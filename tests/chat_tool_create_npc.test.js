const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function makeRuntime({ toolArgs, locationOverrides = {}, generateNpcFromEvent }) {
    const location = {
        id: 'loc-1',
        name: 'Study',
        baseLevel: 4,
        ...locationOverrides
    };
    const region = { id: 'region-1', name: 'Manor' };
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
                                    id: 'call-create-npc',
                                    type: 'function',
                                    function: {
                                        name: 'createNpc',
                                        arguments: JSON.stringify(toolArgs)
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
                            content: 'Created the NPC.',
                            tool_calls: []
                        }
                    }]
                }
            });
            return 'Created the NPC.';
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
        generateNpcFromEvent,
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
}

test('createNpc tool schema exposes NPC seed fields', () => {
    const createNpc = findToolDefinition('createNpc');

    assert.ok(createNpc, 'createNpc tool definition should exist');
    assert.equal(createNpc.parameters.minProperties, 1);
    assert.equal(createNpc.parameters.properties.name.type, 'string');
    assert.equal(createNpc.parameters.properties.shortDescription.type, 'string');
    assert.equal(createNpc.parameters.properties.role.type, 'string');
    assert.equal(createNpc.parameters.properties.level.type, 'integer');
    assert.equal(createNpc.parameters.properties.isHostile.type, 'boolean');
    assert.equal(createNpc.parameters.properties.hiddenFromPlayer.type, 'boolean');
});

test('createNpc forwards seed data to the single NPC generator at the current location', async () => {
    let capturedArgs = null;
    const runtime = makeRuntime({
        toolArgs: {
            name: 'Mira Vale',
            shortDescription: 'sharp-eyed quartermaster',
            description: 'Mira keeps the expedition ledger in flawless order.',
            role: 'quartermaster',
            class: 'logistician',
            race: 'human',
            level: 7,
            currency: 12,
            isHostile: false,
            hiddenFromPlayer: true,
            aiNotes: 'Tracks supply debts carefully.',
            notes: 'Tie her to the missing shipment subplot.'
        },
        generateNpcFromEvent: async (args) => {
            capturedArgs = args;
            return {
                id: 'npc-1',
                name: 'Mira Vale',
                isNPC: true,
                currentLocation: args.location.id
            };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: '@Create an NPC quartermaster.' }]
        },
        metadataLabel: 'test_create_npc_tool'
    });

    assert.equal(result.rounds, 2);
    assert.equal(capturedArgs.name, 'Mira Vale');
    assert.equal(capturedArgs.location.id, 'loc-1');
    assert.equal(capturedArgs.region.id, 'region-1');
    assert.equal(capturedArgs.additionalInstructions, 'Tie her to the missing shipment subplot.');
    assert.deepEqual(capturedArgs.npc, {
        name: 'Mira Vale',
        shortDescription: 'sharp-eyed quartermaster',
        description: 'Mira keeps the expedition ledger in flawless order.',
        role: 'quartermaster',
        class: 'logistician',
        race: 'human',
        relativeLevel: 3,
        currency: 12,
        isHostile: false,
        hiddenFromPlayer: true,
        aiNotes: 'Tracks supply debts carefully.'
    });
    assert.equal(result.toolInvocations[0].metadata.npcId, 'npc-1');
    assert.equal(result.toolInvocations[0].metadata.finalName, 'Mira Vale');
});
