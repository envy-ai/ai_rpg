const path = require('node:path');
const { test, expect } = require('@playwright/test');

test('shared faction editor preserves absent edges and explicitly authored neutral', async ({ page }) => {
    await page.setContent('<div id="relations"></div>');
    await page.addScriptTag({ path: path.resolve(__dirname, '../../public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../public/js/faction-editor.js') });
    await page.evaluate(() => {
        const container = document.getElementById('relations');
        container.append(window.FactionEditor.buildRelationRow({ id: 'one', name: 'One' }, null));
        container.append(window.FactionEditor.buildRelationRow({ id: 'two', name: 'Two' }, { status: 'neutral', notes: 'A cautious truce.' }));
        container.append(window.FactionEditor.buildRelationRow({ id: 'three', name: 'Three' }, null));
    });
    const collect = () => page.evaluate(() => window.FactionEditor.collectRelationsFrom(document.getElementById('relations')));
    expect(await collect()).toEqual({ two: { status: 'neutral', notes: 'A cautious truce.' } });
    const first = page.locator('.faction-relation-row').first();
    await first.locator('select').selectOption('allied');
    await first.locator('textarea').fill('A trading agreement.');
    expect(await collect()).toEqual({ one: { status: 'allied', notes: 'A trading agreement.' }, two: { status: 'neutral', notes: 'A cautious truce.' } });
    await first.getByRole('button', { name: 'Clear' }).click();
    expect(await collect()).toEqual({ two: { status: 'neutral', notes: 'A cautious truce.' } });
});

test('faction asset and tier rows retain values and fit at desktop and phone widths', async ({ page }) => {
    await page.setContent('<div id="assets"></div><div id="tiers"></div>');
    await page.addStyleTag({ path: path.resolve(__dirname, '../../public/css/main.css') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../public/js/faction-editor.js') });
    await page.evaluate(() => {
        FactionEditor.appendAssetRow(document.querySelector('#assets'), { name: 'Fleet', type: 'Ships', description: 'A fleet' });
        FactionEditor.appendTierRow(document.querySelector('#tiers'), { threshold: 0, label: 'Neutral', perks: ['Trade'], penalties: [] });
    });
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        const problems = await page.locator('.faction-asset-row, .faction-tier-row').evaluateAll(rows => rows.flatMap(row => {
            const bounds = row.getBoundingClientRect();
            const elements = [...row.querySelectorAll('label, input, textarea, button')].filter(el => el.getClientRects().length);
            const boxes = elements.map(el => ({ el, box: el.getBoundingClientRect() }));
            const issues = [];
            for (const { el, box } of boxes) if (box.left < bounds.left - 1 || box.right > bounds.right + 1) issues.push(`${el.className || el.tagName} outside row`);
            for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i], b = boxes[j];
                if (!a.el.contains(b.el) && !b.el.contains(a.el) && Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1 && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1) issues.push(`${a.el.className || a.el.tagName} overlaps ${b.el.className || b.el.tagName}`);
            }
            return issues;
        }));
        expect(problems).toEqual([]);
    }
    expect(await page.evaluate(() => FactionEditor.collectAssetsFrom(document.querySelector('#assets')))).toEqual([{ name: 'Fleet', type: 'Ships', description: 'A fleet' }]);
    expect(await page.evaluate(() => FactionEditor.collectTiersFrom(document.querySelector('#tiers')))).toEqual([{ threshold: 0, label: 'Neutral', perks: ['Trade'], penalties: [] }]);
    await page.evaluate(() => { FactionEditor.clearAssetRows(document.querySelector('#assets')); FactionEditor.appendAssetRow(document.querySelector('#assets'), { name: 'Again' }); });
    await expect(page.locator('#assets .faction-asset-row')).toHaveCount(1);
});

test('favor editor round-trips a target delivery alongside an existing fixed item grant', async ({ page }) => {
    await page.setContent('<div id="favors"></div>');
    await page.addScriptTag({ path: path.resolve(__dirname, '../../public/js/widgets/controls.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../public/js/faction-editor.js') });
    await page.evaluate(() => {
        const favors = document.querySelector('#favors');
        const base = { shortDescription: 'A gift.', description: 'The guild sends a gift.', minThreshold: 20, cooldown: '1 day', presence: 'anywhere' };
        FactionEditor.appendFavorRow(favors, { ...base, id: 'favor_delivery', name: 'Delivery', requiresTarget: true,
            targetPrompt: 'What should be delivered?', effect: { type: 'grant-item', params: { name: 'Parcel', description: 'A sealed parcel.', contentsSource: 'target' } } });
        FactionEditor.appendFavorRow(favors, { ...base, id: 'favor_fixed', name: 'Writ', requiresTarget: false,
            effect: { type: 'grant-item', params: { name: 'Writ', description: 'A pass.' } } });
    });
    const collected = await page.evaluate(() => FactionEditor.collectFavorsFrom(document.querySelector('#favors')));
    expect(collected[0]).toMatchObject({ id: 'favor_delivery', requiresTarget: true, targetPrompt: 'What should be delivered?',
        effect: { type: 'grant-item', params: { name: 'Parcel', description: 'A sealed parcel.', contentsSource: 'target' } } });
    expect(collected[1]).toMatchObject({ id: 'favor_fixed', requiresTarget: false,
        effect: { type: 'grant-item', params: { name: 'Writ', description: 'A pass.' } } });
});
