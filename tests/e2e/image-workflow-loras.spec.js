const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const yaml = require('js-yaml');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '../..');
const environment = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(ROOT, 'views')), {
    autoescape: true
});
const installed = 'styles/installed.safetensors';
const missing = 'styles/removed.safetensors';
const additional = 'styles/additional.safetensors';

async function openEditor(page, { loras = [installed, additional], status = 200, world = false, config = false } = {}) {
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
        <form id="{% if config %}configForm{% else %}workflow-form{% endif %}">
          <div class="image-workflow-editor">
            {{ workflowTab('generation', 'generation', 'globalGeneration', false, generation, world) }}
            {{ workflowTab('edit', 'edit', 'globalEdit', false, edit, world) }}
          </div>
          {% if config %}<div><input id="ai-apiKey" type="password"><button type="button" class="toggle-password">Show</button></div><button type="submit">Save configuration</button>{% endif %}
        </form>
        {% include "_includes/image-workflow-preset-modal.njk" %}
        <script defer src="/js/widgets/controls.js"></script>
        <script defer src="/js/widgets/overlays.js"></script>
        <script defer src="/js/widgets/modal-stack.js"></script>
        <script defer src="/js/widgets/searchable-select.js"></script>
        <script defer src="/js/image-workflow-editor.js"></script>
        {% if config %}<script defer src="/js/config.js"></script>{% endif %}
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
        world, config
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
                    generation: { 'Saved workflow': { loras: [missing, { name: installed, strength: 0.25 }], steps: 24 }, 'MOSS Full Turbo': { family: 'moss_full_turbo', loras: [], steps: 8, cfg: 35 } },
                    edit: { 'Qwen Image 2.1 Edit Skimmed CFG': yaml.load(fs.readFileSync(path.join(ROOT, 'image-workflow-presets.yaml'), 'utf8')).edit['Qwen Image 2.1 Edit Skimmed CFG'] }
                },
                presetSaveTarget: 'fixture-presets.yaml'
            } });
        }
        throw new Error(`Unexpected fixture request: ${pathname}`);
    });
    await page.goto('http://127.0.0.1:4173/workflow-fixture');
    await expect(page.locator('[data-image-workflow-mode="generation"] [data-image-workflow-preset] option')).toHaveCount(3);
    return { errors, writes, setLiveOptions: next => { liveOptions = { ...liveOptions, ...next }; } };
}

async function serializedSettings(page, mode) {
    return page.evaluate(mode => {
        const data = new FormData(document.querySelector('#workflow-form, #configForm'));
        return JSON.parse(data.get(mode));
    }, mode);
}

test('LoRA rows preserve strengths while adding, searching, removing, and saving a preset', async ({ page }) => {
    const { errors, writes } = await openEditor(page);
    const generation = page.locator('[data-image-workflow-mode="generation"]');
    const rows = generation.locator('[data-image-workflow-lora-rows] tr');
    const add = generation.locator('[data-image-workflow-lora-add-select]');
    expect(await serializedSettings(page, 'generation')).toMatchObject({ loras: [{ name: installed, strength: 1 }], steps: 12 });
    await expect(rows).toHaveCount(1);
    await generation.getByLabel(`Strength for ${installed}`).fill('-0.5');
    await add.getByRole('searchbox').fill('SAFETENSORS ADDITIONAL');
    await expect(rows).toHaveCount(1);
    await add.locator('select').selectOption(additional);
    await generation.locator('[data-image-workflow-lora-add]').click();
    await generation.getByLabel(`Strength for ${additional}`).fill('0');
    await add.getByRole('searchbox').fill('no matching lora');
    await expect(rows).toHaveCount(2);
    expect((await serializedSettings(page, 'generation')).loras).toEqual([
        { name: installed, strength: -0.5 }, { name: additional, strength: 0 }
    ]);
    await generation.locator('[data-image-workflow-preset]').selectOption('Saved workflow');
    await generation.locator('[data-image-workflow-save]').click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].settings.loras).toEqual([
        { name: installed, strength: -0.5 }, { name: additional, strength: 0 }
    ]);
    await generation.getByRole('button', { name: `Remove ${installed}` }).click();
    expect((await serializedSettings(page, 'generation')).loras).toEqual([{ name: additional, strength: 0 }]);
    await generation.locator('[data-image-workflow-loras]').screenshot({ path: 'tmp/image-workflow-lora-widget-desktop.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await generation.locator('[data-image-workflow-loras]').screenshot({ path: 'tmp/image-workflow-lora-widget-mobile.png', animations: 'disabled' });
    expect(errors).toEqual([]);
});

test('loading a preset reconciles unavailable LoRAs and retains their strengths', async ({ page }) => {
    const { errors } = await openEditor(page);
    const generation = page.locator('[data-image-workflow-mode="generation"]');
    await generation.locator('[data-image-workflow-preset]').selectOption('Saved workflow');
    await generation.locator('[data-image-workflow-load]').click();
    expect(await serializedSettings(page, 'generation')).toMatchObject({ loras: [{ name: installed, strength: 0.25 }], steps: 24 });
    await expect(generation.getByLabel(`Strength for ${installed}`)).toHaveValue('0.25');
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
        expect((await serializedSettings(page, 'generation')).loras).toEqual([{ name: missing, strength: 1 }, { name: installed, strength: 1 }]);
        expect((await serializedSettings(page, 'edit')).loras).toEqual([{ name: missing, strength: 1 }]);
        expect(errors).toEqual([]);
    });
}

test('loading a world profile refreshes and cleans its workflow selections', async ({ page }) => {
    const { errors } = await openEditor(page, { world: true });
    await page.evaluate(({ missing, additional }) => {
        const input = document.querySelector('[data-image-workflow-mode="generation"] [data-image-workflow-value]');
        input.value = JSON.stringify({ loras: [missing, { name: additional, strength: -2 }], steps: 30 });
        input.dispatchEvent(new Event('change'));
    }, { missing, additional });
    expect(await serializedSettings(page, 'generation')).toMatchObject({ loras: [{ name: additional, strength: -2 }], steps: 30 });
    const generation = page.locator('[data-image-workflow-mode="generation"]');
    await expect(generation.getByLabel(`Strength for ${additional}`)).toHaveValue('-2');
    await expect(generation.getByLabel(`Strength for ${installed}`)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('configuration save revalidates dynamically added and removed LoRA strengths', async ({ page }) => {
    const { errors } = await openEditor(page, { config: true });
    const generation = page.locator('[data-image-workflow-mode="generation"]');
    const add = generation.locator('[data-image-workflow-lora-add-select]');
    const save = page.getByRole('button', { name: 'Save configuration' });
    await add.locator('select').selectOption(additional);
    await generation.locator('[data-image-workflow-lora-add]').click();
    const strength = generation.getByLabel(`Strength for ${additional}`);
    await strength.fill('');
    await generation.locator('[data-image-workflow-field="steps"]').fill('13');
    await expect(save).toBeDisabled();
    await strength.fill('0');
    await expect(save).toBeEnabled();
    await strength.fill('');
    await expect(save).toBeDisabled();
    await generation.getByRole('button', { name: `Remove ${additional}` }).click();
    await expect(save).toBeEnabled();
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
        <script defer src="/js/widgets/controls.js"></script>
        <script defer src="/js/widgets/overlays.js"></script>
        <script defer src="/js/widgets/modal-stack.js"></script>
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
    await expect(generation.locator('[data-image-workflow-lora-add]')).toBeDisabled();
    expect(await generation.locator('[data-image-workflow-controls] button').evaluateAll(buttons => buttons.every(button => button.disabled))).toBe(true);
});

test('workflow preset naming validates, cancels with Escape and submits once with Enter', async ({ page }) => {
    const { errors, writes } = await openEditor(page);
    const saveAs = page.locator('[data-image-workflow-mode="generation"] [data-image-workflow-save-as]');
    const modal = page.locator('#imageWorkflowPresetModal');
    const input = page.locator('#imageWorkflowPresetName');
    await saveAs.click(); await expect(modal).toBeVisible(); await expect(input).toBeFocused();
    await input.press('Enter'); await expect(page.locator('#imageWorkflowPresetError')).toContainText('cannot be empty');
    await page.keyboard.press('Escape'); await expect(modal).toBeHidden();
    expect(writes).toHaveLength(0);
    await saveAs.click(); await input.fill('Named preset'); await input.press('Enter');
    await expect(modal).toBeHidden(); await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ name: 'Named preset' });
    expect(errors).toEqual([]);
});


test('MOSS Full Turbo is generation-only and persists in preset saves', async ({ page }) => {
    const { errors, writes } = await openEditor(page);
    const generation = page.locator('[data-image-workflow-mode="generation"]');
    const edit = page.locator('[data-image-workflow-mode="edit"]');
    const family = generation.locator('[data-image-workflow-field="family"]');
    await expect(family.locator('option[value="moss_full_turbo"]')).toHaveText('Standard: MOSS Full Turbo');
    await expect(edit.locator('[data-image-workflow-field="family"] option[value="moss_full_turbo"]')).toHaveCount(0);
    await generation.locator('[data-image-workflow-preset]').selectOption('MOSS Full Turbo');
    await generation.locator('[data-image-workflow-load]').click();
    await expect(family).toHaveValue('moss_full_turbo');
    expect(await serializedSettings(page, 'generation')).toMatchObject({ family: 'moss_full_turbo', steps: 8, cfg: 35 });
    await generation.locator('[data-image-workflow-save]').click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].settings.family).toBe('moss_full_turbo');
    expect(errors).toEqual([]);
});


test('Qwen Image 2.1 Edit Skimmed CFG is edit-only and its preset persists', async ({ page }) => {
    const { errors, writes } = await openEditor(page);
    const generation = page.locator('[data-image-workflow-mode="generation"]');
    const edit = page.locator('[data-image-workflow-mode="edit"]');
    const family = edit.locator('[data-image-workflow-field="family"]');
    await expect(family.locator('option[value="qwen21_skimmed"]')).toHaveText('Standard: Qwen Image 2.1 Edit Skimmed CFG');
    await expect(generation.locator('[data-image-workflow-field="family"] option[value="qwen21_skimmed"]')).toHaveCount(0);
    // This isolated fixture renders the tab panels without the host's tab buttons.
    await edit.evaluate(element => { element.hidden = false; });
    await edit.locator('[data-image-workflow-preset]').selectOption('Qwen Image 2.1 Edit Skimmed CFG');
    await edit.locator('[data-image-workflow-load]').click();
    await expect(family).toHaveValue('qwen21_skimmed');
    expect(await serializedSettings(page, 'edit')).toMatchObject({ family: 'qwen21_skimmed', steps: '20', cfg: 35, sampler: 'dpmpp_2m_sharp', scheduler: 'bong_tangent' });
    await edit.locator('[data-image-workflow-save]').click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].settings.family).toBe('qwen21_skimmed');
    expect(errors).toEqual([]);
});

test.describe('large LoRA library', () => {
    test('search batches native choice updates and preserves workflow state', async ({ page }) => {
        const loras = Array.from({ length: 3000 }, (_, index) => `styles/anime-detail-${String(index).padStart(4, '0')}.safetensors`);
        const { errors } = await openEditor(page, { loras, config: true });
        const generation = page.locator('[data-image-workflow-mode="generation"]');
        const picker = generation.locator('[data-image-workflow-lora-add-select]');
        const search = picker.getByRole('searchbox');
        const records = await search.evaluate(input => {
            const select = input.parentElement.querySelector('select');
            const observer = new MutationObserver(() => {});
            observer.observe(select, { childList: true });
            input.value = 'anime';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const changes = observer.takeRecords().length;
            observer.disconnect();
            return changes;
        });
        expect(records).toBe(1);
        await expect(picker.locator('select option')).toHaveCount(3001);
        await search.fill('DETAIL 0025');
        await expect(picker.locator('select option').last()).toHaveText(loras[25]);
        await expect(picker.locator('select option')).toHaveCount(2);
        expect((await serializedSettings(page, 'generation')).steps).toBe(12);
        expect(errors).toEqual([]);
    });
});
