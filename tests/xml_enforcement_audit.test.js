const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const Audit = require('../PromptAuditLog.js');
const tmp = path.join(__dirname, '..', 'tmp');
const schemas = path.join(__dirname, 'fixtures', 'xml-generation-schema');
const token = (text, id, alternatives = []) => ({ id, token: text, logprob: -0.1, top_logprobs: [{ id, token: text, logprob: -0.1 }, ...alternatives] });
const eos = { reason: 'eos_token', sample: { id: 99, token: '<|im_end|>', logprob: -0.1, top_logprobs: [] }, stop_token_ids: [99] };

test('actual guarded completion writes compact turn summaries for clean, sampled, forced and failed branches', async () => {
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    fs.mkdirSync(tmp, { recursive: true }); Globals.baseDir = fs.mkdtempSync(path.join(tmp, 'xml-audit-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1/chat/completions', apiKey: 'test', model: 'mock', stream: false, retryAttempts: 0, max_concurrent_requests: 1, suppress_seed: true, xml_closing_tag_guard: true, live_deslop: false } };
    try {
        for (const scenario of ['clean', 'sampled', 'forced', 'failure']) {
            let call = 0, snapshot;
            axios.post = async () => {
                call++;
                const first = call === 1;
                const text = scenario === 'clean' ? '<root><required>secret-body</required></root>' : scenario === 'sampled' ? (first ? '<root></wrong>' : '') : scenario === 'forced' ? (first ? '<root></root>' : 'secret-body</required></root>') : '<root></wrong>';
                const records = scenario === 'sampled' && first ? [token('<root>', 1), token('</wrong>', 2, [{ id: 3, token: '</root>', logprob: -0.2 }])] : [token(text, 1)];
                return { status: 200, statusText: 'OK', headers: {}, data: { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop', logprobs: { content: records, terminal: eos } }], usage: { completion_tokens: 2 } } };
            };
            const turn = await Audit.runTurn({ requestId: `audit-${scenario}`, route: 'chat', startLocation: { id: 'loc', name: 'Market' }, getLocation: () => ({ id: 'loc', name: 'Market' }), logDirectory: Globals.baseDir }, async () => {
                const owner = Audit.currentTurn();
                await Audit.runPrompt({ metadataLabel: 'audit_prompt' }, async () => Audit.runStage({ stage: 'checkpoint', parser: 'fixture', checkpoint: 2 }, async () => {
                    const options = { messages: [{ role: 'user', content: 'secret-prompt' }], metadataLabel: 'audit_prompt', xmlOutput: true, validateXML: false, stream: false, maxTokens: 100, retryAttempts: 0, throwOnError: true, output: 'silent', ...(scenario === 'clean' || scenario === 'forced' ? { xmlSchema: 'root.schema.xml', xmlSchemaDirectory: schemas } : {}) };
                    if (scenario === 'failure') await assert.rejects(LLMClient.chatCompletion(options), /alternative/i);
                    else await LLMClient.chatCompletion(options);
                    snapshot = Audit.snapshot(owner);
                }));
                return owner;
            });
            const file = await Audit.waitForFinalization(turn);
            const content = await fs.promises.readFile(file, 'utf8');
            assert.equal(snapshot.errorCount, scenario === 'failure' ? 1 : 0);
            assert.ok(snapshot.xmlGenerationCount >= 1);
            assert.equal(snapshot.xmlSelectionCount, ['sampled', 'forced'].includes(scenario) ? 1 : 0);
            assert.equal(snapshot.xmlFailureCount, scenario === 'failure' ? 1 : 0);
            const selected = snapshot.xmlEnforcementRows.find(row => row.action.endsWith('-selected'));
            if (selected) { assert.equal(selected.stage, 'checkpoint'); assert.equal(selected.parser, 'fixture'); assert.equal(selected.checkpoint, 2); assert.equal(selected.location.id, 'loc'); assert.ok(selected.offsetMin >= 0); assert.ok(selected.firstAt); assert.ok(selected.promptId); }
            if (scenario === 'forced') { assert.equal(selected.action, 'forced-opening-selected'); assert.equal(selected.schema, 'root.schema.xml'); assert.equal(selected.targetTag, 'required'); assert.match(content, /target=required/); }
            if (scenario === 'sampled') assert.equal(selected.action, 'branch-selected');
            assert.match(content, /XML enforcement/);
            assert.doesNotMatch(content, /secret-body|secret-prompt/);
        }
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});

test('interleaved owners retain distinct XML attribution and finalize tracked background work', async () => {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const snapshots = new Map();
    const owners = await Promise.all(['one', 'two'].map(name => Audit.runTurn({ requestId: name, route: 'chat', logDirectory: fs.mkdtempSync(path.join(tmp, 'xml-audit-owner-')), getLocation: () => ({ id: name, name }) }, async () => {
        const owner = Audit.currentTurn();
        const job = Audit.runPrompt({ metadataLabel: `prompt-${name}` }, () => Audit.runStage({ stage: 'stage', parser: 'parser', checkpoint: 3 }, async () => {
            const observer = Audit.beginXmlEnforcement({ metadataLabel: `prompt-${name}`, schema: `${name}.schema.xml` });
            await gate;
            observer.generationStarted({ attempt: 2 });
            observer.record({ action: 'branch-selected', reason: 'mismatch', offset: name === 'one' ? 7 : 9, path: '/root' });
            snapshots.set(name, Audit.snapshot(owner));
        }));
        Audit.trackWork(job);
        return { owner, job };
    })));
    assert.ok(owners.every(({ owner }) => !owner.finalized));
    release(); await Promise.all(owners.map(({ job }) => job));
    for (const { owner } of owners) {
        const file = await Audit.waitForFinalization(owner); const text = await fs.promises.readFile(file, 'utf8');
        const name = owner.requestId, other = name === 'one' ? 'two' : 'one', snapshot = snapshots.get(name);
        assert.equal(snapshot.xmlGenerationCount, 1); assert.equal(snapshot.xmlSelectionCount, 1); assert.equal(snapshot.errorCount, 0);
        const row = snapshot.xmlEnforcementRows.find(entry => entry.action === 'branch-selected');
        assert.equal(row.metadataLabel, `prompt-${name}`); assert.equal(row.schema, `${name}.schema.xml`); assert.equal(row.location.id, name); assert.deepEqual(row.attempts, [2]);
        assert.match(text, new RegExp(`prompt-${name}`)); assert.doesNotMatch(text, new RegExp(`prompt-${other}`));
        assert.equal(owner.xmlEnforcementRows.size, 0);
    }
});

test('an idle turn writes zero XML activity', async () => {
    let snapshot;
    const owner = await Audit.runTurn({ requestId: 'idle', route: 'chat', logDirectory: fs.mkdtempSync(path.join(tmp, 'xml-audit-idle-')) }, async () => { const turn = Audit.currentTurn(); snapshot = Audit.snapshot(turn); return turn; });
    const file = await Audit.waitForFinalization(owner); const text = await fs.promises.readFile(file, 'utf8');
    assert.equal(snapshot.xmlGenerationCount, 0); assert.equal(snapshot.xmlSelectionCount, 0); assert.equal(snapshot.xmlFailureCount, 0);
    assert.match(text, /Guarded transport dispatches: 0/);
});

test('detached shared work fans XML observations to each reserved owner and late records append', async () => {
    async function makeOwner(name) {
        let handle;
        const owner = await Audit.runTurn({ requestId: name, route: 'image', logDirectory: fs.mkdtempSync(path.join(tmp, 'xml-audit-shared-')) }, async () => {
            const owner = Audit.currentTurn();
            await Audit.runPrompt({ metadataLabel: `prompt-${name}` }, async () => { handle = Audit.reserveWork(); });
            return owner;
        });
        return { owner, handle };
    }
    const owners = await Promise.all(['a', 'b'].map(makeOwner));
    let observer;
    await Audit.withoutTurn(async () => {
        observer = Audit.beginXmlEnforcement({ metadataLabel: 'shared', schema: 'root.schema.xml' });
        observer.generationStarted({ attempt: 1 });
        observer.record({ action: 'terminal-rejected', reason: 'premature-eos', offset: 5 });
    }, { failureContexts: owners.map(entry => entry.handle) });
    for (const { owner } of owners) {
        const snapshot = Audit.snapshot(owner);
        assert.equal(snapshot.xmlGenerationCount, 1); assert.equal(snapshot.xmlFailureCount, 1); assert.equal(snapshot.errorCount, 0);
        assert.equal(snapshot.xmlEnforcementRows.find(row => row.action === 'terminal-rejected').metadataLabel, 'shared');
    }
    for (const { handle } of owners) handle.release();
    const files = await Promise.all(owners.map(({ owner }) => Audit.waitForFinalization(owner)));
    const priorWarn = console.warn; console.warn = () => {};
    try { observer.record({ action: 'guard-failed', reason: 'continuation-limit', offset: 6 }); }
    finally { console.warn = priorWarn; }
    for (const file of files) {
        let text = '';
        for (let attempt = 0; attempt < 40; attempt++) {
            text = await fs.promises.readFile(file, 'utf8');
            if (text.includes('LATE XML ENFORCEMENT')) break;
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        assert.match(text, /LATE XML ENFORCEMENT.*guard-failed/);
    }
});

test('streaming scoped EOS correction is attributed, while explicit plain output records no guard activity', async () => {
    const { Readable } = require('node:stream');
    const old = { post: axios.post, config: Globals.config, base: Globals.baseDir };
    Globals.baseDir = fs.mkdtempSync(path.join(tmp, 'xml-audit-stream-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://fixture.invalid/v1/chat/completions', apiKey: 'test', model: 'mock', stream: true, retryAttempts: 1, max_concurrent_requests: 1, suppress_seed: true, stream_start_timeout: 5, stream_continue_timeout: 5, xml_closing_tag_guard: true, live_deslop: false } };
    try {
        for (const enabled of [true, false]) {
            let call = 0, snapshot;
            axios.post = async () => {
                call++;
                const text = enabled ? (call === 1 ? '<root>' : 'value</required></root>') : 'ordinary prose';
                const events = [{ choices: [{ delta: { content: text }, finish_reason: null, logprobs: { content: [token(text, 1)] } }] }, { choices: [{ delta: {}, finish_reason: 'stop', logprobs: { content: [], terminal: eos } }], usage: { completion_tokens: 2 } }];
                return { status: 200, statusText: 'OK', data: Readable.from(events.map(event => `data: ${JSON.stringify(event)}\n\n`).concat('data: [DONE]\n\n')) };
            };
            const owner = await Audit.runTurn({ requestId: `stream-${enabled}`, route: 'chat', logDirectory: Globals.baseDir }, async () => {
                const owner = Audit.currentTurn();
                await Audit.runPrompt({ metadataLabel: 'stream-audit' }, async () => Audit.runStage({ stage: 'tinybrain', parser: 'schema', checkpoint: 4 }, async () => {
                    const invoke = () => LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'request' }], metadataLabel: 'stream-audit', xmlOutput: enabled ? true : false, validateXML: false, maxTokens: 100, retryAttempts: 1, throwOnError: true, output: 'silent' });
                    const result = enabled ? await LLMClient.withXmlOutputScope({ xmlOutput: true, xmlSchema: 'root.schema.xml', xmlSchemaDirectory: schemas }, invoke) : await invoke();
                    assert.equal(result, enabled ? '<root><required>value</required></root>' : 'ordinary prose');
                    snapshot = Audit.snapshot(owner);
                }));
                return owner;
            });
            await Audit.waitForFinalization(owner);
            assert.equal(snapshot.xmlGenerationCount, enabled ? 2 : 0);
            assert.equal(snapshot.xmlSelectionCount, enabled ? 1 : 0);
            if (enabled) {
                const row = snapshot.xmlEnforcementRows.find(entry => entry.action === 'forced-opening-selected');
                assert.equal(row.reason, 'premature-eos'); assert.equal(row.stage, 'tinybrain'); assert.equal(row.checkpoint, 4); assert.equal(row.schema, 'root.schema.xml'); assert.equal(row.targetTag, 'required');
            }
        }
    } finally { axios.post = old.post; Globals.config = old.config; Globals.baseDir = old.base; LLMClient.resetLiveTokenStreamCapabilitiesForTests(); }
});
