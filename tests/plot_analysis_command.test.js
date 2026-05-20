const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const {
    initializeSlashCommands,
    getSlashCommandModule
} = require('../SlashCommandRegistry.js');

function createPlotAnalysisFixture() {
    return {
        raw: '- Find the missing courier.\n\n<response></response>',
        updatedAt: '2026-05-20T12:00:00.000Z',
        plotThreads: [
            {
                description: 'Find the missing courier before the trail goes cold.',
                isCurrentFocus: true
            },
            {
                description: 'Track the smugglers working the river gate.',
                isCurrentFocus: false
            }
        ],
        currentPlotComplications: [
            { description: 'Find the missing courier.' },
            { description: 'Get access to the locked customs ledger.' }
        ]
    };
}

function createInteraction() {
    const replies = [];
    return {
        replies,
        reply: async (payload) => {
            replies.push(payload);
        }
    };
}

test('plot_analysis command is registered', () => {
    initializeSlashCommands();

    const command = getSlashCommandModule('plot_analysis');
    assert.ok(command, 'plot_analysis command should be registered');
});

test('plot_analysis command prints the current global as readable markdown', async () => {
    const previous = typeof Globals.getPlotAnalysis === 'function'
        ? Globals.getPlotAnalysis()
        : null;

    try {
        Globals.setPlotAnalysis(createPlotAnalysisFixture());

        initializeSlashCommands();
        const command = getSlashCommandModule('plot_analysis');
        assert.ok(command, 'plot_analysis command should be registered');

        const interaction = createInteraction();
        await command.execute(interaction, {});

        assert.equal(interaction.replies.length, 1);
        const reply = interaction.replies[0];
        assert.equal(reply.ephemeral, false);
        assert.match(reply.content, /^## Plot Analysis/m);
        assert.match(reply.content, /Updated: 2026-05-20T12:00:00\.000Z/);
        assert.match(reply.content, /### Active Plot Threads/);
        assert.match(reply.content, /- \*\*\[current\]\*\* Find the missing courier before the trail goes cold\./);
        assert.match(reply.content, /- Track the smugglers working the river gate\./);
        assert.match(reply.content, /### Current Plot Complications/);
        assert.match(reply.content, /1\. Find the missing courier\./);
        assert.match(reply.content, /2\. Get access to the locked customs ledger\./);
    } finally {
        if (typeof Globals.setPlotAnalysis === 'function') {
            Globals.setPlotAnalysis(previous);
        }
    }
});

test('plot_analysis command reports when no analysis has completed yet', async () => {
    const previous = typeof Globals.getPlotAnalysis === 'function'
        ? Globals.getPlotAnalysis()
        : null;

    try {
        Globals.setPlotAnalysis(null);

        initializeSlashCommands();
        const command = getSlashCommandModule('plot_analysis');
        assert.ok(command, 'plot_analysis command should be registered');

        const interaction = createInteraction();
        await command.execute(interaction, {});

        assert.equal(interaction.replies.length, 1);
        assert.equal(interaction.replies[0].ephemeral, false);
        assert.match(interaction.replies[0].content, /No plot analysis is available yet\./);
    } finally {
        if (typeof Globals.setPlotAnalysis === 'function') {
            Globals.setPlotAnalysis(previous);
        }
    }
});
