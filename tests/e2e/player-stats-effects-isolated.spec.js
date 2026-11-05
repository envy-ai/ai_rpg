const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../..');
const origin = 'http://player-stats-fixture.test';
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(root, 'views')), { autoescape: true });

test('standalone Player Stats saves without overwriting status effects when editor is absent', async ({ page }) => {
    const effect = { id: 'player-effect', name: 'Hidden ward', description: 'Original', duration: 0, maxHealthPercent: 0, appliedAt: 5, customMarker: 'retained', attributes: [{ attribute: 'strength', modifier: 0, percentModifier: 0 }] };
    const player = { id: 'player-fixture', name: 'Fixture Player', level: 1, health: 10, attributes: { strength: 10 }, skills: {}, statusEffects: [effect] };
    const saves = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        const pathname = decodeURIComponent(url.pathname);
        if (pathname === '/player-stats') return route.fulfill({ contentType: 'text/html', body: env.render('player-stats.njk', { title: 'Player Stats', player, attributes: [{ name: 'strength', label: 'Strength' }], skills: [] }) });
        if (pathname === '/api/player') return route.fulfill({ json: { success: true, player } });
        if (pathname === '/api/player/update-stats') { saves.push(route.request().postDataJSON()); return route.fulfill({ json: { success: true, player } }); }
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { success: true } });
        const file = path.resolve(root, 'public', `.${pathname}`);
        if (file.startsWith(path.join(root, 'public') + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: fs.readFileSync(file) });
        return route.abort();
    });
    await page.goto(`${origin}/player-stats`);
    await expect(page.locator('#player-stats-form')).toBeVisible();
    await expect(page.locator('#player-name')).toHaveValue('Fixture Player');
    await expect(page.locator('#playerStatusEffectsList')).toHaveCount(0);
    await page.locator('#player-name').fill('Edited Player');
    await page.locator('#player-stats-form').evaluate(form => form.requestSubmit());
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].name).toBe('Edited Player');
    expect(saves[0]).not.toHaveProperty('statusEffects');
    expect(errors).toEqual([]);
});
