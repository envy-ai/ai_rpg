const test = require('node:test');
const assert = require('node:assert/strict');

const {
    formatSceneSummaryRangeError
} = require('../scene_summary_diagnostics.js');

test('scene summary range errors include scalar call context', () => {
    const message = formatSceneSummaryRangeError({
        totalEntries: 676,
        startIndex: 278,
        endIndex: 701,
        redo: false,
        parsedStart: 278,
        parsedEnd: 701
    });

    assert.equal(
        message,
        'Scene summary range must be within 1-676. Called with startIndex=278, endIndex=701, redo=false; resolved range=278-701; indexed entries=676.'
    );
});

test('scene summary range errors format all-range calls without dumping history', () => {
    const message = formatSceneSummaryRangeError({
        totalEntries: 120,
        startIndex: 'all',
        endIndex: 'all',
        redo: true,
        parsedStart: 1,
        parsedEnd: 140
    });

    assert.match(message, /Called with startIndex="all", endIndex="all", redo=true/);
    assert.match(message, /resolved range=1-140/);
    assert.doesNotMatch(message, /chatHistory/);
});
