const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const nunjucks = require('nunjucks');

const ModExtensionRegistry = require('../ModExtensionRegistry.js');
const ModLoader = require('../ModLoader.js');
const { TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');
const { configureTinyBrainPromptContext } = require('../TinyBrainPromptFamilies.js');

function createPromptEnv() {
    const env = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false, throwOnUndefined: true }
    );
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return env;
}

test('scene-summary contributors collect enabled-mod text and fail loudly for invalid output', () => {
    const registry = new ModExtensionRegistry();
    registry.registerSceneSummarizeContributor({
        modName: 'nsfw-boost',
        contributor: ({ fullHistoryLines }) => fullHistoryLines.length
            ? 'Retain intimate details that affect future relationships.'
            : ''
    });
    registry.registerSceneSummarizeContributor({
        modName: 'empty',
        contributor: () => null
    });

    assert.deepEqual(registry.collectSceneSummarizeContributions({
        fullHistoryLines: [{ name: 'Baato', text: 'A scene entry.' }]
    }), [{
        modName: 'nsfw-boost',
        text: 'Retain intimate details that affect future relationships.'
    }]);

    registry.registerSceneSummarizeContributor({
        modName: 'invalid',
        contributor: () => ({ text: 'not a string' })
    });
    assert.throws(
        () => registry.collectSceneSummarizeContributions({ fullHistoryLines: [] }),
        /Scene summarize contributor from mod "invalid" must return a string or null/
    );
});

test('ModLoader scopes scene-summary contributors to the registering mod', () => {
    const registry = new ModExtensionRegistry();
    const loader = new ModLoader(path.join(__dirname, '..'), { config: {} });
    const scope = loader.createModScope('summary-mod', path.join(__dirname, '..', 'mods', 'summary-mod'), {
        modExtensionRegistry: registry
    });

    scope.registerSceneSummarizeContributor(() => 'Keep the mod-specific consequence.');

    assert.deepEqual(registry.collectSceneSummarizeContributions({ fullHistoryLines: [] }), [{
        modName: 'summary-mod',
        text: 'Keep the mod-specific consequence.'
    }]);
});

test('scene-summary templates render enabled-mod guidance in standard and TinyBrain prompts', () => {
    const promptEnv = createPromptEnv();
    const templateContext = {
        fullHistoryLines: [
            { name: 'Baato', text: 'A meaningful scene event.' },
            { name: 'Storyteller', text: 'The scene resolves.' }
        ],
        modSceneSummarizeContributions: [{
            modName: 'summary-mod',
            text: 'Keep the mod-specific consequence.'
        }]
    };

    const standard = promptEnv.render('scene-summarize.xml.njk', templateContext);
    assert.match(standard, /Keep the mod-specific consequence\./);

    const tinyBrainContext = { ...templateContext };
    configureTinyBrainPromptContext(tinyBrainContext, 'scene_summarize');
    const tinyBrain = promptEnv.render('scene-summarize.xml.njk', tinyBrainContext);
    assert.match(tinyBrain, /TINYBRAIN_PROGRAM_START/);
});
