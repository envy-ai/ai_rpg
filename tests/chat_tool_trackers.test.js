const test = require('node:test');
const assert = require('node:assert/strict');

const { createChatToolRuntime, getChatToolDefinitions } = require('../chat_tool_calls.js');
const Globals = require('../Globals.js');
const IdGenerator = require('../IdGenerator.js');
const Tracker = require('../Tracker.js');
const Utils = require('../Utils.js');

function findToolDefinition(name) {
    return getChatToolDefinitions().find(entry => entry?.function?.name === name)?.function || null;
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
    const previousConfig = Globals.config;
    Globals.config = { trackers: { short_string_max_words: 4 } };

    try {
    const addDefinition = findToolDefinition('addTracker');
    const updateDefinition = findToolDefinition('updateTracker');
    const removeDefinition = findToolDefinition('removeTracker');

    assert.ok(addDefinition, 'Expected addTracker definition.');
    assert.ok(updateDefinition, 'Expected updateTracker definition.');
    assert.ok(removeDefinition, 'Expected removeTracker definition.');
    assert.deepEqual(addDefinition.parameters.required || [], []);
    assert.deepEqual(updateDefinition.parameters.required || [], []);
    assert.deepEqual(removeDefinition.parameters.required || [], []);
    assert.equal(addDefinition.parameters.properties.items.type, 'array');
    assert.deepEqual(addDefinition.parameters.properties.items.items.required, ['name', 'type', 'value', 'description']);
    assert.equal(updateDefinition.parameters.properties.items.type, 'array');
    assert.deepEqual(updateDefinition.parameters.properties.items.items.required, ['tracker', 'value']);
    assert.equal(removeDefinition.parameters.properties.items.type, 'array');
    assert.deepEqual(removeDefinition.parameters.properties.items.items.required, ['tracker']);
    assert.equal(addDefinition.parameters.properties.note.type, 'string');
    assert.match(addDefinition.parameters.properties.note.description, /why the initial value is what it is/i);
    assert.match(addDefinition.parameters.properties.note.description, /100 words or fewer/i);
    assert.equal(updateDefinition.parameters.properties.note.type, 'string');
    assert.match(updateDefinition.parameters.properties.note.description, /why the new value is what it is/i);
    assert.match(updateDefinition.parameters.properties.note.description, /100 words or fewer/i);
    assert.deepEqual(
        addDefinition.parameters.properties.type.enum,
        ['countdown', 'numerical_count', 'x_out_of_total', 'percentage', 'short_string']
    );
    assert.match(addDefinition.parameters.properties.value.description, /at most four words for short_string/);
    assert.doesNotMatch(addDefinition.parameters.properties.value.description, /six words/);
    } finally {
        Globals.config = previousConfig;
    }
});

test('tracker tool definitions describe configured short_string limit', () => {
    const previousConfig = Globals.config;
    Globals.config = { trackers: { short_string_max_words: 6 } };

    try {
        const addDefinition = findToolDefinition('addTracker');
        assert.match(addDefinition.parameters.properties.value.description, /at most six words for short_string/);
        assert.doesNotMatch(addDefinition.parameters.properties.value.description, /four words/);
    } finally {
        Globals.config = previousConfig;
    }
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
            description: 'Update when the planar gate weakens or stabilizes.',
            note: 'The gate is stable because two anchors are still intact.'
        });

        assert.match(result.content, /<addTrackerResult>/);
        assert.equal(result.metadata.status, 'success');
        assert.equal(result.metadata.id, 'tracker_1');
        assert.equal(result.metadata.name, 'Gate Stability');
        assert.equal(result.metadata.hiddenFromPlayer, true);
        assert.equal(result.metadata.note, 'The gate is stable because two anchors are still intact.');
        assert.match(result.content, /<note>The gate is stable because two anchors are still intact\.<\/note>/);

        const tracker = Tracker.getById('tracker_1');
        assert.equal(tracker.value, '60%');
        assert.equal(tracker.note, 'The gate is stable because two anchors are still intact.');
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

test('addTracker batch attempts every item and reports per-item failures', async () => {
    IdGenerator.reset();
    Tracker.clear();

    try {
        const runtime = createRuntime({ currentWorldMinute: 240 });
        const result = await executeTool(runtime, 'addTracker', {
            items: [
                {
                    name: 'Gate Stability',
                    type: 'percentage',
                    value: '60%',
                    hiddenFromPlayer: true,
                    description: 'Update when the planar gate weakens or stabilizes.',
                    note: 'The gate is stable because two anchors are still intact.'
                },
                {
                    name: 'Oracle Mood',
                    type: 'short_string',
                    value: 'one two three four five',
                    description: 'Update when the oracle mood changes.'
                },
                {
                    name: 'Supply Shuttle Arrival',
                    type: 'countdown',
                    value: '90 minutes',
                    description: 'Update only if the deadline changes or the shuttle arrives.'
                }
            ]
        });

        assert.match(result.content, /<addTrackerBatchResult>/);
        assert.equal(result.metadata.status, 'partial_success');
        assert.equal(result.metadata.successCount, 2);
        assert.equal(result.metadata.failureCount, 1);
        assert.deepEqual(result.metadata.items.map(entry => entry.status), ['success', 'error', 'success']);
        assert.equal(result.metadata.items[1].code, 'invalid_tracker');
        assert.match(result.metadata.items[1].message, /short_string value must be four words or fewer/);
        assert.equal(Tracker.getAll().length, 2);
        assert.equal(Tracker.getById('tracker_1').name, 'Gate Stability');
        assert.equal(Tracker.getById('tracker_2').name, 'Supply Shuttle Arrival');
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
            value: '2/3',
            note: 'A second key was recovered from the sealed archive.'
        });

        assert.match(result.content, /<updateTrackerResult>/);
        assert.equal(result.metadata.status, 'success');
        assert.equal(result.metadata.value, '2/3');
        assert.equal(result.metadata.note, 'A second key was recovered from the sealed archive.');
        assert.equal(result.metadata.lastUpdatedWorldMinute, 180);
        assert.equal(Tracker.getById('tracker_1').value, '2/3');
        assert.equal(Tracker.getById('tracker_1').note, 'A second key was recovered from the sealed archive.');
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

test('updateTracker batch attempts every item and leaves failed items unchanged', async () => {
    IdGenerator.reset();
    Tracker.clear();

    try {
        const keys = new Tracker({
            name: 'Keys Found',
            type: 'x_out_of_total',
            value: '1/3',
            hiddenFromPlayer: false,
            lastUpdatedWorldMinute: 120,
            description: 'Update whenever the party finds or loses key evidence.'
        });
        const suspicion = new Tracker({
            name: 'Suspicion',
            type: 'percentage',
            value: '20%',
            hiddenFromPlayer: true,
            lastUpdatedWorldMinute: 120,
            description: 'Update when witnesses grow more or less suspicious.'
        });

        const runtime = createRuntime({ currentWorldMinute: 180 });
        const result = await executeTool(runtime, 'updateTracker', {
            items: [
                {
                    tracker: keys.id,
                    value: '2/3',
                    note: 'A second key was recovered from the sealed archive.'
                },
                {
                    tracker: 'Missing Tracker',
                    value: '50%'
                },
                {
                    tracker: suspicion.id,
                    value: 'high'
                }
            ]
        });

        assert.match(result.content, /<updateTrackerBatchResult>/);
        assert.equal(result.metadata.status, 'partial_success');
        assert.equal(result.metadata.successCount, 1);
        assert.equal(result.metadata.failureCount, 2);
        assert.deepEqual(result.metadata.items.map(entry => entry.status), ['success', 'error', 'error']);
        assert.equal(result.metadata.items[1].code, 'tracker_not_found');
        assert.equal(result.metadata.items[2].code, 'invalid_tracker_value');
        assert.equal(Tracker.getById(keys.id).value, '2/3');
        assert.equal(Tracker.getById(keys.id).note, 'A second key was recovered from the sealed archive.');
        assert.equal(Tracker.getById(suspicion.id).value, '20%');
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
        assert.equal(result.metadata.name, 'Suspicion');
        assert.equal(result.metadata.hiddenFromPlayer, true);
        assert.equal(Tracker.getById(tracker.id), null);
    } finally {
        Tracker.clear();
        IdGenerator.reset();
    }
});

test('removeTracker batch attempts every item and reports missing trackers', async () => {
    IdGenerator.reset();
    Tracker.clear();

    try {
        const suspicion = new Tracker({
            name: 'Suspicion',
            type: 'numerical_count',
            value: '4',
            hiddenFromPlayer: true,
            lastUpdatedWorldMinute: 10,
            description: 'Update when witnesses grow more or less suspicious.'
        });
        const clock = new Tracker({
            name: 'Clock',
            type: 'countdown',
            value: '2 hours',
            hiddenFromPlayer: true,
            lastUpdatedWorldMinute: 10,
            deriveCountdownUntilWorldMinute: true,
            description: 'Update only if the clock deadline changes.'
        });

        const runtime = createRuntime();
        const result = await executeTool(runtime, 'removeTracker', {
            items: [
                { tracker: suspicion.id },
                { tracker: 'Missing Tracker' },
                { tracker: clock.id }
            ]
        });

        assert.match(result.content, /<removeTrackerBatchResult>/);
        assert.equal(result.metadata.status, 'partial_success');
        assert.equal(result.metadata.successCount, 2);
        assert.equal(result.metadata.failureCount, 1);
        assert.deepEqual(result.metadata.items.map(entry => entry.status), ['success', 'error', 'success']);
        assert.deepEqual(result.metadata.items.map(entry => entry.hiddenFromPlayer), [true, undefined, true]);
        assert.equal(result.metadata.items[1].code, 'tracker_not_found');
        assert.equal(Tracker.getById(suspicion.id), null);
        assert.equal(Tracker.getById(clock.id), null);
    } finally {
        Tracker.clear();
        IdGenerator.reset();
    }
});
