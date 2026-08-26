const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

test('chat API validates and confirms haltAfterPlayerAction', () => {
    assert.match(apiSource, /haltAfterPlayerAction: rawHaltAfterPlayerAction/);
    assert.match(apiSource, /rawHaltAfterPlayerAction !== undefined && typeof rawHaltAfterPlayerAction !== 'boolean'/);
    assert.match(apiSource, /responseData\.haltedAfterPlayerAction = true/);
});

test('haltAfterPlayerAction returns before post-player scheduling and skips summarization', () => {
    const summaryGuard = apiSource.indexOf('if (aiResponseEntry && !haltAfterPlayerAction)');
    const earlyBoundary = apiSource.indexOf('if (haltAfterPlayerAction) {', summaryGuard);
    const plotScheduling = apiSource.indexOf('if (shouldRunPlotSummaryForThisTurn)', earlyBoundary);
    const eventChecks = apiSource.indexOf('const eventCheckPromise = Events.runEventChecks({', earlyBoundary);
    assert.ok(summaryGuard >= 0, 'expected chat-summary guard');
    assert.ok(earlyBoundary > summaryGuard, 'expected early boundary after response persistence');
    assert.ok(plotScheduling > earlyBoundary, 'expected early return before plot scheduling');
    assert.ok(eventChecks > earlyBoundary, 'expected early return before event checks');
    assert.match(apiSource.slice(earlyBoundary, plotScheduling), /corpseProcessingRan = true/);
    assert.match(apiSource.slice(earlyBoundary, plotScheduling), /return await respond\(responseData\)/);
});
