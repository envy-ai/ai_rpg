const { test, expect } = require('@playwright/test');

const transparentBluePixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==',
    'base64'
);

test('faction emblems render at the requested image corners with formatted hover details', async ({ page }) => {
    await page.route('**/api/factions', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            factions: [{
                id: 'faction-ui-test',
                name: 'Azure Watch',
                shortDescription: 'Wardens of the eastern roads.',
                homeRegionName: 'Aster Vale',
                goals: ['Keep the roads safe', 'Protect border villages'],
                reputationTiers: [
                    { threshold: 0, label: 'Neutral' },
                    { threshold: 25, label: 'Trusted' }
                ],
                imageId: 'faction-ui-image'
            }],
            playerStandings: { 'faction-ui-test': 31 }
        })
    }));
    await page.route('**/api/images/faction-ui-image/file', route => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: transparentBluePixel
    }));
    await page.route('**/api/map/region**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            region: {
                regionId: 'region-ui-test',
                regionName: 'Aster Vale',
                controllingFactionId: 'faction-ui-test',
                currentLocationId: 'location-ui-test',
                locations: [{
                    id: 'location-ui-test',
                    name: 'Eastern Gate',
                    isStub: false,
                    isVehicle: false,
                    vehicleIcon: null,
                    visited: true,
                    favorite: false,
                    regionId: 'region-ui-test',
                    exits: []
                }]
            }
        })
    }));

    await page.goto('/');
    await page.evaluate(() => {
        if (typeof window.attachFactionEmblem !== 'function') {
            throw new Error('attachFactionEmblem is unavailable on the Play page.');
        }
        const stage = document.createElement('div');
        stage.id = 'faction-emblem-test-stage';
        stage.style.cssText = 'position:fixed;inset:80px auto auto 80px;display:flex;gap:24px;z-index:9998';

        const npcHost = document.createElement('div');
        npcHost.id = 'faction-emblem-test-npc';
        npcHost.className = 'entity-icon';
        npcHost.style.cssText = 'width:180px;height:240px;background:#24324a';
        window.attachFactionEmblem(npcHost, {
            factionId: 'faction-ui-test',
            variant: 'npc',
            statusRowCount: 2
        });

        const locationHost = document.createElement('div');
        locationHost.id = 'faction-emblem-test-location';
        locationHost.className = 'location-image';
        locationHost.style.cssText = 'width:420px;height:240px;background:#24324a';
        window.attachFactionEmblem(locationHost, {
            factionId: 'faction-ui-test',
            variant: 'location'
        });

        const regionMapHost = document.createElement('div');
        regionMapHost.id = 'faction-emblem-test-region-map';
        regionMapHost.style.cssText = 'position:relative;width:420px;height:240px;background:#24324a';
        window.attachFactionEmblem(regionMapHost, {
            factionId: 'faction-ui-test',
            variant: 'region-map'
        });

        stage.append(npcHost, locationHost, regionMapHost);
        document.body.appendChild(stage);
    });

    const npcEmblem = page.locator('#faction-emblem-test-npc > .faction-emblem');
    const locationEmblem = page.locator('#faction-emblem-test-location > .faction-emblem');
    const regionMapEmblem = page.locator('#faction-emblem-test-region-map > .faction-emblem');
    await expect(npcEmblem.locator('img')).toHaveCount(1);
    await expect(locationEmblem.locator('img')).toHaveCount(1);
    await expect(regionMapEmblem.locator('img')).toHaveCount(1);
    await expect(npcEmblem).toHaveCSS('bottom', '22px');
    await expect(locationEmblem).toHaveCSS('left', '10px');
    await expect(locationEmblem).toHaveCSS('bottom', '10px');
    await expect(regionMapEmblem).toHaveCSS('top', '16px');
    await expect(regionMapEmblem).toHaveCSS('left', '16px');

    const npcBox = await npcEmblem.boundingBox();
    const regionMapHostBox = await page.locator('#faction-emblem-test-region-map').boundingBox();
    const regionMapBox = await regionMapEmblem.boundingBox();
    expect(npcBox).toBeTruthy();
    expect(regionMapHostBox).toBeTruthy();
    expect(regionMapBox).toBeTruthy();
    expect(regionMapBox.width).toBe(npcBox.width * 2);
    expect(regionMapBox.x - regionMapHostBox.x).toBe(16);
    expect(regionMapBox.y - regionMapHostBox.y).toBe(16);

    await regionMapEmblem.hover();
    const tooltip = page.locator('#inventoryTooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Azure Watch');
    await expect(tooltip).toContainText('Wardens of the eastern roads.');
    await expect(tooltip).toContainText('Aster Vale');
    await expect(tooltip).toContainText('Trusted (+31)');
    await expect(tooltip).toContainText('Keep the roads safe');
    const tooltipEmblem = tooltip.locator('.faction-emblem-tooltip__emblem');
    const tooltipName = tooltip.locator('.faction-emblem-tooltip__name');
    const tooltipDetails = tooltip.locator('.faction-emblem-tooltip__details');
    await expect(tooltipEmblem.locator('img')).toHaveCount(1);
    await expect(tooltipEmblem).toHaveCSS('width', '132px');
    await expect(tooltipEmblem).toHaveCSS('height', '132px');
    const tooltipEmblemBox = await tooltipEmblem.boundingBox();
    const tooltipNameBox = await tooltipName.boundingBox();
    const tooltipDetailsBox = await tooltipDetails.boundingBox();
    expect(tooltipEmblemBox).toBeTruthy();
    expect(tooltipNameBox).toBeTruthy();
    expect(tooltipDetailsBox).toBeTruthy();
    expect(tooltipNameBox.x).toBeGreaterThanOrEqual(tooltipEmblemBox.x + tooltipEmblemBox.width);
    expect(tooltipDetailsBox.y).toBeGreaterThanOrEqual(tooltipEmblemBox.y + tooltipEmblemBox.height);
    await page.screenshot({ path: 'tmp/faction-emblem-overlays.png' });

    await page.evaluate(() => {
        document.getElementById('faction-emblem-test-stage')?.remove();
        window.floatingTooltipController?.hide?.();
    });

    await page.locator('#tab-map-tab').click();
    const liveMapHost = page.locator('#mapContainer');
    const liveMapEmblem = liveMapHost.locator(':scope > .faction-emblem--region-map');
    await expect(liveMapHost).toHaveAttribute('data-region-id', 'region-ui-test');
    await expect(liveMapEmblem.locator('img')).toHaveCount(1);
    const liveMapHostBox = await liveMapHost.boundingBox();
    const liveMapEmblemBox = await liveMapEmblem.boundingBox();
    expect(liveMapHostBox).toBeTruthy();
    expect(liveMapEmblemBox).toBeTruthy();
    expect(liveMapEmblemBox.width).toBe(npcBox.width * 2);
    expect(liveMapEmblemBox.x - liveMapHostBox.x).toBe(17);
    expect(liveMapEmblemBox.y - liveMapHostBox.y).toBe(17);
    await liveMapEmblem.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Azure Watch');
    await page.screenshot({ path: 'tmp/faction-region-map-emblem.png' });

    await page.locator('#tab-factions-tab').click();
    const factionListItem = page.locator('#factionList .faction-list-item').first();
    const factionListEmblem = factionListItem.locator('.faction-list-emblem');
    await expect(factionListItem).toBeVisible();
    await expect(factionListEmblem.locator('img')).toHaveCount(1);
    await expect(factionListItem).toHaveCSS('grid-template-columns', /^44px \d+(?:\.\d+)?px$/);
    const itemBox = await factionListItem.boundingBox();
    const emblemBox = await factionListEmblem.boundingBox();
    expect(itemBox).toBeTruthy();
    expect(emblemBox).toBeTruthy();
    expect(Math.abs(
        (itemBox.y + (itemBox.height / 2)) - (emblemBox.y + (emblemBox.height / 2))
    )).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'tmp/faction-list-emblems.png' });
});

test('system and world settings expose faction emblem prompt and resolution controls', async ({ page }) => {
    await page.route('**/api/comfyui/workflow-options', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ model: [], text_encoder: [], vae: [], loras: [], workflows: [] })
    }));
    await page.route('**/api/image-workflow-presets', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, presets: { generation: {}, edit: {} } })
    }));
    await page.route('**/api/settings/current', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, setting: null })
    }));

    await page.goto('/config');
    await page.locator('[data-config-tab-target="image-prompts"]').click();
    await expect(page.locator('#image-prompt-instructions-faction')).toBeVisible();
    await page.locator('[data-config-tab-target="images"]').click();
    await expect(page.locator('[data-image-workflow-mode="generation"] [data-image-workflow-resolutions] .form-group', {
        hasText: 'Faction resolution'
    })).toBeVisible();

    await page.goto('/settings');
    await page.locator('[data-editor-tab="images"]').click();
    await expect(page.locator('#imagePromptPrefixFaction')).toBeVisible();
    await page.locator('[data-editor-tab="image-prompt-generation"]').click();
    await expect(page.locator('#imagePromptInstructionsFaction')).toBeVisible();
    await page.locator('[data-editor-tab="image-workflows"]').click();
    await expect(page.locator('[data-image-workflow-mode="generation"] [data-image-workflow-resolutions] .form-group', {
        hasText: 'Faction resolution'
    })).toBeVisible();
});
