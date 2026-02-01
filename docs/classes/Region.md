# Region

## Purpose
Represents a region containing multiple locations, with metadata like average level, random events, and status effects. Maintains static indexes for lookup by id and name.

## Key State
- `#id`, `#name`, `#description`, `#shortDescription`.
- `#locationBlueprints`: blueprint definitions for generated locations.
- `#locationIds`: ids for instantiated locations in the region.
- `#entranceLocationId`, `#parentRegionId`.
- `#statusEffects`, `#randomEvents`, `#averageLevel`, `#relativeLevel`.
- `#numImportantNPCs`, `#characterConcepts`, `#enemyConcepts`, `#secrets`.
- `#lastVisitedTime`.

## Construction
- `new Region({...})` validates name/description and normalizes blueprints, events, levels, and status effects. Adds to static indexes.

## Static API
- `get(id)` / `getByName(name)` / `getAll()`.
- `get indexById()` / `get indexByName()` / `getIndexById()` / `getIndexByName()`.
- `clear()`.
- `fromJSON(data)` / `fromXMLSnippet(xmlSnippet)`.
- `get stubRegionCount()`: count of regions without location ids.

## Accessors
- `name`, `description`, `shortDescription` (get/set).
- `locationBlueprints`, `locationIds` (get/set).
- `entranceLocationId`, `parentRegionId` (get/set).
- `randomEvents` (get/set), `addRandomEvent`, `removeRandomEvent`.
- `numImportantNPCs` (get/set).
- `relativeLevel` (get/set), `averageLevel` (get) with `setAverageLevel(level)`.
- `characterConcepts`, `enemyConcepts`, `secrets` (get/set).
- `lastVisitedTime` (get/set), `hoursSinceLastVisit(currentTime)`.
- Relationship helpers: `childRegions`, `siblingRegions`, `parentRegion`, `parentHierarchy`.

## Instance API
- `toJSON()`: serializes region state.
- Status effects: `getStatusEffects()`, `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`, `tickStatusEffects()`, `clearExpiredStatusEffects()`.
- NPC discovery: `getNPCs()`, `getNPCIds()`, `get locations()`.
- Location tracking: `addLocationId(id)` / `addLocation(id)`.

## Private Helpers
- `#generateId()`.
- `#normalizeBlueprint(blueprint)`.
- `#normalizeImportantNpcCount(value)`.
- `#normalizeStatusEffects(effects)`.

## Notes
- `fromXMLSnippet` accepts both `<region>` and mixed tag variants (name/description/shortDescription).
- `parentHierarchy` throws on circular references to surface data errors early.
