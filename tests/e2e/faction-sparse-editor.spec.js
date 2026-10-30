const path = require('node:path');
const { test, expect } = require('@playwright/test');

test('shared faction editor preserves absent edges and explicitly authored neutral', async ({ page }) => {
    await page.setContent('<div id="relations"></div>');
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
