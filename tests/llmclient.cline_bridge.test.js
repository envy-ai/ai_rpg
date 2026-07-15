const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('js-yaml');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const CodexBridgeClient = require('../CodexBridgeClient.js');
const ClineBridgeClient = require('../ClineBridgeClient.js');

const FAKE_CLINE_PATH = path.join(__dirname, 'fixtures', 'fake_cline_cli.js');

function withFakeClineEnv(overrides, callback) {
    const previousValues = new Map();
    Object.entries(overrides).forEach(([key, value]) => {
        previousValues.set(key, process.env[key]);
        if (value === null || value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = String(value);
        }
    });

    const restore = () => {
        previousValues.forEach((value, key) => {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        });
    };

    return Promise.resolve()
        .then(callback)
        .finally(restore);
}

function buildClineAiConfig(overrides = {}) {
    return {
        backend: 'cline_cli_bridge',
        model: 'test-cline-model',
        retryAttempts: 0,
        stream: true,
        max_concurrent_requests: 4,
        cline_bridge: {
            command: 'cline',
            provider: '',
            cwd: '',
            thinking: '',
            compaction: 'basic',
            timeout_seconds: 0,
            config: '',
            data_dir: '',
            prompt_preamble: ''
        },
        ...overrides
    };
}

test('LLMClient.chatCompletion uses Cline bridge backend without axios', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalBridgeChatCompletion = ClineBridgeClient.chatCompletion;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;

    let capturedRequest = null;
    let onResponsePayload = null;
    let bridgeArgs = null;

    axios.post = async () => {
        throw new Error('axios.post should not be called for cline_cli_bridge backend.');
    };
    ClineBridgeClient.chatCompletion = async (args) => {
        bridgeArgs = args;
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: { backend: 'cline_cli_bridge' },
            data: {
                id: 'cline-bridge-response-1',
                object: 'chat.completion',
                created: 1,
                model: 'test-cline-model',
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '<final>Cline bridge response</final>'
                        }
                    }
                ]
            }
        };
    };
    Globals.baseDir = process.cwd();
    Globals.config = {
        ai: buildClineAiConfig()
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Run Cline bridge test.' }],
            metadataLabel: 'cline_bridge_test',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent',
            captureRequestPayload: (payload) => {
                capturedRequest = payload;
            },
            onResponse: (response) => {
                onResponsePayload = response;
            }
        });

        assert.equal(result, '<final>Cline bridge response</final>');
        assert.equal(capturedRequest?.stream, false);
        assert.equal(bridgeArgs?.model, 'test-cline-model');
        assert.equal(bridgeArgs?.metadataLabel, 'cline_bridge_test');
        assert.equal(onResponsePayload?.data?.choices?.[0]?.message?.content, '<final>Cline bridge response</final>');
    } finally {
        axios.post = originalAxiosPost;
        ClineBridgeClient.chatCompletion = originalBridgeChatCompletion;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
});

test('Cline bridge backend aliases normalize to cline_cli_bridge', { concurrency: false }, () => {
    assert.equal(CodexBridgeClient.normalizeBackend('cline'), 'cline_cli_bridge');
    assert.equal(CodexBridgeClient.normalizeBackend('cline_cli'), 'cline_cli_bridge');
    assert.equal(CodexBridgeClient.normalizeBackend('cline-bridge'), 'cline_cli_bridge');
    assert.equal(CodexBridgeClient.normalizeBackend('cline_cli_bridge'), 'cline_cli_bridge');
});

test('Cline bridge configuration rejects invalid options', { concurrency: false }, () => {
    const invalidThinking = ClineBridgeClient.getConfigurationErrors(buildClineAiConfig({
        cline_bridge: {
            command: 'cline',
            provider: '',
            cwd: '',
            thinking: 'very-hard',
            compaction: 'basic',
            timeout_seconds: 0,
            config: '',
            data_dir: '',
            prompt_preamble: ''
        }
    }));
    assert.match(invalidThinking.join('\n'), /thinking must be one of/i);

    const invalidTimeout = ClineBridgeClient.getConfigurationErrors(buildClineAiConfig({
        cline_bridge: {
            command: 'cline',
            provider: '',
            cwd: '',
            thinking: '',
            compaction: 'basic',
            timeout_seconds: -1,
            config: '',
            data_dir: '',
            prompt_preamble: ''
        }
    }));
    assert.match(invalidTimeout.join('\n'), /timeout_seconds must be a non-negative number/i);

    const prefillErrors = ClineBridgeClient.getConfigurationErrors(buildClineAiConfig({
        prefill: '<final>'
    }));
    assert.match(prefillErrors.join('\n'), /prefill is not supported with cline_cli_bridge/i);
});

test('ClineBridgeClient runs Cline command with expected arguments and parses content', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CLINE_PATH, 0o755);
    const logPath = path.join(process.cwd(), 'tmp', `fake-cline-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const aiConfig = buildClineAiConfig({
        cline_bridge: {
            command: FAKE_CLINE_PATH,
            provider: 'openai-codex',
            cwd: './tmp',
            thinking: 'low',
            compaction: 'off',
            timeout_seconds: 12,
            config: './tmp/cline-config-test',
            data_dir: './tmp/cline-data-test',
            prompt_preamble: 'Cline bridge preamble.'
        }
    });

    const response = await withFakeClineEnv({
        FAKE_CLINE_LOG_PATH: logPath,
        FAKE_CLINE_RESPONSE: '{"content":"<final>cline command ok</final>"}'
    }, () => ClineBridgeClient.chatCompletion({
        messages: [
            { role: 'system', content: 'Cline system instructions.' },
            { role: 'user', content: 'Say hello from Cline.' }
        ],
        model: 'test-cline-model',
        metadataLabel: 'cline_bridge_command_args',
        aiConfig,
        timeoutMs: 10000
    }));

    assert.equal(response?.data?.choices?.[0]?.message?.content, '<final>cline command ok</final>');

    const logPayload = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    assert.equal(logPayload.cwd, path.join(process.cwd(), 'tmp'));
    assert.ok(logPayload.args.includes('--json'));
    assert.deepEqual(logPayload.args.slice(logPayload.args.indexOf('--auto-approve'), logPayload.args.indexOf('--auto-approve') + 2), ['--auto-approve', 'false']);
    assert.deepEqual(logPayload.args.slice(logPayload.args.indexOf('--provider'), logPayload.args.indexOf('--provider') + 2), ['--provider', 'openai-codex']);
    assert.deepEqual(logPayload.args.slice(logPayload.args.indexOf('--model'), logPayload.args.indexOf('--model') + 2), ['--model', 'test-cline-model']);
    assert.deepEqual(logPayload.args.slice(logPayload.args.indexOf('--thinking'), logPayload.args.indexOf('--thinking') + 2), ['--thinking', 'low']);
    assert.deepEqual(logPayload.args.slice(logPayload.args.indexOf('--compaction'), logPayload.args.indexOf('--compaction') + 2), ['--compaction', 'off']);
    assert.deepEqual(logPayload.args.slice(logPayload.args.indexOf('--timeout'), logPayload.args.indexOf('--timeout') + 2), ['--timeout', '12']);
    assert.ok(logPayload.args.includes('--system'));
    assert.match(logPayload.args[logPayload.args.indexOf('--system') + 1], /stdin/);
    assert.match(logPayload.args.at(-1), /piped stdin/);
    assert.match(logPayload.stdin, /Conversation:/);
    assert.match(logPayload.stdin, /Say hello from Cline\./);
    assert.match(logPayload.stdin, /Bridge Instructions:/);
    assert.match(logPayload.stdin, /Return exactly one JSON object/);
});

test('ClineBridgeClient accepts non-JSON Cline assistant text as content', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CLINE_PATH, 0o755);
    const plainAssistantText = [
        '1a. **Ekaterina** - She just asked about depth under the footing line.',
        '',
        '<turnResult>',
        '  <content>Plain Cline output should be treated as assistant content.</content>',
        '</turnResult>'
    ].join('\n');

    const response = await withFakeClineEnv({
        FAKE_CLINE_RESPONSE: plainAssistantText
    }, () => ClineBridgeClient.chatCompletion({
        messages: [{ role: 'user', content: 'Return the next game turn.' }],
        model: 'test-cline-model',
        metadataLabel: 'cline_bridge_plain_text',
        aiConfig: buildClineAiConfig({
            cline_bridge: {
                command: FAKE_CLINE_PATH,
                provider: '',
                cwd: '',
                thinking: '',
                compaction: 'basic',
                timeout_seconds: 0,
                config: '',
                data_dir: '',
                prompt_preamble: ''
            }
        }),
        timeoutMs: 10000
    }));

    assert.equal(response?.data?.choices?.[0]?.finish_reason, 'stop');
    assert.equal(response?.data?.choices?.[0]?.message?.content, plainAssistantText);
});

test('ClineBridgeClient extracts bridge JSON after leading Cline prose', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CLINE_PATH, 0o755);
    const expectedContent = '<memoriesToRecall><npc><name>Tiefu</name></npc></memoriesToRecall>';
    const clineOutput = [
        'Looking at the text, I need to rank the relevant memories.',
        '',
        JSON.stringify({ content: expectedContent })
    ].join('\n');

    const response = await withFakeClineEnv({
        FAKE_CLINE_RESPONSE: clineOutput
    }, () => ClineBridgeClient.chatCompletion({
        messages: [{ role: 'user', content: 'Choose important memories.' }],
        model: 'test-cline-model',
        metadataLabel: 'cline_bridge_leading_prose',
        aiConfig: buildClineAiConfig({
            cline_bridge: {
                command: FAKE_CLINE_PATH,
                provider: '',
                cwd: '',
                thinking: '',
                compaction: 'basic',
                timeout_seconds: 0,
                config: '',
                data_dir: '',
                prompt_preamble: ''
            }
        }),
        timeoutMs: 10000
    }));

    assert.equal(response?.data?.choices?.[0]?.finish_reason, 'stop');
    assert.equal(response?.data?.choices?.[0]?.message?.content, expectedContent);
});

test('ClineBridgeClient rejects malformed JSON-looking bridge responses', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CLINE_PATH, 0o755);
    await assert.rejects(
        withFakeClineEnv({
            FAKE_CLINE_RESPONSE: '{"content":"unterminated"'
        }, () => ClineBridgeClient.chatCompletion({
            messages: [{ role: 'user', content: 'Return malformed bridge JSON.' }],
            model: 'test-cline-model',
            metadataLabel: 'cline_bridge_malformed_json',
            aiConfig: buildClineAiConfig({
                cline_bridge: {
                    command: FAKE_CLINE_PATH,
                    provider: '',
                    cwd: '',
                    thinking: '',
                    compaction: 'basic',
                    timeout_seconds: 0,
                    config: '',
                    data_dir: '',
                    prompt_preamble: ''
                }
            }),
            timeoutMs: 10000
        })),
        /Cline bridge response is not valid JSON/
    );
});

test('ClineBridgeClient sends bridge prompt through stdin instead of argv', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CLINE_PATH, 0o755);
    const logPath = path.join(process.cwd(), 'tmp', `fake-cline-stdin-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const uniqueMarker = `stdin-marker-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const response = await withFakeClineEnv({
        FAKE_CLINE_LOG_PATH: logPath,
        FAKE_CLINE_RESPONSE: '{"content":"stdin prompt ok"}'
    }, () => ClineBridgeClient.chatCompletion({
        messages: [
            { role: 'system', content: 'Keep transport instructions out of argv.' },
            { role: 'user', content: `Use this large prompt marker: ${uniqueMarker}\n${'payload '.repeat(1200)}` }
        ],
        model: 'test-cline-model',
        metadataLabel: 'cline_bridge_stdin_prompt',
        aiConfig: buildClineAiConfig({
            cline_bridge: {
                command: FAKE_CLINE_PATH,
                provider: '',
                cwd: './tmp',
                thinking: '',
                compaction: 'basic',
                timeout_seconds: 0,
                config: '',
                data_dir: '',
                prompt_preamble: ''
            }
        }),
        timeoutMs: 10000
    }));

    assert.equal(response?.data?.choices?.[0]?.message?.content, 'stdin prompt ok');

    const logPayload = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    assert.match(logPayload.stdin, /Bridge Instructions:/);
    assert.match(logPayload.stdin, /Conversation:/);
    assert.match(logPayload.stdin, new RegExp(uniqueMarker));
    assert.ok(logPayload.args.every(arg => !arg.includes(uniqueMarker)));
    assert.ok(logPayload.args.every(arg => !arg.includes('Bridge Instructions:')));
    assert.ok(logPayload.args.every(arg => !arg.includes('Conversation:')));
});

test('ClineBridgeClient normalizes tool call responses', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CLINE_PATH, 0o755);
    const response = await withFakeClineEnv({
        FAKE_CLINE_RESPONSE: JSON.stringify({
            content: '',
            tool_calls: [
                {
                    name: 'moreInfo',
                    arguments: JSON.stringify({ name: 'Signal Tower' })
                }
            ]
        })
    }, () => ClineBridgeClient.chatCompletion({
        messages: [{ role: 'user', content: 'Use a tool.' }],
        model: 'test-cline-model',
        metadataLabel: 'cline_bridge_tool_call',
        additionalPayload: {
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'moreInfo',
                        description: 'Fetch more information.',
                        parameters: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' }
                            },
                            required: ['name']
                        }
                    }
                }
            ]
        },
        aiConfig: buildClineAiConfig({
            cline_bridge: {
                command: FAKE_CLINE_PATH,
                provider: '',
                cwd: '',
                thinking: '',
                compaction: 'basic',
                timeout_seconds: 0,
                config: '',
                data_dir: '',
                prompt_preamble: ''
            }
        }),
        timeoutMs: 10000
    }));

    const toolCall = response?.data?.choices?.[0]?.message?.tool_calls?.[0];
    assert.equal(response?.data?.choices?.[0]?.finish_reason, 'tool_calls');
    assert.equal(toolCall?.function?.name, 'moreInfo');
    assert.deepEqual(JSON.parse(toolCall?.function?.arguments || '{}'), { name: 'Signal Tower' });
});

test('LLMClient.chatCompletion streams Cline preview text through prompt_progress', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CLINE_PATH, 0o755);
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalRealtimeHub = Globals.realtimeHub;
    const emittedEvents = [];

    Globals.baseDir = process.cwd();
    Globals.config = {
        ai: buildClineAiConfig({
            cline_bridge: {
                command: FAKE_CLINE_PATH,
                provider: '',
                cwd: '',
                thinking: '',
                compaction: 'basic',
                timeout_seconds: 0,
                config: '',
                data_dir: '',
                prompt_preamble: ''
            }
        }),
        prompt_progress: {
            character_targets: {
                cline_progress_popup_test: 100
            }
        }
    };
    Globals.realtimeHub = {
        emit(_room, type, payload) {
            emittedEvents.push({ type, payload });
        }
    };

    try {
        const result = await withFakeClineEnv({
            FAKE_CLINE_STDOUT_EVENTS: JSON.stringify([
                { type: 'agent_event', event: { text: '{"content":"<final>cline ' } },
                { type: 'agent_event', event: { text: '{"content":"<final>cline progress ok</final>"}' } }
            ])
        }, () => LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Show Cline prompt progress.' }],
            metadataLabel: 'cline_progress_popup_test',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'stdout'
        }));

        assert.equal(result, '<final>cline progress ok</final>');
        await LLMClient.waitForPromptDrain({ timeoutMs: 3000, pollIntervalMs: 25 });

        const activeProgressEvents = emittedEvents
            .filter(event => event.type === 'prompt_progress')
            .filter(event => Array.isArray(event.payload?.entries) && event.payload.entries.length > 0);
        const textPreviewEntry = activeProgressEvents
            .map(event => event.payload.entries[0])
            .find(entry => typeof entry?.previewText === 'string' && entry.previewText.includes('<final>cline progress ok</final>'));
        assert.ok(textPreviewEntry);
        assert.equal(textPreviewEntry.receivedUnit, 'characters');
        assert.equal(textPreviewEntry.model, 'test-cline-model');
        assert.ok(emittedEvents.some(event => event.type === 'prompt_progress_cleared'));
    } finally {
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        Globals.realtimeHub = originalRealtimeHub;
    }
});

test('LLMClient.chatCompletion streams non-JSON Cline preview text through prompt_progress', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CLINE_PATH, 0o755);
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalRealtimeHub = Globals.realtimeHub;
    const emittedEvents = [];

    Globals.baseDir = process.cwd();
    Globals.config = {
        ai: buildClineAiConfig({
            cline_bridge: {
                command: FAKE_CLINE_PATH,
                provider: '',
                cwd: '',
                thinking: '',
                compaction: 'basic',
                timeout_seconds: 0,
                config: '',
                data_dir: '',
                prompt_preamble: ''
            }
        }),
        prompt_progress: {
            character_targets: {
                cline_plain_progress_popup_test: 100
            }
        }
    };
    Globals.realtimeHub = {
        emit(_room, type, payload) {
            emittedEvents.push({ type, payload });
        }
    };

    try {
        const result = await withFakeClineEnv({
            FAKE_CLINE_STDOUT_EVENTS: JSON.stringify([
                { type: 'agent_event', event: { text: 'Plain ' } },
                { type: 'agent_event', event: { text: 'Plain Cline streaming output.' } }
            ])
        }, () => LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Show plain Cline prompt progress.' }],
            metadataLabel: 'cline_plain_progress_popup_test',
            requiredRegex: /Plain Cline streaming output\./,
            validateXML: false,
            output: 'stdout'
        }));

        assert.equal(result, 'Plain Cline streaming output.');
        await LLMClient.waitForPromptDrain({ timeoutMs: 3000, pollIntervalMs: 25 });

        const activeProgressEvents = emittedEvents
            .filter(event => event.type === 'prompt_progress')
            .filter(event => Array.isArray(event.payload?.entries) && event.payload.entries.length > 0);
        const textPreviewEntry = activeProgressEvents
            .map(event => event.payload.entries[0])
            .find(entry => typeof entry?.previewText === 'string' && entry.previewText.includes('Plain Cline streaming output.'));
        assert.ok(textPreviewEntry);
        assert.equal(textPreviewEntry.receivedUnit, 'characters');
        assert.equal(textPreviewEntry.model, 'test-cline-model');
        assert.ok(emittedEvents.some(event => event.type === 'prompt_progress_cleared'));
    } finally {
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        Globals.realtimeHub = originalRealtimeHub;
    }
});

test('ClineBridgeClient.runClineCommand honors abort signals', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CLINE_PATH, 0o755);
    const controller = new AbortController();
    const abortPromise = withFakeClineEnv({
        FAKE_CLINE_DELAY_MS: '3000'
    }, () => ClineBridgeClient.runClineCommand({
        aiConfig: buildClineAiConfig({
            cline_bridge: {
                command: FAKE_CLINE_PATH,
                provider: '',
                cwd: '',
                thinking: '',
                compaction: 'basic',
                timeout_seconds: 0,
                config: '',
                data_dir: '',
                prompt_preamble: ''
            }
        }),
        timeoutMs: 10000,
        signal: controller.signal,
        promptText: 'Abort this fake Cline run.',
        developerInstructions: 'Return JSON only.',
        model: 'test-cline-model'
    }));

    setTimeout(() => {
        controller.abort(new Error('Abort requested from cline bridge test.'));
    }, 100);

    await assert.rejects(
        abortPromise,
        /Abort requested from cline bridge test\./
    );
});

test('default config and settings UI expose Cline bridge configuration', { concurrency: false }, () => {
    const configPath = path.resolve(__dirname, '..', 'config.default.yaml');
    const config = load(fs.readFileSync(configPath, 'utf8'));

    assert.equal(config.ai.cline_bridge.command, 'cline');
    assert.equal(config.ai.cline_bridge.cwd, './tmp/cline-bridge-cwd');
    assert.equal(config.ai.cline_bridge.compaction, 'basic');
    assert.equal(config.ai.cline_bridge.timeout_seconds, 0);

    const configTemplate = fs.readFileSync(path.resolve(__dirname, '..', 'views', 'config.njk'), 'utf8');
    assert.match(configTemplate, /<option value="cline_cli_bridge"/);
    assert.match(configTemplate, /name="ai\.cline_bridge\.command::string"/);
    assert.match(configTemplate, /name="ai\.cline_bridge\.prompt_preamble::string"/);

    const configJs = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'js', 'config.js'), 'utf8');
    assert.match(configJs, /clineBridge:/);
    assert.match(configJs, /ai-cline-command/);
});
