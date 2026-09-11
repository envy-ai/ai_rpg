const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');

const rootDir = path.join(__dirname, '..');
const promptsDir = path.join(rootDir, 'prompts');

const readPrompt = name => fs.readFileSync(path.join(promptsDir, '_includes', name), 'utf8');

test('player-action prompts resolve committed uncertain actions before outcome brainstorming', () => {
    const standard = readPrompt('player-action.njk');
    const tinyBrain = readPrompt('player-action.tinybrain.njk');

    for (const [label, source] of [['standard', standard], ['TinyBrain', tinyBrain]]) {
        const resolutionIndex = source.indexOf('Information gathering and pre-outcome mechanical resolution');
        const brainstormingIndex = source.indexOf('In markdown format, list three');

        assert.notEqual(resolutionIndex, -1, `${label} prompt should contain pre-outcome resolution guidance`);
        assert.notEqual(brainstormingIndex, -1, `${label} prompt should contain outcome brainstorming`);
        assert.ok(resolutionIndex < brainstormingIndex, `${label} prompt should resolve checks before brainstorming`);
        assert.match(source, /player-action-check-outcomes\.njk/);
        assert.match(source, /do not (?:negate|reroll)/i);
    }
});

test('standard and TinyBrain player-action prompts describe until clock-time durations', () => {
    const standard = readPrompt('player-action.njk');
    const tinyBrain = readPrompt('player-action.tinybrain.njk');

    assert.match(standard, /until \[HH:MM\] \[AM\/PM\]/);
    assert.match(standard, /leading zero and minutes may be omitted/i);
    assert.match(standard, /AM\/PM may also be omitted to use 24-hour time/i);
    assert.match(tinyBrain, /until 6:00 AM[\s\S]*until 6 AM[\s\S]*until 18:00[\s\S]*until 18/);
    assert.match(
        tinyBrain,
        /llmparse\('player_action_time_passed_duration', 1, playerActionWorldTimeMinutes\)/
    );
});

test('shared player-action outcome contract covers every resolver result label', () => {
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(promptsDir, { noCache: true }),
        { autoescape: false }
    );
    const rendered = promptEnv.render('_includes/player-action-check-outcomes.njk');
    const resultLabels = [
        'automatic success',
        'critical success',
        'major success',
        'success',
        'barely succeeded',
        'barely failed',
        'failure',
        'major failure',
        'critical failure',
        'failure - implausible'
    ];

    for (const resultLabel of resultLabels) {
        assert.ok(rendered.includes(`\`${resultLabel}\``), `outcome contract should cover ${resultLabel}`);
    }
    assert.match(rendered, /reasonable practical intent/);
    assert.match(rendered, /Established canon remains authoritative/);
    assert.match(rendered, /new immediate fact needed to express an otherwise plausible successful result is allowed/);
});

test('skill-check tools preserve the result label as the first line of enriched content', () => {
    const chatToolCalls = fs.readFileSync(path.join(rootDir, 'chat_tool_calls.js'), 'utf8');
    const enrichedContentMatches = chatToolCalls.match(/content: buildSkillCheckOutcomeToolContent\(actionResolution, resultLabel\)/g) || [];

    assert.equal(enrichedContentMatches.length, 2);
});
