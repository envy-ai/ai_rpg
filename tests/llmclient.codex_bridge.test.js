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

test('LLMClient.chatCompletion uses Codex bridge backend without axios', async () => {
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

test('LLMClient.chatCompletion accepts Codex bridge tool calls', async () => {
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

test('Codex bridge configuration requires session_id for resume_id mode and forces concurrency to one', () => {
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
    assert.equal(LLMClient.getMaxConcurrent(buildCodexAiConfig()), 1);
});

test('Codex bridge configuration rejects invalid reasoning effort values', () => {
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

test('CodexBridgeClient fresh mode spawns Codex with schema output and cleans up temporary output file', async () => {
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

test('CodexBridgeClient resume_id mode uses resume args and normalizes tool calls', async () => {
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
