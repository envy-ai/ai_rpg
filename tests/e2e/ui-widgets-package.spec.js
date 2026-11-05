const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const PACKAGE = path.resolve(__dirname, '../../packages/ui-widgets');
const ORIGIN = 'http://widget-fixture.test';

async function openPackage(page, url = '/fixture.html') {
    const errors = [];
    const unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.origin !== ORIGIN) {
            unexpected.push(route.request().url());
            return route.abort();
        }
        if (requestUrl.pathname === '/fixture.html') {
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><main id="host"></main><button id="outside">Outside</button></body></html>' });
        }
        const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
        const filename = path.resolve(PACKAGE, relative);
        if (!filename.startsWith(`${PACKAGE}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
            unexpected.push(route.request().url());
            return route.abort();
        }
        const contentType = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html';
        return route.fulfill({ contentType, body: fs.readFileSync(filename) });
    });
    await page.goto(`${ORIGIN}${url}`);
    return { errors, unexpected };
}

test('standalone specimen loads only package assets and fits desktop and narrow viewports', async ({ page }) => {
    const { errors, unexpected } = await openPackage(page, '/examples/index.html');
    await expect(page.locator('input[type="search"]').first()).toBeVisible();
    await expect(page.locator('details').first()).toBeVisible();
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(element => element.scrollWidth > element.clientWidth + 10 && element.clientWidth > 0).map(element => `${element.tagName.toLowerCase()}#${element.id}.${element.className}`).slice(0, 12) }));
        expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `tmp/ui-widgets-specimen-${width}.png`, fullPage: true });
    }
    expect(await page.evaluate(() => ({ airpg: 'AIRPG' in window, widgets: 'AIRPG_WIDGETS' in window }))).toEqual({ airpg: false, widgets: false });
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
});

test('direct ESM selectors preserve selection, events, disabled state, and lifecycle', async ({ page }) => {
    const { errors, unexpected } = await openPackage(page);
    await page.evaluate(async () => {
        const { SearchableSelect } = await import('/src/index.js');
        const host = document.querySelector('#host');
        host.innerHTML = '<form id="form"><div id="single" data-label="Model" data-placeholder="Find model"></div><div id="multiple" data-label="Layers"></div></form>';
        window.changes = [];
        host.addEventListener('searchable-select-change', event => window.changes.push(['event', event.detail.value]));
        window.single = new SearchableSelect(document.querySelector('#single'), { options: ['Alpha Model', 'Beta Model'], value: 'Alpha Model', onChange: value => window.changes.push(['callback', value]) });
        window.multiple = new SearchableSelect(document.querySelector('#multiple'), { multiple: true, options: ['Red Layer', 'Blue Layer'], value: ['Red Layer'], onChange: value => window.changes.push(['multi', value]) });
    });
    const single = page.locator('#single');
    const multi = page.locator('#multiple');
    await expect(single.getByRole('searchbox')).toHaveAttribute('placeholder', 'Find model');
    await expect(single.getByRole('combobox')).toHaveAccessibleName('Model');
    await single.getByRole('searchbox').fill('MODEL beta');
    await expect(single.getByRole('combobox')).toHaveValue('Alpha Model');
    await expect(single.locator('option')).toContainText(['Alpha Model', 'Beta Model']);
    await single.getByRole('combobox').selectOption('Beta Model');
    await single.getByRole('searchbox').fill('no matches');
    await expect(single.getByRole('combobox')).toHaveValue('Beta Model');
    await page.evaluate(() => { window.single.setValue('Missing Model'); window.single.setOptions(['Alpha Model', 'Beta Model']); });
    await expect(single.locator('option[value="Missing Model"]')).toContainText('(unavailable)');
    await single.getByRole('searchbox').fill('');
    await single.getByRole('combobox').selectOption('');
    await single.getByRole('combobox').focus();
    await single.getByRole('combobox').press('End');
    await expect(single.getByRole('combobox')).toHaveValue('Beta Model');
    expect(await page.evaluate(() => window.changes.filter(([type]) => type === 'callback').length)).toBe(3);
    expect(await page.evaluate(() => window.changes.filter(([type]) => type === 'event').length)).toBe(3);

    await multi.getByRole('searchbox').fill('layer blue');
    await multi.getByLabel('Blue Layer').focus();
    await page.keyboard.press('Space');
    await multi.getByRole('searchbox').fill('');
    await expect(multi.getByLabel('Red Layer')).toBeChecked();
    await expect(multi.getByLabel('Blue Layer')).toBeChecked();
    expect(await page.evaluate(() => { const value = window.multiple.getValue(); value.push('mutated'); return window.multiple.getValue(); })).toEqual(['Red Layer', 'Blue Layer']);
    expect(await page.evaluate(() => [...new FormData(document.querySelector('#form')).entries()])).toEqual([]);
    await page.evaluate(() => { window.preRerenderCheckbox = document.querySelector('#multiple input[type=checkbox]'); window.multiple.setDisabled(true); window.multiple.setOptions(['Red Layer', 'Blue Layer', 'Green Layer']); });
    await expect(multi.getByRole('searchbox')).toBeDisabled();
    await expect(multi.getByLabel('Green Layer')).toBeDisabled();
    expect(await page.evaluate(() => window.multiple.disabled)).toBe(true);
    await page.evaluate(() => { window.multiple.setDisabled(false); document.querySelector('#multiple input[type=search]').disabled = true; window.multiple.setOptions(['Red Layer', 'Blue Layer']); });
    await expect(multi.getByRole('searchbox')).toBeDisabled();
    await expect(multi.getByLabel('Blue Layer')).toBeDisabled();
    await page.evaluate(() => { window.oldSearch = document.querySelector('#multiple input[type=search]'); window.oldCheckbox = document.querySelector('#multiple input[type=checkbox]'); window.changesBeforeDestroy = window.changes.length; window.multiple.destroy(); window.multiple.destroy(); window.oldSearch.dispatchEvent(new Event('input', { bubbles: true })); window.oldCheckbox.dispatchEvent(new Event('change', { bubbles: true })); window.preRerenderCheckbox.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(await page.evaluate(() => window.changes.length)).toBe(await page.evaluate(() => window.changesBeforeDestroy));
    await expect(multi).toBeEmpty();
    expect(await page.evaluate(() => { try { window.multiple.setValue([]); return ''; } catch (error) { return error.message; } })).toMatch(/destroy/i);
    await page.evaluate(async () => { const { SearchableSelect } = await import('/src/index.js'); window.multiple = new SearchableSelect(document.querySelector('#multiple'), { multiple: true, options: ['Remounted'] }); });
    await expect(multi.getByLabel('Remounted')).toBeEnabled();
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
});

test('popup service owns dismissal, focus, detachment, and disposal', async ({ page }) => {
    const { errors, unexpected } = await openPackage(page);
    await page.evaluate(async () => {
        const { createPopupDismissal } = await import('/src/index.js');
        document.querySelector('#host').innerHTML = '<dialog id="outer"><details id="one"><summary>First</summary><button id="action">Open dialog</button></details><details id="two"><summary>Second</summary><button>Second action</button></details><button id="stopped">Outside popup</button></dialog><dialog id="inner"><input aria-label="Dialog input"></dialog>';
        document.querySelector('#outer').showModal();
        document.querySelector('#stopped').addEventListener('click', event => event.stopPropagation());
        window.service = createPopupDismissal({ document });
        window.firstBinding = window.service.bind(document.querySelector('#one'));
        window.secondBinding = window.service.bind(document.querySelector('#two'));
        window.escapeCount = 0;
        document.querySelector('#outer').addEventListener('keydown', event => { if (event.key === 'Escape') window.escapeCount++; });
        document.querySelector('#action').addEventListener('click', () => { window.actionWasClosed = !document.querySelector('#one').open; document.querySelector('#inner').showModal(); document.querySelector('#inner input').focus(); });
    });
    const first = page.locator('#one');
    const second = page.locator('#two');
    await first.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('open', '');
    await second.locator('summary').click();
    await expect(first).not.toHaveAttribute('open', '');
    await expect(second).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(second).not.toHaveAttribute('open', '');
    await expect(second.locator('summary')).toBeFocused();
    expect(await page.evaluate(() => ({ count: window.escapeCount, open: document.querySelector('#outer').open }))).toEqual({ count: 0, open: true });
    await first.locator('summary').click();
    await first.locator('#action').click();
    expect(await page.evaluate(() => window.actionWasClosed)).toBe(true);
    await expect(page.getByLabel('Dialog input')).toBeFocused();
    await page.evaluate(() => document.querySelector('#inner').close());
    await page.evaluate(() => new Promise(resolve => { const one = document.querySelector('#one'); one.addEventListener('toggle', resolve, { once: true }); one.open = true; }));
    expect(await page.evaluate(() => {
        const one = document.querySelector('#one'), two = document.querySelector('#two');
        let closedBeforeAction;
        two.querySelector('button').addEventListener('click', () => { closedBeforeAction = !two.open; }, { once: true });
        two.open = true;
        two.querySelector('button').click();
        return { closedBeforeAction, oneOpen: one.open, twoOpen: two.open };
    })).toEqual({ closedBeforeAction: true, oneOpen: false, twoOpen: false });
    await page.evaluate(() => new Promise(resolve => { const one = document.querySelector('#one'); one.addEventListener('toggle', resolve, { once: true }); one.open = true; }));
    expect(await page.evaluate(() => {
        const one = document.querySelector('#one'), two = document.querySelector('#two');
        two.open = true;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { oneOpen: one.open, twoOpen: two.open };
    })).toEqual({ oneOpen: false, twoOpen: false });
    await page.evaluate(() => { document.querySelector('#one').open = true; document.querySelector('#one').remove(); document.querySelector('#two').open = true; });
    await page.keyboard.press('Escape');
    await expect(second).not.toHaveAttribute('open', '');
    await page.evaluate(() => { window.secondBinding.destroy(); window.service.destroy(); window.service.destroy(); });
    expect(await page.evaluate(() => { try { window.service.bind(document.querySelector('#two')); return ''; } catch (error) { return error.message; } })).toMatch(/destroy/i);
    await page.evaluate(async () => { const { createPopupDismissal } = await import('/src/index.js'); window.service = createPopupDismissal({ document }); window.service.bind(document.querySelector('#two')); });
    await second.locator('summary').click();
    await page.locator('#stopped').dispatchEvent('pointerdown');
    await expect(second).not.toHaveAttribute('open', '');
    await second.locator('summary').click();
    await page.locator('#stopped').click();
    await expect(second).not.toHaveAttribute('open', '');
    await expect(page.locator('#stopped')).toBeFocused();
    await second.locator('summary').click();
    await page.keyboard.press('Escape');
    await expect(second).not.toHaveAttribute('open', '');
    await page.evaluate(() => window.service.destroy());
    const independent = await page.evaluate(async () => {
        const { createPopupDismissal, SearchableSelect } = await import('/src/index.js');
        const frame = document.createElement('iframe');
        document.body.append(frame);
        const doc = frame.contentDocument;
        doc.body.innerHTML = '<div id="choice" data-label="Frame choice"></div><details><summary>Frame popup</summary><button>Action</button></details>';
        const select = new SearchableSelect(doc.querySelector('#choice'), { options: ['Frame option'] });
        const service = createPopupDismissal({ document: doc });
        const details = doc.querySelector('details');
        service.bind(details);
        details.open = true;
        doc.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const result = { closed: !details.open, focused: doc.activeElement === details.querySelector('summary'), owner: doc.querySelector('select').ownerDocument === doc };
        service.destroy(); select.destroy(); frame.remove();
        return result;
    });
    expect(independent).toEqual({ closed: true, focused: true, owner: true });
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
});

test('standalone overlay specimen demonstrates dialog and tooltip interactions', async ({ page }) => {
    const { errors, unexpected } = await openPackage(page, '/examples/index.html');
    await page.locator('#native-open').click();
    const dialog = page.locator('#native-dialog');
    await expect(dialog).toHaveJSProperty('open', true);
    await expect(page.locator('#native-field')).toBeFocused();
    await page.locator('#native-pending').check();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveJSProperty('open', true);
    await page.locator('#native-pending').uncheck();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveJSProperty('open', false);
    await expect(page.locator('#native-open')).toBeFocused();
    await page.locator('#tooltip-text-trigger').hover();
    await expect(page.locator('#specimen-tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#specimen-tooltip')).toBeHidden();
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
});

test('standalone repeated controls preserve drafts and remount independently', async ({ page }) => {
    const { errors, unexpected } = await openPackage(page, '/examples/index.html');
    await page.locator('#sample-draft').fill('Unsaved draft');
    await page.locator('#sample-tab-first').focus(); await page.keyboard.press('ArrowRight');
    await expect(page.locator('#sample-tab-last')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#sample-draft')).toHaveValue('Unsaved draft');
    await page.locator('#sample-number').fill('42');
    await expect(page.locator('#sample-range')).toHaveValue('42');
    await page.locator('#sample-controls-destroy').click();
    await expect(page.locator('#sample-controls-status')).toContainText('destroyed');
    await page.locator('#sample-controls-mount').click();
    await expect(page.locator('#sample-controls-status')).toHaveText('Controls mounted.');
    await expect(page.locator('#sample-draft')).toHaveValue('Unsaved draft');
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('anchored popup portals, dismisses before actions, and cleans up detached triggers', async ({ page }) => {
    const { errors, unexpected } = await openPackage(page);
    await page.evaluate(async () => {
        const { AnchoredPopup } = await import('/src/index.js');
        document.querySelector('#host').innerHTML = '<div id="origin"><button id="trigger">Options</button><div id="popup"><button id="action">Open dialog</button></div><span id="after"></span></div><div id="portal"></div><dialog id="dialog"><input aria-label="Dialog field"></dialog>';
        const root = document.querySelector('#popup'), trigger = document.querySelector('#trigger');
        window.reasons = [];
        window.popup = new AnchoredPopup(root, { trigger, portalTarget: document.querySelector('#portal'), position: ({ root }) => { root.style.left = '10px'; }, onClose: ({ reason }) => window.reasons.push(reason) });
        document.querySelector('#action').addEventListener('click', () => { window.closedBeforeAction = !window.popup.isOpen; document.querySelector('#dialog').showModal(); document.querySelector('#dialog input').focus(); });
        window.popup.open({ initialFocus: document.querySelector('#action') });
    });
    await expect(page.locator('#portal #popup')).toBeVisible();
    await page.locator('#action').click();
    expect(await page.evaluate(() => window.closedBeforeAction)).toBe(true);
    await expect(page.getByLabel('Dialog field')).toBeFocused();
    await expect(page.locator('#origin #popup + #after')).toHaveCount(1);
    await page.evaluate(() => { document.querySelector('#dialog').close(); window.popup.open(); document.querySelector('#trigger').remove(); });
    await expect.poll(() => page.evaluate(() => window.popup.isOpen)).toBe(false);
    expect(await page.evaluate(() => window.reasons)).toEqual(['action', 'detached']);
    await page.evaluate(() => { window.popup.destroy(); window.popup.destroy(); });
    expect(await page.evaluate(() => { try { window.popup.open(); return ''; } catch (error) { return error.message; } })).toMatch(/destroy/i);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('native modal above an anchored popup owns Escape before the popup', async ({ page }) => {
    const { errors, unexpected } = await openPackage(page);
    await page.evaluate(async () => {
        const { AnchoredPopup } = await import('/src/index.js');
        document.querySelector('#host').innerHTML = '<button id="trigger">Trigger</button><div id="popup"><button>Action</button></div><dialog id="native"><button>Native</button></dialog>';
        window.popup = new AnchoredPopup(document.querySelector('#popup'), { trigger: document.querySelector('#trigger') });
        window.popup.open(); document.querySelector('#native').showModal();
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('#native')).toHaveJSProperty('open', false);
    expect(await page.evaluate(() => window.popup.isOpen)).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.popup.isOpen)).toBe(false);
    await expect(page.locator('#trigger')).toBeFocused();
    await page.evaluate(() => window.popup.destroy());
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('standalone surface specimen demonstrates busy, status and notice lifetimes', async ({ page }) => {
    const { errors, unexpected } = await openPackage(page, '/examples/index.html');
    await page.locator('#surface-busy-start').click(); await expect(page.locator('#surface-action')).toBeDisabled();
    await page.locator('#surface-blocked').check(); await page.locator('#surface-busy-end').click();
    await expect(page.locator('#surface-action')).toBeDisabled(); await page.locator('#surface-blocked').uncheck(); await expect(page.locator('#surface-action')).toBeEnabled();
    await page.locator('#surface-status-info').click(); await page.locator('#surface-status-error').click();
    await expect(page.locator('#surface-status')).toContainText('newer status');
    await page.locator('#surface-notice').click(); await expect(page.locator('#surface-notices')).toContainText('Portable transient notice');
    await page.locator('#surface-dismiss').click(); await expect(page.locator('#surface-notices .notice-host__notice')).toHaveCount(0);
    await page.locator('#surface-destroy').click(); await expect(page.locator('#surface-action')).toBeDisabled();
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});

test('standalone conditional specimen retains native values and master eligibility', async ({ page }) => {
    const { errors, unexpected } = await openPackage(page, '/examples/index.html');
    const choice = page.locator('#conditional-choice'), custom = page.locator('#conditional-custom');
    await choice.selectOption('Other'); await expect(custom).toBeVisible(); await expect(custom).toHaveValue('Retained custom text');
    await page.locator('#conditional-master').uncheck(); await expect(custom).toBeDisabled();
    await page.locator('#conditional-master').check(); await expect(custom).toBeEnabled();
    const secret = page.locator('#conditional-secret'), reveal = page.locator('#conditional-reveal');
    await reveal.click(); await expect(secret).toHaveAttribute('type', 'text'); await expect(reveal).toHaveAttribute('aria-pressed', 'true');
    await reveal.click(); await expect(secret).toHaveAttribute('type', 'password'); await expect(secret).toHaveValue('Example text');
    await page.locator('#conditional-show').uncheck(); await expect(page.locator('#conditional-required')).toBeHidden();
    await page.locator('#conditional-show').check(); await expect(page.locator('#conditional-required')).toHaveValue('Retained provider text');
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
});
