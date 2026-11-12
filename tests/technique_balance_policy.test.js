'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Balance = require('../TechniqueBalancePolicy.js');
const Variables = require('../public/js/technique-formula-variables.js');
const Evaluator = require('../public/js/formula-evaluator.js');
const { parseAutomaticTechniqueCandidate } = require('../TechniquePrompt.js');

function actor({ level = 3, skill = 3, attribute = 4, skills = { Spellcasting: skill, 'Field Craft': 6 }, mana = true, capacity = 1000, paymentDirection = 'decrease' } = {}) {
    const attributes = { Intelligence: attribute, Strength: 2 };
    return {
        id: 'balance-fixture', name: 'Balance Fixture', level,
        getSkills: () => new Map(Object.entries(skills)),
        getSkillValue: name => skills[name],
        getAttributeNames: () => Object.keys(attributes),
        getAttributeModifier: name => attributes[name],
        getNeedBars: () => mana ? [{ id: 'mana', min: 0, max: capacity, value: capacity, paymentDirection }] : []
    };
}

function proposal(overrides = {}) {
    return { recipeId: 'standard-healing', skillName: 'Spellcasting', attributeName: 'Intelligence', resourceProfileId: 'mana', ...overrides };
}

function amount(spec, target) {
    return Evaluator.compile(spec.formula)(Variables.resolve(spec.formula, target));
}

test('standard healing recipe matches accepted level-three calibration and keeps the full potency above 30', () => {
    const target = actor();
    const policy = Balance.resolvePolicy({});
    for (const [skill, expectedHealing, expectedMana] of [[3, 24, 83], [5, 26, 77], [7, 28, 71], [10, 31, 65]]) {
        target.getSkillValue = name => name === 'Spellcasting' ? skill : 6;
        const revision = Balance.compileHealingRecipe({ proposal: proposal(), actor: target, policy, revision: { revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' } } });
        assert.equal(amount(revision.effects[0].amount, target), expectedHealing, `healing at skill ${skill}`);
        assert.equal(amount(revision.costs[0].amount, target), expectedMana, `mana at skill ${skill}`);
    }
});

test('healing reads the selected actual skill, attribute modifier and current actor facts at use time', () => {
    const target = actor({ skills: { 'Field Craft': 3 }, attribute: 4 });
    const policy = Balance.resolvePolicy({});
    const revision = Balance.compileHealingRecipe({
        proposal: proposal({ skillName: 'Field Craft' }), actor: target, policy,
        revision: { revision: 1, target: { kind: 'single' }, check: { kind: 'automatic' } }
    });
    assert.match(revision.effects[0].amount.formula, /skill_field_craft/);
    assert.match(revision.effects[0].amount.formula, /attribute_intelligence_modifier/);
    assert.equal(amount(revision.effects[0].amount, target), 24);

    target.level = 5;
    target.getSkillValue = name => name === 'Field Craft' ? 8 : undefined;
    assert.equal(amount(revision.effects[0].amount, target), 35);
    assert.equal(amount(revision.costs[0].amount, target), 67);
});

test('cost does not increase across level and proficiency increases, including ceiling plateaus', () => {
    const policy = Balance.resolvePolicy({});
    for (const level of [1, 3, 7, 20, 100]) {
        let previous = Infinity;
        for (let skill = 0; skill <= 100; skill++) {
            const target = actor({ level, skill });
            const revision = Balance.compileHealingRecipe({ proposal: proposal(), actor: target, policy, revision: { revision: 1, target: { kind: 'self' } } });
            const current = amount(revision.costs[0].amount, target);
            assert.ok(current <= previous, `skill cost increased at level ${level}, skill ${skill}`);
            previous = current;
        }
    }
});

test('configured efficiency reduces mana cost while power preserves cost and changes only potency', () => {
    const target = actor();
    const policy = Balance.resolvePolicy({});
    const learned = Balance.compileHealingRecipe({ proposal: proposal(), actor: target, policy, revision: { revision: 1, target: { kind: 'self' } } });
    const efficient = Balance.compilePersonalImprovement({ learned, proposal: { stepId: 'efficiency', reason: 'A focused efficiency improvement.' }, actor: target });
    const stronger = Balance.compilePersonalImprovement({ learned, proposal: { stepId: 'power', reason: 'A focused power improvement.' }, actor: target });
    assert.equal(amount(learned.costs[0].amount, target), 83);
    assert.equal(amount(efficient.costs[0].amount, target), 75);
    assert.equal(amount(efficient.effects[0].amount, target), 24);
    assert.equal(amount(stronger.costs[0].amount, target), 83);
    assert.equal(amount(stronger.effects[0].amount, target), 26);
});

test('recipe rejects unavailable, reversed, mismatched and ambiguous actor resources or selections', () => {
    const policy = Balance.resolvePolicy({});
    const compile = target => Balance.compileHealingRecipe({ proposal: proposal(), actor: target, policy, revision: { target: { kind: 'self' } } });
    assert.throws(() => compile(actor({ mana: false })), /missing or inactive/);
    assert.throws(() => compile(actor({ paymentDirection: 'increase' })), /payment direction conflicts/);
    assert.throws(() => compile(actor({ capacity: 500 })), /capacity 500 conflicts with required 1000/);
    assert.throws(() => Balance.compileHealingRecipe({ proposal: proposal({ skillName: 'Unknown' }), actor: actor(), policy }), /no unambiguous actual skill/);
    assert.throws(() => Balance.compileHealingRecipe({ proposal: proposal({ attributeName: 'Luck' }), actor: actor(), policy }), /no unambiguous actual attribute/);
    assert.throws(() => Balance.compileHealingRecipe({ proposal: proposal({ resourceProfileId: 'stamina' }), actor: actor(), policy }), /resourceProfileId stamina is unsupported/);
    const colliding = actor({ skills: { 'Field Craft': 2, 'Field-Craft': 4 } });
    assert.throws(() => Balance.compileHealingRecipe({ proposal: proposal({ skillName: 'Field Craft' }), actor: colliding, policy }), /skill_field_craft is ambiguous/);
});

test('recipe reports missing and invalid actor selectors together', () => {
    const policy = Balance.resolvePolicy({});
    const target = actor();
    assert.throws(() => Balance.resolveAuthoringRecipeProposal({ kind: 'healing', skillName: 'Unknown', resourceProfileId: 'invented' }, { actor: target, policy }), error => {
        assert.match(error.message, /skillName/);
        assert.match(error.message, /attributeName/);
        assert.match(error.message, /resourceProfileId/);
        return true;
    });
});

test('mixed recipe feedback identifies every independent selector in the second status component', () => {
    const valid = { kind: 'healing', skillName: 'Spellcasting', attributeName: 'Intelligence', resourceProfileId: 'mana' };
    const buff = { kind: 'buff', resourceProfileId: 'mana', statusStatKind: 'attribute', statusModifierKind: 'fixed', statusName: 'Holographic Strength', statusDescription: 'Improves strength.' };
    const resolve = component => Balance.resolveAuthoringRecipeProposal({ components: [valid, component] }, { actor: actor(), policy: Balance.resolvePolicy({}) });
    assert.throws(() => resolve(buff), error => {
        for (const pattern of [/recipe\.components\[1\]\.skillName/, /recipe\.components\[1\]\.statusStatName/, /component 2, buff.*Holographic Strength/, /<skillName>/, /<statusStatName>/, /Intelligence/, /Strength/, /actual attributes/, /recipe\/components\/component\[2\]/]) assert.match(error.message, pattern);
        return true;
    });
    assert.throws(() => resolve({ ...buff, statusStatKind: 'invalid' }), error => {
        assert.match(error.message, /statusStatKind/);
        assert.doesNotMatch(error.message, /components\[1\]\.statusStatName/);
        return true;
    });
    const accepted = resolve({ ...buff, skillName: 'Spellcasting', statusStatName: 'Strength' });
    assert.equal(accepted.components[1].statusStatName, 'Strength');
    assert.equal(accepted.components[1].skillName, 'Spellcasting');
});

test('policy validation rejects unknown fields and coefficients that could break cost monotonicity', () => {
    const policy = structuredClone(Balance.DEFAULT_POLICY);
    assert.throws(() => Balance.validatePolicy({ ...policy, surprise: true }), /techniques\.balance\.surprise is unsupported/);
    const negativeEfficiency = structuredClone(policy);
    negativeEfficiency.resourceProfiles.mana.skillEfficiency = -0.1;
    assert.throws(() => Balance.validatePolicy(negativeEfficiency), /skillEfficiency must be finite and >= 0/);
    const zeroBase = structuredClone(policy);
    zeroBase.resourceProfiles.mana.baseCost = 0;
    assert.throws(() => Balance.validatePolicy(zeroBase), /baseCost must be finite and positive/);
});

test('authoring context exposes only profiles applicable to the actor', () => {
    const policy = Balance.resolvePolicy({});
    assert.deepEqual(Balance.getAuthoringContext({ actor: actor(), policy }).resourceProfiles.map(profile => profile.resourceProfileId), ['mana']);
    assert.deepEqual(Balance.getAuthoringContext({ actor: actor({ mana: false }), policy }).resourceProfiles, []);
});

test('saved managed revisions keep their policy snapshot when current configuration changes', () => {
    const target = actor();
    const originalPolicy = Balance.resolvePolicy({});
    const managed = Balance.compileHealingRecipe({ proposal: proposal(), actor: target, policy: originalPolicy, revision: { revision: 1, target: { kind: 'self' } } });
    const newerConfig = structuredClone(Balance.DEFAULT_POLICY);
    newerConfig.healing.standard.levelCoefficient = 20;
    const newerPolicy = Balance.resolvePolicy({ techniques: { balance: newerConfig } });
    const later = Balance.compileHealingRecipe({ proposal: proposal(), actor: target, policy: newerPolicy, revision: { revision: 1, target: { kind: 'self' } } });

    assert.equal(Balance.validateManagedRevision(managed, target), true);
    assert.equal(amount(managed.effects[0].amount, target), 24);
    assert.equal(amount(later.effects[0].amount, target), 75);
    assert.notEqual(managed.balance.policy.digest, later.balance.policy.digest);
});

test('automatic unmanaged healing and forged managed formulas are rejected; editor custom healing remains explicit', () => {
    const custom = { revision: 1, target: { kind: 'self' }, costs: [], effects: [{ id: 'heal', kind: 'healing', amount: 3 }] };
    assert.throws(() => Balance.materializeRevision(custom, { actor: actor(), origin: 'automatic' }), /Automatic healing requires a managed recipe/);
    assert.deepEqual(Balance.materializeRevision(custom, { actor: actor(), origin: 'editor' }), custom);

    const managed = Balance.compileHealingRecipe({ proposal: proposal(), actor: actor(), policy: Balance.resolvePolicy({}), revision: { revision: 1, target: { kind: 'self' } } });
    const forged = structuredClone(managed);
    forged.effects[0].amount = { formula: 'max(1, level)' };
    assert.throws(() => Balance.validateManagedRevision(forged), /canonical saved recipe/);
    const forgedSnapshot = structuredClone(managed);
    forgedSnapshot.balance.policy.snapshot.referenceBaseWeaponDamage = 99;
    assert.throws(() => Balance.validateManagedRevision(forgedSnapshot), /digest does not match/);
});

test('model-authored editor provenance cannot grant the trusted custom-authoring origin', () => {
    const raw = {
        id: 'forged-editor-technique', disciplineId: 'fixture-discipline', name: 'Forged', description: 'A fixture.', semanticKey: 'forged', aliases: [],
        provenance: { kind: 'editor', reason: 'Model claimed editor authority.' },
        revisions: [{ revision: 1, target: { kind: 'self' }, check: { kind: 'automatic' }, costs: [], effects: [{ id: 'heal', kind: 'healing', amount: 3 }] }]
    };
    assert.throws(() => Balance.materializeDefinition(raw, { actor: actor(), origin: 'automatic' }), /cannot claim editor provenance/);
    assert.throws(() => parseAutomaticTechniqueCandidate(raw), /cannot claim editor provenance/);
    assert.equal(Balance.materializeDefinition(raw, { actor: actor(), origin: 'editor' }).revisions[0].effects[0].amount, 3);
});


test('mixed area components retain full strength and each carries per-target cost', () => {
    const target = actor();
    const policy = Balance.resolvePolicy({});
    const healing = { kind: 'healing', skillName: 'Spellcasting', attributeName: 'Intelligence', resourceProfileId: 'mana', effectId: 'heal' };
    const damage = { ...healing, kind: 'damage', effectId: 'strike' };
    const check = { kind: 'skill', skill: 'Spellcasting', difficulty: 'Easy' };
    const mixed = Balance.compileComponentsRecipe({ proposal: { components: [healing, damage] }, actor: target, policy, revision: { target: { kind: 'area' }, check } });
    const single = Balance.compileComponentsRecipe({ proposal: { components: [healing] }, actor: target, policy, revision: { target: { kind: 'single' } } });
    assert.equal(mixed.balance.schemaVersion, 2);
    assert.deepEqual(mixed.effects[0], single.effects[0]);
    assert.deepEqual(mixed.costs.map(cost => cost.perTarget), [true, true]);
    assert.equal(mixed.costs.reduce((sum, cost) => sum + amount(cost.amount, target), 0), 166);
    assert.equal(Balance.validateManagedRevision(mixed, target), true);
    const forged = structuredClone(mixed);
    forged.costs[0].perTarget = false;
    assert.throws(() => Balance.validateManagedRevision(forged), /perTarget pricing/);
});

test('status components use signed fixed or percent defaults and targeted improvements', () => {
    const target = actor();
    const common = { skillName: 'Spellcasting', resourceProfileId: 'mana', statusStatKind: 'attribute', statusStatName: 'Strength', statusName: 'Focus', statusDescription: 'Changes strength.' };
    const components = [
        { ...common, kind: 'buff', effectId: 'buff', statusModifierKind: 'fixed' },
        { ...common, kind: 'debuff', effectId: 'debuff', statusModifierKind: 'percent' }
    ];
    const revision = Balance.compileComponentsRecipe({ proposal: { components }, actor: target, revision: { target: { kind: 'area' }, check: { kind: 'skill', skill: 'Spellcasting', difficulty: 'Easy' } } });
    assert.equal(revision.effects[0].status.duration, 3);
    assert.deepEqual(revision.effects[0].status.attributes, [{ attribute: 'Strength', modifier: 1 }]);
    assert.deepEqual(revision.effects[1].status.attributes, [{ attribute: 'Strength', percentModifier: -5 }]);
    assert.throws(() => Balance.compilePersonalImprovement({ learned: revision, actor: target, proposal: { stepId: 'statusPower' } }), /effectId must select/);
    const improved = Balance.compilePersonalImprovement({ learned: revision, actor: target, proposal: { stepId: 'statusPower', effectId: 'debuff' } });
    assert.deepEqual(improved.effects[0], revision.effects[0]);
    assert.deepEqual(improved.effects[1].status.attributes, [{ attribute: 'Strength', percentModifier: -10 }]);
    assert.deepEqual(improved.costs, revision.costs);
});

test('legacy managed healing retains its original v1 snapshot digest and improvement shape', () => {
    const target = actor();
    const managed = Balance.compileHealingRecipe({ proposal: proposal(), actor: target, policy: Balance.resolvePolicy({}), revision: { revision: 1, target: { kind: 'self' } } });
    assert.equal(managed.balance.schemaVersion, 1);
    assert.equal(managed.balance.policy.digest, 'e01ad9f55b7fed788a68686c6825a047a011c80794255fe3f887ebf1601983da');
    assert.deepEqual(Object.keys(managed.balance.policy.snapshot), ['version', 'healing', 'referenceBaseWeaponDamage', 'resourceProfile', 'improvementSteps']);
    const upgraded = Balance.compilePersonalImprovement({ learned: managed, proposal: { stepId: 'power' }, actor: target });
    assert.deepEqual(upgraded.balance.parameters.appliedImprovementIds, ['power']);
    assert.equal(upgraded.balance.schemaVersion, 1);
    assert.equal(Balance.validateManagedRevision(upgraded, target), true);
});
