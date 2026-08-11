# Region

## Purpose
`Region` models a named area that contains multiple `Location` records. Regions provide world structure, hierarchy, location blueprints for generated stubs, average level metadata, controlling faction, secrets, dynamic weather, random events, status effects, and optional vehicle-region state. The class maintains static lookup indexes by id and lowercase name.

## Key State
- Identity and descriptions: `#id`, `#name`, `#description`, `#shortDescription`.
- Location membership: `#locationBlueprints`, `#locationIds`, `#entranceLocationId`.
- Hierarchy and ownership: `#parentRegionId`, `#controllingFactionId`.
- Vehicle data: `#vehicleInfo`, stored as a `VehicleInfo` instance or `null`; `isVehicle` is derived from this field.
- Gameplay metadata: `#averageLevel`, `#relativeLevel`, `#numImportantNPCs`, `#randomEvents`, `#characterConcepts`, `#enemyConcepts`, `#secrets`.
- Status and time: `#statusEffects`, `#lastVisitedTime` in world minutes.
- Weather: `#weather` definitions and `#weatherState` using minute-canonical duration fields.
- Runtime timestamps: `#createdAt`, `#lastUpdated`.

## Construction
- `new Region({...})` requires string `name` and `description`, accepts `shortDescription` as string or `null`, assigns a compact `region_n` id through `IdGenerator` when `id` is omitted, and registers the id with the counter system.
- Constructor input normalizes location blueprints, `locationIds`, entrance/parent/faction ids, status effects, random events, concepts, secrets, important NPC count, `VehicleInfo`, weather definitions, and weather state.
- Constructed instances are registered in the static id/name indexes. Name lookups are case-insensitive.
- `fromJSON(data)` reconstructs a region from saved payload fields and rebuilds indexes through the constructor. Save hydration in `Utils.hydrateGameState()` clears the runtime maps/indexes, calls `Region.fromJSON()` for each saved region, and stores successful regions in the active `regions` map. Pending region-entry stubs are persisted separately from `Region` instances.

## Static API
- `get(id)`, `getByName(name)`, and `getAll()` read from static indexes.
- `indexById`, `indexByName`, `getIndexById()`, and `getIndexByName()` return copied `Map` instances.
- `clear()` empties the static indexes.
- `removeFromIndex(regionOrId)` removes stale id/name entries, primarily for failed generation rollback.
- `fromJSON(data)` hydrates saved region data.
- `fromXMLSnippet(xmlSnippet)` parses a generated `<region>` XML block and returns a registered `Region`.
- `parseWeatherDefinitionFromXmlSnippet(xmlSnippet)` parses only the `<weather>` block from a `<region>` XML snippet.
- `stubRegionCount` returns the number of registered regions whose `locationIds` array is empty.

## Accessors
- `name`, `description`, and `shortDescription` get/set display text. `name` and `description` reject missing/non-string values; `shortDescription` accepts `null`.
- `locationBlueprints` returns cloned blueprint records. `locationIds` returns a cloned id array and can be replaced as an array.
- `entranceLocationId`, `parentRegionId`, and `controllingFactionId` expose linkage fields. `controllingFactionId` rejects non-string values except `null`/empty clear operations.
- `isStub` is true when the region has no `locationIds`.
- `isVehicle` is true when `vehicleInfo` is non-null. `vehicleInfo` returns serialized `VehicleInfo` data or `null`, and the setter accepts a `VehicleInfo`, plain object, or `null`.
- `weather` returns a deep clone of the normalized weather definition. Assigning `weather` normalizes the definition and resets `weatherState`.
- `weatherState` returns a clone of the active weather state or `null`; setting it validates `{ seasonName, name, description, nextChangeMinutes, durationMinutes }`.
- `resolveCurrentWeather({ seasonName, totalMinutes, totalHours, visitedRegionIds })` resolves the active weather for a non-negative time. `totalMinutes` is canonical; `totalHours` is accepted for compatibility and converted to minutes.
- `randomEvents` get/set returns or stores arrays of strings. `addRandomEvent(event)` appends a non-empty string. `removeRandomEvent(eventOrIndex)` removes by exact string or array index.
- `numImportantNPCs`, `relativeLevel`, `averageLevel`, `characterConcepts`, `enemyConcepts`, `secrets`, and `lastVisitedTime` expose gameplay metadata. `setAverageLevel(level)` stores a rounded whole number with a minimum of `1`, or clears to `null`.
- `minutesSinceLastVisit(currentTime?)` uses the supplied minute timestamp or `Globals.elapsedTime`; it throws if the reference time is not finite.
- Relationship helpers: `childRegions`, `siblingRegions`, `parentRegion`, and `parentHierarchy`. `parentHierarchy` throws if a circular parent chain is detected.

## Instance API
- `toJSON()` serializes the current region state, including location blueprints, location ids, entrance, parent, controlling faction, vehicle info, status effects, average level, important NPC count, random events, concepts, secrets, weather, and weather state.
- Status effects:
  - `getStatusEffects()` returns cloned effects.
  - `setStatusEffects(effects)` replaces all effects after normalization.
  - `addStatusEffect(effect, defaultDuration)` adds or replaces by case-insensitive description.
  - `removeStatusEffect(description)` removes by case-insensitive description.
  - `tickStatusEffects(elapsedMinutes)` decrements finite positive durations in minutes.
  - `clearExpiredStatusEffects()` removes effects whose finite duration is `0`.
- Location membership:
  - `addLocationId(id)` / `addLocation(id)` append a string id if absent.
  - `removeLocationId(id)` / `removeLocation(id)` remove an id and reset `entranceLocationId` to the first remaining location or `null` when needed.
  - `locations` resolves member ids through `Location.get()`.
- NPC discovery:
  - `getNPCs()` resolves NPC ids across member locations through `Player.get()`.
  - `getNPCIds()` returns a `Set` of unique NPC ids across member locations.

## Location Blueprints
`locationBlueprints` are generated-region plans that server generation turns into location stubs. Each blueprint normalizes to:

- `name`: required non-empty string.
- `description`: string, defaulting to `''`.
- `shortDescription`: string or `null`.
- `exits`: array of `{ target, travelTimeMinutes }`. Object exits accept `target`, `name`, or `destination`; string exits are accepted with `travelTimeMinutes: 0`. XML exits require `<destination>` and `<travelTime>`, parse duration text, and normalize generated `0`-minute values to `1` minute.
- `aliases`: array of alternate names used during pending-region stub reuse.
- `relativeLevel`, `numNpcs`, `numHostiles`: numeric generation hints.
- `controllingFaction`: faction name from generated XML; server instantiation resolves it to an id.
- `hasWeather`: `yes`, `no`, `sheltered`, or `null`; boolean/boolean-like inputs normalize to `yes`/`no`, while legacy `outside` values normalize to canonical `sheltered` when generated XML or saved blueprints are loaded.

During `server.js` region instantiation, blueprints become `Location` stubs with stub metadata such as `stubDescription`, `stubShortDescription`, suggested exits, level/NPC/hostile hints, controlling faction id, and weather exposure. Pending region-entry expansion strictly parses the complete generated `<region>` document before creating any `Region`, `Location`, or exit records. Malformed XML, a non-`region` root, a missing direct `<locations>` child, or an empty location list triggers a parser-guided retry. Because these documents can be large and the model may copy a retained malformed response verbatim, the correction attempt starts again from the original prompt plus the exact validation error and an explicit fresh-generation instruction; the rejected document is logged but is not placed back in model context. The retry budget is `ai.retryAttempts + 1` total attempts. Pending region-entry expansion can also seed preserved location stubs into a region, match them by normalized name/alias, keep preserved stubs even when a blueprint omits them, and avoid deleting those preserved stubs during later instantiation rollback.

Generated self-referential location exits are skipped with a console warning. Generated connected-region definitions that point to the region being created are skipped the same way.

## XML Parsing
`fromXMLSnippet(xmlSnippet)` expects a `<region>` root or a string containing a `<region>` block. It parses:

- Region identity: `<regionName>` or `<name>`, `<regionDescription>` or `<description>`, and optional `<shortDescription>`.
- `<relativeLevel>` into `averageLevel` using whole-number minimum `1`.
- `<numImportantNPCs>`.
- `<locations><location>` direct children only. Nested `<location>` tags inside other structures, such as vehicle destination tags, are ignored for region-blueprint parsing.
- Location blueprint fields: `<name>`, `<description>`, `<shortDescription>`, `<relativeLevel>`, `<numNpcs>`, `<numHostiles>`, `<hasWeather>`, `<controllingFaction>`, and `<exits><exit>`.
- XML location exits as `<exit><destination>...</destination><travelTime>...</travelTime></exit>`. Missing destination or travel time throws.
- Optional generated metadata: `<randomStoryEvents><event>`, `<characterConcept>`/`<characterConcepts><concept>`, and `<enemyConcept>`/`<enemyConcepts><concept>` are all accepted when present and default to empty arrays when omitted.
- `<secrets><secret>`.
- `<weather>` through `parseWeatherDefinitionFromXmlSnippet()`.

Missing region or location short descriptions log warnings but do not abort parsing. Invalid XML, missing region name, or missing region description throw clear errors.

`server.js` performs additional parsing around the same generated XML for region exits and vehicles. Pending-region expansion parses all of these components, weather, short description, secrets, character concepts, important-NPC count, and faction selection during the validation attempt, before consuming the result. Each completion attempt is logged. `<regionExits><stubRegion>` entries require `<travelTime>`; parsed minutes are applied to created cross-region exits and are not stored on pending-region stub records. Large generated vehicles become location stubs; huge generated vehicles become pending region-entry stubs with vehicle metadata.

## Region-Entry Doorways And Arrival Selection

Exits into a region no longer all funnel to a single entrance:

- **Distinct doorways per origin.** `createRegionStubFromEvent()` in `server.js` gives each distinct origin location its own region-entry stub ("doorway") rather than reusing a shared entrance stub. When a pending region with the same name already exists, the new doorway reuses that pending region's id (so the region still generates once) but keeps its own approach context. The existing per-origin guard still prevents duplicate doorways from the same origin, and the pending record is created only for the first doorway.
- **First traversal defines the entrance.** Whichever doorway is entered first triggers region generation and lands the traveler at the LLM-chosen canonical entrance (`chooseRegionEntrance()`), which sets `entranceLocationId`. Sibling doorways remain region-entry stubs pointing at the now-generated region and resolve independently when later traversed.
- **Contextual arrival for generated regions.** `chooseArrivalLocationForEntryStub({ region, originContext })` picks which existing member location a traveler arrives at based on approach context (origin location/region, direction, route description) via the `region_arrival_selection` prompt. It returns the chosen `Location` or **throws** — it does not silently fall back to the entrance. Regions with a single member location return that location without a prompt; a region with no non-stub members, an empty/unparseable response, or a name that matches no member all raise clear errors. `entranceLocationId` remains the canonical default only for name-based travel and other consumers (while-you-were-away, travel prose, vehicle arrival).
- **Call sites.** The contextual pick is used by `createRegionStubFromEvent()` (new exit to an already-generated region), `expandRegionEntryStub()`'s already-generated branches (sibling doorway traversal), and the `POST /api/locations/:id/exits` existing-region branch (manual exit creation).

## Weather
Region weather definitions normalize to:

```js
{
  hasDynamicWeather: boolean,
  seasonWeather: [
    {
      seasonName: string,
      weatherTypes: [
        {
          name: string,
          description: string,
          relativeFrequency: number,
          durationRange: { minMinutes: number, maxMinutes: number }
        }
      ]
    }
  ]
}
```

Weather state normalizes to:

```js
{
  seasonName: string,
  name: string,
  description: string,
  nextChangeMinutes: number,
  durationMinutes: number
}
```

`resolveCurrentWeather()` chooses a weather type by weighted `relativeFrequency`, stores the state until `nextChangeMinutes`, and returns `{ name, description, seasonName, dynamic }`. Regions without dynamic weather inherit from the nearest parent region with dynamic weather. If no ancestor has dynamic weather, the method returns the sheltered no-active-weather result. Circular parent weather lookups throw.

Duration data is minute-canonical. `minHours`/`maxHours`, `durationHours`, `nextChangeHours`, and `totalHours` are accepted as compatibility inputs and converted to minutes. Invalid duration strings inside weather-type XML log warnings and skip that weather type; a dynamic weather definition with no valid weather types throws during normalization.

## Vehicle Regions
A region represents a vehicle when `vehicleInfo` is present. `vehicleInfo` uses the canonical `VehicleInfo` shape: `terrainTypes`, `icon`, `currentDestination`, `pendingDestination`, `destinations`, `ETA`, `departureTime`, and `vehicleExitId`.

Region vehicles participate in:

- `Player.currentVehicle`, which exposes computed trip state for prompts (`isUnderway`, `hasArrived`, `isArriving`, destination, remaining minutes, and formatted remaining time).
- Travel-prose handling in `api.js`, which resolves named vehicles against both vehicle locations and vehicle regions.
- Region/world map responses, which render vehicle icons and hide vehicle exits while a vehicle is underway or finalizing arrival.
- Save/load through `Region.toJSON()` and `Region.fromJSON()`.

## API, UI, And Prompt Integration
- Persistence: `Utils.serializeGameState()` writes `Region.toJSON()` under `gameWorld.regions`. `Utils.hydrateGameState()` reconstructs regions through `fromJSON()` and persists unresolved region-entry stubs in `pendingRegionStubs.json`.
- Region API: `GET /api/regions/:id` returns a focused edit payload with id, descriptions, parent, average level, controlling faction, vehicle data, secrets, weather, and weather state. `PUT /api/regions/:id` updates those fields, rejects parent cycles, validates faction ids, validates vehicle data through `VehicleInfo`, and resets `weatherState` when weather is assigned. Weather updates include a `worldTime` payload for UI refresh.
- Region generation API: `POST /api/regions/generate` calls `generateRegionFromPrompt()`, parses XML with `Region.fromXMLSnippet()`, instantiates location stubs, chooses an entrance, populates important NPCs, and returns `Region.toJSON()` plus created locations.
- Maps: `/api/map/region` reads `locationIds` to build a regional location graph. `/api/map/world` uses `id`, `name`, `parentRegionId`, `isVehicle`, `vehicleInfo.icon`, `isStub`, `locationIds`, `locationCount`, `averageLevel`, and computed `childRegionIds`.
- Events: `Events.js` resolves live regions and pending region-entry stubs by id/name/original name for move, exit-discovery, NPC-arrival/departure, and thing-arrival/departure flows. Unknown offscreen destination regions may be represented as pending region stubs through server helpers rather than immediate `Region` instances.
- Chat tools: `updateObjectFields({ objectType: "region" })` can update allowlisted scalar/list/object fields such as descriptions, level metadata, concepts, secrets, visit time, parent/entrance/faction ids, weather, weather state, random events, and status effects. Compact `moreInfo` omits bulky region scaffolding like `locationBlueprints`, random events, concepts, and `weatherState` unless `includeFullState` is requested, while leaving `secrets` visible.
- Prompt context: base context renders current region name, description, secrets, location names, and connected region names. Current weather enters prompts through the world-time payload after `resolveCurrentWeather()`. `templates/region.njk` renders fuller region detail including parent, controlling faction, average level, locations, connected regions, secrets, current weather, and status effects.
