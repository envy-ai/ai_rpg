const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Events = require('../Events.js');
const Globals = require('../Globals.js');

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
    assert.match(source, /const promptLaunchStaggerMs = Events\.resolvePromptLaunchStaggerMs\(\);/);
    assert.match(source, /promptLaunchStaggerMs \* 2/);
    assert.match(source, /const \[eventCheckOutcome, questCheckOutcome\] = await Promise\.all\(\[/);
    assert.match(source, /eventResult = eventCheckOutcome;/);
    assert.match(source, /questResult = questCheckOutcome;/);
});

test('XML event path schedules need-bar prompt after configured stagger', () => {
    const eventsSource = fs.readFileSync(path.join(__dirname, '..', 'Events.js'), 'utf8');
    const source = eventsSource.slice(
        eventsSource.indexOf('    static async _runXmlEventChecks({'),
        eventsSource.indexOf('        this.logEventCheck({', eventsSource.indexOf('    static async _runXmlEventChecks({'))
    );

    assert.match(eventsSource, /static PROMPT_LAUNCH_STAGGER_MS = 4000;/);
    assert.match(eventsSource, /static resolvePromptLaunchStaggerMs\(configOverride = Globals\?\.config\)/);
    assert.match(eventsSource, /static runAfterPromptLaunchDelay\(delayMs, task\)/);
    assert.match(source, /const eventCheckPromise = useTinyBrainEventChecks/);
    assert.match(source, /: LLMClient\.chatCompletion\(\{/);
    assert.match(source, /const promptLaunchStaggerMs = this\.resolvePromptLaunchStaggerMs\(\);/);
    assert.match(source, /const needBarEventCheckPromise = suppressNeedBarEventChecks[\s\S]*?this\.runAfterPromptLaunchDelay\(\s*promptLaunchStaggerMs,/);
    assert.match(source, /const \[responseText, needBarEventCheck\] = await Promise\.all\(\[/);
});

test('legacy event path also staggers need-bar prompt launch', () => {
    const eventsSource = fs.readFileSync(path.join(__dirname, '..', 'Events.js'), 'utf8');
    const source = eventsSource.slice(
        eventsSource.indexOf('        const promptGroups = EVENT_PROMPT_ORDER;'),
        eventsSource.indexOf('        const groupResponsesPromise = Promise.all(', eventsSource.indexOf('        const promptGroups = EVENT_PROMPT_ORDER;'))
    );

    assert.match(source, /const promptLaunchStaggerMs = this\.resolvePromptLaunchStaggerMs\(\);/);
    assert.match(source, /const needBarEventCheckPromise = suppressNeedBarEventChecks[\s\S]*?this\.runAfterPromptLaunchDelay\(\s*promptLaunchStaggerMs,/);
});

test('event housekeeping prompt is silent, logged, and mutation-capable', () => {
    const source = sourceBetween(
        'async function startHousekeepingPrompt({',
        'Events.setHousekeepingPromptRunner(runHousekeepingPrompt);'
    );

    assert.match(source, /promptType:\s*'housekeeping'/);
    assert.match(source, /housekeepingInstructions\s*=\s*''/);
    assert.match(source, /housekeepingInstructions:\s*typeof housekeepingInstructions === 'string'\s*\?\s*housekeepingInstructions\s*:\s*''/);
    assert.match(apiSource, /const \{\s*collectHistoryMatches,\s*runChatCompletionWithToolLoop,\s*executeChatToolCall\s*\} = createChatToolRuntime\(\{/);
    assert.match(source, /const rawResponsePromise = LLMClient\.chatCompletion\(requestOptions\)/);
    assert.match(source, /async function finishHousekeepingPrompt\(pendingHousekeepingPrompt,/);
    assert.match(source, /const rawResponseResult = await pending\.rawResponsePromise;/);
    assert.doesNotMatch(source, /getAllChatToolDefinitions/);
    assert.doesNotMatch(source, /housekeepingTools/);
    assert.doesNotMatch(source, /tool_choice/);
    assert.doesNotMatch(source, /additionalPayload/);
    assert.match(source, /metadataLabel:\s*'housekeeping'/);
    assert.match(source, /Globals\.config\?\.debug_tool_calls === true[\s\S]*?createPromptToolCallDebugRecorder\(\{/);
    assert.match(source, /promptLabel:\s*'housekeeping'/);
    assert.match(source, /entryCollector:\s*housekeepingToolCallDebugEntries/);
    assert.match(source, /Events\._applyHousekeepingXmlResponse\(rawResponse,\s*\{/);
    assert.match(source, /executeChatToolCall,/);
    assert.match(source, /startingSequence:\s*0,/);
    assert.match(source, /onToolCallDebug:\s*toolCallDebugRecorder[\s\S]*?toolCallDebugRecorder\.record\(event\)/);
    assert.match(source, /LLMClient\.logPrompt\(\{\s*prefix:\s*'housekeeping'/);
    assert.doesNotMatch(source, /runHousekeepingPrompt\.start/);
    assert.doesNotMatch(source, /runHousekeepingPrompt\.finish/);
    assert.match(source, /buildHousekeepingTurnHistory\(chatHistory,/);
    assert.match(source, /currentEventText:\s*formatHousekeepingCurrentEventText\(eventResult\)/);
    assert.match(source, /housekeepingTurnHistory:\s*housekeepingHistory\.turns/);
    assert.match(source, /advanceLastHousekeepingTurnId/);
    assert.doesNotMatch(source, /toolLoopResult/);
    assert.doesNotMatch(source, /newChatEntries/);
});

test('event checks schedule housekeeping before checks and run it with finalized outcomes', () => {
    const eventsSource = fs.readFileSync(path.join(__dirname, '..', 'Events.js'), 'utf8');
    const source = eventsSource.slice(
        eventsSource.indexOf('        const baseContext = await prepareBasePromptContext({'),
        eventsSource.indexOf('        const promptGroups = EVENT_PROMPT_ORDER;')
    );

    assert.match(source, /const housekeepingScheduled = this\._scheduleHousekeepingForEventChecks\(\{/);
    assert.match(source, /housekeepingScheduled,/);
    assert.match(eventsSource, /static async _runHousekeepingAfterEventChecks\(\{\s*[\s\S]*?housekeepingScheduled = false,/);
    assert.match(eventsSource, /if \(depth > 0 \|\| suppressHousekeeping \|\| !housekeepingScheduled\)/);
    assert.match(eventsSource, /return runner\(\{[\s\S]*?eventResult,/);
    assert.doesNotMatch(eventsSource, /_startHousekeepingForEventChecks/);
});

test('quest objective event signal forces at most one quest check and resets its interval', () => {
    const source = sourceBetween(
        '                    let eventResult = null;',
        '\n                    if (playerActionTimeProgress'
    );

    assert.match(source, /Events\.eventResultIndicatesAnyQuestObjectivesCompleted\(eventResult\)/);
    assert.match(source, /questResult = await Events\.resolveEventSignaledQuestCheck\(\{[\s\S]*?eventResult,[\s\S]*?existingQuestResult: questResult/);
});

test('split moveTurnResult runs one merged housekeeping pass after sub-checks', () => {
    const source = sourceBetween(
        'async function runmoveTurnResultEventChecks({',
        '\n        function recordSkillCheckEntry'
    );
    const originCallStart = source.indexOf('originEventResult = await Events.runEventChecks({');
    const destinationCallStart = source.indexOf('destinationEventResult = await Events.runEventChecks({');
    const mergeStart = source.indexOf('let splitEventResult = mergeEventResults([originEventResult, destinationEventResult]);');
    const returnStart = source.indexOf('            return {', mergeStart);

    assert.notEqual(originCallStart, -1, 'Unable to locate split origin event-check call.');
    assert.notEqual(destinationCallStart, -1, 'Unable to locate split destination event-check call.');
    assert.notEqual(mergeStart, -1, 'Unable to locate split event-result merge.');
    assert.notEqual(returnStart, -1, 'Unable to locate split movement return.');
    assert.ok(originCallStart < destinationCallStart, 'origin event checks should run before destination event checks.');
    assert.ok(destinationCallStart < mergeStart, 'destination event checks should finish before result merge.');

    const originCall = source.slice(originCallStart, source.indexOf('                });', originCallStart));
    const destinationCall = source.slice(destinationCallStart, source.indexOf('                });', destinationCallStart));
    const postMerge = source.slice(mergeStart, returnStart);

    assert.match(originCall, /suppressHousekeeping:\s*true/);
    assert.match(destinationCall, /suppressHousekeeping:\s*true/);
    assert.match(postMerge, /combinedProse && Events\.shouldRunAutomaticHousekeepingThisTurn\(\)/);
    assert.match(postMerge, /await runHousekeepingPrompt\(\{/);
    assert.match(postMerge, /textToCheck:\s*combinedProse,/);
    assert.match(postMerge, /eventResult:\s*splitEventResult,/);
    assert.match(postMerge, /locationOverride:\s*destinationLocation \|\| location \|\| null,/);
    assert.match(postMerge, /entryCollector/);
});

test('slash command context exposes housekeeping prompt runner with instructions and stream', () => {
    const source = sourceBetween(
        'function buildSlashCommandInteractionContext({',
        "\n        app.post('/api/slash-command', async (req, res) => {"
    );

    assert.match(source, /runHousekeepingPrompt:\s*async\s*\(\{\s*instructions\s*=\s*''\s*\} = \{\}\) => \{/);
    assert.match(source, /Housekeeping slash command requires an active client connection\./);
    assert.match(source, /createStreamEmitter\(\{\s*clientId:\s*normalizedClientId/);
    assert.match(source, /housekeepingInstructions:\s*instructions/);
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

test('prompt launch stagger resolves from root config seconds', { concurrency: false }, () => {
    const originalConfig = Globals.config;
    try {
        Globals.config = { stagger_concurrent_prompts: 5 };
        assert.equal(Events.resolvePromptLaunchStaggerMs(), 5000);

        Globals.config = { stagger_concurrent_prompts: 0.25 };
        assert.equal(Events.resolvePromptLaunchStaggerMs(), 250);

        Globals.config = {};
        assert.equal(Events.resolvePromptLaunchStaggerMs(), 4000);

        Globals.config = { stagger_concurrent_prompts: -1 };
        assert.throws(
            () => Events.resolvePromptLaunchStaggerMs(),
            /stagger_concurrent_prompts must be a non-negative finite number of seconds/
        );
    } finally {
        Globals.config = originalConfig;
    }
});
