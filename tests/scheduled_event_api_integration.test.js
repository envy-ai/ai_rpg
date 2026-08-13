const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('api wires scheduled event scheduling and due-event resolution hooks', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

    assert.match(apiSource, /require\('\.\/ScheduledEvent\.js'\)/);
    assert.match(apiSource, /createScheduledEventScheduler/);
    assert.match(apiSource, /parseScheduledEventResultXml/);
    assert.match(apiSource, /scheduleEvent:\s*scheduledEventScheduler\.scheduleEvent/);
    assert.match(apiSource, /async function processDueScheduledEvents/);
    assert.match(apiSource, /ScheduledEvent\.getPendingDue/);
    assert.match(apiSource, /promptType:\s*'scheduled-event-resolution'/);
    assert.match(apiSource, /function getAllChatToolDefinitions/);
    assert.match(apiSource, /modExtensionRegistry\.getChatToolDefinitions\(\)/);
    assert.match(
        apiSource,
        /const scheduledEventTools = getAllChatToolDefinitions\(\{\s*modExtensionRegistry,\s*includeGenericPromptOnly:\s*false\s*\}\)/
    );
    assert.match(apiSource, /const isPlanCheckpoint = !stage\.isFinal\s*&& stage\.checkpoint\?\.index === 1/);
    assert.match(apiSource, /afterParse:\s*async stage => \{\s*if \(stage\.checkpoint\?\.parserName !== 'scheduled_event_tool_plan'\)/);
    assert.doesNotMatch(apiSource, /const isToolCheckpoint = !stage\.isFinal/);
    assert.match(apiSource, /isNonMutatingScheduledEventToolName/);
    assert.match(apiSource, /scheduledEventTools\.filter\(definition/);
    assert.match(
        apiSource,
        /validateScheduledEventToolCallAgainstPlan\(\s*toolCall,\s*scheduledEventToolPlan\s*\)/
    );
    assert.match(apiSource, /executeDeterministicScheduledEventToolPlan/);
    assert.match(apiSource, /scheduledEventDeterministicToolResultCache/);
    assert.match(apiSource, /const executePlannedToolCall = \(toolCall, executionOptions\)/);
    assert.match(apiSource, /chatToolMayLaunchPrompts\(toolCall\.functionName\)/);
    assert.match(apiSource, /retryError\.tinyBrainRetryCompletePlan = true/);
    assert.match(apiSource, /title:\s*'server-executed scheduled-event tool plan'/);
    assert.match(apiSource, /expectedSummary:\s*happened \? completed\[2\]\?\.value : ''/);
    assert.match(apiSource, /event:\s*scheduledEvent\.event\s*\|\|\s*''/);
    assert.match(apiSource, /event:\s*result\.event\s*\|\|\s*''/);
    assert.doesNotMatch(apiSource, /scheduledEventTools[\s\S]{0,240}\.filter\(toolDefinition => toolDefinition\?\.\function\?\.name !== 'requestUserInput'\)/);
    assert.match(apiSource, /promptLabel:\s*'scheduled_event_resolution'/);
    assert.match(apiSource, /LLMClient\.logPrompt\(\{\s*prefix:\s*'scheduled_event_resolution'/);
    assert.match(apiSource, /type:\s*'scheduled-event'/);
    assert.match(apiSource, /type:\s*'scheduled-event-prose'/);
    assert.match(apiSource, /await processDueVehicleArrivals\(\);\s*await processDueScheduledEvents/s);
    assert.match(apiSource, /app\.get\('\/api\/story-tools\/scheduled-events'/);
    assert.match(apiSource, /ScheduledEvent\.getAll\(\)/);
    assert.match(apiSource, /scheduledEvents,\s*count:\s*scheduledEvents\.length/);
});

test('scheduled resolution prompts treat player presence as visibility rather than applicability', () => {
    const tinyBrainPrompt = fs.readFileSync(
        path.join(__dirname, '..', 'prompts', '_includes', 'scheduled-event-resolution.tinybrain.njk'),
        'utf8'
    );
    const oneShotPrompt = fs.readFileSync(
        path.join(__dirname, '..', 'prompts', '_includes', 'scheduled-event-resolution.njk'),
        'utf8'
    );

    for (const prompt of [tinyBrainPrompt, oneShotPrompt]) {
        assert.match(prompt, /Player presence controls only whether .*prose.* returned/i);
        assert.match(prompt, /does not determine whether .*event can occur/i);
        assert.match(prompt, /scheduled location differs from the player's location/i);
        assert.match(prompt, /Resolve feasible offscreen events/i);
    }
    assert.match(tinyBrainPrompt, /scheduled_event_tool_plan/);
    assert.doesNotMatch(tinyBrainPrompt, /scheduled_event_tool_execution/);
    assert.doesNotMatch(tinyBrainPrompt, /server now executes every accepted call/i);
    assert.doesNotMatch(tinyBrainPrompt, /Make each planned call once now/i);
    assert.doesNotMatch(tinyBrainPrompt, /stateChangeRequired/);
    assert.doesNotMatch(tinyBrainPrompt, /<purpose>/);
    assert.match(tinyBrainPrompt, /read-only lookup calls now/i);
    assert.match(tinyBrainPrompt, /automatically records this event's lifecycle and hidden summary/i);
    assert.match(tinyBrainPrompt, /return both lists empty; do not invent a mutation/i);
    assert.match(tinyBrainPrompt, /scheduleEvent.*only for a distinct future consequence/i);
    assert.match(tinyBrainPrompt, /llmresult\('scheduled_event_result'\)/);
    assert.doesNotMatch(tinyBrainPrompt, /character-for-character/i);
    assert.doesNotMatch(tinyBrainPrompt, /grammatical subject/i);
});
