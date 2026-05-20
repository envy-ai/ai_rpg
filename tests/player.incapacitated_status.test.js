const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
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

    return Promise.resolve()
        .then(callback)
        .finally(() => {
            Player.clearRuntimeRegistries();
            Globals.config = previousConfig;
        });
}

test('Incapacitated status disables a living character without changing health', () => withPlayerTestState(() => {
    const player = new Player({
        id: 'incapacitated-player',
        name: 'Baato',
        health: 7
    });

    assert.equal(player.isAlive(), true);
    assert.equal(player.isDisabled, false);

    player.addStatusEffect({ description: 'Incapacitated', duration: null });

    assert.equal(player.health, 7);
    assert.equal(player.isAlive(), true);
    assert.equal(player.isDisabled, true);

    player.removeStatusEffect('Incapacitated');

    assert.equal(player.health, 7);
    assert.equal(player.isDisabled, false);
}));
