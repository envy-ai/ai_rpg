const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');
const Thing = require('../Thing.js');
const ThingMutationService = require('../ThingMutationService.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');
const ModLoader = require('../ModLoader.js');
const PromptFailureReporter = require('../PromptFailureReporter.js');
const { parseHiddenDiscoveryXmlPair } = require('../HiddenDiscovery.js');
const { resolveConfiguredPromptMaxAttempts, runPromptWithParseRetries } = require('../PromptRetryPolicy.js');

function createModulesRegistry() {
    const registry = new ModExtensionRegistry();
    const loader = new ModLoader(path.join(__dirname, '..'), { config: { mods: { modules: { enabled: true } } } });
    const scopeBase = {
        modExtensionRegistry: registry,
        things: new Map(),
        getCurrentPlayer: () => null,
        getActiveSettingSnapshot: () => ({
            modSettings: {
                modules: {
                    displayLabel: 'Modules',
                    itemLabel: 'Module',
                    slotTypes: [{ id: 'core', label: 'Core', description: 'Main module socket.' }]
                }
            }
        }),
        findActorByName: () => null
    };
    const scope = loader.createModScope(
        'modules', path.join(__dirname, '..', 'mods', 'modules'), scopeBase,
        { mod: {}, modConfig: {} }
    );
    require('../mods/modules/mod.js').register(scope);
    registry.registerEntityField({
        modName: 'implants', entityType: 'thing', fieldName: 'implantSlot', type: 'string',
        exposeToXmlParser: true, clearThingSlotWhenPresent: true
    });
    return registry;
}

function loadRealThingParser() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function parseThingsXml');
    const end = source.indexOf('\nasync function parseThingSeparateResponse', start);
    assert.ok(start >= 0 && end > start);
    const context = { Array, Boolean, Error, JSON, Number, Object, String, Utils, Globals,
        parseHiddenDiscoveryXmlPair, console, getDefaultRarityLabel: () => 'Common' };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.parseThingsXml = parseThingsXml;`, context);
    return context.parseThingsXml;
}

function loadInventoryGenerator({ responses, retryAttempts = 1, mode = 'inventory', requestedItems = [], parseInventoryItems = null } = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const validatorStart = source.indexOf('function validateParsedThingCandidateBatch(');
    const validatorEnd = source.indexOf('\nasync function generateItemsByNames', validatorStart);
    const generatorStart = source.indexOf('async function generateInventoryForCharacter({');
    const generatorEnd = source.indexOf('\nfunction restoreCharacterHealthToMaximum', generatorStart);
    assert.ok(validatorStart >= 0 && validatorEnd > validatorStart, 'Unable to locate the production Thing batch validator.');
    assert.ok(generatorStart >= 0 && generatorEnd > generatorStart, 'Unable to locate the production inventory generator.');

    const priorGlobals = {
        modExtensionRegistry: Globals.modExtensionRegistry,
        realtimeHub: Globals.realtimeHub
    };
    const registry = createModulesRegistry();
    Globals.modExtensionRegistry = registry;
    Thing.clear();
    const mutationService = new ThingMutationService({ getModExtensionRegistry: () => registry });
    const prepareCalls = [];
    const batchValidationCalls = [];
    const commitCalls = [];
    const thingMutationService = {
        prepareCreate(data, options) {
            prepareCalls.push(data);
            return mutationService.prepareCreate(data, options);
        },
        prepareCreateBatch(entries, options) {
            batchValidationCalls.push(entries);
            return mutationService.prepareCreateBatch(entries, options);
        },
        commitCreateBatch(entries, options) {
            commitCalls.push(entries);
            return mutationService.commitCreateBatch(entries, options);
        }
    };
    const completionCalls = [];
    const parsedCalls = [];
    const promptLogs = [];
    const promptFailures = [];
    const worldStateAtCompletions = [];
    const responseQueue = [...responses];
    let responseIndex = 0;
    const runtimeThings = new Map();
    const character = {
        id: 'inventory-retry-owner',
        name: 'Mara',
        description: 'A new mage.',
        level: 1,
        currentLocation: null,
        isNPC: false,
        inventory: [],
        addInventoryItem(thing) {
            this.inventory.push(thing);
            thing.metadata = { ...(thing.metadata || {}), ownerId: this.id };
        }
    };

    const context = {
        Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise, Set, String, TypeError,
        Utils,
        config: { omit_item_generation: false, ai: { retryAttempts } },
        gameLocations: new Map(),
        currentPlayer: { level: 1 },
        startingPlayerLevel: 1,
        things: runtimeThings,
        character,
        resolveConfiguredPromptMaxAttempts,
        runPromptWithParseRetries,
        PromptFailureReporter,
        LLMClient: {
            resolveEffectiveAiConfiguration: (_metadataLabel, config) => ({ aiConfig: config.ai }),
            logPrompt(entry) { promptLogs.push(entry); return entry.filePath || '/test/logs/inventory-generation.log'; }
        },
        getActiveSettingSnapshot: () => ({ name: 'Test World' }),
        describeSettingForPrompt: () => 'A grounded test setting.',
        getLorebookManager: () => null,
        findRegionByLocationId: () => null,
        renderInventoryPrompt: async () => '<template><systemPrompt>system</systemPrompt><generationPrompt>Generate inventory.</generationPrompt></template>',
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'Generate inventory.' }),
        normalizeInventoryGenerationContext: value => ({
            ...value,
            mode,
            requestedItems,
            expectedItemCount: requestedItems.length
        }),
        runGenerationPromptCompletion: async ({ requestOptions }) => {
            completionCalls.push(requestOptions);
            worldStateAtCompletions.push({ inventory: character.inventory.length, things: runtimeThings.size, committed: commitCalls.length });
            assert.equal(requestOptions.validateXML, false);
            assert.equal(requestOptions.throwOnError, true);
            assert.equal(requestOptions.expectedXmlRootTag, undefined);
            const response = responseQueue[responseIndex++];
            assert.notEqual(response, undefined, 'Unexpected additional inventory completion.');
            if (response instanceof Error) throw response;
            return response;
        },
        parseThingsXml: async (xml, options) => {
            parsedCalls.push({ xml, options });
            assert.equal(options.strictXml, true);
            assert.equal(options.expectedThingType, 'item');
            if (parseInventoryItems) return parseInventoryItems(xml);
            const names = [...xml.matchAll(/<name>([^<]+)<\/name>/g)].map(match => match[1]);
            return names.map(name => ({ name, description: `${name} description.`, itemOrScenery: 'item', rarity: 'Common', count: 1, moduleSlots: [] }));
        },
        getThingXmlParserFields: () => registry.getEntityFields('thing').filter(field => field.exposeToXmlParser),
        getThingExtensionFieldInputsFromSource(sourceValue, fields) {
            return Object.fromEntries(fields
                .filter(field => Object.hasOwn(sourceValue, field.fieldName))
                .map(field => [field.fieldName, sourceValue[field.fieldName]]));
        },
        getThingGeneratorPromptFields: () => [],
        getThingExtensionFieldInputs: () => ({}),
        getModGenerationPromptInstructions: () => '',
        extractThingBooleanFlags: () => ({}),
        sanitizeMetadataObject: value => ({ ...value }),
        normalizeAttributeBonusesForItem: value => value,
        scaleAttributeBonusesForItem: value => value,
        clampLevel: value => value,
        thingMutationService,
        promptEnv: {},
        prepareBasePromptContext: async () => ({}),
        attributeDefinitionsForPrompt: {},
        getGearSlotTypes: () => [],
        getGearSlotNames: () => [],
        getThingGeneratorPromptFields: () => [],
        shouldGenerateThingImage: () => false,
        hasExistingImage: () => false,
        ensureThingNamesAllowed: async () => {},
        ensureUniqueThingNames: async () => {},
        equipBestGearForCharacter: async () => {},
        normalizeThingGenerationSeed: seed => seed,
        console: { log() {}, warn() {}, error() {} }
    };
    Globals.realtimeHub = { emit: (...args) => { if (args[1] === 'prompt_failed') promptFailures.push(args[2]); } };
    vm.createContext(context);
    const extracted = `${source.slice(validatorStart, validatorEnd)}\n${source.slice(generatorStart, generatorEnd)}\nthis.generateInventoryForCharacter = generateInventoryForCharacter;`;
    vm.runInContext(extracted, context);

    return {
        character,
        runtimeThings,
        completionCalls,
        parsedCalls,
        promptLogs,
        promptFailures,
        worldStateAtCompletions,
        prepareCalls,
        batchValidationCalls,
        commitCalls,
        responseQueue,
        generate: options => context.generateInventoryForCharacter({ character, autoEquip: false, ...options }),
        cleanup() {
            Thing.clear();
            Globals.modExtensionRegistry = priorGlobals.modExtensionRegistry;
            Globals.realtimeHub = priorGlobals.realtimeHub;
        }
    };
}

test('inventory generation corrects an invalid module slot before preparing or attaching inventory', { concurrency: false }, async () => {
    const invalidXml = '<items><item><name>Modular Kit</name><description>A kit with an unusable socket.</description><moduleSlots><moduleSlot><type>core</type></moduleSlot></moduleSlots></item></items>';
    const validXml = '<items><item><name>Modular Kit</name><description>A kit with a usable socket.</description><slot>head</slot><moduleSlots><moduleSlot><type>core</type></moduleSlot></moduleSlots></item></items>';
    let invalidCandidate;
    const harness = loadInventoryGenerator({
        responses: [invalidXml, validXml],
        parseInventoryItems(xml) {
            const candidate = {
                name: 'Modular Kit',
                description: xml.includes('usable socket') ? 'A kit with a usable socket.' : 'A kit with an unusable socket.',
                itemOrScenery: 'item',
                type: 'gear',
                slot: xml.includes('<slot>head</slot>') ? 'head' : null,
                count: 1,
                moduleSlots: [{ type: 'core' }]
            };
            if (!candidate.slot) invalidCandidate = candidate;
            return [candidate];
        }
    });

    try {
        const created = await harness.generate({ characterDescriptor: { class: 'Mage' } });
        const moduleError = 'Only equippable items may have module slots; "Modular Kit" has no equipment slot.';
        assert.equal(created.length, 1);
        assert.equal(harness.character.inventory.length, 1);
        assert.equal(harness.runtimeThings.size, 1);
        assert.equal(harness.commitCalls.length, 1);
        assert.equal(harness.prepareCalls.length, 1, 'only the accepted fully validated candidate reaches prepareCreate');
        assert.equal(invalidCandidate.level, undefined, 'the rejected item object is not normalized or mutated before validation');
        assert.deepEqual(harness.worldStateAtCompletions, [
            { inventory: 0, things: 0, committed: 0 },
            { inventory: 0, things: 0, committed: 0 }
        ]);
        assert.equal(harness.completionCalls.length, 2);
        const correction = harness.completionCalls[1].messages.at(-1).content;
        assert.ok(correction.includes(moduleError));
        assert.match(correction, /Return the corrected complete <items>/);
        assert.equal(harness.completionCalls[1].messages.at(-2).content, invalidXml);
        const validationLogs = harness.promptLogs.filter(entry => entry.sections?.some(section => section.title === 'Validation'));
        assert.equal(validationLogs.length, 2);
        assert.ok(validationLogs[0].sections[0].content.includes(moduleError));
        assert.match(validationLogs[1].sections[0].content, /accepted/);
    } finally {
        harness.cleanup();
    }
});

test('inventory correction explains a conflicting implant field and accepts corrected modular greaves atomically', { concurrency: false }, async () => {
    const item = implant => `<item><name>Vera's Greaves</name><description>Armored greaves.</description><shortDescription>Armored greaves</shortDescription><itemOrScenery>item</itemOrScenery><type>gear</type><slot>legs</slot><implantSlot>${implant}</implantSlot><moduleSlots><moduleSlot><type>core</type></moduleSlot></moduleSlots></item>`;
    const validFirst = '<item><name>Lantern</name><description>A lantern.</description><shortDescription>Lantern</shortDescription><itemOrScenery>item</itemOrScenery></item>';
    const invalidXml = `<items>${validFirst}${item('skeletal')}</items>`;
    const validXml = `<items>${validFirst}${item('N/A')}</items>`;
    const parseThingsXml = loadRealThingParser();
    const parsed = [];
    const harness = loadInventoryGenerator({
        responses: [invalidXml, validXml],
        async parseInventoryItems(xml) {
            const result = await parseThingsXml(xml, { strictXml: true, expectedThingType: 'item' });
            parsed.push(result[1]);
            return result;
        }
    });
    try {
        const created = await harness.generate({ throwOnError: true });
        assert.equal(parsed[0].slot, null, 'the parser clears the normal slot when implantSlot is meaningful');
        assert.equal(parsed[0].implantSlot, 'skeletal');
        assert.equal(parsed[1].slot, 'legs');
        assert.equal(created.length, 2);
        assert.equal(created[1].slot, 'legs');
        assert.deepEqual(created[1].getExtensionField('moduleSlots'), [{ type: 'core' }]);
        assert.equal(harness.character.inventory.length, 2);
        assert.equal(harness.runtimeThings.size, 2);
        assert.equal(harness.commitCalls.length, 1);
        assert.deepEqual(harness.worldStateAtCompletions, [
            { inventory: 0, things: 0, committed: 0 },
            { inventory: 0, things: 0, committed: 0 }
        ]);
        const correction = harness.completionCalls[1].messages.at(-1).content;
        assert.match(correction, /implantSlot/i);
        assert.match(correction, /skeletal/i);
        assert.match(correction, /clear/i);
        assert.match(correction, /N\/A/i);
        assert.match(correction, /moduleSlots/i);
        assert.match(correction, /remov/i);
        assert.equal(harness.completionCalls[1].messages.at(-2).content, invalidXml);
    } finally {
        harness.cleanup();
    }
});

test('malformed inventory XML and barter stock count errors share one configured correction budget', { concurrency: false }, async () => {
    const malformed = '<items><item><name>Lantern</name>';
    const oneItem = '<items><item><name>Lantern</name><description>A lantern.</description></item></items>';
    const twoItems = '<items><item><name>Lantern</name><description>A lantern.</description></item><item><name>Rope</name><description>A rope.</description></item></items>';
    const expectedXmlError = (() => {
        try { Utils.parseXmlDocumentStrict(malformed, 'text/xml'); }
        catch (error) { return error.message; }
        assert.fail('Expected the malformed XML fixture to be rejected.');
    })();
    const harness = loadInventoryGenerator({
        responses: [malformed, oneItem, twoItems],
        retryAttempts: 2,
        mode: 'barterStock',
        requestedItems: [{ name: 'Lantern', reason: 'night trade' }, { name: 'Rope', reason: 'travel trade' }]
    });

    try {
        const created = await harness.generate({ inventoryGeneration: { mode: 'barterStock', requestedItems: [{ name: 'Lantern' }, { name: 'Rope' }] } });
        assert.equal(created.length, 2);
        assert.equal(harness.completionCalls.length, 3);
        assert.equal(harness.parsedCalls.length, 2, 'malformed XML is rejected before Thing parsing');
        assert.ok(harness.completionCalls[1].messages.at(-1).content.includes(expectedXmlError));
        assert.equal(harness.completionCalls[1].messages.at(-2).content, malformed);
        const countError = 'Inventory generator returned 1 barter stock item(s); expected 2.';
        assert.ok(harness.completionCalls[2].messages.at(-1).content.includes(countError));
        assert.equal(harness.completionCalls[2].messages.at(-2).content, oneItem);
        const validationLogs = harness.promptLogs.filter(entry => entry.sections?.some(section => section.title === 'Validation'));
        assert.equal(validationLogs.length, 3, 'every rejected and accepted response is logged');
        assert.deepEqual(harness.worldStateAtCompletions, [
            { inventory: 0, things: 0, committed: 0 },
            { inventory: 0, things: 0, committed: 0 },
            { inventory: 0, things: 0, committed: 0 }
        ]);
    } finally {
        harness.cleanup();
    }
});

test('exhaustion reports one terminal prompt failure and preserves throwOnError behavior', { concurrency: false }, async () => {
    const invalidXml = '<items><item><name>Modular Kit</name><description>A kit.</description><moduleSlots><moduleSlot><type>core</type></moduleSlot></moduleSlots></item></items>';
    const makeCandidate = () => ({ name: 'Modular Kit', description: 'A kit.', itemOrScenery: 'item', slot: null, moduleSlots: [{ type: 'core' }], count: 1 });
    const firstHarness = loadInventoryGenerator({
        responses: [invalidXml, invalidXml], retryAttempts: 1,
        parseInventoryItems: () => [makeCandidate()]
    });
    try {
        await assert.rejects(firstHarness.generate({ throwOnError: true }), /failed to parse after 2 attempts:.*Only equippable items may have module slots/s);
        assert.equal(firstHarness.completionCalls.length, 2);
        assert.equal(firstHarness.promptFailures.length, 1, 'transient parse failure is reported only once after exhaustion');
        assert.equal(firstHarness.promptFailures[0].validationRetries, 1);
        assert.equal(firstHarness.promptFailures[0].transportAttempts, 0);
        assert.equal(firstHarness.prepareCalls.length, 0);
        assert.equal(firstHarness.commitCalls.length, 0);
        assert.equal(firstHarness.character.inventory.length, 0);
    } finally {
        firstHarness.cleanup();
    }

    const caughtHarness = loadInventoryGenerator({
        responses: [invalidXml], retryAttempts: 0,
        parseInventoryItems: () => [makeCandidate()]
    });
    try {
        const caughtResult = await caughtHarness.generate();
        assert.equal(caughtResult.length, 0, 'the existing default nonthrowing catch remains available to callers');
        assert.equal(caughtHarness.promptFailures.length, 1);
        assert.equal(caughtHarness.promptFailures[0].validationRetries, 0);
        assert.equal(caughtHarness.character.inventory.length, 0);
    } finally {
        caughtHarness.cleanup();
    }
});

test('inventory transport failures propagate without spending semantic validation attempts', { concurrency: false }, async () => {
    const transportError = new Error('Provider transport exhausted.');
    const harness = loadInventoryGenerator({ responses: [transportError], retryAttempts: 3 });
    try {
        await assert.rejects(harness.generate({ throwOnError: true }), error => error === transportError);
        assert.equal(harness.completionCalls.length, 1);
        assert.equal(harness.parsedCalls.length, 0);
        assert.equal(harness.promptLogs.filter(entry => entry.sections?.some(section => section.title === 'Validation')).length, 0);
        assert.equal(harness.promptFailures.length, 1);
        assert.equal(harness.promptFailures[0].validationRetries, 0);
        assert.equal(harness.character.inventory.length, 0);
        assert.equal(harness.commitCalls.length, 0);
    } finally {
        harness.cleanup();
    }
});
