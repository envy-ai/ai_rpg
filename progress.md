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
  - `node --check public/js/chat.js` ✅

Original prompt: Trigger item-card long-name compact style when any word is 12+ characters.

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
