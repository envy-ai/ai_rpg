const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const root = path.resolve(__dirname, '../..');
const origin = 'http://127.0.0.1:4173';

async function install(page, { configured = true } = {}) {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(root, 'views')), { autoescape: true });
    const html = env.renderString('<!DOCTYPE html><html><head>{% include "_includes/head-common.njk" %}</head><body>{% include "_includes/app-header.njk" %}<main>Fixture</main></body></html>', { currentPage: 'chat', gameLoaded: true, managedLocalLlmConfigured: configured, modNavigationItems: [] });
    const state = { status: { success: true, configured, kind: configured ? 'strata' : null, state: 'running', desiredOn: true, nextEnabled: false, error: null }, posts: [], gets: 0, resolvePost: null, releasePost: null, errors: [] };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
        if (url.pathname === '/api/local-llm') {
            if (req.method() === 'GET') state.gets++;
            if (req.method() === 'POST') {
                state.posts.push(req.postDataJSON());
                if (state.releasePost) await state.releasePost;
            }
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.status) });
        }
        const base = url.pathname.startsWith('/assets/') ? path.join(root, 'assets') : path.join(root, 'public');
        const rel = url.pathname.startsWith('/assets/') ? url.pathname.slice('/assets'.length) : url.pathname;
        const file = path.resolve(base, `.${rel}`);
        if (file.startsWith(`${base}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
            return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
        }
        return route.fulfill({ status: 404, body: 'Fixture missing asset' });
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    return state;
}

for (const viewport of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'phone', width: 320, height: 640 }]) {
    test(`${viewport.name} header displays status colors, accessible toggle, errors and nonoverlapping controls`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const fixture = await install(page);
        const button = page.locator('#appHeaderLocalLlmToggle'), led = button.locator('.app-header-local-llm__led');
        await expect(button).toHaveAttribute('data-state', 'running');
        const green = await led.evaluate(el => getComputedStyle(el).backgroundColor);
        const gate = new Promise(resolve => { fixture.resolvePost = resolve; }); fixture.releasePost = gate;
        await button.focus(); await page.keyboard.press('Space');
        await expect(button).toHaveAttribute('data-state', 'waiting');
        await expect(button).toHaveAttribute('aria-busy', 'true');
        const yellow = await led.evaluate(el => getComputedStyle(el).backgroundColor);
        await expect.poll(() => fixture.posts.length).toBe(1);
        const priorGets = fixture.gets;
        await expect.poll(() => fixture.gets, { timeout: 5000 }).toBeGreaterThan(priorGets);
        await expect(button).toHaveAttribute('data-state', 'waiting');
        expect(fixture.posts[0]).toEqual({ enabled: false });
        fixture.status = { ...fixture.status, state: 'off', desiredOn: false, nextEnabled: true };
        fixture.resolvePost();
        await expect(button).toHaveAttribute('data-state', 'off');
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        const dark = await led.evaluate(el => getComputedStyle(el).backgroundColor);
        fixture.releasePost = null;
        fixture.status = { ...fixture.status, state: 'running', desiredOn: true, nextEnabled: false };
        await button.focus(); await page.keyboard.press('Enter');
        await expect.poll(() => fixture.posts.length).toBe(2);
        expect(fixture.posts[1]).toEqual({ enabled: true });
        await expect(button).toHaveAttribute('data-state', 'running');
        fixture.status = { ...fixture.status, state: 'error', nextEnabled: true, error: { message: 'Runtime failed', stack: 'Runtime failed\n    at fixture:42' } };
        await expect(button).toHaveAttribute('data-state', 'error', { timeout: 5000 });
        const red = await led.evaluate(el => getComputedStyle(el).backgroundColor);
        expect(new Set([green, yellow, dark, red]).size).toBe(4);
        await expect(page.getByRole('dialog', { name: 'Operation stopped' })).toContainText('at fixture:42');
        await page.getByRole('dialog', { name: 'Operation stopped' }).getByRole('button', { name: /close/i }).click();
        if (viewport.name === 'phone') {
            const ids = ['appHeaderLocalLlmToggle', 'appHeaderPrimaryAction', 'appHeaderMenuToggle'];
            const rects = await Promise.all(ids.map(id => page.locator(`#${id}`).boundingBox()));
            for (const rect of rects) { expect(rect).not.toBeNull(); expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width); }
            for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
                expect(Math.min(rects[i].x + rects[i].width, rects[j].x + rects[j].width) - Math.max(rects[i].x, rects[j].x)).toBeLessThanOrEqual(0);
            }
        }
        expect(fixture.errors).toEqual([]);
        await page.screenshot({ path: path.join(root, 'tmp', `local-llm-toggle-${viewport.name}.png`) });
    });
}

test('unmanaged header renders no toggle or lifecycle requests', async ({ page }) => {
    const fixture = await install(page, { configured: false });
    await expect(page.locator('#appHeaderLocalLlmToggle')).toHaveCount(0);
    expect(fixture.posts).toEqual([]);
});
