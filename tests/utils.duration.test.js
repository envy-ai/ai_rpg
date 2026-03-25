const test = require('node:test');
const assert = require('node:assert/strict');

const Utils = require('../Utils.js');

test('parseDurationToMinutes accepts decimal unit quantities and rounds to the nearest minute', () => {
    assert.equal(Utils.parseDurationToMinutes('2.5 hours'), 150);
    assert.equal(Utils.parseDurationToMinutes('1.25 hours'), 75);
    assert.equal(Utils.parseDurationToMinutes('2.4 minutes'), 2);
    assert.equal(Utils.parseDurationToMinutes('2.5 minutes'), 3);
    assert.equal(Utils.parseDurationToMinutes('1 day, 2.5 hours, 30.5 minutes'), 1621);
});

test('parseDurationToMinutes rounds decimal numeric minute inputs', () => {
    assert.equal(Utils.parseDurationToMinutes(2.4), 2);
    assert.equal(Utils.parseDurationToMinutes(2.5), 3);
});

test('parseDurationToMinutes still rejects bare decimal strings without units', () => {
    assert.throws(
        () => Utils.parseDurationToMinutes('2.5'),
        /Expected HH:MM, integer minutes, or day\/hour\/minute\/round units/
    );
});
