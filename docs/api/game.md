# Game Lifecycle API

Common payloads: see `docs/api/common.md`.

## POST /api/new-game
Start a new game session.

Request:
- Body supports: `playerName`, `playerDescription`, `playerClass`, `playerRace`, `playerLevel`, `startTime`, `startingLocation`, `startingCurrency`, `attributes`, `skills`, `clientId`, `requestId`
  - `startTime` is a 24-hour integer hour (`0`-`23`) and defaults to `9` when omitted.
  - The selected `startTime` hour is converted to canonical world minutes at initialization (`hour * 60`).
- Rejects `unspentSkillPoints` and `unspentAttributePoints` (400) because pools are formula-derived at read time.

Response:
- 200: `{ success: true, message, player, startingLocation, region, skills, gameState }`
  - `player`: `Player.toJSON()` (not NpcProfile)
  - `startingLocation`: LocationDetails + `pendingImageJobId` + `npcs`
  - `region`: Region JSON
  - `skills`: Skill[]
  - `factions`: Faction[]
  - `gameState`: `{ totalPlayers, totalLocations, currentLocation, regionEntranceId }`
- 400: `{ success: false, error }` (no active setting)
- 500: `{ success: false, error, details }`

Notes:
- When `clientId` is provided, realtime status events are emitted during generation.
- Skills are sourced from the active setting (`defaultExistingSkills`) and are not accepted in the request body.
- Faction setup now prefers active-setting defaults when present:
  - `defaultFactions` are loaded first.
  - `defaultFactionCount` determines the total target count when provided.
  - If count exceeds preconfigured drafts, the remainder is generated via faction generation prompts.
  - If `defaultFactionCount` is unset and drafts exist, draft length is used; otherwise `config.factions.count` is used as fallback.
- World calendar generation runs during new-game setup via an LLM prompt (`calendar_generation`).
- The prompt explicitly instructs Earth-like settings to use a Gregorian calendar (standard month/day names and lengths, no leap-year handling).
- The prompt requests season descriptions, per-season time-of-day lighting descriptions, and 10 holiday entries (with descriptions).
- Gregorian fallback is still used if calendar generation fails.
- New-game setup also runs a base-context intro prompt (`game_intro`) and appends its prose to chat history as a visible assistant entry (`type: game-intro`) before the first player turn.
- If intro generation fails, setup continues; the server logs a warning and no intro entry is added.

## POST /api/new-game/settings/save
Save a New Game form configuration to disk.

Request:
- Body: `{ saveName?: string, settings: NewGameFormSettings }`
  - `settings` supports: `playerName`, `playerDescription`, `playerClass`, `playerRace`, `playerLevel`, `startTime`, `startingLocation`, `startingCurrency`, `attributes`, `skills`

Response:
- 200: `{ success: true, saveName, saveDir, metadata, message }`
- 400/500 with `{ success: false, error }`

## POST /api/new-game/settings/load
Load a saved New Game form configuration.

Request:
- Body: `{ saveName: string }`

Response:
- 200: `{ success: true, saveName, metadata, settings, message }`
- 400/404/500 with `{ success: false, error }`

## GET /api/new-game/settings/saves
List saved New Game form configurations.

Response:
- 200: `{ success: true, saves, count, directory }`
  - `saves` entries include metadata such as `saveName`, `timestamp`, `playerName`, `playerLevel`, `currentSettingName`, `totalAttributes`, `totalSkills`
- 500 with `{ success: false, error }`

## POST /api/save
Save the current game.

Response:
- 200: `{ success: true, saveName, saveDir, metadata, message }`
- 400/500 with `{ success: false, error }`

Notes:
- Successful saves now emit a server-console line in the shared save path (`performGameSave`), so this applies to both manual saves and autosaves.
- Save metadata now includes `npcAliasesGenerated` (boolean). It is set to `true` after alias-generation prompts run.

## POST /api/load
Load a saved game.

Request:
- Body: `{ saveName: string, saveType?: 'autosaves'|'saves', clientId?: string }`

Response:
- 200: `{ success: true, saveName, source, metadata, loadedData, message }`
  - `loadedData`: `{ currentPlayer: NpcProfile|null, totalPlayers, totalThings, totalLocations, totalLocationExits, chatHistoryLength, totalGeneratedImages, currentSetting }`
- 400/404/500 with `{ success: false, error }`

Notes:
- If a save has no persisted `calendarDefinition`, the server generates one from the active setting via LLM (`calendar_generation`) using the same Earth-like => Gregorian prompt rule, then falls back to Gregorian if generation fails.
- `/api/load` now runs faction-reference reconciliation before restoring the current player: invalid faction ids are cleared from player `factionId`, player faction standings, location/region/pending-stub controlling faction ids, and faction relation edges that target missing/self factions.
- `/api/load` now also resolves pending player level-up ability draft state for the loaded player (`player_ability_options_per_level` / `player_abilities_per_level`) without generating options yet; option generation runs when the client requests `/api/player/ability-selection` with generation enabled.
- `metadata.npcAliasesGenerated` is normalized to a boolean on load (`true` only when explicitly set `true` in the save metadata).

## GET /api/saves
List available saves.

Request:
- Query: `type` (`saves` or `autosaves`, default `saves`)

Response:
- 200: `{ success: true, type, saves, count, message }`
  - `saves` entries include baseline metadata and fields from each save's `metadata.json`.
- 400/500 with `{ success: false, error }`

## DELETE /api/save/:saveName
Delete a save.

Response:
- 200: `{ success: true, saveName, message }`
- 404/500 with `{ success: false, error }`

## POST /api/summaries/style
Update summary style in save metadata.

Request:
- Body: `{ style: 'line' | 'scene' }`

Response:
- 200: `{ success: true, summaryStyle, persisted }`
- 400/500 with `{ success: false, error }`

## GET /api/short-descriptions/pending
Check for pending short-description backfill work.

Request:
- Query: `clientId` (required)

Response:
- 200: `{ success: true, pending, plan }`
  - `plan` includes counts/prompts/batch size per entity type.
- 400/500 with `{ success: false, error }`

## POST /api/short-descriptions/process
Run or skip short-description backfill.

Request:
- Body: `{ clientId: string, action: 'run'|'process'|'skip'|'dismiss' }`

Response:
- 200: `{ success: true, processed: true }` or `{ success: true, skipped: true }`
- 400/404/409/500 with `{ success: false, error }`
