const test = require('node:test');
const assert = require('node:assert/strict');

// Match server.js initialization: LLMClient loads ChatToolPolicy before other API dependencies.
require('../LLMClient.js');
const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');
const {
    getEnabledProseChatToolDefinitions,
    getPlayerActionToolDefinitions
} = require('../ChatToolPolicy.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function makeRuntime({
    chatHistory = [],
    sceneSummaries = null,
    summarizeScenesForHistoryRange = null,
    persistSceneSummaries = null
} = {}) {
    const currentPlayer = { id: 'player-1', name: 'Player', isNPC: false, currentLocation: 'loc-1' };
    const location = {
        id: 'loc-1',
        name: 'Hub',
        toJSON() {
            return { id: this.id, name: this.name };
        }
    };
    const region = {
        id: 'region-1',
        name: 'Region',
        locationIds: [location.id],
        toJSON() {
            return { id: this.id, name: this.name, locationIds: this.locationIds };
        }
    };

    return createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => chatHistory,
        getSceneSummaries: () => sceneSummaries,
        summarizeScenesForHistoryRange,
        persistSceneSummaries,
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
            async chatCompletion() {
                throw new Error('LLM should not be called by direct tool tests.');
            },
            logPrompt() {},
            formatMessagesForErrorLog(messages) {
                return JSON.stringify(messages);
            }
        },
        Player: { getAll: () => [currentPlayer] },
        Thing: { getAll: () => [] },
        Location: { get: id => (id === location.id ? location : null), getAll: () => [location] },
        Region: { getAll: () => [region] },
        getGameLocations: () => new Map([[location.id, location]]),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map([[region.id, region]]),
        getPendingRegionStubs: () => new Map()
    });
}

async function executeTool(runtime, functionName, argumentsObject) {
    return runtime.executeChatToolCall({
        id: `call-${functionName}`,
        type: 'function',
        functionName,
        argumentsObject
    });
}

test('chat history mutation tool schemas exist', () => {
    const editTool = findToolDefinition('editChatLogEntry');
    assert.ok(editTool, 'editChatLogEntry tool definition should exist');
    assert.equal(editTool.parameters.properties.entry.type, 'string');
    assert.equal(editTool.parameters.properties.index.type, 'integer');
    assert.equal(editTool.parameters.properties.content.type, 'string');
    assert.ok(editTool.parameters.required.includes('content'));

    const regexTool = findToolDefinition('regexReplace');
    assert.ok(regexTool, 'regexReplace tool definition should exist');
    assert.deepEqual(regexTool.parameters.required, ['pattern', 'replacement']);
    assert.equal(regexTool.parameters.properties.scope.type, 'string');

    const rerunTool = findToolDefinition('rerunSceneSummary');
    assert.ok(rerunTool, 'rerunSceneSummary tool definition should exist');
    assert.deepEqual(rerunTool.parameters.required, ['sceneNumber']);
    assert.equal(rerunTool.parameters.properties.sceneNumber.type, 'integer');

    const editSummaryTool = findToolDefinition('editSceneSummary');
    assert.ok(editSummaryTool, 'editSceneSummary tool definition should exist');
    assert.ok(editSummaryTool.parameters.required.includes('sceneNumber'));
    assert.equal(editSummaryTool.parameters.properties.sceneNumber.type, 'integer');
    assert.equal(editSummaryTool.parameters.properties.summary.type, 'string');
    assert.equal(editSummaryTool.parameters.properties.details.type, 'array');
    assert.equal(editSummaryTool.parameters.properties.quotes.type, 'array');
});

test('chat history mutation tools are unavailable in regular and TinyBrain scopes but available to generic prompts', () => {
    const config = { use_legacy_prompt_checks: false };
    const regularNames = new Set(getEnabledProseChatToolDefinitions({ config }).map(tool => tool.function.name));
    const tinyBrainNames = new Set(getPlayerActionToolDefinitions({ config, tinyBrain: true }).map(tool => tool.function.name));
    const genericNames = new Set(getEnabledProseChatToolDefinitions({ config, allowWorldMutationTools: true }).map(tool => tool.function.name));
    const genericPromptOnlyNames = [
        'editChatLogEntry',
        'regexReplace',
        'bulkUpdateCharacterFields',
        'rerunSceneSummary',
        'editSceneSummary'
    ];

    for (const name of genericPromptOnlyNames) {
        assert.equal(regularNames.has(name), false, `${name} must not be exposed to regular prose`);
        assert.equal(tinyBrainNames.has(name), false, `${name} must not be exposed to TinyBrain player-action prompts`);
        assert.equal(genericNames.has(name), true, `${name} must remain available to generic prompts`);
    }
});

test('editChatLogEntry edits a chat entry by id and replaces event summary rows', async () => {
    const chatHistory = [{
        id: 'msg-1',
        timestamp: '2026-05-28T05:00:00.000Z',
        role: 'assistant',
        type: 'event-summary',
        content: 'Old event text.',
        summaryTitle: 'Events',
        summaryItems: [{ text: 'Old row.' }]
    }];
    const runtime = makeRuntime({ chatHistory });

    const result = await executeTool(runtime, 'editChatLogEntry', {
        entry: 'msg-1',
        content: 'Corrected event text.',
        reason: 'Fix stale event wording.'
    });

    assert.equal(chatHistory[0].content, 'Corrected event text.');
    assert.equal(chatHistory[0].summary, 'Corrected event text.');
    assert.deepEqual(chatHistory[0].summaryItems, [{
        icon: '•',
        text: 'Corrected event text.'
    }]);
    assert.equal(chatHistory[0].summaryTitle, 'Events');
    assert.equal(chatHistory[0].metadata.editedPlainText, true);
    assert.match(chatHistory[0].lastEditedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(result.metadata.status, 'success');
    assert.equal(result.metadata.entryId, 'msg-1');
    assert.equal(result.metadata.index, 0);
    assert.match(result.content, /<editChatLogEntryResult>/);
});

test('editChatLogEntry hides diagnostic old-content previews while preserving success metadata and replacement preview', async () => {
    const diagnosticEntry = {
        id: 'tool-debug-old',
        timestamp: '2026-05-28T05:00:00.000Z',
        role: 'assistant',
        type: 'tool-call-debug',
        content: 'CONFIDENTIAL_OLD_TOOL_ARGUMENTS',
        toolCalls: [{ name: 'updateObjectFields', arguments: { secret: 'CONFIDENTIAL_OLD_TOOL_ARGUMENTS' } }]
    };
    const chatHistory = [diagnosticEntry];
    const runtime = makeRuntime({ chatHistory });

    const result = await executeTool(runtime, 'editChatLogEntry', {
        entry: diagnosticEntry.id,
        content: 'Corrected visible history entry.',
        reason: 'Repair stale diagnostic row.'
    });

    assert.equal(chatHistory[0].content, 'Corrected visible history entry.');
    assert.match(result.content, /<status>success<\/status>/);
    assert.match(result.content, /<id>tool-debug-old<\/id>/);
    assert.match(result.content, /<newContentPreview>Corrected visible history entry\.<\/newContentPreview>/);
    assert.doesNotMatch(result.content, /oldContentPreview|CONFIDENTIAL_OLD_TOOL_ARGUMENTS/);
    assert.deepEqual({
        status: result.metadata.status,
        entryId: result.metadata.entryId,
        index: result.metadata.index,
        oldContentLength: result.metadata.oldContentLength,
        newContentLength: result.metadata.newContentLength
    }, {
        status: 'success',
        entryId: 'tool-debug-old',
        index: 0,
        oldContentLength: 'CONFIDENTIAL_OLD_TOOL_ARGUMENTS'.length,
        newContentLength: 'Corrected visible history entry.'.length
    });
});

test('editChatLogEntry retains old-content preview for ordinary story entries', async () => {
    const chatHistory = [{ id: 'story-old-preview', role: 'assistant', type: 'npc-action', content: 'Mira lowers her guard.' }];
    const result = await executeTool(makeRuntime({ chatHistory }), 'editChatLogEntry', {
        entry: 'story-old-preview',
        content: 'Mira keeps watch.'
    });

    assert.match(result.content, /<oldContentPreview>Mira lowers her guard\.<\/oldContentPreview>/);
    assert.match(result.content, /<newContentPreview>Mira keeps watch\.<\/newContentPreview>/);
});

test('editChatLogEntry edits a chat entry by zero-based index from getHistory results', async () => {
    const chatHistory = [
        { id: 'msg-1', timestamp: '2026-05-28T05:00:00.000Z', role: 'user', content: 'First.' },
        { id: 'msg-2', timestamp: '2026-05-28T05:01:00.000Z', role: 'assistant', content: 'Second.' }
    ];
    const runtime = makeRuntime({ chatHistory });

    const result = await executeTool(runtime, 'editChatLogEntry', {
        index: 1,
        content: 'Second, corrected.'
    });

    assert.equal(chatHistory[0].content, 'First.');
    assert.equal(chatHistory[1].content, 'Second, corrected.');
    assert.equal(result.metadata.entryId, 'msg-2');
    assert.equal(result.metadata.index, 1);
});

test('rerunSceneSummary resolves a stored scene range and reruns that range with redo', async () => {
    const chatHistory = [
        { id: 'msg-1', role: 'user', content: 'A' },
        { id: 'msg-2', role: 'assistant', content: 'B' },
        { id: 'msg-3', role: 'user', content: 'C' }
    ];
    const sceneSummaries = {
        getScenesInOrder() {
            return [{
                startIndex: 2,
                endIndex: 3,
                startEntryId: 'msg-2',
                endEntryId: 'msg-3',
                summary: 'Old summary.'
            }];
        }
    };
    let capturedArgs = null;
    let persistCount = 0;
    const runtime = makeRuntime({
        chatHistory,
        sceneSummaries,
        summarizeScenesForHistoryRange: async (args) => {
            capturedArgs = args;
            return {
                range: { start: 2, end: 3 },
                summarizedRange: { start: 2, end: 3 },
                totalEntries: 3,
                scenes: [{ startIndex: 2, endIndex: 3, summary: 'New summary.' }]
            };
        },
        persistSceneSummaries: () => {
            persistCount += 1;
            return true;
        }
    });

    const result = await executeTool(runtime, 'rerunSceneSummary', {
        sceneNumber: 1,
        reason: 'Refresh after chat edit.'
    });

    assert.equal(capturedArgs.chatHistory, chatHistory);
    assert.equal(capturedArgs.startIndex, 2);
    assert.equal(capturedArgs.endIndex, 3);
    assert.equal(capturedArgs.redo, true);
    assert.equal(persistCount, 1);
    assert.equal(result.metadata.status, 'success');
    assert.equal(result.metadata.sceneNumber, 1);
    assert.equal(result.metadata.originalRange.start, 2);
    assert.equal(result.metadata.persisted, true);
    assert.match(result.content, /<rerunSceneSummaryResult>/);
});

test('editSceneSummary updates an existing scene summary and persists the save copy', async () => {
    let capturedIndex = null;
    let capturedUpdates = null;
    let persistCount = 0;
    const originalScene = {
        startIndex: 2,
        endIndex: 4,
        startEntryId: 'msg-2',
        endEntryId: 'msg-4',
        summary: 'Old summary.',
        details: ['Old detail.'],
        quotes: [{ character: 'Maren', text: 'Old quote.' }]
    };
    const updatedScene = {
        ...originalScene,
        summary: 'Corrected summary.',
        details: ['New detail A.', 'New detail B.'],
        quotes: [{ character: 'Velkathra', text: 'That tracks.' }]
    };
    const sceneSummaries = {
        getScenesInOrder() {
            return [originalScene];
        },
        updateSceneAtDisplayIndex(sceneNumber, updates) {
            capturedIndex = sceneNumber;
            capturedUpdates = updates;
            return updatedScene;
        }
    };
    const runtime = makeRuntime({
        sceneSummaries,
        persistSceneSummaries: () => {
            persistCount += 1;
            return true;
        }
    });

    const result = await executeTool(runtime, 'editSceneSummary', {
        sceneNumber: 1,
        summary: 'Corrected summary.',
        details: ['New detail A.', 'New detail B.'],
        quotes: [{ character: 'Velkathra', text: 'That tracks.' }],
        reason: 'Manual continuity cleanup.'
    });

    assert.equal(capturedIndex, 1);
    assert.deepEqual(capturedUpdates, {
        summary: 'Corrected summary.',
        details: ['New detail A.', 'New detail B.'],
        quotes: [{ character: 'Velkathra', text: 'That tracks.' }]
    });
    assert.equal(persistCount, 1);
    assert.equal(result.metadata.status, 'success');
    assert.equal(result.metadata.sceneNumber, 1);
    assert.equal(result.metadata.persisted, true);
    assert.deepEqual(result.metadata.updatedScene.details, ['New detail A.', 'New detail B.']);
    assert.match(result.content, /<editSceneSummaryResult>/);
});
