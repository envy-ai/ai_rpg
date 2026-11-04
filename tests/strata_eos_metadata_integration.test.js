const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, 'tmp', 'xml-eos-guard-backend');
const installed = '/home/bart/.local/share/strata/terminal/0.1.49.2';
const python = path.join(installed, 'python/bin/python');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const script = String.raw`
import json,sys,threading
from pathlib import Path
sys.path.insert(0, sys.argv[1])
sys.path.insert(0, str(Path(sys.argv[1])/'tools'))
import serve
serve.__path__.insert(0, str(Path(sys.argv[2])/'serve'))
from serve.frontend import ChatTemplate, Event, ToolCall
from serve.server import ByteTokenizer, MockEngine, Service, serve, run_with_mcp
class FakeService:
    def __init__(self): self.round = 0
    def run(self, *args, **kwargs):
        self.round += 1
        if self.round == 1:
            yield 'event', Event('tool_call', call=ToolCall('lookup', {}))
            yield 'done', {'finish':'stop', 'completion_tokens':1, 'terminal_logprobs':{'reason':'eos_token', 'sample':{'id':99}}}
        else:
            yield 'done', {'finish':'length', 'completion_tokens':1, 'terminal_logprobs':{'reason':'token_limit'}}
    def prepare(self, *args, **kwargs): return [1], False, 10
class Hub:
    settings = {'max_rounds': 2}
    def __init__(self, cancelled): self.cancelled = cancelled
    def routes(self): return {}
    def call(self, name, arguments, cancel):
        if self.cancelled: cancel.set()
        return {'ok':True, 'text':'result', 'chars':6, 'truncated':False, 'ms':0}
for cancelled in (False, True):
    final = list(run_with_mcp(FakeService(), Hub(cancelled), [], [], {}, [1], False, 10, 10, {}, threading.Event(), {'lookup'}))[-1][1]
    assert final['terminal_logprobs']['reason'] == ('cancel' if cancelled else 'token_limit'), final
    assert 'sample' not in final['terminal_logprobs'], final
class Tok(ByteTokenizer):
    def token_bytes(self, token_id):
        return self.SPECIALS[token_id - 256].encode() if token_id >= 256 else bytes([token_id])
class Engine(MockEngine):
    def generate(self, ids, max_new, sampling, cancel, embeddings=None):
        output = '<tool_call><function=lookup><parameter=query>x</parameter></function></tool_call>' if 'Tool now' in self.tok.decode(ids) else 'Hello'
        eos = self.tok.encode('<|im_end|>', parse_special=True)[0]
        for token_id in (self.tok.encode(output, parse_special=True) + [eos])[:max_new]:
            if cancel.is_set(): return
            if token_id == eos and 'Cancel now' in self.tok.decode(ids): cancel.set()
            yield {'id': token_id, 'logprob': -0.3, 'top': [(token_id, -0.3), (ord('!'), -0.5)]} if (sampling or {}).get('logprobs') else token_id
tok=Tok(); svc=Service(Engine(tok,'unused',max_context=4096),tok,ChatTemplate(Path(sys.argv[1])/'serve/chat_template.jinja'),model_name='mock-eos')
httpd=serve(svc,port=0)
print('READY '+str(httpd.server_address[1]),flush=True)
threading.Event().wait()
`;
function waitReady(child) { return new Promise((resolve, reject) => { let text = '', err = ''; const timer = setTimeout(() => reject(new Error(`fixture timeout: ${err}`)), 15000); child.stdout.on('data', chunk => { text += chunk; const m = /READY (\d+)/.exec(text); if (m) { clearTimeout(timer); resolve(Number(m[1])); } }); child.stderr.on('data', chunk => { err += chunk; }); child.once('exit', code => { clearTimeout(timer); reject(new Error(`fixture exited ${code}: ${err}`)); }); }); }

test('staged Strata HTTP exposes EOS only in terminal metadata and retains trace baseline', { timeout: 25000, skip: process.env.STRATA_EOS_STAGED_PROBE !== '1' }, async () => {
    const receipt = JSON.parse(fs.readFileSync(path.join(stage, 'base-receipt.json'), 'utf8'));
    for (const item of Object.values(receipt)) assert.equal(hash(item.installed_base), item.base_sha256, 'installed baseline changed since staging');
    assert.equal(hash(path.join(stage, 'serve', 'termination_trace.py')), receipt['termination_trace.py'].base_sha256);
    const traceDir = fs.mkdtempSync(path.join(root, 'tmp', 'strata-eos-protocol-'));
    const trace = path.join(traceDir, 'trace.jsonl');
    const child = spawn(python, ['-u', '-c', script, installed, stage], { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', STRATA_TERMINATION_TRACE_PATH: trace }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
        const port = await waitReady(child);
        const request = async body => {
            const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'mock-eos', messages: [{ role: 'user', content: 'Say hello.' }], chat_template_kwargs: { enable_thinking: false }, max_tokens: 32, ...body }) });
            assert.equal(response.status, 200); return response;
        };
        const plain = await (await request({ stream: false, logprobs: true, top_logprobs: 2 })).json();
        assert.equal(plain.choices[0].message.content, 'Hello');
        assert.equal(plain.choices[0].finish_reason, 'stop');
        const terminal = plain.choices[0].logprobs.terminal;
        assert.equal(terminal.reason, 'eos_token');
        assert.ok(terminal.stop_token_ids.includes(terminal.sample.id));
        assert.ok(terminal.sample.top_logprobs.some(item => item.token === '!'));
        assert.ok(plain.choices[0].logprobs.content.every(item => item.id !== terminal.sample.id));
        assert.ok(plain.usage.completion_tokens > 0);
        const noLogprobs = await (await request({ stream: false })).json();
        assert.equal(noLogprobs.choices[0].message.content, 'Hello');
        assert.equal(noLogprobs.choices[0].logprobs, undefined);
        const response = await request({ stream: true, logprobs: true, top_logprobs: 2 });
        const chunks = (await response.text()).split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
        assert.equal(chunks.map(chunk => chunk.choices[0].delta.content || '').join(''), 'Hello');
        assert.equal(chunks.filter(chunk => chunk.choices[0].logprobs?.terminal).length, 1);
        const last = chunks.at(-1).choices[0];
        assert.equal(last.finish_reason, 'stop'); assert.deepEqual(last.delta, {}); assert.deepEqual(last.logprobs.content, []); assert.equal(last.logprobs.terminal.reason, 'eos_token');
        const limited = await (await request({ stream: false, logprobs: true, top_logprobs: 2, max_tokens: 1 })).json();
        assert.equal(limited.choices[0].finish_reason, 'length');
        assert.equal(limited.choices[0].logprobs.terminal.reason, 'token_limit');
        assert.equal(limited.choices[0].logprobs.terminal.sample, undefined);
        const cancelled = await (await request({ messages: [{ role: 'user', content: 'Cancel now' }], stream: false, logprobs: true, top_logprobs: 2 })).json();
        assert.equal(cancelled.choices[0].logprobs.terminal.reason, 'cancel');
        assert.equal(cancelled.choices[0].logprobs.terminal.sample, undefined);
        const tool = await (await request({ messages: [{ role: 'user', content: 'Tool now' }], stream: false, max_tokens: 128, logprobs: true, top_logprobs: 2, tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }] })).json();
        assert.equal(tool.choices[0].finish_reason, 'tool_calls');
        assert.equal(tool.choices[0].message.tool_calls[0].function.name, 'lookup');
        assert.equal(tool.choices[0].logprobs.terminal.reason, 'eos_token');
    } finally {
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
    }
    for (const item of Object.values(receipt)) assert.equal(hash(item.installed_base), item.base_sha256, 'installed source changed during test');
    const lines = fs.readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(lines.some(line => line.terminationReason === 'eos_token'));
    assert.ok(lines.some(line => line.terminationReason === 'token_limit'));
});
