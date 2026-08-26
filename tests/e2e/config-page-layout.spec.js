const { test, expect } = require('@playwright/test');

test('configuration page separates major concerns and uses shared section cards', async ({ page }) => {
    const presetWrites = [];
    await page.route('**/api/comfyui/workflow-options', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            model: ['test-model.safetensors'],
            text_encoder: ['test-encoder.safetensors'],
            vae: ['test-vae.safetensors'],
            loras: ['test-lora.safetensors'],
            workflows: []
        })
    }));
    await page.route('**/api/image-workflow-presets', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, presets: { generation: {}, edit: {} } })
    }));
    await page.route('**/api/image-workflow-presets/*', async route => {
        const body = route.request().postDataJSON();
        presetWrites.push({ url: route.request().url(), body });
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                mode: 'edit',
                name: body.name,
                presets: { generation: {}, edit: { [body.name]: body.settings } },
                presetSaveTarget: 'image-workflow-presets.test.yaml'
            })
        });
    });
    await page.goto('/config');

    await expect(page.locator('#config-save-target')).toContainText('Saving this page modifies');
    await expect(page.locator('#config-save-target code')).not.toBeEmpty();
    const tabs = page.locator('[data-config-tab-target]');
    await expect(tabs).toHaveCount(7);
    await expect(page.locator('#config-tab-server')).toBeVisible();
    await expect(page.locator('#config-tab-ai')).toBeHidden();

    await page.locator('[data-config-tab-target="ai"]').click();
    await expect(page.locator('#config-tab-ai')).toBeVisible();
    await expect(page.locator('#config-tab-ai > .config-sections > .config-section')).toHaveCount(5);
    await expect(page.locator('#config-tab-ai .config-section h2', { hasText: 'Essentials' })).toBeVisible();
    await expect(page.locator('#config-tab-ai .config-section h2', { hasText: 'OpenAI-Compatible Connection' })).toBeVisible();
    await expect(page.locator('#config-tab-ai .config-accordion')).toHaveCount(0);
    await expect(page.locator('#ai-endpoint')).toBeVisible();
    await expect(page.locator('#ai-codex-command')).toBeHidden();

    await page.locator('#ai-backend').selectOption('codex_cli_bridge');
    await expect(page.locator('#config-tab-ai .config-section h2', { hasText: 'Codex Bridge Connection' })).toBeVisible();
    await expect(page.locator('#ai-codex-command')).toBeVisible();
    await expect(page.locator('#ai-endpoint')).toBeHidden();

    await page.locator('[data-config-tab-target="images"]').click();
    await expect(page.locator('[data-image-workflow-mode="generation"]')).toBeVisible();
    await expect(page.locator('[data-image-workflow-mode="edit"]')).toBeHidden();
    await page.locator('[data-image-workflow-subtab="edit"]').click();
    await expect(page.locator('[data-image-workflow-mode="edit"]')).toBeVisible();
    await expect(page.locator('[data-image-workflow-mode="generation"]')).toBeHidden();
    await expect(page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-preset]').locator('xpath=..')).toHaveClass(/form-group/);
    await expect(page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-load]')).toHaveClass(/btn-secondary/);
    await expect(page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-save]')).toHaveClass(/btn-secondary/);
    await expect(page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-save-as]')).toHaveClass(/btn-secondary/);
    await expect(page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-resolutions]')).toHaveCount(0);
    const editCards = page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-controls] > .config-section');
    await expect(editCards).toHaveCount(2);
    const firstCardBox = await editCards.nth(0).boundingBox();
    const secondCardBox = await editCards.nth(1).boundingBox();
    expect(secondCardBox.y - (firstCardBox.y + firstCardBox.height)).toBeGreaterThan(0);
    const fluxCache = page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-field="flux_kv_cache"]');
    await expect(fluxCache).toBeVisible();
    await expect(fluxCache).toBeChecked();
    await page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-field="family"]').selectOption('qwen');
    await expect(fluxCache).toBeHidden();

    await page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-save-as]').click();
    await expect(page.locator('#imageWorkflowPresetModal')).toBeVisible();
    await page.locator('#imageWorkflowPresetName').fill('Painterly Edit');
    await page.locator('#imageWorkflowPresetConfirm').click();
    await expect.poll(() => presetWrites.length).toBe(1);
    expect(presetWrites[0].url).toContain('/api/image-workflow-presets/edit');
    expect(presetWrites[0].body.name).toBe('Painterly Edit');
    expect(presetWrites[0].body.name.endsWith('.yaml')).toBe(false);
    expect(presetWrites[0].body.overwrite).toBe(false);
    expect(presetWrites[0].body.settings).not.toHaveProperty('resolutions');
    await expect(page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-preset]')).toHaveValue('Painterly Edit');
    await expect(page.locator('[data-image-workflow-mode="edit"] [data-image-workflow-preset-status]')).toContainText('image-workflow-presets.test.yaml');
    await page.screenshot({ path: 'tmp/config-image-workflow-shared-presets.png', fullPage: true });

    const submittedConfigurations = [];
    await page.route('**/config', async route => {
        if (route.request().method() !== 'POST') {
            return route.continue();
        }
        submittedConfigurations.push(new URLSearchParams(route.request().postData() || ''));
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, message: 'Saved for layout test.' })
        });
    });
    await page.locator('#config-tab-images button[type="submit"]').click();
    await expect.poll(() => submittedConfigurations.length).toBe(1);
    expect(submittedConfigurations[0].has('searchable-choices')).toBe(false);
    expect(submittedConfigurations[0].has('searchable-choices::string')).toBe(false);

    await page.locator('[data-config-tab-target="image-prompts"]').click();
    await expect(page.locator('#config-tab-image-prompts')).toBeVisible();
    await expect(page.locator('#image-prompt-instructions-character')).toBeVisible();
    await expect(page.locator('#image-prompt-instructions-location')).toBeVisible();
    await expect(page.locator('#image-prompt-instructions-item')).toBeVisible();
    await expect(page.locator('#image-prompt-instructions-scenery')).toBeVisible();
    await page.locator('#image-prompt-instructions-location').fill('Keep architecture grounded and geographically consistent.');
    await page.locator('#config-tab-image-prompts button[type="submit"]').click();
    await expect.poll(() => submittedConfigurations.length).toBe(2);
    expect(submittedConfigurations[1].get('imagegen.image_prompt_instructions.location::string'))
        .toBe('Keep architecture grounded and geographically consistent.');

    await page.locator('[data-config-tab-target="game"]').click();
    await expect(page.locator('#save-game-config-override')).toBeDisabled();
    await expect(page.locator('#game-config-save-state')).toContainText(/Load a game|All changes saved/);
});
