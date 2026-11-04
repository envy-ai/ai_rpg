const test = require('node:test');
const assert = require('node:assert/strict');
const Balance = require('../TechniqueBalancePolicy.js');
const Variables = require('../public/js/technique-formula-variables.js');
const Evaluator = require('../public/js/formula-evaluator.js');
function actor({ skills = { Spellcasting: 3 }, attributes = { Intelligence: 4 }, bars = [{ id: 'mana', min: 0, max: 1000, value: 1000, paymentDirection: 'decrease' }] } = {}) {
    return { id: 'semantic-damage', name: 'Mage', level: 3, getSkills: () => new Map(Object.entries(skills)), getSkillValue: name => skills[name], getAttributeNames: () => Object.keys(attributes), getAttributeModifier: name => attributes[name], getNeedBars: () => bars };
}
const evaluate = (spec, target) => Evaluator.compile(spec.formula)(Variables.resolve(spec.formula, target));
const damageCheck = { kind: 'skill', skill: 'Spellcasting', difficulty: 'Medium' };

test('semantic recipe selects engine constants and fills only unambiguous actor choices', () => {
    const policy = Balance.resolvePolicy({}); const target = actor();
    for (const kind of ['healing', 'damage']) {
        const resolved = Balance.resolveAuthoringRecipeProposal({ kind }, { actor: target, policy });
        assert.equal(resolved.recipeId, `standard-${kind}`);
        assert.equal(resolved.skillName, 'Spellcasting'); assert.equal(resolved.attributeName, 'Intelligence'); assert.equal(resolved.resourceProfileId, 'mana');
        assert.equal(resolved.effectId, kind === 'damage' ? 'strike' : 'restore');
    }
    assert.throws(() => Balance.resolveAuthoringRecipeProposal({ kind: 'damage' }, { actor: actor({ skills: {} }), policy }), /skill/i);
    assert.throws(() => Balance.resolveAuthoringRecipeProposal({ kind: 'damage' }, { actor: actor({ skills: { A: 1, B: 2 } }), policy }), /skill|ambiguous/i);
    assert.throws(() => Balance.resolveAuthoringRecipeProposal({ kind: 'damage' }, { actor: actor({ attributes: { A: 1, B: 2 } }), policy }), /attribute|ambiguous/i);
    assert.throws(() => Balance.resolveAuthoringRecipeProposal({ kind: 'damage' }, { actor: actor({ bars: [] }), policy }), /resource|profile/i);
});

test('standard damage compiles the selected actor facts with independently saved policy', () => {
    const target = actor(); const policy = Balance.resolvePolicy({});
    const recipe = Balance.resolveAuthoringRecipeProposal({ kind: 'damage' }, { actor: target, policy });
    const compiled = Balance.compileDamageRecipe({ proposal: recipe, actor: target, policy, revision: { revision: 1, target: { kind: 'single' }, check: damageCheck } });
    assert.equal(compiled.effects[0].kind, 'damage'); assert.equal(compiled.effects[0].damageMode, 'technique');
    assert.equal(evaluate(compiled.effects[0].amount, target), 24); assert.equal(evaluate(compiled.costs[0].amount, target), 83);
    const saved = structuredClone(compiled.balance.policy.snapshot);
    target.level = 5; target.getSkillValue = () => 8;
    assert.equal(evaluate(compiled.effects[0].amount, target), 35); assert.equal(evaluate(compiled.costs[0].amount, target), 67);
    assert.deepEqual(compiled.balance.policy.snapshot, saved);
    assert.equal(Balance.validateManagedRevision(compiled, target), true);
});

test('automatic custom damage remains available alongside the standard recipe', () => {
    const custom = { revision: 1, target: { kind: 'area' }, check: damageCheck, costs: [], effects: [{ id: 'hurt', kind: 'damage', damageMode: 'technique', amount: { formula: 'level * 2' } }] };
    assert.deepEqual(Balance.materializeRevision(custom, { actor: actor(), origin: 'automatic' }), custom);
});

test('damage policy changes independently while historical healing snapshot and damage digest stay stable', () => {
    const target = actor(), original = Balance.resolvePolicy({});
    const healing = Balance.compileHealingRecipe({ proposal: { recipeId: 'standard-healing', skillName: 'Spellcasting', attributeName: 'Intelligence', resourceProfileId: 'mana' }, actor: target, policy: original, revision: { revision: 1, target: { kind: 'self' } } });
    const damage = Balance.compileDamageRecipe({ proposal: { recipeId: 'standard-damage', skillName: 'Spellcasting', attributeName: 'Intelligence', resourceProfileId: 'mana' }, actor: target, policy: original, revision: { revision: 1, target: { kind: 'single' }, check: damageCheck } });
    const savedHealing = structuredClone(healing.balance), savedDamage = structuredClone(damage.balance);
    const changed = structuredClone(Balance.DEFAULT_POLICY); changed.damage.standard.levelCoefficient = 10;
    const updated = Balance.resolvePolicy({ techniques: { balance: changed } });
    const newer = Balance.compileDamageRecipe({ proposal: { recipeId: 'standard-damage', skillName: 'Spellcasting', attributeName: 'Intelligence', resourceProfileId: 'mana' }, actor: target, policy: updated, revision: { revision: 1, target: { kind: 'single' }, check: damageCheck } });
    assert.equal(evaluate(newer.effects[0].amount, target), 45);
    assert.deepEqual(healing.balance, savedHealing); assert.deepEqual(damage.balance, savedDamage);
    assert.equal(Balance.validateManagedRevision(healing, target), true); assert.equal(Balance.validateManagedRevision(damage, target), true);
    assert.notEqual(damage.balance.policy.digest, newer.balance.policy.digest);
    const oldConfig = structuredClone(Balance.DEFAULT_POLICY); delete oldConfig.damage;
    assert.deepEqual(Balance.resolvePolicy({ techniques: { balance: oldConfig } }).damage, Balance.DEFAULT_POLICY.damage);
    assert.equal(Object.hasOwn(healing.balance.policy.snapshot, 'damage'), false);
});

test('standard damage rejects ambiguity, unavailable resources and unsupported mixtures without fallback', () => {
    const policy = Balance.resolvePolicy({});
    const secondProfile = structuredClone(Balance.DEFAULT_POLICY); secondProfile.resourceProfiles.mana_alt = { ...secondProfile.resourceProfiles.mana, needId: 'aether' };
    const bars = [{ id: 'mana', min: 0, max: 1000, value: 1000, paymentDirection: 'decrease' }, { id: 'aether', min: 0, max: 1000, value: 1000, paymentDirection: 'decrease' }];
    assert.throws(() => Balance.resolveAuthoringRecipeProposal({ kind: 'damage' }, { actor: actor({ bars }), policy: Balance.resolvePolicy({ techniques: { balance: secondProfile } }) }), /resourceProfileId.*multiple/i);
    const base = { revision: 1, target: { kind: 'single' }, check: damageCheck, recipe: { kind: 'damage' } };
    assert.throws(() => Balance.materializeRevision({ ...base, target: { kind: 'area' } }, { actor: actor(), policy }), /target/i);
    assert.throws(() => Balance.materializeRevision({ ...base, check: { kind: 'automatic' } }, { actor: actor(), policy }), /nonautomatic/i);
    assert.throws(() => Balance.materializeRevision({ ...base, effects: [] }, { actor: actor(), policy }), /omit/i);
    assert.throws(() => Balance.materializeRevision({ ...base, failureCosts: [] }, { actor: actor(), policy }), /omit/i);
    assert.throws(() => Balance.materializeRevision({ ...base, recipe: { kind: 'damage', resourceProfileId: 'unknown' } }, { actor: actor(), policy }), /unsupported/i);
});

test('semantic recipe permits consistent explicit canonical identifiers and rejects unknown or conflicting identifiers', () => {
    const target = actor(), policy = Balance.resolvePolicy({});
    const compatible = Balance.resolveAuthoringRecipeProposal({ kind: 'damage', recipeId: 'standard-damage', effectId: 'strike' }, { actor: target, policy });
    assert.equal(compatible.recipeId, 'standard-damage'); assert.equal(compatible.effectId, 'strike');
    assert.throws(() => Balance.resolveAuthoringRecipeProposal({ kind: 'damage', recipeId: 'standard-healing' }, { actor: target, policy }), /conflict/i);
    assert.throws(() => Balance.resolveAuthoringRecipeProposal({ kind: 'damage', recipeId: 'unrecognized' }, { actor: target, policy }), /unsupported/i);
});

test('actors with and without resources share policy projection without losing applicability', () => {
    const { compactTechniquePromptContext } = require('../TechniquePromptContext.js');
    const policy = Balance.resolvePolicy({}), withMana = actor(), withoutMana = actor({ bars: [] });
    const first = Balance.getAuthoringContext({ actor: withMana, policy }), second = Balance.getAuthoringContext({ actor: withoutMana, policy });
    assert.deepEqual(first.availableRecipeKinds, ['healing', 'damage']); assert.deepEqual(second.availableRecipeKinds, []);
    const contexts = [withMana, withoutMana].map((target, index) => ({ actorId: `a${index}`, actorName: `Actor ${index}`, formulaVariables: Variables.catalog(target), balanceAuthoring: index ? second : first, disciplineAccess: [], techniques: [] }));
    const compact = compactTechniquePromptContext(contexts);
    assert.equal(Object.keys(compact.balancePolicies).length, 1);
    assert.equal(compact.actors[0].balanceAuthoring.resourceProfiles.length, 1);
    assert.equal(compact.actors[1].balanceAuthoring.resourceProfiles.length, 0);
});

test('omitted allowDead uses supported default while true and malformed values reject', () => {
    const { parseAutomaticTechniqueCandidate } = require('../TechniquePrompt.js');
    const candidate = { id: 'technique-test', disciplineId: 'discipline-test', name: 'Strike', description: 'A strike.', semanticKey: 'strike', provenance: { kind: 'discovery', reason: 'Fixture.' }, revisions: [{ revision: 1, target: { kind: 'single' }, check: damageCheck, recipe: { kind: 'damage', skillName: 'Spellcasting', attributeName: 'Intelligence', resourceProfileId: 'mana' } }] };
    assert.doesNotThrow(() => parseAutomaticTechniqueCandidate(candidate));
    for (const invalid of [true, 'false']) {
        const copy = structuredClone(candidate); copy.revisions[0].target.allowDead = invalid;
        assert.throws(() => parseAutomaticTechniqueCandidate(copy), /allowDead|target/i);
    }
});
