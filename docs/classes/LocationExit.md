# LocationExit

## Purpose
Represents a connection between locations (or regions), with optional vehicle semantics and bidirectional travel.

## Key State
- `#id`, `#description`, `#destination`, `#destinationRegion`, `#travelTimeMinutes`.
- `#bidirectional`, `#isVehicle`, `#vehicleType`.
- `#imageId`, `#createdAt`, `#lastUpdated`.
- Runtime-only `#backtrace`, capturing the stack at exit-object creation time for debugging.

## Construction
- `new LocationExit({ description, destination, destinationRegion, travelTimeMinutes, bidirectional, id, imageId, isVehicle, vehicleType })`.

## Accessors
- Getters: `id`, `description`, `destination`, `destinationRegion`, `travelTimeMinutes`, `associatedRegionStub`, `region`, `location`, `name`, `relativeName`, `bidirectional`, `isVehicle`, `vehicleType`, `createdAt`, `imageId`, `lastUpdated`, `backtrace`.
- Setters: `description`, `destination`, `destinationRegion` (no-op with warning), `travelTimeMinutes`, `bidirectional`, `imageId`, `isVehicle`, `vehicleType`.

## Instance API
- `isReversible()`: alias of `bidirectional`.
- `createReverse(reverseDescription, { destination })`: creates a reverse exit (requires caller to supply source id) and preserves `travelTimeMinutes`.
- `update({ description, destination, destinationRegion, travelTimeMinutes, bidirectional, isVehicle, vehicleType })`.
- `getSummary()` / `getDetails()`: returns a detail object.
- `toJSON()`: alias of `getDetails()`.
- `toString()`: human-readable representation.

## Static API
- `createBidirectionalPair({ location1Id, location2Id, description1to2, description2to1, travelTimeMinutes })`.
- `createOneWay({ description, destination, travelTimeMinutes })`.

## Notes
- `destinationRegion` is derived from the destination location; direct setting is intentionally disabled.
- `travelTimeMinutes` is persisted as a non-negative integer minute amount and drives non-vehicle exit traversal time advancement.
- `associatedRegionStub` and `location` fall back to server stub data when full objects are not yet generated.
- `backtrace` is intentionally excluded from `toJSON()`/save serialization; it reflects the current runtime creation path, including load-time reconstruction.
