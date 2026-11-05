'use strict';

const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '../..');
const ORIGIN = 'http://127.0.0.1:4173';
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(ROOT, 'views')), { autoescape: true });
const rarities = [
    { key: 'common', label: 'Common', prevalence: 100 },
    { key: 'rare', label: 'Rare', prevalence: 10, color: '#2000ff' }
];
const fixtureData = {
    success: true, generation: 1, rarityDefinitions: rarities,
    definitions: [
        { id: 'itemdef_lantern', reusable: false, blueprint: { name: 'Blue Lantern', description: 'A glass lantern <script>unsafe()</script>.', thingType: 'item', rarity: 'rare', level: 7, value: 0, weight: 0, attributeBonuses: [{ attribute: 'strength', bonus: 0 }] } },
        { id: 'itemdef_ingot', reusable: false, blueprint: { name: 'Iron Ingot', description: 'A dull bar.', thingType: 'item', rarity: 'common', level: 2 } }
    ],
    families: [{ id: 'itemfamily_sword', name: 'Iron Sword', minimumRarity: 'common', maximumRarity: 'rare', rarities: ['common', 'rare'], variants: [
        { name: 'Iron Sword', itemOrScenery: 'item', rarity: 'common', description: 'A simple sword.', unscaledAttributeBonuses: [{ attribute: 'strength', bonus: 1 }] },
        { name: 'Iron Sword', itemOrScenery: 'item', rarity: 'rare', description: 'A refined sword.', causeStatusEffectOnTarget: { name: 'Burn', description: 'Burns the target.', duration: 10 }, unscaledAttributeBonuses: [{ attribute: 'strength', bonus: 3 }] }
    ] }]
};

async function installFixture(page, { holdCatalogue = false } = {}) {
    const state = { requests: [], writes: [], external: [], errors: [], catalogue: structuredClone(fixtureData), failure: null };
    if (holdCatalogue) state.gate = new Promise(resolve => { state.release = resolve; });
    page.on('pageerror', error => state.errors.push(error.stack || error.message));
    await page.addInitScript(() => {
        window.WebSocket = class extends EventTarget { constructor() { super(); this.readyState = 1; } send() {} close() {} };
    });
    await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== ORIGIN) {
            if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) state.external.push(url.href);
            return route.abort();
        }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: env.render('index.njk', {
            title: 'Catalogue fixture', currentPage: 'chat', characterPortraitWidth: 3, characterPortraitHeight: 4,
            clientMessageHistory: { maxMessages: 100, pruneTo: 80 }, currentSetting: {}, gameLoaded: true,
            availableSkills: [], thingImageBadges: [], thingContextActions: [], thingEditFields: [], playerEditFields: [],
            rarityDefinitions: rarities, needBarDefinitions: [], pointPoolFormulas: {}
        }) });
        if (url.pathname.startsWith('/api/')) {
            state.requests.push(`${request.method()} ${url.pathname}`);
            if (url.pathname === '/api/things/gun/reload-options') return route.fulfill({ json: { success: true, actorId: 'player', itemId: 'gun', chargePool: { mode: 'discrete', amount: 1, capacity: 5, unit: 'rounds', ammoType: 'round' }, capacityAvailable: 4, sources: [{ id: 'ammo', name: 'Rounds', count: 3, ammoType: 'round', amount: 3 }] } });
            if (url.pathname === '/api/things/gun/reload' && request.method() === 'POST') { state.writes.push(request.postDataJSON()); if (state.postGate) await state.postGate; if (state.postFailure) { state.postFailure = false; return route.fulfill({ status: 400, json: { success: false, error: 'Temporary failure', stack: 'Error: Temporary failure\n    at fixture' } }); } return route.fulfill({ json: { success: true, receipt: {}, inventory: [], item: {} } }); }
            if (request.method() !== 'GET') {
                state.writes.push(`${request.method()} ${url.pathname}`);
                return route.fulfill({ status: 405, json: { success: false, error: 'Writes are disabled in this fixture.' } });
            }
            if (url.pathname === '/api/item-catalogue') {
                if (state.gate) await state.gate;
                return route.fulfill(state.failure || { json: state.catalogue });
            }
            if (url.pathname === '/api/player/ability-selection') return route.fulfill({ json: { success: true, abilitySelection: { pending: false } } });
            return route.fulfill({ json: { success: true, attributes: {}, history: [], player: { quests: [], completedQuests: [] }, routeKnowledge: [] } });
        }
        const root = path.join(ROOT, url.pathname.startsWith('/assets/') ? 'assets' : 'public');
        const relative = url.pathname.startsWith('/assets/') ? url.pathname.slice('/assets'.length) : url.pathname;
        const file = path.resolve(root, `.${decodeURIComponent(relative)}`);
        if (file.startsWith(`${root}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
            return route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        }
        return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    return state;
}

test('reload dialog selects ammunition and submits an exact checked transfer', async ({ page }) => {
    const state = await installFixture(page);
    await page.evaluate(() => window.AIRPG_ITEM_CHARGES.openReload({ id: 'gun', name: 'Pistol', chargePool: { mode: 'discrete', amount: 1, capacity: 5, unit: 'rounds', ammoType: 'round' } }));
    const dialog = page.locator('#itemChargeReloadDialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-ammo-id="ammo"]').click();
    await expect(page.locator('#itemChargeReloadPreview')).toContainText('4 / 5');
    await page.screenshot({ path: 'tmp/item-charge-desktop.png' });
    await page.locator('#itemChargeReloadAmount').fill('5');
    await expect(page.locator('#itemChargeReloadSubmit')).toBeDisabled();
    await page.locator('#itemChargeReloadAmount').fill('2');
    await page.locator('#itemChargeReloadSubmit').click();
    await expect(dialog).toBeHidden();
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toMatchObject({ ammoItemId: 'ammo', amount: 2 });
    expect(state.writes[0].operationId).toBeTruthy();
    expect(state.errors).toEqual([]);
});

test('keyboard retry keeps operation identity, blocks editing while pending, and closes on success', async ({ page }) => {
    const state = await installFixture(page);
    state.postFailure = true;
    state.postGate = new Promise(resolve => { state.releasePost = resolve; });
    await page.evaluate(() => window.AIRPG_ITEM_CHARGES.openReload({ id: 'gun', name: 'Pistol', chargePool: { mode: 'discrete', amount: 1, capacity: 5, unit: 'rounds', ammoType: 'round' } }));
    await page.locator('#itemChargeReloadSources [data-ammo-id="ammo"]').click();
    await page.locator('#itemChargeReloadAmount').focus();
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(page.locator('#itemChargeReloadAmount')).toBeDisabled();
    await expect(page.locator('#itemChargeReloadSearch')).toBeDisabled();
    await expect(page.locator('#itemChargeReloadCancel')).toBeDisabled();
    state.releasePost();
    await expect(page.locator('#itemChargeReloadStatus')).toContainText('Temporary failure');
    await expect(page.locator('#itemChargeReloadStatus')).toContainText('at fixture');
    await expect(page.locator('#itemChargeReloadAmount')).toBeEnabled();
    state.postGate = null;
    await page.getByRole('dialog', { name: 'Operation stopped' }).getByRole('button', { name: 'Close' }).click();
    await page.locator('#itemChargeReloadSubmit').click();
    await expect(page.locator('#itemChargeReloadDialog')).toBeHidden();
    expect(state.writes).toHaveLength(2);
    expect(state.writes[1]).toEqual(state.writes[0]);
    await page.evaluate(() => window.AIRPG_ITEM_CHARGES.openReload({ id: 'gun', name: 'Pistol', chargePool: { mode: 'discrete', amount: 1, capacity: 5, unit: 'rounds', ammoType: 'round' } }));
    await expect(page.locator('#itemChargeReloadCancel')).toBeEnabled();
    await page.locator('#itemChargeReloadCancel').click();
    await expect(page.locator('#itemChargeReloadDialog')).toBeHidden();
});

test.describe('touch reload dialog', () => {
    test.use({ hasTouch: true });
    for (const width of [320, 390]) test(`reload dialog fits and remains tappable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await installFixture(page);
    await page.evaluate(() => window.AIRPG_ITEM_CHARGES.openReload({ id: 'gun', name: 'Pistol', chargePool: { mode: 'discrete', amount: 1, capacity: 5, unit: 'rounds', ammoType: 'round' } }));
    await page.locator('#itemChargeReloadSources [data-ammo-id="ammo"]').tap();
    await expect(page.locator('#itemChargeReloadSubmit')).toBeEnabled();
    const overflow = await page.locator('#itemChargeReloadDialog').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
    expect(overflow.left).toBeGreaterThanOrEqual(0);
    expect(overflow.right).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `tmp/item-charge-phone-${width}.png` });
    });
});

test('native owned inventory card opens reload from its context menu', async ({ page }) => {
    const state = await installFixture(page);
    await page.evaluate(() => {
        const thing = { id: 'gun', name: 'Pistol', description: 'A pistol.', thingType: 'item', chargePool: { mode: 'discrete', amount: 1, capacity: 5, unit: 'rounds', ammoType: 'round' } };
        cacheThingData(thing);
        const built = buildThingCollectionEntry(thing, { viewMode: 'grid', enableTooltip: false, contextMenuOptions: { context: 'container-player-inventory' } });
        document.body.append(built.card);
    });
    const card = page.locator('.thing-collection-entry[data-thing-id="gun"]');
    await card.locator('.thing-card-menu-button').click();
    await page.locator('.item-charge-reload-action').click();
    await expect(page.locator('#itemChargeReloadDialog')).toBeVisible();
    await expect(page.locator('#itemChargeReloadSources [data-ammo-id="ammo"]')).toBeVisible();
    expect(state.requests).toContain('GET /api/things/gun/reload-options');
});

test('rapid reload reopen retains the latest request across the native close event', async ({ page }) => {
    const state = await installFixture(page);
    await page.evaluate(async () => {
        const base = { id: 'gun', chargePool: { mode: 'discrete', amount: 1, capacity: 5, unit: 'rounds', ammoType: 'round' } };
        await window.AIRPG_ITEM_CHARGES.openReload({ ...base, name: 'First' });
        const middle = window.AIRPG_ITEM_CHARGES.openReload({ ...base, name: 'Middle' });
        const latest = window.AIRPG_ITEM_CHARGES.openReload({ ...base, name: 'Latest' });
        await Promise.all([middle, latest]);
    });
    await expect(page.locator('#itemChargeReloadDialog')).toHaveJSProperty('open', true);
    await expect(page.locator('#itemChargeReloadDialog')).toContainText('Reload Latest');
    await expect(page.locator('#itemChargeReloadSources [data-ammo-id="ammo"]')).toBeVisible();
    expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});
