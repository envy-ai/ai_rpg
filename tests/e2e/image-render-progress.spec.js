const { test, expect } = require('@playwright/test');

test.describe('image render progress overlays', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => (
            window.AIRPG?.imageManager
            && typeof window.AIRPG.imageManager.handleRealtimeJobUpdate === 'function'
        ));
    });

    test('shows spinner progress over placeholders and preserves seasonal location images', async ({ page }) => {
        await page.evaluate(() => {
            const buildThingPlaceholder = ({ id, entityId, icon, left }) => {
                const placeholder = document.createElement('div');
                placeholder.id = id;
                placeholder.className = 'entity-icon';
                placeholder.dataset.imageEntityType = 'thing';
                placeholder.dataset.imageEntityId = entityId;
                placeholder.dataset.imageProcessing = 'true';
                placeholder.style.position = 'fixed';
                placeholder.style.left = left;
                placeholder.style.top = '35%';
                placeholder.style.width = '180px';
                placeholder.style.height = '140px';
                placeholder.style.zIndex = '5000';
                placeholder.innerHTML = `<div class="entity-icon-placeholder">${icon}</div>`;
                document.body.appendChild(placeholder);
            };
            buildThingPlaceholder({
                id: 'test-rendering-item-placeholder',
                entityId: 'rendering-item',
                icon: '🗡️',
                left: '35%'
            });
            buildThingPlaceholder({
                id: 'test-rendering-scenery-placeholder',
                entityId: 'rendering-scenery',
                icon: '🏞️',
                left: '50%'
            });

            const locationImage = document.getElementById('locationImage');
            locationImage.dataset.imageEntityType = 'location';
            locationImage.dataset.imageEntityId = 'seasonal-location';
            locationImage.style.minHeight = '180px';
            locationImage.innerHTML = `
                <img
                    alt="Seasonal location"
                    src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3Crect width='640' height='360' fill='%232563eb'/%3E%3Ccircle cx='510' cy='75' r='35' fill='%23fde68a'/%3E%3Cpath d='M0 300L180 130L330 280L470 150L640 300V360H0Z' fill='%23166534'/%3E%3C/svg%3E"
                >`;

            window.AIRPG.imageManager.handleRealtimeJobUpdate({
                jobId: 'item-render-job',
                status: 'processing',
                progress: 50,
                renderProgress: 42.5,
                renderNodeId: 'sampler-1',
                isRendering: true,
                message: 'Rendering image... 42.5%',
                payload: {
                    entityType: 'item',
                    entityId: 'rendering-item',
                    isLocationWeatherVariant: false
                }
            });
            window.AIRPG.imageManager.handleRealtimeJobUpdate({
                jobId: 'scenery-render-job',
                status: 'processing',
                progress: 50,
                renderProgress: 57,
                renderNodeId: 'sampler-1',
                isRendering: true,
                message: 'Rendering image... 57%',
                payload: {
                    entityType: 'scenery',
                    entityId: 'rendering-scenery',
                    isLocationWeatherVariant: false
                }
            });
            window.AIRPG.imageManager.handleRealtimeJobUpdate({
                jobId: 'seasonal-render-job',
                status: 'processing',
                progress: 50,
                renderProgress: 68,
                renderNodeId: 'sampler-2',
                isRendering: true,
                message: 'Rendering image... 68%',
                payload: {
                    entityType: 'location-variant',
                    entityId: 'seasonal-location',
                    isLocationWeatherVariant: true
                }
            });
        });

        const item = page.locator('#test-rendering-item-placeholder');
        const itemOverlay = item.locator(':scope > .entity-image-render-state');
        await expect(itemOverlay).toHaveCount(1);
        await expect(itemOverlay).not.toHaveClass(/entity-image-render-state--seasonal/);
        await expect(itemOverlay.locator('.entity-image-render-state__spinner')).toHaveCount(1);
        await expect(itemOverlay.locator('.entity-image-render-state__progress')).toHaveAttribute('aria-valuenow', '42.5');
        expect(await itemOverlay.locator('.entity-image-render-state__progress-fill').evaluate(element => element.style.width))
            .toBe('42.5%');

        const scenery = page.locator('#test-rendering-scenery-placeholder');
        const sceneryOverlay = scenery.locator(':scope > .entity-image-render-state');
        await expect(sceneryOverlay).toHaveCount(1);
        await expect(sceneryOverlay.locator('.entity-image-render-state__spinner')).toHaveCount(1);
        await expect(sceneryOverlay.locator('.entity-image-render-state__progress')).toHaveAttribute('aria-valuenow', '57');

        const locationImage = page.locator('#locationImage');
        const seasonalOverlay = locationImage.locator(':scope > .entity-image-render-state');
        await expect(locationImage.locator(':scope > img')).toHaveCount(1);
        await expect(seasonalOverlay).toHaveClass(/entity-image-render-state--seasonal/);
        await expect(seasonalOverlay.locator('.entity-image-render-state__progress')).toHaveAttribute('aria-valuenow', '68');

        await page.screenshot({ path: 'tmp/image-render-progress-overlays.png', fullPage: true });

        await page.evaluate(() => {
            window.AIRPG.imageManager.handleRealtimeJobUpdate({
                jobId: 'item-render-job',
                status: 'completed',
                progress: 100,
                renderProgress: 100,
                isRendering: false,
                payload: { entityType: 'item', entityId: 'rendering-item' },
                result: { imageId: 'done-item' }
            });
            window.AIRPG.imageManager.handleRealtimeJobUpdate({
                jobId: 'scenery-render-job',
                status: 'completed',
                progress: 100,
                renderProgress: 100,
                isRendering: false,
                payload: { entityType: 'scenery', entityId: 'rendering-scenery' },
                result: { imageId: 'done-scenery' }
            });
            window.AIRPG.imageManager.handleRealtimeJobUpdate({
                jobId: 'seasonal-render-job',
                status: 'completed',
                progress: 100,
                renderProgress: 100,
                isRendering: false,
                payload: {
                    entityType: 'location-variant',
                    entityId: 'seasonal-location',
                    isLocationWeatherVariant: true
                },
                result: { imageId: 'done-seasonal' }
            });
        });

        await expect(item.locator(':scope > .entity-image-render-state')).toHaveCount(0);
        await expect(scenery.locator(':scope > .entity-image-render-state')).toHaveCount(0);
        await expect(locationImage.locator(':scope > .entity-image-render-state')).toHaveCount(0);
    });

    test('empty character portraits reserve the configured render aspect ratio', async ({ page }) => {
        const metrics = await page.evaluate(() => {
            const dimensions = window.AIRPG_CONFIG?.characterPortraitDimensions;
            if (!dimensions?.width || !dimensions?.height) {
                throw new Error('Configured character portrait dimensions were not exposed to the client.');
            }

            const fixture = document.createElement('div');
            fixture.style.position = 'fixed';
            fixture.style.left = '20px';
            fixture.style.top = '20px';
            fixture.style.zIndex = '5000';
            fixture.style.display = 'flex';
            fixture.style.gap = '12px';

            const npcCard = document.createElement('div');
            npcCard.className = 'entity-card entity-card--npc';
            const npcPortrait = document.createElement('div');
            npcPortrait.id = 'test-empty-npc-portrait';
            npcPortrait.className = 'entity-icon';
            npcPortrait.innerHTML = '<div class="entity-icon-placeholder">🎭</div>';
            npcCard.appendChild(npcPortrait);

            const partyPortrait = document.createElement('div');
            partyPortrait.id = 'test-empty-party-portrait';
            partyPortrait.className = 'party-portrait';
            partyPortrait.style.width = '180px';
            partyPortrait.innerHTML = '<div class="party-portrait-placeholder">🎭</div>';

            fixture.append(npcCard, partyPortrait);
            document.body.appendChild(fixture);

            const rectOf = element => {
                const rect = element.getBoundingClientRect();
                return { width: rect.width, height: rect.height };
            };
            return {
                expectedRatio: Number(dimensions.width) / Number(dimensions.height),
                npc: rectOf(npcPortrait),
                party: rectOf(partyPortrait),
                player: rectOf(document.getElementById('chatPlayerPortrait'))
            };
        });

        const expectConfiguredRatio = ({ width, height }) => {
            expect(width).toBeGreaterThan(0);
            expect(height).toBeGreaterThan(0);
            expect(width / height).toBeCloseTo(metrics.expectedRatio, 2);
        };
        expectConfiguredRatio(metrics.npc);
        expectConfiguredRatio(metrics.party);
        expectConfiguredRatio(metrics.player);

        await page.screenshot({ path: 'tmp/character-portrait-placeholder-sizing.png', fullPage: true });
    });
});
