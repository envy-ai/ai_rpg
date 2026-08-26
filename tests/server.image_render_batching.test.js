const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const yaml = require('js-yaml');

function loadRenderBatchHarness({ enabled = true } = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = source.indexOf('function imageRenderPromptBatchingIsEnabled(configuration = config) {');
    const end = source.indexOf('\nfunction startImageJob(job) {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate image render batching helpers in server.js');
    }

    const imageJobs = new Map();
    const jobQueue = [];
    const context = {
        config: {
            imagegen: {
                engine: 'comfyui',
                batch_prompts: enabled,
                api_template: 'batch.json.njk',
                default_settings: { image: { width: 1024, height: 1024 } }
            }
        },
        imageJobs,
        jobQueue,
        JOB_STATUS: { QUEUED: 'queued' },
        getActiveSettingSnapshot: () => null,
        resolveStandardWorkflowTemplate: () => 'standard/krea2-generation.json.njk',
        resolveStandardBatchWorkflowTemplate: () => 'standard/krea2-generation-batch.json.njk',
        JSON,
        String,
        Error
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}\nthis.takeNextImageRenderBatch = takeNextImageRenderBatch;`,
        context
    );

    const enqueue = (id, payload = {}) => {
        const job = { id, status: 'queued', payload };
        imageJobs.set(id, job);
        jobQueue.push(id);
        return job;
    };
    return { context, enqueue, jobQueue };
}

function loadWorkflowResolutionHarness(configuration, activeSetting = null) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = source.indexOf('function resolveEffectiveImageWorkflowSettings(mode, configuration = config) {');
    const end = source.indexOf('\nfunction buildImageRenderBatchKey(', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate image workflow resolution helper in server.js');
    }
    const context = {
        config: configuration,
        getActiveSettingSnapshot: () => activeSetting,
        resolveStandardBatchWorkflowTemplate: family => `standard/${family}-generation-batch.json.njk`,
        resolveStandardWorkflowTemplate: (mode, family) => `standard/${family}-${mode}.json.njk`
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}\nthis.resolveImageJobWorkflowTemplate = resolveImageJobWorkflowTemplate;`,
        context
    );
    return context.resolveImageJobWorkflowTemplate;
}

function loadImageTemplateDataHarness(workflowSettings) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = source.indexOf('function buildImageWorkflowTemplateData(job) {');
    const end = source.indexOf('\nasync function processImageJobBatch(', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate image workflow template-data helper in server.js');
    }
    const context = {
        config: {
            imagegen: {
                default_settings: {
                    image: { seed: 123 },
                    sampling: { steps: 99 }
                },
                lora: null,
                lora_strength: 1
            }
        },
        buildNegativePrompt: () => 'fallback negative',
        resolveMegapixels: value => value || 1,
        resolveImageJobRenderDimensions: () => ({ width: 1920, height: 1080 }),
        resolveEffectiveImageWorkflowSettings: () => workflowSettings,
        Math,
        Number,
        String,
        Error
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}\nthis.buildImageWorkflowTemplateData = buildImageWorkflowTemplateData;`,
        context
    );
    return context.buildImageWorkflowTemplateData;
}

function loadBatchedGenerationHarness({ outputCount = 2, progressEvents = [] } = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = source.indexOf('function createBatchedComfyProgressHandler(jobs, workflow) {');
    const end = source.indexOf('\n// Process a single image generation job', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate batched image generation function in server.js');
    }

    const renderedTemplateVars = [];
    const renderProgressUpdates = [];
    const generatedImages = new Map();
    let nextImageId = 0;
    const context = {
        Array,
        Date,
        Error,
        JSON,
        Map,
        Object,
        config: { imagegen: {} },
        path: { join: (...parts) => parts.join('/') },
        fs: {
            existsSync: () => true,
            mkdirSync: () => {
                throw new Error('save directory should already exist in this harness');
            }
        },
        __dirname: '/game',
        buildImageRenderBatchKey: job => JSON.stringify([
            job.payload.api_template,
            job.payload.width,
            job.payload.height
        ]),
        buildImageWorkflowTemplateData: job => ({ ...job.payload }),
        resolveImageJobWorkflowTemplate: job => job.payload.api_template,
        isStandardImageWorkflow: () => false,
        applyStandardImageWorkflowSettings: () => {},
        throwIfAborted: () => {},
        withRetry: callback => callback(),
        imagePromptEnv: {
            render: (_template, variables) => {
                renderedTemplateVars.push(variables);
                return '{"sampler":{"class_type":"KSampler","inputs":{}},"output":{"class_type":"TestOutput","inputs":{}}}';
            }
        },
        updateBatchedImageJobs: (jobs, updates) => jobs.forEach(job => Object.assign(job, updates)),
        updateComfyRenderProgress: (job, progressEvent) => {
            renderProgressUpdates.push({
                jobId: job.id,
                nodeId: progressEvent.nodeId,
                fraction: progressEvent.fraction
            });
        },
        comfyUIClient: {
            generatePromptId: () => 'initial-prompt-id',
            queuePrompt: async () => ({
                success: true,
                promptId: 'shared-comfy-prompt-id',
                clientId: 'client-id'
            }),
            waitForCompletion: async (_promptId, _maxWaitTime, _pollInterval, options) => {
                progressEvents.forEach(progressEvent => options.onProgress(progressEvent));
                return {
                    success: true,
                    images: Array.from({ length: outputCount }, (_, index) => ({
                        filename: `output-${index + 1}.webp`,
                        subfolder: '',
                        type: 'output'
                    }))
                };
            },
            getImage: async imageName => `bytes:${imageName}`,
            saveImage: async (_bytes, imageId, originalFilename) => ({
                success: true,
                filename: `${imageId}-${originalFilename}`,
                size: 123
            })
        },
        generateImageId: () => `image-${++nextImageId}`,
        warnIfEditedImageSizeDiffers: async () => {},
        isImageJobRuntimeStale: () => false,
        generatedImages
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}\nthis.processBatchedImageGeneration = processBatchedImageGeneration;`,
        context
    );
    return {
        processBatchedImageGeneration: context.processBatchedImageGeneration,
        renderedTemplateVars,
        renderProgressUpdates,
        generatedImages
    };
}

test('render batching groups all queued jobs with the same workflow and exact resolution', () => {
    const harness = loadRenderBatchHarness();
    harness.enqueue('square-a', { width: 1600, height: 1600 });
    harness.enqueue('wide', { width: 1920, height: 1080 });
    harness.enqueue('square-b', { width: 1600, height: 1600 });

    const first = harness.context.takeNextImageRenderBatch();
    assert.equal(first.useBatchWorkflow, true);
    assert.deepEqual(Array.from(first.jobs, job => job.id), ['square-a', 'square-b']);
    assert.deepEqual(harness.jobQueue, ['wide']);

    const second = harness.context.takeNextImageRenderBatch();
    assert.equal(second.useBatchWorkflow, true);
    assert.deepEqual(Array.from(second.jobs, job => job.id), ['wide']);
});

test('render jobs cannot bypass the selected workflow with a stale payload template', () => {
    const harness = loadRenderBatchHarness();
    harness.enqueue('default', { width: 1200, height: 1600 });
    harness.enqueue('stale-payload', {
        width: 1200,
        height: 1600,
        api_template: 'other-batch.json.njk'
    });

    const first = harness.context.takeNextImageRenderBatch();
    assert.deepEqual(Array.from(first.jobs, job => job.id), ['default', 'stale-payload']);
    assert.deepEqual(harness.jobQueue, []);
});

test('weather variants and disabled configurations retain the single-job workflow', () => {
    const weatherHarness = loadRenderBatchHarness();
    weatherHarness.enqueue('weather', {
        width: 1920,
        height: 1080,
        isLocationWeatherVariant: true
    });
    assert.equal(weatherHarness.context.takeNextImageRenderBatch().useBatchWorkflow, false);

    const disabledHarness = loadRenderBatchHarness({ enabled: false });
    disabledHarness.enqueue('one', { width: 1600, height: 1600 });
    disabledHarness.enqueue('two', { width: 1600, height: 1600 });
    const selection = disabledHarness.context.takeNextImageRenderBatch();
    assert.equal(selection.useBatchWorkflow, false);
    assert.deepEqual(Array.from(selection.jobs, job => job.id), ['one']);
    assert.deepEqual(disabledHarness.jobQueue, ['two']);
});

test('qwen combo router enables prompt-list rendering with the new Krea 2 workflow', () => {
    const config = yaml.load(fs.readFileSync(
        path.join(__dirname, '..', 'config.yaml.qwen-combo-router'),
        'utf8'
    ));
    assert.equal(config.imagegen.batch_prompts, true);
    assert.equal(Object.hasOwn(config.imagegen, 'api_template'), false);
    assert.equal(config.imagegen.workflow.generation.family, 'krea2');
    assert.equal(config.imagegen.workflow.generation.custom_template, '');
});

test('selected workflow settings take precedence over obsolete top-level template fields', () => {
    const configuration = {
        imagegen: {
            batch_prompts: true,
            api_template: 'obsolete-generation.json.njk',
            workflow: {
                generation: { family: 'krea2', custom_template: '' },
                edit: { family: 'qwen', custom_template: '' }
            },
            location_variant_settings: { api_template: 'obsolete-edit.json.njk' }
        }
    };
    const resolve = loadWorkflowResolutionHarness(configuration);

    assert.equal(resolve(null, configuration), 'standard/krea2-generation-batch.json.njk');
    assert.equal(
        resolve({ payload: { isLocationWeatherVariant: true } }, configuration),
        'standard/qwen-edit.json.njk'
    );

    configuration.imagegen.workflow.generation.custom_template = 'selected-custom.json.njk';
    assert.equal(resolve(null, configuration), 'selected-custom.json.njk');
    assert.equal(
        resolve({ payload: { api_template: 'stale-job-template.json.njk' } }, configuration),
        'selected-custom.json.njk'
    );
});

test('seasonal variants use the effective edit profile without legacy sampling overlays', () => {
    const buildTemplateData = loadImageTemplateDataHarness({
        model: 'selected-flux.safetensors',
        text_encoder: 'selected-encoder.safetensors',
        vae: 'selected-vae.safetensors',
        loras: ['selected-style.safetensors'],
        steps: 4,
        cfg: 1,
        sampler: 'euler',
        scheduler: 'simple',
        denoise: 1,
        flux_kv_cache: true
    });
    const templateData = buildTemplateData({
        id: 'seasonal-job',
        payload: {
            isLocationWeatherVariant: true,
            prompt: 'Make this location look wintry.',
            negative_prompt: 'new people',
            seed: 42,
            steps: 20,
            cfg: 6,
            sampler: 'dpmpp_2m',
            scheduler: 'karras',
            denoise: 0.45
        }
    });

    assert.equal(templateData.checkpoint, 'selected-flux.safetensors');
    assert.equal(templateData.textEncoder, 'selected-encoder.safetensors');
    assert.equal(templateData.vae, 'selected-vae.safetensors');
    assert.deepEqual(Array.from(templateData.loras), ['selected-style.safetensors']);
    assert.equal(templateData.steps, 4);
    assert.equal(templateData.cfg, 1);
    assert.equal(templateData.sampler, 'euler');
    assert.equal(templateData.scheduler, 'simple');
    assert.equal(templateData.denoise, 1);
    assert.equal(templateData.fluxKvCacheEnabled, true);

    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const processStart = serverSource.indexOf('async function processImageGeneration(job) {');
    const processEnd = serverSource.indexOf('\n// Configuration validation function', processStart);
    assert.notEqual(processStart, -1);
    assert.notEqual(processEnd, -1);
    const processSource = serverSource.slice(processStart, processEnd);
    assert.doesNotMatch(processSource, /job\.payload\.(?:steps|cfg|sampler|scheduler|denoise)/);
});

test('qwen combo router sends player-visible prose families to the prose model', () => {
    const config = yaml.load(fs.readFileSync(
        path.join(__dirname, '..', 'config.yaml.qwen-combo-router'),
        'utf8'
    ));
    const prosePrompts = config.ai_model_overrides.prose.prompts;

    assert.deepEqual(
        [
            'player_action',
            'creative_mode_action',
            'npc_action',
            'craft_player_action',
            'location_modify_player_action',
            'player_action_open_container',
            'random_event',
            'npc_plausibility',
            'quest_reward_prose',
            'while_you_were_away',
            'generic_prompt',
            'generic_prompt_nocontext',
            'question',
            'game_intro',
            'scheduled_event_resolution',
            'player_action_interruption_rewrite'
        ].filter(label => !prosePrompts.includes(label)),
        []
    );
    assert.equal(prosePrompts.includes('slop_remover'), false);
});

test('one Comfy submission maps ordered outputs back to distinct image jobs', async () => {
    const harness = loadBatchedGenerationHarness();
    const abortController = new AbortController();
    const jobs = [
        {
            id: 'job-one',
            timeout: 300000,
            abortController,
            payload: {
                api_template: 'batch.json.njk',
                prompt: 'first prompt',
                negativePrompt: '',
                width: 1200,
                height: 1600,
                seed: 41
            }
        },
        {
            id: 'job-two',
            timeout: 300000,
            abortController,
            payload: {
                api_template: 'batch.json.njk',
                prompt: 'second prompt',
                negativePrompt: '',
                width: 1200,
                height: 1600,
                seed: 42
            }
        }
    ];

    const results = await harness.processBatchedImageGeneration(jobs);
    assert.equal(harness.renderedTemplateVars.length, 1);
    assert.deepEqual(
        Array.from(harness.renderedTemplateVars[0].images, image => image.prompt),
        ['first prompt', 'second prompt']
    );
    assert.equal(results.get('job-one').imageId, 'image-1');
    assert.equal(results.get('job-two').imageId, 'image-2');
    assert.equal(results.get('job-one').metadata.comfyUIPromptId, 'shared-comfy-prompt-id');
    assert.equal(results.get('job-two').metadata.comfyUIPromptId, 'shared-comfy-prompt-id');
    assert.equal(harness.generatedImages.size, 2);
});

test('batched sampler cycles produce one monotonic overall progress pass for every image job', async () => {
    const harness = loadBatchedGenerationHarness({
        progressEvents: [
            { nodeId: 'sampler', value: 1, max: 4, fraction: 0.25 },
            { nodeId: 'sampler', value: 4, max: 4, fraction: 1 },
            { nodeId: 'sampler', value: 1, max: 4, fraction: 0.25 },
            { nodeId: 'sampler', value: 4, max: 4, fraction: 1 }
        ]
    });
    const abortController = new AbortController();
    const jobs = ['one', 'two'].map((id, index) => ({
        id,
        timeout: 300000,
        abortController,
        payload: {
            api_template: 'batch.json.njk',
            prompt: `prompt ${id}`,
            negativePrompt: '',
            width: 1600,
            height: 1600,
            seed: index + 1
        }
    }));

    await harness.processBatchedImageGeneration(jobs);

    const progressByJob = jobs.map(job => harness.renderProgressUpdates
        .filter(update => update.jobId === job.id)
        .map(update => update.fraction));
    assert.deepEqual(progressByJob, [
        [0.125, 0.5, 0.625, 1],
        [0.125, 0.5, 0.625, 1]
    ]);
    progressByJob.forEach(fractions => {
        assert.equal(fractions.every((fraction, index) => index === 0 || fraction >= fractions[index - 1]), true);
    });
});

test('batched generation rejects output counts that cannot map one-to-one', async () => {
    const harness = loadBatchedGenerationHarness({ outputCount: 1 });
    const abortController = new AbortController();
    const jobs = ['one', 'two'].map((id, index) => ({
        id,
        timeout: 300000,
        abortController,
        payload: {
            api_template: 'batch.json.njk',
            prompt: `prompt ${id}`,
            negativePrompt: '',
            width: 1600,
            height: 1600,
            seed: index + 1
        }
    }));

    await assert.rejects(
        () => harness.processBatchedImageGeneration(jobs),
        /returned 1 images for 2 prompts/
    );
    assert.equal(harness.generatedImages.size, 0);
});

test('batch rendering has strict configuration and output-count guards', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(source, /batch_prompts must be a boolean when provided/);
    assert.match(source, /batch_prompts requires the ComfyUI engine/);
    assert.match(
        source,
        /Batched ComfyUI workflow returned \$\{completionResult\.images\.length\} images for \$\{jobs\.length\} prompts/
    );
});
