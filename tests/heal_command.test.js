const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const HealCommand = require('../slashcommands/heal.js');

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

test('heal heals the invoking player when called without arguments', async () => withPlayerTestState(async () => {
    const baato = new Player({
        id: 'heal-player-self',
        name: 'Baato',
        health: 1,
        isDead: true
    });
    const replies = [];

    await HealCommand.execute({
        user: { id: baato.id },
        argsText: '',
        reply: async (payload) => {
            replies.push(payload);
        }
    }, {});

    assert.equal(baato.isDead, false);
    assert.equal(baato.health, baato.maxHealth);
    assert.deepEqual(replies, [{
        content: 'Baato has been fully restored.',
        ephemeral: false
    }]);
}));

test('heal accepts an explicitly named player target', async () => withPlayerTestState(async () => {
    const invoker = new Player({
        id: 'heal-player-invoker',
        name: 'Invoker'
    });
    const baato = new Player({
        id: 'heal-player-target',
        name: 'Baato',
        health: 2,
        isDead: true
    });
    const replies = [];

    await HealCommand.execute({
        user: { id: invoker.id },
        argsText: 'Baato',
        reply: async (payload) => {
            replies.push(payload);
        }
    }, {});

    assert.equal(baato.isDead, false);
    assert.equal(baato.health, baato.maxHealth);
    assert.deepEqual(replies, [{
        content: 'Baato has been fully restored.',
        ephemeral: false
    }]);
}));
