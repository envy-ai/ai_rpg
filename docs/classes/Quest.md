# Quest

## Purpose
Represents a player-owned quest with objectives, reward metadata, giver metadata, pause/reward flags, and derived completion state. The class also maintains process-local indexes for lookup by id and sanitized name.

## Key State
- `#id`: compact `quest_n` id unless a non-empty id is supplied.
- `name`: required non-empty display name.
- `description`, `secretNotes`: persisted quest text. `secretNotes` are included in quest-check prompts.
- `objectives`: array of `QuestObjective` instances.
- `rewardItems`: array of non-empty item reward labels.
- `rewardCurrency`, `rewardXp`: non-negative integer reward amounts.
- `rewardFactionReputation`: object map of `factionId -> integerDelta`; zero deltas are omitted.
- `rewardNpcDispositions`: array of `{ npcId, npcName, dispositions: [{ type, intensity, reason }] }`.
- `rewardBenefits`: typed mechanical non-material rewards. The initial registered shape is `{ id, type: "party-member", targetId, label, description?, role? }`.
- `rewardNotes`: trimmed narrative-only promises or benefits. Notes are displayed but never treated as proof of a mechanical grant.
- `appliedRewardBenefitIds`: stable ids recorded immediately after each successful benefit mutation so partial retries do not repeat it.
- `rewardNotesPresented`: persisted presentation flag set after direct reward application succeeds.
- `rewardClaimed`: prevents duplicate completion reward processing. A completed quest can retain `false` when reward application fails, so objective state and reward-delivery state remain independent.
- `giverId`, `giverName`: optional giver reference and display label.
- `paused`: excludes the quest from quest-check prompts while keeping it on the player.

## Construction
- `new Quest(options)` validates `name`, assigns/registers a quest id, normalizes objectives and rewards, stores giver metadata, and indexes the instance by id and sanitized name.
- Objective inputs may be `QuestObjective` instances, strings, or objects with `description`, `optional`, and `completed`. Object objective ids are not preserved through the constructor path; `fromJSON()` hydrates objective ids after construction.
- `rewardItems` accepts an array of strings or one string. Blank entries are discarded.
- `rewardCurrency` and `rewardXp` are converted with `Number(...)`, floored, and kept at or above zero; non-finite values become `0`.
- `rewardFactionReputation` accepts an object, array, or `Map`. Keys must be non-empty strings and values must be finite integers. Array entries use `factionId` or `name` plus `delta`, `amount`, or `value`.
- `rewardNpcDispositions` accepts an array. Each entry must identify an NPC by `npcId`/`id` or `npcName`/`name`/`npc`, and may provide dispositions as an array or object map. Disposition types must be non-empty strings, intensities must be non-zero integers, and reasons are optional trimmed strings.
- `rewardBenefits` is normalized through `QuestRewardBenefitRegistry`. Unknown types, blank ids, duplicate ids, missing required typed fields, and non-array values throw.
- `rewardNotes` must be an array of non-empty strings; values are trimmed and exact duplicates are removed.
- A supplied `giver` object sets `giverId` and may replace `giverName`; otherwise `giverId`/`giverName` are stored from scalar options.

## Instance API
- `get id()`: returns quest id.
- `get giver()`: resolves `giverId` via `Player.getById`; `giverName` alone does not resolve an actor.
- `set giver(player)`: stores `player.id` and `player.name`, or clears both giver fields for falsey/non-object values.
- `get completed()`: returns true when every objective is completed or optional. A quest with no objectives is complete because `Array.prototype.every()` returns true for an empty array.
- `addObjective(description, optional)`: appends a `QuestObjective`.
- `completeObjective(index)`: marks the zero-based objective complete or throws on an invalid index.
- `toJSON()`: serializes persisted fields plus `giver` as a display alias for `giverName` and `completed` as derived state.

## Static API
- `getByName(name)`: sanitized, case/punctuation-insensitive lookup from the construction-time name index.
- `getById(id)`: trimmed id lookup from the construction-time id index.
- `clear()`: clears the static quest name/id indexes. New-game reset and save hydration call this so quests from a previous game cannot resolve by stale id or name.
- `fromJSON(data)`: validates saved quest data, constructs a `Quest`, then replaces the objective list with `QuestObjective.fromJSON(...)` results. Invalid objectives are skipped with a console warning.
- `filterActiveQuests(quests, { includePaused })`: requires an array and filters out completed quests; paused quests are excluded unless `includePaused` is true.
- `normalizeRewardNpcDispositions(value)`: validates and copies NPC disposition reward entries into the stored shape.
- `normalizeRewardBenefits(value, context)`, `normalizeRewardNotes(value)`, and `normalizeAppliedRewardBenefitIds(value)` validate/copy the new persisted reward state.

## Internal Class: QuestObjective
- `new QuestObjective(description, optional, id)`: validates a non-empty description, stores `optional`, assigns/registers a compact `obj_n` id when needed, and starts with `completed = false`.
- `static generateId()`: generates compact objective ids.
- `toJSON()`: returns `{ id, description, completed, optional }`.
- `fromJSON(data)`: constructs an objective from saved data and restores `completed`.
- `get id()`: returns objective id.

## Player And Persistence
- `Player` stores quests in its private `#quests` array. `addQuest()` appends, `removeQuest(id)` deletes from that array, and `getQuestByIndex(index)` uses zero-based canonical array order.
- `Player.getCurrentQuests()` returns incomplete quests and does not filter paused quests. `Player.getCompletedQuests()` returns completed quests from the same array.
- Base-context prompts expose the count of these incomplete quests as `activeQuestCount`, together with the root-level `soft_quest_limit` configuration value as `softQuestLimit`; detailed quest entries may still be omitted for specialized prompt types. Standard and TinyBrain player-action first-draft instructions add guidance to avoid unsolicited new quest-like tasks only when `activeQuestCount > soft_quest_limit`; equality does not trigger it.
- `serializeNpcForClient()` exposes active quests as `player.quests` and completed quests as `player.completedQuests`; both are derived from the same stored quest list.
- `Player.toJSON()` persists all quests through `quest.toJSON()`. `Player.fromJSON()` restores them with `Quest.fromJSON()` and skips invalid quest entries with a console warning.
- Game saves write players to `allPlayers.json` via `Utils.serializeGameState()` and `Utils.writeSerializedGameState()`. There is no separate quest save file.

## Event And Reward Flow
- Quest generation and objective completion are driven by `Events`, not by the `Quest` constructor.
- `Events.runQuestChecks()` uses `Quest.filterActiveQuests(player.currentQuests, { includePaused: false })`, builds one-based prompt indices from the player's canonical quest order, renders `quest-check`, and parses completed objective XML back into one-based quest/objective entries.
- `Events.processQuestObjectiveCompletionEntries()` resolves quests by prompt index and commits objective completion before attempting rewards. A reward-application exception does not reject or roll back the objective update; it leaves `rewardClaimed = false` and records a structured `QUEST_REWARD_APPLICATION_FAILED` entry in `context.questCompletionErrors` with the cause and stack. A later presentation-only failure records `QUEST_REWARD_PRESENTATION_FAILED` but retains the successfully claimed reward state.
- Typed benefits run before conventional rewards. Successful benefit ids persist immediately; a later failure leaves only the remaining benefits pending. The registered `party-member` handler calls the authoritative party API and never transfers the NPC's inventory or equipment. Configured reward items are generated directly into the player's inventory with persisted quest/reward-index metadata and stack merging disabled. Currency calls `player.adjustCurrency(...)`; XP calls `player.addExperience(...)`; faction reputation and NPC dispositions use their authoritative state helpers. `rewardClaimed` is set only after the complete reward flow succeeds. Completed quests are excluded from later automatic quest checks, so pending rewards use the explicit retry endpoint.
- Quest reward prose is presentation output for already-applied structured rewards. It is not passed back through ordinary event checks, preventing narrated coins, items, XP, reputation, dispositions, or incidental status language from being applied a second time.

## API And UI Use
- Generated quest offers pass through `QuestConfirmationManager`, emit `quest_confirmation_request`, and enter the player's quest list only when accepted through `/api/quests/confirm`.
- `/api/quest/edit` mutates an existing quest on the current player. It can update text fields, conventional rewards, typed benefits, reward notes, objectives, `paused`, `rewardClaimed`, and `giverName`; it does not create quests or grant completion rewards. Applied benefit ids cannot be removed or retargeted.
- `POST /api/quests/:questId/retry-rewards` explicitly retries a completed quest whose `rewardClaimed` remains false. The completed-quest card exposes this as **Retry Pending Rewards** and shows stack-bearing failures in the chat error popup.
- `DELETE /api/player/quests/:questId` removes a quest from the current player's stored quest list and does not move it to completed quests.
- The quest panel reads `/api/player`, renders active and completed quest sections, supports edit/pause/abandon controls for active quests, provides structured party-member reward editing plus narrative-note editing, and displays all reward summaries. NPC disposition reward reasons are stored for reward application but omitted from quest-list disposition pills.
- Chat responses expose `questCompletionErrors` without converting the otherwise-successful turn into a top-level API error. The chat client shows each pending-reward error and its backtrace in the existing error popup while retaining the objective-completion result.
- Chat tool field updates include quest and objective targets from the player's current and completed quests, with `rewardItems`, `rewardFactionReputation`, `rewardNpcDispositions`, validated `rewardBenefits`, `rewardNotes`, `rewardClaimed`, `paused`, `completed`, and `optional` among the allowed persisted fields.
- `createQuest({ summary, giver? })` is a mutation-capable chat tool for generic prompts and scheduled-event resolution. Parser-only housekeeping can still create quests by returning `<quests>` XML, which is converted afterward into `createQuest` executor calls. The executor feeds the supplied summary/giver into the same `received_quest` event handler used by event checks, including the quest-generation prompt, duplicate/update handling, reward normalization, and player confirmation for new quests.
- When the player declines a tool-created quest offer, the event handler records that decision in `declinedQuests`. The tool returns the terminal structured status `declined`, the declined quest identity, and an instruction not to retry the resolved request. A generation path that produces no accepted, updated, or declined quest still returns `not_created`.

## Operational Notes
- `Quest.QuestObjective` is assigned for external access to the helper class.
- The class uses `SanitizedStringMap` for case-insensitive name lookups.
- Static indexes are populated when a quest is constructed. Directly mutating `quest.name` after construction does not re-key `Quest.getByName(...)`.
