# UI Pages and Routes

This page maps server-rendered routes to templates, shared page chrome, injected data, and page-local scripts/styles.

## Shared Head And Header

- Shared head tags live in `views/_includes/head-common.njk`: `charset`, viewport, `title`, favicon, `/css/main.css`, and the deferred `/js/pending-load.js` script.
- Top-level page templates (`index`, `new-game`, `config`, `settings`, `mods`, `lorebooks`, `debug`, `player-stats`) include `views/_includes/head-common.njk`.
- Top-level pages include `views/_includes/app-header.njk` for the shared app header. `views/_navigation.njk` is a compatibility shim that includes the same header partial.
- The shared favicon target is `/assets/fluentui-emoji/crossed_swords_color_classic.svg`.
- `public/js/pending-load.js` checks `GET /api/pending-load` on `DOMContentLoaded`. A pending load intent redirects non-play pages to `/?pendingLoad=1#tab-adventure`, posts `/api/load` with `fromPendingLoad: true`, clears the intent with `DELETE /api/pending-load` after a successful load, and reloads the play page at `/#tab-adventure`.

## Main Chat Interface

- Route: `/`
- Template: `views/index.njk`
- Styles: `/css/main.css`, `/css/map.css`, plus mod styles from `ModLoader.getModClientStyles()`.
- Scripts:
  - Vendor/domain libraries: `/vendor/cytoscape.min.js`, `/vendor/layout-base.js`, `/vendor/cose-base.js`, `/vendor/cytoscape-fcose.js`, `/vendor/cytoscape-euler.js`, `/vendor/nunjucks.js`, `/vendor/markdown-it.min.js`, `/vendor/json-viewer.js`.
  - App scripts: `/js/cytoscape-convex-hull.js`, `/js/lightbox.js`, `/js/image-manager.js`, `/js/currency-utils.js`, `/js/formula-evaluator.js`, `/js/attribute-skill-allocator.js`, `/js/turn-state-diff-drawer.js`, `/js/chat.js`, `/js/map.js`, `/js/world-map.js`, `/js/player-stats.js`.
  - Mod client scripts from `ModLoader.getModClientScripts()`.
- Data injected by `server.js`:
  - `chatHistory`, `currentPage`, `gameLoaded`, `player`, `availableSkills`, `currentSetting`.
  - `pointPoolFormulas`, `rarityDefinitions`, `needBarDefinitions`, `checkMovePlausibility`, `baseWeaponDamage`, `clientMessageHistory`.
  - `saveMetadata`, `vehicleDebugEnabled`, `thingImageBadges`, `thingContextActions`, `thingEditFields`, `modScripts`, `modStyles`.
- Inline script responsibilities:
  - Tab switching (`initTabs`), map triggers, party/faction/quest panels, Story Tools history paging/editor panels, Story Tools search/filter/highlighting, Scene Summaries, and Mystery Boxes.
  - Location display, location/stub edit modals, NPC/player/thing edit flows, crafting/salvage/harvest modals, save/load modals, and turn state UI wiring.
  - Region edit modal fields for name, description, short description, parent region, average level, controlling faction, shared vehicle info, and `Region Secrets`.
  - Region weather edit modal from location/map context menus; it edits `Region.weather` through `/api/regions/:id` with dynamic-weather, per-season weather groups, and weather-type name/description/frequency/duration fields.
  - Calendar edit modal from location/map context menus; it loads `/api/calendar`, renders the `calendarDefinition` as structured fields for year name, months, weekdays, seasons/time descriptions, and holidays, saves through `PUT /api/calendar`, and refreshes world-time/current-location display after save.
  - Set-last-seen modal from main-location and map context menus; it accepts the same exact-time or relative-duration text as `/set_last_seen` and dispatches through the shared slash-command client path.
  - Image rendering helpers (`renderEntityImage`), tooltip helpers, mod-provided thing image badges, mod-provided thing context actions, and mod-provided thing edit fields.
- Player/NPC "View" modals reuse shared allocation partials for attributes/skills. NPCs use read-only controls; players can spend points through `/api/player/update-stats` with negative pools blocked and positive pools confirmed. Unspent pools are computed server-side from submitted level/attributes/skills.
- Location and region edit forms share `views/_includes/vehicle-info-fields.njk` for vehicle editing (`isVehicle`, icon, destination picker, ETA, fixed-route destinations, and Vehicle Exit). Location edits also expose Local Weather (`generationHints.hasWeather`) and region relocation controls backed by `/api/locations/:id/relocate`.
- Ordinary location stubs use the region selector in stub mode and save `targetRegionId` through `/api/stubs/:id`; region-entry stubs hide that selector. Stub descriptions may be empty.
- Vehicle destination pickers preserve unresolved pending targets until a user clears or replaces them. Active destination and fixed-route destination lists support region-only unresolved targets for trips/routes into not-yet-generated regions.
- Client-side name rendering applies a `font-size: 0.75em` span when character/item/scenery names exceed 40 characters.
- Load Game handles `MOD_ENABLEMENT_MISMATCH` with the Save Mods Differ modal. Extra-active and missing-active mod groups are shown separately; choices apply the save's mod configuration, retry with the running mod set, or cancel.
- Saves with missing or false `npcAliasesGenerated` metadata prompt for alias generation through `/api/npcs/generate-aliases` before reload.
- The shared player/NPC edit modal includes aliases, resistances/vulnerabilities, and NPC-only need-bar applicability checkboxes submitted through `PUT /api/npcs/:id`.

## New Game

- Route: `/new-game`
- Template: `views/new-game.njk`
- Styles: `/css/main.css` plus page inline styles.
- Scripts: inline navigation guard/default-data setup, `/js/formula-evaluator.js`, `/js/attribute-skill-allocator.js`, `/js/new-game.js`.
- Data injected by `server.js`: `newGameDefaults`, `currentSetting`.
- The form includes player name/description, level, start time (`0`-`23`, default `9`), class/race selectors with custom entries, starting location generation instructions, starting currency, attributes, and skills.
- Starting Location Generation Instructions use the multiline placeholder template for region name, summary, rooms/locations, and region exits.
- Skills come from the active world profile's `defaultExistingSkills`, sort alphabetically in the allocation list, and can be edited on the form.
- Attribute/skill allocation markup comes from `views/_includes/attribute-allocation.njk` and `views/_includes/skill-allocation.njk`. Formulas come from `config.formulas.character_creation`; formula errors display in the warning area and disable submit.
- Pools can go negative, but submission is disabled until overspending is resolved. Positive unspent pools trigger a confirmation prompt. Submitted payloads include level/attributes/skills; unspent values are derived server-side.
- Submitting posts `/api/new-game` with `keepalive: true` and immediately navigates to `/#tab-adventure`; websocket status updates drive the overlay spinner while the page is visible.
- `Save Form Settings` / `Load Form Settings` use `/api/new-game/settings/save`, `/api/new-game/settings/load`, and `/api/new-game/settings/saves`.
- Loading saved form settings matches attributes/skills by name, definition label, and abbreviation aliases. Current attributes/skills without a loaded match reset to defaults.

## System Configuration

- Route: `/config`
- Template: `views/config.njk`
- Styles: `/css/main.css`, `/css/config.css`.
- Scripts: `/js/config.js` plus inline helpers.
- Data injected by `server.js`: `config`, `modConfigs`, `modelOptions`, `savedMessage`, `errorMessage`, `gameConfigOverrideYaml`, `gameLoaded`.
- The app header nav label is `System`; the page title is `System Configuration`.
- The page has `Server Configuration` and `Game Configuration` tabs.
- The AI section has a backend selector. `openai_compatible` displays endpoint/API-key inputs. `codex_cli_bridge` displays command, home, model/session settings, sandbox, reasoning effort, profile, skip-git-check, prompt preamble, and session-id validation for `resume_id`.
- Image Generation includes prompt batching controls for enablement, delay, and maximum compatible prompts per batch.
- Gameplay Tuning includes Debug Tool Calls, Show Hidden Notes in Story Tools, and the compatibility prompt-check toggle for attack/skill checks.
- The `Game Configuration` tab exposes a fixed-width YAML textarea for the loaded game's runtime config override. It saves through `PUT /api/game-config-override`, reloads merged config on change, persists to the save as `gameConfigOverride.yaml`, and is disabled until a game is loaded.

## Mods

- Route: `/mods`
- Template: `views/mods.njk`
- Styles: `/css/main.css`, `/css/config.css`.
- Script: inline mod-manager script.
- Data injected by `server.js`: `modState` from `ModManager.buildModManagerState()`.
- The page lists discovered valid mods with configured enablement checkboxes, runtime active indicators, mod contents (`mod.js`, `defs`, or metadata only), and restart-required messaging.
- `Save Mod Selection` sends `PUT /api/mods/enabled`, writes `config.yaml`, refreshes the displayed mod state, and reports whether restart is required.
- `Refresh` fetches `GET /api/mods/manager` and rerenders the list.

## World Profiles

- Route: `/settings`
- Template: `views/settings.njk`
- Styles: `/css/main.css`, `/css/settings.css`.
- Script: inline settings CRUD/editor script.
- Data injected by `server.js`:
  - `currentPage`, `defaultExistingSkills`, `defaultExistingSkillsError`, `defaultFactionCountFallback`, `unifiedTonalScaleDefinition`, `unifiedTonalScaleError`, `attributeOptions`.
  - `modSettingFields` for ungrouped mod fields and `modSettingTabs` for tabbed mod fields.
- The app header nav label is `Worlds`; the page title is `World Profiles`. The API and internal ids use `settings`.
- The layout is master/detail: left world-profile library and right editor panel.
- The library panel includes search across name/theme/genre/tone/difficulty, sort controls, and selection-scoped `Edit`, `Apply`, `Clone`, and `Delete` actions.
- Editor tabs are `Basics`, `New Game Defaults`, `Tone Scale`, `Factions`, `Character Options`, `Prompt Guidance`, optional mod-owned tabs, `Calendar`, and `Image Prefixes`. The sticky action bar keeps `Clear`, `Create/Update`, and `Auto-Fill Blank Fields` reachable.
- Mod setting fields with registered tabs render in their own World Profiles tab. Ungrouped mod fields render in Prompt Guidance under `Mod Settings`. Registered select fields render as dropdowns, array/object fields serialize through the generic mod-settings payload, non-persisted `applyPreset` action fields require confirmation, and the bundled modules mod uses a custom row editor for its `slotTypes` array.
- Tone Scale renders axes from `defs/unified_tonal_scale.yaml`. Dropdowns include defined levels plus generated half-step midpoint choices; if any tonal axis is selected, every axis needs a numeric level. Optional comments save in `setting.unifiedTonalScale`.
- Factions includes `Number of Factions`, a settings-local faction editor, `Pre-Generate Factions` through `/api/settings/factions/generate`, and `Auto-Fill Selected` through `/api/settings/factions/fill-missing`.
- The default Starting Location Generation Instructions field mirrors the New Game multiline placeholder.
- Default Existing Skills is prefilled from `defs/default_skills.yaml` for blank profiles.
- Character Options includes required Hiding Attribute and Perception Attribute selects from defined attributes, plus optional Hiding Skill and Perception Skill selects populated from the Default Existing Skills textarea.
- Calendar stores optional `setting.calendarDefinition` data through a structured editor with year name, Months, Weekdays, Seasons, and Holidays. It includes add/remove/reorder controls, dynamic month/day selectors, stale-reference validation, `/api/settings/calendar/generate`, `/api/settings/calendar/default`, and blank-state behavior for calendar generation during new-game setup.
- Auto-Fill Blank Fields can append setting-specific skills when the skills list is empty or contains only baseline defaults.
- Prompt Guidance includes `Custom Slop Words`; single-word entries feed slop-word checks and multi-word entries feed configured ngram checks.
- Editing a profile and changing its name creates a profile id for the new name while the original profile remains available.
- Deleting a profile removes in-memory and persisted copies; deleted profiles remain absent after page refresh.

## Lorebooks

- Route: `/lorebooks`
- Template: `views/lorebooks.njk`
- Styles: `/css/main.css`, `/css/lorebooks.css`.
- Script: `/js/lorebooks.js`.
- Data injected by `server.js`: `currentPage`. Lorebook data loads through `/api/lorebooks` calls.

## Debug

- Route: `/debug`
- Template: `views/debug.njk`
- Styles: `/css/main.css` plus inline styles.
- Scripts: external `pretty-json-custom-element`, `/js/image-manager.js`, and inline debug-page handlers.
- Data injected by `api.js`: `player`, `playerStatus`, `playerJson`, `totalPlayers`, `currentPlayerId`, `allPlayers`, `allLocations`, `allSettings`, `currentSetting`, `gameWorld`, `gameWorldCounts`, `currentPage`.

## Player Stats Editor

- Route: `/player-stats`
- Template: `views/player-stats.njk`
- Styles: `/css/main.css`.
- Scripts: `/js/image-manager.js`, `/js/player-stats.js`.
- Data injected by `api.js`: `player`, `currentPage`, `availableSkills`, `defaultUnspentSkillPoints`.

## Shared Navigation

- Template partials: `views/_includes/app-header.njk` and `views/_includes/app-header-nav.njk`.
- Compatibility shim: `views/_navigation.njk`.
- Primary nav order is `Play`, `New Game`, `Worlds`, `Mods`, `Lorebooks`, `System`, followed by a native `Tools` disclosure containing `Debug` and `Player Stats`.
- The `Tools` disclosure is open/active on Debug and Player Stats pages.
- The chat page action cluster includes `Save` and `Load` buttons with stable ids `saveGameBtn` and `loadGameBtn`; `New Game` is primary navigation, not a chat action button.
