# Regions API

Common payloads: see `docs/api/common.md`.

## GET /api/regions
List regions or fetch current region details.

Request:
- Query: `scope=current` to return the active region with parent options.

Response (list):
- 200: `{ success: true, regions: Array<{ id, name, parentRegionId, averageLevel }> }`

Response (scope=current):
- 200: `{ success: true, region, parentOptions }`
  - `region`: `{ id, name, description, shortDescription, parentRegionId, parentRegionName?, averageLevel, controllingFactionId, isVehicle, vehicleInfo, secrets, weather, weatherState }`
  - `parentOptions`: array of `{ id, name, description, parentRegionId }`
- 404: `{ success: false, error }` if no current region

## GET /api/regions/:id
Fetch a region by id.

Response:
- 200: `{ success: true, region, parentOptions }`
  - `region`: `{ id, name, description, shortDescription, parentRegionId, parentRegionName?, averageLevel, controllingFactionId, isVehicle, vehicleInfo, secrets, weather, weatherState }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/regions/:id
Update a region.

Request:
- Body: `{ name: string, description: string, shortDescription?: string|null, parentRegionId?: string|null, averageLevel?: number|null, controllingFactionId?: string|null, isVehicle?: boolean, vehicleInfo?: object|null, secrets?: string[], weather?: object|null }`

Response:
- 200: `{ success: true, message, region, parentOptions, worldTime? }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Parent cycles are rejected.
- `averageLevel` accepts numeric values or `null`/empty string to clear.
- `controllingFactionId` must reference an existing faction id or be `null` to clear.
- Vehicle edits use `isVehicle` + `vehicleInfo` together:
  - `isVehicle=false` clears vehicle info (and `vehicleInfo` must be null/omitted).
  - `isVehicle=true` requires a valid `vehicleInfo` object (or existing data when `vehicleInfo` is omitted).
  - `vehicleInfo` is validated by `VehicleInfo` rules (`icon` optional string, `ETA` non-negative integer, fixed-route consistency checks).
- `secrets` must be an array of strings; entries are trimmed and empty values are dropped.
- `weather` uses the persisted `Region.weather` shape: `{ hasDynamicWeather: boolean, seasonWeather: Array<{ seasonName, weatherTypes: Array<{ name, description, relativeFrequency, durationRange }> }> }`.
- `durationRange` can be an object with minute fields (`{ minMinutes, maxMinutes }`) or a parseable duration range string such as `30 minutes - 2 hours`.
- Regions without dynamic weather inherit current weather from the nearest parent region with dynamic weather when weather-visible locations resolve current conditions.
- Updating `weather` clears the current `weatherState`; the response includes a fresh `worldTime` payload so clients can redraw the weather line immediately.

## POST /api/regions/generate
Generate a region using AI.

Request:
- Body: `{ regionName?, regionDescription?, regionNotes?, clientId?, requestId? }`

Response:
- 200: `{ success: true, region: Region, createdLocationIds, createdLocations, entranceLocationId, message, requestId? }`
- 500: `{ success: false, error, requestId? }`

Notes:
- When `clientId` is provided, realtime events are emitted during generation.
