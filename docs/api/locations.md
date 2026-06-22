# Location, Exit, Stub, and Map API

Routes are registered in `api.js`. Shared shapes are documented in `docs/api/common.md`, especially `LocationResponse`, `LocationDetails`, `LocationExit`, `MapLocationSummary`, and `MapRegionSummary`.

`LocationResponse` is based on `Location.toJSON()` and includes response-only enrichment from `buildLocationResponse(...)`: pending base-image job id, region name/path payloads, enriched vehicle display data, exit destination/stub/visited/vehicle metadata, NPC profiles, and thing JSON. Vehicle exits that should be hidden while a vehicle is in transit are omitted from location and map payloads.

## GET /api/exits/options

Returns grouped region/location options for the exit editor.

Request:
- Query: `originLocationId` (optional)

Responses:
- 200: `{ success: true, regions, originRegionId }`
  - `regions`: array of `{ id, name, isStub, locations }`
  - `locations`: array of `{ id, name, isStub, regionId, isRegionEntryStub }`
  - Live regions and pending region stubs are included. Pending region entrance stubs are included in their pending region group when available.
- 500: `{ success: false, error }`

## GET /api/locations

Lists locations or returns the active location.

Request:
- Query: `scope` (optional)
  - `current`: return the active player location as `location: LocationResponse`.
  - `favorites`: return visited, non-stub locations with `favorite=true`.
  - `named` or `names`: return the named-location list shape. This is also the default when `scope` is omitted.

Responses:
- 200 (scope `current`): `{ success: true, location: LocationResponse }`
- 200 (list scopes): `{ success: true, locations }`
  - List entries: `{ id, name, shortDescription, description, regionId, regionName, label, favorite, visited, isStub, imageId, image }`
  - `image`: `{ id, url } | null`
  - Favorite entries also include `computedTravelTimeMinutes`, the shortest directed route from the active player's current location, or `null` when no route is known.
- 404: `{ success: false, error }` when `scope=current` has no current location.
- 500: `{ success: false, error }`

## POST /api/locations/generate

Generates a location from the active setting.

Request:
- Body: `{ clientId?, requestId?, locationStyle? }`

Responses:
- 200: `{ success: true, location, locationId, locationName, gameWorldStats, generationInfo, message, requestId? }`
  - `location` is `LocationDetails` enriched with `pendingImageJobId`, `npcs`, and `things`.
  - `generationInfo`: `{ aiResponse, options, activeSetting, requestedLocationStyle, newStubs }`
- 408: `{ success: false, error, details, requestId? }` for AI timeouts.
- 503: `{ success: false, error, details, requestId? }` for AI connection failures.
- Other AI status codes may be forwarded when the backend returns an error response.
- 500: `{ success: false, error, details, requestId? }`

Notes:
- When `clientId` is provided, realtime `generation_status` and `location_generated` events are emitted.

## GET /api/locations/:id

Fetches a location by id. Stub expansion is enabled by default.

Request:
- Path: `id`
- Query: `expandStubs` or `expandStub` (optional)
  - Omit or pass a truthy value to expand stubs.
  - `0`, `false`, `no`, or `off` disables expansion.

Responses:
- 200: `{ success: true, location: LocationResponse }`
- 404: `{ success: false, error }`
- 500: `{ success: false, error, trace? }`
  - Region-entry stub expansion failures include `trace`.

Notes:
- Fetching the active player location queues image generation for things at that location when possible.
- Ordinary location-stub expansion failures clear their in-flight expansion dedupe entry and propagate to the calling route/chat request as an error response; they should not leave an unhandled rejection that terminates the server process.

## PUT /api/locations/:id

Updates a hydrated or stub location record by id. Stub-specific presentation edits should use `PUT /api/stubs/:id`.

Request:
- Path: `id`
- Body:
  - `description` (required string)
  - `level` (required number; stored as a rounded integer with minimum `1`)
  - `name` (string or null, optional)
  - `shortDescription` (string or null, optional)
  - `controllingFactionId` (string or null, optional)
  - `hasWeather` (`"yes"`, `"no"`, `"outside"`, boolean, or null, optional)
  - `isVehicle` (boolean, optional)
  - `vehicleInfo` (object or null, optional)
  - `statusEffects` (array or null, optional)

Responses:
- 200: `{ success: true, message, location: LocationResponse, imageCleared, worldTime, changes }`
  - `changes`: `{ name, description, shortDescription, level, vehicle, hasWeather }`
  - `worldTime` is populated when the weather-exposure hint is modified; otherwise it is `null`.
- 400: `{ success: false, error }` for validation errors.
- 404: `{ success: false, error }` when the location does not exist.
- 500: `{ success: false, error }`

Notes:
- `controllingFactionId` must reference an existing faction id or be `null` to clear.
- `hasWeather` is stored as `generationHints.hasWeather`. `"yes"` means weather-exposed, `"no"` means sheltered/no local weather, `"outside"` means sheltered with exterior weather visible, and `null` returns to automatic region/weather behavior. Boolean values are accepted and normalized to `yes`/`no` for compatibility.
- Name or description edits clear the base `location.imageId` and pending base-image job tracking. Name, description, short description, vehicle, or weather-exposure edits clear cached weather/lighting image variants.
- Vehicle edits use `isVehicle` and `vehicleInfo` together:
  - `isVehicle=false` requires omitted/null `vehicleInfo` and clears vehicle info.
  - `isVehicle=true` requires valid vehicle data, or existing vehicle data when `vehicleInfo` is omitted.

## PUT /api/locations/:id/favorite

Persists the favorite marker used by the Play tab Favorites subtab.

Request:
- Path: `id`
- Body: `{ favorite: boolean }`

Responses:
- 200: `{ success: true, location: LocationResponse, favorite }`
- 400: `{ success: false, error }` when `favorite` is missing or not boolean.
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- Favorites can be set on any location record, but `GET /api/locations?scope=favorites` only returns visited, non-stub favorites.

## GET /api/location-region-membership-conflicts

Reports non-stub locations that are listed in more than one live region's `locationIds`.

Responses:
- 200: `{ success: true, conflicts, conflict }`
  - `conflicts`: array of `{ code, location, declaredRegionId, regions, message }`
  - `location`: `{ id, name, label }`, with `label` formatted as `name (id)`.
  - `regions`: array of `{ id, name, label, isDeclared }`, with `label` formatted as `name (id)`.
  - `conflict`: first entry in `conflicts`, or `null`.
- 500: `{ success: false, error }`

## POST /api/location-region-membership-conflicts/:locationId/resolve

Repairs one duplicate region-membership conflict by keeping the location in one of the listed regions and removing it from the rest.

Request:
- Path: `locationId`
- Body: `{ regionId }`
  - `regionId` must be one of the regions currently listing the location.

Responses:
- 200: `{ success: true, repaired, message, conflict, location, selectedRegion, removedRegions }`
  - `location`, `selectedRegion`, and `removedRegions` use `name (id)` labels.
  - `repaired=false` means the conflict was already gone.
- 400: `{ success: false, error, code?, conflict? }` for missing ids, stub locations, or selecting a region that is not currently listed.
- 404: `{ success: false, error }`
- 409: `{ success: false, code: "location_region_membership_conflict", error, conflict }` when repair still leaves duplicate membership.
- 500: `{ success: false, error }`

## GET /api/locations/:id/relocation-options

Returns direct exit cleanup candidates for the hydrated-location region selector.

Request:
- Path: `id`

Responses:
- 200: `{ success: true, locationId, currentRegionId, exitOptions }`
  - `exitOptions`: array of `{ exitId, relation, direction, originLocation, originRegion, destinationLocation, destinationRegion, connectedRegionId, description }`
  - `relation` is `inbound` for exits from another location to the target and `outbound` for exits from the target to another destination.
- 400: `{ success: false, error }` when `id` is missing.
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

## POST /api/locations/:id/relocate

Moves a hydrated location to a live target region and optionally removes selected direct exits.

Request:
- Path: `id`
- Body:
  - `targetRegionId` (required live region id)
  - `removeExitIds` (optional array of exit ids; reverse exits are also removed when present)
  - `makeRegionEntrance` (optional truthy boolean/string/number)

Responses:
- 200: `{ success: true, message, location: LocationResponse, previousRegionId, targetRegionId, removedExits, makeRegionEntrance }`
- 400: `{ success: false, error }`
  - Stub locations must be expanded before relocation.
  - Pending-region stubs cannot be relocation targets.
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- The route updates `location.regionId`, repairs source/target `Region.locationIds` membership, removes duplicate membership from any non-target region, and can set the target region's `entranceLocationId`.
- A realtime `location_relocated` event is emitted when the realtime hub is available.

## POST /api/locations/:id/modify

Runs the current-location `Modify Location` crafting flow. The endpoint evaluates optional player-inventory materials/tools plus freeform notes through the location-modification plausibility and success-degree prompts, then applies accepted physical/environmental outcomes through the `alter_location` event path with location level preservation enabled.

Request:
- Path: `id` must be the active player's current location id.
- Body: `{ slots, notes?, noProse?, clientId? }`
  - `slots`: array of `{ thingId, slotIndex? }`; it may be empty.
  - Each selected item must be in the active player's inventory and must not be equipped.
  - `notes` may include an inline `<N>` die-roll override; the token is stripped before prompt rendering.
  - `noProse` accepts booleans, `1`/`0`, and common boolean strings. When true, prose/chat entries are skipped, while mutation, item consumption/grants, time advancement, need/status ticking, vehicle-arrival processing, scheduled-event processing, quest checks, hidden-NPC checks, NPC sightings, and the prompt-excluded check-results path still run.

Responses:
- 200: `{ success: true, location, outcome, resultLevel, plausibility, modification, consumedThingIds, consumedThingNames, receivedThingIds, receivedThingNames, narrative, unmatchedConsumedNames, timeTakenMinutes, timeProgress, locationRefreshRequested, worldTime, imageCleared }`
  - `modification`: `{ locationChanged, alteration, alterationSummary }`
  - `plausibility`: `{ type, reason }`
  - `narrative`: `{ description, otherEffect }`
- 400: `{ success: false, error }`
  - No active player.
  - Target location is not the player's current location.
  - Selected item is missing, not in player inventory, equipped, or an attempted consumed container is not empty.
  - The plausibility prompt resolves to an implausible action.
- 404: `{ success: false, error }`
- 500: `{ success: false, error }` for prompt rendering/parsing failures, unmatched consumed item names, failed `alter_location` mutation, failed received-item generation, or other server errors.

Notes:
- Received items are generated into the active player's inventory and must not exactly match selected input names. Selected tools/materials that survive use should be omitted from `itemsConsumed`.
- Accepted location-modification outcomes create a prompt-excluded `check-results` success-degree entry.
- If `locationChanged=true`, the route clears base-image state and weather/lighting image variants when the applied alteration modifies the location text.
- Failed and critical-failure outcomes may still alter the location when the resolved result describes a real botched, incomplete, damaging, or otherwise visible environmental effect.
- Consumed materials are matched exactly against selected slot item names. Unknown consumed names fail loudly. If no materials/tools were selected, the prompt result must not consume items.

## DELETE /api/locations/:id

Deletes a hydrated non-stub location with cascade cleanup.

Execution order:
1. Delete items/scenery at the location.
2. Delete NPCs at the location.
3. Delete exits from and to the location.
4. Clear pending/base image state and image variants.
5. Remove the location from regions and repair any region entrance pointer.
6. Delete the location record and static indexes.

Request:
- Path: `id`

Responses:
- 200: `{ success: true, locationId, message, deletedThingIds, deletedNpcIds, relocatedPartyNpcIds, removedExitIds }`
- 400: `{ success: false, error }`
  - Missing id.
  - Target is a stub and must use `/api/stubs/:id`.
  - Target is the player's current location.
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- Party NPCs are not deleted; they are moved to the player's current location.

## POST /api/locations/:id/exits

Creates an exit from the origin location to an existing location, a location stub, an existing live/pending region entrance, or a region-entry stub.

Request:
- Path: `id` (origin location id)
- Body:
  - `type` (`location` or `region`; defaults to `location`)
  - `name`, `description`
  - `travelTime` (duration string such as `1m`, `1h10m`, or `2 hours`)
  - `travelTimeMinutes` (non-negative integer minute value or parseable duration string)
  - `regionId` (target live or pending region id)
  - `locationId` (target location id)
  - `parentRegionId` (for region-entry stubs)
  - `vehicleType` (string; marks the exit as a vehicle exit)
  - `relativeLevel` (number; rounded and limited to `-10..10`)
  - `clientId` (for realtime event metadata)
  - `bidirectional` (optional boolean/string/number; affects created location stubs)
  - `imageDataUrl`, `imageDataUrlOriginal` (reference image data URLs for created location/region stubs only; both must be supplied together and the original must be PNG)

Responses:
- 200: `{ success: true, message, location: LocationResponse, created }`
  - Region-entry stub: `{ type: "region", stubId, regionId, name, parentRegionId, isVehicle, vehicleType, exitId? }`
  - Existing live/pending region entrance: `{ type: "region", stubId, regionId, destinationRegionId, name, existing: true, isStub, isVehicle, vehicleType, exitId? }`
  - Existing location: `{ type: "location", destinationId, name, isStub, existing: true, isVehicle, vehicleType, exitId? }`
  - Location stub: `{ type: "location", destinationId, name, isStub, isVehicle, vehicleType, exitId? }`
- 400: `{ success: false, error, code?, nameRejection? }`
  - Created location/region stub names can fail with `code: "invalid_world_entity_name"` when the requested name conflicts with an existing location, live region, pending region stub, banned name fragment, or slop word.
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- When neither `travelTime` nor `travelTimeMinutes` is supplied, the exit defaults to `1` minute.
- `type: "region"` plus an existing `regionId` creates an exit to that live or pending region's entrance location/stub; no location name is required.
- Name validation runs before the world is mutated.
- A realtime `location_exit_created` event is emitted when the realtime hub is available.

## DELETE /api/locations/:id/exits/:exitId

Deletes an exit from a location. Reverse exits are deleted when present.

Request:
- Path: `id`, `exitId`
- Body or query: `clientId`, `requestId` (optional realtime event metadata)

Responses:
- 200: `{ success: true, message, location: LocationResponse, removed, reverseRemoved, deletedStub, preservedStub }`
  - `removed`: `{ exitId, direction }`
  - `reverseRemoved`: `{ exitId, direction } | null`
  - `deletedStub`: stub deletion info when removing the last exit of a stub. Pending-region deletion details can include `regionStubId`, `regionStubName`, `pendingRegionDeleted: true`, and `deletedLocationStubs`.
  - `preservedStub`: stub info when the stub or pending region remains referenced.
- 400: `{ success: false, error }`
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- Pending region-entry stubs are deleted only when no remaining exits target the pending region's entrance stub or tracked pending child-location stubs.
- A realtime `location_exit_deleted` event is emitted when the realtime hub is available.

## POST /api/locations/:id/npcs

Generates one NPC at a location.

Request:
- Path: `id`
- Body supports seed fields:
  - `name`, `description`, `shortDescription`, `role`, `class`, `race`, `currency`, `level`, `isHostile`, `notes`, `aiNotes`
  - `imageDataUrl`, `imageDataUrlOriginal` (portrait reference data URLs; both must be supplied together and the original must be PNG)

Responses:
- 200: `{ success: true, npc: NpcProfile, location: LocationResponse, message }`
- 400: `{ success: false, error }` for invalid request/reference-image data.
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- `level` is treated as an absolute level and converted to a relative seed level from the target location or region level.
- The response is sent after the generated NPC progression pass is applied.
- Generic/scheduled chat prompts can also use the world-mutation `createNpc(...)` chat tool, which delegates to the same single-NPC generation path and supports matching seed fields plus `relativeLevel`, `hiddenFromPlayer`, `aiNotes`, and non-persisted generation `notes`.

## POST /api/locations/:id/things

Generates one item or scenery object at a location.

Request:
- Path: `id`
- Body: `{ seed, level? }`
  - `seed` supports `name`, `description`, `shortDescription`, `type`, `slot`, `rarity`, `itemOrScenery`, `value`, `weight`, `level`, `relativeLevel`, `isVehicle`, `isHarvestable`, `isCraftingStation`, `isProcessingStation`, `isSalvageable`, `isContainer`, `requiresCheckToOpen`, `notes`
  - `payload.notes` is also accepted when `seed.notes` is absent.
  - `itemOrScenery`, when provided, must be `item` or `scenery`.

Responses:
- 200: `{ success: true, thing: ThingJson, location: LocationResponse, message }`
- 400: `{ success: false, error }` for invalid `itemOrScenery`.
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- `seed.name` is optional; when omitted, the generator is expected to produce a name.
- When `seed.itemOrScenery` is omitted, the generated thing prompt receives no forced item/scenery type instead of defaulting to `item`.
- `level` or `seed.level` is treated as an absolute level and converted to `seed.relativeLevel` from the target location/region/player context. `seed.relativeLevel` is used directly when no absolute level is supplied.

## GET /api/stubs/:id

Fetches location-stub editor data.

Request:
- Path: `id`

Responses:
- 200: `{ success: true, stub }`
  - `stub`: `{ id, name, isRegionEntryStub, targetRegionId, targetRegionName, controllingFactionId, isVehicle, vehicleInfo, npcs }`
- 400: `{ success: false, error }`
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

## PUT /api/stubs/:id

Updates stub presentation, ownership, faction, and vehicle metadata.

Request:
- Path: `id`
- Body:
  - `name` (required non-empty string)
  - `description` (required string; may be empty)
  - `relativeLevel` (optional number)
  - `targetRegionId` (live or pending region id; ordinary location stubs only)
  - `controllingFactionId` (string or null)
  - `isVehicle` (boolean)
  - `vehicleInfo` (object or null)

Responses:
- 200: `{ success: true, stub }`
  - `stub`: `{ id, name, description, relativeLevel, isRegionEntryStub, targetRegionId, targetRegionName, controllingFactionId, isVehicle, vehicleInfo }`
- 400: `{ success: false, error }`
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- `controllingFactionId` must reference an existing faction id or be `null` to clear.
- `targetRegionId` moves an ordinary location stub between live or pending regions by updating stub metadata and the relevant live `Region.locationIds` or pending-region `locationIds`.
- Region-entry stubs reject `targetRegionId` because their target region identity is the region they represent.
- Empty `description` values are accepted and clear the stub's presentation description fields.
- Vehicle edits follow the same `isVehicle` and `vehicleInfo` validation semantics as location and region updates.
- Region-entry stub vehicle edits are mirrored into pending-region stub records so expansion uses the edited vehicle metadata.

## POST /api/stubs/:id/expand

Expands a stub without relying on `GET /api/locations/:id` expansion side effects. Region-entry stubs expand their pending target region and return its entrance location; ordinary location stubs expand in place.

Request:
- Path: `id`

Responses:
- 200: `{ success: true, type, stubId, location: LocationResponse, expandedRegion }`
  - `type`: `"region"` for region-entry stubs or `"location"` for ordinary location stubs.
  - `expandedRegion` is a region API payload or `null`.
- 400: `{ success: false, error }`
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- A realtime `location_stub_expanded` event is emitted when the realtime hub is available.

## DELETE /api/stubs/:id

Deletes a stub, its NPCs, its own exits, inbound exits that point to it, and the pending region record when applicable.

Request:
- Path: `id`

Responses:
- 200: `{ success: true, stubId, targetRegionId, removedExitIds, deletedNpcIds, npcSummaries }`
- 400: `{ success: false, error }`
- 404: `{ success: false, error }`
- 500: `{ success: false, error }`

## GET /api/map/region

Returns map data for one region.

Request:
- Query: `regionId` (optional)
  - When omitted, the active player's current region is used.

Responses:
- 200: `{ success: true, region }`
  - `region`: `{ regionId, regionName, currentLocationId, locations }`
  - `locations`: `MapLocationSummary[]`
- 404: `{ success: false, error }`
  - No current player when `regionId` is omitted.
  - Requested region or current-location region cannot be resolved.
- 500: `{ success: false, error }`

Notes:
- Only locations listed in the resolved region's `locationIds` are included.

## GET /api/map/world

Returns world-map data across live regions and mapped locations.

Responses:
- 200: `{ success: true, world }`
  - `world`: `{ currentLocationId, regions, locations }`
  - `regions`: `MapRegionSummary[]`
  - `locations`: `MapLocationSummary[]`
- 404: `{ success: false, error }`
  - No live regions, no locations, or no mapped locations.
- 500: `{ success: false, error }`

Notes:
- Region summaries include parent/child region ids and vehicle icon metadata.
- Location summaries are omitted when no `regionId` can be resolved.
