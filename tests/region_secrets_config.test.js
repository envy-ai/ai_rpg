const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const nunjucks = require('nunjucks');
const yaml = require('js-yaml');
const Region = require('../Region');
const Utils = require('../Utils');
const Globals = require('../Globals');
const { createChatToolRuntime } = require('../chat_tool_calls');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const serverSource = read('server.js');
const apiSource = read('api.js');
const secret = 'REGION_SECRET_SENTINEL';
const xml = `<region><name>Quiet Valley</name><description>A green valley.</description><shortDescription>Quiet green valley</shortDescription><secrets><secret>${secret}</secret></secrets></region>`;
const previousConfig = Globals.config;
test.before(() => { Globals.config = { strictXMLParsing: true }; });
test.after(() => { Globals.config = previousConfig; });

test('region secrets default to disabled', () => {
    assert.equal(yaml.load(read('config.default.yaml')).regions.secrets_enabled, false);
});

test('region XML may omit secrets and ignores unsolicited secrets when disabled, while saves retain them', () => {
    for (const includeSecrets of [false, true]) {
        const region = Region.fromXMLSnippet(xml, { includeSecrets });
        try {
            assert.deepEqual(region.secrets, includeSecrets ? [secret] : []);
            region.secrets = [secret];
            assert.deepEqual(region.toJSON().secrets, [secret]);
        } finally { Region.removeFromIndex(region); }
    }
    const region = Region.fromXMLSnippet(xml.replace(/<secrets>[\s\S]*?<\/secrets>/, ''), { includeSecrets: false });
    try { assert.deepEqual(region.secrets, []); }
    finally { Region.removeFromIndex(region); }
});

test('pending-region secret extraction respects the switch', () => {
    const start = serverSource.indexOf('function extractRegionSecrets(stubResponse) {');
    const end = serverSource.indexOf('\nasync function expandRegionEntryStub', start);
    for (const enabled of [false, true]) {
        const context = { config: { regions: { secrets_enabled: enabled } }, Utils };
        vm.createContext(context);
        vm.runInContext(serverSource.slice(start, end), context);
        assert.deepEqual(Array.from(context.extractRegionSecrets(xml)), enabled ? [secret] : []);
        assert.deepEqual(Array.from(context.extractRegionSecrets('<region/>')), []);
    }
});

test('unsolicited secret XML is removed before reusing a region response as NPC/entrance context', () => {
    const start = serverSource.indexOf('function omitDisabledRegionSecretsFromXml(response) {');
    const end = serverSource.indexOf('\nfunction extractRegionSecrets', start);
    for (const enabled of [false, true]) {
        const context = { config: { regions: { secrets_enabled: enabled } } };
        vm.createContext(context);
        vm.runInContext(serverSource.slice(start, end), context);
        const result = context.omitDisabledRegionSecretsFromXml(xml);
        assert.equal(result.includes(secret), enabled);
        assert.ok(result.includes('<description>A green valley.</description>'));
        assert.equal(context.omitDisabledRegionSecretsFromXml('<region><secrets /></region>'),
            enabled ? '<region><secrets /></region>' : '<region></region>');
    }
});

test('disabled standalone generation makes no context, model, or logging calls', async () => {
    const start = apiSource.indexOf('        async function ensureRegionSecretsForCurrentRegion() {');
    const end = apiSource.indexOf('        function triggerRegionSecretsForCurrentRegion()', start);
    for (const config of [{}, { regions: { secrets_enabled: false } }]) {
        const context = { Globals: { config, region: { secrets: [] } } };
        vm.createContext(context);
        vm.runInContext(apiSource.slice(start, end), context);
        assert.equal(await context.ensureRegionSecretsForCurrentRegion(), null);
    }
});

test('generation and shared context templates omit disabled secrets', () => {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(root, 'prompts')), { autoescape: false });
    env.addFilter('ceil', Math.ceil);
    env.addFilter('eval', () => 0);
    env.addFilter('dice', () => 1);
    const region = { name: 'Valley', description: 'A valley.', secrets: [secret], locations: [], connectedRegions: [] };
    for (const enabled of [false, true]) {
        const context = {
            config: { regions: { secrets_enabled: enabled } }, setting: { attributes: [], skills: [] },
            currentRegion: region, regionContext: region, region,
            currentPlayer: { name: 'Tester', currentQuests: [] }, worldTime: {},
            secrets: [secret], allLocationsInRegion: [], attributeDefinitions: {},
            promptType: 'region_generate_secrets', itemType: 'location',
            locationGroups: [{ regionName: 'Valley', regionContext: region, locations: [] }]
        };
        const generation = env.render('_includes/region-generator.njk', context);
        assert.equal(generation.includes('<secrets>'), enabled);
        const standalone = env.render('_includes/region_generate_secrets.njk', context);
        assert.equal(standalone.includes('<secrets>'), enabled);
        const npcs = env.render('region-generator-important-npcs.njk', context);
        assert.equal(npcs.includes(secret), enabled);
        const short = env.render('short-description.xml.njk', context);
        assert.equal(short.includes(secret), enabled);
        const base = env.render('base-context.xml.njk', context);
        assert.equal(base.includes(secret), enabled);
    }
});

test('moreInfo hides stored secrets in compact and full results when disabled without changing the record', async () => {
    const source = { id: 'region-test', name: 'Quiet Valley', secrets: [secret] };
    const region = { ...source, toJSON: () => structuredClone(source) };
    let enabled = false;
    const runtime = createChatToolRuntime({
        getChatHistory: () => [], isAssistantProseLikeEntry: () => true,
        getConfig: () => ({ regions: { secrets_enabled: enabled } }),
        getGameLocations: () => new Map(), getRegionsMap: () => new Map([[region.id, region]]),
        getPendingRegionStubs: () => new Map(), getFactions: () => [],
        Player: { getAll: () => [] }, Thing: { getAll: () => [] }, Region: { getAll: () => [region] }, Location: require('../Location'),
        getCurrentPlayer: () => null,
        serializeNpcForClient: value => value, buildLocationResponse: value => value,
        createLocationFromEvent: async () => {}, createRegionStubFromEvent: async () => {},
        generateItemsByNames: async () => [], ensureExitConnection: () => {}, findRegionByLocationId: () => null,
        LLMClient: { chatCompletion: async () => '', logPrompt: () => {} }
    });
    for (enabled of [false, true]) {
        for (const includeFullState of [false, true]) {
            const result = await runtime.executeChatToolCall({ functionName: 'moreInfo', argumentsObject: { name: 'Quiet Valley', type: 'region', includeFullState } });
            const data = JSON.parse(result.content).regions[0];
            assert.ok(data);
            assert.deepEqual(data.secrets, enabled ? [secret] : undefined);
            assert.deepEqual(source.secrets, [secret]);
        }
    }
});
