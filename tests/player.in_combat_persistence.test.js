const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-combat-persistence-',
        currentPlayer: 'null'
    }, run);
}

test('current-player combat state stays synchronized and survives Player save/load', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'combat-persistence-player',
            name: 'Baato'
        });
        Globals.currentPlayer = player;

        Globals.setInCombat(true);

        assert.equal(Globals.inCombat, true);
        assert.equal(player.inCombat, true);
        const saved = player.toJSON();
        assert.equal(saved.inCombat, true);

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });
        const loaded = Player.fromJSON(saved);
        assert.equal(loaded.inCombat, true);

        Globals.currentPlayer = loaded;
        Globals.setInCombat(false);
        assert.equal(loaded.inCombat, false);
    });
});
