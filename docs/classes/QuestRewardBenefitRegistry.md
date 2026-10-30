# QuestRewardBenefitRegistry

## Purpose

`QuestRewardBenefitRegistry.js` owns the typed server-side contract for mechanical non-material quest rewards. Serialized quests store data, never arbitrary tool calls or property paths. A benefit type is usable only after a handler registers all five required operations: `normalize`, `validate`, `isSatisfied`, `apply`, and `summarize`.

## Registry API

- `register(type, handler)` rejects duplicate types and incomplete handlers.
- `get(type)` returns the registered handler or throws `Unsupported quest reward benefit type`.
- `normalize(entry, context)` and `normalizeAll(entries, context)` create canonical persisted values and reject missing or duplicate stable ids.
- `validate(entry, context)` normalizes and validates one entry against authoritative state.
- `isSatisfied(entry, context)` asks the owning handler whether the benefit already exists.
- `apply(entry, context)` validates, treats an already-satisfied state as success, otherwise performs the typed mutation, verifies the resulting state, and returns display-ready summary metadata.
- `summarize(entry, result, context)` describes a previously applied entry without applying it again; quest reward recovery uses this for persisted applied ids.

## Registered Types

### `party-member`

Canonical shape:

```js
{
  id: 'ragna_support',
  type: 'party-member',
  targetId: 'npc_ragna_kaen',
  label: 'Ragna Kaen',
  description: 'Ragna joins with her own equipment.',
  role: 'combat support'
}
```

- `id`, `targetId`, and `label` are required non-empty strings. `description` and `role` are optional trimmed strings.
- Validation requires a party-owning player and an existing living NPC distinct from the player.
- Satisfaction checks the authoritative `player.getPartyMembers()` list.
- Application calls `player.addPartyMember(targetId)`. That existing domain API removes the NPC from ordinary location membership and leaves the NPC's inventory and equipment on the NPC.
- Summaries request party and target-actor refreshes and provide a reward-prose line.

### `knowledge` / `route`

Canonical shape:

```js
{
  id: 'knowledge-route:loc_gate:exit_hidden_path',
  type: 'knowledge',
  subtype: 'route',
  sourceLocationId: 'loc_gate',
  targetId: 'exit_hidden_path',
  destinationLocationId: 'loc_grotto',
  label: 'The concealed path to the grotto',
  description: 'The guide explains where the trail begins.'
}
```

- `route` is the only registered knowledge subtype. The id must exactly equal `knowledge-route:<sourceLocationId>:<targetId>`.
- Validation requires an active player, a hydrated source location, the exact outgoing directed exit id, its pinned destination id, and an existing destination location. Deleted, moved, or retargeted exits fail explicitly.
- Satisfaction requires the exact directed exit to be visible with null discovery difficulty.
- Application uses `HiddenDiscovery.revealHiddenExit(...)`. It reveals only that edge; it does not reveal the reverse edge, visit or expand the destination, or grant fast travel.
- A matching edge revealed independently before completion is an idempotent success. Summaries distinguish newly learned from already-known routes and request source-location, Region Map, World Map, and Favorites refreshes.

No other benefit types or knowledge subtypes are registered yet. `service`, `favor`, `access`, general location/recipe/ability/lore knowledge, `property`, `title`, and `world-change` entries therefore fail explicitly instead of being stored as unenforced mechanics. Narrative-only promises belong in `Quest.rewardNotes`.

## Completion And Recovery

`Events.processQuestObjectiveCompletionEntries()` applies benefits before conventional rewards. Each successfully applied benefit id is appended to `quest.appliedRewardBenefitIds` immediately. If a later benefit fails, `rewardClaimed` remains false, the earlier benefit is not rolled back, and an explicit retry skips its mutation while retaining it in the authoritative reward summary. The completed quest UI calls `POST /api/quests/:questId/retry-rewards` for this recovery path.
