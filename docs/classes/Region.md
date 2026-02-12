# Region

## Purpose
Represents a region containing multiple locations, with metadata like average level, random events, and status effects. Maintains static indexes for lookup by id and name.

## Key State
- `#id`, `#name`, `#description`, `#shortDescription`.
- `#locationBlueprints`: blueprint definitions for generated locations (now include per-location `shortDescription`).
- `#locationIds`: ids for instantiated locations in the region.
- `#entranceLocationId`, `#parentRegionId`, `#controllingFactionId`.
- `#statusEffects`, `#randomEvents`, `#averageLevel`, `#relativeLevel`.
- `#numImportantNPCs`, `#characterConcepts`, `#enemyConcepts`, `#secrets`.
- `#weather`, `#weatherState` for region-level dynamic weather definitions/state.
- `#lastVisitedTime`.

## Construction
- `new Region({...})` validates name/description and normalizes blueprints, events, levels, and status effects. Adds to static indexes.

## Static API
- `get(id)` / `getByName(name)` / `getAll()`.
- `get indexById()` / `get indexByName()` / `getIndexById()` / `getIndexByName()`.
- `clear()`.
- `fromJSON(data)` / `fromXMLSnippet(xmlSnippet)`.
- `parseWeatherDefinitionFromXmlSnippet(xmlSnippet)` to parse `<weather>` blocks without instantiating a region.
- `get stubRegionCount()`: count of regions without location ids.

## Accessors
- `name`, `description`, `shortDescription` (get/set).
- `locationBlueprints`, `locationIds` (get/set).
- `entranceLocationId`, `parentRegionId` (get/set).
- `controllingFactionId` (get/set).
- `weather` (get/set), `weatherState` (get/set), `resolveCurrentWeather({ seasonName, totalHours })`.
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
- weather normalization helpers for booleans, duration ranges, weather definitions/state.

## Notes
- Region stub expansion expects a `<shortDescription>` in the stub response and persists it on the generated `Region`.
- Region entry stubs with an assigned controlling faction pass that faction into stub-generation prompts as authoritative context; the region-level `<controllingFaction>` field is omitted from stub-mode output expectations so expansion preserves the stub faction.
- `fromXMLSnippet` accepts both `<region>` and mixed tag variants (name/description/shortDescription).
- `parentHierarchy` throws on circular references to surface data errors early.
- Location blueprints now include both a two-paragraph `<description>` and one-sentence `<shortDescription>`; these are carried into stub metadata as `stubDescription`/`stubShortDescription`, including region stub expansions.
- Region XML weather definitions (`<weather>`, `<seasonWeather>`, `<weatherType>`) are persisted and can drive dynamic per-season weather selection over elapsed world time.
