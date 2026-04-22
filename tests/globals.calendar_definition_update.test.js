const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');

function buildCalendar(overrides = {}) {
    return {
        yearName: 'Test Reckoning',
        months: [
            { name: 'Ash', lengthDays: 2, seasonName: 'Dawnseason' },
            { name: 'Bloom', lengthDays: 3, seasonName: 'Brightseason' }
        ],
        weekdays: ['Firstday', 'Secondday'],
        seasons: [
            {
                name: 'Dawnseason',
                description: 'The early season.',
                startMonth: 'Ash',
                startDay: 1,
                dayLengthMinutes: null,
                timeDescriptions: [
                    { timeOfDay: 12, description: 'Clear afternoon light.' },
                    { timeOfDay: 0, description: 'Dark early hours.' }
                ]
            },
            {
                name: 'Brightseason',
                description: 'The bright season.',
                startMonth: 'Bloom',
                startDay: 1,
                dayLengthMinutes: null,
                timeDescriptions: [
                    { timeOfDay: 0, description: 'Dim night.' }
                ]
            }
        ],
        holidays: [
            {
                name: 'Ash Wake',
                description: 'A small calendar test holiday.',
                month: 'Ash',
                day: 2
            }
        ],
        ...overrides
    };
}

test('setCalendarDefinition normalizes calendar data and preserves current world time', () => {
    const previousConfig = Globals.config;
    const previousWorldTime = Globals.worldTime;
    const previousCalendarDefinition = Globals.calendarDefinition;

    try {
        Globals.config = null;
        Globals.hydrateWorldTime({
            worldTime: { dayIndex: 1, timeMinutes: 900 },
            calendarDefinition: Globals.generateCalendarDefinition()
        });

        const normalized = Globals.setCalendarDefinition(buildCalendar());

        assert.equal(normalized.yearName, 'Test Reckoning');
        assert.deepEqual(
            normalized.seasons[0].timeDescriptions.map(entry => entry.timeOfDay),
            [0, 12]
        );
        assert.deepEqual(Globals.getSerializedWorldTime(), { dayIndex: 1, timeMinutes: 900 });

        const context = Globals.getWorldTimeContext();
        assert.equal(context.dateLabel, 'Secondday, Ash 2, Test Reckoning 1');
        assert.equal(context.lightLevelDescription, 'Clear afternoon light.');
        assert.equal(context.holidayName, 'Ash Wake');
    } finally {
        Globals.config = previousConfig;
        Globals.worldTime = previousWorldTime;
        Globals.calendarDefinition = previousCalendarDefinition;
    }
});

test('setCalendarDefinition rejects invalid calendars without mutating the active calendar', () => {
    const previousConfig = Globals.config;
    const previousWorldTime = Globals.worldTime;
    const previousCalendarDefinition = Globals.calendarDefinition;

    try {
        Globals.config = null;
        Globals.hydrateWorldTime({
            worldTime: { dayIndex: 0, timeMinutes: 480 },
            calendarDefinition: Globals.generateCalendarDefinition()
        });
        const valid = Globals.setCalendarDefinition(buildCalendar());

        assert.throws(
            () => Globals.setCalendarDefinition(buildCalendar({
                months: [{ name: 'Broken', lengthDays: 0, seasonName: 'Dawnseason' }]
            })),
            /positive integer lengthDays/
        );

        assert.deepEqual(Globals.getSerializedCalendarDefinition(), valid);
    } finally {
        Globals.config = previousConfig;
        Globals.worldTime = previousWorldTime;
        Globals.calendarDefinition = previousCalendarDefinition;
    }
});
