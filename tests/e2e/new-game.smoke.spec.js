const { test, expect } = require('@playwright/test');

test('new game page renders core form controls', async ({ page }) => {
    const response = await page.goto('/new-game');
    expect(response && response.ok()).toBeTruthy();

    await expect(page.locator('.app-header__page-title')).toContainText('New Game');
    await expect(page.locator('#newGameForm')).toBeVisible();
    await expect(page.locator('#playerName')).toBeVisible();
    await expect(page.locator('#playerLevel')).toBeVisible();
    await expect(page.locator('#startMonth')).toBeVisible();
    await expect(page.locator('#startDay')).toBeVisible();

    const secondMonth = page.locator('#startMonth option').nth(1);
    const configuredLength = Number(await secondMonth.getAttribute('data-length-days'));
    const expectedDayCount = Number.isInteger(configuredLength) && configuredLength > 0
        ? configuredLength
        : 31;
    await page.selectOption('#startMonth', '2');
    await expect(page.locator('#startDay option')).toHaveCount(expectedDayCount);
});

test('new game submit redirects immediately to adventure tab', async ({ page }) => {
    let submittedPayload = null;
    await page.route('**/api/new-game', async (route) => {
        if (route.request().method() !== 'POST') {
            await route.fallback();
            return;
        }
        submittedPayload = route.request().postDataJSON();
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
    await page.selectOption('#startMonth', '2');
    await page.selectOption('#startDay', '2');
    await page.click('#startBtn');

    await page.waitForURL(/#tab-adventure$/, { timeout: 3000 });
    await expect.poll(() => submittedPayload).not.toBeNull();
    expect(submittedPayload.startMonth).toBe(2);
    expect(submittedPayload.startDay).toBe(2);
});
