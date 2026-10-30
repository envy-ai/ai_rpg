const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const yaml = require('js-yaml');
const {
    STANDARD_IMAGE_WORKFLOWS,
    STANDARD_BATCH_WORKFLOWS,
    resolveStandardWorkflowTemplate,
    resolveStandardBatchWorkflowTemplate,
    applyStandardImageWorkflowSettings,
    applyImageWorkflowTextEncoderType
} = require('../StandardImageWorkflows.js');

function renderStandardWorkflow(templateName, imageOverrides = {}) {
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
            megapixels: 1,
            ...imageOverrides
        }
    }));
}

function renderStandardBatchWorkflow(templateName, images = [{ prompt: 'A quiet marketplace at sunset.', width: 1024, height: 768, seed: 42 }]) {
    const environment = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(['imagegen']),
        { autoescape: false }
    );
    environment.addFilter('json', value => JSON.stringify(String(value)).slice(1, -1));
    return JSON.parse(environment.render(templateName, {
        config: { imagegen: { lora: '' } },
        images
    }));
}

test('standard workflow registry distinguishes supported generation and editing families', () => {
    assert.equal(resolveStandardWorkflowTemplate('generation', 'krea2'), 'standard/krea2-generation.json.njk');
    assert.equal(resolveStandardWorkflowTemplate('edit', 'krea2'), 'standard/krea2-identity-edit.json.njk');
    assert.equal(resolveStandardWorkflowTemplate('edit', 'flux_klein'), 'standard/flux-klein-edit.json.njk');
    assert.equal(resolveStandardWorkflowTemplate('edit', 'qwen'), 'standard/qwen-image-edit.json.njk');
    assert.equal(resolveStandardWorkflowTemplate('generation', 'qwen21'), 'standard/qwen21-generation.json.njk');
    assert.equal(resolveStandardWorkflowTemplate('generation', 'moss'), 'standard/moss-generation.json.njk');
    assert.equal(resolveStandardWorkflowTemplate('edit', 'qwen21'), 'standard/qwen21-image-edit.json.njk');
    assert.deepEqual(Object.keys(STANDARD_IMAGE_WORKFLOWS.edit), ['krea2', 'flux_klein', 'qwen', 'qwen21']);
    assert.equal(resolveStandardBatchWorkflowTemplate('krea2'), STANDARD_BATCH_WORKFLOWS.krea2);
    assert.equal(resolveStandardBatchWorkflowTemplate('moss'), 'standard/moss-generation-batch.json.njk');
    assert.equal(resolveStandardBatchWorkflowTemplate('moss'), STANDARD_BATCH_WORKFLOWS.moss);
    assert.throws(
        () => resolveStandardWorkflowTemplate('edit', 'sdxl'),
        /No standard edit workflow exists/
    );
    assert.throws(
        () => resolveStandardBatchWorkflowTemplate('ideogram4'),
        /does not support prompt-list rendering/
    );
    assert.throws(
        () => resolveStandardBatchWorkflowTemplate('qwen21'),
        /does not support prompt-list rendering/
    );
    assert.throws(
        () => resolveStandardWorkflowTemplate('edit', 'moss'),
        /No standard edit workflow exists/
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

test('text encoder type overrides every supported canonical loader while blank leaves family defaults intact', () => {
    const loaderTypes = ['CLIPLoader', 'CLIPLoaderGGUF', 'DualCLIPLoader', 'DualCLIPLoaderGGUF'];
    const templates = [
        ...Object.values(STANDARD_IMAGE_WORKFLOWS.generation),
        ...Object.values(STANDARD_IMAGE_WORKFLOWS.edit),
        ...Object.values(STANDARD_BATCH_WORKFLOWS)
    ];

    for (const templateName of templates) {
        const isBatch = Object.values(STANDARD_BATCH_WORKFLOWS).includes(templateName);
        const workflow = isBatch ? renderStandardBatchWorkflow(templateName) : renderStandardWorkflow(templateName);
        const loaders = Object.values(workflow).filter(node => loaderTypes.includes(node?.class_type));
        const before = loaders.map(node => ({ type: node.inputs.type }));
        applyImageWorkflowTextEncoderType(workflow, '');
        assert.deepEqual(loaders.map(node => ({ type: node.inputs.type })), before, `${templateName} blank override`);
        if (loaders.length) {
            applyImageWorkflowTextEncoderType(workflow, 'qwen_image');
            assert.deepEqual(loaders.map(node => node.inputs.type), loaders.map(() => 'qwen_image'), `${templateName} explicit override`);
        } else {
            assert.throws(
                () => applyImageWorkflowTextEncoderType(workflow, 'qwen_image'),
                /does not expose a supported standalone text encoder loader/,
                `${templateName} unsupported override`
            );
        }
    }
});

test('text encoder type helper supports GGUF and dual loaders and errors when a graph has no standalone loader', () => {
    for (const classType of ['CLIPLoaderGGUF', 'DualCLIPLoader', 'DualCLIPLoaderGGUF']) {
        const workflow = { loader: { class_type: classType, inputs: { type: 'baseline' } } };
        applyImageWorkflowTextEncoderType(workflow, 'flux');
        assert.equal(workflow.loader.inputs.type, 'flux', classType);
    }

    const builtInEncoderWorkflow = { checkpoint: { class_type: 'CheckpointLoaderSimple', inputs: {} } };
    assert.throws(
        () => applyImageWorkflowTextEncoderType(builtInEncoderWorkflow, 'clip_g'),
        /does not expose a supported standalone text encoder loader/
    );
    assert.doesNotThrow(() => applyImageWorkflowTextEncoderType(builtInEncoderWorkflow, ''));
});

test('registered standard prompt-list workflows render to valid ComfyUI API JSON', () => {
    for (const templateName of Object.values(STANDARD_BATCH_WORKFLOWS)) {
        assert.doesNotThrow(() => renderStandardBatchWorkflow(templateName), templateName);
    }
});

test('MOSS single and prompt-list workflows use core VAE nodes and the Flux 2 latent', () => {
    const singleTemplate = resolveStandardWorkflowTemplate('generation', 'moss');
    const batchTemplate = resolveStandardBatchWorkflowTemplate('moss');
    const expectedDefaults = {
        model: 'd/kromoss_int8_convrot.safetensors',
        textEncoder: 'd/qwen3.5_9b_ultra_uncensored_heretic_int8_convrot.safetensors',
        textEncoderType: 'moss_image',
        vae: 'd/flux2-vae_small.safetensors'
    };
    const assertGraph = (workflow, templateName) => {
        const nodes = Object.values(workflow);
        const find = classType => nodes.find(node => node.class_type === classType);
        assert.ok(find('EmptyFlux2LatentImage'), `${templateName} must use the Flux 2 latent`);
        assert.equal(find('VAELoader')?.inputs.vae_name, expectedDefaults.vae, `${templateName} VAE`);
        assert.equal(find('VAEDecode')?.class_type, 'VAEDecode', `${templateName} core VAE decode`);
        assert.equal(find('VAEUtils_CustomVAELoader'), undefined, `${templateName} must not use the custom VAE loader`);
        assert.equal(find('VAEUtils_VAEDecodeTiled'), undefined, `${templateName} must not use the custom VAE decode`);
        assert.equal(find('UNETLoader')?.inputs.unet_name, expectedDefaults.model, `${templateName} model`);
        assert.equal(find('CLIPLoader')?.inputs.clip_name, expectedDefaults.textEncoder, `${templateName} text encoder`);
        assert.equal(find('CLIPLoader')?.inputs.type, expectedDefaults.textEncoderType, `${templateName} text encoder type`);
        assert.deepEqual(find('VAEDecode')?.inputs.samples, ['17', 0], `${templateName} decode samples`);
        assert.deepEqual(find('VAEDecode')?.inputs.vae, ['6', 0], `${templateName} decode VAE`);
        assert.deepEqual(find('KSampler')?.inputs.model, ['4', 0], `${templateName} sampler model`);
        assert.deepEqual(find('KSampler')?.inputs.latent_image, ['2', 0], `${templateName} sampler latent`);
        assert.equal(find('KSampler')?.inputs.steps, 8, `${templateName} baseline steps`);
        assert.equal(find('KSampler')?.inputs.cfg, 1, `${templateName} baseline CFG`);
        assert.equal(find('KSampler')?.inputs.sampler_name, 'euler', `${templateName} baseline sampler`);
        assert.equal(find('KSampler')?.inputs.scheduler, 'simple', `${templateName} baseline scheduler`);
        assert.equal(find('KSampler')?.inputs.denoise, 1, `${templateName} baseline denoise`);
        for (const [nodeId, node] of Object.entries(workflow)) {
            for (const [inputName, input] of Object.entries(node.inputs || {})) {
                if (Array.isArray(input) && input.length === 2 && Number.isInteger(input[1])) {
                    assert.ok(Object.hasOwn(workflow, String(input[0])), `${templateName} node ${nodeId}.${inputName} references missing node ${input[0]}`);
                }
            }
        }
    };

    const single = renderStandardWorkflow(singleTemplate, { prompt: 'First MOSS prompt', seed: 57 });
    assertGraph(single, singleTemplate);
    const singleSampler = Object.values(single).find(node => node.class_type === 'KSampler');
    assert.equal(singleSampler.inputs.seed, 57);

    const batchImages = [
        { prompt: 'Prompt one for MOSS', width: 896, height: 1152, seed: 51 },
        { prompt: 'Second prompt for MOSS', width: 1152, height: 896, seed: 52 }
    ];
    const batch = renderStandardBatchWorkflow(batchTemplate, batchImages);
    assertGraph(batch, batchTemplate);
    assert.deepEqual(batch['2'].inputs, { width: 896, height: 1152, batch_size: 1 });
    assert.deepEqual(batch['100'].inputs, { value1: ['1000', 0], value2: ['1001', 0] });
    assert.deepEqual(batch['101'].inputs, { value1: ['2000', 0], value2: ['2001', 0] });
    assert.equal(batch['1000'].inputs.value, batchImages[0].prompt);
    assert.equal(batch['1001'].inputs.value, batchImages[1].prompt);
    assert.equal(batch['2000'].inputs.value, batchImages[0].seed);
    assert.equal(batch['2001'].inputs.value, batchImages[1].seed);

    applyStandardImageWorkflowSettings(single, {
        checkpoint: 'override-moss-model.safetensors',
        textEncoder: 'override-moss-encoder.safetensors',
        textEncoderType: 'moss_image',
        vae: 'override-moss-vae.safetensors',
        sampler: 'dpmpp_2m',
        scheduler: 'karras',
        steps: 11,
        cfg: 2.5,
        seed: 88,
        loras: ['styles/moss-detail.safetensors']
    });
    assert.equal(single['4'].inputs.unet_name, 'override-moss-model.safetensors');
    assert.equal(single['5'].inputs.clip_name, 'override-moss-encoder.safetensors');
    assert.equal(single['5'].inputs.type, 'moss_image');
    assert.equal(single['6'].inputs.vae_name, 'override-moss-vae.safetensors');
    assert.equal(single['17'].inputs.sampler_name, 'dpmpp_2m');
    assert.equal(single['17'].inputs.scheduler, 'karras');
    assert.equal(single['17'].inputs.steps, 11);
    assert.equal(single['17'].inputs.cfg, 2.5);
    assert.equal(single['17'].inputs.seed, 88);
    const lora = Object.values(single).find(node => node.class_type === 'LoraLoaderModelOnly');
    assert.equal(lora?.inputs.lora_name, 'styles/moss-detail.safetensors');
    assert.deepEqual(single['17'].inputs.model, [Object.keys(single).find(id => single[id] === lora), 0]);

    applyStandardImageWorkflowSettings(batch, {
        checkpoint: 'batch-moss-model.safetensors',
        textEncoder: 'batch-moss-encoder.safetensors',
        textEncoderType: 'moss_image',
        vae: 'batch-moss-vae.safetensors',
        sampler: 'heun',
        scheduler: 'simple',
        seed: 999,
        loras: ['styles/moss-batch.safetensors']
    });
    assert.equal(batch['4'].inputs.unet_name, 'batch-moss-model.safetensors');
    assert.equal(batch['5'].inputs.clip_name, 'batch-moss-encoder.safetensors');
    assert.equal(batch['6'].inputs.vae_name, 'batch-moss-vae.safetensors');
    assert.equal(batch['17'].inputs.sampler_name, 'heun');
    assert.deepEqual(batch['17'].inputs.seed, ['101', 0]);
    assert.deepEqual(batch['101'].inputs.value2, ['2001', 0]);
    const batchLora = Object.values(batch).find(node => node.class_type === 'LoraLoaderModelOnly');
    assert.equal(batchLora?.inputs.lora_name, 'styles/moss-batch.safetensors');
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
        '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'original-clip.safetensors', type: 'baseline' } },
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
        textEncoderType: 'qwen_image',
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
    assert.equal(workflow['2'].inputs.type, 'qwen_image');
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

test('Qwen 2.1 workflows preserve source models, conditioning, sampling, and escaped application prompts', () => {
    const prompt = 'A "quiet" marketplace.\nKeep the\\sign.';
    const negativePrompt = 'blurry, "washed out"\nartifacts';
    for (const mode of ['generation', 'edit']) {
        const workflow = renderStandardWorkflow(STANDARD_IMAGE_WORKFLOWS[mode].qwen21, {
            prompt, negativePrompt
        });
        assert.equal(workflow['126'].inputs.unet_name, 'd/Qwenvy2.1-v1.0.safetensors');
        assert.equal(workflow['133'].inputs.clip_name, 'd/qwen3-vl-8b-heretic-1.3.0-int8-convrot.safetensors');
        assert.equal(workflow['133'].inputs.type, 'qwen_image');
        assert.equal(workflow['127'].inputs.vae_name, 'd/vae/qwen_image_2.1_vae_bf16.safetensors');
        assert.equal(workflow['796'].inputs.lora_name, 'qwen2.1/qwen2.1-anime-classic-flat.safetensors');
        assert.equal(workflow['796'].inputs.strength_model, 1);
        assert.deepEqual(workflow['796'].inputs.model, ['126', 0]);
        assert.equal(workflow['725'].class_type, 'TextEncodeQwenImage21');
        assert.equal(workflow['725'].inputs.resolution, 1376);
        assert.deepEqual(workflow['725'].inputs.clip, ['133', 0]);
        assert.deepEqual(workflow['725'].inputs.vae, ['127', 0]);
        assert.deepEqual(workflow['725'].inputs.prompt, ['855', 0]);
        assert.equal(workflow['855'].inputs.value, prompt);
        assert.equal(workflow['725'].inputs.negative_prompt, negativePrompt);
        assert.deepEqual(workflow['856'].inputs.any_value, ['855', 0]);
        assert.equal(workflow['856'].inputs.console, true);
        assert.equal(workflow['856'].inputs.prefix, 'Final Prompt');
        assert.equal(workflow['768'].class_type, 'KSamplerAdvanced');
        assert.equal(workflow['768'].inputs.noise_seed, 42);
        assert.equal(workflow['768'].inputs.steps, 20);
        assert.equal(workflow['768'].inputs.cfg, 3.5);
        assert.equal(workflow['768'].inputs.sampler_name, 'dpmpp_2m_sharp');
        assert.equal(workflow['768'].inputs.scheduler, 'bong_tangent');
        assert.equal(workflow['768'].inputs.add_noise, 'enable');
        assert.equal(workflow['768'].inputs.start_at_step, 0);
        assert.equal(workflow['768'].inputs.end_at_step, 10000);
        assert.equal(workflow['768'].inputs.return_with_leftover_noise, 'disable');
        assert.deepEqual(workflow['768'].inputs.model, ['796', 0]);
        assert.deepEqual(workflow['768'].inputs.positive, ['725', 0]);
        assert.deepEqual(workflow['768'].inputs.negative, ['725', 1]);
        assert.deepEqual(workflow['768'].inputs.latent_image, ['853', 0]);
        assert.equal(workflow['853'].class_type, 'EmptyLatentImage');
        assert.deepEqual(workflow['750'].inputs.samples, ['768', 0]);
        assert.equal(workflow['851'].inputs.filename_prefix, `airpg/qwen21-${mode}`);
        assert.ok(!Object.values(workflow).some(node => node.class_type === 'JWDatetimeString'));
        for (const node of Object.values(workflow)) {
            for (const value of Object.values(node.inputs)) {
                if (Array.isArray(value)) {
                    assert.ok(workflow[value[0]], `missing referenced node ${value[0]}`);
                }
            }
        }
    }
});

test('Qwen 2.1 generation has no source reference and uses selected application dimensions', () => {
    const workflow = renderStandardWorkflow(STANDARD_IMAGE_WORKFLOWS.generation.qwen21, {
        width: 1280, height: 720
    });
    assert.ok(!Object.values(workflow).some(node => ['LoadImage', 'GetImageSize', 'ImageScale'].includes(node.class_type)));
    assert.ok(!Object.keys(workflow['725'].inputs).some(name => name.startsWith('images.')));
    assert.deepEqual(workflow['853'].inputs, { width: 1280, height: 720, batch_size: 1 });
    assert.deepEqual(workflow['851'].inputs.images, ['750', 0]);

    applyStandardImageWorkflowSettings(workflow, { width: 1600, height: 900, loras: [] });
    assert.equal(workflow['853'].inputs.width, 1600);
    assert.equal(workflow['853'].inputs.height, 900);
});

test('Qwen 2.1 editing conditions on the source and saves its exact dimensions', () => {
    const workflow = renderStandardWorkflow(STANDARD_IMAGE_WORKFLOWS.edit.qwen21);
    assert.equal(workflow['850'].inputs.image, 'airpg-location-variants/source.png');
    assert.deepEqual(workflow['725'].inputs['images.image_1'], ['850', 0]);
    assert.deepEqual(workflow['852'].inputs.image, ['850', 0]);
    assert.deepEqual(workflow['853'].inputs.width, ['852', 0]);
    assert.deepEqual(workflow['853'].inputs.height, ['852', 1]);
    assert.equal(workflow['854'].class_type, 'ImageScale');
    assert.deepEqual(workflow['854'].inputs.image, ['750', 0]);
    assert.deepEqual(workflow['854'].inputs.width, ['852', 0]);
    assert.deepEqual(workflow['854'].inputs.height, ['852', 1]);
    assert.equal(workflow['854'].inputs.crop, 'disabled');
    assert.deepEqual(workflow['851'].inputs.images, ['854', 0]);

    applyStandardImageWorkflowSettings(workflow, { width: 1600, height: 900, loras: [] });
    assert.deepEqual(workflow['853'].inputs.width, ['852', 0]);
    assert.deepEqual(workflow['853'].inputs.height, ['852', 1]);
});

test('Qwen 2.1 advanced sampling settings use noise_seed and chain optional LoRAs after its built-in adapter', () => {
    for (const mode of ['generation', 'edit']) {
        const workflow = renderStandardWorkflow(STANDARD_IMAGE_WORKFLOWS[mode].qwen21);
        applyStandardImageWorkflowSettings(workflow, {
            seed: 9876, steps: 12, cfg: 2, sampler: 'euler', scheduler: 'simple', denoise: 0.5,
            loras: ['styles/example.safetensors']
        });
        assert.equal(workflow['768'].inputs.noise_seed, 9876);
        assert.equal(workflow['768'].inputs.seed, undefined);
        assert.equal(workflow['768'].inputs.denoise, undefined);
        assert.equal(workflow['768'].inputs.steps, 12);
        assert.equal(workflow['768'].inputs.cfg, 2);
        assert.equal(workflow['768'].inputs.sampler_name, 'euler');
        assert.equal(workflow['768'].inputs.scheduler, 'simple');
        assert.equal(workflow['768'].inputs.start_at_step, 0);
        assert.equal(workflow['768'].inputs.end_at_step, 10000);
        const selectedLora = workflow[workflow['768'].inputs.model[0]];
        assert.equal(selectedLora.class_type, 'LoraLoaderModelOnly');
        assert.equal(selectedLora.inputs.lora_name, 'styles/example.safetensors');
        assert.deepEqual(selectedLora.inputs.model, ['796', 0]);
        assert.equal(workflow['796'].inputs.lora_name, 'qwen2.1/qwen2.1-anime-classic-flat.safetensors');
    }
});

test('Qwen 2.1 is available in both workflow editor tabs with source-model presets', () => {
    const environment = new nunjucks.Environment(new nunjucks.FileSystemLoader(['views']), { autoescape: false });
    const presets = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'image-workflow-presets.yaml'), 'utf8'));
    for (const [mode, name] of [['generation', 'Qwen Image 2.1'], ['edit', 'Qwen Image 2.1 Edit']]) {
        const markup = environment.renderString(
            '{% from "_includes/image-workflow-editor.njk" import workflowTab %}{{ workflowTab(mode, "settings", "", false, {}, false) }}',
            { mode }
        );
        assert.match(markup, /<option value="qwen21">Standard: Qwen Image 2\.1(?: Edit)?<\/option>/);
        if (mode === 'generation') {
            assert.match(markup, /<option value="moss">Standard: MOSS Image<\/option>/);
        } else {
            assert.doesNotMatch(markup, /<option value="moss">/);
        }
        const preset = presets[mode][name];
        assert.equal(preset.family, 'qwen21');
        assert.equal(preset.custom_template, '');
        assert.equal(preset.model, 'd/Qwenvy2.1-v1.0.safetensors');
        assert.equal(preset.text_encoder, 'd/qwen3-vl-8b-heretic-1.3.0-int8-convrot.safetensors');
        assert.equal(preset.vae, 'd/vae/qwen_image_2.1_vae_bf16.safetensors');
        assert.deepEqual(preset.loras, []);
        assert.equal(Number(preset.steps), 20);
        assert.equal(Number(preset.cfg), 3.5);
        assert.equal(preset.sampler, 'dpmpp_2m_sharp');
        assert.equal(preset.scheduler, 'bong_tangent');
        assert.equal(Number(preset.denoise), 1);
        if (mode === 'generation') assert.ok(preset.resolutions);
        else assert.equal(preset.resolutions, undefined);
    }
});
