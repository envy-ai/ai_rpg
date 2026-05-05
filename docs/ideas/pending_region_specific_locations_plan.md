# Pending Region Specific Locations Plan

## Goal

Allow event checks and tools to create specific location stubs inside a pending region-entry stub, then preserve those exact locations when the region is later expanded from a stub into a full region.

## Current Behavior

- `createLocationFromEvent(...)` can already accept `targetRegionId`.
- If `targetRegionId` points at a pending region stub, the created location stub gets that pending region id and is added to `pendingRegionStubs.get(targetRegionId).locationIds`.
- Region-entry expansion currently ignores those pending-region `locationIds`.
- `instantiateRegionLocations(...)` always creates fresh stubs from the generated region blueprints, so a pre-created specific location can be orphaned or duplicated.

## Gotchas

1. Event XML/legacy exit discovery needs to resolve destination regions against pending region stubs, not only live `Region` objects.
2. `pendingRegionStubs.locationIds` needs to become first-class state instead of an incidental field.
3. Blueprint names from the region generator may collide with pre-created pending-region locations and should reuse them.
4. If expansion fails and rolls back newly generated stubs, preserved pre-existing pending-region locations must not be deleted.
5. Entrance selection must keep working when the selected entrance is one of the preserved locations.

## Implementation Plan

1. Add pending-region lookup helpers that resolve by id, name, or original name.
2. Teach event `new_exit_discovered` destination-region resolution to accept pending regions and pass the pending region id into `createLocationFromEvent(...)`.
3. Add helper functions for registering/removing pending-region location ids and use them instead of ad hoc mutation.
4. Persist and rebuild `pendingRegionStubs.locationIds` in save hydration, rebuild, and duplicate-merge maintenance.
5. During region-entry expansion, collect preserved pending-region locations before calling `instantiateRegionLocations(...)`.
6. Let `instantiateRegionLocations(...)` seed `stubMap` with preserved locations, reuse a preserved location when a generated blueprint matches by normalized name/alias, keep preserved locations even when omitted by the prompt, and apply blueprint metadata onto reused stubs.
7. Track which locations are newly created during expansion so rollback removes only new expansion locations, not preserved pending-region locations.
8. Add tests for pending-region event creation, expansion reuse, expansion omission preservation, and rollback preservation.

## Test Plan

- `node --test tests/events.exit_travel_time.test.js`
- `node --test tests/server.region_stub_parsing.test.js`
- `node --check Events.js`
- `node --check Utils.js`
- `node --check server.js`
