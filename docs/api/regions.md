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
  - `region`: `{ id, name, description, shortDescription, parentRegionId, parentRegionName?, averageLevel, controllingFactionId, secrets }`
  - `parentOptions`: array of `{ id, name, description, parentRegionId }`
- 404: `{ success: false, error }` if no current region

## GET /api/regions/:id
Fetch a region by id.

Response:
- 200: `{ success: true, region, parentOptions }`
  - `region`: `{ id, name, description, shortDescription, parentRegionId, parentRegionName?, averageLevel, controllingFactionId, secrets }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/regions/:id
Update a region.

Request:
- Body: `{ name: string, description: string, shortDescription?: string|null, parentRegionId?: string|null, averageLevel?: number|null, controllingFactionId?: string|null }`

Response:
- 200: `{ success: true, message, region, parentOptions }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Parent cycles are rejected.
- `averageLevel` accepts numeric values or `null`/empty string to clear.
- `controllingFactionId` must reference an existing faction id or be `null` to clear.

## POST /api/regions/generate
Generate a region using AI.

Request:
- Body: `{ regionName?, regionDescription?, regionNotes?, clientId?, requestId? }`

Response:
- 200: `{ success: true, region: Region, createdLocationIds, createdLocations, entranceLocationId, message, requestId? }`
- 500: `{ success: false, error, requestId? }`

Notes:
- When `clientId` is provided, realtime events are emitted during generation.
