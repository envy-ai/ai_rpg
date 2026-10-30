const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function buildAiConfig() {
    return {
        backend: 'openai_compatible',
        endpoint: 'https://example.invalid/v1/chat/completions',
        apiKey: 'test-key',
        model: 'test-model',
        stream: false,
        retryAttempts: 0,
        max_concurrent_requests: 1,
        supress_seed: true,
        prefill: null
    };
}

async function capturePayload({
    metadataLabel,
    additionalPayload = {},
    messages,
    executionAllowedToolNames = null,
    preserveBaseContextToolDefinitions = false,
    queueReservation = null,
    config = null,
    nativeToolMutationsRequired = null
}) {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let capturedPayload = null;

    axios.post = async (_endpoint, payload) => {
        capturedPayload = JSON.parse(JSON.stringify(payload));
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'base-context-tools-test',
                object: 'chat.completion',
                created: 1,
                model: payload.model,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: {
                        role: 'assistant',
                        content: 'ok'
                    }
                }]
            }
        };
    };
    Globals.config = config || {
        ai: buildAiConfig(),
        chat_tools: {
            request_user_input_enabled: true
        }
    };

    try {
        const response = await LLMClient.chatCompletion({
            messages,
            metadataLabel,
            additionalPayload,
            executionAllowedToolNames,
            preserveBaseContextToolDefinitions,
            nativeToolMutationsRequired,
            queueReservation,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        });
        assert.equal(response, 'ok');
        return capturedPayload;
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
}

function buildBaseContextMessages(promptSpecific = 'Prompt-specific instructions.') {
    return [
        { role: 'system', content: 'Shared system prompt.' },
        {
            role: 'user',
            content: [
                'Stable base context.',
                LLMClient.getRecentStoryMessageBoundaryMarker(),
                'Recent story and current conditions.',
                LLMClient.getBaseContextEndMarker(),
                promptSpecific
            ].join('\n')
        }
    ];
}

test('mutating-prompts-only classifies declared native capabilities and validates option types', () => {
    const { isNativeToolExecutionEnabled } = require('../chat_tool_calls.js');
    const enabledConfig = { chat_tools: { mutating_prompts_only: true } };
    const disabledConfig = { chat_tools: { mutating_prompts_only: false } };

    assert.equal(isNativeToolExecutionEnabled({ config: enabledConfig, toolNames: ['moreInfo'] }), false);
    assert.equal(isNativeToolExecutionEnabled({ config: enabledConfig, toolNames: ['requestUserInput'] }), false,
        'requesting player input alone does not qualify as a state mutation');
    assert.equal(isNativeToolExecutionEnabled({ config: enabledConfig, toolNames: ['createLocationStub'] }), true);
    assert.equal(isNativeToolExecutionEnabled({ config: enabledConfig, toolNames: ['resolveSkillCheck'] }), true,
        'server-executed mechanics qualify as state-changing capabilities');
    assert.equal(isNativeToolExecutionEnabled({ config: enabledConfig, toolNames: ['updateMysteryThreadFields'] }), true);
    assert.equal(isNativeToolExecutionEnabled({
        config: enabledConfig,
        toolNames: ['readOnlyModTool'],
        modExtensionRegistry: { getChatToolRecord: () => ({ mutatesWorld: false }) }
    }), false);
    assert.equal(isNativeToolExecutionEnabled({
        config: enabledConfig,
        toolNames: ['mutatingModTool'],
        modExtensionRegistry: { getChatToolRecord: () => ({ mutatesWorld: true }) }
    }), true);
    assert.equal(isNativeToolExecutionEnabled({
        config: enabledConfig,
        toolNames: ['createLocationStub'],
        nativeToolMutationsRequired: false
    }), false, 'an explicit read-only prompt scope vetoes mutator-capable schemas');
    assert.equal(isNativeToolExecutionEnabled({ config: disabledConfig, toolNames: ['moreInfo'] }), true,
        'the default-off option leaves existing native lookup permissions unchanged');

    assert.throws(() => isNativeToolExecutionEnabled({
        config: { chat_tools: { mutating_prompts_only: 'true' } },
        toolNames: ['moreInfo']
    }), /chat_tools\.mutating_prompts_only must be a boolean/);
    assert.throws(() => isNativeToolExecutionEnabled({
        config: enabledConfig,
        toolNames: ['moreInfo'],
        nativeToolMutationsRequired: 'false'
    }), /nativeToolMutationsRequired must be a boolean or null/);
});

test('base-context caller subsets use the exact effective standard player-action wire schema', { concurrency: false }, async () => {
    const { getChatToolDefinitions } = require('../chat_tool_calls.js');
    const config = {
        ai: { ...buildAiConfig(), tinybrain: false, tinybrain_prompts: { player_action: false } },
        ai_model_overrides: {
            player_action_profile: { prompts: ['player_action'], model: 'override-model', tinybrain: true }
        },
        chat_tools: { request_user_input_enabled: true },
        use_legacy_prompt_checks: true,
        tinybrain_prompts: { player_action: false }
    };
    Globals.config = config;
    const playerActionTools = LLMClient.resolvePlayerActionToolDefinitions();
    const callerTools = getChatToolDefinitions({ allowTechniqueExecution: true })
        .filter(definition => ['moreInfo', 'resolveSkillCheck', 'useTechnique'].includes(definition.function.name));

    const standardPayload = await capturePayload({
        metadataLabel: 'player_action',
        messages: buildBaseContextMessages(),
        config,
        additionalPayload: { tools: playerActionTools, tool_choice: 'auto' }
    });
    const craftingPayload = await capturePayload({
        metadataLabel: 'crafting',
        messages: buildBaseContextMessages(),
        config,
        additionalPayload: { tools: callerTools, tool_choice: 'auto' }
    });
    const plausibilityPayload = await capturePayload({
        metadataLabel: 'plausibility_check',
        messages: buildBaseContextMessages(),
        config,
        additionalPayload: { tools: callerTools.filter(tool => tool.function.name === 'resolveSkillCheck'), tool_choice: 'auto' }
    });

    assert.equal(standardPayload.model, 'override-model');
    assert.deepEqual(craftingPayload.tools, callerTools);
    assert.deepEqual(plausibilityPayload.tools, callerTools.filter(tool => tool.function.name === 'resolveSkillCheck'));
    assert.equal(craftingPayload.tool_choice, standardPayload.tool_choice);
    assert.equal(plausibilityPayload.tool_choice, standardPayload.tool_choice);
    assert.ok(standardPayload.tools.some(tool => tool.function.name === 'useTechnique'));
    assert.ok(standardPayload.tools.some(tool => tool.function.name === 'resolveSkillCheck'),
        'standard player actions retain native check tools even with the global legacy flag');
    assert.equal(standardPayload.tool_choice, 'auto');
    assert.equal(craftingPayload.tool_choice, 'auto');
    assert.equal(plausibilityPayload.tool_choice, 'auto');
});

test('base-context callers expose only the tool definitions they can execute', { concurrency: false }, async () => {
    const config = { ai: buildAiConfig(), chat_tools: { request_user_input_enabled: true } };
    const baseline = await capturePayload({
        metadataLabel: 'player_action', messages: buildBaseContextMessages(), config,
        additionalPayload: { tools: LLMClient.resolvePlayerActionToolDefinitions(), tool_choice: 'auto' }
    });
    const emptyCaller = await capturePayload({
        metadataLabel: 'slop_remover', messages: buildBaseContextMessages(), config
    });
    const extra = { type: 'function', function: { name: 'callerSpecificTool', parameters: { type: 'object' } } };
    const largerCaller = await capturePayload({
        metadataLabel: 'slop_remover', messages: buildBaseContextMessages(), config,
        additionalPayload: { tools: [...baseline.tools, extra], tool_choice: 'auto' }
    });
    const changedDefinition = {
        ...baseline.tools[0],
        function: { ...baseline.tools[0].function, description: 'Caller-specific custom schema.' }
    };
    const sameNameCustom = await capturePayload({
        metadataLabel: 'slop_remover', messages: buildBaseContextMessages(), config,
        additionalPayload: { tools: [changedDefinition], tool_choice: 'auto' }
    });
    assert.equal(emptyCaller.tools, undefined);
    assert.equal(emptyCaller.tool_choice, 'none');
    assert.deepEqual(largerCaller.tools, [...baseline.tools, extra]);
    assert.deepEqual(sameNameCustom.tools, [changedDefinition],
        'a same-name tool with a different definition remains the caller schema');
});

test('custom provider tool definitions cannot extend the caller execution scope', { concurrency: false }, async () => {
    const injectedTool = {
        type: 'function',
        function: { name: 'injectedTool', parameters: { type: 'object', properties: {} } }
    };
    const config = {
        ai: { ...buildAiConfig(), custom_args: { tools: [injectedTool], tool_choice: 'auto' } },
        chat_tools: { mutating_prompts_only: true }
    };
    const noScope = await capturePayload({
        metadataLabel: 'npc_memory',
        messages: buildBaseContextMessages(),
        config
    });
    const injectedNameOnly = await capturePayload({
        metadataLabel: 'npc_memory',
        messages: buildBaseContextMessages(),
        config,
        executionAllowedToolNames: ['injectedTool']
    });

    for (const payload of [noScope, injectedNameOnly]) {
        assert.equal(payload.tools, undefined);
        assert.equal(payload.tool_choice, 'none');
        assert.equal(payload.messages.some(message => (
            message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
        )), false);
        assert.equal(payload.messages.some(message => /Do not make native function tool calls\./.test(String(message.content))), false);
    }
    const callerInstruction = 'User-authored instruction: do not make native function tool calls.';
    const callerInstructionPayload = await capturePayload({
        metadataLabel: 'npc_memory',
        messages: buildBaseContextMessages(callerInstruction),
        config
    });
    assert.ok(callerInstructionPayload.messages.some(message => String(message.content).includes(callerInstruction)),
        'user-authored prompt instructions remain intact');
});

test('TinyBrain schema without original tool definitions exposes no shared base tools', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const config = { ai: buildAiConfig(), chat_tools: { mutating_prompts_only: true } };
    Globals.config = config;
    try {
        const payload = await LLMClient.withPromptQueueReservation(async queueReservation => (
            LLMClient.withTinyBrainToolSchema({
                metadataLabel: 'tinybrain_empty_original_scope',
                queueReservation,
                shareBaseContextTools: false
            }, async () => {
                const state = LLMClient.getTinyBrainToolExecutionState({
                    metadataLabel: 'tinybrain_empty_original_scope',
                    queueReservation,
                    maxToolCalls: 1
                });
                assert.deepEqual(state.executionToolNames, []);
                return capturePayload({
                    metadataLabel: 'tinybrain_empty_original_scope',
                    queueReservation,
                    messages: buildBaseContextMessages('User-authored instruction: do not make native function tool calls.'),
                    config,
                    additionalPayload: { tool_choice: 'auto' }
                });
            })
        ));
        assert.equal(payload.tools, undefined);
        assert.equal(payload.tool_choice, 'none');
        assert.equal(payload.messages.some(message => (
            message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
        )), false);
        assert.equal(payload.messages.some(message => /Do not make native function tool calls\./.test(String(message.content))), false);
        assert.ok(payload.messages.some(message => String(message.content).includes(
            'User-authored instruction: do not make native function tool calls.'
        )), 'caller-authored instructions are preserved without a generated replacement');
    } finally {
        Globals.config = originalConfig;
    }
});

test('shared base-context wire schema does not authorize direct tool-less execution', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let capturedPayload = null;
    let responseHandlerCalls = 0;
    axios.post = async (_endpoint, payload) => {
        capturedPayload = JSON.parse(JSON.stringify(payload));
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'base-context-direct-tool-call-test',
                object: 'chat.completion',
                created: 1,
                model: payload.model,
                choices: [{
                    index: 0,
                    finish_reason: 'tool_calls',
                    message: { role: 'assistant', content: null, tool_calls: [{
                        id: 'forbidden-shared-tool',
                        type: 'function',
                        function: { name: 'moreInfo', arguments: '{"name":"Target"}' }
                    }] }
                }]
            }
        };
    };
    Globals.config = { ai: buildAiConfig(), chat_tools: { request_user_input_enabled: true } };
    try {
        await assert.rejects(LLMClient.chatCompletion({
            messages: buildBaseContextMessages(),
            metadataLabel: 'slop_remover',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            onResponse() { responseHandlerCalls += 1; }
        }), /Tool calls are forbidden for this completion checkpoint or correction/);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
    assert.equal(capturedPayload.tools, undefined);
    assert.equal(capturedPayload.tool_choice, 'none');
    const permissionGuidance = capturedPayload.messages.filter(message => (
        message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
    ));
    assert.equal(permissionGuidance.length, 0, 'no tool schema means no tool permission message is needed');
    assert.equal(capturedPayload.messages.some(message => /Do not make native function tool calls\./.test(String(message.content))), false,
        'a tool-less completion does not receive a generated native restriction');
    assert.equal(responseHandlerCalls, 0);
});

test('TinyBrain base-context requests wire the family-scoped lookup schema', { concurrency: false }, async () => {
    const { getChatToolDefinitions } = require('../chat_tool_calls.js');
    const config = {
        ai: { ...buildAiConfig(), tinybrain: true, tinybrain_prompts: { player_action: true } },
        chat_tools: { request_user_input_enabled: true },
        use_legacy_prompt_checks: false
    };
    Globals.config = config;
    const baseline = LLMClient.resolvePlayerActionToolDefinitions();
    const moreInfo = getChatToolDefinitions().find(definition => definition.function.name === 'moreInfo');
    const payload = await LLMClient.withPromptQueueReservation(async queueReservation => (
        LLMClient.withTinyBrainToolSchema({
            metadataLabel: 'player_action',
            queueReservation,
            toolDefinitions: [moreInfo],
            shareBaseContextTools: true
        }, async () => capturePayload({
            metadataLabel: 'player_action',
            messages: buildBaseContextMessages(),
            queueReservation,
            config,
            additionalPayload: { tools: [moreInfo], tool_choice: 'auto' }
        }))
    ));

    assert.equal(payload.tool_choice, 'auto');
    assert.deepEqual(payload.tools, [moreInfo]);
});

test('base-context wire tools describe only the effective execution permissions in a late user message', { concurrency: false }, async () => {
    const { getChatToolDefinitions } = require('../chat_tool_calls.js');
    const config = {
        ai: { ...buildAiConfig(), tinybrain: false, tinybrain_prompts: { player_action: false } },
        chat_tools: { request_user_input_enabled: true }
    };
    Globals.config = config;
    const moreInfoTool = getChatToolDefinitions().find(tool => tool.function.name === 'moreInfo');
    const inputMessages = buildBaseContextMessages();
    const originalMessages = structuredClone(inputMessages);
    const baseline = await capturePayload({
        metadataLabel: 'slop_remover',
        messages: inputMessages,
        config,
        executionAllowedToolNames: []
    });
    const subset = await capturePayload({
        metadataLabel: 'slop_remover',
        messages: inputMessages,
        config,
        additionalPayload: { tools: [moreInfoTool], tool_choice: 'auto' },
        executionAllowedToolNames: ['moreInfo']
    });
    const fullyAllowedTools = LLMClient.resolvePlayerActionToolDefinitions();
    const fullyAllowed = await capturePayload({
        metadataLabel: 'slop_remover',
        messages: inputMessages,
        config,
        additionalPayload: { tools: fullyAllowedTools, tool_choice: 'auto' },
        executionAllowedToolNames: fullyAllowedTools.map(tool => tool.function.name)
    });
    assert.deepEqual(inputMessages, originalMessages, 'adding request guidance must not mutate caller history');
    assert.equal(baseline.tools, undefined, 'a completion that cannot execute tools exposes no tool definitions');
    assert.equal(baseline.tool_choice, 'none');
    assert.deepEqual(subset.tools, [moreInfoTool], 'the provider sees only the executable subset');
    assert.equal(subset.tool_choice, 'auto');
    assert.deepEqual(fullyAllowed.tools, fullyAllowedTools);
    assert.equal(fullyAllowed.tool_choice, 'auto');
    assert.equal(fullyAllowed.messages.some(message => (
        message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
    )), false, 'a complete runtime grant should not add redundant restriction guidance');

    assert.equal(baseline.messages.some(message => (
        message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
    )), false, 'no restriction message is needed when no tool definitions are exposed');
    assert.equal(baseline.messages.some(message => /Do not make native function tool calls\./.test(String(message.content))), false);
    assert.equal(subset.messages.some(message => (
        message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
    )), false, 'a restricted provider schema contains only tools the prompt can execute');
});

test('mutating-prompts-only disables read-only native scopes while preserving mutator-capable permissions', { concurrency: false }, async () => {
    const { getChatToolDefinitions } = require('../chat_tool_calls.js');
    const config = {
        ai: buildAiConfig(),
        chat_tools: { request_user_input_enabled: true, mutating_prompts_only: true }
    };
    const toolDefinitions = getChatToolDefinitions();
    const moreInfo = toolDefinitions.find(tool => tool.function.name === 'moreInfo');
    const createLocationStub = toolDefinitions.find(tool => tool.function.name === 'createLocationStub');
    const editChatLogEntry = toolDefinitions.find(tool => tool.function.name === 'editChatLogEntry');
    const readonlyPayload = await capturePayload({
        metadataLabel: 'npc_memory',
        messages: buildBaseContextMessages(),
        config,
        additionalPayload: { tools: [moreInfo], tool_choice: 'auto' },
        executionAllowedToolNames: ['moreInfo']
    });
    const strayMutatorPayload = await capturePayload({
        metadataLabel: 'npc_memory',
        messages: buildBaseContextMessages(),
        config,
        additionalPayload: { tools: [moreInfo], tool_choice: 'auto' },
        executionAllowedToolNames: ['moreInfo', 'updateObjectFields']
    });
    const playerActionTools = LLMClient.resolvePlayerActionToolDefinitions();
    const playerActionPayload = await capturePayload({
        metadataLabel: 'player_action',
        messages: buildBaseContextMessages(),
        config,
        additionalPayload: { tools: playerActionTools, tool_choice: 'auto' },
        executionAllowedToolNames: playerActionTools.map(tool => tool.function.name)
    });
    const genericEditingTools = [moreInfo, editChatLogEntry];
    const genericEditingPayload = await capturePayload({
        metadataLabel: 'generic_prompt',
        messages: buildBaseContextMessages(),
        config,
        additionalPayload: { tools: genericEditingTools, tool_choice: 'auto' },
        executionAllowedToolNames: genericEditingTools.map(tool => tool.function.name)
    });
    const vetoedPayload = await capturePayload({
        metadataLabel: 'npc_memory',
        messages: buildBaseContextMessages(),
        config,
        additionalPayload: { tools: [createLocationStub], tool_choice: 'auto' },
        executionAllowedToolNames: ['createLocationStub'],
        nativeToolMutationsRequired: false
    });

    for (const payload of [readonlyPayload, strayMutatorPayload, vetoedPayload]) {
        assert.equal(payload.tools, undefined);
        assert.equal(payload.tool_choice, 'none');
        assert.equal(payload.messages.some(message => (
            message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
        )), false);
        assert.equal(payload.messages.some(message => /Do not make native function tool calls\./.test(String(message.content))), false);
    }
    for (const payload of [playerActionPayload, genericEditingPayload]) {
        assert.equal(payload.tool_choice, 'auto');
        assert.equal(payload.messages.some(message => (
            message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
        )), false, 'mutator-capable prompt scopes retain their declared permissions');
    }
    assert.deepEqual(playerActionPayload.tools, playerActionTools);
    assert.deepEqual(genericEditingPayload.tools, genericEditingTools);
});

test('mutating-prompts-only TinyBrain eligibility is snapshotted from its original run tool set', { concurrency: false }, async () => {
    const { getChatToolDefinitions } = require('../chat_tool_calls.js');
    const config = {
        ai: { ...buildAiConfig(), tinybrain: true, tinybrain_prompts: { player_action: true } },
        chat_tools: { request_user_input_enabled: true, mutating_prompts_only: true }
    };
    const originalConfig = Globals.config;
    Globals.config = config;
    const toolDefinitions = getChatToolDefinitions();
    const moreInfo = toolDefinitions.find(tool => tool.function.name === 'moreInfo');
    const createLocationStub = toolDefinitions.find(tool => tool.function.name === 'createLocationStub');
    let payload;
    try {
        payload = await LLMClient.withPromptQueueReservation(async queueReservation => (
            LLMClient.withTinyBrainToolSchema({
            metadataLabel: 'player_action',
            queueReservation,
            toolDefinitions: [moreInfo, createLocationStub],
            shareBaseContextTools: true
        }, async () => {
            const state = LLMClient.getTinyBrainToolExecutionState({ metadataLabel: 'player_action', queueReservation, maxToolCalls: 3 });
            assert.equal(state.nativeToolExecutionEnabled, true);
            assert.deepEqual(state.executionToolNames, ['moreInfo', 'createLocationStub']);
            return capturePayload({
                metadataLabel: 'player_action',
                queueReservation,
                messages: buildBaseContextMessages(),
                config,
                additionalPayload: { tools: [moreInfo, createLocationStub], tool_choice: 'auto' },
                executionAllowedToolNames: ['moreInfo']
            });
            })
        ));
    } finally {
        Globals.config = originalConfig;
    }

    assert.deepEqual(payload.tools, [moreInfo], 'the provider only receives the current executable checkpoint subset');
    assert.equal(payload.tool_choice, 'auto');
    const permissionGuidance = payload.messages.filter(message => (
        message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
    ));
    assert.equal(permissionGuidance.length, 1);
    assert.match(permissionGuidance[0].content, /You may call ONLY these native tools: moreInfo/);
});

test('TinyBrain tool schema scopes reject mutations and isolate nested runs', { concurrency: false }, async () => {
    const toolA = {
        type: 'function',
        function: { name: 'tinyBrainScopeA', parameters: { type: 'object', properties: {} } }
    };
    const toolB = {
        type: 'function',
        function: { name: 'tinyBrainScopeB', parameters: { type: 'object', properties: {} } }
    };
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const wirePayloads = [];
    axios.post = async (_endpoint, payload) => {
        wirePayloads.push(JSON.parse(JSON.stringify(payload)));
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'tinybrain-stage-schema-test',
                object: 'chat.completion',
                created: 1,
                model: payload.model,
                choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }]
            }
        };
    };
    Globals.config = {
        ai: buildAiConfig(),
        chat_tools: { request_user_input_enabled: true }
    };

    try {
        await LLMClient.withPromptQueueReservation(async reservationA => {
            await LLMClient.withTinyBrainToolSchema({
                metadataLabel: 'tinybrain_scope_a',
                queueReservation: reservationA,
                toolDefinitions: [toolA]
            }, async () => {
                const outerExecutionState = LLMClient.getTinyBrainToolExecutionState({
                    metadataLabel: 'tinybrain_scope_a',
                    queueReservation: reservationA,
                    maxToolCalls: 3
                });
                outerExecutionState.toolCallsUsed = 2;
                outerExecutionState.negativeEntityLookups.set('moreInfo|character|missing', {
                    fingerprint: 'outer-world',
                    result: { content: 'outer negative lookup', metadata: { totalMatches: 0 } }
                });
                wirePayloads.push(await capturePayload({
                    metadataLabel: 'tinybrain_scope_a',
                    queueReservation: reservationA,
                    messages: [{ role: 'user', content: 'scope A' }]
                }));

                await assert.rejects(
                    LLMClient.withTinyBrainToolSchema({
                        metadataLabel: 'tinybrain_scope_a',
                        queueReservation: reservationA,
                        toolDefinitions: [toolA]
                    }, async () => {}),
                    /Tiny-brain run tool schema is already initialized for this queue reservation/
                );

                await assert.rejects(
                    capturePayload({
                        metadataLabel: 'tinybrain_scope_a',
                        queueReservation: reservationA,
                        additionalPayload: { tools: [toolB], tool_choice: 'auto' },
                        messages: [{ role: 'user', content: 'attempt to replace scope A' }]
                    }),
                    /Tiny-brain checkpoint tools must use unchanged definitions from the original execution scope/
                );

                await LLMClient.withTinyBrainToolSchema({
                    metadataLabel: 'tinybrain_scope_b',
                    queueReservation: reservationA,
                    toolDefinitions: [toolB]
                }, async () => {
                    const nestedExecutionState = LLMClient.getTinyBrainToolExecutionState({
                        metadataLabel: 'tinybrain_scope_b',
                        queueReservation: reservationA,
                        maxToolCalls: 3
                    });
                    assert.notEqual(nestedExecutionState, outerExecutionState);
                    assert.equal(nestedExecutionState.toolCallsUsed, 0);
                    assert.equal(nestedExecutionState.negativeEntityLookups.size, 0);
                    nestedExecutionState.toolCallsUsed = 1;
                    wirePayloads.push(await capturePayload({
                        metadataLabel: 'tinybrain_scope_b',
                        queueReservation: reservationA,
                        messages: [{ role: 'user', content: 'nested scope B' }]
                    }));
                });

                wirePayloads.push(await capturePayload({
                    metadataLabel: 'tinybrain_scope_a',
                    queueReservation: reservationA,
                    messages: [{ role: 'user', content: 'scope A after nested scope B' }]
                }));
                const restoredOuterState = LLMClient.getTinyBrainToolExecutionState({
                    metadataLabel: 'tinybrain_scope_a',
                    queueReservation: reservationA,
                    maxToolCalls: 3
                });
                assert.equal(restoredOuterState, outerExecutionState);
                assert.equal(restoredOuterState.toolCallsUsed, 2);
                assert.equal(restoredOuterState.negativeEntityLookups.size, 1);
            });
        });
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }

    assert.equal(wirePayloads.length, 3, 'schema mutation is rejected before transport');
    assert.deepEqual(wirePayloads.map(payload => payload.tools), [[toolA], [toolB], [toolA]]);
});

test('concurrent TinyBrain tool scopes receive separate execution budgets and negative-lookup caches', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    Globals.config = { ai: buildAiConfig() };
    try {
        await LLMClient.withPromptQueueReservation(async queueReservation => {
            let enteredScopes = 0;
            let releaseScopes;
            const scopesReady = new Promise(resolve => { releaseScopes = resolve; });
            const runScope = metadataLabel => LLMClient.withTinyBrainToolSchema({
                metadataLabel,
                queueReservation,
                toolDefinitions: []
            }, async () => {
                const state = LLMClient.getTinyBrainToolExecutionState({
                    metadataLabel,
                    queueReservation,
                    maxToolCalls: 2
                });
                state.toolCallsUsed = 1;
                state.negativeEntityLookups.set('lookup', {
                    fingerprint: metadataLabel,
                    result: { content: metadataLabel, metadata: { totalMatches: 0 } }
                });
                enteredScopes += 1;
                if (enteredScopes === 2) releaseScopes();
                await scopesReady;
                return state;
            });

            const [first, second] = await Promise.all([
                runScope('tinybrain_concurrent_a'),
                runScope('tinybrain_concurrent_b')
            ]);
            assert.notEqual(first, second);
            assert.notEqual(first.negativeEntityLookups, second.negativeEntityLookups);
            assert.equal(first.toolCallsUsed, 1);
            assert.equal(second.toolCallsUsed, 1);
            assert.equal(first.negativeEntityLookups.get('lookup').fingerprint, 'tinybrain_concurrent_a');
            assert.equal(second.negativeEntityLookups.get('lookup').fingerprint, 'tinybrain_concurrent_b');
        });
    } finally {
        Globals.config = originalConfig;
    }
});

test('TinyBrain retains its schema and schema-derived tool choice across transport retries', { concurrency: false }, async () => {
    const tool = {
        type: 'function',
        function: { name: 'tinyBrainRetryTool', parameters: { type: 'object', properties: {} } }
    };
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const payloads = [];
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        if (payloads.length === 1) {
            const error = new Error('temporary transport failure');
            error.code = 'ECONNRESET';
            throw error;
        }
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'tinybrain-transport-retry-test',
                object: 'chat.completion',
                created: 1,
                model: payload.model,
                choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }]
            }
        };
    };
    Globals.config = { ai: { ...buildAiConfig(), retryAttempts: 1 } };

    try {
        await LLMClient.withPromptQueueReservation(async queueReservation => (
            LLMClient.withTinyBrainToolSchema({
                metadataLabel: 'tinybrain_transport_retry_test',
                queueReservation,
                toolDefinitions: [tool]
            }, async () => {
                const response = await LLMClient.chatCompletion({
                    messages: [{ role: 'user', content: 'Retry this checkpoint.' }],
                    metadataLabel: 'tinybrain_transport_retry_test',
                    queueReservation,
                    additionalPayload: { tool_choice: 'none' },
                    allowToolCalls: false,
                    validateXML: false,
                    output: 'silent',
                    retryAttempts: 1
                });
                assert.equal(response, 'ok');
            })
        ));
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }

    assert.equal(payloads.length, 2);
    for (const payload of payloads) {
        assert.equal(payload.tools, undefined);
        assert.equal(payload.tool_choice, 'none');
    }
});

test('TinyBrain retains its schema-derived tool choice during response-validation correction', { concurrency: false }, async () => {
    const tool = {
        type: 'function',
        function: { name: 'tinyBrainValidationTool', parameters: { type: 'object', properties: {} } }
    };
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const payloads = [];
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `tinybrain-validation-${payloads.length}`,
                object: 'chat.completion',
                created: 1,
                model: payload.model,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: {
                        role: 'assistant',
                        content: payloads.length === 1 ? 'not-valid' : 'valid-result'
                    }
                }]
            }
        };
    };
    Globals.config = { ai: { ...buildAiConfig(), retryAttempts: 1 } };

    try {
        await LLMClient.withPromptQueueReservation(async queueReservation => (
            LLMClient.withTinyBrainToolSchema({
                metadataLabel: 'tinybrain_validation_correction_test',
                queueReservation,
                toolDefinitions: [tool]
            }, async () => {
                const response = await LLMClient.chatCompletion({
                    messages: [{ role: 'user', content: 'Return valid output.' }],
                    metadataLabel: 'tinybrain_validation_correction_test',
                    queueReservation,
                    additionalPayload: { tool_choice: 'none' },
                    allowToolCalls: false,
                    requiredRegex: /^valid-result$/,
                    responseValidationRetryFeedback: true,
                    validateXML: false,
                    output: 'silent',
                    retryAttempts: 1,
                    waitAfterError: 0
                });
                assert.equal(response, 'valid-result');
            })
        ));
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }

    assert.equal(payloads.length, 2);
    for (const payload of payloads) {
        assert.equal(payload.tools, undefined);
        assert.equal(payload.tool_choice, 'none');
    }
    assert.equal(payloads[1].messages.some(message => (
        message.role === 'user' && String(message.content).startsWith('Tool execution permissions for this completion:')
    )), false);
    assert.equal(payloads[1].messages.some(message => /Do not make native function tool calls\./.test(String(message.content))), false);
    assert.match(payloads[1].messages.at(-1).content, /Do not make any tool calls\./);
});

test('TinyBrain forced tool-call responses obey the fixed choice and completion restriction', { concurrency: false }, async () => {
    const tool = {
        type: 'function',
        function: { name: 'tinyBrainForcedTool', parameters: { type: 'object', properties: {} } }
    };
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let transportCalls = 0;
    let responseHandlerCalls = 0;
    axios.post = async () => {
        transportCalls += 1;
        throw new Error('Forced output must not use transport.');
    };
    Globals.config = { ai: buildAiConfig() };

    try {
        await LLMClient.withPromptQueueReservation(async queueReservation => (
            LLMClient.withTinyBrainToolSchema({
                metadataLabel: 'tinybrain_forced_tool_call_test',
                queueReservation,
                toolDefinitions: [tool]
            }, async () => {
                assert.equal(LLMClient.getTinyBrainToolChoice({
                    metadataLabel: 'tinybrain_forced_tool_call_test',
                    queueReservation
                }), 'auto');
                await assert.rejects(LLMClient.chatCompletion({
                    messages: [{ role: 'user', content: 'Do not call a tool.' }],
                    metadataLabel: 'tinybrain_forced_tool_call_test',
                    queueReservation,
                    allowToolCalls: false,
                    forceOutput: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'forced-forbidden-tool-call',
                            type: 'function',
                            function: { name: tool.function.name, arguments: '{}' }
                        }]
                    },
                    validateXML: false,
                    output: 'silent',
                    retryAttempts: 0,
                    onResponse: () => { responseHandlerCalls += 1; }
                }), /Tool calls are forbidden for this completion checkpoint or correction/);
            })
        ));
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }

    assert.equal(transportCalls, 0);
    assert.equal(responseHandlerCalls, 0);
});

test('chatCompletion leaves generic base-context tool payloads unchanged', { concurrency: false }, async () => {
    const genericTools = [{
        type: 'function',
        function: {
            name: 'genericOnlyTool',
            parameters: { type: 'object' }
        }
    }];
    const payload = await capturePayload({
        metadataLabel: 'generic_prompt',
        messages: buildBaseContextMessages(),
        additionalPayload: {
            tools: genericTools,
            tool_choice: 'required'
        }
    });

    assert.deepEqual(payload.tools, genericTools);
    assert.equal(payload.tool_choice, 'required');
    assert.doesNotMatch(JSON.stringify(payload.messages), /AI_RPG_INTERNAL_/);
    assert.doesNotMatch(JSON.stringify(payload.messages), /Do not make tool calls\./);
});

test('chatCompletion does not add shared tools to prompts without the base-context marker', { concurrency: false }, async () => {
    const payload = await capturePayload({
        metadataLabel: 'standalone_prompt',
        messages: [{ role: 'user', content: 'Standalone prompt.' }]
    });

    assert.equal(payload.tools, undefined);
    assert.equal(payload.tool_choice, 'none');
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'Standalone prompt.' }]);
});
