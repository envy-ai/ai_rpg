const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const Globals = require('../Globals.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function extractFunctionBlock(source, signature, nextSignature) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `Unable to locate ${signature}`);
    const end = source.indexOf(nextSignature, start);
    assert.notEqual(end, -1, `Unable to locate ${nextSignature}`);
    return source.slice(start, end);
}

function withRegisteredField(run) {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({
        modName: 'nsfw-boost',
        entityType: 'player',
        fieldName: 'sexualTraits',
        type: 'string',
        exposeToGeneratorPrompt: true,
        exposeToXmlParser: true,
        xmlPrompt: { tagName: 'sexualTraits', placeholder: 'traits here' }
    });
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = registry;
    try {
        run(registry);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
}

function getGeneratorPromptFields(registry) {
    return registry.getEntityFields('player', { exposeToGeneratorPrompt: true })
        .filter(field => field && field.xmlPrompt && typeof field.xmlPrompt.tagName === 'string');
}

test('batch NPC prompt renderers pass playerGeneratorPromptFields to their templates', () => {
    const serverSource = read('server.js');

    const locationRenderer = extractFunctionBlock(
        serverSource,
        'function renderLocationNpcPrompt(',
        'function renderRegionNpcPrompt('
    );
    assert.match(locationRenderer, /playerGeneratorPromptFields:\s*getPlayerGeneratorPromptFields\(\)/);

    const regionRenderer = extractFunctionBlock(
        serverSource,
        'function renderRegionNpcPrompt(',
        'const SHORT_DESCRIPTION_MAX_ATTEMPTS'
    );
    assert.match(regionRenderer, /playerGeneratorPromptFields:\s*getPlayerGeneratorPromptFields\(\)/);
});

test('batch NPC generation templates include the player generator fields scaffold', () => {
    const locationTemplate = read('prompts/location-generator-npcs.xml.njk');
    const regionTemplate = read('prompts/region-generator-important-npcs.njk');

    assert.match(locationTemplate, /include "_includes\/player-generator-fields\.njk"/);
    assert.match(regionTemplate, /include "_includes\/player-generator-fields\.njk"/);
});

test('registered Player fields render into batch NPC generation scaffolds', () => {
    withRegisteredField((registry) => {
        const promptEnv = nunjucks.configure(path.join(rootDir, 'prompts'), {
            autoescape: false,
            dev: true
        });
        const fields = getGeneratorPromptFields(registry);
        assert.equal(fields.length, 1);

        const locationOutput = promptEnv.render('location-generator-npcs.xml.njk', {
            playerGeneratorPromptFields: fields
        });
        assert.match(locationOutput, /<sexualTraits><!--traits here--><\/sexualTraits>/);

        const regionOutput = promptEnv.render('region-generator-important-npcs.njk', {
            playerGeneratorPromptFields: fields,
            region: {}
        });
        assert.match(regionOutput, /<sexualTraits><!--traits here--><\/sexualTraits>/);

        // Without the variable the scaffold renders nothing (the original bug).
        const withoutFields = promptEnv.render('location-generator-npcs.xml.njk', {});
        assert.doesNotMatch(withoutFields, /<sexualTraits>/);
    });
});
