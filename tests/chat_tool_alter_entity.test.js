const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function makeBaseRuntime(overrides = {}) {
    const location = overrides.location || { id: 'loc-1', name: 'Study' };
    const region = overrides.region || { id: 'region-1', name: 'Manor' };
    const npc = overrides.npc || { id: 'npc-1', name: 'Neka', isNPC: true, currentLocation: location.id };
    const thing = overrides.thing || {
        id: 'thing-1',
        name: 'Warped Study Desk',
        thingType: 'scenery',
        metadata: { locationId: location.id }
    };
    let completionCalls = 0;
    const LLMClient = overrides.LLMClient || {
        async chatCompletion(options) {
            completionCalls += 1;
            if (completionCalls === 1) {
                options.onResponse?.(overrides.firstResponse);
                return '';
            }
            const finalResponse = {
                data: {
                    choices: [{
                        message: {
                            content: 'Alteration complete.',
                            tool_calls: []
                        }
                    }]
                }
            };
            options.onResponse?.(finalResponse);
            return 'Alteration complete.';
        },
        logPrompt() {},
        formatMessagesForErrorLog(messages) {
            return JSON.stringify(messages);
        }
    };

    return createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: value => value,
        buildLocationResponse: value => value,
        getCurrentPlayer: () => ({ id: 'player-1', name: 'Player', currentLocation: location.id }),
        createLocationFromEvent: async () => location,
        createRegionStubFromEvent: async () => region,
        generateItemsByNames: async () => [],
        ensureExitConnection: async () => ({}),
        findRegionByLocationId: () => region,
        alterThingByPrompt: overrides.alterThingByPrompt || (async () => ({ originalName: thing.name, newName: thing.name, thing })),
        alterNpcByEvent: overrides.alterNpcByEvent || (async () => ({ npcId: npc.id, originalName: npc.name, name: npc.name })),
        alterLocationByEvent: overrides.alterLocationByEvent || (async () => ({ locationId: location.id, originalName: location.name, newName: location.name })),
        LLMClient,
        Player: { getAll: () => [npc] },
        Thing: { getAll: () => [thing] },
        Location: { get: id => (id === location.id ? location : null), getAll: () => [location] },
        Region: { getAll: () => [region] },
        getGameLocations: () => new Map([[location.id, location]]),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map([[region.id, region]]),
        getPendingRegionStubs: () => new Map()
    });
}

test('alterThing, alterNpc, and alterLocation tool schemas exist', () => {
    const alterThing = findToolDefinition('alterThing');
    assert.ok(alterThing, 'alterThing tool definition should exist');
    assert.deepEqual(alterThing.parameters.required, ['thing', 'alteration']);
    assert.equal(alterThing.parameters.properties.thing.type, 'string');
    assert.equal(alterThing.parameters.properties.alteration.type, 'string');

    const alterNpc = findToolDefinition('alterNpc');
    assert.ok(alterNpc, 'alterNpc tool definition should exist');
    assert.deepEqual(alterNpc.parameters.required, ['npc', 'alteration']);
    assert.equal(alterNpc.parameters.properties.npc.type, 'string');
    assert.equal(alterNpc.parameters.properties.alteration.type, 'string');

    const alterLocation = findToolDefinition('alterLocation');
    assert.ok(alterLocation, 'alterLocation tool definition should exist');
    assert.deepEqual(alterLocation.parameters.required, ['location', 'alteration']);
    assert.equal(alterLocation.parameters.properties.location.type, 'string');
    assert.equal(alterLocation.parameters.properties.region.type, 'string');
    assert.equal(alterLocation.parameters.properties.alteration.type, 'string');
});

test('alterThing forwards resolved thing and alteration to existing alteration helper', async () => {
    const thing = { id: 'thing-1', name: 'Warped Study Desk', thingType: 'scenery', metadata: { locationId: 'loc-1' } };
    let capturedArgs = null;
    const runtime = makeBaseRuntime({
        thing,
        firstResponse: {
            data: {
                choices: [{
                    message: {
                        content: '',
                        tool_calls: [{
                            id: 'call-alter-thing',
                            type: 'function',
                            function: {
                                name: 'alterThing',
                                arguments: JSON.stringify({
                                    thing: 'Warped Study Desk',
                                    alteration: 'Repair the legs, oil the wood, and convert the top drawer into a hidden lockbox.'
                                })
                            }
                        }]
                    }
                }]
            }
        },
        alterThingByPrompt: async (args) => {
            capturedArgs = args;
            return {
                originalName: thing.name,
                newName: 'Repaired Study Desk',
                changeDescription: args.changeDescription,
                thing: { ...thing, id: thing.id, name: 'Repaired Study Desk', thingType: 'scenery' }
            };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Alter the desk.' }] },
        metadataLabel: 'test_alter_thing_tool'
    });

    assert.equal(result.rounds, 2);
    assert.equal(capturedArgs.thing, thing);
    assert.equal(capturedArgs.changeDescription, 'Repair the legs, oil the wood, and convert the top drawer into a hidden lockbox.');
    assert.equal(capturedArgs.newName, null);
    assert.equal(result.toolInvocations[0].metadata.newName, 'Repaired Study Desk');
});

test('alterNpc forwards resolved NPC and alteration through existing event handler wrapper', async () => {
    const npc = { id: 'npc-1', name: 'Neka', isNPC: true, currentLocation: 'loc-1' };
    let capturedArgs = null;
    const runtime = makeBaseRuntime({
        npc,
        firstResponse: {
            data: {
                choices: [{
                    message: {
                        content: '',
                        tool_calls: [{
                            id: 'call-alter-npc',
                            type: 'function',
                            function: {
                                name: 'alterNpc',
                                arguments: JSON.stringify({
                                    npc: 'Neka',
                                    alteration: 'Give her soot-stained gloves and a habit of listening before touching dangerous debris.'
                                })
                            }
                        }]
                    }
                }]
            }
        },
        alterNpcByEvent: async (args) => {
            capturedArgs = args;
            return {
                npcId: npc.id,
                originalName: npc.name,
                name: npc.name,
                changeDescription: args.alteration
            };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Alter Neka.' }] },
        metadataLabel: 'test_alter_npc_tool'
    });

    assert.equal(result.rounds, 2);
    assert.equal(capturedArgs.npc, npc);
    assert.equal(capturedArgs.alteration, 'Give her soot-stained gloves and a habit of listening before touching dangerous debris.');
    assert.equal(result.toolInvocations[0].metadata.npcId, npc.id);
});

test('alterLocation forwards resolved location and alteration through existing event handler wrapper', async () => {
    const location = { id: 'loc-1', name: 'Study' };
    let capturedArgs = null;
    const runtime = makeBaseRuntime({
        location,
        firstResponse: {
            data: {
                choices: [{
                    message: {
                        content: '',
                        tool_calls: [{
                            id: 'call-alter-location',
                            type: 'function',
                            function: {
                                name: 'alterLocation',
                                arguments: JSON.stringify({
                                    location: 'Study',
                                    alteration: 'Repair the broken windows, clear the smoke, and turn the Study into a clean workshop.'
                                })
                            }
                        }]
                    }
                }]
            }
        },
        alterLocationByEvent: async (args) => {
            capturedArgs = args;
            return {
                locationId: location.id,
                originalName: location.name,
                newName: 'Restored Study Workshop',
                changeDescription: args.alteration
            };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Alter the Study.' }] },
        metadataLabel: 'test_alter_location_tool'
    });

    assert.equal(result.rounds, 2);
    assert.equal(capturedArgs.location, location);
    assert.equal(capturedArgs.alteration, 'Repair the broken windows, clear the smoke, and turn the Study into a clean workshop.');
    assert.equal(result.toolInvocations[0].metadata.locationId, location.id);
    assert.equal(result.toolInvocations[0].metadata.newName, 'Restored Study Workshop');
});
