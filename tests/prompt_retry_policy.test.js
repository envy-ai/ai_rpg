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

test('unclosed XML retry preserves parser error, asks for all closing tags and DONE, then accepts complete XML', async () => {
    const Utils = require('../Utils.js');
    const requests = [], attempts = [];
    const responses = ['<items><item><name>Ward</name>', '<items><item><name>Ward</name></item></items>\nDONE'];
    const result = await runPromptWithParseRetries({
        messages: [{ role: 'user', content: 'Generate items.' }], maxAttempts: 2,
        complete: ({ messages }) => { requests.push(messages); return responses.shift(); },
        parse: response => Utils.parseXmlDocumentStrict(response),
        buildRetryInstruction: error => `Correct the exact error: ${error.message}`,
        onAttempt: attempt => attempts.push(attempt)
    });
    assert.equal(result.value.documentElement.tagName, 'items');
    assert.equal(result.attempts, 2);
    assert.equal(requests[1].at(-2).content, '<items><item><name>Ward</name>');
    const feedback = requests[1].at(-1).content;
    assert.ok(feedback.includes(attempts[0].error.message));
    assert.match(feedback, /clos(?:e|ing)[\s\S]*tag/i);
    assert.equal((feedback.match(/\bDONE\b/g) || []).length, 1);
    assert.deepEqual(attempts.map(item => item.accepted), [false, true]);
});

test('identical rejected responses add the quoted repetition cue only to the immediate correction', async () => {
    const Utils = require('../Utils.js');
    const bad = '<items><item>';
    const requests = [];
    const responses = [bad, bad, bad + ' ', '<items><item/></items>'];
    const result = await runPromptWithParseRetries({
        messages: [{ role: 'user', content: 'Generate items.' }], maxAttempts: 4,
        complete: ({ messages }) => { requests.push(messages); return responses.shift(); },
        parse: response => Utils.parseXmlDocumentStrict(response),
        buildRetryInstruction: error => `Correct the exact error: ${error.message}`
    });
    const quote = '"Insanity is doing the same thing over and over again and expecting different results."';
    assert.equal(result.attempts, 4);
    assert.doesNotMatch(requests[1].at(-1).content, /Insanity/);
    assert.ok(requests[2].at(-1).content.includes(quote));
    assert.match(requests[2].at(-1).content, /unclosed/i);
    assert.equal((requests[2].at(-1).content.match(/\bDONE\b/g) || []).length, 1);
    assert.doesNotMatch(requests[3].at(-1).content, /Insanity/);
});

test('domain and mismatched XML errors do not request DONE, and incomplete XML plus DONE is rejected', async () => {
    const Utils = require('../Utils.js');
    for (const [response, parse] of [
        ['<items><item></items>', value => Utils.parseXmlDocumentStrict(value)],
        ['<items/>', () => { throw new Error('Item inventory is semantically invalid.'); }],
        ['<items><item>', () => { throw new Error('Item inventory is semantically invalid.'); }],
        ['<wrong><item>', () => { throw new Error('Expected one complete <items>...</items> XML root block.'); }]
    ]) {
        const requests = [];
        await assert.rejects(runPromptWithParseRetries({
            messages: [{ role: 'user', content: 'Return items.' }], maxAttempts: 2,
            complete: ({ messages }) => { requests.push(messages); return response; },
            parse, buildRetryInstruction: error => `Correct: ${error.message}`
        }));
        assert.doesNotMatch(requests[1].at(-1).content, /\bDONE\b/);
    }
    assert.throws(() => Utils.parseXmlDocumentStrict('<items><item>\nDONE'), /unclosed|parse/i);
});

test('parser cancellation remains terminal and does not build correction feedback', async () => {
    const cancelled = Object.assign(new Error('cancelled by user'), { code: 'PROMPT_CANCELLED' });
    let completions = 0, corrections = 0;
    await assert.rejects(runPromptWithParseRetries({
        messages: [{ role: 'user', content: 'Return items.' }], maxAttempts: 3,
        complete: () => { completions += 1; return '<items><item>'; },
        parse: () => { throw cancelled; },
        buildRetryInstruction: () => { corrections += 1; return 'correct'; }
    }), error => error === cancelled);
    assert.equal(completions, 1);
    assert.equal(corrections, 0);
});

test('shared unclosed XML feedback is idempotent and preserves the original diagnostic', () => {
    const { withUnclosedXmlDoneInstruction } = require('../XmlRetryFeedback.js');
    const error = new Error('unclosed xml tag(s): items, item');
    const details = { error, response: '<items><item>' };
    const once = withUnclosedXmlDoneInstruction(`Fix: ${error.message}`, details);
    assert.equal(withUnclosedXmlDoneInstruction(once, details), once);
    assert.match(once, /unclosed xml tag\(s\): items, item/);
    assert.equal((once.match(/\bDONE\b/g) || []).length, 1);
});
