const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    countSceneSummaryIndexEntries,
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

test('automatic scene-summary threshold counter uses the shared scene-summary index', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    assert.match(apiSource, /countSceneSummaryIndexEntries\(entries\)/);
});
