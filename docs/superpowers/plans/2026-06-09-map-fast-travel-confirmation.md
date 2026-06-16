# Map Fast Travel Confirmation Implementation Plan

**Archive status:** Implemented. This document preserves the historical plan and the completed-task structure for future maintenance context. Current behavior is documented in `docs/ui/maps.md` and `docs/api/players.md`.

**Goal:** Ask for confirmation, including authoritative graph-route travel time, before Region Map, World Map, or Favorites fast travel mutates state or leaves the current tab.

**Implemented architecture:** A read-only player fast-travel preview endpoint calls the same `resolveFastTravelTimeForTraversal(...)` helper used by the teleport path when travel-time accounting is requested. The shared browser `travelToAdjacentLocationFromMap(...)` helper fetches that preview, opens the map fast-travel modal, focuses Adventure when Travel is accepted, dispatches the confirmed player-action text through `/api/chat` with direct fast-travel metadata, then teleports with travel-time accounting.

**Tech stack:** Express routes in `api.js`, Nunjucks-embedded browser JavaScript in `views/index.njk`, Cytoscape map scripts in `public/js/map.js` and `public/js/world-map.js`, Node test runner static regression tests.

## Current Behavior

- `GET /api/player/fast-travel-preview?destinationId=<id>` resolves the current player's origin and requested destination, returns `{ success, origin, destination, travelTimeMinutes }`, and does not move actors, write chat history, advance time, or run arrival processing.
- `resolveFastTravelTimeForTraversal({ sourceLocation, destinationLocation })` delegates to `Location.findShortestTravelTimeMinutes(...)`; no route returns `0`, while malformed non-integer or negative timing raises an error.
- `views/index.njk` owns the shared map travel flow: `fetchMapFastTravelPreview`, `requestMapFastTravelConfirmation`, `confirmMapFastTravel`, `buildMapFastTravelMetadata`, and `travelToAdjacentLocationFromMap`.
- Confirmation uses `#mapFastTravelConfirmModal`, not a native browser `confirm(...)`. The modal displays destination and travel time, and the editable player-action text starts blank.
- Confirmed map travel sends `travelMetadata.mode: "fast-travel"` and `eventDriven: false` through `AIRPG_CHAT.dispatchAutomatedMessage(...)` before teleporting, so `/api/chat` can process a direct non-adjacent travel prompt without requiring a single adjacent exit.
- The teleport step uses `accountTravelTime: true`, so this remains gameplay travel with normal travel-time accounting and arrival processing. Character-menu story-tool teleports are separate and bypass this modal flow.
- Region Map, World Map, and Favorites call the shared helper without switching to Adventure before confirmation; Adventure focus happens as soon as Travel is accepted.

---

### Task 1: Failing Regression Tests

**Files:**
- Created: `tests/map_fast_travel_confirmation.test.js`

- [x] **Step 1: Add tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('fast travel preview endpoint uses the same server helper as fast travel mutation', () => {
  const apiSource = read('api.js');
  assert.match(apiSource, /app\.get\('\/api\/player\/fast-travel-preview'/);
  assert.match(apiSource, /resolveFastTravelTimeForTraversal\(\{\s*sourceLocation,\s*destinationLocation\s*\}\)/);
  assert.match(apiSource, /travelTimeMinutes:\s*fastTravelTimeMinutes/);
});
```

- [x] **Step 2: Verify red during original implementation**

Run: `node --test tests/map_fast_travel_confirmation.test.js`

Historical expected result: failed because the endpoint and confirmation code were not present yet. Current expected result: passes.

### Task 2: Preview Endpoint

**Files:**
- Modify: `api.js`

- [x] **Step 1: Implement read-only endpoint**

`GET /api/player/fast-travel-preview?destinationId=...` lives near player movement routes. It resolves the current player location and destination, calls `resolveFastTravelTimeForTraversal({ sourceLocation, destinationLocation })`, and returns `{ success: true, destination, origin, travelTimeMinutes }`.

- [x] **Step 2: Verify targeted tests**

Run: `node --test tests/map_fast_travel_confirmation.test.js`

Historical expected result: remaining tests failed until browser confirmation code was present. Current expected result: passes.

### Task 3: Browser Confirmation

**Files:**
- Modify: `views/index.njk`
- Modify: `public/js/map.js`
- Modify: `public/js/world-map.js`

- [x] **Step 1: Implement shared confirmation**

Add preview fetch and shared confirmation inside `travelToAdjacentLocationFromMap(...)` before overlay, automated message dispatch, teleport, and tab activation. The final implementation uses the accessible `#mapFastTravelConfirmModal` with editable action text instead of native `window.confirm(...)`.

- [x] **Step 2: Delay tab changes**

Remove pre-confirm Adventure-tab activation from Region Map, World Map, and Favorites click handlers. Keep Adventure activation after the shared helper succeeds.

- [x] **Step 3: Verify targeted tests**

Run: `node --test tests/map_fast_travel_confirmation.test.js`

Expected: all tests pass.

### Task 4: Documentation and Verification Anchors

**Files:**
- Modified during implementation: `docs/ui/maps.md`
- Modified during implementation: `docs/api/players.md`

- [x] **Step 1: Document behavior**

Map and player API docs describe the preview endpoint, confirmation modal, direct fast-travel metadata, and travel-time-accounting teleport flow. `docs/ui/modals_overlays.md`, `docs/ui/chat_interface.md`, and `docs/api/map.md` also reference the implemented behavior.

- [x] **Step 2: Syntax and focused tests**

Run:

```bash
node --check api.js
node --test tests/map_fast_travel_confirmation.test.js tests/ui.location_favorites.test.js tests/api.exit_travel_time.test.js
```

Expected: exit code 0.

Current focused verification command:

```bash
node --test tests/map_fast_travel_confirmation.test.js tests/ui.location_favorites.test.js tests/api.exit_travel_time.test.js
```
