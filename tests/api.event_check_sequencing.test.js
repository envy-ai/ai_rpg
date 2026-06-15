const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Events = require('../Events.js');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
    const start = apiSource.indexOf(startMarker);
    assert.notEqual(start, -1, `Unable to locate start marker: ${startMarker}`);
    const end = apiSource.indexOf(endMarker, start);
    assert.notEqual(end, -1, `Unable to locate end marker after ${startMarker}: ${endMarker}`);
    return apiSource.slice(start, end);
}

test('player-action event, need-bar, and quest checks launch concurrently with staggered starts', () => {
    const source = sourceBetween(
        'const textToCheck = stripHiddenNotesFromText(aiResponse);',
        "} catch (eventError) {"
    );
    const eventPromiseIndex = source.indexOf('const eventCheckPromise = Events.runEventChecks({');
    const questPromiseIndex = source.indexOf('const questCheckPromise = Events.runAfterPromptLaunchDelay(');

    assert.notEqual(eventPromiseIndex, -1, 'Unable to locate immediate event-check promise.');
    assert.notEqual(questPromiseIndex, -1, 'Unable to locate delayed quest-check promise.');
    assert.ok(eventPromiseIndex < questPromiseIndex, 'event checks should be launched before delayed quest checks are scheduled.');
    assert.match(source, /Events\.PROMPT_LAUNCH_STAGGER_MS \* 2/);
    assert.match(source, /const \[eventCheckOutcome, questCheckOutcome\] = await Promise\.all\(\[/);
    assert.match(source, /eventResult = eventCheckOutcome;/);
    assert.match(source, /questResult = questCheckOutcome;/);
});

test('XML event path schedules need-bar prompt two seconds after events-xml launch', () => {
    const eventsSource = fs.readFileSync(path.join(__dirname, '..', 'Events.js'), 'utf8');
    const source = eventsSource.slice(
        eventsSource.indexOf('    static async _runXmlEventChecks({'),
        eventsSource.indexOf('        this.logEventCheck({', eventsSource.indexOf('    static async _runXmlEventChecks({'))
    );

    assert.match(eventsSource, /static PROMPT_LAUNCH_STAGGER_MS = 2000;/);
    assert.match(eventsSource, /static runAfterPromptLaunchDelay\(delayMs, task\)/);
    assert.match(source, /const eventCheckPromise = LLMClient\.chatCompletion\(\{/);
    assert.match(source, /const needBarEventCheckPromise = suppressNeedBarEventChecks[\s\S]*?this\.runAfterPromptLaunchDelay\(\s*this\.PROMPT_LAUNCH_STAGGER_MS,/);
    assert.match(source, /const \[responseText, needBarEventCheck\] = await Promise\.all\(\[/);
});

test('legacy event path also staggers need-bar prompt launch', () => {
    const eventsSource = fs.readFileSync(path.join(__dirname, '..', 'Events.js'), 'utf8');
    const source = eventsSource.slice(
        eventsSource.indexOf('        const promptGroups = EVENT_PROMPT_ORDER;'),
        eventsSource.indexOf('        const groupResponsesPromise = Promise.all(', eventsSource.indexOf('        const promptGroups = EVENT_PROMPT_ORDER;'))
    );

    assert.match(source, /const needBarEventCheckPromise = suppressNeedBarEventChecks[\s\S]*?this\.runAfterPromptLaunchDelay\(\s*this\.PROMPT_LAUNCH_STAGGER_MS,/);
});

test('prompt launch delay helper rejects invalid delay requests loudly', async () => {
    await assert.rejects(
        Events.runAfterPromptLaunchDelay(-1, () => {}),
        /non-negative finite delayMs number/
    );
    await assert.rejects(
        Events.runAfterPromptLaunchDelay(Number.NaN, () => {}),
        /non-negative finite delayMs number/
    );
    await assert.rejects(
        Events.runAfterPromptLaunchDelay(0, null),
        /requires a task function/
    );

    const result = await Events.runAfterPromptLaunchDelay(0, () => 'launched');
    assert.equal(result, 'launched');
});
