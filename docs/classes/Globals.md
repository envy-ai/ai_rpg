# Globals

## Purpose
`Globals.js` is the server-wide runtime state holder. It provides access to active configuration, current player/location/region helpers, save metadata, prompt wiring, realtime emits, slop analysis hooks, mod/runtime reload hooks, and canonical world time.

## Key State (Static)
- `config`, `baseDir`, `gameLoaded`, `inCombat`, `realtimeHub`.
- `currentSaveVersion` and `saveFileSaveVersion`: current runtime target version and loaded save metadata version. Version `1.2` is the persisted domain-object counter-ID format; `Utils.hydrateGameState(...)` migrates older serialized data before runtime use.
- `sceneSummaries`, `saveMetadata`, `currentSaveInfo`, `gameConfigOverrideYaml`.
- `plotAnalysis`: structured background `plot-analysis` prompt state, persisted in save metadata.
- `travelHistory`, `slopWords`, `slopTrigrams`.
- `_playerArrivalVisitStates` (transient per-request map of player movement destination ids to their pre-arrival `visited` state and `lastVisitedTime`).
- `worldTime`, `calendarDefinition`: canonical minute-based world clock and normalized calendar definition.
- Server-assigned runtime properties include `modExtensionRegistry`, `reloadConfigAndDefs`, `reloadLorebooks`, `cliTestModes`, and `debugVehicles`.
- `#currentPlayerOverride` (private override for `currentPlayer`).

## Static API

### Save And Runtime Metadata
- `setSaveMetadata(metadata)` / `getSaveMetadata()`: stores an object or clears with `null`/`undefined`. Non-object values throw. The getter returns the stored object reference.
- `setCurrentSaveInfo(info)` / `getCurrentSaveInfo()`: stores an object or clears with `null`/`undefined`. Non-object values throw.
- `setGameConfigOverrideYaml(value)` / `getGameConfigOverrideYaml()`: stores normalized per-game YAML override text. `null`, `undefined`, or blank text clear it; non-string values throw.
- `setPlotAnalysis(value)` / `getPlotAnalysis()`: validates and normalizes plot-analysis state. `null` clears the state. `getPlotAnalysis()` returns a deep clone.

### Server-Assigned Hooks
- `getBasePromptContext`, `getPromptEnv`, `parseXMLTemplate`, and `appendChatEntry` are fail-loud placeholders until `server.js` assigns implementations.
- `appendChatEntry(entry, { collector, locationId, clientId, emitClientRefresh, refreshPayload })` routes through `pushChatEntry`. It requires an explicit `locationId` or current player location and can emit `chat_history_updated`.
- `analyzeChatSlopwords`, `analyzeSlopwordsForText(text)`, `analyzeConfiguredNgramsForText(text)`, `analyzeSlopRegexesForText(text)`, and `findSlopRegexesInText(text)` are assigned by `server.js`. Text analysis throws on empty input; regex helpers strip asterisks before matching configured regexes.
- `reloadConfigAndDefs(...)` reloads merged config, validates definition overlays/formulas, refreshes caches, and stores the active per-game YAML override.
- `reloadLorebooks()` reloads the active lorebook manager or throws if the manager is unavailable.

### Current Player And Movement
- `getSceneSummaries()` returns the initialized `SceneSummaries` instance and throws if it is unavailable.
- `get currentPlayer()` returns `#currentPlayerOverride` when set, otherwise delegates to `Player.getCurrentPlayer()`.
- `set currentPlayer(player)` stores an override or clears it with a falsy value, and installs a `Player` current-player resolver.
- `set processedMove(value)` / `get processedMove()` store turn movement state.
- `clearPlayerArrivalVisitStates()`, `recordPlayerArrivalVisitState(locationOrId, wasVisited?)`, `getPlayerArrivalWasVisitedBeforeMove(locationOrId)`, and `getPlayerArrivalLastVisitedTimeBeforeMove(locationOrId)` preserve destination visit state before player movement marks the destination visited. `recordPlayerArrivalVisitState(...)` throws without a location id; getters return `undefined` when no snapshot exists.
- `setInCombat(value)` / `isInCombat()` store global combat state.
- `get location()` returns `Globals.currentPlayer?.location || null`.
- `get region()` returns `Globals.currentPlayer?.location?.region || null`.
- `get elapsedTime()` returns current player elapsed minutes when a player exists, otherwise total world minutes.
- `set elapsedTime(value)` requires a non-negative integer minute value, writes the current player's elapsed time when present, and updates `worldTime` to the matching `dayIndex`/`timeMinutes`.

### Lookup Helpers
- `locationById(id)` / `regionsById(id)` return `Location.get(id)` and `Region.get(id)` when config is initialized.
- `locationsById`, `regionsById`, `locationsByName`, `regionsByName`, `playersById`, and `playersByName` expose the corresponding class indexes.
- Lookup helpers warn and return `null` or an empty `Map` when accessed before `Globals.config` is set.

### Time And Calendar
- `getTimeConfig()` reads `Globals.config?.time` and validates `cycleLengthMinutes`, `tickMinutes`, and named `segmentBoundaries`. Defaults are a 1440-minute day, 15-minute tick, and dawn/day/dusk/night boundaries.
- `generateCalendarDefinition({ settingName })` returns a normalized Gregorian-style default calendar with months, weekdays, seasons, seasonal light descriptions, and holidays.
- `normalizeCalendarDefinition(calendarDefinition)` validates and returns a normalized deep clone without mutating active state.
- `ensureWorldTimeInitialized({ settingName })` initializes or normalizes `calendarDefinition` and `worldTime`, then returns `getWorldTimeContext({ skipEnsure: true })`.
- `resetWorldTime({ settingName, calendarDefinition })` installs a generated or supplied calendar, resets time to day 0 at the configured day segment start, syncs the current player, and returns world-time context.
- `hydrateWorldTime({ worldTime, calendarDefinition, settingName })` normalizes loaded state, generates a default calendar when needed, supports `timeHours` input compatibility when `timeMinutes` is absent, syncs the current player, and returns world-time context.
- `setCalendarDefinition(calendarDefinition)` validates and normalizes the replacement calendar before assignment, preserves normalized active world time, syncs the current player, and returns serialized calendar data. Invalid input throws before active state is mutated.
- `getSerializedWorldTime()` / `getSerializedCalendarDefinition()` ensure initialization and return deep clones.
- `getTotalWorldMinutes()` / `getTotalWorldHours()` return elapsed canonical world time.
- `getCalendarDayIndex({ monthNumber, dayOfMonth, calendarDefinition? })` converts a one-based year-one calendar date to canonical zero-based `dayIndex`. It validates the month position and the selected month's exact length without clamping.
- `advanceTime(minutes, { source })` requires non-negative integer minutes, advances `worldTime`, syncs the current player, and returns `{ source, advancedMinutes, transitions, previous, current }`.
- `getTimeSegment(worldTime?)`, `getSeason(worldTime?)`, `getCalendarDate(worldTime?)`, `getLightLevelDescription(worldTime?)`, `getLightingDescription(segmentName?)`, `formatTime(worldTime?)`, and `formatDate(worldTime?)` derive labels and calendar context from minute-based world time.
- `getWorldTimeContext({ transitions })` returns day/time, segment, season, formatted labels, lighting, holiday data, full date info, and cloned transition entries.
- `syncWorldTimeToPlayer(player?)` writes total world minutes to non-NPC players whose `elapsedTime` field is numeric or undefined.

### Realtime Helpers
- `emitToClient(clientId, type, payload, { includeServerTime, requestId })` validates `realtimeHub`, event type, and optional `clientId`, wraps non-object payloads as `{ value }`, injects `serverTime` unless disabled, injects `requestId` when provided, and delegates to `RealtimeHub.emit`. Omitted `clientId` broadcasts.
- `updateSpinnerText({ clientId, message, scope, requestId, includeServerTime })` emits a `chat_status` payload with stage `spinner:update`.

## Notes
- Canonical world time is `worldTime = { dayIndex, timeMinutes }`.
- Calendar generation has no leap-year handling.
- `calendarDefinition.seasons[*].timeDescriptions` is normalized and sorted, then used for `lightLevelDescription`. Segment-based lighting is used when no seasonal description applies.
- `getCalendarDate()` and `getWorldTimeContext()` include season descriptions and holiday context when the current date matches a configured holiday.
- `formatTime()` renders 12-hour `h:MM AM/PM` labels.
- Player-arrival visit-state helpers are runtime-only and are cleared at the start of player chat, direct-move, and teleport flows. Non-NPC `Player.setLocation(...)` snapshots the destination before marking it visited.
