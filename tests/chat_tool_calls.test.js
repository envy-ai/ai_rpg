const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

test('runChatCompletionWithToolLoop converts async ToolVisibleError rejections into tool messages', async () => {
    const originLocation = {
        id: 'loc-origin',
        name: 'Greenhouse Foyer'
    };
    const gameLocations = new Map([[originLocation.id, originLocation]]);
    const capturedMessagesByRound = [];
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_1',
                                    type: 'function',
                                    function: {
                                        name: 'createLocationStub',
                                        arguments: JSON.stringify({
                                            locationName: 'Observatory Annex',
                                            targetRegion: 'Botanical Research Conservatory'
                                        })
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        },
        {
            data: {
                choices: [
                    {
                        message: {
                            content: 'Recovered after tool error.',
                            tool_calls: []
                        }
                    }
                ]
            }
        }
    ];

    const runtime = createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 4 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => ({ currentLocation: originLocation.id }),
        createLocationFromEvent: async () => {
            throw new Error('createLocationFromEvent should not be reached for this regression test.');
        },
        createRegionStubFromEvent: async () => {
            throw new Error('createRegionStubFromEvent should not be reached for this regression test.');
        },
        generateItemsByNames: async () => [],
        ensureExitConnection: () => {
            throw new Error('ensureExitConnection should not be reached for this regression test.');
        },
        findRegionByLocationId: () => null,
        LLMClient: {
            chatCompletion: async (options) => {
                capturedMessagesByRound.push(structuredClone(options.messages));
                const response = llmResponses.shift();
                assert.ok(response, 'Expected a queued LLM response for this round.');
                options.onResponse?.(response);
                return response.data.choices[0].message.content || '';
            },
            logPrompt: () => {},
            formatMessagesForErrorLog: (messages) => JSON.stringify(messages)
        },
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: {
            getAll: () => [],
            get: () => null
        },
        Region: {},
        getGameLocations: () => gameLocations,
        getFactions: () => [],
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: '@Create a new path.' }]
        },
        metadataLabel: 'chat_tool_runtime_test'
    });

    assert.equal(result.aiResponse, 'Recovered after tool error.');
    assert.equal(result.rounds, 2);
    assert.equal(result.toolInvocations.length, 1);
    assert.equal(result.toolInvocations[0].name, 'createLocationStub');
    assert.equal(result.toolInvocations[0].metadata?.error, true);
    assert.equal(result.toolInvocations[0].metadata?.code, 'region_not_found');

    const secondRoundMessages = capturedMessagesByRound[1];
    assert.ok(Array.isArray(secondRoundMessages), 'Expected messages to be captured for the second round.');
    const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
    assert.ok(toolMessage, 'Expected a tool response message in the second round.');
    assert.match(toolMessage.content, /<toolError>/);
    assert.match(toolMessage.content, /No targetRegion matches "Botanical Research Conservatory"\./);
});

test('runChatCompletionWithToolLoop reports tool-call debug lifecycle events', async () => {
    const debugEvents = [];
    const capturedMessagesByRound = [];
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_debug_1',
                                    type: 'function',
                                    function: {
                                        name: 'moreInfo',
                                        arguments: JSON.stringify({
                                            name: 'No Such Thing',
                                            type: 'thing'
                                        })
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        },
        {
            data: {
                choices: [
                    {
                        message: {
                            content: 'Done.',
                            tool_calls: []
                        }
                    }
                ]
            }
        }
    ];

    const runtime = createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 4 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => ({ currentLocation: 'loc-origin' }),
        createLocationFromEvent: async () => {
            throw new Error('createLocationFromEvent should not be reached for this regression test.');
        },
        createRegionStubFromEvent: async () => {
            throw new Error('createRegionStubFromEvent should not be reached for this regression test.');
        },
        generateItemsByNames: async () => [],
        ensureExitConnection: () => {
            throw new Error('ensureExitConnection should not be reached for this regression test.');
        },
        findRegionByLocationId: () => null,
        LLMClient: {
            chatCompletion: async (options) => {
                capturedMessagesByRound.push(structuredClone(options.messages));
                const response = llmResponses.shift();
                assert.ok(response, 'Expected a queued LLM response for this round.');
                options.onResponse?.(response);
                return response.data.choices[0].message.content || '';
            },
            logPrompt: () => {},
            formatMessagesForErrorLog: (messages) => JSON.stringify(messages)
        },
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { getAll: () => [], get: () => null },
        Region: { getAll: () => [] },
        getGameLocations: () => new Map(),
        getFactions: () => [],
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Look up a missing thing.' }]
        },
        metadataLabel: 'tool_debug_test',
        onToolCallDebug: event => {
            debugEvents.push(structuredClone(event));
        }
    });

    assert.equal(result.aiResponse, 'Done.');
    assert.equal(debugEvents.length, 2);
    assert.equal(debugEvents[0].phase, 'started');
    assert.equal(debugEvents[0].metadataLabel, 'tool_debug_test');
    assert.equal(debugEvents[0].round, 1);
    assert.equal(debugEvents[0].sequence, 1);
    assert.equal(debugEvents[0].name, 'moreInfo');
    assert.deepEqual(debugEvents[0].parameters, {
        name: 'No Such Thing',
        type: 'thing'
    });
    assert.equal(debugEvents[1].phase, 'completed');
    assert.equal(debugEvents[1].sequence, 1);
    assert.match(debugEvents[1].result.content, /<moreInfoResults>/);
    assert.equal(debugEvents[1].result.metadata.totalMatches, 0);

    const secondRoundMessages = capturedMessagesByRound[1];
    const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
    assert.ok(toolMessage, 'Expected a tool response message in the second round.');
    assert.match(toolMessage.content, /<moreInfoResults>/);
});

test('getFullScene tool returns delineated actions and prose for a numbered scene', async () => {
    const chatHistory = [
        {
            id: 'entry-user-1',
            role: 'user',
            content: 'Scout the silent hall.',
            locationId: 'loc-1'
        },
        {
            id: 'entry-prose-1',
            role: 'assistant',
            type: 'player-action',
            content: 'You move along the wall, keeping your lantern low.',
            locationId: 'loc-1'
        },
        {
            id: 'entry-npc-action-1',
            role: 'Mara',
            type: 'npc-action',
            actor: 'Mara',
            content: 'Mara tests the old lock with a bent pin.',
            locationId: 'loc-1'
        },
        {
            id: 'entry-npc-prose-1',
            role: 'assistant',
            actor: 'Mara',
            content: 'Mara kneels by the lock and listens for the tumblers.',
            locationId: 'loc-1'
        },
        {
            id: 'entry-event-1',
            role: 'assistant',
            type: 'event-summary',
            content: '📋 Events\nA mechanical row that should not be returned.',
            locationId: 'loc-1'
        },
        {
            id: 'entry-user-2',
            role: 'user',
            content: 'Open the chest.',
            locationId: 'loc-1'
        }
    ];
    const sceneSummaries = {
        getScenesInOrder: () => [
            {
                startIndex: 1,
                endIndex: 4,
                startEntryId: 'entry-user-1',
                endEntryId: 'entry-npc-prose-1',
                summary: 'The party scouts a hallway and Mara checks a lock.'
            }
        ]
    };
    const capturedMessagesByRound = [];
    const runtime = createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => chatHistory,
        getSceneSummaries: () => sceneSummaries,
        isAssistantProseLikeEntry: (entry) => {
            if (!entry || entry.role !== 'assistant') {
                return false;
            }
            const entryType = typeof entry.type === 'string' ? entry.type : null;
            return entryType === null || ['player-action', 'npc-action', 'while-you-were-away-player'].includes(entryType);
        },
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => ({ id: 'player-1', name: 'Test Player', currentLocation: 'loc-1' }),
        createLocationFromEvent: async () => {
            throw new Error('createLocationFromEvent should not be reached.');
        },
        createRegionStubFromEvent: async () => {
            throw new Error('createRegionStubFromEvent should not be reached.');
        },
        generateItemsByNames: async () => [],
        ensureExitConnection: () => {
            throw new Error('ensureExitConnection should not be reached.');
        },
        findRegionByLocationId: () => null,
        LLMClient: {
            chatCompletion: async (options) => {
                capturedMessagesByRound.push(structuredClone(options.messages));
                if (capturedMessagesByRound.length === 1) {
                    options.onResponse?.({
                        data: {
                            choices: [{
                                message: {
                                    content: '',
                                    tool_calls: [{
                                        id: 'call-get-full-scene',
                                        type: 'function',
                                        function: {
                                            name: 'getFullScene',
                                            arguments: JSON.stringify({ sceneNumber: 1 })
                                        }
                                    }]
                                }
                            }]
                        }
                    });
                    return '';
                }
                options.onResponse?.({
                    data: {
                        choices: [{
                            message: {
                                content: 'Scene reviewed.',
                                tool_calls: []
                            }
                        }]
                    }
                });
                return 'Scene reviewed.';
            },
            logPrompt: () => {},
            formatMessagesForErrorLog: messages => JSON.stringify(messages)
        },
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { getAll: () => [], get: () => null },
        Region: { getAll: () => [] },
        getGameLocations: () => new Map(),
        getFactions: () => [],
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Review scene one.' }]
        },
        metadataLabel: 'get_full_scene_test'
    });

    assert.equal(result.aiResponse, 'Scene reviewed.');
    assert.equal(result.toolInvocations.length, 1);
    assert.equal(result.toolInvocations[0].name, 'getFullScene');
    assert.equal(result.toolInvocations[0].metadata.returnedCount, 4);

    const secondRoundMessages = capturedMessagesByRound[1];
    const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
    assert.ok(toolMessage, 'Expected a getFullScene tool response message.');
    assert.match(toolMessage.content, /<fullScene number="1" totalScenes="1">/);
    assert.match(toolMessage.content, /Action by Test Player/);
    assert.match(toolMessage.content, /Scout the silent hall\./);
    assert.match(toolMessage.content, /Storyteller prose/);
    assert.match(toolMessage.content, /You move along the wall/);
    assert.match(toolMessage.content, /Action by Mara/);
    assert.match(toolMessage.content, /Mara tests the old lock/);
    assert.match(toolMessage.content, /Storyteller prose for Mara/);
    assert.match(toolMessage.content, /Mara kneels by the lock/);
    assert.doesNotMatch(toolMessage.content, /mechanical row/);
    assert.doesNotMatch(toolMessage.content, /Open the chest/);
});

test('getFullScene out-of-range errors return toolError and continue the loop', async () => {
    const capturedMessagesByRound = [];
    const debugEvents = [];
    const loggedPrompts = [];
    const sceneSummaries = {
        getScenesInOrder: () => [
            { startIndex: 1, endIndex: 1, startEntryId: 'a', endEntryId: 'a', summary: 'One.' },
            { startIndex: 2, endIndex: 2, startEntryId: 'b', endEntryId: 'b', summary: 'Two.' },
            { startIndex: 3, endIndex: 3, startEntryId: 'c', endEntryId: 'c', summary: 'Three.' },
            { startIndex: 4, endIndex: 4, startEntryId: 'd', endEntryId: 'd', summary: 'Four.' }
        ]
    };
    const runtime = createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => [],
        getSceneSummaries: () => sceneSummaries,
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => ({ id: 'player-1', name: 'Test Player', currentLocation: 'loc-1' }),
        createLocationFromEvent: async () => {
            throw new Error('createLocationFromEvent should not be reached.');
        },
        createRegionStubFromEvent: async () => {
            throw new Error('createRegionStubFromEvent should not be reached.');
        },
        generateItemsByNames: async () => [],
        ensureExitConnection: () => {
            throw new Error('ensureExitConnection should not be reached.');
        },
        findRegionByLocationId: () => null,
        LLMClient: {
            chatCompletion: async (options) => {
                capturedMessagesByRound.push(structuredClone(options.messages));
                if (capturedMessagesByRound.length === 1) {
                    options.onResponse?.({
                        data: {
                            choices: [{
                                message: {
                                    content: '',
                                    tool_calls: [{
                                        id: 'call-get-full-scene-out-of-range',
                                        type: 'function',
                                        function: {
                                            name: 'getFullScene',
                                            arguments: JSON.stringify({ sceneNumber: 7 })
                                        }
                                    }]
                                }
                            }]
                        }
                    });
                    return '';
                }
                options.onResponse?.({
                    data: {
                        choices: [{
                            message: {
                                content: 'Recovered after scene lookup error.',
                                tool_calls: []
                            }
                        }]
                    }
                });
                return 'Recovered after scene lookup error.';
            },
            logPrompt: (payload) => {
                loggedPrompts.push(payload);
            },
            formatMessagesForErrorLog: messages => JSON.stringify(messages)
        },
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { getAll: () => [], get: () => null },
        Region: { getAll: () => [] },
        getGameLocations: () => new Map(),
        getFactions: () => [],
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Review scene seven.' }]
        },
        metadataLabel: 'get_full_scene_out_of_range_test',
        onToolCallDebug: event => {
            debugEvents.push(structuredClone(event));
        }
    });

    assert.equal(result.aiResponse, 'Recovered after scene lookup error.');
    assert.equal(result.rounds, 2);
    assert.equal(result.toolInvocations.length, 1);
    assert.equal(result.toolInvocations[0].name, 'getFullScene');
    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.equal(result.toolInvocations[0].metadata.code, 'tool_execution_error');
    assert.match(result.toolInvocations[0].metadata.message, /sceneNumber 7 is out of range; stored scenes: 4/);

    assert.equal(debugEvents.length, 2);
    assert.equal(debugEvents[0].phase, 'started');
    assert.equal(debugEvents[1].phase, 'error');
    assert.match(debugEvents[1].error.message, /sceneNumber 7 is out of range; stored scenes: 4/);

    const secondRoundMessages = capturedMessagesByRound[1];
    const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
    assert.ok(toolMessage, 'Expected a tool response message in the second round.');
    assert.match(toolMessage.content, /<toolError>/);
    assert.match(toolMessage.content, /getFullScene sceneNumber 7 is out of range; stored scenes: 4\./);
    assert.ok(
        loggedPrompts.some(entry => entry?.prefix === 'get_full_scene_out_of_range_test_tool_call_error'),
        'Expected the tool execution error to be logged.'
    );
});

test('getFullScene tool schema exists', () => {
    const getFullScene = findToolDefinition('getFullScene');
    assert.ok(getFullScene, 'getFullScene tool definition should exist');
    assert.deepEqual(getFullScene.parameters.required, ['sceneNumber']);
    assert.equal(getFullScene.parameters.properties.sceneNumber.type, 'integer');
});
