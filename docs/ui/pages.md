# UI Pages and Routes

This page maps routes to templates and the client scripts/styles they load.

## Shared head behavior
- Shared head tags now live in `views/_includes/head-common.njk`.
- All top-level page templates (`index`, `new-game`, `config`, `settings`, `lorebooks`, `debug`, `player-stats`) include that partial for shared `meta`, `title`, favicon, and `main.css` tags.
- The shared favicon target is `/assets/fluentui-emoji/crossed_swords_color_classic.svg`.
- Top-level pages also include `views/_includes/app-header.njk` for the shared app header. The legacy `views/_navigation.njk` now delegates to that partial.

## Main chat interface
- Route: `/`
- Template: `views/index.njk`
- Styles: `public/css/main.css`, `public/css/map.css`, plus mod styles if present.
- Scripts (in order):
  - Vendor: `public/vendor/cytoscape*.js`, `public/vendor/layout-base.js`, `public/vendor/cose-base.js`, `public/vendor/nunjucks.js`, `public/vendor/markdown-it.min.js`, `public/vendor/json-viewer.js`.
  - App: `public/js/cytoscape-convex-hull.js`, `public/js/lightbox.js`, `public/js/image-manager.js`, `public/js/currency-utils.js`, `public/js/formula-evaluator.js`, `public/js/attribute-skill-allocator.js`, `public/js/chat.js`, `public/js/map.js`, `public/js/world-map.js`, `public/js/player-stats.js`.
  - Optional mod scripts from `ModLoader` (injected by `server.js`).
- Inline script responsibilities:
  - Tab switching (`initTabs`), map triggers, party/faction/quest panels, and Story Tools history paging/editor panel.
  - Location display, edit modals, crafting/salvage modals.
  - Region edit modal field handling (name/description/short description, parent region, average level, controlling faction dropdown sourced from `/api/factions`, shared vehicle-info editor fields, and a collapsed-by-default `Region Secrets` editor with add/remove rows); scrolling is handled by the modal overlay and the region dialog has no max-height cap so expanded sections remain usable.
  - Region weather edit modal handling from the location/map context menus; it edits `Region.weather` through `/api/regions/:id` with dynamic-weather toggle, per-season weather groups, and weather-type name/description/frequency/duration fields.
  - Calendar edit modal handling from the location/map context menus; it loads `/api/calendar`, renders the full `calendarDefinition` as tabbed fields for year name, ordered months, weekdays, seasons/time descriptions, and holidays, saves through `PUT /api/calendar`, and refreshes the world-time chip/current location after a successful save.
  - Set-last-seen modal handling from the main-location and map context menus; it collects the same `H AM/PM`, `H:MM AM/PM`, or `duration ago` text accepted by `/set_last_seen` and dispatches through the shared slash-command client path.
  - Image rendering helpers (`renderEntityImage`) and tooltip helpers.
- Data injected by `server.js`:
  - `chatHistory`, `player`, `availableSkills`, `currentSetting`.
  - `pointPoolFormulas`.
  - `rarityDefinitions`, `needBarDefinitions`, `checkMovePlausibility`.
  - `baseWeaponDamage`, `clientMessageHistory`, `saveMetadata`.
- Notes: the player "View" modal reuses shared allocation partials for attributes/skills; NPCs use read-only controls, while players can spend points and submit through `/api/player/update-stats` (negative pools blocked, positive pools confirmed). Unspent pools are computed server-side from submitted level/attributes/skills.
- Notes: location and region edit forms share `views/_includes/vehicle-info-fields.njk` for vehicle editing (`isVehicle` toggle, `icon` dropdown, a single-select destination picker, `ETA`, and a `Vehicle Exit` select). The location edit form also exposes `Local Weather`, which stores `generationHints.hasWeather` as exposed, visible outside, sheltered, or automatic. The destination picker edits `vehicleInfo.currentDestination` for resolved trips and the active `pendingDestination` target for underway trips; unresolved pending targets without a concrete `locationId` still render in the picker from their saved region/location names so they can be seen, cleared, or replaced, while region-only pending targets are preserved until explicitly changed. Both the active destination picker and the fixed-route destination list include `New Region` actions: the active picker writes a region-only unresolved `pendingDestination`, while fixed routes store `pending-region:<region name>` entries so the route can remember a not-yet-generated region until timed arrival builds it. Vehicle-exit options render as `inside -> outside`; location/stub editors list exits from the edited location, while region editors list cross-region exits from locations in that region. Map-tab stub editing reuses the same vehicle editor in stub mode.
- Notes: client-side name rendering for character/item/scenery cards applies a `font-size: 0.75em` span when a name exceeds 40 characters.
- Notes: after a successful Load Game action, if save metadata indicates `npcAliasesGenerated=false` (or missing), the client shows a confirmation dialog; accepting runs `/api/npcs/generate-aliases` before page reload (20 NPCs per prompt batch), declining leaves aliases empty.
- Notes: the shared player/NPC edit modal includes aliases (one alias per line) plus resistances/vulnerabilities text fields, submitted through `PUT /api/npcs/:id`. When editing an NPC, the same modal also exposes per-character need-bar applicability checkboxes; this section is omitted for the player.

## New game
- Route: `/new-game`
- Template: `views/new-game.njk`
- Styles: `public/css/main.css` + page inline styles.
- Scripts: `public/js/formula-evaluator.js`, `public/js/attribute-skill-allocator.js`, `public/js/new-game.js`.
- Data injected by `server.js`:
  - `newGameDefaults`, `currentSetting`.
- Notes: the Starting Location Generation Instructions field uses a multiline placeholder template (region name, summary, rooms/locations, region exits).
- Notes: the New Game form includes a `Start Time (24h hour)` field (`0`-`23`) with default `9` (09:00).
- Notes: submits `/api/new-game` with a keepalive POST, then immediately navigates to `/#tab-adventure` while generation continues; websocket status updates drive the overlay spinner if the page remains visible.
- Notes: skills are pulled from the active setting (`defaultExistingSkills`) and displayed for allocation; the New Game form can add or remove skills and recalculates pools immediately.
- Notes: attribute/skill allocation markup is included via `views/_includes/attribute-allocation.njk` and `views/_includes/skill-allocation.njk`.
- Notes: skills are sorted alphabetically in the New Game allocation list.
- Notes: the New Game form lets players adjust attribute and skill allocations via point pools; base pool formulas and max caps come from `config.formulas.character_creation` and are then adjusted by refunds/spend (attributes below/above 10, skills above rank 1). Pools can go negative but the submit button disables until overspending is resolved, and unspent points trigger a confirmation prompt. The form submits level/attributes/skills only; unspent values are derived server-side.
- Notes: pool formulas are evaluated after attribute definitions load so `attribute.*`/`skill.*` variables are available; evaluation errors surface in the warning area and disable form submission.
- Notes: the New Game form includes `Save Form Settings` / `Load Form Settings` controls backed by `/api/new-game/settings/save`, `/api/new-game/settings/load`, and `/api/new-game/settings/saves`.
- Notes: loading applies attributes/skills on a best-effort name match; any current attribute/skill without a matching loaded entry resets to its default value (attribute default stat, skill rank 1).
- Notes: attribute matching also checks definition label/abbreviation aliases; blank aliases are ignored so saved-form loading does not fail when optional alias fields are empty.

## System configuration
- Route: `/config`
- Template: `views/config.njk`
- Styles: `public/css/main.css`, `public/css/config.css`.
- Script: `public/js/config.js` + inline helper script.
- Data injected by `server.js`:
  - `config`, `modConfigs`, `modelOptions`, `savedMessage`, `errorMessage`, `gameConfigOverrideYaml`, `gameLoaded`.
- Notes: the global nav labels this route as `System`, while the page title is `System Configuration`.
- Notes: the page is split into `Server Configuration` and `Game Configuration` tabs.
- Notes: the AI section includes a backend selector. `openai_compatible` shows endpoint/API-key inputs, while `codex_cli_bridge` shows Codex command/home/session settings plus conditional session-id validation for `resume_id`.
- Notes: Gameplay Tuning exposes `Debug Tool Calls`, which writes live prompt-excluded tool diagnostics into the chat log when enabled.
- Notes: the `Game Configuration` tab exposes a fixed-width YAML textarea for the currently loaded game's runtime config override. It saves through `PUT /api/game-config-override`, reloads config immediately on change, persists to the save as `gameConfigOverride.yaml`, and stays disabled when no game is loaded.

## World profiles manager
- Route: `/settings`
- Template: `views/settings.njk`
- Styles: `public/css/main.css`, `public/css/settings.css`.
- Script: inline (settings CRUD is embedded in the template).
- Data injected by `server.js`:
  - `currentPage` only. Data is loaded via `/api/settings` calls.
- Notes: the global nav labels this route as `Worlds`, while the page title is `World Profiles`. The underlying API and internal ids still use `settings`.
- Notes: uses a master-detail layout with a left world-profile library and a right editor panel.
- Notes: the left panel includes search (`name/theme/genre/tone/difficulty`), sort controls, and selection-scoped actions (`Edit`, `Apply`, `Clone`, `Delete`), instead of per-row action buttons.
- Notes: editor fields are grouped into tabbed sections (`Basics`, `New Game Defaults`, `Factions`, `Character Options`, `Prompt Guidance`, `Image Prefixes`) and a sticky action bar keeps `Clear`, `Create/Update`, and `Auto-Fill Blank Fields` visible while scrolling.
- Notes: the `Factions` tab includes:
  - `Number of Factions` input (`defaultFactionCount`) for new-game faction target count.
  - A settings-local faction editor (list/detail, assets/relations/tiers, add/delete/apply).
  - `Pre-Generate Factions` using `/api/settings/factions/generate`.
  - `Auto-Fill Selected` using `/api/settings/factions/fill-missing`.
- Notes: tab buttons use fixed pill sizing in CSS so they do not vertically stretch/shrink with container height changes.
- Notes: library/editor scrolling is container-scoped within the settings workspace (instead of raw viewport-height caps) so bottom actions stay reachable.
- Notes: the default Starting Location Generation Instructions field mirrors the multiline placeholder used on the New Game form.
- Notes: the Default Existing Skills field is prefilled from `defs/default_skills.yaml` when creating a new (blank) setting.
- Notes: the auto-fill button can append up to ~10 setting-specific skills when the skills list is empty or baseline-only.
- Notes: Prompt Guidance includes `Custom Slop Words` (one per line); single-word entries feed slop-word checks and multi-word entries feed configured ngram checks.
- Notes: editing a setting and changing its name creates a new setting id (the original setting remains available).
- Notes: deleting a setting removes both in-memory and persisted copies; deleted settings do not return after page refresh.

## Lorebooks manager
- Route: `/lorebooks`
- Template: `views/lorebooks.njk`
- Styles: `public/css/main.css`, `public/css/lorebooks.css`.
- Script: `public/js/lorebooks.js`.
- Data injected by `server.js`:
  - `currentPage` only. Data is loaded via `/api/lorebooks` calls.

## Debug page
- Route: `/debug`
- Template: `views/debug.njk`
- Styles: `public/css/main.css` + inline styles.
- Script: external `pretty-json-custom-element` for rendering JSON.
- Data injected by `api.js`:
  - `player`, `playerJson`, `allPlayers`, `allLocations`, `gameWorld`, etc.

## Player stats editor (legacy)
- Route: `/player-stats`
- Template: `views/player-stats.njk`
- Styles: `public/css/main.css`.
- Script: `public/js/player-stats.js`.
- Data injected by `api.js`:
  - `player`, `availableSkills`.

## Shared navigation
- Template partials: `views/_includes/app-header.njk` and `views/_includes/app-header-nav.njk`.
- Legacy shim: `views/_navigation.njk`.
- Primary nav order is `Play`, `New Game`, `Worlds`, `Lorebooks`, `System`, and a native `Tools` disclosure containing `Debug` and `Player Stats`.
- The chat page action cluster includes `Save` and `Load` buttons with stable ids `saveGameBtn` and `loadGameBtn`; `New Game` is primary navigation, not a chat action button.
