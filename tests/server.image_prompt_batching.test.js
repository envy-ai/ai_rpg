const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const Utils = require('../Utils.js');

function loadImagePromptBatchHarness({
    promptBatching = { enabled: true, delay_ms: 2000, max_items: 10 },
    settingSnapshot = {},
    promptGenerationAttempts = undefined,
    chatCompletion = null
} = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function resolveBaseContextPreambleForImagePrompts() {');
    const end = source.indexOf('\n// Function to generate location scene image', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate image prompt batching helpers in server.js');
    }

    const functionSource = source.slice(start, end);
    const calls = [];
    const logs = [];
    let nextTimerId = 1;
    const timers = new Map();
    const context = {
        console,
        Date,
        String,
        Number,
        Array,
        Map,
        Promise,
        RegExp,
        config: {
            imagegen: {
                engine: 'comfyui',
                prompt_batching: promptBatching,
                ...(promptGenerationAttempts === undefined ? {} : { prompt_generation_attempts: promptGenerationAttempts })
            }
        },
        getActiveSettingSnapshot: () => settingSnapshot,
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
            chatCompletion: async ({ messages }) => {
                calls.push(messages);
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
    assert.match(harness.calls[0][1].content, /<imagePromptBatchRequest>/);
    assert.match(harness.calls[0][1].content, /describe item one/);
    assert.match(harness.calls[0][1].content, /describe item two/);
    assert.equal(results[0].prompt, 'item prefix\n\ngenerated batch prompt 1');
    assert.equal(results[1].prompt, 'item prefix\n\ngenerated batch prompt 2');
    assert.equal(harness.logs.some(entry => entry.prefix === 'image_prompt_generation_batch'), true);
});

test('image prompt batching separates incompatible system prompts', async () => {
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

    assert.equal(harness.calls.length, 2);
    assert.equal(results[0].prompt, 'generated single prompt');
    assert.equal(results[1].prompt, 'generated single prompt');
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
