const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../Player.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-player-disposition-'
    }, run);
}

test('NPC behavioral disposition persists and appears in status', () => {
    withTempPlayerEnvironment(() => {
        const disposition = 'flees if approached; attacks only if cornered';
        const npc = new Player({
            id: 'disposition-npc',
            name: 'Moss Deer',
            isNPC: true,
            disposition: `  ${disposition}\r\n`
        });

        assert.equal(npc.disposition, disposition);
        assert.equal(npc.getStatus().disposition, disposition);
        assert.equal(npc.toJSON().disposition, disposition);

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(npc.toJSON());
        assert.equal(loaded.disposition, disposition);
        assert.equal(loaded.toJSON().disposition, disposition);
    });
});

test('literal N/A NPC dispositions persist while blanks normalize to no stored value', () => {
    withTempPlayerEnvironment(() => {
        const npc = new Player({
            id: 'sentient-disposition-npc',
            name: 'Archivist',
            isNPC: true,
            disposition: ' N/A '
        });

        assert.equal(npc.disposition, 'N/A');
        assert.equal(npc.toJSON().disposition, 'N/A');

        const loaded = Player.fromJSON(npc.toJSON());
        assert.equal(loaded.disposition, 'N/A');
        assert.equal(loaded.toJSON().disposition, 'N/A');

        npc.disposition = '   ';
        assert.equal(npc.disposition, null);
    });
});

test('NPC disposition rejects non-string values', () => {
    withTempPlayerEnvironment(() => {
        assert.throws(
            () => new Player({
                id: 'invalid-disposition-npc',
                name: 'Invalid Creature',
                isNPC: true,
                disposition: { behavior: 'aggressive' }
            }),
            /NPC disposition must be a string/
        );
    });
});
