const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../Player.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-player-ai-notes-'
    }, run);
}

test('aiNotes persist and appear in player status', () => {
    withTempPlayerEnvironment(() => {
        const npc = new Player({
            id: 'ai-notes-npc',
            name: 'Mira',
            isNPC: true,
            aiNotes: 'Mira will intervene if an ally is bleeding.'
        });

        assert.equal(npc.aiNotes, 'Mira will intervene if an ally is bleeding.');

        const status = npc.getStatus();
        assert.equal(status.aiNotes, 'Mira will intervene if an ally is bleeding.');
        assert.equal(status.personality.aiNotes, 'Mira will intervene if an ally is bleeding.');

        const saved = npc.toJSON();
        assert.equal(saved.aiNotes, 'Mira will intervene if an ally is bleeding.');
        assert.equal(saved.personality.aiNotes, 'Mira will intervene if an ally is bleeding.');

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(saved);
        assert.equal(loaded.aiNotes, 'Mira will intervene if an ally is bleeding.');
        assert.equal(loaded.toJSON().aiNotes, 'Mira will intervene if an ally is bleeding.');
    });
});

test('legacy nested personality aiNotes hydrate when top-level aiNotes is missing', () => {
    withTempPlayerEnvironment(() => {
        const loaded = Player.fromJSON({
            id: 'nested-ai-notes-npc',
            name: 'Tovan',
            isNPC: true,
            personality: {
                aiNotes: 'Tovan flees if outnumbered.'
            }
        });

        assert.equal(loaded.aiNotes, 'Tovan flees if outnumbered.');
    });
});
