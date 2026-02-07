# UI Documentation

This folder documents the core UI (no mod-provided UI) for the AI RPG web client.

## Scope
- Server-rendered Nunjucks pages in `views/`.
- Client-side behavior in `public/js/`.
- Styling in `public/css/`.
- Client templates in `public/templates/`.
- Third-party browser libs in `public/vendor/`.

## UI entry points
- `/` -> `views/index.njk` (main chat interface).
- `/new-game` -> `views/new-game.njk`.
- `/config` -> `views/config.njk`.
- `/settings` -> `views/settings.njk`.
- `/lorebooks` -> `views/lorebooks.njk`.
- `/debug` -> `views/debug.njk`.
- `/player-stats` -> `views/player-stats.njk` (still routed, not linked in nav).

Routing is registered in `server.js` (most pages) and `api.js` (debug + player stats).

## Directory map
- `views/` server-rendered templates.
  - `index.njk` main UI (tabs, chat, panels, modals).
  - `_navigation.njk` shared nav buttons.
  - `new-game.njk`, `config.njk`, `settings.njk`, `lorebooks.njk`, `debug.njk`, `player-stats.njk`.
  - `views/popups/plausibility.njk` server-side copy of plausibility tooltip markup.
- `public/js/` client scripts (chat, maps, lorebooks, settings logic, etc).
- `public/css/` SCSS/CSS (global styles + page-specific overrides).
- `public/templates/` client-side Nunjucks templates (currently `plausibility.njk`).
- `public/vendor/` third-party libraries (cytoscape, markdown-it, nunjucks runtime).

## Runtime globals injected on the chat page
From `views/index.njk`:
- `window.currentSetting`, `window.rarityDefinitions`, `window.needBarDefinitions`.
- `window.AIRPG_CONFIG` (including `baseWeaponDamage`).
- `window.AIRPG_CONFIG.clientMessageHistory`.
- `window.__AIRPG_SAVE_METADATA__` (save metadata for summaries, etc).
- `window.CHECK_MOVE_PLAUSIBILITY`.
- `window.availableSkillsList` and `window.getKnownSkillNameSet()`.
- `window.AIRPG_CLIENT_ID` (set by `AIRPGChat` and reused by image jobs).

## Files in this folder
- `docs/ui/pages.md` routes, templates, scripts, and injected data.
- `docs/ui/chat_interface.md` main chat UI layout, behaviors, data flow.
- `docs/ui/modals_overlays.md` modal inventory (chat page).
- `docs/ui/maps.md` region map and world map implementation.
- `docs/ui/assets_styles.md` styling, assets, and vendor libraries.
