const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

const record = (token, id) => ({ id, token, bytes: [...Buffer.from(token)], logprob: -0.1, top_logprobs: [] });
const terminal = alternative => ({ reason: 'eos_token', sample: { ...record('<|im_end|>', 99), top_logprobs: alternative ? [record(alternative, 2)] : [] }, stop_token_ids: [99] });
function sse(chunks) { return Readable.from(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).concat('data: [DONE]\n\n')); }

test('terminal-only EOS metadata continues incomplete XML in streaming and non-streaming requests', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-eos-transport-'));
    try {
        for (const streaming of [true, false]) for (const scoped of [false, true]) {
            Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1/chat/completions', apiKey: 'test', model: 'mock', stream: streaming, retryAttempts: 1, max_concurrent_requests: 1, suppress_seed: true, stream_start_timeout: 5, stream_continue_timeout: 5, xml_closing_tag_guard: true, live_deslop: false } };
            LLMClient.resetLiveTokenStreamCapabilitiesForTests();
            const payloads = [];
            axios.post = async (_url, payload) => {
                payloads.push(JSON.parse(JSON.stringify(payload)));
                const first = payloads.length === 1;
                const body = first ? '<root>' : '';
                const meta = terminal(first ? '</root>' : null);
                const data = streaming ? sse([
                    ...(first ? [{ choices: [{ delta: { content: body }, finish_reason: null, logprobs: { content: [record(body, 1)] } }] }] : []),
                    { choices: [{ delta: {}, finish_reason: 'stop', logprobs: { content: [], terminal: meta } }], usage: { completion_tokens: first ? 2 : 1 } }
                ]) : { choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop', logprobs: { content: first ? [record(body, 1)] : [], terminal: meta } }], usage: { completion_tokens: first ? 2 : 1 } };
                return { status: 200, statusText: 'OK', headers: {}, data };
            };
            const invoke = () => LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Return XML' }], metadataLabel: 'xml_eos_mock', ...(scoped ? {} : { xmlOutput: true }), validateXML: false, stream: streaming, maxTokens: 100, retryAttempts: 1, throwOnError: true, output: 'silent' });
            const result = scoped ? await LLMClient.withXmlOutputScope({ xmlOutput: true }, invoke) : await invoke();
            assert.equal(result, '<root></root>');
            assert.equal(payloads.length, 2);
            assert.equal(payloads[1].messages.at(-1).content, '<root></root>');
            assert.ok(payloads[1].max_tokens < payloads[0].max_tokens);
        }
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('ordinary validation retry receives its original token budget', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-eos-retry-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1/chat/completions', apiKey: 'test', model: 'mock', stream: false, retryAttempts: 1, max_concurrent_requests: 1, suppress_seed: true, xml_closing_tag_guard: true, live_deslop: false } };
    const payloads = [];
    try {
        axios.post = async (_url, payload) => {
            payloads.push(JSON.parse(JSON.stringify(payload)));
            const content = payloads.length === 1 ? '<root>bad</root>' : '<root>good</root>';
            return { status: 200, statusText: 'OK', headers: {}, data: { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop', logprobs: { content: [record(content, 1)], terminal: terminal(null) } }], usage: { completion_tokens: 2 } } };
        };
        const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'XML' }], metadataLabel: 'xml_eos_retry', xmlOutput: true, validateXML: false, responseValidationRetryFeedback: true, responseValidator(text) { if (text.includes('bad')) throw new Error('Bad value'); }, stream: false, maxTokens: 100, retryAttempts: 1, waitAfterError: 0, throwOnError: true, output: 'silent' });
        assert.equal(result, '<root>good</root>');
        assert.deepEqual(payloads.map(payload => payload.max_tokens), [100, 100]);
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('declared root ignores surrounding markup and missing-root EOS requests a corrected response', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-root-scope-'));
    try {
        for (const streaming of [true, false]) for (const missing of ['Explanation only.', '<wrong>complete</wrong>']) {
            Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1/chat/completions', apiKey: 'test', model: 'mock', stream: streaming, retryAttempts: 1, max_concurrent_requests: 1, suppress_seed: true, stream_start_timeout: 5, stream_continue_timeout: 5, xml_closing_tag_guard: true, live_deslop: false } };
            LLMClient.resetLiveTokenStreamCapabilitiesForTests();
            const payloads = [];
            axios.post = async (_url, payload) => {
                payloads.push(JSON.parse(JSON.stringify(payload)));
                const body = payloads.length === 1 ? missing : 'Preface <unrelated><root><child/></root><tool_call>';
                const data = streaming ? sse([
                    { choices: [{ delta: { content: body }, finish_reason: null, logprobs: { content: [record(body, 1)] } }] },
                    { choices: [{ delta: {}, finish_reason: 'stop', logprobs: { content: [], terminal: terminal(null) } }], usage: { completion_tokens: 2 } }
                ]) : { choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop', logprobs: { content: [record(body, 1)], terminal: terminal(null) } }], usage: { completion_tokens: 2 } };
                return { status: 200, statusText: 'OK', headers: {}, data };
            };
            const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Return XML' }], metadataLabel: 'xml_root_scope_mock', expectedXmlRootTag: 'root', validateXML: false, responseValidationRetryFeedback: true, stream: streaming, maxTokens: 100, retryAttempts: 1, waitAfterError: 0, throwOnError: true, output: 'silent' });
            assert.match(result, /<root><child\/><\/root>/);
            assert.equal(payloads.length, 2);
            assert.match(JSON.stringify(payloads[1].messages), /Wrap your response in <root>\.\.\.<\/root>\./);
        }
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});
