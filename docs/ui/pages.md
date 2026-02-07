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
- Scripts: `public/js/formula-evaluator.js`, `public/js/attribute-skill-allocator.js`, `public/js/new-game.js`.
- Data injected by `server.js`:
  - `newGameDefaults`, `currentSetting`.
- Notes: the Starting Location Generation Instructions field uses a multiline placeholder template (region name, summary, rooms/locations, region exits).
- Notes: submits `/api/new-game` with a keepalive POST, then immediately navigates to `/#tab-adventure` while generation continues; websocket status updates drive the overlay spinner if the page remains visible.
- Notes: skills are pulled from the active setting (`defaultExistingSkills`) and displayed for allocation; the New Game form can add or remove skills and recalculates pools immediately.
- Notes: attribute/skill allocation markup is included via `views/_includes/attribute-allocation.njk` and `views/_includes/skill-allocation.njk`.
- Notes: skills are sorted alphabetically in the New Game allocation list.
- Notes: the New Game form lets players adjust attribute and skill allocations via point pools; base pool formulas and max caps come from `config.formulas.character_creation` and are then adjusted by refunds/spend (attributes below/above 10, skills above rank 1). Pools can go negative but the submit button disables until overspending is resolved, and unspent points trigger a confirmation prompt.
- Notes: pool formulas are evaluated after attribute definitions load so `attribute.*`/`skill.*` variables are available; evaluation errors surface in the warning area and disable form submission.
- Notes: the New Game form includes `Save Form Settings` / `Load Form Settings` controls backed by `/api/new-game/settings/save`, `/api/new-game/settings/load`, and `/api/new-game/settings/saves`.
- Notes: loading applies attributes/skills on a best-effort name match; any current attribute/skill without a matching loaded entry resets to its default value (attribute default stat, skill rank 1).
- Notes: attribute matching also checks definition label/abbreviation aliases; blank aliases are ignored so saved-form loading does not fail when optional alias fields are empty.

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
- Notes: uses a master-detail layout with a left settings library and a right editor panel.
- Notes: the left panel includes search (`name/theme/genre/tone/difficulty`), sort controls, and selection-scoped actions (`Edit`, `Apply`, `Clone`, `Delete`), instead of per-row action buttons.
- Notes: editor fields are grouped into tabbed sections (`Basics`, `New Game Defaults`, `Character Options`, `Prompt Guidance`, `Image Prefixes`) and a sticky action bar keeps `Clear`, `Create/Update`, and `Auto-Fill Blank Fields` visible while scrolling.
- Notes: the default Starting Location Generation Instructions field mirrors the multiline placeholder used on the New Game form.
- Notes: the Default Existing Skills field is prefilled from `defs/default_skills.yaml` when creating a new (blank) setting.
- Notes: the auto-fill button can append up to ~10 setting-specific skills when the skills list is empty or baseline-only.
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
- Template partial: `views/_navigation.njk`
- Appears on all pages; includes Save/Load buttons only on the chat page.
