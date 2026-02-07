const { test, expect } = require('@playwright/test');

async function fetchSettings(page) {
    return page.evaluate(async () => {
        const response = await fetch('/api/settings');
        return response.json();
    });
}

async function waitForSettingName(page, name, shouldExist, timeoutMs = 20000) {
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < timeoutMs) {
        const payload = await fetchSettings(page);
        if (!payload || !payload.success || !Array.isArray(payload.settings)) {
            throw new Error('Failed to fetch settings list while waiting for setting state.');
        }
        const found = payload.settings.find(setting => setting.name === name) || null;
        if ((shouldExist && found) || (!shouldExist && !found)) {
            return found;
        }
        await page.waitForTimeout(300);
    }
    throw new Error(`Timed out waiting for setting "${name}" existence=${shouldExist}.`);
}

test('renaming creates new id and delete persists across refresh', async ({ page }) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const originalName = `PW Persist Original ${stamp}`;
    const renamedName = `PW Persist Renamed ${stamp}`;

    const cleanupIds = [];
    try {
        const response = await page.goto('/settings');
        expect(response && response.ok()).toBeTruthy();

        await page.fill('#name', originalName);
        await page.fill('#theme', 'Fantasy');
        await page.fill('#genre', 'Adventure');
        await page.click('#submitBtn');

        const originalSetting = await waitForSettingName(page, originalName, true);
        expect(originalSetting).toBeTruthy();
        cleanupIds.push(originalSetting.id);

        await page.locator(`.setting-item:has-text("${originalName}") .btn-edit`).first().click();
        await page.fill('#name', renamedName);
        await page.click('#submitBtn');

        const originalAfterRename = await waitForSettingName(page, originalName, true);
        const renamedSetting = await waitForSettingName(page, renamedName, true);
        expect(originalAfterRename).toBeTruthy();
        expect(renamedSetting).toBeTruthy();
        expect(renamedSetting.id).not.toBe(originalAfterRename.id);
        cleanupIds.push(renamedSetting.id);

        page.once('dialog', async dialog => {
            await dialog.accept();
        });
        await page.locator(`.setting-item:has-text("${originalName}") .btn-delete`).first().click();
        await waitForSettingName(page, originalName, false);

        await page.reload();
        await page.waitForLoadState('domcontentloaded');

        await waitForSettingName(page, originalName, false);
        const renamedAfterReload = await waitForSettingName(page, renamedName, true);
        expect(renamedAfterReload).toBeTruthy();
    } finally {
        for (const id of cleanupIds) {
            await page.evaluate(async (settingId) => {
                await fetch(`/api/settings/${settingId}`, { method: 'DELETE' });
            }, id);
        }
    }
});

