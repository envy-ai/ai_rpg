Original prompt: Can you create a button that stops ALL PROMPTS (basically ends processing of the turn immediately wherever it is) and then reverts to the latest autosave?

- Prompt scheduling follow-up: failed attempts now retain their per-model and all-model semaphore position for immediate retries when no higher-priority foreground prompt is waiting; background retries yield to foreground work, then run before already queued background peers. This applies to automatic failures, adaptive stream fallback, and user-requested prompt retry.
- Retry-order validation passed for same-model, global all-model, background/foreground, configured network-wait, prompt-progress, and lifecycle-gate behavior. Restarted the live server from the newest Community Kitchen Exterior autosave with Qwen 27B; game/model health return 200.
- Fixed exterior travel unstubbing after the Community Kitchen move failure: `location-generator-stub.njk` now derives `displayName` from the guarded `stubName` string instead of dereferencing `normalizedLocationName.name`, and regression coverage checks both exterior and missing-name rendering.
- The three focused exterior/destination tests and new test syntax check pass. Restarted from the newest autosave with managed llama.cpp PID 3450520; game/model health return 200, and the required read-only browser smoke rendered cleanly with no error artifact at `tmp/location-stub-move-fix/shot-0.png`.
- Follow-up UI: replaced the wide `Stop & Undo` button beside Send with a 34px stop-sign icon button immediately left of the chat bubble visibility eye control; cancellation state now preserves the icon and updates accessible status text instead of resizing the control.
- Compiled `public/css/main.css`, passed the focused prompt-dock UI test and `chat.js` syntax check, then visually verified the aligned upper-right controls with no browser error artifact at `tmp/stop-undo-corner-control/shot-0.png`.
- Tracing the existing global prompt-cancellation endpoint, pre-turn autosave lifecycle, live save loader, and client prompt controls before designing an atomic cancel-and-rollback operation.
- Added an atomic game-load cancellation barrier: runtime-generation invalidation, active chat-turn drain, repeated LLM cancellation/drain, pending player/quest wait rejection, move-lock clearing, and broad transient promise/queue cleanup all finish before hydration.
- Added abortable OpenAI/NanoGPT/ComfyUI image requests, ComfyUI queue deletion plus active sampler interruption, image-job/batch cancellation, and stale image-prompt runtime guards.
- Added `POST /api/turn/cancel-and-rollback` and a red `Stop & Undo` chat control that restores the latest autosave selected after cancellation completes.
- Added focused cancellation/ComfyUI/UI tests and updated game-load, serialization, chat UI, prompt-control, and image-client docs.
- Restarted port 7777 from the newest autosave with the updated cancellation barrier; startup advanced the runtime generation before hydration and managed llama.cpp PID 3435586 is healthy. A non-mutating browser smoke test visually confirmed the red `Stop & Undo` control, with no console/page-error artifact (`tmp/cancel-rollback-ui/shot-0.png`).

Original prompt: I've added a config option called "live_deslop". If it's true, use this process with the normal slop checking algorithm (including the n-gram checking, which is hopefully fast enough to keep up?).

Follow-up: If the first flagged word has no viable branch, step backward one word at a time—even before the beginning of the matched phrase—until a viable next token is found.

Follow-up: Exclude XML tags from live checks and treat them as n-gram boundaries.

Follow-up: Prefer `stream + logprobs + tools`, fall back to the existing 500-token non-stream method after one failed streaming attempt, and retry streaming only after the game server or managed llama.cpp process restarts. Tool-call deltas do not need logprobs.

Follow-up: Persist the stream-failure message in the associated prompt log.

- Tracing TinyBrain and ordinary prose generation, streamed token metadata, every existing post-generation slop-removal call site, and the cost/semantics of incremental word/regex/n-gram checks.
- Intended behavior: retain an uncommitted token tail; on a detected match, rewind to the first overlapping token, choose the highest-probability safe alternative recorded for that position, and resume from verified prefill without a persistent token ban.
- Implemented `LiveDeslopController` for structured player-action prose, including source-offset mapping for normal/travel prose tags, completed-word-boundary inspection, word/regex/ngram match location, highest-probability branch selection, and one-word-at-a-time backward widening when the slop-start token is exhausted.
- Added ordered async token interception to `LLMClient` using streamed `logprobs.content`, retained sampled token records, transport restart through assistant prefill, and tool preservation across both continuations and textual branch corrections.
- Added one-definition-load-per-generation slop analysis sessions; a local definition-loader benchmark dropped the avoidable YAML/mod scan cost from roughly 30 ms per boundary (three loads) to one startup snapshot.
- Wired live deslop into final ordinary and TinyBrain player-action XML generation, retained the normal final slop pass, merged live diagnostics, added startup validation/default config, and documented the behavior.
- Indexed repeated-ngram benchmarks on deliberately repetitive synthetic histories ranged from about 0.65 ms at 20 words to 25.9 ms at 170 words per token boundary; the existing full-history scanner ranged from about 202 ms to 3.0 seconds on the same inputs.
- Final validation passed: syntax checks for all five changed JavaScript modules and the six targeted LiveDeslop, regex, streaming, prefill, and tool-call test files (6/6).
- Restarted with `config.yaml.qwen35B-A3B`; the game and managed llama.cpp health checks pass, ComfyUI was not started, and the required non-mutating browser smoke test rendered the initial UI without console or page errors.
- XML-aware live extraction now removes tag markup, excludes hidden-note contents, ignores incomplete streamed tags, splits both current prose and indexed history into hard n-gram segments, and prevents word-by-word rewind from crossing structural markup. Ten focused live-deslop cases and the broader seven-suite regression set pass.
- Restarted cleanly after resolving a stale llama.cpp port-owner race; the game returns HTTP 200, managed llama.cpp PID 3264276 reports healthy, and a fresh non-mutating browser smoke test rendered normally with no console/page errors. ComfyUI was not started.
- Live-deslop requests now try streaming first with tools and token logprobs. Pure streamed tool-call deltas are accepted without logprobs, while every visible text delta still requires aligned token metadata. The last visible token is rechecked when a later empty finish chunk marks the response complete.
- A compatibility or pre-text streaming failure is remembered by chat endpoint plus managed llama PID. The failed logical request immediately retries through the existing 500-token non-stream path; later calls skip streaming for that identity. A game-server restart clears the in-memory latch, and a changed managed PID creates a fresh identity.
- Probed the custom llama.cpp wire format with a logged, non-gameplay request containing tools, assistant prefill, streaming, and top-20 logprobs. It returned aligned text-token probabilities, pure metadata/finish chunks without logprobs, and completed successfully.
- Focused JavaScript syntax checks and five live-deslop, prefill, base-context-tool, image-progress-UI, and chat-tool test files pass. The adaptive regression verifies request modes `[stream, fallback, remembered fallback, stream after PID change]` and retained tools.
- The browser smoke test initially exposed an unrelated undefined portrait-dimension template interpolation (`Unexpected token ';'`). The server now passes validated primitive width/height locals; the restarted live UI renders correctly with no browser error artifact.
- Restarted port 7777 with `config.yaml.qwen35B-A3B` and the latest Community Kitchen Exterior save. The game and managed llama.cpp health endpoints pass under managed PID 3306319. Startup connected to the user-managed ComfyUI instance and cleared its VRAM immediately before the startup script; it did not launch ComfyUI.
- Adaptive fallback now emits a structured diagnostic callback containing the exact warning, classification, capability key, HTTP status/body, error details/backtrace, and fallback batch size. TinyBrain appends it immediately to the current logical prompt log before retrying; ordinary player-action logs include any collected diagnostics when written.
- Added a strict TinyBrain `appendLogSection(...)` completion hook so transport diagnostics cannot silently disappear or drift into another staged prompt's file. Focused live-deslop and relevant TinyBrain logging tests pass; the standalone TinyBrain file retains only its documented unrelated real-template checkpoint-count failure (`0 !== 8`).
- Saved the latest completed game state as `2026-08-05T20-43-10-800Z_Monster_Girl_Life_2026-06b-Baato-Ember_Hollow_Village_Square-char_2-msgk0imo`, then restarted port 7777 from that save with `config.yaml.qwen35B-A3B`. Managed llama.cpp PID 3310675 and both health endpoints are ready; startup cleared the existing user-managed ComfyUI instance's VRAM before the script and did not launch ComfyUI.
- The required non-mutating browser client produced `tmp/live-stream-failure-log-smoke/shot-0.png`; visual inspection confirms the restored Ember Hollow Village Square UI renders correctly, and no console/page-error artifact was created.
- Fixed the first post-restart player-action rejection: the fallback diagnostic callback had been placed on the shared TinyBrain request options, so non-live planning checkpoints correctly rejected it for lacking `liveTokenStreamFallbackChunkSize`. The callback is now attached only after a draft/final stage is selected for live deslop; non-TinyBrain live requests attach it together with their fallback configuration.
- Syntax checks and the focused live-deslop, TinyBrain logging, prefill, base-context-tool, and chat-tool suites pass. Restarted from current-state save `2026-08-05T20-49-49-687Z_Monster_Girl_Life_2026-06b-Baato-Ember_Hollow_Village_Square-char_2-msgk92ev`; game and managed llama.cpp PID 3312712 are healthy. The required browser smoke rendered correctly with no error artifact at `tmp/live-stream-log-callback-scope-fix/shot-0.png`.

Original prompt: At {#MARKER#} in player-action.tinybrain.njk, add the target location's name and description. Add an njk function like moreInfo.

- Added a prompt-only `getLocationInfo(name, id?)` Nunjucks global with exact-ID disambiguation, exact/substring name lookup, and explicit missing/ambiguous/description errors. Stub description metadata is supported.
- Wired resolved player-action travel destination id/name into the TinyBrain prompt context and rendered its canonical name and description in the exterior-travel branch at `{#MARKER#}`.
- Preserved the user-edited LLM-facing labels `Destination name` and `Destination description` and removed the temporary marker comment.
- Validation passed: syntax checks for all altered JavaScript files plus `tests/nunjucks_filters.eval.test.js`, `tests/base_context_is_exterior.test.js`, and `tests/player_action_tinybrain_target_location.test.js` (3/3 files).
- Restarted port 7777 with `config.yaml.qwen35B-A3B` and the latest save `2026-08-05T22-43-40-385Z_Monster_Girl_Life_2026-06b-Baato-Ember_Hollow_Village_Square-char_2-msgobh0h`; host-visible game and managed llama.cpp PID 3387963 health checks return 200.
- The required non-mutating browser client produced `tmp/tinybrain-destination-info-smoke/shot-0.png`; visual inspection confirms the restored Ember Hollow Village Square UI renders correctly, with no console/page-error artifact.

Original prompt: NPC ability and skill generation are being really wonky and returning gibberish, and those two prompts are contiunuations of previous prompts, so I'm converting them into base_context prompts instead.

Original prompt: When prompt_uses_caching is true, include every omission-controlled base-context piece before recentStoryHistory.

- Caching mode now ignores `omitGameHistory`, `omitInventoryItems`, `omitAbilities`, `suppressQuestList`, and per-call `omitEventSummaryHistory`.
- `omitCraftHistory` and `includeAllHistoryEntryTypes` remain active as accepted rare/specialized exceptions; without them, `<recentStoryHistory>` is the first omission-sensitive point.
- Plot-analysis and tonal-scale-evaluation self-context exclusions remain unchanged.
- Validation passed: syntax checks for `server.js` and the altered test files, plus all five targeted base-context/history/mod-field suites.

Original prompt: Preserve the chronological order in the live prompt/response viewer.

- Added `LLMClient.formatMessagesForPromptProgress(...)` to label request messages and preserve their system/user/assistant/tool chronology in live prompt-progress payloads.
- Kept the existing grouped `formatMessagesForErrorLog(...)` output unchanged for prompt and error log files.
- Updated prompt-progress regression coverage and UI/LLM documentation.
- Validation passed: `node --check LLMClient.js`, targeted Node prompt-progress/UI tests, the three-test prompt-progress Playwright spec, and visual inspection of a chronological tiny-brain viewer capture under `tmp/`.

- Added slash command `/respec_skills` in `slashcommands/respec_skills.js` to rebuild an NPC's skills for its current level by requesting a fresh NPC progression assignment, resetting registered skills to baseline, and reapplying the full formula-derived skill budget with rollback on failure.
- Updated `/respec_skills` target resolution to accept NPC aliases, prefer a unique match at the invoking player's current location when names are ambiguous, and abort with a warning if multiple matches still remain.
- Added shared slash-command character targeting helpers in `slashcommand_utils/characterTargeting.js` for alias-aware resolution, current-location ambiguity tie-breaking, and raw character-argument extraction from `interaction.argsText`.
- Updated `/awardxp`, `/setlevel`, `/heal`, `/kill`, `/incapacitate`, and `/respec_abilities` to use the shared character-targeting behavior so alias lookup and ambiguity handling are consistent across character-targeting commands.
- Added `Globals.respecNpcSkillsForCharacter` in `server.js`, including live-NPC XML seed generation for the progression prompt, strict location/region validation, baseline skill reset, and explicit restoration of the prior skill map on failure.
- Updated docs:
  - `docs/slash_commands.md`
  - `docs/slashcommands/RespecSkillsCommand.md`
  - `docs/slashcommands/Command.md`
  - `docs/slashcommands/SetLevelCommand.md`
  - `docs/slashcommands/HealCommand.md`
  - `docs/slashcommands/KillCommand.md`
  - `docs/slashcommands/IncapacitateCommand.md`
  - `docs/slashcommands/RespecAbilitiesCommand.md`
  - `docs/README.md`

- Added slash command `/setlevel` in `slashcommands/setlevel.js` to set the invoking player or a named character to an exact level while leaving XP unchanged and still triggering normal level-up side effects on increases.
- Fixed standalone NPC post-generation prompt resolution by making the skill/ability follow-up prompt bodies resolve directly under `_includes/` with `.njk` filenames so `base-context.xml.njk` can include them by prompt type.
- Updated `prompts/base-context.xml.njk` so `<currentLocation>` only renders when `currentLocation` is non-null.
- Reworked NPC post-generation skill/ability prompt construction in `server.js`:
  - Added a standalone base-context render path for `npc-generate-skills` and `npc-generate-abilities`.
  - Those prompts now receive `generated_npc_results` from the raw NPC-generation XML response.
  - They also receive `generatedRegionOrLocation` from the raw region/location generation XML when applicable.
  - When `generatedRegionOrLocation` is supplied, `currentLocation` is explicitly set to `null` for that prompt render.
- Removed the continuation-style follow-up behavior for NPC skills/abilities:
  - Location and region NPC follow-up prompts still run skills and abilities concurrently after NPC generation.
  - Single-NPC generation now also launches skill and ability prompts concurrently from the same NPC-generation response instead of chaining abilities after the skills prompt.
- Updated docs:
  - `docs/server_llm_notes.md`
  - `docs/README.md`

Original prompt: I've added a cachebuster parameter to the ai config. if true, prepend a random ID to the main prompt

- Implemented `ai.cachebuster` handling in `LLMClient.chatCompletion()`:
  - When enabled, each outbound request attempt prepends a fresh `[cachebuster:<uuid>]` line to the final `user` message only.
  - The original caller-provided `messages` array is left unchanged.
  - The streamed prompt-progress payload and error logging paths now reflect the actual tagged prompt that was sent.
- Added targeted regression coverage in `tests/llmclient.force-output.test.js` to verify final-user-message-only tagging and non-mutation of the source `messages` array.
- Updated docs:
  - `docs/config.md`
  - `docs/classes/LLMClient.md`
  - `docs/README.md`

Original prompt: Add a faction dropdown to the Region edit modal.

- Reviewed docs and existing region edit modal wiring.
- Found existing region faction select markup and JS wiring already present.
- Implementing a robustness tweak to ensure faction options are always refreshed when opening the region modal.
- Updated `views/index.njk` region edit modal faction select to include `name="controllingFactionId"`.
- Region edit modal now force-refreshes faction options on open and awaits faction select population before applying selected region faction.
- Updated docs: `docs/ui/pages.md` and `docs/README.md`.
- Validation: `npm run test:e2e:headless` failed because Playwright webServer exited early from config.
- Added defensive controlling-faction reconciliation for region-entry stub expansion in `server.js`:
  - Unknown stub/region faction ids are ignored with warnings (no hard throw).
  - Generated region `<controllingFaction>` conflicts no longer abort expansion; stub/existing values are enforced.
  - Existing saved region controlling faction now wins when conflicting with derived value, with warning logs.
- Updated docs: `docs/server_llm_notes.md`, `docs/README.md`.

Original prompt: Migrate canonical time from hours to minutes.

- Migrated canonical world time in `Globals.js` from `worldTime.timeHours` to `worldTime.timeMinutes`, with minute-based `advanceTime(...)`, `advancedMinutes`, and `atTimeMinutes` transition payload fields.
- Added strict shared duration parsing (`Utils.parseDurationToMinutes`) and switched event/crafting/status/weather parse paths to it.
- Converted status effect duration/applied-at semantics to minutes across `StatusEffect.js`, `Player.js`, `Thing.js`, `Location.js`, `Region.js`, `Events.js`, `server.js`, and `api.js`.
- Migrated weather duration/state structures to minute fields (`minMinutes`/`maxMinutes`, `durationMinutes`, `nextChangeMinutes`) with compatibility reads for legacy hour fields.
- Migrated offscreen NPC schedule snapshots/arithmetic to minute-based world-time comparisons.
- Updated crafting contracts to `timeTakenMinutes` with strict parsing and minimum one-minute advancement.
- Updated prompt contracts (`base-context`, craft/salvage/harvest plausibility checks, status-related includes) to request parseable minute/day/hour duration formats instead of decimal hours/turns.
- Added legacy save migration in `Utils.hydrateGameState(...)` to convert hour-based save structures into minute-canonical data during load.
- Updated docs and indexes for minute-based payload/model semantics (`docs/api/*`, `docs/classes/*`, `docs/server_llm_notes.md`, `docs/README.md`).
- Validation:
  - `node --check` passed for modified JS files.
  - Targeted runtime smoke checks passed for duration parsing, world-time advancement, and region weather minute normalization.

Original prompt: On mobile, if the 3 dots menu over an item, location, or character is clicked, suppress the description/stat popup so the menu is reachable.

- Updated `views/index.njk` to suppress floating tooltips on touch/coarse-pointer menu interactions:
  - Added touch-context tooltip suppression helpers (`shouldSuppressContextTooltips`, `suppressContextTooltipsForTouch`, and menu-button wiring for `pointerdown`/`touchstart`).
  - Wired suppression into item (`registerThingContextMenu`), character (`registerNpcContextMenu`), and location image (`locationImageMenuButton`) 3-dot menu buttons.
  - Added a suppression guard in `initFloatingTooltipController().show(...)` to prevent delayed synthetic hover popups while menu interaction is active.
  - Exposed `window.hidePartyTooltip` and added matching suppression checks in party tooltip hover/move handlers.
- Updated docs:
  - `docs/ui/chat_interface.md` (touch menu-tap tooltip suppression behavior)
  - `docs/README.md` (UI docs index summary line)
- Validation:
  - `npm run test:e2e:headless` still fails with the pre-existing Playwright startup error: `Process from config.webServer exited early`.

Original prompt: Don't run the slop remover on prompts starting with @, @@, or @@@.

- Updated `/api/chat` slop-removal gate in `api.js` so generic prompt actions (`@`, `@@`, `@@@`) bypass slop-remover the same way question actions (`?`) already do.
- Updated docs:
  - `docs/api/chat.md` (generic prompt variants now explicitly documented as slop-remover bypass).
  - `docs/slop_and_repetition.md` (explicit bypass section for `?`, `@`, `@@`, `@@@`).
  - `docs/README.md` (API chat summary line updated).
- Validation: `node --check api.js` passed.

Original prompt: I added vulnerability and resistance to the npc generation prompts. Please do the following:

1. Add these properties to the NPC class. they should each be a single string, as they are meant for the LLM to interpret easily. Don't process them at all.

2. Make sure that they are saved and loaded with the game. Do not error out if they are missing from the load; just leave them completely empty.

3. Add them as text boxes to the character view and edit modals.

4. Note that I've added a <damageEffectiveness> field to the attack-check prompt. If the enemy is successfully damaged, an effectiveness of 1 should cancel it out, 2 should reduce it by half, 3 should be normal (1x), 4 should be double, and 5 should be triple.

5. Include the damage multiplier in the combat results popup in the client.

- Added raw-string `resistances` and `vulnerabilities` fields to `Player` with getters/setters, constructor wiring, `getStatus()`, `toJSON()`, and `fromJSON()` (including singular-load aliases `resistance`/`vulnerability`). Missing fields now load as empty strings.
- Updated NPC generation parsing/creation pipeline in `server.js`:
  - `parseLocationNpcs()` / `parseRegionNpcs()` now parse `<resistances>` and `<vulnerabilities>`.
  - Generated NPC `new Player(...)` calls now persist those fields.
  - `serializeNpcForClient()` now returns both fields for client payloads.
  - `normalizeNpcPromptSeed()` now carries those values into single-NPC generation prompts.
- Updated base prompt context in `prompts/base-context.xml.njk` to include NPC `<resistances>` and `<vulnerabilities>` entries in `<currentLocation><npcs>`.
- Updated NPC edit API route (`PUT /api/npcs/:id`) to accept and persist `resistances`/`vulnerabilities` (plus singular aliases).
- Added UI text boxes:
  - `#npcEditModal`: editable `npcEditResistances` / `npcEditVulnerabilities` fields.
  - `#npcViewModal`: read-only `npcViewResistances` / `npcViewVulnerabilities` fields.
  - Hooked modal populate + submit payload wiring.
- Implemented `damageEffectiveness` combat math in `api.js`:
  - Parse `<damageEffectiveness>` from attack-check XML.
  - Apply multiplier only when pre-effectiveness damage is > 0.
  - Mapping implemented: `1=>x0`, `2=>x0.5` (rounded up with `Math.ceil`), `3=>x1`, `4=>x2`, `5=>x3`.
  - Added multiplier/effectiveness data to attack outcome + attack summary payloads.
- Updated combat result popup rendering in `public/js/chat.js` to show:
  - pre-multiplier damage,
  - multiplier/effectiveness,
  - effectiveness step inside damage calculation breakdown,
  - explicit “prevented by effectiveness” reason when multiplier zeroes damage.
- Docs updated:
  - `docs/classes/Player.md`
  - `docs/api/common.md`
  - `docs/api/npcs.md`
  - `docs/ui/chat_interface.md`
  - `docs/ui/modals_overlays.md`
  - `docs/ui/pages.md`
  - `docs/server_llm_notes.md`
  - `docs/README.md`
- Validation:
  - `node --check Player.js` ✅
  - `node --check server.js` ✅
  - `node --check api.js` ✅
  - `node --check public/js/chat.js` ✅
  - A direct `Player.fromJSON(...)` runtime smoke test failed outside full app bootstrap because `Globals.config.baseHealthPerLevel` is undefined in that isolated context.

- TODO (optional): run a gameplay smoke test (`/api/chat` attack turn) in a fully bootstrapped server session to verify the new multiplier values render as expected in live chat insight tooltips.

Original prompt: Note the following additions to config.default.yaml:

player_ability_options_per_level: 6
player_abilities_per_level: 3

When the player (and only the player) levels up, don't assign them abilities automatically. Instead, if they don't have player_abilities_per_level abilities for all of their levels, then for each level in sequence up to their current level (starting with the lowest level where they are missing abilities and skipping any level where they have sufficient abilities ), do the following:

Use the abilities generation prompt to generate a set of player_ability_options_per_level abilities. Display them in a new modal themed as cards, and allow them to toggle on player_abilities_per_level abilities, then click the submit button to choose those abilities.

If they already have one or more abilities in a level but less than player_abilities_per_level, then add those to the modal, already selected, but able to be toggled off. Generate that many fewer new abilities so that the number of choices they have is consistent.

- Added persisted player-only pending ability option storage in `Player` (`pendingAbilityOptionsByLevel`) with accessors/mutators and save/load wiring.
- Reworked level-up ability flow in `server.js`:
  - NPC behavior remains auto-generated + auto-assigned.
  - Player behavior now enters pending draft state instead of auto-assignment.
  - Added helper pipeline to resolve missing levels, generate per-level player options (via the level-up abilities prompt template), and apply submitted selections.
  - Added strict config validation for `player_ability_options_per_level` / `player_abilities_per_level` and explicit duplicate/shape validation errors.
- Added API endpoints:
  - `GET /api/player/ability-selection`
  - `POST /api/player/ability-selection/submit`
- Added pending-selection gameplay gates:
  - `/api/chat` now returns `409` with `pendingAbilitySelection` when player picks are pending.
  - `/api/player/move` now returns `409` with `pendingAbilitySelection` when pending.
  - `/api/player/levelup` now includes `pendingAbilitySelection` in the response.
- Added player ability draft modal to `views/index.njk`:
  - Card-style options, preselected existing abilities, exact-selection enforcement, sequential level progression.
  - Flow auto-checks on player refresh/load and blocks chat send/travel while pending.
  - Added handlers to consume `pendingAbilitySelection` payloads from API/chat errors and force-open the modal.
- Updated `public/js/chat.js`:
  - Blocks message dispatch when ability drafting is pending.
  - Handles pending-selection payloads from `/api/chat` and suppresses generic error spam for that case.
- Added modal styles in `public/css/main.scss` and rebuilt `public/css/main.css`.
- Updated docs:
  - `docs/config.md`
  - `docs/api/chat.md`
  - `docs/api/players.md`
  - `docs/ui/chat_interface.md`
  - `docs/ui/modals_overlays.md`
  - `docs/classes/Player.md`
  - `docs/server_llm_notes.md`
  - `docs/README.md`
- Validation:
  - `node --check Player.js` ✅
  - `node --check server.js` ✅
  - `node --check api.js` ✅
  - `node --check public/js/chat.js` ✅
  - `npm run scss:build:main` ✅
  - `npm run test:e2e:headless` ❌ (pre-existing failure: `Process from config.webServer exited early.`)

Follow-up update for the same prompt:
- Added load-time player ability draft resolution in `performGameLoad` (`api.js`) so missing per-level player ability option pools are generated during save load, not only during later chat/move requests.
- `performGameLoad` now also clears `playerAbilitySelectionPromises` alongside other in-flight generation maps.
- Updated docs:
  - `docs/api/game.md`
  - `docs/server_llm_notes.md`
  - `docs/README.md`

Original prompt: Make this a warning: "Error loading game: Error: Location description is required and must be a string ..."

- Applied a load-time-only fix in `Utils.hydrateGameState`:
  - For each loaded location, if `description` is blank/non-string, hydration now logs a warning and substitutes `"NO DESCRIPTION"` before `new Location(...)`.
  - `Location` constructor validation remains unchanged.
- Updated docs:
  - `docs/classes/Utils.md`
  - `docs/README.md`

Original prompt: Horizontally center the submit abilities button in the modal and put a 1.5em margin below it.

- Updated `public/css/main.scss`:
  - `.player-ability-selection-footer` now centers content.
  - `#playerAbilitySelectionSubmitBtn` now has `margin-bottom: 1.5em`.

Original prompt: Surface an error to the client if the summary fails.

- Automatic post-turn summary failures now emit a targeted `summary_error` realtime event containing the server error message and stack trace.
- The chat client handles `summary_error` independently of chat request lifecycle events and displays the stack in a modal browser alert.
- Added server scheduling, client handler, and browser alert regression tests.
- Updated `docs/api/chat.md`, `docs/ui/modals_overlays.md`, and `docs/README.md`.
- Validation: `node --check api.js`, `node --check public/js/chat.js`, and the two focused Node tests all pass. `npm run test:e2e:headless` passes with 34 tests passed and 4 fixture-gated tests skipped.

Follow-up: Fix live-deslop completion failure on llama.cpp's trailing empty stop token.

- Token-chunked non-stream processing now accepts exactly one final `token: ""`, `bytes: []` control record on a normal text `finish_reason: "stop"` response.
- The control record is excluded from response text and retained token history; the final visible token still receives `responseComplete: true` so trailing prose is checked.
- Empty token records in any other position remain explicit metadata errors.
- Validation passed: `node --check` for implementation and test files; focused live-deslop, assistant-prefill, and base-context tool-schema tests; game and llama health checks; and a non-mutating browser smoke capture with no console/page errors.
- Restarted the game with `config.yaml.qwen35B-A3B` and the requested save. Managed llama.cpp is healthy under PID 3285074; ComfyUI was not launched.

Follow-up: Prefer `stream + logprobs + tools` for live deslop, with remembered fallback.

- Live-deslop requests now probe streamed text-token logprobs while retaining the exact tool schema and assistant-prefill corrections.
- Pure streamed tool-call deltas are accepted without logprobs because tool calls are outside prose inspection.
- If the stream is rejected, lacks aligned text-token metadata, or fails before its first text token, the same logical completion switches to the existing 500-token non-stream path.
- Failed streaming capability is latched by endpoint plus managed llama.cpp PID. It is retried after either a game-server restart (fresh in-memory state) or managed llama.cpp restart (new PID key).
- The final streamed visible token receives `responseComplete: true`, including providers that send `finish_reason` in a later empty SSE chunk.
- Browser smoke testing exposed an undefined `characterPortraitDimensions` object in the rendered Play template, which produced `window.AIRPG_CONFIG.characterPortraitDimensions = ;` and stopped client hydration. The route now passes validated primitive width/height locals and the template constructs the client object explicitly.
- The first focused browser alert test run deadlocked because the test awaited `page.evaluate()` while the native alert was open; the test was corrected to accept the dialog before awaiting the dispatch evaluation.
- A second focused run encountered an unrelated directory-listing server on Playwright's default port 4173; the isolated-port config in `tmp/playwright.summary-error.config.js` avoided that listener. The final focused Chromium test passed and verified the alert heading, summary error text, and server stack location.

Original prompt: Make summarize all clear and rebuild those mappings.

- `/summarize all` and `/summarize all true` now generate from scene-summary entry 1 through the current end instead of resuming at the first gap.
- Successful all-range generation atomically replaces the complete scene list and entry-id index map through `SceneSummaries.replaceWithSummaryResult(...)`; invalid replacement data leaves the prior store unchanged.
- Numeric-range and numeric redo behavior remains unchanged.
- Updated `docs/classes/SceneSummaries.md`, `docs/slashcommands/SceneSummaryCommand.md`, and `docs/README.md`.
- Validation: syntax checks passed for `SceneSummaies.js` and `server.js`; five focused scene-summary test files pass.
- Isolated-port Chromium regression suite passes with 35 tests passed and 4 fixture-gated tests skipped.

Original prompt: Incomplete scene summary data shouldn't block loading.

- `Utils.hydrateGameState(...)` now catches invalid or incomplete `sceneSummaries.json` payload errors, clears the scene-summary store, warns with the validation error, and continues loading the rest of the save.
- A missing scene-summary runtime store remains a fatal hydration configuration error, and recovery also fails explicitly if the store cannot be cleared.
- Added a hydration regression test for the persisted `scenes: []` plus stale non-empty `entryIndexMap` case.
- Updated `docs/classes/Utils.md`, `docs/classes/SceneSummaries.md`, and `docs/README.md`.

Original prompt: If not already, make housekeeping and quest_check run at configurable intervals.

- Added persisted maintenance-prompt turn counters and strict interval resolution for `housekeeping.interval` and `quest_checks.interval`; both default to 1.
- Added interval gates to normal event-check housekeeping, split-movement housekeeping, and active-quest checks. Suppressed/recursive checks and no-active-quest calls do not advance counters; manual `/housekeeping` remains immediate.
- Added configuration form fields and focused regression coverage. Documentation and final validation remain to be completed.
- Browser inspection against the already-running server exposed blank interval inputs because its in-memory config predates the new defaults. The form now renders `1` for either missing key; a follow-up browser capture is pending.
- Updated `docs/config.md`, `docs/classes/Events.md`, `docs/api/chat.md`, `docs/api/quests.md`, `docs/api/game.md`, `docs/slashcommands/HousekeepingCommand.md`, and `docs/README.md` with cadence, manual-bypass, and persistence semantics.
- Final validation passed: JS syntax checks, default YAML parsing, isolated Nunjucks defaults, and 10 focused test files covering intervals, housekeeping XML, quest prompt transport, event sequencing, new-game reset, config overrides, need bars, and the manual command.
- Browser captures confirmed both controls are present and correctly laid out. Their values remained blank in the already-running process because it cached the pre-change template/config; the source-level Nunjucks validation confirms missing keys render as `1` after restart.
- Unrelated existing issue: `tests/api.vehicle_travel_prose_timing.test.js` fails because it still searches `api.js` for the removed `runTravelProseEventChecks` source marker.
- TODO: restart the actively used game server at a safe point so the new runtime interval logic and refreshed config template are loaded.

Original prompt: Add parsing for the new `<anyQuestObjectivesCompleted>` event type in the event prompt. If true, run the quest check immediately and reset the counter, suppressing running it twice in one turn.

- The prompt schema already contained the required XML field. Added strict boolean parsing, a query helper for merged/split results, interval bypass support, duplicate suppression against the normal per-turn quest check, and quest-counter reset after a successful check.
- Added focused parser, interval-bypass, counter-reset, and API sequencing coverage. Documentation and final validation remain.
- Clarified timing after user follow-up: normal quest-check staggering is unchanged. The event signal adds one interval-bypassing check later in the same turn only when the normal check returned no result; an existing result is reused and resets cadence without launching a second prompt.
- Updated `docs/classes/EventsXmlEventSchema.md`, `docs/classes/EventsEventTypes.md`, `docs/classes/Events.md`, `docs/api/quests.md`, `docs/api/chat.md`, `docs/config.md`, and `docs/README.md`.
- Validation passed: syntax checks; 4 focused parser/cadence/orchestration test files; 9 broader event, quest-objective, housekeeping, need-bar, save-reset, and config test files; and visual inspection of the final browser smoke capture in `tmp/quest-objective-signal-final-smoke/shot-0.png` with no reported browser errors.
- TODO: restart the running game server at a safe point to load this backend change; the browser smoke used the currently active pre-change process.
- Validation: `Utils.js` and the new test pass syntax checks; four focused hydration/scene-summary test files pass.
- Isolated-port Chromium regression suite passes with 35 tests passed and 4 fixture-gated tests skipped.
- Rebuilt CSS output: `npm run scss:build:main` (updates `public/css/main.css`).
- Updated docs:
  - `docs/ui/modals_overlays.md`
  - `docs/README.md`

Original prompt: Make it so the modal pops up before the prompt to generate the abilities is run, with a message saying that the ability options for level X are being generated.
Then: "Just say 'Ability options for level-up are being generated'"
Also: update `/respec_abilities` with optional end level and player-specific modal reselection behavior.

- Deferred player ability-option generation until explicitly requested:
  - `server.js` `resolvePlayerAbilitySelectionState(...)` now supports pending selections with incomplete options (`selection.optionsReady=false`, `optionsToGenerate`) when generation is not requested.
  - Player `generateLevelUpAbilitiesForCharacter(...)` now resolves pending state without pre-generating options.
  - `api.js` pending checks for `/api/chat`, `/api/player/move`, `/api/player/levelup`, and load-time pending resolution now use `ensureOptionsForNext: false` (no pre-generation).
  - `GET /api/player/ability-selection` now supports query `generateOptions=0|false|no` to return pending state without generating options.
- Updated modal flow in `views/index.njk`:
  - Added loading-first flow: modal opens before generation with message `Ability options for level-up are being generated`.
  - Generation is then triggered via a second request (`/api/player/ability-selection?generateOptions=1`), after which cards render.
  - Added client-side detection for incomplete selection payloads (`optionsReady`/option count), plus submit-state guards while loading.
- Updated `/respec_abilities` in `slashcommands/respec_abilities.js`:
  - Added optional `end_level`.
  - Supports numeric positional shorthand (`/respec_abilities 2 4`) when no character named `2` exists.
  - Respec range is now inclusive `[start_level, end_level]`.
  - Player target: removes abilities only in range, clears pending generated options for those levels, does not regenerate automatically, and instructs replacement via modal.
  - NPC target: keeps regeneration flow, now limited to range via `{ previousLevel: start-1, newLevel: end }`.
- Updated docs:
  - `docs/api/players.md`
  - `docs/api/game.md`
  - `docs/ui/chat_interface.md`
  - `docs/ui/modals_overlays.md`
  - `docs/slashcommands/RespecAbilitiesCommand.md`
  - `docs/server_llm_notes.md`
  - `docs/README.md`
- Validation:
  - `node --check server.js` ✅
  - `node --check api.js` ✅
  - `node --check slashcommands/respec_abilities.js` ✅

Original prompt: "If no game has been loaded or started, suppress the dialogue. (and the prompt, obviously)"

- Added no-active-game suppression for player ability selection modal/prompt flow:
  - `server.js` now passes `gameLoaded` into `index.njk` render context.
  - `views/index.njk` now sets `window.__AIRPG_GAME_LOADED__` and gates `requestPlayerAbilitySelectionFlow(...)`; when false, the modal is closed and ability-selection fetch/generation is skipped.
  - `views/index.njk` pending-payload handler now no-ops when no game is loaded.
  - `api.js` `resolvePendingPlayerAbilitySelection(...)` now immediately returns `null` when `Globals.gameLoaded === false`.
  - `GET /api/player/ability-selection` now returns `{ pending:false }` without generating options when no game is loaded.
- Updated docs:
  - `docs/api/players.md`
  - `docs/ui/chat_interface.md`
  - `docs/server_llm_notes.md`
  - `docs/README.md`
- Validation:
  - `node --check api.js` ✅
  - `node --check server.js` ✅

Original prompt: When I run /respec_abilities on another character, it says character not found even if I copy and paste their name directly.

- Fixed `/respec_abilities` target resolution and positional parsing in `slashcommands/respec_abilities.js`:
  - Added raw positional parsing from `interaction.argsText` so multi-word copied names are interpreted correctly before trailing levels.
  - Added alias-aware, sanitized character lookup with ambiguity detection (fails loudly when multiple matches exist).
  - Kept numeric shorthand support (`/respec_abilities 2 4`) and range validation.
  - Added explicit integer validation messaging for `start_level` / `end_level` when provided.
- Updated slash interaction payload in `api.js` to pass `argsText` into command `interaction`.
- Updated docs:
  - `docs/slashcommands/RespecAbilitiesCommand.md`
  - `docs/README.md`
- Follow-up docs update: `docs/slash_commands.md` now documents `interaction.argsText` availability for command handlers.
- Root cause identified in `slashcommands/respec_abilities.js`: not-found reply branch only checked `rawName`, so it fired even when target lookup succeeded. Fixed to `if (rawName && !target)`.
- Added quick local smoke checks via `node - <<'NODE' ...` for:
  - direct name lookup (`Bob Ross`) ✅
  - parser-split positional input (`character=Bob`, `start_level=Ross`, `argsText='Bob Ross'`) ✅
  - numeric shorthand (`2 3`) ✅

Original prompt: For the skill generation modal: close the load game modal first; keep top-screen options clickable during generation.

- Updated load-game modal controls in `views/index.njk`:
  - Exposed `openLoadGameModal` / `closeLoadGameModal` on `window` so other UI layers can safely dismiss the load dialog.
- Updated prompt progress UI behavior in `public/js/chat.js`:
  - Added `closeLoadGameModalIfOpen()` and call it before rendering prompt progress entries, so the load modal is dismissed before prompt activity UI appears.
  - Added prompt overlay auto-anchoring below top controls via `getPromptProgressSafeTopOffsetPx()` + `applyPromptProgressAutoAnchor()`.
  - Dragging prompt overlay now disables auto-anchor for that overlay instance (`dataset.autoAnchored=false`).
- Updated docs:
  - `docs/ui/chat_interface.md`
  - `docs/ui/modals_overlays.md`
  - `docs/README.md`
- Validation:

Original prompt: Add an eye icon on the left column of the running prompted table that pops up a window that shows the text of the response as it's streaming in.

- Updated `LLMClient.js` prompt-progress tracking to include live `previewText` content for active streamed prompts in the existing realtime `prompt_progress` payload.
- Updated `public/js/chat.js` prompt-progress overlay:
  - added an eye action in the left-column action group for each running prompt,
  - added a floating streamed-response viewer window with close control,
  - wired the viewer to follow live `previewText` updates as prompt chunks arrive,
  - highlighted the currently viewed prompt row and closed the viewer automatically when the tracked prompt disappeared.
- Updated `public/css/main.scss` and rebuilt `public/css/main.css`:
  - styled the new eye action button,
  - added active-row highlighting,
  - added the streamed-response viewer window styling and mobile layout.
- Updated docs:
  - `docs/ui/chat_interface.md`
  - `docs/ui/modals_overlays.md`
  - `docs/classes/LLMClient.md`
  - `docs/README.md`
- Validation:
  - `npm run scss:build:main` ✅
  - `node --check LLMClient.js` ✅
  - `node --check public/js/chat.js` ✅
  - `npm run test:e2e:headless` ✅
  - `node --check public/js/chat.js` ✅

Original prompt: Trigger item-card long-name compact style when any word is 12+ characters.

Original prompt: In the eye button window, also render the full prompt before the response, make it a different color, and add a copy prompt button.

- Updated `LLMClient.js` prompt-progress tracking to include full `promptText` alongside the existing live `previewText` in each realtime `prompt_progress` entry.
- Updated `public/js/chat.js` prompt viewer:
  - added a prompt panel above the response panel,
  - added `Copy Prompt` in the viewer header with clipboard fallback + temporary success/failure feedback,
  - reset copy-button feedback correctly when switching between tracked prompts.
- Updated `public/css/main.scss` and rebuilt `public/css/main.css`:
  - split the viewer into differently colored prompt/response sections,
  - styled the new copy button and header action group.
- Updated docs:
  - `docs/ui/chat_interface.md`
  - `docs/ui/modals_overlays.md`
  - `docs/classes/LLMClient.md`
  - `docs/README.md`
- Validation:
  - `npm run scss:build:main` ✅
  - `node --check LLMClient.js` ✅
  - `node --check public/js/chat.js` ✅
  - `npm run test:e2e:headless` ✅

- Updated shared name rendering helper in `views/index.njk`:
  - Added `LONG_NAME_WORD_CHARACTER_LIMIT = 12` and `containsLongWord(...)`.
  - `setRenderedName(...)` now supports optional `longWordCharacterLimit` and applies `.entity-name-long` when either:
    - name length > 40, or
    - a word meets the configured long-word limit.
- Applied the 12+ word trigger only to item/scenery card name call sites:
  - inventory cards
  - crafting inventory cards
  - location item/scenery cards
- Updated docs:
  - `docs/ui/assets_styles.md`
  - `docs/README.md`

Original prompt: Now, on the dual column container inventory modal, put an "Add all" button on the player side and a "Remove all" button on the container side. These should add and remove all items that are currently visible with the current filter in their respective column. In general, when viewing an inventory modal, dragging an item outside of the modal should drop it at the location.

- Added visible-filtered `Add all` and `Remove all` controls to `#thingContainerModal`.
- Bulk container transfers snapshot the currently rendered filtered item lists and move whole stacks sequentially via existing container move endpoints, refreshing the modal/player inventory afterward.
- Added shared modal-inventory drag state so dragging items out of container, NPC inventory, or crafting inventory modals drops them into the current location through the existing item-drop route.
- Updated container, NPC inventory, and crafting inventory drag wiring to participate in modal-outside drops while preserving existing in-modal drag/drop behavior.
- Updated docs:
  - `docs/ui/chat_interface.md`
  - `docs/ui/modals_overlays.md`
  - `docs/ui/assets_styles.md`
  - `docs/README.md`
- Validation:
  - `npm run scss:build:main` ✅
  - rendered `views/index.njk` inline script `node --check` ✅
  - `node --test tests/thing.container.test.js` ✅
  - `npm run test:e2e:headless` ✅ (3 passed, 3 skipped)
- Tightened `Add all` preflight validation so a visible equipped item or the open container itself fails before any bulk move starts, avoiding partial success on known-invalid visible sets.

Follow-up for the same container modal prompt:
- Changed container `move-in`/`move-out` API routes to accept either a single `thingId` or bulk `thingIds` arrays.
- Bulk container API moves validate the whole list before moving anything, then return one refreshed container payload.
- Updated the client `Add all` / `Remove all` actions to send one bulk request instead of one request per visible item.
- Updated docs: `docs/api/things.md`, `docs/ui/chat_interface.md`, `docs/ui/modals_overlays.md`, `docs/README.md`.
- Validation:
  - `node --check api.js` ✅
  - rendered `views/index.njk` inline script `node --check` ✅
  - `node --check tests/api.container_moves.test.js` ✅
  - `node --test tests/api.container_moves.test.js tests/thing.container.test.js` ✅
  - `npm run test:e2e:headless` ✅ (3 passed, 3 skipped)

Original prompt: Make item text filtering filter on item detail as well. Follow-up: maybe also do status effect text, if it's not already done, since that's user visible.

- Expanded shared thing-list text filtering to search item/scenery detail fields, recursive metadata text/numeric detail values, and status-effect text (`statusEffects`, `causeStatusEffectOnTarget`, and `causeStatusEffectOnEquipper`).
- Updated docs: `docs/ui/chat_interface.md`, `docs/README.md`.
- Validation:
  - rendered `views/index.njk` inline script `node --check` ✅
  - `npm run test:e2e:headless` ✅ (3 passed, 3 skipped)

Original prompt: In mobile mode, rather than columns, the player inventory should take the top half the box vertically and the container the bottom half. On a touch screen, long pressing on an item should initiate a drag (wait for lift to do the short press action).

- Updated the thing-container modal mobile layout so the dialog fills the viewport height and the player/container panels split the modal vertically half-and-half.
- Added simulated long-press touch dragging for modal inventory item cards:
  - Container modal cards can long-press drag between the player inventory and container panels.
  - NPC inventory and crafting inventory cards can long-press drag outside the modal to drop at the current location.
  - Short taps are left for normal click behavior; completed touch drags suppress the follow-up synthetic click.
- Added touch-drag ghost/active styling in `public/css/main.scss` and rebuilt `public/css/main.css`.
- Updated docs: `docs/ui/chat_interface.md`, `docs/ui/modals_overlays.md`, `docs/ui/assets_styles.md`, `docs/README.md`.
- Validation:
  - `npm run scss:build:main` ✅
  - rendered `views/index.njk` inline script `node --check` ✅
  - `npm run test:e2e:headless` ✅ (3 passed, 3 skipped)

Original prompt: Check every modal input box and make sure ctrl-enter submits on all of them. Maybe unify that piece of code.

- Audited modal documentation, modal markup across the shared pages, and existing keyboard handlers.
- Found a partially unified Ctrl/Cmd+Enter handler in `views/index.njk`, plus separate crafting and salvage handlers and page-specific modal implementations.
- Identified a behavior boundary requiring confirmation before implementation: inventory/search filters have no submit action, and the barter modal contains filters, a Haggle action, and a separate Commit Trade action.
- Proposed direction: a shared delegated modal-shortcut helper loaded by `_includes/head-common.njk`, native form submission where available, and explicit control-to-action mappings for non-form/multi-action modals.
- Added shared `public/js/modal-submit-shortcuts.js`, loaded through `_includes/head-common.njk` on every application page.
- Modal inputs inside forms now submit through native `requestSubmit()`; non-form data-entry modals use explicit `data-ctrl-enter-submit` mappings.
- Added mappings for Play-page travel, location-region repair, slash upload, barter haggle, crafting/salvage, NPC memories/goals, load game, and dynamic chat edit workflows, plus Config Add Model, Settings Auto-Fill Guidance, and Lorebooks Upload.
- Removed the duplicated general/crafting/salvage Play-page Ctrl/Cmd+Enter handlers; preserved unmodified Enter behavior for Add Model, Load Game, barter haggle, and skill addition.
- Added behavioral and markup regression coverage in `tests/modal_submit_shortcuts.test.js` and updated `tests/crafting_ctrl_enter_ui.test.js`.
- Added `tests/e2e/modal-submit-shortcuts.spec.js` for real-browser form submission, explicit action activation, filter non-submission, and shared Play-page helper loading.
- Updated docs: `docs/ui/modals_overlays.md` and `docs/README.md`.
- Validation:
  - `node --check` passed for all altered JavaScript and test files.
  - `node --test tests/modal_submit_shortcuts.test.js tests/crafting_ctrl_enter_ui.test.js` ✅ (7 passed).
  - Targeted Playwright modal shortcut spec ✅ (2 passed).
  - Develop-web-game browser client completed with no captured console/page errors; inspected `tmp/modal-ctrl-enter-webgame/shot-0.png`.
  - Full `npm run test:e2e:headless`: 18 passed, 3 skipped, 11 failed. Eight header failures expect the existing navigation without its Mods entry; two settings persistence tests time out creating profiles. The empty-action confirmation test failed only in the parallel run and passed when rerun alone.
  - Settings persistence failures reproduce with one worker and are unrelated to keyboard events (the new helper only handles Ctrl/Cmd+Enter keydown).
- TODO: no remaining work for modal Ctrl/Cmd+Enter submission. Existing header/settings E2E failures remain outside this task.

Original prompt: Update the tests to match the current intended functionalty of the game.

- Compared the failing E2E assertions with current UI/API documentation and implementation.
- Header expectations are stale: `Mods` is now a primary navigation item and `/mods` is a documented top-level page.
- Settings persistence tests submit before the asynchronous Worlds-page initialization attaches handlers and omit the now-required hiding/perception attributes.
- Settings tests also need isolation: `/settings` performs `POST /api/settings/load`, which clears/reloads the singleton in-memory profile registry and can race with persistence tests running in parallel.
- The parallel-only empty-action failure is a readiness race; the test clicks Send before `window.AIRPG_CHAT` is guaranteed to exist.
- Proposed test-only changes: update header labels/routes, stub profile reload in the header-only Worlds check, serialize settings persistence tests, populate required mechanic attributes, and wait for client initialization in the empty-action test.
- Updated `header.navigation.spec.js` to include the primary Mods label, exercise `/mods`, and include Mods in mobile navigation expectations.
- The header-only `/settings` case now stubs `POST /api/settings/load` so a read-only chrome assertion cannot clear/reload the shared profile registry during persistence tests.
- Updated `settings.persistence.spec.js` to run serially, wait for Worlds-page network initialization, force a create-mode current-profile response, choose required hiding/perception attributes through Character Options, and apply the enabled Modules default preset before saving.
- Updated `empty-action-confirm.spec.js` to wait for `window.AIRPG_CHAT` and an enabled Send button before exercising the confirmation flow.
- Updated docs: `docs/playwright.md` and `docs/README.md`.
- Validation:
  - Altered E2E spec syntax checks passed.
  - The 15 formerly failing header/settings/empty-action tests passed together with three workers.
  - Full `npm run test:e2e:headless` ✅: 30 passed, 3 intentionally skipped.
  - Develop-web-game browser client completed without captured console/page errors; inspected `tmp/current-functionality-tests-webgame/shot-0.png` and confirmed the Mods page/header renders correctly.
- TODO: none for this test-alignment task.

Original prompt: I've saved my current game on the running server. Go ahead and run those tests, checking if they work as designed. If they fail, let me know and we'll determine if the problem is the code or the test.

- Ran all three intentionally skipped Playwright regressions against the existing server at `http://127.0.0.1:7777` after confirming the user's manual save exists.
- Attack replay: failed at the 30-second timeout waiting for `POST /api/chat`; the attack check and `resolveAttack` completed, but live (non-fixture) player-action and follow-up prompts ran. The resulting narration did not match the deterministic fixture assertion.
- Cross-region round trip: failed at the 30-second timeout on its first `POST /api/player/move`; the server did complete the move from The Sinking Stairs to Warning Post, but the test never reached the round-trip exit assertions because live image/while-away work ran after load.
- Vehicle new game: failed at the 30-second timeout on `POST /api/new-game`; it created Vehicle Regression Hero but was still generating a live calendar/region and had no current location when the test ended, so none of the vehicle assertions ran.
- Root-cause evidence points to test setup: both `/api/load` and `/api/new-game` call `Globals.reloadConfigAndDefs()`, while the tests apply `ai.force_outputs_file` and other deterministic runtime settings *before* those calls. The reload removes the test overrides, causing live prompts and making the 30-second timeout unsuitable. No application or test code was changed during this diagnostic run.
- Verified the runtime config values returned to the pre-test baseline after the runs. The live in-memory game remains test-mutated; the user's pre-test manual save is retained for restoration.
- Develop-web-game smoke review captured `tmp/web-game-test-review/shot-0.png`; it shows the partially initialized Vehicle Regression Hero at Unknown Location with a live `region_generation` prompt. The client captured one generic 404 console resource error.

Follow-up: Change the timeout to 5m and re-run the tests.

- Scoped a five-minute timeout to the opt-in playthrough regression describe block and the opt-in vehicle regression describe block; the global Playwright timeout remains 30 seconds.
- Updated `docs/playwright.md` and its `docs/README.md` catalog description to document the regression-specific timeout.
- Known rerun caveat: `/api/load` and `/api/new-game` still reload configuration after the tests set deterministic runtime overrides, so the five-minute runs may use live prompts.
- Validation:
  - Altered spec syntax checks passed.
  - Attack replay ran for about 5.1 minutes, received a successful live `/api/chat` response just before timeout, then failed because the live narration did not contain the deterministic fixture text. Serial mode did not run the region scenario in that command.
  - Region shortcut ran for about 5.1 minutes. It completed moves to Warning Post and Memorial Walk, then hit the 300,000 ms timeout during the move to Last Chance Market; cross-region assertions were not reached.
  - Vehicle regression ran for about 5.1 minutes and hit the 300,000 ms timeout inside `/api/new-game` while live Starfall Station NPC/ability generation was still running; vehicle assertions were not reached.
  - Develop-web-game browser review captured `tmp/five-minute-regression-review/shot-0.png`, showing Vehicle Regression Hero at Unknown Location with live NPC ability generation still active. One generic 404 resource console error was captured.
- Conclusion: the five-minute timeout override is active, but it does not make the regressions deterministic or sufficient while config reloads discard their forced-output settings.

Original prompt: Add an optional `ai.tinybrain` player-action prompt program using `player-action.tinybrain.njk`, with staged LLM calls, parser checkpoints and resumable parse retries, preserved tool-call results, and one progressively written prompt log.

- Confirmed defaults and implementation direction:
  - `ai.tinybrain` defaults to `false`; the existing player-action path remains unchanged when disabled.
  - Extend the user's instruction/checkpoint pattern through the rest of `player-action.tinybrain.njk` with minimal wording changes.
  - `llm_dummy_action` requires a non-whitespace response.
  - `llmparse` routes by parser name, accepts parser arguments, and retries only the failed checkpoint.
  - Preserve tool calls/results across stages and parse retries.
  - Write one incrementally updated log per tinybrain run with explicit LLM response start/end markers.
  - Add optional `tinyBrainText` to mod player-action prompt steps and fall back to `text`.
- Added `TinyBrainPromptRunner.js` and a Nunjucks prompt extension implementing staged `{% llm_dummy_action %}` and `{% llmparse(...) %}` checkpoints.
  - `llm_dummy_action` requires a non-whitespace response.
  - `llmparse` routes by parser name, accepts additional parser arguments, and supports `as variable` assignments used by later Nunjucks branches.
  - Parser failures retry only the current checkpoint using `ai.retryAttempts`; successful prior stages are retained.
  - Tool-call assistant messages and tool results remain in the accumulated conversation across later stages and retries, while an unparseable terminal assistant response is removed before retrying.
- Completed the staged instructions in `prompts/_includes/player-action.tinybrain.njk` with minimal wording changes:
  - staged NPC selection, action validation, information gathering, needs/initiative analysis, travel classification, mental-compulsion analysis, first draft, editing, second draft, final analysis, and final XML response;
  - attack and non-repetition-buster prompt branches retain their existing one-shot behavior because they contain no checkpoints.
- Added `ai.tinybrain: false` to `config.default.yaml`, strict boolean configuration validation, prompt-environment extension registration, and `/api/chat` routing for normal `player-action` prompts when enabled.
- Extended player-action mod prompt steps with optional `tinyBrainText`, falling back to `text`, and supplied staged-response wording for the three `nsfw-boost` prompt steps.
- Extended `LLMClient.logPrompt()` with explicit append support and response-boundary labels. Each tiny-brain run now writes one progressive prompt log, including every staged prompt, LLM response BEGIN/END markers, parse failures/retries, tool-call rounds, and tool results.
- Updated documentation:
  - `docs/classes/TinyBrainPromptRunner.md`
  - `docs/classes/LLMClient.md`
  - `docs/classes/ModExtensionRegistry.md`
  - `docs/config.md`
  - `docs/api/chat.md`
  - `docs/modding.md`
  - `docs/modding_hooks.md`
  - `docs/mods/nsfw-boost.md`
  - `docs/mods/need-bar-lust.md`
  - `docs/server_llm_notes.md`
  - `docs/README.md`
- Added/updated targeted regression coverage in `tests/tiny_brain_prompt_runner.test.js`, `tests/chat_tool_calls.test.js`, `tests/mod_extension_hooks.test.js`, and `tests/mod_entity_field_xml_prompt.test.js`.
- Validation:
  - Syntax checks passed for all altered JavaScript and test files.
  - `config.default.yaml` parses successfully with the project's `js-yaml` dependency.
  - Targeted tiny-brain/tool/mod test files pass.
  - Direct prompt rendering produced 14 ordered checkpoints, including both stage-1 and stage-3 mod steps.
  - A real append-log smoke test verified one shared path and explicit LLM response BEGIN/END markers.
  - Full `npm run test:e2e:headless` passed with no failed tests after clearing a stale unrelated static server from the Playwright port.
  - Develop-web-game browser smoke completed without captured browser/page errors; inspected `tmp/tinybrain-browser-smoke/shot-0.png` and confirmed the Play screen renders normally.
  - Broad `node --test tests/*.test.js` result was 295 passing and 15 failing. Representative failures are pre-existing source-extraction/config-fixture issues unrelated to tiny-brain (for example obsolete helper extraction and a local plot-analysis config expectation); the tiny-brain-related targeted tests all pass.
- TODO: none for the tiny-brain staged prompt runtime.

Original prompt: I made additional changes to player-action.tinybrain.njk. Make sure that the njk doesn't have any nesting issues or other errors, and make sure what I'm doing is covered by the parsing functions.

- Fixed a real Nunjucks nesting error in `prompts/_includes/player-action.tinybrain.njk`: the final travel/non-travel `{% if response %}` was missing its closing `{% endif %}` before the outer repetition-buster `{% else %}`.
- Added built-in `response_or_na` parsing to `TinyBrainPromptRunner.js`:
  - direct normalized no-result answers (`N/A`, `not applicable`, `none`, `no`, `no issues`, `nothing`, and common identified/found variants) become `false`;
  - every other non-whitespace answer becomes `true` so the corresponding revision checkpoint renders.
- Added built-in `yes_no` parsing for the final travel decision. It accepts answers beginning with `yes` or `no`, including an optional `Answer:` prefix, and stores a boolean in the assigned Nunjucks variable.
- Added parser unit coverage and a real-template runner regression that exercises the repeated `response` assignment, a substantive editing result, skipped N/A editing results, and the final travel branch.
- Updated `docs/classes/TinyBrainPromptRunner.md` and `docs/README.md`.
- Validation:
  - `player-action.tinybrain.njk` eager Nunjucks compilation passes.
  - `node --check TinyBrainPromptRunner.js` passes.
  - `node --check tests/tiny_brain_prompt_runner.test.js` passes.
  - `node tests/tiny_brain_prompt_runner.test.js` passes all 4 tests.
- A direct real-template render matrix passes for repetition-enabled non-attacks with and without action text, simple non-attacks, and both attack configurations. It confirms 20–21 initial checkpoints for repetition-enabled non-attacks, one NPC-selection checkpoint for simple non-attacks, and zero checkpoints for attacks.
- Corrected the runner/API documentation to reflect the existing simple non-attack NPC-selection checkpoint; only attack branches are one-completion tiny-brain programs.
- TODO: none for the updated tiny-brain template/parser audit.

Original prompt: Add a command line option to automatically load game saved at an arbitrary path at startup, if something similar doesn't already exist. I'd like you to be able to use this to write live browser tests.

- Confirmed there was no existing CLI save-path option. The pending-load mechanism is browser-mediated, restricted to normal save roots, and therefore does not provide pre-listen hydration for live browser tests.
- Added `StartupGameLoad.js`:
  - parses `--load-game <save-directory>` and `--load-game=<save-directory>`;
  - resolves relative paths against the launch working directory;
  - rejects duplicate, missing, nonexistent, root, and non-directory targets with explicit errors;
  - delegates to the normal `performGameLoad()` helper using the arbitrary directory's parent and basename.
- Integrated startup hydration into `server.js`:
  - skips the dummy Adventurer and its background inventory generation when `--load-game` is present;
  - performs the full save load after configuration/image/lorebook initialization and before attaching/listening on the HTTP server;
  - aborts startup when hydration fails, including mod mismatch and save validation errors.
- Added `tests/startup_game_load.test.js` covering both CLI forms, relative/absolute resolution, invalid targets, delegation to the normal loader, pre-listen ordering, and dummy-player suppression.
- Updated `README.md`, `docs/api/game.md`, `docs/playwright.md`, and `docs/README.md`.
- Validation:
  - `node --check StartupGameLoad.js` passed.
  - `node --check server.js` passed.
  - `node --check tests/startup_game_load.test.js` passed.
  - `node tests/startup_game_load.test.js` passed all 5 tests.
  - A real server startup on port 4175 loaded the arbitrary-path save for Exis at Living Stair before logging that the port was listening.
  - Develop-web-game browser client completed without captured browser/page errors; inspected `tmp/startup-game-load-browser/shot-0.png` and confirmed Exis (level 5), Living Stair, saved chat history, and exits rendered correctly.
- `npm run test:e2e:headless` passed on a clean rerun with Playwright reporting no failed tests. The first attempt reached an unrelated Python directory server already occupying port 4173; after stopping that stale process, Playwright started this application's server and the suite passed.
- TODO: none for startup CLI game loading.

Original prompt: Stop the live tinybrain test, then make a tinybrain prompt retain its current queue spot until the entire staged prompt finishes instead of switching between queued prompts.

- Stopped the requested live browser probe and its test server at the user's direction.
- The probe used `config.yaml.qwen27B-ternary`, the newest timestamped Exis/Living Stair save, and submitted the exact text `"What do you make of this, Ilyarra?"` including the double quotes.
- The run reached tinybrain checkpoint 2, where the model repeatedly returned prose instead of `<accepted></accepted>` or `<rejected>...</rejected>`. The resumable parser correctly retried checkpoint 2; the run was stopped before retry exhaustion and never reached event processing.
- The server log showed `plot_analysis` and staged `player_action` calls interleaving because each `LLMClient.chatCompletion()` currently releases its semaphore permits independently.
- Added `LLMClient.withPromptQueueReservation(callback)` and opaque `queueReservation` support in `chatCompletion()`:
  - the first real reserved request acquires and retains its normal per-model permit and optional all-model permit;
  - later sequential requests reuse the permits across staged calls and transport retries;
  - concurrent reuse, semaphore-key changes, all-model configuration changes, and foreground/background priority changes fail explicitly;
  - permits release in `finally` on success or failure.
- Wrapped the complete tinybrain player-action runner in one reservation and passed it through every direct completion and tool-loop round.
- Added scheduler tests for per-model retention, all-model retention across a competing model key, and failure-path release, plus a source-level API integration assertion.
- Updated `docs/classes/LLMClient.md`, `docs/classes/TinyBrainPromptRunner.md`, `docs/api/chat.md`, `docs/server_llm_notes.md`, `docs/config.md`, and `docs/README.md`.
- Targeted validation:
  - syntax checks pass for all altered JavaScript and test files;
  - all 7 `llmclient.background_priority` tests pass, including transport-retry retention;
  - the new API integration assertion passes;
  - all 4 tinybrain runner tests and all 36 chat-tool-loop tests pass;
  - LLM force-output, network-retry-wait, prompt-progress, and Codex bridge files pass;
  - the Cline bridge file still has its unrelated local nvm/npm-prefix fixture launch failure;
  - the full plot-analysis scheduling file still has its pre-existing local-config assertion expecting `improvement_prompt.enabled: true` while the current local config is false.
- Full `npm run test:e2e:headless` passed: 33 passed and 4 opt-in scenarios skipped.
- Develop-web-game browser smoke completed without captured console/page errors; inspected `tmp/tinybrain-queue-reservation-smoke/shot-0.png` and confirmed the Play page, chat input, prompt-status area, and player sidebar render normally.
- TODO: none for tinybrain queue reservation.

Original prompt: Re-run the latest-save tinybrain test with `config.yaml.qwen27B-ternary`, then stop the server at the user's direction.

- Started the game on port 4175 with `config.yaml.qwen27B-ternary` and the latest timestamped Exis/Living Stair save.
- Submitted the exact chat text `"What do you make of this, Ilyarra?"`, including the double quotes.
- The revised tinybrain flow recovered from an invalid checkpoint-2 response on retry and advanced through checkpoint 8 into checkpoint 9; it had not reached event processing.
- Observed the player-action queue reservation retaining its queue slot throughout the staged calls while the independently queued plot analysis used the other configured global slot.
- Stopped both the server and the headless browser probe at the user's request. Port 4175 is clear.
- The interrupted browser result is in `tmp/tinybrain-live-rerun/result.json`; the progressive prompt log is `logs/2026-07-15T05-38-07-226Z_player_action_tinybrain_player_action.log`.
- TODO: none; the run was intentionally stopped before completion.

Original prompt: Keep one prompt-text viewer persistent throughout a tinybrain run, use distinct prompt/response colors, retry parse failures without exposing diagnostics to the model, and retain failed text in red.

- Added `progressGroupId` support to `LLMClient.chatCompletion()` and prompt-progress payloads. Every tinybrain checkpoint, retry, final response, and tool-loop round uses the render state's stable run id, so an opened viewer follows the logical run as individual stream ids change.
- Prompt viewers now render the current prompt in amber, live response in cyan, and ordered parse-failed responses in red. Empty/whitespace failed output is represented as `(empty response)`.
- Added immediate `prompt_progress_group_failure` broadcasts plus transient grouped failure history, so a completed response can be recolored even after its normal progress entry hold window.
- Tinybrain parse retries now remove the malformed terminal assistant response and resend the unchanged checkpoint conversation without appending the failed response, parser error, or backtrace to model messages. Preceding tool calls/results remain retained.
- Parse errors/backtraces continue to be written to the progressive prompt/server logs; only the raw failed response is exposed as red viewer display metadata.
- Updated `docs/classes/TinyBrainPromptRunner.md`, `docs/classes/LLMClient.md`, `docs/ui/modals_overlays.md`, `docs/server_llm_notes.md`, `docs/api/chat.md`, and `docs/README.md`.
- Validation:
  - JavaScript syntax checks passed for all altered runtime/test files.
  - SCSS compiled successfully to `public/css/main.css`.
  - Tinybrain runner tests pass: 4/4.
  - LLM prompt-progress tests pass: 10/10.
  - Prompt-progress dock/UI source tests pass: 15/15.
  - Tinybrain API integration assertion passes; the same test file retains its known unrelated local-config failure because `config.yaml` has `improvement_prompt.enabled: false` while the fixture expects true.
  - Focused prompt-viewer Playwright tests pass: 3/3.
  - Full `npm run test:e2e:headless` passes: 34 passed, 4 opt-in scenarios skipped.
  - Inspected `tmp/tinybrain-prompt-viewer.png`: one viewer advanced from stage 1 to stage 2 and visibly showed amber prompt, red failed response, and cyan retry response.
  - Required reusable browser smoke client passed without reported browser errors; inspected `tmp/tinybrain-persistent-viewer-smoke/shot-0.png` and confirmed the idle Play UI remained intact.
- Test servers were stopped; ports 4173 and 4175 are clear.
- TODO: none.

Original prompt: Implement the follow-up API playtest acceleration plan.

- Added strict version-2 logical completion cassettes with semantic request fingerprints, atomic recording, ordered replay, completeness/consumption checks, API status/control endpoints, and unchanged legacy forced-output compatibility.
- Added the declarative follow-up scenario harness, persistent realtime session support, mechanical assertions, focused triage reports, canonical fixture promotion/runtime-copy tooling, and isolated configuration-profile generation/preflight.
- Added focused cassette and harness tests. Syntax checks and the combined cassette/legacy-force-output/harness test set pass.
- The synthetic harness test now injects API/realtime dependencies, so it verifies the full scenario/triage path without binding forbidden local sockets in a restricted test environment.
- TODO: convert and fix the VEH-7 swallowed off-route redirect failure, promote its canonical fixture/scenario, finish documentation, and run the broader/final verification sequence.

Original prompt: Do not load mmproj for qwen-combo-router models.

- Added `scripts/start-qwen-combo-router.sh`, which passes llama.cpp's supported `--no-mmproj` flag to the shared Prism router launcher without deleting the installed projector files.
- Pointed `config.yaml.qwen-combo-router` at the text-only wrapper and documented why this is required for slot persistence.
- Live verification showed router directory discovery still emitted an explicit child `--mmproj` after `--no-mmproj`; added `config/llama-qwen-combo-text-only.ini` to override both configured Qwen projectors with empty paths while preserving the files on disk.
- Restarted with the latest save and verified both Qwen router entries advertise only `text` input modality. The loaded 27B worker receives an empty `--mmproj` value and does not initialize multimodal support.
- Live slot 0 verification now succeeds: the router saved an empty 1,184-byte cache, restored it, and the client immediately deleted it. No cache file remained.
- Focused wrapper/preset and affected configuration tests pass (21 assertions), and the required browser smoke passed; inspected `tmp/qwen-text-only-smoke/shot-2.png` and confirmed the Play screen remains intact.
- TODO: none.

Original prompt: Implement the backend scope of docs/ten_turn_api_playtest_followup_plan.md using the declarative API scenario harness, immutable fixtures, config profiles, strict v2 cassettes, mechanical assertions, and triage artifacts.

- In progress: reconciled the goal with the 18-system follow-up plan; UI/Playwright-only checkpoints are excluded, and all prose-quality requirements remain human-review notes rather than executable wording checks.
- Extended scenario dataflow for broad conversion: uniquely named snapshots and request/chat/save/reload responses can feed later routes, bodies, and assertions through strict `$snapshot` / `$response` variables.
- Extended mechanically knowable assertions with named before/after sources, numeric comparisons, and exact structured array-object counts. No prose regex, classifier, keyword, or dialogue checks were added.
- Added harness coverage for duplicate names, runtime variable propagation, named-source comparisons, numeric assertions, structured object counting, and emitted snapshot artifacts.
- Verification: JavaScript syntax checks pass and `npm run test:followup-harness` passes all three harness/cassette test files.
- Next: promote the canonical broader-combat fixture and convert COMBAT backend cases in execution-order batches, then apply strict replay/live verification to model-backed paths.

Original prompt: When using llama.cpp locally in router mode, save slot 0 before switching models, unload the old model, load the new model, restore that model's saved slot cache when present, immediately delete the restored cache file, and restart afterward.

- Traced the existing `unload_model_on_switch` transaction and the configured local router startup script.
- Confirmed the router starts llama.cpp with `--slot-save-path /dev/shm`; slot save/restore accepts a safe relative filename, so the game can verify and delete `/dev/shm/<filename>` after a successful restore.
- Added model-specific slot-cache filenames and strict llama.cpp slot 0 save/restore response validation. Successful restores immediately delete their consumed files; deletion failure remains explicit.
- Local game-owned router switches now save the old slot, unload the old model, load the replacement, restore its cache when present, and only then send the prompt. Save and restore failures warn to the console and continue, while model unload/load failures remain fatal.
- Added the absolute `ai.router_slot_cache_directory` setting with a `/dev/shm` default and enabled it explicitly in the qwen-combo-router configuration.
- Focused router-client and LLM switch tests cover ordered save/unload/load/restore, first-use cache absence, restored-file deletion, nonfatal save/restore warnings, and strict post-restore deletion errors.
- Restarted with `config.yaml.qwen-combo-router` and the latest save after an unrelated active ComfyUI MiniMax H3 render released VRAM. The router preloaded the configured 27B model and the game became ready on port 7777.
- The live router accepted the slot request path but returned HTTP 501 (`This feature is not supported by multimodal`) for the Qwen model loaded with mmproj. This exercises the intended nonfatal warning path; actual cache retention for these configured models depends on llama.cpp adding multimodal slot persistence or running them without multimodal projection.
- Required reusable browser smoke passed against the restarted server; inspected `tmp/local-router-cache-smoke/shot-2.png` and confirmed the loaded Play screen is intact with no prompts running.
- TODO: none.

Original prompt: Create a ComfyUI workflow that accepts multiple prompts and performs list-based prompt encoding, rendering, and VAE decoding; enable it through `imagegen.batch_prompts` and the qwen-combo-router configuration. Batch render jobs by resolution.

- Inspecting the configured Krea 2 workflow, installed ComfyUI list nodes, image-job queue lifecycle, qwen-combo-router configuration, and example batch workflows.
- Confirmed the list workflow will retain the configured Krea 2 UNet, CLIP, VAE, and both LoRAs. Render batches will be keyed by effective workflow plus exact width and height.
- Added the list-capable Krea 2 lovely workflow using Impact Pack list outputs so ComfyUI executes all prompt encodes, then all samplers, then all VAE decodes/scales/saves.
- Added strict Comfy render batching, per-job result attachment, shared prompt cancellation/progress, exact output-count validation, configuration/UI support, and qwen-combo-router workflow selection.
- Focused workflow, resolution-grouping, lifecycle, prompt-batching, weather-variant, progress, and dimension tests pass. Documentation now distinguishes LLM prompt-writing batches from final Comfy render batches.
- The merged qwen-combo-router config resolves the new workflow with 1600×1600 default, 1200×1600 character, 1920×1080 location, and 1600×1200 scenery batches.
- Live ComfyUI object metadata confirms Impact Pack list output, core integer primitives, VAE Utils decoding, and metadata saving are installed with the expected list-mapping contract. The Comfy queue was empty and no render was submitted, so validation did not load a model or consume VRAM.
- Temporary startup validation passed with the new workflow and batch flag. The required Play/browser and System Configuration smoke checks completed without console/page errors; inspected `tmp/comfy-batch-browser-smoke/shot-0.png` and `tmp/comfy-batch-config-control.png`. The temporary port-4173 server was stopped.
- TODO: none.

Original prompt: In configurations such as `config.yaml.qwen-combo`, terminate the currently managed local model and start the replacement when a prompt switches to a model with a different `local_startup_script_path`; reuse the process when the startup path is unchanged.

- Confirmed the combo configuration uses `/home/bart/prism-llama-bonsai-27b/start-qwen-35b-a3b.sh` for its base 35B model and `/home/bart/prism-llama-bonsai-27b/start-qwen.sh` for its prose 27B override; both files exist and are executable.
- Added managed startup-script identity tracking and switching. Identical normalized paths retain the current PID; different paths wait for the old detached process group to exit, clear ComfyUI VRAM, start the replacement, and wait for readiness before prompt transport.
- Managed-local prompt transports now hold exclusive model-lifecycle access through script selection and transport, preventing another prompt from replacing a model that is still in use. Missing handlers, dead managed processes, stop failures, cleanup failures, replacement startup failures, and readiness failures propagate explicitly without sending the prompt.
- Server startup validates every effective managed-local startup script referenced by base AI configuration or active prompt override labels, rather than discovering a non-executable replacement only after stopping the current model.
- The active startup identity remains on `LocalLlamaServerProcess`, so image rendering restarts the model selected by the most recent prompt instead of reverting to the initial script.
- JavaScript syntax checks and focused local-process, managed-switch, lifecycle-gate, router-switch, image-lifecycle, image-batching, and configuration tests pass.
- Updated `docs/classes/LocalLlamaServerProcess.md`, `docs/classes/LLMClient.md`, `docs/config.md`, `docs/server_llm_notes.md`, and `docs/README.md`.
- Live port 7777 was verified outside the sandbox; the older `config.yaml.qwen27B` game and managed llama processes were stopped cleanly, then the server was started with `config.yaml.qwen-combo` and no explicit game load.
- Combo startup passed configuration validation, strictly cleared ComfyUI, launched the base 35B-A3B script as managed PID 3475602, and reached healthy llama.cpp and game endpoints.
- The required reusable browser client completed without a console/page-error artifact. Visual inspection of `tmp/qwen-combo-local-switch-smoke/shot-0.png` confirms the fresh default-game Play UI renders normally.
- TODO: none.
Original prompt: Diagnose the stuck player-action prompt, fix it, and restart the server with `config.yaml.qwen-combo`.

- Traced the live TinyBrain transcript to `alterLocation` for Herbal Alchemy Shop Interior. The tool started its nested `alter_location` completion, but that request never reached override resolution or transport while llama.cpp was idle.
- Root cause: the outer 27B TinyBrain run retained the only process-wide prompt permit (`max_concurrent_requests_all_models: 1`) across tool execution, while the nested 35B alteration prompt waited for that same permit. The parent waited for the tool and the tool waited for the parent, leaving grouped progress active with no tracked transport for Stop & Undo to abort.
- Added an explicit queue-reservation yield operation. It releases the outer per-model and all-model permits around nested prompt work, then reacquires the exact original reservation at the front of both queue lanes even when the nested callback fails.
- The chat-tool loop applies yielding only to tools known to launch LLM work: `alterLocation`, `alterNpc`, `alterThing`, `createNpc`, `createQuest`, `createThing`, and `rerunSceneSummary`. Ordinary synchronous tools continue to retain the TinyBrain reservation uninterrupted.
- Added regression coverage for a staged outer prompt calling a different-model nested prompt under a global cap of one, callback-failure reacquisition, and `alterLocation` tool-loop integration.
- Focused JavaScript syntax checks and four related queue, tool-loop, managed-model, and lifecycle suites pass. The standalone real-template TinyBrain file retains its documented unrelated checkpoint-count fixture failure (`0 !== 8`).
- Updated `docs/classes/LLMClient.md`, `docs/classes/TinyBrainPromptRunner.md`, `docs/api/chat.md`, `docs/server_llm_notes.md`, and `docs/README.md`.
- Stopped the wedged server and its orphaned 27B managed process, then restarted port 7777 with `config.yaml.qwen-combo`. Startup launched the configured base 35B-A3B model as managed PID 3515450 and loaded pre-turn autosave `2026-08-06T03-59-29-641Z_Monster_Girl_Life_2026-06b-Baato-Herbal_Alchemy_Shop_Exterior-char_2-msgzlmcp`.
- Both `/api/hello` and llama.cpp `/health` pass. The required browser smoke produced no console/page-error artifact; visual inspection of `tmp/tinybrain-nested-prompt-yield-smoke/shot-0.png` confirms Baato is restored at Herbal Alchemy Shop Exterior and the UI reports no prompts running.
- TODO: none.
Original prompt: The recently added comfyui image spinner and progress bar doesn't appear to be working with item/scenery images. Also, precompute what size the character portraits will be based on their configured resolution and style the empty ones to that size. Note that the player portrait is a special case and needs to be handled separately.

- Auditing item/scenery image-host matching and the character/player portrait rendering paths before implementation.
- Root cause found: thing render jobs publish stored `item`/`scenery` entity types while every item/scenery DOM image host is keyed as `thing`.
- Implemented client-side canonical image entity keys, preserving the server/API type detail while matching item/scenery jobs to thing hosts.
- Added server-precomputed effective character dimensions with `character_settings.image` -> `default_settings.image` fallback, configured portrait aspect-ratio CSS variables, a shared NPC/party/modal portrait rule, and a separate player-sidebar portrait rule.
- Added source and Playwright regression coverage for item/scenery progress overlays and pre-sized empty portraits.
- Rebuilt `public/css/main.css` from `public/css/main.scss`.
- Validation passed: JavaScript/test syntax checks, 11 focused image-related Node suites, the 2-case focused Chromium spec, the required reusable browser-game smoke client, and the full Chromium suite (42 passed, 4 fixture-gated skips).
- Visually inspected `tmp/image-render-progress-overlays.png`, `tmp/character-portrait-placeholder-sizing.png`, and `tmp/image-progress-portrait-smoke/shot-0.png`; item/scenery spinners and bars are visible, seasonal location translucency remains intact, and empty NPC/party/player portraits reserve the configured ratio.
- Updated `docs/api/images.md`, `docs/config.md`, `docs/ui/chat_interface.md`, `docs/ui/assets_styles.md`, and `docs/README.md`.
- TODO: none.

Original prompt: Make the same tools available across all non-generic base-context prompts. For prompts that previously had no tools, prepend "Do not make tool calls." immediately after the base context.

- Added an internal end-of-base-context marker immediately before every prompt-specific base-context include.
- Added centralized `LLMClient` policy that replaces every non-generic base-context request's tool payload with one ordered built-in-plus-mod schema.
- Generic prompts explicitly bypass the shared schema and retain their prior tools and tool-choice behavior.
- Previously tool-less base-context requests receive `Do not make tool calls.` at the internal boundary before their prompt-specific instructions.
- Corrected scheduled-event, plot-analysis, and mystery-box-update tool-loop request options so their existing tool definitions are passed through `additionalPayload` and count as previously tool-enabled.
- Explicit `tool_choice: none` remains disabled while retaining the canonical schema, so an exhausted tool loop cannot be re-enabled by normalization or cause a schema cache divergence.
- Updated `docs/classes/LLMClient.md`, `docs/classes/TinyBrainPromptRunner.md`, `docs/classes/Events.md`, `docs/server_llm_notes.md`, `docs/api/chat.md`, `docs/config.md`, `docs/slop_and_repetition.md`, and `docs/README.md`.
- Validation:
  - JavaScript syntax checks pass for `LLMClient.js`, `api.js`, `Events.js`, and the focused tests.
  - Base-context render/policy and actual outbound transport tests pass, including shared ordered schemas, exact no-tool instruction placement, generic exclusion, marker removal, recent-story chronology, and explicit tool-choice disabling.
  - Related LLMClient, base-context history, chat-tool loop, scheduled-event, plot-analysis, mystery-box/event parser, container-open, and TinyBrain focused suites all pass.
  - Full `npm run test:e2e:headless` passes: 35 passed and 4 fixture-dependent scenarios skipped.
  - The required reusable browser smoke client completed without a browser error artifact; inspected `tmp/base-context-shared-tools-smoke/shot-0.png` and confirmed the live Play interface renders normally.
- No SCSS files changed, so no stylesheet compilation was required.
- TODO: restart the live game when the user wants the running process to load this change.

Original prompt: Add a chat-message boundary immediately before recentStoryHistory so recurrent llama.cpp models can checkpoint the cache-stable base-context prefix.

- Added a caching-only internal boundary marker immediately before `<recentStoryHistory>` in `base-context.xml.njk`.
- Added outbound `LLMClient` expansion that removes the marker and sends the stable prefix and recent-story suffix as two consecutive user messages before cachebusting or transport.
- Added focused template and outbound-payload regression coverage.
- Confirmed the real rendered base-context text splits exactly before `<recentStoryHistory>` and recombines byte-for-byte after removing the internal marker.
- Added TinyBrain transcript-order coverage for a retained marker-bearing first user message followed by assistant and later user messages.
- Updated `docs/classes/LLMClient.md`, `docs/server_llm_notes.md`, `docs/config.md`, and `docs/README.md`.
- Validation:
  - Syntax checks pass for the altered runtime and test files.
  - Focused base-context and outbound-payload tests pass (8/8 and 16/16); related LLMClient/base-context regression suites also pass.
  - The targeted TinyBrain runner coverage passes. The full TinyBrain runner file retains one unrelated pre-existing conditional-parser fixture failure that does not load `base-context.xml.njk` or call `LLMClient`.
  - llama.cpp's `/apply-template` endpoint confirmed that the active `peg-native` template preserves the two consecutive user messages as distinct chat turns.
  - Full `npm run test:e2e:headless` passed: 35 tests passed and 4 opt-in scenarios skipped.
  - The required reusable browser smoke client completed without reported browser/page errors. Inspected `tmp/recent-story-boundary-smoke/shot-0.png` and confirmed the live Play interface renders normally.
- TODO: restart the live game when the user wants the running process to load this change.

Original prompt: Change base-context history so automatic scene summarization occurs at the configured unsummarized boundary and prompts show only genuinely unsummarized entries raw, keeping the summarized prefix stable between summary batches.

- Confirmed automatic scene summarization already triggers when the shared scene-summary index reaches `summaries.max_unsummarized_log_entries`.
- Identified the prompt-assembly defect: `buildBasePromptContext()` independently slides `relevantHistory.slice(-max_unsummarized_log_entries)` on every render instead of using stored contiguous scene-summary coverage.
- Implementation defaults confirmed: uncovered history may exceed the configured boundary while summarization is pending/failed; non-indexed event-summary rows follow the contiguous coverage frontier; summarization remains nonblocking.
- Added `SceneSummaries.getContiguousSummarizedEndIndex()` and made `getFirstUnsummarizedIndex()` derive from the same contiguous coverage calculation.
- Added `partitionBaseContextHistoryBySceneCoverage()` and switched scene-style base-context assembly from a sliding last-N raw window to the stored contiguous scene-summary frontier.
- Covered records remain capped by `max_summarized_log_entries`; every uncovered prompt-visible record remains raw, including event-summary rows after the frontier. Raw history may exceed the configured trigger while summary generation is pending or failed.
- Line-summary saves retain their existing per-entry window behavior; automatic scene summarization remains nonblocking and still triggers at `max_unsummarized_log_entries`.
- Added regression coverage for contiguous gaps, event-summary boundary placement, preservation of more raw records than the configured trigger, and prefix stability as uncovered entries are appended.
- Updated `docs/classes/base_context_history.md`, `docs/classes/SceneSummaries.md`, `docs/config.md`, and `docs/README.md`.
- Validation:
  - Syntax checks pass for all altered runtime and new test files.
  - Focused history/summary tests pass; the broader related run passed 14 files and exposed only two unrelated stale `quantity 1` expectations in `tests/base_context_inventory_value.test.js`.
  - The current autosave contains 72 uncovered scene-index entries and 108 prompt-visible uncovered records; the new partition retains all 108 instead of hiding eight behind the former 100-record window.
  - Full `npm run test:e2e:headless` passed: 35 tests passed and 4 opt-in scenarios skipped.
  - The required reusable browser smoke client completed without reported browser/page errors against a temporary dummy-game server. Inspected `tmp/history-coverage-browser-smoke/shot-0.png` and confirmed the Play interface renders normally.
- TODO: restart the live Q35B-A3B server when the user wants the running process to load this change.

Original prompt: Add a brief note to the `moreInfo` description not to call it for items or characters whose full XML is already visible because the result would be redundant.

- Updated the model-facing `moreInfo` tool description with the requested redundancy warning.
- Added a tool-definition regression assertion.
- Updated `docs/api/chat.md` and `docs/README.md`.
- Validation:
  - `node --check chat_tool_calls.js` passed.
  - `node --check tests/chat_tool_calls.test.js` passed.
  - All 37 chat-tool-loop tests passed.
  - No Playwright was run, honoring the user's manual-testing preference.
- TODO: none.

Original prompt: The N/A-normalizing tinybrain parser should treat a trimmed response that starts or ends with N/A as N/A.

- Updated `parseResponseOrNa()` to return `false` when a trimmed response begins or ends with a standalone `N/A` token.
- The boundary matcher accepts `N/A`, `N.A.`, and compact `NA` variants while avoiding substring matches inside words such as `narrative` and `banana`.
- Added focused start/end and false-positive regression cases to `tests/tiny_brain_prompt_runner.test.js`.
- Updated `docs/classes/TinyBrainPromptRunner.md` and `docs/README.md`.
- Validation:
  - `node --check TinyBrainPromptRunner.js` passed.
  - `node --check tests/tiny_brain_prompt_runner.test.js` passed.
  - All 4 tinybrain runner/template tests passed.
  - No Playwright was run, honoring the user's manual-testing instruction.
- The already-running qwen server was deliberately left untouched to avoid interrupting the user's active manual session; it must be restarted before it will use this code change.
- TODO: restart the qwen server when the user is ready.

Original prompt: Re-run the qwen-configured server after the N/A parser change.

- Stopped the prior qwen server and restarted it with `--config-override config.yaml.qwen27B-ternary`.
- The restarted server is listening on port 7777 and now includes the boundary-aware N/A parser change.
- No Playwright was run.
- TODO: none.

Original prompt: Add a persisted `imagePrompt` field to every image-capable entity, update it when prompts are generated, expose it in entity editors, and add `Regenerate Image (same prompt)` context-menu actions without changing initial entity-generation behavior.

- Added blank-by-default, validated, persisted `imagePrompt` state to Player/NPC, Thing, Location, and LocationExit models and their save hydration/API serialization paths.
- Initial player/NPC, item/scenery, location/stub, and exit creation remains unchanged: constructors never generate prompts and the new field starts blank.
- Final prompts are stored immediately before image jobs are queued for normal, deterministic exit, and user-confirmed prompt paths. `/api/images/prompt` also stores its returned editable final prompt. Weather/lighting variants do not overwrite a location's base prompt.
- Added `/api/images/request` support for `useExistingPrompt: true`; it bypasses prompt generation, rejects conflicts with an explicit `prompt`, and returns `409` when no saved prompt exists.
- Added editable Image Prompt fields to the shared player/NPC, Thing, hydrated Location, and exit edit modes. Thing creation, stub editing, and exit creation keep the field hidden/blank.
- Added `Regenerate Image (same prompt)` to player/NPC, Thing, current-location, and map-location image context menus. Location request failures restore the pre-request image in the client.
- Excluded Thing `imagePrompt` from stack checksums so prompt generation/editing does not alter stack compatibility.
- Automatic image-manager requests broadcast stored prompt updates back into current client entity caches.
- Updated Player, Thing, Location, LocationExit, images API, chat UI, modal UI, and documentation index references.
- Validation:
  - JavaScript syntax checks passed for every altered runtime and test file.
  - Focused model, serialization, hydration, API, generator, UI-source, race, variant, checksum, and mod-extension tests all pass.
  - Full `npm run test:e2e:headless` passes: 35 passed, 4 opt-in scenarios skipped.
  - Focused browser inspection confirmed the location context menu renders `Regenerate Image (same prompt)` and the Location editor renders an editable Image Prompt textarea without page errors. Screenshots are in `tmp/entity-image-prompt-location-menu.png` and `tmp/entity-image-prompt-location-editor.png`.
- TODO: none.

Original prompt: Make it so abilties are alphabetized in any modal they show up in.

- Audited the documented ability-bearing modals. The player sidebar ability picker already alphabetizes its cards; the level-up picker, character View modal, and character Edit modal still need the same ordering.
- Added focused regression coverage for one shared, non-mutating, case-insensitive modal ability sorter and all four modal render paths.
- Added `alphabetizeAbilities()` in `views/index.njk` and routed the player ability picker, level-up ability selection, character View cards, and character Edit rows through it.
- Targeted modal ability tests pass, including existing player picker and declined-option behavior coverage.
- Updated `docs/ui/modals_overlays.md`, `docs/ui/chat_interface.md`, and `docs/README.md` to document alphabetical ability ordering in every modal.
- Validation:
  - `node --test tests/ability_modal_sorting.test.js tests/player_abilities_modal_ui.test.js tests/player_ability_selection_declined.test.js` passed.
  - Full `npm run test:e2e:headless` passed: 35 tests passed and 4 opt-in scenarios skipped.
  - The required reusable browser smoke client opened the live player Abilities modal from a loaded save without console/page errors.
  - Inspected `tmp/ability-modal-smoke/shot-0.png` and confirmed the visible cards are alphabetized by ability name.
- TODO: none.

Original prompt: In the modal that shows the prompt as it's running, check the Follow button by default.

- New prompt-progress viewer windows now initialize with `followStream: true`, so the `Follow` checkbox is checked and the combined prompt/response pane follows streamed updates immediately.
- Users can still uncheck `Follow` for an individual open viewer; subsequent syncs preserve that viewer-local choice.
- Added source-level and Playwright assertions for the checked-by-default state.
- Updated `docs/ui/modals_overlays.md`, `docs/ui/chat_interface.md`, and `docs/README.md`.
- Validation:
  - JavaScript syntax checks passed for all altered runtime and test files.
  - All 15 focused prompt-progress dock/UI source tests passed.
  - The focused Playwright prompt-progress suite passed: 3/3, including the checked-by-default assertion.
  - Inspected `tmp/tinybrain-prompt-viewer.png`; Follow is visibly checked and the existing prompt/failed/response color treatments remain intact.
  - The required reusable browser smoke client passed against the live Kimi-backed server without reported page or console errors; `tmp/follow-default-webgame/shot-0.png` confirms the Play UI still renders normally.
- TODO: none.

Original prompt: Restart the server, then make TinyBrain prompts share one AI Prompts progress bar across all sub-prompts, with the grouped bar blue while no sub-prompt is actively streaming.

- Restarted the live game on port 7777 with `config.yaml.qwen35B-A3B`; the server loaded the preceding shared base-context tool changes.
- Changed grouped `LLMClient` progress tracking to reuse one stable entry/id across every sequential request with the same `progressGroupId`, including TinyBrain checkpoints, retries, and tool-loop rounds.
- A completed sub-request now leaves that entry active as `isGroupWaiting: true` with a full progress fraction. The next request resets the same entry's per-stage prompt, preview, counts, target, timeout, and retry state; only `clearPromptProgressGroup()` supplies the final completion pulse/removal.
- The dock's collapsed, one-line, and table bars plus open-modal aggregate bars render grouped waiting state in blue. One-line/table percent text says `waiting`; view remains enabled while retry/cancel are disabled until the next request starts.
- Added server lifecycle, UI-source, and Chromium coverage. The focused server/UI tests and four prompt-progress Playwright scenarios pass.
- Compiled `public/css/main.scss` to `public/css/main.css`.
- Updated `docs/classes/LLMClient.md`, `docs/classes/TinyBrainPromptRunner.md`, `docs/server_llm_notes.md`, `docs/ui/modals_overlays.md`, `docs/ui/chat_interface.md`, and `docs/README.md`.
- Inspected `tmp/tinybrain-shared-progress-blue-dock.png` and `tmp/tinybrain-shared-progress-blue.png`; the single waiting row and modal bar are visibly blue.
- Full `npm run test:e2e:headless` passed: 36 tests passed and 4 opt-in scenarios skipped.
- The required reusable browser smoke client completed without a browser-error artifact; `tmp/tinybrain-shared-progress-smoke/shot-0.png` was inspected and renders the Play UI normally.
- The relevant TinyBrain runner cases pass. One unrelated pre-existing real-template fixture remains stale (`expected 8`, `actual 0`).
- Restarted the live game again with `config.yaml.qwen35B-A3B` after implementation; the refreshed server is ready on port 7777 and `/api/hello` responds normally.
- TODO: none.

Original prompt: Make TinyBrain grouped progress accumulate received output across sub-prompts; keep the blue waiting bar at that accumulated progress and display its percentage instead of `waiting`.

- Confirmed the tracker measures decoded output characters (the UI labels the count as `chars`), so this change will accumulate that existing received metric rather than inventing an inaccurate token estimate.
- The cumulative percentage will use the sum of each sub-prompt's target estimate selected when that sub-prompt begins. Per-stage latency/rate accounting and completion logs will remain per-stage.
- Grouped progress now preserves `receivedCount`/`bytes`, accumulates `targetCharacters`, and records a stage-start received offset so rate/log output remains per-stage.
- Waiting entries no longer force `progressFraction: 1`; the browser percent formatters render their real exact/approximate percentage instead of `waiting`.
- Focused lifecycle/UI source tests pass. The four-scenario Chromium prompt-progress suite passes.
- Inspected `tmp/tinybrain-shared-progress-blue-dock.png` and `tmp/tinybrain-shared-progress-blue.png`; the blue waiting fill is visibly partial and the dock reads `84 chars ~35%`.
- Updated the LLMClient, TinyBrain runner, server LLM, prompt dock/modal, and documentation index notes.
- Full `npm run test:e2e:headless` passed: 36 tests passed and 4 opt-in scenarios skipped.
- The required reusable browser smoke passed after rerunning outside the restricted Chromium sandbox. `tmp/tinybrain-cumulative-progress-smoke/shot-0.png` was inspected and the Play UI renders normally with no browser-error artifact.
- Restarted the live server with `config.yaml.qwen35B-A3B`; it is ready on port 7777 and `/api/hello` responds normally.
- TODO: none.

Original prompt: Restart the server first, then fix TinyBrain grouped progress so it uses total received output over one fixed total expected output for the whole multiprompt instead of shrinking at each sub-prompt.

- Restarted the live Q35B-A3B game server before beginning the fix; port 7777 responds normally.
- Root cause: each stage preserved the numerator but added a new stage target to the denominator before receiving more output, making the displayed percentage fall at every boundary.
- Chosen fix: select one dedicated multiprompt target at group start, preserve it for the run, use the direct accumulated-received / fixed-expected ratio, skip per-stage output-stat samples, and record one aggregate sample only after a successful full run.
- Implemented required `progressGroupTargetLabel` support in `LLMClient`; player-action TinyBrain uses `player_action_tinybrain`, whose historical average or `player_action*` configured value is selected once and preserved.
- Grouped sub-requests no longer write individual output-character samples. A successful non-rejected run records its accumulated total once when the group clears; errors and early rejection do not affect the expected-total history.
- Grouped `progressFraction` is now the direct accumulated received count divided by the fixed group target. Focused lifecycle coverage confirms stage two begins at exactly stage one's waiting percentage and rises after new output.
- Focused LLM lifecycle and four-scenario Chromium progress tests pass. The relevant API source integration test passes; the containing test file still has an unrelated existing local-config expectation failure for `improvement_prompt.enabled`.
- Inspected `tmp/tinybrain-multiprompt-progress-monotonic.png`; the single blue TinyBrain row shows the accumulated `120 chars` at `~50%` after the next stage, with no boundary reset or percentage drop.
- Full `npm run test:e2e:headless` passed: 36 tests passed and 4 opt-in scenarios skipped.
- The required reusable browser smoke passed outside the restricted Chromium sandbox. `tmp/tinybrain-fixed-total-smoke/shot-0.png` was inspected, the Play UI renders normally, and no browser-error artifact was produced.
- Updated LLMClient, TinyBrain, server-flow, prompt dock/modal, and documentation-index notes.
- Restarted the finished server with `config.yaml.qwen35B-A3B`; exactly one process owns port 7777 and `/api/hello` responds normally.
- TODO: none.

Original prompt: Make every TinyBrain prompt, including event checks and future TinyBrain runners, keep one progress bar across sub-prompts; use the ordinary asymptotic progress curve and track one whole-run average.

- Root cause: player actions manually owned their queue/progress-group lifecycle in `api.js`, while the TinyBrain XML event-check integration called `TinyBrainPromptRunner` without any group. Event-check stages therefore completed and cleared as independent prompts.
- Moved queue reservation, async-scoped progress grouping, parse-failure reporting, final clearing, and aggregate-stat recording into `TinyBrainPromptRunner.run()` itself. Every current or future runner instance now receives the behavior without prompt-specific lifecycle code.
- Added `LLMClient.withPromptProgressGroup(...)`, which makes every nested `chatCompletion()` and tool-loop round inherit one stable group id and dedicated `<metadataLabel>_tinybrain` target. Conflicting or nested group scopes fail explicitly.
- Player actions use `player_action_tinybrain`; TinyBrain event checks use `event_checks_tinybrain`. Event `<done/>` is a successful whole-run completion and records the aggregate, while failed runs and rejected player actions do not alter the average.
- Grouped progress now calls the same `calculatePromptProgressFraction(...)` curve as single prompts: 75% at the fixed expected whole-run total, then an asymptotic approach to 100%. Received output and target remain unchanged at stage boundaries, so the percentage stays monotonic.
- Focused LLM progress, event TinyBrain, queue/concurrency, chat-tool-loop, prompt-dock, reusable future-runner lifecycle, and player-action integration tests pass. The full real-template runner file retains its unrelated existing stale fixture expectation (`expected 8`, `actual 0`), and the full API scheduling file retains its unrelated local `improvement_prompt.enabled` expectation.
- Focused Chromium prompt-progress coverage passed 4/4. Inspected `tmp/tinybrain-multiprompt-progress-monotonic.png`; the blue shared row displays `120 chars ~37%`, the asymptotic value at half the target rather than the old direct 50%.
- Full `npm run test:e2e:headless` passed: 36 tests passed and 4 fixture-dependent scenarios skipped.
- Updated `docs/classes/LLMClient.md`, `docs/classes/TinyBrainPromptRunner.md`, `docs/classes/Events.md`, `docs/server_llm_notes.md`, `docs/config.md`, `docs/ui/modals_overlays.md`, `docs/ui/chat_interface.md`, and `docs/README.md`.
- Restarted the live server with `config.yaml.qwen35B-A3B`; exactly one process owns port 7777 and `/api/hello` responds normally.
- The required reusable browser smoke passed with no browser-error artifact. Inspected `tmp/tinybrain-universal-progress-smoke/shot-0.png`; the Play UI renders normally.
- TODO: none.

Original prompt: For the housekeeping prompt, send the history of every turn since its last run (including the current turn), grouped with player-action text, prose, and event text; if it has never run, use the configured housekeeping interval worth of context.

- Audited the existing prompt timing and chat-history layout. Player action/prose is stored before event checks, while finalized event summaries are available only after event outcomes, so the housekeeping LLM request must run after event processing to include the complete current turn.
- Added turn-history grouping and a persisted `lastHousekeepingTurnId` successful-run boundary. First-run context uses the latest configured interval worth of player turns; later runs use every turn after the boundary through the current one.
- The prompt now receives ordered `<housekeepingTurnHistory>` records containing `<playerAction>`, `<prose>`, and `<eventText>`, with an explicit instruction to examine every record rather than only the final turn.
- Current-turn context is supplemented with canonical checked prose and formatted finalized event/status results before normal event-summary chat entries are recorded. Hidden-note variants do not duplicate the current prose.
- Automatic housekeeping is scheduled before event checks for interval accounting but invoked only after event results are finalized. Recursive/suppressed and split-movement single-pass semantics remain intact.
- Added focused history-selection, prompt-rendering, event-ordering, and source-wiring tests; updated Events, chat API, save/load, config, slash-command, and documentation-index notes.
- Validation passed: JavaScript syntax checks, 12 focused unit/source suites, direct Nunjucks history rendering, and the full Chromium suite (36 passed, 4 fixture-gated scenarios skipped).
- The required reusable browser smoke client completed against the live game without a browser-error artifact. Inspected `tmp/housekeeping-history-smoke/shot-0.png`; the Play UI renders normally.
- The actively used live server was not restarted, so it still needs a later restart to load this backend change.
- TODO: none.

Original prompt: Restart the server. Then add an enable/disable and interval config for the tonal scale check, with an interval of 5 by default.

- Restarted the live server first with the same `config.yaml.kimi` override. Port 7777 is healthy, and the preceding housekeeping-history backend change is loaded.
- Audit result: runtime enable gating, strict boolean/integer validation, persisted cadence, `enabled: true`, and `interval: 5` already exist. The missing surface is the System Configuration form, which currently exposes neither tonal-scale setting.
- Added a Tonal Scale Evaluation section to System Configuration with an enabled checkbox and integer interval field. The checkbox submits an explicit false value when cleared; the interval defaults to 5 and requires at least 1.
- Added source-level and Chromium coverage for defaults plus enabled/disabled form submissions, and documented the controls in `docs/config.md` and `docs/README.md`.
- Inspected `tmp/tonal-scale-config-controls/shot-0.png`; the live configuration page visibly shows the enabled control checked and interval 5.
- Validation passed: focused tonal-scale unit tests, JavaScript syntax checks, the focused config-page browser test, and the full Chromium suite (37 passed, 4 fixture-gated scenarios skipped).
- The restarted live server remains running on port 7777 and `/api/hello` responds normally.
- TODO: none.

Original prompt: Add an AI model setting `unload_during_image_generation`, default false. When enabled, batch any additional image-prompt generation immediately, unload the active llama.cpp router model before Comfy renders, and reload it after all renders finish, asking ComfyUI to unload its models first when possible.

- Began by auditing the documented image prompt batching/render-job lifecycle, ComfyUI client surface, AI model configuration, and llama.cpp router integration before changing concurrency behavior.
- Added the default-false `ai.unload_during_image_generation` setting, prompt-specific override resolution, strict backend/engine validation, and a System Configuration checkbox.
- Added a fair exclusive LLM lifecycle gate: active requests drain before unload and new text requests wait until the image lifecycle releases the gate.
- Added llama.cpp router `/models`, `/models/unload`, and `/models/load` integration with status polling; ComfyUI `/free` cleanup requests both model unload and memory release.
- Image-prompt requests flush without the normal debounce when enabled. Rendering waits until prompt generation is quiescent, drains every queued render with normal configured concurrency, frees ComfyUI, and reloads the exact effective image-prompt model. Prompt requests arriving while rendering wait for the reload and begin the next cycle.
- Focused router, lifecycle ordering/failure, LLM gate, prompt batching, Comfy cleanup, config, image race, and Chromium form tests pass. The broader image and LLM suites also pass apart from two unrelated local-fixture issues: `config.yaml.qwen35B-A3B` lacks the `Connection: close` header its source test expects, and the fake Cline child process is polluted by the host npm startup warning.
- Added `LlamaCppRouterClient` and `ImageGenerationModelLifecycle` class docs and updated ComfyUIClient, LLMClient, images API, server LLM, config, and documentation-index notes.
- The required reusable browser client passed outside the restricted Chromium sandbox. Inspected `tmp/ai-unload-image-config-final/shot-0.png`; the new checkbox is visible, unchecked by default, and uses the standard checkbox layout. No browser-error artifact was produced.
- Full `npm run test:e2e:headless` passed: 38 tests passed and 4 fixture-gated scenarios skipped.
- The existing live port-7777 process was not restarted for this task, so a later restart is required to activate the new backend lifecycle there.
- TODO: none.

Original prompt: In the running prompts interface, if the model name is more than 10 characters long, truncate it and add a `...` symbol to the end.

- Audited the prompt-progress UI. Model names are displayed in the full tracker table and in each modeless prompt viewer subtitle; the compact one-line dock does not display a model name.
- The display-only formatter will preserve the underlying full model identifier, leave names of exactly 10 characters unchanged, and render longer names as their first 10 characters plus `...`.
- Added one Unicode-safe display formatter and applied it to the full tracker table and prompt viewer subtitle. Truncated values retain their full model identifier in hover text.
- JavaScript syntax checks and the prompt-progress source suite pass. The focused Chromium suite passes 5/5, including long-name and exact-10-character boundary assertions.
- Inspected `tmp/prompt-progress-model-name-truncation.png`; both the table and open viewer visibly show `abcdefghij...`, while the 10-character `1234567890` value remains intact.
- The required reusable browser client passed outside the restricted Chromium sandbox with no error artifact. Inspected `tmp/prompt-model-truncation-smoke/shot-0.png`; the live Play UI renders normally.
- Updated `docs/ui/chat_interface.md`, `docs/ui/modals_overlays.md`, and `docs/README.md`.
- Full `npm run test:e2e:headless` passed on the clean rerun: 39 tests passed and 4 fixture-gated scenarios skipped. The first attempt immediately after the focused suite hit a transient Playwright web-server startup failure; port 4173 was clear, and the unchanged rerun completed successfully.
- TODO: none.

Original prompt: If `unload_during_image_generation` is enabled, tell ComfyUI to unload its models before any LLM prompt is run.

- Audited the shared LLM transport and ComfyUI initialization paths. Every real transport attempt acquires the model-lifecycle shared gate immediately before the request, which is the safe point to free ComfyUI without racing an active image-render lifecycle.
- The current Qwen override has image rendering disabled while the unload mode is enabled, so the implementation must initialize a control-only ComfyUI client for `/free` even when render jobs themselves are disabled.
- Pre-prompt ComfyUI cleanup will be strict: if the enabled mode cannot unload ComfyUI, the LLM request must not start and the existing prompt error path will surface the failure.
- Added an `LLMClient` pre-transport Comfy cleanup handler. Each real request attempt evaluates its effective AI profile after overrides, acquires shared model-lifecycle access, and runs the handler before starting prompt progress or contacting any text backend.
- Cleanup failure is tagged and propagated immediately, so the text transport never starts and the direct Comfy error remains visible instead of degrading into an empty model response.
- Server startup now initializes and connectivity-checks ComfyUI for cleanup-only use whenever the mode is enabled in the base AI config or any model override, even if `imagegen.enabled` is false. Missing cleanup-only Comfy server settings fail configuration validation.
- Focused syntax and LLM/image-lifecycle/config tests pass.
- Updated LLMClient, ComfyUIClient, server flow, config, images API, and documentation-index notes.
- Exact Qwen override startup passed on temporary port 4174: configuration validation succeeded, ComfyUI was reachable, and startup reported both cleanup-only initialization and pre-prompt cleanup readiness while image rendering remained disabled.
- The focused suites pass directly: 5 LLM lifecycle cases, 6 unload/config/Comfy cases, and 5 image lifecycle cases. Fifteen broader LLM/image files pass; the sole failure remains the unrelated existing `config.yaml.qwen35B-A3B` fixture assertion for a missing `Connection: close` header.
- The required reusable browser client passed with no browser-error artifact. Inspected `tmp/comfy-pre-prompt-cleanup-smoke/shot-0.png`; the live Play UI renders normally.
- Full `npm run test:e2e:headless` passed: 39 tests passed and 4 fixture-gated scenarios skipped.
- Restarted the live port-7777 game with `config.yaml.qwen35B-A3B`. The health endpoint responds normally, and startup confirms ComfyUI is initialized for cleanup-only use with strict pre-prompt model cleanup ready.
- TODO: none.

Original prompt: An image prompt was generated after entering a new location, but no image rendered. Diagnose and apply the router reliability fix.

- Live job inspection showed five image jobs failed at 0% before reaching ComfyUI. Both render-lifecycle starts aborted because llama.cpp router `GET /models` returned `socket hang up`; the ComfyUI queue remained empty and the router was healthy again afterward.
- Restored `ai.headers.Connection: close` in `config.yaml.qwen35B-A3B`, satisfying the existing streamed-transport regression and preventing stale pooled connections from being reused for router management.
- Added two bounded retries after the initial read-only `GET /models` attempt. Network errors, HTTP 408/429, and HTTP 5xx responses retry after 250 ms; non-transient client errors, malformed responses, and model action POST failures remain immediate explicit failures.
- Added focused transient-recovery and non-transient rejection coverage. Syntax checks and ten router/LLM/image lifecycle regression files pass, including the previously failing Qwen connection-close assertion.
- Updated `LlamaCppRouterClient`, configuration, and documentation-index notes.
- Restarted the live port-7777 server with `config.yaml.qwen35B-A3B`. Health checks pass, image generation and ComfyUI initialize successfully, and the llama.cpp router reports the configured Gemma model loaded when queried with `Connection: close`.
- The five previously failed jobs were runtime-only and were not retried automatically; their images must be requested again.
- TODO: none.

Original prompt: Tiny-brain event chunks returning three or more events should be accepted rather than failing the event-check turn.

- Audited `Events.parseTinyBrainEventXmlChunk(...)`, staged chunk assembly, and the downstream monolithic event parser. The assembly and application paths already preserve arbitrary event counts; only an explicit parser guard rejected chunks larger than two.
- Removed the two-event hard rejection. The staged prompt still asks for 1-2 events per checkpoint for pacing, but every well-formed chunk with at least one event is accepted and all returned event elements are preserved.
- Added regression coverage proving a three-event chunk is retained intact while empty and malformed chunks still fail explicitly.
- Syntax checks and five focused tiny-brain event, XML event, sequencing, destination-resolution, and travel-time suites pass together. The standalone player-action tiny-brain template suite still has an unrelated existing checkpoint-count failure (`0 !== 8`) outside the event parser path.
- Updated `Events`, server LLM flow, and documentation-index notes.
- Restarted the live port-7777 server with `config.yaml.qwen35B-A3B`; configuration and ComfyUI initialization pass and `/api/hello` is healthy.
- The prior failed movement turn was not replayed, so its player location remains unchanged until a new movement action succeeds.
- TODO: none.
Original prompt: Fix location thing generation so malformed XML does not silently leave locations without items or scenery.

- Diagnosed Hearthside Market generation: six objects were returned, but an invalid generated `moduleSlots` value caused the whole parse to fail; `parseThingsXml` converted that failure to `[]`, and location expansion treated it as success.
- `parseThingsXml` now propagates parse/registered-field errors and can opt into strict XML parsing; malformed registered array/object JSON reports the field and expected JSON shape.
- Location thing generation now strictly parses and validates each response before creating anything, retries the complete prompt up to three times, and propagates exhausted failures through location expansion instead of accepting `[]`. Explicit zero/zero generation hints remain valid.
- Added focused coverage for the Hearthside Market `moduleSlots` shape, malformed closing tags, retry wiring, and exhausted-failure propagation. Targeted syntax checks and parser/retry tests pass.
- Updated `docs/classes/Thing.md`, `docs/server_llm_notes.md`, `docs/slashcommands/ImportItemCommand.md`, and `docs/README.md`.
- Verification passed: syntax checks; focused registered-field, strict XML, retry-wiring, alteration, import, module-schema, and container-prompt tests; browser suite with 39 passed and 4 fixture-gated skips. The required browser smoke client produced `tmp/location-things-retry-smoke/shot-0.png`; it was visually inspected and produced no console-error artifact.
- Created safety save `2026-08-03T00-10-31-689Z_Monster_Girl_Life_2026-06b-Baato-The_Mossy_Hearth-char_2-msch3m2x`, restarted port 7777 with `config.yaml.qwen35B-A3B` plus that startup save, and verified Baato was restored at `loc_10` on the healthy updated server.
- The already-expanded Hearthside Market batch was not retroactively regenerated; the validation/retry behavior applies when location things are generated after this restart.
- TODO: none.

Original prompt: Determine whether a malformed final TinyBrain response reruns the whole staged prompt; ensure only the final step is retried.

- Verified that the final response already runs through `TinyBrainPromptRunner.#runCompletionStep(...)` with `isFinal: true` and the integration-specific final parser.
- A final parse failure retains the accumulated checkpoint/tool transcript, removes only the malformed terminal assistant response, and retries the unchanged final prompt segment under `ai.retryAttempts`; completed checkpoints are not rerun.
- Added explicit regression coverage that deliberately fails both an ordinary checkpoint and the final response, then confirms each retry preserves its prompt exactly once and reports the correct final-step parse-failure metadata.
- The focused regression and JavaScript syntax check pass. The entire standalone test file still contains its existing unrelated real-template checkpoint-count failure (`0 !== 8`).
- No runtime code or documented behavior changed, so the live server did not require a restart.
- TODO: none.

Original prompt: On the New Game screen, allow the user to select a starting month and day.

- Added required Starting Month and Starting Day selectors beside the existing starting level/time controls. Stored setting calendars provide named months and exact day counts; settings whose calendars will be generated show honest ordinal `Month N` labels and a 31-day provisional selector.
- Month values are submitted and saved as one-based calendar positions, so custom month names do not leak into the API contract. Changing to a shorter known month leaves the day unselected instead of silently coercing it.
- Added `Globals.getCalendarDayIndex(...)` to strictly convert one-based month/day values into canonical year-one `dayIndex`.
- New-game setup now resolves and validates the selected date against the actual stored/generated calendar before destructive runtime reset, then combines that day index with the selected starting hour. Invalid dates return `400` while preserving the loaded game.
- Saved New Game form profiles now persist `startMonth` and `startDay`, defaulting older profiles to month 1/day 1.
- Syntax checks, focused calendar unit tests, and the focused Chromium New Game suite pass. The required browser smoke client passed without console errors; `tmp/new-game-start-date-focus/shot-0.png` was visually inspected and shows the date controls aligned cleanly in the existing grid.
- Updated New Game UI, game API, Globals, setting-studio status, and documentation-index notes.
- Broader focused calendar/settings/reset tests pass. Full Chromium regression passed with 39 tests and 4 fixture-gated skips.
- Created fresh safety save `2026-08-03T01-40-54-910Z_Monster_Girl_Life_2026-06b-Baato-The_Mossy_Hearth-char_2-msckbuny`, then restarted port 7777 with `config.yaml.qwen35B-A3B` and that save. Health checks pass with Baato restored at The Mossy Hearth.
- The live focused New Game suite passes 2/2 outside the restricted Chromium sandbox. Visually inspected `tmp/new-game-start-date-live/shot-0.png`; it shows the active calendar's January selector, day selector, and existing hour control aligned correctly, with no console-error artifact.
- TODO: none.

Original prompt: If `unload_model_on_switch` is true, unload the previous model through the router API before a prompt runs with a different model.

- Added the root `unload_model_on_switch` configuration setting with a strict boolean validator and a default of `false`.
- Real LLM transports now track their effective router/model target after endpoint and model overrides. The first prompt establishes the baseline; a later prompt targeting a different endpoint or model unloads the previous target through its llama.cpp router before the replacement request is sent.
- Enabled mode uses the exclusive model-lifecycle gate for the complete text transport, so an active stream cannot be unloaded by a concurrent prompt and prompt ordering remains deterministic. Same-model prompts do not issue router commands.
- Router unload failures are propagated immediately and prevent the replacement model request from starting. Forced test outputs do not affect live model tracking.
- Startup validates that enabled configurations use the `openai_compatible` backend. Updated the configuration, LLM client, router client, server-flow, and documentation-index notes.
- JavaScript syntax checks and the focused model-switch suite pass 4/4. Six combined model-switch, lifecycle-gate, priority, router, image-lifecycle, and image-unload/config suites pass together.
- Exact startup validation passed with `config.yaml.qwen35B-A3B` on the temporary verification port.
- Created fresh safety save `2026-08-03T02-55-22-916Z_Monster_Girl_Life_2026-06b-Baato-Valley_Entrance-char_2-mscmzm78`, then restarted port 7777 with `config.yaml.qwen35B-A3B` and that save. `/api/hello` is healthy and Baato's Valley Entrance game was restored.
- TODO: none.
Original prompt: When an image is actively rendering, replace its placeholder icon with a spinner (if it's a seasonal location image, just put the spinner on top of the image). Then, at the bottom of the image placeholder, put a thin progress bar that shows the current progress of the current image.

- Tracing ComfyUI WebSocket progress, shared image-job state, ordinary placeholders, and seasonal location image overlays.
- Confirmed progress semantics: display ComfyUI's exact `value/max` for the currently executing sampler node; a multi-sampler workflow may reset when the next sampler begins.
- Implemented the first integration pass: ComfyUI WebSocket progress parsing, server `renderProgress` realtime fields, image-manager active render caching, and spinner/progress overlays with seasonal-location image preservation.
- The server now ends active-render state as soon as ComfyUI sampling completes, before output download/save, and clears it on timeout, failure, and stale-runtime exits.
- Added focused ComfyUI progress unit coverage and a Playwright UI regression covering an opaque ordinary placeholder overlay, a translucent seasonal-location overlay, exact bar widths, and cleanup on completion.
- Validation passed: altered JavaScript syntax checks, 11 focused image/config/lifecycle tests, the focused Playwright spec, visual inspection of `tmp/image-render-progress-overlays.png`, and the develop-web-game smoke client against the live game.
- Updated `docs/api/images.md`, `docs/classes/ComfyUIClient.md`, `docs/ui/chat_interface.md`, and `docs/README.md`.
Original prompt: Enable live deslop for TinyBrain drafts and use roughly 500-token chunks without losing llama.cpp prefix-cache performance.

- Live deslop now checks TinyBrain's first- and second-draft checkpoints in plain-prose mode as well as final structured XML prose; planning and analysis checkpoints remain excluded.
- Checked stages use OpenAI-compatible non-stream responses capped at 500 new tokens with `logprobs`/`top_logprobs`. A full batch continues from assistant prefill up to the original logical token budget.
- Tools and `tool_choice` remain unchanged across length continuations and rewind corrections, preserving the stable tool-bearing context prefix that llama.cpp can cache.
- Plain drafts exclude XML markup and `<hidden>` contents, treat every XML tag as an n-gram/rewind boundary, delay unfinished words, and explicitly inspect an alphanumeric final word when the response completes.
- Added focused coverage for draft-stage selection, plain extraction, final-word correction, multi-batch continuation, logprob alignment, assistant prefill, and tool preservation. The focused live-deslop, prefill, streaming, and chat-tool suites pass; the standalone TinyBrain suite retains its documented unrelated real-template checkpoint-count failure (`0 !== 8`).
- Updated live-deslop, LLM client, TinyBrain runner, configuration, slop/repetition, server-flow, and documentation-index notes.
- Restarted port 7777 with `config.yaml.qwen35B-A3B` and the latest Baato save. Startup cleared ComfyUI VRAM immediately before launching managed llama.cpp PID 3273273; both health endpoints pass and ComfyUI remained user-managed.
- The required browser client passed with no console/page error artifact. Visually inspected `tmp/live-deslop-draft-chunks-loaded-smoke/shot-0.png`; the restored Ember Hollow campaign renders normally.
- TODO: none.

Original prompt: Empty character image sizes are slightly different from ones where the image is populated.

- Diagnosed the responsive mismatch against a loaded save: in a 300px-wide location NPC collection, a populated image's intrinsic width made its card use the intended 142px half-row maximum while the same card with an empty placeholder shrank to 127px. The 250px desktop sidebar masked the issue because both states hit the existing 120px minimum.
- Updated `.entity-card--npc` to use `calc(50% - 8px)` as its flex basis while retaining the existing minimum and maximum. Card width now comes from available container space rather than child image content.
- Strengthened the image-progress browser regression to wait for populated fixture images to decode and compare empty/populated NPC cards, portrait hosts, and image layers, plus party, player, and character-modal portrait surfaces.
- Recompiled `public/css/main.css` from `public/css/main.scss` and updated the portrait layout docs/index.
- Focused Playwright regression passes 2/2. Loaded-save probes confirm exact parity at desktop (120px cards, 98×130.656px hosts) and mobile (142px cards, 120×160px hosts), with player portrait sizing unchanged.
- The required reusable browser smoke client passed without a browser-error artifact; `tmp/character-portrait-sizing-smoke/shot-0.png` was visually inspected and the loaded Play layout remains intact.
- Full `npm run test:e2e:headless` passed: 42 tests passed and 4 fixture-gated scenarios skipped.
- The temporary loaded-save verification server on port 4174 was stopped after testing.
- TODO: none.

Original prompt: I just added a `router_preload_model` configuration option. If set, that's the model that should be loaded first by the router. If not, just load the main one.

- Added startup router preload resolution with `ai.model` fallback, strict type/backend validation, idempotent router loading, and initial model-switch target registration.
- Moved default-player creation into the asynchronous startup sequence so its inventory prompt cannot run before router preloading completes.
- Added focused router client and startup/model-switch regression coverage. Syntax checks pass for all changed JavaScript, and the six combined preload, router, switch, lifecycle, image-lifecycle, and configuration test files pass.
- Created safety save `2026-08-06T13-40-04-678Z_Monster_Girl_Life_2026-06b-Baato-Shop_Floor-char_2-mshkc98m`, restarted the router through `start-router.sh`, and restarted the game from that save with `config.yaml.qwen-combo-router`.
- Live startup called `/models/load`, waited for the configured 27B preload, then loaded the save and opened port 7777. Router state confirms that model is loaded and the main 35B model is unloaded; both router parent and child use `--cache-ram 24576`.
- The required browser client completed without a console/page-error artifact. Visually inspected `tmp/router-preload-model-smoke/shot-0.png`; the restored Shop Floor game UI renders correctly.
- TODO: none.

Original prompt: Make it so that the game automatically starts the script at local_startup_script_path even when unload_during_image_generation is false

- Diagnosed the failed qwen-combo startup: `initializeManagedLocalLlamaServer()` returned early unless the effective image profile enabled `terminate_during_image_generation`, so a configured startup script did not run before router preloading attempted to contact the offline endpoint.
- A nonblank root `ai.local_startup_script_path` now activates game-owned local llama.cpp startup independently of both image-handoff flags. Termination mode still uses the effective image-prompt script and remains the only mode that switches scripts per prompt or stops/restarts the process around renders.
- Startup remains ordered before router preloading and all startup prompts. Path-driven startup waits for the root OpenAI-compatible endpoint's `/health`, retains process-group ownership, and is terminated by existing shutdown/self-restart handling.
- Executable-file validation now applies whenever the root startup path is nonblank, and path-driven startup explicitly requires the `openai_compatible` backend.
- ComfyUI cleanup remains strict when an image-handoff mode is enabled. With both handoff flags false, local-process startup no longer requires or contacts ComfyUI.
- Updated focused lifecycle/config regression coverage, configuration help/default comments, local process/LLM/server documentation, and the documentation index.
- Syntax checks pass, and the six focused configuration, local-process, router-preload, prompt-switch, lifecycle-gate, and image-lifecycle test files pass together.
- Live qwen-combo startup confirmed the required ordering: ComfyUI cleanup completed, the game launched `start-router.sh`, `/health` became ready under the saved PID, and only then did router preloading begin. The configured 27B model reached `loaded` and the game opened port 7777.
- Both game and router health endpoints respond normally. The required browser smoke client completed without a console/page-error artifact; `tmp/local-startup-script-smoke/shot-0.png` was visually inspected and the Play UI renders correctly.
- Left the qwen-combo game and its game-owned llama.cpp router running.
- TODO: none.
Original prompt: At the end of player-action.tinybrain.njk, the llm has to produce XML for either travel or a normal turn. Rather than asking it to produce XML for those things, write control flow and parsing to ask it for the necessary information, and parse it out. In the case of the vehicle section, be sure to respect the existing control flow that asks about vehicle-related things if the player is on a vehicle. Write a plan document for this change now.

- Wrote `docs/superpowers/plans/2026-08-06-player-action-tinybrain-non-xml-finalization.md`.
- The plan replaces the scoped final LLM-authored result XML with strict non-XML checkpoints, vehicle-aware Nunjucks branches, and a no-LLM server-side result composer while preserving the canonical XML expected by downstream player-action processing.
- Documented the normal/travel/vehicle decision matrix, parser formats, result-builder invariants, live-deslop/logging changes, tests, documentation work, and acceptance criteria.
- No runtime code was changed or executed; the game and model server were not stopped or restarted.

Implementation follow-up:

- Added strict non-XML player-action parsers for movement, vehicle decisions, prose scope, destinations, durations, prose, hidden notes, and time reasoning.
- Added the pure `PlayerActionTinyBrainResult.js` canonical result builder with CDATA-safe prose serialization, authoritative destination support, and the documented vehicle decision matrix.
- Added focused parser and result-builder coverage. Syntax checks and `tests/tiny_brain_prompt_parsers.test.js` plus `tests/player_action_tinybrain_result.test.js` pass.
- TODO: add the TinyBrain no-LLM terminal result hook, replace the template's final XML branch, wire the route/live-deslop integration, update docs, and run the broader regression/smoke checks.

- Added `{% llmresult(...) %}` terminal composition to `TinyBrainPromptRunner`; it validates a sole terminal marker, builds named checkpoint assignments, performs no extra completion, preserves tool/progress state, and logs the locally assembled response.
- Replaced the scoped player-action final XML instructions with parsed normal/travel control flow. Committed exit-button travel is authoritative; otherwise movement is classified explicitly. Vehicle questions are conditional on `currentVehicle` and distinguish unchanged onboard travel, inside movement, disembarkation, departure, stop, and redirect.
- Wired `player_action_result` into `/api/chat`, added canonical destination/time context, direct move-result hidden-note parsing, and plain live-deslop selection for final prose checkpoints.
- Added runner tests for ordinary travel, underway unchanged vehicle turns, vehicle redirect, and committed destinations. Focused TinyBrain family, parser, runner, live-deslop, target-location, result-builder, and player-action XML parser tests pass.
- Documented the terminal result-builder contract, parser formats, prompt-family behavior, API integration, and live-deslop behavior in the class/API/server/slop docs and documentation index.
- JavaScript syntax checks passed for the builder, runner, parsers, live-deslop integration, API route, and changed tests. Eleven focused TinyBrain, player-action, travel, vehicle, live-deslop, and scheduled-event test files pass together; the broader ten-file TinyBrain/API regression set also passes.
- The required browser client completed outside the restricted Chromium sandbox without a console/page-error artifact. Visually inspected `tmp/player-action-tinybrain-smoke/shot-0.png`; the game shell renders normally.
- The temporary smoke-test server on port 4178 was stopped after verification. No game or llama server was restarted.
- TODO: none.

Original prompt: If the player is moving, ask the LLM for the exact names of any accompanying characters. Have them move with the player.

- Tracing the TinyBrain movement checkpoint/result builder, canonical move-result parser, player relocation paths, and existing party/location invariants.
- Compatibility boundary: the exact-name selection will control physical location movement only. Existing event checks remain authoritative for party membership, so omission will not silently add or remove party members.
- Candidate names will be restricted to living current party members and living NPCs physically present at the movement origin; unknown, ambiguous, and duplicate names will fail explicitly.
- Added an alias-aware movement checkpoint that accepts one exact canonical name or alias per line (or `NONE`) and canonicalizes aliases before result assembly. Identifier collisions and duplicate selections fail explicitly.
- The canonical move result now carries `<accompanyingCharacters>`, and `/api/chat` extracts it without mixing the names into prose/event text.
- Added shared candidate collection and relocation logic. Selected party members retain membership and remain absent from destination NPC lists; selected non-party companions are removed from prior location lists and registered at the player's destination.
- Wired relocation into prompt-driven movement and committed event-driven exit travel. Focused parser, builder, XML, real-template, target-location, and relocation tests pass; altered JavaScript syntax checks pass.
- Forwarded prompt-selected canonical companion names through the client-deferred adjacent-move and map/Favorites fast-travel paths into `/api/player/move` and gameplay `/api/npcs/:id/teleport`. Story-tool player teleports remain outside this gameplay selection flow.
- Tightened move-result XML parsing so `<accompanyingCharacters>` accepts only direct `<name>` children and rejects duplicates, empty names, and unexpected child fields.
- Added and updated class, API, server-LLM, Player, Location, and chat-interface documentation, including `docs/classes/PlayerActionCompanions.md` and the documentation index.
- Final JavaScript syntax checks passed for every altered JavaScript file and focused test file.
- Sixteen focused TinyBrain, alias/parser/builder/XML, travel, vehicle, event-sequencing, direct-move, map-fast-travel, and repair-regression test files pass together.
- The reusable browser client rendered the Adventure shell twice with no console/page-error artifact. Visually inspected `tmp/player-action-companion-smoke-adventure/shot-1.png`; layout and controls render normally. The separately inspected empty-world Map shell rendered its expected `Current location not found` state and emitted the corresponding expected 404 artifact.
- Stopped the temporary smoke server on port 4178. Ports 4178 and 7777 are both closed; no persistent game server was left running and the llama server was not started.
- TODO: none.

Original prompt: Nothing happened after the player prose; shouldn't the game queue the prompt and let llama.cpp wait?

- Diagnosed the reported live turn from the game/router logs. It did reach event checks, need-bar checks, NPC turn handling, random-event handling, and final turn processing, but only after a long 27B-to-35B switch, location generation, NPC-memory work, and queued image rendering made the interface appear idle.
- Changed same-game-owned-router prompt-model swaps so they no longer issue `POST /models/load` and poll before continuing. After saving/unloading the old model, an existing replacement cache is restored immediately and the llama.cpp router autoloads/waits before restoring; without a cache, the replacement prompt is dispatched immediately and the router autoloads/waits for it.
- Kept cache save/restore failures warning-only. Old-model unload failures, consumed-cache deletion failures, and eventual prompt failures still surface explicitly.
- Prompt progress is now registered and broadcast before model-lifecycle waiting, so the client shows the queued prompt throughout a router load/restore delay. Early lifecycle failures clean up that progress entry instead of leaving it stranded.
- Added model-switch regression coverage for exact save/unload/restore/prompt ordering, the absence of explicit load requests, warning-only cache failures, and visible progress during a deferred router restore.
- JavaScript syntax checks pass. Seven combined router, model-switch, prompt-progress, local-process, lifecycle-gate, image-lifecycle, and image-handoff configuration suites pass.
- Updated the LLM client, router client, configuration, server-flow, and documentation-index notes.
- Allowed the previously delayed live turn to reach finalization, stopped the old game, removed its exact stale router PID, and restarted port 7777 from the same Shop Floor save with `config.yaml.qwen-combo-router`. Game and router health checks pass; the configured 27B preload is loaded and the 35B prompt model is initially unloaded as intended.
- The required reusable browser client completed without a console/page-error artifact. Visually inspected `tmp/router-queued-model-switch-smoke/shot-1.png`; the restored Adventure UI renders normally and reports no prompts running.
- TODO: none.

Original prompt: In player-action, there's a bunch of numbered questions in the tinybrain prompt. Update it so that it asks them one at a time and uses the dummy parser.

- Split the nine built-in editing/pruning audit questions in `player-action.tinybrain.njk` into nine sequential `llm_dummy_action` checkpoints.
- Each prompt segment now asks exactly one question and repeats the succinct/N/A response contract. The awareness-validity question follows the awareness-inventory answer in the retained TinyBrain conversation.
- Added a real-template regression that proves all nine questions occur exactly once, occupy distinct completion segments, and use dummy checkpoints.
- The focused runner test and the seven-suite TinyBrain/player-action/live-deslop regression set pass.
- Updated the TinyBrain runner, server LLM flow, and documentation-index notes.
- The required reusable browser client completed without a console/page-error artifact. Visually inspected `tmp/player-action-single-audit-smoke/shot-1.png`; the Adventure UI renders normally. An unrelated live player-action was already running and was left untouched.
- TODO: none.

Original prompt: Pass the committed player-action movement type to the result builder.

- Diagnosed the live `Unknown player-action movement value "undefined"` failure: committed Stairwell travel skipped the LLM movement checkpoint and set only a render-local Nunjucks variable, while terminal assembly receives only parser assignments plus the immutable template context.
- `/api/chat` now computes `playerActionTravelMovementKind` alongside `playerActionTravelDestination`: `destination` off-vehicle and `disembark` on-vehicle. It passes both values into the TinyBrain template/result context.
- The template uses the passed movement type for its downstream branch selection. `PlayerActionTinyBrainResult` consumes it for authoritative travel and fails explicitly when it is missing, conflicts with a parser assignment, lacks a destination, or disagrees with current vehicle state.
- Added the missing full-run committed-travel regression: it skips `player_action_movement`, reaches local terminal assembly, and emits the authoritative Stairwell move XML. Added builder contract and API wiring coverage.
- JavaScript syntax checks pass. Twelve combined TinyBrain, live-deslop, XML repetition, travel time/prose, vehicle, and move-event suites pass.
- Updated player-action result, TinyBrain runner, chat API, server LLM, and documentation-index notes.
- The required reusable browser client completed without a console/page-error artifact. Visually inspected `tmp/player-action-authoritative-movement-smoke/shot-1.png`; the post-error Adventure UI remains intact and reports no prompts running.
- Created a fresh Loft safety save after the completed live turn, stopped the previous game/router processes, and restarted port 7777 with `config.yaml.qwen-combo-router` from that save so the changed `api.js` and result-builder module are active.
- Final health checks pass: the game answers on port 7777 (PID 3854533) and the managed llama.cpp router reports healthy on port 5005 (PID 3854545).
- TODO: none.

Original prompt: Make a tinybrain prompt for need-bars that asks for the same stuff except separates the planning phase from the characters phase.

- Added the allowlisted/configurable `need_bar_event_checks` TinyBrain family. It sends the shared need-bar context once, asks for plain-text planning without XML, retains that answer, then asks for only the `<characters>` block.
- Refactored the one-shot and TinyBrain prompts to share need-bar context, planning guidance, and XML schema includes, keeping their requested facts aligned.
- Added `parseNeedBarCharactersResult()` and registered it with the shared runner. It validates XML-only output, configured need-bar ids, unique characters/bars, required fields, direction/magnitude keywords, and the ten-word reason limit; an invalid final retries only the characters phase.
- Routed both XML and legacy grouped event-check paths through TinyBrain when the family is enabled, retaining the original one-shot call and log behavior when disabled. TinyBrain uses one cumulative prompt log and progress group under `need_bar_event_checks`.
- Updated default/local config and TinyBrain, Events, server-flow, and documentation-index notes.
- JavaScript syntax and YAML parsing checks pass. Thirteen focused TinyBrain runner/parser/family/XML-repetition, need-bar/event, prompt-progress, transport, housekeeping, and reasoning suites pass.
- The required reusable browser client completed without a console/page-error artifact. Visually inspected `tmp/need-bar-tinybrain-smoke/shot-0.png`; the Adventure UI renders normally and reports no prompts running.
- Restarted the game with `config.yaml.qwen-combo-router` and no load-game argument, as requested. The replacement game (PID 3885208) and managed llama.cpp router (PID 3885220) pass health checks on ports 7777 and 5005; the new `need_bar_event_checks` TinyBrain family is active.
- TODO: none.

Original prompt: When the program terminates, delete any context cache files. Don't restart the server after this change.

- Added exact local-router slot-cache ownership tracking for root, preload, prompt-override, and runtime-observed models. Async and synchronous cleanup remove only those model-derived paths, ignore absent files, attempt every deletion, and report all real failures together.
- Wired cleanup into graceful `SIGINT`/`SIGTERM` shutdown, startup failure, self-restart before replacement spawn, and the synchronous process-exit fallback. Graceful paths stop the managed router before deleting its cache files.
- Added focused cleanup and server-shutdown contract coverage, including unrelated-file preservation and aggregated failure behavior. Eight cleanup, router, preload, local-process, lifecycle-gate, and model-switch suites pass; both modified JavaScript files pass syntax checks.
- Updated LLM client, llama.cpp router, configuration, server-flow, and documentation-index notes. Documented that uncatchable `SIGKILL` cannot run in-process cleanup.
- The reusable browser smoke check completed and `tmp/router-cache-shutdown-smoke/shot-0.png` was visually inspected; the Adventure UI renders normally. Final host-side health checks still report HTTP 200 with the original game PID 3885208 and router PID 3885220.
- As requested, the running game/router processes were not restarted, so the currently loaded server process will pick up this implementation only on its next ordinary launch.
- TODO: none.

Original prompt: Fix the need-bar errors and failed generation tool-call error, then restart without loading a save.

- In progress: fix the missing TinyBrain need-bar progress target and its nested retry amplification, preserve generation prompts' restricted tool schemas, reject semantically wrong container contents before mutation, and coalesce concurrent generation for the same container.
- Restart constraint: replace the current qwen-combo-router game/router only after verification and start the game without a save argument.
- Implemented: `need_bar_event_checks*` now covers both direct and TinyBrain progress labels, and missing progress targets are classified as non-retryable configuration failures so they propagate before staged parse retries.
- Implemented: generation prompts preserve their caller-provided random-integer-only schema through base-context boundary processing, so container generation no longer receives `createThing` or other world-mutation definitions.
- Implemented: pending container generation requires a complete strict `<items>` response whose exact name/count multiset matches the pending seeds before object creation. Simultaneous API requests for one container now join a single in-flight promise.
- Verification so far: YAML parsing and JavaScript syntax checks pass; eleven focused/adjacent need-bar, TinyBrain, progress, tool-loop, container, Thing, and streaming suites pass.
- Documentation updated: LLM client, Thing/container behavior, server generation flow, configuration, and the documentation index.
- Restarted with `node server.js --config-override ./config.yaml.qwen-combo-router --port 7777` and no save argument. Startup created the fresh default `Adventurer` (`locationId: null`) instead of hydrating saved state.
- Final health: game HTTP 200 on port 7777 (PID 3923525); managed llama.cpp router HTTP 200 on port 5005 (PID 3923746). The preloaded text-only Qwen 27B preset uses `--no-mmproj-auto` plus an empty `--mmproj` and is currently sleeping after its idle timeout.
- Browser smoke completed without a console/page-error artifact. Visually inspected `tmp/need-bar-generation-fix-smoke/shot-2.png`; the fresh Adventure shell renders normally and reports no prompts running.
- TODO: none.

Original prompt: Make it so the non-realtiume deslopper also removes <hidden>. No reason for that to be in there.

- Added shared XML-aware sanitation to the completed-response deslop history path. Slop-word, positive-ppm regex, configured-ngram, and repeated-ngram analysis no longer count stored `<hidden>` contents.
- Sanitized the slop-remover prompt's supporting player/assistant history while preserving `<hidden>` blocks in the current response being edited.
- Added `tests/api.slop_hidden_history.test.js`; focused hidden-history, regex-filter, and live-deslop tests pass.
- Per user instruction, do not restart the running game or llama server for this change.
- Final validation: five focused slop/live/context test files pass. The read-only browser smoke rendered the current game normally at `tmp/nonrealtime-hidden-deslop-smoke/shot-2.png` with no console/page-error artifact, and the untouched game server still returns HTTP 200.
- TODO: none; the running process has not loaded this code and will pick it up on the user's next restart.

Original prompt: Save the TinyBrain section-aware event-check overhaul plan to docs and implement it.

- Saved the approved design as `docs/tinybrain_event_checks_overhaul_plan.md`.
- Implemented category-specific TinyBrain XML checkpoints for scene/location, items/inventory, characters/presence, combat/recovery, quests/progression, a final sweep, and tracker updates.
- Implemented strict stage parsing for tag allowlists, required fields, downstream semantic parsing, singleton constraints, canonical tracker nesting, and exact duplicate XML; malformed responses retry only their current checkpoint and retry exhaustion fails explicitly.
- Replaced the raw final model completion with `llmresult('event_xml_result')`, which locally assembles only accepted XML fragments.
- Movement event processing now runs nonempty origin, between, and destination prose separately when TinyBrain event checks are enabled. Transit permits only `thingMoveWithCharacter`; authoritative player/vehicle movement and time remain outside event inference. A tracker-only pass runs last over combined prose with accepted section XML supplied as context.
- Non-movement TinyBrain event checks use the same category pipeline once for the CURRENT section, with tracker updates last. Need bars remain a separate prompt.
- Uncommented the LLM-facing `<trackerUpdates><trackerUpdate>...</trackerUpdate></trackerUpdates>` schema documentation.
- Updated Events/XML schema/chat/server/slop documentation and the docs index.
- Verification: `node --check Events.js` and `node --check api.js` pass. A 36-file focused regression run covering Events, XML parsing, tracker/need-bar checks, travel orchestration, player-action TinyBrain behavior, and the shared runner passes with no failures.
- Runtime constraint: do not restart the currently running game/router during this implementation pass.
- Browser smoke was not run because no game server was listening on port 7777 at verification time; the server was not started or restarted.
- TODO: none. The new backend behavior will load on the next user-controlled server start.

Original prompt: Make TinyBrain event checking ignore movement XML, or remove it from TinyBrain documentation, because player-action already detects movement. Leave non-TinyBrain event checking unchanged.

- TinyBrain event extraction no longer renders the one-shot movement-boundary XML documentation. Its stage parser defensively discards stray `moveLocation`, `moveNewLocation`, and `arriveAtLocation` elements while preserving required-tag validation; the non-TinyBrain event path remains unchanged.
- Validation passed: `node --check Events.js` plus the TinyBrain event, monolithic XML parser, event-check sequencing, and travel-prose destination test files (4/4).
- The required read-only browser smoke rendered normally with no error artifact; visually inspected `tmp/tinybrain-event-movement-ignore-smoke/shot-0.png`.
- The running server was not restarted and has not loaded this change yet.

Original prompt: Keep the ten-word need-bar reason limit in the prompt, but do not enforce it in parsing.

- Removed the TinyBrain need-bar parser's hard reason word-count rejection while retaining the prompt's `10 words or less` guidance.
- Validation passed: parser syntax plus the focused TinyBrain parser, TinyBrain need-bar, and ordinary need-bar prompt suites (3/3).
- The required read-only browser smoke rendered normally with no error artifact; visually inspected `tmp/need-bar-reason-soft-limit-smoke/shot-0.png`.
- The running server was not restarted and has not loaded this change yet.

Original prompt: For each gameplay action omitted from the recent ten-turn API playtest, write a comprehensive test plan, including `@@` commands to generate necessary game entities.

- Added `docs/ten_turn_api_playtest_followup_plan.md` with an isolated test-run contract and comprehensive plans for all 18 recorded coverage gaps.
- Each scenario includes `@@` fixture setup, canonical ID resolution, API/player execution cases, mechanical and prose assertions, negative variants, save/reload coverage, and required artifacts.
- Linked the comprehensive plan from `docs/ten_turn_api_playtest_gaps.md` and indexed it in `docs/README.md`.
- This was a documentation-only planning task. No game, llama.cpp, ComfyUI, API playtest, or Playwright run was started.
- TODO: execute the follow-up scenarios in the documented priority order in a future user-authorized testing session.

Original prompt: Add a `/free` fallback when ComfyUI Cache Monitor VRAM release fails, with a browser popup recommending the custom nodes and a browser-local "hide in the future" checkbox.

- Implemented the backend fallback contract: Cache Monitor is attempted first, `/free` is used only after failure, and callers receive explicit fallback metadata.
- Wired both router-mode and managed-process post-render paths to broadcast a dedicated `comfy_cache_monitor_fallback` realtime warning after fallback use.
- Added the browser warning modal, localStorage suppression preference, and dedicated SCSS styling. Validation and browser inspection remain to be completed.
- Updated ComfyUI lifecycle, realtime, configuration, image API, and modal documentation plus the docs index; compiled `public/css/main.css` from the updated SCSS.
- Validation passed: syntax checks for the four runtime modules, browser script, and four focused test files; all four focused Node test files pass.
- Used the required web-game Playwright client against an isolated UI harness. Visual inspection confirmed the warning layout and checked suppression control at `tmp/comfy-cache-monitor-fallback-ui/capture/shot-0.png`; a second interaction confirmed dismissal stores suppression and prevents an immediate repeat (`popupVisible: false`, `suppressionStored: true`) with no console/page-error artifacts.
- The game and llama.cpp servers were not started or restarted.
- TODO: none.

Original prompt: Implement the follow-up API playtest acceleration plan.

- Implemented strict version 2 logical-completion recording/replay with canonical request fingerprints, atomic per-completion writes, completeness markers, ordered repeated-label/tool-call support, no live fallback, and explicit mismatch/exhaustion/concurrency/unused-entry failures. Legacy by-label forced outputs remain compatible.
- Added completion-cassette status, assert-consumed, and complete-recording API endpoints.
- Refactored the API playtest harness into reusable HTTP/realtime, assertion/triage, fixture, config-profile, and scenario modules. Declarative schemas reject unknown fields/types, missing chat response policies, and unresolved fixture variables before fixture load.
- Added immutable fixture promotion/runtime-copy integrity checks, inherited minimal config profiles (including a no-llama replay profile), focused state/history/realtime/log assertions, automatic attempt directories, and JSON/Markdown triage reports.
- Promoted the canonical `vehicle-underway-eastbound` fixture and added `VEH-7-off-route.json` as the first scenario.
- Fixed VEH-7 at two structured boundaries: fixed-route destinations are canonicalized and rejected/retried inside the TinyBrain vehicle-destination parser, and tagged invalid-route mutation errors now propagate through `/api/chat` instead of being swallowed as warning-only event-check failures. No prose regex/classifier logic was added.
- Live diagnosis found that a parser correction could substitute an allowed stop after first extracting the requested off-route destination. `TinyBrainPromptRunner` now gives each checkpoint retry-local parser state, and the vehicle parser anchors that first complete normalized destination so retries cannot change its mechanical meaning.
- Added `npm run test:followup-harness` and `npm run followup:scenario`, plus comprehensive operational/class/config/API/player/chat/playwright documentation.
- Fixed two harness issues exposed by real execution: expected HTTP failures now produce a successful scenario-command result when all assertions pass, and fingerprints canonicalize JSON tool results while omitting reconstruction-only timestamps/ids. Strict cassette replay also permits but intentionally does not invoke live-token callbacks.
- The VEH-7 action now explicitly keeps the player aboard, preventing the movement checkpoint from selecting `DISEMBARK` and bypassing the intended vehicle-destination branch.
- ComfyUI Cache Monitor released about 8.7 GB of VRAM before verification. Image generation remained disabled for all test profiles.
- Final verification passed: focused syntax/unit suites; completed 35-entry Qwen live recording (`attempt-7`); no-llama strict replay consuming all 35 entries (`attempt-9`); and independent unrecorded live-Qwen verification (`attempt-10`). All three relevant runs returned the expected checkpoint-26 HTTP 500 after seven attempts with unchanged player location, fixed-route vehicle state, world time, and committed player-action history.
- The source-controlled cassette is `tests/followup_api_playtest/cassettes/vehicle/VEH-7-off-route.json`. The required browser smoke was previously completed and visually inspected at `tmp/followup-api-playtest-smoke/shot-0.png`; the post-smoke changes are backend-only cassette/parser/harness logic.
- Closing regressions pass: `npm run test:followup-harness` (3 files), the five focused vehicle/TinyBrain/API suites, syntax checks for all changed JavaScript, and JSON checks for the 35-entry completed cassette and corrected scenario action.
- Final shutdown verified: ports 7777 and 5005 refuse connections, and no llama.cpp process remains in the GPU process list. Only the pre-existing ComfyUI Python process remains at about 386 MiB.
- TODO: none.
- Follow-up API harness: COMBAT-1 live-record attempt 5 passed all 50 mechanical assertions, but `/api/chat` returned about 21 seconds before the final staged `event_checks` logical completion released the cassette lease. Hardened recording finalization to require a stable idle period and extended its bounded synchronization window; replay finalization now likewise waits for stable idle plus full strict-cassette consumption before asserting. Syntax checks and the full `test:followup-harness` suite pass.
- Follow-up API harness: eliminated ambiguous cassette interleaving without deadlocking TinyBrain tool work. `LLMClient` now serializes cassette-backed logical completions, retains cassette ownership across a whole queue-reserved staged program, yields/reacquires it with model permits for nested prompt-launching tools, exposes active/queued ownership, and latches replay failures so later consumption cannot hide an earlier mismatch. Focused cassette/reservation and harness suites pass.
- Promoted the immutable `combat-elemental-skirmish` fixture and declarative `COMBAT-1-hostile-npc-attack` scenario with 51 authoritative assertions and human-only prose review. The final source cassette has 40 ordered completions and SHA-256 `35301680ec858750eb6fbc0005973827a89180064e48178e09bbde741b96d683`.
- Independent live verification caught the same QA Ash Beetle narrating an unrolled second bite even though the model's own audit identified it. Tightened the tool/TinyBrain contract to one approach plus one impact per single-target result and instructed revision/final stages to delete unsupported action sentences wholesale rather than paraphrase or substitute them. No prose regex, classifier, keyword scan, or application-code heuristic was added.
- Final COMBAT-1 evidence passes: live-record `attempt-20` (51/51 plus human-reviewed one-attack prose), no-llama strict replay `attempt-21` (40/40, zero latched failures, empty queue), and independent live-Qwen `attempt-22` (51/51 plus one attack followed only by withdrawal/posture). Image generation remained disabled throughout.
- Next: convert COMBAT-2 and the remaining documented backend cases, then audit the complete backend case matrix before completing the active goal.
- Follow-up API harness: completed COMBAT-2 with `combat-elemental-skirmish`, `combat-friendly-only`, a declarative 43-assertion scenario, and source cassette SHA-256 `d9cddf0e72f9c37f302b17d98607f1f1fac9c71873eef64c01e40eaf2cca68f0` (40 ordered completions).
- The first independent live run validly used a one-target `resolveAreaAttack` for Shield Bash while the scenario assumed two fixed-order `resolveAttack` calls. Added `attackResultCount` and `attackResultApplied` to normalize both structured attack tools by actor/canonical target and prove their health applications against before/after state. No prose regex, classifier, keyword scan, or application heuristic was added.
- COMBAT-2 evidence passes: live record `attempt-6` (51/51 original assertions and human-reviewed prose), current no-llama strict replay `attempt-10` (43/43, 40/40 consumed, zero latched failures/queue), and current independent live-Qwen `attempt-9` (43/43 plus one bite/one shield impact and no duplicate NPC turn). Focused harness/cassette tests pass.
- Goal accounting correction: the acceleration harness was introduced mid-goal and does not invalidate or require conversion of earlier passing API cases. Authoritative retained assertions show 71/148 backend cases complete: VEH-1–7, CONT-1–8, INV-1–7, EQUIP-1–5, TRADE-1–9, CRAFT-1–8, COMBAT-1–10, PARTY-1–8, and QUEST-1–9. COMBAT-3 was already complete before its optional declarative conversion work began.
- Remaining scope is 77 genuinely untested backend cases. Use declarative scenarios, immutable fixtures, strict cassettes, and replay when they accelerate those cases or protect a new defect; do not redo the 71 completed cases solely to fit the harness.
- Follow-up API playtest VEH-8 passed on the first state-only attempt with 37/37 assertions. The underway tram remained unchanged through minute 668, finalized once at ETA 669, restored the destination exit, preserved Rika and her QA Brass Travel Case, and remained unchanged on a zero-minute idempotence check. Current goal progress is 72/148 backend cases complete and 76 remaining; the dashboard was updated immediately.
- Follow-up API playtest VEH-9 passed live verification on attempt 2 with 31/31 assertions. The first run established correct disembark behavior but exposed a scenario error caused by checking full `vehicleInfo` in the intentionally abbreviated bulk-locations projection; the corrected scenario queries the detailed tram endpoint. The structured result classified the move as `disembark`, moved the player with zero additional time, committed one action/summary pair, preserved the normalized route, and produced no runtime errors. Current goal progress is 73/148 backend cases complete and 75 remaining; prior completed cases remain complete.
- Follow-up API playtest VEH-10 passed its first state-only run with 46/46 assertions. A normal save preserved the active route, ETA, departure time, tracked exit, player vehicle context, companion, and carried-item ownership; after deliberate runtime mutation, reload restored the exact saved state. The restored ETA finalized one arrival and a zero-minute follow-up produced no duplicate. Vehicle coverage is now complete, with current goal progress at 74/148 backend cases and 74 remaining.
- Follow-up API playtest REG-1 passed live-verify attempt 4 with 40/40 assertions. Direct traversal expanded the immutable QA Frost March doorway under its pending region id, moved Baato to one canonical entrance, rewired/backfilled the origin exit to five minutes, retained QA Border Lantern as a target-region child stub, and kept region-map membership unique. Failed attempts exposed malformed region XML being partially consumed; pending-region generation now strictly parses every consumed component before mutation and retries from the original prompt plus the exact parser error without retaining the large rejected document that Qwen copied byte-for-byte. Focused parser/retry/region tests pass. Current goal progress is 75/148 backend cases with 73 remaining.
- Follow-up API playtest REG-2 passed live-verify attempt 1 with 44/44 assertions. Promoted the validated REG-1 post-state as immutable fixture `cross-region-expanded-frost-march`, then moved through the preserved two-minute child route. QA Border Lantern expanded in place under `loc_38` inside QA Frost March, retained unique region membership and both canonical entrance links, moved Baato and time exactly once, added one event summary, and produced no realtime or changed error-log failures. Human review accepted the generated frozen-frontier lantern checkpoint against the saved blueprint. Current goal progress is 76/148 backend cases with 72 remaining; the original 71 pre-harness cases remain credited.
- Follow-up API playtest REG-3 passed live-verify attempt 3 with 51/51 assertions. The direct player-action travel path accepted alias `Kuroha`, returned canonical companion `QA Quartermaster`, expanded the existing QA Border Lantern stub for destination prose without moving either actor or advancing time, then `/api/player/move` moved both actors exactly once and advanced the clock by the canonical two minutes. Region membership and the reciprocal exit remained canonical, one event summary was added, and no realtime or changed error-log failures occurred. Human review accepted the one-character alias treatment and single departure/walk/arrival. The failed first attempt exposed sequential TinyBrain movement-event request growth (about 498 KB from repeated full base contexts); later sections now refresh the transcript's one base snapshot in place while preserving prior prompts and replies, with focused three-section regression coverage. Current goal progress is 77/148 backend cases with 71 remaining; all 71 pre-harness completions remain credited.
- Follow-up API playtest REG-4 passed live-verify attempt 3 with 41/41 assertions. Without exit-button destination metadata, TinyBrain selected QA Aurora Cairn in QA Frost March and the exact requested three-minute travel time; authoritative generation created and expanded one location, added reciprocal three-minute exits, moved Baato once, advanced time once, kept region membership unique, and added one action/summary pair without duplicate event-check movement. Human review accepted one coherent, region-appropriate trip. Failed attempts exposed that the tool loop executed registered provider-emitted tools omitted from the active request schema; request schemas now form the execution allowlist, undeclared calls return retryable `tool_not_declared` XML without mutation, and the TinyBrain destination lookup preserves its `moreInfo`-only schema. Focused tool/TinyBrain suites and the harness suite pass. Current goal progress is 78/148 backend cases with 70 remaining; all 71 pre-harness completions remain credited.
- Follow-up API playtest REG-5 passed live-verify attempt 4 with 23/23 assertions. Validly shaped authoritative fast-travel metadata named a nonexistent canonical destination, and `/api/chat` returned HTTP 400 before launching a prompt or applying any player, time, history, exit, location, or region mutation. Both intentionally same-named fixture stubs retained their distinct region memberships and no realtime errors occurred. The first ambiguity-driven draft was replaced because the model could invent a region and validly disambiguate the prose; the invalid authoritative id makes the same failure-isolation requirement deterministic. Current goal progress is 79/148 backend cases with 69 remaining; all 71 pre-harness completions remain credited.
- Follow-up API playtest REG-6 passed state-only attempt 3 with 57/57 assertions. A normal save, deliberate seven-minute perturbation, and reload restored the expanded QA Frost March state: one unique live region, five unique correctly owned map locations, the canonical unexpanded child stub, exact player/time/location/region projections, and all relevant one-, two-, and five-minute route topology. Hydration regenerates exit-object audit timestamps, so the scenario asserts canonical route semantics rather than treating those timestamps as state drift. Cross-region coverage is now complete. Current goal progress is 80/148 backend cases with 68 remaining; all 71 pre-harness completions remain credited.
- Promoted immutable fixture `fast-travel-visited-favorites` after setup live-verify attempt 1 passed 33/33 assertions. Deterministic exit APIs created four- and nine-minute two-way destinations; an `@@` tool prompt created QA Courier and set exact alias Quickstep; no-side-effect visits expanded, visited, and favorited both endpoints before returning Baato to the baseline without advancing time. FAST-1 then passed state-only attempt 1 with 43/43 assertions: both previews returned exact directed times and canonical metadata with complete player/NPC/location/clock/history state unchanged and no errors. Current goal progress is 81/148 backend cases with 67 remaining; all 71 pre-harness completions remain credited.
- FAST-2 passed live-verify attempt 2 with 47/47 assertions. The browser-equivalent blank confirmation stored one travel-marked comment entry and launched no prompt or player-action record; the subsequent normal teleport moved Baato once to QA Fast Travel Grove, advanced exactly four graph minutes, added one travel event summary, left QA Courier at March Start Marker, and completed ordinary below-threshold arrival processing with no WYWA or runtime errors. Current goal progress is 82/148 backend cases with 66 remaining; all 71 pre-harness completions remain credited.
- FAST-3 passed live-verify attempt 1 with 46/46 mechanical assertions and accepted human prose review. Direct fast-travel metadata fixed QA Fast Travel Tower as the destination; player-action emitted one coherent Tower-bound trip and one history row while leaving player/time at the origin. The separate gameplay teleport performed the only move, exact nine-minute graph advance, and one travel summary, with no below-threshold WYWA or runtime errors. Current goal progress is 83/148 backend cases with 65 remaining; all 71 pre-harness completions remain credited.
- FAST-4 passed live-verify attempt 1 with 48/48 mechanical assertions and accepted human prose review. The alias Quickstep canonicalized to QA Courier, neither actor moved during prose generation, and the separate teleport moved both to QA Fast Travel Grove exactly once with a four-minute advance and one travel summary. Alias identity and both NPC/player party state stayed unchanged; no runtime errors occurred. Current goal progress is 84/148 backend cases with 64 remaining; all 71 pre-harness completions remain credited.
- FAST-5 passed live-verify attempt 1 with 58/58 mechanical assertions and accepted human prose review. After aging the visited Grove by 31 minutes, an event-driven TinyBrain move committed the exact four-minute route, retained one hidden WYWA bookkeeping row, and suppressed only the duplicate visible WYWA prose because the same player-action supplied destination prose. A save/reload isolated the browser-equivalent blank comment plus gameplay teleport, which advanced the same four minutes and retained one hidden plus one visible WYWA row. Both branches reached the Grove without realtime, arrival-processing, or changed-log errors, and neither prose review found a conflicting destination or second trip. Current goal progress is 85/148 backend cases with 63 remaining; all 71 pre-harness completions remain credited.
- FAST-6 passed state-only attempt 1 with 52/52 assertions. After aging the Grove beyond the WYWA threshold and marking Mina hidden, the story-tool player teleport moved only Baato, ignored the supplied Quickstep companion for movement, advanced no time, left full history unchanged, emitted no arrival-processing result or prompt, and added no WYWA, player-action, or travel-summary row. Mina stayed hidden with untouched sighting fields, and no realtime or changed-log error occurred. Current goal progress is 86/148 backend cases with 62 remaining; all 71 pre-harness completions remain credited.
- FAST-7 passed state-only attempt 1 with 37/37 assertions. Preview and gameplay teleport both rejected the same nonexistent destination with their documented HTTP 404 payloads before mutation. The complete tracked player, character, location, clock, and history projections stayed unchanged; no prompt or player-action/WYWA/event-summary row appeared; and no realtime or changed-log error occurred. Fast-travel coverage is complete at 7/7, and current goal progress is 87/148 backend cases with 61 remaining; all 71 pre-harness completions remain credited.
- Promoted immutable fixture `need-bars-status-lifecycle` after the setup scenario passed 44/44 assertions. Two `@@` calls created QA Restorative Meal and QA Tired Companion; deterministic API normalization established the exact ten-minute QA Well Fed need/attribute modifiers, player ownership, party membership, and raw player/companion need values. The executable manifest verifies 22 invariants and the save tree has SHA-256 `4fd7386a4255970712445d30c58c6f7087eaa3bd9cb096c220ef2caf24878a13`. Added `need-bars-mechanics`/replay profiles and the structured `historyAddedNestedObjectCount` assertion, with schema validation and focused harness coverage.
- NEED-1 passed live-verify attempt 2 with 50/50 assertions. A voluntary one-minute shared strenuous activity produced exactly one structured small stamina decrease for Baato and QA Tired Companion, combined correctly with the ordinary passive minute tick, left non-party QA Courier unchanged, and recorded one event summary containing exactly two matching need-bar-change items plus one time-passed item. Human review accepted one coherent activity without recovery, eating, or spellcasting; no realtime or changed-log errors occurred. The first draft's direct NPC command was correctly rejected by plausibility without mutation, so the corrected scenario establishes the companion's voluntary precommitment through structured fixture state. Current goal progress is 88/148 backend cases with 60 remaining; all 71 pre-harness completions remain credited.
- NEED-2 passed live-verify attempt 4 with 59/59 assertions and accepted human review. The scenario dismisses the companion and relocates both fixture NPCs through normal APIs so Baato can rest alone at the unchanged baseline marker without prose-policing heuristics. One explicit one-minute short rest applied Rest +100 and a capped stamina fill only to Baato after passive time rates; stamina stopped at 1000; remote actors received only passive drift; the meal and QA Well Fed state remained untouched; and one action plus one matching structured summary were added without errors. Earlier attempts proved why the mechanical isolation matters: nearby NPCs validly took their own narrated actions, while generic quiet sitting did not always satisfy the configured `short rest` trigger. Current goal progress is 89/148 backend cases with 59 remaining; all 71 pre-harness completions remain credited.
- NEED-3 passed state-only attempt 2 with 50/50 assertions. The direct needs API moved Rest from exactly 150 to `149.99999999999997`, the next representable JavaScript value below that boundary. One unique bar switched from `Tired` to `Very Tired` with canonical `-5% to health and attributes` effect metadata; the old threshold disappeared; every unrelated actor, need, status, inventory, location, time, and history field stayed unchanged. Reapplying the crossed value was fully state-idempotent with no duplicate bar or errors. Threshold effects are descriptive metadata, not arbitrary prose parsed into stat modifiers. Current goal progress is 90/148 backend cases with 58 remaining; all 71 pre-harness completions remain credited.
- NEED-4 passed live-verify attempt 2 with 64/64 assertions and accepted human review. With nearby NPCs isolated and Food set to 100, exactly one normal QA Restorative Meal produced the configured immediate large +700 Food change to 799.3 after passive drift, while its separate +5-per-minute effect did not tick in the creation minute. One ingest/consume/status application removed the sole item globally and started one QA Well Fed at minute 664 for ten minutes with Constitution +2 and Food +5/minute; derived max/current health rose by four. One player action, one event summary, and one dedicated status-summary row captured the result without errors. The first source attempt only misclassified the dedicated `status-summary` as a second `event-summary`; production behavior was correct. Current goal progress is 91/148 backend cases with 57 remaining; all 71 pre-harness completions remain credited.
- NEED-5 passed state-only attempt 2 with 57/57 assertions. A directly installed ten-minute QA Well Fed retained duration 1, Constitution +2, Food +5/minute, and derived health 43 after nine minutes while contributing exactly nine modifier ticks. The tenth minute applied the final +5 once, removed the status, and restored max/current health to 39; the eleventh applied baseline Food drift only. No duplicate removal, status summary, history mutation, realtime error, or changed log occurred. The first attempt compared the history wrapper's intentionally changing current-time metadata; the corrected invariant compares its unchanged entry array. Current goal progress is 92/148 backend cases with 56 remaining; all 71 pre-harness completions remain credited.
- NEED-6 passed live-verify attempt 1 with 75/75 assertions plus accepted prose and prompt-participant review. Need endpoints exposed four player bars, party-only Food/Rest/Stamina for QA Tired Companion with Mana explicitly absent, and non-party Stamina/Mana for QA Courier with Food/Rest absent, all under exact audience flags. After relocating both NPCs, the need prompt's location/party participant lines were empty and Baato remained the implicit player actor. One minor spell produced exactly Baato Mana -100 after passive +10; no NPC TinyBrain entry appeared and remote actors received passive drift only. Current goal progress is 93/148 backend cases with 55 remaining; all 71 pre-harness completions remain credited.
- NEED-7 passed deterministic forced-output coverage. A source-controlled eight-completion fixture retained one accepted planning response while the characters checkpoint rejected, diagnosed, and retried an unknown bar, duplicate character, duplicate bar, invalid direction, invalid magnitude, and unexpected XML child before accepting one valid stamina change. Every malformed assistant response was removed from the retained transcript, planning was neither lost nor rerun, and the focused staged-runner plus parser tests passed. Current goal progress is 94/148 backend cases with 54 remaining; all 71 pre-harness completions remain credited.
- NEED-8 passed state-only attempt 3 with 87/87 assertions. Four distinctive raw need values and a partially elapsed QA Well Fed status were saved at minute 666/duration 7, deliberately destroyed and advanced, then restored with exact current and initial values, `appliedAt`, modifiers, derived health, clock, inventory, and save-notice history. The next ordinary minute applied every passive rate and one +5 Food status tick exactly once and reduced the effect to duration 6 at minute 667. The run fixed a real Player hydration defect that replaced persisted `initialValue` with current `value`; focused applicability/round-trip tests plus the broader need-bar suites pass. Need/status coverage is complete at 8/8. Current goal progress is 95/148 backend cases with 53 remaining; all 71 pre-harness completions remain credited.
- Promoted immutable fixture `stealth-hidden-npcs` from the successful two-`@@` setup plus a 24/24 state-only validation continuation. It contains living hidden QA Veiled Scout (`char_40`, alias Whisper, Dexterity/Stealth 20/20) and living visible QA Loud Decoy (`char_41`, 1/0) at March Start Marker, with 17 executable invariants and integrity hash `c8cedbb4c8a0a9d3da7cbcfd8e90af5cecc207459c46ee52e4815f3d23f2a03f`. Added isolated live/replay stealth profiles.
- HIDE-1 passed state-only attempt 1 with 39/39 assertions. Baato's deliberately inferior Wisdom/Perception 1/0 made the first-shared-location automatic check a mathematically certain failure against Scout; exactly one major-failure check row was added with `hiddenFromClient: true`, Scout remained hidden with no last-seen fields, and no prose/prompt, time, player-action, event-summary, realtime error, or changed error log occurred. Current goal progress is 96/148 backend cases with 52 remaining; all 71 pre-harness completions remain credited.
- HIDE-2 passed its full model-backed evidence chain. Live-record attempt 7 and independent live-Qwen attempt 9 each passed 41/41 assertions and human review; strict no-llama replay attempt 8 consumed all 38 ordered cassette completions with zero failures. Exactly one forced Perception-vs-Stealth check revealed QA Veiled Scout, produced one check-results row, requested one location refresh, and added one action/summary pair without movement or errors. The run fixed XML event delegation dropping pre-resolved player-action checks, then hardened structured reuse for tool-valid omitted/alternate attributes while retaining exact actor, canonical opponent, and configured-skill identity. Exact search duration was removed as an unrelated over-constraint. Cassette SHA-256 is `0492b356b177f4acdec52498fc3d0f70f7ebce6a47d7432ff9d05fe169a7b0bc`. Current goal progress is 97/148 backend cases with 51 remaining; all 71 pre-harness completions remain credited.
- HIDE-3 passed live-verify attempt 1 with 43/43 assertions and accepted human review. An alias-targeted forced-die-1 search by Wisdom/Perception 1/0 against Scout's Dexterity/Stealth 20/20 produced one critical-failure tool result and one check-results row. Scout stayed hidden in place with null last-seen fields, no reveal refresh, and no realtime or changed-log errors; the prose reported finding nothing and did not locate or interact with Scout. Current goal progress is 98/148 backend cases with 50 remaining; all 71 pre-harness completions remain credited.
- HIDE-4 passed its full model-backed evidence chain. Live-record attempt 6 and independent live-Qwen attempt 8 each passed 43/43 assertions and human prose review; strict no-llama replay attempt 7 consumed all 39 source-cassette completions with zero failures. Exactly one forced-die-20 Stealth-vs-Perception check used QA Loud Decoy as actor and Baato as opponent, hid the living Decoy in place, requested one location refresh, and added one check/action/summary set without runtime errors. The run fixed actorless NPC-owned checks in TinyBrain player-action by adding exact canonical/alias checked-actor selection, requiring the actor in its cloned check schemas, supplying an omitted actor only from a sole structured selection, rejecting out-of-set actors, and rejecting self-opposed checks at the domain boundary. No prose classifier or wording heuristic was added. Cassette SHA-256 is `f4785f137ff4bbbf7b3f709b9e50c4d9c57460d78d04d7107ca54e4d9dc58bbf`. Current goal progress is 99/148 backend cases with 49 remaining; all 71 pre-harness completions remain credited.
- HIDE-5 passed its full model-backed evidence chain. Live-record attempt 5 and independent live-Qwen attempt 7 each passed 42/42 assertions and human review; strict no-llama replay attempt 6 consumed all 39 cassette completions with zero failures. Exactly one forced-die-1 Scout-to-Baato attack missed without contact or health loss, revealed the living Scout at the unchanged location, requested one refresh, and recorded canonical defender id/name plus one check/action/summary set. Attempt 1 exposed zero-damage hit formatting throwing after resolution; authoritative attack-outcome health now supplies `0%` damage and the true remaining percentage. Attempt 2 exposed miss summaries dropping the resolved defender id; summaries and harness normalization now retain it. A mechanically passing attempt-4 cassette was rejected and preserved because its prose converted the miss into light contact; prompt guidance was corrected without executable prose inspection. Accepted cassette SHA-256 is `827b157ccb7fbc30278527312a40ca3c5a815b3b2c350414a36687dfcb361e78`. Current goal progress is 100/148 backend cases with 48 remaining; all 71 pre-harness completions remain credited.
- HIDE-6 passed state-only attempt 1 with 59/59 fixture and scenario assertions. One authoritative update killed the already-hidden QA Veiled Scout while requesting continued concealment; the model normalized the actor to zero health, `isDead=true`, `hiddenFromPlayer=false`, corpse countdown 5, and unchanged location membership. A second explicit concealment update still returned and persisted false, and full actor plus location client payloads exposed exactly one visible corpse. Last-seen fields, time, history, realtime errors, and changed logs remained untouched. No production defect or cassette was needed. Current goal progress is 101/148 backend cases with 47 remaining; all 71 pre-harness completions remain credited.
- HIDE-7 passed its full post-harness evidence chain. Live-record attempt 10 and independent live-Qwen attempt 12 passed 76/76 assertions; strict no-llama replay attempt 11 consumed all 19 ordered completions without provider traffic. Forced `npcDeparture` and `npcArrival` events moved the same hidden Scout away and back with canonical name, location membership, concealment, and null last-seen fields intact. A prose-free story-tool separation plus ordinary player return then recorded exactly one client-hidden automatic failed reveal check and left Scout concealed. The run repaired lowercase `npcUpdates.added`/`departed` values by resolving sanitized tracking keys to authoritative actor names, and strengthened TinyBrain character-presence guidance for physically present hidden arrivals while excluding mere mentions or plans. No prose matcher or classifier was added. Cassette SHA-256 is `b8bc8ad5270ea9f65b73c70a64bbb1c0f34dc6d4d868a684c2a01a69130205b3`. Current goal progress is 102/148 backend cases with 46 remaining; all 71 pre-harness completions remain credited.
- HIDE-8 passed state-only attempt 3 with 90/90 assertions. Before saving, ordinary arrival processing left hidden Scout genuinely unseen with null last-seen fields while visible Decoy recorded minute 663 at March Start Marker. The disposable runtime then revealed/moved Scout, moved Decoy, advanced five minutes, and recorded minute-668 Stairwell sightings for both. Reload restored Scout's hidden flag, alias, null sightings, and baseline membership; Decoy's visible flag and minute-663 sighting; player/time/history; and exact membership exclusion from Stairwell. Actor and location client payloads retained one `hiddenFromPlayer:true` Scout and one visible Decoy, which is the backend marker the browser filter consumes. Zero model prompts, realtime errors, or changed logs occurred; no production defect or cassette was needed. Stealth/hidden coverage is complete at 8/8. Current goal progress is 103/148 backend cases with 45 remaining; all 71 pre-harness completions remain credited.
- Promoted immutable `long-time-rest-lodge` and derivative `long-time-scheduled-events` fixtures. The lodge fixture's final setup passed 53/53 assertions after deterministically normalizing its generated keeper and has integrity hash `4b5a1bde3cccefc301da47fcccef21b19f3b9de7fe738f16c3fed9b0f25a93cc`. The scheduled derivative passed 41/41 assertions with exact pending events at minutes 693 and 708 and has integrity hash `eb0f38ee04beb2936199ad6d5ceb61655b55a26f3fbb450413db5fda05c5a21e`.
- TIME-1 passed live-verify attempt 7 with 78/78 assertions and accepted human review. After isolating all fixture NPCs and using the warm QA Long Rest Lodge, one tonic minute consumed QA Short Tonic, applied its ten-minute Luck status once, and triggered the exact minor-stimulant Rest recovery. One continuous sleep from 11:04 AM to 7:04 PM advanced 480 minutes exactly once, filled Rest/Mana/Stamina, expired the tonic status, applied Food drift once to `263.29999999999995`, retained lodge placement, and stored exactly two action/time-summary pairs without realtime or changed-log errors. Earlier attempts corrected ambiguous test triggers and an implausible exposed sleep location; no production defect, prose heuristic, or cassette was involved. Current goal progress is 104/148 backend cases with 44 remaining; all 71 pre-harness completions remain credited.
- TIME-2 passed state-only attempt 2 with 94/94 assertions. After normalizing active player needs, the ordinary `/time` path advanced to Sunday 11:58 PM and then five minutes across midnight. Canonical state became day index 1/minute 3 and Monday January 2 at 12:03 AM; full actor status persisted `elapsedTime:1443`; New Year's Day cleared; seasonal lighting changed to deep night; Food/Rest reached exact passive values 454/532; and the saved Clear weather state remained byte-for-byte unchanged because its expiry follows the boundary. Location, status, schedules, calendar definition, and history stayed unchanged, with zero prompts or runtime errors. Current goal progress is 105/148 backend cases with 43 remaining; all 71 pre-harness completions remain credited.
- TIME-3 passed state-only attempt 1 with 68/68 assertions after a 66/66 state-only setup promoted `long-time-season-boundary` with integrity hash `74ab6abd916310b0f85bfe10d4a8ebbc357e94268abbab181e1fedebeebfe11e`. A five-minute ordinary time advance crossed Tuesday February 28 at 11:58 PM into Wednesday March 1 at 12:03 AM, advanced serialized actor time from 84958 to 84963, selected the canonical Spring description and night lighting, and recomputed deterministic local weather from QA Winter Still to QA Spring Rain with duration 100000 and next-change minute 184963. A second calendar resolution preserved that weather state exactly; location, statuses, schedules, calendar definition, and history stayed unchanged, with zero prompts or runtime errors. Current goal progress is 106/148 backend cases with 42 remaining; all 71 pre-harness completions remain credited.
- TIME-4 passed the complete model-backed evidence chain. Live-record attempt 6 and independent live-Qwen attempt 8 passed 64/64 assertions plus human review; strict no-llama replay attempt 7 consumed all 12 ordered cassette completions with zero failures or leftovers. A sixty-minute advance resolved the local bell first with the only visible prose and the offscreen lodge ledger second with hidden bookkeeping only; both resolved once at minute 723, actor time and passive needs advanced once, no character/object moved, and a one-minute follow-up replayed neither. The run added exact structured `historyAddedSequence` assertions, wildcard scheduled-event progress targets, a strict XML applicability decision/reason parser, and a strict non-null text-only summary parser. Unsupported summary details remain a prompt-and-human-review concern rather than a prose regex/classifier. Current goal progress is 107/148 backend cases with 41 remaining; all 71 pre-harness completions remain credited.
- TIME-5 passed the complete post-fix evidence chain. Live-record attempt 7 and independent live-Qwen attempt 9 passed 62/62 assertions plus human review; strict no-llama replay attempt 8 consumed 40/40 ordered completions with zero failures or leftovers. An ordinary one-minute player action crossed ETA, returned normal-turn time progress, finalized QA Clockwork Tram once at QA East Platform, retained all occupants and Rika's case aboard, preserved and retargeted the stable vehicle exit, ordered Player Turn before Vehicle Movement, and did not replay arrival on the next minute. Live attempt 6 had converted scheduled vehicle arrival into player/NPC disembarkation; the TinyBrain prompt now explicitly separates vehicle arrival from player movement at both drafting and structured movement selection. No prose scanner or hardcoded classifier was added. Existing tool allowlisting also rejected and retried undeclared teleport attempts without mutation. Cassette SHA-256 is `bfb9ddc3d404ffcf1c645ba88b6a4fc6ac2f397568d7ab365b99da156dea2e7b`. Current goal progress is 108/148 backend cases with 40 remaining; all 71 pre-harness completions remain credited.
- TIME-6 passed the complete model-backed evidence chain. Live-record attempt 4 and independent live-Qwen attempt 6 passed 58/58 assertions plus human review; strict no-llama replay attempt 5 consumed all 58 ordered completions without provider traffic, failures, or leftovers. After a nineteen-minute absence and authoritative twelve-minute solo trip, player-action calculated the expected-arrival age as 31 minutes, supplied the existing lodge description and exact present-NPC list, incorporated its three accepted change bullets into one destination passage, and did not ask the model to estimate travel time. Arrival landed at minute 694 and produced exactly one hidden WYWA bookkeeping row for Mio, QA Lodge Keeper, and Ruri from the affirmative pre-arrival visit snapshot, with no visible WYWA prose. Earlier attempts corrected harness response targeting and removed ambiguous eligible companions through normal APIs; no production change or prose heuristic was needed. Cassette SHA-256 is `d446c705e65586106efe570389a75c4835efaa80407c2582852bb732de6d759c`. Current goal progress is 109/148 backend cases with 39 remaining; all 71 pre-harness completions remain credited.
- TIME-7 passed the complete model-backed evidence chain and closes long-time advancement at 7/7. Live-record attempt 2 and independent live-Qwen attempt 4 passed 83/83 assertions plus human review; strict no-llama replay attempt 3 consumed all 9 ordered completions without provider traffic, failures, or leftovers. Named saves immediately before and after minute 693 independently restored world/actor minutes 692 and 693, QA Boundary Vigor duration/appliedAt pairs 6/692 and 5/693, exact lodge/marker visit minute 692, baseline placement, exact history, and the transition from both events pending to only the due bell resolved. Deliberate runtime status/location/time mutations were absent after either load, and the later lodge event remained pending. The scenario permits only the exact scheduled-resolution network-error prefix because router model switching caused a transient socket reset that normal transport retry recovered without mutation; the strict XML parser also rejected and retried one malformed applicability response. No production change or prose heuristic was needed. Cassette SHA-256 is `d286eae5ce038a878a46dfabdc087423d39f2b8fad37eebb3d6c42b1ecdc15e2`. Current goal progress is 110/148 backend cases with 38 remaining; all 71 pre-harness completions remain credited.
- Promoted immutable fixture `random-scheduled-events` after its state-only continuation passed 22/22 API assertions and direct persisted-state verification of the region random pool. Generic `@@` setup created QA Bell Runner/QA Brass Bell, connected and expanded QA Offscreen Depot with a neutral QA Depot Marker, scheduled exact +2/+3-minute records, and seeded exact location/region random pools. Its manifest has 16 executable invariants and save-tree integrity hash `914d915312e1d79348b7560541d527f4a613e8af119b4c9b4a0a82c0a1e7200c`; dedicated live/replay profiles force only the location-specific category to 100% for EVENT-1.
- EVENT-1 passed the complete model-backed evidence chain. Corrected live-record attempt 2, strict no-provider replay attempt 4, and independent live-Qwen attempt 5 passed 40/40 assertions; replay consumed all 51 ordered cassette completions without model traffic, and both live outputs passed human review. Exactly one location seed produced one `random-event` response/history row, advanced actor/world time once to minute 664, consumed the location pool, left both scheduled events pending, and changed no character, object, location, region, player placement, or status. The first mechanically passing output failed human review by replacing the seed's assigned Bell Runner action with another NPC; TinyBrain random-event plan/draft/audit guidance now preserves authoritative named actors, objects, action assignments, exact counts, and explicit no-movement constraints. No prose scanner, classifier, or hardcoded narrative logic was added. Cassette SHA-256 is `422a49d0d22509a6c88d2c37bb6116023bb2b4ca03e57dbd0cad037b48e1a2af`. Current goal progress is 111/148 backend cases with 37 remaining; all 71 pre-harness completions remain credited.
- EVENT-2 passed three independently restored live-Qwen scenario branches at 33/33 assertions each. The file-backed `party` event made QA Tired Companion its central participant and preserved clock, party membership, spatial/entity state, schedules, and seeded pools. The `location` event consumed only the exact Bell Runner/Bell seed; the `region` event retained that location pool while consuming only the exact distant blue signal-lamp seed. Both consumable branches returned an ephemeral no-event result and added no history row when immediately forced a second time, which behaviorally proves region consumption despite compact API projections omitting region `randomEvents`. All three stored the correct structured rarity and passed human review. No production defect, cassette, or prose heuristic was needed. Current goal progress is 112/148 backend cases with 36 remaining; all 71 pre-harness completions remain credited.
- EVENT-3 passed live-Qwen attempt 1 with 40/40 assertions plus human review. Advancing exactly two minutes from fixture minute 663 resolved only the present-location `sevent_1` bell at minute 665, stored one hidden scheduled-event row followed by one visible prose row, and left the depot event completely pending. Both summary and prose retained QA Bell Runner, QA Brass Bell, and exactly one ring. Actor/world time advanced once; Bell Runner/Bell placement, player/status state, locations, regions, things, and the location random seed stayed unchanged. No production defect, cassette, or prose heuristic was needed. Current goal progress is 113/148 backend cases with 35 remaining; all 71 pre-harness completions remain credited.
- EVENT-4 passed the complete prospective evidence chain. Live-record attempt 13 and independent live-Qwen attempt 15 passed 55/55 assertions; strict no-provider replay attempt 14 consumed all 11 ordered completions with no failures or leftovers. After Baato moved away at zero time, the no-mutation local bell and exact-field remote depot event both resolved once at minute 666 with hidden bookkeeping and no visible scheduled prose. QA Depot Marker's `description` became exactly `The depot marker bears one fresh blue QA stripe.` while `shortDescription`, effect fields, placement, all unrelated entity state, and player placement stayed unchanged. Failed iterations exposed player-presence applicability leakage, unsafe whole-entity regeneration for a direct replacement, neighboring-field/value drift, and llama.cpp textual pseudo-tool calls. TinyBrain scheduled resolution now parses an exact authoritative event/target/allowlisted-field/value plan, validates calls before mutation, and deterministically executes direct-update-only/no-change plans through the existing server executor with successful retry caching; richer or prompt-launching plans retain the normal tool loop. Textual pseudo-tool JSON is never treated as executable, and no generated-prose classifier or regex was added. Cassette SHA-256 is `22d66594e5b02df75059cea6ddd254ca8a26036175206c53bfa149d4efb465ca`. Current goal progress is 114/148 backend cases with 34 remaining; all 71 pre-harness completions remain credited.
