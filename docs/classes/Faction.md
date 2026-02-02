# Faction

## Purpose
Represents a faction with goals, tags, relations to other factions, assets, and reputation tiers. Maintains static indexes for lookup by id and name.

## Key State
- `#id`, `#name`.
- `#tags`, `#goals`.
- `#homeRegionName` (free-form region label).
- `#relations`: `Map<factionId, { status, notes }>` where status is `allied|neutral|hostile|rival`.
- `#assets`: array of asset objects.
- `#reputationTiers`: array of `{ threshold, label, perks, penalties }`.
- `#createdAt`, `#lastUpdated`.
- Static indexes: `#indexById`, `#indexByName`.

## Construction
- `new Faction({ id, name, tags, goals, homeRegionName, relations, assets, reputationTiers })`.

## Accessors
- Getters: `id`, `name`, `tags`, `goals`, `homeRegionName`, `relations`, `assets`, `reputationTiers`, `createdAt`, `lastUpdated`.
- Setters: `name`, `tags`, `goals`, `homeRegionName`, `relations`, `assets`, `reputationTiers`.

## Instance API
- `update(updates)`: applies updates via setters (skips id/timestamps).
- `getRelation(factionId)` returns `{ status, notes }` or `null`.
- `setRelation(factionId, relation)` expects `{ status, notes }`.
- `removeRelation(factionId)`.
- `resolveReputationTier(value)`: returns the tier matching a standing value.
- `toJSON()`.

## Static API
- `fromJSON(data)`.
- `create(options)`.
- `getById(id)` / `getByName(name)` / `getAll()`.
- `exists(id)` / `delete(id)` / `clear()`.
- `indexById` / `indexByName` getters.

## Notes
- Relations are normalized and validated against `allied|neutral|hostile|rival` and require notes.
- `reputationTiers` are sorted by threshold ascending.
