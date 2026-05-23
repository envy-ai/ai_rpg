const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime, getChatToolDefinitions } = require('../chat_tool_calls.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');

function findCreateThingToolDefinition() {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === 'createThing')?.function || null;
}

test('createThing tool schema exposes isContainer as an allowed seed field', () => {
    const createThing = findCreateThingToolDefinition();
    assert.ok(createThing, 'createThing tool definition should exist');
    assert.equal(createThing.parameters.properties.isContainer.type, 'boolean');
});

test('createThing tool schema exposes registered Thing fields at request time', () => {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({
        modName: 'implants',
        entityType: 'thing',
        fieldName: 'implantSlot',
        type: 'string',
        description: 'Implant grouping slot.',
        exposeToCreateTool: true
    });

    const createThing = getChatToolDefinitions({ modExtensionRegistry: registry })
        .find(entry => entry?.function?.name === 'createThing')?.function || null;

    assert.ok(createThing, 'createThing tool definition should exist');
    assert.equal(createThing.parameters.properties.implantSlot.type, 'string');
    assert.match(createThing.parameters.properties.implantSlot.description, /Implant grouping slot/);
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

test('createThing tool forwards and preserves registered Thing fields', async () => {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({
        modName: 'implants',
        entityType: 'thing',
        fieldName: 'implantSlot',
        type: 'string',
        description: 'Implant grouping slot.',
        exposeToCreateTool: true
    });
    const location = { id: 'loc-1', name: 'Study' };
    const region = { id: 'region-1', name: 'Manor' };
    const createdThing = {
        id: 'thing-implant-1',
        name: 'Mnemonic Lattice',
        thingType: 'item',
        extensionFields: {},
        setExtensionField(fieldName, value) {
            this.extensionFields[fieldName] = value;
        }
    };
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
                                    id: 'call-create-implant',
                                    type: 'function',
                                    function: {
                                        name: 'createThing',
                                        arguments: JSON.stringify({
                                            shortDescription: 'a memory lattice implant',
                                            itemOrScenery: 'item',
                                            name: 'Mnemonic Lattice',
                                            implantSlot: 'neural'
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
                            content: 'Created the implant.',
                            tool_calls: []
                        }
                    }]
                }
            });
            return 'Created the implant.';
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
            return [createdThing];
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
        getPendingRegionStubs: () => new Map(),
        getModExtensionRegistry: () => registry
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Create a neural implant.' }]
        },
        metadataLabel: 'test_create_thing_implant_field'
    });

    assert.equal(result.rounds, 2);
    assert.equal(capturedGenerateArgs.seeds[0].implantSlot, 'neural');
    assert.deepEqual(createdThing.extensionFields, { implantSlot: 'neural' });
});

test('createThing tool queues requested names for named thing seeds', async () => {
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
                                    id: 'call-create-named-thing',
                                    type: 'function',
                                    function: {
                                        name: 'createThing',
                                        arguments: JSON.stringify({
                                            shortDescription: 'prototype signal board',
                                            itemOrScenery: 'item',
                                            name: 'Velkathra Signal Board',
                                            description: 'A rescued prototype board.'
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
                            content: 'Created the board.',
                            tool_calls: []
                        }
                    }]
                }
            });
            return 'Created the board.';
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
            return [{ id: 'thing-1', name: 'Velkathra Signal Board', thingType: 'item' }];
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

    await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: 'Create a named signal board.' }]
        },
        metadataLabel: 'test_create_thing_named_seed'
    });

    assert.deepEqual(capturedGenerateArgs.itemNames, ['Velkathra Signal Board']);
    assert.equal(capturedGenerateArgs.seeds[0].name, 'Velkathra Signal Board');
});
