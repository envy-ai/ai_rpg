const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function createRuntime({ createdQuestCalls = [], createQuestFromEvent } = {}) {
    const questCreator = Object.prototype.hasOwnProperty.call(arguments[0] || {}, 'createQuestFromEvent')
        ? createQuestFromEvent
        : async (args) => {
            createdQuestCalls.push(args);
            return {
                questsAwarded: [{
                    id: 'quest_1',
                    name: 'Repair the Beacon',
                    summary: args.summary,
                    giver: args.giver || '',
                    accepted: true
                }],
                updatedQuests: []
            };
        };
    return createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 1 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => ({ id: 'player-1', name: 'Ari' }),
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
        createQuestFromEvent: questCreator,
        LLMClient: {
            chatCompletion: async () => '',
            logPrompt: () => {},
            formatMessagesForErrorLog: (messages) => JSON.stringify(messages)
        },
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: {},
        Region: {},
        getGameLocations: () => new Map(),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });
}

async function executeTool(runtime, functionName, argumentsObject) {
    return runtime.executeChatToolCall({
        id: `call-${functionName}`,
        functionName,
        argumentsObject,
        argumentsText: JSON.stringify(argumentsObject)
    });
}

test('createQuest tool definition accepts a quest summary and optional giver', () => {
    const definition = findToolDefinition('createQuest');

    assert.ok(definition, 'Expected createQuest chat tool definition.');
    assert.deepEqual(definition.parameters.required, ['summary']);
    assert.deepEqual(
        Object.keys(definition.parameters.properties).sort(),
        ['giver', 'summary']
    );
    assert.equal(definition.parameters.additionalProperties, false);
});

test('createQuest delegates to the quest event-generation path', async () => {
    const createdQuestCalls = [];
    const runtime = createRuntime({ createdQuestCalls });

    const result = await executeTool(runtime, 'createQuest', {
        summary: 'Repair the crashed shuttle beacon so rescue can find the party.',
        giver: 'Captain Vale'
    });

    assert.match(result.content, /<createQuestResult>/);
    assert.equal(result.metadata.status, 'success');
    assert.deepEqual(createdQuestCalls, [{
        summary: 'Repair the crashed shuttle beacon so rescue can find the party.',
        giver: 'Captain Vale'
    }]);
    assert.equal(result.metadata.questsAwarded[0].id, 'quest_1');
    assert.equal(result.metadata.questsAwarded[0].name, 'Repair the Beacon');
    assert.match(result.content, /<quest>/);
    assert.match(result.content, /<id>quest_1<\/id>/);
    assert.match(result.content, /<name>Repair the Beacon<\/name>/);
});

test('createQuest returns a tool error when quest creation is unavailable', async () => {
    const runtime = createRuntime({
        createQuestFromEvent: null
    });

    const result = await executeTool(runtime, 'createQuest', {
        summary: 'Investigate the missing archive key.'
    });

    assert.equal(result.metadata.error, true);
    assert.match(result.content, /createQuest handler is not configured/);
});
