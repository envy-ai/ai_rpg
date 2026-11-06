const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const PACKAGE = path.resolve(__dirname, '../../packages/ui-widgets');
const ORIGIN = 'http://windows-fixture.test';

async function openFixture(page) {
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { unexpected.push(url.href); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><input id="composer"><section id="one" hidden><h2 id="title-one"></h2><button id="close-one">Close</button><button id="choice-one">First</button></section><section id="two" hidden><h2 id="title-two"></h2><button id="close-two">Close</button><button id="choice-two">Second</button></section><dialog id="modal"><button>Modal action</button></dialog></body></html>' });
        const filename = path.resolve(PACKAGE, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { unexpected.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}/`);
    return { errors, unexpected };
}

test('pointer capture start failure cleans up and preserves the original error', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.evaluate(async () => {
        const { PointerDrag } = await import('/src/index.js');
        const root = document.querySelector('#one'), handle = document.querySelector('#close-one');
        root.hidden = false; window.dragState = { active: false, pointerId: null, offsetX: 0, offsetY: 0 }; window.ends = 0; window.moves = 0;
        handle.setPointerCapture = () => { throw new Error('fixture capture failure'); };
        window.drag = new PointerDrag(root, handle, { dragState: window.dragState, capturePointer: true, onDragStart: () => document.body.classList.add('fixture-drag'), onDragEnd: () => { window.ends++; document.body.classList.remove('fixture-drag'); }, writePosition: () => window.moves++ });
        handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7 }));
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7 }));
    });
    expect(errors).toEqual(['fixture capture failure']);
    expect(await page.evaluate(() => ({ active: window.dragState.active, pointerId: window.dragState.pointerId, ends: window.ends, moves: window.moves, body: document.body.classList.contains('fixture-drag') }))).toEqual({ active: false, pointerId: null, ends: 1, moves: 0, body: false });
    await page.evaluate(() => { window.drag.destroy(); window.drag.destroy(); });
    expect(unexpected).toEqual([]);
});

test('modeless chooser restores origin after close listeners remove the focused choice', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.evaluate(async () => {
        const { ModelessChooser } = await import('/src/index.js');
        const root = document.querySelector('#one'), choice = document.querySelector('#choice-one');
        window.chooser = new ModelessChooser({ root, title: document.querySelector('#title-one'), closeButton: document.querySelector('#close-one'), onChoose: () => {} });
        window.chooser.choice(choice, 'First'); root.addEventListener('chooser:closed', () => choice.remove());
        document.querySelector('#composer').focus(); window.chooser.open('First');
    });
    await expect(page.locator('#choice-one')).toBeFocused();
    await page.evaluate(() => window.chooser.close());
    await expect(page.locator('#composer')).toBeFocused(); await expect(page.locator('#choice-one')).toHaveCount(0);
    await page.evaluate(() => window.chooser.destroy());
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('modeless chooser owns exclusive opening, native selection, Escape precedence, and teardown', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.evaluate(async () => {
        const { ModelessChooser } = await import('/src/index.js');
        window.picks = [];
        const make = suffix => new ModelessChooser({ root: document.querySelector(`#${suffix}`), title: document.querySelector(`#title-${suffix}`), closeButton: document.querySelector(`#close-${suffix}`), onChoose: value => window.picks.push(value), returnFocus: document.querySelector('#composer'), canDismiss: () => !document.querySelector('dialog[open]') });
        window.one = make('one'); window.two = make('two');
        window.one.choice(document.querySelector('#choice-one'), 'First');
        window.two.choice(document.querySelector('#choice-two'), 'Second');
        document.querySelector('#composer').focus(); window.one.open('First chooser');
    });
    const one = page.locator('#one'), two = page.locator('#two');
    await expect(one).toBeVisible();
    await expect(page.locator('#title-one')).toHaveText('First chooser');
    await expect(page.locator('#choice-one')).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.picks)).toEqual(['First']);
    await expect(one).toBeVisible();
    await page.evaluate(() => window.two.open('Second chooser'));
    await expect(one).toBeHidden();
    await expect(two).toBeVisible();
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => window.picks)).toEqual(['First', 'Second']);
    await page.evaluate(() => document.querySelector('#modal').showModal());
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal')).toHaveJSProperty('open', false);
    await expect(two).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(two).toBeHidden();
    await expect(page.locator('#composer')).toBeFocused();
    await page.evaluate(() => { window.one.destroy(); window.one.destroy(); document.querySelector('#choice-one').click(); });
    expect(await page.evaluate(() => window.picks)).toEqual(['First', 'Second']);
    expect(await page.evaluate(() => { try { window.one.open('late'); return ''; } catch (error) { return error.message; } })).toMatch(/destroy/i);
    await page.evaluate(() => window.two.destroy());
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('floating windows drag independently, raise on focus, and dispose active pointer listeners', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    await page.evaluate(async () => {
        const { FloatingWindow } = await import('/src/index.js');
        window.closedWindows = [];
        function make(name, left) {
            const win = FloatingWindow.create({ document, ariaLabel: name, onClose: () => { window.closedWindows.push(name); win.destroy(); root.remove(); } });
            const { root, header, content } = win.elements;
            root.style.cssText = `position:fixed;left:${left}px;top:80px;width:180px;height:120px;background:white`;
            header.style.cssText = 'height:40px;background:gray';
            content.innerHTML = `<input aria-label="${name} input">`;
            document.body.append(root);
            return win;
        }
        window.firstWindow = make('First window', 30); window.secondWindow = make('Second window', 260);
    });
    const first = page.getByRole('dialog', { name: 'First window' });
    const second = page.getByRole('dialog', { name: 'Second window' });
    const header = first.locator('.floating-window__header');
    const before = await first.boundingBox();
    await header.dragTo(header, { targetPosition: { x: 120, y: 25 } });
    const after = await first.boundingBox();
    expect(after.x).toBeGreaterThan(before.x);
    await page.getByLabel('First window input').focus();
    expect(await first.evaluate(node => Number(node.style.zIndex))).toBeGreaterThan(await second.evaluate(node => Number(node.style.zIndex)));
    await page.keyboard.press('Escape');
    await expect(first).toHaveCount(0);
    await expect(second).toBeVisible();
    expect(await page.evaluate(() => window.closedWindows)).toEqual(['First window']);
    const secondHeader = second.locator('.floating-window__header');
    const box = await secondHeader.boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
    await page.evaluate(() => window.secondWindow.destroy());
    const position = await second.boundingBox();
    await page.mouse.move(box.x + 80, box.y + 60); await page.mouse.up();
    expect(await second.boundingBox()).toMatchObject({ x: position.x, y: position.y });
    await second.locator('.floating-window__close').click();
    expect(await page.evaluate(() => window.closedWindows)).toEqual(['First window']);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('chooser may be destroyed by a closed-event listener during close or destroy', async ({ page }) => {
    const { errors, unexpected } = await openFixture(page);
    const result = await page.evaluate(async () => {
        const { ModelessChooser } = await import('/src/index.js');
        const events = [];
        for (const suffix of ['one', 'two']) {
            const root = document.querySelector(`#${suffix}`);
            const chooser = new ModelessChooser({ root, title: document.querySelector(`#title-${suffix}`), closeButton: document.querySelector(`#close-${suffix}`), onChoose: () => {}, returnFocus: document.querySelector('#composer') });
            chooser.choice(document.querySelector(`#choice-${suffix}`), suffix);
            root.addEventListener('chooser:closed', () => { events.push(suffix); chooser.destroy(); });
            chooser.open(suffix);
            if (suffix === 'one') chooser.close({ focusReturn: true });
            else chooser.destroy();
            chooser.destroy();
        }
        return { events, focus: document.activeElement.id, hidden: [document.querySelector('#one').hidden, document.querySelector('#two').hidden] };
    });
    expect(result).toEqual({ events: ['one', 'two'], focus: 'composer', hidden: [true, true] });
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
