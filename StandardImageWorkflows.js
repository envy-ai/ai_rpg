'use strict';

// Canonical ComfyUI workflow registry. Each template owns its model family's
// graph; this module only applies ordinary UI-selected node inputs after the
// template has rendered to parsed JSON.
const STANDARD_IMAGE_WORKFLOWS = Object.freeze({
    generation: Object.freeze({
        krea2: 'standard/krea2-generation.json.njk',
        sdxl: 'standard/sdxl-generation.json.njk',
        flux_klein: 'standard/flux-klein-generation.json.njk',
        zimage: 'standard/zimage-generation.json.njk',
        qwen: 'standard/qwen-generation.json.njk',
        anima: 'standard/anima-generation.json.njk',
        ideogram4: 'standard/ideogram4-generation.json.njk'
    }),
    edit: Object.freeze({
        krea2: 'standard/krea2-identity-edit.json.njk',
        flux_klein: 'standard/flux-klein-edit.json.njk',
        qwen: 'standard/qwen-image-edit.json.njk'
    })
});

const STANDARD_BATCH_WORKFLOWS = Object.freeze({
    krea2: 'standard/krea2-generation-batch.json.njk'
});

function resolveStandardWorkflowTemplate(mode, family) {
    const normalizedMode = mode === 'edit' ? 'edit' : 'generation';
    const template = STANDARD_IMAGE_WORKFLOWS[normalizedMode]?.[family];
    if (!template) {
        const supported = Object.keys(STANDARD_IMAGE_WORKFLOWS[normalizedMode] || {}).join(', ');
        throw new Error(
            `No standard ${normalizedMode} workflow exists for image family "${family}". `
            + `Supported families: ${supported}. Choose one of those or select a custom workflow.`
        );
    }
    return template;
}

function isStandardImageWorkflow(templateName) {
    return typeof templateName === 'string' && templateName.startsWith('standard/');
}

function resolveStandardBatchWorkflowTemplate(family) {
    const template = STANDARD_BATCH_WORKFLOWS[family];
    if (!template) {
        throw new Error(
            `The standard ${family} generation workflow does not support prompt-list rendering. `
            + 'Disable imagegen.batch_prompts, use Krea 2, or select a batch-capable custom workflow.'
        );
    }
    return template;
}

function setIfNonEmpty(inputs, field, value) {
    if (typeof value === 'string' && value.trim()) {
        inputs[field] = value.trim();
    }
}

function setIfFinite(inputs, field, value) {
    if (Number.isFinite(Number(value))) {
        inputs[field] = Number(value);
    }
}

function setCanvasDimensionIfUnlinked(inputs, field, value) {
    if (Array.isArray(inputs[field])) {
        return;
    }
    setIfFinite(inputs, field, value);
}

function nextNodeId(workflow) {
    const ids = Object.keys(workflow).map(Number).filter(Number.isFinite);
    return String((ids.length ? Math.max(...ids) : 0) + 1);
}

function appendSelectedLoras(workflow, loras) {
    const selected = Array.isArray(loras)
        ? loras.filter(lora => typeof lora === 'string' && lora.trim()).map(lora => lora.trim())
        : [];
    if (selected.length === 0) {
        return;
    }

    // Add user choices after each required family chain and immediately before
    // sampling/guidance, so built-in model LoRAs remain intact.
    const consumers = Object.values(workflow).filter(node => (
        ['KSampler', 'KSamplerAdvanced', 'CFGGuider'].includes(node?.class_type)
        && Array.isArray(node?.inputs?.model)
    ));
    if (consumers.length === 0) {
        throw new Error('This standard workflow does not expose a supported model input for selected LoRAs.');
    }
    for (const consumer of consumers) {
        let model = consumer.inputs.model;
        for (const loraName of selected) {
            const id = nextNodeId(workflow);
            workflow[id] = {
                class_type: 'LoraLoaderModelOnly',
                inputs: { model, lora_name: loraName, strength_model: 1 },
                _meta: { title: `AIRPG selected LoRA: ${loraName}` }
            };
            model = [id, 0];
        }
        consumer.inputs.model = model;
    }
}

function configureFluxKvCache(workflow, enabled) {
    if (enabled !== false) {
        return;
    }

    // API-format workflows do not carry LiteGraph's frontend-only `mode: 4`.
    // ComfyUI serializes a bypassed pass-through node by omitting it from the
    // prompt graph and wiring its consumers to its input; perform that exact
    // per-request transformation without changing the canonical template.
    const cacheNodes = Object.entries(workflow)
        .filter(([, node]) => node?.class_type === 'FluxKVCache');
    for (const [cacheNodeId, cacheNode] of cacheNodes) {
        const upstreamModel = cacheNode?.inputs?.model;
        if (!Array.isArray(upstreamModel) || upstreamModel.length !== 2) {
            throw new Error(`Flux KV Cache node "${cacheNodeId}" has no valid upstream model connection.`);
        }

        for (const node of Object.values(workflow)) {
            if (!node?.inputs || typeof node.inputs !== 'object') continue;
            for (const [inputName, inputValue] of Object.entries(node.inputs)) {
                if (Array.isArray(inputValue) && String(inputValue[0]) === cacheNodeId) {
                    node.inputs[inputName] = [...upstreamModel];
                }
            }
        }
        delete workflow[cacheNodeId];
    }
}

function applyStandardImageWorkflowSettings(workflow, image) {
    if (!workflow || typeof workflow !== 'object' || !image || typeof image !== 'object') {
        throw new Error('Standard image workflow settings require a parsed workflow and image settings.');
    }
    const usesDualModelGuidance = Object.values(workflow).some(node => node?.class_type === 'DualModelGuider');
    if (usesDualModelGuidance && typeof image.checkpoint === 'string' && image.checkpoint.trim()) {
        throw new Error(
            'This standard workflow uses paired conditional and unconditional models and does not support a single model override. '
            + 'Leave the model field blank or select a custom workflow with the required paired models.'
        );
    }
    for (const node of Object.values(workflow)) {
        const inputs = node?.inputs;
        if (!inputs || typeof inputs !== 'object') continue;
        switch (node.class_type) {
        case 'CheckpointLoaderSimple': setIfNonEmpty(inputs, 'ckpt_name', image.checkpoint); break;
        case 'UNETLoader':
        case 'UnetLoaderGGUF': setIfNonEmpty(inputs, 'unet_name', image.checkpoint); break;
        case 'CLIPLoader':
        case 'CLIPLoaderGGUF': setIfNonEmpty(inputs, 'clip_name', image.textEncoder); break;
        case 'VAELoader':
        case 'VAEUtils_CustomVAELoader': setIfNonEmpty(inputs, 'vae_name', image.vae); break;
        case 'KSampler':
        case 'KSamplerAdvanced':
            setIfFinite(inputs, 'steps', image.steps);
            setIfFinite(inputs, 'cfg', image.cfg);
            setIfFinite(inputs, 'denoise', image.denoise);
            setIfNonEmpty(inputs, 'sampler_name', image.sampler);
            setIfNonEmpty(inputs, 'scheduler', image.scheduler);
            setIfFinite(inputs, 'seed', image.seed);
            break;
        case 'KSamplerSelect': setIfNonEmpty(inputs, 'sampler_name', image.sampler); break;
        case 'RandomNoise': setIfFinite(inputs, 'noise_seed', image.seed); break;
        case 'Seed Everywhere': setIfFinite(inputs, 'seed', image.seed); break;
        case 'CFGGuider':
        case 'DualModelGuider': setIfFinite(inputs, 'cfg', image.cfg); break;
        case 'Flux2Scheduler':
        case 'Ideogram4Scheduler': setIfFinite(inputs, 'steps', image.steps); break;
        case 'EmptyLatentImage':
        case 'EmptySD3LatentImage':
        case 'EmptyHunyuanLatentVideo':
        case 'EmptyFlux2LatentImage':
            setCanvasDimensionIfUnlinked(inputs, 'width', image.width);
            setCanvasDimensionIfUnlinked(inputs, 'height', image.height);
            break;
        default: break;
        }
    }
    configureFluxKvCache(workflow, image.fluxKvCacheEnabled);
    appendSelectedLoras(workflow, image.loras);
    return workflow;
}

module.exports = {
    STANDARD_IMAGE_WORKFLOWS,
    STANDARD_BATCH_WORKFLOWS,
    resolveStandardWorkflowTemplate,
    resolveStandardBatchWorkflowTemplate,
    isStandardImageWorkflow,
    applyStandardImageWorkflowSettings
};
