const { test, expect } = require('@playwright/test');

test('AI model unload during image generation submits both values', async ({ page }) => {
    await page.goto('/config');
    await page.locator('[data-config-tab-target="ai"]').click();

    const checkbox = page.locator('#ai-unload-during-image-generation');
    await expect(checkbox).toBeVisible();

    const submitted = [];
    await page.route('**/config', async route => {
        if (route.request().method() !== 'POST') {
            return route.continue();
        }
        submitted.push(new URLSearchParams(route.request().postData() || ''));
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true })
        });
    });

    await checkbox.check();
    await page.locator('#config-tab-ai button[type="submit"]').click();
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0].get('ai.unload_during_image_generation::boolean')).toBe('true');

    await checkbox.uncheck();
    await page.locator('#config-tab-ai button[type="submit"]').click();
    await expect.poll(() => submitted.length).toBe(2);
    expect(submitted[1].get('ai.unload_during_image_generation::boolean')).toBe('false');
});
