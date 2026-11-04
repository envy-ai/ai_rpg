const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('node:vm');
const {
    validateGeneratedContainerContentsAgainstSeeds
} = require('../ContainerContentsGeneration.js');
const Utils = require('../Utils.js');
const { runPromptWithParseRetries } = require('../PromptRetryPolicy.js');

const serverSource = fs.readFileSync(require.resolve('../server.js'), 'utf8');

function extractAsyncFunction(name) {
    const start = serverSource.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1, `Could not locate ${name}`);
    const paramsStart = serverSource.indexOf('(', start);
    let depth = 0;
    let paramsEnd = -1;
    for (let index = paramsStart; index < serverSource.length; index += 1) {
        if (serverSource[index] === '(') depth += 1;
        if (serverSource[index] === ')' && --depth === 0) {
            paramsEnd = index;
            break;
        }
    }
    const bodyStart = serverSource.indexOf('{', paramsEnd);
    depth = 0;
    for (let index = bodyStart; index < serverSource.length; index += 1) {
        if (serverSource[index] === '{') depth += 1;
        if (serverSource[index] === '}' && --depth === 0) return serverSource.slice(start, index + 1);
    }
    throw new Error(`Could not find end of ${name}`);
}

function createGeneratorHarness({ generatedItems, pendingSeeds, attachmentError = null }) {
    const committed = [];
    const initialInventory = [{ id: 'preexisting', name: 'Old Coin' }];
    const container = {
        id: 'container-1', name: 'Canvas Satchel', isContainer: true,
        containerContents: pendingSeeds.map(seed => ({ ...seed })),
        inventory: initialInventory.slice(),
        addInventoryItem(thing) { this.inventory.push(thing); },
        clearContainerContents() { this.containerContents = []; },
        toJSON() { return { id: this.id, name: this.name }; }
    };
    const things = new Map([[container.id, container]]);
    const requestOptions = [];
    let commitCalls = 0;
    const llmClient = {
        resolveEffectiveAiConfiguration: () => ({ aiConfig: { retryAttempts: 1 } }),
        logPrompt: () => null
    };
    const thingMutationService = {
        prepareCreate(input) { return { ...input }; },
        commitCreateBatch(entries) {
            commitCalls += 1;
            const created = entries.map(input => {
                const thing = {
                    ...input,
                    delete() {
                        container.inventory = container.inventory.filter(item => item !== thing);
                        things.delete(thing.id);
                    },
                    toJSON() { return { name: this.name }; }
                };
                thing.id = `generated-${committed.length + 1}`;
                committed.push(thing);
                things.set(thing.id, thing);
                return { thing };
            });
            return created;
        }
    };
    const functionSource = extractAsyncFunction('generateContainerContentsForThing');
    const context = {
        console: { warn() {}, log() {} },
        Utils,
        Globals: { location: null, region: null },
        currentPlayer: { level: 1 },
        config: { ai: { retryAttempts: 1 } },
        things,
        thingMutationService,
        containerContentsGenerationPromises: new WeakMap(),
        attributeDefinitionsForPrompt: {},
        hasConfiguredAiBackend: () => true,
        findRegionByLocationId: () => null,
        prepareBasePromptContext: async () => ({}),
        getGearSlotTypes: () => [],
        getGearSlotNames: () => [],
        getThingGeneratorPromptFields: () => [],
        getModGenerationPromptInstructions: () => '',
        getThingGenerationSchemaExtensions: () => [],
        promptEnv: { render: () => '<prompts />' },
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generate' }),
        PromptFailureReporter: { run: (_options, callback) => callback() },
        runPromptWithParseRetries,
        resolveConfiguredPromptMaxAttempts: () => 2,
        LLMClient: llmClient,
        runGenerationPromptCompletion: async ({ requestOptions: current }) => {
            requestOptions.push(current);
            return '<items><item><name>Generated</name></item></items>';
        },
        parseThingsXml: async () => generatedItems.map(item => ({ ...item })),
        validateGeneratedContainerContentsAgainstSeeds,
        validateParsedThingCandidateBatch: () => {},
        normalizeAttributeBonusesForItem: () => [],
        scaleAttributeBonusesForItem: () => [],
        extractThingBooleanFlags: () => ({}),
        getThingExtensionFieldInputsFromSource: () => ({}),
        getThingXmlParserFields: () => [],
        sanitizeMetadataObject: value => value,
        clampLevel: value => value,
        ensureThingNamesAllowed: async () => {},
        ensureUniqueThingNames: async () => { if (attachmentError) throw attachmentError; },
        formatDurationLine: value => String(value),
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generate' })
    };
    vm.createContext(context);
    vm.runInContext(`${functionSource}\nthis.generateContainerContentsForThing = generateContainerContentsForThing;`, context);
    return { context, container, things, committed, initialInventory, requestOptions, get commitCalls() { return commitCalls; } };
}

test('container inventory routes generate pending container contents before serializing payloads', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');

    assert.match(source, /async function ensureContainerContentsGenerated\(container, \{ location = null \} = \{\}\)/);
    assert.match(source, /await ensureContainerContentsGenerated\(container, \{ location \}\)/);
    assert.match(source, /app\.get\('\/api\/things\/:id\/container', async \(req, res\) =>/);
    assert.match(source, /app\.get\('\/api\/player', async \(req, res\) =>/);
    assert.match(source, /await ensurePendingContainerContentsForThings\(currentPlayer\.getInventoryItems\(\)\)/);
    assert.match(source, /const containerContentsGenerationPromises = new WeakMap\(\)/);
    assert.match(source, /containerContentsGenerationPromises\.get\(container\)/);
    assert.match(source, /containerContentsGenerationPromises\.set\(container, generationPromise\)/);
    assert.match(source, /containerContentsGenerationPromises\.delete\(container\)/);
});

test('container contents generator uses the dedicated contents prompt and clears pending seeds after success', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function generateContainerContentsForThing');
    const end = source.indexOf('\nfunction buildThingPromptItem', start);
    assert.notEqual(start, -1, 'Could not locate generateContainerContentsForThing');
    assert.notEqual(end, -1, 'Could not locate function after generateContainerContentsForThing');

    const functionSource = source.slice(start, end);
    assert.match(functionSource, /promptType:\s*'thing-generator-contents'/);
    assert.match(functionSource, /runGenerationPromptCompletion/);
    assert.match(functionSource, /parseThingsXml/);
    assert.match(functionSource, /xmlSchema:\s*'items\.schema\.xml'/);
    assert.match(functionSource, /strictXml:\s*true/);
    assert.match(functionSource, /isInventory:\s*true/);
    assert.match(functionSource, /runPromptWithParseRetries\(\{/);
    assert.match(functionSource, /validateGeneratedContainerContentsAgainstSeeds\(parsed, pendingContents/);
    assert.match(functionSource, /resolveConfiguredPromptMaxAttempts\(LLMClient\.resolveEffectiveAiConfiguration\(contentsMetadataLabel, config\)\.aiConfig\)/);
    assert.match(functionSource, /kind: 'parse_retry'/);
    assert.match(functionSource, /commitCreateBatch\(preparedThingEntries/);
    assert.match(functionSource, /container\.addInventoryItem\(thing, \{ mergeStacks: false \}\)/);
    assert.match(functionSource, /container\.clearContainerContents\(\)/);
    assert.match(functionSource, /LLMClient\.logPrompt/);
});

test('container contents validation preserves requested minimums while allowing generated extras', () => {
    const result = validateGeneratedContainerContentsAgainstSeeds([
        { name: 'Copper Key', count: 2 },
        { name: 'Travel Biscuit', count: 3 },
        { name: 'Travel Biscuit', count: 2 },
        { name: 'Pocket Map', count: 1 }
    ], [
        { name: 'Travel Biscuit', count: 3 },
        { name: 'Copper Key', count: 1 }
    ], { containerName: 'Canvas Satchel' });

    assert.deepEqual(result, [
        { name: 'Copper Key', count: 2 },
        { name: 'Travel Biscuit', count: 3 },
        { name: 'Travel Biscuit', count: 2 },
        { name: 'Pocket Map', count: 1 }
    ]);
});

test('container contents validation rejects missing or underfilled requested names', () => {
    assert.throws(
        () => validateGeneratedContainerContentsAgainstSeeds(
            [{ name: 'Travel Biscuit', count: 1 }],
            [{ name: 'Copper Key', count: 1 }],
            { containerName: 'Canvas Satchel' }
        ),
        /insufficient <count> for <name> "Copper Key".*at least 1.*received 0/i
    );
    assert.throws(
        () => validateGeneratedContainerContentsAgainstSeeds(
            [{ name: 'Travel Biscuit', count: 1 }],
            [{ name: 'Travel Biscuit', count: 2 }],
            { containerName: 'Canvas Satchel' }
        ),
        /insufficient <count> for <name> "Travel Biscuit".*at least 2.*received 1/i
    );
});

test('container contents validation rejects invalid generated names and counts', () => {
    assert.throws(
        () => validateGeneratedContainerContentsAgainstSeeds(
            [{ name: 'Copper Key', count: 0 }],
            [{ name: 'Copper Key', count: 1 }],
            { containerName: 'Canvas Satchel' }
        ),
        /Generated container item "Copper Key" <count> must be a positive integer.*Supply one or more items/
    );
    assert.throws(
        () => validateGeneratedContainerContentsAgainstSeeds(
            [{ name: '   ', count: 1 }],
            [{ name: 'Copper Key', count: 1 }],
            { containerName: 'Canvas Satchel' }
        ),
        /Generated container item 1 must have a non-empty name/
    );
});

test('container generation attaches requested minimums plus valid generated extras and clears seeds on success', async () => {
    const harness = createGeneratorHarness({
        pendingSeeds: [{ name: 'Copper Key', count: 1 }],
        generatedItems: [
            { name: 'Copper Key', count: 1, description: 'A small brass key.' },
            { name: 'Pocket Map', count: 1, description: 'A folded map.' },
            { name: 'Travel Biscuit', count: 2, description: 'A dry biscuit.' }
        ]
    });

    const created = await harness.context.generateContainerContentsForThing({ container: harness.container });

    assert.equal(created.length, 3);
    assert.deepEqual(harness.container.inventory.map(item => item.name), ['Old Coin', 'Copper Key', 'Pocket Map', 'Travel Biscuit']);
    assert.deepEqual(harness.container.containerContents, []);
    assert.equal(harness.commitCalls, 1);
    assert.equal(harness.things.size, 4);
});

test('invalid generated container extras do not commit and preserve pending seeds and prior inventory', async () => {
    const harness = createGeneratorHarness({
        pendingSeeds: [{ name: 'Copper Key', count: 1 }],
        generatedItems: [
            { name: 'Copper Key', count: 1, description: 'A small brass key.' },
            { name: 'Broken Extra', count: 0, description: 'Invalid count.' }
        ]
    });

    await assert.rejects(
        harness.context.generateContainerContentsForThing({ container: harness.container }),
        /positive integer/
    );

    assert.equal(harness.commitCalls, 0);
    assert.deepEqual(harness.container.containerContents, [{ name: 'Copper Key', count: 1 }]);
    assert.deepEqual(harness.container.inventory, harness.initialInventory);
    assert.equal(harness.things.size, 1);
});

test('container naming failure rolls back every created Thing and preserves pending seeds and prior inventory', async () => {
    const failure = new Error('canonical naming rejected generated item');
    const harness = createGeneratorHarness({
        pendingSeeds: [{ name: 'Copper Key', count: 1 }],
        generatedItems: [
            { name: 'Copper Key', count: 1, description: 'A small brass key.' },
            { name: 'Pocket Map', count: 1, description: 'A folded map.' }
        ],
        attachmentError: failure
    });

    await assert.rejects(
        harness.context.generateContainerContentsForThing({ container: harness.container }),
        error => error === failure
    );

    assert.equal(harness.commitCalls, 1);
    assert.deepEqual(harness.container.containerContents, [{ name: 'Copper Key', count: 1 }]);
    assert.deepEqual(harness.container.inventory, harness.initialInventory);
    assert.equal(harness.things.size, 1);
    assert.equal(harness.committed.length, 2);
});
