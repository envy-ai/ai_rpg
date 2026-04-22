const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadImagePromptPreambleHelpers({
    engine = 'comfyui',
    settingSnapshot = {},
    deterministicRender = null,
    resolveLocationHasWeather = () => null
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
        getActiveSettingSnapshot: () => settingSnapshot,
        normalizeLocationWeatherExposure: (value, fieldName = 'location hasWeather') => {
            if (value === null || value === undefined || value === '') {
                return null;
            }
            if (typeof value === 'boolean') {
                return value ? 'yes' : 'no';
            }
            const lowered = String(value).trim().toLowerCase();
            if (['true', '1', 'yes'].includes(lowered)) {
                return 'yes';
            }
            if (['false', '0', 'no'].includes(lowered)) {
                return 'no';
            }
            if (lowered === 'outside') {
                return 'outside';
            }
            throw new Error(`${fieldName} must be "yes", "no", "outside", true, false, or null.`);
        },
        deterministicTemplateEnv: {
            render: (templateName, variables) => deterministicRender
                ? deterministicRender(templateName, variables)
                : variables?.image?.prompt || ''
        },
        resolveLocationHasWeather
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.resolveBaseContextPreambleForImagePrompts = resolveBaseContextPreambleForImagePrompts;
this.shouldPrependBaseContextPreambleForImagePrompts = shouldPrependBaseContextPreambleForImagePrompts;
this.prependBaseContextPreamble = prependBaseContextPreamble;
this.applyImagePromptPrefix = applyImagePromptPrefix;
this.renderLocationFinalImagePrompt = typeof renderLocationFinalImagePrompt === 'function'
    ? renderLocationFinalImagePrompt
    : undefined;`,
        context
    );

    return {
        resolveBaseContextPreambleForImagePrompts: context.resolveBaseContextPreambleForImagePrompts,
        shouldPrependBaseContextPreambleForImagePrompts: context.shouldPrependBaseContextPreambleForImagePrompts,
        prependBaseContextPreamble: context.prependBaseContextPreamble,
        applyImagePromptPrefix: context.applyImagePromptPrefix,
        renderLocationFinalImagePrompt: context.renderLocationFinalImagePrompt
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

test('renderLocationFinalImagePrompt renders the deterministic template with the whole location object', () => {
    let captured = null;
    const { renderLocationFinalImagePrompt } = loadImagePromptPreambleHelpers({
        deterministicRender: (templateName, variables) => {
            captured = { templateName, variables };
            return `${variables.image.prompt}\n\nlocation:${variables.location.name}\nweather:${variables.hasLocalWeather}`;
        },
        resolveLocationHasWeather: location => location?.generationHints?.hasWeather
    });
    const location = {
        id: 'location-1',
        name: 'Winding Creek Path',
        generationHints: { hasWeather: true }
    };

    assert.equal(typeof renderLocationFinalImagePrompt, 'function');
    assert.equal(
        renderLocationFinalImagePrompt(location, '  wide establishing shot  '),
        'wide establishing shot\n\nlocation:Winding Creek Path\nweather:true'
    );
    assert.equal(captured.templateName, 'location-image-prompt.njk');
    assert.equal(captured.variables.location, location);
    assert.equal(captured.variables.image.prompt, 'wide establishing shot');
    assert.equal(captured.variables.locationId, undefined);
    assert.equal(captured.variables.locationDescription, undefined);
});
