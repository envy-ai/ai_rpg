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

test('parseDurationToMinutes accepts compact adjacent unit forms and abbreviations', () => {
    assert.equal(Utils.parseDurationToMinutes('3d4h2m'), 4562);
    assert.equal(Utils.parseDurationToMinutes('1d11h30m'), 2130);
    assert.equal(Utils.parseDurationToMinutes('4hr, 15min'), 255);
    assert.equal(Utils.parseDurationToMinutes('2hrs15mins'), 135);
    assert.equal(Utils.parseDurationToMinutes('90m'), 90);
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

test('formatMinutesAsDuration renders day/hour/minute labels from minute values', () => {
    assert.equal(Utils.formatMinutesAsDuration(240), '4 hours');
    assert.equal(Utils.formatMinutesAsDuration(1501), '1 day, 1 hour, 1 minute');
    assert.equal(Utils.formatMinutesAsDuration(1440), '1 day');
    assert.equal(Utils.formatMinutesAsDuration(60), '1 hour');
    assert.equal(Utils.formatMinutesAsDuration(0), '0 minutes');
});

test('formatMinutesAsDuration can append ago for negative values', () => {
    assert.equal(Utils.formatMinutesAsDuration(-65, { includeAgo: true }), '1 hour, 5 minutes ago');
    assert.equal(Utils.formatMinutesAsDuration(-1440, { includeAgo: true }), '1 day ago');
});
