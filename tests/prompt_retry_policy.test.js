const test = require('node:test');
const assert = require('node:assert/strict');

const {
    resolveConfiguredPromptMaxAttempts,
    runPromptWithParseRetries
} = require('../PromptRetryPolicy.js');

test('configured prompt retry policy counts the initial attempt plus configured retries', () => {
    assert.equal(resolveConfiguredPromptMaxAttempts({ retryAttempts: 0 }), 1);
    assert.equal(resolveConfiguredPromptMaxAttempts({ retryAttempts: 6 }), 7);
});

test('configured prompt retry policy keeps the established fallback when unset', () => {
    assert.equal(resolveConfiguredPromptMaxAttempts(undefined), 3);
    assert.equal(resolveConfiguredPromptMaxAttempts({}, { fallbackMaxAttempts: 5 }), 5);
});

test('configured prompt retry policy rejects invalid counts without clamping', () => {
    assert.throws(
        () => resolveConfiguredPromptMaxAttempts({ retryAttempts: -1 }),
        /non-negative integer/
    );
    assert.throws(
        () => resolveConfiguredPromptMaxAttempts({ retryAttempts: 1.5 }),
        /non-negative integer/
    );
    assert.throws(
        () => resolveConfiguredPromptMaxAttempts({}, { fallbackMaxAttempts: 0 }),
        /positive integer/
    );
});

test('parsed prompt retries only the rejected structured response and preserves retry context', async () => {
    const completionMessages = [];
    const attemptResults = [];
    const responses = ['<broken>', '<valid/>'];

    const result = await runPromptWithParseRetries({
        messages: [
            { role: 'system', content: 'system' },
            { role: 'user', content: 'return XML' }
        ],
        maxAttempts: 3,
        complete: ({ messages }) => {
            completionMessages.push(messages);
            return responses.shift();
        },
        parse: response => {
            if (response !== '<valid/>') {
                throw new Error('invalid XML');
            }
            return { accepted: true };
        },
        buildRetryInstruction: error => `Correct the XML: ${error.message}`,
        onAttempt: result => attemptResults.push(result)
    });

    assert.deepEqual(result.value, { accepted: true });
    assert.equal(result.attempts, 2);
    assert.equal(completionMessages.length, 2);
    assert.deepEqual(completionMessages[1].slice(-2), [
        { role: 'assistant', content: '<broken>' },
        { role: 'user', content: 'Correct the XML: invalid XML' }
    ]);
    assert.deepEqual(
        attemptResults.map(({ attempt, accepted }) => ({ attempt, accepted })),
        [
            { attempt: 1, accepted: false },
            { attempt: 2, accepted: true }
        ]
    );
});

test('parsed prompt retry exhausts exactly the requested attempt budget', async () => {
    let completionCount = 0;

    await assert.rejects(
        () => runPromptWithParseRetries({
            messages: [{ role: 'user', content: 'return XML' }],
            maxAttempts: 2,
            complete: () => {
                completionCount += 1;
                return '<broken>';
            },
            parse: () => {
                throw new Error('still invalid');
            },
            buildRetryInstruction: error => `Correct it: ${error.message}`
        }),
        /failed to parse after 2 attempts: still invalid/
    );
    assert.equal(completionCount, 2);
});

test('parsed prompt retries can regenerate from the original prompt plus only the parser error', async () => {
    const completionMessages = [];
    const responses = ['<broken>', '<valid/>'];

    const result = await runPromptWithParseRetries({
        messages: [
            { role: 'system', content: 'system' },
            { role: 'user', content: 'return a large XML document' }
        ],
        maxAttempts: 2,
        retainRejectedResponse: false,
        complete: ({ messages }) => {
            completionMessages.push(messages);
            return responses.shift();
        },
        parse: response => {
            if (response !== '<valid/>') {
                throw new Error('tag mismatch at line 10');
            }
            return response;
        },
        buildRetryInstruction: error => `Regenerate fresh XML: ${error.message}`
    });

    assert.equal(result.value, '<valid/>');
    assert.deepEqual(completionMessages[1], [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'return a large XML document' },
        { role: 'user', content: 'Regenerate fresh XML: tag mismatch at line 10' }
    ]);
    assert.equal(
        completionMessages[1].some(message => message.content === '<broken>'),
        false
    );
});

test('parsed prompt retry does not reinterpret completion failures as parser failures', async () => {
    let parseCalls = 0;

    await assert.rejects(
        () => runPromptWithParseRetries({
            messages: [{ role: 'user', content: 'return XML' }],
            maxAttempts: 3,
            complete: () => {
                throw new Error('transport failed');
            },
            parse: () => {
                parseCalls += 1;
            },
            buildRetryInstruction: () => 'Correct it.'
        }),
        /transport failed/
    );
    assert.equal(parseCalls, 0);
});
