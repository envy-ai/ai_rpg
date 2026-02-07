# Players & Party API

Common payloads: see `docs/api/common.md`.

## POST /api/player
Create a new player and set as current.

Request:
- Body (optional): `{ name?: string, attributes?: object, level?: number }`

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400: `{ success: false, error }`

## GET /api/player
Get the current player.

Response:
- 200: `{ success: true, player: NpcProfile }`
- 404: `{ success: false, error: 'No current player found' }`

## GET /api/players
List all players.

Response:
- 200: `{ success: true, players: NpcProfile[], count, currentPlayer }`

## POST /api/player/set-current
Set the current player.

Request:
- Body: `{ playerId: string }`

Response:
- 200: `{ success: true, currentPlayer: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## GET /api/player/party
List party members for current player.

Response:
- 200: `{ success: true, members: NpcProfile[], count }`
- 404: `{ success: false, error }`

## POST /api/player/party
Add a party member by id.

Request:
- Body: `{ ownerId: string, memberId: string }`

Response:
- 200: `{ success: true, message, members }`
  - `members` is an array of **member ids** (not profiles).
- 400/404/500 with `{ success: false, error }`

## DELETE /api/player/party
Remove a party member by id.

Request:
- Body: `{ ownerId: string, memberId: string }`

Response:
- 200: `{ success: true, message, members }` (`members` is an array of ids)
- 400/404/500 with `{ success: false, error }`

## PUT /api/player/attributes
Update player attributes.

Request:
- Body: `{ attributes: Record<string, number> }`

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400/404 with `{ success: false, error }`

## PUT /api/player/health
Modify player health.

Request:
- Body: `{ amount: number, reason?: string }`

Response:
- 200: `{ success: true, healthChange, player: NpcProfile, message }`
- 400/404 with `{ success: false, error }`

## POST /api/player/levelup
Level up the current player.

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400/404 with `{ success: false, error }`

## GET /api/player/needs
Get need bars for the current player.

Response:
- 200: `{ success: true, needs: NeedBar[], includePlayerOnly, player }`
- 404/500 with `{ success: false, error }`

## PUT /api/player/needs
Update need bars.

Request:
- Body: `{ needs: Array<{ id: string, value: number }> }`

Response:
- 200: `{ success: true, message, needs: NeedBar[], includePlayerOnly, player, applied: NeedBar[] }`
- 400/404 with `{ success: false, error }`

## POST /api/player/generate-attributes
Generate new attributes for current player.

Request:
- Body: `{ method?: string }`

Response:
- 200: `{ success: true, player: NpcProfile, generatedAttributes, method, message }`
- 400/404 with `{ success: false, error }`

## POST /api/player/update-stats
Update player stats (admin-style edit).

Request:
- Body supports: `name`, `description`, `level`, `health`, `attributes`, `skills`, `unspentSkillPoints`, `unspentAttributePoints`, `statusEffects`

Response:
- 200: `{ success: true, player: NpcProfile, message, imageNeedsUpdate }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/player/status
Update player status effects directly.

Request:
- Body: `{ statusEffects: array | null }` (required)

Response:
- 200: `{ success: true, message, player: NpcProfile }`
- 400/404 with `{ success: false, error }`

## POST /api/player/create-from-stats
Create a new player from a stats form and set as current.

Request:
- Body requires `name`; supports `description`, `level`, `health`, `attributes`, `skills`, `unspentSkillPoints`, `unspentAttributePoints`, `statusEffects`

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400/500 with `{ success: false, error }`

## POST /api/player/skills/:skillName/increase
Increase a skill rank.

Request:
- Path: `skillName`
- Body: `{ amount?: number }` (defaults to 1)

Response:
- 200: `{ success: true, player: NpcProfile, skill: { name, rank }, amount }`
- 400/404 with `{ success: false, error }`

## POST /api/player/equip
Equip/unequip an item in a specific slot for the current player.

Request:
- Body: `{ slotName: string, itemId?: string }`
  - If `itemId` is omitted, the slot is cleared (unequipped).

Response:
- 200: `{ success: true, player: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## POST /api/players/:id/portrait
Trigger portrait generation for a player.

Request:
- Path: `id`

Response:
- 200: `{ success: true, player: { id, name, imageId }, imageGeneration, message }`
- 202: `{ success: false, player: { ... }, imageGeneration, message: 'Portrait job already in progress' }`
- 409: `{ success: false, error, reason, player: { ... } }` (skipped)
- 503: `{ success: false, error }` (image generation disabled/unavailable)
- 404/500 with `{ success: false, error }`

## GET /api/gear-slots
List gear slot types.

Response:
- 200: `{ success: true, slotTypes: string[] }`
- 500: `{ success: false, error, details }`
