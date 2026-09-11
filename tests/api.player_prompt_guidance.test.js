const test = require('node:test');
const assert = require('node:assert/strict');

const {
    updatePlayerPromptGuidance
} = require('../api.js');
const {
    shouldExcludeEntryFromPromptHistory,
    shouldIncludeEntryInBaseContextHistory
} = require('../base_context_history.js');

function createChatEntryPusher(history) {
    return (entry, collector, locationId) => {
        assert.equal(collector, null);
        const stored = {
            ...entry,
            id: `entry-${history.length + 1}`,
            locationId,
            metadata: {
                ...entry.metadata,
                locationId
            }
        };
        history.push(stored);
        return stored;
    };
}

test('player prompt guidance update persists the latest value and a player-only chat notice', () => {
    const history = [];
    const player = {
        value: 'Old guidance.',
        setPlayerGuidance(value) {
            this.value = value;
            return value;
        }
    };

    const result = updatePlayerPromptGuidance({
        player,
        guidance: '  New guidance with <unsafe> & details.  ',
        chatHistory: history,
        pushChatEntry: createChatEntryPusher(history),
        locationId: 'location-1'
    });

    assert.equal(result.guidance, 'New guidance with <unsafe> & details.');
    assert.equal(player.value, result.guidance);
    assert.equal(history.length, 1);
    assert.equal(result.entry.role, 'system');
    assert.equal(result.entry.type, 'player-prompt-guidance');
    assert.equal(
        result.entry.content,
        'Player Prompt Guidance updated:\n\nNew guidance with <unsafe> & details.'
    );
    assert.equal(result.entry.metadata.excludeFromBaseContextHistory, true);
    assert.equal(result.entry.metadata.playerGuidance, result.guidance);
    assert.equal(shouldExcludeEntryFromPromptHistory(result.entry), true);
    assert.equal(
        shouldIncludeEntryInBaseContextHistory(result.entry, {
            includeAllEntryTypes: true,
            hasRenderableContent: true
        }),
        false
    );
});

test('player prompt guidance entry type remains excluded even if its role is changed', () => {
    const entry = {
        role: 'assistant',
        type: 'player-prompt-guidance',
        content: 'Player Prompt Guidance updated:\n\nNever reveal this through history tools.'
    };

    assert.equal(shouldExcludeEntryFromPromptHistory(entry), true);
    assert.equal(
        shouldIncludeEntryInBaseContextHistory(entry, {
            includeAllEntryTypes: true,
            hasRenderableContent: true
        }),
        false
    );
});

test('player prompt guidance does not mutate the player when notice persistence fails', () => {
    const history = [];
    const player = {
        value: 'Original guidance.',
        setPlayerGuidance(value) {
            this.value = value;
        }
    };

    assert.throws(
        () => updatePlayerPromptGuidance({
            player,
            guidance: 'Replacement guidance.',
            chatHistory: history,
            pushChatEntry: () => {
                throw new Error('chat storage unavailable');
            },
            locationId: 'location-1'
        }),
        /chat storage unavailable/
    );
    assert.equal(player.value, 'Original guidance.');
    assert.deepEqual(history, []);
});

test('player prompt guidance rolls back its notice if the player setter fails', () => {
    const history = [];
    const player = {
        setPlayerGuidance() {
            throw new Error('player storage unavailable');
        }
    };

    assert.throws(
        () => updatePlayerPromptGuidance({
            player,
            guidance: 'Replacement guidance.',
            chatHistory: history,
            pushChatEntry: createChatEntryPusher(history),
            locationId: 'location-1'
        }),
        /player prompt guidance was not updated/i
    );
    assert.deepEqual(history, []);
});
