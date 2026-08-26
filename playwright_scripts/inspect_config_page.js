const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

async function main() {
    const root = path.resolve(__dirname, '..');
    const renderedPath = path.join(root, 'tmp', 'config-page-rendered.html');
    let html = fs.readFileSync(renderedPath, 'utf8');
    html = html
        .replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.addStyleTag({ path: path.join(root, 'public', 'css', 'main.css') });
    await page.addStyleTag({ path: path.join(root, 'public', 'css', 'config.css') });
    await page.evaluate(() => {
        window.__configInspectionFetches = [];
        window.fetch = async (url, options = {}) => {
            window.__configInspectionFetches.push({ url: String(url), method: options.method || 'GET' });
            if (String(url) === '/api/game-config-override') {
                return {
                    ok: true,
                    json: async () => ({
                        success: true,
                        message: 'Saved for inspection.',
                        gameConfigOverrideYaml: JSON.parse(options.body).yaml
                    })
                };
            }
            return {
                ok: true,
                json: async () => ({ model: [], text_encoder: [], vae: [], loras: [], workflows: [] })
            };
        };
    });
    await page.addScriptTag({ path: path.join(root, 'public', 'js', 'widgets', 'searchable-select.js') });
    await page.addScriptTag({ path: path.join(root, 'public', 'js', 'image-workflow-editor.js') });
    await page.addScriptTag({ path: path.join(root, 'public', 'js', 'config.js') });
    await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
    await page.waitForTimeout(50);

    assert.equal(await page.locator('[data-config-tab-target]').count(), 6);
    assert.equal(await page.locator('#config-tab-server').isVisible(), true);
    await page.screenshot({ path: path.join(root, 'tmp', 'config-page-server.png'), fullPage: true });

    await page.locator('[data-config-tab-target="ai"]').click();
    assert.equal(await page.locator('#config-tab-ai > .config-sections > .config-section').count(), 5);
    assert.equal(await page.locator('#config-tab-ai .config-accordion').count(), 0);
    assert.equal(await page.locator('#ai-endpoint').isVisible(), true);
    assert.equal(await page.locator('#ai-codex-command').isVisible(), false);
    await page.screenshot({ path: path.join(root, 'tmp', 'config-page-ai.png'), fullPage: true });

    await page.locator('[data-config-tab-target="images"]').click();
    assert.equal(await page.locator('[data-image-workflow-mode="generation"]').isVisible(), true);
    assert.equal(await page.locator('[data-image-workflow-mode="edit"]').isVisible(), false);
    await page.locator('[data-image-workflow-subtab="edit"]').click();
    assert.equal(await page.locator('[data-image-workflow-mode="edit"]').isVisible(), true);
    assert.match(await page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-preset]').locator('xpath=..').getAttribute('class'), /form-group/);
    for (const action of ['load', 'save', 'save-as']) {
        assert.match(await page.locator(`[data-image-workflow-mode="edit"] [data-image-workflow-${action}]`).getAttribute('class'), /btn-secondary/);
    }
    const editCards = page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-controls] > .config-section');
    assert.equal(await editCards.count(), 3);
    const firstCardBox = await editCards.nth(0).boundingBox();
    const secondCardBox = await editCards.nth(1).boundingBox();
    assert.ok(secondCardBox.y > firstCardBox.y + firstCardBox.height);
    const fluxCache = page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-field="flux_kv_cache"]');
    assert.equal(await fluxCache.isVisible(), true);
    assert.equal(await fluxCache.isChecked(), true);
    await page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-field="family"]').selectOption('qwen');
    assert.equal(await fluxCache.isVisible(), false);
    await page.screenshot({ path: path.join(root, 'tmp', 'config-page-images.png'), fullPage: true });
    await page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-preset]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(root, 'tmp', 'config-page-image-presets.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-config-tab-target="game"]').click();
    assert.equal(await page.locator('#save-game-config-override').isDisabled(), true);
    assert.match(await page.locator('#game-config-save-state').textContent(), /Load a game/);
    await page.screenshot({ path: path.join(root, 'tmp', 'config-page-mobile.png'), fullPage: true });

    await page.locator('#game-config-override-yaml').evaluate((textarea) => {
        textarea.disabled = false;
        textarea.value = 'ai:\n  stream: false\n';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.locator('#save-game-config-override').isEnabled(), true);
    assert.equal(await page.evaluate(() => window.__configInspectionFetches.filter(call => call.url === '/api/game-config-override').length), 0);
    await page.locator('#save-game-config-override').click();
    await page.waitForFunction(() => window.__configInspectionFetches.some(call => call.url === '/api/game-config-override'));
    assert.match(await page.locator('#game-config-save-state').textContent(), /All changes saved/);

    await browser.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
