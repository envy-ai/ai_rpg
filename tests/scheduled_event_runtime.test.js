const test = require('node:test');
const assert = require('node:assert/strict');

const IdGenerator = require('../IdGenerator.js');
const ScheduledEvent = require('../ScheduledEvent.js');
const Utils = require('../Utils.js');
const {
    buildDeterministicScheduledEventToolCalls,
    createScheduledEventScheduler,
    executeDeterministicScheduledEventToolPlan,
    parseScheduledEventResultXml
} = require('../scheduled_event_runtime.js');

function createFakeWorld() {
    const regions = [
        { id: 'region-harbor', name: 'Harbor District', locationIds: ['loc-crane-yard'] },
        { id: 'region-foundry', name: 'Old Foundry', locationIds: ['loc-smelter'] }
    ];
    const locations = [
        { id: 'loc-crane-yard', name: 'Crane Yard', regionId: 'region-harbor' },
        { id: 'loc-smelter', name: 'Smelter Floor', regionId: 'region-foundry' }
    ];
    const Region = {
        get: id => regions.find(region => region.id === id) || null,
        getByName: name => regions.find(region => region.name.toLowerCase() === String(name).trim().toLowerCase()) || null,
        getAll: () => regions
    };
    const Location = {
        get: id => locations.find(location => location.id === id) || null,
        findByName: name => locations.find(location => location.name.toLowerCase() === String(name).trim().toLowerCase()) || null,
        getAll: () => locations
    };
    const Globals = {
        getTotalWorldMinutes: () => 600,
        getTimeConfig: () => ({ cycleLengthMinutes: 1440 }),
        formatDate: worldTime => `Day ${worldTime.dayIndex + 1}`,
        formatTime: worldTime => `${worldTime.timeMinutes}m`
    };
    return { Globals, Location, Region };
}

function makeScheduler() {
    const world = createFakeWorld();
    return createScheduledEventScheduler({
        ...world,
        Utils,
        ScheduledEvent,
        findRegionByLocationId: (locationId) => world.Region.getAll()
            .find(region => Array.isArray(region.locationIds) && region.locationIds.includes(locationId)) || null
    });
}

test('createScheduledEventScheduler schedules relative and exact future events', async () => {
    IdGenerator.reset();
    ScheduledEvent.clear();

    try {
        const scheduler = makeScheduler();
        const relative = await scheduler.scheduleEvent({
            event: 'The crane alarm starts ringing.',
            region: 'Harbor District',
            location: 'Crane Yard',
            in: '2 hours'
        });
        const exact = await scheduler.scheduleEvent({
            event: 'The watch changes shift.',
            region: 'region-harbor',
            location: 'loc-crane-yard',
            at: { dayIndex: 0, timeMinutes: 750 }
        });

        assert.equal(relative.id, 'sevent_1');
        assert.equal(relative.dayIndex, 0);
        assert.equal(relative.timeMinutes, 720);
        assert.equal(relative.dateLabel, 'Day 1');
        assert.equal(relative.timeLabel, '720m');
        assert.equal(exact.id, 'sevent_2');
        assert.equal(exact.timeMinutes, 750);

        const stored = ScheduledEvent.getById(relative.id);
        assert.equal(stored.event, 'The crane alarm starts ringing.');
        assert.equal(stored.regionId, 'region-harbor');
        assert.equal(stored.locationId, 'loc-crane-yard');
        assert.equal(stored.targetWorldMinute, 720);
    } finally {
        ScheduledEvent.clear();
        IdGenerator.reset();
    }
});

test('createScheduledEventScheduler rejects locations outside the specified region', async () => {
    IdGenerator.reset();
    ScheduledEvent.clear();

    try {
        const scheduler = makeScheduler();
        await assert.rejects(
            () => scheduler.scheduleEvent({
                event: 'The furnace coughs black smoke.',
                region: 'Harbor District',
                location: 'Smelter Floor',
                in: '30 minutes'
            }),
            /Location "Smelter Floor" is not in region "Harbor District"/
        );
    } finally {
        ScheduledEvent.clear();
        IdGenerator.reset();
    }
});

test('createScheduledEventScheduler resolves same-named locations inside the specified region', async () => {
    IdGenerator.reset();
    ScheduledEvent.clear();

    try {
        const regions = [
            { id: 'region-harbor', name: 'Harbor District', locationIds: ['loc-harbor-yard'] },
            { id: 'region-foundry', name: 'Old Foundry', locationIds: ['loc-foundry-yard'] }
        ];
        const locations = [
            { id: 'loc-foundry-yard', name: 'Crane Yard', regionId: 'region-foundry' },
            { id: 'loc-harbor-yard', name: 'Crane Yard', regionId: 'region-harbor' }
        ];
        const scheduler = createScheduledEventScheduler({
            Globals: {
                getTotalWorldMinutes: () => 600,
                getTimeConfig: () => ({ cycleLengthMinutes: 1440 }),
                formatDate: worldTime => `Day ${worldTime.dayIndex + 1}`,
                formatTime: worldTime => `${worldTime.timeMinutes}m`
            },
            Utils,
            ScheduledEvent,
            Region: {
                get: id => regions.find(region => region.id === id) || null,
                getByName: name => regions.find(region => region.name.toLowerCase() === String(name).trim().toLowerCase()) || null,
                getAll: () => regions
            },
            Location: {
                get: id => locations.find(location => location.id === id) || null,
                findByName: () => locations[0],
                getAll: () => locations
            },
            findRegionByLocationId: (locationId) => regions
                .find(region => Array.isArray(region.locationIds) && region.locationIds.includes(locationId)) || null
        });

        const result = await scheduler.scheduleEvent({
            event: 'The harbor crane alarm starts ringing.',
            region: 'Harbor District',
            location: 'Crane Yard',
            in: '10 minutes'
        });

        assert.equal(result.locationId, 'loc-harbor-yard');
        assert.equal(ScheduledEvent.getById(result.id).locationId, 'loc-harbor-yard');
    } finally {
        ScheduledEvent.clear();
        IdGenerator.reset();
    }
});

test('parseScheduledEventResultXml handles happened and empty scheduled event results', () => {
    assert.deepEqual(
        parseScheduledEventResultXml('<scheduledEventResult/>'),
        { happened: false, summary: '', proseForPlayer: '' }
    );
    assert.deepEqual(
        parseScheduledEventResultXml(`
            <scheduledEventResult>
                <summary>The alarm draws dockhands to the crane yard.</summary>
                <proseForPlayer>The crane alarm starts ringing overhead.</proseForPlayer>
            </scheduledEventResult>
        `),
        {
            happened: true,
            summary: 'The alarm draws dockhands to the crane yard.',
            proseForPlayer: 'The crane alarm starts ringing overhead.'
        }
    );
});

test('deterministic scheduled event execution runs exact direct updates and caches successful retries', async () => {
    const plan = {
        event: 'Change QA Marker description exactly.',
        stateChangeRequired: true,
        directUpdates: [{
            objectType: 'thing',
            objectId: 'thing-qa-marker',
            objectName: 'QA Marker',
            field: 'description',
            value: 'The exact replacement.',
            eventValue: 'The exact replacement.'
        }],
        otherTools: []
    };
    assert.deepEqual(buildDeterministicScheduledEventToolCalls(plan), [{
        id: 'scheduled_event_plan_1',
        functionName: 'updateObjectFields',
        argumentsObject: {
            objectType: 'thing',
            object: 'thing-qa-marker',
            fields: { description: 'The exact replacement.' }
        },
        argumentsText: '{"objectType":"thing","object":"thing-qa-marker","fields":{"description":"The exact replacement."}}'
    }]);

    const cache = new Map();
    const calls = [];
    const validateToolCall = toolCall => {
        assert.equal(toolCall.name, 'updateObjectFields');
        assert.deepEqual(toolCall.argumentsObject.fields, { description: 'The exact replacement.' });
    };
    const executeChatToolCall = async toolCall => {
        calls.push(toolCall);
        return {
            content: '<updateObjectFieldsResult><status>success</status></updateObjectFieldsResult>',
            metadata: {
                status: 'success',
                objectType: 'thing',
                objectId: 'thing-qa-marker',
                objectName: 'QA Marker',
                updatedFields: ['description'],
                updatedValues: { description: 'The exact replacement.' }
            }
        };
    };

    const first = await executeDeterministicScheduledEventToolPlan(plan, {
        executeChatToolCall,
        validateToolCall,
        resultCache: cache
    });
    const retry = await executeDeterministicScheduledEventToolPlan(plan, {
        executeChatToolCall,
        validateToolCall,
        resultCache: cache
    });

    assert.equal(calls.length, 1);
    assert.equal(first.invocations[0].metadata.cached, undefined);
    assert.equal(retry.invocations[0].metadata.cached, true);
    assert.deepEqual(retry.invocations[0].argumentsObject.fields, {
        description: 'The exact replacement.'
    });
});

test('deterministic scheduled event execution handles no-change plans and rejects richer tools', async () => {
    const noChange = await executeDeterministicScheduledEventToolPlan({
        event: 'The bell rings once.',
        stateChangeRequired: false,
        directUpdates: [],
        otherTools: []
    }, {
        executeChatToolCall: async () => {
            throw new Error('No tool should run.');
        },
        validateToolCall: () => {
            throw new Error('No tool should be validated.');
        }
    });
    assert.deepEqual(noChange, { toolCalls: [], invocations: [] });

    await assert.rejects(
        () => executeDeterministicScheduledEventToolPlan({
            event: 'Create an NPC.',
            stateChangeRequired: true,
            directUpdates: [],
            otherTools: [{
                name: 'createNpc',
                argumentsObject: { name: 'Someone' },
                purpose: 'Create the scheduled arrival.'
            }]
        }, {
            executeChatToolCall: async () => ({ content: 'unused' }),
            validateToolCall: () => true
        }),
        /only supports direct updateObjectFields plans/
    );
});

test('deterministic scheduled event execution retries failed calls without repeating successful mutations', async () => {
    const plan = {
        event: 'Update the surviving marker and the missing marker.',
        stateChangeRequired: true,
        directUpdates: [
            {
                objectType: 'thing',
                objectId: 'thing-surviving-marker',
                objectName: 'QA Surviving Marker',
                field: 'description',
                value: 'Updated exactly once.'
            },
            {
                objectType: 'thing',
                objectId: 'thing-missing-marker',
                objectName: 'QA Missing Marker',
                field: 'description',
                value: 'This update cannot be applied.'
            }
        ],
        otherTools: []
    };
    const executionCounts = new Map();
    const executeChatToolCall = async toolCall => {
        const objectId = toolCall.argumentsObject.object;
        executionCounts.set(objectId, (executionCounts.get(objectId) || 0) + 1);
        if (objectId === 'thing-missing-marker') {
            return {
                content: [
                    '<toolError>',
                    '  <function>updateObjectFields</function>',
                    '  <code>target_not_found</code>',
                    '  <message>No thing matches the requested target.</message>',
                    '  <candidates count="0"></candidates>',
                    '</toolError>'
                ].join('\n'),
                metadata: {
                    error: true,
                    functionName: 'updateObjectFields',
                    code: 'target_not_found',
                    message: 'No thing matches the requested target.',
                    candidates: []
                }
            };
        }
        return {
            content: '<updateObjectFieldsResult><status>success</status></updateObjectFieldsResult>',
            metadata: {
                status: 'success',
                objectType: 'thing',
                objectId,
                objectName: 'QA Surviving Marker',
                updatedFields: ['description'],
                updatedValues: { description: 'Updated exactly once.' }
            }
        };
    };
    const validateToolCall = () => true;
    const cache = new Map();

    const first = await executeDeterministicScheduledEventToolPlan(plan, {
        executeChatToolCall,
        validateToolCall,
        resultCache: cache
    });
    const retry = await executeDeterministicScheduledEventToolPlan(plan, {
        executeChatToolCall,
        validateToolCall,
        resultCache: cache
    });

    assert.equal(executionCounts.get('thing-surviving-marker'), 1);
    assert.equal(executionCounts.get('thing-missing-marker'), 2);
    assert.equal(first.invocations[0].metadata.cached, undefined);
    assert.equal(retry.invocations[0].metadata.cached, true);
    assert.equal(first.invocations[1].metadata.error, true);
    assert.equal(first.invocations[1].metadata.code, 'target_not_found');
    assert.equal(retry.invocations[1].metadata.error, true);
    assert.equal(retry.invocations[1].metadata.cached, undefined);
    assert.equal(cache.size, 1);
});
