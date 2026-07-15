const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

async function openNewWorldProfileEditor(page) {
    await page.route((url) => new URL(url).pathname === '/api/settings/current', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, setting: null })
        });
    });
    const response = await page.goto('/settings', { waitUntil: 'networkidle' });
    expect(response && response.ok()).toBeTruthy();

    await expect(page.locator('#formTitle')).toContainText('Create New Setting');

    await page.click('[data-editor-tab="characters"]');
    await expect(page.locator('[data-editor-panel="characters"]')).toHaveClass(/is-active/);

    const hidingAttributeOption = page.locator('#hidingAttribute option:not([value=""])').first();
    const perceptionAttributeOption = page.locator('#perceptionAttribute option:not([value=""])').first();
    await expect(hidingAttributeOption).toHaveCount(1);
    await expect(perceptionAttributeOption).toHaveCount(1);

    const hidingAttribute = await hidingAttributeOption.getAttribute('value');
    const perceptionAttribute = await perceptionAttributeOption.getAttribute('value');
    expect(hidingAttribute).toBeTruthy();
    expect(perceptionAttribute).toBeTruthy();
    await page.selectOption('#hidingAttribute', hidingAttribute);
    await page.selectOption('#perceptionAttribute', perceptionAttribute);

    const modulesPreset = page.locator('#modSetting_modules_applyPreset');
    if (await modulesPreset.count()) {
        await page.click('[data-editor-tab="mod-modules"]');
        await expect(page.locator('[data-editor-panel="mod-modules"]')).toHaveClass(/is-active/);
        page.once('dialog', async (dialog) => {
            await dialog.accept();
        });
        await modulesPreset.selectOption('modules');
        await expect(page.locator('.modules-slot-types-editor__row')).toHaveCount(1);
        await expect(page.locator('[data-module-slot-type-id]')).toHaveValue('module');
    }

    await page.click('[data-editor-tab="basics"]');
    await expect(page.locator('[data-editor-panel="basics"]')).toHaveClass(/is-active/);
}

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

async function selectSettingByName(page, name) {
    const settingItem = page.locator(`.setting-item:has-text("${name}")`).first();
    await expect(settingItem).toBeVisible();
    await settingItem.click();
    await expect(page.locator('#selectedSettingTitle')).toContainText(name);
}

test('renaming creates new id and delete persists across refresh', async ({ page, request }) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const originalName = `PW Persist Original ${stamp}`;
    const renamedName = `PW Persist Renamed ${stamp}`;

    const cleanupIds = [];
    try {
        await openNewWorldProfileEditor(page);

        await page.fill('#name', originalName);
        await page.fill('#theme', 'Fantasy');
        await page.fill('#genre', 'Adventure');
        await page.click('#submitBtn');

        const originalSetting = await waitForSettingName(page, originalName, true);
        expect(originalSetting).toBeTruthy();
        cleanupIds.push(originalSetting.id);

        await selectSettingByName(page, originalName);
        await expect(page.locator('#selectedEditBtn')).toBeEnabled();
        await page.click('#selectedEditBtn');
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
        await selectSettingByName(page, originalName);
        await expect(page.locator('#selectedDeleteBtn')).toBeEnabled();
        await page.click('#selectedDeleteBtn');
        await waitForSettingName(page, originalName, false);

        await page.reload();
        await page.waitForLoadState('domcontentloaded');

        await waitForSettingName(page, originalName, false);
        const renamedAfterReload = await waitForSettingName(page, renamedName, true);
        expect(renamedAfterReload).toBeTruthy();
    } finally {
        for (const id of cleanupIds) {
            try {
                await request.delete(`/api/settings/${id}`);
            } catch (error) {
                console.warn(`Failed cleanup delete for setting ${id}:`, error?.message || error);
            }
        }
    }
});

test('calendar tab saves a generated calendar with the world profile', async ({ page, request }) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const settingName = `PW Calendar Profile ${stamp}`;
    const cleanupIds = [];

    try {
        await openNewWorldProfileEditor(page);

        await page.fill('#name', settingName);
        await page.fill('#theme', 'Fantasy');
        await page.fill('#genre', 'Adventure');

        await page.click('[data-editor-tab="calendar"]');
        await expect(page.locator('[data-editor-panel="calendar"]')).toHaveClass(/is-active/);
        await page.click('#settingsCalendarUseDefaultBtn');
        await expect(page.locator('#settingsCalendarSummary')).toContainText('Common Era');
        await expect(page.locator('#settingsCalendarYearName')).toHaveValue('Common Era');
        await expect(page.locator('.settings-calendar-month-row')).toHaveCount(12);
        await expect(page.locator('.settings-calendar-weekday-row')).toHaveCount(7);
        await expect(page.locator('.settings-calendar-season-row')).toHaveCount(4);
        await expect(page.locator('.settings-calendar-holiday-row')).toHaveCount(10);
        await expect(page.locator('#settingsCalendarJson')).toHaveCount(0);

        await page.click('#submitBtn');

        const savedSetting = await waitForSettingName(page, settingName, true);
        expect(savedSetting).toBeTruthy();
        cleanupIds.push(savedSetting.id);
        expect(savedSetting.calendarDefinition).toBeTruthy();
        expect(savedSetting.calendarDefinition.yearName).toBe('Common Era');
        expect(savedSetting.calendarDefinition.months.length).toBeGreaterThan(0);
    } finally {
        for (const id of cleanupIds) {
            try {
                await request.delete(`/api/settings/${id}`);
            } catch (error) {
                console.warn(`Failed cleanup delete for setting ${id}:`, error?.message || error);
            }
        }
    }
});
