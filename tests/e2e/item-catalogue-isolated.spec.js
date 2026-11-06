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
    await page.locator('#tab-story-tools-tab').click();
    expect(state.requests.filter(request => request === 'GET /api/item-catalogue')).toHaveLength(0);
    await page.locator('#storyToolsItemCatalogueTab').click();
    return state;
}

test('catalogue lazily reads, filters and inspects recorded and standard mechanics', async ({ page }) => {
    const state = await installFixture(page);
    await expect(page.locator('#itemCatalogueList [data-catalogue-id]')).toHaveCount(2);
    expect(state.requests.filter(request => request === 'GET /api/item-catalogue')).toHaveLength(1);
    await page.locator('#itemCatalogueSearch').fill('blue');
    await expect(page.locator('#itemCatalogueList [data-catalogue-id]')).toHaveCount(1);
    await page.locator('[data-catalogue-id="itemdef_lantern"]').click();
    const detail = page.locator('#itemCatalogueDetail');
    await expect(page.locator('#itemCatalogueBack')).toBeHidden();
    const heading = detail.locator('h4');
    await expect(heading).toHaveCSS('color', 'rgb(248, 250, 252)');
    await expect(heading).toHaveCSS('border-inline-start-color', 'rgb(32, 0, 255)');
    await expect(detail).toContainText('Recorded level');
    await expect(detail).toContainText('7');
    await expect(detail).toContainText('Recorded attribute bonuses');
    await expect(detail.locator('dd')).toHaveText(['7', '0', '0']);
    await expect(detail.getByRole('row', { name: 'Strength 0' })).toBeVisible();
    await expect(detail).toContainText('<script>unsafe()</script>');
    await expect(detail.locator('script')).toHaveCount(0);
    await page.locator('#itemCatalogueSearch').fill('');
    await page.locator('#itemCatalogueRarity').selectOption('common');
    await expect(page.locator('#itemCatalogueList [data-catalogue-id]')).toHaveCount(1);
    await expect(page.locator('#itemCatalogueList')).toContainText('Iron Ingot');
    await page.locator('#itemCatalogueRarity').selectOption('');
    await page.locator('[data-catalogue-mode="families"]').click();
    await page.locator('#itemCatalogueSearch').fill('refined');
    await page.locator('[data-catalogue-id="itemfamily_sword"]').click();
    await expect(detail).toContainText('A refined sword.');
    await page.locator('#itemCatalogueVariant [data-rarity="common"]').click();
    await expect(detail).toContainText('A simple sword.');
    await expect(detail).toContainText('Base attribute bonuses');
    await expect(detail).toContainText('scaled for level and rarity');
    await expect(detail.getByRole('row', { name: 'Strength +1' })).toBeVisible();
    await expect(detail).not.toContainText('Recorded level');
    await page.locator('#itemCatalogueVariant [data-rarity="rare"]').click();
    await expect(detail.getByRole('row', { name: 'Strength +3' })).toBeVisible();
    await expect(detail).toContainText('Burn');
    await expect(detail).toContainText('10');
    await page.locator('#itemCatalogueTitle').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tmp/item-catalogue-desktop.png', fullPage: true });
    await detail.getByText('Definition details').scrollIntoViewIfNeeded();
    await expect(detail.getByText('Definition details')).toBeInViewport();
    expect(state.writes).toEqual([]);
    expect(state.external).toEqual([]);
    expect(state.errors).toEqual([]);
    await page.screenshot({ path: 'tmp/item-catalogue-desktop-scrolled.png', fullPage: true });
});

test('phone drilldown, keyboard and refresh use only isolated reads', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await installFixture(page);
    await page.locator('[data-catalogue-id="itemdef_lantern"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#itemCatalogueDetail')).toContainText('Blue Lantern');
    await expect(page.locator('#itemCatalogueBack')).toBeVisible();
    await page.screenshot({ path: 'tmp/item-catalogue-mobile.png', fullPage: true });
    await page.locator('#itemCatalogueBack').click();
    await expect(page.locator('[data-catalogue-id="itemdef_lantern"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-catalogue-id="itemdef_lantern"]')).toBeFocused();
    await page.keyboard.press('/');
    await expect(page.locator('#itemCatalogueSearch')).toBeFocused();
    await page.locator('[data-catalogue-id="itemdef_lantern"]').evaluate(button => { window.fixtureOldCatalogueItem = button; });
    state.catalogue = { ...structuredClone(fixtureData), generation: 2, definitions: [] };
    await page.locator('#itemCatalogueRefresh').click();
    await expect(page.locator('#itemCatalogueStatus')).toContainText('No item definitions');
    await page.evaluate(() => window.fixtureOldCatalogueItem.click());
    await expect(page.locator('#itemCatalogueList [data-catalogue-id]')).toHaveCount(0);
    expect(state.requests.filter(request => request === 'GET /api/item-catalogue')).toHaveLength(2);
    expect(state.writes).toEqual([]);
    expect(state.external).toEqual([]);
    expect(state.errors).toEqual([]);
});

test('catalogue errors expose the server message and refresh recovers', async ({ page }) => {
    const state = await installFixture(page);
    await expect(page.locator('#itemCatalogueList [data-catalogue-id]')).toHaveCount(2);
    state.failure = { status: 500, json: { success: false, error: 'Catalogue fixture failure', stack: 'Error: Catalogue fixture failure\n    at fixture' } };
    await page.locator('#itemCatalogueRefresh').click();
    await expect(page.locator('#itemCatalogueStatus')).toContainText('Catalogue fixture failure');
    const dialog = page.getByRole('dialog', { name: 'Operation stopped' });
    await expect(dialog).toContainText('Catalogue fixture failure');
    await expect(dialog).toContainText('at fixture');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.locator('[data-catalogue-mode="families"]').click();
    await expect(page.locator('#itemCatalogueBrowser')).toBeHidden();
    await expect(page.locator('#itemCatalogueList [data-catalogue-id]')).toHaveCount(0);
    state.failure = null;
    await page.locator('#itemCatalogueRefresh').click();
    await expect(page.locator('#itemCatalogueList [data-catalogue-id]')).toHaveCount(1);
    expect(state.writes).toEqual([]);
});

test('loading state is visible while catalogue read is pending', async ({ page }) => {
    const state = await installFixture(page, { holdCatalogue: true });
    await expect(page.locator('#itemCatalogueStatus')).toContainText('Loading');
    await expect(page.locator('#itemCatalogueRefresh')).toBeDisabled();
    await expect(page.locator('#itemCatalogueSearch')).toBeDisabled();
    await expect(page.locator('[data-catalogue-mode="families"]')).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    state.release();
    await expect(page.locator('#itemCatalogueList [data-catalogue-id]')).toHaveCount(2);
    await expect(page.locator('#itemCatalogueRefresh')).toBeEnabled();
    await expect(page.locator('#itemCatalogue').getByRole('button', { name: /generate|create|craft/i })).toHaveCount(0);
    expect(state.writes).toEqual([]);
});

test('final pagehide discards an in-flight catalogue read', async ({ page }) => {
    const state = await installFixture(page, { holdCatalogue: true });
    await expect(page.locator('#itemCatalogueStatus')).toContainText('Loading');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    const before = await page.locator('#itemCatalogueList').innerHTML();
    state.release(); await page.waitForTimeout(100);
    expect(await page.locator('#itemCatalogueList').innerHTML()).toBe(before);
    expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

test('narrow phone layout has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await installFixture(page);
    await expect(page.locator('#itemCatalogueList [data-catalogue-id]')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator('#itemCatalogueFilters').evaluate(el => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await page.locator('[data-catalogue-id="itemdef_lantern"]').click();
    await expect(page.locator('#itemCatalogueBack')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'tmp/item-catalogue-mobile-320.png', fullPage: true });
});
