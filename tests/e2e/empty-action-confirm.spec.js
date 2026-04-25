const { test, expect } = require('@playwright/test');

test('empty chat send asks for confirmation before posting empty action', async ({ page }) => {
    const chatRequests = [];

    await page.route((url) => new URL(url).pathname === '/api/chat/history', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ history: [], count: 0, worldTime: {} })
        });
    });

    await page.route((url) => new URL(url).pathname === '/api/chat', async (route) => {
        chatRequests.push(route.request().postDataJSON());
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                response: 'The scene continues.',
                messages: [
                    {
                        id: 'empty-action-response',
                        role: 'assistant',
                        type: 'player-action',
                        content: 'The scene continues.',
                        timestamp: '2026-04-25T00:00:00.000Z',
                        locationId: 'test-location'
                    }
                ],
                worldTime: {}
            })
        });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#emptyActionConfirmModal')).toBeHidden();
    await page.locator('#sendButton').click();
    await expect(page.locator('#emptyActionConfirmModal')).toBeVisible();
    expect(chatRequests).toHaveLength(0);

    await page.locator('#emptyActionConfirmCancelBtn').click();
    await expect(page.locator('#emptyActionConfirmModal')).toBeHidden();
    await expect(page.locator('#messageInput')).toBeFocused();

    await page.locator('#sendButton').click();
    await page.locator('#emptyActionConfirmSubmitBtn').click();

    await expect.poll(() => chatRequests.length).toBe(1);
    expect(chatRequests[0].messages.at(-1)).toMatchObject({
        role: 'user',
        content: ''
    });
});
