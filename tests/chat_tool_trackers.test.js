const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');
const IdGenerator = require('../IdGenerator.js');
const Tracker = require('../Tracker.js');
const Utils = require('../Utils.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function createRuntime({ currentWorldMinute = 240 } = {}) {
    return createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 1 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => null,
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
        getCurrentWorldMinute: () => currentWorldMinute,
        formatTrackerLastUpdated: (worldMinute) => `${currentWorldMinute - worldMinute} minutes ago`,
        formatTrackerCountdownValue: (untilWorldMinute) => Utils.formatCountdownUntilWorldMinute(untilWorldMinute, {
            currentTotalMinutes: currentWorldMinute
        }),
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

test('tracker tool definitions expose add, update, and remove mutators', () => {
    const addDefinition = findToolDefinition('addTracker');
    const updateDefinition = findToolDefinition('updateTracker');
    const removeDefinition = findToolDefinition('removeTracker');

    assert.ok(addDefinition, 'Expected addTracker definition.');
    assert.ok(updateDefinition, 'Expected updateTracker definition.');
    assert.ok(removeDefinition, 'Expected removeTracker definition.');
    assert.deepEqual(addDefinition.parameters.required, ['name', 'type', 'value', 'description']);
    assert.deepEqual(updateDefinition.parameters.required, ['tracker', 'value']);
    assert.deepEqual(removeDefinition.parameters.required, ['tracker']);
    assert.deepEqual(
        addDefinition.parameters.properties.type.enum,
        ['countdown', 'numerical_count', 'x_out_of_total', 'percentage', 'short_string']
    );
});

test('addTracker creates a stamped plot tracker', async () => {
    IdGenerator.reset();
    Tracker.clear();

    try {
        const runtime = createRuntime({ currentWorldMinute: 240 });
        const result = await executeTool(runtime, 'addTracker', {
            name: 'Gate Stability',
            type: 'percentage',
            value: '60%',
            hiddenFromPlayer: true,
            description: 'Update when the planar gate weakens or stabilizes.'
        });

        assert.match(result.content, /<addTrackerResult>/);
        assert.equal(result.metadata.status, 'success');
        assert.equal(result.metadata.id, 'tracker_1');
        assert.equal(result.metadata.name, 'Gate Stability');
        assert.equal(result.metadata.hiddenFromPlayer, true);

        const tracker = Tracker.getById('tracker_1');
        assert.equal(tracker.value, '60%');
        assert.equal(tracker.lastUpdatedWorldMinute, 240);
    } finally {
        Tracker.clear();
        IdGenerator.reset();
    }
});

test('addTracker derives countdown target time from the current world minute', async () => {
    IdGenerator.reset();
    Tracker.clear();

    try {
        const runtime = createRuntime({ currentWorldMinute: 100 });
        const result = await executeTool(runtime, 'addTracker', {
            name: 'Supply Shuttle Arrival',
            type: 'countdown',
            value: '2 days, 3 hours, 12 minutes',
            hiddenFromPlayer: true,
            description: 'Update only if the deadline changes or the shuttle arrives.'
        });

        assert.equal(result.metadata.status, 'success');
        assert.equal(result.metadata.value, '2 days, 3 hours');
        assert.equal(result.metadata.countdownUntilWorldMinute, 3172);

        const tracker = Tracker.getById('tracker_1');
        assert.equal(tracker.value, '2 days, 3 hours, 12 minutes');
        assert.equal(tracker.countdownUntilWorldMinute, 3172);
    } finally {
        Tracker.clear();
        IdGenerator.reset();
    }
});

test('updateTracker changes the value and last-updated minute', async () => {
    IdGenerator.reset();
    Tracker.clear();

    try {
        new Tracker({
            name: 'Keys Found',
            type: 'x_out_of_total',
            value: '1/3',
            hiddenFromPlayer: false,
            lastUpdatedWorldMinute: 120,
            description: 'Update whenever the party finds or loses key evidence.'
        });

        const runtime = createRuntime({ currentWorldMinute: 180 });
        const result = await executeTool(runtime, 'updateTracker', {
            tracker: 'Keys Found',
            value: '2/3'
        });

        assert.match(result.content, /<updateTrackerResult>/);
        assert.equal(result.metadata.status, 'success');
        assert.equal(result.metadata.value, '2/3');
        assert.equal(result.metadata.lastUpdatedWorldMinute, 180);
        assert.equal(Tracker.getById('tracker_1').value, '2/3');
    } finally {
        Tracker.clear();
        IdGenerator.reset();
    }
});

test('updateTracker resets countdown target time from the current world minute', async () => {
    IdGenerator.reset();
    Tracker.clear();

    try {
        new Tracker({
            name: 'Supply Shuttle Arrival',
            type: 'countdown',
            value: '2 days',
            hiddenFromPlayer: false,
            lastUpdatedWorldMinute: 100,
            deriveCountdownUntilWorldMinute: true,
            description: 'Update only if the deadline changes or the shuttle arrives.'
        });

        const runtime = createRuntime({ currentWorldMinute: 200 });
        const result = await executeTool(runtime, 'updateTracker', {
            tracker: 'Supply Shuttle Arrival',
            value: '90 minutes'
        });

        assert.equal(result.metadata.status, 'success');
        assert.equal(result.metadata.value, '1 hour, 30 minutes');
        assert.equal(result.metadata.countdownUntilWorldMinute, 290);
        assert.equal(Tracker.getById('tracker_1').value, '90 minutes');
        assert.equal(Tracker.getById('tracker_1').countdownUntilWorldMinute, 290);
    } finally {
        Tracker.clear();
        IdGenerator.reset();
    }
});

test('removeTracker deletes the resolved tracker', async () => {
    IdGenerator.reset();
    Tracker.clear();

    try {
        const tracker = new Tracker({
            name: 'Suspicion',
            type: 'numerical_count',
            value: '4',
            hiddenFromPlayer: true,
            lastUpdatedWorldMinute: 10,
            description: 'Update when witnesses grow more or less suspicious.'
        });

        const runtime = createRuntime();
        const result = await executeTool(runtime, 'removeTracker', {
            tracker: tracker.id
        });

        assert.match(result.content, /<removeTrackerResult>/);
        assert.equal(result.metadata.status, 'success');
        assert.equal(result.metadata.id, tracker.id);
        assert.equal(Tracker.getById(tracker.id), null);
    } finally {
        Tracker.clear();
        IdGenerator.reset();
    }
});
