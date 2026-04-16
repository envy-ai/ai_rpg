const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

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
