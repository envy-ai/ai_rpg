# Mod UI Hooks Implementation Plan

> Archive status: this is a historical implementation proposal, not a current API reference. Verified against the current code and focused docs on 2026-06-16: the first-class `ModUI` manifest/runtime described here is not implemented.

## Goal

Add a first-class mod UI extension layer for pages, navigation, panels, actions, limited overrides, named slots, and browser lifecycle hooks.

## Historical Architecture

The original plan proposed extending `ModExtensionRegistry` with server-side UI declarations, exposing a normalized manifest through server render locals and `/api/mod-ui/manifest`, and adding a browser `ModUI` runtime loaded before mod scripts. Core templates would provide named slots and action surfaces. Bundled implants and spells would register read-only UI panels as integration examples.

This still describes a plausible future direction, but it should not be read as implemented behavior.

## Current Code Baseline

- `ModExtensionRegistry` currently supports chat tools, XML events, base-context contributors, player-action prompt steps, generation prompt instructions, actor status contributors, attribute/status/target-status contributors, inventory sync contributors, world-profile setting tabs/fields, entity fields, Thing image badges, Thing context actions, and startup validators.
- `ModExtensionRegistry` does not currently expose `registerUiPage`, `registerNavigationItem`, `registerUiPanel`, `registerUiAction`, `registerUiOverride`, `getUiManifest`, or `getUiPage`.
- `ModLoader.createModScope(...)` does not currently expose scoped UI registration helpers.
- `ModLoader.getModClientScripts()` and `getModClientStyles()` still discover enabled mod files under `public/js` and `public/css`, but the current implementation does not sort those filenames.
- Server-rendered mod script/style injection is currently play-page scoped. `server.js` passes `modScripts` and `modStyles` to `views/index.njk`; shared mod UI locals for all top-level pages are not present.
- There is no current `public/js/mod-ui.js`, `views/_includes/mod-ui-head.njk`, `views/_includes/mod-ui-scripts.njk`, or `views/mod-page.njk`.
- There is no current `/api/mod-ui/manifest` route and no default `/mods/:modName/ui/:pageId` page route.
- Bundled implants and spells surface their state through current mod hooks such as actor status contributors, setting tabs/fields, chat tools, XML events, Thing image badges, and Thing context actions. They do not register `ModUI` panels or ship `implants-ui.js` / `spells-ui.js`.

For current modding behavior, use `docs/modding.md`, `docs/modding_hooks.md`, `docs/classes/ModExtensionRegistry.md`, `docs/classes/ModLoader.md`, and `docs/ui/pages.md`. The companion design proposal remains in `docs/superpowers/specs/2026-05-23-mod-ui-hooks-design.md`.

## Gotchas If Revived

1. The existing mod script/style injection only happens on the play page. A shared include would need to preserve play-page load order while adding other top-level pages.
2. `app.use('/mods/<modName>', express.static(...))` is registered before app routes. A default `/mods/:modName/ui/:pageId` route must still work after static middleware falls through on missing files.
3. Mods load after API and page route registration. Manifest and route lookups must read the live registry at request time.
4. `views/index.njk` is large. UI hook insertions should stay small and use helper functions rather than scattering raw `window.ModUI` calls.
5. Implant install/remove should remain prose/tool driven unless a separate design changes that. A future implant UI panel should be read-only by default.
6. If `public/css/main.scss` is modified for generic mod UI styles, compile the corresponding CSS before finishing.
7. Do not treat actor `modStatusSections` as the same abstraction as future UI panels. They are current prompt/client status data, not browser slot registrations.

## Proposed File Map

If this plan is revived, the likely implementation surface is:

- `ModExtensionRegistry.js`: UI hook storage, validation, registration methods, accessors, and manifest generation.
- `ModLoader.js`: scoped UI registration helpers and deterministic mod client asset ordering.
- `server.js`: mod UI render locals, `/api/mod-ui/manifest`, default mod UI page route, and shared locals for top-level pages.
- `api.js`: mod UI locals for any server-rendered pages owned by API routes.
- `views/_includes/mod-ui-head.njk`: manifest and mod style injection.
- `views/_includes/mod-ui-scripts.njk`: `public/js/mod-ui.js` and enabled mod script loading.
- `views/mod-page.njk`: default shell for registered mod UI pages.
- `views/_includes/app-header.njk` and `views/_includes/app-header-nav.njk`: registered mod navigation entries, override targets, slots, and action surfaces.
- Top-level templates: shared mod UI head/script includes and selected slots/surfaces.
- `public/js/mod-ui.js`: browser runtime for manifest access, events, slot mounting, action mounting, overrides, API calls, and simple modal/toast helpers.
- `views/index.njk`: play-page slots, action surfaces, and lifecycle notifications.
- `mods/implants/mod.js` and `mods/spells/mod.js`: optional read-only panel registrations once registry hooks exist.
- New mod-owned client files only after the runtime exists.

## Archived Task Breakdown

The original plan used a test-first checklist. These tasks remain useful as a revival outline, but they should be re-derived against current code before implementation. Do not paste the old snippets blindly.

### Task 1: Add UI Hook Registry Tests

- [ ] Add tests proving UI pages, nav items, panels, actions, overrides, and manifest snapshots are registered and sorted.
- [ ] Add tests proving duplicate and invalid declarations fail loudly.
- [ ] Confirm the tests fail before adding the registry methods.

### Task 2: Implement UI Hooks In `ModExtensionRegistry`

- [ ] Add private stores for pages, navigation items, panels, actions, and overrides.
- [ ] Add known slot, action-surface, override-operation, navigation-section, and render-mode constants.
- [ ] Add normalization helpers for ids, local routes, optional strings, orders, slots, and surfaces.
- [ ] Add `registerUiPage`, `registerNavigationItem`, `registerUiPanel`, `registerUiAction`, and `registerUiOverride`.
- [ ] Add `getUiPages`, `getUiPage`, and `getUiManifest`.
- [ ] Clear all UI stores from `clear()`.

### Task 3: Expose UI Helpers To Mod Scopes

- [ ] Add scope tests for UI helper forwarding through `ModLoader.createModScope(...)`.
- [ ] Add scoped helpers that attach the current `modName` and throw explicit errors when no compatible registry exists.
- [ ] Sort discovered `public/js/*.js` and `public/css/*.css` filenames deterministically before returning client asset paths.

### Task 4: Add Server Manifest Locals, API, And Default Mod Page Route

- [ ] Add a helper that returns `modUiManifest`, `modScripts`, and `modStyles`.
- [ ] Pass shared locals to the play page and other server-rendered top-level pages.
- [ ] Expose the helper to API-owned page routes if those routes render templates.
- [ ] Add `GET /api/mod-ui/manifest`.
- [ ] Add the default `/mods/:modName/ui/:pageId` route using live registry lookups.
- [ ] Add a default mod page template with the `mod-page.root` slot.

### Task 5: Add Shared Template Injection And Header Navigation

- [ ] Add shared head and script includes for the manifest, mod styles, `mod-ui.js`, and enabled mod scripts.
- [ ] Update top-level templates to use those includes.
- [ ] Add mod navigation entries to the app header.
- [ ] Add stable `data-mod-ui-target`, `data-mod-ui-slot`, and `data-mod-ui-action-surface` attributes where the runtime needs them.
- [ ] Add template-render tests for registered mod nav.

### Task 6: Implement The Browser `ModUI` Runtime

- [ ] Add a browser/CommonJS-compatible `public/js/mod-ui.js`.
- [ ] Support `registerPanelRenderer`, `registerActionHandler`, `on`, `off`, `notify`, `mountSlot`, `mountActions`, `applyOverrides`, `apiFetch`, `showModal`, `showToast`, and `requestRefresh`.
- [ ] Make missing renderers/handlers fail visibly in development and log clear errors.
- [ ] Avoid duplicate mounts in the same slot instance when dynamic UI refreshes run repeatedly.

### Task 7: Add Core Slots, Action Surfaces, And Lifecycle Notifications

- [ ] Add play-page slots for adventure sidebar, location header/details, character profile, party members, Story Tools, Thing cards, and NPC cards where useful.
- [ ] Add action surfaces for player profile, Thing cards, NPC cards, chat message actions, and app-header actions.
- [ ] Notify the runtime after stable UI lifecycle points such as data refreshes, tab changes, and entity renders.
- [ ] Add settings and mods page slots only where a real mod use case exists.
- [ ] Add generic SCSS for runtime-mounted panels, action buttons, and missing-renderer diagnostics.

### Task 8: Register Bundled Implant And Spell UI Contributions

- [ ] Register an implants panel only after the registry and runtime exist.
- [ ] Register a spells panel only after the registry and runtime exist.
- [ ] Keep these panels read-only unless a separate design approves direct UI actions.
- [ ] Use existing actor `modStatusSections` data as panel input rather than duplicating mod state parsing.

### Task 9: Update Documentation

- [ ] Update focused modding and hook docs only after the runtime exists in code.
- [ ] Document supported slots, action surfaces, lifecycle events, override operations, manifest shape, and client runtime API.
- [ ] Document examples as current API examples only after the relevant tests and code pass.
- [ ] Keep docs updates focused on stable API behavior rather than implementation diary notes.

### Task 10: Final Verification

- [ ] Run focused registry, server/static, runtime, and template tests added for this feature.
- [ ] Run adjacent modding tests, especially settings tabs, Thing image badges, Thing context actions, mod manager, and bundled implant/spell registration tests.
- [ ] Run syntax checks for altered JavaScript files.
- [ ] Compile changed SCSS outputs.
- [ ] If a full `node --test tests/*.test.js` sweep reveals unrelated failures, report them without changing unrelated files.

## Acceptance Criteria For A Future Implementation

- An enabled mod can register a top-level UI page and navigation entry without manually adding an Express page route.
- An enabled mod can mount a panel into a named slot on an existing page.
- An enabled mod can add an action to a known UI surface and handle it in client JavaScript.
- An enabled mod can hide or rename a registered core UI element only through constrained override operations.
- The play page and other intended top-level pages load the shared mod UI runtime and active mod UI manifest.
- Dynamic core UI rerenders remount relevant mod panels through lifecycle calls.
- Invalid UI declarations fail loudly during mod registration or startup.
- Bundled examples prove the surface works for at least implants and spells without adding unsupported inventory equip controls.
