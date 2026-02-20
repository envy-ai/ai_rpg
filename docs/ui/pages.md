# UI Pages and Routes

This page maps routes to templates and the client scripts/styles they load.

## Main chat interface
- Route: `/`
- Template: `views/index.njk`
- Styles: `public/css/main.css`, `public/css/map.css`, plus mod styles if present.
- Scripts (in order):
  - Vendor: `public/vendor/cytoscape*.js`, `public/vendor/layout-base.js`, `public/vendor/cose-base.js`, `public/vendor/nunjucks.js`, `public/vendor/markdown-it.min.js`.
  - App: `public/js/cytoscape-convex-hull.js`, `public/js/lightbox.js`, `public/js/image-manager.js`, `public/js/currency-utils.js`, `public/js/formula-evaluator.js`, `public/js/attribute-skill-allocator.js`, `public/js/chat.js`, `public/js/map.js`, `public/js/world-map.js`, `public/js/player-stats.js`.
  - Optional mod scripts from `ModLoader` (injected by `server.js`).
- Inline script responsibilities:
  - Tab switching (`initTabs`), map triggers, party/faction/quest panels, and Story Tools history paging/editor panel.
  - Location display, edit modals, crafting/salvage modals.
  - Region edit modal field handling (name/description/short description, parent region, average level, controlling faction dropdown sourced from `/api/factions`, and a collapsed-by-default `Region Secrets` editor with add/remove rows); scrolling is handled by the modal overlay and the region dialog has no max-height cap so expanded sections remain usable.
  - Image rendering helpers (`renderEntityImage`) and tooltip helpers.
- Data injected by `server.js`:
  - `chatHistory`, `player`, `availableSkills`, `currentSetting`.
  - `pointPoolFormulas`.
  - `rarityDefinitions`, `needBarDefinitions`, `checkMovePlausibility`.
  - `baseWeaponDamage`, `clientMessageHistory`, `saveMetadata`.
- Notes: the player "View" modal reuses shared allocation partials for attributes/skills; NPCs use read-only controls, while players can spend points and submit through `/api/player/update-stats` (negative pools blocked, positive pools confirmed). Unspent pools are computed server-side from submitted level/attributes/skills.
- Notes: client-side name rendering for character/item/scenery cards applies a `font-size: 0.75em` span when a name exceeds 40 characters.
- Notes: after a successful Load Game action, if save metadata indicates `npcAliasesGenerated=false` (or missing), the client shows a confirmation dialog; accepting runs `/api/npcs/generate-aliases` before page reload (20 NPCs per prompt batch), declining leaves aliases empty.
- Notes: the shared player/NPC edit modal includes an aliases list field (one alias per line) and submits aliases through `PUT /api/npcs/:id`.

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
- Template partial: `views/_navigation.njk`
- Appears on all pages; includes Save/Load buttons only on the chat page.
