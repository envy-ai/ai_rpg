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

test('fast travel preview endpoint returns graph-route timing without mutation', () => {
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

test('shared map fast travel asks for confirmation before gameplay travel side effects', () => {
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
    viewSource.includes('id="mapFastTravelConfirmModal"'),
    'confirmation should use the HTML fast-travel modal'
  );
  assert.ok(
    viewSource.includes('id="mapFastTravelActionText"'),
    'confirmation modal should include action text input'
  );
  assert.ok(
    viewSource.includes('async function requestMapFastTravelConfirmation'),
    'confirmation should be resolved through the modal promise helper'
  );
  assert.ok(
    viewSource.includes('function buildDefaultMapFastTravelActionText'),
    'confirmation should build a default full player-action travel prompt'
  );
  assert.ok(
    viewSource.includes('function buildMapFastTravelMetadata'),
    'map fast travel should send direct fast-travel metadata to /api/chat'
  );
  assert.ok(
    viewSource.includes("mode: 'fast-travel'"),
    'map fast travel metadata should identify non-adjacent fast travel'
  );
  assert.ok(
    viewSource.includes('eventDriven: false'),
    'map fast travel prompt metadata should suppress event-driven movement enforcement'
  );
  assert.ok(
    viewSource.includes('return requestMapFastTravelConfirmation({'),
    'confirmMapFastTravel should open the HTML modal'
  );
  assert.ok(
    helperSource.includes('fetchMapFastTravelPreview'),
    'map fast travel should preview route time'
  );
  assert.ok(
    helperSource.includes('confirmation.actionText'),
    'confirmed action text should be used by the shared map travel helper'
  );
  assert.ok(
    helperSource.includes('travelMetadata'),
    'confirmed map travel action should include travel metadata'
  );
  assert.ok(
    helperSource.includes("throw new Error('AIRPG chat client not available; cannot dispatch fast travel action.')"),
    'map fast travel should fail loudly when the chat client is unavailable'
  );
  assert.match(
    helperSource,
    /dispatchAutomatedMessage\(actionText,\s*\{[\s\S]*?travel:\s*true,[\s\S]*?travelMetadata,[\s\S]*?suppressTravelCompletionSound:\s*true/,
    'map fast travel should dispatch a full player-action prompt before teleporting'
  );
  assert.match(
    helperSource,
    /teleportNpcToLocation\(playerRecord,\s*destinationId,\s*\{[\s\S]*?accountTravelTime:\s*true/,
    'map fast travel should call the player teleport endpoint with travel-time accounting'
  );

  const previewIndex = helperSource.indexOf('fetchMapFastTravelPreview');
  const confirmationIndex = helperSource.indexOf('confirmMapFastTravel');
  const overlayIndex = helperSource.indexOf('showMoveOverlay()');
  const messageIndex = helperSource.indexOf('dispatchAutomatedMessage');
  const teleportIndex = helperSource.indexOf('teleportNpcToLocation');
  const tabIndex = helperSource.indexOf("activateTab('adventure')");

  assert.notEqual(previewIndex, -1, 'preview should be inside the shared map travel helper');
  assert.notEqual(confirmationIndex, -1, 'confirmation should be inside the shared map travel helper');
  assert.ok(previewIndex < confirmationIndex, 'travel preview should happen before confirmation');
  assert.ok(confirmationIndex < overlayIndex, 'confirmation should happen before the moving overlay');
  assert.ok(confirmationIndex < messageIndex, 'confirmation should happen before automated travel logging');
  assert.ok(messageIndex < overlayIndex, 'the full action prompt should finish before the moving overlay is shown');
  assert.ok(confirmationIndex < teleportIndex, 'confirmation should happen before the teleport request');
  assert.ok(teleportIndex < tabIndex, 'Adventure should focus only after successful teleport');
});

test('server accepts direct fast-travel metadata for non-adjacent map travel prompts', () => {
  const apiSource = read('api.js');

  assert.match(
    apiSource,
    /const isFastTravelMode = normalized\.mode === 'fast-travel'/,
    'travel metadata normalization should identify fast-travel mode'
  );
  assert.match(
    apiSource,
    /if \(isFastTravelMode\) \{[\s\S]*?exit: null[\s\S]*?\}/,
    'fast-travel mode should resolve origin and destination without requiring a single exit'
  );
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
