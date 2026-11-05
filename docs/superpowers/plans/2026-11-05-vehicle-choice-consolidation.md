# Vehicle suggestion and token ownership

## Scope

This required form follow-up starts after checkpoint `d44cba0`. Location and Region already share `vehicle-info-fields.njk` and domain methods. Extract their repeated existing-element suggestion lifecycle and selected-token presentation, retaining exact native markup, selection/save rules and keyboard policy. No generated persisted IDs, backend changes, clamping or SearchableSelect redesign are introduced.

The form worker owns new `NativeSuggestions`, its isolated specimen and index vehicle adapters. Core owns exports, classic build and shared specimen integration; its parallel GraphHost work does not mutate these index blocks. The coordinator owns README/commit; Terra owns tests. Both existing close adapters already call `resetVehicleEditor`, so no modal shell lifecycle change is required.

## Implemented boundary

`NativeSuggestions` adopts input/root elements and injects matching, button construction, selection and error handling. It composes CollectionView to own transient button listeners. Input/focus query, Enter-first-match, Escape hide without cancellation, mousedown preventDefault selection and 100ms blur hiding remain shared native policy. New query/hide/destroy generations prevent late delivery; a new query releases the old buttons so they cannot commit obsolete matches. No outside handler, Arrow navigation or focus restoration is added.

The vehicle adapter supplies case-insensitive name/label substring matching, the existing ten-result limit and cached named-location transport. Fixed-route matches exclude selected IDs; current-target matches do not. Native button labels/classes/data attributes and token row structure remain the same. The selected route Map and current snapshot remain domain authority; both token displays now compose CollectionView with their existing Remove/Clear delegation and empty messages.

Separate route/current selection versions guard asynchronous label refresh. Changes/reset and final unload invalidate older refreshes; unknown IDs and pending-region entries remain in place. Existing close/reset hides both suggestion owners. Persisted page hide keeps owners usable; final non-persisted hide destroys suggestion/token owners and invalidates pending label work.

The shared named/teleport adapter now propagates original JSON/network/API errors instead of returning an empty success-shaped array. Success alone updates the cache; finally releases the failed in-flight promise so a later deliberate query can try again. Vehicle event errors and label-refresh failures use PageFeedback. Existing Thing/NPC teleport preparation catches use the same original-error modal. Summon search retains its existing loading/filter cleanup and inline error, adding stack-bearing PageFeedback at that catch. No automatic retry or selected-state clearing occurs on failure.

## Domain policy retained

- Fixed-route insertion order, duplicate exclusion, pending-region route strings and unknown saved IDs remain adapters.
- Current Clear differs from route Remove; pending destination snapshots preserve unresolved location/region names and identifiers.
- New-region prompts and generated pending entries remain vehicle helpers.
- ETA blank/null versus explicit zero, departure-time preservation/clearing, destination-required and route-membership validation, exit choices and terrain metadata remain the existing collector.
- Modal shell visibility, Escape routing and other transaction policies remain their owners' responsibility.

## Verification gates

Syntax checks passed for NativeSuggestions and its specimen; Play Nunjucks compilation and inline script syntax passed. Core built the controls adapter before Play callers. Terra ran **six distinct Chromium cases and nine serializer unit cases**, all passing. The browser cases cover the portable lifetime; actual Location route order/duplicate exclusion/unavailable IDs/ETA zero; Region Clear/ETA validation/select/save; a late response after close/reopen; pending-region snapshot preservation; and failure with deliberate retry while the selected token remains visible.

The actual late-response check exposed the existing `.vehicle-destination-suggestions { display: flex }` rule overriding native `[hidden]`. Core added scoped `&[hidden] { display: none; }` in the authoritative main SCSS rule and compiled main CSS; the affected late-result case then passed. Region's first fixture needed a valid existing level; no production level behavior changed.

All browser runs used the standard XDG/DBUS/browser paths, `PLAYWRIGHT_SKIP_WEBSERVER=1` and the following memory-limited command prefix:

```bash
XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
PLAYWRIGHT_BROWSERS_PATH=/home/bart/.cache/ms-playwright \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
npm run test:e2e:headless -- <case arguments>
```

Exact case arguments and retained results:

- `tests/e2e/ui-widgets-suggestions.spec.js tests/e2e/ability-tooltip.spec.js --grep 'native suggestions honor|Location vehicle picker|Region vehicle current|late vehicle location' --output=tmp/vehicle-first-results --workers=3`: portable and Location cases retained (2).
- `tests/e2e/ability-tooltip.spec.js --grep 'Region vehicle current|late vehicle location' --output=tmp/vehicle-second-results --workers=2`: Region retained (1).
- `tests/e2e/ability-tooltip.spec.js --grep 'late vehicle location' --output=tmp/vehicle-late-final-results --workers=1`: affected visibility/late-result case passed (1).
- `tests/e2e/ability-tooltip.spec.js --grep 'vehicle pending-region snapshot|vehicle search failure' --output=tmp/vehicle-additional-results --workers=2`: pending-region and failure/retry cases passed (2). The latter keeps Alpha Dock selected through the error, then displays Beta after an explicit new query.

Serializer verification:

```bash
systemd-run --wait --collect --pipe \
  -p MemoryMax=16G -p MemorySwapMax=0 \
  -p 'WorkingDirectory=/home/bart/ai_rpg' \
  node --test tests/vehicle_editor.active_destination.test.js
```

All nine passed. The existing VM fixture gained a browser pagehide-listener shim; no production compatibility branch was added. Runtime is frozen after this delivery.

## Remaining full-goal work

This closes the tested vehicle choice/token seam. The master ledger still owns navigation, feedback/readers, graph composition and any remaining forms. Candidate next form group: index `createRegionWeatherTypeRow`, `createRegionWeatherSeasonBlock`, render/reset/collect functions compose nested ReaderRows and createField while retaining required season/type names, descriptions, positive relative frequencies, duration text, dynamic-weather disable state and focused errors. Keep existing minimum-row creation/removal semantics and save payloads. Stories `typedFields` has a distinct recursive HTML/document renderer: scalar fields can share native construction, while reviewed path/descriptor authority, collection shape restoration, clone/mutate/redraw and readonly behavior must remain in the mod. Inspect that scalar boundary separately rather than moving its document ownership into ReaderRows. Distinct fixed relations and allocator pool/rank behavior already compose common native fields without being forced into free-form row serialization.
