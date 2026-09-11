const { test, expect } = require('@playwright/test');

const primaryNavLabels = ['Play', 'New Game', 'Worlds', 'Mods', 'Lorebooks', 'System', 'Tools'];

const topLevelRoutes = [
    { url: '/', currentPage: 'chat', title: 'Play' },
    { url: '/new-game', currentPage: 'new-game', title: 'New Game' },
    { url: '/settings', currentPage: 'settings', title: 'World Profiles' },
    { url: '/mods', currentPage: 'mods', title: 'Mods' },
    { url: '/config', currentPage: 'config', title: 'System Configuration' },
    { url: '/lorebooks', currentPage: 'lorebooks', title: 'Lorebooks' },
    { url: '/debug', currentPage: 'debug', title: 'Debug' },
    { url: '/player-stats', currentPage: 'player-stats', title: 'Player Stats' }
];

async function expectHeaderBasics(page, route) {
    if (route.url === '/settings') {
        await page.route((url) => new URL(url).pathname === '/api/settings/load', async (requestRoute) => {
            await requestRoute.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    result: { count: 0, settings: [], files: [] }
                })
            });
        });
    }
    const response = await page.goto(route.url, { waitUntil: 'domcontentloaded' });
    expect(response && response.ok()).toBeTruthy();

    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('.app-header__page-title')).toContainText(route.title);

    const labels = await page.locator('.app-nav').evaluate((nav) => {
        return Array.from(nav.querySelectorAll(':scope > .app-nav__link .app-nav__label, :scope > .app-tools-menu > .app-tools-menu__summary .app-nav__label'))
            .map((element) => element.textContent.trim());
    });
    expect(labels).toEqual(primaryNavLabels);

    await expect(page.locator(`.app-nav [aria-current="page"]`).first()).toBeVisible();
}

test.describe('shared app header navigation', () => {
    for (const route of topLevelRoutes) {
        test(`renders shared header on ${route.url}`, async ({ page }) => {
            await expectHeaderBasics(page, route);
        });
    }

    test('worlds and system labels disambiguate settings and configuration pages', async ({ page }) => {
        await page.goto('/settings', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.app-nav__link[aria-current="page"]')).toContainText('Worlds');
        await expect(page.locator('.app-header__page-title')).toContainText('World Profiles');

        await page.goto('/config', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.app-nav__link[aria-current="page"]')).toContainText('System');
        await expect(page.locator('.app-header__page-title')).toContainText('System Configuration');
    });

    test('chat exposes save and load actions with stable ids', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#saveGameBtn')).toBeVisible();
        await expect(page.locator('#saveGameBtn .app-header-action__label')).toHaveText('Save');
        await expect(page.locator('#loadGameBtn')).toBeVisible();
        await expect(page.locator('#loadGameBtn .app-header-action__label')).toHaveText('Load');
        await expect(page.locator('.app-header-actions a[href="/new-game"]')).toHaveCount(0);
    });

    test('desktop tools menu paints above page content', async ({ page }) => {
        await page.goto('/debug', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.app-tools-menu__panel')).toBeVisible();

        const result = await page.locator('.app-tools-menu__panel').evaluate((panel) => {
            const rect = panel.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + Math.min(rect.height / 2, rect.height - 2);
            const hit = document.elementFromPoint(x, y);
            const header = document.querySelector('.app-header');

            return {
                hitInsidePanel: Boolean(hit && panel.contains(hit)),
                headerZIndex: header ? getComputedStyle(header).zIndex : 'auto'
            };
        });

        expect(result.hitInsidePanel).toBeTruthy();
        expect(Number.parseInt(result.headerZIndex, 10)).toBeGreaterThan(0);
    });

    test('tablet widths retain the expanded header without overlapping controls', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 844 });
        await page.goto('/debug', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#appHeaderMenuToggle')).not.toBeVisible();
        await expect(page.locator('.app-nav')).toBeVisible();

        const overlaps = await page.locator('.app-header').evaluate(header => {
            const controls = Array.from(header.querySelectorAll('a, button, summary'))
                .map(element => {
                    const rect = element.getBoundingClientRect();
                    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
                })
                .filter(rect => rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight);
            const collisions = [];
            for (let index = 0; index < controls.length; index += 1) {
                for (let otherIndex = index + 1; otherIndex < controls.length; otherIndex += 1) {
                    const first = controls[index];
                    const second = controls[otherIndex];
                    if (Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1
                        && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1) {
                        collisions.push([index, otherIndex]);
                    }
                }
            }
            return collisions;
        });
        expect(overlaps).toEqual([]);
    });

    test('mobile header is fixed, collapsible, and retains the unloaded Load action after hydration', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 480 });
        const playerResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/player');
        await page.route('**/api/player', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    // A server without a game still has a default player object. It must
                    // not promote the primary action to Save during client hydration.
                    player: { name: 'Adventurer', partyMembers: [], quests: [], completedQuests: [] }
                })
            });
        });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await playerResponse;
        await page.waitForFunction(() => typeof window.setAirpgGameLoaded === 'function');

        const header = page.locator('.app-header');
        const toggle = page.locator('#appHeaderMenuToggle');
        const menu = page.locator('#appHeaderMobilePanel');
        const primaryAction = page.locator('#appHeaderPrimaryAction');
        await expect(primaryAction).toHaveAttribute('data-action', 'load');
        await expect(primaryAction).toHaveText('Load');
        await expect(header).not.toHaveClass(/is-menu-open/);
        await expect(menu).not.toBeVisible();

        const idCounts = await page.evaluate(() => ['saveGameBtn', 'loadGameBtn', 'appHeaderPrimaryAction', 'appHeaderMenuToggle', 'appHeaderMobilePanel']
            .map(id => [id, document.querySelectorAll(`#${id}`).length]));
        expect(idCounts).toEqual([
            ['saveGameBtn', 1],
            ['loadGameBtn', 1],
            ['appHeaderPrimaryAction', 1],
            ['appHeaderMenuToggle', 1],
            ['appHeaderMobilePanel', 1]
        ]);

        // A viewport-fixed header has the same viewport-relative top after document scroll.
        await page.evaluate(() => {
            document.body.style.minHeight = '2400px';
            window.scrollTo(0, 700);
        });
        expect(await header.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBe(0);

        await page.evaluate(() => window.scrollTo(0, 0));
        const layoutBefore = await page.locator('.main-content').evaluate(element => ({
            top: element.getBoundingClientRect().top,
            scrollY: window.scrollY
        }));
        await toggle.click();
        await expect(header).toHaveClass(/is-menu-open/);
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(menu).toBeVisible();
        const layoutAfter = await page.locator('.main-content').evaluate(element => ({
            top: element.getBoundingClientRect().top,
            scrollY: window.scrollY
        }));
        expect(layoutAfter).toEqual(layoutBefore);

        // The panel scrolls independently, and its Tools links remain reachable on a short screen.
        await menu.locator('.app-tools-menu__summary').click();
        await menu.evaluate(element => { element.scrollTop = element.scrollHeight; });
        const tools = menu.locator('.app-tools-menu__panel a');
        await expect(tools).toHaveCount(3);
        await expect(tools.last()).toBeVisible();
        const toolsBounds = await tools.evaluateAll(elements => elements.map(element => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        }));
        for (const bounds of toolsBounds) {
            expect(bounds.left).toBeGreaterThanOrEqual(0);
            expect(bounds.right).toBeLessThanOrEqual(320);
        }

        // On a taller phone, the exposed scrim, Escape, and the toggle all collapse the overlay.
        await page.setViewportSize({ width: 390, height: 844 });
        await menu.evaluate(element => { element.scrollTop = 0; });
        await page.locator('.app-header__scrim').click({ position: { x: 4, y: 700 } });
        await expect(header).not.toHaveClass(/is-menu-open/);
        await expect(toggle).toBeFocused();
        await toggle.click();
        await page.keyboard.press('Escape');
        await expect(header).not.toHaveClass(/is-menu-open/);
        await expect(toggle).toBeFocused();
        await toggle.click();
        await toggle.click();
        await expect(header).not.toHaveClass(/is-menu-open/);

        // State changes after a successful game load/new-game setup change only the compact proxy.
        await page.evaluate(() => window.setAirpgGameLoaded(true));
        await expect(primaryAction).toHaveAttribute('data-action', 'save');
        await expect(primaryAction).toHaveText('Save');
    });

    test('a mobile navigation choice closes its overlay before changing routes', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.locator('#appHeaderMenuToggle').click();
        await page.locator('#appHeaderMobilePanel a[href="/mods"]').click();
        await page.waitForURL('**/mods');
        await expect(page.locator('.app-header')).not.toHaveClass(/is-menu-open/);
    });
});
