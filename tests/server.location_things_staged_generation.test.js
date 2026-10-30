const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const Utils = require('../Utils.js');
const Globals = require('../Globals.js');
const PromptFailureReporter = require('../PromptFailureReporter.js');
const { resolveConfiguredPromptMaxAttempts, runPromptWithParseRetries } = require('../PromptRetryPolicy.js');
const {
    parseLocationThingsPlan,
    parseLocationThingsDocument,
    normalizeLocationThingRarities,
    validateLocationThingsAgainstPlan
} = require('../LocationThingGenerationPlan.js');
const { validateGeneratedLocationThingBatch } = require('../LocationThingGenerationValidation.js');

const rarityDefinitions = [
    { key: 'common', label: 'Common' },
    { key: 'uncommon', label: 'Uncommon' },
    { key: 'rare', label: 'Rare' }
];

function planXml(entries) {
    return `<thingsPlan>${entries.map(entry => (
        `<item><name>${entry.name}</name><itemOrScenery>${entry.kind}</itemOrScenery>`
        + `<rarity>${entry.rarity}</rarity><description>${entry.name} in one sentence.</description></item>`
    )).join('')}</thingsPlan>`;
}

function thingsXml(names) {
    return `<things>${names.map(name => `<item><name>${name}</name></item>`).join('')}</things>`;
}

function item(name, kind, rarity, extra = {}) {
    return {
        name,
        description: `Complete description of ${name}.`,
        itemOrScenery: kind,
        rarity,
        count: 1,
        ...extra
    };
}

function loadGeneratorHarness({ tinyBrain = false, responses = [], parsedResponses = [], retryAttempts = 1 } = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function generateLocationThingsForLocation({ location } = {}) {');
    const end = source.indexOf('\nfunction renderSkillsPrompt(', start);
    assert.notEqual(start, -1, 'Unable to locate location Things generation function.');
    assert.ok(end > start, 'Unable to locate location Things generation function end.');

    const completionRequests = [];
    const providerRequests = [];
    const promptLogs = [];
    const progress = [];
    const mutationsAtProviderCalls = [];
    const prepared = [];
    const registered = [];
    const responseQueue = [...responses];
    const parsedQueue = [...parsedResponses];
    let activeTinyBrainStage = null;
    const location = {
        id: 'location-staged-test',
        name: 'Test Arcade',
        description: 'A sheltered arcade.',
        baseLevel: 1,
        generationHints: { numItems: 1, numScenery: 1 },
        addThingId(id) { this.addedIds.push(id); },
        addedIds: []
    };
    const runtimeThings = new Map();

    const context = {
        Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise, Set, String, TypeError,
        Utils,
        config: { ai: { retryAttempts }, omit_item_generation: false },
        hasConfiguredAiBackend: () => true,
        PromptFailureReporter,
        currentPlayer: { level: 1 },
        Thing: {
            generateRandomRarityDefinition: () => ({ key: 'common', label: 'Common' }),
            getDefaultRarityKey: () => 'common',
            getAllRarityDefinitions: () => rarityDefinitions,
            getAll: () => []
        },
        getActiveSettingSnapshot: () => null,
        findRegionByLocationId: () => ({ name: 'Test Region', description: 'Region details.' }),
        describeSettingForPrompt: () => 'Test setting.',
        getLorebookManager: () => null,
        renderLocationThingsPrompt: async ({ useTinyBrain: useTinyBrainArg, itemCount, sceneryCount }) => ({
            systemPrompt: 'system prompt',
            generationPrompt: 'generate location things',
            temperature: 0,
            renderedTemplate: 'tiny-brain initial prompt',
            templateContext: { itemCount, sceneryCount },
            tinyBrain: useTinyBrainArg ? { family: 'location_things_generation' } : null
        }),
        isTinyBrainPromptEnabled: () => tinyBrain,
        parseThingsXml: async () => {
            const parsed = parsedQueue.shift();
            assert.notEqual(parsed, undefined, 'Unexpected Thing XML parser invocation.');
            if (parsed instanceof Error) throw parsed;
            return parsed;
        },
        validateGeneratedLocationThingBatch,
        validateParsedThingCandidateBatch(candidates) {
            for (const candidate of candidates) {
                if (!candidate.name || !candidate.description) throw new Error('missing identity prose');
            }
        },
        validateLocationThingsAgainstPlan,
        parseLocationThingsDocument,
        parseLocationThingsPlan,
        normalizeLocationThingRarities,
        runTinyBrainPromptProgram: async options => {
            const runnerOptions = options.runnerOptions;
            const parser = runnerOptions.parsers.location_things_plan;
            const planMessages = [{ role: 'system', content: 'system prompt' }, { role: 'user', content: 'roster request' }];
            let approved = false;
            for (let attempt = 0; attempt <= runnerOptions.retryAttempts; attempt += 1) {
                activeTinyBrainStage = 'roster';
                const completion = await runnerOptions.complete({ messages: planMessages, queueReservation: 'mock-reservation' });
                completionRequests.push(completion);
                const response = completion.aiResponse;
                try {
                    parser(response);
                    approved = true;
                    break;
                } catch (error) {
                    if (attempt >= runnerOptions.retryAttempts) throw error;
                    planMessages.push({ role: 'assistant', content: response }, { role: 'user', content: error.message });
                }
            }
            assert.ok(approved, 'roster checkpoint must validate before expansion');

            const finalMessages = [
                ...planMessages,
                { role: 'assistant', content: 'Roster accepted.' },
                { role: 'user', content: 'Expand exact roster.' }
            ];
            for (let attempt = 0; attempt <= runnerOptions.retryAttempts; attempt += 1) {
                activeTinyBrainStage = 'expansion';
                const completion = await runnerOptions.complete({ messages: finalMessages, queueReservation: 'mock-reservation' });
                completionRequests.push(completion);
                try {
                    await runnerOptions.finalParser(completion.aiResponse);
                    return { aiResponse: completion.aiResponse, conversationMessages: completion.conversationMessages };
                } catch (error) {
                    if (attempt >= runnerOptions.retryAttempts) throw error;
                    finalMessages.push(
                        { role: 'assistant', content: completion.aiResponse },
                        { role: 'user', content: error.message }
                    );
                }
            }
            throw new Error('Mock TinyBrain runner exhausted without a validated batch.');
        },
        runGenerationPromptCompletion: async ({ requestOptions }) => {
            completionRequests.push(requestOptions);
            mutationsAtProviderCalls.push(registered.length);
            const response = responseQueue.shift();
            assert.notEqual(response, undefined, 'Unexpected standard completion.');
            return response;
        },
        LLMClient: {
            logPrompt: entry => { promptLogs.push(entry); return '/tmp/location-things-test.log'; },
            chatCompletion: async options => {
                providerRequests.push({ stage: activeTinyBrainStage, ...options });
                progress.push({ stage: activeTinyBrainStage, messages: options.messages });
                mutationsAtProviderCalls.push(registered.length);
                const response = responseQueue.shift();
                assert.notEqual(response, undefined, 'Unexpected TinyBrain provider completion.');
                return response;
            }
        },
        resolveConfiguredPromptMaxAttempts,
        runPromptWithParseRetries,
        validateGeneratedLocationThingBatch,
        validateLocationThingsAgainstPlan,
        parseLocationThingsDocument,
        promptEnv: {},
        parseXMLTemplate: () => ({}),
        prepareBasePromptContext: async () => ({}),
        getThingXmlParserFields: () => ['modTag'],
        getThingExtensionFieldInputsFromSource: sourceValue => sourceValue.modTag ? { modTag: sourceValue.modTag } : {},
        extractThingBooleanFlags: sourceValue => sourceValue.isContainer === undefined ? {} : { isContainer: Boolean(sourceValue.isContainer) },
        clampLevel: value => value,
        normalizeAttributeBonusesForItem: value => value,
        scaleAttributeBonusesForItem: value => value,
        sanitizeMetadataObject: value => value,
        thingMutationService: {
            prepareCreate(data) { prepared.push(data); return { ...data }; },
            commitCreateBatch(entries) {
                for (const entry of entries) {
                    const thing = { ...entry, id: `thing-${registered.length + 1}` };
                    registered.push(thing);
                    runtimeThings.set(thing.id, thing);
                }
                return entries.map((entry, index) => ({ thing: registered[registered.length - entries.length + index] }));
            }
        },
        things: runtimeThings,
        shouldGenerateThingImage: () => false,
        hasExistingImage: () => false,
        ensureUniqueThingNames: async () => {},
        ensureThingNamesAllowed: async () => {},
        console: { log() {}, warn() {}, error() {} }
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.generateLocationThingsForLocation = generateLocationThingsForLocation;`, context);

    return {
        generate: () => context.generateLocationThingsForLocation({ location }),
        completionRequests,
        providerRequests,
        promptLogs,
        progress,
        mutationsAtProviderCalls,
        prepared,
        registered,
        responseQueue,
        location
    };
}

test('standard location Things generation sends raw rejected XML and its exact error with one configured parse budget', async () => {
    const first = thingsXml(['Copper Seal']);
    const second = thingsXml(['Copper Seal', 'Bench']);
    const harness = loadGeneratorHarness({
        responses: [first, second],
        parsedResponses: [
            [item('Copper Seal', 'item', 'Common')],
            [item('Copper Seal', 'item', 'Common'), item('Bench', 'scenery', 'Common')]
        ],
        retryAttempts: 1
    });

    const result = await harness.generate();

    assert.equal(result.length, 2);
    assert.equal(harness.completionRequests.length, 2, 'retryAttempts: 1 means two complete responses total');
    assert.deepEqual(harness.mutationsAtProviderCalls, [0, 0], 'no rejected batch is registered before standard correction succeeds');
    assert.equal(harness.registered.length, 2);
    assert.equal(harness.promptLogs.length, 2);
    assert.equal(harness.completionRequests[0].expectedXmlRootTag, undefined);
    assert.equal(harness.completionRequests[0].validateXML, false);
    const retryMessages = harness.completionRequests[1].messages;
    assert.equal(retryMessages.at(-2).content, first, 'the exact rejected XML is retained');
    assert.match(retryMessages.at(-1).content, /expected at least 1 scenery entries, but received 0/i);
});

test('standard location Things generation returns a missing-root error with the raw response for correction', async () => {
    const wrongRoot = '<items><item/></items>';
    const valid = thingsXml(['Copper Seal', 'Bench']);
    const harness = loadGeneratorHarness({
        responses: [wrongRoot, valid],
        parsedResponses: [
            [item('Copper Seal', 'item', 'Common'), item('Bench', 'scenery', 'Common')]
        ],
        retryAttempts: 1
    });

    const result = await harness.generate();

    assert.equal(result.length, 2);
    assert.equal(harness.completionRequests.length, 2);
    const retryMessages = harness.completionRequests[1].messages;
    assert.equal(retryMessages.at(-2).content, wrongRoot);
    assert.match(retryMessages.at(-1).content, /requires one complete <things>\.\.\.<\/things> root; received <items>/i);
    assert.equal(harness.registered.length, 2);
});

test('TinyBrain location Things retries an invalid roster only at its checkpoint, then rejects roster drift before any registration', async () => {
    const invalidRoster = planXml([
        { name: 'Copper Seal', kind: 'item', rarity: 'common' }
    ]);
    const validRoster = planXml([
        { name: 'Copper Seal', kind: 'item', rarity: 'common' },
        { name: 'Bench', kind: 'scenery', rarity: 'common' }
    ]);
    const changedKindFinalBatch = thingsXml(['Copper Seal', 'Bench']);
    const validFinalBatch = thingsXml(['Copper Seal', 'Bench']);
    const harness = loadGeneratorHarness({
        tinyBrain: true,
        responses: [invalidRoster, validRoster, changedKindFinalBatch, validFinalBatch],
        parsedResponses: [
            [item('Copper Seal', 'scenery', 'Common'), item('Bench', 'item', 'Common')],
            [item('Copper Seal', 'item', 'Common'), item('Bench', 'scenery', 'Common')]
        ],
        retryAttempts: 1
    });

    const result = await harness.generate();

    assert.equal(result.length, 2);
    assert.deepEqual(harness.progress.map(entry => entry.stage), ['roster', 'roster', 'expansion', 'expansion']);
    assert.deepEqual(harness.providerRequests.map(request => request.stage), ['roster', 'roster', 'expansion', 'expansion']);
    assert.ok(harness.providerRequests.every(request => request.allowToolCalls === false));
    assert.equal(harness.completionRequests.length, 4, 'one configured retry is applied separately at each staged checkpoint');
    assert.deepEqual(harness.mutationsAtProviderCalls, [0, 0, 0, 0], 'no item is registered before final validation succeeds');
    assert.equal(harness.providerRequests[1].messages.at(-2).content, invalidRoster);
    assert.match(harness.providerRequests[1].messages.at(-1).content, /expected at least 1 scenery entries, but received 0/i);
    assert.equal(harness.providerRequests[3].messages.at(-2).content, changedKindFinalBatch);
    assert.match(harness.providerRequests[3].messages.at(-1).content, /must keep approved itemOrScenery "item"/i);
    assert.equal(harness.registered.length, 2);
    assert.equal(harness.promptLogs.length, 0, 'TinyBrain completion logging is owned by its shared runner');
});

test('TinyBrain final roster drift errors return to the model without registering partial batches', async () => {
    const scenarios = [
        {
            label: 'dropped approved entry',
            entries: [
                { name: 'Copper Seal', kind: 'item', rarity: 'common' },
                { name: 'Bench', kind: 'scenery', rarity: 'common' },
                { name: 'Clock', kind: 'item', rarity: 'common' }
            ],
            badNames: ['Copper Seal', 'Bench'],
            badParsed: [item('Copper Seal', 'item', 'Common'), item('Bench', 'scenery', 'Common')],
            validNames: ['Copper Seal', 'Bench', 'Clock'],
            validParsed: [item('Copper Seal', 'item', 'Common'), item('Bench', 'scenery', 'Common'), item('Clock', 'item', 'Common')],
            error: /missing approved entries: Clock/i
        },
        {
            label: 'extra unapproved entry',
            entries: [
                { name: 'Copper Seal', kind: 'item', rarity: 'common' },
                { name: 'Bench', kind: 'scenery', rarity: 'common' }
            ],
            badNames: ['Copper Seal', 'Bench', 'Mystery Box'],
            badParsed: [item('Copper Seal', 'item', 'Common'), item('Bench', 'scenery', 'Common'), item('Mystery Box', 'item', 'Common')],
            validNames: ['Copper Seal', 'Bench'],
            validParsed: [item('Copper Seal', 'item', 'Common'), item('Bench', 'scenery', 'Common')],
            error: /unplanned name "Mystery Box"/i
        },
        {
            label: 'renamed approved entry',
            entries: [
                { name: 'Copper Seal', kind: 'item', rarity: 'common' },
                { name: 'Bench', kind: 'scenery', rarity: 'common' }
            ],
            badNames: ['Renamed Seal', 'Bench'],
            badParsed: [item('Renamed Seal', 'item', 'Common'), item('Bench', 'scenery', 'Common')],
            validNames: ['Copper Seal', 'Bench'],
            validParsed: [item('Copper Seal', 'item', 'Common'), item('Bench', 'scenery', 'Common')],
            error: /unplanned name "Renamed Seal"/i
        },
        {
            label: 'changed approved kind',
            entries: [
                { name: 'Copper Seal', kind: 'item', rarity: 'common' },
                { name: 'Bench', kind: 'scenery', rarity: 'common' }
            ],
            badNames: ['Copper Seal', 'Bench'],
            badParsed: [item('Copper Seal', 'scenery', 'Common'), item('Bench', 'item', 'Common')],
            validNames: ['Copper Seal', 'Bench'],
            validParsed: [item('Copper Seal', 'item', 'Common'), item('Bench', 'scenery', 'Common')],
            error: /must keep approved itemOrScenery "item"/i
        },
        {
            label: 'changed approved rarity',
            entries: [
                { name: 'Copper Seal', kind: 'item', rarity: 'common' },
                { name: 'Optional Charm', kind: 'item', rarity: 'uncommon' },
                { name: 'Bench', kind: 'scenery', rarity: 'common' }
            ],
            badNames: ['Copper Seal', 'Optional Charm', 'Bench'],
            badParsed: [item('Copper Seal', 'item', 'Common'), item('Optional Charm', 'item', 'Rare'), item('Bench', 'scenery', 'Common')],
            validNames: ['Copper Seal', 'Optional Charm', 'Bench'],
            validParsed: [item('Copper Seal', 'item', 'Common'), item('Optional Charm', 'item', 'Uncommon'), item('Bench', 'scenery', 'Common')],
            error: /must keep approved rarity "uncommon"/i
        }
    ];

    for (const scenario of scenarios) {
        const harness = loadGeneratorHarness({
            tinyBrain: true,
            responses: [planXml(scenario.entries), thingsXml(scenario.badNames), thingsXml(scenario.validNames)],
            parsedResponses: [scenario.badParsed, scenario.validParsed],
            retryAttempts: 1
        });

        const generated = await harness.generate();

        assert.equal(generated.length, scenario.validParsed.length, scenario.label);
        assert.equal(harness.providerRequests.length, 3, `${scenario.label}: the final checkpoint gets one correction attempt`);
        assert.deepEqual(harness.mutationsAtProviderCalls, [0, 0, 0], `${scenario.label}: failed XML cannot commit partial Things`);
        assert.equal(harness.providerRequests[2].messages.at(-2).content, thingsXml(scenario.badNames), `${scenario.label}: rejected raw XML is preserved`);
        assert.match(harness.providerRequests[2].messages.at(-1).content, scenario.error, `${scenario.label}: exact parser error is returned`);
        assert.equal(harness.registered.length, scenario.validParsed.length, `${scenario.label}: only the accepted final batch is committed`);
    }
});

test('final candidate validation and registered fields run before the location batch commit', async () => {
    const xml = thingsXml(['Copper Seal', 'Hidden Bench']);
    const harness = loadGeneratorHarness({
        responses: [xml],
        parsedResponses: [[
            item('Copper Seal', 'item', 'Common', { modTag: 'crafted', isContainer: true }),
            item('Hidden Bench', 'scenery', 'Common', { hiddenFromPlayer: true, discoveryDifficulty: 'Hard' })
        ]],
        retryAttempts: 0
    });

    await harness.generate();

    assert.equal(harness.registered.length, 2);
    assert.equal(harness.prepared[0].modTag, 'crafted');
    assert.equal(harness.prepared[0].isContainer, true);
    assert.equal(harness.prepared[1].hiddenFromPlayer, true);
    assert.equal(harness.prepared[1].discoveryDifficulty, 'Hard');
    assert.equal(harness.location.addedIds.length, 2);
});

test('final location Things validation exhaustion leaves the world untouched', async () => {
    const invalid = thingsXml(['Copper Seal']);
    const harness = loadGeneratorHarness({
        responses: [invalid],
        parsedResponses: [[item('Copper Seal', 'item', 'Common')]],
        retryAttempts: 0
    });

    await assert.rejects(harness.generate(), /failed to parse after 1 attempt: .*expected at least 1 scenery entries/i);
    assert.equal(harness.prepared.length, 0);
    assert.equal(harness.registered.length, 0);
    assert.equal(harness.location.addedIds.length, 0);
});

test('standard location Things reports one terminal parse failure and stays quiet after recovery', { concurrency: false }, async () => {
    const originalRealtimeHub = Globals.realtimeHub;
    const events = [];
    Globals.realtimeHub = { emit: (...args) => events.push(args) };
    try {
        const recovered = loadGeneratorHarness({
            responses: [thingsXml(['Copper Seal']), thingsXml(['Copper Seal', 'Bench'])],
            parsedResponses: [
                [item('Copper Seal', 'item', 'Common')],
                [item('Copper Seal', 'item', 'Common'), item('Bench', 'scenery', 'Common')]
            ],
            retryAttempts: 1
        });
        await recovered.generate();
        assert.deepEqual(events, [], 'a parser-guided recovery should not notify the user');

        const exhausted = loadGeneratorHarness({
            responses: [thingsXml(['Copper Seal']), thingsXml(['Copper Seal'])],
            parsedResponses: [
                [item('Copper Seal', 'item', 'Common')],
                [item('Copper Seal', 'item', 'Common')]
            ],
            retryAttempts: 1
        });
        await assert.rejects(exhausted.generate(), /failed to parse after 2 attempts: .*expected at least 1 scenery entries/i);
        assert.equal(events.length, 1, 'terminal parse exhaustion emits exactly one prompt_failed event');
        assert.equal(events[0][0], null);
        assert.equal(events[0][1], 'prompt_failed');
        assert.equal(events[0][2].metadataLabel, 'location_things_generation');
        assert.equal(events[0][2].kind, 'parse_retry');
        assert.equal(events[0][2].validationRetries, 1);
        assert.equal(events[0][2].transportAttempts, 0);
        assert.match(events[0][2].message, /failed to parse after 2 attempts/i);
        assert.equal(exhausted.registered.length, 0);
    } finally {
        Globals.realtimeHub = originalRealtimeHub;
    }
});
