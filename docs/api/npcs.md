# NPC API

Common payloads: see `docs/api/common.md`.

## GET /api/npcs/:id
Fetch full NPC status (uses `Player.getStatus()`).

Response:
- 200: `{ success: true, npc }` (PlayerStatus shape; may include `intrinsicStatusEffects`)
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id
Update an NPC's core data.

Request:
- Path: `id`
- Body supports: `name`, `description`, `shortDescription`, `race`, `class`, `level`, `health`, `healthAttribute`, `attributes`, `skills`, `abilities`, `unspentSkillPoints`, `currency`, `experience`, `isDead`, `personalityType`, `personalityTraits`, `personalityNotes`, `statusEffects`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Unknown skills may trigger skill generation; canonical names are normalized before assignment.

## POST /api/npcs/:id/equipment
Equip or unequip an item in an NPC's inventory.

Request:
- Body: `{ itemId: string, action?: 'equip'|'unequip'|false, slotName?: string, slotType?: string }`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## GET /api/npcs/:id/needs
Fetch need bars for an NPC.

Response:
- 200: `{ success: true, needs: NeedBar[], includePlayerOnly, npc, player? }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id/needs
Update need bars for an NPC.

Request:
- Body: `{ needs: Array<{ id: string, value: number }> }`

Response:
- 200: `{ success: true, message, needs: NeedBar[], includePlayerOnly, npc, applied: NeedBar[] }`
- 400/404/500 with `{ success: false, error }`

## GET /api/npcs/:id/dispositions
Fetch disposition values toward the current player.

Response:
- 200: `{ success: true, npc, player, range, dispositions }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id/dispositions
Update disposition values.

Request:
- Body: `{ dispositions?: Array<{ key, value }> }`

Response:
- 200: `{ success: true, message, npc, player, range, dispositions, applied }`
- 400/404/500 with `{ success: false, error }`

Notes:
- If `dispositions` is omitted, the endpoint returns the snapshot with an empty `applied` array.

## PUT /api/npcs/:id/memories
Replace important memories.

Request:
- Body: `{ memories: string[] }`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id/goals
Replace NPC goals.

Request:
- Body: `{ goals: string[] }`

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

## POST /api/npcs/:id/teleport
Teleport an NPC to another location.

Request:
- Body: `{ locationId: string }`

Response:
- 200: `{ success: true, npc: NpcProfile, destination: LocationResponse, previousLocation: LocationResponse, locationIds: string[], message }`
- 400/404/500 with `{ success: false, error }`

## DELETE /api/npcs/:id
Delete an NPC.

Response:
- 200: `{ success: true, message, locationId, regionId }`
- 400/404/500 with `{ success: false, error }`

## POST /api/npcs/:id/portrait
Trigger portrait generation for an NPC.

Request:
- Path: `id`
- Body: `{ clientId?: string }`

Response:
- 200: `{ success: true, npc: { id, name, imageId }, imageGeneration, message }`
- 202: `{ success: false, npc: { ... }, imageGeneration, message }` (existing job)
- 409: `{ success: false, error, reason, npc: { ... } }` (skipped)
- 503: `{ success: false, error }`
- 404/500 with `{ success: false, error }`
