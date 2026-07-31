const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('js-yaml');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const CodexBridgeClient = require('../CodexBridgeClient.js');
const KimiBridgeClient = require('../KimiBridgeClient.js');

const FAKE_KIMI_PATH = path.join(__dirname, 'fixtures', 'fake_kimi_cli.py');

function withFakeKimiEnv(overrides, callback) {
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

function buildKimiAiConfig(overrides = {}) {
    return {
        backend: 'kimi_cli_bridge',
        model: 'game-model-label',
        retryAttempts: 0,
        stream: true,
        max_concurrent_requests: 3,
        baseTimeoutSeconds: 10,
        kimi_bridge: {
            command: 'kimi',
            cwd: './tmp/kimi-bridge-cwd',
            model: '',
            thinking: '',
            prompt_preamble: ''
        },
        ...overrides
    };
}

test('LLMClient.chatCompletion uses Kimi bridge backend without axios or API key', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalBridgeChatCompletion = KimiBridgeClient.chatCompletion;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;

    let capturedRequest = null;
    let bridgeArgs = null;
    axios.post = async () => {
        throw new Error('axios.post should not be called for kimi_cli_bridge backend.');
    };
    KimiBridgeClient.chatCompletion = async (args) => {
        bridgeArgs = args;
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: { backend: 'kimi_cli_bridge' },
            data: {
                id: 'kimi-bridge-response-1',
                object: 'chat.completion',
                created: 1,
                model: 'kimi-default',
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '<final>Kimi bridge response</final>'
                        }
                    }
                ]
            }
        };
    };
    Globals.baseDir = process.cwd();
    Globals.config = {
        ai: buildKimiAiConfig({
            model: ''
        })
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Run Kimi bridge test.' }],
            metadataLabel: 'kimi_bridge_test',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent',
            captureRequestPayload: (payload) => {
                capturedRequest = payload;
            }
        });

        assert.equal(result, '<final>Kimi bridge response</final>');
        assert.equal(capturedRequest?.stream, false);
        assert.equal(capturedRequest?.model, 'kimi-default');
        assert.equal(bridgeArgs?.model, 'kimi-default');
        assert.equal(bridgeArgs?.metadataLabel, 'kimi_bridge_test');
    } finally {
        axios.post = originalAxiosPost;
        KimiBridgeClient.chatCompletion = originalBridgeChatCompletion;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
});

test('Kimi bridge aliases normalize to kimi_cli_bridge', { concurrency: false }, () => {
    assert.equal(CodexBridgeClient.normalizeBackend('kimi'), 'kimi_cli_bridge');
    assert.equal(CodexBridgeClient.normalizeBackend('kimi_cli'), 'kimi_cli_bridge');
    assert.equal(CodexBridgeClient.normalizeBackend('kimi-bridge'), 'kimi_cli_bridge');
    assert.equal(CodexBridgeClient.normalizeBackend('kimi_cli_bridge'), 'kimi_cli_bridge');
});

test('Kimi bridge configuration is API-key independent and rejects invalid options', { concurrency: false }, () => {
    assert.deepEqual(KimiBridgeClient.getConfigurationErrors(buildKimiAiConfig({
        model: '',
        apiKey: ''
    })), []);

    const emptyCommandErrors = KimiBridgeClient.getConfigurationErrors(buildKimiAiConfig({
        kimi_bridge: {
            command: ' ',
            cwd: './tmp/kimi-bridge-cwd',
            model: '',
            thinking: '',
            prompt_preamble: ''
        }
    }));
    assert.match(emptyCommandErrors.join('\n'), /command must be a non-empty string/i);

    const invalidModelErrors = KimiBridgeClient.getConfigurationErrors(buildKimiAiConfig({
        kimi_bridge: {
            command: 'kimi',
            cwd: './tmp/kimi-bridge-cwd',
            model: 123,
            thinking: '',
            prompt_preamble: ''
        }
    }));
    assert.match(invalidModelErrors.join('\n'), /model must be a string/i);

    const prefillErrors = KimiBridgeClient.getConfigurationErrors(buildKimiAiConfig({
        prefill: '<final>'
    }));
    assert.match(prefillErrors.join('\n'), /prefill is not supported with kimi_cli_bridge/i);
});

test('KimiBridgeClient uses ACP stdin with an isolated fresh session and the saved model by default', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_KIMI_PATH, 0o755);
    const logPath = path.join(process.cwd(), 'tmp', `fake-kimi-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const aiConfig = buildKimiAiConfig({
        kimi_bridge: {
            command: FAKE_KIMI_PATH,
            cwd: './tmp/kimi-bridge-test-cwd',
            model: '',
            thinking: '',
            prompt_preamble: 'Kimi bridge preamble.'
        }
    });

    const response = await withFakeKimiEnv({
        FAKE_KIMI_LOG_PATH: logPath,
        FAKE_KIMI_RESPONSE: '{"content":"<final>kimi command ok</final>"}'
    }, () => KimiBridgeClient.chatCompletion({
        messages: [
            { role: 'system', content: 'Kimi system instructions.' },
            { role: 'user', content: 'Say hello from Kimi.' }
        ],
        model: 'ignored-game-model',
        metadataLabel: 'kimi_bridge_command_args',
        aiConfig,
        timeoutMs: 10000
    }));

    assert.equal(response?.data?.choices?.[0]?.message?.content, '<final>kimi command ok</final>');
    assert.equal(response?.data?.model, 'ignored-game-model');

    const logPayload = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    assert.equal(logPayload.cwd, path.join(process.cwd(), 'tmp', 'kimi-bridge-test-cwd'));
    assert.deepEqual(logPayload.args, ['acp']);
    const initializeRequest = logPayload.stdinMessages.find(message => message.method === 'initialize');
    assert.equal(initializeRequest.params.protocolVersion, 1);
    assert.deepEqual(initializeRequest.params.clientCapabilities, {});
    const sessionRequest = logPayload.stdinMessages.find(message => message.method === 'session/new');
    assert.equal(sessionRequest.params.cwd, path.join(process.cwd(), 'tmp', 'kimi-bridge-test-cwd'));
    assert.deepEqual(sessionRequest.params.mcpServers, []);
    assert.equal(logPayload.stdinMessages.some(message => message.method === 'session/set_config_option'), false);

    const promptRequest = logPayload.stdinMessages.find(message => message.method === 'session/prompt');
    const prompt = promptRequest.params.prompt[0].text;
    assert.match(prompt, /Bridge Instructions:/);
    assert.match(prompt, /Kimi bridge preamble\./);
    assert.match(prompt, /Kimi system instructions\./);
    assert.match(prompt, /Say hello from Kimi\./);
    assert.match(prompt, /Return exactly one JSON object/);
});

test('KimiBridgeClient passes an explicitly configured Kimi model alias', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_KIMI_PATH, 0o755);
    const logPath = path.join(process.cwd(), 'tmp', `fake-kimi-model-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const aiConfig = buildKimiAiConfig({
        kimi_bridge: {
            command: FAKE_KIMI_PATH,
            cwd: './tmp/kimi-bridge-test-cwd',
            model: 'kimi-code/custom-model',
            thinking: '',
            prompt_preamble: ''
        }
    });

    const response = await withFakeKimiEnv({
        FAKE_KIMI_LOG_PATH: logPath,
        FAKE_KIMI_RESPONSE: '{"content":"model override ok"}'
    }, () => KimiBridgeClient.chatCompletion({
        messages: [{ role: 'user', content: 'Use the configured model.' }],
        model: 'game-model-label',
        metadataLabel: 'kimi_bridge_model',
        aiConfig,
        timeoutMs: 10000
    }));

    const logPayload = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    const modelRequest = logPayload.stdinMessages.find(
        message => message.method === 'session/set_config_option'
    );
    assert.deepEqual(modelRequest.params, {
        sessionId: 'fake-kimi-session',
        configId: 'model',
        value: 'kimi-code/custom-model'
    });
    assert.equal(response?.data?.model, 'kimi-code/custom-model');
});

test('KimiBridgeClient passes configured thinking through the subprocess environment without an ACP round trip', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_KIMI_PATH, 0o755);
    const logPath = path.join(process.cwd(), 'tmp', `fake-kimi-thinking-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const aiConfig = buildKimiAiConfig({
        kimi_bridge: {
            command: FAKE_KIMI_PATH,
            cwd: './tmp/kimi-bridge-test-cwd',
            model: '',
            thinking: 'low',
            prompt_preamble: ''
        }
    });

    await withFakeKimiEnv({
        FAKE_KIMI_LOG_PATH: logPath,
        FAKE_KIMI_RESPONSE: '{"content":"thinking override ok"}'
    }, () => KimiBridgeClient.chatCompletion({
        messages: [{ role: 'user', content: 'Use low thinking.' }],
        metadataLabel: 'kimi_bridge_thinking',
        aiConfig,
        timeoutMs: 10000
    }));

    const logPayload = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    assert.equal(logPayload.thinkingEffortEnv, 'low');
    assert.equal(logPayload.stdinMessages.some(
        message => message.method === 'session/set_config_option'
            && message.params?.configId === 'thinking'
    ), false);
});

test('KimiBridgeClient sends prompts larger than the argv limit through ACP stdin', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_KIMI_PATH, 0o755);
    const logPath = path.join(process.cwd(), 'tmp', `fake-kimi-large-stdin-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const marker = `large-stdin-marker-${Date.now()}`;
    const largeMessage = `${marker}-start${'x'.repeat(256 * 1024)}${marker}-end`;
    const aiConfig = buildKimiAiConfig({
        kimi_bridge: {
            command: FAKE_KIMI_PATH,
            cwd: './tmp/kimi-bridge-test-cwd',
            model: '',
            prompt_preamble: ''
        }
    });

    const response = await withFakeKimiEnv({
        FAKE_KIMI_LOG_PATH: logPath,
        FAKE_KIMI_RESPONSE: '{"content":"large stdin prompt ok"}'
    }, () => KimiBridgeClient.chatCompletion({
        messages: [{ role: 'user', content: largeMessage }],
        metadataLabel: 'kimi_bridge_large_stdin_prompt',
        aiConfig,
        timeoutMs: 10000
    }));

    assert.equal(response?.data?.choices?.[0]?.message?.content, 'large stdin prompt ok');
    const logPayload = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    assert.deepEqual(logPayload.args, ['acp']);
    assert.ok(logPayload.promptText.length > 256 * 1024);
    assert.match(logPayload.promptText, new RegExp(`${marker}-start`));
    assert.match(logPayload.promptText, new RegExp(`${marker}-end`));
});

test('KimiBridgeClient streams decoded content deltas from partial ACP wrapper JSON', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_KIMI_PATH, 0o755);
    const previewEvents = [];
    const aiConfig = buildKimiAiConfig({
        kimi_bridge: {
            command: FAKE_KIMI_PATH,
            cwd: './tmp/kimi-bridge-test-cwd',
            model: '',
            thinking: '',
            prompt_preamble: ''
        }
    });

    const response = await withFakeKimiEnv({
        FAKE_KIMI_RESPONSE_CHUNKS: JSON.stringify([
            '{"content":"<final>kimi ',
            'streams\\nwith ',
            'unicode \\u263A</final>"}'
        ])
    }, () => KimiBridgeClient.chatCompletion({
        messages: [{ role: 'user', content: 'Stream the Kimi bridge response.' }],
        metadataLabel: 'kimi_bridge_streaming',
        aiConfig,
        timeoutMs: 10000,
        onStdoutEvent: event => previewEvents.push(event)
    }));

    assert.equal(
        response?.data?.choices?.[0]?.message?.content,
        '<final>kimi streams\nwith unicode ☺</final>'
    );
    assert.deepEqual(
        previewEvents
            .filter(event => event?.type === 'agent_message_delta')
            .map(event => event.delta),
        ['<final>kimi ', 'streams\nwith ', 'unicode ☺</final>']
    );
    assert.equal(
        previewEvents.at(-1)?.item?.text,
        '<final>kimi streams\nwith unicode ☺</final>'
    );
});

test('LLMClient.chatCompletion streams Kimi content through prompt_progress', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_KIMI_PATH, 0o755);
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalRealtimeHub = Globals.realtimeHub;
    const emittedEvents = [];

    Globals.baseDir = process.cwd();
    Globals.config = {
        ai: buildKimiAiConfig({
            model: '',
            kimi_bridge: {
                command: FAKE_KIMI_PATH,
                cwd: './tmp/kimi-bridge-test-cwd',
                model: '',
                thinking: '',
                prompt_preamble: ''
            }
        }),
        prompt_progress: {
            character_targets: {
                kimi_progress_popup_test: 100
            }
        }
    };
    Globals.realtimeHub = {
        emit(_room, type, payload) {
            emittedEvents.push({ type, payload });
        }
    };

    try {
        const result = await withFakeKimiEnv({
            FAKE_KIMI_RESPONSE_CHUNKS: JSON.stringify([
                '{"content":"<final>kimi ',
                'progress ',
                'ok</final>"}'
            ])
        }, () => LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Show Kimi prompt progress.' }],
            metadataLabel: 'kimi_progress_popup_test',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'stdout'
        }));

        assert.equal(result, '<final>kimi progress ok</final>');
        await LLMClient.waitForPromptDrain({ timeoutMs: 3000, pollIntervalMs: 25 });

        const activeProgressEntries = emittedEvents
            .filter(event => event.type === 'prompt_progress')
            .filter(event => Array.isArray(event.payload?.entries) && event.payload.entries.length > 0)
            .map(event => event.payload.entries[0]);
        const finalPreviewEntry = activeProgressEntries.find(
            entry => entry?.previewText === '<final>kimi progress ok</final>'
        );
        assert.ok(finalPreviewEntry);
        assert.equal(finalPreviewEntry.receivedUnit, 'characters');
        assert.equal(
            finalPreviewEntry.receivedCount,
            Array.from('<final>kimi progress ok</final>').length
        );
        assert.equal(finalPreviewEntry.model, 'kimi-default');
        assert.ok(emittedEvents.some(event => event.type === 'prompt_progress_cleared'));
    } finally {
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        Globals.realtimeHub = originalRealtimeHub;
    }
});

test('KimiBridgeClient normalizes application tool-call responses', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_KIMI_PATH, 0o755);
    const response = await withFakeKimiEnv({
        FAKE_KIMI_RESPONSE: JSON.stringify({
            content: '',
            tool_calls: [
                {
                    name: 'lookupThing',
                    arguments: '{"id":"thing-42"}'
                }
            ]
        })
    }, () => KimiBridgeClient.chatCompletion({
        messages: [{ role: 'user', content: 'Look up thing 42.' }],
        model: 'kimi-default',
        metadataLabel: 'kimi_bridge_tool_call',
        additionalPayload: {
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'lookupThing',
                        description: 'Look up a thing.',
                        parameters: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' }
                            },
                            required: ['id']
                        }
                    }
                }
            ]
        },
        aiConfig: buildKimiAiConfig({
            kimi_bridge: {
                command: FAKE_KIMI_PATH,
                cwd: './tmp/kimi-bridge-test-cwd',
                model: '',
                prompt_preamble: ''
            }
        }),
        timeoutMs: 10000
    }));

    const toolCall = response?.data?.choices?.[0]?.message?.tool_calls?.[0];
    assert.equal(response?.data?.choices?.[0]?.finish_reason, 'tool_calls');
    assert.match(toolCall?.id, /^kimi_call_/);
    assert.equal(toolCall?.function?.name, 'lookupThing');
    assert.deepEqual(JSON.parse(toolCall?.function?.arguments), { id: 'thing-42' });
});

test('KimiBridgeClient rejects malformed bridge JSON and internal Kimi tool calls', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_KIMI_PATH, 0o755);
    const aiConfig = buildKimiAiConfig({
        kimi_bridge: {
            command: FAKE_KIMI_PATH,
            cwd: './tmp/kimi-bridge-test-cwd',
            model: '',
            prompt_preamble: ''
        }
    });

    await assert.rejects(
        withFakeKimiEnv({
            FAKE_KIMI_RESPONSE: '{"content":'
        }, () => KimiBridgeClient.chatCompletion({
            messages: [{ role: 'user', content: 'Return malformed JSON.' }],
            metadataLabel: 'kimi_bridge_malformed',
            aiConfig,
            timeoutMs: 10000
        })),
        /not valid JSON/i
    );

    await assert.rejects(
        withFakeKimiEnv({
            FAKE_KIMI_STDOUT_EVENTS: JSON.stringify([
                {
                    role: 'assistant',
                    content: 'I will read a file.',
                    tool_calls: [
                        {
                            type: 'function',
                            function: {
                                name: 'Read',
                                arguments: '{"path":"AGENTS.md"}'
                            }
                        }
                    ]
                }
            ])
        }, () => KimiBridgeClient.chatCompletion({
            messages: [{ role: 'user', content: 'Do not use tools.' }],
            metadataLabel: 'kimi_bridge_internal_tool',
            aiConfig,
            timeoutMs: 10000
        })),
        /attempted to invoke an internal Kimi tool/i
    );
});

test('KimiBridgeClient.runKimiCommand honors abort signals', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_KIMI_PATH, 0o755);
    const controller = new AbortController();
    const abortPromise = withFakeKimiEnv({
        FAKE_KIMI_DELAY_MS: 5000
    }, () => KimiBridgeClient.runKimiCommand({
        aiConfig: buildKimiAiConfig({
            kimi_bridge: {
                command: FAKE_KIMI_PATH,
                cwd: './tmp/kimi-bridge-test-cwd',
                model: '',
                prompt_preamble: ''
            }
        }),
        timeoutMs: 10000,
        signal: controller.signal,
        promptText: 'Abort this fake Kimi run.'
    }));

    setTimeout(() => {
        controller.abort(new Error('Abort requested from Kimi bridge test.'));
    }, 100);

    await assert.rejects(
        abortPromise,
        /Abort requested from Kimi bridge test\./
    );
});

test('default config and settings UI expose Kimi bridge configuration', { concurrency: false }, () => {
    const configPath = path.resolve(__dirname, '..', 'config.default.yaml');
    const config = load(fs.readFileSync(configPath, 'utf8'));

    assert.equal(config.ai.kimi_bridge.command, 'kimi');
    assert.equal(config.ai.kimi_bridge.cwd, './tmp/kimi-bridge-cwd');
    assert.equal(config.ai.kimi_bridge.model, '');
    assert.equal(config.ai.kimi_bridge.thinking, '');

    const configTemplate = fs.readFileSync(path.resolve(__dirname, '..', 'views', 'config.njk'), 'utf8');
    assert.match(configTemplate, /<option value="kimi_cli_bridge"/);
    assert.match(configTemplate, /name="ai\.kimi_bridge\.command::string"/);
    assert.match(configTemplate, /name="ai\.kimi_bridge\.model::string"/);
    assert.match(configTemplate, /name="ai\.kimi_bridge\.thinking::string"/);
    assert.match(configTemplate, /name="ai\.kimi_bridge\.prompt_preamble::string"/);

    const configJs = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'js', 'config.js'), 'utf8');
    assert.match(configJs, /kimiBridge:/);
    assert.match(configJs, /ai-kimi-command/);

    const apiSource = fs.readFileSync(path.resolve(__dirname, '..', 'api.js'), 'utf8');
    assert.match(apiSource, /backend === KimiBridgeClient\.backendName/);
    assert.match(apiSource, /kimi_bridge: kimiBridge/);
});
