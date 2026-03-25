# VehicleInfo

## Purpose
Represents lightweight vehicle travel state for vehicle-capable `Location` and `Region` entities.

## Key State
- `terrainTypes`: optional string used by prompts/LLM (typically comma-separated terrain tags).
- `icon`: optional emoji/string used to visually represent the vehicle in the UI.
- `currentDestination`: optional current destination location id.
- `pendingDestination`: optional structured pending destination reference used while a timed trip is underway before arrival finalization resolves a concrete location. Shape: `{ rawText, regionName, locationName, regionId, locationId }`.
- `destinations`: ordered list of destination location ids for fixed routes.
- `ETA`: optional absolute game minute (`Globals.elapsedTime` scale) for arrival.
- `departureTime`: optional absolute game minute (`Globals.elapsedTime` scale) marking when the current trip started.
- `vehicleExitId`: optional location-exit id used as the vehicle's current outward exit.

## Construction
- `new VehicleInfo({...})` validates all fields and cross-field consistency.
- `static fromJSON(data)` hydrates from persisted/API payload data.

## Accessors
 - Get/set: `terrainTypes`, `icon`, `currentDestination`, `pendingDestination`, `destinations`, `ETA`, `departureTime`, `vehicleExitId`.
- Read-only getter: `location` resolves the current outside location from `vehicleExitId`.
- Read-only getter: `isUnderway` is `true` only after a trip has actually started (`departureTime <= Globals.elapsedTime`) and while `ETA > Globals.elapsedTime`.
- Read-only getter: `hasArrived` is `true` only after a trip has actually started and `ETA <= Globals.elapsedTime`.
- Read-only getter: `isArriving` becomes `true` once the trip has reached/passed `ETA` after having had a valid departure-to-arrival window; pre-departure states do not count as arriving/arrived.
- Read-only getter: `timeTraveled` returns minutes elapsed since `departureTime` (or `0` when unset).
- Read-only getter: `tripCompleteFraction` returns progress from `0` to `1` inclusive.

## Instance API
- `toJSON()` returns a persistence-safe object with the same field names.

## Validation Rules
- `terrainTypes` must be a string or `null`.
- `icon` must be a string or `null`.
- `pendingDestination` must be an object or `null`; when present it must contain at least one non-empty destination reference field.
- `destinations` must be an array of non-empty string location ids (duplicates are removed).
- `ETA` must be a non-negative integer or `null`.
- `ETA` cannot be set when both `currentDestination` and `pendingDestination` are `null`.
- `departureTime` must be a non-negative integer or `null`.
- `departureTime` cannot be set when both `currentDestination` and `pendingDestination` are `null`.
- `currentDestination` and `pendingDestination` cannot both be set at the same time.
- `departureTime` cannot be greater than `ETA`.
- If `destinations` is non-empty and `currentDestination` is set, `currentDestination` must be present in `destinations`.
- If `destinations` is non-empty and `pendingDestination.locationId` is set, that location id must be present in `destinations`.
- `location` throws when `vehicleExitId` is set but does not resolve to a valid exit/location.
