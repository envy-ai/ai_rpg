const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Player = require('../Player.js');
const Thing = require('../Thing.js');
const { applyRegexReplace } = require('../regex_replace_runtime.js');
const RegexReplaceCommand = require('../slashcommands/regex_replace.js');

async function runRegexReplace(args, chatHistory, {
    players = [],
    locations = [],
    things = []
} = {}) {
    const replies = [];
    const saves = [];
    const emits = [];
    const previousRealtimeHub = Globals.realtimeHub;
    const previousPlayerGetAll = Player.getAll;
    const previousLocationGetAll = Location.getAll;
    const previousThingGetAll = Thing.getAll;
    Globals.realtimeHub = {
        emit: (...emitArgs) => {
            emits.push(emitArgs);
        }
    };
    Player.getAll = () => players;
    Location.getAll = () => locations;
    Thing.getAll = () => things;

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
        Player.getAll = previousPlayerGetAll;
        Location.getAll = previousLocationGetAll;
        Thing.getAll = previousThingGetAll;
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

test('regex_replace updates memories and allowlisted NPC, location, and item text fields', async () => {
        const region = {
            id: 'regex-region',
            name: 'Red March',
            description: 'Region fields are outside the regex replacement allowlist.'
        };
        const location = {
            id: 'regex-location',
            name: 'Red Hall',
            description: 'A red hall.',
            shortDescription: 'Red stone.'
        };
        const npc = {
            id: 'regex-npc',
            name: 'Red Keeper',
            isNPC: true,
            description: 'A red-robed keeper.',
            shortDescription: 'Red-robed keeper.',
            personalityNotes: 'Prefers red banners.',
            personalityType: '',
            personalityTraits: '',
            aiNotes: '',
            resistances: '',
            vulnerabilities: '',
            importantMemories: ['Saw the red comet.']
        };
        const item = {
            id: 'regex-item',
            name: 'Red Key',
            description: 'A red iron key.',
            shortDescription: 'Red key.'
        };
        const chatHistory = [{ id: 'entry-world', content: 'The red door opens.' }];

        const result = await runRegexReplace({
            pattern: 'red',
            replacement: 'blue',
            flags: 'gi'
        }, chatHistory, {
            players: [npc],
            locations: [location],
            things: [item]
        });

        assert.equal(chatHistory[0].content, 'The blue door opens.');
        assert.deepEqual(npc.importantMemories, ['Saw the blue comet.']);
        assert.equal(npc.description, 'A blue-robed keeper.');
        assert.equal(npc.shortDescription, 'blue-robed keeper.');
        assert.equal(npc.personalityNotes, 'Prefers blue banners.');
        assert.equal(location.description, 'A blue hall.');
        assert.equal(location.shortDescription, 'blue stone.');
        assert.equal(item.description, 'A blue iron key.');
        assert.equal(item.shortDescription, 'blue key.');
        assert.equal(npc.name, 'Red Keeper');
        assert.equal(location.name, 'Red Hall');
        assert.equal(item.name, 'Red Key');
        assert.equal(region.name, 'Red March');
        assert.equal(result.saves.length, 1);
        assert.equal(result.emits[0][2].modifiedMemories, 1);
        assert.equal(result.emits[0][2].modifiedNpcFields, 3);
        assert.equal(result.emits[0][2].modifiedLocationFields, 2);
        assert.equal(result.emits[0][2].modifiedItemFields, 2);
        assert.equal(result.emits[0][2].totalReplacements, 9);
});

test('regex_replace memories scope leaves story and NPC descriptive fields unchanged', async () => {
        const npc = {
            id: 'regex-memory-npc',
            name: 'Keeper',
            isNPC: true,
            description: 'A red keeper.',
            importantMemories: ['Saw the red comet.']
        };
        const chatHistory = [{ id: 'entry-memory-scope', content: 'The red door opens.' }];

        const result = await runRegexReplace({
            pattern: 'red',
            replacement: 'blue',
            flags: 'g',
            scope: 'memories'
        }, chatHistory, { players: [npc] });

        assert.equal(chatHistory[0].content, 'The red door opens.');
        assert.equal(npc.description, 'A red keeper.');
        assert.deepEqual(npc.importantMemories, ['Saw the blue comet.']);
        assert.equal(result.emits[0][2].modifiedMemories, 1);
        assert.equal(result.emits[0][2].modifiedEntries, 0);
});

test('regex replacement validates the full batch before applying any mutation', () => {
    const chatHistory = [{ id: 'atomic-entry', content: 'red' }];
    const item = {
        id: 'atomic-item',
        description: 'red',
        shortDescription: 'red marker'
    };

    assert.throws(
        () => applyRegexReplace({
            pattern: 'red',
            replacement: '',
            flags: 'g',
            chatHistory,
            players: [],
            locations: [],
            things: [item]
        }),
        /would erase the required description for item atomic-item/
    );
    assert.equal(chatHistory[0].content, 'red');
    assert.equal(item.description, 'red');
    assert.equal(item.shortDescription, 'red marker');
});
