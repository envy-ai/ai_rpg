const { test, expect } = require('@playwright/test');

test('shared route inspector renders desktop, mobile, and unavailable routes without moving', async ({ page }) => {
    await page.route('**/api/location-region-membership-conflicts*', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, conflicts: [] })
    }));
    await page.route('**/api/player/fast-travel-preview*', route => {
        const destinationId = new URL(route.request().url()).searchParams.get('destinationId');
        const unavailable = destinationId === 'blocked-location';
        const destination = unavailable
            ? { id: destinationId, name: 'Fogbound Reach', regionId: 'region-1', regionName: 'North Ward', visited: false, isStub: false }
            : { id: destinationId, name: 'Hidden Garden', regionId: 'region-1', regionName: 'North Ward', visited: true, isStub: false };
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(unavailable ? {
                success: true,
                origin: { id: 'origin-location', name: 'Old Gatehouse', regionId: 'region-1', regionName: 'North Ward' },
                destination,
                reachable: false,
                canFastTravel: false,
                blockingReason: { code: 'NO_KNOWN_ROUTE', message: 'No known route is currently available.' },
                travelTimeMinutes: null,
                steps: []
            } : {
                success: true,
                origin: { id: 'origin-location', name: 'Old Gatehouse', regionId: 'region-1', regionName: 'North Ward' },
                destination,
                reachable: true,
                canFastTravel: true,
                blockingReason: null,
                travelTimeMinutes: 12,
                steps: [
                    {
                        exitId: 'exit-1', direction: 'orchard_gate_side', description: 'A narrow stair climbs behind the wall.',
                        fromLocationId: 'origin-location', fromLocationName: 'Old Gatehouse', fromRegionId: 'region-1', fromRegionName: 'North Ward',
                        toLocationId: 'middle-location', toLocationName: 'Wall Walk', toRegionId: 'region-1', toRegionName: 'North Ward',
                        travelTimeMinutes: 4, isVehicle: false, vehicleType: null, destinationIsStub: false
                    },
                    {
                        exitId: 'exit-2', direction: 'east', description: 'A small ferry crosses the moat.',
                        fromLocationId: 'middle-location', fromLocationName: 'Wall Walk', fromRegionId: 'region-1', fromRegionName: 'North Ward',
                        toLocationId: 'destination-location', toLocationName: 'Hidden Garden', toRegionId: 'region-1', toRegionName: 'North Ward',
                        travelTimeMinutes: 8, isVehicle: true, vehicleType: 'ferry', destinationIsStub: false
                    }
                ]
            })
        });
    });

    await page.goto('/');
    await page.evaluate(async () => {
        window.guardPendingPlayerAbilitySelection = () => false;
        window.currentPlayerData = { id: 'route-player', name: 'Rook' };
        await window.updateLocationDisplay({
            id: 'origin-location', name: 'Old Gatehouse', description: 'Gatehouse.', shortDescription: 'Gatehouse.',
            regionName: 'North Ward', visited: true, npcs: [], things: [], thingIds: [],
            exits: {
                east: { id: 'visible-destination', destination: 'destination-location', destinationName: 'Hidden Garden', destinationVisited: true, travelTimeMinutes: 12 },
                west: { id: 'visible-blocked', destination: 'blocked-location', destinationName: 'Fogbound Reach', destinationVisited: false, travelTimeMinutes: 3 }
            }
        });
        window.openMapRouteInspector('destination-location');
    });

    const modal = page.locator('#mapFastTravelConfirmModal');
    await expect(modal).toBeVisible();
    await expect(page.locator('#mapFastTravelRouteSteps > li')).toHaveCount(2);
    await expect(modal).toContainText('12 minutes');
    await expect(modal).toContainText('Vehicle: ferry');
    await expect(modal).not.toContainText('orchard_gate_side');
    await expect(page.locator('#mapFastTravelConfirmBtn')).toBeEnabled();
    await modal.locator('.modal__dialog').screenshot({ path: 'tmp/map-route-inspector-desktop.png' });
    await page.locator('#mapFastTravelCancelBtn').click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { window.openMapRouteInspector('destination-location'); });
    await expect(modal).toBeVisible();
    await modal.locator('.modal__dialog').screenshot({ path: 'tmp/map-route-inspector-mobile.png' });
    await page.locator('#mapFastTravelCancelBtn').click();

    await page.evaluate(() => { window.openMapRouteInspector('blocked-location'); });
    await expect(modal).toBeVisible();
    await expect(page.locator('#mapFastTravelBlockingReason')).toHaveText('No known route is currently available.');
    await expect(page.locator('#mapFastTravelConfirmBtn')).toBeDisabled();
    await expect(page.locator('#mapFastTravelRouteSteps > li')).toHaveCount(0);
    await expect(page.locator('#mapFastTravelRouteSection')).toBeHidden();
    await expect(page.locator('#mapFastTravelActionGroup')).toBeHidden();
    await modal.locator('.modal__dialog').screenshot({ path: 'tmp/map-route-inspector-unavailable.png' });
    await page.locator('#mapFastTravelCancelBtn').click();
    await expect(page.locator('#locationName')).toHaveText('Old Gatehouse');
});
