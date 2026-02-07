const { test, expect } = require('@playwright/test');

test('new game page renders core form controls', async ({ page }) => {
    const response = await page.goto('/new-game');
    expect(response && response.ok()).toBeTruthy();

    await expect(page.locator('h1')).toContainText('Start a New Game');
    await expect(page.locator('#newGameForm')).toBeVisible();
    await expect(page.locator('#playerName')).toBeVisible();
    await expect(page.locator('#playerLevel')).toBeVisible();
});

test('new game submit redirects immediately to adventure tab', async ({ page }) => {
    await page.route('**/api/new-game', async (route) => {
        if (route.request().method() !== 'POST') {
            await route.fallback();
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true })
        });
    });

    page.on('dialog', async dialog => {
        await dialog.accept();
    });

    const response = await page.goto('/new-game');
    expect(response && response.ok()).toBeTruthy();

    await page.fill('#playerName', 'Playwright Redirect Test');
    await page.click('#startBtn');

    await page.waitForURL(/#tab-adventure$/, { timeout: 3000 });
});
