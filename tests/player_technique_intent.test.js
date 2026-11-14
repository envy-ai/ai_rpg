'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { createPlayerTechniqueSession, getPlayerTechniqueAuthoringContext, getPlayerTechniqueAuthoringInstructions } = require('../PlayerTechniqueIntent.js');
const TechniqueService = require('../TechniqueService.js');
const { compactTechniquePromptContext, compactTechniqueActorFacts, compactTechniqueCatalogue } = require('../TechniquePromptContext.js');
const { TinyBrainPromptExtension, TinyBrainPromptRunner } = require('../TinyBrainPromptRunner.js');
const { parsePlayerActionResolutionPlan } = require('../PlayerActionResolutionPlan.js');
const { createResolutionPlanExecutionState, executePlayerActionResolutionPlan } = require('../PlayerActionResolutionPlan.js');
const Utils = require('../Utils.js');
const { addXmlTextFilter } = require('../nunjucks_filters.js');
const { withTechniqueWorld, mechanics, addDefinition, learn } = require('./helpers/techniqueIntegrationFixtures.js');
const { DOMImplementation, XMLSerializer } = require('@xmldom/xmldom');
const { writeTechniqueXmlValue, candidateSchema, disciplineGroupSchema } = require('../TechniqueXml.js');
function authoringXml(tag, value, schema) {
    const document = new DOMImplementation().createDocument(null, tag, null);
    writeTechniqueXmlValue(document.documentElement, value, schema);
    return new XMLSerializer().serializeToString(document.documentElement);
}

function groupedAuthoringXml(candidate, discipline) {
    const candidateBody = { ...candidate };
    delete candidateBody.id; delete candidateBody.provenance; delete candidateBody.disciplineId;
    const parent = { ...discipline };
    delete parent.id; delete parent.provenance;
    return authoringXml('discipline', { ...parent, techniques: [{ candidate: candidateBody }] }, disciplineGroupSchema);
}

function candidateFor(actor) {
    return {
        name: 'Field Mend',
        description: 'Restore a practiced ally with a steady gesture.',
        semanticKey: 'field-mend',
        provenance: { kind: 'discovery', reason: 'A successful first field treatment.' },
        revisions: [{
            revision: 1,
            acquisitionRequirements: [{ kind: 'class', name: actor.class }],
            useRequirements: [],
            target: { kind: 'self', allowDead: false },
            check: { kind: 'automatic' },
            recipe: {
                recipeId: 'standard-healing', skillName: 'Spellcasting', attributeName: 'intelligence',
                resourceProfileId: 'mana', effectId: 'restore'
            }
        }]
    };
}

const newDiscipline = {
    name: 'Field Medicine',
    description: 'Practical restorative work learned through experience.',
    accessRequirements: [],
    publicAccess: true
};
const xmlEscape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function makeBloatedTechniquePromptFixture() {
    const skills = [{ name: 'Spellcasting', description: 'A practiced magical skill.' }, ...Array.from({ length: 99 }, (_, index) => ({ name: `Skill ${index + 1}`, description: `Long skill definition ${index + 1}: ${'authoritative training definition. '.repeat(4)}` }))];
    const attributes = [{ name: 'Intelligence', description: 'Intelligence modifier.' }, ...Array.from({ length: 11 }, (_, index) => ({ name: `Attribute ${index + 1}`, description: `Attribute rule ${index + 1}.` }))];
    const needBars = Array.from({ length: 111 }, (_, index) => ({
        id: index === 0 ? 'mana' : `need_${index + 1}`, name: index === 0 ? 'Mana' : `Need ${index + 1}`, value: 500, min: 0, max: 1000,
        paymentDirection: 'decrease', description: `Managed need definition ${index + 1}: ${'This saved definition is repeated for each nearby actor. '.repeat(3)}`
    }));
    const recipe = { recipeId: 'standard-healing', targetKinds: ['self', 'single'], amountFormula: 'round(10 + 3 * level + skill_spellcasting)', managedNeedDefinitions: needBars };
    const improvementSteps = [{ stepId: 'efficiency', kind: 'efficiency', multiplier: 0.9 }, { stepId: 'power', kind: 'power', amount: 2 }];
    const actors = Array.from({ length: 6 }, (_, index) => ({
        actorId: `actor_${index + 1}`,
        actorName: `Actor ${index + 1}`,
        formulaVariables: [
            { key: 'level', label: 'Level', kind: 'level', value: 3 + index },
            ...(index === 5 ? [] : [{ key: 'skill_spellcasting', label: 'Spellcasting', kind: 'skill', name: 'Spellcasting', value: 2 + index }]),
            ...(index === 4 ? [] : [{ key: 'attribute_intelligence_modifier', label: 'Intelligence modifier', kind: 'attribute', name: 'intelligence', value: 4 + index }])
        ],
        balanceAuthoring: {
            policyVersion: 1, policyDigest: 'shared-managed-policy', recipes: [recipe], skills, attributes,
            resourceProfiles: [{ resourceProfileId: 'mana', needId: 'mana', direction: 'decrease', capacity: 1000, baseCost: 100 }], improvementSteps
        },
        disciplineAccess: [{ id: 'discipline_magic', name: 'Magic', description: 'A learned restorative tradition.' }],
        techniques: [{
            techniqueId: 'technique_heal', imageId: 'art-id-that-is-not-prompt-context', imagePrompt: 'Large redundant image prompt. '.repeat(20),
            name: 'Practiced Restoration', description: 'A qualified restorative technique.', disciplineId: 'discipline_magic', disciplineName: 'Magic', learned: true,
            balanceImprovements: { policyDigest: 'personal-policy', steps: improvementSteps, appliedImprovementIds: [] },
            sources: [{
                sourceId: 'learned:technique_heal', sourceKind: 'learned', definitionRevision: 2, personalRevision: 1,
                mechanics: {
                    revision: 1, acquisitionRequirements: [{ kind: 'skill', name: 'Spellcasting', minimum: 2 }],
                    useRequirements: [{ kind: 'skill', name: 'Spellcasting', minimum: 2 }], target: { kind: 'self', allowDead: false },
                    check: { kind: 'automatic' },
                    costs: [{ resource: 'need', needId: 'mana', direction: 'decrease', amount: { formula: 'ceil(100 / (1 + 0.05 * skill_spellcasting + 0.02 * level))' } }],
                    failureCosts: [], effects: [{ id: 'restore', kind: 'healing', amount: { formula: 'round(10 + 3 * level + skill_spellcasting + 0.5 * attribute_intelligence_modifier)' } }],
                    balance: { schemaVersion: 1, policy: { digest: 'saved-snapshot', snapshot: { healing: { referenceMultiplier: 2 }, resourceProfile: { needId: 'mana', baseCost: 100 }, improvementSteps } } }
                },
                costs: [{ resource: 'need', needId: 'mana', direction: 'decrease', amount: 83 }], failureCosts: [], available: true, blockers: []
            }]
        }]
    }));
    const actorFacts = Array.from({ length: 6 }, (_, index) => ({
        id: `actor_${index + 1}`, name: `Actor ${index + 1}`, class: 'Adept', race: 'Human', level: 3 + index,
        description: 'An actor in the current scene.', health: 40, maxHealth: 50, isDead: false, isDisabled: false,
        skills: { ...Object.fromEntries(skills.filter((_, skillIndex) => !(index === 5 && skillIndex === 0)).map((skill, skillIndex) => [skill.name, skillIndex === 0 ? 2 + index : 1])) },
        attributes: { ...Object.fromEntries(attributes.filter((_, attributeIndex) => !(index === 4 && attributeIndex === 0)).map((attribute, attributeIndex) => [attribute.name, attributeIndex + 1])), ...(index === 4 ? {} : { intelligence: 14 + index }) },
        abilities: [], needBars
    }));
    const catalog = [{
        id: 'technique_heal', disciplineId: 'discipline_magic', name: 'Practiced Restoration', description: 'A qualified restorative technique.',
        semanticKey: 'practiced-restoration', aliases: [], provenance: { kind: 'discovery', reason: 'Learned by practice.' },
        revisions: [
            { revision: 1, acquisitionRequirements: [{ kind: 'skill', name: 'Spellcasting', minimum: 1 }], useRequirements: [], target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'restore', kind: 'healing', amount: 10 }], balance: { policy: { snapshot: { obsolete: true } } } },
            { revision: 2, acquisitionRequirements: [{ kind: 'skill', name: 'Spellcasting', minimum: 2 }], useRequirements: [{ kind: 'skill', name: 'Spellcasting', minimum: 2 }], target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' }, costs: [{ resource: 'need', needId: 'mana', direction: 'decrease', amount: { formula: 'ceil(100 / (1 + 0.05 * skill_spellcasting + 0.02 * level))' } }], effects: [{ id: 'restore', kind: 'healing', amount: { formula: 'round(10 + 3 * level + skill_spellcasting)' } }], balance: { policy: { snapshot: { obsolete: false } } } }
        ]
    }];
    return { techniques: actors, actorFacts, catalog };
}

function renderPlayerAction(mode, context, repetition = false) {
    const environment = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }), { autoescape: false });
    environment.addFilter('dump', value => JSON.stringify(value));
    addXmlTextFilter(environment);
    environment.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return environment.render(`_includes/player-action${mode === 'tinybrain' ? '.tinybrain' : ''}.njk`, {
        ...(mode === 'tinybrain' ? { __tinyBrainState: TinyBrainPromptRunner.createRenderState() } : {}),
        actionText: 'Restore my wounds with the field technique.', characterName: 'Actor 1',
        config: { prose_length: 'one paragraph', prose_prompt_suffix: '', repetition_buster: repetition, soft_quest_limit: 3, use_legacy_prompt_checks: false },
        currentPlayer: { currentQuests: [] }, currentPlayerNeeds: [], setting: { writingStyleNotes: 'Keep it concrete.' },
        isAttack: false, playerActionCombinedMechanics: true,
        playerTechniqueAuthoringInstructions: getPlayerTechniqueAuthoringInstructions(),
        techniqueSelectionInstructions: require('../TechniqueSelectionContext.js').getTechniqueSelectionInstructions(),
        modPlayerActionPromptSteps: () => [],
        playerTechniqueAuthoringContext: context
    });
}

test('native technique normalization reserves novel IDs across corrections and commits managed healing once', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const session = createPlayerTechniqueSession({ resolveActor: name => name === player.id || name === player.name ? player : null });
        const raw = {
            actor: player.name,
            targetIds: [player.id],
            intent: 'Restore my wounds with the field technique.',
            discoveryIntent: 'The player demonstrated a new healing practice.',
            disciplineXml: groupedAuthoringXml(candidateFor(player), newDiscipline)
        };
        const key = session.nativeKey(raw, 'native-call-first');
        const invalid = { ...raw, disciplineXml: raw.disciplineXml.replace('<name>Field Mend</name>', '<name>TECHNIQUE_NAME</name>') };
        assert.throws(() => session.normalizeNative(invalid, key), /candidate.name.*unresolved example placeholder/);
        session.assertComplete();
        const correctedKey = session.nativeKey(raw, 'native-call-corrected');
        const badMechanics = { ...raw, disciplineXml: raw.disciplineXml.replace('<kind>self</kind>', '<kind>invalid-target</kind>') };
        assert.notEqual(badMechanics.disciplineXml, raw.disciplineXml);
        assert.throws(() => session.normalizeNative(badMechanics, correctedKey));
        assert.throws(() => session.assertComplete(), /target|kind|invalid/i);
        const operation = session.normalizeNative(raw, correctedKey);
        assert.equal(operation.techniqueId, 'technique_field_mend', 'the readable candidate name supplies the identity');
        assert.equal(operation.candidate.id, operation.techniqueId);
        assert.ok(operation.candidateDiscipline.id);
        assert.equal(operation.candidate.disciplineId, operation.candidateDiscipline.id);
        assert.equal(Object.hasOwn(raw, 'candidate'), false, 'native authoring supplies mechanics inside disciplineXml');
        assert.equal(Object.hasOwn(raw, 'candidateDiscipline'), false, 'native authoring supplies one outer XML group');
        assert.equal(session.nativeKey(raw, 'native-call-retry'), correctedKey, 'correction call IDs reuse the pending actor attempt slot');

        const corrected = session.normalizeNative(raw, correctedKey);
        assert.equal(corrected.techniqueId, operation.techniqueId);
        assert.equal(corrected.candidateDiscipline.id, operation.candidateDiscipline.id);

        player.setHealth(player.health - 5);
        const startingHealth = player.health;
        const startingMana = player.getNeedBarValue('mana');
        const request = {
            ...corrected,
            actor: player,
            operationId: 'merged-player-action:technique:call-0',
            turnId: 'merged-player-action',
            acquisition: { provenance: { kind: 'discovery', reason: raw.discoveryIntent } }
        };
        const receipt = await TechniqueService.execute(request);
        session.commit(correctedKey);
        session.assertComplete();
        assert.equal(receipt.committed, true);
        assert.equal(receipt.techniqueId, corrected.techniqueId);
        assert.equal(receipt.effects[0].kind, 'healing');
        assert.equal(receipt.effects[0].amount, 24);
        assert.equal(player.health, Math.min(player.maxHealth, startingHealth + 24));
        assert.equal(player.getNeedBarValue('mana'), startingMana - 83);
        assert.equal(player.techniques.filter(entry => entry.techniqueId === corrected.techniqueId).length, 1);
        assert.equal(TechniqueService.getReceiptsForTurn('merged-player-action').length, 1);

        const committedHealth = player.health;
        const committedMana = player.getNeedBarValue('mana');
        const replay = await TechniqueService.execute(request);
        assert.equal(replay.operationId, receipt.operationId);
        assert.equal(player.health, committedHealth, 'a replay does not heal again');
        assert.equal(player.getNeedBarValue('mana'), committedMana, 'a replay does not charge again');
        assert.equal(TechniqueService.getReceiptsForTurn('merged-player-action').length, 1);
    }, { includeMana: true });
});

test('malformed pre-name attempts do not lock a fabricated candidate identity', async () => {
    require('../IdGenerator.js').reset();
    await withTechniqueWorld(async ({ player }) => {
        const resolveActor = name => name === player.id || name === player.name ? player : null;
        const raw = {
            actor: player.name,
            targetIds: [player.id],
            intent: 'Try the new field healing technique.',
            discoveryIntent: 'A demonstrated restorative practice.',
            disciplineXml: '<discipline><name>Field Medicine</name><description>{ malformed group'
        };
        const native = createPlayerTechniqueSession({ resolveActor });
        const nativeKey = native.nativeKey(raw, 'native-call-invalid');
        assert.throws(() => native.normalizeNative(raw, nativeKey), /XML|parse|mismatch|root/i);
        assert.notEqual(native.nativeKey(raw, 'native-call-retry'), nativeKey);
        native.assertComplete();

        const plan = createPlayerTechniqueSession({ resolveActor });
        const malformedXml = `<resolutionPlan><technique><actor>${player.name}</actor><intent>Try the new field healing technique.</intent><targets><targetId>${player.id}</targetId></targets><discipline><name>Field Medicine</name><description>{ malformed parent</description><techniques><technique><candidate>{ malformed mechanics</candidate></technique></techniques></discipline></technique></resolutionPlan>`;
        plan.beginPlan();
        assert.throws(() => parsePlayerActionResolutionPlan(malformedXml, { parseTechnique: (node, index) => plan.parseNode(node, `plan:initial:${index}`) }), /JSON|position|property/i);
        plan.beginPlan();
        const empty = parsePlayerActionResolutionPlan('<resolutionPlan/>', { parseTechnique: (node, index) => plan.parseNode(node, `plan:initial:${index}`) });
        assert.deepEqual(empty.value, []);
        plan.finishPlan('plan:initial:');
        plan.assertComplete();
        assert.equal(player.health, player.maxHealth, 'rejected attempts have not changed health');
        assert.equal(player.techniques.length, 0, 'rejected attempts have not learned a candidate');

        const correctedXml = `<resolutionPlan><technique><actor>${player.name}</actor><intent>Try the new field healing technique.</intent><discoveryIntent>A demonstrated restorative practice.</discoveryIntent><targets><targetId>${player.id}</targetId></targets>${groupedAuthoringXml(candidateFor(player), newDiscipline)}</technique></resolutionPlan>`;
        plan.beginPlan();
        const corrected = parsePlayerActionResolutionPlan(correctedXml, { parseTechnique: (node, index) => plan.parseNode(node, `plan:initial:${index}`) });
        plan.finishPlan('plan:initial:');
        const correctedId = corrected.value[0].argumentsObject.techniqueId;
        assert.equal(correctedId, 'technique_field_mend', 'malformed pre-name attempts do not reserve a placeholder ID');
        const changedIdentity = candidateFor(player);
        changedIdentity.semanticKey = 'different-field-technique';
        const changedXml = correctedXml.replace(groupedAuthoringXml(candidateFor(player), newDiscipline), groupedAuthoringXml(changedIdentity, newDiscipline));
        plan.beginPlan();
        assert.throws(() => parsePlayerActionResolutionPlan(changedXml, { parseTechnique: (node, index) => plan.parseNode(node, `plan:initial:${index}`) }), /cannot change semantic identity/i);
        plan.beginPlan();
        const sameAttempt = parsePlayerActionResolutionPlan(correctedXml, { parseTechnique: (node, index) => plan.parseNode(node, `plan:initial:${index}`) });
        assert.equal(sameAttempt.value[0].argumentsObject.techniqueId, correctedId, 'the corrected same attempt keeps its server-reserved identity');
        plan.finishPlan('plan:initial:');
        const receipt = await TechniqueService.execute({
            ...sameAttempt.value[0].argumentsObject,
            actor: player,
            operationId: 'tinybrain-corrected-attempt',
            turnId: 'tinybrain-corrected-attempt'
        });
        plan.commit('plan:initial:0');
        plan.assertComplete();
        assert.equal(receipt.committed, true);
        assert.equal(player.techniques.filter(entry => entry.techniqueId === correctedId).length, 1);
    }, { includeMana: true });
});

test('TinyBrain initial resolution plan normalizes a novel healing attempt and executes its receipt before prose', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const session = createPlayerTechniqueSession({ resolveActor: name => name === player.id || name === player.name ? player : null });
        const candidate = candidateFor(player);
        const operationXml = `<technique><actor>${player.name}</actor><intent>Restore my wounds with the field technique.</intent><discoveryIntent>A demonstrated restorative practice.</discoveryIntent><targets><targetId>${player.id}</targetId></targets>${groupedAuthoringXml(candidate, newDiscipline)}</technique>`;
        const prefix = 'plan:initial:4:';
        session.beginPlan();
        const plan = parsePlayerActionResolutionPlan(`<resolutionPlan>${operationXml}</resolutionPlan>`, {
            parseTechnique: (node, index) => {
                const attemptKey = `${prefix}${index}`;
                return { operation: session.parseNode(node, attemptKey), attemptKey };
            }
        });
        session.finishPlan(prefix);
        assert.equal(plan.value.length, 1);
        assert.equal(plan.value[0].functionName, 'useTechnique');
        assert.equal(plan.value[0].techniqueAttemptKey, `${prefix}0`);
        assert.ok(plan.value[0].argumentsObject.techniqueId);

        player.setHealth(player.health - 5);
        const startingHealth = player.health;
        const startingMana = player.getNeedBarValue('mana');
        const state = createResolutionPlanExecutionState('tinybrain-player-action');
        const result = await executePlayerActionResolutionPlan(plan.value, {
            state,
            checkpointId: 4,
            validateAction: action => TechniqueService.preview({ ...action.argumentsObject, actor: player }),
            executeAction: async toolCall => {
                const receipt = await TechniqueService.execute({
                    ...toolCall.argumentsObject,
                    actor: player,
                    operationId: toolCall.id,
                    turnId: 'tinybrain-player-action',
                    acquisition: { provenance: { kind: 'discovery', reason: toolCall.argumentsObject.acquisition.provenance.reason } }
                });
                session.commit(toolCall.techniqueAttemptKey);
                return { content: `Committed technique receipt ${receipt.operationId}.`, metadata: { techniqueReceipt: receipt } };
            }
        });
        session.assertComplete();
        assert.equal(result.invocations.length, 1);
        assert.equal(result.invocations[0].metadata.techniqueReceipt.committed, true);
        assert.equal(player.health, Math.min(player.maxHealth, startingHealth + 24));
        assert.equal(player.getNeedBarValue('mana'), startingMana - 83);
        assert.equal(TechniqueService.getReceiptsForTurn('tinybrain-player-action').length, 1);
    }, { includeMana: true });
});

test('the shared TinyBrain plan adapter converts technique attack shims and preserves pending suffix ordinals', async () => {
    await withTechniqueWorld(async ({ player, target }) => {
        const firstDefinition = addDefinition('technique-plan-adapter-first', { revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'first-aid', kind: 'healing', amount: 1 }] });
        const shimDefinition = addDefinition('technique-plan-adapter-shim', { revision: 1, target: { kind: 'single' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'shim-aid', kind: 'healing', amount: 1 }] });
        learn(player, firstDefinition.id);
        learn(player, shimDefinition.id);
        const session = createPlayerTechniqueSession({
            resolveActor: name => name === player.id || name === player.name ? player : name === target.id || name === target.name ? target : null,
            resolveAttackOperation: (name, args) => name === 'resolveAttack' && args.ability === shimDefinition.name
                ? { actor: args.attacker, techniqueId: shimDefinition.id, sourceId: `learned:${shimDefinition.id}`, targetIds: [player.id], intent: args.intent, newAttempt: true }
                : null
        });
        const nativeTechnique = `<technique><actor>${player.name}</actor><intent>Use the practiced first aid.</intent><techniqueId>${firstDefinition.id}</techniqueId><sourceId>learned:${firstDefinition.id}</sourceId><newAttempt>true</newAttempt><targets><targetId>${player.id}</targetId></targets></technique>`;
        const ordinaryCheck = `<check><type>unopposed</type><actor>${player.name}</actor><intent>Recall the training.</intent><skill>Athletics</skill><attribute>Strength</attribute><difficulty>Easy</difficulty><circumstanceModifiers/></check>`;
        const techniqueAttackShim = `<attack><type>single</type><intent>Use the practiced aid.</intent><attacker>${player.name}</attacker><attackerInfo><attackSkill>Melee Combat</attackSkill><damageAttribute>Strength</damageAttribute></attackerInfo><ability>${shimDefinition.name}</ability><weapon>N/A</weapon><circumstanceModifiers/><newTechniqueAttempt>true</newTechniqueAttempt><targets><target><name>${target.name}</name><defenseInfo><evadeSkill>Dodge</evadeSkill><deflectSkill>N/A</deflectSkill></defenseInfo><circumstanceModifiers/><damageEffectiveness>3</damageEffectiveness></target></targets></attack>`;
        const firstPlan = session.parsePlan(`<resolutionPlan>${nativeTechnique}${ordinaryCheck}${techniqueAttackShim}</resolutionPlan>`, { checkpointId: 5, completedCount: 0 });
        assert.deepEqual(firstPlan.value.map(action => action.functionName), ['useTechnique', 'resolveSkillCheck', 'useTechnique']);
        assert.deepEqual(firstPlan.value.filter(action => action.functionName === 'useTechnique').map(action => action.techniqueAttemptKey), ['plan:5:0', 'plan:5:1']);
        assert.deepEqual(firstPlan.value[2].argumentsObject.targetIds, [player.id]);
        session.commit('plan:5:0');
        session.reject('plan:5:1', new Error('Insufficient health for the selected technique.'));

        assert.throws(() => session.parsePlan('<resolutionPlan/>', { checkpointId: 5, completedCount: 2 }), /Insufficient health/);
        const correctedSuffix = `<resolutionPlan><technique><actor>${player.name}</actor><intent>Use the practiced aid.</intent><techniqueId>${shimDefinition.id}</techniqueId><sourceId>learned:${shimDefinition.id}</sourceId><newAttempt>true</newAttempt><targets><targetId>${player.id}</targetId></targets></technique></resolutionPlan>`;
        const corrected = session.parsePlan(correctedSuffix, { checkpointId: 5, completedCount: 2 });
        assert.equal(corrected.value[0].techniqueAttemptKey, 'plan:5:1', 'the correction suffix keeps its original action ordinal');
        assert.equal(corrected.value[0].argumentsObject.techniqueId, shimDefinition.id);
        session.commit('plan:5:1');
        session.assertComplete();

        const reverseSession = createPlayerTechniqueSession({
            resolveActor: name => name === player.id || name === player.name ? player : name === target.id || name === target.name ? target : null,
            resolveAttackOperation: (name, args) => name === 'resolveAttack' && args.ability === shimDefinition.name
                ? { actor: args.attacker, techniqueId: shimDefinition.id, sourceId: `learned:${shimDefinition.id}`, targetIds: [player.id], intent: args.intent, newAttempt: true }
                : null
        });
        const reversed = reverseSession.parsePlan(`<resolutionPlan>${techniqueAttackShim}${ordinaryCheck}${nativeTechnique}</resolutionPlan>`, { checkpointId: 6, completedCount: 0 });
        const reversedKeys = reversed.value.filter(action => action.functionName === 'useTechnique').map(action => action.techniqueAttemptKey);
        assert.deepEqual(reversedKeys, ['plan:6:0', 'plan:6:1']);
        const correctedDirect = `<technique><actor>${player.name}</actor><intent>Use the practiced aid.</intent><techniqueId>${shimDefinition.id}</techniqueId><sourceId>learned:${shimDefinition.id}</sourceId><newAttempt>true</newAttempt><targets><targetId>${player.id}</targetId></targets></technique>`;
        const reverseCorrection = reverseSession.parsePlan(`<resolutionPlan>${correctedDirect}${nativeTechnique}</resolutionPlan>`, { checkpointId: 6, completedCount: 0 });
        assert.deepEqual(reverseCorrection.value.map(action => action.techniqueAttemptKey), reversedKeys);
        assert.deepEqual(reverseCorrection.value.map(action => action.argumentsObject.techniqueId), [shimDefinition.id, firstDefinition.id]);
        reversedKeys.forEach(key => reverseSession.commit(key));
        reverseSession.assertComplete();
    });
});

test('TinyBrain player technique plans use the fixed read-only lookup tool allowlist', async () => {
    const { getChatToolDefinitions, TINY_BRAIN_LOOKUP_TOOL_NAMES } = require('../chat_tool_calls.js');
    const first = getChatToolDefinitions({ allowTechniqueExecution: true }).find(definition => definition.function.name === 'useTechnique').function;
    const second = getChatToolDefinitions({ allowTechniqueExecution: true }).find(definition => definition.function.name === 'useTechnique').function;
    assert.deepEqual(first, second, 'the standard native schema is static across player action sessions');
    const tinyBrainNames = [...TINY_BRAIN_LOOKUP_TOOL_NAMES].sort();
    assert.deepEqual(tinyBrainNames, [
        'findMysteryBoxes', 'getFullScene', 'getHistory', 'getMysteryBox', 'getMysteryThread',
        'getTravelTime', 'listLocationEntities', 'listMysteryBoxes', 'listMysteryThreads',
        'locateNpcs', 'locateThings', 'moreInfo'
    ]);
    assert.equal(tinyBrainNames.includes('useTechnique'), false, 'TinyBrain executes techniques through its resolution-plan adapter, not a new native tool');
    assert.deepEqual(Object.keys(first.parameters.properties).sort(), [
        'actor', 'disciplineXml', 'discoveryIntent', 'intent', 'newAttempt', 'operationId', 'sourceId', 'targetIds', 'techniqueId', 'utilitySelections', 'weaponItemId'
    ]);
    assert.deepEqual(first.parameters.required, ['actor', 'targetIds', 'intent']);
});

test('player technique authoring context is bounded to current actors and accessible public definitions', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const context = getPlayerTechniqueAuthoringContext([player]);
        assert.deepEqual(context.actors.map(actor => actor.id), [player.id]);
        assert.equal(Object.hasOwn(context.actors[0], 'skills'), false);
        assert.equal(Object.hasOwn(context.actors[0], 'attributes'), false);
        assert.ok(Array.isArray(context.techniqueContext.actors));
        assert.equal(Object.keys(context.techniqueContext.balancePolicies).length, 1);
        assert.ok(context.techniqueContext.formulaVariableSchema.some(variable => variable.key === 'skill_spellcasting'));
        assert.equal(context.techniqueContext.actors[0].formulaVariables.skill_spellcasting, 3);
        assert.ok(Array.isArray(context.catalog.disciplines));
        assert.equal(context.catalog.disciplines.length, 0, 'an accessible discipline with no catalogue entries is not a populated catalogue');
        const authoring = context.techniqueContext.actors[0].balanceAuthoring;
        assert.ok(context.techniqueContext.balancePolicies[authoring.policyDigest].recipes.some(recipe => recipe.recipeId === 'standard-healing'));
        assert.equal(Object.hasOwn(authoring, 'skills'), false);
        assert.equal(Object.hasOwn(authoring, 'attributes'), false);
        assert.ok(authoring.resourceProfiles.some(profile => profile.resourceProfileId === 'mana'));
        assert.equal(Object.hasOwn(context, 'config'), false);
        assert.equal(Object.hasOwn(context, 'baseContext'), false);
        const instructions = getPlayerTechniqueAuthoringInstructions();
        assert.match(instructions, /Ordinary dialogue, movement and ordinary weapon attacks do not become techniques/);
        assert.match(instructions, /engine assigns new IDs/);
        assert.match(instructions, /recognized rejected technique cannot be omitted/);
    }, { includeMana: true });
});

test('six-actor managed technique projection renders shared mechanics once in standard and TinyBrain prompts', () => {
    const fixture = makeBloatedTechniquePromptFixture();
    const techniqueContext = compactTechniquePromptContext(fixture.techniques);
    const authoringFacts = {
        actors: fixture.actorFacts.map(actor => compactTechniqueActorFacts(actor, { includeFormulaFacts: false })),
        catalog: { disciplines: require('../TechniqueSelectionContext.js').buildTechniqueCatalogueOutlineGroups({ definitions: fixture.catalog, disciplines: [{ id: 'discipline_magic', name: 'Magic' }] }) }
    };
    const bloatedCharacters = JSON.stringify({ techniques: fixture.techniques, authoringFacts: { actors: fixture.actorFacts, catalog: fixture.catalog } }).length;
    const compactCharacters = JSON.stringify({ techniques: techniqueContext, authoringFacts }).length;
    assert.equal(techniqueContext.actors.length, 6);
    assert.ok(Array.isArray(techniqueContext.formulaVariableSchema));
    assert.deepEqual(techniqueContext.formulaVariableSchema.find(row => row.key === 'skill_spellcasting'), {
        key: 'skill_spellcasting', kind: 'skill', name: 'Spellcasting'
    });
    assert.equal(techniqueContext.actors[0].formulaVariables.skill_spellcasting, 2);
    assert.equal(techniqueContext.actors[1].formulaVariables.skill_spellcasting, 3);
    assert.equal(Object.hasOwn(techniqueContext.actors[5].formulaVariables, 'skill_spellcasting'), false, 'actor-specific absent skills stay absent');
    assert.equal(Object.hasOwn(techniqueContext.actors[4].formulaVariables, 'attribute_intelligence_modifier'), false, 'actor-specific absent attributes stay absent');
    assert.ok(compactCharacters < bloatedCharacters * 0.5, `projection reduces fixture from ${bloatedCharacters} to ${compactCharacters} serialized characters`);
    assert.equal(Object.keys(techniqueContext.balancePolicies).length, 1, 'identical managed balance recipes and improvement steps are shared once');

    for (const actor of techniqueContext.actors) {
        assert.equal(Object.hasOwn(actor.balanceAuthoring, 'skills'), false, 'derived skill lists are omitted');
        assert.equal(Object.hasOwn(actor.balanceAuthoring, 'attributes'), false, 'derived attribute lists are omitted');
        assert.ok(actor.balanceAuthoring.resourceProfiles.some(profile => profile.resourceProfileId === 'mana' && profile.baseCost === 100));
        const source = actor.techniques[0].sources[0];
        assert.equal(source.mechanics.acquisitionRequirements[0].minimum, 2);
        assert.equal(source.mechanics.useRequirements[0].minimum, 2);
        assert.match(source.mechanics.costs[0].amount.formula, /skill_spellcasting/);
        assert.match(source.mechanics.effects[0].amount.formula, /attribute_intelligence_modifier/);
        assert.equal(source.costs[0].amount, 83);
        assert.equal(Object.hasOwn(source.mechanics, 'balance'), false, 'saved formula snapshots stay out of the prompt');
        assert.equal(Object.hasOwn(actor.techniques[0], 'imagePrompt'), false, 'art metadata stays out of prompt mechanics');
    }
    assert.equal(techniqueContext.balancePolicies['shared-managed-policy'].recipes[0].managedNeedDefinitions.length, 111, 'the complete managed need-definition set remains available once');
    assert.equal(authoringFacts.actors[0].needBars.length, 111, 'all active need values remain available to authoring');
    assert.equal(Object.hasOwn(authoringFacts.actors[0], 'level'), false, 'main authoring does not duplicate level');
    assert.equal(Object.hasOwn(authoringFacts.actors[0], 'skills'), false, 'main authoring does not duplicate skill values');
    assert.equal(Object.hasOwn(authoringFacts.actors[0], 'attributes'), false, 'main authoring does not duplicate attribute values');
    const detailedActorFacts = fixture.actorFacts.map(actor => compactTechniqueActorFacts(actor));
    assert.equal(detailedActorFacts[0].skills.Spellcasting, 2);
    assert.equal(detailedActorFacts[1].skills.Spellcasting, 3, 'full actor facts preserve differing skill values');
    assert.equal(Object.hasOwn(detailedActorFacts[5].skills, 'Spellcasting'), false, 'full actor facts preserve absent skills');
    assert.equal(Object.hasOwn(detailedActorFacts[4].attributes, 'intelligence'), false, 'full actor facts preserve absent attributes');
    const outlineEntry = authoringFacts.catalog.disciplines[0].techniques[0];
    assert.deepEqual(outlineEntry, { id: 'technique_heal', name: 'Practiced Restoration' });
    const selectedDetails = compactTechniqueCatalogue(fixture.catalog);
    assert.equal(selectedDetails[0].revisions.length, 1, 'selected details retain current mechanics');
    assert.equal(selectedDetails[0].revisions[0].costs[0].needId, 'mana');

    for (const mode of ['standard', 'tinybrain']) {
        const rendered = renderPlayerAction(mode, authoringFacts);
        assert.doesNotMatch(rendered, /<techniqueAuthoringFacts>|"techniqueContext"|formulaVariableSchema/);
        assert.match(rendered, /selectedTechniqueDetails|getTechniqueDetails/);
    }
});

test('technique prompt projection rejects duplicate, conflicting, and nonfinite formula definitions', () => {
    const fixture = makeBloatedTechniquePromptFixture();
    const duplicate = structuredClone(fixture.techniques);
    duplicate[0].formulaVariables.push({ ...duplicate[0].formulaVariables[1] });
    assert.throws(() => compactTechniquePromptContext(duplicate), /duplicated/i);

    const conflict = structuredClone(fixture.techniques);
    conflict[1].formulaVariables.find(variable => variable.key === 'skill_spellcasting').name = 'spellcasting';
    assert.throws(() => compactTechniquePromptContext(conflict), /conflicting definitions/i);

    const nonfinite = structuredClone(fixture.techniques);
    nonfinite[0].formulaVariables[0].value = Number.NaN;
    assert.throws(() => compactTechniquePromptContext(nonfinite), /finite value/i);
});

test('API wires natural player techniques into main action prompts and keeps NPC preparation standalone', () => {
    const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const standardPrompt = fs.readFileSync(require.resolve('../prompts/_includes/player-action.njk'), 'utf8');
    const tinyBrainPrompt = fs.readFileSync(require.resolve('../prompts/_includes/player-action.tinybrain.njk'), 'utf8');
    const currentPlayerPreparationCalls = [...apiSource.matchAll(/resolveTechniqueBeforeNarration\(\{\s*actor:\s*currentPlayer/g)];
    assert.equal(currentPlayerPreparationCalls.length, 1, 'the only player standalone preparation is the explicit pinned UI path');
    assert.match(apiSource, /const invocation = explicitUse \? await resolveTechniqueBeforeNarration\(\{ actor: currentPlayer/);
    assert.match(apiSource, /const npcTechniqueInvocation = await resolveTechniqueBeforeNarration\(\{ actor: npc/);
    assert.match(apiSource, /techniqueSession:\s*promptType === 'player-action'\s*\?\s*playerTechniqueSession\s*:\s*null/);
    assert.match(apiSource, /playerTechniqueSession\.parsePlan\(response, \{/);
    assert.match(apiSource, /playerTechniqueSession\.assertComplete\(\)/);
    assert.match(apiSource, /playerActionCombinedMechanics:\s*!isCreativeModeAction/);
    assert.match(apiSource, /preserveBaseContextToolDefinitions:\s*true/);
    assert.match(getPlayerTechniqueAuthoringInstructions(), /ordinary weapon attacks do not become techniques/i);
    for (const prompt of [standardPrompt, tinyBrainPrompt]) {
        assert.match(prompt, /set useLegacyPlayerChecks = config\.use_legacy_prompt_checks and not playerActionCombinedMechanics/);
        assert.doesNotMatch(prompt, /<techniqueAuthoringFacts>/);
        assert.match(prompt, /selectedTechniqueDetails|getTechniqueDetails/);
    }
});

test('native and TinyBrain nested XML both accept semantic standard damage without model-authored IDs', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const candidate = candidateFor(player);
        candidate.name = 'Arcane Strike'; candidate.semanticKey = 'arcane-strike';
        candidate.revisions[0].check = { kind: 'skill', skill: 'Spellcasting', difficulty: 'Medium' };
        candidate.revisions[0].recipe = { kind: 'damage', skillName: 'Spellcasting', attributeName: 'intelligence' };
        delete candidate.revisions[0].revision;
        const { loadXmlGenerationSchema } = require('../XmlGenerationSchema.js');
        const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
        assert.equal(new XmlClosingTagGuard({ schema: loadXmlGenerationSchema('technique-authoring-discipline.schema.xml') }).inspect(groupedAuthoringXml(candidate, newDiscipline)), null);
        const resolveActor = name => name === player.id || name === player.name ? player : null;
        const native = createPlayerTechniqueSession({ resolveActor });
        const raw = { actor: player.name, targetIds: [player.id], intent: 'Strike with practiced magic.', disciplineXml: groupedAuthoringXml(candidate, newDiscipline) };
        const nativeOp = native.normalizeNative(raw, native.nativeKey(raw, 'damage-call'));
        assert.equal(nativeOp.candidate.revisions[0].recipe.kind, 'damage');
        assert.equal(nativeOp.candidate.revisions[0].revision, 1);
        assert.ok(nativeOp.techniqueId);
        const staged = createPlayerTechniqueSession({ resolveActor });
        const xml = `<resolutionPlan><technique><actor>${player.name}</actor><intent>Strike with practiced magic.</intent><targets><targetId>${player.id}</targetId></targets>${groupedAuthoringXml(candidate, newDiscipline)}</technique></resolutionPlan>`;
        staged.beginPlan();
        const plan = parsePlayerActionResolutionPlan(xml, { parseTechnique: (node, index) => staged.parseNode(node, `plan:initial:${index}`) });
        const entry = plan.value[0].argumentsObject;
        assert.equal(entry.candidate.revisions[0].recipe.kind, 'damage');
        assert.equal(entry.candidate.revisions[0].revision, 1);
        assert.ok(entry.techniqueId);
        assert.equal(Object.hasOwn(candidate, 'id'), false);
    }, { includeMana: true });
});

test('unknown technique references can be corrected to ordinary checks, empty plans, or canonical techniques', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const definition = addDefinition('technique-corrected', { revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'heal', kind: 'healing', amount: 1 }] });
        learn(player, definition.id);
        const technique = id => `<technique><actor>${player.name}</actor><intent>Use a technique.</intent><techniqueId>${id}</techniqueId><sourceId>learned:${id}</sourceId><targets><targetId>${player.id}</targetId></targets></technique>`;
        const check = `<check><type>unopposed</type><actor>${player.name}</actor><intent>Check the area.</intent><skill>Athletics</skill><attribute>Strength</attribute><difficulty>Easy</difficulty><circumstanceModifiers/></check>`;
        for (const correction of [check, '', technique(definition.id)]) {
            const session = createPlayerTechniqueSession({ resolveActor: name => name === player.name || name === player.id ? player : null });
            const state = createResolutionPlanExecutionState('unknown-correction');
            assert.throws(() => session.parsePlan(`<resolutionPlan>${technique('ability_salvage_scan')}</resolutionPlan>`, { checkpointId: 1, completedCount: 0 }), /unknown technique/i);
            const plan = session.parsePlan(`<resolutionPlan>${correction}</resolutionPlan>`, { checkpointId: 1, completedCount: 0 });
            const executed = [];
            const result = await executePlayerActionResolutionPlan(plan.value, {
                state, checkpointId: 1,
                validateAction: async () => {},
                executeAction: async call => { executed.push(call); return { content: 'Resolved.', metadata: { success: true } }; }
            });
            assert.equal(result.invocations.length, correction ? 1 : 0);
            assert.equal(executed.length, correction ? 1 : 0);
        }
    });
});

test('correcting an unknown pending technique retains completed plan receipts without replay', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const session = createPlayerTechniqueSession({ resolveActor: name => name === player.name || name === player.id ? player : null });
        const state = createResolutionPlanExecutionState('unknown-after-prefix');
        const check = intent => `<check><type>unopposed</type><actor>${player.name}</actor><intent>${intent}</intent><skill>Athletics</skill><attribute>Strength</attribute><difficulty>Easy</difficulty><circumstanceModifiers/></check>`;
        const initial = session.parsePlan(`<resolutionPlan>${check('First')}${check('Pending')}</resolutionPlan>`, { checkpointId: 7, completedCount: 0 });
        const executed = [];
        await assert.rejects(executePlayerActionResolutionPlan(initial.value, {
            state, checkpointId: 7,
            validateAction: async action => { if (executed.length) throw new Error('Pending action changed.'); },
            executeAction: async call => { executed.push(call); return { content: 'Resolved.', metadata: { success: true } }; }
        }), /Pending action changed/);
        const unknown = `<technique><actor>${player.name}</actor><intent>Use a technique.</intent><techniqueId>ability_salvage_scan</techniqueId><targets><targetId>${player.id}</targetId></targets></technique>`;
        assert.throws(() => session.parsePlan(`<resolutionPlan>${unknown}</resolutionPlan>`, { checkpointId: 7, completedCount: 1 }), /unknown technique/i);
        const corrected = session.parsePlan(`<resolutionPlan>${check('Corrected')}</resolutionPlan>`, { checkpointId: 7, completedCount: 1 });
        const result = await executePlayerActionResolutionPlan(corrected.value, {
            state, checkpointId: 7, validateAction: async () => {},
            executeAction: async call => { executed.push(call); return { content: 'Resolved.', metadata: { success: true } }; }
        });
        assert.deepEqual(executed.map(call => call.intent), ['First', 'Corrected']);
        assert.match(executed[1].id, /:1$/);
        assert.equal(result.invocations.length, 2);
    });
});

test('standard and TinyBrain technique adapters preserve nested utility selectors identically', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const id = 'technique-selector-parity';
        addDefinition(id, mechanics({ effects: [{ id: 'travel', kind: 'teleport' }] }));
        const session = createPlayerTechniqueSession({ resolveActor: name => name === player.name || name === player.id ? player : null });
        const native = session.normalizeNative({ actor: player.name, intent: 'Travel.', techniqueId: id, targetIds: [player.id], utilitySelections: { travel: { destinationId: 'loc-test' } } }, 'native:selector');
        const node = Utils.parseXmlDocumentStrict(`<technique><actor>${player.name}</actor><intent>Travel.</intent><techniqueId>${id}</techniqueId><targets><targetId>${player.id}</targetId></targets><utilitySelections><selection><effectId>travel</effectId><destinationId>loc-test</destinationId></selection></utilitySelections></technique>`, 'text/xml').documentElement;
        const tiny = session.parseNode(node, 'plan:selector');
        assert.deepEqual(tiny.utilitySelections, native.utilitySelections);
        assert.deepEqual(tiny.targetIds, native.targetIds);
        const invalid = Utils.parseXmlDocumentStrict(`<technique><actor>${player.name}</actor><intent>Travel.</intent><techniqueId>${id}</techniqueId><targets><targetId>${player.id}</targetId></targets><utilitySelections><selection><effectId>travel</effectId><destinationId>x</destinationId><actorId>y</actorId></selection></utilitySelections></technique>`, 'text/xml').documentElement;
        assert.throws(() => session.parseNode(invalid, 'plan:bad-selector'), /exactly one/);
    });
});

test('TinyBrain preflight correction keeps a novel technique identity when ordinary actions shift', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setSkillValue('Athletics', 1);
        const session = createPlayerTechniqueSession({ resolveActor: name => name === player.name || name === player.id ? player : null });
        const state = createResolutionPlanExecutionState('shifted-novel');
        const check = `<check><type>unopposed</type><actor>${player.name}</actor><intent>Apply first aid.</intent><skill>Athletics</skill><attribute>Strength</attribute><difficulty>Easy</difficulty><circumstanceModifiers/></check>`;
        const candidate = candidateFor(player);
        const invalid = structuredClone(candidate);
        delete invalid.revisions[0].recipe.skillName;
        delete invalid.revisions[0].recipe.attributeName;
        const technique = value => `<technique><actor>${player.name}</actor><intent>Restore my wounds.</intent><discoveryIntent>A restorative practice.</discoveryIntent><targets><targetId>${player.id}</targetId></targets>${groupedAuthoringXml(value, newDiscipline)}</technique>`;
        const first = session.parsePlan(`<resolutionPlan>${check}${technique(invalid)}</resolutionPlan>`, { checkpointId: 11, completedCount: 0 });
        const original = first.value[1];
        const executed = [];
        await assert.rejects(executePlayerActionResolutionPlan(first.value, {
            state, checkpointId: 11,
            validateAction: async action => {
                if (action.functionName === 'useTechnique') {
                    try { TechniqueService.preview({ ...action.argumentsObject, actor: player }); }
                    catch (error) { session.reject(action.techniqueAttemptKey, error); throw error; }
                }
            },
            executeAction: async call => { executed.push(call); return { content: 'Resolved.' }; }
        }), /recipe\.(skillName|attributeName)/);
        assert.equal(executed.length, 0, 'whole-batch preflight executes no earlier check');
        assert.throws(() => session.parsePlan('<resolutionPlan/>', { checkpointId: 11, completedCount: 0 }), /recipe\.(skillName|attributeName)|cannot be omitted/);
        const replacement = structuredClone(candidate);
        replacement.name = 'Different Mend';
        replacement.semanticKey = 'different-mend';
        assert.throws(() => session.parsePlan(`<resolutionPlan>${technique(replacement)}</resolutionPlan>`, { checkpointId: 11, completedCount: 0 }), /technique|identity|attempt|recipe/i);
        const corrected = session.parsePlan(`<resolutionPlan>${technique(candidate)}</resolutionPlan>`, { checkpointId: 11, completedCount: 0 });
        assert.equal(corrected.value[0].argumentsObject.techniqueId, original.argumentsObject.techniqueId);
        assert.equal(corrected.value[0].techniqueAttemptKey, original.techniqueAttemptKey);
        await executePlayerActionResolutionPlan(corrected.value, {
            state, checkpointId: 11, validateAction: async action => TechniqueService.preview({ ...action.argumentsObject, actor: player }),
            executeAction: async call => {
                executed.push(call);
                const receipt = await TechniqueService.execute({ ...call.argumentsObject, actor: player, operationId: call.id, turnId: 'shifted-novel' });
                session.commit(call.techniqueAttemptKey);
                return { content: 'Resolved.', metadata: { techniqueReceipt: receipt } };
            }
        });
        assert.equal(executed.length, 1);
        session.assertComplete();
    }, { includeMana: true });
});

test('TinyBrain known technique retry survives ordinary action shifts and retains distinct repeated attempts', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const definition = addDefinition('technique-shifted-known', { revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'heal', kind: 'healing', amount: 1 }] });
        learn(player, definition.id);
        const session = createPlayerTechniqueSession({ resolveActor: name => name === player.name || name === player.id ? player : null });
        const check = `<check><type>unopposed</type><actor>${player.name}</actor><intent>Check first.</intent><skill>Athletics</skill><attribute>Strength</attribute><difficulty>Easy</difficulty><circumstanceModifiers/></check>`;
        const technique = `<technique><actor>${player.name}</actor><intent>Use practiced aid.</intent><techniqueId>${definition.id}</techniqueId><newAttempt>true</newAttempt><targets><targetId>${player.id}</targetId></targets></technique>`;
        const first = session.parsePlan(`<resolutionPlan>${check}${technique}${technique}</resolutionPlan>`, { checkpointId: 12, completedCount: 0 });
        const keys = first.value.slice(1).map(action => action.techniqueAttemptKey);
        assert.notEqual(keys[0], keys[1]);
        session.reject(keys[0], new Error('Correct the target.'));
        assert.throws(() => session.parsePlan(`<resolutionPlan>${technique}</resolutionPlan>`, { checkpointId: 12, completedCount: 0 }), /omit|technique|target/i);
        const corrected = session.parsePlan(`<resolutionPlan>${technique}${check}${technique}</resolutionPlan>`, { checkpointId: 12, completedCount: 0 });
        assert.deepEqual(corrected.value.filter(action => action.functionName === 'useTechnique').map(action => action.techniqueAttemptKey), keys);
        keys.forEach(key => session.commit(key));
        session.assertComplete();
    });
});


test('rendered standard and TinyBrain selection guidance distinguishes abilities from owned techniques', () => {
    for (const mode of ['standard', 'tinybrain']) {
        const prompt = renderPlayerAction(mode, {}, true);
        assert.match(prompt, /choose from that actor's <techniques> list/i);
        assert.match(prompt, /shown ID to disambiguate names/i);
        assert.match(prompt, /ability names alone are not technique references/i);
        assert.match(prompt, /kind discover[\s\S]*(?:acquisition|catalogue)/i);
        assert.doesNotMatch(prompt, /<techniqueAuthoringFacts>|<formulaVariableSchema>|<balancePolicies>/);
    }
});
