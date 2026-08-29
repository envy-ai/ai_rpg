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
    const start = eventsSource.indexOf('    static async _runXmlEventChecks({');
    const source = eventsSource.slice(
        start,
        eventsSource.indexOf('        const xmlEvents =', start)
    );

    assert.match(eventsSource, /static PROMPT_LAUNCH_STAGGER_MS = 4000;/);
    assert.match(eventsSource, /static resolvePromptLaunchStaggerMs\(configOverride = Globals\?\.config\)/);
    assert.match(eventsSource, /static runAfterPromptLaunchDelay\(delayMs, task\)/);
    assert.match(source, /const eventCheckPromise = useTinyBrainEventChecks/);
    assert.match(source, /runPromptWithParseRetries\(\{/);
    assert.match(source, /complete:\s*\(\{ messages \}\)\s*=>\s*LLMClient\.chatCompletion\(\{/);
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
    assert.match(source, /const initialRawResponseResult = await pending\.rawResponsePromise;/);
    assert.match(source, /runPromptWithParseRetries\(\{[\s\S]*?parse:\s*response\s*=>\s*Events\._parseHousekeepingXmlResponse\(response\)/);
    assert.match(source, /Housekeeping response attempt \$\{attempt\}\/\$\{maxAttempts\} failed validation/);
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
    assert.match(source, /lastRunTurnTimestamp:\s*getLastHousekeepingTurnTimestamp\(\)/);
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
    assert.match(eventsSource, /return await runner\(\{[\s\S]*?eventResult,/);
    assert.match(eventsSource, /HOUSEKEEPING_AFTER_EVENT_CHECKS_FAILED/);
    assert.match(eventsSource, /appendEventPostProcessingError\(eventResult,/);
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

test('split moveTurnResult runs origin, transit, destination, tracker, then one housekeeping pass', () => {
    const source = sourceBetween(
        'async function runmoveTurnResultEventChecks({',
        '\n        function recordSkillCheckEntry'
    );
    const originCallStart = source.indexOf('originEventResult = await Events.runEventChecks({');
    const splitSectionStart = source.indexOf('            let destinationEventResult = null;');
    const betweenCallStart = source.indexOf('betweenEventResult = await Events.runEventChecks({', splitSectionStart);
    const destinationCallStart = source.indexOf('destinationEventResult = await Events.runEventChecks({', splitSectionStart);
    const trackerCallStart = source.indexOf('trackerEventResult = await Events.runEventChecks({', splitSectionStart);
    const mergeStart = source.indexOf('let splitEventResult = mergeEventResults([', splitSectionStart);
    const returnStart = source.indexOf('            return {', mergeStart);

    assert.notEqual(originCallStart, -1, 'Unable to locate split origin event-check call.');
    assert.notEqual(betweenCallStart, -1, 'Unable to locate split transit event-check call.');
    assert.notEqual(destinationCallStart, -1, 'Unable to locate split destination event-check call.');
    assert.notEqual(trackerCallStart, -1, 'Unable to locate split tracker event-check call.');
    assert.notEqual(mergeStart, -1, 'Unable to locate split event-result merge.');
    assert.notEqual(returnStart, -1, 'Unable to locate split movement return.');
    assert.ok(originCallStart < betweenCallStart, 'origin event checks should run before transit event checks.');
    assert.ok(betweenCallStart < destinationCallStart, 'transit event checks should run before destination event checks.');
    assert.ok(destinationCallStart < trackerCallStart, 'destination event checks should run before tracker checks.');
    assert.ok(trackerCallStart < mergeStart, 'tracker checks should finish before result merge.');

    const originCall = source.slice(originCallStart, source.indexOf('                });', originCallStart));
    const betweenCall = source.slice(betweenCallStart, source.indexOf('                });', betweenCallStart));
    const destinationCall = source.slice(destinationCallStart, source.indexOf('                });', destinationCallStart));
    const trackerCall = source.slice(trackerCallStart, source.indexOf('                });', trackerCallStart));
    const postMerge = source.slice(mergeStart, returnStart);

    assert.match(originCall, /suppressHousekeeping:\s*true/);
    assert.match(originCall, /eventSectionKind:\s*'origin'/);
    assert.match(originCall, /tinyBrainEventSequence/);
    assert.match(betweenCall, /eventSectionKind:\s*'between'/);
    assert.match(betweenCall, /suppressNeedBarEventChecks:\s*true/);
    assert.match(betweenCall, /tinyBrainEventSequence/);
    assert.match(destinationCall, /suppressHousekeeping:\s*true/);
    assert.match(destinationCall, /eventSectionKind:\s*'destination'/);
    assert.match(destinationCall, /tinyBrainEventSequence/);
    assert.match(trackerCall, /eventSectionKind:\s*'tracker'/);
    assert.match(trackerCall, /eventMode:\s*'trackers'/);
    assert.match(trackerCall, /tinyBrainAcceptedEventXml:\s*acceptedSectionEventResult\?\.raw \|\| ''/);
    assert.match(trackerCall, /tinyBrainEventSequence/);
    assert.match(source, /const tinyBrainEventSequence = useTinyBrainSectionedEventChecks[\s\S]*?Events\.createTinyBrainEventSequence\(\)/);
    assert.match(postMerge, /combinedProse && Events\.shouldRunAutomaticHousekeepingThisTurn\(\)/);
    assert.match(postMerge, /await runAutomaticHousekeepingPrompt\(\{/);
    assert.match(postMerge, /textToCheck:\s*combinedProse,/);
    assert.match(postMerge, /eventResult:\s*splitEventResult,/);
    assert.match(postMerge, /locationOverride:\s*destinationLocation \|\| location \|\| null,/);
    assert.match(postMerge, /entryCollector/);
});

test('post-event housekeeping failures remain visible without discarding event results', () => {
    const chatSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat.js'), 'utf8');

    assert.match(apiSource, /async function runAutomaticHousekeepingPrompt\(options = \{\}\)/);
    assert.match(apiSource, /Events\.appendEventPostProcessingError\(\s*options\.eventResult,/);
    assert.match(apiSource, /responseData\.postProcessingErrors = eventResult\.postProcessingErrors\.slice\(\)/);
    assert.match(chatSource, /Array\.isArray\(data\.postProcessingErrors\)/);
    assert.match(chatSource, /this\.showChatErrorPopup\(postProcessingErrorMessage\)/);
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
