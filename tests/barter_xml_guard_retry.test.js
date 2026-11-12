'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const { loadXmlGenerationSchema } = require('../XmlGenerationSchema.js');
const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
const { LiveDeslopController } = require('../LiveDeslop.js');
const { runPromptWithParseRetries } = require('../PromptRetryPolicy.js');
const schema = loadXmlGenerationSchema('barter-prices.schema.xml');
const guard = () => new XmlClosingTagGuard({ schema });
const eos = { reason: 'eos_token', sample: { id: 99, token: '<|im_end|>', bytes: [], logprob: -0.1, top_logprobs: [] }, stop_token_ids: [99] };
const valid = '<barterPrices><generalReasoning>Fair</generalReasoning><merchantCurrency>25</merchantCurrency><haggleResponse/><continueTrading>true</continueTrading><playerItems/><merchantItems/><newStock/></barterPrices>';

test('barter schema permits empty and repeated lists while rejecting nested and invented fields', () => {
    assert.equal(guard().inspect(valid), null);
    assert.equal(guard().terminalState(valid).incomplete, false);
    assert.equal(guard().inspect(valid.replace('<playerItems/>', '<playerItems><item><unitPrice>1</unitPrice></item><item><unitPrice>2</unitPrice></item></playerItems>')), null);
    for (const invalid of [valid.replace('<playerItems/>', '<playerItems><playerItems/>'), valid.replace('<newStock/>', '<newStock><invented/>'), valid.replace('<merchantItems/>', '')]) assert.ok(guard().inspect(invalid), invalid);
});

test('barter EOS forces structural tags without fabricating required scalar content', async () => {
    const controller = new LiveDeslopController({ detectSlop: async () => null });
    const prefix = '<barterPrices><generalReasoning>Fair</generalReasoning><merchantCurrency>25</merchantCurrency><haggleResponse/><continueTrading>true</continueTrading><playerItems/>';
    const result = await controller.inspectXmlTerminal({ responseText: prefix, terminal: eos, finishReason: 'stop', schema, remainingTokens: 100, continuationLimit: 10 });
    assert.match(result.alternative.token, /^<merchantItems>/);
    assert.doesNotMatch(result.alternative.token, /true|false|\d/);
    const complete = await new LiveDeslopController({ detectSlop: async () => null }).inspectXmlTerminal({ responseText: prefix + '<merchantItems></merchantItems><newStock></newStock>', terminal: eos, finishReason: 'stop', schema, remainingTokens: 100, continuationLimit: 10 });
    assert.equal(complete.documentComplete, true);
    assert.equal(complete.responseText, prefix + '<merchantItems></merchantItems><newStock></newStock></barterPrices>');
    const needsValue = await new LiveDeslopController({ detectSlop: async () => null }).inspectXmlTerminal({ responseText: '<barterPrices>', terminal: eos, finishReason: 'stop', schema, remainingTokens: 100, continuationLimit: 10 });
    assert.equal(needsValue.alternative.token, '<generalReasoning>');
});

test('only model guard failures are classified as correctable', async () => {
    const input = { responseText: '<barterPrices>', terminal: eos, finishReason: 'stop', schema };
    for (const extra of [{ remainingTokens: -1 }, { remainingTokens: 10, continuationLimit: -1 }, { remainingTokens: 10, terminal: null }]) {
        await assert.rejects(new LiveDeslopController({ detectSlop: async () => null }).inspectXmlTerminal({ ...input, ...extra }), error => { assert.notEqual(error.isXmlGuardResponseError, true); return true; });
    }
    await assert.rejects(new LiveDeslopController({ detectSlop: async () => null }).inspectXmlTerminal({ ...input, remainingTokens: 0 }), error => { assert.equal(error.isXmlGuardResponseError, true); return true; });
});

test('barter guard exhaustion retries a fresh response through actual completion transport', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir, hub: Globals.realtimeHub };
    Globals.baseDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'barter-guard-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1', apiKey: 'test', model: 'mock', stream: false, retryAttempts: 0, max_concurrent_requests: 1, suppress_seed: true, xml_closing_tag_guard: true, live_deslop: false } };
    const requests = [], attempts = [], notifications = [], parsed = [];
    Globals.realtimeHub = { emit: (...args) => notifications.push(args) };
    const partial = '<barterPrices><generalReasoning>Fair';
    axios.post = async (_url, payload) => {
        requests.push(structuredClone(payload));
        const text = requests.length === 1 ? partial : valid;
        return { status: 200, statusText: 'OK', headers: {}, data: { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop', logprobs: { content: [{ id: 1, token: text, bytes: [...Buffer.from(text)], logprob: -0.1, top_logprobs: [] }], terminal: eos } }], usage: { completion_tokens: requests.length === 1 ? 100 : 1 } } };
    };
    try {
        LLMClient.resetLiveTokenStreamCapabilitiesForTests();
        const result = await runPromptWithParseRetries({ metadataLabel: 'barter_guard_test', messages: [{ role: 'user', content: 'Price these items.' }], maxAttempts: 2, retainRejectedResponse: false,
            complete: ({ messages }) => LLMClient.chatCompletion({ messages, metadataLabel: 'barter_guard_test', xmlSchema: 'barter-prices.schema.xml', validateXML: false, stream: false, maxTokens: 100, retryAttempts: 0, throwOnError: true, output: 'silent' }),
            parse: text => { parsed.push(text); return text; },
            getCorrectableCompletionResponse: error => error.isXmlGuardResponseError === true && typeof error.rejectedResponse === 'string' ? error.rejectedResponse : null,
            buildRetryInstruction: error => `Return a complete corrected response. ${error.message}`,
            onAttempt: attempt => { attempts.push(attempt); }
        });
        assert.equal(result.value, valid);
        assert.deepEqual(parsed, [valid], 'rejected partial response never reaches the parser');
        assert.equal(requests.length, 2);
        assert.equal(attempts[0].phase, 'completion');
        assert.equal(attempts[0].response, partial);
        assert.equal(attempts[1].accepted, true);
        assert.equal(requests[1].messages[0].content, 'Price these items.');
        assert.ok(!requests[1].messages.some(message => message.role === 'assistant' && message.content === partial));
        assert.match(requests[1].messages.at(-1).content, /complete corrected response/i);
        assert.ok(!notifications.some(args => args[1] === 'prompt_failed'));
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; Globals.realtimeHub = old.hub; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('opt-in completion correction respects its budget and never retries cancellation or unrelated failures', async () => {
    const marker = error => error.isXmlGuardResponseError === true ? error.rejectedResponse : null;
    const failures = [new Error('first guard failure'), new Error('last guard failure')];
    failures.forEach(error => { error.isXmlGuardResponseError = true; error.rejectedResponse = '<barterPrices>'; });
    let calls = 0, parsed = 0;
    await assert.rejects(runPromptWithParseRetries({ messages: [{ role: 'user', content: 'Price items.' }], maxAttempts: 2,
        complete: async () => { throw failures[calls++]; }, parse: () => { parsed++; },
        getCorrectableCompletionResponse: marker, buildRetryInstruction: () => 'Correct the response.'
    }), error => { assert.equal(error.cause, failures[1]); return true; });
    assert.equal(calls, 2);
    assert.equal(parsed, 0);
    for (const error of [Object.assign(new Error('cancelled'), { code: 'PROMPT_CANCELLED' }), new Error('transport failure')]) {
        calls = 0; let classified = 0;
        await assert.rejects(runPromptWithParseRetries({ messages: [{ role: 'user', content: 'Price items.' }], maxAttempts: 2,
            complete: async () => { calls++; throw error; }, parse: () => { parsed++; },
            getCorrectableCompletionResponse: candidate => { classified++; return marker(candidate); }, buildRetryInstruction: () => 'Correct the response.'
        }), actual => actual === error);
        assert.equal(calls, 1);
        assert.equal(classified, error.code === 'PROMPT_CANCELLED' ? 0 : 1);
    }
    assert.equal(parsed, 0);
});
