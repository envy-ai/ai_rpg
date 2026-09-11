const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SKILL_CHECK_OUTCOME_GUIDANCE,
    buildSkillCheckOutcomeToolContent,
    normalizeOutcomeDegree
} = require('../utils/skill-check-outcome-guidance.js');

const outcomes = [
    ['automatic success', 'automatic_success', true],
    ['critical success', 'critical_success', true],
    ['major success', 'major_success', true],
    ['success', 'success', true],
    ['barely succeeded', 'barely_succeeded', true],
    ['barely failed', 'barely_failed', false],
    ['failure', 'failure', false],
    ['major failure', 'major_failure', false],
    ['critical failure', 'critical_failure', false],
    ['failure - implausible', 'implausible_failure', false]
];

test('skill-check tool guidance preserves every result label and explains its tier', () => {
    for (const [label, degree, success] of outcomes) {
        const content = buildSkillCheckOutcomeToolContent({ label, degree, success }, label);

        assert.equal(content.split('\n')[0], label);
        assert.match(content, /\n\nOutcome guidance:\n/);
        assert.ok(content.includes(SKILL_CHECK_OUTCOME_GUIDANCE[degree]));
        assert.equal(normalizeOutcomeDegree({ label, degree, success }), degree);
        if (success) {
            assert.match(content, /successful search/);
            assert.match(content, /Established canon remains authoritative/);
        } else {
            assert.doesNotMatch(content, /successful search/);
        }
    }
});

test('skill-check outcome guidance rejects unsupported or missing results', () => {
    assert.throws(
        () => buildSkillCheckOutcomeToolContent({ label: 'mystery result', degree: 'mystery_result' }, 'mystery result'),
        /Unsupported skill-check outcome degree/
    );
    assert.throws(
        () => buildSkillCheckOutcomeToolContent({ label: 'success', degree: 'success' }, ''),
        /non-empty result label/
    );
});
