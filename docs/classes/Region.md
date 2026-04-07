# Region

## Purpose
Represents a region containing multiple locations, with metadata like average level, random events, and status effects. Maintains static indexes for lookup by id and name.

## Key State
- `#id`, `#name`, `#description`, `#shortDescription`.
- `#locationBlueprints`: blueprint definitions for generated locations (now include per-location `shortDescription` plus exit `travelTimeMinutes`).
- `#locationIds`: ids for instantiated locations in the region.
- `#entranceLocationId`, `#parentRegionId`, `#controllingFactionId`.
- `#vehicleInfo` (`VehicleInfo` or `null`) for mobile/vehicle regions.
- `#statusEffects`, `#randomEvents`, `#averageLevel`, `#relativeLevel`.
- `#numImportantNPCs`, `#characterConcepts`, `#enemyConcepts`, `#secrets`.
- `#weather`, `#weatherState` for region-level dynamic weather definitions/state (minute duration fields).
- `#lastVisitedTime` (minutes).

## Construction
- `new Region({...})` validates name/description and normalizes blueprints, events, levels, and status effects. Adds to static indexes.

## Static API
- `get(id)` / `getByName(name)` / `getAll()`.
- `get indexById()` / `get indexByName()` / `getIndexById()` / `getIndexByName()`.
- `removeFromIndex(regionOrId)` to drop stale rolled-back regions from the static indexes.
- `clear()`.
- `fromJSON(data)` / `fromXMLSnippet(xmlSnippet)`.
- `parseWeatherDefinitionFromXmlSnippet(xmlSnippet)` to parse `<weather>` blocks without instantiating a region.
- `get stubRegionCount()`: count of regions without location ids.

## Accessors
- `name`, `description`, `shortDescription` (get/set).
- `locationBlueprints`, `locationIds` (get/set).
- `entranceLocationId`, `parentRegionId` (get/set).
- `controllingFactionId` (get/set).
- `isVehicle` (derived get), `vehicleInfo` (get/set; serialized object or `null`).
- `weather` (get/set), `weatherState` (get/set), `resolveCurrentWeather({ seasonName, totalMinutes })` (`totalHours` is still accepted as a compatibility fallback).
- `randomEvents` (get/set), `addRandomEvent`, `removeRandomEvent`.
- `numImportantNPCs` (get/set).
- `relativeLevel` (get/set), `averageLevel` (get) with `setAverageLevel(level)`.
- `characterConcepts`, `enemyConcepts`, `secrets` (get/set).
- `lastVisitedTime` (get/set, minutes), `hoursSinceLastVisit(currentTime)` (legacy name; returns elapsed minutes).
- Relationship helpers: `childRegions`, `siblingRegions`, `parentRegion`, `parentHierarchy`.

## Instance API
- `toJSON()`: serializes region state.
- Status effects: `getStatusEffects()`, `setStatusEffects(effects)`, `addStatusEffect(effect, defaultDuration)`, `removeStatusEffect(description)`, `tickStatusEffects(elapsedMinutes)`, `clearExpiredStatusEffects()`.
- NPC discovery: `getNPCs()`, `getNPCIds()`, `get locations()`.
- Location tracking: `addLocationId(id)` / `addLocation(id)`.

## Private Helpers
- `#generateId()`.
- `#normalizeBlueprint(blueprint)`.
- `#normalizeImportantNpcCount(value)`.
- `#normalizeStatusEffects(effects)`.
- weather normalization helpers for booleans, duration ranges, weather definitions/state.
- `#normalizeVehicleInfo(vehicleInfo)`.

## Notes
- Region stub expansion expects a `<shortDescription>` in the stub response and persists it on the generated `Region`.
- Region entry stubs with an assigned controlling faction pass that faction into stub-generation prompts as authoritative context; the region-level `<controllingFaction>` field is omitted from stub-mode output expectations so expansion preserves the stub faction.
- `fromXMLSnippet` accepts both `<region>` and mixed tag variants (name/description/shortDescription).
- `fromXMLSnippet` now reads location blueprints only from direct `<locations><location>` children, so nested vehicle-destination tags like `<destination><location>...` do not get misparsed as region locations.
- Region XML location exits now use `<exit><destination>...</destination><travelTime>...</travelTime></exit>` and normalize to blueprint entries shaped like `{ target, travelTimeMinutes }`.
- Explicit prompt-generated `0`-minute exit travel times are normalized up to `1` minute during region and region-stub parsing so persisted `0` can continue to mean “not populated yet”.
- Region stub-location parsing in `server.js` uses the same exit shape and preserves the first parsed travel time for both directions when reverse exits are synthesized.
- `parentHierarchy` throws on circular references to surface data errors early.
- Location blueprints now include both a two-paragraph `<description>` and one-sentence `<shortDescription>`; these are carried into stub metadata as `stubDescription`/`stubShortDescription`, including region stub expansions.
- Region XML weather definitions (`<weather>`, `<seasonWeather>`, `<weatherType>`) are persisted and can drive dynamic per-season weather selection over elapsed world time.
- Weather duration data is minute-canonical (`minMinutes`/`maxMinutes`, `durationMinutes`, `nextChangeMinutes`) with legacy hour fields accepted during load normalization.
- If a weather type has an invalid duration string, Region logs a warning, skips that weather-type entry, and continues parsing remaining entries.
- Regions can now be flagged as vehicles by storing `vehicleInfo`; `isVehicle` is derived from `vehicleInfo !== null`, and `toJSON()` includes both fields for persistence/API responses.
