const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const Globals = require('../Globals.js');
const Region = require('../Region.js');
const Utils = require('../Utils.js');
const { assertNewLocationNameAvailable } = require('../LocationCreationNameGuard.js');
const { resolveConfiguredPromptMaxAttempts, runPromptWithParseRetries } = require('../PromptRetryPolicy.js');

const validRegionXml = `
<region>
  <regionName>Retry Test Region</regionName><regionDescription>A region used by parser retry tests.</regionDescription>
  <shortDescription>A test region.</shortDescription><controllingFaction>None</controllingFaction>
  <locations><location>
    <name>Retry Meadow</name><description>A quiet meadow.</description><shortDescription>Quiet meadow</shortDescription>
    <hasWeather>false</hasWeather><exits><exit><destination>Open Path</destination><travelTime>2 minutes</travelTime></exit></exits>
  </location></locations>
</region>`;

function loadGenerateRegionFromPrompt({ responses, retryAttempts = 1, imageDataUrl = null, sourceLevel = null, selectedOffset = 2, generationOptions = {} }) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function generateRegionFromPrompt(options = {}) {');
    const end = source.indexOf('\n// Middleware', start);
    assert.notEqual(start, -1, 'generateRegionFromPrompt source marker exists');
    assert.notEqual(end, -1, 'generateRegionFromPrompt end marker exists');

    const completionMessages = [];
    const logs = [];
    const constructed = [];
    const instantiations = [];
    const regions = new Map();
    const gameLocations = new Map();
    const origin = sourceLevel === null ? null : { id: 'origin', name: 'Origin' };
    const sourceRegion = origin ? { id: 'source', name: 'Source', averageLevel: sourceLevel } : null;
    if (origin) gameLocations.set(origin.id, origin);
    const offsetRequests = [];
    const responseQueue = [...responses];
    class CountedRegion extends Region {
        constructor(data) {
            super(data);
            constructed.push(this);
        }
    }
    CountedRegion.parseXMLSnippet = Region.parseXMLSnippet.bind(Region);
    CountedRegion.removeFromIndex = Region.removeFromIndex.bind(Region);
    CountedRegion.getByName = Region.getByName.bind(Region);

    const context = {
        Array, Boolean, Error, JSON, Map, Number, Object, String,
        Utils,
        Region: CountedRegion,
        Globals,
        runtimeGenerationId: 1,
        currentPlayer: origin ? { location: origin, level: 30 } : null,
        findRegionByLocationId: () => sourceRegion,
        findRegionByNameLoose: () => null,
        findPendingRegionByNameLoose: () => null,
        resolveEventRegionStubLevelData: ({ currentRegion }) => ({ regionAverageLevel: currentRegion.averageLevel }),
        requestRegionLevelOffset: async options => { offsetRequests.push(options); sourceRegion.averageLevel = 99; return selectedOffset; },
        clampLevel: value => Math.max(1, Math.round(value)),
        config: { ai: { retryAttempts }, regions: { secrets_enabled: false } },
        LLMClient: { logPrompt: entry => logs.push(entry) },
        resolveConfiguredPromptMaxAttempts,
        runPromptWithParseRetries,
        renderRegionGeneratorPrompt: async () => ({ systemPrompt: 'system', generationPrompt: 'Build a region.' }),
        describeSettingForPrompt: () => 'test setting',
        getActiveSettingSnapshot: () => null,
        runGenerationPromptCompletion: async ({ requestOptions }) => {
            completionMessages.push(requestOptions.messages);
            assert.equal(requestOptions.metadataLabel, 'region_generation');
            assert.equal(requestOptions.expectedXmlRootTag, 'region');
            return responseQueue.shift();
        },
        omitDisabledRegionSecretsFromXml: value => value,
        extractXmlTagValue: (xml, { tagName }) => {
            const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i'));
            return match?.[1]?.trim() || '';
        },
        resolveFactionNameToId: name => ({ id: null, explicit: name === 'None' }),
        parseRegionExitsResponse: () => [],
        parseRegionVehicleDefinitions: () => [],
        normalizeRegionLocationName: value => String(value || '').trim().toLowerCase(),
        formatGenerationPromptMessageForLog: message => typeof message.content === 'string'
            ? `${message.role}: ${message.content}`
            : `${message.role}: [multimodal content]`,
        ensureRegionNameAllowed: async () => {},
        regions,
        gameLocations,
        pendingRegionStubs: new Map(),
        assertNewLocationNameAvailable,
        instantiateRegionLocations: async args => {
            instantiations.push(args);
            return new Map();
        },
        rollbackFailedRegionInstantiation: () => {},
        chooseRegionEntrance: async () => ({ locationId: null }),
        generateRegionNPCs: async () => {},
        console: { log() {}, warn() {}, error() {} }
    };
    vm.createContext(context);
    const validationStart = source.indexOf('function getRegionInstantiationLocationAliases(');
    const validationEnd = source.indexOf('\nfunction ensureExitConnection(', validationStart);
    assert.ok(validationStart >= 0 && validationEnd > validationStart);
    vm.runInContext(`${source.slice(validationStart, validationEnd)}\n${source.slice(start, end)}\nthis.generateRegionFromPrompt = generateRegionFromPrompt;`, context);

    return {
        generate: () => context.generateRegionFromPrompt({ ...generationOptions, ...(imageDataUrl ? { imageDataUrl } : {}) }),
        completionMessages,
        logs,
        constructed,
        instantiations,
        regions,
        responseQueue,
        offsetRequests
    };
}

test('direct region generation applies one selected offset to captured source region level', async () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };
    try {
        const harness = loadGenerateRegionFromPrompt({ responses: [validRegionXml], sourceLevel: 4, selectedOffset: 3 });
        await harness.generate();
        assert.equal(harness.offsetRequests.length, 1);
        assert.equal(harness.offsetRequests[0].sourceAverageLevel, 4);
        assert.equal(harness.constructed[0].averageLevel, 7);
        assert.equal(harness.instantiations[0].regionAverageLevel, 7);
        const initial = loadGenerateRegionFromPrompt({ responses: [validRegionXml], sourceLevel: 4, generationOptions: { averageLevel: 1 } });
        await initial.generate();
        assert.equal(initial.offsetRequests.length, 0);
        assert.equal(initial.constructed[0].averageLevel, 1);
        const zeroOffset = loadGenerateRegionFromPrompt({ responses: [validRegionXml], sourceLevel: 4, generationOptions: { relativeLevel: 0 } });
        await zeroOffset.generate();
        assert.equal(zeroOffset.offsetRequests.length, 0);
        assert.equal(zeroOffset.constructed[0].averageLevel, 4);
    } finally { Globals.config = previousConfig; Region.clear(); }
});

test('region generation retries parser rejection from the original multimodal prompt and constructs only accepted XML', async () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };
    const imageDataUrl = 'data:image/png;base64,cmVmZXJlbmNl';
    const rejectedXml = '<region><regionName>Rejected Secret XML Marker</regionName></region>';
    const harness = loadGenerateRegionFromPrompt({
        responses: [rejectedXml, validRegionXml],
        imageDataUrl
    });
    try {
        const result = await harness.generate();
        assert.equal(result.region.name, 'Retry Test Region');
        assert.equal(harness.completionMessages.length, 2);
        assert.equal(harness.constructed.length, 1, 'Region is constructed once, after parser acceptance');
        assert.equal(harness.instantiations.length, 1, 'location instantiation happens only after acceptance');
        assert.equal(harness.logs.length, 2, 'both rejected and accepted responses are logged');
        assert.match(harness.logs[0].sections[0].content, /rejected \(1\/2\)/);
        assert.match(harness.logs[1].sections[0].content, /accepted \(2\/2\)/);

        const retryMessages = harness.completionMessages[1];
        assert.deepEqual(Array.from(retryMessages, message => message.role), ['system', 'user', 'assistant', 'user']);
        const retryText = retryMessages.flatMap(message => Array.isArray(message.content)
            ? message.content.filter(part => part.type === 'text').map(part => part.text)
            : [message.content]).join('\n');
        assert.match(retryText, /at least one location/i);
        assert.match(retryText, /Region XML missing <regionDescription>/, 'retry instruction includes the specific parser error');
        assert.equal(retryMessages[2].content, rejectedXml, 'the same-checkpoint correction retains the rejected XML');
        const retryImage = retryMessages[1].content.find(part => part.type === 'image_url');
        assert.equal(retryImage.image_url.url, imageDataUrl, 'the original image reference remains in retry context');
    } finally {
        for (const region of harness.constructed) Region.removeFromIndex(region);
        Globals.config = previousConfig;
    }
});

test('region generation stops at its configured parse retry budget and does not instantiate rejected data', async () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };
    const harness = loadGenerateRegionFromPrompt({
        responses: ['<region><regionName>Still Rejected</regionName></region>', '<region><regionName>Still Rejected</regionName></region>'],
        retryAttempts: 1
    });
    try {
        await assert.rejects(harness.generate(), /failed to parse after 2 attempts: .*missing <regionDescription>/i);
        assert.equal(harness.completionMessages.length, 2);
        assert.equal(harness.logs.length, 2);
        assert.equal(harness.constructed.length, 0);
        assert.equal(harness.instantiations.length, 0);
        assert.equal(harness.regions.size, 0);
    } finally {
        for (const region of harness.constructed) Region.removeFromIndex(region);
        Globals.config = previousConfig;
    }
});

test('named region schema preserves parser-valid weather and location blueprints', () => {
    const { loadXmlGenerationSchema } = require('../XmlGenerationSchema.js');
    const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
    const schema = loadXmlGenerationSchema('region.schema.xml');
    const previousConfig = Globals.config;
    Globals.config = { ai: {} };
    let parsed;
    try { parsed = Region.parseXMLSnippet(validRegionXml, { requireLocationHasWeather: true }); }
    finally { Globals.config = previousConfig; }
    assert.equal(parsed.locations.length, 1);
    assert.equal(new XmlClosingTagGuard({ schema }).inspect(validRegionXml), null);
    const withOptional = validRegionXml.replace('<locations>', '<weather><hasDynamicWeather>false</hasDynamicWeather></weather><locations>').replace('</exits>', '</exits><vehicles><vehicle><name>Ferry</name><destinations><destination><region>Coast</region><location>Port</location></destination></destinations></vehicle></vehicles>');
    assert.equal(new XmlClosingTagGuard({ schema }).inspect(withOptional), null);
});

test('region generation retries a location named after its region before constructing world objects', async () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };
    const collision = validRegionXml.replace('<name>Retry Meadow</name>', '<name> retry   test region </name>');
    const harness = loadGenerateRegionFromPrompt({ responses: [collision, validRegionXml] });
    try {
        const result = await harness.generate();
        assert.equal(result.region.name, 'Retry Test Region');
        assert.equal(harness.completionMessages.length, 2);
        assert.equal(harness.constructed.length, 1);
        assert.equal(harness.instantiations.length, 1);
        const correction = harness.completionMessages[1].at(-1).content;
        assert.match(correction, /already a region/i);
        assert.match(correction, /different location/i);
    } finally {
        for (const region of harness.constructed) Region.removeFromIndex(region);
        Globals.config = previousConfig;
    }
});
