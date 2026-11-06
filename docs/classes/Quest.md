# Quest

## Purpose
Represents a player-owned quest with objectives, reward metadata, giver metadata, pause/reward flags, and derived completion state. The class also maintains process-local indexes for lookup by id and sanitized name.

## Key State
- `#id`: first-three-name-word `quest_...` ID unless a non-empty id is supplied.
- `name`: required non-empty display name.
- `description`, `secretNotes`: persisted quest text. `secretNotes` are included in quest-check prompts.
- `objectives`: array of `QuestObjective` instances.
- `rewardItems`: array of `{ name, description }` physical-item reward descriptors. Names are required; descriptions are stored separately so generation prose cannot become part of the canonical item name.
- `rewardCurrency`, `rewardXp`: non-negative integer reward amounts.
- `originLocationLevel`: recorded positive integer location base level at generation/offer time. `relativeLevel` is a signed integer difficulty offset; derived read-only `level = originLocationLevel + relativeLevel` must be positive. Travel, player level changes, offer acceptance, and later location edits do not change the recorded anchor. Regenerating an existing quest preserves its anchor while allowing a new validated offset.
- `rewardXp` is the authored base XP value. Completion passes `ceil(rewardXp * level / completingPlayer.level)` to ordinary `Player.addExperience`, which then applies its existing experience scaling and party sharing. Completion reward lines and `xp` report the actual scaled player award; `baseRewardXp`, `experienceAwardInput`, and `questLevel` preserve the calculation inputs in structured award records.
- `rewardFactionReputation`: object map of `factionId -> integerDelta`; zero deltas are omitted.
- `rewardNpcDispositions`: array of `{ npcId, npcName, dispositions: [{ type, intensity, reason }] }`.
- `rewardBenefits`: typed mechanical non-material rewards. Registered shapes are `{ id, type: "party-member", targetId, label, description?, role? }` and exact directed route knowledge `{ id: "knowledge-route:<sourceLocationId>:<exitId>", type: "knowledge", subtype: "route", sourceLocationId, targetId: exitId, destinationLocationId, label, description? }`.
- `rewardNotes`: trimmed narrative-only promises or benefits. Notes are displayed but never treated as proof of a mechanical grant.
- `appliedRewardBenefitIds`: stable ids recorded immediately after each successful benefit mutation so partial retries do not repeat it.
- `rewardNotesPresented`: persisted presentation flag set after direct reward application succeeds.
- `rewardClaimed`: prevents duplicate completion reward processing. A completed quest can retain `false` when reward application fails, so objective state and reward-delivery state remain independent.
- `giverId`, `giverName`: optional giver reference and display label.
- `paused`: excludes the quest from quest-check prompts while keeping it on the player.

## Construction
- `new Quest(options)` requires explicit `originLocationLevel` and `relativeLevel`, validates `name`, assigns/registers a quest id, normalizes objectives and rewards, stores giver metadata, and indexes the instance by id and sanitized name. Saved legacy data receives its deterministic level metadata through `fromJSON` before construction.
- Objective inputs may be `QuestObjective` instances, strings, or objects with `description`, `optional`, and `completed`. Supplied object objective IDs are preserved through construction and hydration.
- `rewardItems` is stored canonically as `{ name, description }` objects. It also accepts legacy string entries (and a single string) when loading older saves, converting each to `{ name, description: "" }`; blank legacy strings are discarded. Object entries require a non-empty `name`; `description` is trimmed and may be empty for legacy/manual data.
- `rewardCurrency` retains its existing numeric normalization. `rewardXp` and level fields require safe whole integers, with non-negative XP, positive origin level, and positive derived level; no rounding or clamping is applied. Optional null/omitted/empty/whitespace scalar values mean omission; explicit zero is preserved. `normalizeInteger` and `normalizeLevelData` share this validation between model, API, offer, and quest boundaries.
- `rewardFactionReputation` accepts an object, array, or `Map`. Keys must be non-empty strings and values must be finite integers. Array entries use `factionId` or `name` plus `delta`, `amount`, or `value`.
- `rewardNpcDispositions` accepts an array. Each entry must identify an NPC by `npcId`/`id` or `npcName`/`name`/`npc`, and may provide dispositions as an array or object map. Disposition types must be non-empty strings, intensities must be non-zero integers, and reasons are optional trimmed strings.
- `rewardBenefits` is normalized through `QuestRewardBenefitRegistry`. Unknown types, blank ids, duplicate ids, missing required typed fields, and non-array values throw.
- `rewardNotes` must be an array of non-empty strings; values are trimmed and exact duplicates are removed.
- A supplied `giver` object sets `giverId` and may replace `giverName`; otherwise `giverId`/`giverName` are stored from scalar options.

## Instance API
- `get id()`: returns quest id.
- `originLocationLevel` and `level` are read-only getters. Assigning `relativeLevel` validates the result against the recorded anchor before mutation.
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
- `normalizeSavedLevelData(data)`: migrates an older saved quest without recorded level metadata to origin level `1`, offset `0`, and level `1`. A positive saved XP value is preserved; missing/zero XP becomes `25 * max(1, required-objective count)`. This deterministic migration also applies to saved pending offers, needs no LLM, preserves IDs and claimed rewards, and is stable across subsequent saves/loads. Explicit zero on an already-leveled quest stays zero.
- `filterActiveQuests(quests, { includePaused })`: requires an array and filters out completed quests; paused quests are excluded unless `includePaused` is true.
- `normalizeRewardNpcDispositions(value)`: validates and copies NPC disposition reward entries into the stored shape.
- `normalizeRewardBenefits(value, context)`, `normalizeRewardNotes(value)`, and `normalizeAppliedRewardBenefitIds(value)` validate/copy the new persisted reward state.

## Internal Class: QuestObjective
- `new QuestObjective(description, optional, id)`: validates a non-empty description, stores `optional`, assigns/registers a first-three-description-word `obj_...` ID when needed, and starts with `completed = false`.
- `static generateId(description)`: allocates an objective ID through the shared named allocator.
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
- Generated XML tolerates completely empty `<item>` reward placeholders as no items; populated or partial entries still require both a name and a description. Quest parsing and reward-target validation run before mutation inside the existing completion retry loop, which sends the specific failure and rejected response back for correction. Successful validation supplies the draft used by the later offer/update path; exhausted retries propagate the original error.
- Newly generated responses require populated `<relativeLevel>` and `<rewards><xp>`. Both are strict integers; XP must be non-negative. Missing, blank, fractional, unit-suffixed, negative-XP, or non-positive derived-level responses enter that same correction loop before offer creation or existing-quest mutation. Existing quests use their recorded origin for this validation, and prompts expose origin, offset, level, and base XP.
- Quest generation uses 25 base XP per required objective (minimum one objective) as authoring guidance, allowing deliberate adjustments and explicit zero for intentionally unrewarded quests; this baseline is not an enforced XP formula.
- `Events.runQuestChecks()` uses `Quest.filterActiveQuests(player.currentQuests, { includePaused: false })`, builds one-based prompt indices from the player's canonical quest order, renders `quest-check`, and parses completed objective XML back into one-based quest/objective entries.
- `Events.processQuestObjectiveCompletionEntries()` resolves quests by prompt index and commits objective completion before attempting rewards. A reward-application exception does not reject or roll back the objective update; it leaves `rewardClaimed = false` and records a structured `QUEST_REWARD_APPLICATION_FAILED` entry in `context.questCompletionErrors` with the cause and stack. A later presentation-only failure records `QUEST_REWARD_PRESENTATION_FAILED` but retains the successfully claimed reward state.
- Typed benefits run before conventional rewards. Successful benefit ids persist immediately; a later failure leaves only the remaining benefits pending. The registered `party-member` handler calls the authoritative party API and never transfers the NPC's inventory or equipment. The `knowledge/route` handler validates and reveals one exact outgoing hidden exit through the shared discovery helper without visiting/expanding its destination, revealing a reverse edge, or granting fast travel; an independently revealed matching edge is an idempotent success. Configured reward items are generated directly into the player's inventory with their exact reward `name` and separate `description` supplied as generation seeds, persisted quest/reward-index metadata, and stack merging disabled. Currency calls `player.adjustCurrency(...)`; XP calls `player.addExperience(...)`; faction reputation and NPC dispositions use their authoritative state helpers. `rewardClaimed` is set only after the complete reward flow succeeds. Completed quests are excluded from later automatic quest checks, so pending rewards use the explicit retry endpoint.
- Quest reward prose is presentation output for already-applied structured rewards. It is not passed back through ordinary event checks, preventing narrated coins, items, XP, reputation, dispositions, or incidental status language from being applied a second time.

## API And UI Use
- Generated quest offers pass through `QuestConfirmationManager` as plain, unregistered candidates. They appear as durable inline `quest-offer` chat entries on every client and enter the player's canonical quest list only when accepted through `/api/quests/confirm`.
- `/api/quest/edit` mutates an existing quest on the current player. It can update text fields, conventional rewards, typed benefits, reward notes, objectives, `paused`, `rewardClaimed`, and `giverName`; it does not create quests or grant completion rewards. Applied benefit ids cannot be removed or retargeted.
- `POST /api/quests/:questId/retry-rewards` explicitly retries a completed quest whose `rewardClaimed` remains false. The completed-quest card exposes this as **Retry Pending Rewards** and shows stack-bearing failures in the chat error popup.
- `DELETE /api/player/quests/:questId` removes a quest from the current player's stored quest list and does not move it to completed quests.
- The quest panel reads `/api/player`, renders active and completed quest sections, supports edit/pause/abandon controls for active quests, provides separate name and description fields for physical item rewards, structured party-member and authoritative route-knowledge reward editing, plus narrative-note editing, and displays all reward summaries. Route editing uses only server-listed hidden exits and locks applied benefit identity; an applied completed route reward provides **View route** to open the shared map inspector. NPC disposition reward reasons are stored for reward application but omitted from quest-list disposition pills.
- Chat responses expose `questCompletionErrors` without converting the otherwise-successful turn into a top-level API error. The chat client shows each pending-reward error and its backtrace in the existing error popup while retaining the objective-completion result.
- Chat tool field updates include quest and objective targets from the player's current and completed quests, with `rewardItems`, `rewardFactionReputation`, `rewardNpcDispositions`, validated `rewardBenefits`, `rewardNotes`, `rewardClaimed`, `paused`, `completed`, and `optional` among the allowed persisted fields.
- `createQuest({ summary, giver? })` is a mutation-capable chat tool for generic prompts and scheduled-event resolution. Parser-only housekeeping can still create quests by returning `<quests>` XML, which is converted afterward into `createQuest` executor calls. The executor feeds the supplied summary/giver into the same `received_quest` event handler used by event checks, including the quest-generation prompt, duplicate/update handling, reward normalization, and player confirmation for new quests.
- A tool-created new quest returns structured status `pending` plus its confirmation id and tells the model not to retry. The eventual decision happens outside the originating model turn. Existing-quest updates still return `success`; a generation path that produces no accepted, updated, or pending quest returns `not_created`.

## Operational Notes
- Implementation plan: keep level/XP validation in `Quest`; capture and validate generation metadata before mutation; persist candidates and accepted quests; share the native player XP scaler for accurate reward reporting; expose the fields to prompt/API/UI consumers; verify generation correction, migration, anchor stability, and completion scaling.
- `Quest.QuestObjective` is assigned for external access to the helper class.
- The class uses `SanitizedStringMap` for case-insensitive name lookups.
- Static indexes are populated when a quest is constructed. Directly mutating `quest.name` after construction does not re-key `Quest.getByName(...)`.

## Shared Play display collection

Play's active and completed quest roots compose CollectionView with per-card
listener ownership. Native details chrome composes `createDisclosure`; reward,
objective, level, paused and applied-route content remains formatted by the quest
adapter. Cards still rebuild on refresh: updated time, created time and reverse
original-index tie breaking retain the existing order; only the first active card
starts open, and completed cards start closed. No remembered-open or keyed-node
policy is added.

Entry removal releases Edit/Pause/Resume/Mark Complete/Abandon/Retry Rewards and
View route listeners. Existing confirmations, exact IDs/endpoints/client IDs,
button-local pending state and post-completion refreshes remain host-owned.
Replacing a card does not cancel its committed operation. Final unload prevents
obsolete refresh/modal/button writes and releases collections; cached pagehide
keeps them live. Original parse/Error/server backtraces from touched operations use
persistent PageFeedback. The editor's late submit continuation also checks final
ownership before clearing its destroyed row controllers.
