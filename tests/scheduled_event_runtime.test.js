const test = require('node:test');
const assert = require('node:assert/strict');

const IdGenerator = require('../IdGenerator.js');
const ScheduledEvent = require('../ScheduledEvent.js');
const Utils = require('../Utils.js');
const {
    createScheduledEventScheduler,
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
