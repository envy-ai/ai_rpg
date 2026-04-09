# NPC API

Common payloads: see `docs/api/common.md`.

## POST /api/npcs/generate-aliases
Generate aliases in bulk for all current NPCs.

Request:
- Body: none

Behavior:
- Processes NPCs in prompt batches of `20` names per request to the alias generator prompt.
- Applies aliases per NPC by exact lowercased name key; NPCs with no returned aliases are set to an empty alias list.
- Marks save metadata `npcAliasesGenerated=true` and persists `metadata.json` for the currently loaded save (if one is active).

Response:
- 200: `{ success: true, message, totalNpcs, updatedNpcs, npcsWithAliases, promptsRun, batchSize, persisted, metadata }`
- 500: `{ success: false, error }`

## GET /api/npcs/:id
Fetch full NPC status (uses `Player.getStatus()`).

Response:
- 200: `{ success: true, npc }` (PlayerStatus shape; may include `intrinsicStatusEffects`)
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id
Update an NPC's core data.

Request:
- Path: `id`
- Body supports: `name`, `description`, `shortDescription`, `race`, `class`, `factionId`, `level`, `health`, `healthAttribute`, `attributes`, `skills`, `abilities`, `currency`, `experience`, `isDead`, `personalityType`, `personalityTraits`, `personalityNotes`, `statusEffects`, `aliases`, `resistances`, `vulnerabilities`, `needBarApplicability` (also accepts singular aliases `resistance` and `vulnerability`)
- Rejects `unspentSkillPoints` (400) because pools are formula-derived at read time.

Response:
- 200: `{ success: true, npc: NpcProfile, message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Unknown skills may trigger skill generation; canonical names are normalized before assignment.
- `factionId` must reference an existing faction id or be `null` to clear membership.
- If provided, `aliases` must be an array of strings.
- If provided, `needBarApplicability` must be an object and is only accepted for NPCs; unchecked bars are removed from that actor and re-enabled bars come back at `100`.

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
- 200: `{ success: true, needs: NeedBar[], audience: { player, party, nonParty }, npc, player? }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/npcs/:id/needs
Update need bars for an NPC.

Request:
- Body: `{ needs: Array<{ id: string, value: number }> }`

Response:
- 200: `{ success: true, message, needs: NeedBar[], audience: { player, party, nonParty }, npc, applied: NeedBar[] }`
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
- Body: `{ locationId: string, accountTravelTime?: boolean, clientId?: string }`

Response:
- 200: `{ success: true, npc: NpcProfile, destination: LocationResponse, previousLocation: LocationResponse, locationIds: string[], worldTime, timeProgress, message }`
- 400/404/500 with `{ success: false, error }`

Notes:
- When `accountTravelTime` is `true`, the route resolves the shortest directed path between the origin and destination using the location graph's stored `travelTimeMinutes`, advances world time by that total, and returns the resulting `worldTime` / `timeProgress`.
- When the teleported character is the player and travel time advances, the route also records an event-summary chat entry in the form `Traveled from X to Y. Z passed.` and emits `chat_history_updated` when `clientId` is provided.
- If no route exists, fast-travel time falls back to `0` minutes.

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
