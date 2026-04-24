const { test, expect } = require('@playwright/test');

async function openCraftingModalFromDisabledTrigger(page, selector) {
    await page.locator(selector).evaluate((button) => {
        button.disabled = false;
        button.click();
    });
    await expect(page.locator('#craftingModal')).toBeVisible();
    await expect(page.locator('#craftingActionButton')).toBeEnabled();
    await expect(page.locator('#craftingNoProseButton')).toBeEnabled();
}

test.describe('crafting modal empty-slot submits', () => {
    test('craft submits no selected items as an intentional empty payload', async ({ page }) => {
        let requestPayload = null;
        await page.route('**/api/craft', async (route) => {
            requestPayload = route.request().postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true })
            });
        });

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await openCraftingModalFromDisabledTrigger(page, '#craftItemButton');
        await page.locator('#craftingActionButton').click();

        await expect.poll(() => requestPayload).not.toBeNull();
        expect(requestPayload.mode).toBe('craft');
        expect(requestPayload.craftTargetType).toBe('item');
        expect(requestPayload.itemIds).toEqual([]);
        expect(requestPayload.slots).toEqual([]);
    });

    test('modify-location submits no selected materials as an intentional empty payload', async ({ page }) => {
        let requestPayload = null;
        await page.route('**/api/locations/test-location/modify', async (route) => {
            requestPayload = route.request().postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    location: { id: 'test-location', name: 'Test Location' }
                })
            });
        });

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
            window.lastRenderedLocation = { id: 'test-location', name: 'Test Location' };
        });
        await openCraftingModalFromDisabledTrigger(page, '#modifyLocationButton');
        await page.locator('#craftingNoProseButton').click();

        await expect.poll(() => requestPayload).not.toBeNull();
        expect(requestPayload.mode).toBe('modify-location');
        expect(requestPayload.locationId).toBe('test-location');
        expect(requestPayload.noProse).toBe(true);
        expect(requestPayload.itemIds).toEqual([]);
        expect(requestPayload.slots).toEqual([]);
    });
});
