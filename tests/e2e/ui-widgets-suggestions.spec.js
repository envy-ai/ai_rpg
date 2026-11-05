const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const PACKAGE = path.resolve(__dirname, '../../packages/ui-widgets');
const ORIGIN = 'http://suggestion-fixture.test';
async function openFixture(page) {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { unexpected.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><input id="search"><div id="suggestions" hidden></div><button id="outside">Outside</button>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { unexpected.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`); return { errors, unexpected };
}

test('native suggestions honor Enter, mousedown, Escape, blur and stale async results', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.evaluate(async () => {
        const { NativeSuggestions } = await import('/src/index.js');
        window.chosen = []; window.pending = [];
        window.owner = new NativeSuggestions(document.querySelector('#search'), document.querySelector('#suggestions'), {
            getMatches: query => query === 'slow' ? new Promise(resolve => window.pending.push(resolve)) : Promise.resolve([`${query} one`, `${query} two`]),
            renderOption: item => { const button = document.createElement('button'); button.type = 'button'; button.textContent = item; return button; },
            onChoose: item => window.chosen.push(item), onError: error => { throw error; }
        });
    });
    const search = page.locator('#search'), suggestions = page.locator('#suggestions');
    await search.fill('alpha'); await expect(suggestions).toContainText('alpha one');
    await search.press('Enter'); expect(await page.evaluate(() => window.chosen)).toEqual(['alpha one']);
    await search.fill('beta'); await expect(suggestions).toContainText('beta two');
    await suggestions.getByRole('button', { name: 'beta two' }).dispatchEvent('mousedown');
    expect(await page.evaluate(() => window.chosen)).toEqual(['alpha one', 'beta two']); await expect(search).toBeFocused();
    await search.fill('gamma'); await expect(suggestions).toBeVisible(); await search.press('Escape'); await expect(suggestions).toBeHidden();
    await search.fill('delta'); await expect(suggestions).toBeVisible(); await page.locator('#outside').focus(); await expect(suggestions).toBeHidden();
    await search.fill('slow'); await expect.poll(() => page.evaluate(() => window.pending.length)).toBeGreaterThan(0);
    await search.fill('new'); await expect(suggestions).toContainText('new one');
    await page.evaluate(() => window.pending.forEach(resolve => resolve(['stale result'])));
    await expect(suggestions).toContainText('new one'); await expect(suggestions).not.toContainText('stale result');
    await page.evaluate(() => { window.owner.destroy(); window.owner.destroy(); });
    await search.fill('after'); await expect(suggestions).toBeHidden();
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
