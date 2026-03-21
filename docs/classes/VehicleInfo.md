# VehicleInfo

## Purpose
Represents lightweight vehicle travel state for vehicle-capable `Location` and `Region` entities.

## Key State
- `terrainTypes`: optional string used by prompts/LLM (typically comma-separated terrain tags).
- `icon`: optional emoji/string used to visually represent the vehicle in the UI.
- `currentDestination`: optional current destination location id.
- `destinations`: ordered list of destination location ids for fixed routes.
- `ETA`: optional absolute game minute (`Globals.elapsedTime` scale) for arrival.
- `departureTime`: optional absolute game minute (`Globals.elapsedTime` scale) marking when the current trip started.
- `vehicleExitId`: optional location-exit id used as the vehicle's current outward exit.

## Construction
- `new VehicleInfo({...})` validates all fields and cross-field consistency.
- `static fromJSON(data)` hydrates from persisted/API payload data.

## Accessors
- Get/set: `terrainTypes`, `icon`, `currentDestination`, `destinations`, `ETA`, `departureTime`, `vehicleExitId`.
- Read-only getter: `location` resolves the current outside location from `vehicleExitId`.
- Read-only getter: `isUnderway` is `true` only when `ETA` is a positive number.
- Read-only getter: `hasArrived` is `true` only when `ETA` is `<= 0`.
- Read-only getter: `isArriving` is `true` when remaining time (`ETA - Globals.elapsedTime`) is `<= 0` after having started from a positive remaining-time state.
- Read-only getter: `timeTraveled` returns minutes elapsed since `departureTime` (or `0` when unset).
- Read-only getter: `tripCompleteFraction` returns progress from `0` to `1` inclusive.

## Instance API
- `toJSON()` returns a persistence-safe object with the same field names.

## Validation Rules
- `terrainTypes` must be a string or `null`.
- `icon` must be a string or `null`.
- `destinations` must be an array of non-empty string location ids (duplicates are removed).
- `ETA` must be a non-negative integer or `null`.
- `ETA` cannot be set when `currentDestination` is `null`.
- `departureTime` must be a non-negative integer or `null`.
- `departureTime` cannot be set when `currentDestination` is `null`.
- If `destinations` is non-empty and `currentDestination` is set, `currentDestination` must be present in `destinations`.
- `location` throws when `vehicleExitId` is set but does not resolve to a valid exit/location.
