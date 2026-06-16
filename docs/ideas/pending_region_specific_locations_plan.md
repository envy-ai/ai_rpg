# Pending Region Specific Locations

## Status

Implemented. This note is retained as design/archive context for the behavior that lets concrete location stubs belong to a pending region-entry stub before that region is fully generated.

## Current Behavior

- Pending region records can carry `locationIds` for ordinary location stubs that already belong to the unresolved region. Region-entry stubs remain the entrance placeholder; child location stubs are tracked separately.
- `createLocationFromEvent(...)` accepts `targetRegionId` for live regions and pending region stubs. When the target is pending, the created or reused location stub keeps the pending region id in its region metadata and is registered on `pendingRegionStubs.get(regionId).locationIds`.
- `new_exit_discovered` resolves destination-region hints against live regions and pending region stubs. For location exits with a resolved pending destination region, the handler passes that pending region id into `createLocationFromEvent(...)`; a named destination region that cannot be resolved raises an error.
- Offscreen NPC/thing movement can also create a pending region-entry stub plus a child location stub so entities remain trackable before the region is expanded.
- Region-entry expansion calls `collectPendingRegionLocationsForExpansion(...)` before generating region locations. The helper reconciles explicit `pendingRegionStubs.locationIds` with existing location metadata and excludes the region-entry entrance stub itself.
- `instantiateRegionLocations(...)` seeds its stub map with preserved pending-region locations. Generated blueprints reuse preserved locations by normalized name/id/metadata aliases, apply blueprint metadata to reused stubs, and keep preserved locations in the region even when the region-generation response omits them.
- Timed vehicle arrivals that resolve to a specific pending-region child location carry the pending region-entry stub context through arrival finalization. The region-entry stub expands first, then the preserved child destination is refreshed and expanded if needed.
- Rollback after failed region instantiation receives the preserved location ids and removes only newly generated expansion stubs, not pre-existing pending-region child locations.
- Save hydration and pending-region maintenance treat `locationIds` as first-class state: rebuild and duplicate-merge paths preserve member location ids and rewire member metadata when canonicalizing duplicate pending region records.

## Design Rationale

The motivating case was that story events can reveal or move entities into a specific place inside a region before the player has entered that region. Without preserved pending-region child locations, later region expansion could create a duplicate location with the same name or leave the earlier concrete stub orphaned.

The implemented design keeps these places stable by making pending-region membership explicit, then letting generated region blueprints enrich or connect the preserved stubs instead of replacing them. Expansion failure is intentionally conservative: generated locations can be rolled back, but locations that existed before expansion remain registered for future attempts.

## Coverage Anchors

- `tests/server.region_stub_parsing.test.js` covers reuse of matching pending-region locations, preservation of omitted pending-region locations, and rollback preservation.
- `tests/utils.pending_region_stubs.test.js` covers rebuilding and duplicate merging of pending-region `locationIds`.
- `tests/new_exit_pending_region.test.js` covers API behavior around existing pending-region entrance targets and deletion preservation.
- Focused documentation for the current behavior lives in `docs/classes/Location.md`, `docs/classes/Utils.md`, `docs/classes/Events.md`, and `docs/classes/Region.md`.
