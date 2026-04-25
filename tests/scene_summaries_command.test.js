const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const SceneSummaries = require('../SceneSummaies.js');
const {
    initializeSlashCommands,
    getSlashCommandModule
} = require('../SlashCommandRegistry.js');

function createInteraction({ chatHistory = [] } = {}) {
    const replies = [];
    return {
        replies,
        getChatHistory: () => chatHistory,
        reply: async (payload) => {
            replies.push(payload);
        }
    };
}

test('scene_summaries command is registered with an alias', () => {
    initializeSlashCommands();

    const command = getSlashCommandModule('scene_summaries');
    assert.ok(command, 'scene_summaries command should be registered');
    assert.equal(command, getSlashCommandModule('summary_ranges'));
});

test('scene_summaries command lists stored summaries by number and entry range', async () => {
    const previousSceneSummaries = Globals.sceneSummaries;
    const sceneSummaries = new SceneSummaries();
    sceneSummaries.addSummaryResult({
        entryIndexMap: [
            { entryId: 'entry-1', index: 1 },
            { entryId: 'entry-2', index: 2 },
            { entryId: 'entry-3', index: 3 },
            { entryId: 'entry-5', index: 5 }
        ],
        scenes: [
            {
                startIndex: 1,
                endIndex: 3,
                startEntryId: 'entry-1',
                endEntryId: 'entry-3',
                summary: 'The party discovers a hidden dock.'
            },
            {
                startIndex: 5,
                endIndex: 5,
                startEntryId: 'entry-5',
                endEntryId: 'entry-5',
                summary: 'Mara warns that the bridge is watched.'
            }
        ]
    });
    Globals.sceneSummaries = sceneSummaries;

    try {
        initializeSlashCommands();
        const command = getSlashCommandModule('scene_summaries');
        assert.ok(command, 'scene_summaries command should be registered');

        const interaction = createInteraction({
            chatHistory: [
                { id: 'entry-1', content: 'one' },
                { id: 'entry-2', content: 'two' },
                { id: 'entry-3', content: 'three' },
                { id: 'entry-4', content: 'four' },
                { id: 'entry-5', content: 'five' }
            ]
        });

        await command.execute(interaction);

        assert.equal(interaction.replies.length, 1);
        const reply = interaction.replies[0];
        assert.equal(reply.ephemeral, false);
        assert.match(reply.content, /## Scene Summaries/);
        assert.match(reply.content, /1\. Entries 1-3: The party discovers a hidden dock\./);
        assert.match(reply.content, /2\. Entry 5: Mara warns that the bridge is watched\./);
        assert.match(reply.content, /Coverage gaps: entry 4\./);
    } finally {
        Globals.sceneSummaries = previousSceneSummaries;
    }
});

test('scene_summaries command reports when no summaries are stored', async () => {
    const previousSceneSummaries = Globals.sceneSummaries;
    Globals.sceneSummaries = new SceneSummaries();

    try {
        initializeSlashCommands();
        const command = getSlashCommandModule('scene_summaries');
        assert.ok(command, 'scene_summaries command should be registered');

        const interaction = createInteraction({
            chatHistory: [{ id: 'entry-1', content: 'one' }]
        });

        await command.execute(interaction);

        assert.equal(interaction.replies.length, 1);
        assert.equal(interaction.replies[0].ephemeral, false);
        assert.match(interaction.replies[0].content, /No scene summaries are stored\./);
        assert.match(interaction.replies[0].content, /Coverage gaps: entry 1\./);
    } finally {
        Globals.sceneSummaries = previousSceneSummaries;
    }
});
