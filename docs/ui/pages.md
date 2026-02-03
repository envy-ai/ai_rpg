# UI Pages and Routes

This page maps routes to templates and the client scripts/styles they load.

## Main chat interface
- Route: `/`
- Template: `views/index.njk`
- Styles: `public/css/main.css`, `public/css/map.css`, plus mod styles if present.
- Scripts (in order):
  - Vendor: `public/vendor/fitty.min.js`, `public/vendor/cytoscape*.js`, `public/vendor/layout-base.js`, `public/vendor/cose-base.js`, `public/vendor/nunjucks.js`, `public/vendor/markdown-it.min.js`.
  - App: `public/js/fitty-init.js`, `public/js/cytoscape-convex-hull.js`, `public/js/lightbox.js`, `public/js/image-manager.js`, `public/js/currency-utils.js`, `public/js/chat.js`, `public/js/map.js`, `public/js/world-map.js`, `public/js/player-stats.js`.
  - Optional mod scripts from `ModLoader` (injected by `server.js`).
- Inline script responsibilities:
  - Tab switching (`initTabs`), map triggers, party/faction/quest panels.
  - Location display, edit modals, crafting/salvage modals.
  - Image rendering helpers (`renderEntityImage`) and tooltip helpers.
- Data injected by `server.js`:
  - `chatHistory`, `player`, `availableSkills`, `currentSetting`.
  - `rarityDefinitions`, `needBarDefinitions`, `checkMovePlausibility`.
  - `baseWeaponDamage`, `clientMessageHistory`, `saveMetadata`.

## New game
- Route: `/new-game`
- Template: `views/new-game.njk`
- Styles: `public/css/main.css` + page inline styles.
- Script: `public/js/new-game.js`.
- Data injected by `server.js`:
  - `newGameDefaults`, `currentSetting`.
- Notes: submits `/api/new-game` with a keepalive POST, then immediately navigates to `/#tab-adventure` while generation continues; websocket status updates drive the overlay spinner if the page remains visible.

## Server configuration
- Route: `/config`
- Template: `views/config.njk`
- Styles: `public/css/main.css`.
- Script: `public/js/config.js` + inline helper script.
- Data injected by `server.js`:
  - `config`, `modConfigs`, `modelOptions`, `savedMessage`, `errorMessage`.

## Game settings manager
- Route: `/settings`
- Template: `views/settings.njk`
- Styles: `public/css/main.css`, `public/css/settings.css`.
- Script: inline (settings CRUD is embedded in the template).
- Data injected by `server.js`:
  - `currentPage` only. Data is loaded via `/api/settings` calls.

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
- Template partial: `views/_navigation.njk`
- Appears on all pages; includes Save/Load buttons only on the chat page.
