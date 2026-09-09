# Location

## Purpose
Represents a game location, including descriptive text, exits, NPCs, items/scenery, status effects, visit/favorite state, weather/image hints, and optional vehicle metadata. Supports stub locations that can be promoted into generated locations.

## Key State
- Core fields: `#id`, `#name`, `#description`, `#shortDescription`, `#baseLevel`, `#imageId`, `#imagePrompt`, `#imageVariants`. `imagePrompt` defaults to blank and is not generated during location construction or stub expansion.
- Region linkage: `#regionId`, `#controllingFactionId`.
- Vehicle state: `#vehicleInfo` (`VehicleInfo` or `null`).
- Exits: `#exits` (Map of direction -> LocationExit).
- NPC/Thing references: `#npcIds`, `#thingIds`.
- Status effects: `#statusEffects`.
- Stub support: `#isStub`, `#stubMetadata`, `#hasGeneratedStubs`.
- Generation hints: `#generationHints` (`numItems`, `numScenery`, `numNpcs`, `numHostiles`, `hasWeather`).
- Random events: `#randomEvents`.
- Visit tracking: `#visited`, `#lastVisitedTime` (minute timestamp).
- UI markers: `#favorite`.
- Concept tags: `#characterConcepts`, `#enemyConcepts`.
- Static indexes: `#indexById`, `#indexByName`.

## Construction
- `new Location({...})` validates required fields, assigns a compact `loc_n` id when missing, initializes static indexes, and links the location into its `Region` when `checkRegionId` is true. Non-stub locations require a string `description`, positive numeric `baseLevel`, and a live `regionId`; stubs can carry incomplete text/level data but still require a region id string. Callers use `checkRegionId: false` for pending-region ids.
- Construction normalizes stub metadata, status effects, image variants, generation hints, random events, vehicle info, NPC ids, Thing ids, concept lists, `visited`, `favorite`, and finite numeric `lastVisitedTime` values.
- `static fromXMLSnippet(xmlSnippet, options)` parses `<location>` XML, normalizes generation hints/random events, computes `baseLevel` from absolute or relative level data, and can promote or update an existing stub while enforcing authoritative stub fields. Missing optional generated metadata blocks such as `randomStoryEvents`, `characterConcepts`, and `enemyConcepts` are accepted and normalize to empty arrays/preserved defaults rather than aborting parsing.

## Static API
- `get(id)` / `getById(id)` / `getByName(name)` / `findByName(name)`. Name lookup is case-insensitive through the static name index.
- `getAll()`.
- `clear()`: clears both static location indexes. New-game reset and save hydration use this before rebuilding the live world.
- `findShortestTravelTimeMinutes(startLocationOrId, endLocationOrId)`: runs Dijkstra over the directed location-exit graph and returns the minimum summed `travelTimeMinutes`, `0` for the same location, or `null` when no route exists.
- `findShortestTravelTimeMinutesByRegionAndLocationNames(startRegionName, startLocationName, endRegionName, endLocationName)`: resolves each endpoint by exact region-scoped location name, then runs the same Dijkstra route search and returns the minimum summed `travelTimeMinutes`, `0` for the same location, or `null` when no route exists.
- `findShortestTravelRoute(startLocationOrId, endLocationOrId)`: runs the same Dijkstra search and returns `{ origin, destination, travelTimeMinutes, steps }`, with each step including source/destination location+region names, direction, and `travelTimeMinutes`; returns `null` when no route exists.
- `findShortestTravelRouteByRegionAndLocationNames(startRegionName, startLocationName, endRegionName, endLocationName)`: exact-name variant of `findShortestTravelRoute(...)`.
- `get indexById()` / `get indexByName()`.
- `removeFromIndex(locationOrId)` removes the id index entry and removes the name index entry when given a Location object with a name.

## Accessors
- `regionId` (get/set) and `region` (get). Reassigning `regionId` requires a live target region, removes the location from the previous live region when present, adds it to the target region, updates `stubMetadata.regionId`, and lets `Region.removeLocationId(...)` repair the previous region's `entranceLocationId`. If the previous region id is stale/missing, reassignment logs a warning and links the location into the target live region.
- `controllingFactionId` (get/set).
- Basic fields: `id`, `name`, `description`, `shortDescription`, `baseLevel`, `imageId`, `imagePrompt`, `imageVariants`, `createdAt`, `lastUpdated`.
- Visit tracking: `visited` (get/set), `lastVisitedTime` (get/set, minutes), `minutesSinceLastVisit(currentTime?)`. Setting `lastVisitedTime` also stamps the owning live region's `lastVisitedTime`.
- Favorite marker: `favorite` (get/set) and `isFavorite` (read alias).
- Stub metadata: `isStub`, `stubMetadata` (get/set), `hasGeneratedStubs` (get/set).
- Vehicle metadata: `isVehicle` (derived get), `vehicleInfo` (get/set; serialized object or `null`).
- `generationHints` (get/set; count hints are integers from `0` to `20` or `null`, and `hasWeather` is `yes`, `no`, `sheltered`, or `null`).
- Random events: `randomEvents` (get/set).
- Entities: `npcIds`, `npcs`, `thingIds`, `things`, `items`, `scenery`.
- Concepts: `characterConcepts` (get/set), `enemyConcepts` (get/set).

## Instance API
- Stub lifecycle: `promoteFromStub(...)`, `markStubsGenerated()`, `resetStubGeneration()`.
- `setStubRegionId(regionId, { requireLiveRegion = false })`: reassigns a stub location's internal `regionId` and `stubMetadata.regionId`. When the target is a live region it also adds the stub to that region's membership; callers that allow pending-region ids must maintain `pendingRegionStubs.locationIds` separately.
- Visit tracking: `markVisited(visitedAt?)` marks the location visited and, when a minute timestamp is available, updates `lastVisitedTime`. With no argument it uses `Globals.elapsedTime`; with `null` it marks `visited` without a timestamp.
- Image variants: `getImageVariant(variantKey)`, `setImageVariant(variantKey, entry)`, `removeImageVariant(variantKey)`, and `clearImageVariants({ sourceImageId? })` manage persisted display-only image variants such as weather/lighting renders.
- Exit management: `addExit(direction, exit)`, `removeExit(direction)`, `getExit(direction)`, `getAvailableDirections()`, `hasExit(direction)`, `clearExits()`. Directions are lower-cased and trimmed.
- Summaries: `getSummary()` returns a lightweight snapshot with counts/directions. `getDetails()` and `toJSON()` return the save/API location payload, including `imagePrompt`, visit/favorite fields, image variants, vehicle info, generation hints, exits, NPC/Thing ids, status effects, random events, and concept tags.
- Random events: `addRandomEvent(event)`, `removeRandomEvent(event)`.
- NPC helpers: `getNPCIds()`, `getNPCs()`, `getNPCNames()`, `addNpcId(id)`, `removeNpcId(id)`, `setNpcIds(ids)`, `clearNpcIds()`.
- Thing helpers: `addThingId(id, { mergeStacks = true } = {})`, `removeThingId(id)`, `setThingIds(ids)`, `clearThingIds()`.
- `addThingId(...)` removes the incoming Thing from other world locations, updates its metadata for location ownership, and merges incoming non-container, unequipped item stacks into existing loose same-name/same-checksum stacks in the location unless called with `mergeStacks: false`.
- Status effects: `getStatusEffects()`, `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`, `tickStatusEffects(elapsedMinutes)`, `clearExpiredStatusEffects()`.
- `toString()`.

## Private/Static Helpers
- `#generateId()`.
- `#normalizeWeatherExposure(value, fieldName)`.
- `#normalizeStubMetadata(metadata)`.
- `#normalizeStatusEffects(effects)`.
- `#normalizeImageVariantEntry(entry, fallbackKey)` / `#normalizeImageVariants(imageVariants)` / `#serializeImageVariants(variants)`.
- `#normalizeRandomEvents(events)`.
- `#normalizeGenerationHints(hints)`.
- `#normalizeVehicleInfo(vehicleInfo)`.

## Notes
- Stub locations can carry a long `stubDescription` and a one-sentence `stubShortDescription` in `stubMetadata`. Stub expansion treats those fields as authoritative when present. Stub short descriptions are copied into `location.shortDescription` during construction/hydration so stubs render in world outlines. Manual stub edits load and persist the long and short fields independently, accept empty values for either, and synchronize the corresponding presentation fields in `stubMetadata`. Description-only legacy callers continue mirroring their description into the stub short description. Event-created location stubs intentionally omit short-description fields so the short-description hydrator can generate them later.
- Stub expansion prompts include authoritative stub fields such as description/shortDescription, relative/base level, controlling faction, and NPC/hostile counts. `Location.fromXMLSnippet(...)` enforces authoritative description/shortDescription, relative/base level, and NPC/hostile counts. The generation caller resolves and applies the controlling faction. Expanded description/shortDescription text is accepted when it starts with the authoritative stub text after whitespace normalization.
- Event-created location stubs can target a pending region-entry stub by `targetRegionId`. These stubs are recorded on `pendingRegionStubs.locationIds`, matched by normalized name/alias during region expansion, and preserved even when the generated region blueprint omits them.
- Event/travel-created stubs persist `stubMetadata.createOriginExit`; when the flag is `false`, stub expansion skips generic origin/reverse link creation so vehicle-specific exit wiring remains authoritative. Travel-driven expansion stores the flag on a matching existing stub before expansion.
- Stubs without `stubDescription` can expand; their long description falls back through `blueprintDescription`, `shortDescription`, existing `description`, or existing `shortDescription`, while the LLM supplies the missing short description.
- Every ordinary location unstubbing path asks the same location-generation LLM call whether any additional directly reachable exits make sense, including player, NPC, vehicle, teleport, manual, fetched, event-created, and starting-location expansions. The prompt includes the implied return route and every already-wired outgoing destination, gives stronger consideration to dead-end locations, and explicitly permits zero new exits with no target or maximum count.
- The generated `<newExits>` block is parsed strictly before the response is accepted. Each entry must identify a `location` or `region` destination, route description, and travel duration; malformed entries trigger the bounded parser-guided regeneration policy. Duplicate names and destinations already represented by known locations, live regions, or pending region stubs are ignored after validation. Accepted unknown entries become ordinary location stubs in the current region or pending region-entry stubs.
- Even an empty or fully filtered decision calls `markStubsGenerated()`, so the persisted `hasGeneratedStubs` flag prevents repeat decisions. Suggested children are created without immediate expansion, preventing recursive unstubbing loops; each child makes its own bounded decision only when it is later unstubbed.
- Player-driven `Player.setLocation(...)` calls mark the destination as visited and stamp `lastVisitedTime` from `Globals.elapsedTime`; NPC movement and vehicle-only movement do not mark visit state. `Globals.recordPlayerArrivalVisitState(...)` snapshots the destination's previous visit state before player moves for arrival/chat payloads.
- TinyBrain-resolved player movement can name accompanying living characters by exact canonical name or alias. Selected non-party NPCs are removed from every prior location list, assigned the player's destination, and added to that destination's `npcIds`; selected party members remain represented off-location and do not enter the destination list.
- Save hydration: when saved `visited` is absent, hydrated non-stub locations default to visited and hydrated stubs default to unvisited. When saved `favorite` is absent, hydrated locations default to not favorite. Missing saved exit `travelTimeMinutes` values hydrate as `0`. Favorites are stored on the `Location` record, persist with the world save, and the Favorites subtab lists only visited, non-stub favorites.
- `findShortestTravelTimeMinutes(...)` and `findShortestTravelRoute(...)` treat exits as directed weighted edges and throw on malformed graph data such as dangling destinations or invalid `travelTimeMinutes` values. The exact-name shortest-travel helpers throw when a named region is missing, a location name does not exist within the named region, or the same location name appears more than once inside that region.
- `addThingId(...)` and `removeThingId(...)` maintain Thing metadata for direct location ownership. `setThingIds(...)` and `clearThingIds()` replace the id list without doing per-Thing metadata repair.
- Status effects are stored as `StatusEffect` instances; getters return JSON snapshots. Timed status effects tick by positive elapsed minute amounts and `clearExpiredStatusEffects()` removes effects whose finite duration is `0`.
- Movement/integrity repair paths can reapply the same `regionId` to restore missing region membership, and explicit reassignment can recover from a stale previous region id while requiring the target region to be live.
- If a non-stub location is listed in multiple live `Region.locationIds` arrays, movement preflight reports a `location_region_membership_conflict` payload instead of continuing into the integrity error. The client fixer modal displays the affected location and listed regions as `name (id)`, keeps the selected region, removes the rest, then retries the move.
- `generationHints.hasWeather`, `stubMetadata.hasWeather`, and `stubMetadata.locationHasWeather` use `yes`, `no`, `sheltered`, or `null`. `yes` means weather-exposed, `sheltered` means outdoor weather remains visible from an indoor or covered location, and `no` means no outdoor weather is visible locally. Boolean and boolean-like inputs normalize to `yes`/`no`. The legacy persisted/API/prompt value `outside` normalizes to canonical `sheltered`. Explicit hints win; when a legacy location has no hint, an `Exterior` location name resolves effectively to `yes`, and an `Interior` location or containing-region name resolves to `no`, with `yes` as the remaining default. Newly generated full, stub-expanded, and region locations are all required to supply an explicit scope. The location edit API and the `updateObjectFields` chat tool's direct `hasWeather` field store the canonical hint and clear cached weather/lighting variants when it changes; the chat tool preserves all other generation hints.
- Locations act as vehicles by setting `vehicleInfo`; `isVehicle` is derived from `vehicleInfo !== null`. API/map payloads enrich vehicle info for display, include vehicle icon/direction metadata on exits, and omit vehicle exits that should be hidden while the vehicle is in transit.
- `Location.toJSON()` returns model state. `buildLocationResponse(...)` and map serializers add API/UI fields such as region names/paths, image URLs, NPC/Thing profiles, destination visit/stub/vehicle metadata, and vehicle-exit filtering.
- `imageVariants` stores cached presentation-layer image ids keyed by source base image plus normalized season, lighting, effective weather scope, and applicable weather. Variants do not replace `imageId`; callers clear them when visual location edits, weather-exposure edits, vehicle edits, base-image regeneration, or active-calendar replacement makes cached variants stale.
