const test = require('node:test');
const assert = require('node:assert/strict');

const SceneSummaries = require('../SceneSummaies.js');
const {
    partitionBaseContextHistoryBySceneCoverage
} = require('../base_context_history.js');
const {
    loadBuildBasePromptContext
} = require('./helpers/baseContextFixtures.js');

function createSceneSummaryStore() {
    const sceneSummaries = new SceneSummaries();
    sceneSummaries.addSummaryResult({
        summarizedRange: { start: 1, end: 2 },
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
                summary: 'The stable summarized scene.'
            }
        ]
    });
    return sceneSummaries;
}

function createHistory() {
    return [
        { id: 'story-1', role: 'assistant', type: 'player-action', content: 'First old prose.' },
        { id: 'events-1', role: 'assistant', type: 'event-summary', content: 'Events after first prose.' },
        { id: 'story-2', role: 'assistant', type: 'player-action', content: 'Second old prose.' },
        { id: 'events-2', role: 'assistant', type: 'event-summary', content: 'Events after second prose.' },
        { id: 'story-3', role: 'assistant', type: 'player-action', content: 'First uncovered prose.' }
    ];
}

test('scene coverage partitions history at the stored contiguous boundary', () => {
    const historyEntries = createHistory();
    const result = partitionBaseContextHistoryBySceneCoverage({
        historyEntries,
        relevantHistory: historyEntries,
        sceneSummaries: createSceneSummaryStore(),
        maxSummarizedEntries: 100
    });

    assert.deepEqual(
        result.summaryCandidates.map(entry => entry.id),
        ['story-1', 'events-1', 'story-2']
    );
    assert.deepEqual(
        result.tailEntries.map(entry => entry.id),
        ['events-2', 'story-3']
    );
    assert.equal(result.summarizedThroughEntryId, 'story-2');
});

test('scene-mode base context keeps every uncovered entry raw instead of sliding a fixed tail', () => {
    const chatHistory = createHistory();
    const sceneSummaries = createSceneSummaryStore();
    const config = {
        summaries: {
            max_unsummarized_log_entries: 1,
            max_summarized_log_entries: 100
        },
        recent_history_turns: 0
    };
    const buildBasePromptContext = loadBuildBasePromptContext({
        chatHistory,
        config,
        sceneSummaries,
        saveMetadata: { summaryStyle: 'scene' }
    });

    const before = buildBasePromptContext().gameHistory;
    assert.match(before, /The stable summarized scene\./);
    assert.match(before, /Events after second prose\./);
    assert.match(before, /First uncovered prose\./);
    assert.doesNotMatch(before, /Events after first prose\./);

    chatHistory.push(
        { id: 'events-3', role: 'assistant', type: 'event-summary', content: 'Newest event summary.' },
        { id: 'story-4', role: 'assistant', type: 'player-action', content: 'Newest uncovered prose.' }
    );

    const after = buildBasePromptContext().gameHistory;
    assert.equal(after.startsWith(before), true);
    assert.match(after, /Newest event summary\./);
    assert.match(after, /Newest uncovered prose\./);
});

test('deleted scene-summary boundary leaves all remaining history uncovered', () => {
    const historyEntries = createHistory().filter(entry => entry.id !== 'story-2');
    const result = partitionBaseContextHistoryBySceneCoverage({
        historyEntries,
        relevantHistory: historyEntries,
        sceneSummaries: createSceneSummaryStore(),
        maxSummarizedEntries: 100
    });

    assert.equal(result.boundaryWasDeleted, true);
    assert.equal(result.coverageHasDeletedEntries, true);
    assert.equal(result.storedSummarizedThroughEntryId, 'story-2');
    assert.equal(result.summarizedThroughEntryId, null);
    assert.deepEqual(result.summaryCandidates, []);
    assert.deepEqual(result.tailEntries, historyEntries);
});

test('deleting every covered scene-summary entry leaves all remaining history uncovered', () => {
    const historyEntries = createHistory().filter(entry => !['story-1', 'story-2'].includes(entry.id));
    const result = partitionBaseContextHistoryBySceneCoverage({
        historyEntries,
        relevantHistory: historyEntries,
        sceneSummaries: createSceneSummaryStore(),
        maxSummarizedEntries: 100
    });

    assert.equal(result.boundaryWasDeleted, true);
    assert.equal(result.coverageHasDeletedEntries, true);
    assert.equal(result.summarizedThroughEntryId, null);
    assert.deepEqual(result.summaryCandidates, []);
    assert.deepEqual(result.tailEntries, historyEntries);
});
