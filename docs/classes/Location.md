# Location

## Purpose
Represents a game location, including description, exits, NPCs, items/scenery, and status effects. Supports stub locations that can be promoted to fully generated locations.

## Key State
- Core fields: `#id`, `#name`, `#description`, `#shortDescription`, `#baseLevel`, `#imageId`, `#imageVariants`.
- Region linkage: `#regionId`, `#controllingFactionId`.
- Vehicle state: `#vehicleInfo` (`VehicleInfo` or `null`).
- Exits: `#exits` (Map of direction -> LocationExit).
- NPC/Thing references: `#npcIds`, `#thingIds`.
- Status effects: `#statusEffects`.
- Stub support: `#isStub`, `#stubMetadata`, `#hasGeneratedStubs`, `#generationHints`.
- Random events: `#randomEvents`.
- Visit tracking: `#visited`, `#lastVisitedTime` (minute timestamp).
- Concept tags: `#characterConcepts`, `#enemyConcepts`.
- Static indexes: `#indexById`, `#indexByName`.

## Construction
- `new Location({...})` validates required fields, links to a `Region`, initializes indexes, and normalizes status effects and hints. `visited` defaults to `false` unless explicitly provided.
- `static fromXMLSnippet(xmlSnippet, options)` parses XML and constructs a Location with normalized hints and events.

## Static API
- `get(id)` / `getById(id)` / `getByName(name)` / `findByName(name)`.
- `getAll()`.
- `findShortestTravelTimeMinutes(startLocationOrId, endLocationOrId)`: runs Dijkstra over the directed location-exit graph and returns the minimum summed `travelTimeMinutes`, `0` for the same location, or `null` when no route exists.
- `findShortestTravelTimeMinutesByRegionAndLocationNames(startRegionName, startLocationName, endRegionName, endLocationName)`: resolves each endpoint by exact region-scoped location name, then runs the same Dijkstra route search and returns the minimum summed `travelTimeMinutes`, `0` for the same location, or `null` when no route exists.
- `get indexById()` / `get indexByName()`.
- `removeFromIndex(locationOrId)` to prevent stale lookups.

## Accessors
- `regionId` (get/set) and `region` (get). Reassigning `regionId` now keeps region membership indexes in sync by removing the location from the old region, adding it to the new region, and repairing the old region's `entranceLocationId` if it pointed at the moved location. If the previous `regionId` is already stale/missing, reassignment logs a warning and still repairs the location into the new live region instead of failing.
- `controllingFactionId` (get/set).
- Basic fields: `id`, `name`, `description`, `shortDescription`, `baseLevel`, `imageId`, `imageVariants`, `createdAt`, `lastUpdated`.
- Visit tracking: `visited` (get/set), `lastVisitedTime` (get/set, minutes), `hoursSinceLastVisit()` (legacy name; returns elapsed minutes).
- Stub metadata: `isStub`, `stubMetadata` (get/set), `hasGeneratedStubs` (get/set).
- Vehicle metadata: `isVehicle` (derived get), `vehicleInfo` (get/set; serialized object or `null`).
- `generationHints` (get/set).
- Random events: `randomEvents` (get/set).
- Entities: `npcIds`, `npcs`, `thingIds`, `things`, `items`, `scenery`.
- Concepts: `characterConcepts` (get/set), `enemyConcepts` (get/set).

## Instance API
- Stub lifecycle: `promoteFromStub(...)`, `markStubsGenerated()`, `resetStubGeneration()`.
- Visit tracking: `markVisited(visitedAt?)` marks the location visited and, when a minute timestamp is available, updates `lastVisitedTime`.
- Image variants: `getImageVariant(variantKey)`, `setImageVariant(variantKey, entry)`, `removeImageVariant(variantKey)`, and `clearImageVariants({ sourceImageId? })` manage persisted display-only image variants such as weather/lighting renders.
- Exit management: `addExit(direction, exit)`, `removeExit(direction)`, `getExit(direction)`, `getAvailableDirections()`, `hasExit(direction)`, `clearExits()`.
- Summaries: `getSummary()`, `getDetails()`, `toJSON()` now include `visited`, `lastVisitedTime`, serialized `imageVariants`, and `generationHints`.
- Random events: `addRandomEvent(event)`, `removeRandomEvent(event)`.
- NPC helpers: `getNPCIds()`, `getNPCs()`, `getNPCNames()`, `addNpcId(id)`, `removeNpcId(id)`, `setNpcIds(ids)`, `clearNpcIds()`.
- Thing helpers: `addThingId(id)`, `removeThingId(id)`, `setThingIds(ids)`, `clearThingIds()`.
- Status effects: `getStatusEffects()`, `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`, `tickStatusEffects(elapsedMinutes)`, `clearExpiredStatusEffects()`.
- `toString()`.

## Private/Static Helpers
- `#generateId()`.
- `#normalizeStatusEffects(effects)`.
- `#normalizeImageVariantEntry(entry, fallbackKey)` / `#normalizeImageVariants(imageVariants)` / `#serializeImageVariants(variants)`.
- `#normalizeRandomEvents(events)`.
- `#normalizeGenerationHints(hints)`.
- `#normalizeVehicleInfo(vehicleInfo)`.

## Notes
- Stub locations now carry both a long `stubDescription` and a one-sentence `stubShortDescription` in `stubMetadata`; those are treated as authoritative during stub expansion and reused without regeneration. Stub short descriptions are also copied into `location.shortDescription` on creation/load so stubs render properly in base-context world outlines. Event-created location stubs are the exception: they intentionally leave short-description fields blank so the short-description hydrator still treats them as missing and generates a real one later.
- Event/travel-created stubs also persist `stubMetadata.createOriginExit`; when that flag is `false`, later stub expansion skips creating the generic origin/reverse links so vehicle-specific exit wiring can remain authoritative. Travel-driven unstub/expansion can also stamp that flag onto already-existing stubs before expansion, which prevents older saves from recreating the plain link.
- Legacy stubs without `stubDescription` continue to expand, but only their long description is fixed; the LLM still generates a short description.
- Player-driven `Player.setLocation(...)` calls mark the destination as visited and stamp `lastVisitedTime` from `Globals.elapsedTime`; NPC and vehicle-only movement do not.
- Legacy saves that predate persisted `visited` flags now load non-stub locations as visited and stub locations as unvisited by default.
- `findShortestTravelTimeMinutes(...)` treats exits as directed weighted edges and throws on malformed graph data such as dangling destinations or invalid travel-time values, instead of silently skipping them.
- `findShortestTravelTimeMinutesByRegionAndLocationNames(...)` fails loudly when a named region is missing, a location name does not exist within the named region, or the same location name appears more than once inside that region.
- Adding/removing thing ids updates Thing metadata (location ownership) and removes from other locations via `Thing.removeFromWorldById`.
- Status effects are stored as `StatusEffect` instances; getters return JSON snapshots.
- Movement/integrity repair paths can safely reapply the same `regionId` to restore missing region membership, and can also recover a location from a stale missing previous region during explicit reconciliation.
- Stub expansion prompts include authoritative stub fields (description/shortDescription, relative/base level, controlling faction, numNpcs/numHostiles). When present, these fields are omitted from the LLM output and filled from the stub during parsing; if the LLM provides a different value, the server warns and overrides with the stub values. For description/shortDescription, if the LLM output starts with the stub text (after whitespace normalization), the expanded text is accepted instead of being overridden.
- `generationHints` now optionally carries `hasWeather` as `yes`, `no`, `outside`, or `null` so outdoor/indoor weather applicability can persist through stub promotion, API responses, and save/load. Stub metadata fields `hasWeather` and `locationHasWeather` use the same normalization, so legacy saved stub booleans load as `yes`/`no`. Legacy boolean values are accepted on hydration/prompt parsing and normalized to `yes`/`no`. `outside` means the location is sheltered but exterior weather remains visible, such as through windows or an open view. The main location edit modal can set this hint to exposed, outside-visible, sheltered, or automatic.
- Locations can now act as vehicles by setting `vehicleInfo`; `isVehicle` is derived from `vehicleInfo !== null`. `getSummary()`/`getDetails()`/`toJSON()` include both `isVehicle` and serialized `vehicleInfo`.
- `imageVariants` stores cached presentation-layer image ids keyed by source base image plus normalized lighting/weather. These variants never replace `imageId`; callers clear them when a visual location edit or base image regeneration changes the authoritative location image.
