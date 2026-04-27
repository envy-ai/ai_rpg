const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('chat respond schedules party memory prompts without awaiting them', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('const respond = async (payload, statusCode = 200) => {');
    const endMatch = /try\s*\{\s*travelMetadata\s*=\s*normalizeTravelMetadata\(rawTravelMetadata\);/.exec(source.slice(start));
    const end = endMatch ? start + endMatch.index : -1;
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate /api/chat respond helper.');
    }

    const respondSource = source.slice(start, end);
    assert.doesNotMatch(respondSource, /await\s+processPartyMemoriesForCurrentTurn\s*\(/);
    assert.match(respondSource, /schedulePartyMemoriesForCurrentTurn\s*\(/);
});

function getApiFunctionSource(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    assert.notEqual(end, -1, `Unable to locate end marker ${endNeedle}`);
    return source.slice(start, end);
}

function countMatches(source, pattern) {
    return Array.from(source.matchAll(pattern)).length;
}

test('async disposition summaries aggregate per memory batch', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const locationChangeSource = getApiFunctionSource(
        source,
        'async function generateNpcMemoriesForLocationChange',
        '\n        async function processPartyMemoriesForCurrentTurn'
    );
    const currentTurnSource = getApiFunctionSource(
        source,
        'async function processPartyMemoriesForCurrentTurn',
        '\n        function schedulePartyMemoriesForCurrentTurn'
    );

    for (const functionSource of [locationChangeSource, currentTurnSource]) {
        assert.match(functionSource, /const aggregatedDispositionChanges = \[\];/);
        assert.match(functionSource, /appendAppliedDispositionChanges\(aggregatedDispositionChanges, dispositionChanges\);/);
        assert.equal(
            countMatches(functionSource, /recordDispositionPromptSummary\(\{/g),
            1,
            'Expected a single aggregated disposition summary write after memory tasks settle'
        );
        assert.ok(
            functionSource.indexOf('await Promise.allSettled(memoryTasks);')
                < functionSource.indexOf('recordDispositionPromptSummary({'),
            'Expected disposition summary recording after memory tasks settle'
        );
        assert.doesNotMatch(functionSource, /actorName:\s*(actor|member)\.name/);
    }

    assert.match(source, /label = safeActorName[\s\S]*'📋 Events – Disposition Check'/);
});
