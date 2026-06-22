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

async function captureChatCompletionPayload({
    aiConfig = buildAiConfig(),
    configOverrides = {},
    messages = [{ role: 'user', content: 'System append test request.' }],
    requestOptions = {}
} = {}) {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    const tempBaseDir = fs.mkdtempSync(path.join(tmpRoot, 'llmclient-sysprompt-'));
    let capturedPayload = null;

    axios.post = async (_endpoint, payload) => {
        capturedPayload = JSON.parse(JSON.stringify(payload));
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'sysprompt-append-test-response',
                object: 'chat.completion',
                created: 1,
                model: payload.model,
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '<final>ok</final>'
                        }
                    }
                ]
            }
        };
    };
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ai: aiConfig,
        ...configOverrides
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages,
            metadataLabel: 'sysprompt_append_test',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            ...requestOptions
        });
        assert.equal(result, '<final>ok</final>');
        return capturedPayload;
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
}

test('config.default.yaml defines ai.sysprompt_append as blank by default', () => {
    const configPath = path.resolve(__dirname, '..', 'config.default.yaml');
    const config = load(fs.readFileSync(configPath, 'utf8'));

    assert.equal(config.ai.sysprompt_append, '');
});

test('config page exposes ai.sysprompt_append textarea', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'views', 'config.njk'), 'utf8');

    assert.match(source, /id="ai-syspromptAppend"/);
    assert.match(source, /name="ai\.sysprompt_append::string"/);
});

test('LLMClient.chatCompletion appends configured sysprompt_append as an outbound system message', { concurrency: false }, async () => {
    const callerMessages = [
        { role: 'system', content: 'Base system instructions.' },
        { role: 'user', content: 'Generate text.' }
    ];
    const payload = await captureChatCompletionPayload({
        aiConfig: buildAiConfig({
            sysprompt_append: 'Provider-specific system addition.'
        }),
        messages: callerMessages
    });

    assert.deepEqual(payload.messages, [
        { role: 'system', content: 'Base system instructions.' },
        { role: 'system', content: 'Provider-specific system addition.' },
        { role: 'user', content: 'Generate text.' }
    ]);
    assert.deepEqual(callerMessages, [
        { role: 'system', content: 'Base system instructions.' },
        { role: 'user', content: 'Generate text.' }
    ]);
});

test('LLMClient.chatCompletion inserts sysprompt_append before user messages when no system message exists', { concurrency: false }, async () => {
    const payload = await captureChatCompletionPayload({
        aiConfig: buildAiConfig({
            sysprompt_append: 'Provider-specific system addition.'
        })
    });

    assert.deepEqual(payload.messages, [
        { role: 'system', content: 'Provider-specific system addition.' },
        { role: 'user', content: 'System append test request.' }
    ]);
});

test('LLMClient.chatCompletion applies and clears ai_model_overrides sysprompt_append values', { concurrency: false }, async () => {
    const appliedPayload = await captureChatCompletionPayload({
        aiConfig: buildAiConfig({
            sysprompt_append: ''
        }),
        configOverrides: {
            ai_model_overrides: {
                quest_system_append: {
                    prompts: ['quest_check'],
                    sysprompt_append: 'Quest-check model-specific instructions.'
                }
            }
        },
        requestOptions: {
            metadataLabel: 'quest_check'
        }
    });

    assert.deepEqual(appliedPayload.messages, [
        { role: 'system', content: 'Quest-check model-specific instructions.' },
        { role: 'user', content: 'System append test request.' }
    ]);

    const clearedPayload = await captureChatCompletionPayload({
        aiConfig: buildAiConfig({
            sysprompt_append: 'Global system append.'
        }),
        configOverrides: {
            ai_model_overrides: {
                quest_system_append_clear: {
                    prompts: ['quest_check'],
                    sysprompt_append: null
                }
            }
        },
        requestOptions: {
            metadataLabel: 'quest_check'
        }
    });

    assert.deepEqual(clearedPayload.messages, [
        { role: 'user', content: 'System append test request.' }
    ]);
});

test('LLMClient configuration rejects non-string sysprompt_append values', () => {
    const openAiErrors = LLMClient.getConfigurationErrors(buildAiConfig({
        sysprompt_append: 3
    }));
    assert.match(openAiErrors.join('\n'), /sysprompt_append must be a string or null/i);

    const codexErrors = LLMClient.getConfigurationErrors(buildCodexAiConfig({
        sysprompt_append: 3
    }));
    assert.match(codexErrors.join('\n'), /sysprompt_append must be a string or null/i);
});

test('LLMClient.chatCompletion rejects non-string override sysprompt_append values', { concurrency: false }, async () => {
    await assert.rejects(
        () => captureChatCompletionPayload({
            configOverrides: {
                ai_model_overrides: {
                    invalid_system_append: {
                        prompts: ['quest_check'],
                        sysprompt_append: 3
                    }
                }
            },
            requestOptions: {
                metadataLabel: 'quest_check'
            }
        }),
        /sysprompt_append must be a string or null/i
    );
});
