const { test, expect } = require('@playwright/test');

test('hidden things and exits eye toggles reveal disabled 90 percent preview rows', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
        if (typeof window.updateLocationDisplay !== 'function') {
            throw new Error('updateLocationDisplay is unavailable.');
        }
        window.currentPlayerData = {
            ...(window.currentPlayerData || {}),
            id: 'hidden-smoke-player'
        };
        await window.updateLocationDisplay({
            id: 'hidden-smoke-location',
            name: 'Discovery Test Chamber',
            description: 'A controlled browser-smoke location.',
            shortDescription: 'A controlled browser-smoke location.',
            baseLevel: 4,
            regionName: 'Test Region',
            exits: {
                west: {
                    id: 'visible-exit',
                    destination: 'visible-destination',
                    destinationName: 'Visible Gate',
                    destinationVisited: true,
                    travelTimeMinutes: 5,
                    hiddenFromPlayer: false,
                    discoveryDifficulty: null
                },
                down: {
                    id: 'hidden-exit',
                    destination: 'hidden-destination',
                    destinationName: 'Hidden Passage',
                    destinationVisited: true,
                    travelTimeMinutes: 1,
                    hiddenFromPlayer: true,
                    discoveryDifficulty: 'Hard'
                }
            },
            npcs: [],
            things: [
                {
                    id: 'visible-item',
                    name: 'Visible Coin',
                    description: 'A visible coin.',
                    thingType: 'item',
                    hiddenFromPlayer: false,
                    discoveryDifficulty: null,
                    count: 1
                },
                {
                    id: 'hidden-item',
                    name: 'Hidden Locket',
                    description: 'A locket under loose stone.',
                    thingType: 'item',
                    hiddenFromPlayer: true,
                    discoveryDifficulty: 'Medium',
                    count: 1
                },
                {
                    id: 'hidden-scenery',
                    name: 'Hidden Rune',
                    description: 'A faint rune.',
                    thingType: 'scenery',
                    hiddenFromPlayer: true,
                    discoveryDifficulty: 'Legendary',
                    count: 1
                }
            ],
            thingIds: ['visible-item', 'hidden-item', 'hidden-scenery']
        });
    });

    const exits = page.locator('#locationExitsList');
    await expect(exits).toContainText('Visible Gate');
    await expect(exits).not.toContainText('Hidden Passage');
    await expect(page.locator('#locationItems [data-thing-id="visible-item"]')).toHaveCount(1);
    await expect(page.locator('#locationItems [data-thing-id="hidden-item"]')).toHaveCount(0);
    await expect(page.locator('#locationScenery [data-thing-id="hidden-scenery"]')).toHaveCount(0);

    const exitToggle = page.locator('#toggleHiddenExitsButton');
    await exitToggle.click();
    await expect(exitToggle).toHaveAttribute('aria-pressed', 'true');
    const hiddenExit = exits.locator('.exit-item.is-hidden-from-player');
    await expect(hiddenExit).toContainText('Hidden Passage');
    await expect(hiddenExit).toContainText('Hidden · Hard');
    await expect(hiddenExit.locator('.exit-button')).toBeDisabled();
    await expect(hiddenExit).toHaveCSS('opacity', '0.9');

    const thingToggle = page.locator('#toggleHiddenThingsButton');
    await thingToggle.click();
    await expect(thingToggle).toHaveAttribute('aria-pressed', 'true');
    const hiddenItem = page.locator('#locationItems [data-thing-id="hidden-item"].thing-collection-entry.is-hidden-from-player');
    const hiddenScenery = page.locator('#locationScenery [data-thing-id="hidden-scenery"].thing-collection-entry.is-hidden-from-player');
    await expect(hiddenItem).toContainText('Hidden · Medium');
    await expect(hiddenScenery).toContainText('Hidden · Legendary');
    await expect(hiddenItem).toHaveAttribute('aria-disabled', 'true');
    await expect(hiddenItem).toHaveAttribute('draggable', 'false');
    await expect(hiddenItem).toHaveCSS('opacity', '0.9');
    await expect(hiddenScenery).toHaveCSS('opacity', '0.9');

    await page.locator('.location-exits').screenshot({ path: 'tmp/hidden-exits-toggle.png' });
    await page.locator('.location-things').screenshot({ path: 'tmp/hidden-things-toggle.png' });
});
