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

test('/summarize check excludes event-summary and status-summary entries from scene-summary counts', async () => {
    const previousSceneSummaries = Globals.sceneSummaries;
    Globals.sceneSummaries = new SceneSummaries();

    try {
        initializeSlashCommands();
        const command = getSlashCommandModule('summarize');
        assert.ok(command, 'summarize command should be registered');

        const interaction = createInteraction({
            chatHistory: [
                { id: 'entry-1', role: 'user', type: 'player-action', content: 'Inspect the cellar.' },
                {
                    id: 'entry-2',
                    role: 'assistant',
                    type: 'event-summary',
                    summaryTitle: '🛠️ Location Modification Results',
                    content: '🛠️ Location Modification Results\nA door was added.'
                },
                {
                    id: 'entry-3',
                    role: 'assistant',
                    type: 'status-summary',
                    content: 'Status details.'
                },
                {
                    id: 'entry-4',
                    role: 'assistant',
                    type: 'while-you-were-away',
                    content: 'Update on Mara since the party last saw them: Mara reached the gate.'
                }
            ]
        });

        await command.execute(interaction, { range: 'check' });

        assert.equal(interaction.replies.length, 1);
        assert.equal(interaction.replies[0].ephemeral, false);
        assert.equal(interaction.replies[0].content, 'Unsummarized entries: 2 of 2.');
    } finally {
        Globals.sceneSummaries = previousSceneSummaries;
    }
});
