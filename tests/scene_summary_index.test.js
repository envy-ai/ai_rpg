const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const SceneSummaries = require('../SceneSummaies.js');

const {
    countSceneSummaryIndexEntries,
    findDeletedCoveredSceneSummaryEntryIds,
    shouldIncludeEntryInSceneSummaryIndex
} = require('../scene_summary_index.js');

test('scene summary index excludes event and status summaries while preserving hidden story entries', () => {
    const entries = [
        { id: 'player-1', role: 'user', type: 'player-action', content: 'Inspect the cellar.' },
        {
            id: 'event-1',
            role: 'assistant',
            type: 'event-summary',
            summaryTitle: '🛠️ Location Modification Results',
            content: '🛠️ Location Modification Results\nA door was added.'
        },
        {
            id: 'status-1',
            role: 'assistant',
            type: 'status-summary',
            content: 'Status details.'
        },
        {
            id: 'away-1',
            role: 'assistant',
            type: 'while-you-were-away',
            content: 'Update on Mara since the party last saw them: Mara reached the gate.'
        }
    ];

    assert.equal(shouldIncludeEntryInSceneSummaryIndex(entries[1]), false);
    assert.equal(shouldIncludeEntryInSceneSummaryIndex(entries[2]), false);
    assert.equal(shouldIncludeEntryInSceneSummaryIndex(entries[3]), true);
    assert.equal(countSceneSummaryIndexEntries(entries), 2);
});

test('scene summary index excludes system and diagnostic entries', () => {
    assert.equal(
        shouldIncludeEntryInSceneSummaryIndex({
            id: 'system-1',
            role: 'system',
            type: 'tool-call-debug',
            content: 'Tool calls for player_action\n\n1. resolveSkillCheck\nStatus: completed'
        }),
        false
    );

    assert.equal(
        shouldIncludeEntryInSceneSummaryIndex({
            id: 'checks-1',
            role: 'assistant',
            type: 'check-results',
            content: 'Checks for player_action\n\n1. Test: Success',
            summary: 'Checks: 1 check, 1 complete, 0 errors.'
        }),
        false
    );
});

test('automatic scene-summary threshold counter uses the shared scene-summary index', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    assert.match(apiSource, /countSceneSummaryIndexEntries\(entries\)/);
    assert.match(apiSource, /invalidateSceneSummariesForDeletedHistoryEntries/);
});

test('scene summary deletion check reports missing entries only inside contiguous coverage', () => {
    const sceneSummaries = new SceneSummaries();
    sceneSummaries.addSummaryResult({
        summarizedRange: { start: 1, end: 2 },
        entryIndexMap: [
            { entryId: 'covered-1', index: 1 },
            { entryId: 'covered-2', index: 2 },
            { entryId: 'future-3', index: 3 }
        ],
        scenes: [{
            startIndex: 1,
            endIndex: 2,
            startEntryId: 'covered-1',
            endEntryId: 'covered-2',
            summary: 'Covered scene.'
        }]
    });

    assert.deepEqual(findDeletedCoveredSceneSummaryEntryIds([
        { id: 'covered-1' },
        { id: 'future-3' }
    ], sceneSummaries), ['covered-2']);
});
