# LocationExit

## Purpose
Represents a connection between locations (or regions), with optional vehicle semantics and bidirectional travel.

## Key State
- `#id`, `#description`, `#destination`, `#destinationRegion`.
- `#bidirectional`, `#isVehicle`, `#vehicleType`.
- `#imageId`, `#createdAt`, `#lastUpdated`.

## Construction
- `new LocationExit({ description, destination, destinationRegion, bidirectional, id, imageId, isVehicle, vehicleType })`.

## Accessors
- Getters: `id`, `description`, `destination`, `destinationRegion`, `associatedRegionStub`, `region`, `location`, `name`, `relativeName`, `bidirectional`, `isVehicle`, `vehicleType`, `createdAt`, `imageId`, `lastUpdated`.
- Setters: `description`, `destination`, `destinationRegion` (no-op with warning), `bidirectional`, `imageId`, `isVehicle`, `vehicleType`.

## Instance API
- `isReversible()`: alias of `bidirectional`.
- `createReverse(reverseDescription)`: creates a reverse exit (requires caller to supply source id).
- `update({ description, destination, destinationRegion, bidirectional, isVehicle, vehicleType })`.
- `getSummary()` / `getDetails()`: returns a detail object.
- `toJSON()`: alias of `getDetails()`.
- `toString()`: human-readable representation.

## Static API
- `createBidirectionalPair({ location1Id, location2Id, description1to2, description2to1 })`.
- `createOneWay({ description, destination })`.

## Notes
- `destinationRegion` is derived from the destination location; direct setting is intentionally disabled.
- `associatedRegionStub` and `location` fall back to server stub data when full objects are not yet generated.
