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
- Status effects: `getStatusEffects()`, `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`, `tickStatusEffects()`, `clearExpiredStatusEffects()`.
- `toString()`.

## Private/Static Helpers
- `#generateId()`.
- `#normalizeStatusEffects(effects)`.
- `#normalizeRandomEvents(events)`.
- `#normalizeGenerationHints(hints)`.

## Notes
- Stub locations seed `shortDescription` from stub metadata at creation, and that value persists through promotion unless overwritten by generated output.
- Adding/removing thing ids updates Thing metadata (location ownership) and removes from other locations via `Thing.removeFromWorldById`.
- Status effects are stored as `StatusEffect` instances; getters return JSON snapshots.
