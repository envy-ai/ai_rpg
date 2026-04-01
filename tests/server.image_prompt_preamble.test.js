const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadImagePromptPreambleHelpers({
    engine = 'comfyui',
    settingSnapshot = {}
} = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function resolveBaseContextPreambleForImagePrompts() {');
    const end = source.indexOf('\nasync function generateImagePromptFromTemplate(prompts, options = {}) {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate image prompt preamble helpers in server.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        String,
        config: {
            imagegen: {
                engine
            }
        },
        getActiveSettingSnapshot: () => settingSnapshot
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.resolveBaseContextPreambleForImagePrompts = resolveBaseContextPreambleForImagePrompts;
this.shouldPrependBaseContextPreambleForImagePrompts = shouldPrependBaseContextPreambleForImagePrompts;
this.prependBaseContextPreamble = prependBaseContextPreamble;
this.applyImagePromptPrefix = applyImagePromptPrefix;`,
        context
    );

    return {
        resolveBaseContextPreambleForImagePrompts: context.resolveBaseContextPreambleForImagePrompts,
        shouldPrependBaseContextPreambleForImagePrompts: context.shouldPrependBaseContextPreambleForImagePrompts,
        prependBaseContextPreamble: context.prependBaseContextPreamble,
        applyImagePromptPrefix: context.applyImagePromptPrefix
    };
}

test('prependBaseContextPreamble skips the setting preamble for ComfyUI', () => {
    const { prependBaseContextPreamble, shouldPrependBaseContextPreambleForImagePrompts } = loadImagePromptPreambleHelpers({
        engine: 'comfyui',
        settingSnapshot: {
            baseContextPreamble: '[Genre: Space Opera]'
        }
    });

    assert.equal(shouldPrependBaseContextPreambleForImagePrompts(), false);
    assert.equal(
        prependBaseContextPreamble('  cinematic starship bridge  '),
        'cinematic starship bridge'
    );
});

test('prependBaseContextPreamble still applies the setting preamble for OpenAI image generation', () => {
    const { prependBaseContextPreamble, shouldPrependBaseContextPreambleForImagePrompts } = loadImagePromptPreambleHelpers({
        engine: 'openai',
        settingSnapshot: {
            baseContextPreamble: '[Genre: Space Opera]'
        }
    });

    assert.equal(shouldPrependBaseContextPreambleForImagePrompts(), true);
    assert.equal(
        prependBaseContextPreamble('cinematic starship bridge'),
        '[Genre: Space Opera]\n\ncinematic starship bridge'
    );
});

test('applyImagePromptPrefix keeps prefixes for ComfyUI while omitting the setting preamble', () => {
    const { applyImagePromptPrefix } = loadImagePromptPreambleHelpers({
        engine: 'comfyui',
        settingSnapshot: {
            baseContextPreamble: '[Genre: Space Opera]',
            imagePromptPrefixLocation: 'ultra-detailed concept art'
        }
    });

    assert.equal(
        applyImagePromptPrefix('ancient orbital dock', 'location'),
        'ultra-detailed concept art\n\nancient orbital dock'
    );
});

test('missing engine still defaults to ComfyUI behavior', () => {
    const { prependBaseContextPreamble } = loadImagePromptPreambleHelpers({
        engine: '',
        settingSnapshot: {
            baseContextPreamble: '[Genre: Space Opera]'
        }
    });

    assert.equal(prependBaseContextPreamble('ancient orbital dock'), 'ancient orbital dock');
});
