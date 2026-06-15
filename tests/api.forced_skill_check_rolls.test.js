const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    extractInlineRollControls
} = require('../api.js');

test('extractInlineRollControls strips forced-roll markers and preserves numeric roll override', () => {
    const result = extractInlineRollControls(' I pick <F> the lock <20>\nthen listen <f> carefully. ');

    assert.deepEqual(result, {
        text: 'I pick the lock\nthen listen carefully.',
        dieRoll: 20,
        forceSkillCheckRolls: true
    });
});

test('extractInlineRollControls leaves non-roll angle tags untouched', () => {
    const result = extractInlineRollControls('Inspect <finalProse> without a forced roll marker.');

    assert.deepEqual(result, {
        text: 'Inspect <finalProse> without a forced roll marker.',
        dieRoll: null,
        forceSkillCheckRolls: false
    });
});

test('chat action persistence uses the current inline roll parser', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

    assert.equal(
        /\bextractInlineDieRollOverride\b/.test(apiSource),
        false,
        'api.js should not reference the obsolete inline die-roll helper'
    );
    assert.equal(
        /const userEntryContentWithoutInlineRoll = extractInlineRollControls\(/.test(apiSource),
        true,
        'chat action persistence should use extractInlineRollControls'
    );
});
