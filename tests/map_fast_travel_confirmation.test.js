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

  const paramsStart = source.indexOf('(', start);
  assert.notEqual(paramsStart, -1, `${functionName} should have a parameter list`);

  let parenDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        paramsEnd = index;
        break;
      }
    }
  }

  assert.notEqual(paramsEnd, -1, `${functionName} should close its parameter list`);

  const bodyStart = source.indexOf('{', paramsEnd);
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
    viewSource.includes('id="mapFastTravelActionText"'),
    'confirmation modal should include action text input'
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
    'nonblank confirmed map travel action should include travel metadata'
  );
  assert.ok(
    helperSource.includes("throw new Error('AIRPG chat client not available; cannot dispatch fast travel action.')"),
    'prompt-backed map fast travel should fail loudly when the chat client is unavailable'
  );
  assert.match(
    helperSource,
    /const hasPromptText\s*=\s*actionText\.length\s*>\s*0;/,
    'map fast travel should branch on whether the confirmation text is blank'
  );
  assert.match(
    helperSource,
    /if \(hasPromptText\) \{[\s\S]*?dispatchAutomatedMessage\(actionText,\s*\{[\s\S]*?travel:\s*true,[\s\S]*?travelMetadata,[\s\S]*?suppressTravelCompletionSound:\s*true[\s\S]*?\}\);[\s\S]*?\}/,
    'nonblank map fast travel should dispatch the confirmed action before teleporting'
  );
  assert.match(
    helperSource,
    /else if \(window\.AIRPG_CHAT && typeof window\.AIRPG_CHAT\.dispatchAutomatedMessage === 'function'\) \{[\s\S]*?dispatchAutomatedMessage\(`# \$\{playerName\} moved to \$\{destinationName\}\.`,\s*\{[\s\S]*?travel:\s*true,[\s\S]*?travelMetadata:\s*null,[\s\S]*?suppressTravelCompletionSound:\s*true[\s\S]*?\}\);[\s\S]*?\}/,
    'blank map fast travel should log only a comment-style travel entry before teleporting'
  );
  assert.match(
    helperSource,
    /teleportNpcToLocation\(playerRecord,\s*destinationId,\s*\{[\s\S]*?accountTravelTime:\s*true/,
    'map fast travel should call the player teleport endpoint with travel-time accounting'
  );
  assert.match(
    helperSource,
    /teleportNpcToLocation\(playerRecord,\s*destinationId,\s*\{[\s\S]*?arrivalProseAlreadyProvided:\s*hasPromptText/,
    'map fast travel should distinguish prompt narration from a blank movement comment'
  );
  assert.match(
    helperSource,
    /travelNarrationResult\?\.accompanyingCharacters[\s\S]*?teleportNpcToLocation\(playerRecord,[\s\S]*?accompanyingCharacters/,
    'map fast travel should carry prompt-selected companions into the player teleport request'
  );

  const previewIndex = helperSource.indexOf('fetchMapFastTravelPreview');
  const confirmationIndex = helperSource.indexOf('confirmMapFastTravel');
  const overlayIndex = helperSource.indexOf('showMoveOverlay()');
  const messageIndex = helperSource.indexOf('dispatchAutomatedMessage');
  const teleportIndex = helperSource.indexOf('teleportNpcToLocation');
  const tabIndex = helperSource.indexOf("activateTab('adventure')");

  assert.notEqual(previewIndex, -1, 'preview should be inside the shared map travel helper');
  assert.notEqual(confirmationIndex, -1, 'confirmation should be inside the shared map travel helper');
  assert.notEqual(tabIndex, -1, 'Adventure should focus from the shared map travel helper');
  assert.ok(previewIndex < confirmationIndex, 'travel preview should happen before confirmation');
  assert.ok(confirmationIndex < overlayIndex, 'confirmation should happen before the moving overlay');
  assert.ok(confirmationIndex < tabIndex, 'Adventure should focus when the Travel button is confirmed');
  assert.ok(tabIndex < messageIndex, 'Adventure should focus before map travel chat logging starts');
  assert.ok(confirmationIndex < messageIndex, 'confirmation should happen before automated travel logging');
  assert.ok(messageIndex < overlayIndex, 'the full action prompt should finish before the moving overlay is shown');
  assert.ok(confirmationIndex < teleportIndex, 'confirmation should happen before the teleport request');
  assert.ok(tabIndex < teleportIndex, 'Adventure should focus before the teleport request starts');
});

test('map fast travel confirmation starts blank and skips the prompt for blank action text', () => {
  const viewSource = read('views/index.njk');
  const requestSource = extractFunction(viewSource, 'requestMapFastTravelConfirmation');
  const helperSource = extractFunction(viewSource, 'travelToAdjacentLocationFromMap');

  assert.equal(
    viewSource.includes('function buildDefaultMapFastTravelActionText'),
    false,
    'map fast travel should not build automatic player-action text'
  );
  assert.match(
    requestSource,
    /elements\.actionText\.value\s*=\s*'';/,
    'confirmation textarea should be blank when the modal opens'
  );
  assert.match(
    requestSource,
    /const actionText\s*=\s*confirmed\s*\?\s*\(\(elements\.actionText\.value\s*\|\|\s*''\)\.trim\(\)\)\s*:\s*'';/,
    'confirmed blank action text should resolve as an empty string'
  );
  assert.equal(
    helperSource.includes('buildDefaultMapFastTravelActionText'),
    false,
    'shared map travel helper should not replace blank confirmation text with generated text'
  );
  assert.match(
    helperSource,
    /const actionText\s*=\s*\(confirmation\.actionText\s*\|\|\s*''\)\.trim\(\);/,
    'shared map travel helper should preserve a blank confirmed action'
  );
  assert.match(
    helperSource,
    /const hasPromptText\s*=\s*actionText\.length\s*>\s*0;/,
    'shared map travel helper should distinguish blank confirmations from prompt-backed travel'
  );
  assert.doesNotMatch(
    helperSource,
    /dispatchAutomatedMessage\(actionText,\s*\{[\s\S]*?allowEmptyAction:\s*true/,
    'blank map travel should not submit an empty player-action prompt'
  );
  assert.match(
    helperSource,
    /dispatchAutomatedMessage\(`# \$\{playerName\} moved to \$\{destinationName\}\.`,\s*\{[\s\S]*?travelMetadata:\s*null/,
    'blank map travel should log the same comment-style movement text used by direct exit travel'
  );
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
