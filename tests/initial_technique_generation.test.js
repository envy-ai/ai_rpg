'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Thing = require('../Thing.js');
const TechniqueService = require('../TechniqueService.js');
const LLMClient = require('../LLMClient.js');
const { generateStartingTechniques, parseStartingTechniquePlan, operationIdFor, selectPendingHostileArrivalActors } = require('../StartingTechniques.js');
const { initializeGeneratedNpcTechniques, isGeneratedNpcTechniqueError } = require('../GeneratedNpcTechniques.js');
const { isTinyBrainPromptEnabled } = require('../TinyBrainPromptFamilies.js');
const { createTempDefsDir, withStandardTestConfig } = require('./helpers/needBarFixtures.js');

const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const actorNode = (actor, disciplines) => `<actor><actorId>${actor.id}</actorId><disciplines>${disciplines}</disciplines></actor>`;
const knownTechnique = id => `<discipline><disciplineId>${TechniqueService.getDefinition(id)?.disciplineId || 'discipline-integration'}</disciplineId><techniques><technique><techniqueId>${id}</techniqueId></technique></techniques></discipline>`;
const responseFor = (...actors) => `<startingTechniques>${actors.join('')}</startingTechniques>`;
const itemTag = { aliases: 'alias', revisions: 'revision', acquisitionRequirements: 'requirement', useRequirements: 'requirement', accessRequirements: 'requirement', costs: 'cost', effects: 'effect', attributes: 'attribute', skills: 'skill', needBars: 'needBar' };
function xmlObject(value) {
    return Object.entries(value).map(([key, child]) => {
        if (Array.isArray(child)) {
            assert.ok(itemTag[key], `unknown fixture collection ${key}`);
            return `<${key}>${child.map(entry => `<${itemTag[key]}>${typeof entry === 'object' ? xmlObject(entry) : escapeXml(entry)}</${itemTag[key]}>`).join('')}</${key}>`;
        }
        return `<${key}>${child && typeof child === 'object' ? xmlObject(child) : escapeXml(child)}</${key}>`;
    }).join('');
}

function newDiscipline(name, accessRequirements = []) {
    return { name, description: `${name} tradition.`, accessRequirements, publicAccess: false };
}

function candidate({ semanticKey, name = `Technique ${semanticKey}`, disciplineId, disciplineName = 'Arcane Practice', disciplineRequirements = [{ kind: 'class', name: 'Mage' }], acquisitionRequirements = [], costs = [], effects = [{ id: 'guard', kind: 'buff', stacking: 'refresh', refreshPolicy: 'stronger', status: { name: 'Guard', description: 'A practiced defensive stance.', duration: 3, attributes: [{ attribute: 'Strength', modifier: 1 }], skills: [], needBars: [] } }], recipe, check = { kind: 'automatic' } }) {
    const definition = {
        name,
        description: 'A fully specified initial technique.',
        semanticKey,
        aliases: [],
        revisions: [{
            revision: 1,
            acquisitionRequirements,
            target: { kind: 'self', allowDead: false },
            check,
            ...(recipe ? { recipe } : { costs, effects })
        }]
    };
    const parent = disciplineId ? `<disciplineId>${escapeXml(disciplineId)}</disciplineId>` : xmlObject(newDiscipline(disciplineName, disciplineRequirements));
    return `<discipline>${parent}<techniques><technique><candidate>${xmlObject(definition)}</candidate></technique></techniques></discipline>`;
}

const techniqueChild = group => group.match(/<technique>[\s\S]*<\/technique>/)?.[0];

function withWorld(run, { includeMana = false } = {}) {
    const old = {
        currentPlayer: Globals.currentPlayer,
        baseDir: Globals.baseDir,
        config: Globals.config,
        setting: Globals.setting
    };
    const tempBaseDir = createTempDefsDir({
        prefix: 'ai-rpg-initial-techniques-',
        ...(includeMana ? {
            attributes: [{ id: 'strength', label: 'Strength', default: 5 }, { id: 'intelligence', label: 'Intelligence', default: 10 }],
            needBarsYaml: fs.readFileSync(path.join(__dirname, '../defs/need_bars.yaml'), 'utf8')
        } : {})
    });
    Player.clearRuntimeRegistries();
    Thing.clear();
    TechniqueService.reset();
    Globals.baseDir = tempBaseDir;
    Globals.config = withStandardTestConfig(old.config);
    Player.reloadDefinitionCaches({ refreshInstances: false });
    const cleanup = () => {
        TechniqueService.reset();
        Player.clearRuntimeRegistries();
        Thing.clear();
        Globals.currentPlayer = old.currentPlayer;
        Globals.baseDir = old.baseDir;
        Globals.config = old.config;
        Globals.setting = old.setting;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    };
    try { return Promise.resolve(run()).finally(cleanup); }
    catch (error) { cleanup(); throw error; }
}

function mockLlm(responses, captured = {}, { logPath = null } = {}) {
    const originalCompletion = LLMClient.chatCompletion;
    const originalLogPrompt = LLMClient.logPrompt;
    let index = 0;
    LLMClient.chatCompletion = async options => {
        (captured.calls ??= []).push(options);
        const response = responses[index++];
        if (response instanceof Error) throw response;
        return response;
    };
    LLMClient.logPrompt = options => {
        (captured.logs ??= []).push(options);
        return options.filePath || logPath;
    };
    return () => {
        LLMClient.chatCompletion = originalCompletion;
        LLMClient.logPrompt = originalLogPrompt;
    };
}

function rosterTechnique(discipline, name, description = `${name} is a compact approved technique.`) {
    return { discipline, name, description };
}

function rosterActor(actor, techniques, { includeId = true } = {}) {
    const grouped = new Map();
    for (const entry of techniques) {
        if (!grouped.has(entry.discipline)) grouped.set(entry.discipline, []);
        grouped.get(entry.discipline).push(entry);
    }
    const disciplines = [...grouped].map(([name, entries]) => `<discipline><name>${escapeXml(name)}</name><description>${escapeXml(`${name} is an established tradition.`)}</description><accessRequirements/><publicAccess>false</publicAccess><techniques>${entries.map(entry => `<technique><name>${escapeXml(entry.name)}</name><description>${escapeXml(entry.description)}</description></technique>`).join('')}</techniques></discipline>`).join('');
    return `<actor>${includeId ? `<actorId>${escapeXml(actor.id)}</actorId>` : ''}<disciplines>${disciplines}</disciplines></actor>`;
}

function startingTechniquePlan(...actors) {
    return `<startingTechniquePlan>${actors.join('')}</startingTechniquePlan>`;
}

test('starting-technique roster parser strictly validates actors, required fields, and duplicate entries', () => {
    const one = { id: 'roster-one', name: 'One' };
    const two = { id: 'roster-two', name: 'Two' };
    const parsedSingle = parseStartingTechniquePlan(startingTechniquePlan(
        rosterActor(one, [rosterTechnique('Arcane Practice', 'Ward')], { includeId: false })
    ), { actors: [one] });
    assert.deepEqual(parsedSingle, [{
        actorId: one.id,
        actorName: one.name,
        techniques: [{ discipline: 'Arcane Practice', disciplineId: 'discipline_arcane_practice', candidateDiscipline: { id: 'discipline_arcane_practice', name: 'Arcane Practice', description: 'Arcane Practice is an established tradition.', accessRequirements: [], publicAccess: false }, name: 'Ward', description: 'Ward is a compact approved technique.' }]
    }]);

    const parsedBatch = parseStartingTechniquePlan(startingTechniquePlan(
        rosterActor(one, []),
        rosterActor(two, [rosterTechnique('Medicine', 'Mend')])
    ), { actors: [one, two] });
    assert.deepEqual(parsedBatch.map(entry => entry.techniques.length), [0, 1], 'empty repertoires are explicit and valid');

    const duplicateTechnique = [rosterTechnique('Arcane Practice', 'Ward'), rosterTechnique('Arcane Practice', 'ward')];
    const invalidResponses = [
        '<wrongRoot/>',
        '<startingTechniquePlan/>',
        startingTechniquePlan(rosterActor(one, []), rosterActor(one, [])),
        startingTechniquePlan(rosterActor({ id: 'unknown-roster-actor' }, [])),
        startingTechniquePlan(`<actor><actorId>${one.id}</actorId><disciplines><discipline><name>Arcane Practice</name><description>A tradition.</description><techniques><technique><name>Ward</name></technique></techniques></discipline></disciplines></actor>`),
        startingTechniquePlan(`<actor><actorId>${one.id}</actorId><disciplines><discipline><name>Arcane Practice</name><description>A tradition.</description><techniques><technique><description>A ward.</description></technique></techniques></discipline></disciplines></actor>`),
        startingTechniquePlan(`<actor><actorId>${one.id}</actorId><disciplines><discipline><name>Arcane Practice</name><description>A tradition.</description><techniques><technique><name>Ward</name><description> </description></technique></techniques></discipline></disciplines></actor>`),
        startingTechniquePlan(`<actor><actorId>${one.id}</actorId><disciplines><discipline><name>Arcane Practice</name><description>A tradition.</description><techniques><technique><name>Ward</name><name>Ward 2</name><description>A ward.</description></technique></techniques></discipline></disciplines></actor>`),
        startingTechniquePlan(rosterActor(one, duplicateTechnique)),
        startingTechniquePlan(`<actor><actorId>${one.id}</actorId><disciplines><discipline extra="x"><name>Arcane Practice</name><description>A tradition.</description><techniques><technique><name>Ward</name><description>A ward.</description></technique></techniques></discipline></disciplines></actor>`)
    ];
    for (const [index, response] of invalidResponses.entries()) {
        assert.throws(() => parseStartingTechniquePlan(response, { actors: [one] }), undefined, `invalid fixture ${index}`);
    }
    assert.throws(() => parseStartingTechniquePlan(startingTechniquePlan(
        rosterActor(one, [rosterTechnique('Arcane Practice', 'Ward')]),
        rosterActor(two, [], { includeId: false })
    ), { actors: [one, two] }), /actorId/);
});

test('starting-technique TinyBrain routing inherits the master setting and follows the effective per-prompt override', () => {
    assert.equal(isTinyBrainPromptEnabled({ ai: { tinybrain: true } }, 'starting_techniques'), true);
    assert.equal(isTinyBrainPromptEnabled({
        ai: { tinybrain: true, tinybrain_prompts: { starting_techniques: false } }
    }, 'starting_techniques'), false);
    assert.equal(isTinyBrainPromptEnabled({
        ai: { tinybrain: true },
        ai_model_overrides: {
            local_generation: { prompts: ['starting_techniques'], tinybrain: false, backend: 'openai_compatible' }
        }
    }, 'starting_techniques'), false);
});

test('TinyBrain authors a roster then one technique at a time, retries only the bad entry, and commits shared recipes atomically', async () => withWorld(async () => {
    const first = new Player({ id: 'staged-technique-first', name: 'Mara', description: 'A newly arrived mage.', class: 'Mage', race: 'Elf' });
    const second = new Player({ id: 'staged-technique-second', name: 'Tomas', description: 'A trained mage.', class: 'Mage', race: 'Human' });
    for (const actor of [first, second]) {
        actor.setSkillValue('Spellcasting', 3);
        actor.setAttribute('intelligence', 18);
    }
    TechniqueService.addDiscipline({ id: 'staged-arcane-practice', name: 'Arcane Practice', description: 'A public magical tradition.', publicAccess: true });
    TechniqueService.addDefinition({
        id: 'staged-known-ward', disciplineId: 'staged-arcane-practice', name: 'Known Ward', description: 'An existing defensive technique.',
        semanticKey: 'known-ward', aliases: [], provenance: { kind: 'generation', reason: 'Staged catalogue reuse fixture.' },
        revisions: [{ revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'guard', kind: 'buff', stacking: 'refresh', refreshPolicy: 'stronger', status: { name: 'Guard', description: 'A practiced defensive stance.', duration: 3, attributes: [{ attribute: 'Strength', modifier: 1 }], skills: [], needBars: [] } }] }]
    }, { origin: 'editor' });

    const plan = startingTechniquePlan(
        rosterActor(first, [
            rosterTechnique('Wilderness Medicine', 'Technique shared', 'A common healing technique.'),
            rosterTechnique('Wilderness--Medicine', 'Technique second'),
            rosterTechnique('Arcane Practice', 'Known Ward')
        ]),
        rosterActor(second, [rosterTechnique('Wilderness Medicine', 'Technique shared', 'A common healing technique.')])
    );
    const sharedHealing = candidate({
        semanticKey: 'shared-mend',
        name: 'Technique shared',
        disciplineName: 'Wilderness Medicine',
        recipe: { recipeId: 'standard-healing', skillName: 'Spellcasting', attributeName: 'intelligence', resourceProfileId: 'mana', effectId: 'mend' }
    });
    const wrongSecond = candidate({ semanticKey: 'wrong-second', name: 'Not the approved second', disciplineName: 'Wilderness Medicine' });
    const correctSecond = candidate({ semanticKey: 'second', name: 'Technique second', disciplineName: 'Wilderness Medicine' });
    const knownWard = '<technique><techniqueId>staged-known-ward</techniqueId></technique>';
    const responses = [plan, techniqueChild(sharedHealing), techniqueChild(wrongSecond), techniqueChild(correctSecond), knownWard, techniqueChild(sharedHealing)];
    const captured = {};
    const restore = mockLlm(responses, captured, { logPath: path.resolve(__dirname, '../tmp/starting-techniques-tinybrain-mock.log') });
    const firstHealth = first.health;
    try {
        await generateStartingTechniques({
            actors: [first, second],
            config: { ai: { tinybrain: true, retryAttempts: 1, max_concurrent_requests: 1 } },
            setting: { name: 'Test World' }
        });
    } finally { restore(); }

    assert.equal(captured.calls.length, 6, 'the local result builder must not request a formatting/final response');
    assert.deepEqual(captured.calls.map(call => call.xmlSchema), ['starting-technique-plan.schema.xml', ...Array(5).fill('starting-technique.schema.xml')]);
    assert.equal(captured.calls.every(call => call.metadataLabel === 'starting_techniques'), true);
    assert.equal(captured.calls.every(call => call.allowToolCalls === false && call.additionalPayload.tool_choice === 'none' && call.additionalPayload.tools.length === 0), true);
    const promptText = call => call.messages.map(message => `${message.role}:${message.content || ''}`).join('\n');
    assert.match(promptText(captured.calls[0]), /startingTechniquePlan/);
    assert.match(promptText(captured.calls[1]), /Expand ONLY technique 1 for Mara/);
    assert.match(promptText(captured.calls[2]), /Expand ONLY technique 2 for Mara/);
    assert.match(promptText(captured.calls[3]), /Expand ONLY technique 2 for Mara/);
    assert.match(promptText(captured.calls[3]), /Validation feedback:[\s\S]*Use the approved name Technique second/);
    assert.match(promptText(captured.calls[4]), /Expand ONLY technique 3 for Mara/);
    assert.match(promptText(captured.calls[5]), /Expand ONLY technique 1 for Tomas/);
    assert.doesNotMatch(promptText(captured.calls[4]), /Not the approved second|Use the approved name Technique second/,
        'after the corrected section is accepted, later context drops the rejected response and correction');
    assert.match(promptText(captured.calls[5]), /Technique shared/,
        'the accepted roster and prior accepted technique remain available for the next actor');
    assert.ok(captured.calls[5].messages.some(message => message.role === 'assistant' && String(message.content).includes('shared-mend')),
        'the accepted candidate receipt remains in context for later common-technique reuse');
    assert.doesNotMatch(promptText(captured.calls[5]), /Not the approved second|Use the approved name Technique second/);

    assert.equal(first.techniques.length, 3);
    assert.equal(second.techniques.length, 1);
    assert.equal(first.techniques[0].techniqueId, second.techniques[0].techniqueId,
        'the same common semantic key shares one canonical definition across actors');
    const stagedDiscipline = TechniqueService.getDisciplines().filter(entry => entry.name === 'Wilderness Medicine');
    assert.equal(stagedDiscipline.length, 1, 'a new discipline introduced on the first entry is reused by later entries and actors');
    assert.equal(stagedDiscipline[0].id, 'discipline_wilderness_medicine');
    assert.equal(TechniqueService.getDefinition(first.techniques[0].techniqueId).disciplineId, stagedDiscipline[0].id);
    assert.equal(TechniqueService.getDefinition(first.techniques[1].techniqueId).disciplineId, stagedDiscipline[0].id);
    assert.equal(first.techniques[2].techniqueId, 'staged-known-ward', 'existing catalogue entries are reused by ID');
    const healing = TechniqueService.getDefinition(first.techniques[0].techniqueId);
    assert.equal(healing.revisions[0].balance.recipeId, 'standard-healing');
    assert.equal(first.health, firstHealth, 'authoring a healing recipe learns it without applying its effect');
    assert.ok(TechniqueService.getReceipt(operationIdFor(first)));
    assert.ok(TechniqueService.getReceipt(operationIdFor(second)));
}, { includeMana: true }));

test('TinyBrain empty rosters commit an explicit empty initialization receipt without extra calls', async () => withWorld(async () => {
    const citizen = new Player({ id: 'staged-empty-citizen', name: 'Tomas', description: 'A porter.', class: 'Commoner' });
    const captured = {};
    const restore = mockLlm([startingTechniquePlan(rosterActor(citizen, [], { includeId: false }))], captured, {
        logPath: path.resolve(__dirname, '../tmp/starting-techniques-empty-mock.log')
    });
    try {
        await generateStartingTechniques({ actors: [citizen], config: { ai: { tinybrain: true, retryAttempts: 1 } } });
    } finally { restore(); }
    assert.equal(captured.calls.length, 1, 'empty roster needs no per-technique stage or terminal completion');
    assert.equal(citizen.techniques.length, 0);
    assert.deepEqual(TechniqueService.getReceipt(operationIdFor(citizen)).request.techniqueIds, []);
}, { includeMana: true }));

test('TinyBrain failure in a later technique leaves the entire catalogue and learned state uncommitted', async () => withWorld(async () => {
    const mage = new Player({ id: 'staged-atomic-mage', name: 'Atomic Mage', description: 'A mage.', class: 'Mage' });
    TechniqueService.addDiscipline({ id: 'staged-atomic-discipline', name: 'Arcane Practice', description: 'A public tradition.', publicAccess: true });
    const plan = startingTechniquePlan(rosterActor(mage, [
        rosterTechnique('Arcane Practice', 'Technique first'),
        rosterTechnique('Arcane Practice', 'Technique second')
    ]));
    const acceptedFirst = candidate({ semanticKey: 'atomic-first', name: 'Technique first', disciplineId: 'staged-atomic-discipline' });
    const wrongSecond = candidate({ semanticKey: 'atomic-wrong', name: 'Wrong name', disciplineId: 'staged-atomic-discipline' });
    const captured = {};
    const restore = mockLlm([plan, acceptedFirst, wrongSecond], captured, {
        logPath: path.resolve(__dirname, '../tmp/starting-techniques-atomic-mock.log')
    });
    try {
        await assert.rejects(generateStartingTechniques({
            actors: [mage], config: { ai: { tinybrain: true, retryAttempts: 0 } }
        }), /approved name Technique second/);
    } finally { restore(); }
    assert.equal(captured.calls.length, 3);
    assert.equal(TechniqueService.getDefinitions().length, 0);
    assert.equal(mage.techniques.length, 0);
    assert.equal(TechniqueService.getReceipt(operationIdFor(mage)), null);
}, { includeMana: true }));

test('new caster gets managed healing while an ordinary citizen may remain untrained', async () => withWorld(async () => {
    const caster = new Player({ id: 'initial-caster', name: 'Mara', description: 'A newly arrived mage.', class: 'Mage', race: 'Elf' });
    const citizen = new Player({ id: 'initial-citizen', name: 'Tomas', description: 'A market porter.', class: 'Commoner', race: 'Human' });
    caster.setLevel(3);
    caster.setSkillValue('Spellcasting', 3);
    caster.setAttribute('intelligence', 18);
    const initialHealth = caster.health;
    TechniqueService.addDiscipline({ id: 'private-grant-discipline', name: 'Item Forms', description: 'A grant fixture.', publicAccess: true });
    TechniqueService.addDefinition({
        id: 'private-grant-technique', disciplineId: 'private-grant-discipline', name: 'Hidden Grant', description: 'A grant fixture.',
        semanticKey: 'hidden-grant', aliases: [], provenance: { kind: 'generation', reason: 'Prompt projection fixture.' },
        revisions: [{ revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'mend', kind: 'healing', amount: 1 }] }]
    }, { origin: 'editor' });
    const privateItem = new Thing({
        id: 'private-grant-item', name: 'Private Focus', description: 'An equipped prompt fixture.', thingType: 'item',
        techniqueGrants: [{ id: 'private-grant-id', sourceItemId: 'private-grant-item', techniqueId: 'private-grant-technique', definitionRevision: 1, teaches: false, provenance: { kind: 'item', reason: 'PRIVATE_GRANT_SENTINEL', private: true } }]
    });
    caster.addInventoryItem(privateItem);
    const proposal = candidate({
        semanticKey: 'arcane-mend',
        acquisitionRequirements: [{ kind: 'class', name: 'Mage' }],
        recipe: { recipeId: 'standard-healing', skillName: 'Spellcasting', attributeName: 'intelligence', resourceProfileId: 'mana', effectId: 'mend' }
    });
    const captured = {};
    const restore = mockLlm([responseFor(actorNode(caster, proposal), actorNode(citizen, ''))], captured);
    try {
        await generateStartingTechniques({ actors: [caster, citizen], config: { ai: { retryAttempts: 0 }, privateApiKey: 'DO_NOT_PROMPT' }, setting: { name: 'Test World' } });
    } finally { restore(); }

    assert.equal(caster.techniques.length, 1);
    assert.equal(citizen.techniques.length, 0);
    const known = TechniqueService.getDefinition(caster.techniques[0].techniqueId);
    assert.equal(known.name, 'Technique arcane-mend');
    assert.equal(known.revisions[0].balance.recipeId, 'standard-healing');
    assert.equal(known.revisions[0].effects[0].amount.formula, 'round(10 + 3 * level + 1 * skill_spellcasting + 0.5 * attribute_intelligence_modifier)');
    assert.deepEqual(known.revisions[0].acquisitionRequirements, [{ kind: 'class', name: 'Mage' }]);
    assert.equal(caster.health, initialHealth, 'learning does not pay the recipe cost or apply its healing effect');
    assert.equal(TechniqueService.getReceipt(operationIdFor(caster)).kind, 'initialization');
    assert.deepEqual(TechniqueService.getReceipt(operationIdFor(citizen)).request.techniqueIds, []);
    assert.equal(TechniqueService.getReceiptsForTurn('unused-turn').length, 0);
    assert.equal(captured.calls.length, 1);
    assert.equal(captured.calls[0].allowToolCalls, false);
    assert.deepEqual(captured.calls[0].additionalPayload.tools, []);
    const sent = JSON.stringify(captured.calls[0].messages);
    const projected = JSON.parse(captured.calls[0].messages[1].content);
    assert.deepEqual(Object.keys(projected).sort(), ['actors', 'catalog', 'disciplines', 'explicitTechniques', 'location', 'setting', 'techniqueContext'].sort());
    assert.match(sent, /formulaVariables/);
    assert.match(sent, /level/);
    assert.doesNotMatch(sent, /DO_NOT_PROMPT/);
    assert.doesNotMatch(sent, /PRIVATE_GRANT_SENTINEL/);
    assert.equal(captured.logs.length, 1);
    assert.doesNotMatch(JSON.stringify(captured.logs), /DO_NOT_PROMPT/);
    const retryCapture = {};
    const retryRestore = mockLlm([new Error('Completed initialization must not call the model.')], retryCapture);
    try {
        const replay = await generateStartingTechniques({ actors: [caster, citizen], config: { ai: { retryAttempts: 0 } } });
        assert.equal(replay.length, 2);
    } finally { retryRestore(); }
    assert.equal(retryCapture.calls?.length ?? 0, 0, 'both learned and empty repertoires have durable completion receipts');
}, { includeMana: true }));

test('one common catalogue definition can be reused by two actors without sharing personal revisions', async () => withWorld(async () => {
    const first = new Player({ id: 'initial-reuse-one', name: 'One', description: 'A trained mage.', class: 'Mage', race: 'Human' });
    const second = new Player({ id: 'initial-reuse-two', name: 'Two', description: 'A trained mage.', class: 'Mage', race: 'Elf' });
    TechniqueService.addDiscipline({ id: 'existing-arcane-discipline', name: 'Arcane Practice', description: 'An established tradition.', publicAccess: true });
    TechniqueService.addDefinition({
        id: 'existing-arcane-mend', disciplineId: 'existing-arcane-discipline', name: 'Mend', description: 'A common healing art.',
        semanticKey: 'arcane-mend', aliases: [], provenance: { kind: 'generation', reason: 'Existing common technique fixture.' },
        revisions: [{ revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'mend', kind: 'healing', amount: 1 }] }]
    }, { origin: 'editor' });
    const captured = {};
    const restore = mockLlm([responseFor(actorNode(first, knownTechnique('existing-arcane-mend')), actorNode(second, knownTechnique('existing-arcane-mend')))], captured);
    try { await generateStartingTechniques({ actors: [first, second], config: { ai: { retryAttempts: 0 } } }); }
    finally { restore(); }

    assert.equal(first.techniques.length, 1);
    assert.equal(second.techniques.length, 1);
    assert.equal(first.techniques[0].techniqueId, second.techniques[0].techniqueId);
    assert.equal(TechniqueService.getDefinitions().length, 1);
    const definitionId = first.techniques[0].techniqueId;
    const actorOneOriginal = JSON.stringify(first.techniques[0]);
    const actorTwoOriginal = JSON.stringify(second.techniques[0]);
    TechniqueService.improve({ operationId: 'starting-reuse-improve-one', actor: first, techniqueId: definitionId, mechanics: { ...TechniqueService.getDefinition(definitionId).revisions[0], revision: 2, effects: [{ id: 'guard', kind: 'buff', stacking: 'refresh', refreshPolicy: 'stronger', status: { name: 'Guard', description: 'Improved guard.', duration: 3, attributes: [{ attribute: 'Strength', modifier: 2 }], skills: [], needBars: [] } }] }, evidenceIds: [], provenance: { kind: 'editor', reason: 'Ownership isolation fixture.' }, origin: 'editor' });
    assert.notEqual(JSON.stringify(first.techniques[0]), actorOneOriginal);
    assert.equal(JSON.stringify(second.techniques[0]), actorTwoOriginal);
    assert.equal(TechniqueService.getDefinition(definitionId).revisions[0].effects[0].amount, 1);
}));

test('rejected malformed proposal receives logged correction feedback and commits no candidate state', async () => withWorld(async () => {
    const mage = new Player({ id: 'initial-retry-mage', name: 'Retry Mage', description: 'A mage.', class: 'Mage' });
    const malformed = responseFor(actorNode(mage, candidate({ semanticKey: 'bad-recipe', recipe: { recipeId: 'unknown-healing-recipe', skillName: 'Spellcasting', attributeName: 'intelligence', resourceProfileId: 'mana' } })));
    const captured = {};
    const restore = mockLlm([malformed, malformed], captured);
    try {
        await assert.rejects(generateStartingTechniques({ actors: [mage], config: { ai: { retryAttempts: 1 } } }), /failed to parse after 2 attempts/i);
    } finally { restore(); }
    assert.equal(captured.calls.length, 2);
    assert.match(JSON.stringify(captured.calls[1].messages), /Initial technique validation failed/);
    assert.match(captured.logs.map(entry => JSON.stringify(entry)).join('\n'), /recipe\.recipeId.*unsupported/);
    assert.equal(TechniqueService.getDefinitions().length, 0);
    assert.equal(TechniqueService.getDisciplines().length, 0);
    assert.equal(mage.techniques.length, 0);
    assert.equal(TechniqueService.getReceipt(operationIdFor(mage)), null);
}));

test('failed batch preflight leaves catalog clean and transport cancellation propagates unchanged', async () => withWorld(async () => {
    const citizen = new Player({ id: 'initial-failure-citizen', name: 'Citizen', description: 'An ordinary worker.', class: 'Commoner' });
    const forbidden = candidate({ semanticKey: 'invalid-resource', costs: [{ resource: 'need', needId: 'missing-resource', amount: 1, direction: 'decrease' }] });
    const badRestore = mockLlm([responseFor(actorNode(citizen, forbidden))]);
    try { await assert.rejects(generateStartingTechniques({ actors: [citizen], config: { ai: { retryAttempts: 0 } } }), /need|resource/i); }
    finally { badRestore(); }
    assert.equal(TechniqueService.getDefinitions().length, 0);
    assert.equal(TechniqueService.getDisciplines().length, 0);
    assert.equal(citizen.techniques.length, 0);

    const cancelled = new Error('Prompt transport canceled.');
    cancelled.name = 'AbortError';
    const transportRestore = mockLlm([cancelled]);
    try { await assert.rejects(generateStartingTechniques({ actors: [citizen], config: { ai: { retryAttempts: 0 } } }), error => error === cancelled); }
    finally { transportRestore(); }
    assert.equal(TechniqueService.getDefinitions().length, 0);
    assert.equal(TechniqueService.getReceipt(operationIdFor(citizen)), null);
}));

test('starting discipline access and acquisition skill requirements are bypassed', async () => withWorld(async () => {
    const humanMage = new Player({ id: 'initial-gate-human-mage', name: 'Human Mage', description: 'A mage.', class: 'Mage', race: 'Human' });
    const wrongRace = candidate({ semanticKey: 'elf-only-art', disciplineRequirements: [{ kind: 'race', name: 'Elf' }] });
    const raceRestore = mockLlm([responseFor(actorNode(humanMage, wrongRace))]);
    try { await generateStartingTechniques({ actors: [humanMage], config: { ai: { retryAttempts: 0 } } }); }
    finally { raceRestore(); }
    const learned = TechniqueService.getDefinition(humanMage.techniques[0].techniqueId);
    assert.ok(humanMage.disciplineAccess.some(entry => entry.disciplineId === learned.disciplineId));

    const qualifiedRace = new Player({ id: 'initial-gate-skill-mage', name: 'Skill Mage', description: 'A mage with novice skill.', class: 'Mage', race: 'Elf', skills: { Arcana: 1 } });
    const arcana = [...qualifiedRace.getSkills()].find(([name]) => name.toLowerCase() === 'arcana');
    assert.ok(arcana, 'the configured test world exposes an Arcana skill');
    assert.equal(arcana[1], 1, 'new characters begin with a rank-one skill');
    const rankGate = candidate({ semanticKey: 'advanced-arcane-art', disciplineRequirements: [{ kind: 'race', name: 'Elf' }], acquisitionRequirements: [{ kind: 'skill', name: arcana[0], minimum: 2 }] });
    const skillRestore = mockLlm([responseFor(actorNode(qualifiedRace, rankGate))]);
    try { await generateStartingTechniques({ actors: [qualifiedRace], config: { ai: { retryAttempts: 0 } } }); }
    finally { skillRestore(); }
    assert.equal(qualifiedRace.techniques.length, 1);
    assert.equal(qualifiedRace.disciplineAccess.length, 1);
}));

test('standard and TinyBrain starting selections bypass missing abilities while ordinary learning still checks them', async () => {
    for (const tinybrain of [false, true]) await withWorld(async () => {
        const actor = new Player({ id: 'initial-missing-ability', name: 'Drone', description: 'A newly generated drone.' });
        TechniqueService.addDiscipline({ id: 'laser-discipline', name: 'Laser Practice', description: 'Laser techniques.', publicAccess: true });
        TechniqueService.addDefinition({ id: 'initial-laser', disciplineId: 'laser-discipline', name: 'Erratic Laser Burst',
            description: 'A laser technique.', semanticKey: 'initial-laser', aliases: [],
            provenance: { kind: 'generation', reason: 'Initial selection fixture.' },
            revisions: [{ revision: 1, acquisitionRequirements: [{ kind: 'ability', name: 'Erratic Laser Burst' }],
                useRequirements: [{ kind: 'ability', name: 'Laser Focus' }],
                target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [],
                effects: [{ id: 'heal', kind: 'healing', amount: 1 }] }]
        }, { origin: 'editor' });
        const responses = tinybrain
            ? [startingTechniquePlan(rosterActor(actor, [], { includeId: false }))]
            : [responseFor(actorNode(actor, ''))];
        const restore = mockLlm(responses, {}, { logPath: path.resolve(__dirname, '../tmp/starting-missing-ability.log') });
        try {
            await generateStartingTechniques({ actors: [actor], config: { ai: { tinybrain, retryAttempts: 0 } },
                explicitTechniques: new Map([[actor.id, ['initial-laser']]]) });
        } finally { restore(); }
        assert.equal(actor.techniques[0].techniqueId, 'initial-laser');
        await assert.rejects(TechniqueService.prepare({ operationId: 'initial-laser-use', turnId: 'initial-laser-turn', actor,
            techniqueId: 'initial-laser', targetIds: [actor.id] }), /Laser Focus/);
        const outsider = new Player({ id: 'initial-laser-outsider', name: 'Outsider', description: 'An ordinary learner.' });
        assert.throws(() => TechniqueService.learn({ operationId: 'ordinary-laser-learning', actor: outsider,
            techniqueId: 'initial-laser', provenance: { kind: 'training', reason: 'Ordinary training.' } }), /Requires ability Erratic Laser Burst/);
    });
});

test('completed receipt makes setup retry idempotent and preserves later personal upgrades', async () => withWorld(async () => {
    const mage = new Player({ id: 'initial-idempotent-mage', name: 'Idempotent Mage', description: 'A mage.', class: 'Mage' });
    const reply = responseFor(actorNode(mage, candidate({ semanticKey: 'arcane-mend' })));
    const captured = {};
    const restore = mockLlm([reply, '<malformed should never be requested/>'], captured);
    try {
        await generateStartingTechniques({ actors: [mage], config: { ai: { retryAttempts: 0 } } });
        const id = mage.techniques[0].techniqueId;
        TechniqueService.improve({ operationId: 'starting-retry-upgrade', actor: mage, techniqueId: id, mechanics: { ...TechniqueService.getDefinition(id).revisions[0], revision: 2, effects: [{ id: 'guard', kind: 'buff', stacking: 'refresh', refreshPolicy: 'stronger', status: { name: 'Guard', description: 'Improved guard.', duration: 3, attributes: [{ attribute: 'Strength', modifier: 2 }], skills: [], needBars: [] } }] }, evidenceIds: [], provenance: { kind: 'editor', reason: 'Retry preservation fixture.' }, origin: 'editor' });
        const afterUpgrade = JSON.stringify(mage.techniques);
        const replay = await generateStartingTechniques({ actors: [mage], config: { ai: { retryAttempts: 0 } } });
        assert.equal(replay[0].operationId, operationIdFor(mage));
        assert.equal(JSON.stringify(mage.techniques), afterUpgrade);
    } finally { restore(); }
    assert.equal(captured.calls.length, 1);
}));

test('NPC batch initialization includes every generated role and lets ordinary NPCs remain empty', async () => withWorld(async () => {
    const civilian = new Player({ id: 'initial-npc-civilian', name: 'Baker', description: 'A village baker.', class: 'Commoner', isNPC: true });
    const trainer = new Player({ id: 'initial-npc-trained', name: 'Sela', description: 'A trained mage.', class: 'Mage', race: 'Elf', isNPC: true });
    const captured = {};
    const restore = mockLlm([responseFor(
        actorNode(civilian, ''),
        actorNode(trainer, candidate({ semanticKey: 'arcane-mend', acquisitionRequirements: [{ kind: 'class', name: 'Mage' }] }))
    )], captured);
    try { await initializeGeneratedNpcTechniques([civilian, trainer], { config: { ai: { retryAttempts: 0 } }, setting: { name: 'World' } }); }
    finally { restore(); }
    assert.equal(civilian.techniques.length, 0);
    assert.equal(trainer.techniques.length, 1);
    assert.ok(TechniqueService.getReceipt(operationIdFor(civilian)));
    assert.ok(TechniqueService.getReceipt(operationIdFor(trainer)));
    assert.equal(captured.calls.length, 1, 'the generated actor batch shares one authoring prompt');
    const prompt = JSON.stringify(captured.calls[0].messages);
    assert.match(prompt, /Baker/);
    assert.match(prompt, /Sela/);
}));

test('two actors cannot both own one unique starting definition and failed preflight is atomic', async () => withWorld(async () => {
    const first = new Player({ id: 'initial-unique-one', name: 'First', description: 'A character.', isNPC: true });
    const second = new Player({ id: 'initial-unique-two', name: 'Second', description: 'A character.', isNPC: true });
    TechniqueService.addDiscipline({ id: 'initial-unique-discipline', name: 'Singular', description: 'Unique arts.', publicAccess: true });
    TechniqueService.addDefinition({
        id: 'initial-unique-technique', disciplineId: 'initial-unique-discipline', name: 'One of One', description: 'A unique technique.',
        semanticKey: 'one-of-one', aliases: [], unique: true, provenance: { kind: 'generation', reason: 'Unique ownership fixture.' },
        revisions: [{ revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'mend', kind: 'healing', amount: 1 }] }]
    }, { origin: 'editor' });
    const restore = mockLlm([responseFor(actorNode(first, knownTechnique('initial-unique-technique')), actorNode(second, knownTechnique('initial-unique-technique')))]);
    try { await assert.rejects(generateStartingTechniques({ actors: [first, second], config: { ai: { retryAttempts: 0 } } }), /unique technique/i); }
    finally { restore(); }
    assert.equal(first.techniques.length, 0);
    assert.equal(second.techniques.length, 0);
    assert.equal(TechniqueService.getReceipt(operationIdFor(first)), null);
    assert.equal(TechniqueService.getReceipt(operationIdFor(second)), null);
    assert.equal(TechniqueService.getDefinition('initial-unique-technique').name, 'One of One');
}));

test('NPC initialization wraps full failure causes and preserves typed cancellation identity', async () => withWorld(async () => {
    const npc = new Player({ id: 'initial-wrapper-npc', name: 'Wrapper NPC', description: 'A generated character.', isNPC: true });
    const rootCause = new Error('Root provider failure.');
    rootCause.stack = 'Error: Root provider failure.\n    at RootCauseFrame (fixture.js:2:3)';
    const transportError = new Error('Transport failed.', { cause: rootCause });
    transportError.stack = 'Error: Transport failed.\n    at TransportCauseFrame (fixture.js:1:2)';
    const restore = mockLlm([transportError]);
    try {
        await assert.rejects(initializeGeneratedNpcTechniques([npc], { config: { ai: { retryAttempts: 0 } } }), error => {
            assert.equal(error.code, 'NPC_TECHNIQUE_INITIALIZATION_FAILED');
            assert.equal(error.cause, transportError);
            assert.match(error.stack, /TransportCauseFrame/);
            assert.match(error.stack, /RootCauseFrame/);
            assert.equal(isGeneratedNpcTechniqueError(error), true);
            return true;
        });
    } finally { restore(); }

    for (const [name, code] of [['PromptCancellationError', 'PROMPT_CANCELLED'], ['CanceledError', 'ERR_CANCELED'], ['AbortError', undefined]]) {
        const cancellation = new Error(`Canceled via ${name}.`);
        cancellation.name = name;
        if (code) cancellation.code = code;
        const cancelRestore = mockLlm([cancellation]);
        try {
            await assert.rejects(initializeGeneratedNpcTechniques([npc], { config: { ai: { retryAttempts: 0 } } }), error => {
                assert.equal(error, cancellation, 'the cancellation error object must pass through unchanged');
                assert.equal(error.npcTechniqueInitializationFailed, true);
                assert.equal(isGeneratedNpcTechniqueError(error), true);
                return true;
            });
        } finally { cancelRestore(); }
    }
    assert.equal(npc.techniques.length, 0);
    assert.equal(TechniqueService.getReceipt(operationIdFor(npc)), null);
}));

test('hostile arrival technique repair selects only unreceipted NPCs at the exact destination and arrival', async () => withWorld(async () => {
    const exact = new Player({ id: 'arrival-exact', name: 'Exact', description: 'Exact arrival.', isNPC: true, location: 'destination-a' });
    exact.hostileArrivalProvenance = { arrivalId: 'arrival-1', pendingAttemptId: 'pending-1', source: 'wild' };
    const otherArrival = new Player({ id: 'arrival-other-id', name: 'Other arrival', description: 'Different arrival.', isNPC: true, location: 'destination-a' });
    otherArrival.hostileArrivalProvenance = { arrivalId: 'arrival-2', pendingAttemptId: 'pending-2', source: 'wild' };
    const otherDestination = new Player({ id: 'arrival-other-destination', name: 'Other destination', description: 'Different destination.', isNPC: true, location: 'destination-b' });
    otherDestination.hostileArrivalProvenance = { arrivalId: 'arrival-1', pendingAttemptId: 'pending-1', source: 'wild' };
    const alreadyInitialized = new Player({ id: 'arrival-complete', name: 'Complete', description: 'Has a completion marker.', isNPC: true, location: 'destination-a' });
    alreadyInitialized.hostileArrivalProvenance = { arrivalId: 'arrival-1', pendingAttemptId: 'pending-1', source: 'wild' };
    TechniqueService.commitLearningBatch(TechniqueService.prepareLearningBatch([{ actor: alreadyInitialized, operationId: operationIdFor(alreadyInitialized), techniques: [] }]));
    const player = new Player({ id: 'arrival-player', name: 'Player', description: 'Not an NPC.', location: 'destination-a' });
    player.hostileArrivalProvenance = { arrivalId: 'arrival-1', pendingAttemptId: 'pending-1', source: 'wild' };
    const actors = [exact, otherArrival, otherDestination, alreadyInitialized, player];
    assert.deepEqual(selectPendingHostileArrivalActors(actors, { destinationId: 'destination-a', arrivalId: 'arrival-1' }).map(actor => actor.id), ['arrival-exact']);
    assert.deepEqual(selectPendingHostileArrivalActors(actors, { destinationId: 'destination-a', arrivalId: 'arrival-2' }).map(actor => actor.id), ['arrival-other-id']);
    assert.deepEqual(selectPendingHostileArrivalActors(actors, { destinationId: 'destination-c', arrivalId: 'arrival-1' }), []);
}));

test('standard and TinyBrain initial repertoires persist explicit access for rank-one disciplines without opening ordinary learning', async () => {
    for (const tinybrain of [false, true]) await withWorld(async () => {
        const actor = new Player({ id: `rank-one-${tinybrain}`, name: 'Novice', description: 'A newly trained practitioner.', class: 'Commoner', race: 'Human' });
        actor.setSkillValue('Spellcasting', 1);
        const proposal = candidate({ semanticKey: `novice-${tinybrain}`, name: 'Novice Guard', disciplineName: 'Novice Practice', disciplineRequirements: [{ kind: 'skill', name: 'Spellcasting', minimum: 1 }] });
        const responses = tinybrain
            ? [startingTechniquePlan(rosterActor(actor, [rosterTechnique('Novice Practice', 'Novice Guard')], { includeId: false })), proposal]
            : [responseFor(actorNode(actor, proposal))];
        const restore = mockLlm(responses, {}, { logPath: path.resolve(__dirname, '../tmp/starting-rank-one.log') });
        try { await generateStartingTechniques({ actors: [actor], config: { ai: { tinybrain, retryAttempts: 0 } } }); }
        finally { restore(); }
        assert.equal(actor.techniques.length, 1);
        const learned = TechniqueService.getDefinition(actor.techniques[0].techniqueId);
        assert.ok(actor.disciplineAccess.some(entry => entry.disciplineId === learned.disciplineId));
        const restored = Player.fromJSON(JSON.parse(JSON.stringify(actor.toJSON())));
        assert.deepEqual(restored.disciplineAccess, actor.disciplineAccess);
        assert.ok(TechniqueService.getPromptContext([restored])[0].disciplineAccess.some(entry => entry.id === learned.disciplineId));
        const outsider = new Player({ id: `rank-one-outsider-${tinybrain}`, name: 'Untrained', description: 'An untrained practitioner.', class: 'Commoner', race: 'Human' });
        outsider.setSkillValue('Spellcasting', 1);
        assert.throws(() => TechniqueService.learn({ operationId: `ordinary-learning-${tinybrain}`, actor: outsider, techniqueId: learned.id, provenance: { kind: 'training', reason: 'Test ordinary learning.' } }), /access|baseline/i);
        assert.equal(outsider.techniques.length, 0);
    });
});

test('starting technique plan and final response allow omitted empty actor repertoires', () => {
    const actor = { id: 'npc_1', name: 'Villager' };
    const plan = parseStartingTechniquePlan('<startingTechniquePlan><actor><actorId>npc_1</actorId></actor></startingTechniquePlan>', { actors: [actor] });
    assert.deepEqual(plan[0].techniques, []);
    const result = require('../StartingTechniques.js').parseStartingTechniques('<startingTechniques><actor><actorId>npc_1</actorId></actor></startingTechniques>', { actors: [actor], disciplines: [] });
    assert.deepEqual(result.get('npc_1'), []);
    assert.throws(() => parseStartingTechniquePlan('<startingTechniquePlan><actor><actorId>npc_1</actorId><disciplines/><disciplines/></actor></startingTechniquePlan>', { actors: [actor] }), /disciplines/i);
    assert.throws(() => parseStartingTechniquePlan('<startingTechniquePlan/>', { actors: [actor] }), /actor/i);
});

test('starting roster optional actor ID accepts empty text only for a known sole actor', () => {
    const actor = { id: 'roster-empty-one', name: 'One' };
    const other = { id: 'roster-empty-two', name: 'Two' };
    const omitted = '<startingTechniquePlan><actor><disciplines/></actor></startingTechniquePlan>';
    for (const empty of ['<actorId/>', '<actorId></actorId>', '<actorId> \n </actorId>']) {
        const xml = omitted.replace('<actor>', `<actor>${empty}`);
        assert.deepEqual(parseStartingTechniquePlan(xml, { actors: [actor] }), parseStartingTechniquePlan(omitted, { actors: [actor] }));
        assert.throws(() => parseStartingTechniquePlan(xml, { actors: [actor, other] }), /nonempty/);
    }
    for (const invalid of ['<actorId extra="x"/>', '<actorId><unknown/></actorId>', '<actorId/><actorId>roster-empty-one</actorId>']) {
        assert.throws(() => parseStartingTechniquePlan(omitted.replace('<actor>', `<actor>${invalid}`), { actors: [actor] }));
    }
});

test('starting candidates permit empty optional reference IDs without weakening entry choice validation', async () => withWorld(async () => {
    const { parseStartingTechniques } = require('../StartingTechniques.js');
    const actor = new Player({ name: 'Empty ID Tester', description: 'A mage.', class: 'Mage', race: 'Human', level: 1 });
    const entry = candidate({ semanticKey: 'empty-reference' });
    for (const empty of ['<techniqueId/>', '<techniqueId></techniqueId>', '<techniqueId> \n </techniqueId>']) {
        const xml = responseFor(actorNode(actor, entry.replace('<technique><candidate>', `<technique>${empty}<candidate>`)));
        assert.equal(parseStartingTechniques(xml, { actors: [actor] }).get(actor.id)[0].candidate.semanticKey, 'empty-reference');
        assert.throws(() => parseStartingTechniques(responseFor(actorNode(actor, `<discipline><name>Empty Parent</name><description>A new practice.</description><accessRequirements/><publicAccess>true</publicAccess><techniques><technique>${empty}</technique></techniques></discipline>`)), { actors: [actor] }), /exactly one techniqueId or candidate/);
    }
    for (const invalid of [
        '<techniqueId>known-ward</techniqueId>', '<techniqueId extra="x"/>',
        '<techniqueId><unknown/></techniqueId>', '<techniqueId/><techniqueId>known-ward</techniqueId>'
    ]) {
        assert.throws(() => parseStartingTechniques(responseFor(actorNode(actor, entry.replace('<technique><candidate>', `<technique>${invalid}<candidate>`))), { actors: [actor] }));
    }
    assert.throws(() => parseStartingTechniques('<startingTechniques><actor><actorId/></actor></startingTechniques>', { actors: [actor] }), /nonempty/);
}));

test('named schemas accept parser-valid nested candidates and reject discipline nested inside candidate', async () => withWorld(async () => {
    const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
    const { loadXmlGenerationSchema } = require('../XmlGenerationSchema.js');
    const { parseStartingTechniques } = require('../StartingTechniques.js');
    const actor = new Player({ name: 'Schema Tester', description: 'A mage.', class: 'Mage', race: 'Human', level: 1 });
    const entry = candidate({ semanticKey: 'schema-test' });
    const xml = responseFor(actorNode(actor, entry));
    assert.ok(parseStartingTechniques(xml, { actors: [actor] }).get(actor.id));
    assert.equal(new XmlClosingTagGuard({ schema: loadXmlGenerationSchema('starting-techniques.schema.xml') }).inspect(xml), null);
    assert.equal(new XmlClosingTagGuard({ schema: loadXmlGenerationSchema('technique-authoring-discipline.schema.xml') }).inspect(entry), null);
    const wrong = entry.replace('<candidate>', '<candidate><disciplineId>nested-parent</disciplineId>');
    assert.ok(new XmlClosingTagGuard({ schema: loadXmlGenerationSchema('technique-authoring-discipline.schema.xml') }).inspect(wrong));
    assert.throws(() => parseStartingTechniques(responseFor(actorNode(actor, wrong)), { actors: [actor] }), /disciplineId.*unsupported|Put the discipline ID/i);
}));

test('standard and TinyBrain starting authoring compile semantic damage recipes', async () => {
    for (const tinybrain of [false, true]) await withWorld(async () => {
        const actor = new Player({ name: 'Mage', description: 'A practiced caster.', class: 'Mage', race: 'Human', level: 3 });
        actor.setSkillValue('Spellcasting', 3);
        const proposal = candidate({ semanticKey: `starter-strike-${tinybrain}`, name: 'Starter Strike', recipe: { kind: 'damage', skillName: 'Spellcasting', attributeName: 'intelligence' }, check: { kind: 'skill', skill: 'Spellcasting', difficulty: 'Medium' } });
        const replies = tinybrain ? [startingTechniquePlan(rosterActor(actor, [rosterTechnique('Arcane Practice', 'Starter Strike')])), proposal] : [responseFor(actorNode(actor, proposal))];
        const captured = {}, restore = mockLlm(replies, captured, { logPath: path.resolve(__dirname, '../tmp/starting-damage-test.log') });
        try { await generateStartingTechniques({ actors: [actor], config: { ai: { tinybrain, retryAttempts: 0 } }, setting: {} }); }
        finally { restore(); }
        assert.equal(actor.techniques.length, 1);
        const definition = TechniqueService.getDefinition(actor.techniques[0].techniqueId);
        assert.equal(definition.revisions[0].balance.recipeId, 'standard-damage');
        assert.equal(definition.revisions[0].effects[0].kind, 'damage');
        assert.equal(definition.revisions[0].balance.selections.resourceProfileId, 'mana');
    }, { includeMana: true });
});
