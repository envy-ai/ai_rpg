const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const nunjucks = require('nunjucks');
const Utils = require('../Utils.js');
const Globals = require('../Globals.js');
const PromptAuditLog = require('../PromptAuditLog.js');
const PromptFailureReporter = require('../PromptFailureReporter.js');

const BASE_CONTEXT_END_MARKER = '[[[AI_RPG_INTERNAL_BASE_CONTEXT_END_V1]]]';

function loadImagePromptBatchHarness({
    promptBatching = { enabled: true, delay_ms: 2000, max_items: 10 },
    settingSnapshot = {},
    promptGenerationAttempts = undefined,
    chatCompletion = null,
    unloadDuringImageGeneration = false,
    terminateDuringImageGeneration = false
} = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function resolveBaseContextPreambleForImagePrompts() {');
    const end = source.indexOf('\n// Function to generate location scene image', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate image prompt batching helpers in server.js');
    }

    const functionSource = source.slice(start, end);
    const calls = [];
    const requestOptions = [];
    const logs = [];
    let nextTimerId = 1;
    const timers = new Map();
    const context = {
        console,
        PromptAuditLog,
        PromptFailureReporter,
        Date,
        String,
        Number,
        Array,
        Map,
        Promise,
        RegExp,
        config: {
            ai: {
                backend: 'openai_compatible',
                unload_during_image_generation: unloadDuringImageGeneration,
                terminate_during_image_generation: terminateDuringImageGeneration
            },
            imagegen: {
                engine: 'comfyui',
                prompt_batching: promptBatching,
                ...(promptGenerationAttempts === undefined ? {} : { prompt_generation_attempts: promptGenerationAttempts })
            }
        },
        getActiveSettingSnapshot: () => settingSnapshot,
        buildBasePromptContext: () => ({}),
        promptEnv: { render: (_name, values) => JSON.stringify(values) },
        parseXMLTemplate: rendered => {
            const values = JSON.parse(rendered);
            return { systemPrompt: 'canonical system', generationPrompt: `shared context\n${BASE_CONTEXT_END_MARKER}\n${values.imagePromptWriterInstructions}\n${values.imagePromptWriterRequest}` };
        },
        normalizeLocationWeatherExposure: value => (value ? 'yes' : 'no'),
        resolveLocationHasWeather: () => true,
        deterministicTemplateEnv: {
            render: (templateName, variables) => variables?.image?.prompt || ''
        },
        escapeXmlText: value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;'),
        Utils,
        LLMClient: {
            resolveEffectiveAiConfiguration: (_label, fullConfig) => ({ aiConfig: fullConfig.ai }),
            resolveBackend: aiConfig => aiConfig.backend,
            getBaseContextEndMarker: () => BASE_CONTEXT_END_MARKER,
            chatCompletion: async (options) => {
                const { messages } = options;
                requestOptions.push(options);
                calls.push(messages);
                PromptFailureReporter.transportAttempt('image_prompt_generation');
                if (typeof chatCompletion === 'function') {
                    return chatCompletion({ messages, calls });
                }
                const userPrompt = messages[1]?.content || '';
                const ids = Array.from(userPrompt.matchAll(/<id>([^<]+)<\/id>/g))
                    .map(match => match[1]);
                if (ids.length) {
                    return [
                        '<imagePrompts>',
                        ...ids.map((id, index) => [
                            '  <imagePrompt>',
                            `    <id>${id}</id>`,
                            `    <prompt><![CDATA[generated batch prompt ${index + 1}]]></prompt>`,
                            '  </imagePrompt>'
                        ].join('\n')),
                        '</imagePrompts>'
                    ].join('\n');
                }
                return 'generated single prompt';
            },
            logPrompt: entry => logs.push(entry)
        },
        imageModelLifecycleCyclePromise: null,
        runtimeGenerationId: 0,
        shouldCoordinateAiModelDuringImageGeneration: () => (
            unloadDuringImageGeneration || terminateDuringImageGeneration
        ),
        scheduleImageRenderBatchIfReady: () => false,
        setTimeout: (callback, delay) => {
            const id = nextTimerId++;
            timers.set(id, { callback, delay });
            return id;
        },
        clearTimeout: id => timers.delete(id)
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.generateImagePromptFromTemplate = generateImagePromptFromTemplate;
this.flushImagePromptBatchQueue = flushImagePromptBatchQueue;
this.getImagePromptBatchConfig = getImagePromptBatchConfig;`,
        context
    );

    return {
        generateImagePromptFromTemplate: context.generateImagePromptFromTemplate,
        flushImagePromptBatchQueue: context.flushImagePromptBatchQueue,
        getImagePromptBatchConfig: context.getImagePromptBatchConfig,
        calls,
        requestOptions,
        logs,
        timers
    };
}

test('image prompt generation batches compatible queued requests', async () => {
    const harness = loadImagePromptBatchHarness({
        settingSnapshot: {
            imagePromptPrefixItem: 'item prefix'
        }
    });
    const first = harness.generateImagePromptFromTemplate({
        systemPrompt: 'item system',
        generationPrompt: 'describe item one'
    }, { prefixType: 'item' });
    const second = harness.generateImagePromptFromTemplate({
        systemPrompt: 'item system',
        generationPrompt: 'describe item two'
    }, { prefixType: 'item' });

    assert.equal(harness.calls.length, 0);
    assert.equal(harness.timers.size, 1);

    harness.flushImagePromptBatchQueue();
    const results = await Promise.all([first, second]);

    assert.equal(harness.calls.length, 1);
    assert.equal(harness.requestOptions[0].allowToolCalls, false);
    assert.match(harness.calls[0][1].content, /<imagePromptBatchRequest>/);
    assert.match(harness.calls[0][1].content, /describe item one/);
    assert.match(harness.calls[0][1].content, /describe item two/);
    assert.equal(results[0].prompt, 'item prefix\n\ngenerated batch prompt 1');
    assert.equal(results[1].prompt, 'item prefix\n\ngenerated batch prompt 2');
    assert.equal(harness.logs.some(entry => entry.prefix === 'image_prompt_generation_batch'), true);
});

test('item and scenery image prompts retain their own setting prefixes', async () => {
    const harness = loadImagePromptBatchHarness({
        settingSnapshot: {
            imagePromptPrefixItem: 'item-only icon background',
            imagePromptPrefixScenery: 'scenery environment style'
        }
    });
    const item = harness.generateImagePromptFromTemplate({
        systemPrompt: 'item system', generationPrompt: 'describe the portable item'
    }, { prefixType: 'item' });
    const scenery = harness.generateImagePromptFromTemplate({
        systemPrompt: 'scenery system', generationPrompt: 'describe the fixed feature'
    }, { prefixType: 'scenery' });

    harness.flushImagePromptBatchQueue();
    const [itemResult, sceneryResult] = await Promise.all([item, scenery]);

    assert.equal(itemResult.prompt, 'item-only icon background\n\ngenerated batch prompt 1');
    assert.equal(sceneryResult.prompt, 'scenery environment style\n\ngenerated batch prompt 2');
    assert.equal(harness.calls.length, 1);
});

test('ability and technique icon templates use their distinct world prefixes and action facts', async () => {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('prompts'), { autoescape: false });
    const abilityTemplate = env.render('ability-image.xml.njk', {
        setting: { name: 'Starfall', description: 'An astral fantasy world.', genre: 'fantasy', theme: 'celestial' },
        action: { name: 'Wind Read', description: 'Senses shifts in air.', shortDescription: 'Reads the wind', type: 'Passive' }
    });
    const techniqueTemplate = env.render('technique-image.xml.njk', {
        setting: { name: 'Starfall', description: 'An astral fantasy world.', genre: 'fantasy', theme: 'celestial' },
        action: { name: 'Field Mend', description: 'Restores an ally.', shortDescription: 'Mends a wound' }
    });
    assert.match(abilityTemplate, /Ability Icon Prompt Writer/);
    assert.match(abilityTemplate, /<name>Wind Read<\/name>/);
    assert.match(techniqueTemplate, /Technique Icon Prompt Writer/);
    assert.match(techniqueTemplate, /<name>Field Mend<\/name>/);
    assert.match(techniqueTemplate, /<description>Restores an ally\.<\/description>/);

    const harness = loadImagePromptBatchHarness({ settingSnapshot: {
        imagePromptPrefixAbility: 'ability-only palette',
        imagePromptPrefixTechnique: 'technique-only palette'
    } });
    const ability = harness.generateImagePromptFromTemplate({ systemPrompt: 'icon writer', generationPrompt: 'draw a wind symbol' }, { prefixType: 'ability' });
    const technique = harness.generateImagePromptFromTemplate({ systemPrompt: 'icon writer', generationPrompt: 'draw a healing symbol' }, { prefixType: 'technique' });
    harness.flushImagePromptBatchQueue();
    const [abilityResult, techniqueResult] = await Promise.all([ability, technique]);
    assert.equal(abilityResult.prompt, 'ability-only palette\n\ngenerated batch prompt 1');
    assert.equal(techniqueResult.prompt, 'technique-only palette\n\ngenerated batch prompt 2');
});

test('scenery image instructions place fixed features in their environment', () => {
    const env = new nunjucks.Environment(
        new nunjucks.FileSystemLoader('prompts'),
        { autoescape: false }
    );
    const rendered = env.render('scenery-image.xml.njk', {
        setting: {},
        thingName: 'Village fountain',
        thingDescription: 'An old stone fountain.'
    });

    assert.match(rendered, /surrounding location/);
    assert.match(rendered, /Show the feature in place/);
    assert.doesNotMatch(rendered, /(?:grey|gray) background|item icon|if the item has been rebuilt/i);
});

test('image prompt batching shares one base context and preserves each faction request', async () => {
    const harness = loadImagePromptBatchHarness();
    const sharedContext = '<gameState>shared faction context</gameState>';
    const first = harness.generateImagePromptFromTemplate({
        systemPrompt: 'faction emblem system',
        generationPrompt: `${sharedContext}\n${BASE_CONTEXT_END_MARKER}\n<task>Emblem for faction one</task>`
    }, { prefixType: 'faction' });
    const second = harness.generateImagePromptFromTemplate({
        systemPrompt: 'faction emblem system',
        generationPrompt: `${sharedContext}\n${BASE_CONTEXT_END_MARKER}\n<task>Emblem for faction two</task>`
    }, { prefixType: 'faction' });

    harness.flushImagePromptBatchQueue();
    const results = await Promise.all([first, second]);

    assert.equal(harness.calls.length, 1);
    const batchPrompt = harness.calls[0][1].content;
    assert.equal(batchPrompt.split(BASE_CONTEXT_END_MARKER).length - 1, 1);
    assert.equal(batchPrompt.split(sharedContext).length - 1, 1);
    assert.match(batchPrompt, /Emblem for faction one/);
    assert.match(batchPrompt, /Emblem for faction two/);
    assert.equal(results[0].prompt, 'generated batch prompt 1');
    assert.equal(results[1].prompt, 'generated batch prompt 2');
});

test('image prompt batching separates requests with different base contexts', async () => {
    const harness = loadImagePromptBatchHarness();
    const first = harness.generateImagePromptFromTemplate({
        systemPrompt: 'faction emblem system',
        generationPrompt: `first context\n${BASE_CONTEXT_END_MARKER}\n<task>Emblem one</task>`
    }, { prefixType: 'faction' });
    const second = harness.generateImagePromptFromTemplate({
        systemPrompt: 'faction emblem system',
        generationPrompt: `second context\n${BASE_CONTEXT_END_MARKER}\n<task>Emblem two</task>`
    }, { prefixType: 'faction' });

    harness.flushImagePromptBatchQueue();
    const results = await Promise.all([first, second]);

    assert.equal(harness.calls.length, 2);
    assert.equal(results[0].prompt, 'generated single prompt');
    assert.equal(results[1].prompt, 'generated single prompt');
});

test('image prompt batching preserves each writer instruction in its own task', async () => {
    const harness = loadImagePromptBatchHarness();
    const first = harness.generateImagePromptFromTemplate({
        systemPrompt: 'item system',
        generationPrompt: 'describe item'
    }, { prefixType: 'item' });
    const second = harness.generateImagePromptFromTemplate({
        systemPrompt: 'location system',
        generationPrompt: 'describe location'
    }, { prefixType: 'location' });

    harness.flushImagePromptBatchQueue();
    const results = await Promise.all([first, second]);

    assert.equal(harness.calls.length, 1);
    assert.match(harness.calls[0][1].content, /item system/);
    assert.match(harness.calls[0][1].content, /location system/);
    assert.equal(results[0].prompt, 'generated batch prompt 1');
    assert.equal(results[1].prompt, 'generated batch prompt 2');
});

test('unbatched image writer explicitly disables tools', async () => {
    const harness = loadImagePromptBatchHarness({ promptBatching: { enabled: false, delay_ms: 0, max_items: 1 } });
    await harness.generateImagePromptFromTemplate({ systemPrompt: 'instruction', generationPrompt: 'visual' });
    assert.equal(harness.requestOptions[0].allowToolCalls, false);
});

test('image prompt generation retries leaked prompt wrappers before accepting a final prompt', async () => {
    const responses = [
        '<context><setting>full setting dump</setting><task>Create an image prompt.</task></context>',
        'clean final item image prompt'
    ];
    const harness = loadImagePromptBatchHarness({
        promptBatching: { enabled: false, delay_ms: 0, max_items: 10 },
        promptGenerationAttempts: 3,
        chatCompletion: () => responses.shift()
    });

    const result = await harness.generateImagePromptFromTemplate({
        systemPrompt: 'item system',
        generationPrompt: 'describe item'
    }, { prefixType: 'item' });

    assert.equal(harness.calls.length, 2);
    assert.equal(result.prompt, 'clean final item image prompt');
});

test('image prompt generation rejects instead of falling back to the source generation prompt after retries fail', async () => {
    const harness = loadImagePromptBatchHarness({
        promptBatching: { enabled: false, delay_ms: 0, max_items: 10 },
        promptGenerationAttempts: 2,
        chatCompletion: () => '<context><setting>full setting dump</setting></context>'
    });

    await assert.rejects(
        () => harness.generateImagePromptFromTemplate({
            systemPrompt: 'item system',
            generationPrompt: '<context><setting>source prompt that must not be forwarded</setting></context>'
        }, { prefixType: 'item' }),
        /Image prompt generation failed after 2 attempt\(s\)/
    );
    assert.equal(harness.calls.length, 2);
});

test('terminal image-text validation reports exact attempts while parser recovery stays quiet', { concurrency: false }, async () => {
    const previousHub = Globals.realtimeHub;
    const events = [];
    Globals.realtimeHub = { emit(_room, type, payload) { if (type === 'prompt_failed') events.push(payload); } };
    try {
        const failed = loadImagePromptBatchHarness({
            promptBatching: { enabled: false, delay_ms: 0, max_items: 10 },
            promptGenerationAttempts: 7,
            chatCompletion: () => '<context><setting>leaked prompt context</setting></context>'
        });
        await assert.rejects(failed.generateImagePromptFromTemplate({
            systemPrompt: 'item system', generationPrompt: 'describe an item'
        }, { prefixType: 'item' }), /Image prompt generation failed after 7 attempt/);
        assert.equal(failed.calls.length, 7);
        assert.equal(events.length, 1);
        assert.equal(events[0].metadataLabel, 'image_prompt_generation');
        assert.equal(events[0].kind, 'image_text');
        assert.equal(events[0].transportAttempts, 7);
        assert.equal(events[0].validationRetries, 6);

        events.length = 0;
        const recovered = loadImagePromptBatchHarness({
            promptBatching: { enabled: false, delay_ms: 0, max_items: 10 },
            promptGenerationAttempts: 3,
            chatCompletion: ({ calls }) => calls.length === 1
                ? '<context><setting>leaked prompt context</setting></context>'
                : 'clean recovered image prompt'
        });
        const result = await recovered.generateImagePromptFromTemplate({
            systemPrompt: 'item system', generationPrompt: 'describe another item'
        }, { prefixType: 'item' });
        assert.equal(recovered.calls.length, 2);
        assert.equal(result.prompt, 'clean recovered image prompt');
        assert.deepEqual(events, []);
    } finally {
        Globals.realtimeHub = previousHub;
    }
});

test('explicit image-text prompt cancellation stops immediately without a failure event', { concurrency: false }, async () => {
    const previousHub = Globals.realtimeHub;
    const events = [];
    Globals.realtimeHub = { emit(_room, type, payload) { if (type === 'prompt_failed') events.push(payload); } };
    const cancellation = new Error('Image prompt generation cancelled.');
    cancellation.name = 'PromptCancellationError';
    cancellation.code = 'PROMPT_CANCELLED';
    const harness = loadImagePromptBatchHarness({
        promptBatching: { enabled: false, delay_ms: 0, max_items: 10 },
        promptGenerationAttempts: 3,
        chatCompletion: () => { throw cancellation; }
    });
    try {
        await assert.rejects(harness.generateImagePromptFromTemplate({
            systemPrompt: 'item system', generationPrompt: 'cancelled item'
        }, { prefixType: 'item' }), error => error === cancellation);
        assert.equal(harness.calls.length, 1);
        assert.deepEqual(events, []);
    } finally {
        Globals.realtimeHub = previousHub;
    }
});

test('image prompt batch config defaults to two seconds and ten items', () => {
    const harness = loadImagePromptBatchHarness({
        promptBatching: {}
    });

    assert.deepEqual(JSON.parse(JSON.stringify(harness.getImagePromptBatchConfig())), {
        enabled: true,
        delayMs: 2000,
        maxItems: 10
    });
});

test('model-unload image prompt requests flush immediately instead of waiting for the debounce', async () => {
    const harness = loadImagePromptBatchHarness({
        unloadDuringImageGeneration: true
    });

    const resultPromise = harness.generateImagePromptFromTemplate({
        systemPrompt: 'item system',
        generationPrompt: 'describe immediate item'
    }, { prefixType: 'item' });

    assert.equal(harness.timers.size, 1);
    assert.equal(Array.from(harness.timers.values())[0].delay, 0);
    harness.flushImagePromptBatchQueue();
    const result = await resultPromise;
    assert.equal(result.prompt, 'generated single prompt');
});

test('local-server-termination image prompt requests flush immediately instead of waiting for the debounce', async () => {
    const harness = loadImagePromptBatchHarness({
        terminateDuringImageGeneration: true
    });

    const resultPromise = harness.generateImagePromptFromTemplate({
        systemPrompt: 'item system',
        generationPrompt: 'describe immediate item'
    }, { prefixType: 'item' });

    assert.equal(harness.timers.size, 1);
    assert.equal(Array.from(harness.timers.values())[0].delay, 0);
    harness.flushImagePromptBatchQueue();
    const result = await resultPromise;
    assert.equal(result.prompt, 'generated single prompt');
});
