const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../Player.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-player-prompt-guidance-'
    }, run);
}

test('player prompt guidance normalizes, reports, and survives save roundtrips', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'guided-player',
            name: 'Guided Player',
            playerGuidance: '  Favor tense ruins.\r\nLet rivals negotiate.  '
        });

        const expected = 'Favor tense ruins.\nLet rivals negotiate.';
        assert.equal(player.playerGuidance, expected);
        assert.equal(player.getPlayerGuidance(), expected);
        assert.equal(player.getStatus().playerGuidance, expected);
        assert.equal(player.toJSON().playerGuidance, expected);

        const firstUpdatedAt = player.lastUpdated;
        assert.equal(player.setPlayerGuidance('  Keep travel dangerous.  '), 'Keep travel dangerous.');
        assert.equal(player.playerGuidance, 'Keep travel dangerous.');
        assert.notEqual(player.lastUpdated, undefined);
        assert.ok(player.lastUpdated >= firstUpdatedAt);

        const saved = player.toJSON();
        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(saved);
        assert.equal(loaded.playerGuidance, 'Keep travel dangerous.');
        assert.equal(loaded.toJSON().playerGuidance, 'Keep travel dangerous.');
    });
});

test('old saves without player guidance hydrate as blank', () => {
    withTempPlayerEnvironment(() => {
        const loaded = Player.fromJSON({
            id: 'legacy-guidance-player',
            name: 'Legacy Player',
            isNPC: false
        });

        assert.equal(loaded.playerGuidance, '');
        assert.equal(loaded.getStatus().playerGuidance, '');
        assert.equal(loaded.toJSON().playerGuidance, '');
    });
});

test('player prompt guidance rejects non-string values', () => {
    withTempPlayerEnvironment(() => {
        assert.throws(
            () => new Player({
                id: 'invalid-guidance-player',
                name: 'Invalid Guidance Player',
                playerGuidance: { instruction: 'not text' }
            }),
            /player guidance must be a string/i
        );

        const player = new Player({
            id: 'setter-guidance-player',
            name: 'Setter Guidance Player'
        });
        assert.throws(
            () => player.setPlayerGuidance(['not text']),
            /player guidance must be a string/i
        );
        assert.equal(player.playerGuidance, '');
    });
});
