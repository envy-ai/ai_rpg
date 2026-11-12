const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');

const root = path.join(__dirname, '../..');
const include = fs.readFileSync(path.join(root, 'views/_includes/sequential-ids.njk'), 'utf8');
const sequentialScript = fs.readFileSync(path.join(root, 'public/js/sequential-ids.js'), 'utf8');
const domScript = fs.readFileSync(path.join(root, 'public/js/dom-utils.js'), 'utf8');

test('real bootstrap initializes browser IDs in separate tabs, refills and fails when missing', async ({ browser }) => {
    const context = await browser.newContext();
    let refills = 0;
    await context.route('https://id-fixture.invalid/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/js/sequential-ids.js') return route.fulfill({ contentType: 'application/javascript', body: sequentialScript });
        if (url.pathname === '/js/dom-utils.js') return route.fulfill({ contentType: 'application/javascript', body: domScript });
        if (url.pathname === '/api/ids/reserve') {
            const category = route.request().postDataJSON().category;
            const start = 10000 + (++refills * 1024);
            return route.fulfill({ json: { range: { category, start, end: start + 1023 } } });
        }
        const start = url.pathname === '/two' ? 1025 : 1;
        const bootstrap = nunjucks.renderString(include, { sequentialIdsEnabled: true,
            sequentialIdsBootstrapJson: () => JSON.stringify({ ranges: [{ category: 'client', start, end: start + 1023 }, { category: 'action', start, end: start + 128 }] }) });
        const html = url.pathname === '/missing'
            ? '<script>window.SEQUENTIAL_IDS_ENABLED=true</script><script src="/js/sequential-ids.js"></script><script src="/js/dom-utils.js"></script>'
            : `${bootstrap}<script src="/js/dom-utils.js"></script><script>window.initialClientId = DomUtils.loadClientId(); window.firstActionId = SequentialIds.next('action');</script>`;
        return route.fulfill({ contentType: 'text/html', body: html });
    });
    const first = await context.newPage(), second = await context.newPage();
    await first.goto('https://id-fixture.invalid/one');
    await second.goto('https://id-fixture.invalid/two');
    expect(await first.evaluate(() => window.initialClientId)).toBe('client_1');
    expect(await first.evaluate(() => window.firstActionId)).toBe('action_1');
    expect(await second.evaluate(() => window.firstActionId)).toBe('action_1025');
    await expect.poll(() => refills).toBeGreaterThanOrEqual(2);
    await expect.poll(() => first.evaluate(() => window.SequentialIds.ranges.get('action').length)).toBe(2);
    const missing = await context.newPage();
    const pageError = missing.waitForEvent('pageerror');
    await missing.goto('https://id-fixture.invalid/missing');
    expect((await pageError).message).toMatch(/bootstrap ranges/i);
    expect(await missing.evaluate(() => { localStorage.removeItem('airpg:clientId'); try { DomUtils.loadClientId(); return 'unexpected'; } catch (error) { return error.message; } })).toMatch(/bootstrap allocator/i);
    await context.close();
});
