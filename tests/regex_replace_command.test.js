const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const RegexReplaceCommand = require('../slashcommands/regex_replace.js');

async function runRegexReplace(args, chatHistory) {
    const replies = [];
    const saves = [];
    const emits = [];
    const previousRealtimeHub = Globals.realtimeHub;
    Globals.realtimeHub = {
        emit: (...emitArgs) => {
            emits.push(emitArgs);
        }
    };

    try {
        await RegexReplaceCommand.execute({
            chatHistory,
            performGameSave: async () => {
                saves.push(true);
            },
            reply: async (payload) => {
                replies.push(payload);
            }
        }, args);
    } finally {
        Globals.realtimeHub = previousRealtimeHub;
    }

    return { replies, saves, emits };
}

test('regex_replace accepts an empty replacement string', async () => {
    const chatHistory = [
        { id: 'entry-1', content: 'red fish, red fish' },
        { id: 'entry-2', content: 'blue fish' }
    ];

    const result = await runRegexReplace({
        pattern: 'red\\s*',
        replacement: '',
        flags: 'g'
    }, chatHistory);

    assert.equal(chatHistory[0].content, 'fish, fish');
    assert.equal(chatHistory[1].content, 'blue fish');
    assert.match(chatHistory[0].lastEditedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(result.saves.length, 1);
    assert.equal(result.replies[0].content, 'Replaced 2 occurrence(s) in 1 message(s). Changes have been saved.');
    assert.equal(result.emits[0][1], 'chat_history_updated');
    assert.deepEqual(result.emits[0][2].modifiedEntryIds, ['entry-1']);
});

test('regex_replace treats a null replacement as empty text', async () => {
    const chatHistory = [
        { id: 'entry-1', content: 'Remove NULL markers NULL.' }
    ];

    const result = await runRegexReplace({
        pattern: '\\s*NULL',
        replacement: null,
        flags: 'g'
    }, chatHistory);

    assert.equal(chatHistory[0].content, 'Remove markers.');
    assert.equal(result.saves.length, 1);
    assert.equal(result.replies[0].content, 'Replaced 2 occurrence(s) in 1 message(s). Changes have been saved.');
});

test('regex_replace scope limits replacements to one chat entry type', async () => {
    const chatHistory = [
        { id: 'entry-1', type: 'player-action', content: 'red fish, red fish' },
        { id: 'entry-2', type: 'assistant', content: 'red fish' },
        { id: 'entry-3', type: 'player-action', content: 'blue fish' }
    ];

    const result = await runRegexReplace({
        pattern: 'red',
        replacement: 'gold',
        flags: 'g',
        scope: 'player-action'
    }, chatHistory);

    assert.equal(chatHistory[0].content, 'gold fish, gold fish');
    assert.equal(chatHistory[1].content, 'red fish');
    assert.equal(chatHistory[2].content, 'blue fish');
    assert.match(chatHistory[0].lastEditedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(chatHistory[1].lastEditedAt, undefined);
    assert.equal(result.saves.length, 1);
    assert.equal(result.replies[0].content, 'Replaced 2 occurrence(s) in 1 message(s). Changes have been saved.');
    assert.deepEqual(result.emits[0][2].modifiedEntryIds, ['entry-1']);
});

test('regex_replace omitted scope preserves all-entry behavior', async () => {
    const chatHistory = [
        { id: 'entry-1', type: 'player-action', content: 'red fish' },
        { id: 'entry-2', type: 'assistant', content: 'red fish' }
    ];

    const result = await runRegexReplace({
        pattern: 'red',
        replacement: 'gold',
        flags: 'g'
    }, chatHistory);

    assert.equal(chatHistory[0].content, 'gold fish');
    assert.equal(chatHistory[1].content, 'gold fish');
    assert.equal(result.saves.length, 1);
    assert.equal(result.replies[0].content, 'Replaced 2 occurrence(s) in 2 message(s). Changes have been saved.');
    assert.deepEqual(result.emits[0][2].modifiedEntryIds, ['entry-1', 'entry-2']);
});

test('regex_replace validation accepts null replacement but still requires the argument', () => {
    assert.deepEqual(RegexReplaceCommand.validateArgs({
        pattern: 'x',
        replacement: null
    }), []);

    assert.deepEqual(RegexReplaceCommand.validateArgs({
        pattern: 'x'
    }), ['Missing required argument: replacement']);
});
