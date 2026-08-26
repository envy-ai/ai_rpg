const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
    const baseUrl = process.argv[2] || process.env.AIRPG_TEST_URL || 'http://127.0.0.1:4179/';
    const artifactDir = path.resolve(__dirname, '..', 'tmp', 'region-exit-indicator-deletion');
    fs.mkdirSync(artifactDir, { recursive: true });

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const browserErrors = [];
    page.on('console', message => {
        if (message.type() === 'error') {
            browserErrors.push(message.text());
        }
    });
    page.on('pageerror', error => browserErrors.push(error.stack || error.message || String(error)));

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.loadRegionMap === 'function');
        await page.evaluate(() => {
            const realFetch = window.fetch.bind(window);
            const originalCytoscape = window.cytoscape;
            window.cytoscape = new Proxy(originalCytoscape, {
                apply(target, thisArg, argumentsList) {
                    const instance = Reflect.apply(target, thisArg, argumentsList);
                    window.__REGION_EXIT_TEST_CY = instance;
                    return instance;
                }
            });
            window.__REGION_EXIT_TEST_DELETES = [];
            window.fetch = async (input, options = {}) => {
                const url = typeof input === 'string' ? input : input?.url || '';
                if (url.startsWith('/api/map/region')) {
                    return new Response(JSON.stringify({
                        success: true,
                        region: {
                            regionId: 'region_source',
                            regionName: 'Source Region',
                            currentLocationId: 'loc_source',
                            locations: [
                                {
                                    id: 'loc_source',
                                    name: 'Source Gate',
                                    isStub: false,
                                    visited: true,
                                    exits: [
                                        {
                                            id: 'exit_cross_region',
                                            destination: 'loc_remote',
                                            destinationName: 'Remote Gate',
                                            destinationRegion: 'region_remote',
                                            destinationRegionName: 'Remote Region',
                                            destinationRegionExpanded: true,
                                            isVehicle: true,
                                            isVehicleInbound: true,
                                            vehicleIcon: '🚂'
                                        }
                                    ]
                                }
                            ]
                        }
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                if (
                    String(options?.method || 'GET').toUpperCase() === 'DELETE'
                    && url.startsWith('/api/locations/loc_source/exits/exit_cross_region')
                ) {
                    window.__REGION_EXIT_TEST_DELETES.push(url);
                    return new Response(JSON.stringify({ success: true }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                return realFetch(input, options);
            };
        });

        await page.locator('[data-tab="map"]').click();
        await page.evaluate(() => window.loadRegionMap('region_source'));
        await page.waitForFunction(() => {
            const cy = window.__REGION_EXIT_TEST_CY;
            return cy
                && cy.nodes('.region-exit').length === 1
                && cy.edges('.region-exit-edge').length === 1
                && cy.nodes('.vehicle-overlay').length === 1;
        });
        await page.waitForTimeout(700);
        await page.screenshot({
            path: path.join(artifactDir, 'before-delete.png'),
            fullPage: true
        });

        const before = await page.evaluate(() => {
            const cy = window.__REGION_EXIT_TEST_CY;
            const edge = cy.edges('.region-exit-edge').first();
            const renderedPosition = edge.renderedMidpoint();
            const position = edge.midpoint();
            edge.emit({ type: 'cxttap', renderedPosition, position });
            return {
                regionIndicators: cy.nodes('.region-exit').length,
                regionEdges: cy.edges('.region-exit-edge').length,
                vehicleOverlays: cy.nodes('.vehicle-overlay').length
            };
        });

        const deleteButton = page.locator('.map-edge-menu button', { hasText: 'Delete exit' });
        await deleteButton.waitFor({ state: 'visible' });
        await deleteButton.click();
        await page.waitForFunction(() => {
            const cy = window.__REGION_EXIT_TEST_CY;
            return cy
                && cy.nodes('.region-exit').length === 0
                && cy.edges('.region-exit-edge').length === 0
                && cy.nodes('.vehicle-overlay').length === 0;
        });
        await page.waitForTimeout(700);

        const after = await page.evaluate(() => {
            const cy = window.__REGION_EXIT_TEST_CY;
            return {
                regionIndicators: cy.nodes('.region-exit').length,
                regionEdges: cy.edges('.region-exit-edge').length,
                vehicleOverlays: cy.nodes('.vehicle-overlay').length,
                locationNodes: cy.nodes().filter(node => (
                    !node.hasClass('region-exit') && !node.hasClass('vehicle-overlay')
                )).map(node => node.id()),
                deleteRequests: [...window.__REGION_EXIT_TEST_DELETES]
            };
        });

        if (after.locationNodes.length !== 1 || after.locationNodes[0] !== 'loc_source') {
            throw new Error(`Ordinary location nodes changed unexpectedly: ${JSON.stringify(after.locationNodes)}`);
        }
        if (after.deleteRequests.length !== 1) {
            throw new Error(`Expected one authoritative exit deletion: ${JSON.stringify(after.deleteRequests)}`);
        }
        if (browserErrors.length) {
            throw new Error(`Browser errors detected: ${browserErrors.join(' | ')}`);
        }

        await page.screenshot({
            path: path.join(artifactDir, 'after-delete.png'),
            fullPage: true
        });
        fs.writeFileSync(
            path.join(artifactDir, 'result.json'),
            `${JSON.stringify({ before, after, browserErrors }, null, 2)}\n`
        );
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
