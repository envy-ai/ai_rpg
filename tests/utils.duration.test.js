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

test('parseDurationToMinutes can accept an optional unary sign when allowSigned is enabled', () => {
    assert.equal(
        Utils.parseDurationToMinutes('+10m', { allowSigned: true }),
        10
    );
    assert.equal(
        Utils.parseDurationToMinutes('-3 hours, 2 minutes', { allowSigned: true }),
        -182
    );
    assert.equal(
        Utils.parseDurationToMinutes('- 1d5h', { allowSigned: true }),
        -1740
    );
});

test('parseDurationToMinutes scrubs non-time punctuation without inserting spaces', () => {
    assert.equal(Utils.parseDurationToMinutes('8+ hours'), 480);
    assert.equal(Utils.parseDurationToMinutes('5 minute(s)'), 5);
    assert.equal(Utils.parseDurationToMinutes('1 day (and) 2 hours'), 1560);
    assert.equal(
        Utils.parseDurationToMinutes('-(3 hours, 2 minutes)', { allowSigned: true }),
        -182
    );
});

test('parseDurationToMinutes still rejects signed values unless allowSigned is enabled', () => {
    assert.throws(
        () => Utils.parseDurationToMinutes('-10m'),
        /malformed separators or unknown units/
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

test('formatMinutesAsNaturalDuration renders natural-language joins for day/hour/minute values', () => {
    assert.equal(Utils.formatMinutesAsNaturalDuration(1), '1 minute');
    assert.equal(Utils.formatMinutesAsNaturalDuration(243), '4 hours and 3 minutes');
    assert.equal(Utils.formatMinutesAsNaturalDuration(2880), '2 days');
    assert.equal(Utils.formatMinutesAsNaturalDuration(1624), '1 day, 3 hours, and 4 minutes');
    assert.equal(Utils.formatMinutesAsNaturalDuration(1800), '1 day and 6 hours');
    assert.equal(Utils.formatMinutesAsNaturalDuration(0), '0 minutes');
});

test('formatMinutesAsNaturalDuration can append ago for negative values', () => {
    assert.equal(Utils.formatMinutesAsNaturalDuration(-65, { includeAgo: true }), '1 hour and 5 minutes ago');
    assert.equal(Utils.formatMinutesAsNaturalDuration(-1440, { includeAgo: true }), '1 day ago');
});

test('formatAbsoluteWorldMinutesAgo formats absolute minute timestamps against the current world minute count', () => {
    assert.equal(
        Utils.formatAbsoluteWorldMinutesAgo(1500, { currentTotalMinutes: 3124 }),
        '1 day, 3 hours, and 4 minutes ago'
    );
    assert.equal(
        Utils.formatAbsoluteWorldMinutesAgo(60, { currentTotalMinutes: 120 }),
        '1 hour ago'
    );
    assert.equal(
        Utils.formatAbsoluteWorldMinutesAgo(120, { currentTotalMinutes: 120 }),
        '0 minutes ago'
    );
});
