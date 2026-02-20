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
