const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const { LiveDeslopController } = require('../LiveDeslop.js');

const STRATA_ROOT = process.env.STRATA_TEST_CONTROL_ROOT
    || path.resolve(__dirname, '..', '..', 'strata-logprobs-control');
const STRATA_PYTHON = process.env.STRATA_TEST_PYTHON
    || path.join(path.dirname(STRATA_ROOT), '.local/share/strata/terminal/0.1.49.2/python/bin/python');
const SKIP_REASON = fs.existsSync(path.join(STRATA_ROOT, 'serve/server.py')) && fs.existsSync(STRATA_PYTHON)
    ? false
    : 'set STRATA_TEST_CONTROL_ROOT and STRATA_TEST_PYTHON to run the Strata integration fixture';

const SERVER_SCRIPT = String.raw`
import json
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
from serve.frontend import ChatTemplate
from serve.server import ByteTokenizer, MockEngine, Service, serve

class Tokenizer(ByteTokenizer):
    def token_bytes(self, token_id):
        return self.SPECIALS[token_id - 256].encode() if token_id >= 256 else bytes([token_id])

class SampledEngine(MockEngine):
    def __init__(self, tokenizer):
        super().__init__(tokenizer, 'unused', max_context=4096)
        self.outputs = [
            '<turnResult><prose>Delve into a still hall.</prose></turnResult>',
            'alk into a still hall.</prose></turnResult>'
        ]
        self.prompts = []

    def generate(self, ids, max_new, sampling, cancel, embeddings=None):
        self.last_prompt = list(ids)
        self.prompts.append(self.tok.decode(ids))
        output = self.outputs.pop(0)
        alternatives = [(ord('W'), -0.01)] + [(ord('a') + i, -0.1 - i * 0.01) for i in range(19)]
        for token_id in self.tok.encode(output, parse_special=True) + self.tok.encode('<|im_end|>', parse_special=True):
            if cancel.is_set():
                return
            yield {'id': token_id, 'logprob': -0.5, 'top': alternatives}

class RecordingService(Service):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.test_calls = []

    def run(self, ids, thinking, tools, max_new, sampling, cancel, force=None, declared_only=False):
        self.test_calls.append({'prompt': self.tok.decode(ids), 'tools': tools})
        yield from super().run(ids, thinking, tools, max_new, sampling, cancel, force, declared_only)
        print('STATE ' + json.dumps(self.test_calls), flush=True)

tok = Tokenizer()
engine = SampledEngine(tok)
service = RecordingService(engine, tok, ChatTemplate(Path('serve/chat_template.jinja')), model_name='strata-fixture')
httpd = serve(service, port=0)
print('READY ' + str(httpd.server_address[1]), flush=True)
threading.Event().wait()
`;

function waitForLine(lines, child, prefix, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const existing = lines.find(line => line.startsWith(prefix));
        if (existing) {
            resolve(existing);
            return;
        }
        const timeout = setTimeout(() => {
            clearInterval(poll);
            reject(new Error(`Timed out waiting for Strata fixture line ${prefix}.`));
        }, timeoutMs);
        const poll = setInterval(() => {
            const line = lines.find(item => item.startsWith(prefix));
            if (line) {
                clearTimeout(timeout);
                clearInterval(poll);
                resolve(line);
            }
        }, 10);
        child.once('exit', (code, signal) => {
            clearTimeout(timeout);
            clearInterval(poll);
            reject(new Error(`Strata fixture exited before ${prefix}: code=${code}, signal=${signal}.`));
        });
    });
}

function waitForState(lines, child) {
    return new Promise((resolve, reject) => {
        const find = () => lines
            .filter(line => line.startsWith('STATE '))
            .map(line => line.slice('STATE '.length))
            .find(json => {
                try { return JSON.parse(json).length === 2; } catch { return false; }
            });
        const existing = find();
        if (existing) {
            resolve(existing);
            return;
        }
        const timeout = setTimeout(() => {
            clearInterval(poll);
            reject(new Error('Timed out waiting for both Strata fixture requests.'));
        }, 5000);
        const poll = setInterval(() => {
            const state = find();
            if (state) {
                clearTimeout(timeout);
                clearInterval(poll);
                resolve(state);
            }
        }, 10);
        child.once('exit', (code, signal) => {
            clearTimeout(timeout);
            clearInterval(poll);
            reject(new Error(`Strata fixture exited before recording both requests: code=${code}, signal=${signal}.`));
        });
    });
}

test('Strata sampled logprobs drive a real LiveDeslop rewind with tool schema retained',
    { concurrency: false, timeout: 20000, skip: SKIP_REASON }, async () => {
        const originalConfig = Globals.config;
        const originalBaseDir = Globals.baseDir;
        const tempRoot = path.resolve(__dirname, '..', 'tmp');
        fs.mkdirSync(tempRoot, { recursive: true });
        Globals.baseDir = fs.mkdtempSync(path.join(tempRoot, 'strata-live-deslop-'));

        const child = spawn(STRATA_PYTHON, ['-u', '-c', SERVER_SCRIPT], {
            cwd: STRATA_ROOT,
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const lines = [];
        let outputBuffer = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            outputBuffer += chunk;
            const parts = outputBuffer.split('\n');
            outputBuffer = parts.pop();
            lines.push(...parts);
        });
        child.stderr.on('data', chunk => { stderr += chunk; });

        try {
            const ready = await waitForLine(lines, child, 'READY ');
            const port = Number(ready.slice('READY '.length));
            assert.ok(Number.isInteger(port) && port > 0);
            Globals.config = {
                ai: {
                    backend: 'openai_compatible',
                    endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
                    apiKey: 'fixture-key',
                    model: 'strata-fixture',
                    stream: true,
                    retryAttempts: 0,
                    maxTokens: 512,
                    max_concurrent_requests: 1,
                    suppress_seed: true,
                    stream_start_timeout: 5,
                    stream_continue_timeout: 5
                }
            };
            LLMClient.resetLiveTokenStreamCapabilitiesForTests();

            const detectSlop = async prose => {
                const match = /\bDelve\b/i.exec(prose);
                return match ? {
                    start: match.index,
                    end: match.index + match[0].length,
                    type: 'word',
                    label: match[0].toLowerCase(),
                    slopWords: [match[0].toLowerCase()],
                    slopRegexes: [],
                    slopNgrams: []
                } : null;
            };
            const controller = new LiveDeslopController({ detectSlop });
            const tool = {
                type: 'function',
                function: {
                    name: 'lookup',
                    description: 'Search a small fixture index.',
                    parameters: {
                        type: 'object',
                        properties: { query: { type: 'string' } },
                        required: ['query']
                    }
                }
            };
            const result = await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Continue the scene.' }],
                metadataLabel: 'strata_live_deslop_integration',
                validateXML: false,
                retryAttempts: 0,
                output: 'silent',
                stream: true,
                additionalPayload: {
                    chat_template_kwargs: { enable_thinking: false },
                    logprobs: true,
                    top_logprobs: 20,
                    tools: [tool],
                    tool_choice: 'auto'
                },
                onStreamToken: context => controller.inspect({
                    responseText: context.responseText,
                    tokenRecords: context.tokenRecords,
                    responseComplete: context.responseComplete,
                    preserveTools: true
                })
            });

            assert.equal(result, '<turnResult><prose>Walk into a still hall.</prose></turnResult>',
                `Strata stderr:\n${stderr}\nfixture stdout:\n${lines.join('\n')}`);
            const diagnostic = controller.getDiagnostics();
            assert.equal(diagnostic.ran, true);
            assert.equal(diagnostic.corrections.length, 1);
            assert.equal(diagnostic.corrections[0].rejectedToken, 'D');
            assert.equal(diagnostic.corrections[0].alternativeToken, 'W');

            const calls = JSON.parse(await waitForState(lines, child));
            assert.equal(calls.length, 2);
            assert.deepEqual(calls[0].tools, calls[1].tools);
            assert.equal(calls[0].tools[0].name, 'lookup');
            assert.ok(calls[1].prompt.endsWith('<turnResult><prose>W'));
        } catch (error) {
            if (stderr) error.message += `\nStrata fixture stderr:\n${stderr}`;
            throw error;
        } finally {
            if (!child.killed) {
                child.kill('SIGTERM');
            }
            await new Promise(resolve => {
                if (child.exitCode !== null) resolve();
                else child.once('exit', resolve);
            });
            LLMClient.resetLiveTokenStreamCapabilitiesForTests();
            LLMClient.resetPromptOutputCharacterStatsForTests();
            Globals.config = originalConfig;
            Globals.baseDir = originalBaseDir;
        }
    });
