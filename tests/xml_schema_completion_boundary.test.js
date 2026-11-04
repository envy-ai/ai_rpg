const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const schemas = path.join(__dirname, 'fixtures', 'xml-generation-schema');
const token = (text, id = 1) => ({ id, token: text, bytes: [...Buffer.from(text)], logprob: -0.1, top_logprobs: [] });
const eos = { reason: 'eos_token', sample: { id: 99, token: '<|im_end|>', logprob: -0.1, top_logprobs: [{ id: 3, token: 'extra', logprob: -0.2 }] }, stop_token_ids: [99] };
function makeStream(events) { return Readable.from(events.map(event => `data: ${JSON.stringify(event)}\n\n`).concat('data: [DONE]\n\n')); }
function setup() {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    const tmp = path.join(__dirname, '..', 'tmp'); fs.mkdirSync(tmp, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(tmp, 'xml-root-boundary-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1/chat/completions', apiKey: 'test', model: 'mock', stream: true, retryAttempts: 1, max_concurrent_requests: 1, suppress_seed: true, stream_start_timeout: 5, stream_continue_timeout: 5, xml_closing_tag_guard: true, live_deslop: false } };
    return () => { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); };
}
function response(text, streaming, opaque = false) {
    if (!streaming) return { status: 200, statusText: 'OK', headers: {}, data: { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop', logprobs: { content: [token(text)], terminal: eos } }], usage: { completion_tokens: 2 } } };
    const events = [{ choices: [{ delta: { content: text }, finish_reason: null, ...(opaque ? {} : { logprobs: { content: [token(text)] } }) }] }, { choices: [{ delta: {}, finish_reason: 'stop', logprobs: { content: [], terminal: eos } }], usage: { completion_tokens: 2 } }];
    return { status: 200, statusText: 'OK', headers: {}, data: makeStream(events) };
}
const options = streaming => ({ messages: [{ role: 'user', content: 'XML' }], metadataLabel: 'schema_completion_boundary', xmlSchema: 'root.schema.xml', xmlSchemaDirectory: schemas, validateXML: false, stream: streaming, maxTokens: 100, retryAttempts: 1, throwOnError: true, output: 'silent' });

test('EOS closes satisfiable open elements locally before considering sample alternatives', async () => {
    const restore = setup();
    try {
        for (const streaming of [true, false]) {
            let calls = 0, validated = 0; LLMClient.resetLiveTokenStreamCapabilitiesForTests();
            axios.post = async () => { calls++; return response('<root><required>value', streaming); };
            const result = await LLMClient.chatCompletion({ ...options(streaming), responseValidator(text) { validated++; assert.equal(text, '<root><required>value</required></root>'); } });
            assert.equal(result, '<root><required>value</required></root>'); assert.equal(calls, 1); assert.equal(validated, 1);
        }
    } finally { restore(); }
});

test('first complete schema root stops at exact boundary, including trailing bytes in sampled or opaque chunks', async () => {
    const restore = setup();
    try {
        for (const [streaming, opaque] of [[true, false], [true, true], [false, false]]) {
            let calls = 0; LLMClient.resetLiveTokenStreamCapabilitiesForTests();
            axios.post = async () => { calls++; return response('<root><required>value</required></root>BAD<other/>', streaming, opaque); };
            const result = await LLMClient.chatCompletion(options(streaming));
            assert.equal(result, '<root><required>value</required></root>'); assert.equal(calls, 1);
        }
    } finally { restore(); }
});

test('EOS opens a missing required sibling and asks the model for its value', async () => {
    const restore = setup();
    try {
        let calls = 0, secondPayload;
        axios.post = async (_url, payload) => {
            calls++;
            if (calls === 2) secondPayload = payload;
            return response(calls === 1 ? '<root><first>one' : 'two</second></root>', true);
        };
        const result = await LLMClient.chatCompletion({ ...options(true), xmlSchema: 'two-required.schema.xml' });
        assert.equal(result, '<root><first>one</first><second>two</second></root>');
        assert.equal(calls, 2);
        assert.equal(secondPayload.messages.at(-1).content, '<root><first>one</first><second>');
    } finally { restore(); }
});

test('local structural closure still invokes the final domain validator', async () => {
    const restore = setup();
    try {
        let calls = 0, validations = 0;
        axios.post = async () => { calls++; return response('<root><required>', false); };
        await assert.rejects(LLMClient.chatCompletion({ ...options(false), retryAttempts: 0, responseValidator() { validations++; throw new Error('Required value cannot be empty'); } }), /Required value cannot be empty/);
        assert.equal(calls, 1); assert.equal(validations, 1);
    } finally { restore(); }
});

test('plain and schema-less outputs do not use schema root cutoff', async () => {
    const restore = setup();
    try {
        for (const explicitPlain of [true, false]) {
            LLMClient.resetLiveTokenStreamCapabilitiesForTests();
            const body = '<root>value</root> trailing prose';
            axios.post = async () => response(body, false);
            const { xmlSchema, xmlSchemaDirectory, ...base } = options(false);
            const result = await LLMClient.chatCompletion({ ...base, xmlOutput: explicitPlain ? false : true });
            assert.equal(result, body);
        }
    } finally { restore(); }
});

test('turn audit separates local EOS closure and document cutoff without fabricated sampled token records', async () => {
    const Audit = require('../PromptAuditLog.js'); const restore = setup();
    try {
        for (const early of [false, true]) {
            let snapshot; const completeStates = [];
            axios.post = async () => response(early ? '<root><required>ok</required></root>trailing' : '<root><required>ok', true);
            const owner = await Audit.runTurn({ requestId: `boundary-${early}`, route: 'chat', logDirectory: Globals.baseDir }, async () => {
                const owner = Audit.currentTurn();
                await Audit.runPrompt({ metadataLabel: 'schema_completion_boundary' }, async () => {
                    const result = await LLMClient.chatCompletion({ ...options(true), onStreamToken(state) { if (state.responseComplete) completeStates.push(state); return null; } });
                    assert.equal(result, '<root><required>ok</required></root>');
                    snapshot = Audit.snapshot(owner);
                });
                return owner;
            });
            await Audit.waitForFinalization(owner);
            assert.equal(snapshot.xmlGenerationCount, 1);
            assert.equal(snapshot.xmlCompletionCount, 1);
            assert.equal(snapshot.xmlSelectionCount, early ? 0 : 1);
            assert.equal(snapshot.xmlEnforcementRows.filter(row => row.action === 'eos-closure-selected').length, early ? 0 : 1);
            assert.equal(completeStates.length, 1);
            assert.equal(completeStates[0].responseText, '<root><required>ok</required></root>');
            for (const record of completeStates[0].tokenRecords) assert.ok(record.end <= '<root><required>ok'.length, 'no synthetic or shortened crossing token records');
        }
    } finally { restore(); }
});

test('provider length on a completed root preserves raw finish reason while stopping at boundary', async () => {
    const Audit = require('../PromptAuditLog.js'); const restore = setup();
    const originalLog = console.log, timings = [];
    try {
        console.log = (...args) => { if (typeof args[0] === 'string' && args[0].startsWith('LLM completion timing: ')) timings.push(JSON.parse(args[0].slice('LLM completion timing: '.length))); };
        axios.post = async () => { const result = response('<root><required>ok</required></root>trailing', false); result.data.choices[0].finish_reason = 'length'; result.data.choices[0].logprobs.terminal = { reason: 'token_limit' }; return result; };
        const value = await LLMClient.chatCompletion(options(false));
        assert.equal(value, '<root><required>ok</required></root>');
        assert.equal(timings.at(-1).providerFinishReason, 'length');
    } finally { console.log = originalLog; restore(); }
});

test('tool-capable streaming waits for later native tool call before deciding schema completion', async () => {
    const restore = setup();
    try {
        const events = [
            { choices: [{ delta: { content: '<root><required>ok</required></root>' }, finish_reason: null, logprobs: { content: [token('<root><required>ok</required></root>')] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }
        ];
        axios.post = async () => ({ status: 200, statusText: 'OK', headers: {}, data: makeStream(events) });
        const sentinel = new Error('observed native tool'); let observed;
        const tool = { type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } };
        await assert.rejects(LLMClient.chatCompletion({ ...options(true), additionalPayload: { tools: [tool], tool_choice: 'auto' }, onResponse(response) { observed = response.data; throw sentinel; } }), error => error === sentinel);
        assert.equal(observed.choices[0].finish_reason, 'tool_calls');
        assert.equal(observed.choices[0].message.tool_calls[0].function.name, 'lookup');
    } finally { restore(); }
});
