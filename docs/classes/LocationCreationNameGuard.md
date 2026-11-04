# LocationCreationNameGuard

`LocationCreationNameGuard.js` prevents creation of ordinary locations whose
names belong to a live or pending region. It uses
[`normalizeDuplicateName`](DuplicateNameUtils.md), so case, repeated whitespace,
and one leading `the` do not distinguish names. Pending-region `originalName`
and `targetRegionName` aliases also reserve names.

`findLocationRegionNameConflict(name, { regions, pendingRegionStubs })` returns
the existing conflict metadata shape or `null`. Collections accept arrays or
Maps. Omitting `regions` reads the native `Region` index. The server initializes
`configureLocationCreationNameGuard({ getPendingRegionStubs })` with its live
pending-region Map; omitted pending collections use that provider. Standalone
contexts begin with no pending regions. Explicit collections allow detached
candidate validation without importing the server.

`getLocationCreationPendingRegionStubs()` exposes the current provider collection
for read-only destination reuse checks, validating the same collection contract.
It does not create prompt context or change any pending-region state.

`assertNewLocationNameAvailable(name, options)` throws an Error with
`code: "location_region_name_conflict"` and conflict metadata in `nameRejection`.
Its short message identifies the region and asks the model to travel to that
region, choose a different location, or stay here.

Creation paths resolve existing locations first. Saved locations and stubs
retain their identity, references, and ability to expand even when their names
already collide with regions. Region-entry placeholders intentionally represent
regions and are exempt. Constructors and save hydration do not apply this guard.

The server checks event/tool/offscreen/travel-created location stubs before
image writes, ID allocation, registration, or exit creation. New detached
`Location.parseXMLSnippet` candidates are checked during parser retries and
checked again by `commitParsedSnippet` before constructing a location.
Generated region location and large-vehicle candidates are checked in the
existing detached generation retry before committing the region graph, including
the new region and newly declared connected/huge-vehicle region names. Preserved
child stubs keep native alias-based reuse. Direct ordinary region/vehicle stub
creation also checks immediately before construction. Generated replacement
location names cannot introduce a region collision.
