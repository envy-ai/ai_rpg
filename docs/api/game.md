# Game Lifecycle API

Common payloads: see `docs/api/common.md`.

## POST /api/new-game
Start a new game session.

Request:
- Body supports: `playerName`, `playerDescription`, `playerClass`, `playerRace`, `startingLocation`, `numSkills`, `existingSkills`, `startingCurrency`, `clientId`, `requestId`

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

## POST /api/save
Save the current game.

Response:
- 200: `{ success: true, saveName, saveDir, metadata, message }`
- 400/500 with `{ success: false, error }`

## POST /api/load
Load a saved game.

Request:
- Body: `{ saveName: string, saveType?: 'autosaves'|'saves', clientId?: string }`

Response:
- 200: `{ success: true, saveName, source, metadata, loadedData, message }`
  - `loadedData`: `{ currentPlayer: NpcProfile|null, totalPlayers, totalThings, totalLocations, totalLocationExits, chatHistoryLength, totalGeneratedImages, currentSetting }`
- 400/404/500 with `{ success: false, error }`

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
