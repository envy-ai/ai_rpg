const { test, expect } = require('@playwright/test');

const primaryNavLabels = ['Play', 'New Game', 'Worlds', 'Lorebooks', 'System', 'Tools'];

const topLevelRoutes = [
    { url: '/', currentPage: 'chat', title: 'Play' },
    { url: '/new-game', currentPage: 'new-game', title: 'New Game' },
    { url: '/settings', currentPage: 'settings', title: 'World Profiles' },
    { url: '/config', currentPage: 'config', title: 'System Configuration' },
    { url: '/lorebooks', currentPage: 'lorebooks', title: 'Lorebooks' },
    { url: '/debug', currentPage: 'debug', title: 'Debug' },
    { url: '/player-stats', currentPage: 'player-stats', title: 'Player Stats' }
];

async function expectHeaderBasics(page, route) {
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

    test('mobile header keeps controls non-overlapping and tools menu flows inside viewport', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/debug', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.app-header')).toBeVisible();
        await expect(page.locator('.app-tools-menu__panel')).toBeVisible();

        const result = await page.locator('.app-header').evaluate((header) => {
            const viewportWidth = window.innerWidth;
            const controls = Array.from(header.querySelectorAll('a, button, summary'))
                .map((element) => {
                    const rect = element.getBoundingClientRect();
                    return {
                        label: element.textContent.trim(),
                        left: Math.max(0, rect.left),
                        right: Math.min(viewportWidth, rect.right),
                        top: rect.top,
                        bottom: rect.bottom,
                        width: rect.width,
                        height: rect.height,
                        visible: rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < viewportWidth
                    };
                })
                .filter((rect) => rect.visible);

            const overlaps = [];
            for (let i = 0; i < controls.length; i += 1) {
                for (let j = i + 1; j < controls.length; j += 1) {
                    const a = controls[i];
                    const b = controls[j];
                    const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                    const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                    if (horizontal > 1 && vertical > 1) {
                        overlaps.push(`${a.label} overlaps ${b.label}`);
                    }
                }
            }

            const nav = header.querySelector('.app-nav');
            const toolsPanel = header.querySelector('.app-tools-menu__panel');
            const toolsPanelRect = toolsPanel.getBoundingClientRect();

            return {
                overlaps,
                navDisplay: getComputedStyle(nav).display,
                navFlexWrap: getComputedStyle(nav).flexWrap,
                toolsPanelLeft: toolsPanelRect.left,
                toolsPanelRight: toolsPanelRect.right,
                toolsPanelWidth: toolsPanelRect.width,
                navLabels: Array.from(nav.querySelectorAll('.app-nav__label')).map((element) => element.textContent.trim())
            };
        });

        expect(result.overlaps).toEqual([]);
        expect(result.navDisplay).toBe('flex');
        expect(result.navFlexWrap).toBe('wrap');
        expect(result.toolsPanelLeft).toBeGreaterThanOrEqual(0);
        expect(result.toolsPanelRight).toBeLessThanOrEqual(390);
        expect(result.toolsPanelWidth).toBeLessThanOrEqual(390);
        expect(result.navLabels).toEqual(['Play', 'New Game', 'Worlds', 'Lorebooks', 'System', 'Tools', 'Debug', 'Player Stats']);
    });
});
