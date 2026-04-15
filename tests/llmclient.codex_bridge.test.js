const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const CodexBridgeClient = require('../CodexBridgeClient.js');

const FAKE_CODEX_PATH = path.join(__dirname, 'fixtures', 'fake_codex_cli.js');

function withFakeCodexEnv(overrides, callback) {
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

function buildCodexAiConfig(overrides = {}) {
    return {
        backend: 'codex_cli_bridge',
        model: 'gpt-5.4-mini',
        retryAttempts: 0,
        stream: true,
        max_concurrent_requests: 6,
        codex_bridge: {
            command: 'codex',
            home: './tmp/test-codex-home',
            session_mode: 'fresh',
            session_id: '',
            sandbox: 'read-only',
            skip_git_repo_check: true,
            reasoning_effort: '',
            profile: '',
            prompt_preamble: ''
        },
        ...overrides
    };
}

test('LLMClient.chatCompletion uses Codex bridge backend without axios', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalBridgeChatCompletion = CodexBridgeClient.chatCompletion;
    const originalConfig = Globals.config;

    let capturedRequest = null;
    let onResponsePayload = null;
    let bridgeArgs = null;

    axios.post = async () => {
        throw new Error('axios.post should not be called for codex_cli_bridge backend.');
    };
    CodexBridgeClient.chatCompletion = async (args) => {
        bridgeArgs = args;
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: { backend: 'codex_cli_bridge' },
            data: {
                id: 'bridge-response-1',
                object: 'chat.completion',
                created: 1,
                model: 'gpt-5.4-mini',
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '<final>Bridge response</final>'
                        }
                    }
                ]
            }
        };
    };
    Globals.config = {
        ai: buildCodexAiConfig()
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Run bridge test.' }],
            metadataLabel: 'bridge_test',
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

        assert.equal(result, '<final>Bridge response</final>');
        assert.equal(capturedRequest?.stream, false);
        assert.equal(bridgeArgs?.model, 'gpt-5.4-mini');
        assert.equal(bridgeArgs?.metadataLabel, 'bridge_test');
        assert.equal(onResponsePayload?.data?.choices?.[0]?.message?.content, '<final>Bridge response</final>');
    } finally {
        axios.post = originalAxiosPost;
        CodexBridgeClient.chatCompletion = originalBridgeChatCompletion;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion accepts Codex bridge tool calls', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalBridgeChatCompletion = CodexBridgeClient.chatCompletion;
    const originalConfig = Globals.config;

    let onResponsePayload = null;

    axios.post = async () => {
        throw new Error('axios.post should not be called for codex_cli_bridge backend.');
    };
    CodexBridgeClient.chatCompletion = async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { backend: 'codex_cli_bridge' },
        data: {
            id: 'bridge-response-tool-call',
            object: 'chat.completion',
            created: 1,
            model: 'gpt-5.4-mini',
            choices: [
                {
                    index: 0,
                    finish_reason: 'tool_calls',
                    message: {
                        role: 'assistant',
                        content: '',
                        tool_calls: [
                            {
                                id: 'codex_call_1',
                                type: 'function',
                                function: {
                                    name: 'moreInfo',
                                    arguments: JSON.stringify({ name: 'Ancient Library' })
                                }
                            }
                        ]
                    }
                }
            ]
        }
    });
    Globals.config = {
        ai: buildCodexAiConfig()
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Need tool calls.' }],
            metadataLabel: 'bridge_tool_call_test',
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
            validateXML: false,
            output: 'silent',
            onResponse: (response) => {
                onResponsePayload = response;
            }
        });

        assert.equal(result, '');
        assert.equal(onResponsePayload?.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.name, 'moreInfo');
        assert.equal(onResponsePayload?.data?.choices?.[0]?.finish_reason, 'tool_calls');
    } finally {
        axios.post = originalAxiosPost;
        CodexBridgeClient.chatCompletion = originalBridgeChatCompletion;
        Globals.config = originalConfig;
    }
});

test('Codex bridge concurrency uses configured limits only for fresh mode', { concurrency: false }, () => {
    const aiConfig = buildCodexAiConfig({
        codex_bridge: {
            command: 'codex',
            home: './tmp/test-codex-home',
            session_mode: 'resume_id',
            session_id: '',
            sandbox: 'read-only',
            skip_git_repo_check: true,
            reasoning_effort: '',
            profile: '',
            prompt_preamble: ''
        }
    });

    const errors = CodexBridgeClient.getConfigurationErrors(aiConfig);
    assert.match(errors.join('\n'), /session_id is required/i);
    assert.equal(LLMClient.getMaxConcurrent(buildCodexAiConfig()), 6);
    assert.equal(LLMClient.getMaxConcurrent(buildCodexAiConfig({
        codex_bridge: {
            command: 'codex',
            home: './tmp/test-codex-home',
            session_mode: 'resume_last',
            session_id: '',
            sandbox: 'read-only',
            skip_git_repo_check: true,
            reasoning_effort: '',
            profile: '',
            prompt_preamble: ''
        }
    })), 1);
});

test('Codex bridge semaphore keys separate fresh and resumed session modes', { concurrency: false }, () => {
    const freshKey = CodexBridgeClient.getSemaphoreKey(buildCodexAiConfig(), 'gpt-5.4-mini');
    const resumeLastKey = CodexBridgeClient.getSemaphoreKey(buildCodexAiConfig({
        codex_bridge: {
            command: 'codex',
            home: './tmp/test-codex-home-a',
            session_mode: 'resume_last',
            session_id: '',
            sandbox: 'read-only',
            skip_git_repo_check: true,
            reasoning_effort: '',
            profile: '',
            prompt_preamble: ''
        }
    }), 'gpt-5.4-mini');
    const resumeIdKey = CodexBridgeClient.getSemaphoreKey(buildCodexAiConfig({
        codex_bridge: {
            command: 'codex',
            home: './tmp/test-codex-home-b',
            session_mode: 'resume_id',
            session_id: 'session-123',
            sandbox: 'read-only',
            skip_git_repo_check: true,
            reasoning_effort: '',
            profile: '',
            prompt_preamble: ''
        }
    }), 'gpt-5.4-mini');

    assert.match(freshKey, /codex_cli_bridge::fresh::gpt-5\.4-mini$/);
    assert.match(resumeLastKey, /codex_cli_bridge::resume_last::/);
    assert.match(resumeIdKey, /codex_cli_bridge::resume_id::/);
    assert.notEqual(freshKey, resumeLastKey);
    assert.notEqual(freshKey, resumeIdKey);
    assert.match(resumeIdKey, /session-123$/);
});

test('Codex bridge configuration rejects invalid reasoning effort values', { concurrency: false }, () => {
    const aiConfig = buildCodexAiConfig({
        codex_bridge: {
            command: 'codex',
            home: './tmp/test-codex-home',
            session_mode: 'fresh',
            session_id: '',
            sandbox: 'read-only',
            skip_git_repo_check: true,
            reasoning_effort: 'bogus',
            profile: '',
            prompt_preamble: ''
        }
    });

    const errors = CodexBridgeClient.getConfigurationErrors(aiConfig);
    assert.match(errors.join('\n'), /reasoning_effort must be one of/i);
});

test('CodexBridgeClient fresh mode spawns Codex with schema output and cleans up temporary output file', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CODEX_PATH, 0o755);

    const runtimeDir = path.join(process.cwd(), 'tmp', 'codex-bridge-test-runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    const argLogPath = path.join(runtimeDir, 'fresh-args.json');

    await withFakeCodexEnv({
        FAKE_CODEX_ARG_LOG: argLogPath,
        FAKE_CODEX_RESPONSE: JSON.stringify({
            content: '<final>fresh bridge ok</final>',
            tool_calls: []
        }),
        FAKE_CODEX_THREAD_ID: 'fresh-thread-123',
        FAKE_CODEX_EXIT_CODE: '0'
    }, async () => {
        const response = await CodexBridgeClient.chatCompletion({
            messages: [
                { role: 'system', content: 'Fresh bridge system instructions.' },
                { role: 'user', content: 'Say hello from the fresh bridge.' }
            ],
            model: 'gpt-5.4-mini',
            metadataLabel: 'codex_bridge_spawn_fresh',
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
            aiConfig: buildCodexAiConfig({
                codex_bridge: {
                    command: FAKE_CODEX_PATH,
                    home: './tmp/test-codex-home-fresh',
                    session_mode: 'fresh',
                    session_id: '',
                    sandbox: 'workspace-write',
                    skip_git_repo_check: true,
                    reasoning_effort: 'none',
                    profile: '',
                    prompt_preamble: 'Bridge preamble for fresh mode.'
                }
            })
        });

        assert.ok(typeof response?.data?.id === 'string' && response.data.id.length > 0);
        assert.equal(response?.data?.choices?.[0]?.message?.content, '<final>fresh bridge ok</final>');

        const invocation = JSON.parse(fs.readFileSync(argLogPath, 'utf8'));
        const outputIndex = invocation.args.indexOf('-o');
        const schemaIndex = invocation.args.indexOf('--output-schema');
        assert.notEqual(outputIndex, -1);
        assert.notEqual(schemaIndex, -1);
        assert.equal(invocation.args[0], 'exec');
        assert.ok(invocation.args.includes('--json'));
        assert.ok(invocation.args.includes('--ephemeral'));
        assert.ok(invocation.args.includes('--output-schema'));
        assert.ok(invocation.args.includes('--sandbox'));
        assert.ok(invocation.args.includes('workspace-write'));
        assert.ok(invocation.args.includes('--skip-git-repo-check'));
        assert.ok(invocation.args.includes('-c'));
        assert.ok(invocation.args.includes('model_reasoning_effort="none"'));
        const developerInstructionsArg = invocation.args.find(arg => arg.startsWith('developer_instructions='));
        assert.ok(developerInstructionsArg);
        assert.ok(developerInstructionsArg.includes('Fresh bridge system instructions.'));
        assert.ok(developerInstructionsArg.includes('You are acting as a completion bridge for an external application.'));
        assert.ok(developerInstructionsArg.includes('Available tools:'));
        assert.ok(invocation.stdinText.includes('Conversation:'));
        assert.ok(invocation.stdinText.includes('Message 1 (user)'));
        assert.ok(invocation.stdinText.includes('Say hello from the fresh bridge.'));
        assert.equal(invocation.stdinText.includes('Fresh bridge system instructions.'), false);
        const schema = JSON.parse(fs.readFileSync(invocation.args[schemaIndex + 1], 'utf8'));
        assert.equal(Object.prototype.hasOwnProperty.call(schema, 'oneOf'), false);
        assert.equal(schema?.properties?.content?.type, 'string');
        assert.equal(schema?.properties?.tool_calls?.type, 'array');
        assert.equal(schema?.properties?.tool_calls?.items?.properties?.arguments?.type, 'string');
        assert.deepEqual(schema?.required, ['content', 'tool_calls']);
        assert.ok(invocation.codexHome.endsWith(path.join('tmp', 'test-codex-home-fresh')));
        assert.equal(fs.existsSync(invocation.args[outputIndex + 1]), false);
    });
});

test('CodexBridgeClient prompt logs write plain response content when available', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CODEX_PATH, 0o755);

    const originalConfig = Globals.config;
    const metadataLabel = 'codex_bridge_plaintext_log';
    const logDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const existingFiles = new Set(
        fs.readdirSync(logDir).filter(name => name.includes(`_prompt_${metadataLabel}.log`))
    );

    const aiConfig = buildCodexAiConfig({
        codex_bridge: {
            command: FAKE_CODEX_PATH,
            home: './tmp/test-codex-home-log',
            session_mode: 'fresh',
            session_id: '',
            sandbox: 'read-only',
            skip_git_repo_check: true,
            reasoning_effort: '',
            profile: '',
            prompt_preamble: ''
        }
    });

    Globals.config = { ai: aiConfig };

    try {
        await withFakeCodexEnv({
            FAKE_CODEX_RESPONSE: JSON.stringify({
                content: '<final>log as plain text</final>',
                tool_calls: []
            }),
            FAKE_CODEX_THREAD_ID: 'log-thread-789',
            FAKE_CODEX_EXIT_CODE: '0'
        }, async () => {
            await CodexBridgeClient.chatCompletion({
                messages: [{ role: 'user', content: 'Write a plain log response.' }],
                model: 'gpt-5.4-mini',
                metadataLabel,
                aiConfig
            });
        });

        const createdFiles = fs.readdirSync(logDir)
            .filter(name => name.includes(`_prompt_${metadataLabel}.log`) && !existingFiles.has(name))
            .sort();
        assert.equal(createdFiles.length, 1);

        const logText = fs.readFileSync(path.join(logDir, createdFiles[0]), 'utf8');
        assert.match(logText, /=== RESPONSE ===\n<final>log as plain text<\/final>\n/);
        assert.match(logText, /=== RESPONSE JSON ===\n\{/);
    } finally {
        Globals.config = originalConfig;
    }
});

test('CodexBridgeClient resume_id mode uses resume args and normalizes tool calls', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CODEX_PATH, 0o755);

    const runtimeDir = path.join(process.cwd(), 'tmp', 'codex-bridge-test-runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    const argLogPath = path.join(runtimeDir, 'resume-args.json');

    await withFakeCodexEnv({
        FAKE_CODEX_ARG_LOG: argLogPath,
        FAKE_CODEX_RESPONSE: JSON.stringify({
            content: '',
            tool_calls: [
                {
                    name: 'moreInfo',
                    arguments: JSON.stringify({
                        name: 'Ancient Dock'
                    })
                }
            ]
        }),
        FAKE_CODEX_THREAD_ID: 'resume-thread-456',
        FAKE_CODEX_EXIT_CODE: '0'
    }, async () => {
        const response = await CodexBridgeClient.chatCompletion({
            messages: [
                { role: 'system', content: 'Resume bridge system instructions.' },
                { role: 'user', content: 'Use a tool call.' }
            ],
            model: 'gpt-5.4-mini',
            metadataLabel: 'codex_bridge_spawn_resume',
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
            aiConfig: buildCodexAiConfig({
                codex_bridge: {
                    command: FAKE_CODEX_PATH,
                    home: './tmp/test-codex-home-resume',
                    session_mode: 'resume_id',
                    session_id: 'session-123',
                    sandbox: 'read-only',
                    skip_git_repo_check: true,
                    reasoning_effort: 'none',
                    profile: '',
                    prompt_preamble: ''
                }
            })
        });

        const toolCall = response?.data?.choices?.[0]?.message?.tool_calls?.[0];
        assert.ok(typeof response?.data?.id === 'string' && response.data.id.length > 0);
        assert.equal(response?.data?.choices?.[0]?.finish_reason, 'tool_calls');
        assert.equal(toolCall?.function?.name, 'moreInfo');
        assert.deepEqual(JSON.parse(toolCall?.function?.arguments || '{}'), { name: 'Ancient Dock' });

        const invocation = JSON.parse(fs.readFileSync(argLogPath, 'utf8'));
        assert.equal(invocation.args[0], 'exec');
        assert.equal(invocation.args[1], 'resume');
        assert.ok(invocation.args.includes('session-123'));
        assert.ok(invocation.args.includes('--json'));
        assert.ok(invocation.args.includes('--skip-git-repo-check'));
        assert.ok(invocation.args.includes('-c'));
        assert.ok(invocation.args.includes('model_reasoning_effort="none"'));
        const developerInstructionsArg = invocation.args.find(arg => arg.startsWith('developer_instructions='));
        assert.ok(developerInstructionsArg);
        assert.ok(developerInstructionsArg.includes('Resume bridge system instructions.'));
        assert.equal(invocation.stdinText.includes('Resume bridge system instructions.'), false);
        assert.ok(invocation.stdinText.includes('Use a tool call.'));
        assert.equal(invocation.args.includes('--output-schema'), false);
        assert.equal(invocation.args.includes('--sandbox'), false);
    });
});

test('CodexBridgeClient extracts usage from stdout turn.completed events', { concurrency: false }, () => {
    const usage = CodexBridgeClient.extractUsageFromStdout([
        '{"type":"thread.started","thread_id":"usage-thread-1"}',
        '{"type":"turn.started"}',
        '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":25,"output_tokens":8}}'
    ].join('\n'));

    assert.deepEqual(usage, {
        input_tokens: 120,
        cached_input_tokens: 25,
        output_tokens: 8,
        total_tokens: 128
    });
});

test('CodexBridgeClient.runCodexCommand honors abort signals', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CODEX_PATH, 0o755);

    const controller = new AbortController();
    const abortPromise = CodexBridgeClient.runCodexCommand({
        command: FAKE_CODEX_PATH,
        args: ['exec', '--json'],
        promptText: 'Abort this fake Codex run.',
        timeoutMs: 10000,
        cwd: process.cwd(),
        env: {
            ...process.env,
            FAKE_CODEX_STDOUT_EVENTS: JSON.stringify([
                { type: 'thread.started', thread_id: 'abort-thread-1' },
                { type: 'turn.started' }
            ]),
            FAKE_CODEX_DELAY_MS: '3000',
            FAKE_CODEX_EXIT_CODE: '0'
        },
        signal: controller.signal
    });

    setTimeout(() => {
        controller.abort(new Error('Abort requested from codex bridge test.'));
    }, 100);

    await assert.rejects(
        abortPromise,
        /Abort requested from codex bridge test\./
    );
});

test('LLMClient.chatCompletion logs Codex usage each prompt and rate limits every fifth counted turn', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalBridgeChatCompletion = CodexBridgeClient.chatCompletion;
    const originalReadRateLimits = CodexBridgeClient.readRateLimits;
    const originalConfig = Globals.config;
    const originalAppendChatEntry = Globals.appendChatEntry;
    const originalConsoleLog = console.log;
    const originalConsoleWarn = console.warn;

    const loggedLines = [];
    const warnedLines = [];
    const appendedEntries = [];
    let rateLimitReads = 0;

    axios.post = async () => {
        throw new Error('axios.post should not be called for codex_cli_bridge backend.');
    };
    CodexBridgeClient.chatCompletion = async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { backend: 'codex_cli_bridge' },
        data: {
            id: 'bridge-response-usage-log',
            object: 'chat.completion',
            created: 1,
            model: 'gpt-5.4-mini',
            usage: {
                input_tokens: 100,
                cached_input_tokens: 20,
                output_tokens: 5,
                total_tokens: 105
            },
            choices: [
                {
                    index: 0,
                    finish_reason: 'stop',
                    message: {
                        role: 'assistant',
                        content: '<final>usage logging response</final>'
                    }
                }
            ]
        }
    });
    CodexBridgeClient.readRateLimits = async () => {
        rateLimitReads += 1;
        return {
            rateLimits: {
                limitId: 'codex',
                limitName: 'Codex',
                planType: 'pro',
                primary: {
                    usedPercent: 31,
                    resetsAt: 1777000000000,
                    windowDurationMins: 300
                },
                secondary: {
                    usedPercent: 54,
                    resetsAt: 1777086400000,
                    windowDurationMins: 10080
                },
                credits: {
                    hasCredits: true,
                    unlimited: false,
                    balance: '11.00'
                }
            }
        };
    };
    Globals.config = {
        ai: buildCodexAiConfig()
    };
    Globals.appendChatEntry = (entry, options = {}) => {
        appendedEntries.push({
            entry: entry ? JSON.parse(JSON.stringify(entry)) : entry,
            options: options ? JSON.parse(JSON.stringify(options)) : options
        });
        return entry;
    };
    console.log = (...args) => {
        loggedLines.push(args.join(' '));
    };
    console.warn = (...args) => {
        warnedLines.push(args.join(' '));
    };

    try {
        for (let index = 0; index < 4; index += 1) {
            const result = await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: `Usage logging request ${index + 1}` }],
                metadataLabel: 'player_action',
                metadata: {
                    clientId: 'test-client-1',
                    __codexQuotaCountAsTurn: true,
                    __codexQuotaTurnKey: `turn_${index + 1}`
                },
                requiredRegex: /<final>[\s\S]*?<\/final>/,
                validateXML: false,
                output: 'silent'
            });
            assert.equal(result, '<final>usage logging response</final>');
        }

        const duplicateTurnResult = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Duplicate turn request' }],
            metadataLabel: 'player_action',
            metadata: {
                clientId: 'test-client-1',
                __codexQuotaCountAsTurn: true,
                __codexQuotaTurnKey: 'turn_4'
            },
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent'
        });
        assert.equal(duplicateTurnResult, '<final>usage logging response</final>');

        const nonTurnResult = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Non-turn prompt request' }],
            metadataLabel: 'codex_usage_log_aux',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent'
        });
        assert.equal(nonTurnResult, '<final>usage logging response</final>');

        const fifthTurnResult = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Fifth unique counted turn request' }],
            metadataLabel: 'craft_player_action',
            metadata: {
                clientId: 'test-client-1',
                __codexQuotaCountAsTurn: true,
                __codexQuotaTurnKey: 'turn_5'
            },
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent'
        });
        assert.equal(fifthTurnResult, '<final>usage logging response</final>');

        const usageLines = loggedLines.filter(line => line.includes('[codex usage'));
        assert.equal(usageLines.length, 7);
        assert.ok(usageLines[0].includes('prompt=player_action'));
        assert.ok(usageLines[6].includes('running input=700'));
        assert.equal(rateLimitReads, 1);
        assert.ok(loggedLines.some(line => line.includes('[codex quota turn 5]')));
        assert.equal(appendedEntries.length, 1);
        assert.equal(appendedEntries[0].entry?.type, 'status-summary');
        assert.equal(appendedEntries[0].entry?.metadata?.excludeFromBaseContextHistory, true);
        assert.equal(appendedEntries[0].entry?.summaryItems?.length, 3);
        assert.equal(appendedEntries[0].entry?.summaryItems?.[0]?.text, '11.00 credits');
        assert.match(appendedEntries[0].entry?.summaryItems?.[1]?.text || '', /^Primary: 69% remaining; resets \d{1,2}:\d{2} [AP]M$/);
        assert.match(appendedEntries[0].entry?.summaryItems?.[2]?.text || '', /^Secondary: 46% remaining; resets [A-Z][a-z]{2} \d{1,2}(st|nd|rd|th) at \d{1,2}:\d{2} [AP]M$/);
        assert.equal(appendedEntries[0].options?.emitClientRefresh, true);
        assert.equal(appendedEntries[0].options?.clientId, 'test-client-1');
        assert.equal(appendedEntries[0].options?.refreshPayload?.reason, 'codex_quota_check');
        assert.deepEqual(warnedLines, []);
    } finally {
        axios.post = originalAxiosPost;
        CodexBridgeClient.chatCompletion = originalBridgeChatCompletion;
        CodexBridgeClient.readRateLimits = originalReadRateLimits;
        Globals.config = originalConfig;
        Globals.appendChatEntry = originalAppendChatEntry;
        console.log = originalConsoleLog;
        console.warn = originalConsoleWarn;
    }
});

test('LLMClient.chatCompletion broadcasts Codex bridge progress through prompt_progress', { concurrency: false }, async () => {
    fs.chmodSync(FAKE_CODEX_PATH, 0o755);

    const originalConfig = Globals.config;
    const originalRealtimeHub = Globals.realtimeHub;
    const emittedEvents = [];

    Globals.config = {
        ai: buildCodexAiConfig({
            codex_bridge: {
                command: FAKE_CODEX_PATH,
                home: './tmp/test-codex-home-progress',
                session_mode: 'fresh',
                session_id: '',
                sandbox: 'read-only',
                skip_git_repo_check: true,
                reasoning_effort: 'none',
                profile: '',
                prompt_preamble: ''
            }
        })
    };
    Globals.realtimeHub = {
        emit(_room, type, payload) {
            emittedEvents.push({ type, payload });
        }
    };

    try {
        const result = await withFakeCodexEnv({
            FAKE_CODEX_RESPONSE: JSON.stringify({
                content: '<final>codex progress ok</final>',
                tool_calls: []
            }),
            FAKE_CODEX_STDOUT_EVENTS: JSON.stringify([
                { type: 'thread.started', thread_id: 'progress-thread-1' },
                { type: 'turn.started' },
                { type: 'item.completed', item: { type: 'message' } },
                { type: 'turn.completed' }
            ]),
            FAKE_CODEX_DELAY_MS: '700',
            FAKE_CODEX_EXIT_CODE: '0'
        }, async () => {
            return await LLMClient.chatCompletion({
                messages: [
                    { role: 'system', content: 'System instructions for progress test.' },
                    { role: 'user', content: 'Show prompt progress in the popup.' }
                ],
                metadataLabel: 'codex_progress_popup_test',
                requiredRegex: /<final>[\s\S]*?<\/final>/,
                validateXML: false,
                output: 'stdout'
            });
        });

        assert.equal(result, '<final>codex progress ok</final>');
        await LLMClient.waitForPromptDrain({ timeoutMs: 3000, pollIntervalMs: 25 });

        const promptProgressEvents = emittedEvents.filter(event => event.type === 'prompt_progress');
        const activeProgressEvents = promptProgressEvents.filter(event => Array.isArray(event.payload?.entries) && event.payload.entries.length > 0);
        assert.ok(activeProgressEvents.length > 0);

        const latestActiveEntry = activeProgressEvents[activeProgressEvents.length - 1].payload.entries[0];
        assert.equal(latestActiveEntry.model, 'gpt-5.4-mini');
        assert.ok(Number.isFinite(Number(latestActiveEntry.bytes)));
        assert.match(latestActiveEntry.promptText || '', /Show prompt progress in the popup\./);
        assert.equal(typeof latestActiveEntry.previewText, 'string');
        assert.ok(emittedEvents.some(event => event.type === 'prompt_progress_cleared'));
    } finally {
        Globals.config = originalConfig;
        Globals.realtimeHub = originalRealtimeHub;
    }
});
