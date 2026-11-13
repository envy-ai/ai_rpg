# Main Quest Implementation Plan

Implementation plan for the design in [main_quest_brainstorm.md](main_quest_brainstorm.md). Read that first; this document only covers how to build it.

## Summary

Add a core `MainQuest` model that owns a campaign spine (premise, hidden truth, antagonist, stages, roles, endings, pressure clock). Each active stage is materialized as an ordinary `Quest` linked by `questLineId`/`stageId`. Four new background prompts generate the spine, detail stages, check progress, and write the wrap-up. The base context gets a `<mainQuest>` block, plot analysis gets a pinned thread it cannot drop, and the chat page gets an offer popup plus quest-panel controls.

## Config

New `config.default.yaml` section, documented in `docs/config.md`:

```yaml
main_quest:
  # Master switch. When false, no offer popup, no start action, no prompt block.
  enabled: true
  # Number of stages in a generated spine. Never shown to the player.
  stage_count: 8
  # Eligible completed player-action turns between main-quest-check runs.
  check_interval: 3
  # When false, no pressure trackers or deadline ScheduledEvents are created.
  pressure_clock_enabled: true
```

Validation follows existing patterns: booleans must be booleans when present, `stage_count` and `check_interval` must be integers `>= 1`. Invalid values throw at config load with the key, the problem, and valid values (per `AGENTS.md`).

## Data model

### `MainQuest.js` (new)

One record per main quest, active or historical.

| Field | Notes |
|---|---|
| `id` | `mquest_...` via `IdGenerator.next('mainQuest', title)`. Add `mquest` to the ID prefix table in `docs/api/serialization.md` and to hydration's identity reservation. |
| `title` | Player-facing name. |
| `playerGoal` | Text the player typed, or `null`. |
| `premise` | Player-facing premise. |
| `hiddenTruth` | GM-private. |
| `antagonist` | `{ description, factionId?, npcId? }`. IDs are optional because the antagonist may not exist in the world yet. |
| `roles` | `[{ key, description, boundTo: { type: 'npc' \| 'faction', id } \| null, history: [...] }]` |
| `stages` | Ordered `MainQuestStage` list (below). Length = `stage_count` at generation time. |
| `currentStageIndex` | Zero-based. |
| `lockedFacts` | Strings the player has learned. Replanning must preserve them (same idea as `MysteryThread.constraints`). |
| `endings` | 2–3 `{ id, description }`. Rewritable until reached. |
| `reachedEnding` | `{ endingId \| null, description }` once completed. A non-planned ending is stored with `endingId: null`. |
| `pressure` | `{ playerFacingText, trackerIds: [], scheduledEventIds: [] }`. Empty when `pressure_clock_enabled` is false. |
| `status` | `active`, `completed`, `abandoned`. |
| `previousMainQuestId` | Set for sequels. |
| `turnsSinceProgress` | Drives prompt prominence. |
| `outcomeLog` | `[{ stageId, summary, worldMinute }]`. Actual outcomes, used for replanning and sequels. |
| `createdAt` / `updatedAt` / `completedAt` | ISO timestamps. |

`MainQuestStage`: `{ id, outline, exitCondition, detail \| null, questId \| null, status: 'pending' \| 'active' \| 'completed' \| 'skipped' }`. `detail` (hidden direction, suggested hooks, roles needed) is filled only for the current and next stage.

Static registry API matches `Tracker`/`ScheduledEvent`: `getById`, `getAll`, `getActive()` (at most one active; constructing a second active record throws), `serializeAll`, `loadAll`, `clear`.

### Offer state

Stored alongside the records so it saves with them:

```json
{
  "offer": { "state": "pending" | "declined" | "started", "followUpOf": "mquest_..." | null },
  "mainQuests": { "mquest_...": { ... } }
}
```

- New game: `{ state: "pending", followUpOf: null }`.
- Older save without the file: treated as `pending`, so it gets the popup once (decision 1).
- Completing a main quest: `{ state: "pending", followUpOf: <completed id> }`, which drives the follow-up popup.
- Abandoning: `{ state: "declined", followUpOf: null }`. No popup; the quest-panel/slash-command start action is still available.

### Persistence

- New save file `mainQuests.json`, wired through `Utils.serializeGameState()`, `writeSerializedGameState()`, `loadSerializedGameState()` (default `null` → older-save path) and hydration, next to `trackers.json`.
- Add `totalMainQuests` to save metadata counts.
- New-game reset and load call `MainQuest.clear()`.
- Delta undo is only proposed (`docs/ideas/delta_undo_implementation_plan.md`), not implemented. If it lands, add `mainQuests` to its canonical snapshot next to `trackers`.

### `Quest` changes

- Add optional persisted `questLineId` and `stageId` (both or neither; validated in the constructor, round-tripped in `toJSON`/`fromJSON`).
- `activeQuestCount` in base context excludes quests with a `questLineId`, so stage quests don't trip `soft_quest_limit`.
- `DELETE /api/player/quests/:questId` and the quest panel's Abandon on a stage quest are rejected with an error that points at the main-quest abandon action. Pause stays allowed.

### `ScheduledEvent` and `Tracker` changes

- Add optional `sourceMainQuestId` to both. Abandoning marks the main quest's pending scheduled events `skipped` and deletes its trackers. Nothing else in the world is touched (decision: antagonist is not erased).

## Prompts

All new prompts render through `base-context.xml.njk` with a new `promptType`, as plot analysis does, and run through `runAuditedBackgroundPrompt` with `runInBackground: true`, the stale-token pattern used by `perform_runPlotAnalysisPrompt`, and the standard XML parse-retry/correction loop. Each parser validates before any mutation.

| Prompt (`prompts/_includes/`) | When | Output |
|---|---|---|
| `main-quest-generate.njk` | Start / follow-up | Title, premise, hidden truth, antagonist, roles, `stage_count` stage outlines with exit conditions, 2–3 endings, initial pressure text. Inputs: optional `playerGoal`, mode (`new` / `sequel` / `auto`), previous main quest record for sequels, plus normal base context (plot summary, scene summaries, factions, NPCs) so mid-campaign starts build on history. `auto` must output which mode it chose. |
| `main-quest-stage.njk` | Stage starts | Detail for current and next stage, role bindings to existing NPCs/factions where possible, and a quest summary/giver. The summary is passed through the existing quest-generate path (see below). |
| `main-quest-check.njk` | Every `check_interval` eligible turns, and immediately after a stage quest completes | One of: no change; stage complete (with outcome summary and new locked facts); recast role; replan later stages/endings; ending reached (planned id or new description). |
| `main-quest-wrapup.njk` | Ending reached | Short player-facing wrap-up prose, stored as a visible chat entry of new type `main-quest-wrapup`. |

Tool access:

- `main-quest-generate` and `main-quest-stage` may call `addTracker` and `scheduleEvent` (the same narrow set plot analysis has) only when `pressure_clock_enabled` is true. Created ids are recorded on the main quest and tagged with `sourceMainQuestId`.
- `main-quest-check` gets the same tools for advancing pressure.

Stage quests:

- Factor the quest-generate render/parse/validate portion of the `received_quest` handler (`Events.js`) into a helper that can either create an offer (current behaviour) or add the quest directly. Stage quests use the direct path: the player already opted in, so they skip `QuestConfirmationManager`.
- Stage quest level: `originLocationLevel` is the player's current level at stage start rather than the location level, so late stages track progression (brainstorm risk 3). `relativeLevel` comes from generation as usual.

TinyBrain: add matching families in `TinyBrainPromptFamilies.js` for `main-quest-generate` and `main-quest-check`, the two prompts whose output shape small models are most likely to get wrong. Stage and wrap-up can use the standard prompts at first.

## Base context and plot analysis

### `<mainQuest>` block

Rendered in `base-context.xml.njk` after `<plotExpander>`, only when an active main quest exists and `promptType` is not one of the main-quest prompts (those render their own fuller view):

```xml
<mainQuest prominence="low|normal|high">
  <title>…</title>
  <premise>…</premise>
  <currentStage>…player-facing objective text…</currentStage>
  <hiddenDirection>…GM-private stage detail…</hiddenDirection>
  <lockedFacts>…</lockedFacts>
  <pressure>…vague player-facing text…</pressure>
  <instructions>…offer hooks; never force the player toward the main quest…</instructions>
</mainQuest>
```

- `prominence` comes from `turnsSinceProgress`: low right after progress, high after a long stretch without it. Thresholds live in code first; make them config only if tuning needs it.
- `hiddenTruth` and future stage outlines are not included in ordinary prompts, only in the main-quest prompts.
- `prepareBasePromptContext()` supplies `mainQuest`; document it in `docs/server_llm_notes.md`.

### Plot analysis pin

- The plot-analysis prompt receives the main quest's title and current stage, with an instruction that it is a fixed thread.
- After parsing, `buildPlotAnalysisStateFromResponse` result is post-processed server-side: if no thread is marked as the main quest, one is inserted with `pinned: true, source: "main-quest"`, so the pin doesn't depend on the model. `Globals.#normalizePlotAnalysisThreads` accepts the two new fields.
- The `plot-analysis-blurb.njk` shows pinned threads first.

### Mystery caps

The hidden truth lives on `MainQuest`, not in a `MysteryThread`, so it uses no mystery slots. Mystery boxes the model creates about the main quest still count toward caps as usual.

### Faction housekeeping

When the antagonist role is bound to a faction, the faction-housekeeping context include (`prompts/_includes/faction-housekeeping-context.njk`) gets that faction's main-quest role and current pressure, so its plans follow the storyline. After abandoning or completing, this extra context stops; the faction keeps its existing plans and continues as normal world state.

## Server

### Service

`MainQuestService.js` (new) owns lifecycle and keeps `api.js` thin:

- `start({ goal, mode })`: rejects if `main_quest.enabled` is false or a main quest is active; runs generate → stage 1 → sets offer `started`.
- `runCheck({ reason })`: runs `main-quest-check` and applies its result (advance stage → `main-quest-stage` for the next one; replan; recast; ending → wrap-up).
- `abandon()`: marks abandoned, removes the stage quest from the player, stops pressure (above), sets offer `declined`.
- `declineOffer()`.
- Scheduling: `scheduleMainQuestCheck` hooked next to `schedulePlotAnalysisPrompt` at the end of completed normal player-action turns, with its own counter persisted in save metadata as `mainQuestCheckTurnCounter`. Quest-completion processing calls `runCheck({ reason: 'stage-quest-completed' })` when the completed quest has a `questLineId`.

Failures are recorded with `PromptAuditLog.recordFailure` and surfaced to the client with their original error and stack via the existing persistent PageFeedback path; no silent fallback. A failed start leaves the offer `pending`.

### API (`docs/api/main_quest.md`, new)

| Endpoint | Purpose |
|---|---|
| `GET /api/main-quest` | `{ enabled, offer, active: playerSafeView \| null, history: [...] }`. The player-safe view excludes hidden truth, future stages, endings and stage count. |
| `POST /api/main-quest/start` | `{ goal?, mode?: 'new' \| 'sequel' \| 'auto' }`. Runs as a background job with prompt-progress feedback; returns a job id. |
| `POST /api/main-quest/decline` | Sets offer `declined`. |
| `POST /api/main-quest/abandon` | Abandons the active main quest. |

State changes are pushed through `RealtimeHub` so every client refreshes the quest panel and the popup closes everywhere.

### Slash command

`slashcommands/main_quest.js`: `/mainquest start [goal]`, `/mainquest abandon`, `/mainquest check` (force a check), `/mainquest status` (developer view including hidden fields). Add to `docs/slash_commands.md` and `docs/slashcommands/`.

## Client

### Offer popup

- New modal in `views/index.njk`, following the `questDecisionReminderModal` markup and the shared modal/submit-shortcut helpers.
- Shown when `GET /api/main-quest` returns `enabled` and `offer.state === "pending"`, and only once the page is idle: the opening scene has rendered, no deferred intro or pending ability selection, no turn or quest-offer decision in progress.
- Start popup: title, short explanation, optional goal field, **Start now** / **Not now**.
- Follow-up popup (when `offer.followUpOf` is set): same, plus **Sequel** / **Something new** / **Let the story decide** choice.
- No stage count anywhere.

### Quest panel

- A main quest card pinned above active quests: title, premise, current stage text, pressure text, and **Abandon main quest** (confirmation dialog explaining the antagonist stays in the world).
- The stage quest card shows a "Main quest" badge, and its Abandon control is replaced by a pointer to the main quest card.
- When no main quest is active and `enabled` is true: a **Start main quest** button that opens the same popup.
- Completed and abandoned main quests appear in a history section with the reached ending.

## Tests

- `tests/main_quest.model.test.js`: construction validation, single-active rule, serialize/load round trip, older-save default offer state.
- `tests/main_quest.prompts.test.js`: parser validation and correction-loop retries for each prompt, `auto` mode reporting its choice.
- `tests/main_quest.service.test.js`: start, stage advance, replan preserving locked facts, recast after NPC death, planned and unplanned endings, follow-up offer, abandon removing only main-quest trackers/scheduled events, pressure disabled by config.
- `tests/quest.questline_fields.test.js`: `questLineId`/`stageId` round trip, soft-quest-limit exclusion, stage quest delete rejected.
- `tests/plot_analysis.main_quest_pin.test.js`: pin inserted when the model omits it, not duplicated when present.
- `tests/base_context_main_quest.test.js`: block rendering, prominence, hidden fields excluded from ordinary prompts.
- Playwright: popup appears after intro and not again after reload; older save gets popup once; follow-up popup choices; abandon confirmation.

## Docs to update

`docs/classes/MainQuest.md`, `docs/classes/MainQuestService.md` (new), `docs/api/main_quest.md` (new), `docs/classes/Quest.md`, `docs/classes/Tracker.md`, `docs/classes/ScheduledEvent.md`, `docs/api/serialization.md`, `docs/config.md`, `docs/server_llm_notes.md`, `docs/slash_commands.md`, `docs/ui/chat_interface.md`, `docs/README.md`.

## Phases

1. **Model and persistence.** `MainQuest`, config, save file, `Quest` link fields, `sourceMainQuestId`. Tests for all of it. No prompts yet.
2. **Generation and stage quests.** `main-quest-generate`, `main-quest-stage`, quest-generate helper refactor, `MainQuestService.start`, API start/decline, slash command `start`/`status`.
3. **Prompt integration.** `<mainQuest>` block with prominence, plot-analysis pin, soft-limit exclusion, faction-housekeeping context.
4. **Progress.** `main-quest-check`, scheduling, stage advance, replan, recast, endings, wrap-up, follow-up offer.
5. **Pressure.** Tracker/ScheduledEvent creation and advancement, `pressure_clock_enabled`, abandon cleanup.
6. **Client.** Offer popup, follow-up popup, quest panel card, history, abandon flow, realtime refresh.
7. **TinyBrain** families for generate and check, then playtest a full main quest on both prompt paths and tune prominence thresholds.

Phases 1–3 give a playable main quest that can be started and shows up in prompts but never advances by itself; it's a reasonable first checkpoint for playtesting how prominent it feels.
