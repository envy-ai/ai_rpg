const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run, configOverrides = {}) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-float-health-',
        attributes: [
            { id: 'constitution', label: 'Constitution', default: 10 }
        ],
        configStyle: 'standard-force-health',
        configOverrides,
        manageWorldTime: true
    }, run);
}

test('current health can be a persisted finite float', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'float-health',
            name: 'Float Health',
            health: 10.25
        });

        assert.equal(player.health, 10.25);
        assert.equal(player.getStatus().health, 10.25);
        assert.equal(player.toJSON().health, 10.25);

        const result = player.modifyHealth(-0.5, 'fractional damage');
        assert.equal(player.health, 9.75);
        assert.equal(result.change, -0.5);
    });
});

test('level changes preserve fractional health ratios without rounding', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'float-health-level',
            name: 'Float Health Level'
        });

        assert.equal(player.maxHealth, 20);
        player.setHealth(5.5);
        player.setLevel(2);

        assert.equal(player.maxHealth, 25);
        assert.ok(Math.abs(player.health - 6.875) < 1e-12);
    });
});

test('configured health regen restores a percentage of max health over elapsed minutes', () => {
    withTempPlayerEnvironment(() => {
        Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };
        const player = new Player({
            id: 'float-health-regen',
            name: 'Float Health Regen'
        });
        player.setHealth(10);

        const initialAdjustments = Player.applyStatusEffectNeedBarsToAll();
        assert.equal(player.health, 10);
        assert.deepEqual(initialAdjustments, []);

        Globals.worldTime = { dayIndex: 1, timeMinutes: 0 };
        const adjustments = Player.applyStatusEffectNeedBarsToAll();

        assert.equal(player.maxHealth, 20);
        assert.ok(Math.abs(player.health - 15) < 1e-9);
        assert.equal(adjustments.length, 1);
        assert.equal(adjustments[0].bar, 'Health');
        assert.equal(adjustments[0].needBarName, 'Health');
        assert.ok(Math.abs(adjustments[0].delta - 5) < 1e-9);
        assert.equal(adjustments[0].ticksApplied, 1440);
    }, {
        healthRegenPercentPerMinute: 0.01736111111
    });
});
