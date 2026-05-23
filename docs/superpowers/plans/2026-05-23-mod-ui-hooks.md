# Mod UI Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Repo rule: do not run git commands unless the user explicitly authorizes them.

**Goal:** Add a first-class mod UI extension layer for pages, navigation, panels, actions, limited overrides, named slots, and browser lifecycle hooks.

**Architecture:** Extend the existing `ModExtensionRegistry` with server-side UI declarations, expose a normalized manifest through server render locals and `/api/mod-ui/manifest`, and add a browser `ModUI` runtime loaded before mod scripts. Core templates provide named slots and action surfaces; bundled implants and spells register UI panels as real integration examples.

**Tech Stack:** Node.js CommonJS, Express, Nunjucks templates, browser JavaScript in `public/js`, SCSS in `public/css/main.scss`, Node test runner.

---

## Gotchas

1. The current mod script/style injection only happens on the play page. Shared injection must preserve play-page load order while adding support for other top-level pages.
2. `app.use('/mods/<modName>', express.static(...))` is registered before app routes. The default UI page route under `/mods/:modName/ui/:pageId` must still work after static middleware falls through on missing files.
3. Mods load after API and page route registration. Manifest and route lookups must read the live registry at request time.
4. Existing `views/index.njk` is large. Keep UI hook insertions small and use helper functions instead of scattering raw `window.ModUI` calls everywhere.
5. Do not add implant inventory equip controls. Implants can show read-only UI panels, but install/remove remains prose/tool driven.
6. If `public/css/main.scss` is modified, run `npm run scss:build:main` before finishing implementation.

## File Map

- Modify `ModExtensionRegistry.js`: add UI hook storage, validation, registration methods, accessors, and manifest generation.
- Modify `ModLoader.js`: expose UI registration helpers on mod scopes and sort mod client asset filenames deterministically.
- Modify `server.js`: add mod UI render locals, `/api/mod-ui/manifest`, default mod UI page route, pass mod UI locals to server-rendered top-level pages, and expose the local helper through `apiScope`.
- Modify `api.js`: pass mod UI locals to `debug.njk` and `player-stats.njk` routes.
- Create `views/_includes/mod-ui-head.njk`: inject `window.__AIRPG_MOD_UI__` and mod styles.
- Create `views/_includes/mod-ui-scripts.njk`: load `public/js/mod-ui.js` and enabled mod scripts in deterministic order.
- Create `views/mod-page.njk`: default shell for registered mod UI pages.
- Modify `views/_includes/app-header.njk`: render registered mod nav entries, add data targets for overrides, and expose header slots/action surfaces.
- Modify top-level templates: include mod UI head/scripts and add selected slots/surfaces.
- Create `public/js/mod-ui.js`: browser runtime for manifest access, event subscription, slot mounting, action mounting, overrides, API calls, and simple modal/toast helpers.
- Modify `views/index.njk`: add play-page slots, action surfaces, and lifecycle notifications.
- Modify `mods/implants/mod.js`: register implant UI panel contribution.
- Create `mods/implants/public/js/implants-ui.js`: render installed implants from actor `modStatusSections`.
- Modify `mods/spells/mod.js`: register spell UI panel contribution.
- Create `mods/spells/public/js/spells-ui.js`: render known spells from actor `modStatusSections`.
- Create or modify tests:
  - `tests/mod_extension_hooks.test.js`
  - `tests/mod_ui_static.test.js`
  - `tests/mod_ui_runtime.test.js`
  - `tests/mod_ui_template_render.test.js`
- Update docs:
  - `docs/modding.md`
  - `docs/modding_hooks.md`
  - `docs/classes/ModExtensionRegistry.md`
  - `docs/classes/ModLoader.md`
  - `docs/ui/pages.md`
  - `docs/ui/assets_styles.md`
  - `docs/README.md`

---

### Task 1: Add UI Hook Registry Tests

**Files:**
- Modify: `tests/mod_extension_hooks.test.js`
- Modify after failing test: `ModExtensionRegistry.js`

- [ ] **Step 1: Add tests for UI pages, nav items, panels, actions, overrides, and manifest shape**

Append this block to `tests/mod_extension_hooks.test.js`:

```js
test('ModExtensionRegistry registers UI contributions and builds a sorted manifest', () => {
    const registry = new ModExtensionRegistry();

    registry.registerUiPage({
        modName: 'implants',
        id: 'overview',
        label: 'Implants',
        title: 'Implants Overview',
        description: 'Review installed implants.',
        icon: 'app-header-icon--mods',
        order: 20
    });
    registry.registerNavigationItem({
        modName: 'implants',
        id: 'implants-nav',
        label: 'Implants',
        href: '/mods/implants/ui/overview',
        icon: 'app-header-icon--mods',
        order: 20,
        section: 'primary'
    });
    registry.registerUiPanel({
        modName: 'implants',
        id: 'player-implants',
        slot: 'play.character.profile',
        label: 'Installed Implants',
        order: 10,
        clientModule: 'implants.renderPlayerPanel'
    });
    registry.registerUiAction({
        modName: 'implants',
        id: 'inspect-implant',
        surface: 'thing.card.actions',
        label: 'Inspect Implant',
        icon: 'search',
        order: 30,
        clientHandler: 'implants.inspectThing'
    });
    registry.registerUiOverride({
        modName: 'implants',
        id: 'rename-mods-nav',
        target: 'nav.mods',
        operation: 'rename',
        value: 'Extensions'
    });

    const manifest = registry.getUiManifest();
    assert.deepEqual(Object.keys(manifest).sort(), ['actions', 'navigationItems', 'overrides', 'pages', 'panels']);
    assert.equal(manifest.pages[0].fullId, 'implants:overview');
    assert.equal(manifest.pages[0].route, '/mods/implants/ui/overview');
    assert.equal(manifest.navigationItems[0].fullId, 'implants:implants-nav');
    assert.equal(manifest.panels[0].slot, 'play.character.profile');
    assert.equal(manifest.actions[0].surface, 'thing.card.actions');
    assert.equal(manifest.overrides[0].target, 'nav.mods');
});
```

- [ ] **Step 2: Add tests for duplicate and invalid UI declarations**

Append this block to `tests/mod_extension_hooks.test.js`:

```js
test('ModExtensionRegistry rejects duplicate and invalid UI declarations', () => {
    const registry = new ModExtensionRegistry();

    registry.registerUiPanel({
        modName: 'implants',
        id: 'player-panel',
        slot: 'play.character.profile',
        clientModule: 'implants.renderPlayerPanel'
    });

    assert.throws(
        () => registry.registerUiPanel({
            modName: 'implants',
            id: 'player-panel',
            slot: 'play.character.profile',
            clientModule: 'implants.renderAgain'
        }),
        /UI panel "implants:player-panel" is already registered/
    );

    assert.throws(
        () => registry.registerUiPanel({
            modName: 'implants',
            id: 'bad-slot',
            slot: 'missing.slot',
            clientModule: 'implants.renderBad'
        }),
        /Unknown UI slot "missing\.slot"/
    );

    assert.throws(
        () => registry.registerUiAction({
            modName: 'implants',
            id: 'bad-action',
            surface: 'missing.surface',
            clientHandler: 'implants.badAction'
        }),
        /Unknown UI action surface "missing\.surface"/
    );

    assert.throws(
        () => registry.registerUiPage({
            modName: 'implants',
            id: 'bad-route',
            route: '/unowned/path'
        }),
        /UI page route for mod "implants" must start with "\/mods\/implants\/ui\/"/
    );

    assert.throws(
        () => registry.registerUiOverride({
            modName: 'implants',
            id: 'bad-override',
            target: 'nav.mods',
            operation: 'replaceHtml',
            value: '<b>bad</b>'
        }),
        /Unsupported UI override operation "replaceHtml"/
    );
});
```

- [ ] **Step 3: Run the focused registry tests and verify they fail**

Run:

```bash
node --test tests/mod_extension_hooks.test.js
```

Expected: FAIL with missing `registerUiPage`, `registerNavigationItem`, `registerUiPanel`, `registerUiAction`, `registerUiOverride`, or `getUiManifest`.

---

### Task 2: Implement UI Hooks In ModExtensionRegistry

**Files:**
- Modify: `ModExtensionRegistry.js`
- Test: `tests/mod_extension_hooks.test.js`

- [ ] **Step 1: Add UI storage and constants**

In `ModExtensionRegistry.js`, add private stores near the existing private fields:

```js
    #uiPages = new Map();
    #uiNavigationItems = new Map();
    #uiPanels = new Map();
    #uiActions = new Map();
    #uiOverrides = new Map();
```

Add these static constants after `#thingReservedFieldNames`:

```js
    static #validUiSlots = new Set([
        'app.header.nav',
        'app.header.actions',
        'play.adventure.sidebar',
        'play.location.header',
        'play.location.details',
        'play.character.profile',
        'play.party.member',
        'play.story-tools.panel',
        'chat.message.actions',
        'thing.card.details',
        'thing.card.actions',
        'npc.card.details',
        'npc.card.actions',
        'settings.editor.tabs',
        'mods.manager.rows',
        'mod-page.root'
    ]);

    static #validUiActionSurfaces = new Set([
        'app.header.actions',
        'chat.message.actions',
        'thing.card.actions',
        'npc.card.actions',
        'location.context-menu',
        'player.profile.actions',
        'settings.editor.actions'
    ]);

    static #validUiOverrideOperations = new Set([
        'hide',
        'rename',
        'reorder',
        'addClass'
    ]);

    static #validNavigationSections = new Set(['primary', 'tools']);
    static #validPanelRenderModes = new Set(['append', 'replace']);
```

Update `clear()` to clear all five UI stores:

```js
        this.#uiPages.clear();
        this.#uiNavigationItems.clear();
        this.#uiPanels.clear();
        this.#uiActions.clear();
        this.#uiOverrides.clear();
```

- [ ] **Step 2: Add shared UI normalizers**

Add these private static methods before `#normalizeBoolean`:

```js
    static #uiContributionKey(modName, id) {
        return `${modName}:${id}`;
    }

    static #normalizeUiOrder(value, label) {
        const numeric = value === undefined || value === null || value === '' ? 1000 : Number(value);
        if (!Number.isFinite(numeric)) {
            throw new Error(`${label} order must be a finite number.`);
        }
        return numeric;
    }

    static #normalizeOptionalString(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    static #normalizeLocalAbsolutePath(value, fieldName) {
        const normalized = ModExtensionRegistry.#normalizeString(value, fieldName);
        if (!normalized.startsWith('/') || normalized.startsWith('//')) {
            throw new Error(`${fieldName} must be a local absolute path starting with "/".`);
        }
        return normalized;
    }

    static #assertKnownUiSlot(slot) {
        if (!ModExtensionRegistry.#validUiSlots.has(slot)) {
            throw new Error(`Unknown UI slot "${slot}".`);
        }
    }

    static #assertKnownUiActionSurface(surface) {
        if (!ModExtensionRegistry.#validUiActionSurfaces.has(surface)) {
            throw new Error(`Unknown UI action surface "${surface}".`);
        }
    }
```

- [ ] **Step 3: Add UI registration methods**

Add these methods before `registerStartupValidator`:

```js
    registerUiPage({
        modName,
        id,
        label,
        route = '',
        title = '',
        description = '',
        icon = '',
        order = 1000,
        script = '',
        style = ''
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedId = ModExtensionRegistry.#normalizeIdentifier(id, 'UI page id');
        const fullId = ModExtensionRegistry.#uiContributionKey(normalizedModName, normalizedId);
        if (this.#uiPages.has(fullId)) {
            throw new Error(`UI page "${fullId}" is already registered.`);
        }
        const defaultRoute = `/mods/${normalizedModName}/ui/${normalizedId}`;
        const normalizedRoute = route
            ? ModExtensionRegistry.#normalizeLocalAbsolutePath(route, `UI page route for mod "${normalizedModName}"`)
            : defaultRoute;
        if (!normalizedRoute.startsWith(`/mods/${normalizedModName}/ui/`)) {
            throw new Error(`UI page route for mod "${normalizedModName}" must start with "/mods/${normalizedModName}/ui/".`);
        }
        this.#uiPages.set(fullId, {
            modName: normalizedModName,
            id: normalizedId,
            fullId,
            label: ModExtensionRegistry.#normalizeOptionalString(label) || normalizedId,
            route: normalizedRoute,
            title: ModExtensionRegistry.#normalizeOptionalString(title) || ModExtensionRegistry.#normalizeOptionalString(label) || normalizedId,
            description: ModExtensionRegistry.#normalizeOptionalString(description),
            icon: ModExtensionRegistry.#normalizeOptionalString(icon),
            order: ModExtensionRegistry.#normalizeUiOrder(order, `UI page "${fullId}"`),
            script: ModExtensionRegistry.#normalizeOptionalString(script),
            style: ModExtensionRegistry.#normalizeOptionalString(style)
        });
    }

    registerNavigationItem({
        modName,
        id,
        label,
        href,
        icon = '',
        order = 1000,
        section = 'primary'
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedId = ModExtensionRegistry.#normalizeIdentifier(id, 'navigation item id');
        const fullId = ModExtensionRegistry.#uiContributionKey(normalizedModName, normalizedId);
        if (this.#uiNavigationItems.has(fullId)) {
            throw new Error(`Navigation item "${fullId}" is already registered.`);
        }
        const normalizedSection = ModExtensionRegistry.#normalizeString(section || 'primary', 'navigation item section');
        if (!ModExtensionRegistry.#validNavigationSections.has(normalizedSection)) {
            throw new Error(`Unsupported navigation section "${normalizedSection}".`);
        }
        this.#uiNavigationItems.set(fullId, {
            modName: normalizedModName,
            id: normalizedId,
            fullId,
            label: ModExtensionRegistry.#normalizeOptionalString(label) || normalizedId,
            href: ModExtensionRegistry.#normalizeLocalAbsolutePath(href, `navigation item "${fullId}" href`),
            icon: ModExtensionRegistry.#normalizeOptionalString(icon),
            order: ModExtensionRegistry.#normalizeUiOrder(order, `navigation item "${fullId}"`),
            section: normalizedSection
        });
    }

    registerUiPanel({
        modName,
        id,
        slot,
        label = '',
        order = 1000,
        clientModule,
        renderMode = 'append'
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedId = ModExtensionRegistry.#normalizeIdentifier(id, 'UI panel id');
        const fullId = ModExtensionRegistry.#uiContributionKey(normalizedModName, normalizedId);
        if (this.#uiPanels.has(fullId)) {
            throw new Error(`UI panel "${fullId}" is already registered.`);
        }
        const normalizedSlot = ModExtensionRegistry.#normalizeString(slot, `UI panel "${fullId}" slot`);
        ModExtensionRegistry.#assertKnownUiSlot(normalizedSlot);
        const normalizedRenderMode = ModExtensionRegistry.#normalizeString(renderMode || 'append', `UI panel "${fullId}" renderMode`);
        if (!ModExtensionRegistry.#validPanelRenderModes.has(normalizedRenderMode)) {
            throw new Error(`Unsupported UI panel renderMode "${normalizedRenderMode}".`);
        }
        this.#uiPanels.set(fullId, {
            modName: normalizedModName,
            id: normalizedId,
            fullId,
            slot: normalizedSlot,
            label: ModExtensionRegistry.#normalizeOptionalString(label) || normalizedId,
            order: ModExtensionRegistry.#normalizeUiOrder(order, `UI panel "${fullId}"`),
            clientModule: ModExtensionRegistry.#normalizeString(clientModule, `UI panel "${fullId}" clientModule`),
            renderMode: normalizedRenderMode
        });
    }

    registerUiAction({
        modName,
        id,
        surface,
        label,
        icon = '',
        order = 1000,
        clientHandler
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedId = ModExtensionRegistry.#normalizeIdentifier(id, 'UI action id');
        const fullId = ModExtensionRegistry.#uiContributionKey(normalizedModName, normalizedId);
        if (this.#uiActions.has(fullId)) {
            throw new Error(`UI action "${fullId}" is already registered.`);
        }
        const normalizedSurface = ModExtensionRegistry.#normalizeString(surface, `UI action "${fullId}" surface`);
        ModExtensionRegistry.#assertKnownUiActionSurface(normalizedSurface);
        this.#uiActions.set(fullId, {
            modName: normalizedModName,
            id: normalizedId,
            fullId,
            surface: normalizedSurface,
            label: ModExtensionRegistry.#normalizeOptionalString(label) || normalizedId,
            icon: ModExtensionRegistry.#normalizeOptionalString(icon),
            order: ModExtensionRegistry.#normalizeUiOrder(order, `UI action "${fullId}"`),
            clientHandler: ModExtensionRegistry.#normalizeString(clientHandler, `UI action "${fullId}" clientHandler`)
        });
    }

    registerUiOverride({
        modName,
        id,
        target,
        operation,
        value
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedId = ModExtensionRegistry.#normalizeIdentifier(id, 'UI override id');
        const fullId = ModExtensionRegistry.#uiContributionKey(normalizedModName, normalizedId);
        if (this.#uiOverrides.has(fullId)) {
            throw new Error(`UI override "${fullId}" is already registered.`);
        }
        const normalizedOperation = ModExtensionRegistry.#normalizeString(operation, `UI override "${fullId}" operation`);
        if (!ModExtensionRegistry.#validUiOverrideOperations.has(normalizedOperation)) {
            throw new Error(`Unsupported UI override operation "${normalizedOperation}".`);
        }
        this.#uiOverrides.set(fullId, {
            modName: normalizedModName,
            id: normalizedId,
            fullId,
            target: ModExtensionRegistry.#normalizeString(target, `UI override "${fullId}" target`),
            operation: normalizedOperation,
            value
        });
    }
```

- [ ] **Step 4: Add manifest accessors**

Add these methods after the UI registration methods:

```js
    #sortUiRecords(records) {
        return [...records].sort((a, b) => {
            if (a.order !== b.order) {
                return a.order - b.order;
            }
            return String(a.label || '').localeCompare(String(b.label || ''))
                || a.fullId.localeCompare(b.fullId);
        }).map(record => ({ ...record }));
    }

    getUiPages() {
        return this.#sortUiRecords(this.#uiPages.values());
    }

    getUiPage(modName, id) {
        const normalizedModName = typeof modName === 'string' ? modName.trim() : '';
        const normalizedId = typeof id === 'string' ? id.trim() : '';
        if (!normalizedModName || !normalizedId) {
            return null;
        }
        const record = this.#uiPages.get(`${normalizedModName}:${normalizedId}`) || null;
        return record ? { ...record } : null;
    }

    getUiManifest() {
        return {
            pages: this.getUiPages(),
            navigationItems: this.#sortUiRecords(this.#uiNavigationItems.values()),
            panels: this.#sortUiRecords(this.#uiPanels.values()),
            actions: this.#sortUiRecords(this.#uiActions.values()),
            overrides: this.#sortUiRecords(this.#uiOverrides.values())
        };
    }
```

- [ ] **Step 5: Run focused registry tests**

Run:

```bash
node --test tests/mod_extension_hooks.test.js
```

Expected: PASS.

- [ ] **Step 6: Syntax check**

Run:

```bash
node --check ModExtensionRegistry.js
```

Expected: no output and exit code 0.

---

### Task 3: Expose UI Helpers To Mod Scopes

**Files:**
- Modify: `ModLoader.js`
- Modify: `tests/mod_extension_hooks.test.js`

- [ ] **Step 1: Add a mod scope helper test**

Append this block to `tests/mod_extension_hooks.test.js`:

```js
test('ModLoader scope exposes UI registration helpers', () => {
    const registry = new ModExtensionRegistry();
    const loader = new ModLoader(path.join(__dirname, '..'));
    const scope = loader.createModScope('implants', path.join(__dirname, '..', 'mods', 'implants'), {
        modExtensionRegistry: registry
    });

    scope.registerUiPanel({
        id: 'player-panel',
        slot: 'play.character.profile',
        clientModule: 'implants.renderPlayerPanel'
    });

    assert.deepEqual(registry.getUiManifest().panels.map(panel => panel.fullId), ['implants:player-panel']);
});
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run:

```bash
node --test tests/mod_extension_hooks.test.js
```

Expected: FAIL with `scope.registerUiPanel is not a function`.

- [ ] **Step 3: Add helper methods in `ModLoader.createModScope`**

In `ModLoader.js`, inside the `Object.assign(modScope, { ... })` object after `registerEntityField`, add:

```js
            registerUiPage: (options = {}) => {
                if (!modExtensionRegistry || typeof modExtensionRegistry.registerUiPage !== 'function') {
                    throw new Error(`Mod "${modName}" cannot register UI pages because no ModExtensionRegistry is available.`);
                }
                return modExtensionRegistry.registerUiPage({
                    ...options,
                    modName
                });
            },

            registerNavigationItem: (options = {}) => {
                if (!modExtensionRegistry || typeof modExtensionRegistry.registerNavigationItem !== 'function') {
                    throw new Error(`Mod "${modName}" cannot register navigation items because no ModExtensionRegistry is available.`);
                }
                return modExtensionRegistry.registerNavigationItem({
                    ...options,
                    modName
                });
            },

            registerUiPanel: (options = {}) => {
                if (!modExtensionRegistry || typeof modExtensionRegistry.registerUiPanel !== 'function') {
                    throw new Error(`Mod "${modName}" cannot register UI panels because no ModExtensionRegistry is available.`);
                }
                return modExtensionRegistry.registerUiPanel({
                    ...options,
                    modName
                });
            },

            registerUiAction: (options = {}) => {
                if (!modExtensionRegistry || typeof modExtensionRegistry.registerUiAction !== 'function') {
                    throw new Error(`Mod "${modName}" cannot register UI actions because no ModExtensionRegistry is available.`);
                }
                return modExtensionRegistry.registerUiAction({
                    ...options,
                    modName
                });
            },

            registerUiOverride: (options = {}) => {
                if (!modExtensionRegistry || typeof modExtensionRegistry.registerUiOverride !== 'function') {
                    throw new Error(`Mod "${modName}" cannot register UI overrides because no ModExtensionRegistry is available.`);
                }
                return modExtensionRegistry.registerUiOverride({
                    ...options,
                    modName
                });
            },
```

Ensure the previous property has a trailing comma before adding this block.

- [ ] **Step 4: Sort mod asset filenames deterministically**

In `ModLoader.js`, update both file lists:

```js
            const jsFiles = fs.readdirSync(jsDir)
                .filter(f => f.endsWith('.js'))
                .sort((a, b) => a.localeCompare(b))
                .map(f => `/mods/${modName}/js/${f}`);
```

```js
            const cssFiles = fs.readdirSync(cssDir)
                .filter(f => f.endsWith('.css'))
                .sort((a, b) => a.localeCompare(b))
                .map(f => `/mods/${modName}/css/${f}`);
```

- [ ] **Step 5: Run tests and syntax check**

Run:

```bash
node --test tests/mod_extension_hooks.test.js
node --check ModLoader.js
```

Expected: both commands pass.

---

### Task 4: Add Server Manifest Locals, API, And Default Mod Page Route

**Files:**
- Create: `tests/mod_ui_static.test.js`
- Modify: `server.js`
- Create: `views/mod-page.njk`

- [ ] **Step 1: Add static tests for server routes and template locals**

Create `tests/mod_ui_static.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const baseDir = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(baseDir, relativePath), 'utf8');
}

test('server exposes mod UI manifest API and default mod UI page route', () => {
  const source = read('server.js');
  assert.match(source, /function getModUiTemplateLocals/);
  assert.match(source, /app\.get\('\/api\/mod-ui\/manifest'/);
  assert.match(source, /app\.get\('\/mods\/:modName\/ui\/:pageId'/);
  assert.match(source, /modExtensionRegistry\.getUiManifest\(\)/);
  assert.match(source, /res\.render\('mod-page\.njk'/);
});

test('top-level page renders receive mod UI template locals', () => {
  const source = read('server.js');
  for (const template of [
    'index.njk',
    'new-game.njk',
    'config.njk',
    'settings.njk',
    'mods.njk',
    'lorebooks.njk'
  ]) {
    const pattern = new RegExp(`res\\.render\\('${template}'[\\\\s\\\\S]+\\.\\.\\.getModUiTemplateLocals\\(\\)`);
    assert.match(source, pattern, `${template} should receive mod UI locals`);
  }
  const apiSource = read('api.js');
  assert.match(apiSource, /render\('player-stats\.njk'[\s\S]+getModUiTemplateLocals/);
  assert.match(apiSource, /render\('debug\.njk'[\s\S]+getModUiTemplateLocals/);
});

test('default mod page template has a root slot and shared app header', () => {
  const source = read('views/mod-page.njk');
  assert.match(source, /include "_includes\/app-header\.njk"/);
  assert.match(source, /data-mod-ui-page-root/);
  assert.match(source, /data-mod-ui-slot="mod-page.root"/);
  assert.match(source, /include "_includes\/mod-ui-scripts\.njk"/);
});
```

- [ ] **Step 2: Run static tests and verify they fail**

Run:

```bash
node --test tests/mod_ui_static.test.js
```

Expected: FAIL because the server helper, routes, and `views/mod-page.njk` do not exist.

- [ ] **Step 3: Add `getModUiTemplateLocals` to `server.js`**

In `server.js`, near the existing page route helpers before `app.get('/', ...)`, add:

```js
function getModUiTemplateLocals() {
    const manifest = modExtensionRegistry && typeof modExtensionRegistry.getUiManifest === 'function'
        ? modExtensionRegistry.getUiManifest()
        : { pages: [], navigationItems: [], panels: [], actions: [], overrides: [] };
    const modScripts = modLoader && typeof modLoader.getModClientScripts === 'function'
        ? modLoader.getModClientScripts()
        : [];
    const modStyles = modLoader && typeof modLoader.getModClientStyles === 'function'
        ? modLoader.getModClientStyles()
        : [];
    return {
        modUiManifest: manifest,
        modScripts,
        modStyles
    };
}
```

- [ ] **Step 4: Replace play-page local mod asset collection**

In `app.get('/', ...)`, remove the local `modScripts` and `modStyles` declarations and add the shared locals to `res.render`:

```js
        vehicleDebugEnabled: cliVehicleDebug,
        ...getModUiTemplateLocals()
```

- [ ] **Step 5: Pass shared locals to other top-level page renders**

Add `...getModUiTemplateLocals()` to the render locals for:

```js
res.render('new-game.njk', {
    title: 'Start New Game',
    currentPage: 'new-game',
    newGameDefaults,
    currentSetting: activeSetting,
    ...getModUiTemplateLocals()
});
```

```js
res.render('config.njk', {
    title: 'AI RPG Configuration',
    config: config,
    modConfigs: modLoader.getModConfigs(),
    modelOptions,
    currentPage: 'config',
    savedMessage,
    errorMessage,
    gameConfigOverrideYaml: typeof Globals.getGameConfigOverrideYaml === 'function'
        ? Globals.getGameConfigOverrideYaml()
        : '',
    gameLoaded: Globals.gameLoaded === true,
    ...getModUiTemplateLocals()
});
```

```js
res.render('mods.njk', {
    title: 'Mod Manager',
    currentPage: 'mods',
    modState: buildModManagerState(__dirname, { runtimeConfig: config }),
    ...getModUiTemplateLocals()
});
```

```js
res.render('settings.njk', {
    title: 'Game Settings Manager',
    currentPage: 'settings',
    defaultExistingSkills,
    defaultExistingSkillsError,
    defaultFactionCountFallback,
    unifiedTonalScaleDefinition,
    unifiedTonalScaleError,
    attributeOptions,
    modSettingFields: modExtensionRegistry.getSettingFields({ includeTabbed: false }),
    modSettingTabs: modExtensionRegistry.getSettingTabs(),
    ...getModUiTemplateLocals()
});
```

```js
res.render('lorebooks.njk', {
    title: 'Lorebook Manager',
    currentPage: 'lorebooks',
    ...getModUiTemplateLocals()
});
```

For `debug.njk` and `player-stats.njk`, add the same spread in the render calls in `api.js` if those routes are rendered there rather than in `server.js`.

Also add `getModUiTemplateLocals` to `apiScope` in `server.js`:

```js
    getModUiTemplateLocals,
```

In `api.js`, use the helper in the `player-stats.njk` and `debug.njk` route locals:

```js
const modUiLocals = typeof apiScope.getModUiTemplateLocals === 'function'
    ? apiScope.getModUiTemplateLocals()
    : {};
```

Then spread `...modUiLocals` into the render data for both templates.

- [ ] **Step 6: Add live manifest API route**

In `server.js`, near page routes, add:

```js
app.get('/api/mod-ui/manifest', (req, res) => {
    res.json({
        success: true,
        manifest: modExtensionRegistry.getUiManifest()
    });
});
```

- [ ] **Step 7: Add default mod UI page route**

In `server.js`, after the `/mods` page route, add:

```js
app.get('/mods/:modName/ui/:pageId', (req, res) => {
    const modName = typeof req.params.modName === 'string' ? req.params.modName.trim() : '';
    const pageId = typeof req.params.pageId === 'string' ? req.params.pageId.trim() : '';
    const page = modExtensionRegistry.getUiPage(modName, pageId);
    if (!page) {
        res.status(404).send(`Unknown mod UI page: ${modName}/${pageId}`);
        return;
    }
    res.render('mod-page.njk', {
        title: page.title || page.label || page.id,
        currentPage: `mod-ui:${page.fullId}`,
        modUiPage: page,
        ...getModUiTemplateLocals()
    });
});
```

- [ ] **Step 8: Create the default mod page template**

Create `views/mod-page.njk`:

```njk
<!DOCTYPE html>
<html lang="en">
{% set pageTitleValue = title | default(modUiPage.title | default("Mod Page")) %}
<head>
    {% include "_includes/head-common.njk" %}
    {% include "_includes/mod-ui-head.njk" %}
</head>
<body>
    <div class="container">
        {% set appHeaderTitle = modUiPage.title | default(modUiPage.label | default('Mod Page')) %}
        {% set appHeaderSubtitle = modUiPage.description | default('') %}
        {% include "_includes/app-header.njk" %}

        <main class="config-content mod-ui-page" data-mod-ui-page-root="{{ modUiPage.fullId }}">
            <section class="config-section">
                <h2>{{ modUiPage.label | default(modUiPage.id) }}</h2>
                {% if modUiPage.description %}
                <p class="help-text">{{ modUiPage.description }}</p>
                {% endif %}
                <div data-mod-ui-slot="mod-page.root"
                     data-mod-ui-page-id="{{ modUiPage.fullId }}"></div>
            </section>
        </main>
    </div>

    {% include "_includes/mod-ui-scripts.njk" %}
    <script>
        window.ModUI?.mountSlot('mod-page.root', {
            page: {{ modUiPage | dump | safe }},
            currentPage: {{ currentPage | dump | safe }}
        });
    </script>
</body>
</html>
```

- [ ] **Step 9: Run static tests and syntax check**

Run:

```bash
node --test tests/mod_ui_static.test.js
node --check server.js
```

Expected: both commands pass.

---

### Task 5: Add Shared Template Injection And Header Navigation

**Files:**
- Create: `views/_includes/mod-ui-head.njk`
- Create: `views/_includes/mod-ui-scripts.njk`
- Modify: `views/_includes/app-header.njk`
- Modify: top-level templates listed in File Map
- Modify: `tests/mod_ui_static.test.js`
- Create: `tests/mod_ui_template_render.test.js`

- [ ] **Step 1: Add static tests for shared includes and app header integration**

Append this block to `tests/mod_ui_static.test.js`:

```js
test('shared mod UI includes inject manifest runtime styles and scripts', () => {
  const head = read('views/_includes/mod-ui-head.njk');
  const scripts = read('views/_includes/mod-ui-scripts.njk');
  assert.match(head, /window\.__AIRPG_MOD_UI__/);
  assert.match(head, /modStyles/);
  assert.match(scripts, /\/js\/mod-ui\.js/);
  assert.match(scripts, /modScripts/);
});

test('app header renders mod navigation and exposes override targets', () => {
  const source = read('views/_includes/app-header.njk');
  assert.match(source, /data-mod-ui-target="nav\.chat"/);
  assert.match(source, /data-mod-ui-target="nav\.mods"/);
  assert.match(source, /modUiManifest\.navigationItems/);
  assert.match(source, /data-mod-ui-slot="app\.header\.nav"/);
  assert.match(source, /data-mod-ui-action-surface="app\.header\.actions"/);
});
```

- [ ] **Step 2: Add a template render test for mod navigation**

Create `tests/mod_ui_template_render.test.js`:

```js
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const nunjucks = require('nunjucks');

const baseDir = path.join(__dirname, '..');

test('app header renders registered primary mod navigation items', () => {
    const env = nunjucks.configure(path.join(baseDir, 'views'), { autoescape: false });
    const rendered = env.render('_includes/app-header.njk', {
        currentPage: 'mod-ui:implants:overview',
        appHeaderTitle: 'Implants',
        appHeaderSubtitle: '',
        modUiManifest: {
            pages: [],
            navigationItems: [{
                modName: 'implants',
                id: 'implants-nav',
                fullId: 'implants:implants-nav',
                label: 'Implants',
                href: '/mods/implants/ui/overview',
                icon: 'app-header-icon--mods',
                section: 'primary',
                order: 20
            }],
            panels: [],
            actions: [],
            overrides: []
        }
    });

    assert.match(rendered, /href="\/mods\/implants\/ui\/overview"/);
    assert.match(rendered, /data-mod-ui-target="nav\.implants:implants-nav"/);
    assert.match(rendered, />Implants<\/span>/);
});
```

- [ ] **Step 3: Run template tests and verify they fail**

Run:

```bash
node --test tests/mod_ui_static.test.js tests/mod_ui_template_render.test.js
```

Expected: FAIL because shared includes and header integration are not implemented.

- [ ] **Step 4: Create `mod-ui-head.njk`**

Create `views/_includes/mod-ui-head.njk`:

```njk
<script>
window.__AIRPG_MOD_UI__ = {{ (modUiManifest if modUiManifest is defined else {}) | dump | safe }};
</script>
{% if modStyles %}{% for mod in modStyles %}{% for style in mod.styles %}
<link rel="stylesheet" href="{{ style }}">
{% endfor %}{% endfor %}{% endif %}
```

- [ ] **Step 5: Create `mod-ui-scripts.njk`**

Create `views/_includes/mod-ui-scripts.njk`:

```njk
<script src="/js/mod-ui.js"></script>
{% if modScripts %}{% for mod in modScripts %}{% for script in mod.scripts %}
<script src="{{ script }}"></script>
{% endfor %}{% endfor %}{% endif %}
```

- [ ] **Step 6: Update top-level templates to include mod UI assets**

In each template head, after page-specific stylesheet links and before `</head>`, add:

```njk
    {% include "_includes/mod-ui-head.njk" %}
```

Apply this to:

- `views/index.njk` after `/css/map.css` and remove the old inline mod stylesheet loop.
- `views/config.njk` after `/css/config.css`.
- `views/settings.njk` after `/css/settings.css`.
- `views/mods.njk` after `/css/config.css`.
- `views/lorebooks.njk` after `/css/lorebooks.css`.
- `views/debug.njk` before `</head>`.
- `views/player-stats.njk` before `</head>`.
- `views/new-game.njk` before `</head>`.

Before existing page scripts or inline page initialization near the bottom of each body, add:

```njk
    {% include "_includes/mod-ui-scripts.njk" %}
```

For `views/index.njk`, replace the existing mod script loop with the include so `mod-ui.js` loads before mod scripts and before the large inline play-page script:

```njk
    {% include "_includes/mod-ui-scripts.njk" %}
```

- [ ] **Step 7: Update the app header for targets, mod nav, and slots**

In `views/_includes/app-header.njk`, add `data-mod-ui-target` attributes to built-in nav links by replacing each `appNavLink(...)` call with an optional wrapper macro change.

Modify `views/_includes/app-header-nav.njk` macro signature:

```njk
{% macro appNavLink(href, pageKey, label, iconClass, currentPage, variant, modUiTarget='') %}
<a href="{{ href }}"
   class="app-nav__link {{ 'app-nav__link--' ~ variant if variant else '' }} {{ 'is-active' if currentPage == pageKey else '' }}"
   {% if modUiTarget %}data-mod-ui-target="{{ modUiTarget }}"{% endif %}
   {% if currentPage == pageKey %}aria-current="page"{% endif %}
   title="{{ label }}">
    <span class="app-header-icon {{ iconClass }}" aria-hidden="true"></span>
    <span class="app-nav__label" data-mod-ui-label>{{ label }}</span>
</a>
{% endmacro %}
```

Then update built-in calls in `app-header.njk`:

```njk
{{ appNavLink('/', 'chat', 'Play', 'app-header-icon--play', currentPage, '', 'nav.chat') }}
{{ appNavLink('/new-game', 'new-game', 'New Game', 'app-header-icon--new-game', currentPage, 'accent', 'nav.new-game') }}
{{ appNavLink('/settings', 'settings', 'Worlds', 'app-header-icon--worlds', currentPage, '', 'nav.settings') }}
{{ appNavLink('/mods', 'mods', 'Mods', 'app-header-icon--mods', currentPage, '', 'nav.mods') }}
{{ appNavLink('/lorebooks', 'lorebooks', 'Lorebooks', 'app-header-icon--lorebooks', currentPage, '', 'nav.lorebooks') }}
{{ appNavLink('/config', 'config', 'System', 'app-header-icon--system', currentPage, '', 'nav.config') }}
```

After built-in primary nav links and before the Tools menu, add:

```njk
{% if modUiManifest and modUiManifest.navigationItems %}
    {% for item in modUiManifest.navigationItems %}
        {% if item.section == 'primary' %}
            <a href="{{ item.href }}"
               class="app-nav__link {{ 'is-active' if currentPage == ('mod-ui:' ~ item.fullId) else '' }}"
               data-mod-ui-target="nav.{{ item.fullId }}"
               {% if currentPage == ('mod-ui:' ~ item.fullId) %}aria-current="page"{% endif %}
               title="{{ item.label }}">
                <span class="app-header-icon {{ item.icon or 'app-header-icon--mods' }}" aria-hidden="true"></span>
                <span class="app-nav__label" data-mod-ui-label>{{ item.label }}</span>
            </a>
        {% endif %}
    {% endfor %}
{% endif %}
<span data-mod-ui-slot="app.header.nav"></span>
```

Inside `.app-header-actions`, add an action surface:

```njk
<span data-mod-ui-action-surface="app.header.actions"
      data-mod-ui-slot="app.header.actions"></span>
```

- [ ] **Step 8: Run template tests**

Run:

```bash
node --test tests/mod_ui_static.test.js tests/mod_ui_template_render.test.js
```

Expected: PASS.

---

### Task 6: Implement The Browser ModUI Runtime

**Files:**
- Create: `public/js/mod-ui.js`
- Create: `tests/mod_ui_runtime.test.js`

- [ ] **Step 1: Add runtime tests with a minimal fake DOM**

Create `tests/mod_ui_runtime.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { createModUiRuntime } = require('../public/js/mod-ui.js');

class FakeClassList {
    constructor() {
        this.values = new Set();
    }
    add(value) {
        this.values.add(value);
    }
    contains(value) {
        return this.values.has(value);
    }
}

class FakeElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.attributes = {};
        this.classList = new FakeClassList();
        this.textContent = '';
        this.hidden = false;
        this.events = {};
    }
    appendChild(child) {
        this.children.push(child);
        child.parentElement = this;
        return child;
    }
    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            this.dataset[key] = String(value);
        }
    }
    getAttribute(name) {
        return this.attributes[name] || null;
    }
    addEventListener(name, handler) {
        this.events[name] = handler;
    }
    click() {
        this.events.click?.({ preventDefault() {}, stopPropagation() {} });
    }
    querySelectorAll(selector) {
        const match = selector.match(/^\[data-([^=]+)="([^"]+)"\]$/);
        const results = [];
        const visit = (node) => {
            if (match) {
                const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                if (node.dataset?.[key] === match[2]) {
                    results.push(node);
                }
            }
            node.children.forEach(visit);
        };
        visit(this);
        return results;
    }
}

class FakeDocument extends FakeElement {
    constructor() {
        super('#document');
    }
    createElement(tagName) {
        return new FakeElement(tagName);
    }
}

test('ModUI refreshes panel renderers without duplicating panel containers', () => {
    const document = new FakeDocument();
    const slot = document.createElement('div');
    slot.setAttribute('data-mod-ui-slot', 'play.character.profile');
    document.appendChild(slot);
    const calls = [];
    const runtime = createModUiRuntime({
        document,
        console,
        __AIRPG_MOD_UI__: {
            pages: [],
            navigationItems: [],
            panels: [{
                fullId: 'implants:player-panel',
                slot: 'play.character.profile',
                label: 'Implants',
                clientModule: 'implants.renderPlayerPanel',
                order: 10
            }],
            actions: [],
            overrides: []
        }
    });

    runtime.registerPanelRenderer('implants.renderPlayerPanel', ({ panel, context }) => {
        calls.push({ panel: panel.fullId, actor: context.actor.name });
    });

    runtime.mountSlot('play.character.profile', { actor: { name: 'Ada' } });
    runtime.mountSlot('play.character.profile', { actor: { name: 'Baato' } });

    assert.deepEqual(calls, [
        { panel: 'implants:player-panel', actor: 'Ada' },
        { panel: 'implants:player-panel', actor: 'Baato' }
    ]);
    assert.equal(slot.children.length, 1);
});

test('ModUI mounts actions and invokes registered handlers', () => {
    const document = new FakeDocument();
    const surface = document.createElement('div');
    surface.setAttribute('data-mod-ui-action-surface', 'thing.card.actions');
    document.appendChild(surface);
    const calls = [];
    const runtime = createModUiRuntime({
        document,
        console,
        __AIRPG_MOD_UI__: {
            pages: [],
            navigationItems: [],
            panels: [],
            actions: [{
                fullId: 'implants:inspect',
                surface: 'thing.card.actions',
                label: 'Inspect',
                clientHandler: 'implants.inspect',
                order: 10
            }],
            overrides: []
        }
    });

    runtime.registerActionHandler('implants.inspect', ({ action, context }) => {
        calls.push({ action: action.fullId, thing: context.thing.name });
    });

    runtime.mountActions('thing.card.actions', { thing: { name: 'Mnemonic Lattice' } });
    assert.equal(surface.children.length, 1);
    surface.children[0].click();
    assert.deepEqual(calls, [{ action: 'implants:inspect', thing: 'Mnemonic Lattice' }]);
});
```

- [ ] **Step 2: Run runtime tests and verify they fail**

Run:

```bash
node --test tests/mod_ui_runtime.test.js
```

Expected: FAIL because `public/js/mod-ui.js` does not exist.

- [ ] **Step 3: Create `public/js/mod-ui.js`**

Create this file:

```js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ModUI = factory().createModUiRuntime(root);
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function createModUiRuntime(root = {}) {
        const documentRef = root.document || null;
        const consoleRef = root.console || console;
        const manifest = root.__AIRPG_MOD_UI__ || { pages: [], navigationItems: [], panels: [], actions: [], overrides: [] };
        const panelRenderers = new Map();
        const actionHandlers = new Map();
        const listeners = new Map();
        const mountedPanels = new WeakMap();
        const mountedActions = new WeakMap();

        function emit(eventName, payload = {}) {
            const handlers = listeners.get(eventName) || [];
            handlers.forEach(handler => {
                try {
                    handler(payload);
                } catch (error) {
                    consoleRef.error(`ModUI listener failed for ${eventName}:`, error);
                }
            });
        }

        function on(eventName, handler) {
            if (typeof eventName !== 'string' || !eventName.trim()) {
                throw new Error('ModUI.on requires eventName.');
            }
            if (typeof handler !== 'function') {
                throw new Error('ModUI.on requires handler.');
            }
            const key = eventName.trim();
            if (!listeners.has(key)) {
                listeners.set(key, []);
            }
            listeners.get(key).push(handler);
            return () => off(key, handler);
        }

        function off(eventName, handler) {
            const key = typeof eventName === 'string' ? eventName.trim() : '';
            if (!key || !listeners.has(key)) {
                return;
            }
            listeners.set(key, listeners.get(key).filter(candidate => candidate !== handler));
        }

        function queryAll(selector, rootElement = null) {
            const host = rootElement || documentRef;
            if (!host || typeof host.querySelectorAll !== 'function') {
                return [];
            }
            return Array.from(host.querySelectorAll(selector));
        }

        function createElement(tagName) {
            if (!documentRef || typeof documentRef.createElement !== 'function') {
                throw new Error('ModUI requires document.createElement for DOM mounting.');
            }
            return documentRef.createElement(tagName);
        }

        function registerPanelRenderer(id, renderer) {
            if (typeof id !== 'string' || !id.trim()) {
                throw new Error('registerPanelRenderer requires id.');
            }
            if (typeof renderer !== 'function') {
                throw new Error(`Panel renderer "${id}" must be a function.`);
            }
            panelRenderers.set(id.trim(), renderer);
        }

        function registerActionHandler(id, handler) {
            if (typeof id !== 'string' || !id.trim()) {
                throw new Error('registerActionHandler requires id.');
            }
            if (typeof handler !== 'function') {
                throw new Error(`Action handler "${id}" must be a function.`);
            }
            actionHandlers.set(id.trim(), handler);
        }

        function getMountedPanelContainer(host, panel) {
            if (!mountedPanels.has(host)) {
                mountedPanels.set(host, new Map());
            }
            const mounted = mountedPanels.get(host);
            if (mounted.has(panel.fullId)) {
                return mounted.get(panel.fullId);
            }
            if (panel.renderMode === 'replace') {
                host.innerHTML = '';
                if (Array.isArray(host.children)) {
                    host.children.length = 0;
                }
            }
            const container = createElement('div');
            container.className = 'mod-ui-panel';
            container.dataset.modUiPanelId = panel.fullId;
            container.dataset.modName = panel.modName || '';
            host.appendChild(container);
            mounted.set(panel.fullId, container);
            return container;
        }

        function markActionMounted(map, host, fullId) {
            if (!map.has(host)) {
                map.set(host, new Set());
            }
            const mounted = map.get(host);
            if (mounted.has(fullId)) {
                return false;
            }
            mounted.add(fullId);
            return true;
        }

        function renderMissing(container, message) {
            container.textContent = message;
            container.classList?.add('mod-ui-missing');
        }

        function mountSlot(slotName, context = {}, rootElement = null) {
            const slot = typeof slotName === 'string' ? slotName.trim() : '';
            if (!slot) {
                throw new Error('mountSlot requires slotName.');
            }
            const panels = asArray(manifest.panels).filter(panel => panel.slot === slot);
            const hosts = queryAll(`[data-mod-ui-slot="${slot}"]`, rootElement);
            hosts.forEach(host => {
                panels.forEach(panel => {
                    const container = getMountedPanelContainer(host, panel);
                    const renderer = panelRenderers.get(panel.clientModule);
                    if (!renderer) {
                        renderMissing(container, `Missing mod UI renderer: ${panel.clientModule}`);
                        consoleRef.error(`Missing mod UI renderer: ${panel.clientModule}`, panel);
                        return;
                    }
                    try {
                        renderer({ container, panel, context, ModUI: api });
                    } catch (error) {
                        renderMissing(container, `Mod UI renderer failed: ${panel.fullId}`);
                        consoleRef.error(`Mod UI renderer failed for ${panel.fullId}:`, error);
                    }
                    emit('airpg:slot-mounted', { slotName: slot, panel, context, container });
                });
            });
        }

        function mountActions(surfaceName, context = {}, rootElement = null) {
            const surface = typeof surfaceName === 'string' ? surfaceName.trim() : '';
            if (!surface) {
                throw new Error('mountActions requires surfaceName.');
            }
            const actions = asArray(manifest.actions).filter(action => action.surface === surface);
            const hosts = queryAll(`[data-mod-ui-action-surface="${surface}"]`, rootElement);
            hosts.forEach(host => {
                actions.forEach(action => {
                    if (!markActionMounted(mountedActions, host, action.fullId)) {
                        return;
                    }
                    const button = createElement('button');
                    button.type = 'button';
                    button.className = 'mod-ui-action-button';
                    button.dataset.modUiActionId = action.fullId;
                    button.textContent = action.label || action.id || 'Action';
                    button.addEventListener('click', event => {
                        event.preventDefault();
                        event.stopPropagation();
                        const handler = actionHandlers.get(action.clientHandler);
                        if (!handler) {
                            consoleRef.error(`Missing mod UI action handler: ${action.clientHandler}`, action);
                            return;
                        }
                        try {
                            handler({ action, context, event, ModUI: api });
                        } catch (error) {
                            consoleRef.error(`Mod UI action handler failed for ${action.fullId}:`, error);
                        }
                    });
                    host.appendChild(button);
                });
            });
        }

        async function apiFetch(path, options = {}) {
            if (typeof root.fetch !== 'function') {
                throw new Error('ModUI.apiFetch requires fetch.');
            }
            const response = await root.fetch(path, options);
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }
            return data;
        }

        function showToast(message) {
            consoleRef.info(message);
        }

        function showModal(options = {}) {
            const message = typeof options.message === 'string' ? options.message : '';
            if (typeof root.alert === 'function' && message) {
                root.alert(message);
            }
        }

        function applyOverrides(rootElement = null) {
            asArray(manifest.overrides).forEach(override => {
                const targets = queryAll(`[data-mod-ui-target="${override.target}"]`, rootElement);
                targets.forEach(target => {
                    if (override.operation === 'hide') {
                        target.hidden = true;
                    } else if (override.operation === 'rename') {
                        const label = target.querySelectorAll ? target.querySelectorAll('[data-mod-ui-label]')[0] : null;
                        if (label) {
                            label.textContent = String(override.value ?? '');
                        } else {
                            target.textContent = String(override.value ?? '');
                        }
                    } else if (override.operation === 'addClass') {
                        target.classList?.add(String(override.value || '').trim());
                    } else if (override.operation === 'reorder') {
                        target.style && (target.style.order = String(override.value));
                    }
                });
            });
        }

        function requestRefresh(reason = '') {
            emit('airpg:refresh-requested', { reason });
        }

        const api = {
            manifest,
            registerPanelRenderer,
            registerActionHandler,
            on,
            off,
            notify: emit,
            mountSlot,
            mountActions,
            applyOverrides,
            apiFetch,
            showModal,
            showToast,
            requestRefresh
        };

        if (documentRef && typeof documentRef.addEventListener === 'function') {
            documentRef.addEventListener('DOMContentLoaded', () => {
                applyOverrides();
                asArray(manifest.panels).forEach(panel => mountSlot(panel.slot));
                asArray(manifest.actions).forEach(action => mountActions(action.surface));
                emit('airpg:ready', { manifest });
            });
        }

        return api;
    }

    return { createModUiRuntime };
});
```

- [ ] **Step 4: Run runtime tests and syntax check**

Run:

```bash
node --test tests/mod_ui_runtime.test.js
node --check public/js/mod-ui.js
```

Expected: both commands pass.

---

### Task 7: Add Core Slots, Action Surfaces, And Lifecycle Notifications

**Files:**
- Modify: `views/index.njk`
- Modify: `views/settings.njk`
- Modify: `views/mods.njk`
- Modify: `public/css/main.scss`
- Modify: `tests/mod_ui_static.test.js`

- [ ] **Step 1: Add static tests for key slots and lifecycle calls**

Append this block to `tests/mod_ui_static.test.js`:

```js
test('play page exposes core mod UI slots and lifecycle notifications', () => {
  const source = read('views/index.njk');
  assert.match(source, /data-mod-ui-slot="play\.adventure\.sidebar"/);
  assert.match(source, /data-mod-ui-slot="play\.character\.profile"/);
  assert.match(source, /data-mod-ui-action-surface="player\.profile\.actions"/);
  assert.match(source, /function mountModUiSlot/);
  assert.match(source, /function mountModUiActions/);
  assert.match(source, /notifyModUi\('airpg:tab-changed'/);
  assert.match(source, /notifyModUi\('airpg:data-refreshed'/);
  assert.match(source, /mountModUiSlot\('play\.character\.profile'/);
});

test('settings and mods pages expose mod UI extension slots', () => {
  assert.match(read('views/settings.njk'), /data-mod-ui-slot="settings\.editor\.tabs"/);
  assert.match(read('views/settings.njk'), /data-mod-ui-action-surface="settings\.editor\.actions"/);
  assert.match(read('views/mods.njk'), /data-mod-ui-slot="mods\.manager\.rows"/);
});

test('main scss contains generic mod UI shell styles', () => {
  const source = read('public/css/main.scss');
  assert.match(source, /\.mod-ui-panel/);
  assert.match(source, /\.mod-ui-action-button/);
  assert.match(source, /\.mod-ui-missing/);
});
```

- [ ] **Step 2: Run static tests and verify they fail**

Run:

```bash
node --test tests/mod_ui_static.test.js
```

Expected: FAIL because slots, helpers, and styles do not exist.

- [ ] **Step 3: Add play-page static slots and action surfaces**

In `views/index.njk`, inside `.chat-sidebar` after the player card block, add:

```njk
<div data-mod-ui-slot="play.adventure.sidebar"></div>
```

Inside the character tab, after the Current Status section and before `.form-actions`, add:

```njk
<div data-mod-ui-slot="play.character.profile"></div>
```

Inside the character tab `.form-actions`, add:

```njk
<span data-mod-ui-action-surface="player.profile.actions"></span>
```

Near the location header after `.location-header`, add:

```njk
<div data-mod-ui-slot="play.location.header"></div>
```

Near `.location-details`, add:

```njk
<div data-mod-ui-slot="play.location.details"></div>
```

- [ ] **Step 4: Add play-page JS helpers**

In the large inline script in `views/index.njk`, near other general helpers, add:

```js
        function notifyModUi(eventName, payload = {}) {
            try {
                window.ModUI?.notify(eventName, payload);
            } catch (error) {
                console.warn(`Mod UI notification failed for ${eventName}:`, error);
            }
        }

        function mountModUiSlot(slotName, context = {}, rootElement = null) {
            try {
                window.ModUI?.mountSlot(slotName, context, rootElement || document);
            } catch (error) {
                console.warn(`Mod UI slot mount failed for ${slotName}:`, error);
            }
        }

        function mountModUiActions(surfaceName, context = {}, rootElement = null) {
            try {
                window.ModUI?.mountActions(surfaceName, context, rootElement || document);
            } catch (error) {
                console.warn(`Mod UI action mount failed for ${surfaceName}:`, error);
            }
        }
```

- [ ] **Step 5: Notify tab changes**

In `initTabs()`, after tab-specific refresh logic in `activateTab`, add:

```js
                notifyModUi('airpg:tab-changed', {
                    tabName,
                    panel: targetPanel
                });
```

- [ ] **Step 6: Mount player profile slots after player data refresh**

At the end of `updateChatPlayerPanel(player = {})`, before the function returns, add:

```js
            mountModUiSlot('play.adventure.sidebar', {
                actor: data,
                player: data,
                currentSetting: window.currentSetting || null
            });
            mountModUiSlot('play.character.profile', {
                actor: data,
                player: data,
                currentSetting: window.currentSetting || null
            });
            mountModUiActions('player.profile.actions', {
                actor: data,
                player: data,
                currentSetting: window.currentSetting || null
            });
            notifyModUi('airpg:data-refreshed', {
                actor: data,
                player: data,
                scope: 'player'
            });
```

- [ ] **Step 7: Mount location slots after location render**

At the end of `window.updateLocationDisplay = async function(location) { ... }`, after `window.AIRPG_LAST_LOCATION` is updated in the success branch, add:

```js
                    mountModUiSlot('play.location.header', {
                        location,
                        currentSetting: window.currentSetting || null
                    });
                    mountModUiSlot('play.location.details', {
                        location,
                        currentSetting: window.currentSetting || null
                    });
                    notifyModUi('airpg:data-refreshed', {
                        location,
                        scope: 'location'
                    });
```

- [ ] **Step 8: Add action surfaces for thing cards**

In the function that builds thing collection cards, after `options.decorateCard` runs for table rows, grid tiles, and classic cards, add a surface element to the controls host:

```js
                const modActionSurface = document.createElement('span');
                modActionSurface.dataset.modUiActionSurface = 'thing.card.actions';
                modActionSurface.dataset.modUiSlot = 'thing.card.actions';
                utilitiesInner.appendChild(modActionSurface);
                mountModUiActions('thing.card.actions', { thing }, row);
```

For grid and classic card branches, append the same kind of `span` to `tile` or `card` and call:

```js
                mountModUiActions('thing.card.actions', { thing }, tile);
```

or:

```js
                mountModUiActions('thing.card.actions', { thing }, card);
```

- [ ] **Step 9: Add action surfaces for NPC cards**

Where location NPC cards are created in `window.updateLocationDisplay`, after `card.appendChild(nameEl);`, add:

```js
                                const npcActionSurface = document.createElement('span');
                                npcActionSurface.dataset.modUiActionSurface = 'npc.card.actions';
                                npcActionSurface.dataset.modUiSlot = 'npc.card.actions';
                                card.appendChild(npcActionSurface);
                                mountModUiActions('npc.card.actions', { npc }, card);
```

Where party member cards are rendered in `renderChatPartyPanel`, add the same surface and use `{ npc: member, partyMember: member }`.

- [ ] **Step 10: Add settings and mods slots**

In `views/settings.njk`, near the editor tab buttons after registered mod setting tabs, add:

```njk
<span data-mod-ui-slot="settings.editor.tabs"></span>
```

Near the sticky action bar or final form actions, add:

```njk
<span data-mod-ui-action-surface="settings.editor.actions"></span>
```

Before the closing inline script finishes initialization, add:

```js
        window.ModUI?.mountSlot('settings.editor.tabs', { currentPage: 'settings' });
        window.ModUI?.mountActions('settings.editor.actions', { currentPage: 'settings' });
```

In `views/mods.njk`, after `#mods-manager-list`, add:

```njk
<div data-mod-ui-slot="mods.manager.rows"></div>
```

After `renderMods(data.modState);`, add:

```js
            window.ModUI?.mountSlot('mods.manager.rows', { modState: state, currentPage: 'mods' });
```

- [ ] **Step 11: Add generic mod UI styles**

Append to `public/css/main.scss`:

```scss
.mod-ui-panel {
  margin-top: 0.75rem;
}

.mod-ui-action-button {
  border: 1px solid rgba(255, 255, 255, 0.24);
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border-radius: 6px;
  padding: 0.35rem 0.55rem;
  font: inherit;
  cursor: pointer;
}

.mod-ui-action-button:hover,
.mod-ui-action-button:focus-visible {
  background: rgba(255, 255, 255, 0.2);
  outline: none;
}

.mod-ui-missing {
  color: #ffd2d2;
  border: 1px solid rgba(255, 120, 120, 0.45);
  border-radius: 6px;
  padding: 0.5rem;
  background: rgba(120, 0, 0, 0.25);
}
```

- [ ] **Step 12: Run tests and compile SCSS**

Run:

```bash
node --test tests/mod_ui_static.test.js
npm run scss:build:main
```

Expected: test passes and Sass writes `public/css/main.css`.

---

### Task 8: Register Implant And Spell UI Contributions

**Files:**
- Modify: `mods/implants/mod.js`
- Create: `mods/implants/public/js/implants-ui.js`
- Modify: `mods/spells/mod.js`
- Create: `mods/spells/public/js/spells-ui.js`
- Modify: `tests/mod_extension_hooks.test.js`
- Modify: `tests/mod_ui_static.test.js`

- [ ] **Step 1: Add tests for bundled mod UI registrations**

Append to `tests/mod_extension_hooks.test.js`:

```js
test('bundled implants and spells mods register UI panels', () => {
    const registry = new ModExtensionRegistry();
    const scopeBase = {
        modExtensionRegistry: registry,
        renderModPrompt: () => '<root></root>',
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generation' }),
        baseTimeoutMilliseconds: 1000
    };
    const loader = new ModLoader(path.join(__dirname, '..'));

    require('../mods/implants/mod.js').register(
        loader.createModScope('implants', path.join(__dirname, '..', 'mods', 'implants'), scopeBase)
    );
    require('../mods/spells/mod.js').register(
        loader.createModScope('spells', path.join(__dirname, '..', 'mods', 'spells'), scopeBase)
    );

    const panels = registry.getUiManifest().panels.map(panel => panel.fullId);
    assert.ok(panels.includes('implants:player-implants-panel'));
    assert.ok(panels.includes('spells:player-spells-panel'));
});
```

Append to `tests/mod_ui_static.test.js`:

```js
test('bundled mod UI client scripts register panel renderers', () => {
  assert.match(read('mods/implants/mod.js'), /registerUiPanel/);
  assert.match(read('mods/spells/mod.js'), /registerUiPanel/);
  assert.match(read('mods/implants/public/js/implants-ui.js'), /registerPanelRenderer\('implants\.renderPlayerPanel'/);
  assert.match(read('mods/spells/public/js/spells-ui.js'), /registerPanelRenderer\('spells\.renderPlayerPanel'/);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test tests/mod_extension_hooks.test.js tests/mod_ui_static.test.js
```

Expected: FAIL because bundled mods do not register UI panels and client scripts do not exist.

- [ ] **Step 3: Register the implant player profile panel**

In `mods/implants/mod.js`, after the setting/entity field registrations and before chat tools, add:

```js
        scope.registerUiPanel({
            id: 'player-implants-panel',
            slot: 'play.character.profile',
            label: 'Installed Implants',
            order: 20,
            clientModule: 'implants.renderPlayerPanel'
        });
```

- [ ] **Step 4: Create implant panel client script**

Create `mods/implants/public/js/implants-ui.js`:

```js
(function () {
    function findSection(actor) {
        const sections = Array.isArray(actor?.modStatusSections) ? actor.modStatusSections : [];
        return sections.find(section => section && section.key === 'implants') || null;
    }

    function clear(element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }

    window.ModUI?.registerPanelRenderer('implants.renderPlayerPanel', ({ container, context }) => {
        clear(container);
        const actor = context?.actor || context?.player || window.currentPlayerData || null;
        const section = findSection(actor);
        if (!section || !Array.isArray(section.entries) || section.entries.length === 0) {
            return;
        }

        const wrapper = document.createElement('section');
        wrapper.className = 'config-section mod-implants-panel';
        wrapper.dataset.modName = 'implants';

        const heading = document.createElement('h2');
        heading.textContent = section.label || 'Implants';
        wrapper.appendChild(heading);

        const list = document.createElement('ul');
        list.className = 'npc-view-list';
        section.entries.forEach(entry => {
            const item = document.createElement('li');
            const name = document.createElement('strong');
            name.textContent = entry.itemName || entry.name || entry.itemId || 'Implant';
            item.appendChild(name);
            const details = [entry.slot, entry.description].filter(Boolean).join(' - ');
            if (details) {
                const description = document.createElement('span');
                description.className = 'npc-view-list-description';
                description.textContent = details;
                item.appendChild(description);
            }
            list.appendChild(item);
        });
        wrapper.appendChild(list);
        container.appendChild(wrapper);
    });
})();
```

- [ ] **Step 5: Register the spell player profile panel**

In `mods/spells/mod.js`, after setting fields and before the startup validator, add:

```js
        scope.registerUiPanel({
            id: 'player-spells-panel',
            slot: 'play.character.profile',
            label: 'Known Spells',
            order: 30,
            clientModule: 'spells.renderPlayerPanel'
        });
```

- [ ] **Step 6: Create spell panel client script**

Create `mods/spells/public/js/spells-ui.js`:

```js
(function () {
    function findSection(actor) {
        const sections = Array.isArray(actor?.modStatusSections) ? actor.modStatusSections : [];
        return sections.find(section => section && section.key === 'spells') || null;
    }

    function clear(element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }

    window.ModUI?.registerPanelRenderer('spells.renderPlayerPanel', ({ container, context }) => {
        clear(container);
        const actor = context?.actor || context?.player || window.currentPlayerData || null;
        const section = findSection(actor);
        if (!section || !Array.isArray(section.entries) || section.entries.length === 0) {
            return;
        }

        const wrapper = document.createElement('section');
        wrapper.className = 'config-section mod-spells-panel';
        wrapper.dataset.modName = 'spells';

        const heading = document.createElement('h2');
        heading.textContent = section.label || 'Spells';
        wrapper.appendChild(heading);

        const list = document.createElement('ul');
        list.className = 'npc-view-list';
        section.entries.forEach(entry => {
            const item = document.createElement('li');
            const name = document.createElement('strong');
            name.textContent = entry.name || entry.id || 'Spell';
            item.appendChild(name);
            const details = [];
            if (entry.level) details.push(`level ${entry.level}`);
            if (entry.manaUsage) details.push(`${entry.manaUsage} usage`);
            if (entry.cost) details.push(`cost ${entry.cost}`);
            if (entry.effectSummary) details.push(entry.effectSummary);
            if (details.length) {
                const description = document.createElement('span');
                description.className = 'npc-view-list-description';
                description.textContent = details.join(' - ');
                item.appendChild(description);
            }
            list.appendChild(item);
        });
        wrapper.appendChild(list);
        container.appendChild(wrapper);
    });
})();
```

- [ ] **Step 7: Run tests and syntax checks**

Run:

```bash
node --test tests/mod_extension_hooks.test.js tests/mod_ui_static.test.js
node --check mods/implants/mod.js
node --check mods/implants/public/js/implants-ui.js
node --check mods/spells/mod.js
node --check mods/spells/public/js/spells-ui.js
```

Expected: all commands pass.

---

### Task 9: Update Documentation

**Files:**
- Modify: `docs/modding.md`
- Modify: `docs/modding_hooks.md`
- Modify: `docs/classes/ModExtensionRegistry.md`
- Modify: `docs/classes/ModLoader.md`
- Modify: `docs/ui/pages.md`
- Modify: `docs/ui/assets_styles.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Update modding overview**

In `docs/modding.md`, add these bullets under Runtime hooks:

```markdown
- `registerUiPage(...)`
- `registerNavigationItem(...)`
- `registerUiPanel(...)`
- `registerUiAction(...)`
- `registerUiOverride(...)`
```

Add a paragraph:

```markdown
Enabled mods can add supported UI through registry declarations plus client scripts in `mods/<name>/public/js`. The server exposes a live active-mod UI manifest to top-level pages, loads `public/js/mod-ui.js`, then loads enabled mod scripts. Mods should target named slots and action surfaces through `window.ModUI` instead of querying arbitrary core DOM.
```

- [ ] **Step 2: Update hook contract docs**

In `docs/modding_hooks.md`, add a `## UI Hooks` section:

```markdown
## UI Hooks

Mods can register UI contributions through their scoped helpers:

- `scope.registerUiPage({ id, label, route, title, description, icon, order, script, style })`
- `scope.registerNavigationItem({ id, label, href, icon, order, section })`
- `scope.registerUiPanel({ id, slot, label, order, clientModule, renderMode })`
- `scope.registerUiAction({ id, surface, label, icon, order, clientHandler })`
- `scope.registerUiOverride({ id, target, operation, value })`

The browser runtime is available as `window.ModUI`. Mod scripts should register renderers with `window.ModUI.registerPanelRenderer(id, fn)` and action handlers with `window.ModUI.registerActionHandler(id, fn)`.

Initial named slots include `play.character.profile`, `play.adventure.sidebar`, `play.location.header`, `play.location.details`, `thing.card.actions`, `npc.card.actions`, `settings.editor.tabs`, and `mods.manager.rows`.
```

- [ ] **Step 3: Update class docs**

In `docs/classes/ModExtensionRegistry.md`, document all five UI methods, `getUiManifest()`, duplicate failures, unknown slot/surface failures, and limited override operations.

In `docs/classes/ModLoader.md`, document the scoped helper methods and deterministic mod asset loading.

- [ ] **Step 4: Update UI docs**

In `docs/ui/pages.md`, update Shared head behavior and each top-level page note to say pages receive `modUiManifest`, `modStyles`, and `modScripts`, include `mod-ui.js`, and expose page-specific slots where implemented.

In `docs/ui/assets_styles.md`, add a short section:

```markdown
## Mod UI Runtime Styles

`public/css/main.scss` defines generic `.mod-ui-panel`, `.mod-ui-action-button`, and `.mod-ui-missing` styles used by registered mod UI panels and actions. Mod-owned DOM should add `data-mod-name` and namespaced classes such as `mod-implants-panel` to avoid CSS collisions.
```

- [ ] **Step 5: Update docs index**

In `docs/README.md`, update the recent mod UI design note to mention the implemented files and runtime.

- [ ] **Step 6: Verify docs references**

Run:

```bash
rg -n "registerUiPage|registerNavigationItem|registerUiPanel|registerUiAction|registerUiOverride|ModUI" docs -g '!all.md'
```

Expected: results in the docs listed above.

---

### Task 10: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Run focused unit/static tests**

Run:

```bash
node --test \
  tests/mod_extension_hooks.test.js \
  tests/mod_ui_static.test.js \
  tests/mod_ui_runtime.test.js \
  tests/mod_ui_template_render.test.js
```

Expected: PASS.

- [ ] **Step 2: Run syntax checks**

Run:

```bash
node --check ModExtensionRegistry.js
node --check ModLoader.js
node --check server.js
node --check public/js/mod-ui.js
node --check mods/implants/mod.js
node --check mods/implants/public/js/implants-ui.js
node --check mods/spells/mod.js
node --check mods/spells/public/js/spells-ui.js
```

Expected: all commands exit 0.

- [ ] **Step 3: Compile SCSS**

Run:

```bash
npm run scss:build:main
```

Expected: Sass completes and updates `public/css/main.css`.

- [ ] **Step 4: Run existing adjacent tests**

Run:

```bash
node --test \
  tests/settings_mod_tabs.test.js \
  tests/mod_manager_ui.test.js \
  tests/mod_manager_api_static.test.js \
  tests/thing_grid_equipment_pill_ui.test.js
```

Expected: PASS. `thing_grid_equipment_pill_ui.test.js` should still prove `implantSlot` does not trigger normal equipment toggles.

- [ ] **Step 5: Optional full test sweep**

Run:

```bash
node --test tests/*.test.js
```

Expected: new mod UI tests pass. If unrelated existing failures appear, capture the failing test names and error messages in the final handoff without changing unrelated files.

## Self-Review Checklist

- Spec coverage:
  - UI pages and nav entries: Tasks 1, 2, 4, 5.
  - Panels and action surfaces: Tasks 1, 2, 6, 7, 8.
  - Limited overrides: Tasks 1, 2, 5, 6.
  - Shared asset injection: Tasks 4 and 5.
  - Browser lifecycle: Tasks 6 and 7.
  - Bundled implants and spells examples: Task 8.
  - Docs: Task 9.
- Placeholder scan: no placeholder markers or unspecified implementation steps should remain in this plan.
- Type consistency: registry methods use `registerUiPage`, `registerNavigationItem`, `registerUiPanel`, `registerUiAction`, `registerUiOverride`, and `getUiManifest` consistently across tests, docs, and code snippets.
