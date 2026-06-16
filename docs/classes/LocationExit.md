# LocationExit

## Purpose
`LocationExit` represents a directed travel edge from one `Location` to another destination location id. The owning `Location` stores the exit under a direction key; the exit stores destination, travel-time, reverse-link, vehicle-edge, persisted image id, timestamp, and debug-backtrace metadata.

Exits can point at fully generated locations, location stubs, or region-entry stubs. A stored `destinationRegion` hint is used for cross-region and pending-region exits, but runtime resolution prefers the destination location's live region when that location exists.

`LocationExit` is the low-level graph edge. Location, map, and image API payloads enrich it with destination display names, stub/visit state, vehicle display state, and image-job state.

## Key State
- Identity and text: `#id`, `#description`, `#destination`, `#imageId`.
- Destination hints: `#destinationRegion`.
- Travel data: `#travelTimeMinutes`, `#bidirectional`.
- Vehicle-edge data: `#isVehicle`, `#vehicleType`.
- Timestamps: `#createdAt`, `#lastUpdated`.
- Runtime diagnostics: `#backtrace`.

## Construction And Validation
- Constructor options are `description`, `destination`, `destinationRegion`, `travelTimeMinutes`, `bidirectional`, `id`, `imageId`, `isVehicle`, and `vehicleType`.
- The constructor rejects missing or non-string `destination` values and stores the trimmed string. Callers are expected to pass a non-empty destination id.
- `description` defaults to an empty string and must be a string when supplied.
- Missing `id` values are allocated through `IdGenerator.next('exit')`; every id is registered with `IdGenerator.register('exit', id)`.
- `destination`, `description`, `destinationRegion`, and `vehicleType` string values are trimmed. Empty `destinationRegion` and `vehicleType` values are stored as `null`; non-string `destinationRegion` constructor input is also stored as `null`.
- `travelTimeMinutes` accepts a non-negative integer minute value after numeric coercion. `null`, `undefined`, and an empty string normalize to `0`.
- `bidirectional` and `isVehicle` must be booleans.
- `vehicleType` must be a string or `null`; a non-empty vehicle type forces `isVehicle=true`.
- The constructor stores `imageId` as supplied; the `imageId` setter requires a string or `null`.
- `createdAt` and `lastUpdated` are initialized at construction. Mutating setters update `lastUpdated`.
- `backtrace` captures the runtime stack for diagnostics and is not serialized.

## Accessors
- Basic getters: `id`, `description`, `destination`, `travelTimeMinutes`, `bidirectional`, `isVehicle`, `vehicleType`, `imageId`, `createdAt`, `lastUpdated`, `backtrace`.
- Destination helpers: `destinationRegion`, `associatedRegionStub`, `region`, `location`, `name`, `relativeName`.
- Basic setters: `description`, `destination`, `travelTimeMinutes`, `bidirectional`, `imageId`, `isVehicle`, `vehicleType`.
- `destinationRegion` has a setter for compatibility, but the setter only logs/traces a warning and leaves stored state unchanged.
- Setting `isVehicle=false` clears `vehicleType`.
- Setting `vehicleType` to a non-empty string sets `isVehicle=true`.
- `createdAt` and `lastUpdated` return `Date` copies, not the internal objects.

## Destination And Region Resolution
- `destinationRegion` first returns the current region id of the destination `Location` when the destination can be resolved.
- If the destination location cannot provide a region, `destinationRegion` returns the stored `#destinationRegion` hint.
- If neither source resolves, `destinationRegion` logs diagnostic details, removes exits in loaded locations that point at the missing destination id, and returns `null`.
- `associatedRegionStub` looks for a pending region stub by stored destination-region id, entrance-stub id, and normalized destination/stub names.
- `region` resolves to the destination location's live `Region`, then the stored destination-region `Region`, then an associated pending-region stub.
- `location` resolves through `Location.get(...)`, server `gameLocations`, associated region-stub entrance ids, and name matching. It may return a pending stub record when no `Location` object exists.
- `name` prefers a resolved region or region-stub name, then a destination location name, then the exit description, then the destination id.
- `relativeName` appends the destination region name when `Globals.location` is in a different region.

## Instance API
- `isReversible()` returns `bidirectional`.
- `createReverse(reverseDescription, { destination })` returns `null` for one-way exits. For reversible exits it requires a reverse description, points at the supplied destination id, copies `travelTimeMinutes`, and sets `bidirectional=true`. If `destination` is omitted, it uses the literal placeholder `source_location_id`. It does not copy vehicle metadata, image metadata, or destination-region hints.
- `update({ description, destination, travelTimeMinutes, bidirectional, isVehicle, vehicleType })` applies the same setters as direct mutation. A `destinationRegion` argument is accepted by the signature but is not applied.
- `getSummary()` returns `getDetails()`.
- `getDetails()` returns the serialized exit shape: `id`, `description`, `destination`, stored `destinationRegion`, `travelTimeMinutes`, resolved `name`, `bidirectional`, `imageId`, `isVehicle`, `vehicleType`, `type`, `createdAt`, and `lastUpdated`.
- `toJSON()` returns `getDetails()`.
- `toString()` includes id, description, vehicle marker, minute count, direction arrow, and destination id.

## Static API
- `createBidirectionalPair({ location1Id, location2Id, description1to2, description2to1, travelTimeMinutes })` validates all ids/descriptions and returns `{ exit1to2, exit2to1 }`. Both exits are marked bidirectional and use the same travel time.
- `createOneWay({ description, destination, travelTimeMinutes })` returns a non-bidirectional exit.
- Static helpers create `LocationExit` objects only; callers must attach them to `Location` instances and register them in any global exit map when needed.

## Serialization And Save/Load
- `LocationExit.toJSON()` excludes `backtrace` and emits the stored `#destinationRegion`, not the getter-derived region.
- `Location.getDetails()` embeds exit entries keyed by direction, adds `relativeName`, and includes the full `exitObject`. The top-level `destinationRegion` in each location exit entry is resolved from the destination location's live region when possible; `exitObject.destinationRegion` is the `LocationExit` stored hint.
- `Utils.serializeGameState(...)` writes both location-scoped exits and the global `gameWorld.locationExits` map.
- `Utils.hydrateGameState(...)` reconstructs location-scoped exits first and reuses matching global exit ids. Standalone global exit entries are hydrated afterward.
- Saved exit data with missing, `null`, or empty `travelTimeMinutes` hydrates as `0`; invalid travel-time values throw.
- Saved `vehicleType` implies `isVehicle=true`.
- Rehydrated exits receive a fresh runtime `backtrace` for the load-time construction path.

## Runtime Integration
- `server.ensureExitConnection(...)` is the primary runtime helper for creating and updating graph links. It logs and returns `null` when either endpoint is missing, throws on self-referential exits, creates or reuses the directed exit from source to destination, and stores new exits in `gameLocationExits`.
- Reused exits keep their direction key. `ensureExitConnection(...)` updates destination and bidirectionality, updates description only when a description is supplied, updates travel time only when a value is supplied and `updateExistingExitTravelTime` is not `false`, and updates vehicle fields only when vehicle options are supplied.
- Reverse links created by `ensureExitConnection(...)` are direct non-bidirectional exits back to the source. They carry the source-region hint, travel-time value, and vehicle-edge metadata from the source exit request.
- Region generation, region-stub expansion, event handling, API exit creation, and chat-tool exit creation route through `ensureExitConnection(...)` or the same stub helpers.
- Generated or prompted exit travel times are parsed by callers. Prompt-generated `0` minutes are normalized to `1` before they reach `LocationExit`; `LocationExit` itself allows `0` for unpopulated or no-time exits.
- `/api/locations/:id/exits` defaults unspecified travel time to `1` minute and accepts duration strings or non-negative integer minute values.
- `new_exit_discovered` and `move_new_location` event handling can thread parsed travel minutes into created location/region stubs and their reverse links. Event-created exits from location vehicles, and region exits from region vehicles, are suppressed when the event would create a new vehicle-origin connection.
- `/api/locations/:id/exits/:exitId` removes the requested exit, removes a reverse exit to the origin when present, and can delete orphaned destination stubs or pending-region stubs.
- `/fix_exits` scans loaded exits and calls `ensureExitConnection(...)` to repair missing reverse links while preserving vehicle-edge markers.
- `/fill_exit_travel_times` treats `0`-minute exits as unpopulated unless run in force mode, copies positive reverse times when available, and can prompt for missing region-exit travel times.

## Image Generation
- `imageId` stores the generated passage-scene image id for the exit.
- `/api/images/generate` accepts exit entity types `exit`, `location-exit`, and `location_exit`; it resolves the exit from `gameLocationExits` and queues `generateLocationExitImage(...)`.
- `generateLocationExitImage(...)` uses the location-exit image prompt template, reuses an existing image unless `force=true`, clears `imageId` before forced regeneration, attaches a runtime `pendingImageJobId`, and writes the completed image id back to `imageId`.
- `pendingImageJobId` is a runtime property assigned by the generator path; it is not part of `LocationExit.toJSON()`.

## Travel And Map Semantics
- Direct player movement uses a positive `travelTimeMinutes` to advance world time only when the source location context is not a vehicle location or vehicle region.
- Fast-travel previews and favorite travel estimates use `Location.findShortestTravelTimeMinutes(...)`, which runs Dijkstra over directed exits and throws on malformed graph data.
- Event movement uses the directed shortest-route helper for elapsed time and uses `1` minute when no route exists; direct `/api/player/move` uses the selected exit's own `travelTimeMinutes`.
- `isVehicle` and `vehicleType` describe the exit edge, such as boarding or disembarking. They do not by themselves mean the destination is a vehicle.
- API and map payloads derive destination-vehicle state separately as `destinationIsVehicle`, `destinationVehicleType`, `vehicleIcon`, `isVehicleInbound`, and `isVehicleOutbound`.
- Location and map responses hide vehicle exits that are tied to vehicles in transit or still finalizing arrival.

## Debugging
- `backtrace` is runtime-only and reflects object construction, including hydration-time construction.
- The `/exit_backtraces` slash command lists current-location exits with id, destination, stored destination-region value, vehicle-edge fields, and `backtrace`.
