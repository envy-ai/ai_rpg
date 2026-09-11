const { chromium } = require('playwright');

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4351';
const outputDirectory = 'tmp/mobile-theme';

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/api/player', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                player: { name: 'Adventurer', partyMembers: [], quests: [], completedQuests: [] }
            })
        });
    });
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.setAirpgGameLoaded === 'function');
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${outputDirectory}/fixed-menu-live-collapsed.png`, fullPage: false });
    await page.locator('#appHeaderMenuToggle').click();
    // CSS mask assets for panel controls first become visible at this point.
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outputDirectory}/fixed-menu-live-expanded.png`, fullPage: false });
    await browser.close();
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
