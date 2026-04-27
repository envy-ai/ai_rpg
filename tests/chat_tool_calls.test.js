const test = require('node:test');
const assert = require('node:assert/strict');

const { createChatToolRuntime } = require('../chat_tool_calls.js');

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
