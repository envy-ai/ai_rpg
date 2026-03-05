# VehicleInfo

## Purpose
Represents lightweight vehicle travel state for vehicle-capable `Location` and `Region` entities.

## Key State
- `terrainTypes`: optional string used by prompts/LLM (typically comma-separated terrain tags).
- `icon`: optional emoji/string used to visually represent the vehicle in the UI.
- `currentDestination`: optional current destination location id.
- `destinations`: ordered list of destination location ids for fixed routes.
- `ETA`: optional absolute game minute (`Globals.elapsedTime` scale) for arrival.
- `vehicleExitId`: optional location-exit id used as the vehicle's current outward exit.

## Construction
- `new VehicleInfo({...})` validates all fields and cross-field consistency.
- `static fromJSON(data)` hydrates from persisted/API payload data.

## Accessors
- Get/set: `terrainTypes`, `icon`, `currentDestination`, `destinations`, `ETA`, `vehicleExitId`.
- Read-only getter: `location` resolves the current outside location from `vehicleExitId`.

## Instance API
- `toJSON()` returns a persistence-safe object with the same field names.

## Validation Rules
- `terrainTypes` must be a string or `null`.
- `icon` must be a string or `null`.
- `destinations` must be an array of non-empty string location ids (duplicates are removed).
- `ETA` must be a non-negative integer or `null`.
- `ETA` cannot be set when `currentDestination` is `null`.
- If `destinations` is non-empty and `currentDestination` is set, `currentDestination` must be present in `destinations`.
- `location` throws when `vehicleExitId` is set but does not resolve to a valid exit/location.
