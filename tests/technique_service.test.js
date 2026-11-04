'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Thing = require('../Thing.js');
const Technique = require('../Technique.js');
const TechniqueFormulaVariables = require('../public/js/technique-formula-variables.js');
const TechniqueService = require('../TechniqueService.js');
const { registerTechniqueApiRoutes } = require('../TechniqueApi.js');
const { parseGeneratedNpcTechniques, applyGeneratedNpcTechniques } = require('../GeneratedNpcTechniques.js');
const TechniquePrompt = require('../TechniquePrompt.js');
const TechniqueEvents = require('../TechniqueEvents.js');
const ThingMutationService = require('../ThingMutationService.js');
const Utils = require('../Utils.js');
const { getTechniqueRuntimeFingerprint } = require('../TechniqueRuntimeState.js');
const { resolveActionIconTarget } = require('../ActionIconTarget.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
const {
    createTempDefsDir,
    withStandardTestConfig
} = require('./helpers/needBarFixtures.js');

const provenance = { kind: 'training', reason: 'Focused technique service fixture.' };

function mechanics({ target = 'self', costs = [], failureCosts, effects, check = { kind: 'automatic' } }) {
    return {
        revision: 1,
        target: { kind: target },
        check,
        costs,
        ...(failureCosts ? { failureCosts } : {}),
        effects
    };
}

function definition(id, effectMechanics) {
    return {
        id,
        disciplineId: 'discipline-test',
        name: `Technique ${id}`,
        description: 'A test technique.',
        semanticKey: id,
        aliases: [],
        provenance,
        revisions: [effectMechanics]
    };
}

function setupWorld() {
    TechniqueService.reset();
    const region = new Region({ id: 'technique-test-region', name: 'Test Region', description: 'A test region.' });
    const location = new Location({ id: 'technique-test-location', name: 'Test Room', description: 'A test room.', regionId: region.id });
    const actor = new Player({ id: 'technique-test-actor', name: 'Test Actor', description: 'An actor.' });
    const target1 = new Player({ id: 'technique-test-target1', name: 'Target One', description: 'A target.', isNPC: true });
    const target2 = new Player({ id: 'technique-test-target2', name: 'Target Two', description: 'A target.', isNPC: true });
    for (const character of [actor, target1, target2]) character.setLocation(location);
    Globals.currentPlayer = actor;
    TechniqueService.addDiscipline({ id: 'discipline-test', name: 'Test Discipline', description: 'Test only.', publicAccess: true });
    return { region, location, actor, target1, target2 };
}

function learn(actor, id, effectMechanics) {
    if (!TechniqueService.getDefinition(id)) TechniqueService.addDefinition(definition(id, effectMechanics), { actor, origin: 'editor' });
    return TechniqueService.learn({ operationId: `learn:${id}:${actor.id}`, actor, techniqueId: id, provenance });
}

function withWorld(run, { gearSlotsYaml, includeMana = false } = {}) {
    const previousPlayer = Globals.currentPlayer;
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const tempBaseDir = createTempDefsDir({
        prefix: 'ai-rpg-technique-service-',
        ...(includeMana ? {
            attributes: [
                { id: 'strength', label: 'Strength', default: 5 },
                { id: 'intelligence', label: 'Intelligence', default: 10 }
            ],
            needBarsYaml: fs.readFileSync(path.join(__dirname, '../defs/need_bars.yaml'), 'utf8')
        } : {})
    });
    if (gearSlotsYaml) fs.writeFileSync(path.join(tempBaseDir, 'defs/gear_slots.yaml'), gearSlotsYaml);
    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = withStandardTestConfig(previousConfig);
    Player.reloadDefinitionCaches({ refreshInstances: false });
    const cleanup = () => {
            TechniqueService.reset();
            Player.clearRuntimeRegistries();
            Thing.clear();
            Location.clear();
            Region.clear();
            Globals.currentPlayer = previousPlayer;
            Globals.baseDir = previousBaseDir;
            Globals.config = previousConfig;
            Player.reloadDefinitionCaches({ refreshInstances: false });
            fs.rmSync(tempBaseDir, { recursive: true, force: true });
    };
    try {
        return Promise.resolve(run(setupWorld())).finally(cleanup);
    } catch (error) {
        cleanup();
        throw error;
    }
}

test('technique definitions reject undeclared formulas, unsupported fields, and automatic harmful effects', () => {
    assert.throws(() => Technique.normalizeAmount({ formula: 'level + bonus', bindings: { level: { kind: 'level' } } }), /unknown formula variable bonus/);
    assert.throws(() => Technique.normalizeAmount({ formula: 'clamp(level, 0, 10)', bindings: { level: { kind: 'level' } } }), /unsupported function clamp/);
    assert.throws(() => Technique.normalizeRevision(mechanics({ effects: [{ id: 'hurt', kind: 'damage', amount: 3, damageMode: 'technique' }] })), /Harmful effects require/);
    assert.throws(() => Technique.normalizeRevision({ ...mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 3 }] }), unreviewed: true }), /unsupported/);
});

test('formula amounts bind authoritative actor facts and retain fixed decimal values', async () => {
    await withWorld(({ actor }) => {
        const scaled = Technique.evaluateAmount({ formula: 'level * 2', bindings: { level: { kind: 'level' } } }, actor, 'test amount');
        assert.equal(scaled.amount, actor.level * 2);
        const fixed = Technique.evaluateAmount(2.75, actor, 'fixed amount');
        assert.equal(fixed.amount, 2.75);
    });
});

test('automatic technique formula variables use actor level, skill ranks, and attribute modifiers', async () => {
    await withWorld(({ actor }) => {
        actor.setLevel(5);
        assert.equal(actor.setSkillValue('Spellcasting', 4), true);
        actor.setAttribute('strength', 14);

        const catalog = TechniqueFormulaVariables.catalog(actor);
        assert.deepEqual(catalog.find(row => row.key === 'level'), { key: 'level', label: 'Level', kind: 'level', value: actor.level });
        assert.deepEqual(catalog.find(row => row.key === 'skill_spellcasting'), { key: 'skill_spellcasting', label: 'Spellcasting rank', kind: 'skill', name: 'Spellcasting', value: 4 });
        assert.deepEqual(catalog.find(row => row.key === 'attribute_strength_modifier'), { key: 'attribute_strength_modifier', label: 'strength modifier', kind: 'attribute', name: 'strength', value: actor.getAttributeModifier('strength') });

        const automatic = Technique.evaluateAmount({ formula: 'level + skill_spellcasting + attribute_strength_modifier' }, actor, 'test amount');
        assert.equal(automatic.amount, 11);
        assert.deepEqual(automatic.inputs, { level: 5, skill_spellcasting: 4, attribute_strength_modifier: 2 });

        const legacy = { formula: 'level + power', bindings: { level: { kind: 'skill', name: 'Spellcasting' }, power: { kind: 'attribute', name: 'strength' } } };
        assert.deepEqual(Technique.normalizeAmount(legacy), legacy, 'saved explicit bindings retain their original meaning and shape');
        assert.equal(Technique.evaluateAmount(legacy, actor, 'legacy amount').amount, 6);
        const legacyDefinition = definition('technique-legacy-formula', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: legacy }] }));
        const restoredDefinition = Technique.fromJSON(JSON.parse(JSON.stringify(legacyDefinition))).toJSON();
        assert.deepEqual(restoredDefinition.revisions[0].effects[0].amount, legacy, 'JSON save hydration preserves legacy binding aliases');
        assert.equal(TechniqueFormulaVariables.canonicalize('max(level, power)', legacy.bindings), 'max(skill_spellcasting, attribute_strength_modifier)');
    });
});

test('automatic technique formulas reject unknown actor variables and ambiguous canonical names', async () => {
    await withWorld(({ actor }) => {
        assert.throws(() => Technique.evaluateAmount({ formula: 'skill_not_available + 1' }, actor, 'test amount'), /unknown formula variable skill_not_available/);
        const ambiguousActor = {
            level: 1,
            getSkills: () => new Map([['Field Craft', 2], ['Field-Craft', 3]]),
            getSkillValue: name => name === 'Field Craft' ? 2 : 3,
            getAttributeNames: () => [],
            getAttributeModifier: () => 0
        };
        assert.throws(() => TechniqueFormulaVariables.catalog(ambiguousActor), /variable skill_field_craft is ambiguous/);
    });
});

test('mixed area outcomes pay normal costs once, while all misses pay the failure vector once', async () => {
    await withWorld(async ({ actor, target1, target2 }) => {
        actor.setHealth(actor.maxHealth);
        const effectMechanics = mechanics({
            target: 'area',
            check: { kind: 'skill', skill: 'Strength', difficulty: 'Easy' },
            costs: [{ resource: 'health', amount: 5 }, { resource: 'health', amount: 2 }],
            failureCosts: [{ resource: 'health', amount: 1 }],
            effects: [{ id: 'blast', kind: 'damage', amount: 4, damageMode: 'technique' }]
        });
        learn(actor, 'technique-blast', effectMechanics);
        const outcomes = new Map([[target1.id, true], [target2.id, false]]);
        const mixed = await TechniqueService.execute({
            operationId: 'mixed-area-attempt', turnId: 'turn-1', actor, techniqueId: 'technique-blast', targetIds: [target1.id, target2.id],
            prepareCheck: async ({ target }) => ({ success: outcomes.get(target.id), roll: target.id })
        });
        assert.equal(mixed.success, true);
        assert.equal(mixed.costOutcome, 'normal');
        assert.equal(actor.health, actor.maxHealth - 7);
        assert.deepEqual(mixed.costs.map(cost => [cost.key, cost.amount, cost.previousValue, cost.newValue]), [['health', 7, actor.maxHealth, actor.maxHealth - 7]]);
        assert.equal(target1.health, target1.maxHealth - 4);
        assert.equal(target2.health, target2.maxHealth);

        actor.setHealth(actor.maxHealth - 7);
        const allMiss = await TechniqueService.execute({
            operationId: 'all-miss-area-attempt', turnId: 'turn-1', actor, techniqueId: 'technique-blast', targetIds: [target1.id, target2.id],
            prepareCheck: async () => ({ success: false })
        });
        assert.equal(allMiss.success, false);
        assert.equal(allMiss.costOutcome, 'failure');
        assert.equal(actor.health, actor.maxHealth - 8);
        assert.deepEqual(allMiss.costs.map(cost => cost.amount), [1]);
        assert.equal(target1.health, target1.maxHealth - 4);
        assert.equal(target2.health, target2.maxHealth);
    });
});

test('preflight rejects an unaffordable outcome without learning, charging, rolling, or installing candidates', async () => {
    await withWorld(async ({ actor, target1 }) => {
        actor.setHealth(4);
        const candidate = definition('technique-candidate', mechanics({
            target: 'single',
            check: { kind: 'skill', skill: 'Strength', difficulty: 'Easy' },
            costs: [{ resource: 'health', amount: 3 }],
            failureCosts: [{ resource: 'health', amount: 5 }],
            effects: [{ id: 'restore', kind: 'healing', amount: 2 }]
        }));
        let checks = 0;
        await assert.rejects(TechniqueService.execute({
            operationId: 'too-poor-attempt', turnId: 'turn-1', actor, candidate,
            candidateDiscipline: { id: 'discipline-test', name: 'Test Discipline', description: 'Test only.', publicAccess: true },
            acquisition: { definitionRevision: 1, provenance: { kind: 'discovery', reason: 'A qualified test discovery.' } },
            targetIds: [target1.id], origin: 'editor',
            prepareCheck: async () => { checks += 1; return { success: false }; }
        }), /Insufficient health.*failure costs/);
        assert.equal(checks, 0);
        assert.equal(actor.health, 4);
        assert.equal(actor.techniques.length, 0);
        assert.equal(TechniqueService.getDefinition(candidate.id), null);
        assert.equal(TechniqueService.getReceipt('too-poor-attempt'), null);
    });
});

test('a qualified discovery learns on its first failed attempt; an unqualified discovery leaves no staged world state', async () => {
    await withWorld(async ({ actor }) => {
        actor.setHealth(8);
        const candidate = { ...definition('technique-first-attempt', mechanics({
            check: { kind: 'skill', skill: 'Strength', difficulty: 'Hard' },
            costs: [{ resource: 'health', amount: 2 }],
            effects: [{ id: 'restore', kind: 'healing', amount: 4 }]
        })), disciplineId: 'discipline-discovered' };
        const candidateDiscipline = { id: 'discipline-discovered', name: 'Discovered Discipline', description: 'A test discipline.', publicAccess: true };
        const failed = await TechniqueService.execute({
            operationId: 'qualified-first-failure', turnId: 'discovery-turn', actor, candidate, candidateDiscipline, origin: 'editor',
            acquisition: { definitionRevision: 1, provenance: { kind: 'discovery', reason: 'Qualified first attempt.' } },
            prepareCheck: async () => ({ success: false, result: 'failed' })
        });
        assert.equal(failed.success, false);
        assert.equal(actor.techniques[0].techniqueId, candidate.id);
        assert.equal(actor.health, 6);
        assert.equal(failed.effects[0].success, false);
        assert.ok(TechniqueService.getDefinition(candidate.id));

        const rejectedCandidate = definition('technique-unqualified', mechanics({ effects: [{ id: 'restore', kind: 'healing', amount: 4 }] }));
        const restrictedDiscipline = { id: 'discipline-restricted', name: 'Restricted Discipline', description: 'Requires advanced access.', accessRequirements: [{ kind: 'level', minimum: actor.level + 1 }] };
        await assert.rejects(TechniqueService.execute({
            operationId: 'unqualified-discovery', turnId: 'discovery-turn', actor, candidate: { ...rejectedCandidate, disciplineId: restrictedDiscipline.id }, candidateDiscipline: restrictedDiscipline, origin: 'editor',
            acquisition: { definitionRevision: 1, provenance: { kind: 'discovery', reason: 'Unqualified fixture request.' } }
        }), /Cannot learn Technique technique-unqualified.*level/);
        assert.equal(actor.techniques.some(entry => entry.techniqueId === rejectedCandidate.id), false);
        assert.equal(TechniqueService.getDefinition(rejectedCandidate.id), null);
        assert.equal(TechniqueService.getReceipt('unqualified-discovery'), null);
    });
});

test('replaying a committed candidate learn after discipline rename returns its receipt without reverting metadata', async () => {
    await withWorld(async ({ actor }) => {
        const candidate = definition('technique-replay-renamed-discipline', mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'A ward.', duration: 1, attributes: [{ attribute: 'strength', modifier: 1 }] } }] }));
        delete candidate.disciplineId;
        const candidateDiscipline = { name: 'Field Warding', description: 'A reusable defensive practice.', publicAccess: true };
        const first = TechniqueService.learn({ operationId: 'learn-before-discipline-rename', actor, candidate, candidateDiscipline, provenance, origin: 'editor' });
        const disciplineId = TechniqueService.getDefinition(candidate.id).disciplineId;
        const expected = TechniqueService.getDisciplineEditContext(actor);
        TechniqueService.editDisciplines({
            actor, edits: [{ id: disciplineId, name: 'Protective Forms', description: 'The renamed saved practice.' }],
            accessIds: actor.disciplineAccess.map(entry => entry.disciplineId), expected
        });
        const replay = TechniqueService.learn({ operationId: 'learn-before-discipline-rename', actor, candidate, candidateDiscipline, provenance, origin: 'editor' });
        assert.deepEqual(replay, first);
        assert.equal(TechniqueService.getDiscipline(disciplineId).name, 'Protective Forms', 'receipt replay cannot restore the proposal name over the renamed saved record');
        assert.equal(actor.techniques.filter(entry => entry.techniqueId === candidate.id).length, 1);
    });
});

test('missing discipline errors list live and detached staged IDs, with an explicit empty catalogue marker', async () => {
    await withWorld(async ({ actor }) => {
        assert.throws(() => TechniqueService.getDisciplineIcon('missing-live-discipline'), /Available discipline IDs: discipline-test/);

        const stagedId = 'discipline_detached_warding';
        const wardMechanics = mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'A staged ward.', duration: 1, attributes: [{ attribute: 'strength', modifier: 1 }] } }] });
        const first = { ...definition('technique-detached-first', wardMechanics), disciplineId: stagedId };
        const second = { ...definition('technique-detached-second', wardMechanics), disciplineId: 'missing-detached-discipline' };
        const catalogBefore = TechniqueService.toJSON();
        assert.throws(() => TechniqueService.prepareLearningBatch([{
            actor, operationId: 'detached-discipline-diagnostic',
            techniques: [
                { candidate: first, candidateDiscipline: { id: stagedId, name: 'Detached Warding', description: 'A staged field.', publicAccess: true }, provenance },
                { candidate: second, provenance }
            ]
        }]), error => {
            assert.match(error.message, /Missing initial discipline missing-detached-discipline/);
            assert.match(error.message, /Available discipline IDs:.*discipline-test.*discipline_detached_warding/);
            return true;
        });
        assert.deepEqual(TechniqueService.toJSON(), catalogBefore, 'failed staged validation does not install detached entries');

        TechniqueService.reset();
        assert.throws(() => TechniqueService.getDisciplineIcon('missing-empty-discipline'), /Available discipline IDs: none/);
    });
});

test('automatic first-use healing compiles the managed recipe, pays its full cost, and respects missing-health bounds', async () => {
    await withWorld(async ({ actor }) => {
        actor.setLevel(3);
        actor.setSkillValue('Spellcasting', 3);
        actor.setAttribute('intelligence', 18);
        actor.setHealth(actor.maxHealth - 5);
        const beforeMana = actor.getNeedBarValue('mana');
        const candidate = definition('technique-managed-discovery', {
            revision: 1,
            target: { kind: 'self' },
            check: { kind: 'automatic' },
            recipe: { recipeId: 'standard-healing', skillName: 'Spellcasting', attributeName: 'intelligence', resourceProfileId: 'mana', effectId: 'restore' }
        });
        const receipt = await TechniqueService.execute({
            operationId: 'managed-discovery-use', turnId: 'managed-discovery-turn', actor, candidate,
            candidateDiscipline: { id: 'discipline-test', name: 'Test Discipline', description: 'Test only.', publicAccess: true },
            acquisition: { definitionRevision: 1, provenance: { kind: 'discovery', reason: 'Managed healing recipe fixture.' } }
        });

        assert.equal(receipt.effects[0].amount, 24);
        assert.equal(actor.getNeedBarValue('mana'), beforeMana - 83);
        assert.equal(actor.health, actor.maxHealth);
        assert.equal(TechniqueService.getDefinition(candidate.id).revisions[0].balance.recipeId, 'standard-healing');
    }, { includeMana: true });
});

test('managed improvement consumes evidence once, restores it on failed install, and replays its saved revision', async () => {
    await withWorld(async ({ actor }) => {
        actor.setLevel(3);
        actor.setSkillValue('Spellcasting', 3);
        actor.setAttribute('intelligence', 18);
        const definitionId = 'technique-managed-improvement';
        TechniqueService.addDefinition(definition(definitionId, {
            revision: 1, target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' },
            recipe: { recipeId: 'standard-healing', skillName: 'Spellcasting', attributeName: 'intelligence', resourceProfileId: 'mana', effectId: 'restore' }
        }), { actor, origin: 'automatic' });
        TechniqueService.learn({ operationId: 'managed-improvement-learn', actor, techniqueId: definitionId, provenance });
        TechniqueService.recordEvidence({
            operationId: 'managed-improvement-evidence', actor, techniqueId: definitionId,
            evidence: { id: 'managed-improvement-training', kind: 'training', description: 'Completed focused efficiency practice.', worldMinute: 0 }
        });
        const originalSetTechniques = actor.setTechniques.bind(actor);
        let writes = 0;
        actor.setTechniques = entries => {
            writes += 1;
            if (writes === 1) throw new Error('Injected personal installation failure.');
            return originalSetTechniques(entries);
        };
        const improve = {
            operationId: 'managed-efficiency-improvement', actor, techniqueId: definitionId,
            improvement: { stepId: 'efficiency', reason: 'The training supports more efficient use.' },
            evidenceIds: ['managed-improvement-training'],
            provenance: { kind: 'training', reason: 'Focused efficiency practice.' }
        };
        assert.throws(() => TechniqueService.improve(improve), /Injected personal installation failure/);
        assert.equal(TechniqueService.getReceipt(improve.operationId), null);
        assert.equal(actor.techniques[0].personalRevision, 1);
        assert.equal(actor.techniques[0].evidence[0].usedBy, undefined);

        actor.setTechniques = originalSetTechniques;
        const receipt = TechniqueService.improve(improve);
        assert.equal(actor.techniques[0].personalRevision, 2);
        assert.equal(actor.techniques[0].revisionHistory.length, 1);
        assert.equal(actor.techniques[0].evidence[0].usedBy, improve.operationId);
        assert.equal(actor.techniques[0].mechanics.balance.parameters.baseCost, 90);
        assert.equal(actor.techniques[0].mechanics.effects[0].amount.formula, 'round(10 + 3 * level + 1 * skill_spellcasting + 0.5 * attribute_intelligence_modifier)');
        const malformedReceiptState = TechniqueService.toJSON();
        malformedReceiptState.receipts.find(item => item.operationId === improve.operationId).request.improvement.unreviewed = true;
        assert.throws(() => TechniqueService.validateState(malformedReceiptState, { actors: [actor], things: [] }), /improvement.*unsupported/);
        Globals.config.techniques = { ...(Globals.config.techniques || {}), balance: { ...structuredClone(require('../TechniqueBalancePolicy.js').DEFAULT_POLICY), healing: { standard: { ...require('../TechniqueBalancePolicy.js').DEFAULT_POLICY.healing.standard, levelCoefficient: 20 } } } };
        assert.deepEqual(TechniqueService.improve(improve), receipt, 'a committed improvement replay returns its original saved revision after policy change');
        assert.equal(actor.techniques[0].mechanics.balance.policy.snapshot.healing.levelCoefficient, 3);
    }, { includeMana: true });
});

test('initial candidate batch rejects actor or policy changes made after preparation', async () => {
    await withWorld(async ({ actor }) => {
        actor.setLevel(3);
        actor.setSkillValue('Spellcasting', 3);
        actor.setAttribute('intelligence', 18);
        const candidate = definition('technique-stale-batch', {
            revision: 1, target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' },
            recipe: { recipeId: 'standard-healing', skillName: 'Spellcasting', attributeName: 'intelligence', resourceProfileId: 'mana', effectId: 'restore' }
        });
        const prepared = TechniqueService.prepareLearningBatch([{
            actor, operationId: 'stale-technique-batch',
            techniques: [{ candidate, candidateDiscipline: { id: 'discipline-test', name: 'Test Discipline', description: 'Test only.', publicAccess: true }, provenance }]
        }]);
        actor.setSkillValue('Spellcasting', 4);
        assert.throws(() => TechniqueService.commitLearningBatch(prepared), /changed during initial technique preparation/);
        assert.equal(actor.techniques.length, 0);
        assert.equal(TechniqueService.getDefinition(candidate.id), null);

        actor.setSkillValue('Spellcasting', 3);
        const policyPrepared = TechniqueService.prepareLearningBatch([{
            actor, operationId: 'stale-policy-batch',
            techniques: [{ candidate: { ...candidate, id: 'technique-policy-stale-batch' }, candidateDiscipline: { id: 'discipline-test', name: 'Test Discipline', description: 'Test only.', publicAccess: true }, provenance }]
        }]);
        const policy = structuredClone(require('../TechniqueBalancePolicy.js').DEFAULT_POLICY);
        policy.healing.standard.levelCoefficient += 0.25;
        Globals.config.techniques = { ...(Globals.config.techniques || {}), balance: policy };
        assert.throws(() => TechniqueService.commitLearningBatch(policyPrepared), /balance policy changed during initial preparation/);
        assert.equal(actor.techniques.length, 0);
        assert.equal(TechniqueService.getDefinition('technique-policy-stale-batch'), null);
    }, { includeMana: true });
});

test('managed use rejects an actor stat change during asynchronous preparation before charging or healing', async () => {
    await withWorld(async ({ actor }) => {
        actor.setLevel(3);
        actor.setSkillValue('Spellcasting', 3);
        actor.setAttribute('intelligence', 18);
        const definitionId = 'technique-stale-use';
        TechniqueService.addDefinition(definition(definitionId, {
            revision: 1, target: { kind: 'self', allowDead: false }, check: { kind: 'skill', skill: 'Spellcasting', difficulty: 'Easy' },
            recipe: { recipeId: 'standard-healing', skillName: 'Spellcasting', attributeName: 'intelligence', resourceProfileId: 'mana', effectId: 'restore' }
        }), { actor, origin: 'automatic' });
        TechniqueService.learn({ operationId: 'stale-use-learn', actor, techniqueId: definitionId, provenance });
        actor.setHealth(actor.health - 10);
        const initialHealth = actor.health;
        const initialMana = actor.getNeedBarValue('mana');
        await assert.rejects(TechniqueService.execute({
            operationId: 'stale-managed-attempt', turnId: 'stale-managed-turn', actor, techniqueId: definitionId,
            prepareCheck: async () => {
                actor.setAttribute('intelligence', 16);
                return { success: true };
            }
        }), /changed during preparation/);
        assert.equal(actor.health, initialHealth);
        assert.equal(actor.getNeedBarValue('mana'), initialMana);
        assert.equal(TechniqueService.getReceipt('stale-managed-attempt'), null);
    }, { includeMana: true });
});

test('missing or inactive named need costs reject before a roll or mutation', async () => {
    await withWorld(async ({ actor }) => {
        const before = actor.health;
        learn(actor, 'technique-inactive-need', mechanics({
            costs: [{ resource: 'need', needId: 'inactive-resource', direction: 'decrease', amount: 3 }],
            effects: [{ id: 'heal', kind: 'healing', amount: 2 }]
        }));
        let checkCount = 0;
        await assert.rejects(TechniqueService.execute({
            operationId: 'missing-need-cost', turnId: 'need-turn', actor, techniqueId: 'technique-inactive-need',
            prepareCheck: async () => { checkCount += 1; return { success: true }; }
        }), /Need resource inactive-resource is missing or inactive/);
        assert.equal(checkCount, 0);
        assert.equal(actor.health, before);
        assert.equal(TechniqueService.getReceipt('missing-need-cost'), null);
    });
});

test('learned mechanics win by default; differing equipped grants require an explicit pinned source and reject removal before commit', async () => {
    await withWorld(async ({ actor }) => {
        const base = mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 3 }] });
        learn(actor, 'technique-source-pinning', base);
        const secondRevision = { ...mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 6 }] }), revision: 2 };
        TechniqueService.reviseDefinition('technique-source-pinning', secondRevision, { actor, origin: 'editor' });

        const grant = (id, revision) => ({
            id, sourceItemId: `item-${id}`, techniqueId: 'technique-source-pinning', definitionRevision: revision,
            provenance: { kind: 'item', reason: 'Pinned equipment fixture.' }
        });
        const firstItem = new Thing({ id: 'item-grant-one', name: 'First Focus', description: 'First technique grant.', thingType: 'item', slot: 'hands', techniqueGrants: [grant('grant-one', 1)] });
        const secondItem = new Thing({ id: 'item-grant-two', name: 'Second Focus', description: 'Second technique grant.', thingType: 'item', slot: 'hands', techniqueGrants: [grant('grant-two', 2)] });
        actor.addInventoryItem(firstItem);
        actor.addInventoryItem(secondItem);
        assert.equal(actor.equipItemInSlot(firstItem, 'Right hand'), true);
        assert.equal(actor.equipItemInSlot(secondItem, 'Left hand'), true);

        assert.equal(TechniqueService.resolveSource(actor, 'technique-source-pinning').sourceId, 'learned:technique-source-pinning');
        assert.equal(TechniqueService.resolveSource(actor, 'technique-source-pinning', 'grant-one').definitionRevision, 1);
        assert.equal(TechniqueService.resolveSource(actor, 'technique-source-pinning', 'grant-two').definitionRevision, 2);
        const selected = await TechniqueService.prepare({ operationId: 'selected-grant-use', turnId: 'source-turn', actor, techniqueId: 'technique-source-pinning', sourceId: 'grant-two', expectedDefinitionRevision: 2 });
        assert.equal(selected.source.sourceId, 'grant-two');
        assert.equal(actor.unequipItemId(secondItem.id), true);
        const beforeCommitHealth = actor.health;
        assert.throws(() => TechniqueService.commit(selected), /Selected technique source grant-two is no longer available/);
        assert.equal(actor.health, beforeCommitHealth);
        assert.equal(TechniqueService.getReceipt('selected-grant-use'), null);
    }, { gearSlotsYaml: 'gear_slots:\n  hands:\n    - Right hand\n    - Left hand\n' });
});

test('repeated weaker buffs refresh one provenance-linked effect without reducing its strength, then expire', async () => {
    await withWorld(async ({ actor, target1 }) => {
        const buff = amount => mechanics({
            target: 'single',
            effects: [{
                id: 'steady-guard', kind: 'buff', stacking: 'refresh', refreshPolicy: 'stronger',
                status: { name: 'Steady Guard', description: 'A focused defensive stance.', duration: 3, attributes: [{ attribute: 'Strength', modifier: amount }], skills: [], needBars: [] }
            }]
        });
        learn(actor, 'technique-repeated-buff', buff(4));
        learn(target1, 'technique-repeated-buff', buff(4));
        TechniqueService.improve({
            operationId: 'weaker-buff-revision', actor: target1, techniqueId: 'technique-repeated-buff',
            mechanics: { ...buff(1), revision: 2 }, provenance: { kind: 'editor', reason: 'Weaker personal buff fixture.' }, origin: 'editor'
        });

        await TechniqueService.execute({ operationId: 'stronger-buff', turnId: 'buff-turn-1', actor, techniqueId: 'technique-repeated-buff', targetIds: [target1.id] });
        let active = target1.getIntrinsicStatusEffects().filter(effect => effect.techniqueProvenance?.techniqueId === 'technique-repeated-buff');
        assert.equal(active.length, 1);
        assert.equal(active[0].attributes[0].modifier, 4);
        assert.equal(active[0].duration, 3);

        Globals.advanceTime(1);
        await TechniqueService.execute({ operationId: 'weaker-buff-refresh', turnId: 'buff-turn-2', actor: target1, techniqueId: 'technique-repeated-buff', targetIds: [target1.id] });
        active = target1.getIntrinsicStatusEffects().filter(effect => effect.techniqueProvenance?.techniqueId === 'technique-repeated-buff');
        assert.equal(active.length, 1);
        assert.equal(active[0].attributes[0].modifier, 4);
        assert.equal(active[0].duration, 3);

        Globals.advanceTime(3);
        target1.tickStatusEffects(3);
        target1.clearExpiredStatusEffects();
        assert.equal(target1.getIntrinsicStatusEffects().some(effect => effect.techniqueProvenance?.techniqueId === 'technique-repeated-buff'), false);
    });
});

test('operation replay returns the original receipt; a distinct operation deliberately repeats the same action', async () => {
    await withWorld(async ({ actor }) => {
        const effectMechanics = mechanics({ costs: [{ resource: 'health', amount: 2 }], effects: [{ id: 'heal', kind: 'healing', amount: 3 }] });
        learn(actor, 'technique-heal-repeat', effectMechanics);
        actor.setHealth(8);
        const start = actor.health;
        const options = { turnId: 'turn-repeat', actor, techniqueId: 'technique-heal-repeat' };
        const first = await TechniqueService.execute({ ...options, operationId: 'repeat-op-1' });
        const replay = await TechniqueService.execute({ ...options, operationId: 'repeat-op-1' });
        const intentionalRepeat = await TechniqueService.execute({ ...options, operationId: 'repeat-op-2' });
        assert.deepEqual(replay, first);
        assert.equal(first.costOutcome, 'normal');
        assert.equal(intentionalRepeat.costOutcome, 'normal');
        assert.equal(actor.health, Math.min(actor.maxHealth, start - 2 + 3 - 2 + 3));
        assert.equal(first.costs[0].amount, 2);
        assert.equal(intentionalRepeat.costs[0].amount, 2);
        assert.equal(TechniqueService.getReceiptsForTurn('turn-repeat').length, 2);
    });
});

test('committed technique receipt notification failure retries once on replay without repeating mechanics', async () => {
    await withWorld(async ({ actor }) => {
        learn(actor, 'technique-notification-retry', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 3 }] }));
        actor.setHealth(actor.health - 10);
        let calls = 0;
        TechniqueService.setReceiptObserver(() => {
            calls += 1;
            if (calls === 1) throw new Error('Chat history transport failed.');
        });
        try {
            const request = { operationId: 'notification-retry-use', turnId: 'notification-retry-turn', actor, techniqueId: 'technique-notification-retry' };
            const before = actor.health;
            await assert.rejects(TechniqueService.execute(request), error => error.committedOperationId === request.operationId && /notification failed/.test(error.message));
            const committedHealth = actor.health;
            assert.equal(committedHealth, before + 3);
            assert.equal(TechniqueService.getReceipt(request.operationId).operationId, request.operationId);
            assert.deepEqual(await TechniqueService.execute(request), TechniqueService.getReceipt(request.operationId));
            assert.equal(actor.health, committedHealth, 'the replay repairs notification only and does not apply healing again');
            assert.equal(calls, 2);
            assert.equal(TechniqueService.retryReceiptNotification(request.operationId), false, 'a successful notification is not delivered again');
            assert.equal(calls, 2);
        } finally {
            TechniqueService.setReceiptObserver(null);
        }
    });
});

test('action icon identities persist independently and stale targets cannot attach across actor or world replacement', async () => {
    await withWorld(async ({ actor }) => {
        actor.setAbilities([{ id: 'stable-ability-id', name: 'Stable Ability', description: 'A fixture ability.' }]);
        const actors = new Map([[actor.id, actor]]);
        const abilityTarget = resolveActionIconTarget('ability', `${actor.id}:stable-ability-id`, { players: actors });
        abilityTarget.imagePrompt = 'Silver leaf, square icon.';
        abilityTarget.imageId = 'ability-image-1';
        const savedPlayer = actor.toJSON();
        Player.unregister(actor);
        const restoredActor = Player.fromJSON(savedPlayer);
        actors.set(restoredActor.id, restoredActor);
        assert.deepEqual(restoredActor.getAbilityById('stable-ability-id'), {
            id: 'stable-ability-id', name: 'Stable Ability', description: 'A fixture ability.', shortDescription: '', type: 'Passive', level: 1,
            imagePrompt: 'Silver leaf, square icon.', imageId: 'ability-image-1', statusEffects: []
        });
        assert.throws(() => abilityTarget.imageId, /actor .* changed during image generation/);

        learn(restoredActor, 'technique-icon-persistence', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 3 }] }));
        const techniqueTarget = resolveActionIconTarget('technique', 'technique-icon-persistence');
        const disciplineTarget = resolveActionIconTarget('discipline', 'discipline-test');
        const actorMap = new Map([[restoredActor.id, restoredActor]]);
        const mechanicsFingerprint = getTechniqueRuntimeFingerprint({ actors: actorMap, things: new Map() });
        techniqueTarget.imagePrompt = 'Blue star, square icon.';
        techniqueTarget.imageId = 'technique-image-1';
        disciplineTarget.imagePrompt = 'Bronze compass, square icon.';
        disciplineTarget.imageId = 'discipline-image-1';
        const state = TechniqueService.toJSON();
        assert.deepEqual(state.icons['technique-icon-persistence'], { imageId: 'technique-image-1', imagePrompt: 'Blue star, square icon.' });
        assert.deepEqual(state.disciplineIcons['discipline-test'], { imageId: 'discipline-image-1', imagePrompt: 'Bronze compass, square icon.' });
        assert.equal(TechniqueService.toJSON({ includePresentation: false }).icons, undefined);
        assert.equal(TechniqueService.toJSON({ includePresentation: false }).disciplineIcons, undefined);
        assert.equal(getTechniqueRuntimeFingerprint({ actors: actorMap, things: new Map() }), mechanicsFingerprint);
        TechniqueService.hydrate(state);
        assert.deepEqual(TechniqueService.getIcon('technique-icon-persistence'), { imageId: 'technique-image-1', imagePrompt: 'Blue star, square icon.' });
        assert.deepEqual(TechniqueService.getDisciplineIcon('discipline-test'), { imageId: 'discipline-image-1', imagePrompt: 'Bronze compass, square icon.' });
        assert.throws(() => techniqueTarget.imageId, /runtime was reset or loaded/);
        assert.throws(() => disciplineTarget.imageId, /runtime was reset or loaded/);
    });
});

test('a synchronous effect failure rolls back resource debit and earlier effects without issuing a receipt', async () => {
    await withWorld(async ({ actor, target1 }) => {
        actor.setHealth(actor.maxHealth);
        target1.setHealth(target1.maxHealth - 8);
        const beforeActorHealth = actor.health;
        const beforeTargetHealth = target1.health;
        learn(actor, 'technique-rollback', mechanics({
            target: 'single',
            costs: [{ resource: 'health', amount: 2 }],
            effects: [{ id: 'first-heal', kind: 'healing', amount: 1 }, { id: 'second-heal', kind: 'healing', amount: 1 }]
        }));
        const modifyHealth = target1.modifyHealth.bind(target1);
        let calls = 0;
        target1.modifyHealth = (...args) => {
            calls += 1;
            if (calls === 2) throw new Error('Injected second-effect failure.');
            return modifyHealth(...args);
        };

        await assert.rejects(TechniqueService.execute({
            operationId: 'rollback-attempt', turnId: 'rollback-turn', actor, techniqueId: 'technique-rollback', targetIds: [target1.id]
        }), /Injected second-effect failure/);
        assert.equal(actor.health, beforeActorHealth);
        assert.equal(target1.health, beforeTargetHealth);
        assert.equal(TechniqueService.getReceipt('rollback-attempt'), null);
    });
});

test('personal improvements are isolated by owner and retain the previous pinned mechanics', async () => {
    await withWorld(({ actor, target1 }) => {
        const base = mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 3 }] });
        learn(actor, 'technique-personal-revision', base);
        learn(target1, 'technique-personal-revision', base);
        TechniqueService.improve({
            operationId: 'owner-one-edit', actor, techniqueId: 'technique-personal-revision',
            mechanics: { ...mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 8 }] }), revision: 2 },
            provenance: { kind: 'editor', reason: 'Test personal mechanics editor.' }, origin: 'editor'
        });
        assert.equal(actor.techniques[0].personalRevision, 2);
        assert.equal(actor.techniques[0].mechanics.effects[0].amount, 8);
        assert.equal(actor.techniques[0].revisionHistory[0].effects[0].amount, 3);
        assert.equal(target1.techniques[0].personalRevision, 1);
        assert.equal(target1.techniques[0].mechanics.effects[0].amount, 3);
    });
});

test('mechanics fingerprints change for owned upgrades and gear access, but ignore use receipts', async () => {
    await withWorld(async ({ actor }) => {
        learn(actor, 'technique-fingerprint', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 3 }] }));
        actor.setHealth(actor.health - 2);
        const actors = new Map([[actor.id, actor]]);
        const things = new Map();
        const learned = getTechniqueRuntimeFingerprint({ actors, things });

        await TechniqueService.execute({ operationId: 'fingerprint-use', turnId: 'fingerprint-turn', actor, techniqueId: 'technique-fingerprint' });
        assert.equal(getTechniqueRuntimeFingerprint({ actors, things }), learned, 'execution receipts and health changes do not change the mechanics fingerprint');

        const revision = { ...mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 5 }] }), revision: 2 };
        TechniqueService.improve({ operationId: 'fingerprint-edit', actor, techniqueId: 'technique-fingerprint', mechanics: revision, provenance: { kind: 'editor', reason: 'Fingerprint fixture edit.' }, origin: 'editor' });
        const upgraded = getTechniqueRuntimeFingerprint({ actors, things });
        assert.notEqual(upgraded, learned);

        things.set('thing-fingerprint', { id: 'thing-fingerprint', techniqueGrants: [{ id: 'grant-fingerprint', sourceItemId: 'thing-fingerprint', techniqueId: 'technique-fingerprint', definitionRevision: 1 }], equippedBy: actor, equippedSlot: 'hand' });
        assert.notEqual(getTechniqueRuntimeFingerprint({ actors, things }), upgraded);
    });
});

test('historical NPC use receipts hydrate after the NPC has been removed from the world', async () => {
    await withWorld(async ({ actor, target1 }) => {
        learn(target1, 'technique-historical-receipt', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 1 }] }));
        const receipt = await TechniqueService.execute({ operationId: 'removed-npc-use', turnId: 'npc-turn-1', actor: target1, techniqueId: 'technique-historical-receipt' });
        assert.equal(receipt.actorId, target1.id);
        const savedTechniqueState = TechniqueService.toJSON();

        Player.unregister(target1);
        assert.equal(Player.getById(target1.id), null);
        assert.equal(TechniqueService.validateState(savedTechniqueState, { actors: [actor], things: [] }), true);
        TechniqueService.hydrate(savedTechniqueState);
        assert.deepEqual(TechniqueService.getReceipt('removed-npc-use'), receipt);
        assert.equal(TechniqueService.getReceiptsForTurn('npc-turn-1').length, 1);
    });
});

test('legacy saves hydrate empty technique state and malformed nested receipts are rejected', async () => {
    await withWorld(async ({ actor }) => {
        assert.equal(TechniqueService.validateState(undefined, { actors: [actor], things: [] }), true);
        TechniqueService.hydrate(undefined);
        assert.deepEqual(TechniqueService.toJSON(), { version: 1, disciplines: [], definitions: [], receipts: [], icons: {}, disciplineIcons: {} });
        const legacyPlayer = actor.toJSON();
        delete legacyPlayer.techniques;
        delete legacyPlayer.disciplineAccess;
        Player.unregister(actor);
        const restored = Player.fromJSON(legacyPlayer);
        assert.deepEqual(restored.techniques, []);
        assert.deepEqual(restored.disciplineAccess, []);

        TechniqueService.addDiscipline({ id: 'discipline-test', name: 'Test Discipline', description: 'Test only.', publicAccess: true });
        learn(restored, 'technique-malformed-receipt', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 1 }] }));
        const receipt = await TechniqueService.execute({ operationId: 'valid-for-corruption', turnId: 'receipt-validation', actor: restored, techniqueId: 'technique-malformed-receipt' });
        const saved = TechniqueService.toJSON();
        const malformed = JSON.parse(JSON.stringify(saved));
        malformed.receipts.find(entry => entry.operationId === receipt.operationId).effects[0].effectId = '';
        assert.throws(() => TechniqueService.validateState(malformed, { actors: [restored], things: [] }), /receipt.effect.effectId/);
    });
});

test('game save files round-trip learned mechanics, buff provenance, pinned item grants, and committed receipts', async () => {
    await withWorld(async ({ actor, location, region }) => {
        const previousSceneSummaries = Globals.sceneSummaries;
        const saveRoot = path.join(process.cwd(), 'tmp');
        fs.mkdirSync(saveRoot, { recursive: true });
        const saveDir = fs.mkdtempSync(path.join(saveRoot, 'technique-save-roundtrip-'));
        const legacyDir = fs.mkdtempSync(path.join(saveRoot, 'technique-save-legacy-'));
        Globals.sceneSummaries = { serialize: () => ({}), load: () => {}, clear() {} };

        const roundTripMechanics = mechanics({
            costs: [{ resource: 'health', amount: 4 }],
            effects: [{ id: 'ward', kind: 'buff', status: { name: 'Roundtrip Ward', description: 'A persisted defensive ward.', duration: 6, attributes: [{ attribute: 'Strength', modifier: 2 }], skills: [], needBars: [] } }]
        });
        try {
            TechniqueService.addDefinition(definition('technique-save-roundtrip', roundTripMechanics), { actor, origin: 'editor' });
            learn(actor, 'technique-save-roundtrip', roundTripMechanics);
            const personalRevision = { ...roundTripMechanics, revision: 2, effects: [{ ...roundTripMechanics.effects[0], status: { ...roundTripMechanics.effects[0].status, attributes: [{ attribute: 'Strength', modifier: 3 }] } }] };
            TechniqueService.improve({
                operationId: 'roundtrip-personal-improvement', actor, techniqueId: 'technique-save-roundtrip', mechanics: personalRevision,
                provenance: { kind: 'editor', reason: 'Persist the owner revision.' }, origin: 'editor'
            });
            const item = new Thing({
                id: 'technique-save-item', name: 'Ward Lens', description: 'Pins a catalogue revision.', thingType: 'item', slot: 'hands',
                techniqueGrants: [{ id: 'grant-save-roundtrip', sourceItemId: 'technique-save-item', techniqueId: 'technique-save-roundtrip', definitionRevision: 1, teaches: false, provenance: { kind: 'item', reason: 'The lens preserves the original ward.' } }]
            });
            actor.addInventoryItem(item);
            assert.equal(actor.equipItemInSlot(item, 'Right hand'), true);

            const initialHealth = actor.health;
            const receipt = await TechniqueService.execute({
                operationId: 'roundtrip-committed-use', turnId: 'save-roundtrip-turn', actor,
                techniqueId: 'technique-save-roundtrip', targetIds: [actor.id], expectedDefinitionRevision: 1, expectedPersonalRevision: 2
            });
            const healthAfterUse = actor.health;
            assert.equal(receipt.costs[0].delta, -4);
            assert.equal(receipt.costs[0].newValue, initialHealth - 4);
            assert.equal(receipt.source.personalRevision, 2);
            const wardBeforeSave = JSON.parse(JSON.stringify(actor.getIntrinsicStatusEffects().find(effect => effect.name === 'Roundtrip Ward')));
            assert.equal(wardBeforeSave.techniqueProvenance.personalRevision, 2);
            assert.equal(wardBeforeSave.techniqueProvenance.operationId, receipt.operationId);

            const serializationContext = {
                currentPlayer: actor,
                gameLocations: new Map([[location.id, location]]), gameLocationExits: new Map(), regions: new Map([[region.id, region]]),
                chatHistory: [], generatedImages: new Map(), things: new Map([[item.id, item]]), players: new Map([[actor.id, actor]]),
                skills: new Map(), factions: new Map(), pendingRegionStubs: new Map()
            };
            const serializedState = Utils.serializeGameState(serializationContext);
            serializedState.metadata.saveFileSaveVersion = Number(Globals.currentSaveVersion);
            await Utils.writeSerializedGameState(saveDir, serializedState);

            const hydrationContext = () => ({
                gameLocations: new Map(), gameLocationExits: new Map(), regions: new Map(), chatHistoryRef: [], generatedImages: new Map(),
                things: new Map(), players: new Map(), skills: new Map(), factions: new Map(), jobQueue: [], imageJobs: new Map(),
                pendingLocationImages: new Map(), npcGenerationPromises: new Map(), pendingRegionStubs: new Map()
            });
            const savedReceipt = JSON.parse(JSON.stringify(receipt));
            const loaded = Utils.loadSerializedGameState(saveDir);
            Utils.hydrateGameState(loaded, hydrationContext());

            const restoredActor = Player.getById(actor.id);
            const restoredItem = Thing.getById(item.id);
            assert.ok(restoredActor);
            assert.ok(restoredItem);
            Globals.currentPlayer = restoredActor;
            assert.equal(restoredActor.health, healthAfterUse);
            assert.equal(restoredActor.techniques.find(entry => entry.techniqueId === 'technique-save-roundtrip').personalRevision, 2);
            assert.deepEqual(restoredItem.techniqueGrants, item.techniqueGrants);
            assert.equal(restoredActor.getGear()['Right hand'].itemId, item.id);
            const wardAfterLoad = JSON.parse(JSON.stringify(restoredActor.getIntrinsicStatusEffects().find(effect => effect.name === 'Roundtrip Ward')));
            assert.deepEqual(wardAfterLoad, wardBeforeSave);
            assert.deepEqual(TechniqueService.getReceipt('roundtrip-committed-use'), savedReceipt);
            assert.deepEqual(TechniqueService.getReceipt('roundtrip-committed-use').costs[0], receipt.costs[0]);

            const replay = await TechniqueService.execute({
                operationId: 'roundtrip-committed-use', turnId: 'save-roundtrip-turn', actor: restoredActor,
                techniqueId: 'technique-save-roundtrip', targetIds: [restoredActor.id], expectedDefinitionRevision: 1, expectedPersonalRevision: 2
            });
            assert.deepEqual(replay, savedReceipt);
            assert.equal(restoredActor.health, healthAfterUse, 'replaying after load must not charge health again');
            assert.equal(restoredActor.getIntrinsicStatusEffects().filter(effect => effect.name === 'Roundtrip Ward').length, 1);

            const malformed = Utils.loadSerializedGameState(saveDir);
            malformed.techniques = { version: 1, disciplines: [], definitions: [], receipts: [], unreviewed: true };
            assert.throws(() => Utils.hydrateGameState(malformed, hydrationContext()), /unreviewed is unsupported/);
            assert.deepEqual(TechniqueService.getReceipt('roundtrip-committed-use'), savedReceipt, 'invalid technique state must fail before replacing the live catalogue');
            fs.writeFileSync(path.join(saveDir, 'techniques.json'), '{ invalid JSON');
            assert.throws(() => Utils.loadSerializedGameState(saveDir), SyntaxError, 'a malformed present techniques.json must not be treated as an absent legacy file');

            const emptyLegacyContext = {
                currentPlayer: null,
                gameLocations: new Map(), gameLocationExits: new Map(), regions: new Map(), chatHistory: [], generatedImages: new Map(),
                things: new Map(), players: new Map(), skills: new Map(), factions: new Map(), pendingRegionStubs: new Map()
            };
            const emptyLegacySave = Utils.serializeGameState(emptyLegacyContext);
            emptyLegacySave.metadata.saveFileSaveVersion = Number(Globals.currentSaveVersion);
            await Utils.writeSerializedGameState(legacyDir, emptyLegacySave);
            fs.unlinkSync(path.join(legacyDir, 'techniques.json'));
            const legacyLoaded = Utils.loadSerializedGameState(legacyDir);
            assert.equal(legacyLoaded.techniques, undefined);
            Utils.hydrateGameState(legacyLoaded, hydrationContext());
            assert.deepEqual(TechniqueService.toJSON(), { version: 1, disciplines: [], definitions: [], receipts: [], icons: {}, disciplineIcons: {} });
        } finally {
            Globals.sceneSummaries = previousSceneSummaries;
            fs.rmSync(saveDir, { recursive: true, force: true });
            fs.rmSync(legacyDir, { recursive: true, force: true });
        }
    }, { gearSlotsYaml: 'gear_slots:\n  hands:\n    - Right hand\n    - Left hand\n' });
});

test('isolated technique API routes create, preview, learn, and edit real persisted actor mechanics', async () => {
    await withWorld(async ({ actor, target1 }) => {
        const actors = new Map([[actor.id, actor], [target1.id, target1]]);
        const app = express();
        app.use(express.json());
        registerTechniqueApiRoutes(app, {
            getCurrentPlayer: () => actor,
            getActors: () => actors,
            effectiveTechniqueLocation: character => character.location?.id ?? null
        });
        const server = app.listen(0, '0.0.0.0');
        await new Promise(resolve => server.once('listening', resolve));
        try {
            const base = `http://0.0.0.0:${server.address().port}`;
            const request = async (route, method = 'GET', body) => {
                const response = await fetch(`${base}${route}`, {
                    method,
                    headers: body ? { 'Content-Type': 'application/json' } : {},
                    ...(body ? { body: JSON.stringify(body) } : {})
                });
                return { status: response.status, body: await response.json() };
            };

            const initial = await request(`/api/techniques?actor=${actor.id}&catalog=true`);
            assert.equal(initial.status, 200);
            assert.equal(initial.body.actorId, actor.id);
            assert.equal(initial.body.canUse, true);
            assert.ok(initial.body.targets.some(entry => entry.id === target1.id));

            const discipline = await request('/api/techniques/disciplines', 'POST', {
                id: 'discipline-api-test', name: 'API Test', description: 'Isolated API discipline.', publicAccess: true,
                provenance: { kind: 'editor', reason: 'Route test fixture.' }
            });
            assert.equal(discipline.status, 200);
            const created = await request('/api/techniques/catalog', 'POST', {
                id: 'technique-api-test', disciplineId: 'discipline-api-test', name: 'API Mend', description: 'A test heal.',
                semanticKey: 'api-mend', aliases: [], provenance: { kind: 'editor', reason: 'Route test fixture.' },
                revisions: [mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: { formula: 'level * 2', bindings: { level: { kind: 'level' } } } }] })]
            });
            assert.equal(created.status, 200);
            assert.equal(created.body.definition.id, 'technique-api-test');

            const preview = await request('/api/techniques/preview', 'POST', { actorId: actor.id, mechanics: created.body.definition.revisions[0] });
            assert.equal(preview.status, 200);
            assert.equal(preview.body.mechanics.effects[0].amount, actor.level * 2);

            const learned = await request('/api/techniques/technique-api-test/learn', 'POST', {
                actorId: actor.id, operationId: 'api-learn-test', definitionRevision: 1,
                provenance: { kind: 'editor', reason: 'Route test learning.' }
            });
            assert.equal(learned.status, 200);
            assert.equal(learned.body.receipt.kind, 'learn');
            assert.equal(actor.techniques[0].techniqueId, 'technique-api-test');

            const improved = await request('/api/techniques/technique-api-test/personal', 'PUT', {
                actorId: actor.id, operationId: 'api-edit-test',
                mechanics: { ...mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 9 }] }), revision: 2 },
                provenance: { kind: 'editor', reason: 'Route test personal edit.' }
            });
            assert.equal(improved.status, 200);
            assert.equal(improved.body.receipt.kind, 'improve');
            assert.equal(actor.techniques[0].mechanics.effects[0].amount, 9);

            const invalid = await request('/api/techniques/catalog', 'POST', {
                id: 'technique-api-invalid', disciplineId: 'discipline-api-test', name: 'Invalid', description: 'Invalid formula.', semanticKey: 'invalid',
                provenance: { kind: 'editor', reason: 'Invalid fixture.' },
                revisions: [mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: { formula: 'missing + 1', bindings: {} } }] })]
            });
            assert.equal(invalid.status, 400);
            assert.match(invalid.body.error, /unknown formula variable missing/);
            assert.match(invalid.body.stack, /Error/);
            assert.equal(TechniqueService.getDefinition('technique-api-invalid'), null);
        } finally {
            if (server.listening) {
                server.closeAllConnections();
                await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            }
        }
    });
});

test('generated NPC technique XML accepts only known canonical IDs and initializes owners independently', async () => {
    await withWorld(({ actor, target1, target2 }) => {
        const authored = mechanics({ effects: [{ id: 'guard', kind: 'buff', stacking: 'refresh', refreshPolicy: 'stronger', status: { name: 'Guard', description: 'A defensive stance.', duration: 4, attributes: [{ attribute: 'Strength', modifier: 2 }], skills: [], needBars: [] } }] });
        TechniqueService.addDefinition(definition('technique-npc-common', authored), { origin: 'editor' });
        TechniqueService.addDefinition({ ...definition('technique-npc-unique', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 1 }] })), unique: true }, { origin: 'editor' });

        const parsed = xml => {
            const document = Utils.parseXmlDocumentStrict(xml, 'text/xml');
            return parseGeneratedNpcTechniques(document.documentElement);
        };
        assert.deepEqual(parsed('<npc><startingTechniques><techniqueId>technique-npc-common</techniqueId></startingTechniques></npc>'), ['technique-npc-common']);
        assert.deepEqual(parsed('<npc/>'), []);
        assert.throws(() => parsed('<npc><startingTechniques attr="no"><techniqueId>technique-npc-common</techniqueId></startingTechniques></npc>'), /only <techniqueId> children/);
        assert.throws(() => parsed('<npc><startingTechniques><techniqueId>missing-technique</techniqueId></startingTechniques></npc>'), /not in the current world catalogue/);
        const quantityXml = Utils.parseXmlDocumentStrict('<npc><startingTechniques><techniqueId>technique-npc-unique</techniqueId></startingTechniques></npc>', 'text/xml');
        assert.throws(() => parseGeneratedNpcTechniques(quantityXml.documentElement, { quantity: 2 }), /cannot share unique/);
        assert.throws(() => parsed('<npc><startingTechniques><techniqueId>technique-npc-common</techniqueId><techniqueId>technique-npc-common</techniqueId></startingTechniques></npc>'), /distinct/);

        applyGeneratedNpcTechniques(target1, ['technique-npc-common']);
        applyGeneratedNpcTechniques(target2, ['technique-npc-common']);
        assert.equal(target1.techniques[0].techniqueId, 'technique-npc-common');
        assert.equal(target2.techniques[0].techniqueId, 'technique-npc-common');
        assert.notEqual(target1.techniques, target2.techniques);
        TechniqueService.improve({
            operationId: 'generated-npc-personal-edit', actor: target1, techniqueId: 'technique-npc-common',
            mechanics: { ...authored, revision: 2, effects: [{ ...authored.effects[0], status: { ...authored.effects[0].status, attributes: [{ attribute: 'Strength', modifier: 6 }] } }] },
            provenance: { kind: 'editor', reason: 'Generated actor isolation fixture.' }, origin: 'editor'
        });
        assert.equal(target1.techniques[0].mechanics.effects[0].status.attributes[0].modifier, 6);
        assert.equal(target2.techniques[0].mechanics.effects[0].status.attributes[0].modifier, 2);
    });
});

test('TinyBrain technique intent parser enforces child-only fields and canonical targets', () => {
    const parsed = TechniquePrompt.parseTechniqueIntent('<techniqueIntent><kind>use</kind><actor>Test Actor</actor><intent>Heal Target One.</intent><techniqueId>technique-canonical</techniqueId><targets><targetId>target-1</targetId></targets></techniqueIntent>');
    assert.deepEqual(parsed, { actor: 'Test Actor', intent: 'Heal Target One.', techniqueId: 'technique-canonical', targetIds: ['target-1'] });
    assert.equal(TechniquePrompt.parseTechniqueIntent('<techniqueIntent><kind>none</kind></techniqueIntent>'), null);
    assert.throws(() => TechniquePrompt.parseTechniqueIntent('<techniqueIntent mode="use"><kind>use</kind><actor>Test Actor</actor><intent>Heal.</intent><techniqueId>technique-canonical</techniqueId><targets><targetId>target-1</targetId></targets></techniqueIntent>'), /attributes/);
    assert.throws(() => TechniquePrompt.parseTechniqueIntent('<techniqueIntent><kind>use</kind><actor>Test Actor</actor><intent>Heal.</intent><techniqueId>technique-canonical</techniqueId><targets><targetId>target-1</targetId><targetId>target-1</targetId></targets></techniqueIntent>'), /distinct actor IDs/);
    assert.throws(() => TechniquePrompt.parseTechniqueIntent('<techniqueIntent><kind>use</kind><actor>Test Actor</actor><intent>Heal.</intent><techniqueId>technique-canonical</techniqueId><targets><targetId>target-1</targetId></targets><ignored>value</ignored></techniqueIntent>'), /unsupported <ignored>/);
});

test('event suppression accepts only the exact committed mutation reference and leaves unrelated effects actionable', async () => {
    await withWorld(async ({ actor }) => {
        learn(actor, 'technique-receipt-event', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] }));
        actor.setHealth(actor.health - 5);
        const receipt = await TechniqueService.execute({ operationId: 'event-reference-use', turnId: 'event-turn', actor, techniqueId: 'technique-receipt-event' });
        const xml = `<events><healRecover><characterName>${actor.name}</characterName><techniqueReceipt><operationId>${receipt.operationId}</operationId><mutationId>${receipt.effects[0].mutationId}</mutationId></techniqueReceipt></healRecover></events>`;
        const parsed = Utils.parseXmlDocumentStrict(xml, 'text/xml');
        const linked = parsed.documentElement.firstChild;
        assert.equal(TechniqueEvents.suppressReferencedMutation(linked, 'healRecover'), true);

        const unrelatedXml = `<events><healRecover><characterName>${actor.name}</characterName><amount>2</amount></healRecover></events>`;
        const unrelated = Utils.parseXmlDocumentStrict(unrelatedXml, 'text/xml').documentElement.firstChild;
        assert.equal(TechniqueEvents.suppressReferencedMutation(unrelated, 'healRecover'), false);

        const wrongReferenceXml = `<events><healRecover><characterName>${actor.name}</characterName><techniqueReceipt><operationId>${receipt.operationId}</operationId><mutationId>other-action</mutationId></techniqueReceipt></healRecover></events>`;
        const wrongReference = Utils.parseXmlDocumentStrict(wrongReferenceXml, 'text/xml').documentElement.firstChild;
        assert.throws(() => TechniqueEvents.suppressReferencedMutation(wrongReference, 'healRecover'), /does not belong to receipt/);
    });
});

test('Thing create commit binds grants to the new item and copies get fresh pinned grant identities', async () => {
    await withWorld(() => {
        TechniqueService.addDefinition(definition('technique-item-grant', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 2 }] })), { origin: 'editor' });
        const mutations = new ThingMutationService({ ThingClass: Thing, getModExtensionRegistry: () => null });
        const prepared = mutations.prepareCreate({
            name: 'Granting Focus', description: 'Temporarily grants access to a technique.', thingType: 'item',
            techniqueGrants: [{ id: 'grant-pending', techniqueId: 'technique-item-grant', definitionRevision: 1, teaches: false, provenance: { kind: 'item', reason: 'Pinned item grant fixture.' } }]
        });
        assert.equal(prepared.candidate.id, null);
        assert.equal(prepared.candidate.techniqueGrants[0].sourceItemId, null);

        const runtimeThings = new Map();
        const { thing, receipt } = mutations.commitCreate(prepared, { runtimeRegistry: runtimeThings });
        assert.equal(receipt.operation, 'create');
        assert.equal(thing.techniqueGrants[0].sourceItemId, thing.id);
        assert.equal(runtimeThings.get(thing.id), thing);
        const hydrated = Thing.fromJSON(JSON.parse(JSON.stringify(thing.toJSON())), { register: false });
        assert.deepEqual(hydrated.techniqueGrants, thing.techniqueGrants);

        const copy = thing.copy({ name: 'Copied Granting Focus' });
        assert.notEqual(copy.id, thing.id);
        assert.notEqual(copy.techniqueGrants[0].id, thing.techniqueGrants[0].id);
        assert.equal(copy.techniqueGrants[0].sourceItemId, copy.id);
        assert.equal(copy.techniqueGrants[0].techniqueId, thing.techniqueGrants[0].techniqueId);
        assert.equal(copy.techniqueGrants[0].definitionRevision, thing.techniqueGrants[0].definitionRevision);
        assert.throws(() => thing.techniqueGrants = [{ ...copy.techniqueGrants[0], sourceItemId: thing.id }], /already belongs to another item/);
        assert.equal(thing.techniqueGrants[0].id, 'grant-pending');
    });
});

test('initial learning stages access atomically, restores it on write failure, and rejects stale access', async () => {
    await withWorld(({ actor }) => {
        const candidate = definition('atomic-access-technique', mechanics({ effects: [{ id: 'heal', kind: 'healing', amount: 1 }] }));
        const group = { actor, operationId: 'atomic-access-init', techniques: [{ candidate, provenance }] };
        const before = TechniqueService.toJSON();
        const prepared = TechniqueService.prepareLearningBatch([group], { origin: 'editor' });
        assert.deepEqual(actor.disciplineAccess, []);
        assert.equal(actor.techniques.length, 0);
        const original = actor.setTechniques;
        let first = true;
        actor.setTechniques = function (value) {
            if (first) { first = false; throw new Error('injected actor write failure'); }
            return original.call(this, value);
        };
        try { assert.throws(() => TechniqueService.commitLearningBatch(prepared), /injected actor write failure/); }
        finally { actor.setTechniques = original; }
        assert.deepEqual(actor.disciplineAccess, []);
        assert.equal(actor.techniques.length, 0);
        assert.deepEqual(TechniqueService.toJSON(), before);
        const stale = TechniqueService.prepareLearningBatch([group], { origin: 'editor' });
        TechniqueService.grantDiscipline({ actor, operationId: 'intervening-access', disciplineId: 'discipline-test', provenance });
        assert.throws(() => TechniqueService.commitLearningBatch(stale), /changed during initial technique preparation/);
        assert.equal(actor.techniques.length, 0);
        assert.equal(TechniqueService.getDefinition(candidate.id), null);
        assert.equal(TechniqueService.getReceipt(group.operationId), null);
    });
});

test('domain ID migration rewrites live technique receipts and learned sources while preserving operation identity', async () => {
    await withWorld(async ({ actor, location, region }) => {
        const DomainIdMigration = require('../DomainIdMigration.js');
        const previousSceneSummaries = Globals.sceneSummaries;
        Globals.sceneSummaries = { serialize: () => ({}), load() {}, clear() {} };
        try {
            const id = 'technique-old-ward';
            const ward = mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Guard', description: 'Protection.', duration: 2, attributes: [{ attribute: 'Strength', modifier: 1 }] } }] });
            TechniqueService.addDefinition(definition(id, ward), { actor, origin: 'editor' });
            learn(actor, id, ward);
            const receipt = await TechniqueService.execute({ operationId: 'operation-stable', turnId: 'turn-stable', actor, techniqueId: id, targetIds: [actor.id] });
            const snapshot = Utils.serializeGameState({ currentPlayer: actor, gameLocations: new Map([[location.id, location]]), gameLocationExits: new Map(), regions: new Map([[region.id, region]]), chatHistory: [], generatedImages: new Map(), things: new Map(), players: new Map([[actor.id, actor]]), skills: new Map(), factions: new Map(), pendingRegionStubs: new Map() });
            snapshot.metadata.saveFileSaveVersion = 1.2;
            const { serialized, replacements } = DomainIdMigration.prepare(snapshot);
            const changed = serialized.techniques.receipts.find(item => item.operationId === receipt.operationId);
            assert.ok(changed);
            assert.equal(changed.operationId, 'operation-stable');
            assert.equal(changed.techniqueId, replacements[id]);
            assert.equal(changed.actorId, replacements[actor.id]);
            assert.ok(changed.effects[0].mutationId.includes(replacements[actor.id]));
            assert.equal(changed.source.sourceId, `learned:${replacements[id]}`);
            assert.equal(TechniqueService.validateState(serialized.techniques, { actors: Object.values(serialized.players), things: [] }), true);
            const { createHydrationContext } = require('./helpers/locationFixtures.js');
            const context = createHydrationContext();
            Utils.hydrateGameState(serialized, { ...context, preserveRuntimeSnapshot: true });
            assert.equal(TechniqueService.getReceipt('operation-stable').effects[0].mutationId, changed.effects[0].mutationId);
            assert.equal(context.players.get(replacements[actor.id]).techniques[0].techniqueId, replacements[id]);
        } finally { Globals.sceneSummaries = previousSceneSummaries; }
    });
});

test('domain migration rewrites equipped status and grant source identities in receipts', async () => {
    await withWorld(async ({ actor, location, region }) => {
        const DomainIdMigration = require('../DomainIdMigration.js');
        const previousSceneSummaries = Globals.sceneSummaries;
        Globals.sceneSummaries = { serialize: () => ({}), load() {}, clear() {} };
        try {
            const id = 'technique-old-guard';
            const ward = mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Guard', description: 'Protection.', duration: 2, attributes: [{ attribute: 'Strength', modifier: 1 }] } }] });
            TechniqueService.addDefinition(definition(id, ward), { actor, origin: 'editor' });
            const item = new Thing({ id: 'thing_old_lens', name: 'Ward Lens', description: 'A lens.', thingType: 'item', slot: 'hands', causeStatusEffect: { applyToEquipper: true, id: 'status_old_aura', name: 'Lens Aura', description: 'A protective aura.', duration: -1, techniqueGrants: [{ id: 'tgrant_old_guard', techniqueId: id, definitionRevision: 1, provenance: { kind: 'item', reason: 'Lens grant.' } }] } });
            actor.addInventoryItem(item);
            assert.equal(actor.equipItemInSlot(item, 'Right hand'), true);
            const status = actor.getStatusEffects().find(effect => effect.id.startsWith('equipped_status:'));
            const sourceId = `status:${actor.id}:${status.techniqueGrants[0].id}`;
            await TechniqueService.execute({ operationId: 'equipped-operation', turnId: 'turn-1', actor, techniqueId: id, sourceId, targetIds: [actor.id] });
            const snapshot = Utils.serializeGameState({ currentPlayer: actor, gameLocations: new Map([[location.id, location]]), gameLocationExits: new Map(), regions: new Map([[region.id, region]]), chatHistory: [], generatedImages: new Map(), things: new Map([[item.id, item]]), players: new Map([[actor.id, actor]]), skills: new Map(), factions: new Map(), pendingRegionStubs: new Map() });
            snapshot.metadata.saveFileSaveVersion = 1.2;
            const { serialized, replacements } = DomainIdMigration.prepare(snapshot);
            const receipt = serialized.techniques.receipts.find(entry => entry.operationId === 'equipped-operation');
            assert.equal(receipt.source.sourceId, `status:${replacements[actor.id]}:equipped_grant:${replacements[item.id]}:${replacements.tgrant_old_guard}`);
            assert.equal(receipt.source.statusId, `equipped_status:${replacements[item.id]}:${replacements.status_old_aura}`);
        } finally { Globals.sceneSummaries = previousSceneSummaries; }
    }, { gearSlotsYaml: 'gear_slots:\n  hands:\n    - Right hand\n    - Left hand\n' });
});
