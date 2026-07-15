const path = require('node:path');
const { test, expect } = require('@playwright/test');

const shortcutScriptPath = path.join(__dirname, '..', '..', 'public', 'js', 'modal-submit-shortcuts.js');

test('shared modal shortcut submits forms, activates explicit actions, and ignores filters', async ({ page }) => {
    await page.setContent(`
        <div class="modal" id="formModal">
            <form id="editForm">
                <textarea id="formInput"></textarea>
                <button id="formSubmit" type="submit">Save</button>
            </form>
        </div>
        <div class="modal" id="explicitModal">
            <textarea id="explicitInput" data-ctrl-enter-submit="#explicitSubmit"></textarea>
            <button id="explicitSubmit" type="button">Apply</button>
        </div>
        <div class="modal" id="filterModal">
            <input id="filterInput" type="search">
            <button id="unrelatedAction" type="button">Commit</button>
        </div>
    `);
    await page.addScriptTag({ path: shortcutScriptPath });
    await page.evaluate(() => {
        window.shortcutResults = { formSubmits: 0, explicitClicks: 0, unrelatedClicks: 0 };
        document.getElementById('editForm').addEventListener('submit', (event) => {
            event.preventDefault();
            window.shortcutResults.formSubmits += 1;
        });
        document.getElementById('explicitSubmit').addEventListener('click', () => {
            window.shortcutResults.explicitClicks += 1;
        });
        document.getElementById('unrelatedAction').addEventListener('click', () => {
            window.shortcutResults.unrelatedClicks += 1;
        });
    });

    await page.locator('#formInput').focus();
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => page.evaluate(() => window.shortcutResults.formSubmits)).toBe(1);

    await page.locator('#explicitInput').focus();
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => page.evaluate(() => window.shortcutResults.explicitClicks)).toBe(1);

    await page.locator('#filterInput').focus();
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => page.evaluate(() => window.shortcutResults.unrelatedClicks)).toBe(0);
});

test('common Play page loads the shared modal shortcut helper', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => typeof window.AIRPGModalSubmitShortcuts?.handleModalCtrlEnter)).toBe('function');
});
