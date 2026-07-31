const { test, expect } = require('@playwright/test');

test('summary_error realtime payload displays the server stack in an alert', async ({ page }) => {
    await page.route((url) => new URL(url).pathname === '/api/chat/history', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ history: [], count: 0, worldTime: {} })
        });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => Boolean(window.AIRPG_CHAT))).toBe(true);

    const dialogPromise = page.waitForEvent('dialog');
    const dispatchPromise = page.evaluate(() => {
        window.AIRPG_CHAT.handleWebSocketMessage({
            data: JSON.stringify({
                type: 'summary_error',
                message: 'Scene summary response was empty.',
                stack: 'Error: Scene summary response was empty.\n    at summarizeScenesForHistoryRange (server.js:8384:15)'
            })
        });
    });

    const dialog = await dialogPromise;
    expect(dialog.type()).toBe('alert');
    expect(dialog.message()).toContain('Automatic summary failed:');
    expect(dialog.message()).toContain('Scene summary response was empty.');
    expect(dialog.message()).toContain('server.js:8384:15');
    await dialog.accept();
    await dispatchPromise;
});
