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

test('top modal owns Escape and focus until pending work completes, with native dialog precedence', async ({ page }) => {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { unexpected.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><button id="trigger">Open</button><section id="base" hidden><button id="base-button">Base</button></section><section id="top" hidden><button id="first">First</button><button id="last">Last</button></section><dialog id="native"><button>Native</button></dialog></body></html>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { unexpected.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(async () => {
        const { ModalStack } = await import('/src/index.js');
        window.stack = new ModalStack({ document });
        window.base = document.querySelector('#base'); window.topModal = document.querySelector('#top');
        window.dismissals = [];
        for (const root of [window.base, window.topModal]) {
            window.stack.register(root);
            window.stack.configure(root, { escape: 'dismiss', trapFocus: true, focusables: () => [...root.querySelectorAll('button')], onDismiss: ({ reason }) => { window.dismissals.push([root.id, reason]); window.stack.setVisible(root, false); } });
        }
        document.querySelector('#trigger').focus();
        window.stack.rememberFocus(window.base, document.querySelector('#trigger'));
        window.stack.setVisible(window.base, true); window.stack.setVisible(window.topModal, true);
        document.querySelector('#last').focus();
    });
    await page.keyboard.press('Tab'); await expect(page.locator('#first')).toBeFocused();
    await page.evaluate(() => window.stack.setPending(window.topModal, true));
    await page.keyboard.press('Escape'); await expect(page.locator('#top')).not.toHaveAttribute('hidden', '');
    await page.evaluate(() => { window.stack.setPending(window.topModal, false); document.querySelector('#native').showModal(); });
    await page.keyboard.press('Escape'); await expect(page.locator('#native')).toHaveJSProperty('open', false);
    await expect(page.locator('#top')).not.toHaveAttribute('hidden', '');
    await page.keyboard.press('Escape'); await expect(page.locator('#top')).toHaveAttribute('hidden', '');
    await expect(page.locator('#base')).not.toHaveAttribute('hidden', '');
    await page.keyboard.press('Escape'); await expect(page.locator('#base')).toHaveAttribute('hidden', '');
    expect(await page.evaluate(() => window.dismissals)).toEqual([['top', 'escape'], ['base', 'escape']]);
    await page.evaluate(() => { window.stack.restoreFocus(window.base); window.stack.destroy(); window.stack.destroy(); });
    await expect(page.locator('#trigger')).toBeFocused();
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('nonlocking nontrapping modal policy leaves host focus and Escape handling alone', async ({ page }) => {
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) return route.abort();
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><button id="outside">Outside</button><section id="modal" hidden><button id="inside">Inside</button></section>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) return route.abort();
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(async () => {
        const { ModalStack } = await import('/src/index.js');
        window.stack = new ModalStack({ document }); const root = document.querySelector('#modal');
        window.stack.register(root, { lockScroll: false }); window.stack.configure(root, { escape: 'ignore', trapFocus: false });
        window.escapes = 0; document.addEventListener('keydown', event => { if (event.key === 'Escape') window.escapes++; });
        window.stack.setVisible(root, true); document.querySelector('#outside').focus();
    });
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);
    await expect(page.locator('#outside')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal')).not.toHaveAttribute('hidden', '');
    expect(await page.evaluate(() => window.escapes)).toBe(1);
    await page.evaluate(() => window.stack.destroy());
});

test('default trap skips hidden and disabled controls while nonmodal dialogs do not claim Escape', async ({ page }) => {
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) return route.abort();
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><section id="modal" hidden><button id="first">First</button><div hidden><button>Hidden ancestor</button></div><button style="display:none">CSS hidden</button><fieldset disabled><button>Disabled fieldset</button></fieldset><button id="last">Last</button></section><dialog id="nonmodal" open>Nonmodal</dialog>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) return route.abort();
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(async () => {
        const { ModalStack } = await import('/src/index.js');
        window.stack = new ModalStack({ document }); const modal = document.querySelector('#modal');
        window.stack.register(modal); window.stack.configure(modal, { trapFocus: true, escape: 'dismiss', onDismiss: () => window.stack.setVisible(modal, false) });
        window.stack.setVisible(modal, true); document.querySelector('#last').focus();
    });
    await page.keyboard.press('Tab'); await expect(page.locator('#first')).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(page.locator('#last')).toBeFocused();
    await page.keyboard.press('Escape'); await expect(page.locator('#modal')).toHaveAttribute('hidden', '');
    await expect(page.locator('#nonmodal')).toHaveJSProperty('open', true);
    await page.evaluate(() => window.stack.destroy());
});
