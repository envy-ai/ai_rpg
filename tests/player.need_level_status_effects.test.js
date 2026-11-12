'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Player = require('../Player.js');
const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
const { withTempPlayerEnvironment } = require('./helpers/needBarFixtures.js');

const definitions = `
need_bars:
  rest:
    name: Rest
    player: true
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 50
    effect_thresholds:
      0:
        name: Exhausted
        sentence: "%CHARACTER% is exhausted."
        status_effects:
          exhausted:
            name: Exhausted
            description: Exhaustion weakens strength and stamina.
            attributes:
              strength:
                percent_modifier: -10
            need_bar_maximums:
              stamina:
                percent_modifier: -10
      50:
        name: Rested
        sentence: "%CHARACTER% is rested."
      100:
        name: Fully Rested
        sentence: "%CHARACTER% is fully rested."
        status_effects:
          rested:
            name: Rested
            description: Rest improves strength and stamina.
            attributes:
              strength:
                percent_modifier: 5
            need_bar_maximums:
              stamina:
                percent_modifier: 5
  stamina:
    name: Stamina
    player: true
    party: true
    non_party: true
    min: 0
    max: 1000
    initial: 500
    change_per_minute: 50
  food:
    name: Food
    player: true
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 0
    effect_thresholds:
      0:
        name: Hungry
        sentence: "%CHARACTER% is hungry."
        status_effects:
          hunger:
            name: Hungry
            description: Hunger lowers strength.
            attributes:
              strength:
                percent_modifier: -10
      50:
        name: Satisfied
        sentence: "%CHARACTER% is satisfied."
`;

function fixture(run) {
    return withTempPlayerEnvironment({ prefix: 'need-level-effects-', manageWorldTime: true,
        attributes: [{ id: 'strength', label: 'Strength', default: 10 }], needBarsYaml: definitions }, run);
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('need-level effects switch at boundaries, stack, and never enter intrinsic saves', () => fixture(() => {
    const actor = new Player({ id: 'need-level-bands', name: 'Need Tester', attributes: { strength: 10 } });
    actor.setNeedBarValue('rest', 49.999);
    const effects = actor.getStatusEffects().filter(effect => effect.needBarSource);
    assert.deepEqual(effects.map(effect => effect.needBarSource.barId).sort(), ['food', 'rest']);
    assert.equal(actor.getModifiedAttribute('strength'), 8);
    assert.deepEqual(actor.toJSON().statusEffects, []);
    actor.setNeedBarValue('rest', 50);
    assert.deepEqual(actor.getStatusEffects().filter(effect => effect.needBarSource).map(effect => effect.needBarSource.barId), ['food']);
    assert.equal(actor.getModifiedAttribute('strength'), 9);
    actor.setNeedBarValue('food', 50);
    actor.setNeedBarValue('rest', 100);
    assert.equal(actor.getModifiedAttribute('strength'), 10.5);
    assert.equal(actor.getStatusEffects().filter(effect => effect.needBarSource).length, 1);
}));

test('need capacities preserve exact fill percentage, while fixed spending and recovery stay in units', () => fixture(() => {
    const actor = new Player({ id: 'need-capacity-ratio', name: 'Need Tester', attributes: { strength: 10 } });
    actor.setNeedBarValue('stamina', 372.5);
    actor.setNeedBarValue('rest', 0);
    near(actor.getNeedBarValue('stamina'), 335.25);
    near(actor.getNeedBars().find(bar => bar.id === 'stamina').max, 900);
    actor.setNeedBarValue('stamina', actor.getNeedBarValue('stamina') - 12.5);
    near(actor.getNeedBarValue('stamina'), 322.75);
    actor.setNeedBarValue('rest', 100);
    near(actor.getNeedBarValue('stamina'), 322.75 / 900 * 1050);
    near(actor.getNeedBars().find(bar => bar.id === 'stamina').max, 1050);
}));

test('need-level sources are inactive when their bar is inapplicable and restore without duplication', () => fixture(() => {
    const actor = new Player({ id: 'need-inactive', name: 'Need Tester', attributes: { strength: 10 } });
    assert.equal(actor.getStatusEffects().filter(effect => effect.needBarSource?.barId === 'food').length, 1);
    actor.setNeedBarApplicability({ food: false });
    assert.equal(actor.getStatusEffects().filter(effect => effect.needBarSource?.barId === 'food').length, 0);
    actor.setNeedBarApplicability({ food: true });
    assert.ok(actor.getStatusEffects().filter(effect => effect.needBarSource?.barId === 'food').length <= 1);
    assert.deepEqual(actor.toJSON().statusEffects, []);
}));

test('location capacity changes preserve all local actors and invalid capacities roll back atomically', () => fixture(() => {
    Location.clear();
    try {
        new Region({ id: 'fixture-region', name: 'Fixture Region', description: 'A test region.' });
        const location = new Location({ id: 'need-capacity-room', regionId: 'fixture-region', name: 'Capacity Room', description: 'A test room.' });
        const first = new Player({ id: 'capacity-first', name: 'First' });
        const second = new Player({ id: 'capacity-second', name: 'Second', isNPC: true });
        first.setLocation(location); second.setLocation(location);
        first.setNeedBarValue('stamina', 372.5); second.setNeedBarValue('stamina', 250);
        location.setStatusEffects([{ name: 'Restful room', description: 'More stamina.', duration: -1, needBarMaximums: [{ name: 'stamina', percentModifier: 10 }] }]);
        near(first.getNeedBarValue('stamina'), 409.75);
        near(second.getNeedBarValue('stamina'), 275);
        const before = { location: location.getStatusEffects(), first: first.toJSON(), second: second.toJSON() };
        assert.throws(() => location.setStatusEffects([{ name: 'Broken room', description: 'Invalid capacity.', duration: -1, needBarMaximums: [{ name: 'stamina', percentModifier: -100 }] }]), /stamina.*(?:maximum|capacity|range)/i);
        assert.deepEqual(location.getStatusEffects(), before.location);
        assert.deepEqual(first.toJSON(), before.first);
        assert.deepEqual(second.toJSON(), before.second);
    } finally {
        Location.clear();
        Region.clear();
    }
}));

test('legacy health without a saved maximum reconstructs its pre-need ratio; invalid references fail', () => fixture(() => {
    const actor = new Player({ id: 'legacy_health', name: 'Legacy Health', attributes: { strength: 10 } });
    const saved = actor.toJSON();
    saved.health = 10;
    delete saved.maxHealth;
    delete saved.derivedNeedRatesAppliedAt;
    for (const bar of saved.needBars) { delete bar.baseMin; delete bar.baseMax; delete bar.baseCapacity; }
    Player.clearRuntimeRegistries();
    const restored = Player.fromJSON(saved);
    near(restored.maxHealth, 19);
    near(restored.health, 9.5);
    const invalid = structuredClone(saved);
    invalid.id = 'invalid_health'; invalid.maxHealth = 0;
    assert.throws(() => Player.fromJSON(invalid), /maxHealth.*missing or invalid/i);
    const newFormatMissing = structuredClone(saved);
    newFormatMissing.id = 'new_missing_health'; newFormatMissing.derivedNeedRatesAppliedAt = 0;
    assert.throws(() => Player.fromJSON(newFormatMissing), /maxHealth.*missing or invalid/i);
}));

test('saved effective bounds round-trip exactly; missing new-format bounds fail without guessing', () => fixture(() => {
    const actor = new Player({ id: 'need_roundtrip', name: 'Roundtrip', attributes: { strength: 10 } });
    actor.setNeedBarValue('rest', 0);
    actor.setNeedBarValue('stamina', 333.125);
    actor.setHealth(actor.maxHealth * 0.3725);
    const saved = actor.toJSON();
    const sources = actor.getStatusEffects().filter(effect => effect.needBarSource).map(effect => effect.id).sort();
    Player.clearRuntimeRegistries();
    const restored = Player.fromJSON(saved);
    near(restored.getNeedBarValue('stamina'), 333.125);
    near(restored.getNeedBars().find(bar => bar.id === 'stamina').max, 900);
    near(restored.health, saved.health);
    assert.deepEqual(restored.getStatusEffects().filter(effect => effect.needBarSource).map(effect => effect.id).sort(), sources);
    const malformed = structuredClone(saved);
    malformed.id = 'missing_reference_bounds';
    const stamina = malformed.needBars.find(bar => bar.id === 'stamina');
    delete stamina.min; delete stamina.max;
    assert.throws(() => Player.fromJSON(malformed), error => error.code === 'NEED_BAR_STATE_INVALID' && /stamina.*min\/max/i.test(error.message));
}));
