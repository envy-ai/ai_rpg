'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SettingInfo = require('../SettingInfo.js');
const { createPromptEnv } = require('./helpers/baseContextFixtures.js');

const root = path.join(__dirname, '..');

test('location item generation notes survive world-profile persistence and default empty', () => {
    const dir = fs.mkdtempSync(path.join(root, 'tmp', 'location-item-notes-'));
    const raw = '  No glass & fragile relics\r\nKeep <containers> rare  ';
    const expected = raw.replace(/\r\n/g, '\n');
    try {
        assert.equal(SettingInfo.fromJSON({ name: 'Old item profile' }).locationItemGenerationNotes, '');
        const setting = new SettingInfo({ name: 'Item profile', locationItemGenerationNotes: raw });
        assert.equal(setting.locationItemGenerationNotes, expected);
        assert.equal(setting.getPromptVariables().locationItemGenerationNotes, expected);
        assert.equal(SettingInfo.fromJSON(setting.toJSON()).locationItemGenerationNotes, expected);
        assert.equal(setting.clone('Item profile clone').locationItemGenerationNotes, expected);
        assert.equal(SettingInfo.load(setting.save(dir)).locationItemGenerationNotes, expected);
        setting.update({ locationItemGenerationNotes: 'New\r\nnotes' });
        assert.equal(setting.getPromptVariables().locationItemGenerationNotes, 'New\nnotes');
        setting.update({ locationItemGenerationNotes: '' });
        assert.equal(SettingInfo.load(setting.save(dir)).locationItemGenerationNotes, '');
    } finally { SettingInfo.clear(); }
});

test('location item guidance reaches setting context and survives autofill normalization', () => {
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const normalizerStart = source.indexOf('function normalizeSettingValue(');
    const normalizerEnd = source.indexOf('function normalizeSettingList(', normalizerStart);
    const contextStart = source.indexOf('function buildSettingPromptContext(');
    const contextEnd = source.indexOf('function buildSettingContextForNamePrompt(', contextStart);
    assert.ok(normalizerStart >= 0 && normalizerEnd > normalizerStart && contextStart >= 0 && contextEnd > contextStart);
    const sandbox = { describeSettingForPrompt: () => '', normalizeSettingList: () => [], buildUnifiedTonalScalePromptForSetting: () => '', Globals: { baseDir: root }, __dirname: root };
    vm.runInNewContext(`${source.slice(normalizerStart, normalizerEnd)}\n${source.slice(contextStart, contextEnd)}\nthis.build = buildSettingPromptContext;`, sandbox);
    const setting = new SettingInfo({ name: 'Item context profile', locationItemGenerationNotes: '  Rare jars\nNo glass  ' });
    assert.equal(sandbox.build(setting.getPromptVariables()).locationItemGenerationNotes, '  Rare jars\nNo glass  ');
    assert.equal(sandbox.build({}).locationItemGenerationNotes, '');
    const api = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
    const start = api.indexOf('        function normalizeSettingPayload('), end = api.indexOf('        function isEmptySettingValue(', start);
    assert.ok(start >= 0 && end > start);
    const apiSandbox = { normalizeUnifiedTonalScaleSelections: value => value || {}, Utils: { parseXmlDocument: xml => new (require('@xmldom/xmldom').DOMParser)().parseFromString(xml, 'text/xml') } };
    vm.runInNewContext(`${api.slice(start, end)}\nthis.normalize = normalizeSettingPayload; this.parse = parseSettingXmlResponse;`, apiSandbox);
    assert.equal(apiSandbox.normalize({ locationItemGenerationNotes: '  Rare\r\njars  ' }).locationItemGenerationNotes, '  Rare\njars  ');
    assert.equal(apiSandbox.parse('<setting><locationItemGenerationNotes>Rare &amp; old</locationItemGenerationNotes></setting>').locationItemGenerationNotes, 'Rare & old');
    SettingInfo.clear();
});

test('location roster and expansion prompts append nonblank notes safely, and omit blank guidance', () => {
    const env = createPromptEnv();
    const base = { location: { name: 'Workshop', description: 'A workshop.' }, region: { regionName: 'Town', regionDescription: 'A town.' }, settingDescription: 'A world.', attributeDefinitions: {}, rarityDefinitions: [], equipmentSlots: [], rarityList: { items: {}, scenery: {} }, itemCount: 1, sceneryCount: 1, recentThings: [], lorebookEntries: [], thingGeneratorPromptFields: [], modGenerationPromptInstructions: [], allowHiddenDiscovery: true };
    for (const [planning, expansion] of [[true, false], [false, true]]) {
        const render = notes => env.render('_includes/location-generator-things.njk', { ...base, locationThingsPlanningOnly: planning, locationThingsExpansion: expansion, setting: notes === undefined ? {} : { locationItemGenerationNotes: notes } });
        for (const blank of [undefined, '', '  \n  ']) assert.doesNotMatch(render(blank), /Additional instructions:/);
        const output = render('  Use <glass> & ceramic.\nKeep it rare.  ');
        assert.match(output, /Additional instructions:\s*\n\s*Use &lt;glass&gt; &amp; ceramic\.\nKeep it rare\./);
        assert.match(output.trimEnd(), /Keep it rare\.\s*$/);
    }
});

test('setting autofill prompt carries and XML-escapes location item notes', () => {
    const env = require('nunjucks').configure(path.join(root, 'prompts'), { autoescape: false });
    require('../nunjucks_filters.js').addXmlTextFilter(env);
    const render = notes => env.render('fill-setting-form.xml.njk', { setting: { locationItemGenerationNotes: notes }, additionalInstructions: '', hasImage: false });
    assert.match(render(''), /<locationItemGenerationNotes>[\s\S]*?<\/locationItemGenerationNotes>/);
    assert.match(render('Rare <glass> & clay'), /<locationItemGenerationNotes>Rare &lt;glass&gt; &amp; clay<\/locationItemGenerationNotes>/);
});

test('TinyBrain roster and approved expansion each receive nonblank notes, while blank notes are omitted', async () => {
    const { buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');
    const { TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');
    const { configureTinyBrainPromptContext, runTinyBrainPromptProgram } = require('../TinyBrainPromptFamilies.js');
    const { DOMParser } = require('@xmldom/xmldom');
    for (const notes of ['  Keep <glass> rare & old.  ', '  \n  ']) {
        const env = createPromptEnv();
        env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
        const context = { ...buildBaseRenderContext(), promptType: 'location-generator-things', settingDescription: 'A world.', region: { regionName: 'Town', regionDescription: 'A town.' }, location: { name: 'Room', description: 'A room.' }, attributeDefinitions: {}, attributes: [], equipmentSlots: [], rarityDefinitions: [], rarityList: { items: {}, scenery: {} }, itemCount: 1, sceneryCount: 0, recentThings: [], lorebookEntries: [], thingGeneratorPromptFields: [], modGenerationPromptInstructions: [], allowHiddenDiscovery: true };
        context.setting.locationItemGenerationNotes = notes;
        const tinyBrain = configureTinyBrainPromptContext(context, 'location_things_generation');
        const stages = [];
        await runTinyBrainPromptProgram({ initialRenderedTemplate: env.render('base-context.xml.njk', context), templateContext: context, tinyBrain,
            runnerOptions: { promptEnv: env, metadataLabel: 'location_things_generation', retryAttempts: 0, toolDefinitions: [],
                logPrompt: () => path.join(root, 'tmp', 'location-item-notes-prompt.log'),
                parseXMLTemplate: rendered => { const doc = new DOMParser().parseFromString(rendered, 'text/xml'); return { systemPrompt: doc.getElementsByTagName('systemPrompt')[0]?.textContent || '', generationPrompt: doc.getElementsByTagName('generationPrompt')[0]?.textContent || '' }; },
                parsers: { location_things_plan: () => ({ value: [{ name: 'Jar', itemOrScenery: 'item', rarity: 'common', description: 'An old jar.' }] }) },
                finalParser: () => ({ value: [] }),
                complete: async stage => { stages.push(stage.messages.map(message => message.content || '').join('\n')); const aiResponse = stage.isFinal ? '<things/>' : '<thingsPlan/>'; return { aiResponse, conversationMessages: [...stage.messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] }; }
            }
        });
        assert.equal(stages.length, 2);
        assert.match(stages[1], /approvedThingsPlan>[\s\S]*Jar/);
        if (notes.trim()) {
            for (const stage of stages) assert.match(stage, /Additional instructions:\s*\n\s*Keep &lt;glass&gt; rare &amp; old\./);
            assert.equal((stages[1].match(/Additional instructions:/g) || []).length, 2, 'roster and expansion each contribute their guidance');
        } else for (const stage of stages) assert.doesNotMatch(stage, /Additional instructions:/);
    }
});
