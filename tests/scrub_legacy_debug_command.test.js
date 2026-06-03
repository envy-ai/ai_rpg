const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const SceneSummaries = require('../SceneSummaies.js');
const ScrubLegacyDebugCommand = require('../slashcommands/scrub_legacy_debug.js');

async function runCommand({ chatHistory, sceneSummaries, args = {} }) {
    const replies = [];
    const saves = [];
    const emits = [];
    const previousSceneSummaries = Globals.sceneSummaries;
    const previousRealtimeHub = Globals.realtimeHub;

    Globals.sceneSummaries = sceneSummaries;
    Globals.realtimeHub = {
        emit: (...emitArgs) => {
            emits.push(emitArgs);
        }
    };

    try {
        await ScrubLegacyDebugCommand.execute({
            getChatHistory: () => chatHistory,
            performGameSave: async () => {
                saves.push(true);
            },
            reply: async (payload) => {
                replies.push(payload);
            }
        }, args);
    } finally {
        Globals.sceneSummaries = previousSceneSummaries;
        Globals.realtimeHub = previousRealtimeHub;
    }

    return { replies, saves, emits };
}

function buildSceneSummaries() {
    const sceneSummaries = new SceneSummaries();
    sceneSummaries.addSummaryResult({
        entryIndexMap: [
            { entryId: 'story-1', index: 1 },
            { entryId: 'story-2', index: 2 }
        ],
        scenes: [
            {
                startIndex: 1,
                endIndex: 2,
                startEntryId: 'story-1',
                endEntryId: 'story-2',
                summary: [
                    'Scene summary text.',
                    'Checks: 1 check, 1 complete, 0 errors.',
                    'Tool call debug: 2 calls, 2 complete, 0 errors.',
                    'More summary text.'
                ].join('\n'),
                details: [
                    'Real detail.',
                    'Checks: 3 checks, 2 complete, 1 error.',
                    'Tool call debug: 1 call, 1 complete, 0 errors.'
                ],
                quotes: [
                    { character: 'Storyteller', text: 'Keep this quote.' }
                ]
            }
        ]
    });
    return sceneSummaries;
}

test('scrub_legacy_debug removes standalone diagnostic entries and embedded debug lines', async () => {
    const chatHistory = [
        {
            id: 'debug-1',
            type: 'tool-call-debug',
            role: 'system',
            content: 'Tool calls for player_action\n\n1. resolveSkillCheck\nStatus: completed',
            summary: 'Tool call debug: 1 call, 1 complete, 0 errors.'
        },
        {
            id: 'story-1',
            role: 'assistant',
            content: [
                'Story prose.',
                'Checks: 1 check, 1 complete, 0 errors.',
                'Tool call debug: 1 call, 1 complete, 0 errors.',
                'More story prose.'
            ].join('\n')
        },
        {
            id: 'system-keep',
            role: 'system',
            content: 'Non-debug system note that should remain.'
        },
        {
            id: 'checks-1',
            type: 'check-results',
            role: 'assistant',
            content: 'Checks for npc_action\n\n1. Computers: Success',
            summary: 'Checks: 1 check, 1 complete, 0 errors.'
        }
    ];
    const sceneSummaries = buildSceneSummaries();

    const result = await runCommand({ chatHistory, sceneSummaries });

    assert.deepEqual(chatHistory.map(entry => entry.id), ['story-1', 'system-keep']);
    assert.equal(chatHistory[0].content, 'Story prose.\nMore story prose.');
    assert.match(chatHistory[0].lastEditedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(chatHistory[1].content, 'Non-debug system note that should remain.');

    const [scene] = sceneSummaries.getScenesInOrder();
    assert.equal(scene.summary, 'Scene summary text.\nMore summary text.');
    assert.deepEqual(scene.details, ['Real detail.']);
    assert.deepEqual(scene.quotes, [{ character: 'Storyteller', text: 'Keep this quote.' }]);

    assert.equal(result.saves.length, 1);
    assert.equal(result.emits[0][1], 'chat_history_updated');
    assert.deepEqual(result.emits[0][2].removedEntryIds, ['debug-1', 'checks-1']);
    assert.deepEqual(result.emits[0][2].modifiedEntryIds, ['story-1']);
    assert.match(result.replies[0].content, /Removed 2 standalone diagnostic chat entries/);
    assert.match(result.replies[0].content, /scrubbed 1 chat entry/);
    assert.match(result.replies[0].content, /scrubbed 1 scene summary/);
});

test('scrub_legacy_debug dry_run reports without mutating or saving', async () => {
    const chatHistory = [
        {
            id: 'debug-1',
            type: 'tool-call-debug',
            role: 'system',
            content: 'Tool calls for player_action\n\n1. resolveSkillCheck\nStatus: completed'
        },
        {
            id: 'story-1',
            role: 'assistant',
            content: 'Story prose.\nChecks: 1 check, 1 complete, 0 errors.'
        }
    ];
    const originalChatHistory = JSON.stringify(chatHistory);
    const sceneSummaries = buildSceneSummaries();
    const originalSceneSummaries = JSON.stringify(sceneSummaries.serialize());

    const result = await runCommand({
        chatHistory,
        sceneSummaries,
        args: { dry_run: true }
    });

    assert.equal(JSON.stringify(chatHistory), originalChatHistory);
    assert.equal(JSON.stringify(sceneSummaries.serialize()), originalSceneSummaries);
    assert.equal(result.saves.length, 0);
    assert.equal(result.emits.length, 0);
    assert.match(result.replies[0].content, /^Dry run:/);
    assert.match(result.replies[0].content, /would remove 1 standalone diagnostic chat entry/);
    assert.match(result.replies[0].content, /scrub 1 chat entry/);
    assert.match(result.replies[0].content, /scrub 1 scene summary/);
});
