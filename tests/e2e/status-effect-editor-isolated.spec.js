const path = require('node:path');
const { test, expect } = require('@playwright/test');
const ROOT = path.resolve(__dirname, '../..');

test('shared effect fields preserve absent controls and validate saved modifier values', async ({ page }) => {
    await page.setContent('<!doctype html><div id="effects"></div><input id="name"><textarea id="description"></textarea><input id="max" type="number">');
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/status-effect-editor.js') });
    const original = { id: 'effect-1', name: 'Ward', description: 'Original', duration: 7, maxHealthPercent: 0, appliedAt: 0, custom: { key: 'retained' } };
    const result = await page.evaluate(original => {
        const fields = { name: document.querySelector('#name'), description: document.querySelector('#description'), maxHealthPercent: document.querySelector('#max') };
        window.StatusEffectFields.populate(fields, original);
        fields.description.value = 'Changed';
        const preserved = window.StatusEffectFields.read(fields, original, 'effect');
        fields.maxHealthPercent.value = '';
        const omitted = window.StatusEffectFields.read(fields, original, 'effect');
        const modifiers = new window.ModifierEditor({ getOptions: () => ({ attributes: [{ key: 'strength', label: 'Strength' }], skills: [], needBars: [{ key: 'hunger', label: 'Hunger' }] }), allowNeedBars: true });
        const editor = new window.StatusEffectEditor(document.querySelector('#effects'), { modifiers, editableName: true });
        editor.render([{ ...original, attributes: [{ attribute: 'unknown', modifier: 0, percentModifier: 0 }], needBars: [{ name: 'hunger', delta: 0 }] }]);
        const collected = editor.collect();
        const root = document.querySelector('#effects');
        const options = [...root.querySelectorAll('.thing-modifier-select option[data-unavailable]')].map(option => option.textContent);
        editor.destroy(); editor.destroy();
        return { preserved, omitted, collected, options };
    }, original);
    expect(result.preserved).toMatchObject({ ...original, description: 'Changed' });
    expect(result.omitted).not.toHaveProperty('maxHealthPercent');
    expect(result.omitted.duration).toBe(7);
    expect(result.collected[0]).toMatchObject({ ...original, attributes: [{ attribute: 'unknown', modifier: 0, percentModifier: 0 }], needBars: [{ name: 'hunger', delta: 0 }] });
    expect(result.options).toEqual([expect.stringMatching(/unknown.*unavailable/i)]);
});

test('labeled modifier fields fit desktop and phone widths and expose percentage need rates', async ({ page }) => {
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div class="container"><div id="effects"></div></div>');
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/status-effect-editor.js') });
    await page.evaluate(() => {
        const modifiers = new window.ModifierEditor({ getOptions: () => ({ attributes: [{ key: 'strength', label: 'Strength' }], skills: [], needBars: [{ key: 'hunger', label: 'Hunger' }] }), allowNeedBars: true });
        window.editor = new window.StatusEffectEditor(document.querySelector('#effects'), { modifiers, editableName: true });
        window.editor.render([{ name: 'Ward', description: 'Test', attributes: [{ attribute: 'strength', modifier: 0, percentModifier: 0 }], needBars: [{ name: 'hunger', delta: 0 }] }]);
    });
    const rows = page.locator('.thing-modifier-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first().getByLabel('Percentage modifier')).toBeVisible();
    await expect(rows.nth(1).getByLabel('Percentage points per minute')).toBeVisible();
    for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 800 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const box = await rows.first().boundingBox();
        const overflowFields = await rows.first().locator('.thing-modifier-field').evaluateAll(fields => fields.filter(field => field.scrollWidth > field.clientWidth + 1).map(field => field.textContent.trim()));
        expect(overflowFields).toEqual([]);
        const collisions = await rows.first().evaluate(row => {
            const bounds = [...row.querySelectorAll('label, input, select')].filter(node => node.getClientRects().length).map(node => ({ name: node.getAttribute('aria-label') || node.textContent.trim(), rect: node.getBoundingClientRect() }));
            return bounds.flatMap((a, i) => bounds.slice(i + 1).filter(b => Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 1 && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 1).map(b => [a.name, b.name]));
        });
        expect(collisions).toEqual([]);
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `tmp/status-effects-${width}.png`, fullPage: true });
    }
    await page.evaluate(() => window.editor.destroy());
});

test('need rate and capacity controls preserve fixed and percentage values', async ({ page }) => {
    await page.setContent('<!doctype html><div id="effects"></div>');
    await page.addStyleTag({ path: path.join(ROOT, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'public/js/status-effect-editor.js') });
    await page.evaluate(() => {
        const modifiers = new window.ModifierEditor({ getOptions: () => ({ attributes: [], skills: [], needBars: [{ key: 'stamina', label: 'Stamina' }] }), allowNeedBars: true });
        window.editor = new window.StatusEffectEditor(document.querySelector('#effects'), { modifiers, editableName: true });
        window.editor.render([{ name: 'Rested', description: 'Recovery.', needBars: [{ name: 'stamina', delta: 0, percentDelta: 0.25 }], needBarMaximums: [{ name: 'stamina', percentModifier: 5 }] }]);
    });
    const rows = page.locator('.thing-modifier-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByLabel('Percentage points per minute')).toHaveValue('0.25');
    await expect(rows.nth(1).getByLabel('Maximum capacity change (%)')).toHaveValue('5');
    await rows.nth(0).getByLabel('Percentage points per minute').fill('0');
    await rows.nth(1).getByLabel('Maximum capacity change (%)').fill('10');
    const result = await page.evaluate(() => window.editor.collect());
    expect(result[0].needBars).toEqual([{ name: 'stamina', delta: 0, percentDelta: 0 }]);
    expect(result[0].needBarMaximums).toEqual([{ name: 'stamina', percentModifier: 10 }]);
    await page.evaluate(() => window.editor.destroy());
});
