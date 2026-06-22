const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const promptSource = fs.readFileSync(
    path.join(__dirname, '..', 'prompts', '_includes', 'housekeeping.njk'),
    'utf8'
);

test('housekeeping prompt requires one parser-readable housekeeping XML block', () => {
    assert.match(promptSource, /<housekeeping>/);
    assert.match(promptSource, /<\/housekeeping>/);
    assert.match(promptSource, /<quests>/);
    assert.match(promptSource, /<trackers>/);
    assert.match(promptSource, /<relationships>/);
    assert.doesNotMatch(promptSource, /use tool calls/i);
});

test('housekeeping prompt can receive manual instructions', () => {
    assert.match(promptSource, /{% if housekeepingInstructions %}/);
    assert.match(promptSource, /{{ housekeepingInstructions }}/);
    assert.match(promptSource, /Follow these instructions when determining what to track/);
});
