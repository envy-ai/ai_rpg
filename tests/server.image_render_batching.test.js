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

function loadBatchedGenerationHarness({ outputCount = 2 } = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = source.indexOf('async function processBatchedImageGeneration(jobs) {');
    const end = source.indexOf('\n// Process a single image generation job', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate batched image generation function in server.js');
    }

    const renderedTemplateVars = [];
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
        throwIfAborted: () => {},
        withRetry: callback => callback(),
        imagePromptEnv: {
            render: (_template, variables) => {
                renderedTemplateVars.push(variables);
                return '{"output":{"class_type":"TestOutput","inputs":{}}}';
            }
        },
        updateBatchedImageJobs: (jobs, updates) => jobs.forEach(job => Object.assign(job, updates)),
        updateComfyRenderProgress: () => {},
        comfyUIClient: {
            generatePromptId: () => 'initial-prompt-id',
            queuePrompt: async () => ({
                success: true,
                promptId: 'shared-comfy-prompt-id',
                clientId: 'client-id'
            }),
            waitForCompletion: async () => ({
                success: true,
                images: Array.from({ length: outputCount }, (_, index) => ({
                    filename: `output-${index + 1}.webp`,
                    subfolder: '',
                    type: 'output'
                }))
            }),
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

test('render batching separates workflow overrides even when resolution matches', () => {
    const harness = loadRenderBatchHarness();
    harness.enqueue('default', { width: 1200, height: 1600 });
    harness.enqueue('override', {
        width: 1200,
        height: 1600,
        api_template: 'other-batch.json.njk'
    });

    const first = harness.context.takeNextImageRenderBatch();
    assert.deepEqual(Array.from(first.jobs, job => job.id), ['default']);
    assert.deepEqual(harness.jobQueue, ['override']);
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
    assert.equal(
        config.imagegen.api_template,
        'test_krea_2_simplified_lovely_batch.json.njk'
    );
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
