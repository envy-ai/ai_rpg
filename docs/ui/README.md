# UI Documentation

This folder documents the core web client UI for AI RPG. It covers built-in pages, shared templates, client scripts, styling, browser-side templates, and UI assets. Mod-provided UI is documented with the owning mod when needed.

## Scope
- Server-rendered Nunjucks pages and shared partials in `views/`.
- Client-side behavior in `public/js/`.
- SCSS sources and compiled CSS in `public/css/`.
- Browser-rendered Nunjucks templates in `public/templates/`.
- Third-party browser libraries in `public/vendor/`.
- Built-in image, icon, and generated-image assets served from `assets/`, `public/icons/`, and `public/generated-images/`.

## UI entry points
- `/` -> `views/index.njk` (main chat interface).
- `/new-game` -> `views/new-game.njk`.
- `/settings` -> `views/settings.njk`.
- `/mods` -> `views/mods.njk`.
- `/lorebooks` -> `views/lorebooks.njk`.
- `/config` -> `views/config.njk`.
- `/debug` -> `views/debug.njk`.
- `/player-stats` -> `views/player-stats.njk`.

Routing is registered in `server.js` for Play, New Game, Worlds, Mods, Lorebooks, and System pages. `api.js` registers Debug and Player Stats.

## Directory map
- `views/` contains server-rendered templates.
  - `index.njk` is the Play UI: Adventure, maps, Relationships, Favorites, Character, Quests, Factions, Party, Story Tools, chat, panels, and modals.
  - `new-game.njk`, `settings.njk`, `mods.njk`, `lorebooks.njk`, `config.njk`, `debug.njk`, and `player-stats.njk` are top-level pages.
  - `_includes/head-common.njk` supplies shared head markup, favicon, `main.css`, and `pending-load.js`.
  - `_includes/app-header.njk` and `_includes/app-header-nav.njk` implement the shared app header and primary navigation.
  - `_includes/attribute-allocation.njk`, `_includes/skill-allocation.njk`, `_includes/thing-list-filter-toggle.njk`, and `_includes/vehicle-info-fields.njk` provide reusable UI fragments.
  - `_navigation.njk` delegates to the shared app header for template compatibility.
  - `views/popups/plausibility.njk` mirrors the plausibility tooltip markup used by the browser template.
- `public/js/` contains client scripts for chat, maps, the relationship graph, image jobs, lightbox behavior, allocation controls, new-game setup, configuration, lorebooks, pending-load handling, player stats, and turn state-diff rendering.
- `public/js/widgets/prompt-windows.js`, loaded by the shared head, provides the shared `AIRPG_PROMPT_WINDOWS` singleton for streaming-viewer chrome and terminal failure windows on all pages. Chat and standalone PageFeedback reuse its modeless shell, independent dragging, resizing, focused-window Escape dismissal, UUID deduplication and safe content. [PromptFailureReporter](../classes/PromptFailureReporter.md) documents the failure event and counts.
- The generated PromptWindows/modeless-chooser adapters consume portable
  [FloatingWindow](../classes/FloatingWindow.md), [PointerDrag](../classes/PointerDrag.md)
  and [ModelessChooser](../classes/ModelessChooser.md). App anchoring/failure/insertion
  policy stays in `client/widget-adapters`; Terminal/player-input/dock reuse their
  actual controllers. `widgets/controls.js` exposes the shared
  [Tabs](../classes/Tabs.md), [Repeater](../classes/Repeater.md),
  [OrderedTextList](../classes/OrderedTextList.md) and [NumberRange](../classes/NumberRange.md)
  used by workflow/Worlds/Config and bounded Play form editors.
- [`packages/ui-widgets`](../../packages/ui-widgets/README.md) is the independent native-DOM ESM/SCSS package. Its standalone specimen uses no app scripts, styles or API. `npm run widgets:build` regenerates classic app adapters and package/specimen CSS; generated assets retain existing URLs/load order.
- `public/js/widgets/overlays.js` is the generated adapter for [NativeDialog](../classes/NativeDialog.md) and [FloatingTooltip](../classes/FloatingTooltip.md). The shared head loads it before PageFeedback. PageFeedback/New Game share native lifecycle; Play's general and Party tooltips share timer/position/dismissal while app policies remain in their callers.
- [ModalStack](../classes/ModalStack.md) owns explicit custom-root visibility,
  shared backdrops and scroll locks through `widgets/modal-stack.js`; existing
  per-owner focus/dismissal/transaction policies remain adapters. The overlay
  bundle also exposes [AnchoredPopup](../classes/AnchoredPopup.md) for Thing/NPC/
  location/map menu lifetimes and portal cleanup. Native technique, attachment,
  charge reload and log-error consumers now share NativeDialog.
- `public/js/widgets/popup-dismissal.js` is the generated app adapter for [PopupDismissal](../classes/PopupDismissal.md): immediate option dismissal, outside capture, Escape/focus restoration and exclusive native disclosures. ActionImages consumes the app-owned service; the package factory also supports independent document ownership/disposal.
- `public/js/widgets/searchable-select.js` is the generated app adapter for [SearchableSelect](../classes/SearchableSelect.md): native single-choice dropdowns or checkbox multi-selection with substring search, explicit disabled state and teardown. Workflow/technique consumers retain their APIs and app labels; serialization remains with callers.
- `public/css/` contains SCSS sources (`_globals.scss`, `main.scss`, `settings.scss`, `config.scss`) and compiled CSS outputs (`main.css`, `settings.css`, `config.css`, `map.css`, `lorebooks.css`).
- `public/templates/` contains browser-side Nunjucks templates such as `plausibility.njk`.
- `public/vendor/` contains browser libraries including Cytoscape and layouts, Nunjucks runtime, Markdown-It, JSON viewer, Fitty, and Vaadin assets.

## Runtime globals injected on the chat page
From `views/index.njk`:
- `window.currentSetting`, `window.NPC_VIEW_POINT_POOL_FORMULAS`, `window.rarityDefinitions`, and `window.needBarDefinitions`.
- `window.__AIRPG_SAVE_METADATA__` and `window.__AIRPG_GAME_LOADED__`.
- `window.CHECK_MOVE_PLAUSIBILITY`.
- `window.availableSkillsList` and `window.getKnownSkillNameSet()`.
- `window.AIRPG_CONFIG.baseWeaponDamage`, `window.AIRPG_CONFIG.clientMessageHistory`, and `window.AIRPG_CONFIG.debugVehicles`.
- `window.AIRPG_CONFIG.thingImageBadges`, `window.AIRPG_CONFIG.thingContextActions`, and `window.AIRPG_CONFIG.thingEditFields`.
- `window.AIRPG_CLIENT_ID` is assigned by realtime-aware client code and reused by image, map, load, and chat requests.

## Files in this folder
- [widget_audit.md](widget_audit.md) inventories core and bundled mod widgets, existing shared foundations, individual dialog/overlay shells, extraction boundaries and the proposed order for merging into a decoupled library.
- `docs/ui/pages.md` maps routes to templates, shared partials, scripts, styles, injected data, and page behavior.
- `docs/ui/chat_interface.md` covers the main Play interface layout, tabs, panels, chat flow, inventory views, Story Tools, and client data flow.
- `docs/ui/modals_overlays.md` covers chat-page modals, overlays, tooltips, prompt tracker windows, containers, barter, and map confirmations.
- `docs/ui/maps.md` covers Region Map and World Map rendering, controls, fast travel, context menus, stubs, and vehicle map state.
- `docs/ui/relationships.md` covers the Play Relationships tab, Cytoscape graph rendering, hidden-character filtering, missing-id placeholders, and reload behavior.
- `docs/ui/assets_styles.md` covers SCSS/CSS, shared styling primitives, assets, icons, generated images, and vendor libraries.
- [item_charges.md](item_charges.md) covers item resource details, charge editing, ammo drag/drop and keyboard-accessible reloading.

- [TechniquesPanel](../classes/TechniquesPanel.md) shares grouped character technique cards, source selection, Use turns and structured mechanics/access/catalogue editors across Player Stats and Character Overview.

- [ModalStack](../classes/ModalStack.md) documents explicit custom top-owner policy,
  preserved native/mandatory/pending differences and focus-boundary APIs.
- [AnchoredPopup](../classes/AnchoredPopup.md) documents context/toolbar/Chat/map
  menu lifetimes and native header/responsive-navigation differences.
- [CollectionView](../classes/CollectionView.md), [ImageFrame](../classes/ImageFrame.md)
  and [Lightbox](../classes/Lightbox.md) document shared item presentation, native
  media replacement and session/keyboard ownership with app-owned domain policy.
