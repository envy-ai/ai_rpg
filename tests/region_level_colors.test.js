'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getRegionColors, capturePlayerSnapshot, resolvePlayerLevel } = require('../public/js/region-level-colors.js');

test('region colors use the agreed continuous blue-green-yellow-orange-red level scale', () => {
    for (const [difference, color] of [
        [-5, 'rgb(59, 130, 246)'], [-2.5, 'rgb(34, 197, 94)'], [0, 'rgb(250, 204, 21)'],
        [2.5, 'rgb(249, 115, 22)'], [5, 'rgb(239, 68, 68)']
    ]) {
        const palette = getRegionColors(10 + difference, 10);
        assert.equal(palette.levelDifference, difference);
        assert.equal(palette.fill, color);
        assert.equal(palette.border, color);
    }
    assert.equal(getRegionColors(3.75, 10).levelDifference, -6.25);
    assert.equal(getRegionColors(3.75, 10).fill, 'rgb(59, 130, 246)');
    assert.equal(getRegionColors(17, 10).fill, 'rgb(239, 68, 68)');
    assert.equal(getRegionColors(8.75, 10).fill, 'rgb(142, 201, 58)');
    assert.equal(getRegionColors(null, 10).fill, 'rgb(148, 163, 184)');
    assert.equal(getRegionColors(5, undefined).levelDifference, null);
});

test('map payload uses newer same-player level only if it changed during the request', () => {
    const original = capturePlayerSnapshot({ id: 'player', level: 5 });
    assert.equal(resolvePlayerLevel({ playerId: 'player', playerLevel: 7 }, original, { id: 'player', level: 5 }), 7);
    assert.equal(resolvePlayerLevel({ playerId: 'player', playerLevel: 7 }, original, { id: 'player', level: 8 }), 8);
    assert.equal(resolvePlayerLevel({ playerId: 'player', playerLevel: 7 }, capturePlayerSnapshot({ id: 'other', level: 99 }), { id: 'other', level: 99 }), 7);
    assert.equal(resolvePlayerLevel({ playerId: 'player', playerLevel: 7 }, original, { id: 'other', level: 9 }), null);
    assert.equal(resolvePlayerLevel({ playerId: 'player', playerLevel: 7 }, original, null), null);
    assert.equal(resolvePlayerLevel({ playerId: 'player', playerLevel: null }, original, null), null);
});
