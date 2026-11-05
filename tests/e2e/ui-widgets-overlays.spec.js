const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '../..');
const PACKAGE = path.join(ROOT, 'packages/ui-widgets');
const ORIGIN = 'http://overlay-fixture.test';

async function openFixture(page) {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { unexpected.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><style>#tip { position: fixed; width: 120px; max-height: 80px; overflow: auto; background: white } #tip[hidden] { display: none }</style></head><body><button id="trigger">Open</button><button id="other">Other</button><div id="scroll-area"><div id="tip" hidden></div></div><dialog id="modal"><button id="close">Close</button></dialog></body></html>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { unexpected.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`);
    return { errors, unexpected };
}

test('native dialog owns focus, pending dismissal, replacement focus, and disposal', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.evaluate(async () => {
        const { NativeDialog } = await import('/src/index.js');
        window.dialog = new NativeDialog(document.querySelector('#modal'), { onClose: () => window.closeCount = (window.closeCount || 0) + 1 });
        document.querySelector('#trigger').focus();
        window.dialog.open({ initialFocus: document.querySelector('#close') });
    });
    const modal = page.locator('#modal');
    await expect(modal).toHaveJSProperty('open', true);
    await expect(page.locator('#close')).toBeFocused();
    expect(await modal.evaluate(node => node.matches(':modal'))).toBe(true);
    await page.evaluate(() => window.dialog.setPending(true));
    await page.keyboard.press('Escape');
    await expect(modal).toHaveJSProperty('open', true);
    expect(await page.evaluate(() => window.dialog.close())).toBe(false);
    await expect(modal).toHaveAttribute('aria-busy', 'true');
    await page.evaluate(() => {
        window.dialog.setPending(false);
        const old = document.querySelector('#trigger');
        const replacement = old.cloneNode(true);
        old.replaceWith(replacement);
        window.dialog.close();
    });
    await expect(modal).toHaveJSProperty('open', false);
    await expect(page.locator('#trigger')).toBeFocused();
    expect(await page.evaluate(() => window.closeCount)).toBe(1);
    await page.evaluate(() => { window.dialog.open(); document.querySelector('#modal').close(); });
    await expect.poll(() => page.evaluate(() => window.closeCount)).toBe(2);
    await page.evaluate(() => { window.dialog.destroy(); window.dialog.destroy(); });
    expect(await page.evaluate(() => { try { window.dialog.open(); return ''; } catch (error) { return error.message; } })).toMatch(/destroy/i);
    await page.evaluate(async () => { const { NativeDialog } = await import('/src/index.js'); window.replacement = new NativeDialog(document.querySelector('#modal')); window.replacement.open(); window.replacement.close(); });
    await expect(page.locator('#trigger')).toBeFocused();
    expect(await page.evaluate(() => window.closeCount)).toBe(2);
    await page.evaluate(() => window.replacement.destroy());
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
});

test('floating tooltip supports safe content, movement, hover bridge, dismissal, and teardown', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.setViewportSize({ width: 390, height: 300 });
    await page.evaluate(async () => {
        const { FloatingTooltip } = await import('/src/index.js');
        window.tooltip = new FloatingTooltip(document.querySelector('#tip'), { scrollTargets: [document.querySelector('#scroll-area')] });
        window.tooltip.show('<b>safe text</b>', { clientX: 380, clientY: 290 });
    });
    const tip = page.locator('#tip');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText('<b>safe text</b>');
    await expect(tip.locator('b')).toHaveCount(0);
    const bounds = await tip.boundingBox();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(300);
    await page.evaluate(() => window.tooltip.move({ clientX: 20, clientY: 20 }));
    expect((await tip.boundingBox()).x).toBe(36);
    await page.evaluate(() => { window.tooltip.show('<b>rich</b><p>' + 'long '.repeat(200) + '</p>', { clientX: 20, clientY: 20 }, { allowHTML: true }); window.tooltip.hide({ defer: true }); });
    await expect(tip.locator('b')).toHaveText('rich');
    await expect(tip).toHaveClass(/is-interactive/);
    await tip.dispatchEvent('mouseenter');
    await page.waitForTimeout(250);
    await expect(tip).toBeVisible();
    await tip.dispatchEvent('mouseleave');
    await expect(tip).toBeHidden();
    await page.evaluate(() => { window.tooltip.show('scroll', { clientX: 20, clientY: 20 }); document.querySelector('#scroll-area').dispatchEvent(new Event('scroll')); });
    await expect(tip).toBeHidden();
    await page.evaluate(() => { window.escapeSeen = 0; document.addEventListener('keydown', event => { if (event.key === 'Escape') window.escapeSeen++; }); window.tooltip.show('escape', { clientX: 20, clientY: 20 }); });
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    expect(await page.evaluate(() => window.escapeSeen)).toBe(1);
    await page.evaluate(() => { window.tooltip.show('dispose', { clientX: 20, clientY: 20 }); window.tooltip.hide({ defer: true }); window.tooltip.destroy(); window.tooltip.destroy(); });
    await expect(tip).toBeHidden();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => { try { window.tooltip.show('late', { clientX: 1, clientY: 1 }); return ''; } catch (error) { return error.message; } })).toMatch(/destroy/i);
    await page.evaluate(async () => { const { FloatingTooltip } = await import('/src/index.js'); window.replacement = new FloatingTooltip(document.querySelector('#tip')); window.replacement.show('remounted', { clientX: 20, clientY: 20 }); });
    await expect(tip).toHaveText('remounted');
    await page.evaluate(() => window.replacement.destroy());
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
});

test('native dialog rejects reopening until the prior close event completes', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { NativeDialog } = await import('/src/index.js');
        const root = document.querySelector('#modal');
        document.querySelector('#trigger').focus();
        window.closeCount = 0;
        window.dialog = new NativeDialog(root, { onClose: () => window.closeCount++ });
        window.dialog.open();
        window.dialog.close();
        try { window.dialog.open(); return 'unexpectedly opened'; } catch (error) { return error.message; }
    });
    expect(result).toMatch(/close has not completed.*native close event/i);
    await expect.poll(() => page.evaluate(() => window.closeCount)).toBe(1);
    await expect(page.locator('#trigger')).toBeFocused();
    await page.evaluate(() => { window.dialog.open(); window.dialog.close(); });
    await expect.poll(() => page.evaluate(() => window.closeCount)).toBe(2);
    await expect(page.locator('#trigger')).toBeFocused();
    await page.evaluate(() => window.dialog.destroy());
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
});

test('native dialog close waiters settle when registered during native close dispatch or disposal', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { NativeDialog } = await import('/src/index.js');
        const root = document.querySelector('#modal');
        let lifecycle;
        let duringClose;
        root.addEventListener('close', () => { duringClose = lifecycle.whenClosed(); }, { once: true });
        lifecycle = new NativeDialog(root);
        lifecycle.open(); lifecycle.close();
        await new Promise(resolve => root.addEventListener('close', resolve, { once: true }));
        await duringClose;
        lifecycle.open(); lifecycle.close();
        const disposed = lifecycle.whenClosed();
        lifecycle.destroy();
        await disposed;
        return { open: root.open };
    });
    expect(result).toEqual({ open: false });
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
