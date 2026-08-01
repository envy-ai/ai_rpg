const test = require('node:test');
const assert = require('node:assert/strict');

const {
    loadBuildBasePromptContext
} = require('./helpers/baseContextFixtures.js');

function appendTurn(chatHistory, turnNumber) {
    chatHistory.push(
        {
            id: `user-${turnNumber}`,
            role: 'user',
            content: `User action ${turnNumber}.`
        },
        {
            id: `prose-${turnNumber}`,
            role: 'assistant',
            type: 'player-action',
            content: `Assistant prose ${turnNumber}.`
        }
    );
}

test('base-context older history changes only at configured batch boundaries', () => {
    const chatHistory = [];
    const config = {
        prompt_uses_caching: true,
        recent_history_turns: 2,
        recent_history_batch_interval: 3,
        summaries: {
            max_unsummarized_log_entries: 100,
            max_summarized_log_entries: 0
        }
    };
    const buildBasePromptContext = loadBuildBasePromptContext({
        chatHistory,
        config,
        includeMysteryCleanup: true
    });

    for (let turn = 1; turn <= 4; turn += 1) {
        appendTurn(chatHistory, turn);
    }
    const beforeFirstRollover = buildBasePromptContext();
    assert.doesNotMatch(beforeFirstRollover.gameHistory, /Assistant prose 1\./);
    assert.match(beforeFirstRollover.recentGameHistory, /Assistant prose 1\./);
    assert.match(beforeFirstRollover.recentGameHistory, /Assistant prose 4\./);

    appendTurn(chatHistory, 5);
    const firstRollover = buildBasePromptContext();
    assert.match(firstRollover.gameHistory, /Assistant prose 1\./);
    assert.match(firstRollover.gameHistory, /Assistant prose 3\./);
    assert.doesNotMatch(firstRollover.gameHistory, /Assistant prose 4\./);
    assert.match(firstRollover.recentGameHistory, /Assistant prose 4\./);
    assert.match(firstRollover.recentGameHistory, /Assistant prose 5\./);

    appendTurn(chatHistory, 6);
    const oneTurnAfterRollover = buildBasePromptContext();
    assert.equal(oneTurnAfterRollover.gameHistory, firstRollover.gameHistory);

    appendTurn(chatHistory, 7);
    const twoTurnsAfterRollover = buildBasePromptContext();
    assert.equal(twoTurnsAfterRollover.gameHistory, firstRollover.gameHistory);

    appendTurn(chatHistory, 8);
    const secondRollover = buildBasePromptContext();
    assert.notEqual(secondRollover.gameHistory, firstRollover.gameHistory);
    assert.match(secondRollover.gameHistory, /Assistant prose 6\./);
    assert.doesNotMatch(secondRollover.gameHistory, /Assistant prose 7\./);
    assert.match(secondRollover.recentGameHistory, /Assistant prose 7\./);
    assert.match(secondRollover.recentGameHistory, /Assistant prose 8\./);
});

test('default config batches recent-history rollover every ten turns', () => {
    const fs = require('node:fs');
    const yaml = require('js-yaml');
    const defaultConfig = yaml.load(fs.readFileSync(require.resolve('../config.default.yaml'), 'utf8'));
    const serverSource = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const historySource = fs.readFileSync(require.resolve('../base_context_history.js'), 'utf8');

    assert.equal(defaultConfig.recent_history_batch_interval, 10);
    assert.match(
        historySource,
        /recent_history_batch_interval must be an integer greater than or equal to 1 when provided/
    );
    assert.match(
        serverSource,
        /resolveRecentHistoryBatchInterval\(config\.recent_history_batch_interval\)/
    );
});
