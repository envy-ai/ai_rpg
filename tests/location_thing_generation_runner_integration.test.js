const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');
const {
    configureTinyBrainPromptContext,
    runTinyBrainPromptProgram
} = require('../TinyBrainPromptFamilies.js');
const {
    parseLocationThingsPlan,
    parseLocationThingsDocument,
    normalizeLocationThingRarities,
    validateLocationThingsAgainstPlan
} = require('../LocationThingGenerationPlan.js');
const { validateGeneratedLocationThingBatch } = require('../LocationThingGenerationValidation.js');
const { createPromptEnv, buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');

test('location roster retains its queue slot through native item-family resolution and final expansion', { concurrency: false, timeout: 15000 }, async () => {
    const fs = require('node:fs');
    const axios = require('axios');
    const LLMClient = require('../LLMClient.js');
    const ItemReuseService = require('../ItemReuseService.js');
    const ItemCatalogue = require('../ItemCatalogue.js');
    const { createChatToolRuntime, getChatToolDefinitions } = require('../chat_tool_calls.js');
    const { TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');
    const serverSource = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const begin = serverSource.indexOf('async function resolveItemBatchRoster('), end = serverSource.indexOf('\nasync function generateInventoryForCharacter(', begin);
    assert.ok(begin >= 0 && end > begin);
    const resolveItemBatchRoster = new Function(`${serverSource.slice(begin, end)}; return resolveItemBatchRoster;`)();
    const oldConfig = Globals.config, oldBase = Globals.baseDir, oldPost = axios.post, oldLog = LLMClient.logPrompt;
    const calls = [];
    let releaseRoster, notifyRoster;
    const gate = new Promise(resolve => { releaseRoster = resolve; });
    const ready = new Promise(resolve => { notifyRoster = resolve; });
    const plan = '<thingsPlan><item><name>Copper Seal</name><itemOrScenery>item</itemOrScenery><rarity>Common</rarity><description>A stamped seal.</description></item></thingsPlan>';
    const final = '<things><item><name>Copper Seal</name><itemOrScenery>item</itemOrScenery><rarity>Common</rarity><description>A stamped seal.</description></item></things>';
    Globals.baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'location-things-'));
    Globals.config = { ...(oldConfig || {}), soft_quest_limit: 10, extra_system_instructions: '', max_tool_calls: 4, max_concurrent_requests_all_models: 1, ai: { ...(oldConfig?.ai || {}), tinybrain: true, retryAttempts: 0, max_concurrent_requests: 1, backend: 'openai_compatible', endpoint: 'https://example.invalid', apiKey: 'fixture', model: 'location-queue-fixture', stream: false, supress_seed: true } };
    ItemCatalogue.clear();
    LLMClient.logPrompt = options => options.filePath || `${__dirname}/../tmp/location-queue-test.log`;
    axios.post = async (_url, payload) => {
        const text = payload.messages.at(-1)?.content || '';
        const kind = text === 'FAMILY_REQUEST' ? 'family' : text === 'COMPETITOR' ? 'competitor' : text === 'NPC_REQUEST' ? 'npc' : calls.includes('roster') ? 'final' : 'roster';
        calls.push(kind);
        if (kind === 'roster') { notifyRoster(); await gate; }
        const content = { roster: plan, family: '<itemFamily><reusable>false</reusable></itemFamily>', final, npc: 'npc done', competitor: 'done' }[kind];
        return { status: 200, data: { model: payload.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] } };
    };
    try {
        const promptEnv = createPromptEnv();
        promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
        const rarityDefinitions = [{ key: 'common', label: 'Common', description: 'Ordinary.' }];
        const templateContext = { ...buildBaseRenderContext({ config: Globals.config }), promptType: 'location-generator-things',
            settingDescription: 'Fixture.', region: { regionName: 'Region', regionDescription: 'Fixture.' }, location: { name: 'Room', description: 'Fixture.' },
            attributeDefinitions: {}, attributes: [], equipmentSlots: [], rarityDefinitions, rarityList: { items: { common: 1 }, scenery: {} }, itemCount: 1, sceneryCount: 0,
            recentThings: [], lorebookEntries: [], thingGeneratorPromptFields: [], modGenerationPromptInstructions: [], allowHiddenDiscovery: true };
        const tinyBrain = configureTinyBrainPromptContext(templateContext, 'location_things_generation');
        const runtime = createChatToolRuntime({ LLMClient, Player: require('../Player.js'), Thing: require('../Thing.js'), Location: require('../Location.js'), Region: require('../Region.js'), getConfig: () => Globals.config, getChatHistory: () => [],
            getCurrentPlayer: () => null, isAssistantProseLikeEntry: () => true, serializeNpcForClient: () => ({}),
            buildLocationResponse: () => ({}), generateItemsByNames: async () => [], findRegionByLocationId: () => null,
            createLocationFromEvent: async () => {}, createRegionStubFromEvent: async () => {}, ensureExitConnection: () => {},
            getGameLocations: () => new Map(), getFactions: () => new Map(), getRegionsMap: () => new Map(), getPendingRegionStubs: () => new Map() });
        const completionStart = serverSource.indexOf('async function runGenerationPromptCompletion('), completionEnd = serverSource.indexOf('\nfunction formatGenerationPromptMessageForLog(', completionStart);
        const runGenerationPromptCompletion = new Function('LLMClient', 'getGenerationPromptToolDefinitions', 'getGenerationPromptToolRuntime', `${serverSource.slice(completionStart, completionEnd)}; return runGenerationPromptCompletion;`)(LLMClient, () => getChatToolDefinitions().slice(0, 1), () => runtime);
        const familyStart = serverSource.indexOf('function itemFamilyPromptInputError('), familyEnd = serverSource.indexOf('\nfunction markItemReuseProvenance(', familyStart);
        const authorFamily = new Function('promptEnv', 'parseXMLTemplate', 'prepareBasePromptContext', 'getLorebookManager', 'itemReuseSeedXml', 'Thing', 'attributeDefinitionsForPrompt', 'getGearSlotTypes', 'getThingGeneratorPromptFields', 'getModGenerationPromptInstructions', 'runPromptWithParseRetries', 'resolveConfiguredPromptMaxAttempts', 'LLMClient', 'config', 'runGenerationPromptCompletion', 'Utils', 'formatGenerationPromptMessageForLog', `${serverSource.slice(familyStart, familyEnd)}; return authorStandardItemFamily;`)(
            { render: () => 'family-rendered' }, () => ({ systemPrompt: 'family-system', generationPrompt: 'FAMILY_REQUEST' }), () => ({}), () => null, () => '',
            { getAllRarityDefinitions: () => rarityDefinitions }, {}, () => [], () => [], () => [],
            require('../PromptRetryPolicy.js').runPromptWithParseRetries, require('../PromptRetryPolicy.js').resolveConfiguredPromptMaxAttempts,
            LLMClient, Globals.config, runGenerationPromptCompletion, Utils, message => message.content);
        const session = new ItemReuseService({ rarityDefinitions, authorFamily }).createSession();
        const populationStart = serverSource.indexOf('async function runLocationPopulationTasks('), populationEnd = serverSource.indexOf('\nasync function generateOwnedLocationThingsForLocation(', populationStart);
        assert.ok(populationStart >= 0 && populationEnd > populationStart);
        const runLocationPopulationTasks = new Function('LLMClient', `${serverSource.slice(populationStart, populationEnd)}; return runLocationPopulationTasks;`)(LLMClient);
        const owned = LLMClient.withPromptQueueReservation(rootReservation => LLMClient.withPromptQueueReservationNested(rootReservation, async () => {
        const generate = () => runTinyBrainPromptProgram({ initialRenderedTemplate: promptEnv.render('base-context.xml.njk', templateContext), templateContext, tinyBrain,
            runnerOptions: { promptEnv, parseXMLTemplate: parsePromptTemplate, metadataLabel: 'location_things_generation', retryAttempts: 0, toolDefinitions: [],
                logPrompt: options => options.filePath || `${__dirname}/../tmp/location-queue-test.log`,
                parsers: { location_things_plan: async (response, parseContext) => {
                    const approved = parseLocationThingsPlan(response, { itemCount: 1, sceneryCount: 0, rarityList: { items: { common: 1 }, scenery: {} }, rarityDefinitions });
                    const { unresolvedPlan } = await resolveItemBatchRoster(session, approved, [], { withNestedPrompt: parseContext.withNestedPrompt });
                    return { value: unresolvedPlan };
                } }, finalParser: response => ({ value: parseLocationThingsDocument(response) }),
                complete: async stage => {
                    const aiResponse = await LLMClient.chatCompletion({ messages: stage.messages, queueReservation: stage.queueReservation, metadataLabel: 'location_things_generation', validateXML: false, throwOnError: true, retryAttempts: 0, output: 'silent' });
                    return { aiResponse, conversationMessages: [...stage.messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
                } } });
        return runLocationPopulationTasks(generate, () => LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'NPC_REQUEST' }], metadataLabel: 'npc_fixture', validateXML: false, throwOnError: true, retryAttempts: 0, output: 'silent' }));
        }));
        await ready;
        const contender = LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'COMPETITOR' }], metadataLabel: 'location_competitor', validateXML: false, throwOnError: true, retryAttempts: 0, output: 'silent' });
        await new Promise(resolve => setImmediate(resolve));
        releaseRoster();
        await owned;
        assert.equal(await contender, 'done');
        assert.deepEqual(calls, ['roster', 'family', 'final', 'npc', 'competitor']);
    } finally { releaseRoster(); ItemCatalogue.clear(); axios.post = oldPost; LLMClient.logPrompt = oldLog; Globals.config = oldConfig; fs.rmSync(Globals.baseDir, { recursive: true, force: true }); Globals.baseDir = oldBase; }
});

function parsePromptTemplate(rendered) {
    const doc = Utils.parseXmlDocument(rendered, 'text/xml');
    return {
        systemPrompt: doc.getElementsByTagName('systemPrompt')[0]?.textContent || '',
        generationPrompt: doc.getElementsByTagName('generationPrompt')[0]?.textContent || ''
    };
}

function caughtMessage(callback) {
    try {
        callback();
    } catch (error) {
        return error.message;
    }
    assert.fail('Expected parser to reject the fixture.');
}

test('real TinyBrain location Things runner retries each staged parser locally and carries the approved roster into expansion', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const logCalls = [];
    const completionCalls = [];
    const rarityDefinitions = [
        { key: 'common', label: 'Common', description: 'Ordinary.' },
        { key: 'uncommon', label: 'Uncommon', description: 'Notable.' }
    ];
    const requirements = {
        itemCount: 1,
        sceneryCount: 1,
        rarityList: { items: { common: 1 }, scenery: { common: 1 } },
        rarityDefinitions
    };
    const malformedPlan = '<thingsPlan><item><name>incomplete roster</name>';
    const approvedPlanXml = '<thingsPlan>'
        + '<item><name>Copper Seal</name><itemOrScenery>item</itemOrScenery><rarity>Common</rarity><description>A stamped seal.</description></item>'
        + '<item><name>Bench</name><itemOrScenery>scenery</itemOrScenery><rarity>Common</rarity><description>A bench.</description></item>'
        + '</thingsPlan>';
    const malformedFinal = '<things><item><name>Copper Seal</name><itemOrScenery>item</itemOrScenery><rarity>Common</rarity><description>A stamped seal.</description></item>';
    const validFinal = '<things>'
        + '<item><name>Copper Seal</name><itemOrScenery>item</itemOrScenery><rarity>Common</rarity><description>A detailed stamped seal.</description></item>'
        + '<item><name>Bench</name><itemOrScenery>scenery</itemOrScenery><rarity>Common</rarity><description>A detailed wooden bench.</description></item>'
        + '</things>';
    const expectedPlanError = caughtMessage(() => parseLocationThingsPlan(malformedPlan, requirements));
    const expectedFinalError = caughtMessage(() => parseLocationThingsDocument(malformedFinal));
    const responses = [malformedPlan, approvedPlanXml, malformedFinal, validFinal];
    Globals.baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'location-things-'));
    Globals.config = {
        ...(originalConfig || {}),
        soft_quest_limit: 10,
        extra_system_instructions: '',
        prompt_uses_caching: false,
        strictXMLParsing: true,
        ai: {
            ...(originalConfig?.ai || {}),
            tinybrain: true,
            tinybrain_prompts: { location_things_generation: true },
            retryAttempts: 1,
            max_concurrent_requests: 1
        }
    };

    try {
        const promptEnv = createPromptEnv();
        const { TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');
        promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
        const templateContext = {
            ...buildBaseRenderContext({ config: Globals.config }),
            promptType: 'location-generator-things',
            settingDescription: 'A grounded adventure setting.',
            region: { regionName: 'Test Region', regionDescription: 'A quiet region.' },
            location: { name: 'Test Arcade', description: 'A sheltered arcade.' },
            attributeDefinitions: { strength: { description: 'Physical force.' } },
            attributes: ['strength'],
            equipmentSlots: ['hand'],
            rarityDefinitions,
            rarityList: requirements.rarityList,
            itemCount: requirements.itemCount,
            sceneryCount: requirements.sceneryCount,
            recentThings: [],
            lorebookEntries: [],
            thingGeneratorPromptFields: [],
            modGenerationPromptInstructions: [],
            allowHiddenDiscovery: true
        };
        const tinyBrain = configureTinyBrainPromptContext(templateContext, 'location_things_generation');
        const initialRenderedTemplate = promptEnv.render('base-context.xml.njk', templateContext);
        const approvedPlan = { value: null };
        const finalParsed = { value: null };
        const result = await runTinyBrainPromptProgram({
            initialRenderedTemplate,
            templateContext,
            tinyBrain,
            runnerOptions: {
                promptEnv,
                parseXMLTemplate: parsePromptTemplate,
                metadataLabel: 'location_things_generation',
                logPrefix: 'location_things_generation_test',
                retryAttempts: 1,
                toolDefinitions: [],
                logPrompt(options) {
                    logCalls.push(options);
                    return options.filePath || '/tmp/location-things-runner-test.log';
                },
                parsers: {
                    location_things_plan(response) {
                        const value = parseLocationThingsPlan(response, requirements);
                        approvedPlan.value = value;
                        return { value };
                    }
                },
                finalParser(response) {
                    if (!approvedPlan.value) throw new Error('Location things expansion requires an approved roster.');
                    const { xml } = parseLocationThingsDocument(response);
                    const parsedItems = response === validFinal
                        ? [
                            { name: 'Copper Seal', itemOrScenery: 'item', rarity: 'Common', description: 'A detailed stamped seal.' },
                            { name: 'Bench', itemOrScenery: 'scenery', rarity: 'Common', description: 'A detailed wooden bench.' }
                        ]
                        : [];
                    assert.ok(xml.startsWith('<things>'));
                    const normalized = normalizeLocationThingRarities(parsedItems, rarityDefinitions);
                    validateGeneratedLocationThingBatch(normalized, requirements);
                    validateLocationThingsAgainstPlan(normalized, approvedPlan.value);
                    finalParsed.value = normalized;
                    return { value: normalized };
                },
                async complete(stage) {
                    completionCalls.push({
                        isFinal: stage.isFinal,
                        checkpoint: stage.checkpoint,
                        messages: stage.messages.map(message => ({ ...message }))
                    });
                    const aiResponse = responses.shift();
                    assert.notEqual(aiResponse, undefined, 'Runner must use exactly the scripted mock responses.');
                    return {
                        aiResponse,
                        conversationMessages: [
                            ...stage.messages.map(message => ({ ...message })),
                            { role: 'assistant', content: aiResponse }
                        ],
                        toolInvocations: []
                    };
                }
            }
        });

        assert.equal(result.aiResponse, validFinal);
        assert.deepEqual(completionCalls.map(call => call.isFinal), [false, false, true, true]);
        assert.equal(completionCalls.filter(call => !call.isFinal).length, 2, 'malformed roster retries only the roster checkpoint');
        assert.equal(completionCalls.filter(call => call.isFinal).length, 2, 'malformed final XML retries only the final checkpoint');
        assert.deepEqual(responses, [], 'no additional blind retry calls were made');
        const finalStageContext = completionCalls[2].messages
            .map(message => `${message.role}:${message.content || ''}`)
            .join('\n');
        assert.doesNotMatch(finalStageContext, /incomplete roster|Expected to parse|failed validation|Failed to parse XML content strictly/);
        assert.match(finalStageContext, /<approvedThingsPlan>[\s\S]*Copper Seal[\s\S]*Bench[\s\S]*<\/approvedThingsPlan>/);
        assert.deepEqual(tinyBrain.renderState.completedCheckpoints[0].value, approvedPlan.value);
        assert.deepEqual(finalParsed.value.map(entry => entry.name), ['Copper Seal', 'Bench']);
        assert.deepEqual(Object.keys(tinyBrain.renderState.completedCheckpoints), ['0']);
        assert.ok(completionCalls[2].messages.some(message => /<approvedThingsPlan>[\s\S]*Copper Seal[\s\S]*Bench[\s\S]*<\/approvedThingsPlan>/.test(String(message.content))));
        assert.equal(completionCalls[1].messages.at(-1).role, 'user');
        assert.ok(completionCalls[1].messages.at(-1).content.includes(expectedPlanError));
        assert.ok(completionCalls[1].messages.some(message => message.role === 'assistant' && message.content === malformedPlan));
        assert.equal(completionCalls[3].messages.at(-1).role, 'user');
        assert.ok(completionCalls[3].messages.at(-1).content.includes(expectedFinalError));
        assert.ok(completionCalls[3].messages.some(message => message.role === 'assistant' && message.content === malformedFinal));
        assert.ok(logCalls.length >= 4, 'the shared runner logs each prompt and completion to the injected in-memory logger');
    } finally {
        Globals.config = originalConfig;
        fs.rmSync(Globals.baseDir, { recursive: true, force: true });
        Globals.baseDir = originalBaseDir;
    }
});
