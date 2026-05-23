# Globals

## Purpose
Centralized static state and helpers used across the server. Provides access to the current player, locations, regions, realtime hub, and prompt/context wiring.

## Key State (Static)
- `config`, `baseDir`, `gameLoaded`, `inCombat`, `realtimeHub`.
- `currentSaveVersion`, `saveFileSaveVersion` (`1.2` adds compact counter-ID migration for persisted domain objects).
- `sceneSummaries`, `saveMetadata`, `currentSaveInfo`.
- `plotAnalysis`: the most recent background `plot-analysis` prompt output, stored as a structured object and persisted through save metadata.
- `travelHistory`, `slopWords`, `slopTrigrams`.
- `_playerArrivalVisitStates` (transient per-request map of player movement destination ids to their pre-arrival `visited` state and `lastVisitedTime`).
- `worldTime`, `calendarDefinition`.
- `#currentPlayerOverride` (private override for `currentPlayer`).

## Static API
- `setSaveMetadata(metadata)` / `getSaveMetadata()`.
- `setPlotAnalysis(value)` / `getPlotAnalysis()`: validates and deep-clones the latest plot-analysis state. `null` clears the state.
- `setCurrentSaveInfo(info)` / `getCurrentSaveInfo()`.
- `getBasePromptContext`, `getPromptEnv`, `parseXMLTemplate`: placeholders that must be assigned.
- `appendChatEntry(entry, { collector, locationId, clientId, emitClientRefresh, refreshPayload })`: server-assigned helper that routes through `pushChatEntry` and can optionally emit `chat_history_updated`.
- `analyzeSlopwordsForText(text)`, `analyzeConfiguredNgramsForText(text)`, `analyzeSlopRegexesForText(text)`, and `findSlopRegexesInText(text)`: server-assigned slop detection helpers used by the slop-remover flow. Regex helpers strip asterisks from the checked text before applying configured patterns.
- `getSceneSummaries()`: throws if not initialized.
- `get currentPlayer()` / `set currentPlayer(player)`: resolves through `Player` unless overridden.
- `set processedMove(value)` / `get processedMove()`.
- `clearPlayerArrivalVisitStates()`, `recordPlayerArrivalVisitState(locationOrId, wasVisited?)`, `getPlayerArrivalWasVisitedBeforeMove(locationOrId)`, `getPlayerArrivalLastVisitedTimeBeforeMove(locationOrId)`: transient helpers used by player-movement paths to preserve whether an arrival destination was already visited, and when it was last visited, before `Player.setLocation(...)` marks it visited.
- `setInCombat(value)` / `isInCombat()`.
- `get location()` / `get region()` / `get elapsedTime()` / `set elapsedTime(value)`.
- Time/calendar:
  - `getTimeConfig()`
  - `generateCalendarDefinition({ settingName })`
  - `normalizeCalendarDefinition(calendarDefinition)`
  - `ensureWorldTimeInitialized({ settingName })`
  - `resetWorldTime({ settingName, calendarDefinition })`
  - `hydrateWorldTime({ worldTime, calendarDefinition, settingName })`
  - `setCalendarDefinition(calendarDefinition)`
  - `getTotalWorldMinutes()`
  - `advanceTime(minutes, { source })`
  - `getTimeSegment(worldTime?)` / `getSeason(worldTime?)`
  - `getCalendarDate(worldTime?)`
  - `getLightLevelDescription(worldTime?)`
  - `formatTime(worldTime?)` / `formatDate(worldTime?)`
  - `getWorldTimeContext({ transitions })`
  - `getSerializedWorldTime()` / `getSerializedCalendarDefinition()`
  - `syncWorldTimeToPlayer(player?)`
- `locationById(id)` / `regionsById(id)`.
- `get locationsById()` / `get regionsById()` / `get locationsByName()` / `get regionsByName()`.
- `get playersById()` / `get playersByName()`.
- `emitToClient(clientId, type, payload, { includeServerTime, requestId })`:
  - Validates types and uses `realtimeHub.emit`.
- `updateSpinnerText({ clientId, message, scope, requestId, includeServerTime })`: emits chat spinner updates.

## Notes
- Many getters warn if `Globals.config` is missing to avoid silent failures.
- `currentPlayer` setter also installs a resolver in `Player` when available.
- Player-arrival visit-state helpers are runtime-only and are cleared at the start of player chat/direct-move/teleport flows. They let while-you-were-away logic skip first-time arrivals, missing pre-arrival snapshots, and too-recent revisits even though `Player.setLocation(...)` stamps the destination as visited before the arrival prompt would otherwise run.
- Canonical world time is minute-based: `worldTime = { dayIndex, timeMinutes }`.
- World-time init/context helpers now use an internal non-recursive path (`skipEnsure`)
  so `ensureWorldTimeInitialized()` can safely return full time context.
- Built-in calendar generation is Gregorian (no leap-year/day handling) and acts as
  fallback when LLM calendar generation fails.
- `normalizeCalendarDefinition(calendarDefinition)` validates and returns a normalized
  deep clone without mutating active `Globals.calendarDefinition` or `worldTime`.
- `setCalendarDefinition(calendarDefinition)` validates and normalizes a replacement
  calendar before assigning it, preserves the current minute-based `worldTime`, and
  throws without mutating state when the calendar is invalid.
- `getCalendarDate()` / `getWorldTimeContext()` include season descriptions and
  holiday context (name/description/month/day) when the current date matches a
  configured holiday.
- `calendarDefinition.seasons[*].timeDescriptions` is normalized and used to
  derive `worldTime.lightLevelDescription` (with segment-based lighting as
  fallback when no seasonal time descriptions are present).
- `formatTime()` renders display labels as 12-hour `h:MM AM/PM`.
