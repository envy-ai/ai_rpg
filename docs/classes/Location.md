# Location

## Purpose
Represents a game location, including description, exits, NPCs, items/scenery, and status effects. Supports stub locations that can be promoted to fully generated locations.

## Key State
- Core fields: `#id`, `#name`, `#description`, `#shortDescription`, `#baseLevel`, `#imageId`.
- Region linkage: `#regionId`, `#controllingFactionId`.
- Exits: `#exits` (Map of direction -> LocationExit).
- NPC/Thing references: `#npcIds`, `#thingIds`.
- Status effects: `#statusEffects`.
- Stub support: `#isStub`, `#stubMetadata`, `#hasGeneratedStubs`, `#generationHints`.
- Random events: `#randomEvents`.
- Visit tracking: `#visited`, `#lastVisitedTime`.
- Concept tags: `#characterConcepts`, `#enemyConcepts`.
- Static indexes: `#indexById`, `#indexByName`.

## Construction
- `new Location({...})` validates required fields, links to a `Region`, initializes indexes, and normalizes status effects and hints.
- `static fromXMLSnippet(xmlSnippet, options)` parses XML and constructs a Location with normalized hints and events.

## Static API
- `get(id)` / `getById(id)` / `getByName(name)` / `findByName(name)`.
- `getAll()`.
- `get indexById()` / `get indexByName()`.
- `removeFromIndex(locationOrId)` to prevent stale lookups.

## Accessors
- `regionId` (get/set) and `region` (get).
- `controllingFactionId` (get/set).
- Basic fields: `id`, `name`, `description`, `shortDescription`, `baseLevel`, `imageId`, `createdAt`, `lastUpdated`.
- Visit tracking: `visited` (get/set), `lastVisitedTime` (get/set), `hoursSinceLastVisit()`.
- Stub metadata: `isStub`, `stubMetadata` (get/set), `hasGeneratedStubs` (get/set).
- `generationHints` (get/set).
- Random events: `randomEvents` (get/set).
- Entities: `npcIds`, `npcs`, `thingIds`, `things`, `items`, `scenery`.
- Concepts: `characterConcepts` (get/set), `enemyConcepts` (get/set).

## Instance API
- Stub lifecycle: `promoteFromStub(...)`, `markStubsGenerated()`, `resetStubGeneration()`.
- Exit management: `addExit(direction, exit)`, `removeExit(direction)`, `getExit(direction)`, `getAvailableDirections()`, `hasExit(direction)`, `clearExits()`.
- Summaries: `getSummary()`, `getDetails()`, `toJSON()`.
- Random events: `addRandomEvent(event)`, `removeRandomEvent(event)`.
- NPC helpers: `getNPCIds()`, `getNPCs()`, `getNPCNames()`, `addNpcId(id)`, `removeNpcId(id)`, `setNpcIds(ids)`, `clearNpcIds()`.
- Thing helpers: `addThingId(id)`, `removeThingId(id)`, `setThingIds(ids)`, `clearThingIds()`.
- Status effects: `getStatusEffects()`, `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`, `tickStatusEffects(elapsedMinutes)`, `clearExpiredStatusEffects()`.
- `toString()`.

## Private/Static Helpers
- `#generateId()`.
- `#normalizeStatusEffects(effects)`.
- `#normalizeRandomEvents(events)`.
- `#normalizeGenerationHints(hints)`.

## Notes
- Stub locations now carry both a long `stubDescription` and a one-sentence `stubShortDescription` in `stubMetadata`; those are treated as authoritative during stub expansion and reused without regeneration. Stub short descriptions are also copied into `location.shortDescription` on creation/load so stubs render properly in base-context world outlines.
- Legacy stubs without `stubDescription` continue to expand, but only their long description is fixed; the LLM still generates a short description.
- Adding/removing thing ids updates Thing metadata (location ownership) and removes from other locations via `Thing.removeFromWorldById`.
- Status effects are stored as `StatusEffect` instances; getters return JSON snapshots.
- Stub expansion prompts include authoritative stub fields (description/shortDescription, relative/base level, controlling faction, numNpcs/numHostiles). When present, these fields are omitted from the LLM output and filled from the stub during parsing; if the LLM provides a different value, the server warns and overrides with the stub values. For description/shortDescription, if the LLM output starts with the stub text (after whitespace normalization), the expanded text is accepted instead of being overridden.
- `generationHints` now optionally carries `hasWeather` (boolean/null) so outdoor/indoor weather applicability can persist through stub promotion and save/load.
