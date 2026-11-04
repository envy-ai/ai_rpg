const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '../..');
const origin = 'http://127.0.0.1:4173';

test('faction housekeeping interval renders and saves independently of ordinary housekeeping', async ({ page }) => {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(root, 'views')), { autoescape: true, throwOnUndefined: false });
    const config = yaml.load(fs.readFileSync(path.join(root, 'config.yaml'), 'utf8'));
    const html = env.render('config.njk', { config, modConfigs: [], modelOptions: [], gameLoaded: false });
    const posts = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/config' && request.method() === 'POST') {
            posts.push(new URLSearchParams(request.postData() || ''));
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'Captured' }) });
        }
        if (url.pathname === '/config') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
        const base = url.pathname.startsWith('/assets/') ? path.join(root, 'assets') : path.join(root, 'public');
        const relative = url.pathname.startsWith('/assets/') ? url.pathname.slice('/assets'.length) : url.pathname;
        const file = path.resolve(base, `.${relative}`);
        if (file.startsWith(`${base}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
            return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
        }
        return route.fulfill({ status: 404, body: 'Not found in fixture' });
    });
    await page.goto(`${origin}/config`);
    await page.locator('[data-config-tab-target="story"]').click();
    const ordinary = page.locator('#housekeeping-interval');
    const faction = page.locator('#faction-housekeeping-interval');
    await expect(ordinary).toHaveValue('4');
    await expect(faction).toHaveValue('11');
    await expect(faction).toHaveAttribute('min', '1');
    await faction.fill('7');
    await page.locator('#config-tab-story button[type="submit"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].get('faction_housekeeping.interval::int')).toBe('7');
    expect(posts[0].get('housekeeping.interval::int')).toBe('4');
    expect(errors).toEqual([]);
});
