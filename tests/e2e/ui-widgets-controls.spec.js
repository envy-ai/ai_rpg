const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const PACKAGE = path.resolve(__dirname, '../../packages/ui-widgets');
const ORIGIN = 'http://controls-fixture.test';

async function openFixture(page) {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { unexpected.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><nav><button id="first">First</button><button id="disabled" disabled>Disabled</button><button id="third">Third</button></nav><section id="a">First panel</section><section id="b">Disabled panel</section><section id="c">Third panel</section><div id="list"></div><div id="field"></div><input id="range" type="range" min="-100" max="100"><input id="number" type="number"></body></html>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { unexpected.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`);
    return { errors, unexpected };
}

test('tabs preserve native focus, selected panel and disabled navigation across teardown', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.evaluate(async () => {
        const { Tabs } = await import('/src/index.js');
        window.changes = [];
        window.tabs = new Tabs({ tabs: [{ id: 'first', button: document.querySelector('#first'), panel: document.querySelector('#a') }, { id: 'disabled', button: document.querySelector('#disabled'), panel: document.querySelector('#b') }, { id: 'third', button: document.querySelector('#third'), panel: document.querySelector('#c') }], onChange: id => window.changes.push(id) });
    });
    await expect(page.locator('#first')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#a')).toBeVisible();
    await expect(page.locator('#c')).toBeHidden();
    await page.locator('#first').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#third')).toBeFocused();
    await expect(page.locator('#third')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#c')).toBeVisible();
    await page.keyboard.press('Home');
    await expect(page.locator('#first')).toBeFocused();
    expect(await page.evaluate(() => window.changes)).toEqual(['third', 'first']);
    await page.evaluate(() => { window.tabs.activate('third', { notify: false }); window.tabs.destroy(); window.tabs.destroy(); });
    await page.locator('#first').click();
    expect(await page.evaluate(() => window.changes)).toEqual(['third', 'first']);
    expect(await page.evaluate(() => { try { window.tabs.activate('first'); return ''; } catch (error) { return error.message; } })).toMatch(/destroy/i);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('ordered text list reorders and removes with keyboard, preserves values, and disposes', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.evaluate(async () => {
        const { OrderedTextList } = await import('/src/index.js');
        window.changes = 0;
        window.list = new OrderedTextList(document.querySelector('#list'), { values: ['Alpha', 'Beta'], itemLabel: 'Entry', onChange: () => window.changes++ });
    });
    const list = page.locator('#list');
    await expect(list.locator('textarea')).toHaveCount(2);
    const handle = list.locator('[data-repeater-handle]').nth(1);
    await handle.focus(); await page.keyboard.press('Alt+ArrowUp');
    expect(await page.evaluate(() => window.list.getValues())).toEqual(['Beta', 'Alpha']);
    await expect(list.locator('[data-repeater-handle]').first()).toBeFocused();
    await list.locator('[data-repeater-action="remove"]').first().click();
    expect(await page.evaluate(() => window.list.getValues())).toEqual(['Alpha']);
    await list.locator('textarea').fill('  zero  ');
    expect(await page.evaluate(() => window.list.getValues({ trim: true, omitEmpty: true }))).toEqual(['zero']);
    await list.locator('[data-repeater-action="remove"]').click();
    await expect(list.locator('textarea')).toHaveCount(1);
    await expect(list.locator('textarea')).toHaveValue('');
    await page.evaluate(() => { window.previousChanges = window.changes; window.list.destroy(); window.list.destroy(); });
    await list.locator('textarea').fill('after disposal');
    expect(await page.evaluate(() => window.changes)).toBe(await page.evaluate(() => window.previousChanges));
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('labelled fields and paired numeric controls preserve host value and disable policy', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.evaluate(async () => {
        const { createField, NumberRange } = await import('/src/index.js');
        document.querySelector('#field').append(createField({ document, label: 'Count', type: 'number', value: 0 }).field);
        window.values = [];
        window.pair = new NumberRange(document.querySelector('#range'), document.querySelector('#number'), { onChange: value => window.values.push(value) });
    });
    await expect(page.getByLabel('Count')).toHaveValue('0');
    await page.locator('#number').fill('-7');
    await expect(page.locator('#range')).toHaveValue('-7');
    expect(await page.evaluate(() => window.values)).toEqual([-7]);
    await page.evaluate(() => window.pair.setDisabled(true));
    await expect(page.locator('#number')).toBeDisabled(); await expect(page.locator('#range')).toBeDisabled();
    await page.evaluate(() => { window.pair.destroy(); window.pair.destroy(); });
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('nested repeaters isolate actions and support native drag ordering', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.evaluate(async () => {
        const { Repeater } = await import('/src/index.js');
        document.querySelector('#list').innerHTML = '<div id="row-a"><button data-repeater-handle draggable="true">Move A</button><div id="nested"><div><button data-repeater-action="remove">Remove nested</button></div></div></div><div id="row-b"><button data-repeater-handle draggable="true">Move B</button></div>';
        window.outerChanges = []; window.innerChanges = [];
        window.outer = new Repeater(document.querySelector('#list'), { onChange: change => window.outerChanges.push(change.action) });
        window.inner = new Repeater(document.querySelector('#nested'), { onChange: change => window.innerChanges.push(change.action) });
    });
    await page.getByRole('button', { name: 'Remove nested' }).click();
    expect(await page.evaluate(() => ({ outer: window.outerChanges, inner: window.innerChanges }))).toEqual({ outer: [], inner: ['remove'] });
    await page.getByRole('button', { name: 'Move A' }).dragTo(page.getByRole('button', { name: 'Move B' }), { targetPosition: { x: 4, y: 15 } });
    expect(await page.locator('#list > div').evaluateAll(rows => rows.map(row => row.id))).toEqual(['row-b', 'row-a']);
    await page.evaluate(() => { window.inner.destroy(); window.outer.destroy(); });
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('reader rows serialize DOM order and dispose removed row ownership', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.evaluate(async () => {
        const { ReaderRows } = await import('/src/index.js');
        const root = document.querySelector('#list'); window.disposed = []; window.reader = new ReaderRows(root);
        for (const value of ['one', 'two']) {
            const row = document.createElement('div'); row.innerHTML = `<input value="${value}"><button>Remove</button>`;
            window.reader.add(row, () => row.querySelector('input').value, { removeButton: row.querySelector('button'), dispose: () => window.disposed.push(value) });
        }
    });
    await page.evaluate(() => { const root = document.querySelector('#list'); root.insertBefore(root.lastElementChild, root.firstElementChild); });
    expect(await page.evaluate(() => window.reader.read())).toEqual(['two', 'one']);
    await page.locator('#list > div').first().getByRole('button', { name: 'Remove' }).click();
    expect(await page.evaluate(() => ({ values: window.reader.read(), disposed: window.disposed }))).toEqual({ values: ['one'], disposed: ['two'] });
    await page.evaluate(() => { window.reader.destroy(); window.reader.destroy(); });
    expect(await page.evaluate(() => window.disposed)).toEqual(['two', 'one']);
    expect(await page.evaluate(() => { try { window.reader.read(); return ''; } catch (error) { return error.message; } })).toMatch(/destroy/i);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('reader disposal tolerates reentrant destroy and preserves cleanup errors', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { ReaderRows } = await import('/src/index.js');
        const outcomes = [];
        for (const method of ['clear', 'destroy']) {
            const root = document.createElement('div'); document.body.append(root);
            const owner = new ReaderRows(root), calls = [];
            for (const index of [0, 1]) {
                const row = document.createElement('div');
                owner.add(row, () => index, { dispose: () => { calls.push(index); if (index === 0) owner.destroy(); } });
            }
            owner[method](); owner.destroy();
            outcomes.push({ method, calls, remaining: root.children.length }); root.remove();
        }
        const root = document.createElement('div'); document.body.append(root);
        const owner = new ReaderRows(root), calls = [], original = new Error('Original cleanup failure');
        for (const index of [0, 1]) owner.add(document.createElement('div'), () => index, { dispose: () => { calls.push(index); if (index === 0) throw original; } });
        let sameError = false; try { owner.destroy(); } catch (error) { sameError = error === original; }
        owner.destroy(); root.remove();
        return { outcomes, calls, sameError };
    });
    expect(result).toEqual({ outcomes: [{ method: 'clear', calls: [0, 1], remaining: 0 }, { method: 'destroy', calls: [0, 1], remaining: 2 }], calls: [0, 1], sameError: true });
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
