const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('js-yaml');
const axios = require('axios');

const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function buildAiConfig(overrides = {}) {
    return {
        backend: 'openai_compatible',
        endpoint: 'https://example.invalid/v1/chat/completions',
        apiKey: 'test-key',
        model: 'test-model',
        stream: false,
        retryAttempts: 0,
        max_concurrent_requests: 1,
        supress_seed: true,
        prefill: null,
        ...overrides
    };
}

function buildCodexAiConfig(overrides = {}) {
    return {
        backend: 'codex_cli_bridge',
        model: 'test-model',
        max_concurrent_requests: 1,
        codex_bridge: {
            command: 'codex',
            home: './tmp/codex-bridge-home',
            session_mode: 'fresh',
            session_id: '',
            sandbox: 'read-only',
            reasoning_effort: '',
            idle_timeout_ms: 30000
        },
        ...overrides
    };
}

async function captureChatCompletion({
    aiConfig,
    configOverrides = {},
    requestOptions = {},
    responseContent = 'body'
} = {}) {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    const tempBaseDir = fs.mkdtempSync(path.join(tmpRoot, 'llmclient-prefill-'));
    let capturedPayload = null;

    axios.post = async (_endpoint, payload) => {
        capturedPayload = JSON.parse(JSON.stringify(payload));
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'prefill-test-response',
                object: 'chat.completion',
                created: 1,
                model: payload.model,
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                            role: 'assistant',
                            content: responseContent
                        }
                    }
                ]
            }
        };
    };
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ai: aiConfig || buildAiConfig(),
        ...configOverrides
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Prefill test request.' }],
            metadataLabel: 'prefill_test',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            ...requestOptions
        });
        return { result, payload: capturedPayload };
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
}

test('config.default.yaml sets ai.prefill to null', () => {
    const configPath = path.resolve(__dirname, '..', 'config.default.yaml');
    const config = load(fs.readFileSync(configPath, 'utf8'));

    assert.equal(config.ai.prefill, null);
});

test('LLMClient.chatCompletion appends configured prefill and returns it with the continuation', { concurrency: false }, async () => {
    const { result, payload } = await captureChatCompletion({
        aiConfig: buildAiConfig({ prefill: '<final>' }),
        responseContent: 'body</final>'
    });

    assert.equal(result, '<final>body</final>');
    assert.equal(payload.messages.length, 2);
    assert.deepEqual(payload.messages[0], { role: 'user', content: 'Prefill test request.' });
    assert.deepEqual(payload.messages[1], { role: 'assistant', content: '<final>' });
});

test('LLMClient.chatCompletion does not duplicate a provider-echoed prefill', { concurrency: false }, async () => {
    const { result } = await captureChatCompletion({
        aiConfig: buildAiConfig({ prefill: '<final>' }),
        responseContent: '<final>body</final>'
    });

    assert.equal(result, '<final>body</final>');
});

test('LLMClient.chatCompletion per-call prefill overrides or suppresses configured prefill', { concurrency: false }, async () => {
    const overrideResult = await captureChatCompletion({
        aiConfig: buildAiConfig({ prefill: 'Global: ' }),
        requestOptions: { prefill: 'Call: ' },
        responseContent: 'body'
    });

    assert.equal(overrideResult.result, 'Call: body');
    assert.equal(overrideResult.payload.messages.at(-1).role, 'assistant');
    assert.equal(overrideResult.payload.messages.at(-1).content, 'Call: ');

    const suppressedResult = await captureChatCompletion({
        aiConfig: buildAiConfig({ prefill: 'Global: ' }),
        requestOptions: { prefill: null },
        responseContent: 'body'
    });

    assert.equal(suppressedResult.result, 'body');
    assert.equal(suppressedResult.payload.messages.length, 1);
    assert.equal(suppressedResult.payload.messages[0].role, 'user');
});

test('LLMClient.chatCompletion assistantResponseSeed aliases per-call prefill', { concurrency: false }, async () => {
    const { result, payload } = await captureChatCompletion({
        aiConfig: buildAiConfig({ prefill: 'Global: ' }),
        requestOptions: { assistantResponseSeed: 'Seed: ' },
        responseContent: 'body'
    });

    assert.equal(result, 'Seed: body');
    assert.equal(payload.messages.at(-1).role, 'assistant');
    assert.equal(payload.messages.at(-1).content, 'Seed: ');
});

test('LLMClient.chatCompletion applies ai_model_overrides prefill values', { concurrency: false }, async () => {
    const applied = await captureChatCompletion({
        aiConfig: buildAiConfig({ prefill: null }),
        configOverrides: {
            ai_model_overrides: {
                quest_prefill: {
                    prompts: ['quest_check'],
                    prefill: '<quest>'
                }
            }
        },
        requestOptions: { metadataLabel: 'quest_check' },
        responseContent: 'body</quest>'
    });

    assert.equal(applied.result, '<quest>body</quest>');
    assert.equal(applied.payload.messages.at(-1).content, '<quest>');

    const cleared = await captureChatCompletion({
        aiConfig: buildAiConfig({ prefill: '<global>' }),
        configOverrides: {
            ai_model_overrides: {
                quest_prefill_clear: {
                    prompts: ['quest_check'],
                    prefill: null
                }
            }
        },
        requestOptions: { metadataLabel: 'quest_check' },
        responseContent: 'body'
    });

    assert.equal(cleared.result, 'body');
    assert.equal(cleared.payload.messages.length, 1);
});

test('LLMClient.chatCompletion rejects prefill with tool-call request payloads', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(tmpRoot, 'llmclient-prefill-tools-'));
    Globals.config = {
        ai: buildAiConfig({ prefill: '<final>' })
    };

    try {
        await assert.rejects(
            () => LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Call a tool.' }],
                metadataLabel: 'prefill_tool_test',
                validateXML: false,
                output: 'silent',
                retryAttempts: 0,
                additionalPayload: {
                    tools: [
                        {
                            type: 'function',
                            function: {
                                name: 'noop',
                                parameters: { type: 'object', properties: {} }
                            }
                        }
                    ],
                    tool_choice: 'auto'
                }
            }),
            /prefill cannot be used with tool-call request payloads/i
        );
    } finally {
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
});

test('LLMClient rejects prefill for Codex bridge configuration', { concurrency: false }, async () => {
    const errors = LLMClient.getConfigurationErrors(buildCodexAiConfig({
        prefill: '<final>'
    }));
    assert.match(errors.join('\n'), /prefill is not supported with codex_cli_bridge/i);

    const originalConfig = Globals.config;
    Globals.config = {
        ai: buildCodexAiConfig({ prefill: '<final>' })
    };
    try {
        await assert.rejects(
            () => LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Codex prefill test.' }],
                metadataLabel: 'codex_prefill_test',
                validateXML: false,
                output: 'silent',
                retryAttempts: 0
            }),
            /prefill is only supported by the openai_compatible backend/i
        );
    } finally {
        Globals.config = originalConfig;
    }
});

test('LLMClient configuration rejects non-string prefill values', () => {
    const errors = LLMClient.getConfigurationErrors(buildAiConfig({
        prefill: 3
    }));

    assert.match(errors.join('\n'), /prefill must be a string or null/i);
});
