# Regions API

Routes are registered in `api.js`. Shared shapes are documented in `docs/api/common.md`, especially `VehicleInfo`.

The region detail payload returned by `GET /api/regions?scope=current`, `GET /api/regions/:id`, and `PUT /api/regions/:id` is:

- `id`
- `name`
- `description`
- `shortDescription` (`string | null`)
- `parentRegionId` (`string | null`)
- `parentRegionName` (`string | null`, present only when the parent id resolves)
- `averageLevel` (`number | null`)
- `controllingFactionId` (`string | null`)
- `isVehicle` (derived from `vehicleInfo !== null`)
- `vehicleInfo` (`VehicleInfo | null`)
- `secrets` (`string[]`)
- `weather`
- `weatherState`

`parentOptions` entries are sorted by region name and use `{ id, name, description, parentRegionId }`. Detail routes exclude the edited/fetched region from `parentOptions`.

## GET /api/regions

Lists region summaries, or returns the active region when `scope=current`.

Request:
- Query: `scope=current` returns the active player region detail payload.

Responses:
- 200 list: `{ success: true, regions }`
  - `regions`: sorted array of `{ id, name, parentRegionId, averageLevel }`
- 200 `scope=current`: `{ success: true, region, parentOptions }`
- 404 `scope=current`: `{ success: false, error }` when no current region is set.
- 500: `{ success: false, error }`

## GET /api/regions/:id

Fetches one region by id.

Request:
- Path: `id` must be a non-empty region id.

Responses:
- 200: `{ success: true, region, parentOptions }`
- 400: `{ success: false, error }` when `id` is blank.
- 404: `{ success: false, error }` when the region is missing.
- 500: `{ success: false, error }`

## PUT /api/regions/:id

Updates a region. The route is used by the region editor and the weather editor, so callers should send a complete payload for required/core fields.

Request:
- Path: `id` must be a non-empty region id.
- Body:
  - `name` (required string; trimmed and must not be empty)
  - `description` (required string; trimmed)
  - `shortDescription` (`string | null`, optional; omitted preserves the existing value)
  - `parentRegionId` (`string | null`; omitted is treated as `null`)
  - `averageLevel` (`number | numeric string | null | ""`, optional)
  - `controllingFactionId` (`string | null`, optional)
  - `secrets` (`string[]`, optional)
  - `isVehicle` (`boolean`, optional)
  - `vehicleInfo` (`object | null`, optional)
  - `weather` (`object | null`, optional)

Responses:
- 200: `{ success: true, message, region, parentOptions, worldTime }`
  - `worldTime` is populated when `weather` is present in the request; otherwise it is `null`.
- 400: `{ success: false, error }` for validation errors.
- 404: `{ success: false, error }` when the region or submitted parent region is missing.
- 500: `{ success: false, error }`

Validation and normalization:
- Parent cycles are rejected, including assigning a region as its own parent.
- `averageLevel` is cleared by `null` or `""`; otherwise it must be numeric and is stored through `Region.setAverageLevel`, which rounds to a whole number and stores at least `1`.
- `controllingFactionId` must reference an existing faction id, or be `null`/empty to clear.
- `secrets` must be an array of strings. Entries are trimmed and empty strings are dropped.
- Vehicle state is stored as `vehicleInfo`; `isVehicle` is derived from whether `vehicleInfo` exists.
- `isVehicle=false` requires omitted/null `vehicleInfo` and clears vehicle data.
- `isVehicle=true` with omitted `vehicleInfo` preserves existing vehicle data when present, or creates an empty `VehicleInfo`.
- `vehicleInfo` without `isVehicle` sets vehicle state when it is an object, and clears vehicle state when it is `null`.
- Region vehicle data uses canonical `VehicleInfo` fields: `terrainTypes`, `icon`, `currentDestination`, `pendingDestination`, `destinations`, `ETA`, `departureTime`, and `vehicleExitId`.
- `VehicleInfo` validation requires non-negative integer `ETA`/`departureTime` values, forbids simultaneous `currentDestination` and `pendingDestination`, forbids trip timing without a destination, checks `departureTime <= ETA`, and requires fixed-route destinations to contain the active current/pending destination when routes are specified.

Weather:
- `weather=null` or an omitted weather definition normalizes to `{ hasDynamicWeather: false, seasonWeather: [] }`.
- `weather.hasDynamicWeather` accepts booleans and boolean-like strings (`true`, `false`, `1`, `0`, `yes`, `no`).
- When `hasDynamicWeather=true`, `seasonWeather` must include at least one valid season.
- Each season uses `{ seasonName, weatherTypes }`; `seasonName` is required and `weatherTypes` must be a non-empty array.
- Each weather type uses `{ name, description, relativeFrequency, durationRange }`; `relativeFrequency` must be greater than zero.
- `durationRange` is canonical as `{ minMinutes, maxMinutes }`, and may also be submitted as a parseable duration range string such as `30 minutes - 2 hours`.
- Stored `weatherState` uses `{ seasonName, name, description, nextChangeMinutes, durationMinutes }`.
- Assigning `weather` resets `weatherState`. The `PUT` response includes `worldTime` so clients can redraw the time/weather indicator after saving weather.
- Weather resolution inherits from the nearest parent region with dynamic weather. If no dynamic weather is available, weather-visible locations receive the no-active-weather result.

## POST /api/regions/generate

Generates a region through the region generator prompt, stores the generated region, instantiates its locations, chooses an entrance, and generates regional NPCs.

Request:
- Body: `{ regionName?, regionDescription?, regionNotes?, clientId?, requestId? }`

Request handling:
- `regionName` is trimmed; blank values are treated as absent.
- `regionDescription` is passed into the generator as the description.
- The route passes `regionDescription` into the generator notes field. The `regionNotes` body field is not forwarded by this route.
- The active setting snapshot supplies prompt setting context.

Responses:
- 200: `{ success: true, region, createdLocationIds, createdLocations, entranceLocationId, message, requestId? }`
  - `region` is `Region.toJSON()`, not the narrower region detail payload used by the read/update routes.
  - `createdLocationIds` mirrors the generated region's `locationIds`.
  - `createdLocations` contains `Location.toJSON()` for instantiated generated locations.
- 500: `{ success: false, error, requestId? }`

Realtime:
- When `clientId` is provided, generation emits `generation_status` events with `scope: "region"`.
- When realtime streaming is enabled, completion also emits `region_generated` with the generated region JSON, created location ids, and entrance location id.

## UI and Map Consumers

- The region edit modal loads `GET /api/regions/:id`, saves with `PUT /api/regions/:id`, and sends full core fields plus vehicle, faction, parent, average level, and secrets data.
- The weather edit modal loads `GET /api/regions/:id`, saves with `PUT /api/regions/:id`, preserves the non-weather region fields from the loaded snapshot, and refreshes the time/weather indicator from the returned `worldTime`.
- Region and world map routes use region `parentRegionId`, `averageLevel`, `isVehicle`, and `vehicleInfo.icon` when building map summaries, but those map payloads are documented separately in `docs/api/locations.md`.
