const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');
const IdGenerator = require('../IdGenerator.js');
const MysteryBox = require('../MysteryBox.js');
const MysteryThread = require('../MysteryThread.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function createMinimalRuntime({
    llmResponses = [],
    capturedMessagesByRound = [],
    debugEvents = [],
    chatHistory = [],
    isAssistantProseLikeEntry = () => true,
    requestUserInput = null,
    characters = [],
    currentPlayer = { currentLocation: 'loc-origin' }
} = {}) {
    return createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 4 } }),
        getChatHistory: () => chatHistory,
        isAssistantProseLikeEntry,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => currentPlayer,
        createLocationFromEvent: async () => {
            throw new Error('createLocationFromEvent should not be reached for this test.');
        },
        createRegionStubFromEvent: async () => {
            throw new Error('createRegionStubFromEvent should not be reached for this test.');
        },
        generateItemsByNames: async () => [],
        ensureExitConnection: () => {
            throw new Error('ensureExitConnection should not be reached for this test.');
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
        Player: { getAll: () => characters },
        Thing: { getAll: () => [] },
        Location: { getAll: () => [], get: () => null },
        Region: { getAll: () => [] },
        getGameLocations: () => new Map(),
        getFactions: () => [],
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map(),
        requestUserInput
    });
}

test('requestUserInput tool definition asks a required question only', () => {
    const definition = findToolDefinition('requestUserInput');

    assert.ok(definition, 'Expected requestUserInput chat tool definition.');
    assert.match(definition.description, /ask/i);
    assert.deepEqual(definition.parameters.required, ['question']);
    assert.deepEqual(Object.keys(definition.parameters.properties).sort(), ['question']);
    assert.equal(definition.parameters.additionalProperties, false);
});

test('revealEntity and hideEntity tool definitions require only an entity name', () => {
    const revealDefinition = findToolDefinition('revealEntity');
    const hideDefinition = findToolDefinition('hideEntity');

    assert.ok(revealDefinition, 'Expected revealEntity chat tool definition.');
    assert.ok(hideDefinition, 'Expected hideEntity chat tool definition.');
    assert.deepEqual(revealDefinition.parameters.required, ['name']);
    assert.deepEqual(hideDefinition.parameters.required, ['name']);
    assert.deepEqual(Object.keys(revealDefinition.parameters.properties).sort(), ['description', 'name']);
    assert.deepEqual(Object.keys(hideDefinition.parameters.properties).sort(), ['description', 'name']);
    assert.equal(revealDefinition.parameters.additionalProperties, false);
    assert.equal(hideDefinition.parameters.additionalProperties, false);
});

test('revealEntity and hideEntity tool calls toggle hiddenFromPlayer without resolving checks', async () => {
    const capturedMessagesByRound = [];
    const shade = {
        id: 'npc-shade',
        name: 'Shade',
        isNPC: true,
        currentLocation: 'loc-origin',
        hiddenFromPlayer: true
    };
    const runtime = createMinimalRuntime({
        capturedMessagesByRound,
        characters: [shade],
        llmResponses: [
            {
                data: {
                    choices: [{
                        message: {
                            content: '',
                            tool_calls: [{
                                id: 'call-reveal',
                                type: 'function',
                                function: {
                                    name: 'revealEntity',
                                    arguments: JSON.stringify({
                                        name: 'Shade',
                                        description: 'The light catches Shade.'
                                    })
                                }
                            }]
                        }
                    }]
                }
            },
            {
                data: {
                    choices: [{
                        message: {
                            content: '',
                            tool_calls: [{
                                id: 'call-hide',
                                type: 'function',
                                function: {
                                    name: 'hideEntity',
                                    arguments: JSON.stringify({
                                        name: 'Shade',
                                        description: 'Shade slips behind the curtain.'
                                    })
                                }
                            }]
                        }
                    }]
                }
            },
            {
                data: {
                    choices: [{
                        message: {
                            content: 'Visibility updated.',
                            tool_calls: []
                        }
                    }]
                }
            }
        ]
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Reveal and hide Shade.' }]
        },
        metadataLabel: 'player_action'
    });

    assert.equal(result.aiResponse, 'Visibility updated.');
    assert.equal(shade.hiddenFromPlayer, true);
    assert.deepEqual(result.toolInvocations.map(call => call.name), ['revealEntity', 'hideEntity']);
    assert.equal(result.toolInvocations[0].metadata.hiddenFromPlayer, false);
    assert.equal(result.toolInvocations[1].metadata.hiddenFromPlayer, true);
    const revealToolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool' && message.tool_call_id === 'call-reveal');
    const hideToolMessage = capturedMessagesByRound[2].find(message => message.role === 'tool' && message.tool_call_id === 'call-hide');
    assert.match(revealToolMessage.content, /<field name="hidden">false<\/field>/);
    assert.match(hideToolMessage.content, /<field name="hidden">true<\/field>/);
});

test('hideEntity does not make dead NPCs hidden', async () => {
    const capturedMessagesByRound = [];
    const corpse = {
        id: 'npc-corpse',
        name: 'Fallen Scout',
        isNPC: true,
        isDead: true,
        currentLocation: 'loc-origin',
        hiddenFromPlayer: false
    };
    const runtime = createMinimalRuntime({
        capturedMessagesByRound,
        characters: [corpse],
        llmResponses: [
            {
                data: {
                    choices: [{
                        message: {
                            content: '',
                            tool_calls: [{
                                id: 'call-hide-corpse',
                                type: 'function',
                                function: {
                                    name: 'hideEntity',
                                    arguments: JSON.stringify({
                                        name: 'Fallen Scout',
                                        description: 'The body is dragged behind debris.'
                                    })
                                }
                            }]
                        }
                    }]
                }
            },
            {
                data: {
                    choices: [{
                        message: {
                            content: 'Corpse visibility unchanged.',
                            tool_calls: []
                        }
                    }]
                }
            }
        ]
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Try to hide the corpse.' }]
        },
        metadataLabel: 'player_action'
    });

    assert.equal(result.aiResponse, 'Corpse visibility unchanged.');
    assert.equal(corpse.hiddenFromPlayer, false);
    assert.equal(result.toolInvocations[0].metadata.hiddenFromPlayer, false);
    const hideToolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool' && message.tool_call_id === 'call-hide-corpse');
    assert.match(hideToolMessage.content, /<field name="hidden">false<\/field>/);
});

test('runChatCompletionWithToolLoop sends requestUserInput answers back as tool XML', async () => {
    const capturedMessagesByRound = [];
    const questions = [];
    const runtime = createMinimalRuntime({
        capturedMessagesByRound,
        requestUserInput: async ({ question }) => {
            questions.push(question);
            return {
                answer: 'Check the manifest tab for the crate serial.',
                requestId: 'player-input-1'
            };
        },
        llmResponses: [
            {
                data: {
                    choices: [{
                        message: {
                            content: '',
                            tool_calls: [{
                                id: 'call-input',
                                type: 'function',
                                function: {
                                    name: 'requestUserInput',
                                    arguments: JSON.stringify({
                                        question: 'Which crate serial should I inspect?'
                                    })
                                }
                            }]
                        }
                    }]
                }
            },
            {
                data: {
                    choices: [{
                        message: {
                            content: 'I can continue now.',
                            tool_calls: []
                        }
                    }]
                }
            }
        ]
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Ask if needed.' }]
        },
        metadataLabel: 'player_action'
    });

    assert.equal(result.aiResponse, 'I can continue now.');
    assert.deepEqual(questions, ['Which crate serial should I inspect?']);
    assert.equal(result.toolInvocations[0].name, 'requestUserInput');
    assert.equal(result.toolInvocations[0].metadata.answerLength, 'Check the manifest tab for the crate serial.'.length);
    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.ok(toolMessage, 'Expected a requestUserInput tool response message.');
    assert.match(toolMessage.content, /<userInputResponse>/);
    assert.match(toolMessage.content, /<question>Which crate serial should I inspect\?<\/question>/);
    assert.match(toolMessage.content, /<answer>Check the manifest tab for the crate serial\.<\/answer>/);
});

test('requestUserInput returns a tool error when no request handler is configured', async () => {
    const capturedMessagesByRound = [];
    const runtime = createMinimalRuntime({
        capturedMessagesByRound,
        llmResponses: [
            {
                data: {
                    choices: [{
                        message: {
                            content: '',
                            tool_calls: [{
                                id: 'call-input',
                                type: 'function',
                                function: {
                                    name: 'requestUserInput',
                                    arguments: JSON.stringify({
                                        question: 'What should I ask?'
                                    })
                                }
                            }]
                        }
                    }]
                }
            },
            {
                data: {
                    choices: [{
                        message: {
                            content: 'Recovered from missing request handler.',
                            tool_calls: []
                        }
                    }]
                }
            }
        ]
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Ask if needed.' }]
        },
        metadataLabel: 'player_action'
    });

    assert.equal(result.aiResponse, 'Recovered from missing request handler.');
    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.equal(result.toolInvocations[0].metadata.code, 'user_input_unavailable');
    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.match(toolMessage.content, /<toolError>/);
    assert.match(toolMessage.content, /requestUserInput/);
});

test('getHistory can include all log entry types when the tool loop opts in', async () => {
    const chatHistory = [
        {
            id: 'entry-user-generic',
            role: 'user',
            type: 'user-generic-prompt',
            content: 'Audit the oxidized relay clue.',
            locationId: 'loc-1'
        },
        {
            id: 'entry-visible-prose',
            role: 'assistant',
            type: 'player-action',
            content: 'You pocket the relay casing.',
            locationId: 'loc-1'
        },
        {
            id: 'entry-event-summary',
            role: 'assistant',
            type: 'event-summary',
            content: 'Events: the oxidized relay clue was logged as a summary row.',
            locationId: 'loc-1'
        }
    ];
    const capturedMessagesByRound = [];
    const runtime = createMinimalRuntime({
        chatHistory,
        capturedMessagesByRound,
        isAssistantProseLikeEntry: (entry) => entry?.type === 'player-action',
        llmResponses: [
            {
                data: {
                    choices: [{
                        message: {
                            content: '',
                            tool_calls: [{
                                id: 'call-history',
                                type: 'function',
                                function: {
                                    name: 'getHistory',
                                    arguments: JSON.stringify({ query: 'oxidized relay' })
                                }
                            }]
                        }
                    }]
                }
            },
            {
                data: {
                    choices: [{
                        message: {
                            content: 'History reviewed.',
                            tool_calls: []
                        }
                    }]
                }
            }
        ]
    });

    const filtered = runtime.collectHistoryMatches({ query: 'oxidized relay' });
    assert.equal(filtered.returnedCount, 0);

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Search every log entry.' }]
        },
        metadataLabel: 'generic_prompt',
        includeAllHistoryEntryTypes: true
    });

    assert.equal(result.aiResponse, 'History reviewed.');
    assert.equal(result.toolInvocations[0].metadata.returnedCount, 2);
    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.ok(toolMessage, 'Expected a getHistory tool response message.');
    assert.match(toolMessage.content, /user-generic-prompt/);
    assert.match(toolMessage.content, /Audit the oxidized relay clue/);
    assert.match(toolMessage.content, /event-summary/);
    assert.match(toolMessage.content, /oxidized relay clue was logged/);
});

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
    assert.doesNotMatch(debugEvents[1].result.content, /<moreInfoResults>/);
    assert.deepEqual(JSON.parse(debugEvents[1].result.content), {
        query: 'No Such Thing',
        type: 'thing',
        totalMatches: 0,
        npcs: [],
        things: [],
        locations: [],
        regions: []
    });
    assert.equal(debugEvents[1].result.metadata.totalMatches, 0);

    const secondRoundMessages = capturedMessagesByRound[1];
    const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
    assert.ok(toolMessage, 'Expected a tool response message in the second round.');
    assert.doesNotMatch(toolMessage.content, /<moreInfoResults>/);
    assert.equal(JSON.parse(toolMessage.content).totalMatches, 0);
});

test('moreInfo returns matched entities as direct toJSON payloads', async () => {
    const capturedMessagesByRound = [];
    const thingJson = {
        id: 'thing-1',
        name: 'Copper Spindle',
        description: 'A copper spindle.',
        metadata: {
            value: 12,
            customNote: 'raw toJSON field'
        }
    };
    const thing = {
        id: 'thing-1',
        name: 'Copper Spindle',
        toJSON() {
            return { ...thingJson, metadata: { ...thingJson.metadata } };
        }
    };
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_more_info',
                                    type: 'function',
                                    function: {
                                        name: 'moreInfo',
                                        arguments: JSON.stringify({
                                            name: 'Copper',
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
        serializeNpcForClient: value => value,
        buildLocationResponse: value => value,
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
            formatMessagesForErrorLog: messages => JSON.stringify(messages)
        },
        Player: { getAll: () => [] },
        Thing: { getAll: () => [thing] },
        Location: { getAll: () => [], get: () => null },
        Region: { getAll: () => [] },
        getGameLocations: () => new Map(),
        getFactions: () => [],
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Look up the spindle.' }]
        },
        metadataLabel: 'more_info_json_test'
    });

    assert.equal(result.aiResponse, 'Done.');
    assert.equal(result.toolInvocations[0].metadata.totalMatches, 1);
    assert.deepEqual(result.toolInvocations[0].metadata.results.things, [thingJson]);

    const secondRoundMessages = capturedMessagesByRound[1];
    const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
    assert.ok(toolMessage, 'Expected a tool response message in the second round.');
    assert.doesNotMatch(toolMessage.content, /<moreInfoResults>/);
    const payload = JSON.parse(toolMessage.content);
    assert.deepEqual(payload, {
        query: 'Copper',
        type: 'thing',
        totalMatches: 1,
        npcs: [],
        things: [thingJson],
        locations: [],
        regions: []
    });
});

test('moreInfo omits bulky runtime fields unless full state is requested', async () => {
    const capturedMessagesByRound = [];
    const npcJson = {
        id: 'char-party',
        name: 'Gorika',
        description: 'A silver oni gambler.',
        class: 'Gambler',
        inventory: ['thing-dice'],
        abilities: [{ name: 'Oni Luck' }],
        importantMemories: ['Won a loud poker game.'],
        needBars: [
            {
                id: 'stamina',
                effectThresholds: Array.from({ length: 20 }, (_, index) => ({
                    threshold: index,
                    sentence: `Verbose threshold ${index}`
                }))
            }
        ],
        partyMemoryHistorySegments: [
            [
                {
                    role: 'system',
                    content: 'Tool calls for generic_prompt\n' + 'x'.repeat(5000)
                }
            ]
        ],
        partyMembershipChangedThisTurn: false,
        partyMembersAddedThisTurn: [],
        partyMembersRemovedThisTurn: [],
        elapsedTime: 0,
        isInPlayerParty: true,
        wasEverInPlayerParty: true
    };
    const npc = {
        id: 'char-party',
        name: 'Gorika',
        isNPC: true,
        toJSON() {
            return structuredClone(npcJson);
        }
    };
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_more_info_compact',
                                    type: 'function',
                                    function: {
                                        name: 'moreInfo',
                                        arguments: JSON.stringify({
                                            name: 'Gorika',
                                            type: 'character'
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
        serializeNpcForClient: value => value,
        buildLocationResponse: value => value,
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
            formatMessagesForErrorLog: messages => JSON.stringify(messages)
        },
        Player: { getAll: () => [npc] },
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
            messages: [{ role: 'user', content: 'Look up Gorika.' }]
        },
        metadataLabel: 'more_info_compact_test'
    });

    assert.equal(result.aiResponse, 'Done.');
    const compactNpc = result.toolInvocations[0].metadata.results.npcs[0];
    assert.equal(compactNpc.name, 'Gorika');
    assert.equal(compactNpc.description, 'A silver oni gambler.');
    assert.equal(compactNpc.isInPlayerParty, true);
    assert.equal(compactNpc.wasEverInPlayerParty, true);
    assert.equal(Object.hasOwn(compactNpc, 'partyMemoryHistorySegments'), false);
    assert.equal(Object.hasOwn(compactNpc, 'needBars'), false);
    assert.equal(Object.hasOwn(compactNpc, 'partyMembershipChangedThisTurn'), false);

    const secondRoundMessages = capturedMessagesByRound[1];
    const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
    assert.ok(toolMessage, 'Expected a tool response message in the second round.');
    const payload = JSON.parse(toolMessage.content);
    assert.equal(payload.npcs[0].name, 'Gorika');
    assert.equal(Object.hasOwn(payload.npcs[0], 'partyMemoryHistorySegments'), false);
    assert.equal(Object.hasOwn(payload.npcs[0], 'needBars'), false);
    assert.doesNotMatch(toolMessage.content, /Tool calls for generic_prompt/);
});

test('moreInfo omits bulky region and location scaffolding while keeping region secrets', async () => {
    const capturedMessagesByRound = [];
    const regionJson = {
        id: 'region-skyhawk',
        name: 'Skyhawk Express',
        description: 'A haunted luxury train.',
        shortDescription: 'A gilded train.',
        locationBlueprints: [
            {
                name: 'Forward Boiler',
                description: 'A long generated room blueprint.',
                exits: [{ destination: 'Engine Room', travelTimeMinutes: 1 }]
            }
        ],
        randomEvents: ['A chandelier sways ominously.'],
        characterConcepts: ['A suspicious conductor.'],
        enemyConcepts: ['Clockwork boarders.'],
        weatherState: {
            currentWeather: 'Moonlit Fog',
            durationRemainingMinutes: 45
        },
        weather: {
            hasDynamicWeather: true,
            seasonWeather: [{ seasonName: 'Default', weatherTypes: [] }]
        },
        secrets: ['The conductor sold the passenger list.']
    };
    const locationJson = {
        id: 'loc-lounge',
        name: 'Lounge Car',
        description: 'Velvet booths and low brass lamps.',
        shortDescription: 'A plush lounge.',
        imageVariants: {
            'base:storm': { imageId: 'img-storm', generatedAt: '2026-05-16T00:00:00.000Z' }
        },
        stubMetadata: {
            targetRegionId: 'region-hidden',
            stubDescription: 'Large generated hidden-room seed.'
        },
        generationHints: {
            hasWeather: 'outside'
        },
        randomEvents: ['A gramophone skips.'],
        characterConcepts: ['A lounge singer with a secret.'],
        enemyConcepts: ['Cardsharp spirits.'],
        exits: {
            east: {
                id: 'exit-east',
                description: 'To the dining car.',
                destination: 'loc-dining'
            }
        }
    };
    const region = {
        id: 'region-skyhawk',
        name: 'Skyhawk Express',
        toJSON() {
            return structuredClone(regionJson);
        }
    };
    const location = {
        id: 'loc-lounge',
        name: 'Lounge Car',
        toJSON() {
            return structuredClone(locationJson);
        }
    };
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_more_info_region',
                                    type: 'function',
                                    function: {
                                        name: 'moreInfo',
                                        arguments: JSON.stringify({
                                            name: 'Skyhawk',
                                            type: 'region'
                                        })
                                    }
                                },
                                {
                                    id: 'call_more_info_location',
                                    type: 'function',
                                    function: {
                                        name: 'moreInfo',
                                        arguments: JSON.stringify({
                                            name: 'Lounge',
                                            type: 'location'
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
        serializeNpcForClient: value => value,
        buildLocationResponse: value => value,
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
            formatMessagesForErrorLog: messages => JSON.stringify(messages)
        },
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { getAll: () => [location], get: () => null },
        Region: { getAll: () => [region] },
        getGameLocations: () => new Map(),
        getFactions: () => [],
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Look up the train and lounge.' }]
        },
        metadataLabel: 'more_info_region_location_compact_test'
    });

    assert.equal(result.aiResponse, 'Done.');
    const compactRegion = result.toolInvocations[0].metadata.results.regions[0];
    assert.equal(compactRegion.name, 'Skyhawk Express');
    assert.deepEqual(compactRegion.secrets, ['The conductor sold the passenger list.']);
    assert.equal(Object.hasOwn(compactRegion, 'locationBlueprints'), false);
    assert.equal(Object.hasOwn(compactRegion, 'randomEvents'), false);
    assert.equal(Object.hasOwn(compactRegion, 'characterConcepts'), false);
    assert.equal(Object.hasOwn(compactRegion, 'enemyConcepts'), false);
    assert.equal(Object.hasOwn(compactRegion, 'weatherState'), false);

    const compactLocation = result.toolInvocations[1].metadata.results.locations[0];
    assert.equal(compactLocation.name, 'Lounge Car');
    assert.equal(compactLocation.description, 'Velvet booths and low brass lamps.');
    assert.equal(Object.hasOwn(compactLocation, 'imageVariants'), false);
    assert.equal(Object.hasOwn(compactLocation, 'stubMetadata'), false);
    assert.equal(Object.hasOwn(compactLocation, 'generationHints'), false);
    assert.equal(Object.hasOwn(compactLocation, 'randomEvents'), false);
    assert.equal(Object.hasOwn(compactLocation, 'characterConcepts'), false);
    assert.equal(Object.hasOwn(compactLocation, 'enemyConcepts'), false);

    const toolMessages = capturedMessagesByRound[1].filter((message) => message.role === 'tool');
    assert.equal(toolMessages.length, 2);
    assert.deepEqual(JSON.parse(toolMessages[0].content).regions[0].secrets, ['The conductor sold the passenger list.']);
    assert.equal(Object.hasOwn(JSON.parse(toolMessages[0].content).regions[0], 'locationBlueprints'), false);
    assert.equal(Object.hasOwn(JSON.parse(toolMessages[1].content).locations[0], 'imageVariants'), false);
});

test('moreInfo includeFullState returns raw toJSON payloads', async () => {
    const capturedMessagesByRound = [];
    const npcJson = {
        id: 'char-party',
        name: 'Gorika',
        description: 'A silver oni gambler.',
        needBars: [{ id: 'stamina', value: 1000 }],
        partyMemoryHistorySegments: [
            [{ role: 'system', content: 'Tool calls for generic_prompt' }]
        ],
        partyMembershipChangedThisTurn: false
    };
    const npc = {
        id: 'char-party',
        name: 'Gorika',
        isNPC: true,
        toJSON() {
            return structuredClone(npcJson);
        }
    };
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_more_info_full',
                                    type: 'function',
                                    function: {
                                        name: 'moreInfo',
                                        arguments: JSON.stringify({
                                            name: 'Gorika',
                                            type: 'character',
                                            includeFullState: true
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

    const fullRuntime = createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 4 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: value => value,
        buildLocationResponse: value => value,
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
            formatMessagesForErrorLog: messages => JSON.stringify(messages)
        },
        Player: { getAll: () => [npc] },
        Thing: { getAll: () => [] },
        Location: { getAll: () => [], get: () => null },
        Region: { getAll: () => [] },
        getGameLocations: () => new Map(),
        getFactions: () => [],
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });

    const result = await fullRuntime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Look up Gorika with full state.' }]
        },
        metadataLabel: 'more_info_full_state_test'
    });

    assert.equal(result.aiResponse, 'Done.');
    assert.deepEqual(result.toolInvocations[0].metadata.results.npcs, [npcJson]);
    const toolMessage = capturedMessagesByRound[1].find((message) => message.role === 'tool');
    assert.ok(toolMessage, 'Expected a tool response message in the second round.');
    assert.deepEqual(JSON.parse(toolMessage.content).npcs, [npcJson]);
});

test('runChatCompletionWithToolLoop returns toolError and continues after tool-call rounds are exhausted', async () => {
    const capturedRounds = [];
    const debugEvents = [];
    const loggedPrompts = [];
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_allowed',
                                    type: 'function',
                                    function: {
                                        name: 'moreInfo',
                                        arguments: JSON.stringify({
                                            name: 'Missing First Thing',
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
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_exhausted',
                                    type: 'function',
                                    function: {
                                        name: 'moreInfo',
                                        arguments: JSON.stringify({
                                            name: 'Missing Second Thing',
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
                            content: 'Finished after the tool limit.',
                            tool_calls: []
                        }
                    }
                ]
            }
        }
    ];

    const runtime = createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 1 } }),
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
                capturedRounds.push({
                    messages: structuredClone(options.messages),
                    tools: Array.isArray(options.tools) ? structuredClone(options.tools) : options.tools,
                    tool_choice: options.tool_choice
                });
                const response = llmResponses.shift();
                assert.ok(response, 'Expected a queued LLM response for this round.');
                options.onResponse?.(response);
                return response.data.choices[0].message.content || '';
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
            messages: [{ role: 'user', content: 'Look up two things.' }],
            tools: CHAT_TOOL_DEFINITIONS
        },
        metadataLabel: 'tool_exhaustion_test',
        onToolCallDebug: event => {
            debugEvents.push(structuredClone(event));
        }
    });

    assert.equal(result.aiResponse, 'Finished after the tool limit.');
    assert.equal(result.rounds, 3);
    assert.equal(result.toolInvocations.length, 2);
    assert.equal(result.toolInvocations[0].metadata.error, undefined);
    assert.equal(result.toolInvocations[1].name, 'moreInfo');
    assert.equal(result.toolInvocations[1].metadata.error, true);
    assert.equal(result.toolInvocations[1].metadata.code, 'tool_call_attempts_exhausted');
    assert.match(result.toolInvocations[1].metadata.message, /exhausted its tool call attempts/i);

    assert.equal(capturedRounds.length, 3);
    assert.ok(Array.isArray(capturedRounds[0].tools), 'Expected tools to be available before exhaustion.');
    assert.ok(Array.isArray(capturedRounds[1].tools), 'Expected the model to have one chance to finish or exceed the tool limit.');
    assert.equal(capturedRounds[2].tools, undefined, 'Expected tools to be disabled after the exhaustion error.');
    assert.equal(capturedRounds[2].tool_choice, 'none');

    const finalRoundToolMessage = capturedRounds[2].messages.find(message => (
        message.role === 'tool'
        && message.tool_call_id === 'call_exhausted'
    ));
    assert.ok(finalRoundToolMessage, 'Expected a tool exhaustion message before the final round.');
    assert.match(finalRoundToolMessage.content, /<toolError>/);
    assert.match(finalRoundToolMessage.content, /tool_call_attempts_exhausted/);
    assert.match(finalRoundToolMessage.content, /exhausted its tool call attempts/i);

    const exhaustedErrorEvent = debugEvents.find(event => (
        event.phase === 'error'
        && event.id === 'call_exhausted'
    ));
    assert.ok(exhaustedErrorEvent, 'Expected a debug error event for the exhausted tool call.');
    assert.equal(exhaustedErrorEvent.error.code, 'tool_call_attempts_exhausted');
    assert.ok(
        loggedPrompts.some(entry => entry?.prefix === 'tool_exhaustion_test_tool_call_error'),
        'Expected the exhausted tool call to be logged as a tool-call error.'
    );
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

test('getMysteryBox tool returns private notes by alias', async () => {
    IdGenerator.reset();
    MysteryBox.clear();
    new MysteryBox({
        name: 'Captain Ellison',
        keys: ['ELLISON-SEVEN', 'Omega-7 captain'],
        text: 'Ellison used ELLISON-SEVEN as a private verification protocol and evidence trigger.'
    });

    const capturedMessagesByRound = [];
    const debugEvents = [];
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_mystery_1',
                                    type: 'function',
                                    function: {
                                        name: 'getMysteryBox',
                                        arguments: JSON.stringify({
                                            key: 'ellison seven'
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

    try {
        const runtime = createMinimalRuntime({ llmResponses, capturedMessagesByRound });
        const result = await runtime.runChatCompletionWithToolLoop({
            requestOptions: {
                messages: [{ role: 'user', content: 'Review Ellison.' }]
            },
            metadataLabel: 'get_mystery_box_test',
            onToolCallDebug: event => {
                debugEvents.push(structuredClone(event));
            }
        });

        assert.equal(result.aiResponse, 'Done.');
        assert.equal(result.toolInvocations.length, 1);
        assert.equal(result.toolInvocations[0].name, 'getMysteryBox');
        assert.equal(result.toolInvocations[0].metadata.name, 'Captain Ellison');
        assert.equal(debugEvents[1].phase, 'completed');
        assert.match(debugEvents[1].result.content, /<mysteryBox>/);
        assert.match(debugEvents[1].result.content, /ELLISON-SEVEN/);
        assert.match(debugEvents[1].result.content, /private verification protocol/);

        const secondRoundMessages = capturedMessagesByRound[1];
        const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
        assert.ok(toolMessage, 'Expected a tool response message in the second round.');
        assert.match(toolMessage.content, /<mysteryBox>/);
    } finally {
        MysteryBox.clear();
    }
});

test('getMysteryBox tool schema exists', () => {
    const getMysteryBox = findToolDefinition('getMysteryBox');
    assert.ok(getMysteryBox, 'getMysteryBox tool definition should exist');
    assert.deepEqual(getMysteryBox.parameters.required, ['key']);
    assert.equal(getMysteryBox.parameters.properties.key.type, 'string');
});

test('findMysteryBoxes tool returns multiple private notes matching name or key', async () => {
    IdGenerator.reset();
    MysteryBox.clear();
    new MysteryBox({
        name: 'Captain Ellison',
        keys: ['ELLISON-SEVEN', 'Omega-7 captain'],
        text: 'Ellison used ELLISON-SEVEN as a private verification protocol.'
    });
    new MysteryBox({
        name: 'Ellison Vault Discrepancy',
        keys: ['Meridian weapon cases'],
        text: 'The Meridian cases were moved to the vault before the freeze.'
    });
    new MysteryBox({
        name: 'Cipher Insurance',
        keys: ['Chrome Veil'],
        text: 'Cipher was frozen as leverage against her employers.'
    });

    const capturedMessagesByRound = [];
    const debugEvents = [];
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_find_mystery_1',
                                    type: 'function',
                                    function: {
                                        name: 'findMysteryBoxes',
                                        arguments: JSON.stringify({
                                            query: 'ellison'
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

    try {
        const runtime = createMinimalRuntime({ llmResponses, capturedMessagesByRound });
        const result = await runtime.runChatCompletionWithToolLoop({
            requestOptions: {
                messages: [{ role: 'user', content: 'Find Ellison boxes.' }]
            },
            metadataLabel: 'find_mystery_boxes_test',
            onToolCallDebug: event => {
                debugEvents.push(structuredClone(event));
            }
        });

        assert.equal(result.aiResponse, 'Done.');
        assert.equal(result.toolInvocations.length, 1);
        assert.equal(result.toolInvocations[0].name, 'findMysteryBoxes');
        assert.equal(result.toolInvocations[0].metadata.matchCount, 2);
        assert.equal(debugEvents[1].phase, 'completed');
        assert.match(debugEvents[1].result.content, /<mysteryBoxMatches>/);
        assert.match(debugEvents[1].result.content, /<count>2<\/count>/);
        assert.match(debugEvents[1].result.content, /Captain Ellison/);
        assert.match(debugEvents[1].result.content, /Ellison Vault Discrepancy/);
        assert.doesNotMatch(debugEvents[1].result.content, /Cipher Insurance/);

        const secondRoundMessages = capturedMessagesByRound[1];
        const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
        assert.ok(toolMessage, 'Expected a tool response message in the second round.');
        assert.match(toolMessage.content, /<mysteryBoxMatches>/);
    } finally {
        MysteryBox.clear();
    }
});

test('findMysteryBoxes tool schema exists', () => {
    const findMysteryBoxes = findToolDefinition('findMysteryBoxes');
    assert.ok(findMysteryBoxes, 'findMysteryBoxes tool definition should exist');
    assert.deepEqual(findMysteryBoxes.parameters.required, ['query']);
    assert.equal(findMysteryBoxes.parameters.properties.query.type, 'string');
});

test('listMysteryBoxes tool searches note text without returning full notes', async () => {
    IdGenerator.reset();
    MysteryBox.clear();
    new MysteryBox({
        name: 'Captain Ellison',
        keys: ['ELLISON-SEVEN'],
        text: 'The ELLISON-SEVEN protocol was designed as a meridian audit trigger, and this very long private note should not be returned in list output.'
    });
    new MysteryBox({
        name: 'Cipher Insurance',
        keys: ['Chrome Veil'],
        text: 'Cipher was frozen as leverage against her employers.'
    });

    const capturedMessagesByRound = [];
    const debugEvents = [];
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_list_mystery_1',
                                    type: 'function',
                                    function: {
                                        name: 'listMysteryBoxes',
                                        arguments: JSON.stringify({
                                            query: 'meridian audit'
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

    try {
        const runtime = createMinimalRuntime({ llmResponses, capturedMessagesByRound });
        const result = await runtime.runChatCompletionWithToolLoop({
            requestOptions: {
                messages: [{ role: 'user', content: 'List matching mystery boxes.' }]
            },
            metadataLabel: 'list_mystery_boxes_test',
            onToolCallDebug: event => {
                debugEvents.push(structuredClone(event));
            }
        });

        assert.equal(result.aiResponse, 'Done.');
        assert.equal(result.toolInvocations.length, 1);
        assert.equal(result.toolInvocations[0].name, 'listMysteryBoxes');
        assert.equal(result.toolInvocations[0].metadata.matchCount, 1);
        assert.equal(debugEvents[1].phase, 'completed');
        assert.match(debugEvents[1].result.content, /<mysteryBoxList>/);
        assert.match(debugEvents[1].result.content, /<count>1<\/count>/);
        assert.match(debugEvents[1].result.content, /Captain Ellison/);
        assert.match(debugEvents[1].result.content, /ELLISON-SEVEN/);
        assert.doesNotMatch(debugEvents[1].result.content, /<text>/);
        assert.doesNotMatch(debugEvents[1].result.content, /very long private note/);

        const secondRoundMessages = capturedMessagesByRound[1];
        const toolMessage = secondRoundMessages.find((message) => message.role === 'tool');
        assert.ok(toolMessage, 'Expected a tool response message in the second round.');
        assert.match(toolMessage.content, /<mysteryBoxList>/);
    } finally {
        MysteryBox.clear();
    }
});

test('listMysteryBoxes tool returns all mystery boxes when query is blank or omitted', async () => {
    IdGenerator.reset();
    MysteryBox.clear();
    new MysteryBox({
        name: 'Captain Ellison',
        keys: ['ELLISON-SEVEN'],
        text: 'Ellison used ELLISON-SEVEN as a private verification protocol.'
    });
    new MysteryBox({
        name: 'Cipher Insurance',
        keys: ['Chrome Veil'],
        text: 'Cipher was frozen as leverage against her employers.'
    });

    const debugEvents = [];
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_list_mystery_all',
                                    type: 'function',
                                    function: {
                                        name: 'listMysteryBoxes',
                                        arguments: JSON.stringify({})
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

    try {
        const runtime = createMinimalRuntime({ llmResponses });
        const result = await runtime.runChatCompletionWithToolLoop({
            requestOptions: {
                messages: [{ role: 'user', content: 'List all mystery boxes.' }]
            },
            metadataLabel: 'list_all_mystery_boxes_test',
            onToolCallDebug: event => {
                debugEvents.push(structuredClone(event));
            }
        });

        assert.equal(result.aiResponse, 'Done.');
        assert.equal(result.toolInvocations[0].metadata.matchCount, 2);
        assert.match(debugEvents[1].result.content, /<count>2<\/count>/);
        assert.match(debugEvents[1].result.content, /Captain Ellison/);
        assert.match(debugEvents[1].result.content, /Cipher Insurance/);
        assert.doesNotMatch(debugEvents[1].result.content, /<text>/);
    } finally {
        MysteryBox.clear();
    }
});

test('listMysteryBoxes tool schema exists', () => {
    const listMysteryBoxes = findToolDefinition('listMysteryBoxes');
    assert.ok(listMysteryBoxes, 'listMysteryBoxes tool definition should exist');
    assert.deepEqual(listMysteryBoxes.parameters.required || [], []);
    assert.equal(listMysteryBoxes.parameters.properties.query.type, 'string');
});

test('listMysteryThreads tool returns lightweight thread summaries', async () => {
    IdGenerator.reset();
    MysteryBox.clear();
    MysteryThread.clear();
    const box = new MysteryBox({
        name: 'Siphon Saboteur Identity',
        keys: ['Drask'],
        text: 'Kellen Drask is the siphoner.'
    });
    new MysteryThread({
        name: 'Skyhawk Furnace Siphoning',
        keys: ['furnace siphon'],
        status: 'active',
        summary: 'Drask is stealing vitality.',
        constraints: ['Drask is the siphoner.'],
        boxIds: [box.id]
    });

    const debugEvents = [];
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_list_threads',
                                    type: 'function',
                                    function: {
                                        name: 'listMysteryThreads',
                                        arguments: JSON.stringify({ query: 'furnace' })
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

    try {
        const runtime = createMinimalRuntime({ llmResponses });
        const result = await runtime.runChatCompletionWithToolLoop({
            requestOptions: {
                messages: [{ role: 'user', content: 'List threads.' }]
            },
            metadataLabel: 'list_mystery_threads_test',
            onToolCallDebug: event => {
                debugEvents.push(structuredClone(event));
            }
        });

        assert.equal(result.aiResponse, 'Done.');
        assert.equal(result.toolInvocations[0].name, 'listMysteryThreads');
        assert.equal(result.toolInvocations[0].metadata.matchCount, 1);
        assert.match(debugEvents[1].result.content, /<mysteryThreadList>/);
        assert.match(debugEvents[1].result.content, /Skyhawk Furnace Siphoning/);
        assert.match(debugEvents[1].result.content, /Siphon Saboteur Identity/);
        assert.doesNotMatch(debugEvents[1].result.content, /Kellen Drask is the siphoner/);
    } finally {
        MysteryBox.clear();
        MysteryThread.clear();
    }
});

test('getMysteryThread tool returns full private thread continuity and contained boxes', async () => {
    IdGenerator.reset();
    MysteryBox.clear();
    MysteryThread.clear();
    const box = new MysteryBox({
        name: 'Siphon Saboteur Identity',
        keys: ['Drask'],
        text: 'Kellen Drask is the siphoner.'
    });
    new MysteryThread({
        name: 'Skyhawk Furnace Siphoning',
        keys: ['furnace siphon'],
        status: 'active',
        summary: 'Drask is stealing vitality.',
        constraints: ['Drask is the siphoner.'],
        boxIds: [box.id]
    });

    const debugEvents = [];
    const llmResponses = [
        {
            data: {
                choices: [
                    {
                        message: {
                            content: '',
                            tool_calls: [
                                {
                                    id: 'call_get_thread',
                                    type: 'function',
                                    function: {
                                        name: 'getMysteryThread',
                                        arguments: JSON.stringify({ key: 'Skyhawk Furnace' })
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

    try {
        const runtime = createMinimalRuntime({ llmResponses });
        const result = await runtime.runChatCompletionWithToolLoop({
            requestOptions: {
                messages: [{ role: 'user', content: 'Get thread.' }]
            },
            metadataLabel: 'get_mystery_thread_test',
            onToolCallDebug: event => {
                debugEvents.push(structuredClone(event));
            }
        });

        assert.equal(result.aiResponse, 'Done.');
        assert.equal(result.toolInvocations[0].name, 'getMysteryThread');
        assert.match(debugEvents[1].result.content, /<mysteryThread>/);
        assert.match(debugEvents[1].result.content, /Drask is stealing vitality/);
        assert.match(debugEvents[1].result.content, /Kellen Drask is the siphoner/);
    } finally {
        MysteryBox.clear();
        MysteryThread.clear();
    }
});

test('mystery thread tool schemas exist', () => {
    const listMysteryThreads = findToolDefinition('listMysteryThreads');
    const getMysteryThread = findToolDefinition('getMysteryThread');
    assert.ok(listMysteryThreads, 'listMysteryThreads tool definition should exist');
    assert.deepEqual(listMysteryThreads.parameters.required || [], []);
    assert.equal(listMysteryThreads.parameters.properties.query.type, 'string');
    assert.ok(getMysteryThread, 'getMysteryThread tool definition should exist');
    assert.deepEqual(getMysteryThread.parameters.required, ['key']);
    assert.equal(getMysteryThread.parameters.properties.key.type, 'string');
});
