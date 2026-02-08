# Globals

## Purpose
Centralized static state and helpers used across the server. Provides access to the current player, locations, regions, realtime hub, and prompt/context wiring.

## Key State (Static)
- `config`, `baseDir`, `gameLoaded`, `inCombat`, `realtimeHub`.
- `currentSaveVersion`, `saveFileSaveVersion`.
- `sceneSummaries`, `saveMetadata`, `currentSaveInfo`.
- `travelHistory`, `slopWords`, `slopTrigrams`.
- `worldTime`, `calendarDefinition`.
- `#currentPlayerOverride` (private override for `currentPlayer`).

## Static API
- `setSaveMetadata(metadata)` / `getSaveMetadata()`.
- `setCurrentSaveInfo(info)` / `getCurrentSaveInfo()`.
- `getBasePromptContext`, `getPromptEnv`, `parseXMLTemplate`: placeholders that must be assigned.
- `getSceneSummaries()`: throws if not initialized.
- `get currentPlayer()` / `set currentPlayer(player)`: resolves through `Player` unless overridden.
- `set processedMove(value)` / `get processedMove()`.
- `setInCombat(value)` / `isInCombat()`.
- `get location()` / `get region()` / `get elapsedTime()` / `set elapsedTime(value)`.
- Time/calendar:
  - `getTimeConfig()`
  - `generateCalendarDefinition({ settingName })`
  - `ensureWorldTimeInitialized({ settingName })`
  - `resetWorldTime({ settingName, calendarDefinition })`
  - `hydrateWorldTime({ worldTime, calendarDefinition, settingName })`
  - `advanceTime(hours, { source })`
  - `getTimeSegment(worldTime?)` / `getSeason(worldTime?)`
  - `getCalendarDate(worldTime?)`
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
- World-time init/context helpers now use an internal non-recursive path (`skipEnsure`)
  so `ensureWorldTimeInitialized()` can safely return full time context.
- Built-in calendar generation is Gregorian (no leap-year/day handling) and acts as
  fallback when LLM calendar generation fails.
- `getCalendarDate()` / `getWorldTimeContext()` include season descriptions and
  holiday context (name/description/month/day) when the current date matches a
  configured holiday.
