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
  - `hasWeather` (`"yes"`, `"no"`, `"outside"`, boolean, or null, optional; stored as normalized `generationHints.hasWeather`)
  - `isVehicle` (boolean, optional)
  - `vehicleInfo` (object or null, optional)
  - `statusEffects` (array or null, optional)

Responses:
- 200: `{ success: true, message, location: LocationResponse, imageCleared: boolean, worldTime?, changes: { name, description, shortDescription, level, vehicle, hasWeather } }`
- 400/404/500: `{ success: false, error }`

Notes:
- `controllingFactionId` must reference an existing faction id or be `null` to clear.
- `hasWeather="yes"` marks the location as weather-exposed, `"no"` marks it as sheltered/no local weather, `"outside"` means exterior weather is visible from a sheltered location, and `null` returns to automatic region/weather behavior. Legacy booleans are accepted and normalized to `yes`/`no`. Changing this hint clears cached weather/lighting image variants but does not replace the base `location.imageId`.
- Vehicle edits use `isVehicle` + `vehicleInfo` together:
  - `isVehicle=false` clears vehicle info.
  - `isVehicle=true` requires valid vehicle data (`vehicleInfo` object or existing values when omitted, including optional `icon`).

## POST /api/locations/:id/modify

Runs the current-location `Modify Location` crafting flow. The endpoint uses optional selected player-inventory materials/tools plus freeform notes to run dedicated plausibility and success-degree prompts, then applies any accepted physical/environmental change through the existing `alter_location` event path with location level preservation enabled. Outcomes may also grant newly uncovered portable items to the player when those items are byproducts of the alteration, such as a coin found under repaired flooring.

Request:
- Path: `id` must be the active player's current location id.
- Body: `{ slots: Array<{ thingId, slotIndex? }>, notes?, noProse?, clientId? }`
  - `slots` may be empty; no-material attempts are judged from the location, player abilities, and notes.
  - Each selected item must be in the active player's inventory and must not be equipped.
  - `notes` may include an inline `<N>` die-roll override; the token is stripped before prompt rendering.
  - `noProse=true` skips player-action prose and event-summary chat entries, but still applies mutation, material consumption, received-item grants, time advancement, need/status ticking, vehicle-arrival processing, and quest checks.

Responses:
- 200: `{ success: true, location, outcome, resultLevel, plausibility, modification, consumedThingIds, consumedThingNames, receivedThingIds, receivedThingNames, narrative, unmatchedConsumedNames, timeTakenMinutes, timeProgress, worldTime, imageCleared }`
  - `modification`: `{ locationChanged, alteration, alterationSummary }`.
  - `receivedThingIds` / `receivedThingNames` list generated inventory items granted to the player by the modification outcome.
  - `narrative`: `{ description, otherEffect }`.
- 400: `{ success: false, error }`
  - No active player.
  - Target location is not the player's current location.
  - Selected item is missing, not in player inventory, equipped, or an attempted consumed container is not empty.
  - The plausibility prompt resolves to an implausible action.
- 404: `{ success: false, error }` (location not found)
- 500: `{ success: false, error }` for prompt rendering/parsing failures, unmatched consumed item names, failed `alter_location` mutation, or other server errors.

Notes:
- The base location level is preserved for this UI flow, even if the alteration prompt rewrites the name, description, or short description.
- If the selected outcome sets `locationChanged=true`, the endpoint clears the location's base image, weather/lighting image variants, and pending base-image job tracking so stale images do not reattach after the text change.
- Failed and critical-failure outcomes may still alter the location when the resolved result describes a botched, incomplete, damaging, or otherwise real environmental change.
- Consumed materials are matched exactly against selected slot item names; unknown consumed names fail loudly rather than being ignored. If no materials/tools were selected, `itemsConsumed` must remain empty.
- Received items must be newly found or obtained portable items. They are generated into the active player's inventory and must not exactly match selected input names; selected tools/materials that survive use should simply be omitted from `itemsConsumed` rather than listed as received.

## DELETE /api/locations/:id

Deletes a hydrated (non-stub) location with ordered cascade cleanup.

Execution order:
1. Delete items/scenery at the location.
2. Delete NPCs at the location.
   - Party NPCs are not deleted; they are moved to the player's current location.
3. Delete exits both from and to the location.
4. Delete the location record.

Request:
- Path: `id`

Responses:
- 200: `{ success: true, locationId, message, deletedThingIds, deletedNpcIds, relocatedPartyNpcIds, removedExitIds }`
- 400: `{ success: false, error }`
  - Missing id
  - Target is a stub (must use `/api/stubs/:id`)
  - Target is the player's current location
- 404: `{ success: false, error }` (location not found)
- 500: `{ success: false, error }`

## POST /api/locations/:id/exits

Request:
- Body supports:
  - `type` (`location` or `region`)
  - `name`, `description`
  - `travelTime` (shared duration string such as `1m`, `1h10m`, or `2 hours`)
  - `travelTimeMinutes` (optional non-negative integer minute override for programmatic callers)
  - `regionId` (target region id), `locationId` (target location id)
  - `parentRegionId` (for region stubs)
  - `vehicleType` (string)
  - `relativeLevel` (number, -10..10)
  - `clientId` (for realtime notifications)
  - `bidirectional` (optional boolean; when true, upgrades a newly created location-stub exit to two-way)
  - `imageDataUrl`, `imageDataUrlOriginal` (PNG data URLs for reference images; only for new stubs)

Responses:
- 200: `{ success: true, message, location: LocationResponse, created }`
  - `created` varies:
    - Region stub: `{ type: 'region', stubId, regionId, name, parentRegionId, isVehicle, vehicleType }`
    - Existing location: `{ type: 'location', destinationId, name, isStub, existing: true, isVehicle, vehicleType }`
    - New location stub: `{ type: 'location', destinationId, name, isStub, isVehicle, vehicleType }`
- 400/404/500: `{ success: false, error }`
  - New user-named location/region stubs can return `400` with `code: "invalid_world_entity_name"` and `nameRejection` when the requested name conflicts with an existing location, existing region, pending region stub, banned name fragment, or slop word.

Notes:
- When neither `travelTime` nor `travelTimeMinutes` is supplied, the exit defaults to `1` minute.
- Name validation happens before any new location/region stub is created, so rejected modal submissions do not mutate the world or add an exit.

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
- Body supports seed fields: `name` (optional), `description`, `shortDescription`, `role`, `class`, `race`,
  `currency`, `level`, `isHostile`, `notes`, plus optional `imageDataUrl` + `imageDataUrlOriginal` (PNG data URLs)

Responses:
- 200: `{ success: true, npc: NpcProfile, location: LocationResponse, message }`
- 400/404/500: `{ success: false, error }`

Notes:
- Concurrent requests are supported. In-flight dedupe only applies when an explicit non-empty `name` is provided.
- Single-NPC creation now waits for its generated progression pass before returning, so the created NPC should already have any LLM-assigned skill spec applied in the response payload.

## POST /api/locations/:id/things

Request:
- Body: `{ seed: { name?, description?, shortDescription?, type?, slot?, rarity?, itemOrScenery?, value?, weight?, level?, relativeLevel?, isVehicle?, isHarvestable?, isCraftingStation?, isProcessingStation?, isSalvageable?, isContainer?, notes? }, level? }`

Responses:
- 200: `{ success: true, thing: ThingJson, location: LocationResponse, message }`
- 400/404/500: `{ success: false, error }`

Notes:
- `seed.name` is optional; when omitted, the item/scenery generator is expected to produce a name.

## GET /api/stubs/:id

Responses:
- 200: `{ success: true, stub: { id, name, isRegionEntryStub, targetRegionId, targetRegionName, controllingFactionId, isVehicle, vehicleInfo, npcs } }`
- 400/404/500: `{ success: false, error }`

## PUT /api/stubs/:id

Request:
- Body:
  - `name` (required)
  - `description` (required)
  - `relativeLevel?` (number)
  - `controllingFactionId?` (string or null)
  - `isVehicle?` (boolean)
  - `vehicleInfo?` (object or null)

Responses:
- 200: `{ success: true, stub: { id, name, description, relativeLevel, isRegionEntryStub, targetRegionId, targetRegionName, controllingFactionId, isVehicle, vehicleInfo } }`
- 400/404/500: `{ success: false, error }`

Notes:
- `controllingFactionId` must reference an existing faction id or be `null` to clear.
- Vehicle edits follow the same `isVehicle` + `vehicleInfo` validation semantics as location/region updates.
- For region-entry stubs, successful vehicle edits are mirrored into pending-region stub records so expansion uses the updated vehicle metadata.

## DELETE /api/stubs/:id

Responses:
- 200: `{ success: true, stubId, targetRegionId, removedExitIds, deletedNpcIds, npcSummaries }`
- 400/404/500: `{ success: false, error }`
