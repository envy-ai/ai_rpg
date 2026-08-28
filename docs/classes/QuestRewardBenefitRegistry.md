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

No other benefit types are registered yet. `service`, `favor`, `access`, `knowledge`, `property`, `title`, and `world-change` entries therefore fail explicitly instead of being stored as unenforced mechanics. Narrative-only promises belong in `Quest.rewardNotes`.

## Completion And Recovery

`Events.processQuestObjectiveCompletionEntries()` applies benefits before conventional rewards. Each successfully applied benefit id is appended to `quest.appliedRewardBenefitIds` immediately. If a later benefit fails, `rewardClaimed` remains false, the earlier benefit is not rolled back, and an explicit retry skips its mutation while retaining it in the authoritative reward summary. The completed quest UI calls `POST /api/quests/:questId/retry-rewards` for this recovery path.
