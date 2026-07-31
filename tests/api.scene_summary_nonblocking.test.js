const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('automatic post-turn summary threshold check is fire-and-forget', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const randomEventStart = source.indexOf('const randomEventResult = await withProcessedMoveSuspended');
    const finalizeStart = source.indexOf('console.log(`Finalizing turns for all players', randomEventStart);
    assert.notEqual(randomEventStart, -1, 'Unable to locate random-event processing in /api/chat.');
    assert.notEqual(finalizeStart, -1, 'Unable to locate turn finalization after random-event processing.');

    const postRandomEventSource = source.slice(randomEventStart, finalizeStart);
    assert.doesNotMatch(postRandomEventSource, /await\s+summarizePendingEntriesIfThresholdReached\s*\(/);
    assert.match(postRandomEventSource, /void\s+summarizePendingEntriesIfThresholdReached\s*\(\)\s*\.catch\s*\(/);
    assert.match(postRandomEventSource, /stream\.emit\('summary_error'/);
    assert.match(postRandomEventSource, /stack:\s*summaryErrorStack/);
});
