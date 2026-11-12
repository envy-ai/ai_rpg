const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'views/index.njk'), 'utf8');
function section(start, end) {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    if (from < 0 || to <= from) throw new Error(`Missing dialog source: ${start}`);
    return source.slice(from, to);
}

test('crafting quantity dialog validates input and supports Enter, Cancel, and Escape', async ({ page }) => {
    await page.setContent(section('    <div id="barterQuantityModal"', '    <div id="barterCurrencyConfirmModal"')
        + section('    <div id="craftingModalBackdrop"', '    <div id="moduleWorkbenchModalBackdrop"'));
    await page.addStyleTag({ path: path.join(root, 'public/css/main.css') });
    await page.addScriptTag({ path: path.join(root, 'public/js/widgets/modal-stack.js') });
    await page.addScriptTag({ content: `
        ${['Modal', 'Title', 'CloseBtn', 'Form', 'Message', 'Input', 'Status', 'CancelBtn'].map(name => `const barterQuantity${name} = document.getElementById('barterQuantity${name}');`).join('\n')}
        let barterQuantityDialogState = null;
        ${section('        function setBarterQuantityStatus(', '        function setBarterCurrencyConfirmStatus(')}
        ${section('        if (barterQuantityForm) {', '        if (barterCurrencyConfirmCloseBtn) {')}
        ${section('        if (barterQuantityModal) window.AIRPG_MODAL_STACK.configure', '        if (thingContainerModal) window.AIRPG_MODAL_STACK.configure')}
        window.openQuantity = () => requestBarterQuantity({ thing: { name: 'Iron' }, maxCount: 5, defaultValue: 1, title: 'Select Crafting Quantity' }).then(value => { window.quantityResult = value; });
    ` });
    await page.evaluate(() => { window.AIRPG_MODAL_STACK.setVisible(document.getElementById('craftingModal'), true); window.openQuantity(); });
    await expect(page.locator('#barterQuantityModal')).toBeVisible();
    const quantity = page.locator('#barterQuantityInput');
    const readColors = () => quantity.evaluate(input => {
        const style = getComputedStyle(input);
        const channels = value => value.match(/[\d.]+/g).map(Number);
        return { text: channels(style.color), background: channels(style.backgroundColor), outline: style.outlineStyle };
    });
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await quantity.blur();
        const idle = await readColors();
        expect(idle.text.slice(0, 3).every(channel => channel >= 220)).toBe(true);
        expect(idle.background.slice(0, 3).every(channel => channel <= 80)).toBe(true);
        await quantity.focus();
        const focused = await readColors();
        expect(focused.text.slice(0, 3).every(channel => channel >= 220)).toBe(true);
        expect(focused.background.slice(0, 3).every(channel => channel <= 80)).toBe(true);
        await expect(quantity).toBeFocused();
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('#barterQuantityModal .modal__dialog').screenshot({ path: path.join(root, 'tmp', 'crafting-quantity-input-contrast.png') });
    const expectTop = async id => expect.poll(() => page.evaluate(() => window.AIRPG_MODAL_STACK.top?.id)).toBe(id);
    const expectQuantityClickable = async () => {
        await expectTop('barterQuantityModal');
        expect(await page.locator('#barterQuantityInput').evaluate(element => {
            const rect = element.getBoundingClientRect();
            const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return top === element || element.contains(top);
        })).toBe(true);
    };
    await expectQuantityClickable();
    await page.locator('#barterQuantityInput').fill('6');
    await page.locator('#barterQuantityInput').press('Enter');
    await expect(page.locator('#barterQuantityStatus')).toContainText('1 to 5');
    await page.locator('#barterQuantityInput').fill('3');
    await page.locator('#barterQuantityInput').press('Enter');
    await expect(page.locator('#barterQuantityModal')).toBeHidden();
    await expect(page.locator('#craftingModal')).toBeVisible();
    await expectTop('craftingModal');
    await expect.poll(() => page.evaluate(() => window.quantityResult)).toBe(3);
    await page.evaluate(() => { window.quantityResult = 'pending'; window.openQuantity(); });
    await expectQuantityClickable();
    await page.locator('#barterQuantityCancelBtn').click();
    await expect(page.locator('#craftingModal')).toBeVisible();
    await expectTop('craftingModal');
    await expect.poll(() => page.evaluate(() => window.quantityResult)).toBeNull();
    await page.evaluate(() => { window.quantityResult = 'pending'; window.openQuantity(); });
    await expectQuantityClickable();
    await page.locator('#barterQuantityInput').press('Escape');
    await expect(page.locator('#barterQuantityModal')).toBeHidden();
    await expect(page.locator('#craftingModal')).toBeVisible();
    await expectTop('craftingModal');
    await expect.poll(() => page.evaluate(() => window.quantityResult)).toBeNull();
});
