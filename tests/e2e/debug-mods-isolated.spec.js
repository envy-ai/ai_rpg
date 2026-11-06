const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../..'), origin = 'http://debug-mods-fixture.test';
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(root, 'views')), { autoescape: true });

async function install(page, type) {
    const state = { errors: [], calls: [], bodies: [], mods: [{ name: 'alpha', configuredEnabled: true, activeEnabled: false, hasModJs: true, hasDefsDir: false, restartRequired: true }] };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), pathname = decodeURIComponent(url.pathname);
        if (url.origin !== origin) return route.abort();
        if (pathname === `/${type}`) return route.fulfill({ contentType: 'text/html', body: env.render(`${type}.njk`, { title: type, currentPage: type, modState: { mods: state.mods, restartRequired: true }, player: {}, playerStatus: {}, playerJson: {}, allPlayers: [], allLocations: [], currentSetting: {}, allSettings: [], gameWorld: {}, gameWorldCounts: {} }) });
        if (pathname.startsWith('/api/')) {
            state.calls.push(`${request.method()} ${pathname}`);
            if (request.method() !== 'GET') state.bodies.push(request.postDataJSON());
            if (pathname === '/api/images') return route.fulfill({ json: { success: true, images: [{ prompt: 'Fixture image', width: 512, height: 512, seed: 0, images: [{ url: '/fixture.png' }] }] } });
            if (pathname === '/api/generate-image') { state.jobs = (state.jobs || 0) + 1; return route.fulfill({ json: { success: true, jobId: `job-${state.jobs}`, message: 'Queued' } }); }
            if (pathname.startsWith('/api/jobs/job-')) { state.jobReads = (state.jobReads || 0) + 1; if (state.holdJob) await new Promise(resolve => { state.releaseJob = resolve; }); const complete = state.jobReads % 2 === 0; return route.fulfill({ json: { success: true, job: { status: complete ? 'completed' : 'running', progress: complete ? 100 : 0, message: 'Fixture', createdAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z' }, result: { images: [{ url: '/fixture.png' }] } } }); }
            if (pathname === '/api/saves') return route.fulfill({ json: { success: true, count: 1, saves: [{ saveName: 'fixture-save', playerName: 'Hero', playerLevel: 2, timestamp: '2026-01-01' }] } });
            if (pathname === '/api/save/fixture-save') return route.fulfill({ status: 500, json: { success: false, error: 'Fixture delete failed', stack: 'Error: Fixture delete failed\n    at debug-fixture:42' } });
            if (pathname === '/api/mods/manager') { const snapshot = structuredClone(state.mods); if (state.holdMods) await new Promise(resolve => { state.releaseMods = resolve; }); return route.fulfill({ json: { success: true, modState: { mods: snapshot, restartRequired: true } } }); }
            if (pathname === '/api/mods/enabled') return route.fulfill({ json: { success: true, modState: { mods: state.mods, restartRequired: true }, restartRequired: true } });
            return route.fulfill({ json: { success: true, pendingLoad: null } });
        }
        const base = pathname.startsWith('/assets/') ? path.join(root, 'assets') : path.join(root, 'public');
        const file = path.resolve(base, `.${pathname.startsWith('/assets/') ? pathname.slice(7) : pathname}`);
        if (file.startsWith(`${base}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(file) });
        return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${origin}/${type}`); return state;
}

test('Debug recent image and save cards release stale actions and report original error', async ({ page }) => {
    const state = await install(page, 'debug'); page.on('dialog', dialog => dialog.accept());
    const recent = page.locator('#recentImages [role=button]'); await expect(recent).toHaveCount(1);
    await recent.focus(); await page.keyboard.press('Enter'); await expect(page.locator('#prompt')).toHaveValue('Fixture image');
    await page.locator('#loadSavesBtn').click(); const card = page.locator('#savesList > div'); await expect(card).toHaveCount(1);
    await card.getByRole('button', { name: /Delete/ }).evaluate(button => { window.fixtureOldDebugDelete = button; });
    await page.locator('#loadSavesBtn').click(); await expect.poll(() => state.calls.filter(value => value === 'GET /api/saves').length).toBe(2);
    await expect.poll(() => page.evaluate(() => window.fixtureOldDebugDelete.isConnected)).toBe(false);
    await page.evaluate(() => window.fixtureOldDebugDelete.click()); expect(state.calls.filter(value => value.startsWith('DELETE'))).toHaveLength(0);
    await card.getByRole('button', { name: /Delete/ }).click();
    await expect(page.getByRole('dialog', { name: 'Operation stopped' })).toContainText('debug-fixture:42');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.locator('#loadSavesBtn').click(); await expect.poll(() => state.calls.filter(value => value === 'GET /api/saves').length).toBe(3);
    await page.locator('#savesList button').first().evaluate(button => { window.fixtureLastSave = button; });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await page.evaluate(() => window.fixtureLastSave.click()); expect(state.calls.filter(value => value === 'POST /api/load')).toHaveLength(0);
    expect(state.errors).toEqual([]);
});

test('Debug image jobs display zero progress and append completed results', async ({ page }) => {
    const state = await install(page, 'debug');
    const form = page.locator('#imageGenForm'); await page.locator('#prompt').fill('First image');
    await form.locator('button[type=submit]').click();
    await expect(page.locator('#imageGenStatus')).toContainText('0%');
    await expect(page.locator('#imageGenResults a')).toHaveCount(1, { timeout: 7000 });
    await page.locator('#imageGenResults > div').first().evaluate(element => { window.fixtureFirstResult = element; });
    await page.locator('#prompt').fill('Second image'); await form.locator('button[type=submit]').click();
    await expect(page.locator('#imageGenResults a')).toHaveCount(2, { timeout: 7000 });
    expect(await page.locator('#imageGenResults > div').first().evaluate(element => element === window.fixtureFirstResult)).toBe(true);
    await expect(page.locator('#imageGenResults a').first()).toHaveAttribute('href', '/fixture.png');
    expect(state.errors).toEqual([]);
});

test('Debug final hide ignores a held job response and does not reschedule', async ({ page }) => {
    const state = await install(page, 'debug'); state.holdJob = true;
    await page.locator('#prompt').fill('Pending image'); await page.locator('#imageGenForm button[type=submit]').click();
    await expect.poll(() => Boolean(state.releaseJob)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    const status = await page.locator('#imageGenStatus').innerText(); state.releaseJob(); await page.waitForTimeout(2200);
    expect(await page.locator('#imageGenStatus').innerText()).toBe(status); expect(state.jobReads).toBe(1);
    await expect(page.locator('#imageGenResults a')).toHaveCount(0); expect(state.errors).toEqual([]);
});

test('Mod Manager preserves explicit selection and releases replaced controls', async ({ page }) => {
    const state = await install(page, 'mods');
    const checkbox = page.locator('[data-mod-enabled-checkbox]'); await expect(checkbox).toBeChecked();
    await checkbox.evaluate(element => { window.fixtureOldMod = element; });
    await page.locator('#mods-refresh-button').click(); await expect.poll(() => state.calls.filter(value => value === 'GET /api/mods/manager').length).toBe(1);
    await expect.poll(() => page.evaluate(() => window.fixtureOldMod.isConnected)).toBe(false);
    await page.evaluate(() => { window.fixtureOldMod.checked = false; window.fixtureOldMod.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect(page.locator('[data-mod-enabled-checkbox]')).toBeChecked();
    await expect(page.locator('#mods-restart-warning')).toBeVisible();
    expect(state.calls.some(value => value.startsWith('PUT'))).toBe(false);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.locator('[data-mod-enabled-checkbox]').uncheck(); await page.locator('#mods-manager-form button[type=submit]').click();
    await expect.poll(() => state.calls.filter(value => value === 'PUT /api/mods/enabled').length).toBe(1);
    expect(state.bodies.at(-1)).toMatchObject({ enabledMods: [] });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await page.locator('#mods-refresh-button').evaluate(button => button.click());
    expect(state.calls.filter(value => value === 'GET /api/mods/manager')).toHaveLength(1); expect(state.errors).toEqual([]);
});

test('Mod Manager committed selection wins over an older pending refresh', async ({ page }) => {
    const state = await install(page, 'mods'); state.holdMods = true;
    await page.locator('#mods-refresh-button').click(); await expect.poll(() => Boolean(state.releaseMods)).toBe(true);
    await page.locator('[data-mod-enabled-checkbox]').uncheck();
    state.mods = [{ ...state.mods[0], configuredEnabled: false }];
    await page.locator('#mods-manager-form button[type=submit]').click();
    await expect.poll(() => state.calls.filter(value => value === 'PUT /api/mods/enabled').length).toBe(1);
    await expect(page.locator('[data-mod-enabled-checkbox]')).not.toBeChecked();
    state.releaseMods(); await page.waitForTimeout(100);
    await expect(page.locator('[data-mod-enabled-checkbox]')).not.toBeChecked();
    await expect(page.locator('#mods-restart-warning')).toBeVisible(); expect(state.errors).toEqual([]);
});
