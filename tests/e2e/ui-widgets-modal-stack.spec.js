const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const PACKAGE = path.resolve(__dirname, '../../packages/ui-widgets');
const ORIGIN = 'http://modal-stack-fixture.test';

test('shared modal backdrop and scroll lock remain owned until the final sibling closes', async ({ page }) => {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { unexpected.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="backdrop" hidden></div><section id="first" role="dialog" hidden></section><section id="second" role="dialog" hidden></section><section id="other" role="dialog" hidden></section></body></html>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { unexpected.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(async () => {
        const { ModalStack } = await import('/src/index.js');
        window.stack = new ModalStack({ document });
        window.first = document.querySelector('#first'); window.second = document.querySelector('#second'); window.other = document.querySelector('#other');
        const backdrop = document.querySelector('#backdrop');
        window.stack.register(window.first, { backdrop }); window.stack.register(window.second, { backdrop }); window.stack.register(window.other, { lockScroll: false });
        window.stack.setVisible(window.first, true); window.stack.setVisible(window.second, true);
    });
    const backdrop = page.locator('#backdrop');
    await expect(backdrop).not.toHaveAttribute('hidden', ''); await expect(page.locator('body')).toHaveClass(/modal-open/);
    await page.evaluate(() => window.stack.setVisible(window.first, false));
    await expect(page.locator('#first')).toHaveAttribute('hidden', ''); await expect(page.locator('#first')).toHaveAttribute('aria-hidden', 'true');
    await expect(backdrop).not.toHaveAttribute('hidden', ''); await expect(page.locator('body')).toHaveClass(/modal-open/);
    await page.evaluate(() => { window.stack.setVisible(window.other, true); window.stack.setVisible(window.second, false); });
    await expect(backdrop).toHaveAttribute('hidden', ''); await expect(page.locator('body')).not.toHaveClass(/modal-open/);
    await expect(page.locator('#other')).not.toHaveAttribute('hidden', '');
    await page.evaluate(() => { window.stack.setLock('transaction', true); window.stack.setVisible(window.first, true); window.stack.unregister(window.first); });
    await expect(backdrop).toHaveAttribute('hidden', ''); await expect(page.locator('body')).toHaveClass(/modal-open/);
    await page.evaluate(() => { window.stack.setLock('transaction', false); window.stack.destroy(); window.stack.destroy(); });
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);
    expect(await page.evaluate(() => { try { window.stack.setVisible(window.second, true); return ''; } catch (error) { return error.message; } })).toMatch(/destroy/i);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
