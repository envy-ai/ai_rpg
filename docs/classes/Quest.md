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
- `rewardClaimed`: prevents duplicate completion reward processing.
- `giverId`, `giverName`: optional giver reference and display label.
- `paused`: excludes the quest from quest-check prompts while keeping it on the player.

## Construction
- `new Quest(options)` validates `name`, assigns/registers a quest id, normalizes objectives and rewards, stores giver metadata, and indexes the instance by id and sanitized name.
- Objective inputs may be `QuestObjective` instances, strings, or objects with `description`, `optional`, and `completed`. Object objective ids are not preserved through the constructor path; `fromJSON()` hydrates objective ids after construction.
- `rewardItems` accepts an array of strings or one string. Blank entries are discarded.
- `rewardCurrency` and `rewardXp` are converted with `Number(...)`, floored, and kept at or above zero; non-finite values become `0`.
- `rewardFactionReputation` accepts an object, array, or `Map`. Keys must be non-empty strings and values must be finite integers. Array entries use `factionId` or `name` plus `delta`, `amount`, or `value`.
- `rewardNpcDispositions` accepts an array. Each entry must identify an NPC by `npcId`/`id` or `npcName`/`name`/`npc`, and may provide dispositions as an array or object map. Disposition types must be non-empty strings, intensities must be non-zero integers, and reasons are optional trimmed strings.
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
- `fromJSON(data)`: validates saved quest data, constructs a `Quest`, then replaces the objective list with `QuestObjective.fromJSON(...)` results. Invalid objectives are skipped with a console warning.
- `filterActiveQuests(quests, { includePaused })`: requires an array and filters out completed quests; paused quests are excluded unless `includePaused` is true.
- `normalizeRewardNpcDispositions(value)`: validates and copies NPC disposition reward entries into the stored shape.

## Internal Class: QuestObjective
- `new QuestObjective(description, optional, id)`: validates a non-empty description, stores `optional`, assigns/registers a compact `obj_n` id when needed, and starts with `completed = false`.
- `static generateId()`: generates compact objective ids.
- `toJSON()`: returns `{ id, description, completed, optional }`.
- `fromJSON(data)`: constructs an objective from saved data and restores `completed`.
- `get id()`: returns objective id.

## Player And Persistence
- `Player` stores quests in its private `#quests` array. `addQuest()` appends, `removeQuest(id)` deletes from that array, and `getQuestByIndex(index)` uses zero-based canonical array order.
- `Player.getCurrentQuests()` returns incomplete quests and does not filter paused quests. `Player.getCompletedQuests()` returns completed quests from the same array.
- `serializeNpcForClient()` exposes active quests as `player.quests` and completed quests as `player.completedQuests`; both are derived from the same stored quest list.
- `Player.toJSON()` persists all quests through `quest.toJSON()`. `Player.fromJSON()` restores them with `Quest.fromJSON()` and skips invalid quest entries with a console warning.
- Game saves write players to `allPlayers.json` via `Utils.serializeGameState()` and `Utils.writeSerializedGameState()`. There is no separate quest save file.

## Event And Reward Flow
- Quest generation and objective completion are driven by `Events`, not by the `Quest` constructor.
- `Events.runQuestChecks()` uses `Quest.filterActiveQuests(player.currentQuests, { includePaused: false })`, builds one-based prompt indices from the player's canonical quest order, renders `quest-check`, and parses completed objective XML back into one-based quest/objective entries.
- `Events.processQuestObjectiveCompletionEntries()` resolves quests by prompt index, marks objectives complete, records completion metadata, and processes rewards once per completed quest by setting `rewardClaimed = true`.
- XP rewards call `player.addExperience(...)`. Faction reputation rewards resolve stored faction ids and update player faction standings. NPC disposition rewards resolve target NPCs, convert intensity through configured disposition ranges, apply first-impression scaling when applicable, and append `dispositionChanges`.
- Reward item names and reward currency are part of quest reward summaries/prose. The active completion path does not instantiate reward items into inventory or adjust player currency.

## API And UI Use
- Generated quest offers pass through `QuestConfirmationManager`, emit `quest_confirmation_request`, and enter the player's quest list only when accepted through `/api/quests/confirm`.
- `/api/quest/edit` mutates an existing quest on the current player. It can update text fields, rewards, objectives, `paused`, `rewardClaimed`, and `giverName`; it does not create quests or grant completion rewards.
- `DELETE /api/player/quests/:questId` removes a quest from the current player's stored quest list and does not move it to completed quests.
- The quest panel reads `/api/player`, renders active and completed quest sections, supports edit/pause/abandon controls for active quests, and displays reward summaries. NPC disposition reward reasons are stored for reward application but omitted from quest-list disposition pills.
- Chat tool field updates include quest and objective targets from the player's current and completed quests, with `rewardItems`, `rewardFactionReputation`, `rewardNpcDispositions`, `rewardClaimed`, `paused`, `completed`, and `optional` among the allowed persisted fields.

## Operational Notes
- `Quest.QuestObjective` is assigned for external access to the helper class.
- The class uses `SanitizedStringMap` for case-insensitive name lookups.
- Static indexes are populated when a quest is constructed. Directly mutating `quest.name` after construction does not re-key `Quest.getByName(...)`.
