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

test('CodexBridgeClient fresh mode uses app-server transport with structured output', { concurrency: false }, async () => {
    const originalRunCodexAppServer = CodexBridgeClient.runCodexAppServer;
    const requests = [];
    let appServerArgs = null;

    CodexBridgeClient.runCodexAppServer = async (args) => {
        appServerArgs = args;
        const stdoutLines = [];
        const emit = (payload) => {
            stdoutLines.push(JSON.stringify(payload));
            args.onStdoutChunk?.(`${JSON.stringify(payload)}\n`);
            args.onStdoutEvent?.(payload);
        };
        const request = async (method, params) => {
            requests.push({ method, params });
            if (method === 'thread/start') {
                return { thread: { id: 'fresh-thread-123' } };
            }
            if (method === 'turn/start') {
                emit({ type: 'turn.started', threadId: 'fresh-thread-123', turn: { id: 'turn-1', items: [], status: 'inProgress' } });
                emit({ type: 'item.agentMessage.delta', threadId: 'fresh-thread-123', turnId: 'turn-1', itemId: 'msg-1', delta: '{"' });
                emit({ type: 'item.agentMessage.delta', threadId: 'fresh-thread-123', turnId: 'turn-1', itemId: 'msg-1', delta: 'content' });
                emit({ type: 'item.agentMessage.delta', threadId: 'fresh-thread-123', turnId: 'turn-1', itemId: 'msg-1', delta: '":"<final>fresh bridge ok</final>","tool_calls":[]}' });
                emit({ type: 'item.completed', threadId: 'fresh-thread-123', turnId: 'turn-1', item: { type: 'agentMessage', id: 'msg-1', text: '{"content":"<final>fresh bridge ok</final>","tool_calls":[]}' } });
                emit({ type: 'thread.tokenUsage.updated', threadId: 'fresh-thread-123', turnId: 'turn-1', tokenUsage: { last: { inputTokens: 12, cachedInputTokens: 2, outputTokens: 7, totalTokens: 19 } } });
                emit({ type: 'turn.completed', threadId: 'fresh-thread-123', turn: { id: 'turn-1', items: [], status: 'completed' } });
                return { turn: { id: 'turn-1', items: [], status: 'inProgress' } };
            }
            throw new Error(`Unexpected request method: ${method}`);
        };
        const result = await args.sessionHandler({ request });
        return {
            result,
            stdout: stdoutLines.join('\n'),
            stderr: ''
        };
    };

    try {
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

        assert.equal(appServerArgs?.aiConfig?.codex_bridge?.command, FAKE_CODEX_PATH);
        const threadStartRequest = requests.find(entry => entry.method === 'thread/start');
        const turnStartRequest = requests.find(entry => entry.method === 'turn/start');
        assert.ok(threadStartRequest);
        assert.ok(turnStartRequest);
        assert.equal(threadStartRequest.params?.ephemeral, true);
        assert.equal(threadStartRequest.params?.sandbox, 'workspace-write');
        assert.equal(threadStartRequest.params?.approvalPolicy, 'never');
        assert.equal(threadStartRequest.params?.model, 'gpt-5.4-mini');
        assert.match(threadStartRequest.params?.developerInstructions || '', /Fresh bridge system instructions\./);
        assert.match(threadStartRequest.params?.developerInstructions || '', /You are acting as a completion bridge for an external application\./);
        assert.match(threadStartRequest.params?.developerInstructions || '', /Available tools:/);
        assert.equal(turnStartRequest.params?.effort, 'none');
        assert.equal(turnStartRequest.params?.threadId, 'fresh-thread-123');
        assert.equal(turnStartRequest.params?.sandboxPolicy?.type, 'workspaceWrite');
        assert.deepEqual(turnStartRequest.params?.sandboxPolicy?.writableRoots, [process.cwd()]);
        assert.match(turnStartRequest.params?.input?.[0]?.text || '', /Conversation:/);
        assert.match(turnStartRequest.params?.input?.[0]?.text || '', /Message 1 \(user\)/);
        assert.match(turnStartRequest.params?.input?.[0]?.text || '', /Say hello from the fresh bridge\./);
        assert.doesNotMatch(turnStartRequest.params?.input?.[0]?.text || '', /Fresh bridge system instructions\./);
        const schema = turnStartRequest.params?.outputSchema;
        assert.equal(Object.prototype.hasOwnProperty.call(schema, 'oneOf'), false);
        assert.equal(schema?.properties?.content?.type, 'string');
        assert.equal(schema?.properties?.tool_calls?.type, 'array');
        assert.equal(schema?.properties?.tool_calls?.items?.properties?.arguments?.type, 'string');
        assert.deepEqual(schema?.required, ['content', 'tool_calls']);
    } finally {
        CodexBridgeClient.runCodexAppServer = originalRunCodexAppServer;
    }
});

test('CodexBridgeClient prompt logs write plain response content when available', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalRunCodexAppServer = CodexBridgeClient.runCodexAppServer;
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
    CodexBridgeClient.runCodexAppServer = async (args) => {
        const stdoutLines = [];
        const emit = (payload) => {
            stdoutLines.push(JSON.stringify(payload));
            args.onStdoutEvent?.(payload);
        };
        const request = async (method) => {
            if (method === 'thread/start') {
                return { thread: { id: 'log-thread-789' } };
            }
            if (method === 'turn/start') {
                emit({ type: 'item.completed', threadId: 'log-thread-789', turnId: 'turn-log', item: { type: 'agentMessage', id: 'msg-log', text: '{"content":"<final>log as plain text</final>"}' } });
                emit({ type: 'turn.completed', threadId: 'log-thread-789', turn: { id: 'turn-log', items: [], status: 'completed' } });
                return { turn: { id: 'turn-log', items: [], status: 'inProgress' } };
            }
            throw new Error(`Unexpected request method: ${method}`);
        };
        const result = await args.sessionHandler({ request });
        return { result, stdout: stdoutLines.join('\n'), stderr: '' };
    };

    try {
        await CodexBridgeClient.chatCompletion({
            messages: [{ role: 'user', content: 'Write a plain log response.' }],
            model: 'gpt-5.4-mini',
            metadataLabel,
            aiConfig
        });
        const createdFiles = fs.readdirSync(logDir)
            .filter(name => name.includes(`_prompt_${metadataLabel}.log`) && !existingFiles.has(name))
            .sort();
        assert.equal(createdFiles.length, 1);

        const logText = fs.readFileSync(path.join(logDir, createdFiles[0]), 'utf8');
        assert.match(logText, /=== RESPONSE ===\n<final>log as plain text<\/final>\n/);
        assert.match(logText, /=== RESPONSE JSON ===\n\{/);
    } finally {
        CodexBridgeClient.runCodexAppServer = originalRunCodexAppServer;
        Globals.config = originalConfig;
    }
});

test('CodexBridgeClient resume_id mode resumes an app-server thread and normalizes tool calls', { concurrency: false }, async () => {
    const originalRunCodexAppServer = CodexBridgeClient.runCodexAppServer;
    const requests = [];

    CodexBridgeClient.runCodexAppServer = async (args) => {
        const stdoutLines = [];
        const emit = (payload) => {
            stdoutLines.push(JSON.stringify(payload));
            args.onStdoutEvent?.(payload);
        };
        const request = async (method, params) => {
            requests.push({ method, params });
            if (method === 'thread/resume') {
                return { thread: { id: params.threadId } };
            }
            if (method === 'turn/start') {
                emit({
                    type: 'item.completed',
                    threadId: 'session-123',
                    turnId: 'turn-resume',
                    item: {
                        type: 'agentMessage',
                        id: 'msg-resume',
                        text: JSON.stringify({
                            content: '',
                            tool_calls: [
                                {
                                    name: 'moreInfo',
                                    arguments: JSON.stringify({ name: 'Ancient Dock' })
                                }
                            ]
                        })
                    }
                });
                emit({ type: 'turn.completed', threadId: 'session-123', turn: { id: 'turn-resume', items: [], status: 'completed' } });
                return { turn: { id: 'turn-resume', items: [], status: 'inProgress' } };
            }
            throw new Error(`Unexpected request method: ${method}`);
        };
        const result = await args.sessionHandler({ request });
        return { result, stdout: stdoutLines.join('\n'), stderr: '' };
    };

    try {
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

        const resumeRequest = requests.find(entry => entry.method === 'thread/resume');
        const turnStartRequest = requests.find(entry => entry.method === 'turn/start');
        assert.ok(resumeRequest);
        assert.ok(turnStartRequest);
        assert.equal(resumeRequest.params?.threadId, 'session-123');
        assert.equal(resumeRequest.params?.sandbox, 'read-only');
        assert.equal(resumeRequest.params?.approvalPolicy, 'never');
        assert.match(resumeRequest.params?.developerInstructions || '', /Resume bridge system instructions\./);
        assert.equal(turnStartRequest.params?.threadId, 'session-123');
        assert.equal(turnStartRequest.params?.effort, 'none');
        assert.equal(turnStartRequest.params?.sandboxPolicy?.type, 'readOnly');
        assert.match(turnStartRequest.params?.input?.[0]?.text || '', /Use a tool call\./);
        assert.doesNotMatch(turnStartRequest.params?.input?.[0]?.text || '', /Resume bridge system instructions\./);
    } finally {
        CodexBridgeClient.runCodexAppServer = originalRunCodexAppServer;
    }
});

test('CodexBridgeClient converts app-server JSON deltas into plain content preview events', { concurrency: false }, async () => {
    const originalRunCodexAppServer = CodexBridgeClient.runCodexAppServer;
    const previewEvents = [];

    CodexBridgeClient.runCodexAppServer = async (args) => {
        const stdoutLines = [];
        const emit = (payload) => {
            stdoutLines.push(JSON.stringify(payload));
            args.onStdoutEvent?.(payload);
        };
        const request = async (method) => {
            if (method === 'thread/start') {
                return { thread: { id: 'preview-thread-321' } };
            }
            if (method === 'turn/start') {
                emit({ type: 'item.agentMessage.delta', threadId: 'preview-thread-321', turnId: 'turn-preview', itemId: 'msg-preview', delta: '{"' });
                emit({ type: 'item.agentMessage.delta', threadId: 'preview-thread-321', turnId: 'turn-preview', itemId: 'msg-preview', delta: 'content' });
                emit({ type: 'item.agentMessage.delta', threadId: 'preview-thread-321', turnId: 'turn-preview', itemId: 'msg-preview', delta: '":"'} );
                emit({ type: 'item.agentMessage.delta', threadId: 'preview-thread-321', turnId: 'turn-preview', itemId: 'msg-preview', delta: 'hello' });
                emit({ type: 'item.agentMessage.delta', threadId: 'preview-thread-321', turnId: 'turn-preview', itemId: 'msg-preview', delta: '"}' });
                emit({ type: 'item.completed', threadId: 'preview-thread-321', turnId: 'turn-preview', item: { type: 'agentMessage', id: 'msg-preview', text: '{"content":"hello"}' } });
                emit({ type: 'turn.completed', threadId: 'preview-thread-321', turn: { id: 'turn-preview', items: [], status: 'completed' } });
                return { turn: { id: 'turn-preview', items: [], status: 'inProgress' } };
            }
            throw new Error(`Unexpected request method: ${method}`);
        };
        const result = await args.sessionHandler({ request });
        return { result, stdout: stdoutLines.join('\n'), stderr: '' };
    };

    try {
        const response = await CodexBridgeClient.chatCompletion({
            messages: [{ role: 'user', content: 'Say hello.' }],
            model: 'gpt-5.4-mini',
            metadataLabel: 'codex_bridge_preview_events',
            aiConfig: buildCodexAiConfig({
                codex_bridge: {
                    command: FAKE_CODEX_PATH,
                    home: './tmp/test-codex-home-preview',
                    session_mode: 'fresh',
                    session_id: '',
                    sandbox: 'read-only',
                    skip_git_repo_check: true,
                    reasoning_effort: '',
                    profile: '',
                    prompt_preamble: ''
                }
            }),
            onStdoutEvent: (event) => {
                previewEvents.push(event);
            }
        });

        assert.equal(response?.data?.choices?.[0]?.message?.content, 'hello');
    } finally {
        CodexBridgeClient.runCodexAppServer = originalRunCodexAppServer;
    }

    const textDeltas = previewEvents.filter(event => event?.type === 'agent_message_delta').map(event => event.delta);
    assert.ok(textDeltas.includes('hello'));
    assert.equal(textDeltas.some(delta => typeof delta === 'string' && delta.includes('"content"')), false);
    const finalPreviewEvent = previewEvents.find(event => event?.type === 'item.completed' && event?.item?.type === 'agent_message');
    assert.equal(finalPreviewEvent?.item?.text, 'hello');
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

test('CodexBridgeClient extracts usage from stdout method-style turn/completed events', { concurrency: false }, () => {
    const usage = CodexBridgeClient.extractUsageFromStdout([
        '{"method":"thread/started","params":{"thread_id":"usage-thread-2"}}',
        '{"method":"turn/started","params":{}}',
        '{"method":"turn/completed","params":{"usage":{"input_tokens":77,"cached_input_tokens":11,"output_tokens":9}}}'
    ].join('\n'));

    assert.deepEqual(usage, {
        input_tokens: 77,
        cached_input_tokens: 11,
        output_tokens: 9,
        total_tokens: 86
    });
});

test('CodexBridgeClient extracts usage from app-server thread/tokenUsage/updated events', { concurrency: false }, () => {
    const usage = CodexBridgeClient.extractUsageFromStdout([
        '{"method":"thread/started","params":{"thread":{"id":"usage-thread-3"}}}',
        '{"method":"thread/tokenUsage/updated","params":{"threadId":"usage-thread-3","tokenUsage":{"last":{"inputTokens":33,"cachedInputTokens":4,"outputTokens":6,"totalTokens":39}}}}',
        '{"method":"turn/completed","params":{"threadId":"usage-thread-3","turn":{"id":"turn-1","status":"completed","items":[]}}}'
    ].join('\n'));

    assert.deepEqual(usage, {
        input_tokens: 33,
        cached_input_tokens: 4,
        output_tokens: 6,
        total_tokens: 39
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
        assert.ok(usageLines[6].includes('input=100'));
        assert.equal(usageLines[6].includes('running input='), false);
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

test('LLMClient.chatCompletion prefers the generic codex quota bucket over unrelated model buckets', { concurrency: false }, async () => {
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

    axios.post = async () => {
        throw new Error('axios.post should not be called for codex_cli_bridge backend.');
    };
    CodexBridgeClient.chatCompletion = async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { backend: 'codex_cli_bridge' },
        data: {
            id: 'bridge-response-quota-bucket-selection',
            object: 'chat.completion',
            created: 1,
            model: 'gpt-5.4',
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
                        content: '<final>quota bucket selection</final>'
                    }
                }
            ]
        }
    });
    CodexBridgeClient.readRateLimits = async () => ({
        rateLimitsByLimitId: {
            'GPT-5.3-Codex-Spark': {
                limitId: 'GPT-5.3-Codex-Spark',
                limitName: 'GPT-5.3-Codex-Spark',
                planType: 'pro',
                primary: {
                    usedPercent: 0,
                    resetsAt: 1777000000000,
                    windowDurationMins: 300
                },
                secondary: {
                    usedPercent: 0,
                    resetsAt: 1777600000000,
                    windowDurationMins: 10080
                },
                credits: {
                    hasCredits: false,
                    unlimited: false
                }
            },
            codex: {
                limitId: 'codex',
                limitName: 'codex',
                planType: 'pro',
                primary: {
                    usedPercent: 20,
                    resetsAt: 1776991260000,
                    windowDurationMins: 300
                },
                secondary: {
                    usedPercent: 23,
                    resetsAt: 1777110975000,
                    windowDurationMins: 10080
                },
                credits: {
                    hasCredits: false,
                    unlimited: false
                }
            }
        }
    });
    Globals.config = {
        ai: buildCodexAiConfig({
            model: 'gpt-5.4'
        })
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
        for (let index = 0; index < 5; index += 1) {
            const result = await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: `Quota selection request ${index + 1}` }],
                metadataLabel: 'player_action',
                metadata: {
                    clientId: 'test-client-2',
                    __codexQuotaCountAsTurn: true,
                    __codexQuotaTurnKey: `quota_selection_turn_${index + 1}`
                },
                requiredRegex: /<final>[\s\S]*?<\/final>/,
                validateXML: false,
                output: 'silent'
            });
            assert.equal(result, '<final>quota bucket selection</final>');
        }

        const quotaLine = loggedLines.find(line => /\[codex quota turn \d+\]/.test(line));
        assert.ok(quotaLine);
        assert.match(quotaLine, /\[codex quota turn \d+\] codex \{/);
        assert.doesNotMatch(quotaLine, /GPT-5\.3-Codex-Spark/);
        assert.equal(appendedEntries.length, 1);
        assert.equal(appendedEntries[0].entry?.metadata?.codexQuotaSnapshot?.limitId, 'codex');
        assert.match(appendedEntries[0].entry?.summaryItems?.[0]?.text || '', /^Primary: 80% remaining; resets \d{1,2}:\d{2} [AP]M$/);
        assert.match(appendedEntries[0].entry?.summaryItems?.[1]?.text || '', /^Secondary: 77% remaining; resets [A-Z][a-z]{2} \d{1,2}(st|nd|rd|th) at \d{1,2}:\d{2} [AP]M$/);
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

test('LLMClient.chatCompletion streams Codex preview text through prompt_progress when available', { concurrency: false }, async () => {
    const originalBridgeChatCompletion = CodexBridgeClient.chatCompletion;
    const originalConfig = Globals.config;
    const originalRealtimeHub = Globals.realtimeHub;
    const emittedEvents = [];

    Globals.config = {
        ai: buildCodexAiConfig({
            codex_bridge: {
                command: 'codex',
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
    CodexBridgeClient.chatCompletion = async ({ onStdoutChunk, onStdoutEvent }) => {
        onStdoutChunk?.('{"type":"thread.started","thread_id":"progress-thread-1"}\n');
        onStdoutEvent?.({ type: 'thread.started', thread_id: 'progress-thread-1' });
        onStdoutChunk?.('{"type":"turn.started"}\n');
        onStdoutEvent?.({ type: 'turn.started' });
        onStdoutChunk?.('{"type":"agent_message_delta","delta":"<final>codex "}\n');
        onStdoutEvent?.({ type: 'agent_message_delta', delta: '<final>codex ' });
        onStdoutChunk?.('{"type":"item.agentMessage.delta","delta":"progress "}\n');
        onStdoutEvent?.({ type: 'item.agentMessage.delta', delta: 'progress ' });
        onStdoutChunk?.('{"type":"item.completed","item":{"type":"agent_message","text":"<final>codex progress ok</final>"}}\n');
        onStdoutEvent?.({ type: 'item.completed', item: { type: 'agent_message', text: '<final>codex progress ok</final>' } });
        onStdoutChunk?.('{"type":"turn.completed"}\n');
        onStdoutEvent?.({ type: 'turn.completed' });
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: { backend: 'codex_cli_bridge' },
            data: {
                id: 'bridge-response-progress',
                object: 'chat.completion',
                created: 1,
                model: 'gpt-5.4-mini',
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '<final>codex progress ok</final>'
                        }
                    }
                ]
            }
        };
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [
                { role: 'system', content: 'System instructions for progress test.' },
                { role: 'user', content: 'Show prompt progress in the popup.' }
            ],
            metadataLabel: 'codex_progress_popup_test',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'stdout'
        });

        assert.equal(result, '<final>codex progress ok</final>');
        await LLMClient.waitForPromptDrain({ timeoutMs: 3000, pollIntervalMs: 25 });

        const promptProgressEvents = emittedEvents.filter(event => event.type === 'prompt_progress');
        const activeProgressEvents = promptProgressEvents.filter(event => Array.isArray(event.payload?.entries) && event.payload.entries.length > 0);
        assert.ok(activeProgressEvents.length > 0);

        const textPreviewEntry = activeProgressEvents
            .map(event => event.payload.entries[0])
            .find(entry => typeof entry?.previewText === 'string' && entry.previewText.includes('<final>codex progress '));
        assert.ok(textPreviewEntry);
        assert.equal(textPreviewEntry.model, 'gpt-5.4-mini');
        assert.ok(Number.isFinite(Number(textPreviewEntry.bytes)));
        assert.match(textPreviewEntry.promptText || '', /Show prompt progress in the popup\./);
        assert.equal(typeof textPreviewEntry.previewText, 'string');
        assert.equal(textPreviewEntry.previewText.includes('Codex thread started'), false);
        assert.ok(emittedEvents.some(event => event.type === 'prompt_progress_cleared'));
    } finally {
        CodexBridgeClient.chatCompletion = originalBridgeChatCompletion;
        Globals.config = originalConfig;
        Globals.realtimeHub = originalRealtimeHub;
    }
});

test('LLMClient.chatCompletion throttles high-frequency prompt_progress byte updates', { concurrency: false }, async () => {
    const originalBridgeChatCompletion = CodexBridgeClient.chatCompletion;
    const originalConfig = Globals.config;
    const originalRealtimeHub = Globals.realtimeHub;
    const emittedEvents = [];

    Globals.config = {
        ai: buildCodexAiConfig({
            codex_bridge: {
                command: 'codex',
                home: './tmp/test-codex-home-progress-throttle',
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
            emittedEvents.push({ type, payload, ts: Date.now() });
        }
    };
    CodexBridgeClient.chatCompletion = async ({ onStdoutChunk, onStdoutEvent }) => {
        for (let index = 0; index < 12; index += 1) {
            const delta = `chunk-${index} `;
            onStdoutChunk?.(JSON.stringify({ type: 'agent_message_delta', delta }) + '\n');
            onStdoutEvent?.({ type: 'agent_message_delta', delta });
        }
        await new Promise(resolve => setTimeout(resolve, 650));
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: { backend: 'codex_cli_bridge' },
            data: {
                id: 'bridge-response-progress-throttle',
                object: 'chat.completion',
                created: 1,
                model: 'gpt-5.4-mini',
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '<final>throttled progress ok</final>'
                        }
                    }
                ]
            }
        };
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [
                { role: 'system', content: 'System instructions for progress throttle test.' },
                { role: 'user', content: 'Throttle prompt progress updates.' }
            ],
            metadataLabel: 'codex_progress_throttle_test',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'stdout'
        });

        assert.equal(result, '<final>throttled progress ok</final>');
        await LLMClient.waitForPromptDrain({ timeoutMs: 3000, pollIntervalMs: 25 });

        const activeProgressEvents = emittedEvents
            .filter(event => event.type === 'prompt_progress')
            .filter(event => Array.isArray(event.payload?.entries) && event.payload.entries.length > 0);
        assert.ok(
            activeProgressEvents.length <= 2,
            `expected throttled active prompt_progress events, got ${activeProgressEvents.length}`,
        );
        if (activeProgressEvents.length > 1) {
            assert.ok(
                activeProgressEvents[1].ts - activeProgressEvents[0].ts >= 450,
                'active prompt_progress events should be separated by roughly the 500ms throttle interval',
            );
        }
        const latestPreview = activeProgressEvents.at(-1)?.payload?.entries?.[0]?.previewText || '';
        assert.match(latestPreview, /chunk-11/);
    } finally {
        CodexBridgeClient.chatCompletion = originalBridgeChatCompletion;
        Globals.config = originalConfig;
        Globals.realtimeHub = originalRealtimeHub;
    }
});
