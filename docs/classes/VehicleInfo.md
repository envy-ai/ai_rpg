# VehicleInfo

## Purpose
`VehicleInfo` is the canonical metadata object for vehicle-capable `Location` and `Region` records. It stores presentation data, fixed-route constraints, the tracked outside exit, and the current trip target/timing state used by travel, maps, prompts, saves, and edit APIs.

`Location.isVehicle` and `Region.isVehicle` are derived from `vehicleInfo !== null`. Both owners normalize plain objects and `VehicleInfo` instances through `VehicleInfo.fromJSON(...)`, and both serialize vehicle state with `VehicleInfo.toJSON()`.

## Stored State
- `terrainTypes`: optional prompt-facing string. `null`, `undefined`, and blank strings normalize to `null`.
- `icon`: optional UI icon string. Blank strings normalize to `null`; callers use `🚗` as the display fallback when a vehicle has no icon.
- `currentDestination`: concrete destination location id for a resolved vehicle stop or immediately resolved movement.
- `pendingDestination`: unresolved or not-yet-finalized destination reference. Shape: `{ rawText, regionName, locationName, regionId, locationId }`.
- `destinations`: fixed-route entries. Plain entries are concrete location ids; `pending-region:<region name>` entries represent fixed-route destinations for regions that may not exist until arrival.
- `ETA`: absolute arrival minute on the `Globals.elapsedTime` scale.
- `departureTime`: absolute minute associated with the trip or last immediate vehicle retarget. Trip-state getters use it only together with `ETA`.
- `vehicleExitId`: id of the `LocationExit` representing the vehicle's current inside-to-outside exit.

## Construction And Serialization
- `new VehicleInfo({...})` normalizes each field and validates cross-field consistency.
- `VehicleInfo.fromJSON(data)` requires an object, accepts `ETA`/`eta`, `departureTime`/`departure_time`, and `vehicleExitId`/`vehicleExitID`, and rejects unsupported `destination`/`destinationType` fields.
- `toJSON()` returns only stored model fields: `terrainTypes`, `icon`, `currentDestination`, `pendingDestination`, `destinations`, `ETA`, `departureTime`, and `vehicleExitId`.

## Static Helpers
- `PENDING_REGION_ROUTE_PREFIX` is `pending-region:`.
- `buildPendingRegionPendingDestination(regionName)` returns a normalized region-only pending destination with `rawText` set to `<region>|`.
- `buildPendingRegionRouteEntry(regionName)` returns a canonical `pending-region:<region>` route entry.
- `parsePendingRegionRouteEntry(value)` returns route metadata for pending-region entries or `null` for ordinary entries; blank pending-region names throw.
- `destinationsContainRouteTarget(destinations, { locationId, regionName })` checks a normalized fixed-route list for either an exact location id or matching pending-region route.
- `destinationsContainCurrentDestination(destinations, currentDestination)` resolves the current destination location's region name when available.
- `destinationsContainPendingDestination(destinations, pendingDestination)` checks `pendingDestination.locationId`, explicit `regionName`, or a resolvable `locationId`/`regionId` region name.

## Accessors
- Get/set: `terrainTypes`, `icon`, `currentDestination`, `pendingDestination`, `destinations`, `ETA`, `departureTime`, `vehicleExitId`.
- `location`: resolves the outside location by scanning all location exits for `vehicleExitId`. Returns `null` when no `vehicleExitId` is set; throws when the id cannot resolve or resolves to an exit with no destination location.
- `isUnderway`: true when `ETA` and `departureTime` are set, the trip has started, and arrival time is still in the future. If no valid global elapsed time is available, it falls back to `ETA > departureTime`.
- `hasArrived`: true when `ETA` and `departureTime` are set, the trip has started, and `Globals.elapsedTime >= ETA`. It is false when elapsed time cannot be read.
- `isArriving`: true only for arrived trips with a positive departure-to-ETA window (`departureTime < ETA`).
- `timeTraveled`: minutes elapsed since `departureTime`, or `0` when `departureTime` is unset.
- `tripCompleteFraction`: `0` without both timing values, `1` for zero-or-negative duration windows, otherwise elapsed trip progress capped to `0..1`.

## Validation Rules
- `terrainTypes`, `icon`, `currentDestination`, and `vehicleExitId` must be strings or nullish values; strings are trimmed and blanks become `null`.
- `pendingDestination` must be an object, `null`, `undefined`, or an empty string. When present, each field must be a string or nullish value, and at least one field must be non-empty after normalization.
- `destinations` may be `null`/`undefined` for an empty list. Otherwise it must be an array of non-empty strings. Entries are trimmed, pending-region entries are canonicalized, and duplicates are removed.
- `ETA` and `departureTime` may be `null`, `undefined`, or an empty string. Otherwise each must be a finite, non-negative integer number.
- `ETA` and `departureTime` cannot be set unless either `currentDestination` or `pendingDestination` is set.
- `currentDestination` and `pendingDestination` are mutually exclusive.
- `departureTime` cannot be greater than `ETA` when both are set.
- When `destinations` is non-empty, the active `currentDestination` or `pendingDestination` must match a route entry by exact location id or by a matching pending-region route.

## Runtime Use
- Travel prose with positive `<vehicleInfo><travelTime>` starts a timed trip by setting `pendingDestination`, clearing `currentDestination`, storing `departureTime = Globals.elapsedTime`, setting `ETA`, and preserving the tracked `vehicleExitId`.
- Timed arrivals are finalized by resolving `pendingDestination`, unstubbing/creating the destination when needed, retargeting the vehicle exit, setting `currentDestination`, and clearing `pendingDestination`, `ETA`, and `departureTime`.
- When a timed arrival targets a specific location inside a pending region (`region|location`), arrival finalization expands the pending region-entry stub first, refreshes the preserved child location, and only then expands that child location if it is still stubbed. This keeps the vehicle in the newly generated destination region instead of expanding the child stub in the origin region.
- Immediate or zero-time vehicle movement retargets the vehicle exit and sets `currentDestination` without a pending trip.
- `Player.currentVehicle` wraps active location/region vehicle data with prompt/display fields such as `destination`, `destinationResolved`, `minutesToDestination`, `timeToDestination`, `isUnderway`, `hasArrived`, and `isArriving`.
- Location and region API payloads enrich embedded `vehicleInfo` with display-only fields: `isUnderway`, `hasArrived`, `isArriving`, `minutesToDestination`, `timeToDestination`, `tripCompleteFraction`, `destinationResolved`, and `displayDestination`.
- Map and location responses hide the tracked vehicle exit while the vehicle is underway, and while `ETA` has elapsed but a pending destination still needs arrival finalization.
- Event movement to an active in-motion vehicle's scheduled destination is suppressed; elapsed-time arrival finalization owns that transition.
- Save/load hydration preserves location and region `vehicleInfo`; ID migration rewrites referenced `currentDestination`, `destinations`, and `vehicleExitId` values.

## Editing And Generation
- Location, region, and stub edit APIs validate submitted vehicle data through `VehicleInfo`.
- `isVehicle=false` requires omitted/null `vehicleInfo` and clears vehicle metadata.
- `isVehicle=true` with omitted vehicle data preserves existing metadata when present or creates an empty `VehicleInfo`.
- The shared vehicle editor preserves pending destinations and `departureTime` for in-progress trips, supports new-region destinations through `pending-region:<region>` route entries, and rejects active destinations outside a non-empty fixed route.
- Region generation parses vehicle definitions into location or region vehicle records, assigns `vehicleExitId` to the relevant boarding/outside exit, resolves fixed destinations to ids when possible, and stores unresolved new-region route entries with the pending-region format.
