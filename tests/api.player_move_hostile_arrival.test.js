const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('direct player movement refreshes committed travel and exposes hostile-arrival failures with a backtrace', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const route = extractBlock(apiSource, "app.post('/api/player/move'", 'function resolveVehicleIconFromInfoForMap');
    const clientSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
    const helper = extractBlock(clientSource, 'async function performDirectMove', 'function collectExitEntries');

    const movementIndex = route.indexOf('currentPlayer.setLocation(destinationLocation.id);');
    const whileAwayIndex = route.indexOf('await runWhileYouWereAwayPrompt({', movementIndex);
    const hostileIndex = route.indexOf('await runLocationHostileArrival({', whileAwayIndex);
    const responseIndex = route.indexOf('arrivalProcessingError', hostileIndex);

    assert.ok(movementIndex !== -1, 'direct move should commit the destination');
    assert.ok(whileAwayIndex > movementIndex, 'WYWA story/event occupants should be applied after movement');
    assert.ok(hostileIndex > whileAwayIndex, 'hostile occupancy should be checked after WYWA processing');
    assert.ok(responseIndex > hostileIndex, 'the successful move response should report hostile-arrival failures');
    assert.match(route, /catch \(arrivalError\) \{[\s\S]*?arrivalProcessingError = \{[\s\S]*?message:[\s\S]*?stack:/);

    const displayIndex = helper.indexOf('await window.updateLocationDisplay(result.location);');
    const historyIndex = helper.indexOf('await window.AIRPG_CHAT?.refreshChatHistory?.();', displayIndex);
    const errorIndex = helper.indexOf('if (result.arrivalProcessingError)', historyIndex);
    assert.ok(displayIndex !== -1, 'client should refresh the destination after committed movement');
    assert.ok(historyIndex > displayIndex, 'client should refresh arrival chat after the destination');
    assert.ok(errorIndex > historyIndex, 'client should surface the arrival error after refreshing committed state');
    assert.match(helper, /result\.arrivalProcessingError\.stack/);
    assert.match(helper, /showChatErrorPopup/);
});

test('timed vehicle finalization waits for disembark before hostile arrival processing', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const vehicleFinalizer = extractBlock(
        apiSource,
        'const processDueVehicleArrivals = async () => {',
        'async function runmoveTurnResultEventChecks'
    );
    const directMoveRoute = extractBlock(apiSource, "app.post('/api/player/move'", 'function resolveVehicleIconFromInfoForMap');

    assert.doesNotMatch(vehicleFinalizer, /runLocationHostileArrival\(/);
    assert.match(directMoveRoute, /currentPlayer\.setLocation\(destinationLocation\.id\);[\s\S]*?runLocationHostileArrival\(/);
});

test('danger summaries omit effective values when the changed target is outside current context', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const summaryCase = extractBlock(apiSource, "case 'danger_level_change':", "case 'alter_npc':");

    assert.match(summaryCase, /typeof entry\.effectiveBefore === 'number'/);
    assert.match(summaryCase, /Number\.isFinite\(entry\.effectiveBefore\)/);
    assert.match(summaryCase, /typeof entry\.effectiveAfter === 'number'/);
    assert.doesNotMatch(summaryCase, /Number\.isFinite\(Number\(entry\.effectiveBefore\)\)/);
});

test('a disappeared pending faction invalidates the saved source before prompt generation', () => {
    const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
    const generator = extractBlock(
        serverSource,
        'async function generateHostilePresenceDrafts',
        'function constructHostilePresenceBatch'
    );

    assert.match(
        generator,
        /plan\.source === 'faction' && !faction[\s\S]*?throw new HostileArrivalInvalidatedError/
    );
});
