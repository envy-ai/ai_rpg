const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '../..');
const environment = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(ROOT, 'views')), {
    autoescape: true
});
const installed = 'styles/installed.safetensors';
const missing = 'styles/removed.safetensors';
const additional = 'styles/additional.safetensors';

async function openEditor(page, { loras = [installed, additional], status = 200, world = false } = {}) {
    const errors = [];
    const writes = [];
    let liveOptions = {
        model: ['base-model.safetensors', 'selected-model.safetensors'],
        text_encoder: ['clip_l.safetensors', 'qwen encoder.safetensors'],
        text_encoder_type: ['clip_l', 'qwen_image', 'stable_diffusion'],
        vae: ['base-vae.safetensors', 'vae selected.safetensors'],
        sampler: ['dpmpp_2m', 'euler_torr', 'heun'],
        scheduler: ['beta', 'karras', 'normal'],
        loras,
        workflows: []
    };
    page.on('pageerror', error => errors.push(error.message));
    const html = environment.renderString(`
        <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="/css/main.css"><link rel="stylesheet" href="/css/config.css"></head><body>
        <div class="container"><div class="config-content">
        {% from "_includes/image-workflow-editor.njk" import workflowTab %}
        <form id="workflow-form">
          <div class="image-workflow-editor">
            {{ workflowTab('generation', 'generation', 'globalGeneration', false, generation, world) }}
            {{ workflowTab('edit', 'edit', 'globalEdit', false, edit, world) }}
          </div>
        </form>
        {% include "_includes/image-workflow-preset-modal.njk" %}
        <script defer src="/js/widgets/searchable-select.js"></script>
        <script defer src="/js/image-workflow-editor.js"></script>
        </div></div>
        </body></html>
    `, {
        generation: {
            model: 'selected-model.safetensors',
            text_encoder: 'qwen encoder.safetensors',
            text_encoder_type: 'qwen_image',
            vae: 'vae selected.safetensors',
            sampler: 'euler_torr',
            scheduler: 'karras',
            loras: [missing, installed],
            steps: 12
        },
        edit: { loras: [missing], steps: 18 },
        world
    });
    await page.route('http://127.0.0.1:4173/**', async route => {
        const { pathname } = new URL(route.request().url());
        if (pathname === '/workflow-fixture') {
            return route.fulfill({ contentType: 'text/html', body: html });
        }
        if (pathname.startsWith('/js/')) {
            return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'public', pathname)) });
        }
        if (pathname.startsWith('/css/')) {
            return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(ROOT, 'public', pathname)) });
        }
        if (pathname === '/api/comfyui/workflow-options') {
            return route.fulfill({
                status,
                json: status === 200
                    ? liveOptions
                    : { error: 'ComfyUI is unavailable.' }
            });
        }
        if (pathname.startsWith('/api/image-workflow-presets')) {
            if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON());
            return route.fulfill({ json: {
                presets: {
                    generation: { 'Saved workflow': { loras: [missing, installed], steps: 24 } },
                    edit: {}
                },
                presetSaveTarget: 'fixture-presets.yaml'
            } });
        }
        throw new Error(`Unexpected fixture request: ${pathname}`);
    });
    await page.goto('http://127.0.0.1:4173/workflow-fixture');
    await expect(page.locator('[data-image-workflow-mode="generation"] [data-image-workflow-preset] option')).toHaveCount(2);
    return { errors, writes, setLiveOptions: next => { liveOptions = { ...liveOptions, ...next }; } };
}

async function serializedSettings(page, mode) {
    return page.evaluate(mode => {
        const data = new FormData(document.getElementById('workflow-form'));
        return JSON.parse(data.get(mode));
    }, mode);
}

test('saving workflow settings removes unavailable LoRAs while retaining valid selections and parameters', async ({ page }) => {
    const { errors } = await openEditor(page);
    expect(await serializedSettings(page, 'generation')).toMatchObject({ loras: [installed], steps: 12 });
    expect(await serializedSettings(page, 'edit')).toMatchObject({ loras: [], steps: 18 });

    const choices = page.locator('[data-image-workflow-mode="generation"] [data-image-workflow-select="loras"]');
    await expect(choices.getByLabel(installed, { exact: true })).toBeChecked();
    await choices.getByRole('searchbox').fill('SAFETENSORS ADDITIONAL');
    expect((await serializedSettings(page, 'generation')).loras).toEqual([installed]);
    await choices.getByLabel(additional, { exact: true }).check();
    expect((await serializedSettings(page, 'generation')).loras).toEqual([installed, additional]);
    await choices.getByRole('searchbox').fill('no matching lora');
    expect((await serializedSettings(page, 'generation')).loras).toEqual([installed, additional]);
    await choices.getByRole('searchbox').fill('');
    await expect(choices.getByLabel(additional, { exact: true })).toBeChecked();
    expect(errors).toEqual([]);
});

test('loading and replacing a preset also removes unavailable LoRAs', async ({ page }) => {
    const { errors, writes } = await openEditor(page);
    const generation = page.locator('[data-image-workflow-mode="generation"]');
    await generation.locator('[data-image-workflow-preset]').selectOption('Saved workflow');
    await generation.locator('[data-image-workflow-load]').click();
    expect(await serializedSettings(page, 'generation')).toMatchObject({ loras: [installed], steps: 24 });
    await generation.locator('[data-image-workflow-save]').click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ overwrite: true, settings: { loras: [installed], steps: 24 } });
    expect(errors).toEqual([]);
});

test('a successfully loaded empty LoRA list clears all selections', async ({ page }) => {
    const { errors } = await openEditor(page, { loras: [] });
    expect((await serializedSettings(page, 'generation')).loras).toEqual([]);
    expect((await serializedSettings(page, 'edit')).loras).toEqual([]);
    expect(errors).toEqual([]);
});

for (const failure of [{ status: 503 }, { loras: null }]) {
    test(`unavailable or invalid live options preserve stored LoRAs (${JSON.stringify(failure)})`, async ({ page }) => {
        const { errors } = await openEditor(page, failure);
        expect((await serializedSettings(page, 'generation')).loras).toEqual([missing, installed]);
        expect((await serializedSettings(page, 'edit')).loras).toEqual([missing]);
        expect(errors).toEqual([]);
    });
}

test('loading a world profile refreshes and cleans its workflow selections', async ({ page }) => {
    const { errors } = await openEditor(page, { world: true });
    await page.evaluate(({ missing, additional }) => {
        const input = document.querySelector('[data-image-workflow-mode="generation"] [data-image-workflow-value]');
        input.value = JSON.stringify({ loras: [missing, additional], steps: 30 });
        input.dispatchEvent(new Event('change'));
    }, { missing, additional });
    expect(await serializedSettings(page, 'generation')).toMatchObject({ loras: [additional], steps: 30 });
    const choices = page.locator('[data-image-workflow-mode="generation"] [data-image-workflow-select="loras"]');
    await expect(choices.getByLabel(additional, { exact: true })).toBeChecked();
    await expect(choices.getByLabel(installed, { exact: true })).not.toBeChecked();
    expect(errors).toEqual([]);
});

test('single workflow choices use nameless native selects and preserve filtering, selection, keyboard, and preset state', async ({ page }) => {
    const { errors, writes } = await openEditor(page);
    const generation = page.locator('[data-image-workflow-mode="generation"]');
    const serializedField = generation.locator('[data-image-workflow-value]');

    for (const field of ['model', 'text_encoder', 'text_encoder_type', 'vae', 'sampler', 'scheduler']) {
        const root = generation.locator(`[data-image-workflow-select="${field}"]`);
        const select = root.locator('select.searchable-select__select');
        const label = await root.getAttribute('data-label');
        await expect(select).toHaveCount(1);
        await expect(select).toHaveAttribute('aria-label', label);
        await expect(select).not.toHaveAttribute('name', /.+/);
        await expect(root.locator('input[type="search"]')).not.toHaveAttribute('name', /.+/);
    }

    await page.screenshot({ path: 'tmp/image-workflow-dropdown-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const clippedControls = await page.locator('.image-workflow-editor [data-image-workflow-controls] input, .image-workflow-editor [data-image-workflow-controls] select').evaluateAll(elements => elements
        .filter(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().right > window.innerWidth + 1)
        .map(element => ({ type: element.type || element.tagName, right: element.getBoundingClientRect().right })));
    expect(clippedControls).toEqual([]);
    await page.screenshot({ path: 'tmp/image-workflow-dropdown-mobile.png', fullPage: true });

    const model = generation.locator('[data-image-workflow-select="model"]');
    await expect(model.locator('select')).toHaveValue('selected-model.safetensors');
    await expect(model.locator('select option[value="selected-model.safetensors"]')).toHaveText('selected-model.safetensors');
    await model.getByRole('searchbox').fill('MODEL absent');
    await expect(model.locator('select option:disabled')).toHaveText('No matching options');
    await expect(model.locator('select')).toHaveValue('selected-model.safetensors');
    expect(JSON.parse(await serializedField.inputValue()).model).toBe('selected-model.safetensors');
    await model.getByRole('searchbox').fill('');

    const textEncoderType = generation.locator('[data-image-workflow-select="text_encoder_type"] select');
    await expect(textEncoderType).toHaveValue('qwen_image');
    await textEncoderType.selectOption('');
    await expect.poll(async () => JSON.parse(await serializedField.inputValue()).text_encoder_type).toBe('');
    await textEncoderType.selectOption('stable_diffusion');
    await expect.poll(async () => JSON.parse(await serializedField.inputValue()).text_encoder_type).toBe('stable_diffusion');

    const sampler = generation.locator('[data-image-workflow-select="sampler"]');
    await sampler.getByRole('searchbox').fill('TORR EUL');
    await expect(sampler.locator('select option')).toHaveText(['Use workflow default', 'euler_torr']);
    await sampler.locator('select').selectOption('euler_torr');
    await expect(sampler.locator('select')).toHaveValue('euler_torr');
    await sampler.getByRole('searchbox').fill('no match');
    await expect(sampler.locator('select')).toHaveValue('euler_torr');
    expect(JSON.parse(await serializedField.inputValue()).sampler).toBe('euler_torr');

    const scheduler = generation.locator('[data-image-workflow-select="scheduler"] select');
    await scheduler.focus();
    await scheduler.press('End');
    await expect(scheduler).toHaveValue('normal');
    await expect.poll(async () => JSON.parse(await serializedField.inputValue()).scheduler).toBe('normal');

    const allWidgetNames = await generation.locator('[data-image-workflow-select] input, [data-image-workflow-select] select').evaluateAll(elements => elements.map(element => element.name));
    expect(allWidgetNames).toEqual(Array(allWidgetNames.length).fill(''));
    await generation.locator('[data-image-workflow-preset]').selectOption('Saved workflow');
    await generation.locator('[data-image-workflow-save]').click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].settings).toMatchObject({ model: 'selected-model.safetensors', text_encoder_type: 'stable_diffusion', sampler: 'euler_torr', scheduler: 'normal' });
    expect(errors).toEqual([]);
});

test('single selection remains visible and serialized after live option refresh removes it', async ({ page }) => {
    const fixture = await openEditor(page);
    const model = page.locator('[data-image-workflow-mode="generation"] [data-image-workflow-select="model"]');
    await expect(model.locator('select')).toHaveValue('selected-model.safetensors');

    fixture.setLiveOptions({
        model: ['base-model.safetensors'],
        text_encoder: ['clip_l.safetensors'],
        vae: ['base-vae.safetensors'],
        sampler: ['heun'],
        scheduler: ['normal']
    });
    await page.reload();

    const refreshedModel = page.locator('[data-image-workflow-mode="generation"] [data-image-workflow-select="model"]');
    await expect(refreshedModel.locator('select')).toHaveValue('selected-model.safetensors');
    await expect(refreshedModel.locator('select option[value="selected-model.safetensors"]')).toHaveText('selected-model.safetensors (unavailable)');
    expect((await serializedSettings(page, 'generation')).model).toBe('selected-model.safetensors');
});

test('world use-global disables native selectors after refresh', async ({ page }) => {
    const html = environment.renderString(`
        {% from "_includes/image-workflow-editor.njk" import workflowTab %}
        <form id="workflow-form"><div class="image-workflow-editor">
          {{ workflowTab('generation', 'generation', 'globalGeneration', true, generation, true) }}
          {{ workflowTab('edit', 'edit', 'globalEdit', false, edit, true) }}
        </div></form>
        {% include "_includes/image-workflow-preset-modal.njk" %}
        <script defer src="/js/widgets/searchable-select.js"></script>
        <script defer src="/js/image-workflow-editor.js"></script>
    `, { generation: { model: 'selected-model.safetensors' }, edit: {} });
    await page.route('http://127.0.0.1:4173/**', async route => {
        const { pathname } = new URL(route.request().url());
        if (pathname === '/world-workflow-fixture') return route.fulfill({ contentType: 'text/html', body: html });
        if (pathname.startsWith('/js/')) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'public', pathname)) });
        if (pathname === '/api/comfyui/workflow-options') return route.fulfill({ json: {
            model: ['base-model.safetensors', 'selected-model.safetensors'], text_encoder: [], vae: [],
            sampler: [], scheduler: [], loras: [installed], workflows: []
        } });
        if (pathname === '/api/image-workflow-presets') return route.fulfill({ json: { presets: { generation: {}, edit: {} } } });
        throw new Error(`Unexpected fixture request: ${pathname}`);
    });
    await page.goto('http://127.0.0.1:4173/world-workflow-fixture');
    const generation = page.locator('[data-image-workflow-mode="generation"]');
    const model = generation.locator('[data-image-workflow-select="model"]');
    await expect(model.locator('select')).toBeDisabled();
    await expect(model.getByRole('searchbox')).toBeDisabled();
    await expect(generation.locator('[data-image-workflow-controls] button')).toHaveCount(3);
    expect(await generation.locator('[data-image-workflow-controls] button').evaluateAll(buttons => buttons.every(button => button.disabled))).toBe(true);
});
