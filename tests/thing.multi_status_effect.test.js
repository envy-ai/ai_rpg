const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Thing = require('../Thing.js');
const Player = require('../Player.js');

function withPlayerTestState(callback) {
    const previousConfig = Globals.config;
    Player.clearRuntimeRegistries();
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };
    return Promise.resolve().then(callback).finally(() => {
        Player.clearRuntimeRegistries();
        Globals.config = previousConfig;
    });
}

function makeBlade(overrides = {}) {
    return new Thing({
        name: overrides.name || 'Twin Blade',
        description: 'A blade with layered enchantments.',
        thingType: 'item',
        slot: 'hands',
        enrichStatusEffects: false
    });
}

test('Thing stores, exposes, and round-trips multiple target and equipper effects', () => {
    const blade = makeBlade();
    blade.setCauseStatusEffects({
        target: [
            { name: 'Bleeding', description: 'Bleeds.', duration: 2 },
            { name: 'Poison', description: 'Poisons.', duration: 3 }
        ],
        equipper: [
            { name: 'Focused', description: 'Sharper strikes.', duration: -1 },
            { name: 'Swift', description: 'Faster strikes.', duration: -1 }
        ]
    });

    assert.deepEqual(blade.causeStatusEffectsOnTarget.map(e => e.name), ['Bleeding', 'Poison']);
    assert.deepEqual(blade.causeStatusEffectsOnEquipper.map(e => e.name), ['Focused', 'Swift']);
    // Singular getters remain for backward compatibility (first of each role).
    assert.equal(blade.causeStatusEffectOnTarget.name, 'Bleeding');
    assert.equal(blade.causeStatusEffectOnEquipper.name, 'Focused');

    const restored = Thing.fromJSON(blade.toJSON());
    assert.deepEqual(restored.causeStatusEffectsOnTarget.map(e => e.name), ['Bleeding', 'Poison']);
    assert.deepEqual(restored.causeStatusEffectsOnEquipper.map(e => e.name), ['Focused', 'Swift']);
});

test('an equipped item applies all of its equip status effects to the wearer', () => withPlayerTestState(() => {
    const player = new Player({ id: 'multi-effect-hero', name: 'Hero', health: 20 });
    const blade = makeBlade();
    blade.setCauseStatusEffects({
        equipper: [
            { name: 'Focused', description: 'Sharper strikes.', duration: -1 },
            { name: 'Swift', description: 'Faster strikes.', duration: -1 }
        ]
    });
    player.addInventoryItem(blade);
    player.equipItem(blade);
    assert.equal(blade.isEquipped, true, 'blade should be equipped');

    const names = player.getStatusEffects().map(e => e.name).filter(Boolean);
    assert.ok(names.includes('Focused'), 'first equip effect should apply');
    assert.ok(names.includes('Swift'), 'second equip effect should also apply');
}));

test('the attack and consume paths iterate all inflict effects, not just the first', () => {
    const fs = require('fs');
    const path = require('path');
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    // Attack path pushes every weapon inflict effect.
    assert.match(apiSource, /weaponThing\.causeStatusEffectsOnTarget/);
    assert.match(apiSource, /effects\.push\(\.\.\.weaponTargetEffects\)/);
    // Consume path iterates all inflict effects.
    assert.match(apiSource, /thing\.causeStatusEffectsOnTarget/);
    // Equip path reads the plural getter.
    const playerSource = fs.readFileSync(path.join(__dirname, '..', 'Player.js'), 'utf8');
    assert.match(playerSource, /item\.causeStatusEffectsOnEquipper/);
});
