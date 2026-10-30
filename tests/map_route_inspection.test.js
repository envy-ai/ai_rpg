const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('fast-travel preview exposes explicit hidden-safe availability outcomes', () => {
    const source = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
    assert.match(source, /code: 'NO_KNOWN_ROUTE',[\s\S]*?message: 'No known route is currently available\.'/);
    assert.match(source, /travelTimeMinutes = route \? route\.travelTimeMinutes : null/);
    assert.match(source, /canFastTravel = reachable && blockingReason === null/);
    assert.match(source, /canExpandLocation\(location, \{ endLocation \}\)[\s\S]*?location\?\.isStub !== true/);
    assert.match(source, /shouldHideVehicleExitFromList\(\{/);
    assert.doesNotMatch(source, /No hidden route/);

    const stepProjectionStart = source.indexOf('const steps = route');
    const stepProjectionEnd = source.indexOf('const travelTimeMinutes = route', stepProjectionStart);
    assert.notEqual(stepProjectionStart, -1);
    assert.notEqual(stepProjectionEnd, -1);
    const stepProjection = source.slice(stepProjectionStart, stepProjectionEnd);
    assert.doesNotMatch(stepProjection, /direction:\s*step\.direction/);
});

test('authoritative fast-travel movement recomputes and rejects absent known routes', () => {
    const source = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
    assert.match(source, /function resolveFastTravelTimeForTraversal[\s\S]*?buildPlayerKnownTravelRoute/);
    assert.match(source, /No known route is currently available from/);
    assert.doesNotMatch(source, /if \(shortestTravelTimeMinutes === null\) \{\s*return 0;/);
});
