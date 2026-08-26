const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const {
    STANDARD_IMAGE_WORKFLOWS,
    STANDARD_BATCH_WORKFLOWS,
    resolveStandardWorkflowTemplate,
    resolveStandardBatchWorkflowTemplate,
    applyStandardImageWorkflowSettings
} = require('../StandardImageWorkflows.js');

function renderStandardWorkflow(templateName) {
    const environment = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(['imagegen']),
        { autoescape: false }
    );
    environment.addFilter('json', value => JSON.stringify(String(value)).slice(1, -1));
    return JSON.parse(environment.render(templateName, {
        config: { imagegen: { lora: '' } },
        image: {
            prompt: 'A quiet marketplace at sunset.',
            negativePrompt: 'blurry',
            sourceFilename: 'airpg-location-variants/source.png',
            input_filename: 'airpg-location-variants/source.png',
            width: 1024,
            height: 768,
            steps: 6,
            seed: 42,
            cfg: 1,
            sampler: 'euler',
            scheduler: 'simple',
            denoise: 0.45,
            megapixels: 1
        }
    }));
}

function renderStandardBatchWorkflow(templateName) {
    const environment = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(['imagegen']),
        { autoescape: false }
    );
    environment.addFilter('json', value => JSON.stringify(String(value)).slice(1, -1));
    return JSON.parse(environment.render(templateName, {
        config: { imagegen: { lora: '' } },
        images: [{ prompt: 'A quiet marketplace at sunset.', width: 1024, height: 768, seed: 42 }]
    }));
}

test('standard workflow registry distinguishes supported generation and editing families', () => {
    assert.equal(resolveStandardWorkflowTemplate('generation', 'krea2'), 'standard/krea2-generation.json.njk');
    assert.equal(resolveStandardWorkflowTemplate('edit', 'krea2'), 'standard/krea2-identity-edit.json.njk');
    assert.equal(resolveStandardWorkflowTemplate('edit', 'flux_klein'), 'standard/flux-klein-edit.json.njk');
    assert.equal(resolveStandardWorkflowTemplate('edit', 'qwen'), 'standard/qwen-image-edit.json.njk');
    assert.deepEqual(Object.keys(STANDARD_IMAGE_WORKFLOWS.edit), ['krea2', 'flux_klein', 'qwen']);
    assert.equal(resolveStandardBatchWorkflowTemplate('krea2'), STANDARD_BATCH_WORKFLOWS.krea2);
    assert.throws(
        () => resolveStandardWorkflowTemplate('edit', 'sdxl'),
        /No standard edit workflow exists/
    );
    assert.throws(
        () => resolveStandardBatchWorkflowTemplate('ideogram4'),
        /does not support prompt-list rendering/
    );
});

test('every registered standard workflow renders to valid ComfyUI API JSON', () => {
    for (const templateName of Object.values(STANDARD_IMAGE_WORKFLOWS.generation)) {
        assert.doesNotThrow(() => renderStandardWorkflow(templateName), templateName);
    }
    for (const templateName of Object.values(STANDARD_IMAGE_WORKFLOWS.edit)) {
        assert.doesNotThrow(() => renderStandardWorkflow(templateName), templateName);
    }
});

test('registered standard prompt-list workflows render to valid ComfyUI API JSON', () => {
    for (const templateName of Object.values(STANDARD_BATCH_WORKFLOWS)) {
        assert.doesNotThrow(() => renderStandardBatchWorkflow(templateName), templateName);
    }
});

test('canonical Krea workflows are self-contained rather than aliases of custom test templates', () => {
    for (const templateName of [
        STANDARD_IMAGE_WORKFLOWS.generation.krea2,
        STANDARD_BATCH_WORKFLOWS.krea2
    ]) {
        const source = fs.readFileSync(path.join(__dirname, '..', 'imagegen', templateName), 'utf8');
        assert.doesNotMatch(source, /\{%-?\s*include\s+["']test_krea_/);
        assert.match(source, /"class_type"\s*:\s*"KSampler"/);
        assert.doesNotMatch(source, /k2-pix12_000000200-lora/);
        assert.doesNotMatch(source, /realism_engine_krea2_v2/);
        assert.doesNotMatch(source, /"class_type"\s*:\s*"ImageScaleBy"/);
    }
});

test('canonical Krea workflows sample the base model and save the requested-size decode', () => {
    for (const templateName of [
        STANDARD_IMAGE_WORKFLOWS.generation.krea2,
        STANDARD_BATCH_WORKFLOWS.krea2
    ]) {
        const workflow = templateName === STANDARD_BATCH_WORKFLOWS.krea2
            ? renderStandardBatchWorkflow(templateName)
            : renderStandardWorkflow(templateName);
        assert.deepEqual(workflow['17'].inputs.model, ['4', 0]);
        assert.deepEqual(workflow['23'].inputs.images, ['3', 0]);
        assert.equal(workflow['8'], undefined);
        assert.equal(workflow['9'], undefined);
        assert.equal(workflow['24'], undefined);
    }
});

test('standard workflow settings patch compatible loaders, samplers, dimensions, and selected LoRAs', () => {
    const workflow = {
        '1': { class_type: 'UNETLoader', inputs: { unet_name: 'original.safetensors' } },
        '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'original-clip.safetensors' } },
        '3': { class_type: 'VAELoader', inputs: { vae_name: 'original-vae.safetensors' } },
        '4': { class_type: 'EmptyFlux2LatentImage', inputs: { width: 1, height: 1 } },
        '5': {
            class_type: 'KSampler',
            inputs: { model: ['1', 0], seed: 1, steps: 1, cfg: 1, denoise: 1, sampler_name: 'euler', scheduler: 'simple' }
        }
    };
    applyStandardImageWorkflowSettings(workflow, {
        checkpoint: 'selected-model.safetensors',
        textEncoder: 'selected-clip.safetensors',
        vae: 'selected-vae.safetensors',
        width: 1280,
        height: 720,
        seed: 42,
        steps: 8,
        cfg: 3.5,
        denoise: 0.6,
        sampler: 'dpmpp_2m',
        scheduler: 'karras',
        loras: ['styles/example.safetensors']
    });

    assert.equal(workflow['1'].inputs.unet_name, 'selected-model.safetensors');
    assert.equal(workflow['2'].inputs.clip_name, 'selected-clip.safetensors');
    assert.equal(workflow['3'].inputs.vae_name, 'selected-vae.safetensors');
    assert.deepEqual(workflow['4'].inputs, { width: 1280, height: 720 });
    assert.equal(workflow['5'].inputs.steps, 8);
    assert.equal(workflow['5'].inputs.cfg, 3.5);
    assert.equal(workflow['5'].inputs.denoise, 0.6);
    assert.equal(workflow['5'].inputs.sampler_name, 'dpmpp_2m');
    assert.equal(workflow['5'].inputs.scheduler, 'karras');
    assert.equal(workflow['5'].inputs.seed, 42);
    assert.equal(workflow['6'].class_type, 'LoraLoaderModelOnly');
    assert.deepEqual(workflow['6'].inputs.model, ['1', 0]);
    assert.deepEqual(workflow['5'].inputs.model, ['6', 0]);
});

test('standard workflow settings preserve source-linked edit canvas dimensions', () => {
    const workflow = {
        '1': {
            class_type: 'EmptySD3LatentImage',
            inputs: { width: ['2', 0], height: ['2', 1], batch_size: 1 }
        }
    };

    applyStandardImageWorkflowSettings(workflow, {
        width: 1600,
        height: 900,
        loras: []
    });

    assert.deepEqual(workflow['1'].inputs.width, ['2', 0]);
    assert.deepEqual(workflow['1'].inputs.height, ['2', 1]);
});

test('standard Krea edit workflow uses the v1.2 dual-conditioning topology', () => {
    const workflow = renderStandardWorkflow('standard/krea2-identity-edit.json.njk');
    applyStandardImageWorkflowSettings(workflow, {
        checkpoint: 'd/krea2_turbo_unfiltered_int8_convrot.safetensors',
        textEncoder: 'd/text_encoders/qwen3vl_4b_fp8_scaled.safetensors',
        vae: 'qwen_image_vae.safetensors',
        steps: 10,
        cfg: 1,
        sampler: 'euler',
        scheduler: 'simple',
        denoise: 1,
        width: 1024,
        height: 768,
        loras: []
    });

    assert.equal(workflow['4'].class_type, 'LoraLoaderModelOnly');
    assert.equal(workflow['4'].inputs.lora_name, 'd/krea2_identity_edit_v1_2.safetensors');
    assert.equal(workflow['4'].inputs.strength_model, 1);
    assert.equal(workflow['5'].inputs.clip_name, 'd/text_encoders/qwen3vl_4b_fp8_scaled.safetensors');
    assert.equal(workflow['9'].class_type, 'Krea2EditModelPatch');
    assert.deepEqual(workflow['9'].inputs.model, ['4', 0]);
    assert.deepEqual(workflow['9'].inputs.source_latent, ['7', 0]);
    assert.deepEqual(workflow['9'].inputs.source_image, ['1', 0]);
    assert.deepEqual(workflow['9'].inputs.target_latent, ['8', 0]);
    assert.equal(workflow['9'].inputs.fit_mode, 'fit');
    assert.equal(workflow['9'].inputs.ref_boost, 4);
    assert.equal(workflow['12'].class_type, 'Krea2EditGroundedEncode');
    assert.deepEqual(workflow['12'].inputs.image, ['1', 0]);
    assert.equal(workflow['12'].inputs.grounding_px, 768);
    assert.equal(workflow['13'].inputs.prompt, '');
    assert.deepEqual(workflow['14'].inputs.model, ['9', 0]);
    assert.deepEqual(workflow['14'].inputs.latent_image, ['8', 0]);
    assert.deepEqual(workflow['8'].inputs.width, ['2', 0]);
    assert.deepEqual(workflow['8'].inputs.height, ['2', 1]);
});

test('paired-model workflows reject a misleading single-model override', () => {
    assert.throws(
        () => applyStandardImageWorkflowSettings({
            '1': { class_type: 'DualModelGuider', inputs: {} },
            '2': { class_type: 'UNETLoader', inputs: { unet_name: 'conditional.safetensors' } },
            '3': { class_type: 'UNETLoader', inputs: { unet_name: 'unconditional.safetensors' } }
        }, { checkpoint: 'one-model.safetensors', loras: [] }),
        /paired conditional and unconditional models/
    );
});

test('standard Flux edit workflow keeps KV cache by default and bypasses it when disabled', () => {
    const enabledWorkflow = renderStandardWorkflow('standard/flux-klein-edit.json.njk');
    applyStandardImageWorkflowSettings(enabledWorkflow, { loras: [] });
    assert.equal(enabledWorkflow['139'].class_type, 'FluxKVCache');
    assert.deepEqual(enabledWorkflow['138'].inputs.model, ['139', 0]);

    const disabledWorkflow = renderStandardWorkflow('standard/flux-klein-edit.json.njk');
    applyStandardImageWorkflowSettings(disabledWorkflow, {
        fluxKvCacheEnabled: false,
        loras: []
    });
    assert.equal(disabledWorkflow['139'], undefined);
    assert.deepEqual(disabledWorkflow['138'].inputs.model, ['714', 0]);
});
