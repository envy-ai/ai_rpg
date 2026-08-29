const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const Events = require('../Events.js');
const { runPromptWithParseRetries } = require('../PromptRetryPolicy.js');

test('standard XML event checks validate and retry before applying outcomes', () => {
    const source = fs.readFileSync(require.resolve('../Events.js'), 'utf8');
    const start = source.indexOf('        let parsedXmlEventsFromRetry = null;');
    const end = source.indexOf('        const promptLaunchStaggerMs =', start);
    const retryBlock = source.slice(start, end);

    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    assert.match(retryBlock, /runPromptWithParseRetries\(\{/);
    assert.match(retryBlock, /resolveConfiguredPromptMaxAttempts\(this\.config\?\.ai/);
    assert.match(retryBlock, /parse:\s*\(response\)\s*=>\s*this\._parseXmlEventCheckResponse/);
    assert.match(retryBlock, /requireFinalStateTags:\s*true/);
    assert.match(retryBlock, /preserving every valid event/);
    assert.match(retryBlock, /Include exactly one <inCombat> and one <anyQuestObjectivesCompleted>/);
    assert.match(retryBlock, /Event-check response attempt/);
});

test('event XML correction retains a true quest signal after malformed tracker XML', async () => {
    const responses = [
        `<events>
  <anyQuestObjectivesCompleted><value>true</value></anyQuestObjectivesCompleted>
  <inCombat><value>false</value></inCombat>
  <trackerUpdates><trackerUpdate><action>add</newValue></trackerUpdate></trackerUpdates>
</events>`,
        `<events>
  <anyQuestObjectivesCompleted><value>true</value></anyQuestObjectivesCompleted>
  <inCombat><value>false</value></inCombat>
</events>`
    ];
    let completionCalls = 0;
    let retryMessages = null;

    const result = await runPromptWithParseRetries({
        messages: [
            { role: 'system', content: 'system' },
            { role: 'user', content: 'events' }
        ],
        maxAttempts: 2,
        complete: ({ messages }) => {
            retryMessages = messages;
            const response = responses[completionCalls];
            completionCalls += 1;
            return response;
        },
        parse: response => Events._parseXmlEventCheckResponse(response, {
            requireFinalStateTags: true
        }),
        buildRetryInstruction: error => `Correct this XML: ${error.message}`
    });

    assert.equal(result.attempts, 2);
    assert.equal(completionCalls, 2);
    assert.equal(result.value.structured.parsed.any_quest_objectives_completed, true);
    assert.match(retryMessages.at(-1).content, /Opening and ending tag mismatch/);
});
