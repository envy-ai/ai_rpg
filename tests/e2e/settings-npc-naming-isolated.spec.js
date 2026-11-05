const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '../..');
const origin = 'http://0.0.0.0:4173';
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(root, 'views')), { autoescape: true });

test('world editor saves, reloads, and clears NPC naming guidance', async ({ page }) => {
    let profile = { id: 'isolated-world', name: 'Isolated World', theme: 'Fantasy', genre: 'Adventure', hidingAttribute: 'dexterity', perceptionAttribute: 'wisdom', npcNamingGuidance: 'Existing moon names', calendarDefinition: { yearName: 'Fixture Era', months: [{ name: 'Dawn', lengthDays: 30 }], weekdays: ['Firstday'], seasons: [], holidays: [] } };
    const saves = [];
    const blocked = [];
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        const pathname = decodeURIComponent(url.pathname);
        const method = route.request().method();
        if (pathname === '/settings') return route.fulfill({ contentType: 'text/html', body: env.render('settings.njk', {
            title: 'World Profiles', unifiedTonalScaleDefinition: {}, unifiedTonalScaleError: '',
            attributeOptions: [{ name: 'dexterity', label: 'Dexterity' }, { name: 'wisdom', label: 'Wisdom' }]
        }) });
        if (pathname === '/api/settings/current') return route.fulfill({ json: { success: true, setting: profile } });
        if (pathname === '/api/settings') return route.fulfill({ json: { success: true, settings: [profile] } });
        if (pathname === '/api/settings/load' && method === 'POST') return route.fulfill({ json: { success: true } });
        if (pathname === '/api/settings/isolated-world' && method === 'PUT') {
            profile = { ...profile, ...route.request().postDataJSON(), id: profile.id };
            saves.push(profile.npcNamingGuidance);
            return route.fulfill({ json: { success: true, setting: profile } });
        }
        if (pathname === '/api/settings/isolated-world/save' && method === 'POST') return route.fulfill({ json: { success: true } });
        if (pathname === '/api/settings/isolated-world/apply' && method === 'POST') return route.fulfill({ json: { success: true, setting: profile } });
        if (method === 'GET' && ['/api/comfyui/workflow-options', '/api/image-workflow-presets', '/api/pending-load'].includes(pathname)) {
            return route.fulfill({ json: { success: true, workflows: [], presets: [], pending: false } });
        }
        if (pathname.startsWith('/api/')) { blocked.push(`${method} ${pathname}`); return route.fulfill({ status: 404, json: { success: false } }); }
        const asset = path.resolve(root, 'public', `.${pathname}`);
        if (asset.startsWith(path.join(root, 'public') + path.sep) && fs.existsSync(asset) && fs.statSync(asset).isFile()) {
            const type = pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream';
            return route.fulfill({ contentType: type, body: fs.readFileSync(asset) });
        }
        return route.fulfill({ status: 404, body: 'Not found' });
    });
    await page.goto(`${origin}/settings`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#settingsCalendarYearName')).toHaveValue('Fixture Era');
    await expect(page.locator('.settings-calendar-month-row')).toHaveCount(1);
    await expect(page.getByText(/Could not load current setting:/)).toHaveCount(0);
    await expect(page.locator('#selectedEditBtn')).toBeEnabled();
    await page.locator('#selectedEditBtn').click();
    await page.locator('[data-editor-tab="prompts"]').click();
    const field = page.getByLabel('NPC Naming Guidance');
    await expect(field).toHaveValue('Existing moon names');
    await field.fill('Names from the stars\nNo titles');
    await page.locator('#submitBtn').click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toBe('Names from the stars\nNo titles');
    await page.reload();
    await expect(page.locator('#selectedEditBtn')).toBeEnabled();
    await page.locator('#selectedEditBtn').click();
    await page.locator('[data-editor-tab="prompts"]').click();
    await expect(field).toHaveValue('Names from the stars\nNo titles');
    await field.fill('');
    await page.locator('#submitBtn').click();
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1]).toBe('');
    await page.reload();
    await expect(page.locator('#selectedEditBtn')).toBeEnabled();
    await page.locator('#selectedEditBtn').click();
    await page.locator('[data-editor-tab="prompts"]').click();
    await expect(field).toHaveValue('');
    profile.calendarDefinition = { yearName: 'Fixture Era', months: [{ name: 'Dawn', lengthDays: 30, seasonName: 'Missing season' }], weekdays: ['Firstday'], seasons: [], holidays: [] };
    await page.reload();
    await expect(page.locator('#selectedEditBtn')).toBeEnabled();
    await page.locator('#selectedEditBtn').click();
    await page.locator('[data-editor-tab="calendar"]').click();
    await expect(page.locator('.settings-calendar-month-season option:checked')).toHaveText('Missing season (missing)');
    await page.locator('#submitBtn').click();
    await expect(page.locator('#settingsCalendarStatus')).toContainText('references a missing season');
    expect(saves).toHaveLength(2);
    await page.locator('#settingsCalendarClearBtn').click();
    await page.locator('#submitBtn').click();
    await expect.poll(() => saves.length).toBe(3);
    expect(profile.calendarDefinition).toBeNull();
    expect(blocked).toEqual([]);
});
