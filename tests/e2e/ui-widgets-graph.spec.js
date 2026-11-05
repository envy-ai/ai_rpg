const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const PACKAGE = path.resolve(__dirname, '../../packages/ui-widgets');
const ORIGIN = 'http://graph-fixture.test';
async function openFixture(page) {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { unexpected.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="graph"></div><button id="external">Event</button>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { unexpected.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`); return { errors, unexpected };
}

test('GraphHost replaces engines and cancels generation resources before disposal', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { GraphHost } = await import('/src/index.js');
        const events = [], root = document.querySelector('#graph'), target = document.querySelector('#external');
        let generation = 0;
        const host = new GraphHost(root, { createEngine: () => { const id = ++generation; events.push(`create ${id}`); return { id, destroy() { events.push(`destroy ${id}`); } }; }, statusClasses: { status: 'status', error: 'error' } });
        host.mount(); host.own(() => events.push('dispose 1'));
        host.listen(target, 'click', () => events.push('click 1'));
        host.defer(() => events.push('stale timer'), 50);
        const stale = host.guard(() => events.push('stale guard'));
        target.click(); host.mount(); stale(); target.click();
        host.own(() => events.push('dispose 2'));
        host.status('Nothing here', { kind: 'error' });
        await new Promise(resolve => setTimeout(resolve, 80));
        const text = root.textContent;
        host.destroy(); host.destroy();
        return { events, text };
    });
    expect(result.events).toEqual(['create 1', 'click 1', 'dispose 1', 'destroy 1', 'create 2', 'dispose 2', 'destroy 2']);
    expect(result.text).toBe('Nothing here');
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('GraphHost releases all resources when a disposer throws', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { GraphHost } = await import('/src/index.js');
        const events = [], original = new Error('fixture cleanup failed');
        const host = new GraphHost(document.querySelector('#graph'), { createEngine: () => ({ destroy() { events.push('engine'); } }) });
        host.mount(); host.own(() => { events.push('bad'); throw original; }); host.own(() => events.push('other'));
        let thrown; try { host.clear(); } catch (error) { thrown = error; }
        return { events, message: thrown?.message, same: thrown === original || thrown?.cause === original };
    });
    expect(result.events).toContain('bad'); expect(result.events).toContain('other'); expect(result.events).toContain('engine');
    expect(result.same).toBe(true); expect(result.message).toContain('fixture cleanup failed');
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
