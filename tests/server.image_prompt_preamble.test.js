const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadImagePromptPreambleHelpers({
    engine = 'comfyui',
    settingSnapshot = {},
    globalInstructions = {},
    deterministicRender = null,
    resolveLocationHasWeather = () => null,
    resolveEffectiveLocationHasWeather = location => resolveLocationHasWeather(location) || 'yes',
    findRegionByLocationId = () => null
} = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function resolveBaseContextPreambleForImagePrompts() {');
    const end = source.indexOf('\nasync function generateImagePromptFromTemplate(prompts, options = {}) {', start);
    const instructionStart = source.indexOf('function resolveImagePromptGenerationInstructions(kind, settingSnapshot = getActiveSettingSnapshot()) {');
    const instructionEnd = source.indexOf('\nfunction buildNegativePrompt(', instructionStart);
    if (start < 0 || end < 0 || instructionStart < 0 || instructionEnd < 0) {
        throw new Error('Unable to locate image prompt preamble helpers in server.js');
    }

    const functionSource = `${source.slice(instructionStart, instructionEnd)}\n${source.slice(start, end)}`;
    const context = {
        String,
        config: {
            imagegen: {
                engine,
                image_prompt_instructions: globalInstructions
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
            if (lowered === 'sheltered' || lowered === 'outside') {
                return 'sheltered';
            }
            throw new Error(`${fieldName} must be "yes", "no", "sheltered", true, false, or null (legacy "outside" is also accepted).`);
        },
        deterministicTemplateEnv: {
            render: (templateName, variables) => deterministicRender
                ? deterministicRender(templateName, variables)
                : variables?.image?.prompt || ''
        },
        findRegionByLocationId,
        resolveLocationHasWeather,
        resolveEffectiveLocationHasWeather
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.resolveBaseContextPreambleForImagePrompts = resolveBaseContextPreambleForImagePrompts;
this.resolveImagePromptGenerationInstructions = resolveImagePromptGenerationInstructions;
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
        resolveImagePromptGenerationInstructions: context.resolveImagePromptGenerationInstructions,
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

test('per-world image prompt instructions override only their matching global fallback', () => {
    const { resolveImagePromptGenerationInstructions } = loadImagePromptPreambleHelpers({
        settingSnapshot: {
            imagePromptInstructionsCharacter: 'Use graphic-novel portrait composition.',
            imagePromptInstructionsItem: '   '
        },
        globalInstructions: {
            character: 'Global character guidance.',
            item: 'Global item guidance.'
        }
    });

    assert.equal(
        resolveImagePromptGenerationInstructions('character'),
        'Use graphic-novel portrait composition.'
    );
    assert.equal(resolveImagePromptGenerationInstructions('item'), 'Global item guidance.');
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
