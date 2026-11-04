const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SettingInfo = require('../SettingInfo.js');

test('NPC naming guidance persists across all world profile representations', () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'naming-guidance-'));
    const original = '  Names <of> moon & stars -- yes\r\nSecond line  ';
    const normalized = original.replace(/\r\n/g, '\n');
    try {
        const old = SettingInfo.fromJSON({ name: 'Old profile' });
        assert.equal(old.npcNamingGuidance, '');
        const world = new SettingInfo({ name: 'Naming profile', npcNamingGuidance: original });
        assert.equal(world.npcNamingGuidance, normalized);
        assert.equal(world.getPromptVariables().npcNamingGuidance, normalized);
        assert.equal(world.toJSON().npcNamingGuidance, normalized);
        assert.equal(SettingInfo.fromJSON(world.toJSON()).npcNamingGuidance, normalized);
        assert.equal(world.clone('Naming clone').npcNamingGuidance, normalized);
        assert.equal(SettingInfo.load(world.save(dir)).npcNamingGuidance, normalized);
        world.update({ npcNamingGuidance: 'Updated\r\nvalue' });
        assert.equal(world.npcNamingGuidance, 'Updated\nvalue');
        world.update({ npcNamingGuidance: '' });
        assert.equal(world.getPromptVariables().npcNamingGuidance, '');
        assert.equal(SettingInfo.load(world.save(dir)).npcNamingGuidance, '');
    } finally {
        SettingInfo.clear();
    }
});

test('settings autofill normalization and XML parsing carry naming guidance', () => {
    const vm = require('node:vm');
    const source = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    const start = source.indexOf('        function normalizeSettingPayload(');
    const end = source.indexOf('        function isEmptySettingValue(', start);
    assert.ok(start >= 0 && end > start);
    const sandbox = {
        normalizeUnifiedTonalScaleSelections: value => value || {},
        Utils: { parseXmlDocument: xml => new (require('@xmldom/xmldom').DOMParser)().parseFromString(xml, 'text/xml') }
    };
    vm.runInNewContext(`${source.slice(start, end)}\nthis.normalize = normalizeSettingPayload; this.parse = parseSettingXmlResponse;`, sandbox);
    const raw = '  Moon names\r\nNames with & symbols  ';
    assert.equal(sandbox.normalize({ npcNamingGuidance: raw }).npcNamingGuidance, raw.replace(/\r\n/g, '\n'));
    const parsed = sandbox.parse('<setting><npcNamingGuidance>Moon &amp; star names</npcNamingGuidance></setting>');
    assert.equal(parsed.npcNamingGuidance, 'Moon & star names');
});

test('autofill prompt carries the naming field and its instructions', () => {
    const nunjucks = require('nunjucks');
    const env = nunjucks.configure(path.join(__dirname, '..', 'prompts'), { autoescape: false });
    const { addXmlTextFilter } = require('../nunjucks_filters.js');
    addXmlTextFilter(env);
    const render = npcNamingGuidance => env.render('fill-setting-form.xml.njk', { setting: { npcNamingGuidance }, additionalInstructions: '', hasImage: false });
    assert.match(render(''), /<npcNamingGuidance>[\s\S]*?<\/npcNamingGuidance>/);
    assert.match(render('Moon & stars'), /<npcNamingGuidance>Moon &amp; stars<\/npcNamingGuidance>/);
    assert.match(render(''), /available setting fields[\s\S]*npcNamingGuidance/);
});

test('world setting snapshot reaches the NPC generation prompt context', () => {
    const vm = require('node:vm');
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const normalizerStart = source.indexOf('function normalizeSettingValue(');
    const normalizerEnd = source.indexOf('function normalizeSettingList(', normalizerStart);
    const contextStart = source.indexOf('function buildSettingPromptContext(');
    const contextEnd = source.indexOf('function buildSettingContextForNamePrompt(', contextStart);
    assert.ok(normalizerStart >= 0 && normalizerEnd > normalizerStart && contextStart >= 0 && contextEnd > contextStart);
    const sandbox = { describeSettingForPrompt: () => '', normalizeSettingList: () => [],
        buildUnifiedTonalScalePromptForSetting: () => '', Globals: { baseDir: process.cwd() }, __dirname: process.cwd() };
    vm.runInNewContext(`${source.slice(normalizerStart, normalizerEnd)}\n${source.slice(contextStart, contextEnd)}\nthis.build = buildSettingPromptContext;`, sandbox);
    const world = new SettingInfo({ name: 'Prompt context world', npcNamingGuidance: '  Lunar names\nwith honorifics  ' });
    assert.equal(sandbox.build(world.getPromptVariables()).npcNamingGuidance, '  Lunar names\nwith honorifics  ');
    assert.equal(sandbox.build({}).npcNamingGuidance, '');
    for (const [start, end] of [['function renderLocationNpcPrompt(', 'function renderRegionNpcPrompt('], ['function renderRegionNpcPrompt(', 'const SHORT_DESCRIPTION_MAX_ATTEMPTS']]) {
        const block = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
        assert.match(block, /buildSettingPromptContext\(getActiveSettingSnapshot\(\)\)/);
        assert.match(block, /setting:\s*settingContext/);
    }
    SettingInfo.clear();
});
