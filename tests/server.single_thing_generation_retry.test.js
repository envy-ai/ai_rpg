const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');
const { resolveConfiguredPromptMaxAttempts, runPromptWithParseRetries } = require('../PromptRetryPolicy.js');
const { createPromptEnv, buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');

function loadGenerateItemsByNames({ responses, retryAttempts = 2, parseThingsXml } = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function generateItemsByNames({');
    const end = source.indexOf('\nasync function generateContainerContentsForThing', start);
    assert.notEqual(start, -1, 'Unable to locate generateItemsByNames.');
    assert.notEqual(end, -1, 'Unable to locate end of generateItemsByNames.');

    const completionCalls = [];
    const promptLogs = [];
    const persistedThings = [];
    const responseQueue = [...responses];
    const context = {
        Array,
        Boolean,
        Date,
        Error,
        JSON,
        Map,
        Math,
        Number,
        Object,
        Promise,
        String,
        TypeError,
        Utils,
        getThingGenerationSchemaExtensions: () => [],
        config: { ai: { retryAttempts } },
        currentPlayer: { level: 1 },
        Things: new Map(),
        Location: { get: id => { throw new Error(`Unexpected location lookup: ${id}`); } },
        Thing: { getRarityDefinition: () => null },
        LLMClient: { logPrompt: entry => { promptLogs.push(entry); return '/test/logs/single-thing.log'; } },
        promptEnv: {
            render: () => '<template><systemPrompt>system</systemPrompt><generationPrompt>Generate one thing.</generationPrompt></template>'
        },
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'Generate one thing.' }),
        prepareBasePromptContext: async () => ({
            attributes: [],
            equipmentSlots: [],
            gearSlots: [],
            attributeDefinitions: {},
            currentLocation: null,
            currentRegion: null
        }),
        attributeDefinitionsForPrompt: {},
        getGearSlotTypes: () => [],
        getGearSlotNames: () => [],
        getLorebookManager: () => null,
        getThingGeneratorPromptFields: () => [],
        getThingXmlParserFields: () => [],
        getModGenerationPromptInstructions: () => '',
        getThingExtensionFieldInputsFromSource: () => ({}),
        findRegionByLocationId: () => null,
        sanitizeMetadataObject: value => ({ ...value }),
        extractThingBooleanFlags: () => ({}),
        clampLevel: value => value,
        normalizeAttributeBonusesForItem: value => value,
        scaleAttributeBonusesForItem: value => value,
        shouldGenerateThingImage: () => false,
        hasExistingImage: () => false,
        ensureUniqueThingNames: async () => {},
        ensureThingNamesAllowed: async () => {},
        validateParsedThingCandidateBatch: () => {},
        parseThingsXml: parseThingsXml || (async () => [{
            name: 'Copper Seal',
            description: 'A stamped seal.',
            itemOrScenery: 'item',
            rarity: 'Common',
            count: 1
        }]),
        resolveConfiguredPromptMaxAttempts,
        runPromptWithParseRetries,
        runGenerationPromptCompletion: async ({ requestOptions }) => {
            completionCalls.push(requestOptions);
            assert.equal(requestOptions.expectedXmlRootTag, undefined, 'semantic parsing owns the retryable root check');
            assert.equal(requestOptions.validateXML, false, 'the client must return malformed XML for parser-guided correction');
            assert.equal(requestOptions.throwOnError, true, 'transport exhaustion must propagate instead of entering a parse retry');
            const response = responseQueue.shift();
            assert.notEqual(response, undefined, 'Unexpected extra model completion.');
            if (response instanceof Error) throw response;
            return response;
        },
        thingMutationService: {
            prepareCreate: data => data,
            commitCreate(data) {
                const thing = {
                    ...data,
                    id: `single-thing-${persistedThings.length + 1}`,
                    toJSON() { return { id: this.id, name: this.name }; }
                };
                persistedThings.push(thing);
                return { thing };
            }
        },
        things: new Map(),
        console: { log() {}, warn() {}, error() {} },
        formatDurationLine: seconds => `${seconds}s`,
        formatGenerationPromptMessageForLog: message => `${message.role}: ${message.content}`
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}\nthis.generateItemsByNames = generateItemsByNames;`,
        context
    );

    return {
        generate: () => context.generateItemsByNames({ itemNames: ['Copper Seal'] }),
        completionCalls,
        promptLogs,
        persistedThings,
        responseQueue
    };
}

test('single Thing generation sends malformed-root and schema errors back, then persists only the valid response', async () => {
    const malformedXml = '<items><item><name>Copper Seal</name>';
    const rootError = (() => {
        try {
            Utils.parseXmlDocumentStrict(malformedXml, 'text/xml');
        } catch (error) {
            return error.message;
        }
        assert.fail('Expected the malformed single-Thing fixture to fail strict XML parsing.');
    })();
    const schemaError = 'Generated item "Copper Seal" must include a non-empty <description>.';
    const harness = loadGenerateItemsByNames({
        responses: [
            malformedXml,
            '<items><item><name>Copper Seal</name></item></items>',
            '<items><item><name>Copper Seal</name><description>A stamped seal.</description></item></items>'
        ],
        parseThingsXml: async xml => {
            Utils.parseXmlDocumentStrict(xml, 'text/xml');
            if (!xml.includes('<description>')) throw new Error(schemaError);
            return [{
                name: 'Copper Seal',
                description: 'A stamped seal.',
                itemOrScenery: 'item',
                rarity: 'Common',
                count: 1
            }];
        }
    });

    const things = await harness.generate();

    assert.equal(things.length, 1);
    assert.equal(harness.persistedThings.length, 1, 'invalid responses must never reach Thing persistence');
    assert.equal(harness.completionCalls.length, 3);
    assert.equal(harness.responseQueue.length, 0);
    const firstCorrection = harness.completionCalls[1].messages.at(-1).content;
    assert.match(firstCorrection, /<items>/);
    assert.match(firstCorrection, /exactly one <item>/i);
    assert.ok(firstCorrection.includes(rootError));
    assert.equal(harness.completionCalls[1].messages.at(-2).content, '<items><item><name>Copper Seal</name>');
    const secondCorrection = harness.completionCalls[2].messages.at(-1).content;
    assert.match(secondCorrection, /<items>/);
    assert.match(secondCorrection, /exactly one <item>/i);
    assert.ok(secondCorrection.includes(schemaError));
    assert.equal(
        harness.completionCalls[2].messages.at(-2).content,
        '<items><item><name>Copper Seal</name></item></items>'
    );
    assert.equal(harness.promptLogs.filter(entry => /^(?:accepted|rejected) \(/.test(entry.sections?.[0]?.content || '')).length, 3);
});

test('single Thing generation preserves cancellation without retry or persistence', async () => {
    const abortError = new Error('Prompt cancelled by client.');
    abortError.name = 'AbortError';
    const cancelledHarness = loadGenerateItemsByNames({ responses: [abortError], retryAttempts: 3 });
    await assert.rejects(cancelledHarness.generate(), error => error === abortError);
    assert.equal(cancelledHarness.completionCalls.length, 1);
    assert.equal(cancelledHarness.persistedThings.length, 0);
});

test('single Thing generation propagates exhausted completion transport errors without semantic retries', async () => {
    const transportError = new Error('Provider unavailable after transport retries.');
    const harness = loadGenerateItemsByNames({
        responses: [transportError],
        retryAttempts: 3
    });

    await assert.rejects(harness.generate(), error => error === transportError);
    assert.equal(harness.completionCalls.length, 1);
    assert.equal(harness.persistedThings.length, 0);
});

test('single Thing generation exhausts the configured parse budget and propagates the final parser error', async () => {
    const harness = loadGenerateItemsByNames({
        responses: ['<item><name>Wrong root</name></item>', '<item><name>Still wrong</name></item>'],
        retryAttempts: 1
    });

    await assert.rejects(
        harness.generate(),
        /failed to parse after 2 attempts: Expected one complete <items>\.\.\.<\/items> XML root block\./i
    );
    assert.equal(harness.completionCalls.length, 2);
    assert.equal(harness.responseQueue.length, 0);
    assert.equal(harness.persistedThings.length, 0);
});

test('single Thing generation prompt explicitly requires one item inside an items root', () => {
    const originalConfig = Globals.config;
    Globals.config = { strictXMLParsing: true };
    try {
        const promptEnv = createPromptEnv();
        const rendered = promptEnv.render('base-context.xml.njk', {
            ...buildBaseRenderContext(),
            promptType: 'thing-generator-single',
            thingSeed: { name: 'Copper Seal', description: '', itemOrScenery: 'item' },
            equipmentSlots: [],
            gearSlots: [],
            attributes: [],
            attributeDefinitions: {},
            thingGeneratorPromptFields: [],
            allowHiddenDiscovery: false
        });
        const document = Utils.parseXmlDocument(rendered, 'text/xml');
        const parseError = document.getElementsByTagName('parsererror')[0];
        assert.ok(!parseError, parseError?.textContent);
        const generationPrompt = Utils.extractXmlNodeContent(
            document.getElementsByTagName('generationPrompt')[0]
        );

        assert.match(generationPrompt, /Return XML enclosed in exactly one &lt;items&gt;.*? root/i);
        assert.match(generationPrompt, /exactly one &lt;item&gt;/i);
        assert.match(generationPrompt, /never return a standalone &lt;item&gt;/i);
    } finally {
        Globals.config = originalConfig;
    }
});
