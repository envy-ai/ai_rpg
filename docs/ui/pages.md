# UI Pages and Routes

This page maps server-rendered routes to templates, shared page chrome, injected data, and page-local scripts/styles.

## Shared Head And Header

- Shared head tags live in `views/_includes/head-common.njk`: `charset`, viewport, `title`, favicon, `/css/main.css`, and the deferred `/js/pending-load.js` script.
- Top-level page templates (`index`, `new-game`, `config`, `settings`, `mods`, `lorebooks`, `debug`, `player-stats`) include `views/_includes/head-common.njk`.
- Top-level pages include `views/_includes/app-header.njk` for the shared app header. `views/_navigation.njk` is a compatibility shim that includes the same header partial.
- The shared favicon target is `/assets/fluentui-emoji/crossed_swords_color_classic.svg`; on the Play page, active prompt progress temporarily replaces it with a canvas-rendered progress favicon and restores the static SVG when prompts clear.
- `public/js/pending-load.js` checks `GET /api/pending-load` on `DOMContentLoaded`. A pending load intent redirects non-play pages to `/?pendingLoad=1#tab-adventure`, posts `/api/load` with `fromPendingLoad: true`, clears the intent with `DELETE /api/pending-load` after a successful load, and reloads the play page at `/#tab-adventure`.

## Main Chat Interface

- Route: `/`
- Template: `views/index.njk`
- Styles: `/css/main.css`, `/css/map.css`, plus mod styles from `ModLoader.getModClientStyles()`.
- Scripts:
  - Vendor/domain libraries: `/vendor/cytoscape.min.js`, `/vendor/layout-base.js`, `/vendor/cose-base.js`, `/vendor/cytoscape-fcose.js`, `/vendor/cytoscape-euler.js`, `/vendor/nunjucks.js`, `/vendor/markdown-it.min.js`, `/vendor/json-viewer.js`.
  - App scripts: `/js/cytoscape-convex-hull.js`, `/js/lightbox.js`, `/js/image-manager.js`, `/js/currency-utils.js`, `/js/formula-evaluator.js`, `/js/attribute-skill-allocator.js`, `/js/turn-state-diff-drawer.js`, `/js/chat.js`, `/js/map.js`, `/js/world-map.js`, `/js/relationship-graph.js`, `/js/player-stats.js`.
  - Mod client scripts from `ModLoader.getModClientScripts()`.
- Data injected by `server.js`:
  - `chatHistory`, `currentPage`, `gameLoaded`, `player`, `availableSkills`, `currentSetting`.
  - `pointPoolFormulas`, `rarityDefinitions`, `needBarDefinitions`, `checkMovePlausibility`, `baseWeaponDamage`, `clientMessageHistory`.
  - `saveMetadata`, `vehicleDebugEnabled`, `thingImageBadges`, `thingContextActions`, `thingEditFields`, `modScripts`, `modStyles`.
- Inline script responsibilities:
  - Tab switching (`initTabs`), map and relationship graph triggers, party/faction/quest panels, Story Tools history paging/editor panels, Story Tools search/filter/highlighting, Scene Summaries, and Mystery Boxes.
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
- The form includes player name/description, level, starting month/day, start time (`0`-`23`, default `9`), class/race selectors with custom entries, starting location generation instructions, starting currency, attributes, and skills.
- Starting month is a one-based calendar position. A stored world-profile calendar supplies its month names and exact day counts; profiles without a stored calendar show `Month 1` through `Month 12` until the calendar is generated. Changing months rebuilds the required day selector without silently coercing an invalid prior day.
- Starting month, day, and time initially use the active world profile's defaults. Legacy profiles without those fields use month `1`, day `1`, and `09:00`.
- Starting Location Generation Instructions use the multiline placeholder template for region name, summary, rooms/locations, and region exits.
- Skills come from the active world profile's `defaultExistingSkills`, sort alphabetically in the allocation list, and can be edited on the form.
- Attribute/skill allocation markup comes from `views/_includes/attribute-allocation.njk` and `views/_includes/skill-allocation.njk`. Formulas come from `config.formulas.character_creation`; formula errors display in the warning area and disable submit.
- Pools can go negative, but submission is disabled until overspending is resolved. Positive unspent pools trigger a confirmation prompt. Submitted payloads include level/attributes/skills; unspent values are derived server-side.
- Submitting posts `/api/new-game` with `keepalive: true` and immediately navigates to `/#tab-adventure`; websocket status updates drive the overlay spinner while the page is visible.
- `Save Form Settings` / `Load Form Settings` use `/api/new-game/settings/save`, `/api/new-game/settings/load`, and `/api/new-game/settings/saves`; saved profiles include `startMonth`, `startDay`, and `startTime`.
- Loading saved form settings matches attributes/skills by name, definition label, and abbreviation aliases. Current attributes/skills without a loaded match reset to defaults.

## System Configuration

- Route: `/config`
- Template: `views/config.njk`
- Styles: `/css/main.css`, `/css/config.css`.
- Scripts: `/js/config.js` plus inline helpers.
- Data injected by `server.js`: `config`, `modConfigs`, `modelOptions`, local-model discovery state, `savedMessage`, `errorMessage`, `configSaveTarget`, `gameConfigOverrideYaml`, and `gameLoaded`.
- The app header nav label is `System`; the page title is `System Configuration`.
- Seven top-level tabs separate `Server`, `AI`, `Story Engine`, `Gameplay`, `Image Generation`, global `Image Prompts`, and `Current Game` concerns. The Server-through-Image-Prompts tabs remain one form, so the visible tab's explicit save button validates and submits the complete system configuration without losing values on hidden tabs.
- The AI tab groups Essentials, the selected Provider Connection, Local Model Lifecycle, Prompt Context, and Generation & Reliability into the same ordinary `config-section` containers used by the other tabs. Backend selection still controls which connection fields are visible: `openai_compatible` displays endpoint/API-key inputs, while Codex, Cline, and Kimi expose their respective bridge controls only when selected. Shared AI controls include model swap options and the global `ai.sysprompt_append` textarea.
- Image Generation has its own top-level tab containing the canonical Generate/Edit workflow editor. Its workflow, model, encoder, VAE, LoRA, sampling, generation-resolution, and preset controls reuse the same shared form-grid, form-group, button, section-container, and section-spacing primitives as the Story Engine page; the shared World Profiles editor uses those primitives too. Image Edit omits resolution fields because edit jobs preserve the source image dimensions. Searchable model/encoder/VAE/LoRA choice inputs are presentation-only and serialize solely through each editor's typed workflow JSON field, so they do not leak untyped widget keys into `/config`. Standard Flux Klein edits also expose a default-on Flux KV-cache checkbox, hidden for Qwen and custom workflows. Preset **Save As** uses a shared modal and accepts a bare name without `.yaml`; Load/Save/Save As persist through the config-independent `image-workflow-presets.yaml` store. The former legacy image-generation field collection is no longer rendered on this page.
- Image Prompts exposes the global character, location, item, and scenery `imagegen.image_prompt_instructions` values as full-width textareas with explicit string type hints. Its save button uses the same complete system form and active-target behavior. The panel explains that nonblank World Profile → Image Prompt Generation fields override these global fallbacks.
- Directly below the top-level tab bar, the page displays the exact YAML file that system-form saves will modify. A session `/reload_config` override wins over the startup CLI override, which wins over root `config.yaml`. Image workflow preset controls always read and write the separate root `image-workflow-presets.yaml` store.
- For an OpenAI-compatible configuration with either a local startup script or a loopback endpoint, the AI model dropdown and mod model dropdowns contain only unique IDs returned by the running llama.cpp router's `/models` endpoint. The page displays discovery failures instead of silently using `model_swap_options`; remote and CLI configurations retain the editable configured list and Add Model flow.
- Gameplay Tuning includes Debug Tool Calls, Show Hidden Notes in Story Tools, and the compatibility prompt-check toggle for attack/skill checks.
- The `Current Game` tab exposes a fixed-width YAML textarea for the loaded game's runtime config override. Edits remain local and visibly marked unsaved until **Save Game Configuration** is pressed; that explicit action uses `PUT /api/game-config-override`, reloads merged config, and persists the raw YAML as `gameConfigOverride.yaml`. The editor is disabled until a game is loaded.
- Every successful system-form save first copies the exact previous selected target into the Git-ignored `config-backups/` directory. Preset replacement similarly backs up the standalone preset file. Backups retain comments and formatting; rewritten YAML continues through `js-yaml` and therefore does not retain comments.

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
- Editor tabs are `Basics`, `New Game Defaults`, `Tone Scale`, `Factions`, `Character Options`, `Prompt Guidance`, optional mod-owned tabs, `Calendar`, `Image Prompt Generation`, and `Image Prefixes`. The Image Prompt Generation fields are setting-scoped overrides for the global per-target prompt-writer instructions, while Image Prefixes are applied to final render prompts. The sticky action bar keeps `Clear`, `Create/Update`, and `Auto-Fill Blank Fields` reachable.
- Mod setting fields with registered tabs render in their own World Profiles tab. Ungrouped mod fields render in Prompt Guidance under `Mod Settings`. Registered select fields render as dropdowns, array/object fields serialize through the generic mod-settings payload, non-persisted `applyPreset` action fields require confirmation, and the bundled modules mod uses a custom row editor for its `slotTypes` array.
- Tone Scale renders axes from `defs/unified_tonal_scale.yaml`. Dropdowns include defined levels plus generated half-step midpoint choices; if any tonal axis is selected, every axis needs a numeric level. Optional comments save in `setting.unifiedTonalScale`.
- Factions includes `Number of Factions`, a settings-local faction editor, `Pre-Generate Factions` through `/api/settings/factions/generate`, and `Auto-Fill Selected` through `/api/settings/factions/fill-missing`.
- The default Starting Location Generation Instructions field mirrors the New Game multiline placeholder.
- New Game Defaults includes calendar-aware Default Start Month and Default Start Day selectors plus a Default Start Time hour (`0` through `23`). The selectors track the Calendar tab's month order and day counts; the saved values prefill New Game.
- Default Existing Skills is prefilled from `defs/default_skills.yaml` for blank profiles.
- Character Options includes required Hiding Attribute and Perception Attribute selects from defined attributes, plus optional Hiding Skill and Perception Skill selects populated from the Default Existing Skills textarea.
- Calendar stores optional `setting.calendarDefinition` data through a structured editor with year name, Months, Weekdays, Seasons, and Holidays. Season entries include separate image-ready Vegetation Description and Interior Description fields used by outdoor/sheltered and enclosed-interior seasonal edits. The in-game calendar modal exposes the same fields. It includes add/remove/reorder controls, dynamic month/day selectors, stale-reference validation, `/api/settings/calendar/generate`, `/api/settings/calendar/default`, and blank-state behavior for calendar generation during new-game setup.
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
