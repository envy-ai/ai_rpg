const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const start = source.indexOf('async function renderLocationGeneratorPrompt(');
const end = source.indexOf('\nfunction assignEntityImagePrompt(', start);
assert.ok(start >= 0 && end > start);

test('location and region generators preserve canonical setting for string task descriptions', async () => {
    let payload;
    const context = {
        prepareBasePromptContext: async () => ({ currentPlayer: {}, currentRegion: {} }),
        getActiveSettingSnapshot: () => ({}), describeSettingForPrompt: () => 'canonical description',
        buildSettingPromptContext: () => ({ name: 'World', description: 'canonical description', theme: 'test', races: [] }),
        normalizeSettingValue: value => value, normalizeSettingList: value => value,
        attributeDefinitionsForPrompt: {}, Player: { getAvailableSkills: () => new Map() },
        chatHistory: [], currentPlayer: null, config: { regions: {} },
        getLorebookManager: () => null, getModGenerationPromptInstructions: () => [],
        promptEnv: { render: (_name, value) => { payload = value; return 'template'; } },
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generation' }),
        console, Map, Object, Array, Number, String, Boolean
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.location = renderLocationGeneratorPrompt; this.region = renderRegionGeneratorPrompt;`, context);
    for (const render of [context.location, context.region]) {
        assert.ok(await render({ setting: 'specific task summary' }));
        assert.equal(payload.setting.description, 'canonical description');
        assert.equal(payload.taskSettingDescription, 'specific task summary');
        assert.ok(await render({ setting: { description: 'explicit object override' } }));
        assert.equal(payload.setting.description, 'explicit object override');
    }
});
