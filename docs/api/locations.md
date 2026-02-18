# Location & Exit API (from api.js)

See `docs/api/serialization.md` for shared shapes.

## GET /api/exits/options

Request:
- Query: `originLocationId` (optional)

Responses:
- 200: `{ success: true, regions, originRegionId? }`
  - `regions` is a list of region option groups:
    - `{ id, name, isStub, locations: Array<{ id, name, isStub, regionId, isRegionEntryStub }> }`
- 500: `{ success: false, error }`

## GET /api/locations

Request:
- Query: `scope=current|named|names` (optional)

Responses:
- 200 (scope=current): `{ success: true, location: LocationResponse }`
- 200 (default list): `{ success: true, locations: Array<{ id, name, regionId, regionName, label }> }`
- 404: `{ success: false, error }` (scope=current with no current location)
- 500: `{ success: false, error }`

## POST /api/locations/generate

Request:
- Body: `{ clientId?, requestId?, locationStyle? }` plus optional generation inputs.

Responses:
- 200: `{ success: true, location, locationId, locationName, gameWorldStats, generationInfo, message, requestId? }`
  - `location` matches `LocationResponse` with `pendingImageJobId`, `npcs`, and `things` populated.
- 408: `{ success: false, error, details, requestId? }` (AI timeout)
- 503: `{ success: false, error, details, requestId? }` (AI connection failure)
- 500: `{ success: false, error, details, requestId? }`

Notes:
- Emits realtime events when `clientId` is provided (`generation_status`, `location_generated`).

## GET /api/locations/:id

Request:
- Path: `id`
- Query: `expandStubs` (default true; `0|false|no|off` disables)

Responses:
- 200: `{ success: true, location: LocationResponse }`
- 404: `{ success: false, error }`
- 500: `{ success: false, error, trace? }` (stub expansion failures may include `trace`)

## PUT /api/locations/:id

Request:
- Body:
  - `description` (required string)
  - `level` (required number)
  - `name` (string or null, optional)
  - `shortDescription` (string or null, optional)
  - `controllingFactionId` (string or null, optional)
  - `statusEffects` (array or null, optional)

Responses:
- 200: `{ success: true, message, location: LocationResponse, imageCleared: boolean, changes: { name, description, level } }`
- 400/404/500: `{ success: false, error }`

Notes:
- `controllingFactionId` must reference an existing faction id or be `null` to clear.

## POST /api/locations/:id/exits

Request:
- Body supports:
  - `type` (`location` or `region`)
  - `name`, `description`
  - `regionId` (target region id), `locationId` (target location id)
  - `parentRegionId` (for region stubs)
  - `vehicleType` (string)
  - `relativeLevel` (number, -10..10)
  - `clientId` (for realtime notifications)
  - `imageDataUrl`, `imageDataUrlOriginal` (PNG data URLs for reference images; only for new stubs)

Responses:
- 200: `{ success: true, message, location: LocationResponse, created }`
  - `created` varies:
    - Region stub: `{ type: 'region', stubId, regionId, name, parentRegionId, isVehicle, vehicleType }`
    - Existing location: `{ type: 'location', destinationId, name, isStub, existing: true, isVehicle, vehicleType }`
    - New location stub: `{ type: 'location', destinationId, name, isStub, isVehicle, vehicleType }`
- 400/404/500: `{ success: false, error }`

## DELETE /api/locations/:id/exits/:exitId

Request:
- Optional Body or Query: `clientId`, `requestId` (used for realtime notifications)

Responses:
- 200: `{ success: true, message, location: LocationResponse, removed, reverseRemoved?, deletedStub?, preservedStub? }`
  - `removed`: `{ exitId, direction }`
  - `reverseRemoved`: `{ exitId, direction }` when a reverse exit is removed
  - `deletedStub`: stub deletion info when removing the last exit of a stub
  - `preservedStub`: stub info when stub remains but loses this exit
- 400/404/500: `{ success: false, error }`

## POST /api/locations/:id/npcs

Request:
- Body supports seed fields: `name` (required), `description`, `shortDescription`, `role`, `class`, `race`,
  `currency`, `level`, `isHostile`, `notes`, plus optional `imageDataUrl` + `imageDataUrlOriginal` (PNG data URLs)

Responses:
- 200: `{ success: true, npc: NpcProfile, location: LocationResponse, message }`
- 400/404/500: `{ success: false, error }`

## POST /api/locations/:id/things

Request:
- Body: `{ seed: { name?, description?, shortDescription?, type?, slot?, rarity?, itemOrScenery?, value?, weight?, level?, relativeLevel?, isVehicle?, isHarvestable?, isCraftingStation?, isProcessingStation?, isSalvageable?, notes? }, level? }`

Responses:
- 200: `{ success: true, thing: ThingJson, location: LocationResponse, message }`
- 400/404/500: `{ success: false, error }`

Notes:
- `seed.name` is optional; when omitted, the item/scenery generator is expected to produce a name.

## GET /api/stubs/:id

Responses:
- 200: `{ success: true, stub: { id, name, isRegionEntryStub, targetRegionId, targetRegionName, controllingFactionId, npcs } }`
- 400/404/500: `{ success: false, error }`

## PUT /api/stubs/:id

Request:
- Body: `name` (required), `description` (required), `relativeLevel?` (number), `controllingFactionId?` (string or null)

Responses:
- 200: `{ success: true, stub: { id, name, description, relativeLevel, isRegionEntryStub, targetRegionId, targetRegionName, controllingFactionId } }`
- 400/404/500: `{ success: false, error }`

Notes:
- `controllingFactionId` must reference an existing faction id or be `null` to clear.

## DELETE /api/stubs/:id

Responses:
- 200: `{ success: true, stubId, targetRegionId, removedExitIds, deletedNpcIds, npcSummaries }`
- 400/404/500: `{ success: false, error }`
