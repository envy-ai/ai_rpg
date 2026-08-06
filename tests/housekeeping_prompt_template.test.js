const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

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

test('housekeeping prompt explicitly examines multi-turn action prose and event history', () => {
    assert.match(promptSource, /<housekeepingTurnHistory>/);
    assert.match(promptSource, /{% for turn in housekeepingTurnHistory %}/);
    assert.match(promptSource, /<playerAction>/);
    assert.match(promptSource, /<prose>/);
    assert.match(promptSource, /<eventText>/);
    assert.match(promptSource, /Specifically examine every turn/i);
    assert.match(promptSource, /Do not focus only on the final turn/i);
    assert.match(promptSource, /most recent {{ housekeepingInterval }} player turns/);
    assert.doesNotMatch(promptSource, /<latestEventContext>/);
});

test('housekeeping prompt renders every field from multiple turn records', () => {
    const promptEnv = nunjucks.configure(path.join(__dirname, '..', 'prompts'), {
        autoescape: false,
        noCache: true
    });
    const rendered = promptEnv.render('_includes/housekeeping.njk', {
        housekeepingHistoryMode: 'since-last-run',
        housekeepingInterval: 3,
        housekeepingTurnHistory: [
            {
                playerAction: 'Open the gate.',
                prose: ['The gate opens.'],
                eventText: ['The latch breaks.']
            },
            {
                playerAction: 'Enter the yard.',
                prose: ['Rain falls across the yard.'],
                eventText: []
            }
        ]
    });

    assert.match(rendered, /<playerAction>Open the gate\.<\/playerAction>/);
    assert.match(rendered, /<prose>The gate opens\.<\/prose>/);
    assert.match(rendered, /<eventText>The latch breaks\.<\/eventText>/);
    assert.match(rendered, /<playerAction>Enter the yard\.<\/playerAction>/);
    assert.match(rendered, /including the current turn/);
});
