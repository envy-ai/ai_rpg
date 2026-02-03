# Factions API

## GET /api/factions
List all factions and current player standings.

Response:
- 200: `{ success: true, factions: Faction[], playerStandings: Record<factionId, number>, playerId }`
- 500: `{ success: false, error }`

## POST /api/factions
Create a new faction.

Request:
- Body: `{ name: string, shortDescription?: string|null, description?: string|null, tags?: string[]|string, goals?: string[]|string, homeRegionName?: string, assets?: Array<{ name: string, type?: string, description?: string }>, relations?: Record<factionId, { status: 'allied'|'neutral'|'hostile'|'rival', notes: string }>, reputationTiers?: Array<{ threshold: number, label?: string, perks?: string[]|string, penalties?: string[]|string }> }`

Response:
- 201: `{ success: true, faction: Faction }`
- 400: `{ success: false, error }`
- 500: `{ success: false, error }`

Notes:
- Faction name `"None"` is reserved and cannot be created.

## PUT /api/factions/:id
Update a faction.

Request:
- Path: `id` (faction id)
- Body supports: `name`, `shortDescription`, `description`, `tags`, `goals`, `homeRegionName`, `assets`, `relations`, `reputationTiers`

Response:
- 200: `{ success: true, faction: Faction }`
- 400/404/500 with `{ success: false, error }`

Notes:
- Faction name `"None"` is reserved and cannot be set.

## DELETE /api/factions/:id
Delete a faction, remove relations pointing to it, and clear affiliations/standings.

Response:
- 200: `{ success: true, removed: Faction }`
- 400/404/500 with `{ success: false, error }`

## PUT /api/player/factions/:id/standing
Set or clear the current player's standing with a faction.

Request:
- Path: `id` (faction id)
- Body: `{ value: number | null }` (`null` removes the standing entry)

Response:
- 200: `{ success: true, factionId, standings: Record<factionId, number> }`
- 400/404/500 with `{ success: false, error }`
