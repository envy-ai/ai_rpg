'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Balance = require('../TechniqueBalancePolicy.js');
const Technique = require('../Technique.js');
const TechniqueService = require('../TechniqueService.js');

const provenance = { kind: 'training', reason: 'Portable legacy recipe fixture.' };
function makeFixture() {
    const actor = { id: 'legacy_actor', name: 'Legacy Actor', level: 3,
        getSkills: () => new Map([['Spellcasting', 3]]), getSkillValue: () => 3,
        getAttributeNames: () => ['Strength'], getAttributeModifier: () => 2,
        getNeedBars: () => [{ id: 'mana', min: 0, max: 1000, value: 1000, paymentDirection: 'decrease' }] };
    const revision = Balance.compileComponentsRecipe({ actor, revision: { revision: 1, target: { kind: 'self' } }, proposal: { components: [{
        kind: 'buff', effectId: 'buff', skillName: 'Spellcasting', resourceProfileId: 'mana', statusStatKind: 'attribute',
        statusStatName: 'Strength', statusModifierKind: 'fixed', statusName: 'Focus', statusDescription: 'Improves strength.'
    }] } });
    const state = { version: 1, disciplines: [{ id: 'discipline_legacy', name: 'Legacy discipline', description: 'Fixture.', publicAccess: true }],
        definitions: [{ id: 'technique_legacy', disciplineId: 'discipline_legacy', name: 'Legacy technique', description: 'Fixture.', semanticKey: 'legacy', aliases: [], provenance, revisions: [revision] }], receipts: [] };
    const savedActor = { id: 'legacy_actor', techniques: [{ techniqueId: 'technique_legacy', definitionRevision: 1, personalRevision: 1,
        mechanics: structuredClone(revision), provenance, acquiredAt: 0, evidence: [], revisionHistory: [] }], disciplineAccess: [], statusEffects: [], abilities: [] };
    const item = { id: 'legacy_item', techniqueGrants: [{ id: 'legacy_grant', sourceItemId: 'legacy_item', techniqueId: 'technique_legacy', definitionRevision: 1, teaches: false, provenance }] };
    return { revision, state, savedActor, item };
}

test('legacy managed v2 status recipes validate and hydrate through full saved-graph validation', () => {
    const { revision, state, savedActor, item } = makeFixture();
    const policy = structuredClone(revision.balance.policy);
    assert.equal(Object.hasOwn(revision.effects[0].status, 'needBarMaximums'), false);
    const legacy = structuredClone(state);
    assert.equal(TechniqueService.validateState(legacy, { actors: [savedActor], things: [item] }), true);
    TechniqueService.hydrate(legacy);
    try {
        const saved = TechniqueService.toJSON();
        const status = saved.definitions[0].revisions[0].effects[0].status;
        assert.deepEqual(status.needBarMaximums, []);
        assert.deepEqual(saved.definitions[0].revisions[0].balance.policy, policy);
        assert.equal(TechniqueService.validateState(saved, { actors: [savedActor], things: [item] }), true);
    } finally { TechniqueService.reset(); }
});

test('managed recipe validation rejects added mechanics and changed amounts after canonical normalization', () => {
    const { revision } = makeFixture();
    const normalized = structuredClone(revision);
    normalized.effects[0].status = Technique.normalizeStatus(normalized.effects[0].status, 'test.status');
    assert.equal(Balance.validateManagedRevision(normalized), true);
    for (const alter of [
        status => { status.needBarMaximums = [{ name: 'stamina', percentModifier: 0 }]; },
        status => { status.needBars = [{ name: 'Health', delta: 0, percentDelta: 0 }]; },
        status => { status.attributes[0].modifier += 1; }
    ]) {
        const tampered = structuredClone(normalized);
        alter(tampered.effects[0].status);
        assert.throws(() => Balance.validateManagedRevision(tampered), /effects differ.*canonical recipe/i);
    }
    const changedCost = structuredClone(normalized);
    changedCost.costs[0].amount.formula = '1';
    assert.throws(() => Balance.validateManagedRevision(changedCost), /costs differ.*canonical recipe/i);
});
