const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const axios = require('axios');
const nunjucks = require('nunjucks');
const LLMClient = require('../LLMClient.js');
const Globals = require('../Globals.js');
const {
    CHAT_TOOL_DEFINITIONS,
    TINY_BRAIN_LOOKUP_TOOL_NAMES,
    createChatToolRuntime
} = require('../chat_tool_calls.js');
const { buildPlayerActionTinyBrainResult } = require('../PlayerActionTinyBrainResult.js');
const { parsePlayerActionResolutionPlan } = require('../PlayerActionResolutionPlan.js');
const { parseGameIntroResult } = require('../TinyBrainPromptParsers.js');
const {
    formatPlayerActionDestinationAbsence,
    resolvePlayerActionDestinationContext,
    resolvePlayerActionDestinationPreviewContext
} = require('../PlayerActionDestinationContext.js');
const {
    TinyBrainPromptExtension,
    TinyBrainPromptRunner,
    createTinyBrainContinuationState,
    parseResponseOrNa,
    parseYesNo
} = require('../TinyBrainPromptRunner.js');

class MemoryLoader extends nunjucks.Loader {
    constructor(templates) {
        super();
        this.templates = templates;
    }

    getSource(name) {
        const src = this.templates[name];
        return typeof src === 'string'
            ? { src, path: name, noCache: true }
            : null;
    }
}

function createEnvironment(programTemplate) {
    const environment = new nunjucks.Environment(new MemoryLoader({
        'wrapper.xml.njk': [
            '<template>',
            '<systemPrompt><![CDATA[Test system prompt.]]></systemPrompt>',
            '<generationPrompt><![CDATA[Fixed base context. ',
            '{{ __tinyBrainState.programStartMarker }}',
            '{% include "program.njk" %}',
            ']]></generationPrompt>',
            '</template>'
        ].join(''),
        'program.njk': programTemplate
    }), { autoescape: false });
    environment.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return environment;
}

function addPlayerActionDestinationGlobals(promptEnv) {
    promptEnv.addGlobal(
        'resolvePlayerActionDestinationContext',
        (destination, originLocationId = null, currentWorldMinutes = 0) => (
            resolvePlayerActionDestinationContext(destination, {
                originLocationId,
                currentWorldMinutes
            })
        )
    );
    promptEnv.addGlobal(
        'resolvePlayerActionDestinationPreviewContext',
        (destination, originLocationId = null, currentWorldMinutes = 0) => (
            resolvePlayerActionDestinationPreviewContext(destination, {
                originLocationId,
                currentWorldMinutes
            })
        )
    );
    promptEnv.addGlobal('formatPlayerActionDestinationAbsence', formatPlayerActionDestinationAbsence);
}

function makeHiddenContestContext(playerName = 'Tester') {
    return {
        player: {
            id: 'player-test',
            name: playerName,
            aliases: [],
            isNPC: false,
            hiddenFromPlayer: false
        },
        npcs: []
    };
}

function parseTemplate(rendered) {
    const systemMatch = rendered.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/);
    const generationMatch = rendered.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/);
    if (!systemMatch || !generationMatch) {
        throw new Error('Test wrapper did not render both prompt fields.');
    }
    return {
        systemPrompt: systemMatch[1],
        generationPrompt: generationMatch[1]
    };
}

function buildTinyBrainProviderConfig() {
    const existing = Globals.config || {};
    return {
        ...existing,
        ai: {
            ...(existing.ai || {}),
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'tinybrain-tool-schema-test',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true,
            prefill: null
        },
        chat_tools: {
            ...(existing.chat_tools || {}),
            request_user_input_enabled: true
        },
        max_tool_calls: 4
    };
}

function createTinyBrainChatToolRuntime({
    createLocationFromEvent = async () => {},
    requestUserInput = async () => null,
    maxToolCalls = 4
} = {}) {
    const gameLocations = new Map();
    const regions = new Map();
    return createChatToolRuntime({
        getConfig: () => ({ max_tool_calls: maxToolCalls }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => ({ currentLocation: 'test-origin' }),
        createLocationFromEvent,
        createRegionStubFromEvent: async () => {},
        generateItemsByNames: async () => [],
        ensureExitConnection: () => {},
        findRegionByLocationId: () => null,
        LLMClient,
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { getAll: () => [] },
        Region: { getAll: () => [] },
        getGameLocations: () => gameLocations,
        getFactions: () => [],
        getRegionsMap: () => regions,
        getPendingRegionStubs: () => new Map(),
        requestUserInput
    });
}

function loadApiTinyBrainPlayerActionToolNames() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    return {
        lookupNames: new Set(TINY_BRAIN_LOOKUP_TOOL_NAMES),
        apiSource: source
    };
}

function completionResponse(message) {
    return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: {
            id: 'tinybrain-tool-schema-run',
            object: 'chat.completion',
            created: 1,
            model: 'tinybrain-tool-schema-test',
            choices: [{
                index: 0,
                finish_reason: Array.isArray(message.tool_calls) && message.tool_calls.length ? 'tool_calls' : 'stop',
                message: { role: 'assistant', ...message }
            }]
        }
    };
}

test('TinyBrain narrowed XML checkpoint rejects textual tool calls despite run-level tools', { concurrency: false }, async () => {
    const tool = CHAT_TOOL_DEFINITIONS.find(entry => entry.function.name === 'moreInfo');
    const environment = createEnvironment("Return XML. {% llmparse('exact_xml_root', 'root') as value %}{% llmresult('capture') %}");
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const old = { post: axios.post, log: LLMClient.logPrompt, config: Globals.config };
    const payloads = [];
    axios.post = async (_endpoint, payload) => { payloads.push(payload); return completionResponse({ content: '<root><tool_call/></root>' }); };
    LLMClient.logPrompt = options => options.filePath || '/test/logs/tinybrain-narrowed-xml.log';
    Globals.config = buildTinyBrainProviderConfig();
    Globals.config.ai.xml_closing_tag_guard = false;
    try {
        const runtime = createTinyBrainChatToolRuntime();
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment, parseXMLTemplate: parseTemplate, retryAttempts: 0,
            metadataLabel: 'tinybrain_narrowed_xml', toolDefinitions: [tool],
            logPrompt: options => options.filePath || '/test/logs/tinybrain-narrowed-xml.log',
            resultBuilders: { capture: ({ checkpointValues }) => checkpointValues[0].value },
            async complete({ messages, queueReservation }) {
                return runtime.runChatCompletionWithToolLoop({
                    requestOptions: { messages, queueReservation, metadataLabel: 'tinybrain_narrowed_xml', additionalPayload: { tool_choice: 'auto' }, validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true },
                    metadataLabel: 'tinybrain_narrowed_xml', queueReservation, allowedToolNames: []
                });
            }
        });
        await assert.rejects(runner.run({ initialRenderedTemplate, templateContext, renderState, programTemplateName: 'program.njk' }), /tool.call/i);
        assert.equal(payloads.length, 1);
        assert.equal(payloads[0].tools, undefined);
        assert.equal(payloads[0].tool_choice, 'none');
    } finally { axios.post = old.post; LLMClient.logPrompt = old.log; Globals.config = old.config; }
});

test('tiny-brain dummy checkpoints assign their trimmed response with as syntax', async () => {
    const environment = createEnvironment([
        'Infer the subtext. {% llm_dummy_action as subtextResponse %}',
        '{% if subtextResponse == "N/A" %}No follow-up is needed.{% else %}Follow up on {{ subtextResponse }}.{% endif %}',
        ' Write the final response.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const prompts = [];
    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        logPrompt(options) {
            return options.filePath || '/test/logs/dummy-assignment.log';
        },
        async complete({ messages, isFinal }) {
            prompts.push(messages.at(-1).content);
            const aiResponse = isFinal ? 'Finished.' : '  N/A \n';
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    const result = await runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName: 'program.njk'
    });

    assert.equal(renderState.completedCheckpoints[0].value, 'N/A');
    assert.match(prompts[1], /No follow-up is needed\./);
    assert.doesNotMatch(prompts[1], /Follow up on/);
    assert.equal(result.aiResponse, 'Finished.');
});

test('TinyBrain exposes only each checkpoint’s callable schema across tool returns and parser retries', { concurrency: false }, async () => {
    const moreInfoTool = CHAT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'moreInfo');
    const createLocationStubTool = CHAT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'createLocationStub');
    assert.ok(moreInfoTool);
    assert.ok(createLocationStubTool);
    const runToolDefinitions = [moreInfoTool];
    const endMarker = LLMClient.getBaseContextEndMarker();
    const stableContextMarker = LLMClient.getStableContextMessageBoundaryMarker();
    const programTemplate = [
        "Look up the requested location. {% llmparse('lookup_response') as lookup %}",
        "Now answer without tools. {% llmparse('plain_response') as plain %}",
        "{% llmresult('test_result') %}"
    ].join(' ');
    const environment = new nunjucks.Environment(new MemoryLoader({
        'wrapper.xml.njk': [
            '<template><systemPrompt><![CDATA[Test system prompt.]]></systemPrompt>',
            '<generationPrompt><![CDATA[Stable game context. ',
            stableContextMarker,
            '<scene>Volatile scene trait definitions.</scene> ',
            endMarker,
            '{{ __tinyBrainState.programStartMarker }}',
            '{% include "program.njk" %}',
            ']]></generationPrompt></template>'
        ].join(''),
        'program.njk': programTemplate
    }), { autoescape: false });
    environment.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());

    const forbiddenLocationCreates = [];
    const runtime = createTinyBrainChatToolRuntime({
        createLocationFromEvent: async payload => {
            forbiddenLocationCreates.push(payload);
            return { id: 'unexpected-location' };
        }
    });
    const providerResponses = [
        { content: null, tool_calls: [{ id: 'lookup-call-1', type: 'function', function: { name: 'moreInfo', arguments: '{"name":"Unknown Site"}' } }] },
        { content: 'INVALID_LOOKUP' },
        { content: 'LOOKUP_OK' },
        { content: 'PLAIN_OK' },
    ];
    const wirePayloads = [];
    const stageResults = [];
    const originalAxiosPost = axios.post;
    const originalLogPrompt = LLMClient.logPrompt;
    const originalConfig = Globals.config;
    axios.post = async (_endpoint, payload) => {
        wirePayloads.push(JSON.parse(JSON.stringify(payload)));
        const message = providerResponses.shift();
        assert.ok(message, 'The TinyBrain integration should consume exactly the canned provider responses.');
        return completionResponse(message);
    };
    LLMClient.logPrompt = options => options.filePath || '/test/logs/tinybrain-schema-run.log';
    Globals.config = buildTinyBrainProviderConfig();
    Globals.config.ai.shared_prefix_cache = {
        provider: 'strata',
        endpoint: Globals.config.ai.endpoint
    };
    Globals.config.ai.sysprompt_append = 'Appended stable system instruction.';
    Globals.config.ai.tinybrain = true;
    Globals.config.ai.tinybrain_prompts = { player_action: true };

    try {
        const renderState = TinyBrainPromptRunner.createRenderState();
        const templateContext = { __tinyBrainState: renderState };
        const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 1,
            metadataLabel: 'tinybrain_tool_schema_test',
            toolDefinitions: runToolDefinitions,
            parsers: {
                lookup_response(response) {
                    if (response.trim() !== 'LOOKUP_OK') throw new Error('Lookup checkpoint requires LOOKUP_OK.');
                    return { value: 'lookup-ok' };
                },
                plain_response(response) {
                    if (response.trim() !== 'PLAIN_OK') throw new Error('Plain checkpoint requires PLAIN_OK.');
                    return { value: 'plain-ok' };
                }
            },
            resultBuilders: {
                test_result({ assignments }) {
                    return `<local>${assignments.lookup}/${assignments.plain}</local>`;
                }
            },
            logPrompt: options => options.filePath || '/test/logs/tinybrain-schema-run.log',
            async complete({ messages, checkpoint, queueReservation }) {
                const allowedToolNames = checkpoint.parserName === 'lookup_response'
                    ? ['moreInfo']
                    : [];
                const completion = await runtime.runChatCompletionWithToolLoop({
                    requestOptions: {
                        messages,
                        metadataLabel: 'tinybrain_tool_schema_test',
                        queueReservation,
                        additionalPayload: { tool_choice: 'auto' },
                        validateXML: false,
                        output: 'silent',
                        retryAttempts: 0
                    },
                    metadataLabel: 'tinybrain_tool_schema_test',
                    queueReservation,
                    allowedToolNames
                });
                stageResults.push({ parserName: checkpoint.parserName, allowedToolNames, completion });
                return {
                    aiResponse: completion.aiResponse,
                    conversationMessages: completion.conversationMessages,
                    toolInvocations: completion.toolInvocations
                };
            }
        });

        const result = await runner.run({
            initialRenderedTemplate,
            templateContext,
            renderState,
            programTemplateName: 'program.njk'
        });

        assert.equal(result.aiResponse, '<local>lookup-ok/plain-ok</local>');
        assert.deepEqual(providerResponses, []);
        assert.equal(wirePayloads.length, 4);
        const pinnedPrefixes = wirePayloads.map(payload => {
            const volatileMessageIndex = payload.messages.findIndex(message => message.content.includes('<scene>'));
            assert.ok(volatileMessageIndex > 0, 'The volatile scene content must follow the stable shared context.');
            assert.deepEqual(payload.strata_prefix, { messages: volatileMessageIndex });
            assert.equal(payload.messages[1].role, 'system');
            assert.equal(payload.messages[1].content, 'Appended stable system instruction.');
            assert.equal(payload.messages.some(message => String(message.content).includes('AI_RPG_INTERNAL_MESSAGE_BOUNDARY_')), false);
            return payload.messages.slice(0, volatileMessageIndex);
        });
        for (const pinnedPrefix of pinnedPrefixes.slice(1)) {
            assert.deepEqual(pinnedPrefix, pinnedPrefixes[0], 'Every checkpoint, tool round, and retry must retain the exact pinned prefix.');
        }
        assert.equal(stageResults.length, 3, 'only the invalid lookup response needs a parser retry');
        assert.equal(stageResults[0].parserName, 'lookup_response');
        assert.deepEqual(stageResults[0].allowedToolNames, ['moreInfo']);
        assert.equal(stageResults[1].parserName, 'lookup_response');
        assert.equal(stageResults[2].parserName, 'plain_response');
        assert.deepEqual(stageResults[2].allowedToolNames, []);
        assert.deepEqual(stageResults[2].completion.toolInvocations, []);
        assert.equal(forbiddenLocationCreates.length, 0);
        assert.deepEqual(result.toolInvocations.map(tool => tool.name), ['moreInfo']);

        for (const payload of wirePayloads.slice(0, 3)) {
            assert.deepEqual(payload.tools.map(tool => tool.function.name), ['moreInfo']);
            assert.equal(payload.tool_choice, 'auto');
        }
        assert.equal(wirePayloads[3].tools, undefined, 'plain checkpoints expose no native schema');
        assert.deepEqual(
            wirePayloads.map(payload => payload.tool_choice),
            ['auto', 'auto', 'auto', 'none']
        );
        const stablePrefixMessageCount = wirePayloads[0].strata_prefix.messages;
        const stableBasePrefix = wirePayloads[0].messages.slice(0, stablePrefixMessageCount);
        assert.match(stableBasePrefix[1].content, /Appended stable system instruction/);
        assert.ok(stableBasePrefix.some(message => message.content.includes('Stable game context')));
        for (const payload of wirePayloads.slice(1)) {
            assert.equal(payload.strata_prefix.messages, stablePrefixMessageCount);
            assert.deepEqual(payload.messages.slice(0, payload.strata_prefix.messages), stableBasePrefix);
        }
        assert.ok(wirePayloads[2].messages.some(message => (
            String(message.content).includes('Lookup checkpoint requires LOOKUP_OK.')
        )), 'the parser correction remains in the next lookup request');
        const plainPermissionMessages = wirePayloads[3].messages.filter(message => (
            message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
        ));
        assert.equal(plainPermissionMessages.length, 0);
        assert.equal(wirePayloads[3].messages.some(message => /Do not make native function tool calls\./.test(String(message.content))), false);
        for (const payload of wirePayloads) {
            const guidanceCount = payload.messages.filter(message => (
                message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
            )).length;
            assert.ok(guidanceCount <= 1, 'current completion guidance must not be retained in the checkpoint transcript');
        }
    } finally {
        axios.post = originalAxiosPost;
        LLMClient.logPrompt = originalLogPrompt;
        Globals.config = originalConfig;
    }
});

test('TinyBrain tool-call budget survives parser retries and later checkpoints while exhausted lookups allow valid prose', { concurrency: false }, async () => {
    const moreInfoTool = CHAT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'moreInfo');
    assert.ok(moreInfoTool);
    const environment = createEnvironment([
        "Look up the missing name. {% llmparse('first_lookup') as firstLookup %}",
        "Check the same name again. {% llmparse('second_lookup') as secondLookup %}",
        'Write the final response.'
    ].join(' '));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const missingLookup = index => ({
        id: `missing-lookup-${index}`,
        type: 'function',
        function: {
            name: 'moreInfo',
            arguments: JSON.stringify({
                name: 'Missing Wisp',
                type: 'character',
                ...(index % 2 === 0 ? { includeFullState: true } : {})
            })
        }
    });
    const providerResponses = [
        { content: 'INVALID', tool_calls: Array.from({ length: 99 }, (_unused, index) => missingLookup(index + 1)) },
        { content: 'INVALID' },
        { content: 'FIRST_OK' },
        { content: 'SECOND_OK' },
        { content: 'FINISHED' }
    ];
    const wirePayloads = [];
    const usedBudgets = [];
    const budgetLogCalls = [];
    const originalAxiosPost = axios.post;
    const originalLogPrompt = LLMClient.logPrompt;
    const originalConfig = Globals.config;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    axios.post = async (_endpoint, payload) => {
        wirePayloads.push(JSON.parse(JSON.stringify(payload)));
        const response = providerResponses.shift();
        assert.ok(response, 'The replay should consume only the scripted responses.');
        return completionResponse(response);
    };
    LLMClient.logPrompt = options => {
        budgetLogCalls.push(options);
        return options.filePath || '/test/logs/tinybrain-run-tool-budget.log';
    };
    console.error = () => {};
    console.warn = () => {};
    Globals.config = buildTinyBrainProviderConfig();

    try {
        const runtime = createTinyBrainChatToolRuntime({ maxToolCalls: 1 });
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 1,
            metadataLabel: 'tinybrain_run_tool_budget_test',
            toolDefinitions: [moreInfoTool],
            parsers: {
                first_lookup(response) {
                    if (response.trim() === 'INVALID') throw new Error('Retry this lookup checkpoint.');
                    assert.equal(response.trim(), 'FIRST_OK');
                    return { value: response.trim() };
                },
                second_lookup(response) {
                    assert.equal(response.trim(), 'SECOND_OK');
                    return { value: response.trim() };
                }
            },
            logPrompt: options => options.filePath || '/test/logs/tinybrain-run-tool-budget.log',
            async complete({ messages, checkpoint, queueReservation }) {
                const completion = await runtime.runChatCompletionWithToolLoop({
                    requestOptions: {
                        messages,
                        metadataLabel: 'tinybrain_run_tool_budget_test',
                        queueReservation,
                        additionalPayload: { tool_choice: 'auto' },
                        validateXML: false,
                        output: 'silent',
                        retryAttempts: 0
                    },
                    metadataLabel: 'tinybrain_run_tool_budget_test',
                    queueReservation,
                    allowedToolNames: checkpoint?.parserName ? ['moreInfo'] : [],
                    promptLogFile: '/test/logs/tinybrain-run-tool-budget.log'
                });
        const state = LLMClient.getTinyBrainToolExecutionState({
                    metadataLabel: 'tinybrain_run_tool_budget_test',
                    queueReservation,
                    maxToolCalls: 1
        });
        usedBudgets.push({ used: state.toolCallsUsed, attempted: state.attemptedToolCalls });
                return {
                    aiResponse: completion.aiResponse,
                    conversationMessages: completion.conversationMessages,
                    toolInvocations: completion.toolInvocations
                };
            }
        });

        const result = await runner.run({
            initialRenderedTemplate,
            templateContext,
            renderState,
            programTemplateName: 'program.njk'
        });

        assert.equal(result.aiResponse, 'FINISHED');
        assert.equal(wirePayloads.length, 5);
        assert.deepEqual(usedBudgets, [
            { used: 1, attempted: 99 },
            { used: 1, attempted: 99 },
            { used: 1, attempted: 99 },
            { used: 1, attempted: 99 }
        ], 'the same budget spans the oversized initial batch, parser retry, and later checkpoints');
        assert.equal(providerResponses.length, 0);
        assert.ok(wirePayloads.slice(1).every(payload => payload.tools === undefined && payload.tool_choice === 'none'),
            'later retries and checkpoints expose no tool definitions after the run budget is exhausted');
        assert.ok(wirePayloads.slice(1).every(payload => payload.messages.every(message => (
            !String(message.content).startsWith('Tool execution permissions for this completion:')
            && !/Do not make native function tool calls\./.test(String(message.content))
        ))), 'empty post-budget requests add no generated permission message');
        assert.ok(budgetLogCalls.some(call => (
            call.sections?.some(section => (
                section.title === 'tinybrain_run_tool_budget_test run tool budget exhausted'
                && /checkpoints or retries do not restore the budget/i.test(section.content)
            ))
        )), 'the run-wide exhaustion instruction must also be appended to the prompt log');
    } finally {
        axios.post = originalAxiosPost;
        LLMClient.logPrompt = originalLogPrompt;
        Globals.config = originalConfig;
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
    }
});

test('TinyBrain exhausted mechanical tool calls remain blocking after a prior lookup used the run budget', { concurrency: false }, async () => {
    const moreInfoTool = CHAT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'moreInfo');
    const skillCheckTool = CHAT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'resolveSkillCheck');
    assert.ok(moreInfoTool);
    assert.ok(skillCheckTool);
    const environment = createEnvironment([
        "Look up the missing name. {% llmparse('lookup') as lookup %}",
        "Resolve the check. {% llmparse('check') as check %}",
        'Write the final response.'
    ].join(' '));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const providerResponses = [
        {
            content: 'LOOKUP_OK',
            tool_calls: [{
                id: 'budgeted-lookup',
                type: 'function',
                function: { name: 'moreInfo', arguments: JSON.stringify({ name: 'Missing Wisp', type: 'character' }) }
            }]
        },
        { content: 'LOOKUP_OK' },
        {
            content: 'CHECK_OK',
            tool_calls: [{
                id: 'exhausted-check',
                type: 'function',
                function: {
                    name: 'resolveSkillCheck',
                    arguments: JSON.stringify({ actor: 'Tester', reason: 'test', skill: 'Athletics', attribute: 'Strength', difficultyLevel: 'Easy' })
                }
            }]
        },
        { content: 'CHECK_OK' }
    ];
    const wirePayloads = [];
    const originalAxiosPost = axios.post;
    const originalLogPrompt = LLMClient.logPrompt;
    const originalConfig = Globals.config;
    axios.post = async (_endpoint, payload) => {
        wirePayloads.push(JSON.parse(JSON.stringify(payload)));
        const response = providerResponses.shift();
        assert.ok(response, 'The mechanical-error replay should consume only the scripted responses.');
        return completionResponse(response);
    };
    LLMClient.logPrompt = options => options.filePath || '/test/logs/tinybrain-mechanical-budget.log';
    Globals.config = buildTinyBrainProviderConfig();

    try {
        const runtime = createTinyBrainChatToolRuntime({ maxToolCalls: 1 });
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 0,
            metadataLabel: 'tinybrain_mechanical_budget_test',
            toolDefinitions: [moreInfoTool, skillCheckTool],
            parsers: {
                lookup(response) {
                    assert.equal(response.trim(), 'LOOKUP_OK');
                    return { value: true };
                },
                check(response) {
                    assert.equal(response.trim(), 'CHECK_OK');
                    return { value: true };
                }
            },
            logPrompt: options => options.filePath || '/test/logs/tinybrain-mechanical-budget.log',
            async complete({ messages, checkpoint, queueReservation }) {
                const completion = await runtime.runChatCompletionWithToolLoop({
                    requestOptions: {
                        messages,
                        metadataLabel: 'tinybrain_mechanical_budget_test',
                        queueReservation,
                        additionalPayload: { tool_choice: 'auto' },
                        validateXML: false,
                        output: 'silent',
                        retryAttempts: 0
                    },
                    metadataLabel: 'tinybrain_mechanical_budget_test',
                    queueReservation,
                    allowedToolNames: checkpoint?.parserName === 'lookup'
                        ? ['moreInfo']
                        : (checkpoint?.parserName === 'check' ? ['resolveSkillCheck'] : [])
                });
                return {
                    aiResponse: completion.aiResponse,
                    conversationMessages: completion.conversationMessages,
                    toolInvocations: completion.toolInvocations
                };
            }
        });

        await assert.rejects(
            runner.run({ initialRenderedTemplate, templateContext, renderState, programTemplateName: 'program.njk' }),
            /Tool calls are forbidden for this completion checkpoint or correction/i,
            'an exhausted mechanical invocation must prevent the checkpoint from advancing'
        );
        assert.equal(wirePayloads.length, 3);
        assert.equal(providerResponses.length, 1, 'the provider is not queried again after its disallowed tool call');
        assert.equal(wirePayloads[2].tools, undefined);
        assert.equal(wirePayloads[2].tool_choice, 'none');
        assert.equal(wirePayloads[2].messages.some(message => (
            message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
        )), false);
        assert.equal(wirePayloads[2].messages.some(message => /Do not make native function tool calls\./.test(String(message.content))), false);
    } finally {
        axios.post = originalAxiosPost;
        LLMClient.logPrompt = originalLogPrompt;
        Globals.config = originalConfig;
    }
});

test('regular player-action TinyBrain exposes only its current callable lookup subset', { concurrency: false }, async () => {
    const { lookupNames, apiSource } = loadApiTinyBrainPlayerActionToolNames();
    const expectedNames = [
        'moreInfo', 'getHistory', 'getFullScene', 'listMysteryBoxes', 'findMysteryBoxes',
        'getMysteryBox', 'listMysteryThreads', 'getMysteryThread', 'listLocationEntities',
        'getTravelTime', 'locateNpcs', 'locateThings'
    ];
    assert.equal(lookupNames.size, 12);
    assert.ok(apiSource.includes('enabledChatTools.filter(toolDefinition => TINY_BRAIN_LOOKUP_TOOL_NAMES.has('));
    assert.ok(apiSource.includes('toolDefinitions: promptChatTools'));
    assert.ok(apiSource.includes("if (promptType === 'creative-mode-action')"));

    const extensionModuleTools = ['installModule', 'removeModule'].map(name => ({
        type: 'function',
        function: { name, parameters: { type: 'object', properties: {} } }
    }));
    const enabledChatTools = [...CHAT_TOOL_DEFINITIONS, ...extensionModuleTools];
    const runToolDefinitions = enabledChatTools.filter(tool => lookupNames.has(tool.function.name));
    const runToolNames = runToolDefinitions.map(tool => tool.function.name);
    assert.deepEqual([...runToolNames].sort(), [...expectedNames].sort());
    for (const prohibitedName of [
        'bulkUpdateCharacterFields', 'scheduleEvent', 'addTracker', 'updateTracker',
        'removeTracker', 'setRelationship', 'requestUserInput', 'installModule', 'removeModule',
        'resolveSkillCheck', 'resolveOpposedSkillCheck', 'resolveAttack', 'resolveAreaAttack'
    ]) {
        assert.ok(!runToolNames.includes(prohibitedName), `${prohibitedName} must not be declared for player-action TinyBrain`);
    }

    const programTemplate = [
        "Look up action context. {% llmparse('lookup') as lookup %}",
        "Answer this checkpoint without tools. {% llmparse('plain') as plain %}",
        "{% llmresult('result') %}"
    ].join(' ');
    const environment = createEnvironment(programTemplate);
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const requestUserInputCalls = [];
    const runtime = createTinyBrainChatToolRuntime({
        requestUserInput: async payload => {
            requestUserInputCalls.push(payload);
            return 'unexpected user input';
        }
    });
    const providerResponses = [
        { content: null, tool_calls: [{ id: 'player-lookup', type: 'function', function: { name: 'moreInfo', arguments: '{"name":"Unknown Site"}' } }] },
        { content: 'INVALID_LOOKUP' },
        { content: 'LOOKUP_OK' },
        { content: 'PLAIN_OK' }
    ];
    const wirePayloads = [];
    const stageResults = [];
    const originalAxiosPost = axios.post;
    const originalLogPrompt = LLMClient.logPrompt;
    const originalConfig = Globals.config;
    axios.post = async (_endpoint, payload) => {
        wirePayloads.push(JSON.parse(JSON.stringify(payload)));
        const message = providerResponses.shift();
        assert.ok(message, 'The player-action TinyBrain run should consume only its canned provider responses.');
        return completionResponse(message);
    };
    LLMClient.logPrompt = options => options.filePath || '/test/logs/player-action-callable-subset.log';
    Globals.config = buildTinyBrainProviderConfig();

    try {
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 1,
            metadataLabel: 'player_action',
            toolDefinitions: runToolDefinitions,
            parsers: {
                lookup(response) {
                    if (response.trim() !== 'LOOKUP_OK') throw new Error('Lookup checkpoint requires LOOKUP_OK.');
                    return { value: 'lookup-ok' };
                },
                plain(response) {
                    if (response.trim() !== 'PLAIN_OK') throw new Error('Plain checkpoint requires PLAIN_OK.');
                    return { value: 'plain-ok' };
                }
            },
            resultBuilders: {
                result({ assignments }) {
                    return `<local>${assignments.lookup}/${assignments.plain}</local>`;
                }
            },
            logPrompt: options => options.filePath || '/test/logs/player-action-callable-subset.log',
            async complete({ messages, checkpoint, queueReservation }) {
                const allowedToolNames = checkpoint.parserName === 'lookup' ? [...lookupNames] : [];
                const completion = await runtime.runChatCompletionWithToolLoop({
                    requestOptions: {
                        messages,
                        metadataLabel: 'player_action',
                        queueReservation,
                        additionalPayload: { tool_choice: 'auto' },
                        validateXML: false,
                        output: 'silent',
                        retryAttempts: 0
                    },
                    metadataLabel: 'player_action',
                    queueReservation,
                    allowedToolNames
                });
                stageResults.push({ checkpoint, allowedToolNames, completion });
                return {
                    aiResponse: completion.aiResponse,
                    conversationMessages: completion.conversationMessages,
                    toolInvocations: completion.toolInvocations
                };
            }
        });

        const result = await runner.run({
            initialRenderedTemplate,
            templateContext,
            renderState,
            programTemplateName: 'program.njk'
        });

        assert.equal(result.aiResponse, '<local>lookup-ok/plain-ok</local>');
        assert.deepEqual(providerResponses, []);
        assert.equal(requestUserInputCalls.length, 0, 'a read-only checkpoint cannot request player input by itself');
        assert.deepEqual(result.toolInvocations.map(invocation => invocation.name), ['moreInfo']);
        assert.equal(wirePayloads.length, 4);
        for (const payload of wirePayloads.slice(0, 3)) {
            assert.deepEqual(
                payload.tools.map(tool => tool.function.name).sort(),
                [...expectedNames].sort()
            );
        }
        assert.equal(wirePayloads[3].tools, undefined, 'plain checkpoints expose no native tools');
        assert.deepEqual(wirePayloads.map(payload => payload.tool_choice), [
            'auto', 'auto', 'auto', 'none'
        ]);
        const stablePrefix = wirePayloads[0].messages.slice(0, 2);
        for (const payload of wirePayloads.slice(1)) {
            assert.deepEqual(payload.messages.slice(0, 2), stablePrefix);
        }
        assert.equal(wirePayloads[3].messages.some(message => (
            message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
        )), false);
        assert.equal(wirePayloads[3].messages.some(message => /Do not make native function tool calls\./.test(String(message.content))), false);
    } finally {
        axios.post = originalAxiosPost;
        LLMClient.logPrompt = originalLogPrompt;
        Globals.config = originalConfig;
    }
});

test('TinyBrain hides native tools after the run tool-call budget is exhausted', { concurrency: false }, async () => {
    const moreInfoTool = CHAT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'moreInfo');
    const createLocationStubTool = CHAT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'createLocationStub');
    const runToolDefinitions = [moreInfoTool, createLocationStubTool];
    const providerResponses = [
        { content: null, tool_calls: [{ id: 'exhaustion-call-1', type: 'function', function: { name: 'moreInfo', arguments: '{"name":"Unknown Site"}' } }] },
        { content: 'DONE' },
        { content: 'DONE' }
    ];
    const wirePayloads = [];
    const originalAxiosPost = axios.post;
    const originalLogPrompt = LLMClient.logPrompt;
    const originalConfig = Globals.config;
    axios.post = async (_endpoint, payload) => {
        wirePayloads.push(JSON.parse(JSON.stringify(payload)));
        const message = providerResponses.shift();
        assert.ok(message);
        return completionResponse(message);
    };
    LLMClient.logPrompt = options => options.filePath || '/test/logs/tinybrain-schema-exhaustion.log';
    Globals.config = buildTinyBrainProviderConfig();

    try {
        const runtime = createTinyBrainChatToolRuntime({ maxToolCalls: 1 });
        const result = await LLMClient.withPromptQueueReservation(async queueReservation => (
            LLMClient.withTinyBrainToolSchema({
                metadataLabel: 'tinybrain_tool_exhaustion_test',
                queueReservation,
                toolDefinitions: runToolDefinitions
            }, () => runtime.runChatCompletionWithToolLoop({
                requestOptions: {
                    messages: [{ role: 'user', content: 'Use one lookup round.' }],
                    metadataLabel: 'tinybrain_tool_exhaustion_test',
                    queueReservation,
                    additionalPayload: { tool_choice: 'auto' },
                    validateXML: false,
                    output: 'silent',
                    retryAttempts: 0
                },
                metadataLabel: 'tinybrain_tool_exhaustion_test',
                queueReservation,
                allowedToolNames: ['moreInfo']
            }))
        ));

        assert.equal(result.aiResponse, 'DONE');
        assert.equal(providerResponses.length, 1);
        assert.equal(wirePayloads.length, 2);
        assert.deepEqual(wirePayloads[0].tools, [moreInfoTool]);
        assert.equal(wirePayloads[1].tools, undefined);
        assert.deepEqual(wirePayloads.map(payload => payload.tool_choice), ['auto', 'none']);
        assert.equal(result.toolInvocations.length, 1);
        assert.equal(result.toolInvocations[0].name, 'moreInfo');
    } finally {
        axios.post = originalAxiosPost;
        LLMClient.logPrompt = originalLogPrompt;
        Globals.config = originalConfig;
    }
});

test('TinyBrain shared base-context exposure follows the current tool budget', { concurrency: false }, async () => {
    const moreInfoTool = CHAT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'moreInfo');
    const endMarker = LLMClient.getBaseContextEndMarker();
    const providerResponses = [
        { content: null, tool_calls: [{ id: 'shared-exhaustion-1', type: 'function', function: { name: 'moreInfo', arguments: '{"name":"Unknown Site"}' } }] },
        { content: 'DONE' },
        { content: 'DONE' }
    ];
    const wirePayloads = [];
    const originalAxiosPost = axios.post;
    const originalLogPrompt = LLMClient.logPrompt;
    const originalChatCompletion = LLMClient.chatCompletion;
    const originalConfig = Globals.config;
    axios.post = async (_endpoint, payload) => {
        wirePayloads.push(JSON.parse(JSON.stringify(payload)));
        const message = providerResponses.shift();
        assert.ok(message);
        return completionResponse(message);
    };
    LLMClient.logPrompt = options => options.filePath || '/test/logs/tinybrain-shared-schema-exhaustion.log';
    const completionPermissionOptions = [];
    LLMClient.chatCompletion = async options => {
        completionPermissionOptions.push({
            allowToolCalls: options.allowToolCalls,
            executionAllowedToolNames: options.executionAllowedToolNames,
            tools: options.additionalPayload?.tools,
            toolChoice: options.additionalPayload?.tool_choice,
            fixedChoice: LLMClient.getTinyBrainToolChoice({
                metadataLabel: options.metadataLabel,
                queueReservation: options.queueReservation
            })
        });
        return await originalChatCompletion.call(LLMClient, options);
    };
    Globals.config = buildTinyBrainProviderConfig();
    Globals.config.ai.tinybrain = true;
    Globals.config.ai.tinybrain_prompts = { player_action: true };

    try {
        const runtime = createTinyBrainChatToolRuntime({ maxToolCalls: 1 });
        const result = await LLMClient.withPromptQueueReservation(async queueReservation => (
            LLMClient.withTinyBrainToolSchema({
                metadataLabel: 'tinybrain_player_action_exhaustion',
                queueReservation,
                toolDefinitions: [moreInfoTool],
                shareBaseContextTools: true
            }, () => runtime.runChatCompletionWithToolLoop({
                requestOptions: {
                    messages: [{ role: 'user', content: `Base context ${endMarker} Run the lookup.` }],
                    metadataLabel: 'tinybrain_player_action_exhaustion',
                    queueReservation,
                    additionalPayload: { tool_choice: 'auto' },
                    validateXML: false,
                    output: 'silent',
                    retryAttempts: 0
                },
                metadataLabel: 'tinybrain_player_action_exhaustion',
                queueReservation,
                allowedToolNames: ['moreInfo']
            }))
        ));

        assert.equal(result.aiResponse, 'DONE');
        assert.equal(providerResponses.length, 1);
        assert.equal(wirePayloads.length, 2);
        assert.deepEqual(completionPermissionOptions.map(options => options.executionAllowedToolNames), [
            ['moreInfo'], []
        ]);
        assert.deepEqual(wirePayloads[0].tools, [moreInfoTool]);
        assert.equal(wirePayloads[1].tools, undefined);
        assert.deepEqual(wirePayloads.map(payload => payload.tool_choice), ['auto', 'none']);
        const permissionGuidance = wirePayloads.map(payload => payload.messages.filter(message => (
            message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
        )));
        assert.deepEqual(permissionGuidance.map(messages => messages.length), [0, 0]);
        assert.equal(wirePayloads[1].messages.some(message => /Do not make native function tool calls\./.test(String(message.content))), false);
        assert.equal(result.toolInvocations.length, 1);
    } finally {
        axios.post = originalAxiosPost;
        LLMClient.logPrompt = originalLogPrompt;
        LLMClient.chatCompletion = originalChatCompletion;
        Globals.config = originalConfig;
    }
});

test('TinyBrain event prompt states that native tools are unavailable without cache claims', () => {
    const source = fs.readFileSync(path.join(__dirname, '../prompts/_includes/events-xml.tinybrain.njk'), 'utf8');
    assert.ok(source.includes(
        '- DO NOT make native tool calls. No native tools are available; any attempted call will be rejected.'
    ));
});

test('standard base-context tool exposure matches each current execution permission set', { concurrency: false }, async () => {
    const moreInfoTool = CHAT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'moreInfo');
    const createLocationStubTool = CHAT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'createLocationStub');
    const marker = LLMClient.getBaseContextEndMarker();
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalLogPrompt = LLMClient.logPrompt;
    const capturedRuns = [];

    async function runLoop(label, callerTools) {
        const providerResponses = [
            { content: null, tool_calls: [{ id: `${label}-first`, type: 'function', function: { name: 'moreInfo', arguments: '{"name":"Unknown Site"}' } }] },
            { content: 'DONE' }
        ];
        const wirePayloads = [];
        axios.post = async (_endpoint, payload) => {
            wirePayloads.push(JSON.parse(JSON.stringify(payload)));
            const message = providerResponses.shift();
            assert.ok(message);
            return completionResponse(message);
        };
        const runtime = createTinyBrainChatToolRuntime({ maxToolCalls: 1 });
        const result = await runtime.runChatCompletionWithToolLoop({
            requestOptions: {
                messages: [{ role: 'user', content: `Shared base context ${marker} Prompt body.` }],
                metadataLabel: label,
                additionalPayload: { tools: callerTools, tool_choice: 'auto' },
                validateXML: false,
                output: 'silent',
                retryAttempts: 0
            },
            metadataLabel: label,
            allowedToolNames: ['moreInfo']
        });
        assert.equal(result.aiResponse, 'DONE');
        assert.equal(result.toolInvocations.length, 1);
        assert.equal(wirePayloads.length, 2);
        capturedRuns.push({ label, callerTools, wirePayloads });
    }

    LLMClient.logPrompt = options => options.filePath || '/test/logs/standard-shared-tool-exhaustion.log';
    Globals.config = {
        ...buildTinyBrainProviderConfig(),
        ai: { ...buildTinyBrainProviderConfig().ai, tinybrain: false },
        max_tool_calls: 1
    };
    try {
        await runLoop('plausibility_check', [moreInfoTool]);
        await runLoop('slop_remover', [moreInfoTool, createLocationStubTool]);
    } finally {
        axios.post = originalAxiosPost;
        LLMClient.logPrompt = originalLogPrompt;
        Globals.config = originalConfig;
    }

    const sharedRun = capturedRuns[0];
    assert.deepEqual(sharedRun.wirePayloads[0].tools, [moreInfoTool]);
    assert.equal(sharedRun.wirePayloads[1].tools, undefined);
    assert.deepEqual(sharedRun.wirePayloads.map(payload => payload.tool_choice), ['auto', 'none']);

    const customRun = capturedRuns[1];
    assert.deepEqual(customRun.wirePayloads[0].tools, [moreInfoTool],
        'the first request exposes only the executor allowlist');
    assert.equal(customRun.wirePayloads[1].tools, undefined,
        'the post-budget request exposes no native definitions');
    assert.deepEqual(customRun.wirePayloads.map(payload => payload.tool_choice), ['auto', 'none']);
});

test('TinyBrain explicit no-tools policy sends no schema and rejects tool calls before response handlers', { concurrency: false }, async () => {
    const createLocationStubTool = CHAT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'createLocationStub');
    const providerResponses = [
        { content: null, tool_calls: [{ id: 'disabled-tool-call', type: 'function', function: { name: 'createLocationStub', arguments: '{"name":"Forbidden Site","region":"Test Region"}' } }] },
        { content: 'DONE' }
    ];
    const wirePayloads = [];
    const createdLocations = [];
    const originalAxiosPost = axios.post;
    const originalLogPrompt = LLMClient.logPrompt;
    const originalConfig = Globals.config;
    axios.post = async (_endpoint, payload) => {
        wirePayloads.push(JSON.parse(JSON.stringify(payload)));
        const message = providerResponses.shift();
        assert.ok(message);
        return completionResponse(message);
    };
    LLMClient.logPrompt = options => options.filePath || '/test/logs/tinybrain-no-tools.log';
    Globals.config = buildTinyBrainProviderConfig();

    try {
        const runtime = createTinyBrainChatToolRuntime({
            createLocationFromEvent: async payload => {
                createdLocations.push(payload);
                return { id: 'unexpected-location' };
            }
        });
        let responseHandlerCalls = 0;
        await assert.rejects(LLMClient.withPromptQueueReservation(async queueReservation => (
            LLMClient.withTinyBrainToolSchema({
                metadataLabel: 'tinybrain_tool_none_test',
                queueReservation,
                toolDefinitions: [createLocationStubTool]
            }, () => runtime.runChatCompletionWithToolLoop({
                requestOptions: {
                    messages: [{ role: 'user', content: 'Do not call a tool.' }],
                    metadataLabel: 'tinybrain_tool_none_test',
                    queueReservation,
                    allowToolCalls: false,
                    additionalPayload: { tool_choice: 'none' },
                    validateXML: false,
                    output: 'silent',
                    retryAttempts: 0,
                    onResponse: () => { responseHandlerCalls += 1; }
                },
                metadataLabel: 'tinybrain_tool_none_test',
                queueReservation,
                allowedToolNames: ['createLocationStub']
            }))
        )), /Tool calls are forbidden for this completion checkpoint or correction/);

        assert.equal(createdLocations.length, 0);
        assert.equal(responseHandlerCalls, 0, 'forbidden tool calls are rejected before onResponse handlers');
        assert.equal(providerResponses.length, 1, 'the unneeded follow-up response must not be requested');
        assert.deepEqual(wirePayloads.map(payload => payload.tools), [undefined]);
        assert.deepEqual(wirePayloads.map(payload => payload.tool_choice), ['none']);
    } finally {
        axios.post = originalAxiosPost;
        LLMClient.logPrompt = originalLogPrompt;
        Globals.config = originalConfig;
    }
});

test('TinyBrain runner defaults non-base-context programs to an empty schema', { concurrency: false }, async () => {
    const environment = createEnvironment('Answer plainly. {% llm_dummy_action %}{% llmresult(\'test_result\') %}');
    const wirePayloads = [];
    const originalAxiosPost = axios.post;
    const originalLogPrompt = LLMClient.logPrompt;
    const originalConfig = Globals.config;
    axios.post = async (_endpoint, payload) => {
        wirePayloads.push(JSON.parse(JSON.stringify(payload)));
        return completionResponse({ content: 'READY' });
    };
    LLMClient.logPrompt = options => options.filePath || '/test/logs/tinybrain-empty-schema.log';
    Globals.config = buildTinyBrainProviderConfig();

    try {
        const renderState = TinyBrainPromptRunner.createRenderState();
        const templateContext = { __tinyBrainState: renderState };
        const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 0,
            metadataLabel: 'tinybrain_nonbase_context_test',
            resultBuilders: { test_result: () => 'done' },
            logPrompt: options => options.filePath || '/test/logs/tinybrain-empty-schema.log',
            async complete({ messages, queueReservation }) {
                const aiResponse = await LLMClient.chatCompletion({
                    messages,
                    metadataLabel: 'tinybrain_nonbase_context_test',
                    queueReservation,
                    validateXML: false,
                    output: 'silent',
                    retryAttempts: 0
                });
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
        });

        const result = await runner.run({
            initialRenderedTemplate,
            templateContext,
            renderState,
            programTemplateName: 'program.njk'
        });
        assert.equal(result.aiResponse, 'done');
        assert.equal(wirePayloads.length, 1);
        assert.equal(wirePayloads[0].tools, undefined);
        assert.equal(wirePayloads[0].tool_choice, 'none');
    } finally {
        axios.post = originalAxiosPost;
        LLMClient.logPrompt = originalLogPrompt;
        Globals.config = originalConfig;
    }
});

test('tiny-brain runner propagates prompt cancellation without parser retries', async () => {
    const environment = createEnvironment([
        'Check the scene. {% llm_dummy_action %}',
        'Write the final response.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    let completionCalls = 0;
    let parseFailureCalls = 0;
    const cancellationError = new Error('Stop & Undo requested.');
    cancellationError.name = 'PromptCancellationError';
    cancellationError.code = 'PROMPT_CANCELLED';

    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 6,
        onParseFailure() {
            parseFailureCalls += 1;
        },
        logPrompt(options) {
            return options.filePath || '/test/logs/tinybrain-cancel.log';
        },
        async complete() {
            completionCalls += 1;
            throw cancellationError;
        }
    });

    await assert.rejects(
        runner.run({
            initialRenderedTemplate,
            templateContext,
            renderState,
            programTemplateName: 'program.njk'
        }),
        error => error === cancellationError
    );

    assert.equal(completionCalls, 1);
    assert.equal(parseFailureCalls, 0);
});

test('tiny-brain runner keeps tool results and gives parser feedback when retrying only the failed checkpoint or final step', async () => {
    const environment = createEnvironment([
        'Decide travel. ',
        "{% llmparse('travel_with_reason', 'expected parser argument') as travel %}",
        '{% if travel %}Travel branch YES.{% else %}Travel branch NO.{% endif %} ',
        "Analyze the scene now. {% llmparse('mod_step_test') as sceneAnalysis %}",
        'Write final XML now.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const completionCalls = [];
    const logCalls = [];
    const parseFailures = [];
    const logFilePath = '/test/logs/tinybrain.log';

    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 1,
        parsers: {
            travel_with_reason(response, parserArgument) {
                assert.equal(parserArgument, 'expected parser argument');
                assert.match(response, /yes/i);
                return { value: true };
            }
        },
        onParseFailure(failure) {
            parseFailures.push(failure);
        },
        finalParser(response) {
            assert.match(response, /<turnResult>/);
            return { value: true };
        },
        logPrompt(options) {
            logCalls.push(options);
            return options.filePath || logFilePath;
        },
        async complete({
            messages,
            checkpoint,
            attempt,
            isFinal,
            logFilePath: activeLogFile,
            appendLogSection
        }) {
            assert.equal(activeLogFile, logFilePath);
            completionCalls.push({ messages, checkpoint, attempt, isFinal });
            if (completionCalls.length === 1) {
                appendLogSection({
                    title: 'checkpoint 1 live token stream fallback',
                    content: 'Live token streaming failed: test diagnostic.'
                });
                const aiResponse = '<travel>yes</travel>';
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
            if (completionCalls.length === 2) {
                const aiResponse = '   ';
                return {
                    aiResponse,
                    conversationMessages: [
                        ...messages,
                        {
                            role: 'assistant',
                            content: '',
                            tool_calls: [{ id: 'tool_1', type: 'function', function: { name: 'moreInfo', arguments: '{}' } }]
                        },
                        { role: 'tool', tool_call_id: 'tool_1', name: 'moreInfo', content: 'Useful retained result.' },
                        { role: 'assistant', content: aiResponse }
                    ],
                    toolInvocations: [{ id: 'tool_1', name: 'moreInfo', metadata: {} }]
                };
            }
            if (completionCalls.length === 3) {
                assert.equal(attempt, 1);
                assert.ok(messages.some(message => message.role === 'tool' && message.content === 'Useful retained result.'));
                assert.ok(messages.some(message => message.role === 'assistant' && message.content === '   '));
                const checkpointPrompt = completionCalls[1].messages.at(-1).content;
                assert.equal(
                    messages.filter(message => message.role === 'user' && message.content === checkpointPrompt).length,
                    1
                );
                assert.match(messages.at(-1).content, /previous response failed validation/i);
                assert.match(messages.at(-1).content, /requires a non-whitespace LLM response/i);
                assert.match(messages.at(-1).content, /Do not repeat any successful tool calls/i);
                assert.doesNotMatch(messages.at(-1).content, /TinyBrainPromptRunner\.js:\d+/);
                const aiResponse = 'Scene analysis complete.';
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
            if (completionCalls.length === 4) {
                assert.equal(isFinal, true);
                assert.equal(attempt, 0);
                assert.match(messages[messages.length - 1].content, /Write final XML now\./);
                const aiResponse = 'Malformed final response.';
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
            assert.equal(completionCalls.length, 5);
            assert.equal(isFinal, true);
            assert.equal(attempt, 1);
            assert.match(messages.at(-1).content, /previous response failed validation/i);
            assert.match(messages.at(-1).content, /<turnResult>/);
            assert.doesNotMatch(messages.at(-1).content, /TinyBrainPromptRunner\.js:\d+/);
            assert.ok(messages.some(message => (
                message.role === 'assistant'
                && message.content === 'Malformed final response.'
            )));
            const finalPrompt = completionCalls[3].messages.at(-1).content;
            assert.equal(
                messages.filter(message => message.role === 'user' && message.content === finalPrompt).length,
                1
            );
            const aiResponse = '<turnResult><prose>Done.</prose><timePassed><reasoning>Talk.</reasoning><duration>1 minute</duration></timePassed></turnResult>';
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    const result = await runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName: 'program.njk'
    });

    assert.equal(completionCalls.length, 5);
    assert.match(completionCalls[1].messages.at(-1).content, /Travel branch YES/);
    assert.equal(result.toolInvocations.length, 1);
    assert.equal(result.logFilePath, logFilePath);
    assert.ok(logCalls.every(call => !call.filePath || call.filePath === logFilePath));
    const responseLogCalls = logCalls.filter(call => call.markResponseBoundaries);
    assert.equal(responseLogCalls.length, 5);
    assert.ok(responseLogCalls.every(call => /LLM response/i.test(call.responseLabel)));
    const transportDiagnosticLog = logCalls.find(call => (
        call.sections?.[0]?.title === 'checkpoint 1 live token stream fallback'
    ));
    assert.equal(
        transportDiagnosticLog?.sections?.[0]?.content,
        'Live token streaming failed: test diagnostic.'
    );
    const initialCheckpointPromptLog = logCalls.find(call => (
        call.sections?.[0]?.title === 'Tiny-brain checkpoint 2 prompt'
    ));
    const retryCheckpointPromptLog = logCalls.find(call => (
        call.sections?.[0]?.title === 'Tiny-brain checkpoint 2 prompt retry 1'
    ));
    assert.equal(
        initialCheckpointPromptLog?.sections?.[0]?.content,
        completionCalls[1].messages.at(-1).content
    );
    assert.match(retryCheckpointPromptLog?.sections?.[0]?.content, /previous response failed validation/i);
    assert.match(retryCheckpointPromptLog?.sections?.[0]?.content, /requires a non-whitespace LLM response/i);
    const initialFinalPromptLog = logCalls.find(call => (
        call.sections?.[0]?.title === 'Tiny-brain final response prompt'
    ));
    const retryFinalPromptLog = logCalls.find(call => (
        call.sections?.[0]?.title === 'Tiny-brain final response prompt retry 1'
    ));
    assert.match(initialFinalPromptLog?.sections?.[0]?.content, /Write final XML now\./);
    assert.match(retryFinalPromptLog?.sections?.[0]?.content, /previous response failed validation/i);
    assert.match(retryFinalPromptLog?.sections?.[0]?.content, /<turnResult>/);
    assert.equal(parseFailures.length, 2);
    assert.equal(parseFailures[0].response, '   ');
    assert.equal(parseFailures[0].checkpoint.index, 1);
    assert.equal(parseFailures[0].attempt, 0);
    assert.equal(parseFailures[0].isFinal, false);
    assert.equal(parseFailures[1].response, 'Malformed final response.');
    assert.equal(parseFailures[1].checkpoint.kind, 'final');
    assert.equal(parseFailures[1].attempt, 0);
    assert.equal(parseFailures[1].isFinal, true);
});

test('XML retries retain each rejected answer until success, then carry only accepted context forward', async () => {
    const environment = createEnvironment([
        "Generate the first XML. {% llmparse('xml_check') as result %}",
        'Next checkpoint. {% llm_dummy_action %} Final XML.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const calls = [];
    const bad1 = '<items><item>first';
    const bad2 = '<items><item>second';
    const good = '<items><item>accepted</item></items>';
    const runner = new TinyBrainPromptRunner({
        promptEnv: environment, parseXMLTemplate: parseTemplate, retryAttempts: 2,
        parsers: { xml_check(response) {
            if (response !== good) throw new Error('Unclosed XML tag(s): items, item');
            return { value: true };
        } },
        finalParser(response) {
            if (response !== '<final>ok</final>') throw new Error('Unclosed XML tag(s): final');
            return { value: true };
        },
        logPrompt(options) { return options.filePath || '/tmp/tinybrain-xml-retention.log'; },
        async complete({ messages, checkpoint, attempt, isFinal }) {
            calls.push({ messages, checkpoint, attempt, isFinal });
            const content = messages.filter(m => m.role === 'assistant').map(m => m.content);
            if (!isFinal && checkpoint.index === 0) {
                if (attempt === 1) {
                    assert.ok(content.includes(bad1));
                    assert.match(messages.at(-1).content, /DONE/);
                }
                if (attempt === 2) {
                    assert.ok(content.includes(bad1));
                    assert.ok(content.includes(bad2));
                    assert.match(messages.at(-1).content, /DONE/);
                }
                const aiResponse = [bad1, bad2, good][attempt];
                const receipt = attempt === 0 ? [
                    { role: 'assistant', content: '', tool_calls: [{ id: 'owned', type: 'function', function: { name: 'moreInfo', arguments: '{}' } }] },
                    { role: 'tool', tool_call_id: 'owned', name: 'moreInfo', content: 'Owned successful receipt.' }
                ] : [];
                return { aiResponse, conversationMessages: [...messages, ...receipt, { role: 'assistant', content: aiResponse }], toolInvocations: attempt === 0 ? [{ id: 'owned', name: 'moreInfo', metadata: { status: 'success' } }] : [] };
            }
            assert.ok(content.includes(good));
            assert.ok(!content.includes(bad1) && !content.includes(bad2));
            assert.equal(messages.filter(m => m.role === 'tool' && m.tool_call_id === 'owned').length, 1);
            assert.equal(messages.filter(m => m.role === 'assistant' && m.tool_calls?.some(call => call.id === 'owned')).length, 1);
            if (!isFinal) {
                const aiResponse = 'Next checkpoint complete.';
                return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
            }
            if (attempt === 1) {
                assert.ok(content.includes('<final>bad'));
                assert.match(messages.at(-1).content, /DONE/);
            }
            if (attempt === 2) {
                assert.ok(content.includes('<final>bad'));
                assert.ok(content.includes('<final>still bad'));
                assert.match(messages.at(-1).content, /DONE/);
            }
            const aiResponse = ['<final>bad', '<final>still bad', '<final>ok</final>'][attempt];
            return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
        }
    });
    const result = await runner.run({ initialRenderedTemplate, templateContext, renderState, programTemplateName: 'program.njk' });
    assert.equal(calls.length, 7);
    assert.equal(result.toolInvocations.filter(call => call.id === 'owned').length, 1);
    assert.equal(result.aiResponse, '<final>ok</final>');
});

test('tiny-brain runner retries failed tool invocations without replaying successful calls or returning errors', async () => {
    const environment = createEnvironment([
        'Resolve the scene tools. {% llm_dummy_action %}',
        'Write the final response.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const completionCalls = [];
    const parseFailures = [];

    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 1,
        onParseFailure(failure) {
            parseFailures.push(failure);
        },
        logPrompt(options) {
            return options.filePath || '/test/logs/tinybrain-tool-error-retry.log';
        },
        async complete({ messages, checkpoint, attempt, isFinal }) {
            completionCalls.push({ messages, checkpoint, attempt, isFinal });
            if (completionCalls.length === 1) {
                const aiResponse = 'The failed lookup can be ignored.';
                return {
                    aiResponse,
                    conversationMessages: [
                        ...messages,
                        {
                            role: 'assistant',
                            content: '',
                            tool_calls: [
                                {
                                    id: 'tool_success',
                                    type: 'function',
                                    function: { name: 'resolveAttack', arguments: '{}' }
                                },
                                {
                                    id: 'tool_failure',
                                    type: 'function',
                                    function: { name: 'moreInfo', arguments: '{}' }
                                }
                            ]
                        },
                        {
                            role: 'tool',
                            tool_call_id: 'tool_success',
                            name: 'resolveAttack',
                            content: 'Attack resolved once.'
                        },
                        {
                            role: 'tool',
                            tool_call_id: 'tool_failure',
                            name: 'moreInfo',
                            content: 'Lookup failed because the target does not exist.'
                        },
                        { role: 'assistant', content: aiResponse }
                    ],
                    toolInvocations: [
                        { id: 'tool_success', name: 'resolveAttack', metadata: { status: 'success' } },
                        {
                            id: 'tool_failure',
                            name: 'moreInfo',
                            metadata: {
                                error: true,
                                code: 'target_not_found',
                                message: 'Lookup failed because the target does not exist.'
                            }
                        }
                    ]
                };
            }
            if (completionCalls.length === 2) {
                assert.equal(attempt, 1);
                assert.equal(isFinal, false);
                assert.ok(messages.some(message => (
                    message.role === 'tool'
                    && message.tool_call_id === 'tool_success'
                    && message.content === 'Attack resolved once.'
                )));
                assert.ok(messages.some(message => (
                    message.role === 'tool'
                    && message.tool_call_id === 'tool_failure'
                    && /target does not exist/i.test(message.content)
                )));
                assert.match(messages.at(-1).content, /moreInfo: Lookup failed because the target does not exist/i);
                assert.match(messages.at(-1).content, /Do not repeat any successful tool calls/i);
                assert.ok(messages.some(message => (
                    message.role === 'assistant'
                    && message.content === 'The failed lookup can be ignored.'
                )));
                const aiResponse = 'Scene tools are resolved.';
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
            assert.equal(completionCalls.length, 3);
            assert.equal(isFinal, true);
            const aiResponse = '<final>Done.</final>';
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    const result = await runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName: 'program.njk'
    });

    assert.equal(completionCalls.length, 3);
    assert.equal(parseFailures.length, 1);
    assert.match(parseFailures[0].error.message, /moreInfo: Lookup failed because the target does not exist/i);
    assert.deepEqual(result.toolInvocations, [
        { id: 'tool_success', name: 'resolveAttack', metadata: { status: 'success' } }
    ]);
    assert.equal(result.aiResponse, '<final>Done.</final>');
});

test('tiny-brain afterParse execution failures retry the same complete plan checkpoint', async () => {
    const environment = createEnvironment([
        "Plan the server calls. {% llmparse('server_plan') as plan %}",
        'Write the final response.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const completionCalls = [];
    const afterParseCalls = [];

    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 1,
        parsers: {
            server_plan(response) {
                assert.match(response, /^plan attempt [12]$/);
                return { value: response };
            }
        },
        finalParser(response, parseContext) {
            assert.equal(parseContext.toolInvocations.length, 2);
            return { value: true };
        },
        logPrompt(options) {
            return options.filePath || '/test/logs/tinybrain-after-parse-retry.log';
        },
        async afterParse({ parsed, messages, checkpoint, attempt }) {
            afterParseCalls.push({ parsed, messages, checkpoint, attempt });
            if (afterParseCalls.length === 1) {
                const updateArgs = { object: 'test-object', fields: { status: 'ready' } };
                const failedSummaryArgs = { scene: 3 };
                const calls = [
                    { id: 'update_1', type: 'function', function: { name: 'updateObjectFields', arguments: JSON.stringify(updateArgs) } },
                    { id: 'summary_1', type: 'function', function: { name: 'rerunSceneSummary', arguments: JSON.stringify(failedSummaryArgs) } }
                ];
                return {
                    conversationMessages: [
                        ...messages,
                        { role: 'assistant', content: '', tool_calls: calls },
                        { role: 'tool', tool_call_id: 'update_1', name: 'updateObjectFields', content: 'Updated.' },
                        { role: 'tool', tool_call_id: 'summary_1', name: 'rerunSceneSummary', content: 'Scene summary 3 is out of range; stored scenes: 2.' }
                    ],
                    toolInvocations: [
                        { id: 'update_1', name: 'updateObjectFields', argumentsObject: updateArgs, metadata: { status: 'success' } },
                        {
                            id: 'summary_1',
                            name: 'rerunSceneSummary',
                            argumentsObject: failedSummaryArgs,
                            metadata: {
                                error: true,
                                message: 'Scene summary 3 is out of range; stored scenes: 2.'
                            }
                        }
                    ]
                };
            }
            const scheduleArgs = { event: 'A test event.' };
            return {
                conversationMessages: [
                    ...messages,
                    { role: 'assistant', content: '', tool_calls: [
                        { id: 'schedule_1', type: 'function', function: { name: 'scheduleEvent', arguments: JSON.stringify(scheduleArgs) } }
                    ] },
                    { role: 'tool', tool_call_id: 'schedule_1', name: 'scheduleEvent', content: 'Scheduled.' }
                ],
                toolInvocations: [
                    { id: 'schedule_1', name: 'scheduleEvent', argumentsObject: scheduleArgs, metadata: { status: 'success' } }
                ]
            };
        },
        async complete({ messages, checkpoint, attempt, isFinal }) {
            completionCalls.push({ messages, checkpoint, attempt, isFinal });
            if (!isFinal) {
                if (attempt === 1) {
                    assert.match(messages.at(-1).content, /Return a complete corrected plan/i);
                    assert.match(messages.at(-1).content, /cached successful executions/i);
                    assert.doesNotMatch(messages.at(-1).content, /Do not repeat any successful tool calls/i);
                }
                const aiResponse = `plan attempt ${attempt + 1}`;
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
            assert.ok(messages.some(message => message.tool_call_id === 'update_1'));
            assert.ok(messages.some(message => message.tool_call_id === 'schedule_1'));
            const aiResponse = '<final>Done.</final>';
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    const result = await runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName: 'program.njk'
    });

    assert.equal(afterParseCalls.length, 2);
    assert.equal(completionCalls.length, 3);
    assert.equal(completionCalls[0].checkpoint.index, 0);
    assert.equal(completionCalls[1].checkpoint.index, 0);
    assert.equal(completionCalls[1].attempt, 1);
    assert.deepEqual(result.toolInvocations.map(invocation => invocation.name), [
        'updateObjectFields',
        'scheduleEvent'
    ]);
});

test('tiny-brain blank tool checkpoints and normalized XML finals preserve raw wrapper logs', async () => {
    const environment = createEnvironment([
        'Use the lookup tool now. {% llm_dummy_action %}',
        'Return the final result now.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const completionCalls = [];
    const logCalls = [];
    const rawFinal = 'Here is the result.\n```xml\n<gameIntro><introProse>The group enters the old station.</introProse></gameIntro>\n```\nNo additional fields.';

    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        finalParser(response, parseContext) {
            assert.equal(parseContext.toolInvocations.length, 1);
            assert.equal(parseContext.toolInvocations[0].name, 'moreInfo');
            assert.equal(response, rawFinal);
            return parseGameIntroResult(response);
        },
        logPrompt(options) {
            logCalls.push(options);
            return options.filePath || '/test/logs/tinybrain-normalized.log';
        },
        async complete({ messages, isFinal }) {
            completionCalls.push({ messages, isFinal });
            if (!isFinal) {
                const aiResponse = '';
                return {
                    aiResponse,
                    conversationMessages: [
                        ...messages,
                        {
                            role: 'assistant',
                            content: '',
                            tool_calls: [{
                                id: 'tool_1',
                                type: 'function',
                                function: { name: 'moreInfo', arguments: '{}' }
                            }]
                        },
                        { role: 'tool', tool_call_id: 'tool_1', name: 'moreInfo', content: 'Found it.' },
                        { role: 'assistant', content: aiResponse }
                    ],
                    toolInvocations: [{ id: 'tool_1', name: 'moreInfo', metadata: {} }]
                };
            }
            const aiResponse = rawFinal;
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    const result = await runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName: 'program.njk'
    });

    assert.equal(completionCalls.length, 2);
    assert.equal(result.aiResponse, '<gameIntro><introProse>The group enters the old station.</introProse></gameIntro>');
    assert.equal(result.toolInvocations.length, 1);
    assert.ok(logCalls.some(call => call.response === rawFinal), 'the prompt log keeps the model’s original wrapper and commentary');
});

test('tiny-brain accept_or_reject parser terminates the program on rejection', async () => {
    const environment = createEnvironment([
        'Accept or reject now. {% llmparse(\'accept_or_reject\') %}',
        'This instruction must never run. {% llm_dummy_action %}',
        'This final instruction must never run.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    let completionCount = 0;

    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        logPrompt(options) {
            return options.filePath || '/test/logs/rejected.log';
        },
        async complete({ messages }) {
            completionCount += 1;
            const aiResponse = '<rejected>Incomplete action.</rejected>';
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    const result = await runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName: 'program.njk'
    });

    assert.equal(completionCount, 1);
    assert.equal(result.aiResponse, '<rejected>Incomplete action.</rejected>');
    assert.equal(result.terminatedAtCheckpoint, 0);
    assert.equal(result.recordProgressOutput, false);
});

test('tiny-brain llmresult composes a terminal response without another completion', async () => {
    const environment = createEnvironment([
        'Choose now. {% llmparse(\'yes_no\') as approved %}',
        '{% if approved %}Write prose. {% llmparse(\'required_text\') as prose %}{% endif %}',
        '{% llmresult(\'test_result\') %}'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState, stableValue: 'stable' };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const logCalls = [];
    let completionCount = 0;
    let builderCall = null;

    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        parsers: {
            required_text(response) {
                return { value: response.trim() };
            }
        },
        resultBuilders: {
            test_result(input) {
                builderCall = input;
                return `<local>${input.assignments.prose}</local>`;
            }
        },
        logPrompt(options) {
            logCalls.push(options);
            return options.filePath || '/test/logs/composed.log';
        },
        async complete({ messages, checkpoint }) {
            completionCount += 1;
            const aiResponse = checkpoint.parserName === 'yes_no' ? 'Yes.' : 'Locally composed prose.';
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    const result = await runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName: 'program.njk'
    });

    assert.equal(completionCount, 2);
    assert.equal(result.aiResponse, '<local>Locally composed prose.</local>');
    assert.deepEqual({ ...builderCall.assignments }, {
        approved: true,
        prose: 'Locally composed prose.'
    });
    assert.equal(builderCall.templateContext.stableValue, 'stable');
    assert.ok(Object.isFrozen(builderCall.assignments));
    assert.ok(logCalls.some(call => (
        call.sections?.[0]?.title === 'Tiny-brain assembled final response'
        && call.sections[0].content === '<local>Locally composed prose.</local>'
    )));
});

test('tiny-brain llmresult rejects missing builders and trailing prompt text', async () => {
    for (const [program, expectedError] of [
        [
            'Answer. {% llmparse(\'yes_no\') as answer %}{% llmresult(\'missing\') %}',
            /No tiny-brain result builder is registered/
        ],
        [
            'Answer. {% llmparse(\'yes_no\') as answer %}{% llmresult(\'known\') %} extra',
            /must be the only content/
        ]
    ]) {
        const environment = createEnvironment(program);
        const renderState = TinyBrainPromptRunner.createRenderState();
        const templateContext = { __tinyBrainState: renderState };
        const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 0,
            resultBuilders: { known: () => 'known' },
            logPrompt(options) {
                return options.filePath || '/test/logs/invalid-result.log';
            },
            async complete({ messages }) {
                return {
                    aiResponse: 'Yes.',
                    conversationMessages: [...messages, { role: 'assistant', content: 'Yes.' }],
                    toolInvocations: []
                };
            }
        });
        await assert.rejects(
            runner.run({
                initialRenderedTemplate,
                templateContext,
                renderState,
                programTemplateName: 'program.njk'
            }),
            expectedError
        );
    }
});

test('tiny-brain runner warns and continues when prompt log appends fail', { concurrency: false }, async () => {
    const environment = createEnvironment([
        'Check the scene. {% llm_dummy_action %}',
        'Write the final response.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const logFilePath = '/test/logs/nonfatal-append.log';
    const warnings = [];
    const originalWarn = console.warn;
    let appendCount = 0;
    let completionCount = 0;

    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 0,
            logPrompt(options) {
                if (!options.append) {
                    return logFilePath;
                }
                appendCount += 1;
                if (appendCount === 1) {
                    throw new Error('simulated append exception');
                }
                return null;
            },
            async complete({ messages, isFinal }) {
                completionCount += 1;
                const aiResponse = isFinal ? 'Finished response.' : 'Checkpoint response.';
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
        });

        const result = await runner.run({
            initialRenderedTemplate,
            templateContext,
            renderState,
            programTemplateName: 'program.njk'
        });

        assert.equal(result.aiResponse, 'Finished response.');
        assert.equal(completionCount, 2);
        assert.equal(appendCount, 3);
        assert.equal(warnings.length, 3);
        assert.ok(warnings.every(warning => /running turn will continue/i.test(warning)));
        assert.match(warnings[0], /simulated append exception/);
        assert.ok(warnings.every(warning => warning.includes(logFilePath)));
    } finally {
        console.warn = originalWarn;
    }
});

test('tiny-brain runner owns one reusable progress group and aggregate-average lifecycle', { concurrency: false }, async () => {
    const environment = createEnvironment('Write the final response.');
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const originalWithQueueReservation = LLMClient.withPromptQueueReservation;
    const originalWithTinyBrainToolSchema = LLMClient.withTinyBrainToolSchema;
    const originalWithProgressGroup = LLMClient.withPromptProgressGroup;
    const originalClearProgressGroup = LLMClient.clearPromptProgressGroup;
    const queueReservation = Object.freeze({ test: 'future-tinybrain-reservation' });
    const progressGroups = [];
    const clearedGroups = [];
    let completionReservation = null;

    LLMClient.withPromptQueueReservation = async (callback) => callback(queueReservation);
    LLMClient.withTinyBrainToolSchema = async (_options, callback) => callback();
    LLMClient.withPromptProgressGroup = async (options, callback) => {
        progressGroups.push(options);
        return await callback();
    };
    LLMClient.clearPromptProgressGroup = (progressGroupId, options) => {
        clearedGroups.push({ progressGroupId, options });
    };

    try {
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 0,
            metadataLabel: 'future_prompt',
            logPrefix: 'future_tinybrain',
            logPrompt(options) {
                return options.filePath || '/test/logs/future-tinybrain.log';
            },
            async complete({ messages, queueReservation: activeReservation }) {
                completionReservation = activeReservation;
                const aiResponse = 'Finished future prompt.';
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
        });

        const result = await runner.run({
            initialRenderedTemplate,
            templateContext,
            renderState,
            programTemplateName: 'program.njk'
        });

        assert.equal(result.recordProgressOutput, true);
        assert.equal(completionReservation, queueReservation);
        assert.deepEqual(progressGroups, [{
            progressGroupId: renderState.runId,
            progressGroupTargetLabel: 'future_prompt_tinybrain'
        }]);
        assert.deepEqual(clearedGroups, [{
            progressGroupId: renderState.runId,
            options: { recordOutputCharacters: true }
        }]);
    } finally {
        LLMClient.withPromptQueueReservation = originalWithQueueReservation;
        LLMClient.withTinyBrainToolSchema = originalWithTinyBrainToolSchema;
        LLMClient.withPromptProgressGroup = originalWithProgressGroup;
        LLMClient.clearPromptProgressGroup = originalClearProgressGroup;
    }
});

test('tiny-brain continuation state appends sequential programs to one transcript and prompt log', async () => {
    const environment = createEnvironment(
        'Review the {{ sectionLabel }} section. {% llm_dummy_action %}{% llmresult(\'test_result\') %}'
    );
    const continuationState = createTinyBrainContinuationState();
    const logFilePath = '/test/logs/sequential-tinybrain.log';
    const completionCalls = [];
    const logCalls = [];

    const runSection = async (sectionLabel) => {
        const renderState = TinyBrainPromptRunner.createRenderState();
        const templateContext = { __tinyBrainState: renderState, sectionLabel };
        const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 0,
            resultBuilders: {
                test_result: () => `<result>${sectionLabel}</result>`
            },
            logPrompt(options) {
                logCalls.push(options);
                return options.filePath || logFilePath;
            },
            async complete({ messages }) {
                completionCalls.push({
                    sectionLabel,
                    messages: messages.map(message => ({ ...message }))
                });
                const aiResponse = `Accepted ${sectionLabel}.`;
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
        });
        return runner.run({
            initialRenderedTemplate,
            templateContext,
            renderState,
            programTemplateName: 'program.njk',
            continuationState
        });
    };

    const originResult = await runSection('origin');
    const destinationResult = await runSection('destination');

    assert.equal(originResult.aiResponse, '<result>origin</result>');
    assert.equal(destinationResult.aiResponse, '<result>destination</result>');
    assert.equal(completionCalls.length, 2);
    assert.ok(completionCalls[1].messages.some(message => (
        message.role === 'assistant' && message.content === 'Accepted origin.'
    )));
    assert.match(completionCalls[1].messages.at(-1).content, /Review the destination section/);
    assert.equal(
        completionCalls[1].messages.filter(message => (
            message.role === 'user' && message.content.includes('Fixed base context.')
        )).length,
        2
    );
    assert.equal(continuationState.logFilePath, logFilePath);
    assert.equal(logCalls.filter(call => !call.append).length, 1);
    assert.ok(logCalls.slice(1).every(call => call.filePath === logFilePath));
    assert.equal(continuationState.conversationMessages.at(-1).content, 'Accepted destination.');
});

test('tiny-brain short-response parsers normalize N/A and yes/no answers', () => {
    for (const response of [
        'N/A',
        'n.a.',
        'not applicable',
        'None identified.',
        'No issues found.',
        'N/A - no revision is needed.',
        'No revision is needed: n/a',
        'NA because the draft is already clear.',
        'The draft is already clear — n.a.'
    ]) {
        assert.equal(parseResponseOrNa(response).value, false, response);
    }
    assert.equal(parseResponseOrNa('The draft reveals the outcome before the player can act.').value, true);
    assert.equal(parseResponseOrNa('Narrative continuity needs work.').value, true);
    assert.equal(parseResponseOrNa('The banana example is substantive.').value, true);
    assert.throws(() => parseResponseOrNa('   '), /non-whitespace/i);

    assert.equal(parseYesNo('Yes.').value, true);
    assert.equal(parseYesNo('Answer: no, the player remains here.').value, false);
    assert.throws(() => parseYesNo('Maybe.'), /begin with yes or no/i);
});

test('real tiny-brain player-action template renders conditional parser branches in sequence', async () => {
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    addPlayerActionDestinationGlobals(promptEnv);
    promptEnv.addGlobal('resolvePlayerActionDestinationPreviewContext', () => ({ resolved: false }));

    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = {
        __tinyBrainState: renderState,
        techniqueSelectionInstructions: require('../TechniqueSelectionContext.js').getTechniqueSelectionInstructions(),
        actionText: 'Walk through the archway.',
        characterName: 'Tester',
        config: {
            prose_instructions: 'Write clear prose.',
            prose_length: 'three paragraphs',
            prose_prompt_suffix: '',
            repetition_buster: true,
            use_legacy_prompt_checks: false
        },
        currentLocationLastSeenNpcs: [],
        currentVehicle: null,
        isAttack: false,
        modPlayerActionPromptSteps: () => [],
        npcs: [],
        party: [],
        playerActionAccompanyingCharacters: [{ name: 'Mira Vale', aliases: ['Mira'] }],
        playerActionHiddenContestContext: makeHiddenContestContext(),
        setting: {
            writingStyleNotes: 'Keep it concrete.'
        }
    };
    const programTemplateName = '_includes/player-action.tinybrain.njk';
    const renderedProgram = promptEnv.render(programTemplateName, templateContext);
    const initialRenderedTemplate = [
        '<template>',
        '<systemPrompt><![CDATA[Test system prompt.]]></systemPrompt>',
        '<generationPrompt><![CDATA[Fixed base context.',
        renderState.programStartMarker,
        renderedProgram,
        ']]></generationPrompt>',
        '</template>'
    ].join('');
    const completionPrompts = [];
    const completionCheckpoints = [];
    let proseCount = 0;
    let finalCompletionCount = 0;

    const runner = new TinyBrainPromptRunner({
        promptEnv,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        parsers: { player_action_resolution_plan: parsePlayerActionResolutionPlan, technique_selection: response => require('../TechniqueSelectionContext.js').parseTechniqueSelections(response, { actors: [] }) },
        resultBuilders: {
            player_action_result: buildPlayerActionTinyBrainResult
        },
        logPrompt(options) {
            return options.filePath || '/test/logs/real-template.log';
        },
        async complete({ messages, checkpoint, isFinal }) {
            completionPrompts.push(messages.at(-1).content);
            completionCheckpoints.push(checkpoint);
            if (isFinal) {
                finalCompletionCount += 1;
            }
            let aiResponse = 'Done.';
            if (checkpoint.parserName === 'technique_selection') {
                aiResponse = '<techniqueSelections/>';
            } else if (checkpoint.parserName === 'player_action_resolution_plan') {
                aiResponse = '<resolutionPlan/>';
            } else if (checkpoint.parserName === 'player_action_hidden_contests') {
                aiResponse = '<hiddenContests/>';
            } else if (checkpoint.parserName === 'accept_or_reject') {
                aiResponse = '<accepted></accepted>';
            } else if (checkpoint.parserName === 'player_action_explicit_duration') {
                aiResponse = 'NONE';
            } else if (checkpoint.parserName === 'player_action_destination_name_or_na') {
                aiResponse = 'Beyond the Archway';
            } else if (checkpoint.parserName === 'player_action_movement') {
                aiResponse = 'DESTINATION';
            } else if (checkpoint.parserName === 'player_action_destination_decision') {
                aiResponse = '<playerDestination><decision>travel</decision><location>Beyond the Archway</location></playerDestination>';
            } else if (checkpoint.parserName === 'player_action_duration') {
                aiResponse = '1 minute';
            } else if (checkpoint.parserName === 'player_action_accompanying_characters') {
                aiResponse = 'Mira';
            } else if (checkpoint.parserName === 'player_action_prose_scope') {
                aiResponse = 'ORIGIN, DESTINATION';
            } else if (checkpoint.parserName === 'player_action_required_prose') {
                proseCount += 1;
                aiResponse = proseCount === 1
                    ? 'Tester steps beneath the arch.'
                    : 'Tester emerges beyond it.';
            } else if (checkpoint.parserName === 'player_action_hidden_notes') {
                aiResponse = 'N/A';
            }
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    const result = await runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName
    });

    assert.equal(finalCompletionCount, 0);
    assert.equal(proseCount, 2);
    assert.equal(
        completionCheckpoints.filter(checkpoint => (
            checkpoint.parserName === 'player_action_destination_name_or_na'
        )).length,
        1
    );
    assert.ok(!completionPrompts.some(prompt => /The destination name resolves to this existing game location/i.test(prompt)));
    const editingAuditQuestionPatterns = [
        /1\. Railroading\./,
        /2\. Did any character say anything superfluous/,
        /3\. List any instances where a character says basically the same thing/,
        /4\. Trust the reader\./,
        /5\. Is the plot \(conversation, etc\) going in two directions at once/,
        /6\. Characters are NOT OMNIECNENT\./,
        /7\. Look at each one of your answers to the previous question/,
        /8\. Did you use any tropes you're not supposed to use/,
        /9\. Did you create any "mystery boxes"/
    ];
    const editingAuditCheckpointIndexes = editingAuditQuestionPatterns.map(pattern => {
        const matchingIndexes = completionPrompts
            .map((prompt, index) => pattern.test(prompt) ? index : -1)
            .filter(index => index >= 0);
        assert.equal(matchingIndexes.length, 1, `expected one checkpoint for ${pattern}`);
        return matchingIndexes[0];
    });
    assert.equal(new Set(editingAuditCheckpointIndexes).size, 9);
    for (const checkpointIndex of editingAuditCheckpointIndexes) {
        assert.equal(completionCheckpoints[checkpointIndex].kind, 'dummy');
    }
    assert.ok(completionPrompts.some(prompt => /Answer with exactly one keyword/i.test(prompt)));
    assert.ok(completionPrompts.some(prompt => (
        /An earlier checkpoint selected this destination from the player's action/i.test(prompt)
        && /Destination location: Beyond the Archway/i.test(prompt)
        && /Answer NONE only if the prose was revised so the player no longer travels/i.test(prompt)
        && /landmark, building, shelter, or other descriptive wording/i.test(prompt)
        && /NONE: the second draft was revised so the already-selected travel no longer happens/i.test(prompt)
    )));
    assert.ok(completionPrompts.some(prompt => /<playerDestination><decision>travel<\/decision>/i.test(prompt)));
    assert.ok(completionPrompts.some(prompt => /Mira Vale/.test(prompt) && /accompany the player/i.test(prompt)));
    assert.equal(
        completionCheckpoints.filter(checkpoint => checkpoint.parserName === 'player_action_resolution_plan').length,
        3,
        'the initial draft and both later drafts receive a combined resolution plan'
    );
    const resolutionIndexes = completionCheckpoints.map((checkpoint, index) => checkpoint.parserName === 'player_action_resolution_plan' ? index : -1).filter(index => index >= 0);
    assert.equal(completionCheckpoints.filter(checkpoint => checkpoint.parserName === 'technique_selection').length, 3);
    for (const index of resolutionIndexes) assert.equal(completionCheckpoints[index - 1].parserName, 'technique_selection');
    assert.ok(completionPrompts.some(prompt => (
        /Return one <resolutionPlan>/i.test(prompt)
        && /ordered mixture of <check>, <attack>, and <technique>/i.test(prompt)
        && /trivially easy actions need no check/i.test(prompt)
    )));
    assert.ok(!completionPrompts.some(prompt => (
        /Each resolveAttack result authorizes exactly one resolved attack action/i.test(prompt)
        || /A second approach, lunge, charge, strike, bite, shot, impact, graze, or miss/i.test(prompt)
        || /delete its complete sentences or paragraph wholesale/i.test(prompt)
    )));
    assert.ok(completionPrompts.some(prompt => (
        /Player agency boundary: Narrate only player speech, decisions, agreements, gestures, and actions/i.test(prompt)
        && /explicitly committed in the <playerAction>/i.test(prompt)
    )));
    assert.ok(completionPrompts.some(prompt => /Audit the draft against the Player agency boundary above/i.test(prompt)));
    assert.ok(!completionPrompts.some(prompt => /Remove any player response, agreement, gesture, decision, or follow-up action/i.test(prompt)));
    assert.ok(!completionPrompts.some(prompt => /inside the moveTurnResult tags/i.test(prompt)));
    assert.match(result.aiResponse, /<moveTurnResult>/);
    assert.match(result.aiResponse, /<location>Beyond the Archway<\/location>/);
    assert.match(result.aiResponse, /<accompanyingCharacters>[\s\S]*<name>Mira Vale<\/name>/);
    assert.match(result.aiResponse, /<originProse>/);
    assert.match(result.aiResponse, /<destinationProse>/);
});

test('real TinyBrain player-action resolves revisit context and skips a programmatic duration question', async t => {
    const Region = require('../Region.js');
    const Location = require('../Location.js');
    Region.clear(); Location.clear();
    t.after(() => { Location.clear(); Region.clear(); });
    new Region({ id: 'old-town', name: 'Old Town', description: 'An old district.' });
    new Location({ id: 'market-gate', name: 'Market Gate', description: 'A market gate.', regionId: 'old-town' });
    new Location({ id: 'town-square', name: 'Town Square', description: 'A town square.', regionId: 'old-town' });
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    addPlayerActionDestinationGlobals(promptEnv);
    const destinationContextResolver = () => ({
        resolved: true,
        locationId: 'town-square',
        locationName: 'Town Square',
        regionId: 'old-town',
        regionName: 'Old Town',
        shortDescription: 'The old town gathering place.',
        description: 'An old fountain stands at the center of the busy square.',
        visitedBefore: true,
        lastVisitedTime: 120,
        minutesSinceLastVisitAtPrompt: 60,
        presentNpcNames: ['Ada', 'Merek'],
        exitSummaries: [{
            direction: 'west',
            destinationName: 'Market Gate',
            destinationRegionName: 'Old Town',
            description: 'A cobbled lane passes beneath the market arch.',
            travelTimeMinutes: 15
        }],
        travelTimeMinutes: 15,
        travelDuration: { text: '15 minutes', minutes: 15 }
    });
    promptEnv.addGlobal('resolvePlayerActionDestinationContext', destinationContextResolver);
    promptEnv.addGlobal('resolvePlayerActionDestinationPreviewContext', destinationContextResolver);

    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = {
        __tinyBrainState: renderState,
        techniqueSelectionInstructions: require('../TechniqueSelectionContext.js').getTechniqueSelectionInstructions(),
        actionText: 'Walk back to the Town Square.',
        characterName: 'Tester',
        config: {
            prose_instructions: 'Write clear prose.',
            prose_length: 'three paragraphs',
            prose_prompt_suffix: '',
            repetition_buster: true,
            use_legacy_prompt_checks: false
        },
        currentLocationLastSeenNpcs: [],
        currentPlayer: { name: 'Rowan' },
        currentVehicle: null,
        isAttack: false,
        isExterior: false,
        modPlayerActionPromptSteps: () => [],
        npcs: [],
        party: [],
        playerActionAccompanyingCharacters: [],
        playerActionHiddenContestContext: makeHiddenContestContext('Rowan'),
        playerActionDestinationContextResolver: destinationContextResolver,
        playerActionOriginLocationId: 'market-gate',
        playerActionWorldTimeMinutes: 180,
        setting: { writingStyleNotes: 'Keep it concrete.' }
    };
    const renderedProgram = promptEnv.render('_includes/player-action.tinybrain.njk', templateContext);
    const initialRenderedTemplate = [
        '<template>',
        '<systemPrompt><![CDATA[Test system prompt.]]></systemPrompt>',
        '<generationPrompt><![CDATA[Fixed base context.',
        renderState.programStartMarker,
        renderedProgram,
        ']]></generationPrompt>',
        '</template>'
    ].join('');
    const prompts = [];
    const parserNames = [];
    const runner = new TinyBrainPromptRunner({
        promptEnv,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 1,
        parsers: { player_action_resolution_plan: parsePlayerActionResolutionPlan, technique_selection: response => require('../TechniqueSelectionContext.js').parseTechniqueSelections(response, { actors: [] }) },
        resultBuilders: { player_action_result: buildPlayerActionTinyBrainResult },
        logPrompt(options) {
            return options.filePath || '/test/logs/revisit-destination.log';
        },
        async complete({ messages, checkpoint, attempt }) {
            prompts.push(messages.at(-1).content);
            parserNames.push(checkpoint.parserName);
            let aiResponse = 'Done.';
            if (checkpoint.parserName === 'technique_selection') {
                aiResponse = '<techniqueSelections/>';
            } else if (checkpoint.parserName === 'player_action_resolution_plan') {
                aiResponse = '<resolutionPlan/>';
            } else if (checkpoint.parserName === 'player_action_hidden_contests') {
                aiResponse = '<hiddenContests/>';
            } else if (checkpoint.parserName === 'accept_or_reject') {
                aiResponse = '<accepted></accepted>';
            } else if (checkpoint.parserName === 'player_action_explicit_duration') {
                aiResponse = 'NONE';
            } else if (checkpoint.parserName === 'player_action_destination_name_or_na') {
                aiResponse = 'Town Square';
            } else if (checkpoint.parserName === 'player_action_movement') {
                aiResponse = 'DESTINATION';
            } else if (checkpoint.parserName === 'player_action_destination_decision') {
                aiResponse = attempt === 0
                    ? '<playerDestination><decision>travel</decision><location>market gate</location><region>OLD TOWN</region></playerDestination>'
                    : '<playerDestination><decision>travel</decision><location>Town Square</location><region>Old Town</region></playerDestination>';
                if (attempt === 1) assert.match(messages.at(-1).content, /current|already|same/i);
            } else if (checkpoint.parserName === 'player_action_accompanying_characters') {
                aiResponse = 'NONE';
            } else if (checkpoint.parserName === 'player_action_prose_scope') {
                aiResponse = 'DESTINATION';
            } else if (checkpoint.parserName === 'player_action_destination_changes') {
                aiResponse = '- The fountain is under repair.\n- Ada has opened a flower stall.';
            } else if (checkpoint.parserName === 'player_action_required_prose') {
                aiResponse = 'Rowan finds the old fountain under repair while Ada tends a new flower stall beside it.';
            } else if (checkpoint.parserName === 'player_action_hidden_notes') {
                aiResponse = 'N/A';
            }
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    const result = await runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName: '_includes/player-action.tinybrain.njk'
    });

    assert.ok(!parserNames.includes('player_action_duration'));
    assert.equal(parserNames.filter(name => name === 'player_action_destination_name_or_na').length, 1);
    assert.equal(parserNames.filter(name => name === 'player_action_destination_decision').length, 2);
    assert.equal(parserNames.filter(name => name === 'player_action_resolution_plan').length, 3, 'earlier resolution plans are not rerun');
    assert.equal(parserNames.filter(name => name === 'player_action_destination_changes').length, 1);
    assert.ok(prompts.some(prompt => (
        /Canonical description: An old fountain stands at the center/i.test(prompt)
        && /programmatically: 15 minutes/i.test(prompt)
    )));
    assert.ok(prompts.some(prompt => (
        /Short description: The old town gathering place/i.test(prompt)
        && /NPCs currently present: Ada, Merek/i.test(prompt)
        && /west: Market Gate \(Old Town\)/i.test(prompt)
    )));
    assert.ok(prompts.some(prompt => (
        /An earlier checkpoint selected this destination from the player's action/i.test(prompt)
        && /Destination: Town Square \(Old Town\)/i.test(prompt)
        && /Answer NONE only if the prose was revised so the player no longer travels/i.test(prompt)
    )));
    assert.ok(prompts.some(prompt => (
        /away from Town Square for 1 hour, 15 minutes/i.test(prompt)
        && /NPCs currently present: Ada, Merek/i.test(prompt)
    )));
    assert.ok(prompts.some(prompt => (
        /destination changes were already accepted/i.test(prompt)
        && /The fountain is under repair/i.test(prompt)
        && /Ada has opened a flower stall/i.test(prompt)
    )));
    assert.match(result.aiResponse, /<travelTime>15 minutes<\/travelTime>/);
    assert.match(result.aiResponse, /<location>Town Square<\/location>/);
});

test('real player-action template passes committed travel movement to terminal result assembly', async () => {
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    addPlayerActionDestinationGlobals(promptEnv);

    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = {
        __tinyBrainState: renderState,
        techniqueSelectionInstructions: require('../TechniqueSelectionContext.js').getTechniqueSelectionInstructions(),
        actionText: 'Walk down to the Stairwell.',
        characterName: 'Tester',
        config: {
            prose_instructions: 'Write clear prose.',
            prose_length: 'three paragraphs',
            prose_prompt_suffix: '',
            repetition_buster: true,
            use_legacy_prompt_checks: false
        },
        currentLocationLastSeenNpcs: [],
        currentVehicle: null,
        isAttack: false,
        isExterior: false,
        modPlayerActionPromptSteps: () => [],
        npcs: [],
        party: [],
        playerActionTravelDestination: {
            location: 'Stairwell',
            region: 'Herbal Alchemy Shop Interior',
            travelTimeMinutes: 1
        },
        playerActionTravelMovementKind: 'destination',
        playerActionAccompanyingCharacters: [],
        playerActionHiddenContestContext: makeHiddenContestContext(),
        playerActionWorldTimeMinutes: 0,
        setting: { writingStyleNotes: 'Keep it concrete.' }
    };
    const programTemplateName = '_includes/player-action.tinybrain.njk';
    const renderedProgram = promptEnv.render(programTemplateName, templateContext);
    const initialRenderedTemplate = [
        '<template>',
        '<systemPrompt><![CDATA[Test system prompt.]]></systemPrompt>',
        '<generationPrompt><![CDATA[Fixed base context.',
        renderState.programStartMarker,
        renderedProgram,
        ']]></generationPrompt>',
        '</template>'
    ].join('');
    const parserNames = [];
    let finalCompletionCount = 0;
    const runner = new TinyBrainPromptRunner({
        promptEnv,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        parsers: { player_action_resolution_plan: parsePlayerActionResolutionPlan, technique_selection: response => require('../TechniqueSelectionContext.js').parseTechniqueSelections(response, { actors: [] }) },
        resultBuilders: { player_action_result: buildPlayerActionTinyBrainResult },
        logPrompt(options) {
            return options.filePath || '/test/logs/committed-travel.log';
        },
        async complete({ messages, checkpoint, isFinal }) {
            parserNames.push(checkpoint.parserName);
            finalCompletionCount += isFinal ? 1 : 0;
            let aiResponse = 'Done.';
            if (checkpoint.parserName === 'technique_selection') {
                aiResponse = '<techniqueSelections/>';
            } else if (checkpoint.parserName === 'player_action_resolution_plan') {
                aiResponse = '<resolutionPlan/>';
            } else if (checkpoint.parserName === 'player_action_hidden_contests') {
                aiResponse = '<hiddenContests/>';
            } else if (checkpoint.parserName === 'accept_or_reject') {
                aiResponse = '<accepted></accepted>';
            } else if (checkpoint.parserName === 'player_action_explicit_duration') {
                aiResponse = 'NONE';
            } else if (checkpoint.parserName === 'player_action_accompanying_characters') {
                aiResponse = 'NONE';
            } else if (checkpoint.parserName === 'player_action_prose_scope') {
                aiResponse = 'DESTINATION';
            } else if (checkpoint.parserName === 'player_action_required_prose') {
                aiResponse = 'Tester descends into the Stairwell.';
            } else if (checkpoint.parserName === 'player_action_hidden_notes') {
                aiResponse = 'N/A';
            }
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    const result = await runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName
    });

    assert.equal(finalCompletionCount, 0);
    assert.ok(!parserNames.includes('player_action_movement'));
    assert.match(result.aiResponse, /<moveTurnResult>/);
    assert.match(result.aiResponse, /<location>Stairwell<\/location>/);
    assert.match(result.aiResponse, /<region>Herbal Alchemy Shop Interior<\/region>/);
    assert.match(result.aiResponse, /<travelTime>1 minute<\/travelTime>/);
    assert.match(result.aiResponse, /<destinationProse><!\[CDATA\[Tester descends into the Stairwell\.\]\]><\/destinationProse>/);
});

test('real player-action template preserves underway vehicle normal and redirect control flow', async () => {
    const runScenario = async ({ vehicleAnswer, expectedRoot, invalidFirstDestination = false }) => {
        const promptEnv = new nunjucks.Environment(
            new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
            { autoescape: false }
        );
        promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
        addPlayerActionDestinationGlobals(promptEnv);
        const renderState = TinyBrainPromptRunner.createRenderState();
        const templateContext = {
            __tinyBrainState: renderState,
        techniqueSelectionInstructions: require('../TechniqueSelectionContext.js').getTechniqueSelectionInstructions(),
            actionText: vehicleAnswer === 'UNCHANGED'
                ? 'Talk while the train keeps moving.'
                : 'Tell the conductor to divert to New Harbor.',
            characterName: 'Tester',
            config: {
                prose_instructions: 'Write clear prose.',
                prose_length: 'three paragraphs',
                prose_prompt_suffix: '',
                repetition_buster: true,
                use_legacy_prompt_checks: false
            },
            currentLocationLastSeenNpcs: [],
            currentVehicle: {
                destination: 'Old Port',
                name: 'Night Train',
                timeToDestination: '20 minutes',
                vehicleInfo: {
                    hasArrived: false,
                    isUnderway: true,
                    destinations: ['new-harbor-station']
                },
                allowedDestinations: [{
                    kind: 'location',
                    routeEntry: 'new-harbor-station',
                    locationId: 'new-harbor-station',
                    locationName: 'New Harbor Station',
                    regionName: 'New Harbor'
                }]
            },
            isAttack: false,
            modPlayerActionPromptSteps: () => [],
            npcs: [],
            party: [],
            playerActionTravelDestination: null,
            playerActionAccompanyingCharacters: [],
            playerActionHiddenContestContext: makeHiddenContestContext(),
            setting: { writingStyleNotes: 'Keep it concrete.' }
        };
        const renderedProgram = promptEnv.render('_includes/player-action.tinybrain.njk', templateContext);
        const initialRenderedTemplate = [
            '<template>',
            '<systemPrompt><![CDATA[Test system prompt.]]></systemPrompt>',
            '<generationPrompt><![CDATA[Fixed base context.',
            renderState.programStartMarker,
            renderedProgram,
            ']]></generationPrompt>',
            '</template>'
        ].join('');
        const prompts = [];
        let finalCompletionCount = 0;
        let vehicleDestinationAttempts = 0;
        const runner = new TinyBrainPromptRunner({
            promptEnv,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 1,
            parsers: { player_action_resolution_plan: parsePlayerActionResolutionPlan, technique_selection: response => require('../TechniqueSelectionContext.js').parseTechniqueSelections(response, { actors: [] }) },
            resultBuilders: { player_action_result: buildPlayerActionTinyBrainResult },
            logPrompt(options) {
                return options.filePath || `/test/logs/vehicle-${vehicleAnswer.toLowerCase()}.log`;
            },
            async complete({ messages, checkpoint, isFinal, attempt }) {
                prompts.push(messages.at(-1).content);
                finalCompletionCount += isFinal ? 1 : 0;
                let aiResponse = 'Done.';
                if (checkpoint.parserName === 'technique_selection') {
                aiResponse = '<techniqueSelections/>';
            } else if (checkpoint.parserName === 'player_action_resolution_plan') {
                    aiResponse = '<resolutionPlan/>';
                } else if (checkpoint.parserName === 'player_action_hidden_contests') {
                    aiResponse = '<hiddenContests/>';
                } else if (checkpoint.parserName === 'accept_or_reject') {
                    aiResponse = '<accepted></accepted>';
                } else if (checkpoint.parserName === 'player_action_explicit_duration') {
                    aiResponse = 'NONE';
                } else if (checkpoint.parserName === 'player_action_destination_name_or_na') {
                    aiResponse = 'N/A';
                } else if (checkpoint.parserName === 'player_action_movement') {
                    aiResponse = 'NONE';
                } else if (checkpoint.parserName === 'player_action_vehicle_decision') {
                    aiResponse = vehicleAnswer;
                } else if (checkpoint.parserName === 'player_action_vehicle_destination') {
                    vehicleDestinationAttempts += 1;
                    aiResponse = vehicleAnswer === 'REDIRECT' && invalidFirstDestination && attempt === 0
                        ? 'Location: Ember Hollow Village Square\nRegion: Ember Hollow'
                        : 'Location: New Harbor Station\nRegion: New Harbor';
                } else if (checkpoint.parserName === 'player_action_duration') {
                    aiResponse = vehicleAnswer === 'UNCHANGED' ? '3 minutes' : '30 minutes';
                } else if (checkpoint.parserName === 'player_action_time_passed_duration') {
                    aiResponse = '3 minutes';
                } else if (checkpoint.parserName === 'player_action_prose_scope') {
                    aiResponse = 'BETWEEN';
                } else if (checkpoint.parserName === 'player_action_required_prose') {
                    aiResponse = vehicleAnswer === 'UNCHANGED'
                        ? 'The conversation continues over the clatter of the rails.'
                        : 'The train changes tracks toward New Harbor.';
                } else if (checkpoint.parserName === 'player_action_hidden_notes') {
                    aiResponse = 'N/A';
                } else if (checkpoint.parserName === 'player_action_time_reasoning') {
                    aiResponse = 'A brief conversation passes during the ride.';
                }
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
        });
        const result = await runner.run({
            initialRenderedTemplate,
            templateContext,
            renderState,
            programTemplateName: '_includes/player-action.tinybrain.njk'
        });
        assert.equal(finalCompletionCount, 0);
        assert.match(result.aiResponse, new RegExp(`<${expectedRoot}>`));
        assert.ok(prompts.some(prompt => /Night Train/.test(prompt) && /20 minutes/.test(prompt)));
        assert.ok(prompts.some(prompt => (
            /A vehicle moving or reaching its scheduled destination is not player movement/i.test(prompt)
            && /answer NONE even when the vehicle arrives/i.test(prompt)
            && /Do not turn an unauthorized draft disembarkation into game state/i.test(prompt)
        )));
        assert.ok(prompts.some(prompt => /Ordinary riding, waiting, or talking aboard is UNCHANGED/i.test(prompt)));
        assert.ok(prompts.some(prompt => /mechanical outcome that actually occurs in the second draft/i.test(prompt)));
        assert.ok(prompts.some(prompt => /conditional offer or request still awaiting approval is UNCHANGED/i.test(prompt)));
        return { result, prompts, vehicleDestinationAttempts };
    };

    const unchanged = await runScenario({ vehicleAnswer: 'UNCHANGED', expectedRoot: 'turnResult' });
    assert.doesNotMatch(unchanged.result.aiResponse, /<vehicleInfo>/);

    const redirect = await runScenario({ vehicleAnswer: 'REDIRECT', expectedRoot: 'moveTurnResult' });
    assert.match(redirect.result.aiResponse, /<name>Night Train<\/name>/);
    assert.match(redirect.result.aiResponse, /<vehicleDestination>/);
    assert.doesNotMatch(redirect.result.aiResponse, /<playerDestination>/);
    assert.equal(redirect.vehicleDestinationAttempts, 1);

    await assert.rejects(
        () => runScenario({
            vehicleAnswer: 'REDIRECT',
            expectedRoot: 'moveTurnResult',
            invalidFirstDestination: true
        }),
        /failed to parse after 2 attempts.*may not replace the initially extracted destination/is
    );
});

test('runner scopes XML checkpoint roots, plain checkpoints, custom contracts and final output', async () => {
    const program = [
        "Revision? {% llmparse('revision_decision') as revision %}",
        "Prose? {% llmparse('player_action_required_prose') as prose %}",
        "Custom? {% llmparse('custom_xml') as custom %}",
        "Accept? {% llmparse('accept_or_reject') as accepted %}",
        "Travel? {% llmparse('player_is_traveling') as travel %}",
        'Write the final result.'
    ].join(' ');
    const environment = createEnvironment(program);
    const state = TinyBrainPromptRunner.createRenderState();
    const context = { __tinyBrainState: state };
    const initial = environment.render('wrapper.xml.njk', context);
    const scopes = [];
    const original = LLMClient.withXmlOutputScope;
    LLMClient.withXmlOutputScope = (options, callback) => { scopes.push(options); return original.call(LLMClient, options, callback); };
    try {
        const answers = ['<revisionDecision><revise>no</revise></revisionDecision>', 'A quiet moment.', '<custom/>', '<accepted></accepted>', '<travel>no</travel>', '<turnResult/>'];
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment, parseXMLTemplate: parseTemplate, retryAttempts: 0,
            parsers: { custom_xml: response => ({ value: response }) },
            parserOutputContracts: { custom_xml: { expectedXmlRootTag: 'custom' } },
            finalOutputContract: { expectedXmlRootTags: ['turnResult', 'moveTurnResult'] },
            finalParser: response => ({ value: response }),
            logPrompt: options => options.filePath || '/test/logs/root-scope.log',
            complete: async ({ messages }) => {
                const aiResponse = answers.shift();
                return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
            }
        });
        await runner.run({ initialRenderedTemplate: initial, templateContext: context, renderState: state, programTemplateName: 'program.njk' });
        assert.deepEqual(scopes.map(({ xmlOutput, expectedXmlRootTags }) => ({ xmlOutput, ...(expectedXmlRootTags ? { expectedXmlRootTags } : {}) })), [
            { xmlOutput: true, expectedXmlRootTags: ['revisionDecision'] }, { xmlOutput: false },
            { xmlOutput: true, expectedXmlRootTags: ['custom'] },
            { xmlOutput: true, expectedXmlRootTags: ['accepted', 'rejected'] },
            { xmlOutput: true, expectedXmlRootTags: ['travel'] },
            { xmlOutput: true, expectedXmlRootTags: ['turnResult', 'moveTurnResult'] }
        ]);
    } finally { LLMClient.withXmlOutputScope = original; }
});

for (const scenario of [
    { competingModel: 'same', outcome: 'success' },
    { competingModel: 'different', outcome: 'success' },
    { competingModel: 'different', outcome: 'success', background: true },
    { competingModel: 'different', outcome: 'failure' },
    { competingModel: 'different', outcome: 'cancellation' }
]) {
const { competingModel, outcome, background = false } = scenario;
test(`TinyBrain nested family ${outcome} preserves queue ownership with a ${competingModel}-model contender (background=${background})`, { concurrency: false }, async () => {
    const ItemReuseService = require('../ItemReuseService.js');
    const environment = createEnvironment("Plan. {% llmparse('item_plan') as plan %} Continue. {% llmparse('followup') as next %}{% llmresult('capture') %}");
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const old = { post: axios.post, log: LLMClient.logPrompt, config: Globals.config };
    const calls = [];
    const abort = new AbortController();
    const nestedAbort = new AbortController();
    const deadline = setTimeout(() => abort.abort(new Error('Nested prompt timed out waiting for its parent reservation')), 5000);
    Globals.config = { ...buildTinyBrainProviderConfig(), max_concurrent_requests_all_models: 1 };
    Globals.config.ai.xml_closing_tag_guard = false;
    LLMClient.logPrompt = options => options.filePath || '/test/logs/tinybrain-nested-reservation.log';
    axios.post = async (_endpoint, payload) => {
        const user = payload.messages.filter(message => message.role === 'user').at(-1).content;
        const kind = user.includes('unrelated request') ? 'unrelated' : user.includes('family correction') ? 'family-retry' : user.includes('family request') ? 'family' : user.includes('Continue.') ? 'followup' : 'plan';
        calls.push(kind);
        if (kind === 'family' && outcome === 'cancellation') {
            const error = new Error('Nested family cancellation');
            error.code = 'PROMPT_CANCELLED';
            nestedAbort.abort(error);
            throw error;
        }
        const responses = { plan: 'PLAN', family: 'MALFORMED', 'family-retry': 'NONREUSABLE', followup: 'FOLLOWUP', unrelated: 'UNRELATED' };
        return completionResponse({ content: responses[kind] });
    };
    const catalogue = { generation: 1, getFamiliesByName: () => [], getFamilies: () => [], validateFamilyCommit: () => {} };
    const service = new ItemReuseService({ catalogue, authorFamily: async () => {
        let response = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'family request' }], model: competingModel === 'same' ? Globals.config.ai.model : 'nested-model', metadataLabel: 'nested_family', runInBackground: background, validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true, signal: nestedAbort.signal });
        if (outcome === 'failure') {
            const error = new Error(`Nested family ${outcome}`);
            throw error;
        }
        if (response === 'MALFORMED') response = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'family correction' }], model: competingModel === 'same' ? Globals.config.ai.model : 'nested-model', metadataLabel: 'nested_family', runInBackground: background, validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true, signal: nestedAbort.signal });
        assert.equal(response, 'NONREUSABLE');
        return null;
    } });
    const session = service.createSession();
    let planParses = 0;
    let competingRequest;
    let signalPlanReady;
    let releasePlan;
    const planReady = new Promise(resolve => { signalPlanReady = resolve; });
    const planGate = new Promise(resolve => { releasePlan = resolve; });
    try {
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment, parseXMLTemplate: parseTemplate, retryAttempts: 0, metadataLabel: 'tinybrain_nested_reservation', toolDefinitions: [],
            logPrompt: options => options.filePath || '/test/logs/tinybrain-nested-reservation.log',
            parsers: {
                async item_plan(response, context) {
                    planParses++;
                    assert.equal(response, 'PLAN');
                    signalPlanReady();
                    await planGate;
                    await session.resolve({ name: 'Test item', withNestedPrompt: context.withNestedPrompt });
                    return { value: 'approved' };
                },
                followup(response) { assert.equal(response, 'FOLLOWUP'); return { value: 'done' }; }
            },
            resultBuilders: { capture: ({ assignments }) => `${assignments.plan}/${assignments.next}` },
            async complete({ messages, queueReservation }) {
                const aiResponse = await LLMClient.chatCompletion({ messages, queueReservation, metadataLabel: 'tinybrain_nested_reservation', runInBackground: background, validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true, signal: abort.signal });
                return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
            }
        });
        const running = runner.run({ initialRenderedTemplate, templateContext, renderState, programTemplateName: 'program.njk' });
        await planReady;
        competingRequest = LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'unrelated request' }], model: competingModel === 'same' ? Globals.config.ai.model : 'nested-model', metadataLabel: 'unrelated', validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true, signal: abort.signal });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(calls, ['plan']);
        releasePlan();
        if (outcome === 'success') {
            const result = await running;
            assert.equal(result.aiResponse, 'approved/done');
        } else {
            await assert.rejects(running, new RegExp(`Nested family ${outcome}`));
        }
        await competingRequest;
        assert.equal(planParses, 1);
        assert.deepEqual(calls, outcome === 'success'
            ? ['plan', 'family', 'family-retry', 'followup', 'unrelated']
            : ['plan', 'family', 'unrelated']);
    } finally {
        clearTimeout(deadline);
        releasePlan?.();
        abort.abort();
        nestedAbort.abort();
        axios.post = old.post; LLMClient.logPrompt = old.log; Globals.config = old.config;
    }
});

}

test('technique selection checkpoints inject and retain only chosen authoritative XML across later plans', async () => {
    const { withTechniqueWorld, mechanics, addDefinition, learn } = require('./helpers/techniqueIntegrationFixtures.js');
    const { parseTechniqueSelections, renderSelectedTechniqueDetails } = require('../TechniqueSelectionContext.js');
    await withTechniqueWorld(async ({ player }) => {
        const revision = mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'A ward.', duration: 5, maxHealthPercent: 10 } }] });
        const selected = addDefinition('technique-runner-selected', revision, { name: 'Selected Ward', description: 'SELECTED_RUNNER_DETAIL' });
        const other = addDefinition('technique-runner-other', revision, { name: 'Other Ward', description: 'UNSELECTED_RUNNER_DETAIL' });
        learn(player, selected.id); learn(player, other.id);
        const environment = createEnvironment([
            "Select. {% llmparse('technique_selection') %}",
            "Plan. {% llmparse('test_plan') %}",
            "Select newly needed details. {% llmparse('technique_selection') %}",
            "Final plan. {% llmparse('test_plan') %}",
            "{% llmresult('test_result') %}"
        ].join(''));
        const renderState = TinyBrainPromptRunner.createRenderState();
        const templateContext = { __tinyBrainState: renderState };
        const messagesByCall = [];
        const answers = ['<techniqueSelections><selection><actor>bad actor</actor><technique>Selected Ward</technique></selection></techniqueSelections>', `<techniqueSelections><selection><actor>${player.id}</actor><technique>${selected.id}</technique></selection></techniqueSelections>`, '<resolutionPlan/>', '<techniqueSelections/>', '<resolutionPlan/>'];
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment, parseXMLTemplate: parseTemplate, retryAttempts: 1,
            parsers: { technique_selection: response => parseTechniqueSelections(response, { actors: [player] }), test_plan: response => ({ value: response }) },
            resultBuilders: { test_result: () => '<result/>' },
            logPrompt: options => options.filePath || '/test/logs/technique-selection.log',
            async afterParse({ parsed, checkpoint, messages }) {
                if (checkpoint.parserName !== 'technique_selection') return;
                const message = { role: 'user', content: renderSelectedTechniqueDetails(parsed.value, { actors: [player] }) };
                return { conversationMessages: [...messages, message], retainedMessages: [{ key: `technique-details-${checkpoint.index}`, message }] };
            },
            async complete({ messages }) {
                messagesByCall.push(messages.map(message => ({ ...message })));
                const aiResponse = answers.shift();
                return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
            }
        });
        await runner.run({ initialRenderedTemplate: environment.render('wrapper.xml.njk', templateContext), templateContext, renderState, programTemplateName: 'program.njk' });
        assert.equal(messagesByCall.length, 5);
        const planning = messagesByCall[2].map(message => message.content || '').join('\n');
        const laterPlanning = messagesByCall[4].map(message => message.content || '').join('\n');
        for (const text of [planning, laterPlanning]) {
            assert.match(text, /SELECTED_RUNNER_DETAIL/);
            assert.doesNotMatch(text, /UNSELECTED_RUNNER_DETAIL/);
            assert.match(text, /<selectedTechniqueDetails>/);
        }
        assert.match(messagesByCall[1].map(message => message.content || '').join('\n'), /not in the supplied scene/i);
    });
});

test('two TinyBrain runs can exchange models for nested prompts without deadlocking', { concurrency: false, timeout: 10000 }, async () => {
    const old = { post: axios.post, log: LLMClient.logPrompt, config: Globals.config };
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(new Error('Cross-model nested prompts timed out')), 5000);
    const calls = [];
    let readyCount = 0;
    let bothReady;
    const ready = new Promise(resolve => { bothReady = resolve; });
    Globals.config = { ...buildTinyBrainProviderConfig(), max_concurrent_requests_all_models: 2 };
    Globals.config.ai.xml_closing_tag_guard = false;
    LLMClient.logPrompt = options => options.filePath || '/test/logs/tinybrain-cross-model.log';
    axios.post = async (_endpoint, payload) => {
        const user = payload.messages.filter(message => message.role === 'user').at(-1).content;
        const kind = user.includes('nested A') ? 'nested A' : user.includes('nested B') ? 'nested B' : user.includes('Finish') ? 'finish' : 'plan';
        calls.push(`${payload.model}:${kind}`);
        return completionResponse({ content: kind });
    };
    const build = (model, nestedModel, nestedName) => {
        const environment = createEnvironment("Plan. {% llmparse('plan') as plan %} Finish. {% llmparse('finish') as done %}{% llmresult('capture') %}");
        const renderState = TinyBrainPromptRunner.createRenderState();
        const templateContext = { __tinyBrainState: renderState };
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment, parseXMLTemplate: parseTemplate, retryAttempts: 0, metadataLabel: `cross_${nestedName}`, toolDefinitions: [],
            logPrompt: options => options.filePath || '/test/logs/tinybrain-cross-model.log',
            parsers: {
                async plan(_response, context) {
                    if (++readyCount === 2) bothReady();
                    await ready;
                    const nested = await context.withNestedPrompt(() => LLMClient.chatCompletion({ messages: [{ role: 'user', content: `nested ${nestedName}` }], model: nestedModel, metadataLabel: `nested_${nestedName}`, validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true, signal: abort.signal }));
                    assert.equal(nested, `nested ${nestedName}`);
                    return { value: 'ok' };
                },
                finish() { return { value: 'done' }; }
            },
            resultBuilders: { capture: ({ assignments }) => `${assignments.plan}/${assignments.done}` },
            async complete({ messages, queueReservation }) {
                const aiResponse = await LLMClient.chatCompletion({ messages, model, queueReservation, metadataLabel: `cross_${nestedName}`, validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true, signal: abort.signal });
                return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
            }
        });
        return () => runner.run({ initialRenderedTemplate: environment.render('wrapper.xml.njk', templateContext), templateContext, renderState, programTemplateName: 'program.njk' });
    };
    try {
        const runA = build('cross-model-a', 'cross-model-b', 'A');
        const runB = build('cross-model-b', 'cross-model-a', 'B');
        const results = await Promise.all([runA(), runB()]);
        assert.deepEqual(results.map(result => result.aiResponse), ['ok/done', 'ok/done']);
        assert.equal(calls.filter(call => call.endsWith(':plan')).length, 2);
        assert.ok(calls.includes('cross-model-b:nested A'));
        assert.ok(calls.includes('cross-model-a:nested B'));
        assert.equal(calls.filter(call => call.endsWith(':finish')).length, 2);
    } finally {
        clearTimeout(deadline);
        abort.abort();
        LLMClient.logPrompt = old.log; axios.post = old.post; Globals.config = old.config;
    }
});

test('TinyBrain retries a failed nested parallel parse only after its sibling drains', { concurrency: false, timeout: 10000 }, async () => {
    const old = { post: axios.post, log: LLMClient.logPrompt, config: Globals.config };
    const environment = createEnvironment("Plan. {% llmparse('plan') as plan %} Continue. {% llmparse('finish') as done %}{% llmresult('capture') %}");
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const calls = [];
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(new Error('Nested parser retry timed out')), 5000);
    let failStarted, failRelease, siblingStarted, siblingRelease;
    const failReady = new Promise(resolve => { failStarted = resolve; });
    const failGate = new Promise(resolve => { failRelease = resolve; });
    const siblingReady = new Promise(resolve => { siblingStarted = resolve; });
    const siblingGate = new Promise(resolve => { siblingRelease = resolve; });
    let planParses = 0;
    Globals.config = { ...buildTinyBrainProviderConfig(), max_concurrent_requests_all_models: 1 };
    Globals.config.ai.xml_closing_tag_guard = false;
    LLMClient.logPrompt = options => options.filePath || '/test/logs/tinybrain-nested-retry.log';
    axios.post = async (_url, payload) => {
        const user = payload.messages.filter(message => message.role === 'user').at(-1).content;
        const label = user === 'fail child' || user === 'sibling child' || user === 'unrelated' ? user : user.includes('Continue.') ? 'followup' : 'plan';
        calls.push(label);
        if (label === 'fail child') { failStarted(); await failGate; throw new Error('Nested parse dependency failed'); }
        if (label === 'sibling child') { siblingStarted(); await siblingGate; }
        return completionResponse({ content: label === 'followup' ? 'FOLLOWUP' : label === 'plan' ? 'PLAN' : label });
    };
    const request = label => LLMClient.chatCompletion({ messages: [{ role: 'user', content: label }], metadataLabel: 'nested_retry_child', validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true, signal: abort.signal });
    try {
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment, parseXMLTemplate: parseTemplate, retryAttempts: 1, metadataLabel: 'nested_retry_parent', toolDefinitions: [],
            logPrompt: options => options.filePath || '/test/logs/tinybrain-nested-retry.log',
            parsers: {
                async plan(response, context) {
                    assert.equal(response, 'PLAN');
                    if (++planParses === 1) await context.withNestedPrompt(() => Promise.all([request('fail child'), request('sibling child')]));
                    return { value: 'approved' };
                },
                finish(response) { assert.equal(response, 'FOLLOWUP'); return { value: 'done' }; }
            },
            resultBuilders: { capture: ({ assignments }) => `${assignments.plan}/${assignments.done}` },
            async complete({ messages, queueReservation }) {
                const aiResponse = await LLMClient.chatCompletion({ messages, queueReservation, metadataLabel: 'nested_retry_parent', validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true, signal: abort.signal });
                return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
            }
        });
        const running = runner.run({ initialRenderedTemplate: environment.render('wrapper.xml.njk', templateContext), templateContext, renderState, programTemplateName: 'program.njk' });
        const outcome = running.then(result => ({ result }), error => ({ error }));
        await failReady;
        const outsider = request('unrelated');
        const outsiderOutcome = outsider.then(result => ({ result }), error => ({ error }));
        await new Promise(resolve => setImmediate(resolve));
        failRelease();
        await siblingReady;
        assert.deepEqual(calls, ['plan', 'fail child', 'sibling child']);
        siblingRelease();
        const finished = await outcome;
        if (finished.error) throw finished.error;
        assert.equal(finished.result.aiResponse, 'approved/done');
        const unrelated = await outsiderOutcome;
        if (unrelated.error) throw unrelated.error;
        assert.equal(unrelated.result, 'unrelated');
        assert.deepEqual(calls, ['plan', 'fail child', 'sibling child', 'plan', 'followup', 'unrelated']);
    } finally {
        failRelease?.(); siblingRelease?.(); clearTimeout(deadline); abort.abort();
        axios.post = old.post; LLMClient.logPrompt = old.log; Globals.config = old.config;
    }
});
