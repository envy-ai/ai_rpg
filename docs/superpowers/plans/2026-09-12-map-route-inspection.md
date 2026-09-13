# Map Route Inspection Implementation Plan

## Goal

Turn the existing Region Map, World Map, and Favorites travel confirmation into a read-only route inspector that explains the shortest player-known route before travel. The inspector must show route steps, total time, directed-edge semantics, stub/vehicle constraints, and a clear unavailable state without exposing hidden exits or moving the player until Travel is explicitly chosen.

Implement this plan before `2026-09-12-quest-hidden-route-knowledge-rewards.md`; that plan can then link newly revealed routes directly into this inspector.

## Product Decisions

1. Reuse and expand `GET /api/player/fast-travel-preview`; do not create a second route-preview endpoint with overlapping behavior.
2. A successful lookup is not the same as permitted fast travel. The response separately reports:
   - `reachable`: a player-known route currently exists;
   - `canFastTravel`: the destination is eligible for map fast travel now;
   - `blockingReason`: a stable code plus player-safe message when travel is unavailable.
3. “Known route” means a path composed only of exits visible to the player and currently available under vehicle-route rules. A hidden-only route is indistinguishable from no route.
4. A valid request with no known path returns HTTP 200 with `reachable: false`, `travelTimeMinutes: null`, and `steps: []`. Malformed graph state remains an explicit server error.
5. The current zero-minute fallback for an unreachable fast-travel path is removed. Zero minutes is valid only when origin and destination are the same or a real route totals zero.
6. Selecting a non-current map location opens the route/Travel modal. The modal is useful even when Travel is disabled.
7. Travel remains available only for an already visited, hydrated destination with a currently reachable route. Inspecting a location never marks it visited, expands it, advances time, writes chat, or invokes an LLM.
8. Route inspection does not initially highlight graph edges. The modal step list is the first bounded version; map highlighting can be added later without changing the API contract.
9. Directed routes are described one step at a time. The UI never implies a return route unless route lookup in the reverse direction succeeds independently.
10. Route data is recalculated again immediately before movement through the existing gameplay mutation path. Preview data is not an authorization token.

## Current Baseline and Gotchas

- `Location.findShortestTravelRoute(...)` already performs weighted directed Dijkstra lookup and omits `hiddenFromPlayer` exits.
- Its route steps currently contain names, regions, direction, and minutes, but not the exit id, description, stub state, or vehicle metadata needed by the UI.
- `GET /api/player/fast-travel-preview` currently returns only origin, destination, and `travelTimeMinutes`.
- `resolveFastTravelTimeForTraversal(...)` currently turns `null` (unreachable) into `0`. That can make an unreachable graph look like free travel and must be corrected as part of this feature.
- Region and World Map taps currently ignore unvisited nodes and start the travel-confirmation flow for visited nodes. The inspector should accept any hydrated non-current location represented on the map, while keeping Travel disabled for unvisited destinations.
- Unexpanded stubs are graph facts, not traversable known locations. A visible exit may produce a final route step to a stub for inspection, but route lookup must not use a stub as an intermediate shortcut and map fast travel must remain disabled for a stub destination.
- Vehicle exits are already filtered from map payloads while their vehicle is underway or arrival is pending. Route lookup and route display must use the same predicate rather than presenting a path the map itself considers unavailable.
- The authoritative hidden-exit filter must remain inside the server route traversal. The client must never receive hidden step ids, hidden counts, or a blocker that implies a secret connection exists.

## Response Contract

Expand `GET /api/player/fast-travel-preview?destinationId=<id>` to return:

```json
{
  "success": true,
  "origin": {
    "id": "loc_1",
    "name": "Old Gatehouse",
    "regionId": "region_1",
    "regionName": "Castle Grounds"
  },
  "destination": {
    "id": "loc_8",
    "name": "Hidden Garden",
    "regionId": "region_1",
    "regionName": "Castle Grounds",
    "visited": true,
    "isStub": false
  },
  "reachable": true,
  "canFastTravel": true,
  "blockingReason": null,
  "travelTimeMinutes": 12,
  "steps": [
    {
      "exitId": "exit_4",
      "direction": "north",
      "description": "A narrow stair climbs behind the wall.",
      "fromLocationId": "loc_1",
      "fromLocationName": "Old Gatehouse",
      "fromRegionId": "region_1",
      "fromRegionName": "Castle Grounds",
      "toLocationId": "loc_3",
      "toLocationName": "Wall Walk",
      "toRegionId": "region_1",
      "toRegionName": "Castle Grounds",
      "travelTimeMinutes": 4,
      "isVehicle": false,
      "vehicleType": null,
      "destinationIsStub": false
    }
  ]
}
```

Allowed `blockingReason.code` values for the first version:

- `NO_KNOWN_ROUTE`: no route using visible, currently available edges;
- `DESTINATION_UNVISITED`: a route can be inspected, but map fast travel is not unlocked;
- `DESTINATION_STUB`: the destination must be expanded through normal play before fast travel;
- `DESTINATION_CURRENT`: origin and destination are already the same.

The message paired with `NO_KNOWN_ROUTE` must remain generic: “No known route is currently available.” Do not distinguish missing, hidden, or unavailable edges in player-facing output.

## Domain and Routing Changes

### Route-step metadata

Extend `Location.#routeStepSummary(...)` and its predecessor records so `findShortestTravelRoute(...)` returns the source exit's:

- canonical `exitId`;
- trimmed description;
- `isVehicle` and `vehicleType`;
- destination stub flag.

Keep route objects plain and serializable. Do not include `hiddenFromPlayer` or `discoveryDifficulty` in player route results.

### Traversal policy

Add an optional server-supplied traversal predicate to `Location.findShortestTravelRoute(...)`, or a small route-policy wrapper if that keeps `Location` cleaner. The default route method must continue to exclude hidden exits even when no predicate is supplied.

The player preview policy must:

1. exclude hidden exits unconditionally;
2. exclude vehicle exits suppressed by the existing vehicle-state rules;
3. allow reaching an unexpanded stub as the requested terminal destination;
4. refuse to expand outgoing edges from an unexpanded stub;
5. throw on missing destination records or invalid travel-time data rather than skipping broken graph entries.

Extract/reuse one vehicle-exit availability helper for map serialization and route preview so the two cannot drift.

### Authoritative movement timing

Refactor `resolveFastTravelTimeForTraversal(...)` to consume the same player route policy. When source and destination differ and no route exists, throw a clear error instead of returning `0`. Story Tools teleport remains unaffected because it does not request gameplay travel-time accounting.

Do not trust `travelTimeMinutes` or step data sent back by the browser. The movement path recomputes the current route after any optional travel narration and before the teleport mutation.

## API Changes

In `api.js`:

1. Build a single route-preview result from the current player location and canonical destination.
2. Return HTTP 400 for a missing/blank destination id, 404 for missing origin/destination records, and 500 for malformed graph state.
3. Return HTTP 200 for all well-formed availability outcomes, including no route.
4. Include destination visit/stub state and the separate `reachable`/`canFastTravel` flags.
5. Ensure response construction strips all hidden fields and cannot serialize a hidden exit step.
6. Revalidate route reachability in the gameplay travel-time path immediately before mutation.

No save fields, migrations, prompts, or LLM logs are added by this feature.

## Browser UX

### Route and Travel modal

Evolve `#mapFastTravelConfirmModal` into a route inspector while retaining its existing accessible modal lifecycle and editable action text.

The modal contains:

- destination and region;
- total travel time when reachable;
- an ordered route list with direction, source, destination, per-step time, and vehicle label where relevant;
- an “Unexplored destination” marker when the final location is a stub;
- a prominent player-safe unavailable message when there is no known route;
- the existing optional travel-action textarea only when `canFastTravel` is true;
- `Travel` and `Close` buttons, with Travel disabled and an explanatory accessible description when unavailable.

Use semantic ordered-list markup for steps. Preserve focus trapping, Escape/backdrop close, focus restoration, and mobile layout.

### Map and Favorites interactions

- Region Map and World Map: tap any hydrated, non-current location node to inspect it. Do not inspect region-exit bubbles or vehicle-overlay nodes through this path.
- Unvisited or stub destinations open the inspector with Travel disabled.
- Visited hydrated destinations retain the current travel behavior after the user presses Travel.
- Favorites continue to open the same shared inspector and normally remain travel-eligible.
- The Adventure tab is activated only after Travel is confirmed, never merely for inspection.
- Closing the inspector leaves map focus, graph state, chat history, and player state unchanged.

The fetch helper must validate the complete response shape. Invalid booleans, negative/non-integer minutes, mismatched step totals, malformed step ids, or steps returned for `reachable: false` produce a clear client error modal.

## Styling

Add route-inspector styles to `public/css/main.scss`, not `public/css/map.css`, because the modal is defined in `views/index.njk` and shares the main modal system. Compile `public/css/main.css` and its source map with:

```bash
npm run scss:build:main
```

The ordered route must remain readable at desktop and mobile widths, with time values aligned but no horizontal scrolling required for normal names.

## Implementation Tasks

### Task 1: Lock the domain route contract with failing tests

**Files:**

- Modify: `tests/location.shortest_travel_time.test.js`

Add tests for:

- exit id/description/vehicle/stub metadata on ordered steps;
- hidden edges never appearing in a route;
- a hidden-only route returning `null` with no secret metadata;
- a route reaching a terminal stub but never traversing through that stub under player policy;
- malformed visible edges still throwing explicit errors;
- asymmetric directed routes producing different forward/reverse results.

### Task 2: Extend route calculation and centralize player availability

**Files:**

- Modify: `Location.js`
- Modify: `api.js`
- Consider creating: `PlayerTravelRoute.js` only if the shared policy cannot remain a small cohesive helper in `api.js`

Add route-step metadata, traversal-policy support, shared vehicle filtering, and explicit unreachable handling. Avoid parallel Dijkstra implementations.

### Task 3: Expand the preview API and close the zero-minute hole

**Files:**

- Modify: `api.js`
- Modify: `tests/map_fast_travel_confirmation.test.js`
- Add: `tests/map_route_inspection.test.js`

Test reachable, unreachable, current, unvisited, stub, hidden-only, vehicle-unavailable, and malformed-graph responses. Assert that preview calls do not alter player location, time, visits, history, or saves.

### Task 4: Build the shared route inspector

**Files:**

- Modify: `views/index.njk`
- Modify: `public/js/map.js`
- Modify: `public/js/world-map.js`
- Modify: `public/css/main.scss`
- Compile: `public/css/main.css`
- Compile: `public/css/main.css.map`

Update the existing modal rather than adding a competing map dialog. Split “inspect” from “travel” in browser helpers so disabled travel is a normal result, not an exception.

### Task 5: Add UI and browser coverage

**Files:**

- Add: `tests/ui.map_route_inspection.test.js`
- Add: `tests/e2e/map-route-inspection.spec.js`
- Modify adjacent map/favorite tests as required by the new tap contract

Cover:

- multi-step route rendering and summed time;
- one-way wording;
- vehicle step label;
- unreachable generic message with no hidden clues;
- unvisited and stub destination disabled states;
- Close causing no mutation;
- Travel retaining current blank/nonblank narration behavior;
- responsive layout and keyboard focus;
- route becoming available after a hidden exit is revealed and the map refreshes.

### Task 6: Documentation

**Files:**

- Modify: `docs/api/map.md`
- Modify: `docs/api/players.md`
- Modify: `docs/api/common.md`
- Modify: `docs/ui/maps.md`
- Modify: `docs/ui/modals_overlays.md`
- Modify: `docs/classes/Location.md`
- Modify: `docs/README.md`

Document the exact response contract, the distinction between inspection and travel eligibility, generic hidden-safe unreachable behavior, and the removal of the unreachable-as-zero fallback.

## Verification

Run at minimum:

```bash
node --check Location.js
node --check api.js
node --check public/js/map.js
node --check public/js/world-map.js
npm run scss:build:main
node --test tests/location.shortest_travel_time.test.js tests/map_fast_travel_confirmation.test.js tests/map_route_inspection.test.js tests/ui.map_route_inspection.test.js tests/ui.location_favorites.test.js tests/ui.hidden_things_exits.test.js
npm run test:e2e:headless -- tests/e2e/map-route-inspection.spec.js
```

Also run the adjacent player movement, vehicle routing, hidden-discovery, Region Map, World Map, and Favorites suites identified during implementation.

Store screenshots and Playwright artifacts under `tmp/`. Visually inspect at least one multi-step desktop route, one mobile route, and one unavailable route. Restart the regular server only with current user permission and without loading a save.

## Completion Criteria

- Every represented non-current location can be inspected without mutation.
- Reachable routes show ordered directed steps whose minute sum equals the total.
- Travel is enabled only for a visited, hydrated, currently reachable destination.
- Hidden exits never appear or affect player-facing blocker wording.
- Vehicle and stub behavior matches map visibility and actual movement.
- No-route is explicit and is never converted to zero-minute travel.
- Existing blank and nonblank fast-travel narration flows still work.
- Focused Node and Playwright coverage passes, SCSS is compiled, and documentation matches the shipped contract.
