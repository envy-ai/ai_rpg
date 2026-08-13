const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');
const Faction = require('../Faction.js');
const IdGenerator = require('../IdGenerator.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function makeRuntime({ factions, firstResponse }) {
    const location = { id: 'loc-1', name: 'Study' };
    const region = { id: 'region-1', name: 'Manor' };
    const currentPlayer = { id: 'player-1', name: 'Player', isNPC: false, currentLocation: location.id };
    const llmResponses = [
        firstResponse,
        {
            data: {
                choices: [{
                    message: {
                        content: 'Done.',
                        tool_calls: []
                    }
                }]
            }
        }
    ];

    return createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: value => value,
        buildLocationResponse: value => value,
        getCurrentPlayer: () => currentPlayer,
        createLocationFromEvent: async () => location,
        createRegionStubFromEvent: async () => region,
        generateItemsByNames: async () => [],
        ensureExitConnection: async () => ({}),
        findRegionByLocationId: () => region,
        LLMClient: {
            async chatCompletion(options) {
                const response = llmResponses.shift();
                assert.ok(response, 'Expected a queued LLM response.');
                options.onResponse?.(response);
                return response.data.choices[0].message.content || '';
            },
            logPrompt() {},
            writeLogFile() {},
            formatMessagesForErrorLog(messages) {
                return JSON.stringify(messages);
            }
        },
        Player: { getAll: () => [currentPlayer] },
        Thing: { getAll: () => [] },
        Location: { get: id => (id === location.id ? location : null), getAll: () => [location] },
        Region: { getAll: () => [region] },
        getGameLocations: () => new Map([[location.id, location]]),
        getFactions: () => factions,
        getRegionsMap: () => new Map([[region.id, region]]),
        getPendingRegionStubs: () => new Map(),
        regenerateShortDescription: async ({ objectType }) => `Generated ${objectType} summary.`
    });
}

function toolResponse(args) {
    return {
        data: {
            choices: [{
                message: {
                    content: '',
                    tool_calls: [{
                        id: 'call-upsert-faction',
                        type: 'function',
                        function: {
                            name: 'upsertFactionFields',
                            arguments: JSON.stringify(args)
                        }
                    }]
                }
            }]
        }
    };
}

async function runTool({ factions, args }) {
    const runtime = makeRuntime({
        factions,
        firstResponse: toolResponse(args)
    });
    return runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: '@Update faction continuity.' }] },
        metadataLabel: 'test_upsert_faction_fields',
        allowDirectShortDescriptionUpdates: true
    });
}

test.beforeEach(() => {
    IdGenerator.reset();
    Faction.clear();
});

test.afterEach(() => {
    Faction.clear();
});

test('upsertFactionFields tool schema exposes create/update and field pairs', () => {
    const tool = findToolDefinition('upsertFactionFields');

    assert.ok(tool, 'upsertFactionFields tool definition should exist');
    assert.deepEqual(tool.parameters.required, ['operation', 'fields']);
    assert.deepEqual(tool.parameters.properties.operation.enum, ['create', 'update']);
    assert.equal(tool.parameters.properties.faction.type, 'string');
    assert.equal(tool.parameters.properties.fields.type, 'object');
    assert.equal(tool.parameters.additionalProperties, false);
});

test('upsertFactionFields creates a persisted Faction instance from field pairs', async () => {
    const factions = new Map();

    const result = await runTool({
        factions,
        args: {
            operation: 'create',
            fields: {
                name: 'The Brass Concord',
                description: 'Artificers who regulate forbidden clockwork.',
                shortDescription: 'Clockwork regulators.',
                tags: ['artificers', 'lawful'],
                goals: ['Control unstable automata.'],
                homeRegionName: 'Manor District',
                assets: [{ name: 'Regulatory Charter', type: 'document' }],
                reputationTiers: [{ threshold: 10, label: 'Trusted', perks: ['Workshop access'] }]
            }
        }
    });

    assert.equal(factions.size, 1);
    const faction = Array.from(factions.values())[0];
    assert.ok(faction instanceof Faction);
    assert.equal(Faction.getByName('The Brass Concord'), faction);
    assert.equal(faction.description, 'Artificers who regulate forbidden clockwork.');
    assert.deepEqual(faction.tags, ['artificers', 'lawful']);
    assert.deepEqual(faction.goals, ['Control unstable automata.']);
    assert.equal(faction.homeRegionName, 'Manor District');
    assert.equal(result.toolInvocations[0].metadata.status, 'success');
    assert.equal(result.toolInvocations[0].metadata.operation, 'create');
    assert.equal(result.toolInvocations[0].metadata.factionId, faction.id);
    assert.deepEqual(result.toolInvocations[0].metadata.updatedFields, Object.keys({
        name: true,
        description: true,
        shortDescription: true,
        tags: true,
        goals: true,
        homeRegionName: true,
        assets: true,
        reputationTiers: true
    }));
});

test('upsertFactionFields updates an existing faction by name', async () => {
    const faction = new Faction({
        name: 'The Guild',
        description: 'Original description.',
        tags: ['old']
    });
    const factions = new Map([[faction.id, faction]]);

    const result = await runTool({
        factions,
        args: {
            operation: 'update',
            faction: 'The Guild',
            fields: {
                description: 'A formal trade guild.',
                tags: ['merchant', 'political']
            }
        }
    });

    assert.equal(faction.description, 'A formal trade guild.');
    assert.equal(faction.shortDescription, 'Generated faction summary.');
    assert.deepEqual(faction.tags, ['merchant', 'political']);
    assert.equal(result.toolInvocations[0].metadata.status, 'success');
    assert.equal(result.toolInvocations[0].metadata.operation, 'update');
    assert.equal(result.toolInvocations[0].metadata.factionId, faction.id);
    assert.deepEqual(result.toolInvocations[0].metadata.updatedFields, ['description', 'tags', 'shortDescription']);
});

test('upsertFactionFields defaults omitted relation fields instead of requiring them', async () => {
    const existing = new Faction({
        name: 'The Guild',
        description: 'Existing faction.'
    });
    const factions = new Map([[existing.id, existing]]);

    const result = await runTool({
        factions,
        args: {
            operation: 'create',
            fields: {
                name: 'The Brass Concord',
                relations: {
                    [existing.id]: {}
                }
            }
        }
    });

    const created = Faction.getByName('The Brass Concord');
    assert.ok(created, 'Expected created faction to be indexed by name.');
    assert.equal(factions.get(created.id), created);
    assert.deepEqual(created.getRelation(existing.id), {
        status: 'neutral',
        notes: 'No explicit relationship provided.'
    });
    assert.equal(result.toolInvocations[0].metadata.status, 'success');
    assert.deepEqual(result.toolInvocations[0].metadata.updatedFields, ['name', 'relations']);
});

test('upsertFactionFields rejects duplicate faction names before mutation', async () => {
    const existing = new Faction({
        name: 'The Guild',
        description: 'Original description.'
    });
    const factions = new Map([[existing.id, existing]]);

    const result = await runTool({
        factions,
        args: {
            operation: 'create',
            fields: {
                name: 'The Guild',
                description: 'Should not be created.'
            }
        }
    });

    assert.equal(factions.size, 1);
    assert.equal(existing.description, 'Original description.');
    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.equal(result.toolInvocations[0].metadata.code, 'duplicate_faction_name');
});
