const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');

test('time_passed parser ignores prompt reasoning and parses final duration field', () => {
    const parser = Events._buildParsers().time_passed;

    assert.equal(
        parser('The party searched the room, checked the lock, and regrouped. -> 45 minutes'),
        45,
    );
});

test('time_passed parser uses the final arrow-delimited field when reasoning contains arrows', () => {
    const parser = Events._buildParsers().time_passed;

    assert.equal(
        parser('The character moved from Corridor A -> Corridor B before waiting. -> 10 minutes'),
        10,
    );
});

test('time_passed parser still accepts legacy duration-only responses', () => {
    const parser = Events._buildParsers().time_passed;

    assert.equal(parser('01:30'), 90);
    assert.equal(parser('0'), 0);
});

test('time_passed parser reports invalid final duration field with raw context', () => {
    const parser = Events._buildParsers().time_passed;
    const previousWarn = console.warn;
    const warnings = [];
    console.warn = (message, details) => {
        warnings.push({ message, details });
    };

    try {
        assert.equal(parser('The characters debated for an unclear stretch. -> later maybe'), null);
    } finally {
        console.warn = previousWarn;
    }

    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /invalid time_passed duration/i);
    assert.equal(
        warnings[0].details.value,
        'The characters debated for an unclear stretch. -> later maybe',
    );
    assert.equal(warnings[0].details.durationText, 'later maybe');
});

test('time_passed handler treats full trip-sized durations as ordinary elapsed time', () => {
    const handler = Events._buildHandlers().time_passed;
    const previousPlayer = Globals.currentPlayer;
    const previousWorldTime = Globals.worldTime ? { ...Globals.worldTime } : null;

    try {
        Globals.currentPlayer = { elapsedTime: 100 };
        Globals.elapsedTime = 100;

        const context = { suppressTimePassedAtOrAboveMinutes: 20 };
        handler(20, context);

        assert.equal(Globals.elapsedTime, 120);
        assert.equal(context.timeProgress?.advancedMinutes, 20);
    } finally {
        Globals.currentPlayer = previousPlayer;
        Globals.worldTime = previousWorldTime;
    }
});

test('time_passed handler leaves existing action time progress authoritative', () => {
    const handler = Events._buildHandlers().time_passed;
    const previousAdvanceTime = Globals.advanceTime;
    let advanceCalls = 0;
    const existingTimeProgress = {
        source: 'player_action',
        advancedMinutes: 7
    };

    Globals.advanceTime = () => {
        advanceCalls += 1;
        throw new Error('event-check time should not advance');
    };

    try {
        const context = { timeProgress: existingTimeProgress };
        handler(15, context);

        assert.equal(advanceCalls, 0);
        assert.equal(context.timeProgress, existingTimeProgress);
    } finally {
        Globals.advanceTime = previousAdvanceTime;
    }
});
