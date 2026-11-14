'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const LLMClient = require('../LLMClient.js');
const TechniqueService = require('../TechniqueService.js');
const { prepareTechniqueIntent, parseTechniqueIntent, receiptInvocation, resolveTechniqueAttemptIdentity, parseAutomaticTechniqueDiscipline, getTechniqueCreationInstructions } = require('../TechniquePrompt.js');
const { withTechniqueWorld, mechanics, addDefinition, learn } = require('./helpers/techniqueIntegrationFixtures.js');
const { DOMImplementation, XMLSerializer } = require('@xmldom/xmldom');
const { writeTechniqueXmlValue, candidateSchema, disciplineGroupSchema } = require('../TechniqueXml.js');

test('LLMClient-first import supports actual technique prompting in a fresh process', () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern', '^disabled NPC technique is reported', __filename], {
        encoding: 'utf8', timeout: 30000, env
    });
    assert.equal(child.status, 0, child.stderr + child.stdout);
    assert.match(child.stdout, /# pass 1/);
});
function asXml(tag, value, schema) {
    const document = new DOMImplementation().createDocument(null, tag, null);
    writeTechniqueXmlValue(document.documentElement, value, schema);
    return new XMLSerializer().serializeToString(document.documentElement);
}

function techniqueIntent(kind, techniqueId, actor, target, extra = '') {
    return `<techniqueIntent><kind>${kind}</kind><actor>${actor.name}</actor><intent>Restore ${target.name}.</intent><techniqueId>${techniqueId}</techniqueId>${extra}<targets><targetId>${target.id}</targetId></targets></techniqueIntent>`;
}

function candidateIntent(actor, target, candidate, candidateDiscipline = null) {
    const body = { ...candidate };
    if (candidateDiscipline) {
        candidateDiscipline = { ...candidateDiscipline };
        delete candidateDiscipline.id;
        delete body.disciplineId;
    } else {
        candidateDiscipline = { disciplineId: body.disciplineId };
    }
    delete body.disciplineId;
    delete body.id;
    delete body.provenance;
    const discipline = asXml('discipline', { ...candidateDiscipline, techniques: [{ candidate: body }] }, disciplineGroupSchema);
    return techniqueIntent('discover', '', actor, target, discipline).replace(/<techniqueId><\/techniqueId>/, '');
}

test('technique intent optional empty leaves mean omission while required fields and scalar structure stay strict', () => {
    const actor = { id: 'actor-1', name: 'Actor' };
    const xml = techniqueIntent('use', 'known-ward', actor, actor);
    const empty = '<sourceId/><operationId> \n </operationId><newAttempt></newAttempt><discoveryIntent/>';
    assert.deepEqual(parseTechniqueIntent(xml.replace('</techniqueIntent>', `${empty}</techniqueIntent>`)), parseTechniqueIntent(xml));
    for (const invalid of [
        '<sourceId extra="x"/>', '<sourceId><unknown/></sourceId>', '<sourceId/><sourceId>duplicate</sourceId>',
        '<newAttempt>false</newAttempt>', '<operationId>receipt-1</operationId><newAttempt>true</newAttempt>'
    ]) assert.throws(() => parseTechniqueIntent(xml.replace('</techniqueIntent>', `${invalid}</techniqueIntent>`)), undefined, invalid);
    for (const field of ['kind', 'actor', 'intent', 'techniqueId']) {
        assert.throws(() => parseTechniqueIntent(xml.replace(new RegExp(`<${field}>[^<]*</${field}>`), `<${field}/>`)), /nonempty/);
    }
    const candidate = {
        name: 'Ward', description: 'A ward.', semanticKey: 'ward',
        revisions: [mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'Practice.', duration: 5, maxHealthPercent: 10 } }] })]
    };
    const discovery = techniqueIntent('discover', '', actor, actor, asXml('discipline', {
        name: 'Wardcraft', description: 'A warding practice.', accessRequirements: [], publicAccess: true,
        techniques: [{ candidate }]
    }, disciplineGroupSchema)).replace('<techniqueId></techniqueId>', '');
    const parsed = parseTechniqueIntent(discovery);
    assert.equal(parsed.techniqueId, parsed.candidate.id);
    assert.equal(parsed.candidate.disciplineId, 'discipline_wardcraft');
    assert.throws(() => parseTechniqueIntent(techniqueIntent('discover', '', actor, actor, asXml('candidate', candidate, candidateSchema))), /unsupported <candidate>/);
    assert.throws(() => parseTechniqueIntent(techniqueIntent('discover', '', actor, actor)), /Discovery requires/);
});

test('automatic discipline authoring rejects placeholders without invalidating saved example names', () => {
    const raw = { id: 'discipline-naming', name: 'Spellcasting', description: 'Study and practice of spells.', accessRequirements: [], publicAccess: false };
    for (const [key, value] of [['name', 'DISCIPLINE_NAME'], ['description', 'A tradition: DISCIPLINE_DESCRIPTION']]) {
        assert.throws(() => parseAutomaticTechniqueDiscipline({ ...raw, [key]: value }), new RegExp(`candidateDiscipline.${key}.*unresolved example placeholder`));
    }
    assert.equal(parseAutomaticTechniqueDiscipline(raw).name, 'Spellcasting');
    assert.equal(require('../Technique.js').normalizeDiscipline({ ...raw, name: 'Established Practice' }).name, 'Established Practice', 'save hydration and manual authoring keep their existing contract');
    const instructions = getTechniqueCreationInstructions();
    assert.match(instructions, /<discipline>[\s\S]*DISCIPLINE_NAME/);
    assert.match(instructions, /existing parent/i);
});

test('starting repertoire and event learning share discipline placeholder validation', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const discipline = { name: 'DISCIPLINE_NAME', description: 'A valid description.', accessRequirements: [], publicAccess: false };
        const response = `<startingTechniques><actor><actorId>${player.id}</actorId><disciplines><discipline><name>DISCIPLINE_NAME</name><description>A valid description.</description><accessRequirements/><publicAccess>false</publicAccess><techniques><technique><candidate><name>Named technique</name></candidate></technique></techniques></discipline></disciplines></actor></startingTechniques>`;
        assert.throws(() => require('../StartingTechniques.js').parseStartingTechniques(response, { actors: [player] }), /candidateDiscipline.name.*unresolved example placeholder|discipline.name.*unresolved example placeholder/);
        const eventXml = `<techniqueChange><kind>learn</kind><actorId>${player.id}</actorId><provenance><kind>discovery</kind><reason>Training.</reason></provenance><discipline><name>DISCIPLINE_NAME</name><description>A valid description.</description><accessRequirements/><publicAccess>false</publicAccess><techniques><technique><candidate><name>Named technique</name><description>A technique.</description><semanticKey>named-technique</semanticKey></candidate></technique></techniques></discipline></techniqueChange>`;
        assert.throws(() => require('../TechniqueEvents.js').parseChangeXml(require('../Utils.js').parseXmlDocumentStrict(eventXml, 'text/xml').documentElement), /candidateDiscipline.name.*unresolved example placeholder|discipline.name.*unresolved example placeholder/);
        assert.equal(TechniqueService.getDisciplines().some(entry => entry.name === 'DISCIPLINE_NAME'), false);
    });
});

test('discipline placeholder errors reach the model and correction commits only the meaningful discipline', async () => {
    await withTechniqueWorld(async ({ player, location }) => {
        const discipline = { name: 'Spellcasting', description: 'Study and practice of spells.', accessRequirements: [{ kind: 'skill', name: 'Spellcasting', minimum: 2 }], publicAccess: false };
        const candidate = {
            id: 'technique-naming', name: 'Mending Light', description: 'A healing spell.', semanticKey: 'mending-light',
            provenance: { kind: 'discovery', reason: 'Existing spellcasting training.' },
            revisions: [{ revision: 1, target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' },
                recipe: { recipeId: 'standard-healing', skillName: 'Spellcasting', attributeName: 'intelligence', resourceProfileId: 'mana', effectId: 'restore' } }]
        };
        await withMockedPrompt({
            async complete(options, attempt) {
                assert.equal(TechniqueService.getDefinition(candidate.id), null);
                assert.equal(TechniqueService.getDisciplines().some(entry => entry.id === 'discipline_spellcasting'), false);
                assert.deepEqual(player.disciplineAccess, [], 'model retries cannot grant discipline access');
                if (attempt === 1) return candidateIntent(player, player, candidate, { ...discipline, name: 'DISCIPLINE_NAME' });
                assert.match(JSON.stringify(options.messages), /(?:candidateDiscipline|discipline).name contains unresolved example placeholder DISCIPLINE_NAME/);
                return candidateIntent(player, player, candidate, discipline);
            },
            async execute({ completions, logs }) {
                await prepareTechniqueIntent({ actor: player, actionText: 'Heal myself.', turnId: 'naming-turn', operationId: 'naming-use', baseContext: { currentLocation: location },
                    resolveActor: () => player, assertTarget: () => {}, config: { ai: { retryAttempts: 1 } } });
                assert.equal(completions.length, 2);
                assert.equal(logs.length, 2);
                assert.equal(TechniqueService.getDisciplines().find(entry => entry.id === 'discipline_spellcasting').name, 'Spellcasting');
                assert.equal(player.techniques.length, 1);
                assert.deepEqual(player.disciplineAccess.map(entry => entry.disciplineId), ['discipline_spellcasting']);
            }
        });
    }, { includeMana: true });
});

test('mixed recipe retry sends all missing status selectors to the model in one correction', async () => {
    await withTechniqueWorld(async ({ player, location }) => {
        player.setSkillValue('Field Craft', 3);
        const attributes = player.getAttributeNames();
        assert.ok(attributes.length >= 2);
        const component = { kind: 'buff', resourceProfileId: 'mana', statusStatKind: 'attribute', statusModifierKind: 'fixed', statusName: 'Arcane Guard', statusDescription: 'Improves an attribute.' };
        const candidate = { id: 'mixed-retry', disciplineId: 'discipline-integration', name: 'Healing Guard', description: 'Restores and strengthens.', semanticKey: 'healing-guard', aliases: [], revisions: [{ revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, recipe: { components: [{ kind: 'healing', skillName: 'Spellcasting', attributeName: attributes[0], resourceProfileId: 'mana' }, component] } }] };
        await withMockedPrompt({
            async complete(options, attempt) {
                if (attempt === 1) return candidateIntent(player, player, candidate);
                const feedback = JSON.stringify(options.messages);
                assert.match(feedback, /components\[1\]\.skillName/);
                assert.match(feedback, /components\[1\]\.statusStatName/);
                assert.match(feedback, /Arcane Guard/);
                const repaired = structuredClone(candidate);
                Object.assign(repaired.revisions[0].recipe.components[1], { skillName: 'Spellcasting', statusStatName: attributes[0] });
                return candidateIntent(player, player, repaired);
            },
            async execute({ completions }) {
                await prepareTechniqueIntent({ actor: player, actionText: 'Heal and strengthen myself.', turnId: 'mixed-retry-turn', operationId: 'mixed-retry-use', baseContext: { currentLocation: location }, resolveActor: () => player, assertTarget: () => {}, config: { ai: { retryAttempts: 1 } } });
                assert.equal(completions.length, 2);
                assert.equal(player.techniques.length, 1);
            }
        });
    }, { includeMana: true });
});

async function withMockedPrompt(run) {
    const originalComplete = LLMClient.chatCompletion;
    const originalLog = LLMClient.logPrompt;
    const completions = [];
    const logs = [];
    LLMClient.chatCompletion = async options => {
        completions.push(options);
        assert.equal(options.validateXML, false, 'the outer technique parser owns XML correction');
        assert.equal(options.throwOnError, true, 'transport and completion failures escape to the outer turn');
        assert.equal(options.allowToolCalls, false, 'technique selection does not enter a nested tool loop');
        assert.deepEqual(options.additionalPayload, { tools: [], tool_choice: 'none' });
        return await run.complete(options, completions.length);
    };
    LLMClient.logPrompt = entry => logs.push(entry);
    try {
        await run.execute({ completions, logs });
    } finally {
        LLMClient.chatCompletion = originalComplete;
        LLMClient.logPrompt = originalLog;
    }
}

test('technique prompt corrects malformed discovery fields, then commits a qualified managed self-heal', async () => {
    await withTechniqueWorld(async ({ player, target, location }) => {
        const candidate = {
            id: 'technique-prompt-discovery',
            disciplineId: 'discipline-integration',
            name: 'Restore Self',
            description: 'A practiced self-healing technique.',
            semanticKey: 'restore-self',
            aliases: [],
            provenance: { kind: 'discovery', reason: 'A tested first attempt.' },
            revisions: [{
                revision: 1,
                acquisitionRequirements: [{ kind: 'class', name: player.class }],
                target: { kind: 'self', allowDead: false },
                check: { kind: 'automatic' },
                recipe: { recipeId: 'standard-healing', skillName: 'Spellcasting', attributeName: 'intelligence', resourceProfileId: 'mana', effectId: 'restore' }
            }]
        };
        player.setHealth(player.health - 5);
        const startingHealth = player.health;
        let preparationChecks = 0;
        await withMockedPrompt({
            async complete(options, attempt) {
                assert.equal(player.health, startingHealth, 'model response must be parsed before any cost/effect is committed');
                assert.equal(player.techniques.length, 0, 'discovery must remain staged until accepted preparation');
                assert.equal(TechniqueService.getReceipt('turn-prompt:technique:ordinal-0'), null);
                assert.equal(options.metadataLabel, 'technique_intent');
                if (attempt === 1) return techniqueIntent('discover', '', player, player, '<candidate>{invalid</candidate>');
                if (attempt === 2) return candidateIntent(player, player, candidate).replace(/<acquisitionRequirements>[\s\S]*?<\/acquisitionRequirements>/, '<acquisitionRequirements><requirement>Mage</requirement></acquisitionRequirements>');
                if (attempt === 3) return candidateIntent(player, player, { ...candidate, revisions: [{ ...candidate.revisions[0], recipe: { ...candidate.revisions[0].recipe, skillName: 'Unknown Magic' } }] });
                return candidateIntent(player, player, candidate);
            },
            async execute({ completions, logs }) {
                const invocation = await prepareTechniqueIntent({
                    actor: player,
                    actionText: 'Restore myself.',
                    turnId: 'turn-prompt',
                    operationId: 'turn-prompt:technique:ordinal-0',
                    baseContext: {
                        currentLocation: location,
                        setting: { genre: 'fantasy', description: 'A controlled fixture.' },
                        privateServerConfig: 'PROMPT_SECRET_MUST_NOT_APPEAR'
                    },
                    prepareCheck: async () => { preparationChecks += 1; return { success: true }; },
                    resolveActor: name => [player, target].find(actor => actor.id === name || actor.name === name) || null,
                    assertTarget: id => {
                        if (![player.id, target.id].includes(id)) throw new Error(`Unknown target ${id}.`);
                    },
                    config: { ai: { retryAttempts: 3, apiKey: 'CONFIG_SECRET_MUST_NOT_APPEAR' } }
                });

                assert.equal(completions.length, 4);
                assert.equal(preparationChecks, 0, 'automatic healing uses the actual service without an invented check');
                assert.equal(invocation.name, 'useTechnique');
                assert.equal(invocation.metadata.techniqueReceipt.committed, true);
                candidate.id = invocation.metadata.techniqueReceipt.techniqueId;
                assert.match(candidate.id, /^technique_restore_self(?:_\d+)?$/);
                assert.deepEqual(invocation.metadata.techniqueReceipt.techniqueChanges.map(change => change.kind), ['learned']);
                assert.equal(player.techniques[0].techniqueId, candidate.id);
                assert.equal(player.health, Math.min(player.maxHealth, startingHealth + 24));
                assert.equal(player.getNeedBarValue('mana'), 917, 'the compiled first-use recipe charges its current 83-mana cost');
                const discovered = TechniqueService.getDefinition(candidate.id);
                assert.deepEqual(discovered.revisions[0].target, { kind: 'self', allowDead: false });
                assert.deepEqual(discovered.revisions[0].check, { kind: 'automatic' });
                assert.deepEqual(discovered.revisions[0].acquisitionRequirements, [{ kind: 'class', name: player.class }]);
                assert.equal(discovered.revisions[0].effects[0].amount.formula, 'round(10 + 3 * level + 1 * skill_spellcasting + 0.5 * attribute_intelligence_modifier)');
                assert.equal(discovered.revisions[0].balance.recipeId, 'standard-healing');
                assert.equal(discovered.revisions[0].costs[0].amount.formula, 'ceil(100 / (1 + 0.05 * skill_spellcasting + 0.02 * level))');
                assert.equal(TechniqueService.getReceiptsForTurn('turn-prompt').length, 1);
                assert.throws(() => resolveTechniqueAttemptIdentity({
                    actor: player,
                    techniqueId: candidate.id,
                    targetIds: [player.id],
                    turnId: 'turn-prompt'
                }), /matching technique attempt is already committed/);
                assert.equal(resolveTechniqueAttemptIdentity({
                    actor: player,
                    techniqueId: candidate.id,
                    targetIds: [player.id],
                    operationId: invocation.id,
                    turnId: 'turn-prompt'
                }).operationId, invocation.id);
                assert.equal(resolveTechniqueAttemptIdentity({
                    actor: player,
                    techniqueId: candidate.id,
                    targetIds: [player.id],
                    newAttempt: true,
                    turnId: 'turn-prompt'
                }), null);
                assert.equal(logs.length, 4, 'accepted and every rejected prompt attempt are logged');
                const validationLogs = logs.map(entry => entry.sections.find(section => section.title === 'Validation').content).join('\n');
                assert.match(validationLogs, /JSON|unexpected end|position/i);
                assert.match(validationLogs, /acquisitionRequirements|requirement/i);
                assert.match(validationLogs, /recipe\.skillName.*no unambiguous actual skill Unknown Magic/i);
                assert.match(validationLogs, /accepted/i);
                assert.doesNotMatch(JSON.stringify(completions), /PROMPT_SECRET_MUST_NOT_APPEAR|CONFIG_SECRET_MUST_NOT_APPEAR/);
                assert.doesNotMatch(JSON.stringify(logs), /PROMPT_SECRET_MUST_NOT_APPEAR|CONFIG_SECRET_MUST_NOT_APPEAR/);
                assert.equal(receiptInvocation(invocation.metadata.techniqueReceipt, 'Restore myself.').metadata.techniqueReceipt.operationId, invocation.id);

                const committedHealth = player.health;
                const completionCount = completions.length;
                const replay = await prepareTechniqueIntent({
                    actor: player,
                    actionText: 'Restore myself.',
                    turnId: 'turn-prompt',
                    operationId: 'turn-prompt:technique:ordinal-0',
                    explicitUse: {
                        actorId: player.id,
                        techniqueId: candidate.id,
                        sourceId: `learned:${candidate.id}`,
                        targetIds: [player.id]
                    },
                    baseContext: { currentLocation: location, setting: {} },
                    prepareCheck: async () => { throw new Error('A committed retry must not prepare another check.'); },
                    resolveActor: name => name === player.name ? player : null,
                    assertTarget: id => { if (id !== player.id) throw new Error(`Unknown target ${id}.`); },
                    config: { ai: { retryAttempts: 1 } }
                });
                assert.equal(replay.id, invocation.id);
                assert.equal(completions.length, completionCount, 'committed explicit retry skips another completion');
                assert.equal(player.health, committedHealth, 'receipt replay does not charge or heal a second time');
            }
        });
    }, { includeMana: true });
});

test('correcting malformed novel technique mechanics keeps the reserved technique and discipline identities', async () => {
    await withTechniqueWorld(async ({ player, location }) => {
        const invalid = {
            id: 'will-be-reserved', name: 'Field Mend', description: 'A practical healing technique.',
            semanticKey: 'field-mend', aliases: [],
            revisions: [{ revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [] }]
        };
        const valid = {
            ...invalid,
            revisions: [{ revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'ward', kind: 'buff', status: { name: 'Field Guard', description: 'A practiced ward.', duration: 1, attributes: [{ attribute: 'strength', modifier: 1 }] } }] }]
        };
        const discipline = { name: 'Field Medicine', description: 'Practical restorative work.', accessRequirements: [], publicAccess: true };
        await withMockedPrompt({
            async complete(options, attempt) {
                if (attempt === 1) return candidateIntent(player, player, invalid, { ...discipline });
                assert.match(JSON.stringify(options.messages), /effects cannot be empty/i);
                return candidateIntent(player, player, valid, { ...discipline });
            },
            async execute({ completions, logs }) {
                const result = await prepareTechniqueIntent({
                    actor: player, actionText: 'Use a new healing technique.', turnId: 'identity-correction-turn',
                    operationId: 'identity-correction-use', baseContext: { currentLocation: location },
                    resolveActor: name => name === player.name ? player : null,
                    assertTarget: id => { if (id !== player.id) throw new Error(`Unknown target ${id}.`); },
                    config: { ai: { retryAttempts: 1 } }
                });
                assert.equal(completions.length, 2);
                assert.equal(logs.length, 2);
                const reservedTechniqueId = result.metadata.techniqueReceipt.request.techniqueId;
                assert.equal(reservedTechniqueId, 'technique_field_mend');
                assert.equal(TechniqueService.getDefinition(reservedTechniqueId).disciplineId, 'discipline_field_medicine');
            }
        });
    });
});

test('a malformed new discipline cannot be abandoned as none before correcting the same technique', async () => {
    await withTechniqueWorld(async ({ player, location }) => {
        const candidate = {
            id: 'will-be-reserved', name: 'Field Guard', description: 'A practiced defensive technique.',
            semanticKey: 'field-guard', aliases: [],
            revisions: [{ revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [],
                effects: [{ id: 'guard', kind: 'buff', status: { name: 'Guard', description: 'A practiced stance.', duration: 1, attributes: [{ attribute: 'strength', modifier: 1 }] } }] }]
        };
        const validDiscipline = { name: 'Field Warding', description: 'A reusable defensive practice.', accessRequirements: [], publicAccess: true };
        await withMockedPrompt({
            async complete(options, attempt) {
                if (attempt === 1) return candidateIntent(player, player, candidate, { ...validDiscipline, name: '!!!' });
                if (attempt === 2) return '<techniqueIntent><kind>none</kind></techniqueIntent>';
                assert.match(JSON.stringify(options.messages), /cannot be converted into prose-only mechanics/i);
                return candidateIntent(player, player, candidate, { ...validDiscipline });
            },
            async execute({ completions, logs }) {
                const result = await prepareTechniqueIntent({
                    actor: player, actionText: 'Hold a defensive stance.', turnId: 'discipline-none-lock-turn',
                    operationId: 'discipline-none-lock-use', baseContext: { currentLocation: location },
                    resolveActor: name => name === player.name ? player : null,
                    assertTarget: id => { if (id !== player.id) throw new Error(`Unknown target ${id}.`); },
                    config: { ai: { retryAttempts: 2 } }
                });
                assert.equal(completions.length, 3);
                const validation = logs.map(entry => entry.sections.find(section => section.title === 'Validation').content).join('\n');
                assert.match(validation, /no alphanumeric characters/i);
                assert.match(validation, /cannot be converted into prose-only mechanics/i);
                const reservedTechniqueId = result.metadata.techniqueReceipt.techniqueId;
                assert.equal(reservedTechniqueId, 'technique_field_guard');
                assert.equal(TechniqueService.getDefinition(reservedTechniqueId).disciplineId, 'discipline_field_warding');
            }
        });
    });
});

test('incapacitated technique use is ignored with actionable feedback and no mutations', async () => {
    await withTechniqueWorld(async ({ player, target, location }) => {
        const definition = addDefinition('technique-prompt-incapacitated', mechanics({
            costs: [{ resource: 'health', amount: 2 }],
            effects: [{ id: 'restore', kind: 'healing', amount: 4 }]
        }));
        learn(player, definition.id);
        player.addStatusEffect({ description: 'Incapacitated', duration: null });
        const health = player.health;
        const learned = JSON.stringify(player.techniques);

        await withMockedPrompt({
            async complete() { return techniqueIntent('use', definition.id, player, player); },
            async execute({ completions, logs }) {
                let checks = 0;
                const ignored = await prepareTechniqueIntent({
                    actor: player,
                    actionText: 'Use the healing technique.',
                    turnId: 'turn-incapacitated',
                    operationId: 'turn-incapacitated:technique:0',
                    baseContext: { currentLocation: location, setting: {} },
                    prepareCheck: async () => { checks += 1; return { success: true }; },
                    resolveActor: name => [player, target].find(actor => actor.id === name || actor.name === name) || null,
                    assertTarget: id => { if (id !== player.id) throw new Error(`Unknown target ${id}.`); },
                    config: { ai: { retryAttempts: 3 } }
                });
                assert.equal(ignored.metadata.ignored, true);
                assert.match(ignored.content, /ignored|blocked/i);
                assert.match(ignored.content, /dead|disabled|incapacitated/i);
                assert.equal(ignored.metadata.techniqueReceipt, undefined);
                assert.equal(completions.length, 1, 'immutable actor incapacity is not sent through parser correction retries');
                assert.equal(checks, 0, 'eligibility is checked before any roll');
                assert.equal(player.health, health, 'rejected use does not charge or heal');
                assert.equal(JSON.stringify(player.techniques), learned, 'rejected use does not learn or alter mechanics');
                assert.equal(TechniqueService.getReceipt('turn-incapacitated:technique:0'), null);
                assert.equal(logs.length, 1, 'the rejected recognized attempt is still logged');
                assert.match(logs[0].sections.find(section => section.title === 'Validation').content, /accepted/i);
            }
        });
    });
});

test('incapacitated actor cannot partially install a valid unlearned discovery', async () => {
    await withTechniqueWorld(async ({ player, target, location }) => {
        const discipline = {
            id: 'discipline-incapacitated-discovery',
            name: 'Restorative Practice',
            description: 'A qualifying healing discipline.',
            accessRequirements: [{ kind: 'class', name: player.class }],
            publicAccess: false
        };
        const candidate = {
            id: 'technique-incapacitated-discovery',
            disciplineId: discipline.id,
            name: 'Restore Self',
            description: 'A practiced self-healing technique.',
            semanticKey: 'incapacitated-restore-self',
            aliases: [],
            provenance: { kind: 'discovery', reason: 'A tested first attempt.' },
            revisions: [{
                revision: 1,
                acquisitionRequirements: [{ kind: 'class', name: player.class }],
                target: { kind: 'self' },
                check: { kind: 'automatic' },
                costs: [{ resource: 'health', amount: 2 }],
                effects: [{ id: 'restore', kind: 'healing', amount: { formula: 'level * 2' } }]
            }]
        };
        player.setHealth(player.health - 4);
        player.addStatusEffect({ description: 'Incapacitated', duration: null });
        const health = player.health;
        const techniqueIds = player.techniques.map(entry => entry.techniqueId);
        const definitionIds = TechniqueService.getDefinitions().map(entry => entry.id);
        const disciplineIds = TechniqueService.getDisciplines().map(entry => entry.id);

        await withMockedPrompt({
            async complete() { return candidateIntent(player, player, candidate, discipline); },
            async execute({ completions, logs }) {
                let checks = 0;
                const ignored = await prepareTechniqueIntent({
                    actor: player,
                    actionText: 'Discover and use a self-healing technique.',
                    turnId: 'turn-incapacitated-discovery',
                    operationId: 'turn-incapacitated-discovery:technique:0',
                    baseContext: { currentLocation: location, setting: {} },
                    prepareCheck: async () => { checks += 1; return { success: true }; },
                    resolveActor: name => [player, target].find(actor => actor.id === name || actor.name === name) || null,
                    assertTarget: id => { if (id !== player.id) throw new Error(`Unknown target ${id}.`); },
                    config: { ai: { retryAttempts: 3 } }
                });
                assert.equal(ignored.metadata.ignored, true);
                assert.match(ignored.content, /ignored|blocked/i);
                assert.match(ignored.content, /dead|disabled|incapacitated/i);
                assert.equal(ignored.metadata.techniqueReceipt, undefined);
                assert.equal(completions.length, 1, 'recognized discovery is rejected without correction retries');
                assert.equal(checks, 0, 'discovery is rejected before any roll');
                assert.equal(player.health, health, 'rejected discovery does not charge or heal');
                assert.deepEqual(player.techniques.map(entry => entry.techniqueId), techniqueIds, 'rejected discovery does not learn the candidate');
                assert.deepEqual(TechniqueService.getDefinitions().map(entry => entry.id), definitionIds, 'rejected discovery does not install a catalogue definition');
                assert.deepEqual(TechniqueService.getDisciplines().map(entry => entry.id), disciplineIds, 'rejected discovery does not install a candidate discipline');
                assert.equal(TechniqueService.getReceipt('turn-incapacitated-discovery:technique:0'), null);
                assert.equal(logs.length, 1);
                assert.match(logs[0].sections.find(section => section.title === 'Validation').content, /accepted/i);
            }
        });
    });
});

test('ordinary none intent works while incapacitated and a committed receipt replays after incapacity', async () => {
    await withTechniqueWorld(async ({ player, target, location }) => {
        const definition = addDefinition('technique-prompt-disabled-replay', mechanics({
            costs: [{ resource: 'health', amount: 1 }],
            effects: [{ id: 'restore', kind: 'healing', amount: 2 }]
        }));
        learn(player, definition.id);
        let ordinaryCompletions = 0;
        await withMockedPrompt({
            async complete() { ordinaryCompletions += 1; return '<techniqueIntent><kind>none</kind></techniqueIntent>'; },
            async execute() {
                player.addStatusEffect({ description: 'Incapacitated', duration: null });
                const result = await prepareTechniqueIntent({
                    actor: player,
                    actionText: 'I talk to the target.',
                    turnId: 'turn-disabled-none',
                    operationId: 'turn-disabled-none:technique:0',
                    baseContext: { currentLocation: location, setting: {} },
                    prepareCheck: async () => { throw new Error('none intent must not roll'); },
                    resolveActor: name => [player, target].find(actor => actor.id === name || actor.name === name) || null,
                    assertTarget: id => { if (id !== player.id && id !== target.id) throw new Error(`Unknown target ${id}.`); },
                    config: { ai: { retryAttempts: 2 } }
                });
                assert.equal(result, null);
            }
        });
        assert.equal(ordinaryCompletions, 1, 'disabled actors can still produce ordinary no-technique intents');

        player.removeStatusEffect('Incapacitated');
        const priorHealth = player.health;
        let useCompletions = 0;
        let invocation;
        await withMockedPrompt({
            async complete() { useCompletions += 1; return techniqueIntent('use', definition.id, player, player); },
            async execute() {
                invocation = await prepareTechniqueIntent({
                    actor: player,
                    actionText: 'Heal myself with the learned technique.',
                    turnId: 'turn-replay-disabled',
                    operationId: 'turn-replay-disabled:technique:0',
                    baseContext: { currentLocation: location, setting: {} },
                    prepareCheck: async () => ({ success: true }),
                    resolveActor: name => name === player.name ? player : null,
                    assertTarget: id => { if (id !== player.id) throw new Error(`Unknown target ${id}.`); },
                    config: { ai: { retryAttempts: 0 } }
                });
            }
        });
        const committedHealth = player.health;
        assert.equal(committedHealth, Math.min(player.maxHealth, priorHealth - 1 + 2));
        player.addStatusEffect({ description: 'Incapacitated', duration: null });
        let replayCompletions = 0;
        await withMockedPrompt({
            async complete() { replayCompletions += 1; throw new Error('Committed receipt replay must skip the model.'); },
            async execute() {
                const replay = await prepareTechniqueIntent({
                    actor: player,
                    actionText: 'Heal myself with the learned technique.',
                    turnId: 'turn-replay-disabled',
                    operationId: 'turn-replay-disabled:technique:0',
                    explicitUse: {
                        actorId: player.id,
                        techniqueId: definition.id,
                        sourceId: 'learned:technique-prompt-disabled-replay',
                        targetIds: [player.id]
                    },
                    baseContext: { currentLocation: location, setting: {} },
                    prepareCheck: async () => { throw new Error('Committed receipt replay must skip checks.'); },
                    resolveActor: name => name === player.name ? player : null,
                    assertTarget: id => { if (id !== player.id) throw new Error(`Unknown target ${id}.`); },
                    config: { ai: { retryAttempts: 3 } }
                });
                assert.equal(replay.id, invocation.id);
                assert.equal(player.health, committedHealth, 'replay does not charge or heal a second time');
            }
        });
        assert.equal(useCompletions, 1);
        assert.equal(replayCompletions, 0, 'committed explicit retry bypasses model and current eligibility');
    });
});

test('explicit UI technique pins precommit without a model call and reject stale revisions without mutation', async () => {
    await withTechniqueWorld(async ({ player, target, location }) => {
        const definition = addDefinition('technique-prompt-ui-pins', mechanics({
            costs: [{ resource: 'health', amount: 1 }],
            effects: [{ id: 'restore', kind: 'healing', amount: 2 }]
        }));
        learn(player, definition.id);
        player.setHealth(player.health - 5);
        const initialHealth = player.health;
        const resolveActor = name => [player, target].find(actor => actor.id === name || actor.name === name) || null;
        await withMockedPrompt({
            async complete() { throw new Error('Pinned UI use must not ask the model to identify a technique.'); },
            async execute({ completions, logs }) {
                const pins = { actorId: player.id, techniqueId: definition.id, sourceId: `learned:${definition.id}`, definitionRevision: 1, personalRevision: 1, targetIds: [player.id] };
                await assert.rejects(prepareTechniqueIntent({
                    actor: player, actionText: 'Heal myself with the selected technique.', turnId: 'ui-pinned-turn', operationId: 'ui-pinned-stale',
                    explicitUse: { ...pins, definitionRevision: 2 }, baseContext: { currentLocation: location }, prepareCheck: async () => ({ success: true }),
                    resolveActor, assertTarget: id => { if (id !== player.id) throw new Error(`Unknown target ${id}.`); }, config: { ai: { retryAttempts: 1 } }
                }), /definitionRevision changed/);
                assert.equal(player.health, initialHealth, 'stale pins fail before any cost or effect');
                assert.equal(TechniqueService.getReceipt('ui-pinned-stale'), null);

                const invocation = await prepareTechniqueIntent({
                    actor: player, actionText: 'Heal myself with the selected technique.', turnId: 'ui-pinned-turn', operationId: 'ui-pinned-valid',
                    explicitUse: pins, baseContext: { currentLocation: location }, prepareCheck: async () => ({ success: true }),
                    resolveActor, assertTarget: id => { if (id !== player.id) throw new Error(`Unknown target ${id}.`); }, config: { ai: { retryAttempts: 1 } }
                });
                assert.equal(invocation.metadata.techniqueReceipt.source.sourceId, pins.sourceId);
                assert.equal(invocation.metadata.techniqueReceipt.source.definitionRevision, pins.definitionRevision);
                assert.equal(invocation.metadata.techniqueReceipt.source.personalRevision, pins.personalRevision);
                assert.equal(invocation.metadata.techniqueReceipt.request.targetIds[0], player.id);
                assert.equal(invocation.metadata.techniqueReceipt.committed, true);
                assert.equal(player.health, Math.min(player.maxHealth, initialHealth - 1 + 2));
                assert.equal(completions.length, 0);
                assert.equal(logs.length, 0);
            }
        });
    });
});

test('a cancelled technique check propagates after one accepted parse without rerolling or committing', async () => {
    await withTechniqueWorld(async ({ player, target, location }) => {
        const definition = addDefinition('technique-prompt-cancel', mechanics({
            target: 'single',
            check: { kind: 'skill', skill: 'Strength', difficulty: 'Easy' },
            costs: [{ resource: 'health', amount: 2 }],
            effects: [{ id: 'damage', kind: 'damage', amount: 4, damageMode: 'technique' }]
        }));
        learn(player, definition.id);
        const playerHealth = player.health;
        const targetHealth = target.health;
        await withMockedPrompt({
            async complete() { return techniqueIntent('use', definition.id, player, target); },
            async execute({ completions }) {
                let checks = 0;
                await assert.rejects(prepareTechniqueIntent({
                    actor: player,
                    actionText: 'Strike with the taught technique.',
                    turnId: 'turn-cancel',
                    operationId: 'turn-cancel:technique:0',
                    baseContext: { currentLocation: location, setting: {} },
                    assessDamageEffectiveness: async ({ assessments }) => assessments.map(() => 3),
                    prepareCheck: async () => {
                        checks += 1;
                        const error = new Error('Forced technique roll cancelled.');
                        error.code = 'PROMPT_CANCELLED';
                        throw error;
                    },
                    resolveActor: name => [player, target].find(actor => actor.id === name || actor.name === name) || null,
                    assertTarget: id => { if (id !== target.id) throw new Error(`Unknown target ${id}.`); },
                    config: { ai: { retryAttempts: 2 } }
                }), error => error.code === 'PROMPT_CANCELLED' && /Forced technique roll cancelled/.test(error.message));
                assert.equal(completions.length, 1, 'post-parse cancellation is outside parser retries');
                assert.equal(checks, 1, 'the roll callback is invoked once');
                assert.equal(player.health, playerHealth);
                assert.equal(target.health, targetHealth);
                assert.equal(TechniqueService.getReceipt('turn-cancel:technique:0'), null);
            }
        });
    });
});

test('standard first-use prompt accepts semantic damage as nested XML', async () => {
    await withTechniqueWorld(async ({ player, location }) => {
        const candidate = { name: 'Arcane Strike', description: 'A practiced strike.', semanticKey: 'arcane-strike', disciplineId: 'discipline-integration', revisions: [{ target: { kind: 'self' }, check: { kind: 'skill', skill: 'Spellcasting', difficulty: 'Medium' }, recipe: { kind: 'damage', skillName: 'Spellcasting', attributeName: 'intelligence' } }] };
        await withMockedPrompt({
            async complete() { return candidateIntent(player, player, candidate); },
            async execute({ completions }) {
                const result = await prepareTechniqueIntent({ actor: player, actionText: 'Strike with arcane force.', turnId: 'strike-turn', operationId: 'strike-use', baseContext: { currentLocation: location }, assessDamageEffectiveness: async ({ assessments }) => assessments.map(() => 3), prepareCheck: async () => ({ success: true }), resolveActor: () => player, assertTarget: () => {}, config: { ai: { retryAttempts: 0 } } });
                assert.equal(completions.length, 1);
                assert.equal(result.metadata.techniqueReceipt.committed, true);
                candidate.id = result.metadata.techniqueReceipt.techniqueId;
                assert.match(candidate.id, /^technique_arcane_strike(?:_\d+)?$/);
                assert.equal(TechniqueService.getDefinition(candidate.id).revisions[0].balance.recipeId, 'standard-damage');
                assert.equal(TechniqueService.getDefinition(candidate.id).revisions[0].effects[0].kind, 'damage');
            }
        });
    }, { includeMana: true });
});

test('nested utility authoring XML preserves inline template data and runtime selector validation', () => {
    const { parseTechniqueCandidateXml } = require('../TechniqueXml.js');
    const Utils = require('../Utils.js');
    const candidate = { name: 'Call Familiar', description: 'Call a temporary companion.', semanticKey: 'call-familiar', revisions: [mechanics({ effects: [{ id: 'summon', kind: 'summon', summonMode: 'template', lifetimeMinutes: 3, template: { name: 'Familiar', description: 'A companion.', level: 1, attributes: { Strength: 0 }, skills: { Spellcasting: 0 } } }] })] };
    const xml = asXml('candidate', candidate, candidateSchema);
    const parsed = parseTechniqueCandidateXml(Utils.parseXmlDocumentStrict(xml, 'text/xml').documentElement);
    assert.deepEqual(parsed.revisions[0].effects[0].template.attributes, { Strength: 0 });
    assert.deepEqual(parsed.revisions[0].effects[0].template.skills, { Spellcasting: 0 });
    assert.throws(() => parseTechniqueCandidateXml(Utils.parseXmlDocumentStrict(xml.replace('<level>1</level>', '<level>invalid</level>'), 'text/xml').documentElement), /template\.level.*finite decimal/);
    const actor = { id: 'actor-1', name: 'Actor' };
    const use = techniqueIntent('use', 'known-ward', actor, actor, '<weaponItemId>blade-1</weaponItemId><utilitySelections><selection><effectId>travel</effectId><destinationId>room-2</destinationId></selection></utilitySelections>');
    const operation = parseTechniqueIntent(use);
    assert.equal(operation.weaponItemId, 'blade-1');
    assert.deepEqual(operation.utilitySelections, { travel: { destinationId: 'room-2' } });
    assert.throws(() => parseTechniqueIntent(use.replace('</utilitySelections>', '<selection><effectId>travel</effectId><actorId>npc-1</actorId></selection></utilitySelections>')), /duplicate selection/);
    assert.throws(() => parseTechniqueIntent(use.replace('<destinationId>room-2</destinationId>', '<destinationId>room-2</destinationId><actorId>npc-1</actorId>')), /exactly one/);
});

test('disabled NPC technique is reported as ignored without roll, cost, learning, or a receipt', async () => {
    await withTechniqueWorld(async ({ npc, location }) => {
        const definition = addDefinition('npc-disabled-technique', mechanics({ costs: [{ resource: 'health', amount: 2 }], effects: [{ id: 'restore', kind: 'healing', amount: 4 }] }));
        learn(npc, definition.id);
        npc.addStatusEffect({ description: 'Incapacitated', duration: null });
        const before = npc.health, beforeTechniques = JSON.stringify(npc.techniques);
        await withMockedPrompt({
            async complete() { return techniqueIntent('use', definition.id, npc, npc); },
            async execute() {
                const ignored = await prepareTechniqueIntent({ actor: npc, actionText: 'Try the technique.', turnId: 'disabled-npc-turn', operationId: 'disabled-npc-attempt', baseContext: { currentLocation: location, setting: {} },
                    prepareCheck: async () => { throw new Error('disabled NPC must not roll'); }, resolveActor: () => npc,
                    assertTarget: () => { throw new Error('disabled NPC must not select a target'); }, config: { ai: { retryAttempts: 1 } } });
                assert.equal(ignored.metadata.ignored, true);
                assert.equal(ignored.metadata.actorId, npc.id);
                assert.match(ignored.content, /ignored|blocked/i);
                assert.match(ignored.content, /dead|disabled|incapacitated/i);
                assert.equal(ignored.metadata.techniqueReceipt, undefined);
                assert.equal(npc.health, before);
                assert.equal(JSON.stringify(npc.techniques), beforeTechniques);
                assert.equal(TechniqueService.getReceipt('disabled-npc-attempt'), null);
            }
        });
    });
});

test('disabled explicit UI use ignores a stale source before resolving it', async () => {
    await withTechniqueWorld(async ({ player, location }) => {
        player.addStatusEffect({ description: 'Incapacitated', duration: null });
        const health = player.health;
        const ignored = await prepareTechniqueIntent({ actor: player, actionText: 'Try a stale ability.', turnId: 'stale-disabled-turn', operationId: 'stale-disabled-attempt',
            explicitUse: { actorId: player.id, techniqueId: 'missing-technique', sourceId: 'missing-source', targetIds: [player.id] },
            baseContext: { currentLocation: location, setting: {} },
            prepareCheck: async () => { throw new Error('disabled actor must not roll'); }, resolveActor: () => player,
            assertTarget: () => { throw new Error('disabled actor must not validate target'); }, config: { ai: { retryAttempts: 0 } } });
        assert.equal(ignored.metadata.ignored, true);
        assert.match(ignored.content, /ignored|blocked/i);
        assert.equal(player.health, health);
        assert.equal(TechniqueService.getReceipt('stale-disabled-attempt'), null);
    });
});

test('model-facing technique results round individual effects and exact aggregate once while receipts stay precise', async () => {
    await withTechniqueWorld(async ({ player, target }) => {
        const definition = addDefinition('technique-fractional-report', mechanics({ target: 'single', check: { kind: 'skill', skill: 'Strength', difficulty: 'Easy' }, effects: [
            { id: 'damage-a', kind: 'damage', damageMode: 'technique', amount: 0.4 },
            { id: 'damage-b', kind: 'damage', damageMode: 'technique', amount: 0.4 },
            { id: 'heal-a', kind: 'healing', amount: 0.4 },
            { id: 'heal-b', kind: 'healing', amount: 0.4 }
        ] }));
        learn(player, definition.id);
        target.setHealth(target.maxHealth - 5);
        const before = target.health;
        const receipt = await TechniqueService.execute({ operationId: 'fractional-report-use', turnId: 'fractional-report-turn', actor: player, techniqueId: definition.id, targetIds: [target.id],
            assessDamageEffectiveness: async () => [3, 3], prepareCheck: async () => ({ success: true }) });
        const saved = JSON.parse(JSON.stringify(receipt));
        const invocation = receiptInvocation(receipt, 'Use the technique.');
        const report = JSON.parse(invocation.content.slice(invocation.content.indexOf('\n') + 1));
        assert.deepEqual(report.effects.map(effect => effect.amount), [0, 0, 0, 0]);
        assert.equal(report.reportedTotals.damage, 1);
        assert.equal(report.reportedTotals.healing, 1);
        assert.equal(report.reportedTotals.healthDelta, 0);
        const projectedAgain = require('../TechniqueReport.js').projectTechniqueReceiptReport(report);
        assert.deepEqual(projectedAgain, report, 'projecting an already-rounded report must retain the exact-sum totals');
        assert.deepEqual(invocation.metadata.techniqueReceipt, saved);
        assert.deepEqual(TechniqueService.getReceipt(receipt.operationId), saved);
        assert.equal(receipt.effects[0].amount, 0.4);
        assert.ok(Math.abs(target.health - before) < 1e-9, 'applied health is not changed by report rounding');
    });
});
