# Main Quest API

Optional persistent storyline. Model: [MainQuest](../classes/MainQuest.md); lifecycle and prompts: [MainQuestService](../classes/MainQuestService.md); config: [main_quest](../config.md#main-quest).

## GET /api/main-quest

`{ success, enabled, gameLoaded, offer: { state, followUpOf }, active: PlayerView | null, history: PlayerView[], previousTitle }`. Player views never include the hidden truth, future stages, endings or stage count. `history` is newest first.

## POST /api/main-quest/start

Body `{ goal?: string (≤500), mode?: 'new' | 'sequel' | 'auto' }`. Unknown fields or bad values → 400. Disabled, no game, or an active main quest → 409. Otherwise returns 202 `{ success, started: true }` immediately and generates in the background (prompt-progress feedback via the audited background prompts). Clients receive `main_quest_updated` with `reason: 'starting'`, then `reason: 'started'`, or `main_quest_error` with `{ action: 'start', message, stack, state }`; a failed start leaves the offer as it was.

## POST /api/main-quest/decline

Sets a pending offer to `declined` (no further popup; starting later is still possible). Returns `{ success, offer }`. Like every main quest change, the dismissal is not saved immediately and no save is created or modified: it is written with the game's next ordinary save or autosave.

## POST /api/main-quest/abandon

Abandons the active main quest (409 when there is none). Returns `{ success, abandoned, ...state }`.

## POST /api/main-quest/check

Runs a progress check now (409 without an active main quest). Returns `{ success, result, ...state }`.

## Automatic checks

The full check prompt only runs when something suggests progress, or on a slow timer:

1. **Event-checker gate (no extra prompt).** While a main quest is active, the ordinary event checks are offered one extra registered element, `<mainQuestProgress><value>stage-complete|ending</value><evidence>…</evidence></mainQuestProgress>`, to emit only when the text shows the current stage's exit condition becoming true (the `<mainQuest>` block now includes `<stageExitCondition>`) or the storyline concluding. It is registered through the mod XML-event registry (`core:main-quest`, key `main_quest_progress`), so it works in standard and TinyBrain event checks; its schema is filtered out of `modEventPromptSchemas` when no main quest is active. The handler only records a signal (`noteProgressSignal`); several in one turn merge, and `ending` outranks `stage-complete`.
2. **End of turn.** After each completed normal player-action turn (next to plot-analysis scheduling), `noteCompletedTurn` increments `turnsSinceProgress`, consumes any signal, and returns the trigger: `stage-quest-completed` when the current stage quest is complete (detected without a model call), else `event-signal` when a signal was recorded, else `interval` every `full_check_interval` turns (default 12), else nothing.
3. **Full check.** `runCheck({ reason, signal })` runs in the background; a signal's evidence is passed to the check prompt, which must still confirm it against the story.

Failures are recorded in the prompt audit log and sent as `main_quest_error`.

## Realtime events

- `main_quest_updated` `{ reason, state }` with reasons `starting`, `started`, `checked`, `stage-complete`, `ending-reached`, `abandoned`, `declined`. Stage and ending changes also emit `chat_history_updated`.
- `main_quest_error` `{ action, message, stack, state }`.

## Related behaviour

- Stage quests are ordinary quests with `questLineId`/`stageId`. They do not count toward `soft_quest_limit`. `DELETE /api/player/quests/:id` returns 409 (`code: MAIN_QUEST_STAGE`) for the active main quest's unfinished stage quest; pausing is allowed.
- Each new stage's introductory scene is stored as a visible assistant chat entry of type `main-quest-stage` (`metadata.mainQuestId`, `stageId`, `questId`), followed by `chat_history_updated`. When the stage advanced from a completed one, the scene also wraps up that stage unless the recent story already did.
- The ending wrap-up is stored as a visible assistant chat entry of type `main-quest-wrapup` (`metadata.mainQuestId`).
- `/mainquest action=start|status|check|abandon [goal=...] [mode=...]` ([command doc](../slashcommands/MainQuestCommand.md)).
