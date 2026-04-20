const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');

function findCreateThingToolDefinition() {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === 'createThing')?.function || null;
}

test('createThing tool schema exposes isContainer as an allowed seed field', () => {
    const createThing = findCreateThingToolDefinition();
    assert.ok(createThing, 'createThing tool definition should exist');
    assert.equal(createThing.parameters.properties.isContainer.type, 'boolean');
});

test('createThing tool forwards isContainer into the thing generation seed', async () => {
    const location = { id: 'loc-1', name: 'Study' };
    const region = { id: 'region-1', name: 'Manor' };
    let capturedGenerateArgs = null;
    let completionCalls = 0;

    const LLMClient = {
        async chatCompletion(options) {
            completionCalls += 1;
            if (completionCalls === 1) {
                options.onResponse?.({
                    data: {
                        choices: [{
                            message: {
                                content: '',
                                tool_calls: [{
                                    id: 'call-create-container',
                                    type: 'function',
                                    function: {
                                        name: 'createThing',
                                        arguments: JSON.stringify({
                                            shortDescription: 'locked oak chest',
                                            itemOrScenery: 'scenery',
                                            name: 'Locked Oak Chest',
                                            isContainer: true
                                        })
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
                            content: 'Created the chest.',
                            tool_calls: []
                        }
                    }]
                }
            });
            return 'Created the chest.';
        },
        logPrompt() {},
        formatMessagesForErrorLog(messages) {
            return JSON.stringify(messages);
        }
    };

    const runtime = createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: value => value,
        buildLocationResponse: value => value,
        getCurrentPlayer: () => ({ id: 'player-1', name: 'Player', currentLocation: location.id }),
        createLocationFromEvent: async () => location,
        createRegionStubFromEvent: async () => region,
        generateItemsByNames: async (args) => {
            capturedGenerateArgs = args;
            return [{ id: 'thing-1', name: 'Locked Oak Chest', thingType: 'scenery' }];
        },
        ensureExitConnection: async () => ({}),
        findRegionByLocationId: () => region,
        LLMClient,
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { get: id => (id === location.id ? location : null), getAll: () => [location] },
        Region: { getAll: () => [region] },
        getGameLocations: () => new Map([[location.id, location]]),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map([[region.id, region]]),
        getPendingRegionStubs: () => new Map()
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Create a container chest.' }]
        },
        metadataLabel: 'test_create_thing_container'
    });

    assert.equal(result.rounds, 2);
    assert.equal(capturedGenerateArgs.seeds[0].isContainer, true);
    assert.equal(capturedGenerateArgs.options.treatAsScenery, true);
});
