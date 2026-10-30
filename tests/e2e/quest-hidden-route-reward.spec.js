const { test, expect } = require('@playwright/test');

test('applied route-knowledge reward reveals one route and opens disabled route inspection', async ({ page }) => {
    await page.route('**/api/location-region-membership-conflicts*', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, conflicts: [] })
    }));
    await page.route('**/api/player/fast-travel-preview*', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            origin: { id: 'archive-entry', name: 'Archive Entry', regionId: 'archive-region', regionName: 'Archive Ward' },
            destination: { id: 'sunken-archive', name: 'Sunken Archive', regionId: 'archive-region', regionName: 'Archive Ward', visited: false, isStub: false },
            reachable: true,
            canFastTravel: false,
            blockingReason: { code: 'DESTINATION_UNVISITED', message: 'Visit this destination through normal play before using fast travel.' },
            travelTimeMinutes: 5,
            steps: [{
                exitId: 'concealed-stair', direction: 'down', description: 'A concealed stair descends behind the shelves.',
                fromLocationId: 'archive-entry', fromLocationName: 'Archive Entry', fromRegionId: 'archive-region', fromRegionName: 'Archive Ward',
                toLocationId: 'sunken-archive', toLocationName: 'Sunken Archive', toRegionId: 'archive-region', toRegionName: 'Archive Ward',
                travelTimeMinutes: 5, isVehicle: false, vehicleType: null, destinationIsStub: false
            }]
        })
    }));

    await page.goto('/');
    await page.evaluate(async () => {
        window.guardPendingPlayerAbilitySelection = () => false;
        window.currentPlayerData = { id: 'knowledge-player', name: 'Rook' };
        await window.updateLocationDisplay({
            id: 'archive-entry', name: 'Archive Entry', description: 'Shelves.', shortDescription: 'Shelves.',
            regionName: 'Archive Ward', visited: true, npcs: [], things: [], thingIds: [],
            exits: { down: {
                id: 'concealed-stair', destination: 'sunken-archive', destinationName: 'Sunken Archive',
                destinationVisited: false, travelTimeMinutes: 5, hiddenFromPlayer: true, discoveryDifficulty: 'Hard'
            }}
        });
    });
    await expect(page.locator('#locationExitsList')).not.toContainText('Sunken Archive');

    await page.evaluate(async () => {
        await window.updateLocationDisplay({
            id: 'archive-entry', name: 'Archive Entry', description: 'Shelves.', shortDescription: 'Shelves.',
            regionName: 'Archive Ward', visited: true, npcs: [], things: [], thingIds: [],
            exits: { down: {
                id: 'concealed-stair', destination: 'sunken-archive', destinationName: 'Sunken Archive',
                destinationVisited: false, travelTimeMinutes: 5, hiddenFromPlayer: false, discoveryDifficulty: null
            }}
        });
        window.renderQuestPanel([], [{
            id: 'archive-quest', name: 'The Archivist’s Favor', description: 'Help the archivist.',
            objectives: [{ id: 'o1', description: 'Return the folio.', completed: true, optional: false }],
            rewardCurrency: 0, rewardXp: 0, rewardItems: [], rewardFactionReputation: {}, rewardNpcDispositions: [], rewardNotes: [],
            rewardClaimed: true, appliedRewardBenefitIds: ['knowledge-route:archive-entry:concealed-stair'],
            rewardBenefits: [{
                id: 'knowledge-route:archive-entry:concealed-stair', type: 'knowledge', subtype: 'route',
                targetId: 'concealed-stair', sourceLocationId: 'archive-entry', sourceLocationName: 'Archive Entry',
                destinationLocationId: 'sunken-archive', destinationLocationName: 'Sunken Archive',
                label: 'The concealed stair', description: 'The archivist teaches the opening sequence.'
            }]
        }]);
    });

    await expect(page.locator('#locationExitsList')).toContainText('Sunken Archive');
    const completed = page.locator('#questCompletedAccordion');
    await expect(completed).toContainText('Route knowledge: Archive Entry → Sunken Archive');
    await expect(completed).not.toContainText('Fast travel unlocked');
    await page.locator('#tab-quests-tab').click();
    await completed.locator('.quest-card > summary').click();
    await completed.locator('.quest-view-route-button').click();
    const modal = page.locator('#mapFastTravelConfirmModal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Archive Entry → Sunken Archive');
    await expect(page.locator('#mapFastTravelConfirmBtn')).toBeDisabled();
    await expect(page.locator('#mapFastTravelBlockingReason')).toContainText('Visit this destination');
    await modal.locator('.modal__dialog').screenshot({ path: 'tmp/quest-hidden-route-reward.png' });
});
