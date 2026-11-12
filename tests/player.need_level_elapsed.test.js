'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Globals = require('../Globals.js');
const Player = require('../Player.js');
const { withTempPlayerEnvironment } = require('./helpers/needBarFixtures.js');

function fixture(run) {
    return withTempPlayerEnvironment({ prefix: 'need-level-elapsed-', manageWorldTime: true,
        attributes: [{ id: 'constitution', label: 'Constitution', default: 10 }],
        needBarsYaml: 'need_bars: {}\n', configOverrides: { healthRegenPercentPerMinute: 5 } }, run);
}

test('health regeneration and drain net together before the maximum bound, without need effects', () => fixture(() => {
    Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };
    const player = new Player({ id: 'need-net-health', name: 'Net Health' });
    player.setHealth(player.maxHealth);
    player.addStatusEffect({ name: 'Drain', description: 'A one point drain.', duration: 5, needBars: [{ name: 'Health', delta: -1 }] });
    Player.applyStatusEffectNeedBarsToAll();
    Globals.worldTime = { dayIndex: 0, timeMinutes: 1 };
    Player.applyStatusEffectNeedBarsToAll();
    assert.equal(player.maxHealth, 20);
    assert.equal(player.health, 20);
    Player.applyStatusEffectNeedBarsToAll();
    assert.equal(player.health, 20, 'the same world minute is not applied twice');
}));

test('long elapsed settlement matches repeated minutes through intrinsic effect expiry', () => {
    const simulate = stepped => fixture(() => {
        Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };
        const actor = new Player({ id: `need-elapsed-${stepped}`, name: 'Elapsed' });
        actor.setHealth(10);
        actor.addStatusEffect({ name: 'Drain', description: 'A timed drain.', duration: 2, needBars: [{ name: 'Health', delta: -0.25, percentDelta: -1 }] });
        Player.applyStatusEffectNeedBarsToAll();
        if (stepped) {
            for (let minute = 1; minute <= 5; minute++) {
                Globals.worldTime = { dayIndex: 0, timeMinutes: minute };
                Player.applyStatusEffectNeedBarsToAll();
            }
        } else {
            Globals.worldTime = { dayIndex: 0, timeMinutes: 5 };
            Player.applyStatusEffectNeedBarsToAll();
        }
        return { health: actor.health, effects: actor.getIntrinsicStatusEffects(), saved: actor.toJSON() };
    });
    const stepped = simulate(true), skipped = simulate(false);
    assert.ok(Math.abs(stepped.health - skipped.health) < 1e-9);
    assert.deepEqual(stepped.effects, skipped.effects);
    assert.equal(skipped.effects.length, 0);
});

test('cross-need percentage rates use base capacity and unavailable targets do not replay', () => {
    const needBarsYaml = `
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
        name: Recovering
        sentence: "%CHARACTER% is recovering."
        status_effects:
          recovery:
            name: Recovery
            description: Stamina recovers while health drains.
            need_bars:
              Health:
                percent_delta: -1
              stamina:
                percent_delta: 10
            need_bar_maximums:
              stamina:
                percent_modifier: 50
  stamina:
    name: Stamina
    player: true
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 50
`;
    withTempPlayerEnvironment({ prefix: 'need-cross-rate-', manageWorldTime: true, needBarsYaml,
        attributes: [{ id: 'constitution', label: 'Constitution', default: 10 }], configOverrides: { healthRegenPercentPerMinute: 0 } }, () => {
        Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };
        const actor = new Player({ id: 'cross-rate', name: 'Cross Rate' });
        actor.setHealth(10);
        actor.setNeedBarValue('stamina', 75);
        Player.applyStatusEffectNeedBarsToAll();
        Globals.worldTime = { dayIndex: 0, timeMinutes: 1 };
        Player.applyStatusEffectNeedBarsToAll();
        assert.ok(Math.abs(actor.health - 9.8) < 1e-9);
        assert.ok(Math.abs(actor.getNeedBarValue('stamina') - 85) < 1e-9);
        actor.setNeedBarApplicability({ stamina: false });
        const source = actor.getStatusEffects().find(effect => effect.needBarSource?.barId === 'rest');
        assert.ok(source.inactiveNeedBarTargets.includes('stamina'));
        Globals.worldTime = { dayIndex: 0, timeMinutes: 5 };
        Player.applyStatusEffectNeedBarsToAll();
        assert.ok(Math.abs(actor.health - 9) < 1e-9);
        actor.setNeedBarApplicability({ stamina: true });
        actor.setNeedBarValue('stamina', 50);
        Globals.worldTime = { dayIndex: 0, timeMinutes: 6 };
        Player.applyStatusEffectNeedBarsToAll();
        assert.ok(Math.abs(actor.getNeedBarValue('stamina') - 60) < 1e-9);
        assert.ok(Math.abs(actor.health - 8.8) < 1e-9);
    });
});

test('overflowing ongoing Health rates fail explicitly without mutating health, effects or clocks', () => fixture(() => {
    Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };
    const actor = new Player({ id: 'overflow-rate', name: 'Overflow Rate' });
    actor.setHealth(10);
    actor.addStatusEffect({ name: 'Overflow A', description: 'First extreme rate.', duration: -1, needBars: [{ name: 'Health', delta: 1e308 }] });
    actor.addStatusEffect({ name: 'Overflow B', description: 'Second extreme rate.', duration: -1, needBars: [{ name: 'Health', delta: 1e308 }] });
    Player.applyStatusEffectNeedBarsToAll();
    const before = actor.toJSON();
    Globals.worldTime = { dayIndex: 0, timeMinutes: 1 };
    assert.throws(() => Player.applyStatusEffectNeedBarsToAll(), /Health.*non-finite/i);
    assert.deepEqual(actor.toJSON(), before);
}));
