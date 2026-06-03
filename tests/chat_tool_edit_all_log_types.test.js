const test = require('node:test');
const assert = require('node:assert/strict');

const { createChatToolRuntime } = require('../chat_tool_calls.js');

function makeRuntime({ chatHistory = [], isAssistantProseLikeEntry = () => true } = {}) {
    return createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => chatHistory,
        isAssistantProseLikeEntry,
        serializeNpcForClient: value => value,
        buildLocationResponse: value => value,
        getCurrentPlayer: () => ({
            id: 'player-1',
            name: 'Player',
            isNPC: false,
            currentLocation: 'loc-1'
        }),
        createLocationFromEvent: async () => ({ id: 'loc-1', name: 'Hub' }),
        createRegionStubFromEvent: async () => ({ id: 'region-1', name: 'Region' }),
        generateItemsByNames: async () => [],
        ensureExitConnection: async () => ({}),
        findRegionByLocationId: () => null,
        LLMClient: {
            async chatCompletion() {
                throw new Error('LLM should not be called by direct tool tests.');
            },
            logPrompt() {},
            formatMessagesForErrorLog(messages) {
                return JSON.stringify(messages);
            }
        },
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { get: () => null, getAll: () => [] },
        Region: { getAll: () => [] },
        getGameLocations: () => new Map(),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });
}

async function executeEdit(runtime, args) {
    return runtime.executeChatToolCall({
        id: 'call-editChatLogEntry',
        type: 'function',
        functionName: 'editChatLogEntry',
        argumentsObject: args
    });
}

test('getHistory all-entry mode searches summary-only structured log entries', () => {
    const chatHistory = [{
        id: 'plausibility-1',
        timestamp: '2026-06-02T10:00:00.000Z',
        role: 'assistant',
        type: 'plausibility',
        summary: 'Plausibility: relay clue can be examined.',
        plausibility: {
            raw: 'relay clue can be examined',
            structured: { type: 'Plausible' }
        }
    }];
    const runtime = makeRuntime({
        chatHistory,
        isAssistantProseLikeEntry: () => false
    });

    const filtered = runtime.collectHistoryMatches({
        query: 'relay clue',
        includeAllEntryTypes: false
    });
    assert.equal(filtered.returnedCount, 0);

    const allTypes = runtime.collectHistoryMatches({
        query: 'relay clue',
        includeAllEntryTypes: true
    });
    assert.equal(allTypes.returnedCount, 1);
    assert.equal(allTypes.entries[0].id, 'plausibility-1');
    assert.equal(allTypes.entries[0].content, 'Plausibility: relay clue can be examined.');
});

test('editChatLogEntry replaces event-summary structured rows with authoritative plain text', async () => {
    const chatHistory = [{
        id: 'event-1',
        timestamp: '2026-06-02T10:01:00.000Z',
        role: 'assistant',
        type: 'event-summary',
        content: '📋 Events\nOld event text.',
        summary: '📋 Events\nOld event text.',
        summaryTitle: '📋 Events',
        summaryItems: [{ icon: '📍', text: 'Old event row.' }]
    }];
    const runtime = makeRuntime({ chatHistory });

    const result = await executeEdit(runtime, {
        entry: 'event-1',
        content: 'Corrected event row.'
    });

    assert.equal(chatHistory[0].content, 'Corrected event row.');
    assert.equal(chatHistory[0].summary, 'Corrected event row.');
    assert.deepEqual(chatHistory[0].summaryItems, [{
        icon: '•',
        text: 'Corrected event row.'
    }]);
    assert.equal(chatHistory[0].summaryTitle, '📋 Events');
    assert.equal(result.metadata.replacedStructuredDisplay, true);
});

test('editChatLogEntry replaces status-summary structured rows with authoritative plain text', async () => {
    const chatHistory = [{
        id: 'status-1',
        timestamp: '2026-06-02T10:02:00.000Z',
        role: 'assistant',
        type: 'status-summary',
        content: '🌀 Status Changes\nOld status text.',
        summaryTitle: '🌀 Status Changes',
        summaryItems: [{ icon: '🩸', text: 'Old status row.' }]
    }];
    const runtime = makeRuntime({ chatHistory });

    const result = await executeEdit(runtime, {
        entry: 'status-1',
        content: 'Corrected status row.'
    });

    assert.equal(chatHistory[0].content, 'Corrected status row.');
    assert.equal(chatHistory[0].summary, 'Corrected status row.');
    assert.deepEqual(chatHistory[0].summaryItems, [{
        icon: '•',
        text: 'Corrected status row.'
    }]);
    assert.equal(chatHistory[0].summaryTitle, '🌀 Status Changes');
    assert.equal(result.metadata.replacedStructuredDisplay, true);
});

test('editChatLogEntry replaces check-results structured rows with authoritative plain text', async () => {
    const chatHistory = [{
        id: 'checks-1',
        timestamp: '2026-06-02T10:03:00.000Z',
        role: 'assistant',
        type: 'check-results',
        content: 'Checks for player_action\n\n1. Old check\nStatus: completed',
        summary: 'Checks: 1 check, 1 complete, 0 errors.',
        checkResults: [{
            sequence: 1,
            kind: 'skill',
            status: 'completed',
            summary: 'Old check'
        }]
    }];
    const runtime = makeRuntime({ chatHistory });

    const result = await executeEdit(runtime, {
        entry: 'checks-1',
        content: 'Corrected check result.'
    });

    assert.equal(chatHistory[0].content, 'Corrected check result.');
    assert.equal(chatHistory[0].summary, 'Corrected check result.');
    assert.deepEqual(chatHistory[0].checkResults, []);
    assert.equal(result.metadata.replacedStructuredDisplay, true);
});

test('editChatLogEntry replaces diagnostic tool-call records with authoritative plain text', async () => {
    const chatHistory = [{
        id: 'debug-1',
        timestamp: '2026-06-02T10:04:00.000Z',
        role: 'system',
        type: 'tool-call-debug',
        content: 'Tool calls for player_action\n\n1. oldTool\nStatus: completed',
        summary: 'Tool call debug: 1 call, 1 complete, 0 errors.',
        toolCalls: [{ sequence: 1, name: 'oldTool', status: 'completed' }]
    }];
    const runtime = makeRuntime({ chatHistory });

    const result = await executeEdit(runtime, {
        entry: 'debug-1',
        content: 'Corrected debug note.'
    });

    assert.equal(chatHistory[0].content, 'Corrected debug note.');
    assert.equal(chatHistory[0].summary, 'Corrected debug note.');
    assert.deepEqual(chatHistory[0].toolCalls, []);
    assert.equal(result.metadata.replacedStructuredDisplay, true);
});

test('editChatLogEntry replaces summary-only structured entries with searchable plain text', async () => {
    const chatHistory = [{
        id: 'skill-1',
        timestamp: '2026-06-02T10:05:00.000Z',
        role: 'assistant',
        type: 'skill-check',
        summary: 'Skill check: old relay detail.',
        skillCheck: { skill: 'Investigation', result: 'Success' }
    }];
    const runtime = makeRuntime({ chatHistory });

    const result = await executeEdit(runtime, {
        entry: 'skill-1',
        content: 'Corrected relay skill note.'
    });

    assert.equal(chatHistory[0].content, 'Corrected relay skill note.');
    assert.equal(chatHistory[0].summary, 'Corrected relay skill note.');
    assert.equal(chatHistory[0].skillCheck, null);
    assert.equal(result.metadata.replacedStructuredDisplay, true);

    const matches = runtime.collectHistoryMatches({
        query: 'corrected relay',
        includeAllEntryTypes: true
    });
    assert.equal(matches.returnedCount, 1);
    assert.equal(matches.entries[0].content, 'Corrected relay skill note.');
}
);
