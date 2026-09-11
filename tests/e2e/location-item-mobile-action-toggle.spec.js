const { test, expect } = require('@playwright/test');

test('mobile location items default to inspect and can switch to direct pickup', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderLocationThingCollections === 'function');

    const toggle = page.locator('#locationItemMobileActionToggle');
    const inspectButton = page.locator('#locationItemInspectModeButton');
    const pickupButton = page.locator('#locationItemPickupModeButton');

    expect(await toggle.evaluate(element => getComputedStyle(element).display)).not.toBe('none');
    await expect(inspectButton).toHaveAttribute('aria-pressed', 'true');
    await expect(pickupButton).toHaveAttribute('aria-pressed', 'false');

    await page.setViewportSize({ width: 900, height: 844 });
    expect(await toggle.evaluate(element => getComputedStyle(element).display)).toBe('none');
    await page.setViewportSize({ width: 390, height: 844 });

    let givePayload = null;
    await page.route('**/api/things/thing_mobile_pickup/give', async route => {
        givePayload = route.request().postDataJSON();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                thing: { id: 'thing_mobile_pickup', name: 'Pocket Stone', thingType: 'item' },
                owner: { id: 'player_mobile_pickup', name: 'Mobile Player', inventory: [] }
            })
        });
    });

    await page.evaluate(() => {
        const thing = {
            id: 'thing_mobile_pickup',
            name: 'Pocket Stone',
            description: 'A small smooth stone.',
            thingType: 'item',
            count: 1
        };
        window.currentPlayerData = { id: 'player_mobile_pickup', name: 'Mobile Player', inventory: [] };
        window.lastRenderedLocation = { id: 'location_mobile_pickup', things: [thing] };
        window.loadCurrentLocation = async () => {};
        window.refreshParty = async () => {};
        window.renderLocationThingCollections(window.lastRenderedLocation, [thing]);
        document.querySelector('[data-thing-id="thing_mobile_pickup"]').dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true
        }));
    });
    await page.waitForTimeout(50);
    expect(givePayload).toBeNull();

    await page.evaluate(() => {
        document.getElementById('locationItemPickupModeButton').click();
        document.querySelector('[data-thing-id="thing_mobile_pickup"] .thing-card-menu-button').click();
    });
    await page.waitForTimeout(50);
    expect(givePayload).toBeNull();

    await page.evaluate(() => {
        document.querySelector('[data-thing-id="thing_mobile_pickup"]').dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true
        }));
    });

    await expect.poll(() => givePayload).toEqual({
        ownerId: 'player_mobile_pickup',
        ownerType: 'player',
        locationId: 'location_mobile_pickup'
    });
    await expect(inspectButton).toHaveAttribute('aria-pressed', 'false');
    await expect(pickupButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-thing-id="thing_mobile_pickup"]')).toHaveCount(0);
});
