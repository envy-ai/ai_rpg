const test = require('node:test');
const assert = require('node:assert/strict');

const {
    shouldIncludePlayerActionForEventChecks
} = require('../api.js');

test('event checks include ordinary non-empty no-tool player actions', () => {
    assert.equal(
        shouldIncludePlayerActionForEventChecks({
            actionText: 'We sit together and wait out the remaining 8 minutes of the ride.',
            plausibilityType: '',
            actionResolutions: []
        }),
        true
    );
});

test('event checks exclude explicitly failed checked player actions', () => {
    assert.equal(
        shouldIncludePlayerActionForEventChecks({
            actionText: 'I force the locked hatch open.',
            plausibilityType: '',
            actionResolutions: [{ success: false }]
        }),
        false
    );
});

test('event checks include successful checked player actions', () => {
    assert.equal(
        shouldIncludePlayerActionForEventChecks({
            actionText: 'I force the locked hatch open.',
            plausibilityType: '',
            actionResolutions: [{ success: true }]
        }),
        true
    );
});

test('event checks exclude empty and rejected player actions', () => {
    assert.equal(
        shouldIncludePlayerActionForEventChecks({
            actionText: '   ',
            plausibilityType: ''
        }),
        false
    );
    assert.equal(
        shouldIncludePlayerActionForEventChecks({
            actionText: 'I do something impossible.',
            plausibilityType: 'rejected'
        }),
        false
    );
});
