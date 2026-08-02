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
