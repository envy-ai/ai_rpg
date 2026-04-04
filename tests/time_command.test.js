const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const TimeCommand = require('../slashcommands/time.js');

test('time command advances time by a signed duration and reports vehicle arrivals', async () => {
    const previousGameLoaded = Globals.gameLoaded;
    Globals.gameLoaded = true;

    try {
        const replies = [];
        const calls = [];

        await TimeCommand.execute({
            argsText: '9 hours',
            adjustWorldTimeByMinutes: async (minutes, options = {}) => {
                calls.push({ minutes, options });
                return {
                    vehicleArrivals: [{ vehicleId: 'v1' }, { vehicleId: 'v2' }],
                    worldTime: {
                        timeLabel: '3:00 PM',
                        dateLabel: 'Moonday, Ember 2, Common Reckoning 1'
                    }
                };
            },
            reply: async (payload) => {
                replies.push(payload);
            }
        });

        assert.deepEqual(calls, [
            {
                minutes: 540,
                options: { source: 'slash_command_time' }
            }
        ]);
        assert.equal(replies.length, 1);
        assert.match(replies[0].content, /Advanced time by 9 hours\./);
        assert.match(replies[0].content, /Current world time: 3:00 PM on Moonday, Ember 2, Common Reckoning 1\./);
        assert.match(replies[0].content, /Processed 2 due vehicle arrivals\./);
    } finally {
        Globals.gameLoaded = previousGameLoaded;
    }
});

test('time command warns when rewinding time', async () => {
    const previousGameLoaded = Globals.gameLoaded;
    Globals.gameLoaded = true;

    try {
        const replies = [];
        const calls = [];

        await TimeCommand.execute({
            argsText: '- 1d5h',
            adjustWorldTimeByMinutes: async (minutes, options = {}) => {
                calls.push({ minutes, options });
                return {
                    vehicleArrivals: [],
                    worldTime: {
                        timeLabel: '7:00 AM',
                        dateLabel: 'Sunday, Frost 9, Common Reckoning 1'
                    }
                };
            },
            reply: async (payload) => {
                replies.push(payload);
            }
        });

        assert.deepEqual(calls, [
            {
                minutes: -1740,
                options: { source: 'slash_command_time' }
            }
        ]);
        assert.equal(replies.length, 1);
        assert.match(replies[0].content, /Turned back the clock by 1 day and 5 hours\./);
        assert.match(replies[0].content, /rewinding time does not undo prior arrivals, expired effects, offscreen actions, or other already-processed time-based changes/i);
    } finally {
        Globals.gameLoaded = previousGameLoaded;
    }
});

test('time command fails loudly when invoked without an argument', async () => {
    const previousGameLoaded = Globals.gameLoaded;
    Globals.gameLoaded = true;

    try {
        await assert.rejects(
            () => TimeCommand.execute({
                argsText: '',
                adjustWorldTimeByMinutes: async () => ({}),
                reply: async () => {}
            }),
            /Usage: \/time <signed duration>/
        );
    } finally {
        Globals.gameLoaded = previousGameLoaded;
    }
});
