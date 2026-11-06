const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');
const yaml = require('js-yaml');
const ModLoader = require('../../ModLoader');
const ModExtensionRegistry = require('../../ModExtensionRegistry');
const ROOT = path.resolve(__dirname, '..', '..');
const registry = new ModExtensionRegistry();
for (const name of ['modules', 'implants', 'spells', 'nsfw-boost']) {
    const loader = new ModLoader(ROOT, { config: { mods: { [name]: { enabled: true } } } });
    const scope = loader.createModScope(name, path.join(ROOT, 'mods', name), { modExtensionRegistry: registry, things: new Map(), getCurrentPlayer: () => null, getActiveSettingSnapshot: () => ({ modSettings: {} }) }, { mod: {}, modConfig: {} });
    require(path.join(ROOT, 'mods', name, 'mod.js')).register(scope);
}

const PUBLIC = path.join(ROOT, 'public');
const ASSETS = path.join(ROOT, 'assets');
const URL = process.env.PLAYWRIGHT_BASE_URL
    || `http://0.0.0.0:${process.env.PLAYWRIGHT_PORT || 4173}/`;
const statesByPage = new WeakMap();
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(ROOT, 'views')), { autoescape: true });
const player = {
    id: 'fixture-player', name: 'Fixture Hero', abilities: [
        { id: 'ability-a', name: 'Arcane <Ward>', type: 'Active', level: 3, shortDescription: 'Brief <summary>.', description: 'A full & detailed description with <b>literal markup</b>.', statusEffects: [{ name: 'Guard <&>', duration: -1, attributes: [{ attribute: 'Strength', modifier: 2, percentModifier: 20 }], techniqueGrants: [{ techniqueId: 'ward', techniqueName: 'Wardcraft Technique' }] }] },
        { id: 'ability-b', name: 'Steady', type: 'Passive', level: 1, shortDescription: 'One description.', description: 'One description.' }
    ]
};

async function setup(page, { openPlayerChooser = true, gameLoaded = true, apiHandler = null, seedPlayer = true, stubImages = true } = {}) {
    const errors = [], writes = [];
    const apiState = { handler: apiHandler, requests: [], selection: null };
    statesByPage.set(page, apiState);
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.route('**/*', async route => {
        const request = route.request(), url = new globalThis.URL(request.url());
        if (url.origin !== new globalThis.URL(URL).origin) { await route.abort(); return; }
        const pathname = decodeURIComponent(url.pathname);
        if (pathname === '/') {
            await route.fulfill({ contentType: 'text/html', body: env.render('index.njk', {
                title: 'Ability fixture', currentPage: 'chat', characterPortraitWidth: 3, characterPortraitHeight: 4,
                clientMessageHistory: { maxMessages: 100, pruneTo: 80 }, currentSetting: {}, gameLoaded,
                availableSkills: [], thingImageBadges: registry.getThingImageBadges(), thingContextActions: registry.getThingContextActions(), thingEditFields: registry.getEntityFields('thing', { exposeToEditModal: true }), playerEditFields: registry.getEntityFields('player', { exposeToEditModal: true }),
                rarityDefinitions: [], needBarDefinitions: [], pointPoolFormulas: {}
            }) });
            return;
        }
        if (pathname === '/api/images/request') { await route.fulfill({ json: { skipped: true, reason: 'fixture' } }); return; }
        if (pathname.startsWith('/api/')) {
            const apiRequest = { request, pathname, search: url.search, method: request.method() };
            apiState.requests.push(apiRequest);
            if (typeof apiState.handler === 'function') {
                const response = await apiState.handler(apiRequest);
                if (response) {
                    if (Object.hasOwn(response, 'rawBody')) await route.fulfill({ status: response.status || 200, contentType: 'application/json', body: response.rawBody });
                    else await route.fulfill({ status: response.status || 200, json: response.body || {} });
                    return;
                }
            }
            if (!['GET', 'HEAD'].includes(request.method())) { writes.push(`${request.method()} ${pathname}`); await route.fulfill({ status: 405, json: { error: 'Writes disabled' } }); return; }
            const json = pathname === '/api/player/ability-selection' ? { success: true, player, abilitySelection: apiState.selection || { pending: false, levelsMissing: [] } } : pathname === '/api/player' ? { success: true, player } : pathname === '/api/techniques' ? { actorId: player.id, actorName: player.name, disciplines: [], techniques: [], targets: [], catalog: [{ id: 'ward', name: 'Wardcraft Technique' }] } : pathname === '/api/chat/history' ? { success: true, history: [] } : { success: true, attributes: {} };
            await route.fulfill({ json });
            return;
        }
        const root = pathname.startsWith('/assets/') ? ASSETS : PUBLIC;
        const relative = pathname.startsWith('/assets/') ? pathname.slice('/assets'.length) : pathname;
        const file = path.resolve(root, `.${relative}`);
        if (file.startsWith(`${root}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            const type = ({ '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream';
            await route.fulfill({ contentType: type, body: fs.readFileSync(file) });
        } else await route.fulfill({ status: 404, body: `Missing fixture asset: ${pathname}` });
    });
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.AIRPG_CHAT));
    await page.evaluate(({ data, seed, stub }) => { if (stub) window.renderEntityImage = async ({ element }) => { element.textContent = 'Icon'; return { imageId: 'fixture-icon' }; }; if (seed) window.updateChatPlayerPanel(data); }, { data: player, seed: seedPlayer, stub: stubImages });
    if (openPlayerChooser) {
        await page.locator('#chatPlayerAbilitiesButton').evaluate(button => button.click());
        await expect(page.locator('#playerAbilitiesModal')).toBeVisible();
    }
    return { errors, writes, apiState };
}

const storyLoader = new ModLoader(ROOT, { config: { mods: { 'story-authoring': { enabled: true } } } });
const storyScope = storyLoader.createModScope('story-authoring', path.join(ROOT, 'mods/story-authoring'), {
    modExtensionRegistry: registry, things: new Map(), getCurrentPlayer: () => null, nunjucks,
    app: Object.fromEntries(['get', 'post', 'put', 'delete', 'patch'].map(method => [method, () => {}])),
    config: { mods: { 'story-authoring': { storyStoreRoot: path.join(ROOT, 'tmp/l08-story-library') } } }
}, { mod: {}, modConfig: { storyStoreRoot: path.join(ROOT, 'tmp/l08-story-library') } });
require('../../mods/story-authoring/mod').register(storyScope);

test('registered mod fields, badges and context actions reach the actual Play and NPC consumers', async ({ page }) => {
    let actionRequest;
    const { errors, writes } = await setup(page, { openPlayerChooser: false, stubImages: false, apiHandler: ({ pathname, method, request }) => {
        if (pathname === '/api/mod-thing-context-actions/implants:install-implant' && method === 'POST') { actionRequest = request.postDataJSON(); return { body: { success: true } }; }
        return null;
    } });
    const result = await page.evaluate(() => {
        window.currentSetting = { modSettings: { implants: { itemLabel: 'Tattoo Design', badgeImagePath: 'image.svg' }, modules: { itemLabel: 'Crystal', slotTypes: [{ id: 'known', label: 'Known' }] } } };
        const thing = { id: 'thing_1', implantSlot: 'neural', moduleSlots: [{ type: 'unknown' }], moduleType: 'unknown', installedModuleIds: ['module_1'] };
        renderThingEditModFields(thing);
        currentNpcInventoryNpcId = 'npc_7';
        renderNpcInventory([{ ...thing, name: 'Fixture Implant', thingType: 'item', count: 1 }]);
        window.AIRPG_MODAL_STACK.setVisible(document.querySelector('#npcInventoryModal'), true);
        renderNpcEditModFields({ sexualTraits: 'Literal <text> & "quotes"\nline two' });
        const badges = getModThingImageBadges(thing);
        const actions = context => getModThingContextActions(thing, { context }).map(a => a.fullId);
        const owners = [resolveModThingContextActionOwner({ context: 'npc-inventory', npcId: 'npc_7' }), resolveModThingContextActionOwner({ context: 'player-inventory' })];
        const status = document.createElement('div'), empty = document.createElement('p');
        renderModStatusSections(status, empty, [{ label: 'Crystals', entries: [{ moduleItemName: 'Shard <A>', baseItemName: 'Sword & shield', level: 0, cost: 0 }] }]);
        return { badges, inventory: actions('player-inventory'), npcEquipment: actions('npc-equipment'), location: actions('location'), owners, text: status.textContent, markup: status.innerHTML, npc: collectNpcEditModFieldValues() };
    });
    expect(result.badges.map(b => [b.key, b.position, b.renderMode])).toEqual([
        ['mod:implants:implant-chip', 'top-left', 'mask'], ['mod:modules:module-compatible', 'top-left', 'image'], ['mod:modules:module-type', 'top-left', 'image']
    ]);
    expect(result.badges[0]).toMatchObject({ label: 'Tattoo Design', iconUrl: '/mods/implants/assets/image.svg' });
    expect(result.badges[1].label).toBe('Crystal-compatible');
    expect(result.inventory).toEqual(['implants:install-implant', 'implants:uninstall-implant', 'modules:install-module', 'modules:remove-module']);
    expect(result.npcEquipment).toEqual(['implants:uninstall-implant']);
    expect(result.location).toEqual(['modules:install-module', 'modules:remove-module']);
    expect(result.owners[0]).toEqual({ ownerId: 'npc_7', ownerType: 'npc' });
    expect(result.text).toContain('Shard <A>on Sword & shield · level 0 · cost 0');
    expect(result.markup).toContain('&lt;A&gt;');
    expect(result.npc.sexualTraits).toBe('Literal <text> & "quotes"\nline two');
    await expect(page.locator('#thingEditModField_implantSlot')).toHaveValue('neural');
    await expect(page.locator('#npcEditModField_sexualTraits')).toHaveValue('Literal <text> & "quotes"\nline two');
    const needBars = ['need-bar-lust', 'spells'].map(name => { const definitions = yaml.load(fs.readFileSync(path.join(ROOT, 'mods', name, 'defs/need_bars.yaml'), 'utf8')).need_bars; const [id, data] = Object.entries(definitions)[0]; return { id, ...data, value: 0 }; });
    await page.evaluate(bars => { const host = document.createElement('div'); host.id = 'fixture-need-bars'; document.body.append(host); renderNeedBars(host, bars, { showIcon: true }); }, needBars);
    for (const [id, icon, color] of [['sex', '💋', 'rgb(255, 105, 180)'], ['mana', 'MP', 'rgb(138, 43, 226)']]) { const bar = page.locator(`#fixture-need-bars [data-bar-id="${id}"]`); await expect(bar).toHaveAttribute('aria-valuenow', '0'); await expect(bar.locator('.need-bar-icon')).toHaveText(icon); await expect(bar.locator('.need-bar-fill')).toHaveCSS('background-color', color); }
    const card = page.locator('#npcInventoryGrid [data-thing-id="thing_1"]');
    await expect(card).toBeVisible();
    const badge = card.locator('[data-badge-key="mod:implants:implant-chip"]');
    await expect(badge).toHaveAttribute('title', 'Tattoo Design');
    await expect(badge.locator('..')).toHaveClass(/top-left/);
    await expect(badge.locator('[style*="image.svg"]')).toHaveCount(1);
    await card.click({ button: 'right' });
    await expect(page.locator('.thing-card-menu-item--mod-action')).toHaveText(['Install implant', 'Uninstall implant', 'Install Module', 'Remove Module']);
    await page.getByRole('button', { name: 'Install implant', exact: true }).evaluate(button => button.click());
    await expect.poll(() => actionRequest).toMatchObject({ thingId: 'thing_1', context: 'npc-inventory', npcId: 'npc_7', ownerId: 'npc_7', ownerType: 'npc' });
    expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test('registered Worlds fields round-trip namespaces, structured costs, unknown settings and notes', async ({ page }) => {
    let profile = { id: 'l08-world', name: 'Parity World', theme: 'Fantasy', genre: 'Adventure', hidingAttribute: 'dexterity', perceptionAttribute: 'wisdom', modSettings: {
        modules: { slotTypes: [{ id: 'unknown_slot', label: 'Unknown <slot>', description: '' }], itemLabel: 'Crystal', hiddenValue: { zero: 0, nil: null, empty: [], object: {} }, applyPreset: 'crystals' },
        implants: { itemLabel: 'Tattoo', badgeImagePath: 'image.svg' },
        spells: { manaNeedBarId: 'unknown_mana', manaUsageBaseCosts: { low: 0, medium: 25, high: 50 } },
        'story-authoring': { defaultNotes: 'Notes <literal> & next' }, hidden: { untouched: false }
    } };
    const saves = [], blocked = [];
    expect(registry.getUiPages()).toEqual(expect.arrayContaining([expect.objectContaining({ modName: 'story-authoring', id: 'stories', path: '/stories', title: 'Stories', scripts: ['js/story-editor.js'], styles: ['css/story-editor.css'] })]));
    expect(registry.getSettingFields({ includeTabbed: false })).toEqual(expect.arrayContaining([expect.objectContaining({ namespace: 'story-authoring', key: 'defaultNotes', defaultValue: '' })]));
    await page.route('**/*', async route => {
        const url = new globalThis.URL(route.request().url()), pathname = decodeURIComponent(url.pathname), method = route.request().method();
        if (url.origin !== new globalThis.URL(URL).origin) return route.abort();
        if (pathname === '/settings') return route.fulfill({ contentType: 'text/html', body: env.render('settings.njk', {
            title: 'World Profiles', unifiedTonalScaleDefinition: {}, unifiedTonalScaleError: '',
            attributeOptions: [{ name: 'dexterity', label: 'Dexterity' }, { name: 'wisdom', label: 'Wisdom' }],
            modSettingFields: registry.getSettingFields({ includeTabbed: false }), modSettingTabs: registry.getSettingTabs()
        }) });
        if (pathname === '/api/settings/current') return route.fulfill({ json: { success: true, setting: profile } });
        if (pathname === '/api/settings') return route.fulfill({ json: { success: true, settings: [profile] } });
        if (pathname === '/api/settings/load' && method === 'POST') return route.fulfill({ json: { success: true } });
        if (pathname === '/api/settings/l08-world' && method === 'PUT') { profile = { ...profile, ...route.request().postDataJSON(), id: profile.id }; saves.push(structuredClone(profile)); return route.fulfill({ json: { success: true, setting: profile } }); }
        if (pathname.startsWith('/api/')) { if (method !== 'GET') blocked.push(`${method} ${pathname}`); return route.fulfill({ json: { success: true, workflows: [], presets: [], pending: false } }); }
        const file = path.resolve(PUBLIC, `.${pathname}`);
        if (file.startsWith(`${PUBLIC}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(file) });
        return route.fulfill({ status: 404, body: 'Not found' });
    });
    await page.goto(new globalThis.URL('/settings', URL).href, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#selectedEditBtn')).toBeEnabled();
    await page.locator('#selectedEditBtn').click();
    await page.locator('[data-editor-tab="mod-modules"]').click();
    await expect(page.locator('[data-module-slot-type-id]')).toHaveValue('unknown_slot');
    await expect(page.locator('[data-module-slot-type-label]')).toHaveValue('Unknown <slot>');
    await page.locator('[data-editor-tab="mod-spells"]').click();
    const costs = page.locator('[data-mod-setting-namespace="spells"][data-mod-setting-key="manaUsageBaseCosts"]');
    await expect(costs).toHaveValue(/"low": 0/);
    await costs.fill('{"low":0,"medium":12,"high":50}');
    await page.locator('#submitBtn').click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].modSettings.spells).toMatchObject({ manaNeedBarId: 'unknown_mana', manaUsageBaseCosts: { low: 0, medium: 12, high: 50 } });
    expect(saves[0].modSettings.modules.slotTypes).toEqual([{ id: 'unknown_slot', label: 'Unknown <slot>', description: '' }]);
    expect(saves[0].modSettings.hidden).toEqual({ untouched: false });
    expect(saves[0].modSettings.modules.hiddenValue).toEqual({ zero: 0, nil: null, empty: [], object: {} });
    expect(saves[0].modSettings.modules).not.toHaveProperty('applyPreset');
    expect(saves[0].modSettings['story-authoring'].defaultNotes).toBe('Notes <literal> & next');
    expect(blocked).toEqual([]);
    await page.evaluate(() => clearForm());
    await page.evaluate(() => { document.querySelector('[data-module-slot-type-id]').value = 'fresh'; document.querySelector('[data-module-slot-type-label]').value = 'Fresh'; });
    const freshSettings = await page.evaluate(() => collectModSettingsFromForm());
    expect(freshSettings).not.toHaveProperty('hidden');
    expect(freshSettings.modules).not.toHaveProperty('hiddenValue');
});
