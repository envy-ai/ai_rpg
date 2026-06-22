const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const ClearToolCallDebugCommand = require('../slashcommands/clear_tool_call_debug.js');

async function runCommand({ chatHistory }) {
    const replies = [];
    const saves = [];
    const emits = [];
    const previousRealtimeHub = Globals.realtimeHub;

    Globals.realtimeHub = {
        emit: (...args) => emits.push(args)
    };

    try {
        await ClearToolCallDebugCommand.execute({
            getChatHistory: () => chatHistory,
            performGameSave: async () => {
                saves.push(true);
            },
            reply: async (payload) => {
                replies.push(payload);
            }
        });
    } finally {
        Globals.realtimeHub = previousRealtimeHub;
    }

    return { replies, saves, emits };
}

test('clear_tool_call_debug removes only tool-call debug entries and requests page reload', async () => {
    const chatHistory = [
        { id: 'story-1', type: 'player-action', role: 'assistant', content: 'Story.' },
        { id: 'debug-1', type: 'tool-call-debug', role: 'system', content: 'Tool calls for player_action' },
        { id: 'checks-1', type: 'check-results', role: 'assistant', content: 'Checks.' },
        { id: 'debug-2', type: ' tool-call-debug ', role: 'system', content: 'Tool calls for housekeeping' }
    ];

    const result = await runCommand({ chatHistory });

    assert.deepEqual(chatHistory.map(entry => entry.id), ['story-1', 'checks-1']);
    assert.equal(result.saves.length, 1);
    assert.equal(result.emits.length, 1);
    assert.equal(result.emits[0][1], 'chat_history_updated');
    assert.deepEqual(result.emits[0][2], {
        removedEntryIds: ['debug-2', 'debug-1'],
        removedEntries: 2
    });
    assert.deepEqual(result.replies, [{
        content: 'Removed 2 tool-call debug entries from chat history. Reloading page...',
        ephemeral: false,
        action: {
            type: 'reload_page',
            delayMs: 250
        }
    }]);
});

test('clear_tool_call_debug reports zero removals and still requests page reload without saving', async () => {
    const chatHistory = [
        { id: 'story-1', type: 'player-action', role: 'assistant', content: 'Story.' },
        { id: 'checks-1', type: 'check-results', role: 'assistant', content: 'Checks.' }
    ];

    const result = await runCommand({ chatHistory });

    assert.deepEqual(chatHistory.map(entry => entry.id), ['story-1', 'checks-1']);
    assert.equal(result.saves.length, 0);
    assert.equal(result.emits.length, 0);
    assert.deepEqual(result.replies, [{
        content: 'Removed 0 tool-call debug entries from chat history. Reloading page...',
        ephemeral: false,
        action: {
            type: 'reload_page',
            delayMs: 250
        }
    }]);
});

test('clear_tool_call_debug exposes expected aliases', () => {
    assert.deepEqual(ClearToolCallDebugCommand.aliases, ['clear_tool_calls', 'clear_tool_debug']);
});
