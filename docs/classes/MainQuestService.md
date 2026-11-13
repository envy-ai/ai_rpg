# MainQuestService

`MainQuestService.js` holds the main quest config, prompt parsers, prompt views and the lifecycle runtime. `api.js` creates the runtime with server dependencies (`mainQuestRuntime`).

## Config

`resolveConfig(config)` reads [`main_quest`](../config.md#main-quest): `enabled`, `stage_count`, `full_check_interval`, `pressure_clock_enabled`. Invalid values throw with the key and valid range.

## Prompts

All four prompts render through `base-context.xml.njk` (whole story, cached prefix) with these `promptType`s and includes:

| promptType | Include | Output root | Parser |
|---|---|---|---|
| `main-quest-generate` | `main-quest-generate.njk` | `<mainQuest>` | `parseGenerateResponse` |
| `main-quest-stage` | `main-quest-stage.njk` | `<mainQuestStage>` | `parseStageResponse` |
| `main-quest-check` | `main-quest-check.njk` | `<mainQuestCheck>` | `parseCheckResponse` |
| `main-quest-wrapup` | `main-quest-wrapup.njk` | `<mainQuestWrapUp>` | `parseWrapupResponse` |

`main-quest-state.njk` renders the full GM view (`buildFullPromptView`) for the stage, check and wrap-up prompts and for a sequel's predecessor. `main-quest-pressure-schema.njk` is the shared `<pressure>` block; its `<deadline>` is only offered when the pressure clock is enabled and is ignored otherwise.

Parser rules (failures go back through the correction loop):
- Generate: exactly `stage_count` stages; 2–3 endings; antagonist and role bindings must name existing factions/NPCs (living NPCs only) or be empty; `auto` mode must report `new` or `sequel` in `<modeChosen>`.
- Stage: `<nextStage>` required exactly when another stage follows; binding roles must exist; `<prose>` and `<quest><summary>` required.
- Check: `progress` is `none`, `stage-complete` or `ending-reached`; `stage-complete` is rejected on the final stage; `stageOutcome` required unless `none`; a replan must supply exactly the number of stages after the current one; an `endingId` must be a planned ending or empty (new ending).
- Deadlines need `in` (a valid duration), `event`, `region` and `location`.

### TinyBrain

`main_quest_generate` and `main_quest_check` are TinyBrain families (`main-quest-generate.tinybrain.njk`, `main-quest-check.tinybrain.njk`). Each stage returns one section (`TINY_BRAIN_SECTIONS`) parsed by the `main_quest_section` parser, which validates it with the same rules (`parseTinyBrainSection`) so errors are corrected at that stage. The check program branches on progress (ending vs. replan question via `yes_no`). `buildTinyBrainGenerateResult` / `buildTinyBrainCheckResult` assemble the full XML, which the standard parser validates again.

## Prompt context

- `buildBaseContextBlock(mainQuest)` → the `<mainQuest>` block in ordinary prompts (`main-quest-block.njk`): title, premise, current objective, hidden direction, hooks, cast roles, established facts, pressure, and `prominence` from `prominenceFor(turnsSinceProgress)` (`low` < 6 ≤ `normal` < 15 ≤ `high`). It never includes the hidden truth, future stages or endings, and is omitted from the main-quest prompts themselves. `factionRoles` (antagonist and faction-bound roles) feed the faction-housekeeping `<mainQuestStoryline>` block.
- `applyPlotAnalysisPin(state, mainQuest)` keeps the active main quest as the first plot thread (`pinned: true, source: 'main-quest'`), using the model's `isMainQuest` thread when present, inserting one otherwise, and clearing pins when no main quest is active.

## Runtime

`createMainQuestRuntime(deps)` serializes all operations on one promise chain.

- `start({ goal, mode })`: rejects when disabled, without a player, or with an active main quest; `sequel` needs an earlier main quest (`auto` without one becomes `new`). Generates the spine, applies pressure, starts stage 1, sets the offer `started` and emits `started`. The runtime never writes saves; all changes are saved by the game's next ordinary save or autosave. If stage 1 fails, the new record and its pressure are removed and the offer stays as it was.
- Stage start: runs `main-quest-stage`, stores current/next details, binds roles, applies pressure, then creates the stage quest through the `received_quest` handler with `questLine` (direct add, no offer, `originLocationLevel` = player level), resets `turnsSinceProgress`, and stores the response's `<prose>` scene through `storeStageProse`. The scene continues from the recent story and brings the new objective to the player through a hook; for stage 1 it opens the main quest. When a check advanced the stage, the prompt receives `mainQuestPreviousStage` (`title`, `outcome`, `questCompleted`) and opens by briefly wrapping up that stage only if the recent story (for example quest-completion prose) doesn't already show it. The scene must not move the player, change inventory or currency, or resolve anything for them.
- `runCheck({ reason })`: applies locked facts, recasts, replans and pressure; on `stage-complete` records the outcome, removes the stage quest if it was resolved another way, advances and starts the next stage; on `ending-reached` marks remaining stages skipped, completes the record, stops pressure, writes the wrap-up (`storeWrapUp`) and sets the offer `pending` with `followUpOf`.
- `abandon()`: removes the unfinished stage quest, marks stages skipped, stops pressure (skips this main quest's pending deadline events and deletes its trackers only), marks the record abandoned and sets the offer `declined`. Factions, NPCs and their plans are untouched.
- `declineOffer()`: pending → `declined` in memory, saved with the game as normal.
- `noteProgressSignal({ kind, evidence })`: records the event checker's `<mainQuestProgress>` gate (`parseProgressSignal`, `PROGRESS_SIGNAL_SCHEMA`) for the active main quest.
- `noteCompletedTurn()`: increments `turnsSinceProgress`, consumes the pending signal, and returns `{ reason, signal }` with reason `stage-quest-completed`, `event-signal` or `interval` (every `full_check_interval` turns), else `null`. `runCheck({ reason, signal })` passes the signal to the prompt as `mainQuestCheckSignal`.
- Pressure: a deadline skips earlier pending deadline events of this main quest, schedules the new event (`sourceMainQuestId` set) and creates or updates one hidden countdown `Tracker` (`sourceMainQuestId` set).
