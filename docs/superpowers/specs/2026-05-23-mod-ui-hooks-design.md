# Mod UI Hooks Design

> Archive status: this is a design proposal, not a current modding API reference. Verified against current code and focused docs on 2026-06-16: the first-class `ModUI` manifest/runtime described below is not implemented.

## Goal

Add a first-class UI extension system for enabled mods. Mods should be able to add top-level UI pages, navigation entries, panels, actions, and limited alterations to existing UI without editing core templates directly.

The supported path should be registry-driven and tied into the existing mod loading model. Mods can still ship client JavaScript and CSS as an escape hatch, but core support should use named extension points instead of fragile DOM selectors.

## Current Context

The current mod system supports runtime hooks through `ModExtensionRegistry`, including chat tools, XML events, base-context contributors, player-action prompt steps, generation prompt instructions, actor status contributors, attribute/status/target-status contributors, inventory sync contributors, world-profile setting tabs and fields, entity fields, Thing image badges, Thing context actions, and startup validators.

The current loader serves each enabled mod's `public/` directory at `/mods/<mod>/...`, serves `assets/` at `/mods/<mod>/assets/...`, and injects mod scripts and styles on the play page through `ModLoader.getModClientScripts()` and `ModLoader.getModClientStyles()`. That makes client-side mod code possible on the play page, but it does not provide a stable contract for where arbitrary UI code should mount, how dynamic UI rerenders should notify mods, or how mods should add navigation and pages.

World-profile settings already have a mod tab and field model. The UI hook system should follow that pattern rather than creating a parallel mod extension registry.

For implemented behavior, use `docs/modding.md`, `docs/modding_hooks.md`, `docs/classes/ModExtensionRegistry.md`, `docs/classes/ModLoader.md`, and `docs/ui/pages.md`. This archive remains useful as design intent if a first-class mod UI extension layer is revived.

## Design Summary

The proposal was a hybrid model:

- Server-side UI declarations are registered through `ModExtensionRegistry`.
- A browser-side `ModUI` runtime reads a normalized active-mod UI manifest.
- Core templates expose named extension slots.
- Core client render paths emit lifecycle events after relevant UI updates.
- Mods provide client renderers and handlers through their served public JavaScript.

This gives mods a supported UI surface while keeping the core app in control of layout, load order, route registration, and validation.

## Server-Side Hooks

The proposed extension to `ModExtensionRegistry` was:

- `registerUiPage({ id, label, route, title, description, icon, order, script, style })`
- `registerNavigationItem({ id, label, href, icon, order, section })`
- `registerUiPanel({ id, slot, label, order, clientModule, renderMode })`
- `registerUiAction({ id, surface, label, icon, order, clientHandler })`
- `registerUiOverride({ id, target, operation, value })`

These methods do not exist in current code. `ModLoader.createModScope(...)` also does not expose scoped UI registration helpers, and there is no current `getUiManifest()` or `getUiPage()` accessor.

All registrations are namespaced by the registering mod and normalized into a UI manifest. Duplicate IDs, invalid IDs, invalid routes, unknown slots, unknown surfaces, and unsupported override operations fail loudly at registration or startup validation time.

Registered mod pages default to namespaced routes under:

```text
/mods/:modName/ui/:pageId
```

Mods may register navigation items pointing at those pages or at mod-owned API-backed pages if they intentionally define their own route. The default mod page route should render a shared mod page template that loads the active UI manifest, the `ModUI` runtime, and the enabled mod's client assets.

Current code only has mod-owned API route registration through `scope.registerModRoute(...)`, which registers routes under `/api/mods/<mod>/...`. It does not provide default mod UI pages under `/mods/:modName/ui/:pageId`.

## Client Runtime

The proposed client runtime was `public/js/mod-ui.js`, loaded before enabled mod scripts on every top-level page. There is no current `public/js/mod-ui.js`, `window.__AIRPG_MOD_UI__`, or `window.ModUI`.

The proposed runtime reads:

```js
window.__AIRPG_MOD_UI__
```

It exposes:

- `window.ModUI.registerPanelRenderer(id, fn)`
- `window.ModUI.registerActionHandler(id, fn)`
- `window.ModUI.on(eventName, handler)`
- `window.ModUI.off(eventName, handler)`
- `window.ModUI.notify(eventName, payload)`
- `window.ModUI.mountSlot(slotName, context)`
- `window.ModUI.apiFetch(path, options)`
- `window.ModUI.showModal(options)`
- `window.ModUI.showToast(message, options)`
- `window.ModUI.requestRefresh(reason)`

The runtime mounts registered panels into matching slot containers and adds registered actions to matching action surfaces. Missing registered client renderers or handlers should surface clear console errors and visible development diagnostics where practical, rather than silently doing nothing.

## Lifecycle Events

Core UI code should notify mods at stable points:

- `airpg:ready`
- `airpg:before-render`
- `airpg:after-render`
- `airpg:slot-mounted`
- `airpg:data-refreshed`
- `airpg:tab-changed`
- `airpg:entity-rendered`

Dynamic render paths that replace chunks of DOM should call `ModUI.mountSlot(...)` after rendering so mod panels can be remounted. The runtime should avoid double-mounting the same contribution into the same slot instance.

## Named Extension Slots

V1 slots should cover common, high-value surfaces:

- `app.header.nav`
- `app.header.actions`
- `play.adventure.sidebar`
- `play.location.header`
- `play.location.details`
- `play.character.profile`
- `play.party.member`
- `play.story-tools.panel`
- `chat.message.actions`
- `thing.card.details`
- `thing.card.actions`
- `npc.card.details`
- `npc.card.actions`
- `settings.editor.tabs`
- `mods.manager.rows`

Slots are explicit contracts. Mods should prefer these slots over querying arbitrary DOM. Additional slots can be added later when a real mod needs them.

## UI Actions

Actions are registered against known surfaces. Core UI code renders actions in the same visual language as existing buttons and menus, then invokes the registered client handler through `ModUI`.

V1 action surfaces should include:

- `app.header.actions`
- `chat.message.actions`
- `thing.card.actions`
- `npc.card.actions`
- `location.context-menu`
- `player.profile.actions`
- `settings.editor.actions`

Action handlers receive the action definition and a context object containing the current entity, current page, active setting, and any relevant IDs. The exact context shape should be documented per surface.

## UI Overrides

Overrides are intentionally limited in v1. Supported operations:

- hide a registered core nav item, panel, or action
- rename a registered label
- change order within a registered surface
- add a CSS class to a registered target

Core template replacement, arbitrary HTML replacement, and monkeypatching core render functions are not part of the supported contract. Mods may still ship custom client scripts through the existing public asset path, but that is the escape hatch rather than the official extension model.

## Asset Loading

The proposal moved mod client asset injection into a shared Nunjucks include so all top-level pages could load:

- the normalized UI manifest
- `public/js/mod-ui.js`
- enabled mod styles
- enabled mod scripts

Current behavior is narrower: `server.js` passes `modStyles` and `modScripts` to the play page (`views/index.njk`), and that template loads mod CSS and JS there. Other top-level pages do not currently receive a shared mod UI manifest/runtime include.

Mod styles should load after core styles. Mod scripts should load after `mod-ui.js` and before page inline code only when the page expects mod handlers during initial inline setup; otherwise they can load at the end of the body in deterministic mod order.

## Validation And Failure Mode

The UI registry should follow the existing mod hook style:

- Invalid declarations throw explicit errors.
- Duplicate IDs throw explicit errors.
- Unknown slots and surfaces throw explicit errors.
- Unknown override targets throw explicit errors.
- Routes must be namespaced unless explicitly allowed.
- Client renderer and handler failures should be logged with mod name, contribution ID, surface or slot, parameters, and stack trace.

The active mod UI manifest is frozen at startup with the rest of the active mod set. Changing mod UI declarations requires a restart because enabling or disabling mods already requires a restart.

## Security And Trust

V1 treats mods as trusted local code. There is no sandboxing boundary between mod JavaScript and the app. The design reduces accidental breakage by providing stable slots, actions, and lifecycle events, but it does not attempt to make untrusted third-party mods safe.

All mod-owned DOM should use namespaced classes or `data-mod-name` attributes to reduce CSS and event collisions. Documentation should recommend a class prefix such as:

```text
mod-<modName>-
```

## Bundled Mod Usage

The current bundled implants and spells mods do not register `ModUI` panels or actions. They surface behavior through implemented hooks such as actor status contributors, world-profile setting tabs/fields, chat tools, XML events, Thing image badges, Thing context actions, base-context contributors, and startup validators.

If this UI hook design is revived, the implants mod should use it as an integration example:

- Register a profile panel in `play.character.profile` that shows installed implants under the configured label.
- Register an NPC detail panel or action only if it is useful for inspecting NPC implants.
- Do not add inventory equip or unequip controls for implant items. That remains intentionally prose/tool driven.

The spells mod can use the revived UI hooks as a second integration example:

- Register a spell panel in `play.character.profile`.
- Show mana and known spells where available.
- Register cast-related actions only when the spell system's current behavior supports it cleanly.

These examples should prove that the hook system supports more than one domain and is not tailored to implants.

## Testing If Revived

Add focused tests for a future implementation:

- Registry validation for pages, nav items, panels, actions, and overrides.
- Duplicate contribution failures.
- Manifest generation from multiple enabled mods.
- Shared page asset injection includes the manifest and `mod-ui.js`.
- Default mod page route renders a page for a registered mod UI page.
- Unknown slots, surfaces, and override targets fail loudly.
- Client runtime mounts panel renderers into matching slots without duplicate mounts.
- Client runtime invokes action handlers with the expected context.
- Implants and spells register UI contributions without colliding.

Run syntax checks for altered JavaScript files. If SCSS is touched, compile the corresponding CSS output before finishing.

## Documentation If Revived

Update these docs only after the runtime and registry APIs exist in code:

- `docs/modding.md`
- `docs/modding_hooks.md`
- `docs/classes/ModExtensionRegistry.md`
- `docs/classes/ModLoader.md`
- `docs/ui/pages.md`
- `docs/ui/assets_styles.md`
- `docs/README.md`

Add examples showing a minimal mod page, a profile panel, and an entity action once those examples are tested current behavior.

## Acceptance Criteria For A Future Implementation

- An enabled mod can register a top-level UI page and navigation entry without adding an Express route manually.
- An enabled mod can mount a panel into a named slot on an existing page.
- An enabled mod can add an action to a known UI surface and handle it in client JavaScript.
- An enabled mod can hide or rename a registered core UI element through a constrained override.
- The play page and other top-level pages load the shared mod UI runtime and active mod UI manifest.
- Dynamic core UI rerenders remount relevant mod panels through lifecycle calls.
- Invalid mod UI declarations fail loudly during startup.
- The bundled implants mod demonstrates the panel hook without adding inventory equip controls.
- The bundled spells mod demonstrates an independent panel or action hook when enabled.
