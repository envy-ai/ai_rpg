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
    assert.equal(createThing.parameters.properties.count.type, 'integer');
    assert.equal(createThing.parameters.properties.containerContents.type, 'array');
    assert.equal(
        createThing.parameters.properties.causeStatusEffectOnTarget.properties.needBars.type,
        'array'
    );
});

test('createThing tool schema exposes registered Thing fields at request time', () => {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({
        modName: 'implants',
        entityType: 'thing',
        fieldName: 'implantSlot',
        type: 'string',
        description: 'Implant grouping slot.',
        exposeToCreateTool: true,
        clearThingSlotWhenPresent: true
    });

    const createThing = getChatToolDefinitions({ modExtensionRegistry: registry })
        .find(entry => entry?.function?.name === 'createThing')?.function || null;

    assert.ok(createThing, 'createThing tool definition should exist');
    assert.equal(createThing.parameters.properties.implantSlot.type, 'string');
    assert.match(createThing.parameters.properties.implantSlot.description, /Implant grouping slot/);
});

test('createThing tool forwards core and structured item fields into the thing generation seed', async () => {
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
                                            count: 2,
                                            isContainer: true,
                                            containerContents: [{ name: 'Brass Key', count: 1 }],
                                            attributeBonuses: [{ attribute: 'luck', bonus: 2 }],
                                            causeStatusEffectOnTarget: {
                                                name: 'Marked',
                                                description: 'The target glows.',
                                                duration: '5 minutes',
                                                attributes: [{ name: 'dexterity', modifier: -1 }],
                                                skills: [{ name: 'Stealth', modifier: -2 }],
                                                needBars: [{ name: 'energy', delta: -5 }]
                                            },
                                            properties: 'The lock remembers failed keys.'
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
    assert.equal(capturedGenerateArgs.seeds[0].shortDescription, 'locked oak chest');
    assert.equal(capturedGenerateArgs.seeds[0].count, 2);
    assert.equal(capturedGenerateArgs.seeds[0].isContainer, true);
    assert.deepEqual(capturedGenerateArgs.seeds[0].containerContents, [{ name: 'Brass Key', count: 1 }]);
    assert.deepEqual(capturedGenerateArgs.seeds[0].attributeBonuses, [{ attribute: 'luck', bonus: 2 }]);
    assert.deepEqual(capturedGenerateArgs.seeds[0].causeStatusEffectOnTarget, {
        name: 'Marked',
        description: 'The target glows.',
        duration: '5 minutes',
        attributes: [{ name: 'dexterity', modifier: -1 }],
        skills: [{ name: 'Stealth', modifier: -2 }],
        needBars: [{ name: 'energy', delta: -5 }]
    });
    assert.equal(capturedGenerateArgs.seeds[0].properties, 'The lock remembers failed keys.');
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
        exposeToCreateTool: true,
        clearThingSlotWhenPresent: true
    });
    const location = { id: 'loc-1', name: 'Study' };
    const region = { id: 'region-1', name: 'Manor' };
    const createdThing = {
        id: 'thing-implant-1',
        name: 'Mnemonic Lattice',
        thingType: 'item',
        slot: 'head',
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
                                            slot: 'head',
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
            createdThing.slot = args.seeds[0].slot;
            createdThing.setExtensionField('implantSlot', args.seeds[0].implantSlot);
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
    assert.equal(capturedGenerateArgs.seeds[0].slot, null);
    assert.deepEqual(createdThing.extensionFields, { implantSlot: 'neural' });
    assert.equal(createdThing.slot, null);
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

test('createThing reuses a committed result when the same tool-call id is replayed', async () => {
    const location = { id: 'loc-1', name: 'Study' };
    const region = { id: 'region-1', name: 'Manor' };
    const args = {
        shortDescription: 'a brass astrolabe',
        itemOrScenery: 'item',
        name: 'Brass Astrolabe'
    };
    const responses = [
        toolResponseForCreate(args, 'same-create-call'),
        toolResponseForCreate(args, 'same-create-call'),
        {
            data: {
                choices: [{ message: { content: 'Created once.', tool_calls: [] } }]
            }
        }
    ];
    let generationCalls = 0;
    const LLMClient = {
        async chatCompletion(options) {
            const response = responses.shift();
            options.onResponse?.(response);
            return response.data.choices[0].message.content || '';
        },
        logPrompt() {},
        formatMessagesForErrorLog(messages) { return JSON.stringify(messages); }
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
        generateItemsByNames: async () => {
            generationCalls += 1;
            return [{ id: 'thing-1', name: 'Brass Astrolabe', thingType: 'item' }];
        },
        ensureExitConnection: async () => ({}),
        findRegionByLocationId: () => region,
        LLMClient,
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { get: () => location, getAll: () => [location] },
        Region: { getAll: () => [region] },
        getGameLocations: () => new Map([[location.id, location]]),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map([[region.id, region]]),
        getPendingRegionStubs: () => new Map()
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Create it once.' }] },
        metadataLabel: 'test_create_thing_idempotency'
    });

    assert.equal(generationCalls, 1);
    assert.equal(result.toolInvocations.length, 2);
    assert.equal(result.toolInvocations[0].metadata.cached, false);
    assert.equal(result.toolInvocations[1].metadata.cached, true);
    assert.equal(result.toolInvocations[0].metadata.mutationReceipt.committed, true);
    const replayMessage = result.conversationMessages.find(message => (
        message?.role === 'tool'
        && message?.tool_call_id === 'same-create-call'
        && /already committed/.test(message?.content || '')
    ));
    assert.ok(replayMessage);
});

test('createThing treats different tool-call ids as distinct mutations even with identical arguments', async () => {
    const location = { id: 'loc-1', name: 'Study' };
    const region = { id: 'region-1', name: 'Manor' };
    const args = {
        shortDescription: 'a brass astrolabe',
        itemOrScenery: 'item',
        name: 'Brass Astrolabe'
    };
    const responses = [
        toolResponseForCreate(args, 'first-create-call'),
        toolResponseForCreate(args, 'second-create-call'),
        {
            data: {
                choices: [{ message: { content: 'Created twice.', tool_calls: [] } }]
            }
        }
    ];
    let generationCalls = 0;
    const LLMClient = {
        async chatCompletion(options) {
            const response = responses.shift();
            options.onResponse?.(response);
            return response.data.choices[0].message.content || '';
        },
        logPrompt() {},
        formatMessagesForErrorLog(messages) { return JSON.stringify(messages); }
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
        generateItemsByNames: async () => {
            generationCalls += 1;
            return [{ id: `thing-${generationCalls}`, name: 'Brass Astrolabe', thingType: 'item' }];
        },
        ensureExitConnection: async () => ({}),
        findRegionByLocationId: () => region,
        LLMClient,
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { get: () => location, getAll: () => [location] },
        Region: { getAll: () => [region] },
        getGameLocations: () => new Map([[location.id, location]]),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map([[region.id, region]]),
        getPendingRegionStubs: () => new Map()
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Create two.' }] },
        metadataLabel: 'test_create_thing_distinct_ids'
    });

    assert.equal(generationCalls, 2);
    assert.equal(result.toolInvocations.length, 2);
    assert.equal(result.toolInvocations[0].metadata.cached, false);
    assert.equal(result.toolInvocations[1].metadata.cached, false);
});

test('tool-loop failure reports mutations that committed before the outer prompt failed', async () => {
    const location = { id: 'loc-1', name: 'Study' };
    const region = { id: 'region-1', name: 'Manor' };
    let completionCalls = 0;
    const LLMClient = {
        async chatCompletion(options) {
            completionCalls += 1;
            if (completionCalls === 1) {
                const response = toolResponseForCreate({
                    shortDescription: 'a brass astrolabe',
                    itemOrScenery: 'item',
                    name: 'Brass Astrolabe'
                }, 'committed-before-failure');
                options.onResponse?.(response);
                return '';
            }
            throw new Error('outer completion failed');
        },
        logPrompt() {},
        formatMessagesForErrorLog(messages) { return JSON.stringify(messages); }
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
        generateItemsByNames: async () => [{ id: 'thing-1', name: 'Brass Astrolabe', thingType: 'item' }],
        ensureExitConnection: async () => ({}),
        findRegionByLocationId: () => region,
        LLMClient,
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { get: () => location, getAll: () => [location] },
        Region: { getAll: () => [region] },
        getGameLocations: () => new Map([[location.id, location]]),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map([[region.id, region]]),
        getPendingRegionStubs: () => new Map()
    });

    await assert.rejects(
        runtime.runChatCompletionWithToolLoop({
            requestOptions: { messages: [{ role: 'user', content: 'Create, then fail.' }] },
            metadataLabel: 'test_partial_completion_receipts'
        }),
        error => {
            assert.match(error.message, /Committed mutations before failure:/);
            assert.equal(error.committedMutationReceipts.length, 1);
            assert.equal(error.committedMutationReceipts[0].toolName, 'createThing');
            return true;
        }
    );
});

function toolResponseForCreate(args, id) {
    return {
        data: {
            choices: [{
                message: {
                    content: '',
                    tool_calls: [{
                        id,
                        type: 'function',
                        function: { name: 'createThing', arguments: JSON.stringify(args) }
                    }]
                }
            }]
        }
    };
}
