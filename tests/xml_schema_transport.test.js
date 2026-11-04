const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const directory = path.join(__dirname, 'fixtures', 'xml-generation-schema');
const terminal = { reason: 'eos_token', sample: { id: 99, token: '<|im_end|>', bytes: [], logprob: -0.1, top_logprobs: [] }, stop_token_ids: [99] };
const token = (text, id) => ({ id, token: text, bytes: [...Buffer.from(text)], logprob: -0.1, top_logprobs: [] });
const sse = chunks => Readable.from(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).concat('data: [DONE]\n\n'));

test('named schema forces missing opening tag through direct and scoped streaming/nonstreaming completion', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-schema-transport-'));
    try {
        for (const streaming of [true, false]) for (const scoped of [false, true]) {
            Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1/chat/completions', apiKey: 'test', model: 'mock', stream: streaming, retryAttempts: 1, max_concurrent_requests: 1, suppress_seed: true, stream_start_timeout: 5, stream_continue_timeout: 5, xml_closing_tag_guard: true, live_deslop: false } };
            LLMClient.resetLiveTokenStreamCapabilitiesForTests();
            const payloads = [];
            axios.post = async (_url, payload) => {
                payloads.push(JSON.parse(JSON.stringify(payload)));
                const first = payloads.length === 1;
                const content = first ? '<root></root>' : 'value</required></root>';
                const data = streaming ? sse([{ choices: [{ delta: { content }, finish_reason: null, ...(first ? {} : { logprobs: { content: [token(content, 4)] } }) }] }, { choices: [{ delta: {}, finish_reason: 'stop', logprobs: { content: [], terminal } }], usage: { completion_tokens: 2 } }]) : { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop', logprobs: { content: [token(content, first ? 1 : 4)], terminal } }], usage: { completion_tokens: 2 } };
                return { status: 200, statusText: 'OK', headers: {}, data };
            };
            let extensionCalls = 0;
            const schemaOptions = { xmlSchema: 'root.schema.xml', xmlSchemaDirectory: directory, xmlSchemaExtensions: () => { extensionCalls++; return []; } };
            const invoke = () => LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'XML' }], metadataLabel: 'xml_schema_mock', ...(scoped ? {} : schemaOptions), validateXML: false, stream: streaming, maxTokens: 100, retryAttempts: 1, throwOnError: true, output: 'silent', responseValidator(text) { if (!text.includes('value')) throw new Error('domain value missing'); } });
            const result = scoped ? await LLMClient.withXmlOutputScope({ xmlOutput: true, ...schemaOptions }, invoke) : await invoke();
            assert.equal(result, '<root><required>value</required></root>');
            assert.equal(payloads.length, 2);
            assert.equal(extensionCalls, 1);
            assert.equal(payloads[1].messages.at(-1).content, '<root><required>');
            const logs = fs.readdirSync(path.join(Globals.baseDir, 'logs')).filter(file => /xmlClosingGuard|xmlSchemaCompletion/.test(file) && file.includes('xml_schema_mock'));
            assert.ok(logs.length, 'a branch correction writes a diagnostic file');
            const diagnostics = logs.map(file => fs.readFileSync(path.join(Globals.baseDir, 'logs', file), 'utf8')).join('\n');
            assert.match(diagnostics, /xml-schema-forced/);
            assert.match(diagnostics, /xml-schema-complete/);
            assert.match(diagnostics, /required/);
        }
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('terminal EOS without alternatives forces a required prefix through the actual streaming transport', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-schema-eos-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1/chat/completions', apiKey: 'test', model: 'mock', stream: true, retryAttempts: 1, max_concurrent_requests: 1, suppress_seed: true, stream_start_timeout: 5, stream_continue_timeout: 5, xml_closing_tag_guard: true, live_deslop: false } };
    const payloads = [];
    try {
        axios.post = async (_url, payload) => {
            payloads.push(JSON.parse(JSON.stringify(payload)));
            const text = payloads.length === 1 ? '<root>' : 'value</required></root>';
            return { status: 200, statusText: 'OK', headers: {}, data: sse([{ choices: [{ delta: { content: text }, finish_reason: null, logprobs: { content: [token(text, 1)] } }] }, { choices: [{ delta: {}, finish_reason: 'stop', logprobs: { content: [], terminal } }], usage: { completion_tokens: 2 } }]) };
        };
        const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'XML' }], metadataLabel: 'xml_schema_eos', xmlSchema: 'root.schema.xml', xmlSchemaDirectory: directory, validateXML: false, stream: true, maxTokens: 100, retryAttempts: 1, throwOnError: true, output: 'silent' });
        assert.equal(result, '<root><required>value</required></root>');
        assert.equal(payloads[1].messages.at(-1).content, '<root><required>');
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('named schema selects its root without an explicit expected root', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-schema-root-'));
    try {
        for (const streaming of [true, false]) {
            Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1/chat/completions', apiKey: 'test', model: 'mock', stream: streaming, retryAttempts: 0, max_concurrent_requests: 1, suppress_seed: true, stream_start_timeout: 5, stream_continue_timeout: 5, xml_closing_tag_guard: true, live_deslop: false } };
            LLMClient.resetLiveTokenStreamCapabilitiesForTests();
            const content = 'Prose <unrelated><root><required>value</required></root><tool_call>';
            axios.post = async () => ({ status: 200, statusText: 'OK', headers: {}, data: streaming ? sse([{ choices: [{ delta: { content }, finish_reason: null, logprobs: { content: [token(content, 1)] } }] }, { choices: [{ delta: {}, finish_reason: 'stop', logprobs: { content: [], terminal } }], usage: { completion_tokens: 2 } }]) : { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop', logprobs: { content: [token(content, 1)], terminal } }], usage: { completion_tokens: 2 } } });
            const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'XML' }], metadataLabel: 'schema_root_scope', xmlSchema: 'root.schema.xml', xmlSchemaDirectory: directory, validateXML: false, stream: streaming, maxTokens: 100, retryAttempts: 0, throwOnError: true, output: 'silent' });
            assert.match(result, /<root><required>value<\/required><\/root>/);
        }
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('schema-derived final tool policy works for forced output without an AI profile', async () => {
    const old = { config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-schema-force-'));
    Globals.config = {};
    try {
        const options = { messages: [{ role: 'user', content: 'XML' }], metadataLabel: 'schema_forced_root', xmlSchema: 'root.schema.xml', xmlSchemaDirectory: directory, xmlSchemaExtensions: () => { throw new Error('inactive extension provider must not run'); }, validateXML: false, retryAttempts: 0, throwOnError: true, output: 'silent' };
        const outside = '<tool_call/><root><required>value</required></root><tool_call>';
        assert.equal(await LLMClient.chatCompletion({ ...options, forceOutput: outside }), outside);
        await assert.rejects(LLMClient.chatCompletion({ ...options, forceOutput: '<root><tool_call/></root>' }), /tool.call/i);
    } finally { Globals.config = old.config; Globals.baseDir = old.base; }
});

test('guard-disabled schema policy does not invoke lazy extension provider', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-schema-inactive-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1/chat/completions', apiKey: 'test', model: 'mock', stream: false, retryAttempts: 0, max_concurrent_requests: 1, xml_closing_tag_guard: false } };
    const content = '<tool_call/><root><required>value</required></root>';
    axios.post = async () => ({ status: 200, statusText: 'OK', headers: {}, data: { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] } });
    try {
        const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'XML' }], metadataLabel: 'schema_inactive_root', xmlSchema: 'root.schema.xml', xmlSchemaDirectory: directory, xmlSchemaExtensions: () => { throw new Error('inactive extension provider must not run'); }, validateXML: false, retryAttempts: 0, throwOnError: true, output: 'silent' });
        assert.equal(result, content);
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; }
});

test('nested XML scopes replace inherited root options and reject conflicting explicit roots', async () => {
    const old = { config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-root-options-'));
    Globals.config = {};
    const options = { messages: [{ role: 'user', content: 'XML' }], metadataLabel: 'scope_root_options', validateXML: false, retryAttempts: 0, throwOnError: true, output: 'silent', xmlSchema: 'root.schema.xml', xmlSchemaDirectory: directory, xmlSchemaExtensions: () => { throw new Error('inactive extension provider must not run'); } };
    try {
        await LLMClient.withXmlOutputScope({ expectedXmlRootTag: 'first' }, async () => {
            const content = '<tool_call/><second/>';
            assert.equal(await LLMClient.withXmlOutputScope({ expectedXmlRootTags: ['second', 'third'] }, () => LLMClient.chatCompletion({ ...options, forceOutput: content })), content);
            assert.throws(() => LLMClient.withXmlOutputScope({ expectedXmlRootTag: 'second', expectedXmlRootTags: ['third'] }, async () => {}), /expectedXmlRootTag or expectedXmlRootTags/i);
        });
        await LLMClient.withXmlOutputScope({ expectedXmlRootTags: ['first', 'third'] }, async () => {
            const content = '<tool_call/><second/>';
            assert.equal(await LLMClient.withXmlOutputScope({ expectedXmlRootTag: 'second' }, () => LLMClient.chatCompletion({ ...options, forceOutput: content })), content);
        });
    } finally { Globals.config = old.config; Globals.baseDir = old.base; }
});
