'use strict';
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');
const ROOT = path.resolve(__dirname, '../..');
const ORIGIN = 'http://127.0.0.1:4173';
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(ROOT, 'views')), { autoescape: true });

test('actual route inspector preserves native steps, hidden-safe refusal and explicit travel', async ({ page }) => {
    const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.addInitScript(() => { window.WebSocket = class extends EventTarget { constructor() { super(); this.readyState = 1; } send() {} close() {} }; });
    await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== ORIGIN) return route.abort();
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: env.render('index.njk', {
            title: 'Route fixture', currentPage: 'chat', characterPortraitWidth: 3, characterPortraitHeight: 4,
            clientMessageHistory: { maxMessages: 100, pruneTo: 80 }, currentSetting: {}, gameLoaded: true,
            availableSkills: [], thingImageBadges: [], thingContextActions: [], thingEditFields: [], playerEditFields: [],
            rarityDefinitions: [], needBarDefinitions: [], pointPoolFormulas: {}
        }) });
        if (url.pathname.startsWith('/api/')) {
            requests.push({ method: request.method(), path: url.pathname, search: url.search, body: request.postData() });
            if (url.pathname === '/api/factions') return route.fulfill({ json: { success: true, factions: [{ id: 'faction-old', name: 'Old Watch' }, { id: 'faction-new', name: 'New <Watch>', homeRegionName: 'Ward & Field', reputationTiers: [{ threshold: 0, label: 'Neutral' }] }], playerStandings: { 'faction-new': 0 } } });
            if (url.pathname === '/api/player/fast-travel-preview') {
                const id = url.searchParams.get('destinationId');
                const origin = { id: 'origin', name: 'Old Gate', regionId: 'r', regionName: 'Ward' };
                const destination = { id, name: id === 'blocked' ? 'Fogbound' : 'Garden <literal>', regionId: 'r', regionName: 'Ward', visited: id !== 'blocked', isStub: false };
                const steps = [
                    { exitId: 'exit-1', fromLocationId: 'origin', fromLocationName: 'Old Gate', toLocationId: 'middle', toLocationName: 'Wall', description: 'A <narrow> stair & wall.', travelTimeMinutes: 0, isVehicle: false, vehicleType: null, destinationIsStub: false },
                    { exitId: 'exit-2', fromLocationId: 'middle', fromLocationName: 'Wall', toLocationId: 'destination', toLocationName: 'Garden <literal>', description: 'Ferry across.', travelTimeMinutes: 12, isVehicle: true, vehicleType: 'ferry', destinationIsStub: false }
                ];
                return route.fulfill({ json: id === 'blocked' ? { success: true, origin, destination, reachable: false, canFastTravel: false, blockingReason: { code: 'NO_KNOWN_ROUTE', message: 'No known route is currently available.' }, travelTimeMinutes: null, steps: [] } : { success: true, origin, destination, reachable: true, canFastTravel: true, blockingReason: null, travelTimeMinutes: 12, steps } });
            }
            if (request.method() !== 'GET') return route.fulfill({ status: 405, json: { error: 'Fixture blocks writes' } });
            if (url.pathname === '/api/location-region-membership-conflicts') return route.fulfill({ json: { success: true, conflicts: [] } });
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
    await page.waitForFunction(() => Boolean(window.AIRPG_CHAT));
    await page.evaluate(async () => {
        window.guardPendingPlayerAbilitySelection = () => false;
        window.currentPlayerData = { id: 'player-exact', name: 'Rook' };
        window.renderEntityImage = async ({ element }) => { element.textContent = 'Icon'; };
        await window.updateLocationDisplay({ id: 'origin', name: 'Old Gate', description: 'Gate.', shortDescription: 'Gate.', regionName: 'Ward', visited: true, npcs: [], things: [], thingIds: [], exits: {
            east: { id: 'visible-1', destination: 'destination', destinationName: 'Garden <literal>', destinationVisited: true, travelTimeMinutes: 12 },
            west: { id: 'visible-2', destination: 'blocked', destinationName: 'Fogbound', destinationVisited: false, travelTimeMinutes: 0 }
        } });
        window.routeCalls = [];
        window.AIRPG_CHAT.dispatchAutomatedMessage = async (text, options) => { window.routeCalls.push({ text, options }); return { eventsSkipped: true }; };
    });
    const modal = page.locator('#mapFastTravelConfirmModal');
    await page.evaluate(() => { window.openMapRouteInspector('destination'); });
    await expect(modal).toBeVisible();
    const steps = page.locator('#mapFastTravelRouteSteps');
    await expect(steps.locator(':scope > li')).toHaveCount(2);
    await expect(steps.locator(':scope > li').nth(0)).toContainText('Old Gate → Wall');
    await expect(steps.locator(':scope > li').nth(0)).toContainText('0 hours, 0 minutes');
    await expect(steps.locator(':scope > li').nth(0)).toContainText('A <narrow> stair & wall.');
    await expect(steps.locator('narrow')).toHaveCount(0);
    await expect(steps.locator(':scope > li').nth(1)).toContainText('Wall → Garden <literal>');
    await expect(steps.locator(':scope > li').nth(1)).toContainText('Vehicle: ferry');
    await page.locator('#mapFastTravelActionText').fill(' Cancelled prose ');
    await page.locator('#mapFastTravelCancelBtn').click();
    expect(await page.evaluate(() => window.routeCalls)).toEqual([]);
    await page.evaluate(() => { window.openMapRouteInspector('blocked'); });
    await expect(modal).toBeVisible();
    await expect(page.locator('#mapFastTravelBlockingReason')).toHaveText('No known route is currently available.');
    await expect(page.locator('#mapFastTravelConfirmBtn')).toBeDisabled();
    await expect(page.locator('#mapFastTravelRouteSection')).toBeHidden();
    await expect(page.locator('#mapFastTravelActionGroup')).toBeHidden();
    await page.locator('#mapFastTravelCancelBtn').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { window.openMapRouteInspector('destination'); });
    await expect(modal).toBeVisible();
    await expect(page.locator('#mapFastTravelActionText')).toHaveValue('');
    await page.locator('#mapFastTravelActionText').fill('  Walk carefully.  ');
    await page.locator('#mapFastTravelConfirmBtn').click();
    await expect.poll(() => page.evaluate(() => window.routeCalls.length)).toBe(1);
    expect(await page.evaluate(() => window.routeCalls[0])).toMatchObject({ text: 'Walk carefully.', options: { travel: true, travelMetadata: { mode: 'fast-travel', exit: { originLocationId: 'origin', destinationId: 'destination', destinationName: 'Garden <literal>', regionName: 'Ward' } } } });
    expect(requests.filter(r => r.path === '/api/player/fast-travel-preview').map(r => new URLSearchParams(r.search).get('destinationId'))).toEqual(['destination', 'blocked', 'destination']);
    expect(requests.filter(r => r.method !== 'GET' && r.path !== '/api/images/request')).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
        document.querySelector('#tab-map').hidden = false;
        const host = document.querySelector('#mapContainer');
        window.oldFactionEmblem = window.attachFactionEmblem(host, { factionId: 'faction-old', variant: 'region-map' });
    });
    await expect(page.locator('#mapContainer > .faction-emblem')).toHaveAttribute('aria-label', 'Old Watch faction information');
    await page.evaluate(() => window.attachFactionEmblem(document.querySelector('#mapContainer'), { factionId: 'faction-new', variant: 'region-map' }));
    const emblem = page.locator('#mapContainer > .faction-emblem');
    await expect(emblem).toHaveAttribute('data-faction-id', 'faction-new');
    await expect(emblem).toHaveClass(/faction-emblem--region-map/);
    await expect(emblem).toHaveAttribute('aria-label', 'New <Watch> faction information');
    await emblem.focus();
    const tooltip = page.locator('#inventoryTooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('New <Watch>');
    await expect(tooltip).toContainText('Ward & Field');
    await expect(tooltip).toContainText('Neutral (0)');
    await expect(tooltip.locator('watch')).toHaveCount(0);
    await page.evaluate(() => window.oldFactionEmblem.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true })));
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('New <Watch>');
    await page.evaluate(() => window.oldFactionEmblem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })));
    await expect(tooltip).toContainText('New <Watch>');
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    expect(errors).toEqual([]);
});

test('vehicle overlay helpers preserve IDs, position following and world visibility', async ({ page }) => {
    await page.setContent('<!doctype html><title>Vehicle overlay fixture</title>');
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/vehicle-overlay.js') });
    const result = await page.evaluate(() => {
        const records = [];
        const makeNode = (id, position, display = 'element', overlay = false) => ({
            id: () => id, empty: () => false, hasClass: name => overlay && name === 'vehicle-overlay',
            data: key => key === 'targetId' ? id.replace(/^region-vehicle-/, '') : null,
            style: (key, value) => { if (value !== undefined) { display = value; records.push([id, key, value]); } return display; },
            position: value => { if (value) { position = value; records.push([id, 'position', value]); } return position; },
            unlock: () => records.push([id, 'unlock']), lock: () => records.push([id, 'lock'])
        });
        const target = makeNode('loc-1', { x: 4, y: 7 });
        const hidden = makeNode('loc-2', { x: 8, y: 9 }, 'none');
        const overlay = makeNode('region-vehicle-loc-1', { x: 0, y: 0 }, 'element', true);
        const hiddenOverlay = makeNode('region-vehicle-loc-2', { x: 0, y: 0 }, 'element', true);
        const nodes = new Map([target, hidden, overlay, hiddenOverlay].map(n => [n.id(), n]));
        let follower, selector;
        const cy = { nodes: () => [overlay, hiddenOverlay], getElementById: id => nodes.get(id), on: (event, selected, fn) => { selector = [event, selected]; follower = fn; } };
        const region = window.VehicleOverlay.createHelpers('region-vehicle-', { respectTargetVisibility: true });
        const world = window.VehicleOverlay.createHelpers('world-vehicle-');
        region.syncVehicleOverlayPositions(cy);
        region.attachVehicleOverlayPositionFollower(cy, { selector: 'node.location', ignoreOverlayClass: true });
        target.position({ x: 20, y: 30 }); follower({ target }); follower({ target: overlay });
        return { regionId: region.getVehicleOverlayNodeId('loc-1'), worldId: world.getVehicleOverlayNodeId('loc-1'), selector, records };
    });
    expect(result.regionId).toBe('region-vehicle-loc-1');
    expect(result.worldId).toBe('world-vehicle-loc-1');
    expect(result.selector).toEqual(['position', 'node.location']);
    expect(result.records).toContainEqual(['region-vehicle-loc-1', 'position', { x: 4, y: 7 }]);
    expect(result.records).toContainEqual(['region-vehicle-loc-2', 'display', 'none']);
    expect(result.records).not.toContainEqual(['region-vehicle-loc-2', 'position', { x: 8, y: 9 }]);
    expect(result.records.filter(row => row[0] === 'region-vehicle-loc-1' && row[1] === 'position')).toEqual([
        ['region-vehicle-loc-1', 'position', { x: 4, y: 7 }], ['region-vehicle-loc-1', 'position', { x: 20, y: 30 }]
    ]);
});
