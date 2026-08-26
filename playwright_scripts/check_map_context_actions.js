const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
    const baseUrl = process.argv[2] || process.env.AIRPG_TEST_URL || 'http://127.0.0.1:7777/';
    const artifactDir = path.resolve(__dirname, '..', 'tmp', 'map-context-actions-check');
    fs.mkdirSync(artifactDir, { recursive: true });

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', message => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });
    page.on('pageerror', error => pageErrors.push(error.stack || error.message));

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.openLocationContextMenuForLocationId === 'function');

        const menuState = await page.evaluate(() => {
            const menu = document.getElementById('mapLocationContextMenu');
            const teleportButton = document.getElementById('mapLocationMenuTeleportPlayerButton');
            if (!menu || !teleportButton) {
                throw new Error('The shared map location context menu or teleport button is missing.');
            }
            menu.style.left = '420px';
            menu.style.top = '150px';
            menu.hidden = false;
            menu.classList.add('is-open');
            return {
                teleportLabel: teleportButton.textContent.trim(),
                itemCount: menu.querySelectorAll('button').length
            };
        });

        const menu = page.locator('#mapLocationContextMenu');
        const teleport = page.locator('#mapLocationMenuTeleportPlayerButton');
        await menu.waitFor({ state: 'visible' });
        await teleport.waitFor({ state: 'visible' });
        const teleportButtonVisible = await teleport.isVisible();
        await page.screenshot({
            path: path.join(artifactDir, 'hydrated-location-menu.png'),
            fullPage: true
        });

        if (menuState.teleportLabel !== 'Teleport Player Here') {
            throw new Error(`Unexpected teleport button label: ${menuState.teleportLabel || 'none'}`);
        }

        const result = {
            menuState,
            teleportButtonVisible,
            consoleErrors,
            pageErrors
        };
        fs.writeFileSync(path.join(artifactDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);

        if (consoleErrors.length || pageErrors.length) {
            throw new Error(`Browser errors detected: ${JSON.stringify({ consoleErrors, pageErrors })}`);
        }
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
