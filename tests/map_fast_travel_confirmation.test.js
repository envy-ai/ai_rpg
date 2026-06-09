const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function extractFunction(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);

  const signatureEnd = source.indexOf('\n', start);
  assert.notEqual(signatureEnd, -1, `${functionName} should have a signature line`);

  const signatureLine = source.slice(start, signatureEnd);
  const signatureBodyOffset = signatureLine.lastIndexOf('{');
  assert.notEqual(signatureBodyOffset, -1, `${functionName} should have a body`);

  const bodyStart = start + signatureBodyOffset;
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Unable to extract ${functionName}`);
}

test('fast travel preview endpoint uses the same server helper as fast travel mutation', () => {
  const apiSource = read('api.js');

  assert.ok(
    apiSource.includes("app.get('/api/player/fast-travel-preview'"),
    'api.js should register GET /api/player/fast-travel-preview'
  );
  assert.match(
    apiSource,
    /resolveFastTravelTimeForTraversal\(\{\s*sourceLocation,\s*destinationLocation\s*\}\)/,
    'preview endpoint should use resolveFastTravelTimeForTraversal with source and destination locations'
  );
  assert.ok(
    apiSource.includes('travelTimeMinutes: fastTravelTimeMinutes'),
    'preview endpoint should return fastTravelTimeMinutes as travelTimeMinutes'
  );
});

test('shared map fast travel asks for confirmation before any travel side effects', () => {
  const viewSource = read('views/index.njk');
  const helperSource = extractFunction(viewSource, 'travelToAdjacentLocationFromMap');

  assert.ok(
    viewSource.includes('async function fetchMapFastTravelPreview'),
    'view should define fetchMapFastTravelPreview'
  );
  assert.ok(
    viewSource.includes('function confirmMapFastTravel'),
    'view should define confirmMapFastTravel'
  );
  assert.ok(
    viewSource.includes('Travel to ${resolvedDestinationName} will take ${travelTimeText}. Confirm?'),
    'confirmation text should include destination and formatted travel time'
  );
  assert.ok(
    viewSource.includes('function formatMapFastTravelConfirmationDuration'),
    'confirmation should use the map fast-travel hours/minutes formatter'
  );

  const confirmationIndex = helperSource.indexOf('confirmMapFastTravel');
  const overlayIndex = helperSource.indexOf('showMoveOverlay()');
  const messageIndex = helperSource.indexOf('dispatchAutomatedMessage');
  const teleportIndex = helperSource.indexOf('teleportNpcToLocation');
  const tabIndex = helperSource.indexOf("activateTab('adventure')");

  assert.notEqual(confirmationIndex, -1, 'confirmation should be inside the shared map travel helper');
  assert.ok(confirmationIndex < overlayIndex, 'confirmation should happen before the moving overlay');
  assert.ok(confirmationIndex < messageIndex, 'confirmation should happen before automated travel logging');
  assert.ok(confirmationIndex < teleportIndex, 'confirmation should happen before the teleport request');
  assert.ok(confirmationIndex < tabIndex, 'confirmation should happen before switching to Adventure');
});

test('region map waits for shared helper confirmation before changing tabs', () => {
  const mapSource = read('public/js/map.js');

  assert.equal(
    /focusAdventureTabForMapTravel\(\);\s*window\.travelToAdjacentLocationFromMap\(locationId,\s*\{\s*focusAdventureTab:\s*false\s*\}\);/.test(mapSource),
    false,
    'region map should not focus Adventure before invoking confirmed travel'
  );
  assert.match(mapSource, /window\.travelToAdjacentLocationFromMap\(locationId\)/);
});

test('world map waits for shared helper confirmation before changing tabs', () => {
  const worldMapSource = read('public/js/world-map.js');

  assert.equal(
    /ensureAdventureTabFocus\(\);\s*const travelResult = window\.travelToAdjacentLocationFromMap\(locationId,\s*\{\s*focusAdventureTab:\s*false\s*\}\);/.test(worldMapSource),
    false,
    'world map should not focus Adventure before invoking confirmed travel'
  );
  assert.match(worldMapSource, /window\.travelToAdjacentLocationFromMap\(locationId\)/);
});

test('Favorites reuse confirmed map travel without pre-confirm Adventure tab activation', () => {
  const viewSource = read('views/index.njk');
  const helperSource = extractFunction(viewSource, 'travelToFavoriteLocation');

  assert.equal(
    helperSource.includes("window.activateTab?.('adventure');"),
    false,
    'Favorites should not activate Adventure before invoking confirmed travel'
  );
  assert.match(helperSource, /window\.travelToAdjacentLocationFromMap\(locationId\)/);
});
