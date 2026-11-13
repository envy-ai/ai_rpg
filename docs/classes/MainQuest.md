# MainQuest

`MainQuest.js` is the record for one main quest (active or historical) plus the save-wide offer state. Design: [main_quest_brainstorm.md](../ideas/main_quest_brainstorm.md); lifecycle: [MainQuestService](MainQuestService.md); API: [main_quest.md](../api/main_quest.md).

## Fields

| Field | Notes |
|---|---|
| `id` | `mquest_...` via `IdGenerator.next('mainQuest', title)`. |
| `title`, `premise` | Player-facing. |
| `playerGoal` | What the player typed when starting, or `null`. |
| `hiddenTruth` | GM-private; only main-quest prompts see it. |
| `antagonist` | `{ description, factionId, npcId }`; ids are `null` when the opposition doesn't exist in the world yet. |
| `roles` | `[{ key, description, boundTo: { type: 'npc'|'faction', id, name } | null, history }]`. `bindRole` appends `{ from, to, reason, at }` to `history`. |
| `stages` | `[{ id: 'stage_N', title, outline, exitCondition, detail: { objective, hiddenDirection, hooks } | null, questId, status, outcome }]`; status is `pending`, `active`, `completed` or `skipped`. Only the current and next stage get `detail`. |
| `currentStageIndex` | Zero-based. |
| `lockedFacts` | Established facts replanning must keep; `addLockedFacts` dedupes case-insensitively. |
| `endings` | `[{ id: 'ending_N', description }]`, rewritable until reached. |
| `reachedEnding` | `{ endingId | null, description }`; `null` id is an unplanned ending. |
| `pressure` | `{ playerFacingText, trackerIds, scheduledEventIds }` (ids of the hidden deadline tracker and deadline events this main quest created). |
| `status` | `active`, `completed`, `abandoned`. At most one record is `active`; constructing a second throws. |
| `mode`, `previousMainQuestId` | `new` or `sequel`, and the earlier main quest a sequel continues. |
| `turnsSinceProgress` | Completed player-action turns since the last stage change; drives prompt prominence and the check interval. |
| `outcomeLog` | `[{ stageId, summary, worldMinute }]`. |

Mutators: `setStageDetail`, `replanFutureStages(stages)` (keeps stages up to and including the current one, renumbers the rest as pending), `replaceEndings`, `addLockedFacts`, `bindRole`, `recordOutcome`, `touch`.

`toPlayerView()` is the client-safe projection: title, premise, goal, status, current stage objective, completed stage outcomes, pressure text and reached ending. It omits the hidden truth, future stages, endings and stage count.

## Offer state and persistence

`MainQuest.getOffer()` / `setOffer({ state, followUpOf })` hold `{ state: 'pending'|'declined'|'started', followUpOf }`. `followUpOf` must name a saved main quest.

- New game (`reset`/`clear`): no records, offer `pending`.
- `serializeAll()` → `{ offer, mainQuests: { id: record } }`, saved as `mainQuests.json`.
- `loadAll(null)` (older save without the file) leaves the offer `pending`, so the start popup appears once. Present payloads restore records (non-active first) and the offer.

Static API: `getById`, `getAll`, `getActive`, `findByQuestId(questId)`, `removeById`, `statuses`, `offerStates`.
