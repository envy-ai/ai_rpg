const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('scene summarize all rebuilds from entry one and atomically replaces mappings', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function summarizeScenesForHistoryRange');
    const end = source.indexOf('Globals.summarizeScenesForHistoryRange = summarizeScenesForHistoryRange;', start);
    assert.notEqual(start, -1, 'Unable to find scene summary range function.');
    assert.notEqual(end, -1, 'Unable to find scene summary range function end.');
    const functionSource = source.slice(start, end);

    assert.match(
        functionSource,
        /if \(isAllRange\) \{\s*parsedStart = 1;\s*parsedEnd = totalEntries;\s*\}/
    );
    assert.match(functionSource, /if \(redo && !isAllRange\)/);
    assert.match(
        functionSource,
        /if \(isAllRange\) \{[\s\S]*sceneSummaries\.replaceWithSummaryResult\(summaryResult\);/
    );
});

test('scene summarization preserves requested leading coverage and plans redo transactionally', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function summarizeScenesForHistoryRange');
    const end = source.indexOf('Globals.summarizeScenesForHistoryRange = summarizeScenesForHistoryRange;', start);
    assert.notEqual(start, -1, 'Unable to find scene summary range function.');
    assert.notEqual(end, -1, 'Unable to find scene summary range function end.');
    const functionSource = source.slice(start, end);

    assert.match(functionSource, /const summarizedStartIndex = parsedStart;/);
    assert.match(
        functionSource,
        /const sceneStartIndex = i === 0 \? summarizedStartIndex : scene\.startIndex;/
    );
    assert.doesNotMatch(functionSource, /const summarizedStartIndex = orderedScenes\[0\]\.startIndex;/);
    assert.match(functionSource, /const stagedSceneSummaries = new SceneSummaries\(\);/);
    assert.match(
        functionSource,
        /const redoEnd = Math\.min\(totalEntries, removedRange\.end \+ extraSpan\);/
    );
    assert.doesNotMatch(
        functionSource,
        /sceneSummaries\.deleteSummariesOverlappingRange\(parsedStart, parsedEnd\)/
    );
});
