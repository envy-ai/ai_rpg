const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const IncapacitateCommand = require('../slashcommands/incapacitate.js');

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

test('incapacitate command preserves NPC health and applies incapacitated status', async () => withPlayerTestState(async () => {
    const npc = new Player({
        id: 'incapacitate-target',
        name: 'Gallery Sentinel',
        isNPC: true,
        health: 7
    });
    const replies = [];

    await IncapacitateCommand.execute({
        argsText: 'Gallery Sentinel',
        reply: async (payload) => {
            replies.push(payload);
        }
    }, {});

    assert.equal(npc.health, 7);
    assert.equal(npc.isDead, false);
    assert.equal(npc.isDisabled, true);
    assert.equal(npc.getStatusEffects().some(effect => effect.description === 'Incapacitated'), true);
    assert.deepEqual(replies, [{
        content: 'Gallery Sentinel is incapacitated.',
        ephemeral: false
    }]);
}));
