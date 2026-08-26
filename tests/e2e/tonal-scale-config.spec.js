const { test, expect } = require('@playwright/test');

test('tonal scale configuration exposes defaults and submits enabled and disabled values', async ({ page }) => {
    await page.goto('/config');
    await page.locator('[data-config-tab-target="story"]').click();

    const enabled = page.locator('#tonal-scale-evaluation-enabled');
    const interval = page.locator('#tonal-scale-evaluation-interval');
    await expect(enabled).toBeChecked();
    await expect(interval).toHaveValue('5');
    await expect(interval).toHaveAttribute('min', '1');

    const submitted = [];
    await page.route('**/config', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') {
            return route.continue();
        }
        submitted.push(new URLSearchParams(request.postData() || ''));
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                message: 'Configuration captured for test.'
            })
        });
    });

    await enabled.uncheck();
    await interval.fill('7');
    await page.locator('#config-tab-story button[type="submit"]').click();
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0].get('tonal_scale_evaluation.enabled::boolean')).toBe('false');
    expect(submitted[0].get('tonal_scale_evaluation.interval::int')).toBe('7');

    await enabled.check();
    await interval.fill('5');
    await page.locator('#config-tab-story button[type="submit"]').click();
    await expect.poll(() => submitted.length).toBe(2);
    expect(submitted[1].get('tonal_scale_evaluation.enabled::boolean')).toBe('true');
    expect(submitted[1].get('tonal_scale_evaluation.interval::int')).toBe('5');
});
