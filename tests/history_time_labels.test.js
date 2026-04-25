const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const {
    formatEntryWorldTimeLabel,
    formatHistoryEntrySpeakerPrefix,
    formatWorldTimeLabel,
    getCurrentWorldTimeSnapshotForHistoryEntry
} = require('../history_time_labels.js');

function buildCalendar() {
    return {
        yearName: 'Cycle',
        months: [
            { name: 'Thawmance', lengthDays: 30, seasonName: 'Thaw' }
        ],
        weekdays: ['Moonday', 'Ashday', 'Rootday', 'Wickday', 'Grinday'],
        seasons: [
            {
                name: 'Thaw',
                description: 'The thawing season.',
                startMonth: 'Thawmance',
                startDay: 1,
                dayLengthMinutes: null,
                timeDescriptions: [
                    { timeOfDay: 0, description: 'Night.' }
                ]
            }
        ],
        holidays: []
    };
}

function withWorldTime(callback, worldTime = { dayIndex: 4, timeMinutes: (8 * 60) + 12 }) {
    const previousConfig = Globals.config;
    const previousWorldTime = Globals.worldTime;
    const previousCalendarDefinition = Globals.calendarDefinition;

    try {
        Globals.config = {
            ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
            time: {
                cycleLengthMinutes: 1440,
                tickMinutes: 15
            }
        };
        Globals.hydrateWorldTime({
            worldTime,
            calendarDefinition: buildCalendar()
        });
        callback();
    } finally {
        Globals.config = previousConfig;
        Globals.worldTime = previousWorldTime;
        Globals.calendarDefinition = previousCalendarDefinition;
    }
}

test('formatWorldTimeLabel renders current-day relative labels with calendar date', () => withWorldTime(() => {
    assert.equal(
        formatWorldTimeLabel({ dayIndex: 4, timeMinutes: (8 * 60) + 12 }),
        'today at 8:12 AM (Grinday, Thawmance 5, Cycle 1)'
    );
}));

test('formatWorldTimeLabel renders prior-day relative labels with calendar date', () => withWorldTime(() => {
    assert.equal(
        formatWorldTimeLabel({ dayIndex: 4, timeMinutes: (8 * 60) + 12 }),
        '3 days ago at 8:12 AM (Grinday, Thawmance 5, Cycle 1)'
    );
}, { dayIndex: 7, timeMinutes: (11 * 60) + 30 }));

test('formatWorldTimeLabel renders previous calendar day as yesterday even across midnight', () => withWorldTime(() => {
    assert.equal(
        formatWorldTimeLabel({ dayIndex: 4, timeMinutes: (23 * 60) + 59 }),
        'yesterday at 11:59 PM (Grinday, Thawmance 5, Cycle 1)'
    );
}, { dayIndex: 5, timeMinutes: 1 }));

test('formatHistoryEntrySpeakerPrefix adds relative in-world time to player and NPC role labels', () => withWorldTime(() => {
    const entry = {
        role: 'user',
        metadata: {
            worldTime: { dayIndex: 4, timeMinutes: (8 * 60) + 12 }
        }
    };

    assert.equal(
        formatHistoryEntrySpeakerPrefix(entry, { roleLabel: 'Exis', roleRaw: 'user' }),
        '[Exis][today at 8:12 AM (Grinday, Thawmance 5, Cycle 1)]'
    );
    assert.equal(
        formatHistoryEntrySpeakerPrefix(entry, { roleLabel: 'Rozalin', roleRaw: 'Rozalin' }),
        '[Rozalin][today at 8:12 AM (Grinday, Thawmance 5, Cycle 1)]'
    );
}));

test('formatHistoryEntrySpeakerPrefix omits in-world time for assistant responses', () => withWorldTime(() => {
    const entry = {
        role: 'assistant',
        metadata: {
            worldTime: { dayIndex: 4, timeMinutes: (8 * 60) + 12 }
        }
    };

    assert.equal(
        formatHistoryEntrySpeakerPrefix(entry, { roleLabel: 'Storyteller', roleRaw: 'assistant' }),
        '[Storyteller]'
    );
}));

test('entry world-time labels use metadata snapshots and omit missing snapshots', () => withWorldTime(() => {
    assert.equal(
        formatEntryWorldTimeLabel({
            metadata: {
                worldTime: { dayIndex: 4, timeMinutes: (8 * 60) + 12 }
            }
        }),
        'today at 8:12 AM (Grinday, Thawmance 5, Cycle 1)'
    );
    assert.equal(formatEntryWorldTimeLabel({ metadata: {} }), '');
}));

test('current world-time snapshots are suitable for persisting on chat entries', () => withWorldTime(() => {
    assert.deepEqual(
        getCurrentWorldTimeSnapshotForHistoryEntry(),
        { dayIndex: 4, timeMinutes: (8 * 60) + 12 }
    );
}));
