const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
function tokenChunk(token, id, alternatives = [], finish = null) {
    return { choices: [{ delta: { content: token }, finish_reason: finish, logprobs: { content: [{ id, token, bytes: [...Buffer.from(token)], logprob: -0.1, top_logprobs: [{ id, token, logprob: -0.1 }, ...alternatives] }] } }] };
}
function stream(chunks) {
    const output = new Readable({ read() {} });
    process.nextTick(() => { for (const chunk of chunks) if (!output.destroyed) output.push(`data: ${JSON.stringify(chunk)}\n\n`); if (!output.destroyed) { output.push('data: [DONE]\n\n'); output.push(null); } });
    return output;
}
function config() { return { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1/chat/completions', apiKey: 'test', model: 'mock', stream: true, retryAttempts: 0, max_concurrent_requests: 1, suppress_seed: true, stream_start_timeout: 5, stream_continue_timeout: 5, xml_closing_tag_guard: true, live_deslop: false } }; }

test('unavailable native tools reject generated tool_call elements and select a safe sampled branch', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-tool-call-'));
    Globals.config = config();
    try {
        for (const additionalPayload of [{}, { tools: [] }, { tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }], tool_choice: 'none' }]) {
            const payloads = [];
            axios.post = async (_url, payload) => {
                payloads.push(JSON.parse(JSON.stringify(payload)));
                return { status: 200, statusText: 'OK', data: payloads.length === 1
                    ? stream([tokenChunk('<root>', 1), tokenChunk('<tool_call/>', 2, [{ id: 3, token: '<item/>', logprob: -0.2 }])])
                    : stream([tokenChunk('</root>', 4, [], 'stop')]) };
            };
            const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Return XML' }], metadataLabel: 'xml_tool_call_disabled', xmlOutput: true, validateXML: false, output: 'silent', throwOnError: true, retryAttempts: 0, additionalPayload });
            assert.equal(result, '<root><item/></root>');
            assert.equal(payloads.length, 2);
            assert.equal(payloads[1].messages.at(-1).content, '<root><item/>');
        }
        axios.post = async () => ({ status: 200, statusText: 'OK', data: stream([{ choices: [{ delta: { content: '<root><tool_call/></root>' }, finish_reason: 'stop' }] }]) });
        await assert.rejects(LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Return XML' }], metadataLabel: 'xml_tool_call_opaque', xmlOutput: true, validateXML: false, output: 'silent', throwOnError: true, retryAttempts: 0 }), /tool.call|sampled token alternative/i);
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('EOS alternatives cannot introduce a tool_call when tools are unavailable', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-tool-eos-'));
    Globals.config = config();
    const payloads = [];
    try {
        axios.post = async (_url, payload) => {
            payloads.push(JSON.parse(JSON.stringify(payload)));
            const terminal = { reason: 'eos_token', sample: { id: 99, token: '<|im_end|>', bytes: [], logprob: -0.1, top_logprobs: [{ id: 2, token: '<tool_call/>', logprob: -0.2 }, { id: 3, token: '</root>', logprob: -0.3 }] }, stop_token_ids: [99] };
            return { status: 200, statusText: 'OK', data: payloads.length === 1
                ? stream([tokenChunk('<root>', 1), { choices: [{ delta: {}, finish_reason: 'stop', logprobs: { content: [], terminal } }] }])
                : stream([tokenChunk('', 4, [], 'stop')]) };
        };
        const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Return XML' }], metadataLabel: 'xml_tool_call_eos', xmlOutput: true, validateXML: false, maxTokens: 100, output: 'silent', throwOnError: true, retryAttempts: 0 });
        assert.equal(result, '<root></root>');
        assert.equal(payloads[1].messages.at(-1).content, '<root></root>');
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('standard and scoped TinyBrain XML correct an invalid close before returning, independently of prose guard', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-guard-transport-'));
    try {
        for (const scoped of [false, true]) for (const proseOn of [false, true]) {
            Globals.config = config(); Globals.config.ai.live_deslop = proseOn;
            LLMClient.resetLiveTokenStreamCapabilitiesForTests();
            const payloads = [], proseInspections = [];
            axios.post = async (_url, payload) => {
                payloads.push(JSON.parse(JSON.stringify(payload)));
                return { status: 200, statusText: 'OK', data: payloads.length === 1
                    ? stream([tokenChunk('<root><item/>', 1), tokenChunk('</wrong>', 2, [{ id: 3, token: '</root>', logprob: -0.2 }])])
                    : stream([tokenChunk('', 4, [], 'stop')]) };
            };
            const options = { messages: [{ role: 'user', content: 'Return XML.' }], metadataLabel: 'xml_guard_mock', ...(scoped ? {} : { xmlOutput: true }), validateXML: false, output: 'silent', retryAttempts: 0, additionalPayload: { tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }], tool_choice: 'auto' }, ...(proseOn ? { onStreamToken: async state => { proseInspections.push(state.responseText); return null; } } : {}) };
            const invoke = () => LLMClient.chatCompletion(options);
            const result = scoped ? await LLMClient.withXmlOutputScope({ xmlOutput: true }, invoke) : await invoke();
            assert.equal(result, '<root><item/></root>');
            assert.equal(payloads.length, 2);
            assert.equal(payloads[0].logprobs, true);
            assert.equal(payloads[1].tools.length, 1);
            assert.equal(payloads[1].messages.at(-1).content, '<root><item/></root>');
            if (proseOn) assert.ok(proseInspections.length > 0);
        }
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('opaque invalid markup fails explicitly, while explicit plain output has no guard overhead', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-guard-opaque-'));
    Globals.config = config();
    try {
        let payload;
        axios.post = async (_url, value) => { payload = value; return { status: 200, statusText: 'OK', data: stream([{ choices: [{ delta: { content: '<root></wrong>' }, finish_reason: 'stop' }] }]) }; };
        await assert.rejects(LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'XML' }], metadataLabel: 'xml_guard_opaque', xmlOutput: true, validateXML: false, throwOnError: true, output: 'silent', retryAttempts: 0 }), /no sampled token alternative/i);
        assert.equal(payload.logprobs, true);
        LLMClient.resetLiveTokenStreamCapabilitiesForTests();
        const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Plain' }], metadataLabel: 'xml_guard_plain', xmlOutput: false, validateXML: false, throwOnError: true, output: 'silent', retryAttempts: 0 });
        assert.equal(result, '<root></wrong>');
        assert.notEqual(payload.logprobs, true);
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('actual TinyBrain runner guards structured checkpoint and excludes plain prose checkpoint', async () => {
    const nunjucks = require('nunjucks');
    const { TinyBrainPromptRunner, TinyBrainPromptExtension } = require('../TinyBrainPromptRunner.js');
    class Loader extends nunjucks.Loader { constructor(source) { super(); this.source = source; } getSource() { return { src: this.source, path: 'program', noCache: true }; } }
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-guard-tiny-'));
    Globals.config = config();
    try {
        for (const structured of [true, false]) {
            const program = structured ? "Return XML. {% llmparse('exact_xml_root', 'root') as result %}{% llmresult('capture') %}" : "Draft Response: Write prose. {% llmparse('player_action_optional_prose') as result %}{% llmresult('capture') %}";
            const env = new nunjucks.Environment(new Loader(program), { autoescape: false }); env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
            const state = TinyBrainPromptRunner.createRenderState(), context = { __tinyBrainState: state };
            const initial = state.programStartMarker + env.render('program', context);
            const payloads = [];
            axios.post = async (_url, payload) => { payloads.push(JSON.parse(JSON.stringify(payload))); return { status: 200, statusText: 'OK', data: structured
                ? (payloads.length === 1 ? stream([tokenChunk('Here it is:\n<root><item/>', 1), tokenChunk('<tool_call/>', 2, [{ id: 3, token: '</root>', logprob: -0.2 }])]) : stream([tokenChunk('', 4, [], 'stop')]))
                : stream([{ choices: [{ delta: { content: 'Ordinary words written on a sign.' }, finish_reason: 'stop' }] }]) }; };
            const runner = new TinyBrainPromptRunner({ promptEnv: env, parseXMLTemplate: generationPrompt => ({ systemPrompt: 'system', generationPrompt }), retryAttempts: 0, toolDefinitions: [], metadataLabel: 'xml_guard_tiny', logPrefix: 'xml_guard_tiny', logPrompt: () => path.join(Globals.baseDir, 'mock.log'), resultBuilders: { capture: ({ checkpointValues }) => checkpointValues[0].value }, complete: async ({ messages, queueReservation }) => { const aiResponse = await LLMClient.chatCompletion({ messages, queueReservation, metadataLabel: 'xml_guard_tiny', validateXML: false, output: 'silent', throwOnError: true, retryAttempts: 0 }); return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] }; } });
            const result = await runner.run({ initialRenderedTemplate: initial, templateContext: context, renderState: state, programTemplateName: 'program' });
            if (structured) { assert.equal(result.aiResponse, '<root><item/></root>'); assert.equal(payloads.length, 2); assert.equal(payloads[0].logprobs, true); }
            else { assert.match(result.aiResponse, /written on a sign/); assert.equal(payloads.length, 1); assert.notEqual(payloads[0].logprobs, true); }
        }
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('non-stream auto XML path corrects a wrong close using sampled alternatives', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-guard-batch-'));
    Globals.config = config();
    const payloads = [];
    try {
        axios.post = async (_url, value) => {
            payloads.push(JSON.parse(JSON.stringify(value)));
            const second = payloads.length > 1;
            const content = second ? '' : '<root></wrong>';
            const logprobs = second ? [] : [
                { id: 1, token: '<root>', logprob: -0.1, top_logprobs: [{ id: 1, token: '<root>', logprob: -0.1 }] },
                { id: 2, token: '</wrong>', logprob: -0.1, top_logprobs: [{ id: 2, token: '</wrong>', logprob: -0.1 }, { id: 3, token: '</root>', logprob: -0.2 }] }
            ];
            return { status: 200, statusText: 'OK', headers: {}, data: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content }, logprobs: { content: logprobs } }] } };
        };
        const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Structured output' }], metadataLabel: 'xml_guard_batch', validateXML: false, stream: false, throwOnError: true, output: 'silent', retryAttempts: 0 });
        assert.equal(result, '<root></root>');
        assert.equal(payloads.length, 2);
        assert.equal(payloads[0].logprobs, true);
        assert.equal(payloads[1].messages.at(-1).content, '<root></root>');
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('non-stream XML generation corrects a forbidden tool_call', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-tool-batch-'));
    Globals.config = config();
    const payloads = [];
    try {
        axios.post = async (_url, payload) => {
            payloads.push(JSON.parse(JSON.stringify(payload)));
            const first = payloads.length === 1;
            const content = first ? '<root><tool_call/>' : '</root>';
            const records = first ? [
                { id: 1, token: '<root>', logprob: -0.1, top_logprobs: [{ id: 1, token: '<root>', logprob: -0.1 }] },
                { id: 2, token: '<tool_call/>', logprob: -0.1, top_logprobs: [{ id: 2, token: '<tool_call/>', logprob: -0.1 }, { id: 3, token: '<item/>', logprob: -0.2 }] }
            ] : [{ id: 4, token: '</root>', logprob: -0.1, top_logprobs: [{ id: 4, token: '</root>', logprob: -0.1 }] }];
            return { status: 200, statusText: 'OK', headers: {}, data: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content }, logprobs: { content: records } }] } };
        };
        const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'XML' }], metadataLabel: 'xml_tool_batch', xmlOutput: true, validateXML: false, stream: false, output: 'silent', throwOnError: true, retryAttempts: 0 });
        assert.equal(result, '<root><item/></root>');
        assert.equal(payloads[1].messages.at(-1).content, '<root><item/>');
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('prose and XML guards can each correct a branch in one completion', async () => {
    const { LiveDeslopController } = require('../LiveDeslop.js');
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-guard-both-'));
    Globals.config = config(); Globals.config.ai.live_deslop = true;
    const controller = new LiveDeslopController({ detectSlop: async prose => { const match = /Bad/.exec(prose); return match ? { start: match.index, end: match.index + 3, type: 'word', label: 'Bad', slopWords: ['Bad'], slopRegexes: [], slopNgrams: [] } : null; } });
    const payloads = [];
    try {
        axios.post = async (_url, value) => {
            payloads.push(JSON.parse(JSON.stringify(value)));
            const chunks = payloads.length === 1
                ? [tokenChunk('<root><prose>', 1), tokenChunk('Bad', 2, [{ id: 3, token: 'Good', logprob: -0.2 }]), tokenChunk(' ', 4)]
                : payloads.length === 2
                    ? [tokenChunk(' ', 5), tokenChunk('</wrong>', 6, [{ id: 7, token: '</prose></root>', logprob: -0.2 }])]
                    : [tokenChunk('', 8, [], 'stop')];
            return { status: 200, statusText: 'OK', data: stream(chunks) };
        };
        const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Return XML' }], metadataLabel: 'xml_guard_both', xmlOutput: true, validateXML: false, output: 'silent', throwOnError: true, retryAttempts: 0, onStreamToken: state => controller.inspect({ ...state, preserveTools: true }) });
        assert.equal(result, '<root><prose>Good </prose></root>');
        assert.equal(payloads.length, 3);
        assert.equal(controller.getDiagnostics().corrections[0].matchType, 'word');
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('explicit forced XML bypasses live guard but retains strict final validation', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-guard-forced-'));
    Globals.config = config();
    let calls = 0; axios.post = async () => { calls++; throw new Error('unexpected provider call'); };
    try {
        const options = { messages: [{ role: 'user', content: 'Return XML' }], metadataLabel: 'xml_guard_forced', xmlOutput: true, validateXML: true, validateXMLStrict: true, output: 'silent', retryAttempts: 0, throwOnError: true };
        assert.equal(await LLMClient.chatCompletion({ ...options, forceOutput: '<root><child/></root>' }), '<root><child/></root>');
        await assert.rejects(LLMClient.chatCompletion({ ...options, forceOutput: '<root></wrong>' }), /xml|tag|validation|malformed/i);
        assert.equal(calls, 0);
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; }
});

test('completed XML validation rejects active tool_call with tools unavailable even without live guard', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-tool-final-'));
    Globals.config = config(); Globals.config.ai.xml_closing_tag_guard = false;
    axios.post = async () => { throw new Error('unexpected provider call'); };
    try {
        const options = { messages: [{ role: 'user', content: 'Return XML' }], metadataLabel: 'xml_tool_final', expectedXmlRootTag: 'root', validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true };
        await assert.rejects(LLMClient.chatCompletion({ ...options, forceOutput: '<root><tool_call name="lookup"/></root>' }), /tool.call/i);
        let callbacks = 0;
        await assert.rejects(LLMClient.chatCompletion({ ...options, onResponse: () => { callbacks++; }, forceOutput: '<root>ok</root><tool_call/>' }), /tool.call/i);
        await assert.rejects(LLMClient.chatCompletion({ ...options, forceOutput: '<wrong></mismatch><tool_call/><root>ok</root>' }), /tool.call/i);
        assert.equal(callbacks, 0);
        for (const text of ['<root>&lt;tool_call/&gt;</root>', '<root><!-- <tool_call/> --></root>', '<root><![CDATA[<tool_call/>]]></root>']) {
            assert.equal(await LLMClient.chatCompletion({ ...options, forceOutput: text }), text);
        }
        const enabled = { tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }], tool_choice: 'auto' };
        assert.equal(await LLMClient.chatCompletion({ ...options, additionalPayload: enabled, forceOutput: '<root><tool_call/></root>' }), '<root><tool_call/></root>');
        assert.equal(await LLMClient.chatCompletion({ ...options, expectedXmlRootTag: null, xmlOutput: false, forceOutput: '<tool_call/>' }), '<tool_call/>');
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; }
});

test('non-strict fixture miss still guards the actual provider response', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir, env: process.env.LLM_FORCE_OUTPUTS_FILE };
    fs.mkdirSync(path.join(__dirname, '..', 'tmp'), { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp', 'xml-guard-fixture-'));
    const fixture = path.join(Globals.baseDir, 'fixture.json');
    fs.writeFileSync(fixture, JSON.stringify({ strict: false, byMetadataLabel: { unrelated: ['<root/>'] } }));
    Globals.config = config(); Globals.config.ai.force_outputs_file = fixture;
    delete process.env.LLM_FORCE_OUTPUTS_FILE; LLMClient.resetForcedOutputState();
    let calls = 0;
    axios.post = async (_url, payload) => { calls++; assert.equal(payload.logprobs, true); return { status: 200, statusText: 'OK', data: calls === 1 ? stream([tokenChunk('<root>', 1), tokenChunk('</wrong>', 2, [{ id: 3, token: '</root>', logprob: -0.2 }])]) : stream([tokenChunk('', 4, [], 'stop')]) }; };
    try {
        const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Generate XML' }], metadataLabel: 'missing_bucket', xmlOutput: true, validateXML: false, output: 'silent', throwOnError: true, retryAttempts: 0 });
        assert.equal(result, '<root></root>'); assert.equal(calls, 2);
    } finally {
        axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base;
        if (old.env === undefined) delete process.env.LLM_FORCE_OUTPUTS_FILE; else process.env.LLM_FORCE_OUTPUTS_FILE = old.env;
        LLMClient.resetForcedOutputState(); LLMClient.resetLiveTokenStreamCapabilitiesForTests();
    }
});
