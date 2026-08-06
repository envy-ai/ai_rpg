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

    test('empty and populated character portraits use identical configured dimensions', async ({ page }) => {
        const metrics = await page.evaluate(async () => {
            const dimensions = window.AIRPG_CONFIG?.characterPortraitDimensions;
            if (!dimensions?.width || !dimensions?.height) {
                throw new Error('Configured character portrait dimensions were not exposed to the client.');
            }

            const portraitImageUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='1600'%3E%3Crect width='1200' height='1600' fill='%232563eb'/%3E%3C/svg%3E";
            const appendPortraitContent = (host, { populated, imageClass = '' } = {}) => {
                if (populated) {
                    const image = document.createElement('img');
                    image.src = portraitImageUrl;
                    image.alt = 'Populated portrait fixture';
                    if (imageClass) {
                        image.className = imageClass;
                    }
                    host.appendChild(image);
                    return image;
                }
                const placeholder = document.createElement('div');
                placeholder.className = imageClass || 'entity-icon-placeholder';
                placeholder.textContent = '🎭';
                host.appendChild(placeholder);
                return placeholder;
            };

            const fixture = document.createElement('div');
            fixture.style.position = 'fixed';
            fixture.style.left = '20px';
            fixture.style.top = '20px';
            fixture.style.zIndex = '5000';
            fixture.style.display = 'flex';
            fixture.style.flexWrap = 'wrap';
            fixture.style.alignItems = 'flex-start';
            fixture.style.gap = '12px';

            const npcCollection = document.createElement('div');
            npcCollection.className = 'location-entity-grid';
            npcCollection.style.width = '300px';
            npcCollection.style.flex = '0 0 300px';
            fixture.appendChild(npcCollection);

            const buildNpcPortrait = (populated) => {
                const card = document.createElement('div');
                card.className = 'entity-card entity-card--npc';
                const portrait = document.createElement('div');
                portrait.className = 'entity-icon';
                const imageLayer = document.createElement('div');
                imageLayer.className = 'entity-image location-entity-image';
                appendPortraitContent(imageLayer, {
                    populated,
                    imageClass: populated ? '' : 'entity-icon-placeholder location-entity-placeholder'
                });
                portrait.appendChild(imageLayer);
                card.appendChild(portrait);
                npcCollection.appendChild(card);
                return { card, portrait, imageLayer };
            };

            const buildPartyPortrait = (populated) => {
                const portrait = document.createElement('div');
                portrait.className = 'party-portrait';
                portrait.style.width = '180px';
                portrait.style.flex = '0 0 auto';
                const imageLayer = document.createElement('div');
                imageLayer.className = 'party-portrait-image';
                appendPortraitContent(imageLayer, {
                    populated,
                    imageClass: populated ? '' : 'party-portrait-placeholder'
                });
                portrait.appendChild(imageLayer);
                fixture.appendChild(portrait);
                return { portrait, imageLayer };
            };

            const buildPlayerPortrait = (populated) => {
                const portrait = document.createElement('div');
                portrait.className = 'chat-player-portrait';
                portrait.style.width = '220px';
                portrait.style.flex = '0 0 auto';
                const imageLayer = document.createElement('div');
                imageLayer.className = 'chat-player-portrait-image';
                appendPortraitContent(imageLayer, {
                    populated,
                    imageClass: populated ? '' : 'chat-player-placeholder'
                });
                portrait.appendChild(imageLayer);
                fixture.appendChild(portrait);
                return { portrait, imageLayer };
            };

            const buildModalPortrait = (populated) => {
                const portrait = document.createElement('div');
                portrait.className = 'npc-view-image';
                appendPortraitContent(portrait, {
                    populated,
                    imageClass: populated ? '' : 'npc-view-image-placeholder'
                });
                fixture.appendChild(portrait);
                return portrait;
            };

            const npc = { empty: buildNpcPortrait(false), populated: buildNpcPortrait(true) };
            const party = { empty: buildPartyPortrait(false), populated: buildPartyPortrait(true) };
            const player = { empty: buildPlayerPortrait(false), populated: buildPlayerPortrait(true) };
            const modal = { empty: buildModalPortrait(false), populated: buildModalPortrait(true) };
            document.body.appendChild(fixture);
            await Promise.all(Array.from(fixture.querySelectorAll('img')).map(image => image.decode()));
            await new Promise(resolve => requestAnimationFrame(() => resolve()));

            const rectOf = element => {
                const rect = element.getBoundingClientRect();
                return { width: rect.width, height: rect.height };
            };
            return {
                expectedRatio: Number(dimensions.width) / Number(dimensions.height),
                npc: {
                    emptyCard: rectOf(npc.empty.card),
                    populatedCard: rectOf(npc.populated.card),
                    empty: rectOf(npc.empty.portrait),
                    populated: rectOf(npc.populated.portrait),
                    emptyLayer: rectOf(npc.empty.imageLayer),
                    populatedLayer: rectOf(npc.populated.imageLayer)
                },
                party: {
                    empty: rectOf(party.empty.portrait),
                    populated: rectOf(party.populated.portrait),
                    emptyLayer: rectOf(party.empty.imageLayer),
                    populatedLayer: rectOf(party.populated.imageLayer)
                },
                player: {
                    empty: rectOf(player.empty.portrait),
                    populated: rectOf(player.populated.portrait),
                    emptyLayer: rectOf(player.empty.imageLayer),
                    populatedLayer: rectOf(player.populated.imageLayer)
                },
                modal: {
                    empty: rectOf(modal.empty),
                    populated: rectOf(modal.populated)
                }
            };
        });

        const expectConfiguredRatio = ({ width, height }) => {
            expect(width).toBeGreaterThan(0);
            expect(height).toBeGreaterThan(0);
            expect(width / height).toBeCloseTo(metrics.expectedRatio, 2);
        };
        const expectMatchingDimensions = ({ empty, populated }) => {
            expect(empty.width).toBeCloseTo(populated.width, 5);
            expect(empty.height).toBeCloseTo(populated.height, 5);
            expectConfiguredRatio(empty);
            expectConfiguredRatio(populated);
        };
        const expectMatchingLayers = ({ emptyLayer, populatedLayer }) => {
            expect(emptyLayer.width).toBeCloseTo(populatedLayer.width, 5);
            expect(emptyLayer.height).toBeCloseTo(populatedLayer.height, 5);
        };
        expect(metrics.npc.emptyCard.width).toBeCloseTo(metrics.npc.populatedCard.width, 5);
        expect(metrics.npc.emptyCard.height).toBeCloseTo(metrics.npc.populatedCard.height, 5);
        expectMatchingDimensions(metrics.npc);
        expectMatchingLayers(metrics.npc);
        expectMatchingDimensions(metrics.party);
        expectMatchingLayers(metrics.party);
        expectMatchingDimensions(metrics.player);
        expectMatchingLayers(metrics.player);
        expectMatchingDimensions(metrics.modal);

        await page.screenshot({ path: 'tmp/character-portrait-placeholder-sizing.png', fullPage: true });
    });
});
