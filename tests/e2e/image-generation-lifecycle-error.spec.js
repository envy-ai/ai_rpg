const { test, expect } = require('@playwright/test');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

test('realtime image lifecycle failures open persistent PageFeedback error details', async ({ page }) => {
    await page.setContent('<!doctype html><html><body><form id="chatForm"></form><button id="trigger" type="button">Image request</button></body></html>');
    await page.addScriptTag({ path: path.join(repoRoot, 'public/js/page-feedback.js') });
    await page.addScriptTag({ path: path.join(repoRoot, 'public/js/chat.js') });

    const stack = [
        'AggregateError: render and recovery failed',
        '    at ImageGenerationModelLifecycle.run (ImageGenerationModelLifecycle.js:100:9)',
        '',
        'Underlying errors:',
        '1. Error: Comfy cleanup failed\n    at releaseComfyVram (ImageGenerationModelLifecycle.js:120:8)',
        '',
        '2. Error: Strata restore failed <img src=x onerror=alert(1)>\n    at restore (StrataVramClient.js:150:4)'
    ].join('\n');

    await page.locator('#trigger').focus();
    await page.evaluate(stackText => {
        const chat = Object.create(AIRPGChat.prototype);
        chat.handleWebSocketMessage({ data: JSON.stringify({
            type: 'image_model_lifecycle_error',
            error: 'Image model lifecycle failed',
            stack: stackText
        }) });
    }, stack);

    const dialog = page.locator('dialog.page-feedback-dialog[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toHaveText('Operation stopped');
    await expect(dialog.locator('pre')).toHaveText(stack);
    await expect(dialog.locator('img')).toHaveCount(0);
    await expect(dialog.locator('button', { hasText: 'Close' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.page-feedback-dialog')).toHaveCount(0);
    await expect(page.locator('#trigger')).toBeFocused();

    await page.evaluate(stackText => {
        const chat = Object.create(AIRPGChat.prototype);
        chat.handleWebSocketMessage({ data: JSON.stringify({ type: 'image_model_lifecycle_error', stack: stackText }) });
    }, stack);
    const reopened = page.locator('dialog.page-feedback-dialog[open]');
    await expect(reopened).toBeVisible();
    await reopened.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('dialog.page-feedback-dialog')).toHaveCount(0);
    await expect(page.locator('#trigger')).toBeFocused();
});
