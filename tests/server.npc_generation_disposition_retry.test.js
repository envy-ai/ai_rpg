const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const { runPromptWithParseRetries } = require('../PromptRetryPolicy.js');

function loadNpcGenerationRetry(responses) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function formatGenerationPromptMessageForLog');
    const end = source.indexOf('\nfunction generateChatMessageId', start);
    assert.notEqual(start, -1, 'Unable to locate NPC generation retry helper.');
    assert.notEqual(end, -1, 'Unable to locate end of NPC generation retry helper.');

    const completionMessages = [];
    const logs = [];
    const context = {
        Array,
        Error,
        String,
        TypeError,
        config: { ai: { retryAttempts: 1 } },
        resolveConfiguredPromptMaxAttempts: () => 2,
        runPromptWithParseRetries,
        runGenerationPromptCompletion: async ({ requestOptions }) => {
            completionMessages.push(requestOptions.messages);
            return responses.shift();
        },
        LLMClient: {
            logPrompt: entry => logs.push(entry)
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}\nthis.runNpcGenerationPromptWithParseRetries = runNpcGenerationPromptWithParseRetries;`,
        context
    );
    return {
        run: context.runNpcGenerationPromptWithParseRetries,
        completionMessages,
        logs
    };
}

test('NPC generation retries with the exact disposition parser error surfaced to the LLM', async () => {
    const missingDispositionError = 'Location NPC generation NPC "Wolf" must contain exactly one direct <disposition> element; use <disposition>N/A</disposition> if sentient.';
    const runtime = loadNpcGenerationRetry(['<response>bad</response>', '<response>good</response>']);

    const result = await runtime.run({
        messages: [
            { role: 'system', content: 'System context.' },
            { role: 'user', content: 'Generate an NPC.' }
        ],
        metadataLabel: 'location_npc_generation',
        responseRootTag: 'response',
        responseLabel: 'location NPC generation',
        systemPrompt: 'System context.',
        parseResponse: response => {
            if (response.includes('bad')) {
                throw new Error(missingDispositionError);
            }
            return { npcs: [{ name: 'Wolf', disposition: 'N/A' }] };
        }
    });

    assert.equal(result.attempts, 2);
    assert.equal(runtime.completionMessages.length, 2);
    const retryMessage = runtime.completionMessages[1].at(-1);
    assert.equal(retryMessage.role, 'user');
    assert.match(retryMessage.content, new RegExp(missingDispositionError.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(retryMessage.content, /Every generated <npc> or <hostile> must contain exactly one direct, nonblank <disposition>/);
    assert.match(runtime.logs[0].sections[0].content, /rejected/);
    assert.match(runtime.logs[1].sections[0].content, /accepted/);
});
