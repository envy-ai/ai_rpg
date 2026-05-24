const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function createRuntime({ llmResponses, scheduledEvents, capturedMessagesByRound = [] }) {
    return createChatToolRuntime({
        getConfig: () => ({ max_tool_calls: 4 }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => ({ id: 'player-1', currentLocation: 'loc-origin' }),
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
        scheduleEvent: async (args) => {
            scheduledEvents.push(args);
            return {
                id: 'sevent_1',
                event: args.event,
                region: 'Harbor District',
                location: 'Crane Yard',
                dayIndex: 3,
                timeMinutes: 540,
                dateLabel: 'Day 4',
                timeLabel: '9:00 AM'
            };
        },
        LLMClient: {
            chatCompletion: async (options) => {
                capturedMessagesByRound.push(structuredClone(options.messages));
                const response = llmResponses.shift();
                assert.ok(response, 'Expected a queued LLM response.');
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
        getPendingRegionStubs: () => new Map(),
        requestUserInput: null
    });
}

test('scheduleEvent tool definition accepts event, region, location, and one timing mode', () => {
    const definition = findToolDefinition('scheduleEvent');

    assert.ok(definition, 'Expected scheduleEvent chat tool definition.');
    assert.deepEqual(definition.parameters.required, ['event', 'region', 'location']);
    assert.deepEqual(
        Object.keys(definition.parameters.properties).sort(),
        ['at', 'event', 'in', 'location', 'region']
    );
    assert.equal(definition.parameters.additionalProperties, false);
});

test('scheduleEvent tool delegates event scheduling and returns scheduled time XML', async () => {
    const scheduledEvents = [];
    const capturedMessagesByRound = [];
    const runtime = createRuntime({
        scheduledEvents,
        capturedMessagesByRound,
        llmResponses: [
            {
                data: {
                    choices: [{
                        message: {
                            content: '',
                            tool_calls: [{
                                id: 'call-schedule-event',
                                type: 'function',
                                function: {
                                    name: 'scheduleEvent',
                                    arguments: JSON.stringify({
                                        event: 'The crane alarm starts ringing.',
                                        region: 'Harbor District',
                                        location: 'Crane Yard',
                                        in: '2 hours'
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
                            content: 'Scheduled.',
                            tool_calls: []
                        }
                    }]
                }
            }
        ]
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Set up a future alarm.' }],
            tools: CHAT_TOOL_DEFINITIONS
        },
        metadataLabel: 'schedule_event_tool_test'
    });

    assert.equal(result.aiResponse, 'Scheduled.');
    assert.equal(result.toolInvocations[0].metadata.status, 'success');
    assert.deepEqual(scheduledEvents, [{
        event: 'The crane alarm starts ringing.',
        region: 'Harbor District',
        location: 'Crane Yard',
        in: '2 hours'
    }]);
    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.ok(toolMessage, 'Expected a tool response message in the second round.');
    assert.match(toolMessage.content, /<scheduleEventResult>/);
    assert.match(toolMessage.content, /<id>sevent_1<\/id>/);
    assert.match(toolMessage.content, /<dateLabel>Day 4<\/dateLabel>/);
    assert.match(toolMessage.content, /<timeLabel>9:00 AM<\/timeLabel>/);
});

test('scheduleEvent tool rejects calls that provide both in and at', async () => {
    const scheduledEvents = [];
    const capturedMessagesByRound = [];
    const runtime = createRuntime({
        scheduledEvents,
        capturedMessagesByRound,
        llmResponses: [
            {
                data: {
                    choices: [{
                        message: {
                            content: '',
                            tool_calls: [{
                                id: 'call-schedule-event-invalid',
                                type: 'function',
                                function: {
                                    name: 'scheduleEvent',
                                    arguments: JSON.stringify({
                                        event: 'The crane alarm starts ringing.',
                                        region: 'Harbor District',
                                        location: 'Crane Yard',
                                        in: '2 hours',
                                        at: { dayIndex: 3, timeMinutes: 540 }
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
                            content: 'Retry later.',
                            tool_calls: []
                        }
                    }]
                }
            }
        ]
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Set up a future alarm badly.' }],
            tools: CHAT_TOOL_DEFINITIONS
        },
        metadataLabel: 'schedule_event_tool_invalid_test'
    });

    assert.equal(result.toolInvocations[0].metadata.error, true);
    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.ok(toolMessage, 'Expected a tool error response message in the second round.');
    assert.match(toolMessage.content, /Provide exactly one of in or at/i);
    assert.deepEqual(scheduledEvents, []);
});
