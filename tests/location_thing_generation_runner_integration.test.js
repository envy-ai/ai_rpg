const test = require('node:test');
const assert = require('node:assert/strict');

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
    Globals.baseDir = `${__dirname}/../tmp`;
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
        Globals.baseDir = originalBaseDir;
    }
});
