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
- `docs/ui/pages.md` maps routes to templates, shared partials, scripts, styles, injected data, and page behavior.
- `docs/ui/chat_interface.md` covers the main Play interface layout, tabs, panels, chat flow, inventory views, Story Tools, and client data flow.
- `docs/ui/modals_overlays.md` covers chat-page modals, overlays, tooltips, prompt tracker windows, containers, barter, and map confirmations.
- `docs/ui/maps.md` covers Region Map and World Map rendering, controls, fast travel, context menus, stubs, and vehicle map state.
- `docs/ui/relationships.md` covers the Play Relationships tab, Cytoscape graph rendering, hidden-character filtering, missing-id placeholders, and reload behavior.
- `docs/ui/assets_styles.md` covers SCSS/CSS, shared styling primitives, assets, icons, generated images, and vendor libraries.
