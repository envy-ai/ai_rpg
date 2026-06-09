# Map Fast Travel Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask for confirmation, including authoritative travel time, before map/world-map/Favorites fast travel mutates state or leaves the current tab.

**Architecture:** Add a read-only player fast-travel preview endpoint that calls the same `resolveFastTravelTimeForTraversal(...)` helper used by the existing fast-travel mutation path. The shared browser `travelToAdjacentLocationFromMap(...)` helper fetches that preview, formats the minutes with the existing duration formatter, and calls `confirm(...)` before showing overlays, logging travel prose, teleporting, or activating Adventure.

**Tech Stack:** Express routes in `api.js`, Nunjucks-embedded browser JavaScript in `views/index.njk`, Cytoscape map scripts in `public/js/map.js` and `public/js/world-map.js`, Node test runner static regression tests.

---

### Task 1: Failing Regression Tests

**Files:**
- Create: `tests/map_fast_travel_confirmation.test.js`

- [ ] **Step 1: Add tests**

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

- [ ] **Step 2: Verify red**

Run: `node --test tests/map_fast_travel_confirmation.test.js`

Expected: fails because the endpoint and confirmation code are not present yet.

### Task 2: Preview Endpoint

**Files:**
- Modify: `api.js`

- [ ] **Step 1: Implement read-only endpoint**

Add `GET /api/player/fast-travel-preview?destinationId=...` near player movement routes. Resolve the current player location and destination, call `resolveFastTravelTimeForTraversal({ sourceLocation, destinationLocation })`, and return `{ success: true, destination, origin, travelTimeMinutes }`.

- [ ] **Step 2: Verify targeted tests**

Run: `node --test tests/map_fast_travel_confirmation.test.js`

Expected: remaining tests fail until browser confirmation code is present.

### Task 3: Browser Confirmation

**Files:**
- Modify: `views/index.njk`
- Modify: `public/js/map.js`
- Modify: `public/js/world-map.js`

- [ ] **Step 1: Implement shared confirmation**

Add preview fetch and `confirm("Travel to X will take Y. Confirm?")` inside `travelToAdjacentLocationFromMap(...)` before overlay, automated message dispatch, teleport, and tab activation.

- [ ] **Step 2: Delay tab changes**

Remove pre-confirm Adventure-tab activation from region map, world map, and Favorites click handlers. Keep Adventure activation after the shared helper succeeds.

- [ ] **Step 3: Verify targeted tests**

Run: `node --test tests/map_fast_travel_confirmation.test.js`

Expected: all tests pass.

### Task 4: Documentation and Verification

**Files:**
- Modify: `docs/ui/maps.md`
- Modify: `docs/api/players.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Document behavior**

Update map and player API docs to describe the preview endpoint and pre-navigation confirmation.

- [ ] **Step 2: Syntax and focused tests**

Run:

```bash
node --check api.js
node --test tests/map_fast_travel_confirmation.test.js tests/ui.location_favorites.test.js tests/api.exit_travel_time.test.js
```

Expected: exit code 0.
