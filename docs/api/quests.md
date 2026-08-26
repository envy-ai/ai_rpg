# Quest API

Common payloads: see `docs/api/common.md`.

Quest state lives on the current player. There is no standalone quest-list route; the quest panel reads `/api/player`, using the serialized player's `quests` array for active quests and `completedQuests` array for completed quests.

Quest creation normally comes from the chat event pipeline. Generated quest offers are sent to the client as `quest_confirmation_request` websocket messages and are resolved through `/api/quests/confirm`. Quest edits and abandon actions use the routes below.

## POST /api/quests/confirm
Resolve a pending quest confirmation prompt for the websocket client that received it.

Request:
- Body:
  - `confirmationId` (string, required)
  - `clientId` (string, required)
  - decision (one of):
    - `accepted` (boolean)
    - `decision` (string: `accept`, `accepted`, `yes`, `y`, `true`, `decline`, `declined`, `reject`, `rejected`, `no`, `n`, or `false`)
    - `accept` (string: `true`, `1`, `yes`, `accept`, `false`, `0`, `no`, or `decline`)

Response:
- 200: `{ success: true, accepted: boolean }`
- 400: `{ success: false, error }` for missing fields, invalid decisions, unknown confirmation ids, resolved confirmations, or client mismatches
- 503: `{ success: false, error }` (confirmation service unavailable)

Behavior:
- `QuestConfirmationManager` owns pending confirmations, keyed by `confirmationId`.
- A response must come from the same `clientId` that received the websocket request.
- Resolving the confirmation completes the pending server-side promise. Accepted generated quests enter the player's quest list through the event pipeline; declined quests are ignored.
- The confirmation request payload contains a safe quest preview: `id`, `name`, `summary`, `description`, `giver`, `objectives`, `rewardItems`, `rewardCurrency`, `rewardXp`, and `rewardNpcDispositions`. Generated quest previews also include display-ready faction reward entries.
- Each `rewardNpcDispositions[].dispositions[]` entry carries both the authored `intensity` and a resolved `delta` (the actual disposition change, `intensity` scaled by the disposition definitions' `typicalStep`/`typicalBigStep`). The preview computes `delta` with `resolveQuestDispositionRewardDelta(intensity, Player.getDispositionDefinitions())` — the same shared resolver `Events._resolveQuestDispositionDelta` uses on completion — so the value shown when accepting a quest matches what the quest list shows and what is actually applied. The client accept dialog displays `delta`, falling back to `intensity` only if no delta is available. Faction reputation rewards are applied as authored (no multiplier), so their displayed value already equals the applied change. The first-impression multiplier is intentionally excluded from the preview because it depends on runtime disposition state known only at award time.

## POST /api/quest/edit
Edit an existing quest on the current player. This route does not create quests and does not apply completion rewards by itself.

Request:
- Body:
  - `questId` (required)
  - Optional scalar fields: `name`, `description`, `secretNotes`, `rewardCurrency`, `rewardXp`, `rewardClaimed`, `paused`, `giverName`
  - Optional collection fields: `rewardItems`, `rewardFactionReputation`, `rewardNpcDispositions`, `objectives`

Field behavior:
- `questId` must identify a quest on the current player.
- `name`, when supplied, must trim to a non-empty string.
- `description` and `secretNotes` are accepted as strings; omitted fields keep the existing values.
- `rewardCurrency` and `rewardXp` are converted with `Number(...)`; finite values are floored to non-negative integers. Non-finite or omitted values keep the existing values.
- `rewardItems` accepts an array of strings or a string split on newlines/commas. Blank item names are discarded. Omitted `rewardItems` keeps the existing list.
- `paused`, when supplied, must be a boolean. Paused quests remain on the player but are excluded from quest-check prompts.
- `rewardClaimed` is stored as a boolean. Setting it true prevents the completion pipeline from granting that quest's completion rewards.
- `giverName`, when supplied, is trimmed and stored as display metadata. The edit route does not resolve or rewrite `giverId`.
- `objectives`, when supplied, replaces the quest objective list. Each entry must include a non-empty `description` and may include `id`, `completed`, and `optional`.

`rewardFactionReputation` formats:
- Object map: `{ "factionIdOrName": integerDelta }`
- Array entries: `{ factionId|faction|name, amount|delta|points|value }`
- Array tuples: `[factionIdOrName, integerDelta]`
- Formatted string lines: `Faction Name or ID: +/-points`
- `null`, `undefined`, or an empty string clears reputation rewards.
- Faction keys must resolve by id or name through the faction registry. Unknown factions make the edit fail with 400.
- Deltas must be integers and may be negative. Zero entries are omitted; duplicate entries are merged when the input format allows duplicates.

`rewardNpcDispositions` formats:
- Formatted string lines: `NPC Name: disposition type +/-intensity - reason`
- Multiple dispositions for one NPC can be separated with semicolons in the value after the colon.
- Normalized array entries: `{ npcId?, npcName|name|npc, dispositions: [{ type, intensity, reason? }] }`
- The `dispositions` value may also be an object map of `{ type: intensity }`.
- Entries must include `npcId` or a name field. Disposition types must be non-empty strings. Intensities must be non-zero integers.
- NPC targets are resolved by id or name. Unknown NPC targets are skipped with a console warning; valid entries are saved.

Response:
- 200: `{ success: true, quest: Quest, player: NpcProfile }`, where `quest` is `Quest.toJSON()`
- 400/404 with `{ success: false, error }`

## DELETE /api/player/quests/:questId
Remove a quest from the current player.

Request:
- Path:
  - `questId` (string, required)

Response:
- 200: `{ success: true, message, player: NpcProfile }`
- 400/404 with `{ success: false, error }`

Behavior:
- The route calls `currentPlayer.removeQuest(questId)`.
- Removing a quest deletes it from the current player's quest list; it is not moved to completed quests.

## Quest Checks And Rewards

Quest objective completion is applied by `Events.runQuestChecks()` and `Events.processQuestObjectiveCompletionEntries(...)`, not by the edit route.

Quest checks:
- Require `quest_checks.enabled === true`.
- Also require `event_checks.enabled !== false`, unless the caller passes `allowWithoutEventChecks`.
- Use active, unpaused, incomplete quests from the current player's canonical quest order.
- Return `null` without building a prompt when there are no active, unpaused quests; these calls do not advance the interval counter.
- Increment the persisted quest-check counter once per eligible call and run only on every `quest_checks.interval`th eligible call. The runtime fallback is `1`, the shipped default config sets it to `5`, and configured values must be integers greater than or equal to `1`.
- A true XML event-check `anyQuestObjectivesCompleted` signal bypasses the interval and runs one quest check in the same turn when the normal check did not already run. When either path successfully ran the prompt, the signal resets the quest-check counter to zero. `quest_checks.enabled`, active-quest filtering, and duplicate suppression still apply.
- Render the `quest-check` prompt and call `LLMClient.chatCompletion` with metadata label `quest_check`. Quest-check validation requires one complete `<quests>...</quests>` root, so a response that stops after a nested `</quest>` is rejected and retried before objective parsing.
- Parse completed objectives from quest-status XML using one-based quest and objective indices.

Objective completion:
- Marks the targeted objective complete.
- Records `completedQuestObjectives` entries with quest id/name, zero-based objective index, one-based objective number, objective description, completion reason, and quest completion flags.
- A quest is complete when every objective is completed or optional.

Completion rewards:
- Rewards are processed once per completed quest. `rewardClaimed` is set to true when rewards are processed.
- Reward item names are generated directly into the player's inventory. Each generated item carries its quest id and reward index in metadata and remains a distinct stack, allowing retries to recognize an already-created reward without merging it into unrelated inventory.
- Currency rewards call `player.adjustCurrency(...)` and append `currencyChanges`.
- XP rewards call `player.addExperience(...)` and append `experienceAwards`.
- Faction reputation rewards resolve stored faction ids and call `player.setFactionStanding(...)`; applied rows append `factionStandingChanges` and reward summaries.
- NPC disposition rewards resolve target NPCs, convert configured intensity to a disposition delta using the disposition range settings, apply the first-impression multiplier when applicable, write the NPC disposition toward the current player, and append `dispositionChanges`.
- Unknown faction or NPC reward targets are skipped with console warnings during reward application.
- Reward prose is derived from the structured rewards after they are applied and is not run through event checks. This prevents narration from duplicating currency, items, XP, faction reputation, NPC dispositions, or incidental effects.

## Quest Shape

`Quest.toJSON()` returns:
- `id`, `name`, `description`
- `objectives`: array of `{ id, description, completed, optional }`
- `rewardItems`, `rewardCurrency`, `rewardXp`
- `rewardFactionReputation`: object map of `factionId -> integerDelta`
- `rewardNpcDispositions`: array of `{ npcId, npcName, dispositions: [{ type, intensity, reason }] }`
- `secretNotes`, `rewardClaimed`, `paused`
- `giverId`, `giverName`, `giver`
- `completed`

The current player serializer exposes active quests as `player.quests` and completed quests as `player.completedQuests`. Player payloads also include `dispositionDefinitions`, which the quest editor uses to populate NPC disposition reward controls and preview disposition reward deltas.
