const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

test('LLMClient.chatCompletion uses forceOutput string without network call', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let onResponsePayload = null;
    let capturedRequest = null;
    let capturedResponse = null;

    axios.post = async () => {
        throw new Error('axios.post should not be called when forceOutput is provided.');
    };
    Globals.config = null;

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Run deterministic test.' }],
            forceOutput: '<final>Deterministic response</final>',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            captureRequestPayload: (payload) => {
                capturedRequest = payload;
            },
            captureResponsePayload: (payload) => {
                capturedResponse = payload;
            },
            onResponse: (response) => {
                onResponsePayload = response;
            }
        });

        assert.equal(result, '<final>Deterministic response</final>');
        assert.ok(capturedRequest && capturedRequest.stream === false);
        assert.equal(capturedRequest.forceOutput, '<final>Deterministic response</final>');
        assert.ok(capturedResponse?.choices?.[0]?.message?.content === '<final>Deterministic response</final>');
        assert.ok(onResponsePayload?.data?.choices?.[0]?.message?.content === '<final>Deterministic response</final>');
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion resolves forced outputs from fixture by metadataLabel', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalFixtureEnv = process.env.LLM_FORCE_OUTPUTS_FILE;
    const fixturePath = path.join(
        os.tmpdir(),
        `llm_force_outputs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`
    );
    const fixture = {
        strict: true,
        byMetadataLabel: {
            test_label: [
                '<final>Fixture response 1</final>',
                '<final>Fixture response 2</final>'
            ]
        }
    };

    let firstCapturedRequest = null;
    let secondCapturedRequest = null;
    axios.post = async () => {
        throw new Error('axios.post should not be called when forced-output fixture is provided.');
    };
    Globals.config = null;
    process.env.LLM_FORCE_OUTPUTS_FILE = fixturePath;
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    LLMClient.resetForcedOutputState();

    try {
        const firstResult = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Fixture test turn one.' }],
            metadataLabel: 'Test Label',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            captureRequestPayload: (payload) => {
                firstCapturedRequest = payload;
            }
        });
        const secondResult = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Fixture test turn two.' }],
            metadataLabel: 'Test Label',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            captureRequestPayload: (payload) => {
                secondCapturedRequest = payload;
            }
        });

        assert.equal(firstResult, '<final>Fixture response 1</final>');
        assert.equal(secondResult, '<final>Fixture response 2</final>');
        assert.equal(firstCapturedRequest?.forceOutput, '<final>Fixture response 1</final>');
        assert.equal(secondCapturedRequest?.forceOutput, '<final>Fixture response 2</final>');
    } finally {
        if (fs.existsSync(fixturePath)) {
            fs.rmSync(fixturePath, { force: true });
        }
        if (originalFixtureEnv === undefined) {
            delete process.env.LLM_FORCE_OUTPUTS_FILE;
        } else {
            process.env.LLM_FORCE_OUTPUTS_FILE = originalFixtureEnv;
        }
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        LLMClient.resetForcedOutputState();
    }
});

test('LLMClient.chatCompletion throws when strict forced-output fixture bucket is exhausted', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalFixtureEnv = process.env.LLM_FORCE_OUTPUTS_FILE;
    const fixturePath = path.join(
        os.tmpdir(),
        `llm_force_outputs_exhaust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`
    );
    const fixture = {
        strict: true,
        byMetadataLabel: {
            only_once: ['<final>Single response</final>']
        }
    };

    axios.post = async () => {
        throw new Error('axios.post should not be called when forced-output fixture is provided.');
    };
    Globals.config = null;
    process.env.LLM_FORCE_OUTPUTS_FILE = fixturePath;
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    LLMClient.resetForcedOutputState();

    try {
        const firstResult = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'First call uses only fixture entry.' }],
            metadataLabel: 'only_once',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        });
        assert.equal(firstResult, '<final>Single response</final>');

        await assert.rejects(
            () => LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Second call should fail when bucket is exhausted.' }],
                metadataLabel: 'only_once',
                requiredRegex: /<final>[\s\S]*?<\/final>/,
                validateXML: false,
                output: 'silent',
                retryAttempts: 0
            }),
            /Forced output bucket "only_once" is exhausted/
        );
    } finally {
        if (fs.existsSync(fixturePath)) {
            fs.rmSync(fixturePath, { force: true });
        }
        if (originalFixtureEnv === undefined) {
            delete process.env.LLM_FORCE_OUTPUTS_FILE;
        } else {
            process.env.LLM_FORCE_OUTPUTS_FILE = originalFixtureEnv;
        }
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        LLMClient.resetForcedOutputState();
    }
});

test('LLMClient.chatCompletion resolves prompt_<label> forced-output buckets', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalFixtureEnv = process.env.LLM_FORCE_OUTPUTS_FILE;
    const fixturePath = path.join(
        os.tmpdir(),
        `llm_force_outputs_prompt_prefix_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`
    );
    const fixture = {
        strict: true,
        byMetadataLabel: {
            prompt_quest_check: ['<quests></quests>']
        }
    };

    axios.post = async () => {
        throw new Error('axios.post should not be called when forced-output fixture is provided.');
    };
    Globals.config = null;
    process.env.LLM_FORCE_OUTPUTS_FILE = fixturePath;
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    LLMClient.resetForcedOutputState();

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Quest check fixture fallback test.' }],
            metadataLabel: 'quest_check',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        });
        assert.equal(result, '<quests></quests>');
    } finally {
        if (fs.existsSync(fixturePath)) {
            fs.rmSync(fixturePath, { force: true });
        }
        if (originalFixtureEnv === undefined) {
            delete process.env.LLM_FORCE_OUTPUTS_FILE;
        } else {
            process.env.LLM_FORCE_OUTPUTS_FILE = originalFixtureEnv;
        }
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        LLMClient.resetForcedOutputState();
    }
});

test('LLMClient.chatCompletion resolves <label>_group_N buckets in order', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalFixtureEnv = process.env.LLM_FORCE_OUTPUTS_FILE;
    const fixturePath = path.join(
        os.tmpdir(),
        `llm_force_outputs_grouped_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`
    );
    const fixture = {
        strict: true,
        byMetadataLabel: {
            event_checks_group_2: ['group-2'],
            event_checks_group_1: ['group-1']
        }
    };

    axios.post = async () => {
        throw new Error('axios.post should not be called when forced-output fixture is provided.');
    };
    Globals.config = null;
    process.env.LLM_FORCE_OUTPUTS_FILE = fixturePath;
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    LLMClient.resetForcedOutputState();

    try {
        const first = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Event checks group 1 request.' }],
            metadataLabel: 'event_checks',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        });
        const second = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Event checks group 2 request.' }],
            metadataLabel: 'event_checks',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        });

        assert.equal(first, 'group-1');
        assert.equal(second, 'group-2');
    } finally {
        if (fs.existsSync(fixturePath)) {
            fs.rmSync(fixturePath, { force: true });
        }
        if (originalFixtureEnv === undefined) {
            delete process.env.LLM_FORCE_OUTPUTS_FILE;
        } else {
            process.env.LLM_FORCE_OUTPUTS_FILE = originalFixtureEnv;
        }
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        LLMClient.resetForcedOutputState();
    }
});

test('LLMClient.chatCompletion prepends cachebuster to the final user message only', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const messages = [
        { role: 'system', content: 'System instructions.' },
        { role: 'user', content: 'Earlier user message.' },
        { role: 'assistant', content: 'Intermediate assistant reply.' },
        { role: 'user', content: 'Main prompt body.' }
    ];
    const originalMessagesSnapshot = JSON.stringify(messages);
    let capturedRequest = null;

    axios.post = async (_endpoint, payload) => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: {
            id: 'mock_response',
            model: payload.model,
            choices: [
                {
                    message: { content: 'Cachebuster response.' },
                    finish_reason: 'stop'
                }
            ],
            usage: { total_tokens: 12 }
        }
    });
    Globals.config = {
        ai: {
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'mock-model',
            stream: false,
            cachebuster: true,
            retryAttempts: 0,
            supress_seed: true
        }
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            captureRequestPayload: (payload) => {
                capturedRequest = payload;
            }
        });

        assert.equal(result, 'Cachebuster response.');
        assert.ok(capturedRequest);
        assert.equal(JSON.stringify(messages), originalMessagesSnapshot);
        assert.equal(capturedRequest.messages[0].content, 'System instructions.');
        assert.equal(capturedRequest.messages[1].content, 'Earlier user message.');
        assert.equal(capturedRequest.messages[2].content, 'Intermediate assistant reply.');
        assert.match(
            capturedRequest.messages[3].content,
            /^\[cachebuster:[0-9a-f-]{36}\]\n\nMain prompt body\.$/
        );
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion supports forceOutput tool calls and skips regex validation for tool rounds', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let onResponsePayload = null;

    axios.post = async () => {
        throw new Error('axios.post should not be called when forceOutput is provided.');
    };
    Globals.config = null;

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Find Bob.' }],
            forceOutput: {
                model: 'mock-model',
                finishReason: 'tool_calls',
                message: {
                    content: '',
                    tool_calls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'locateNpcs',
                                arguments: '{"query":"Bob"}'
                            }
                        }
                    ]
                }
            },
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            output: 'silent',
            retryAttempts: 0,
            onResponse: (response) => {
                onResponsePayload = response;
            }
        });

        assert.equal(result, '');
        assert.ok(onResponsePayload);
        assert.equal(onResponsePayload.data.model, 'mock-model');
        assert.equal(onResponsePayload.data.choices[0].finish_reason, 'tool_calls');
        assert.equal(onResponsePayload.data.choices[0].message.tool_calls.length, 1);
        assert.equal(onResponsePayload.data.choices[0].message.tool_calls[0].function.name, 'locateNpcs');
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion treats streamed message.content chunks as snapshots instead of duplicating prefixes', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let capturedRequest = null;
    let capturedResponse = null;

    axios.post = async (_endpoint, payload) => {
        const stream = new PassThrough();
        process.nextTick(() => {
            stream.write(`data: ${JSON.stringify({
                choices: [
                    {
                        message: {
                            content: 'The quick brown fox'
                        }
                    }
                ]
            })}\n\n`);
            stream.write(`data: ${JSON.stringify({
                choices: [
                    {
                        message: {
                            content: 'The quick brown fox jumped over the lazy dog.'
                        },
                        finish_reason: 'stop'
                    }
                ],
                usage: {
                    total_tokens: 17
                }
            })}\n\n`);
            stream.write('data: [DONE]\n\n');
            stream.end();
        });

        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: stream
        };
    };

    Globals.config = {
        ai: {
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'mock-model',
            stream: true,
            retryAttempts: 0,
            supress_seed: true
        }
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Stream a response.' }],
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            captureRequestPayload: (payload) => {
                capturedRequest = payload;
            },
            captureResponsePayload: (payload) => {
                capturedResponse = payload;
            }
        });

        assert.equal(result, 'The quick brown fox jumped over the lazy dog.');
        assert.equal(capturedRequest?.stream, true);
        assert.equal(
            capturedResponse?.choices?.[0]?.message?.content,
            'The quick brown fox jumped over the lazy dog.'
        );
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion treats cumulative streamed delta.content chunks as snapshots instead of duplicating prefixes', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let capturedResponse = null;

    axios.post = async () => {
        const stream = new PassThrough();
        process.nextTick(() => {
            stream.write(`data: ${JSON.stringify({
                choices: [
                    {
                        delta: {
                            content: 'The quick brown fox'
                        }
                    }
                ]
            })}\n\n`);
            stream.write(`data: ${JSON.stringify({
                choices: [
                    {
                        delta: {
                            content: 'The quick brown fox jumped over the lazy dog.'
                        },
                        finish_reason: 'stop'
                    }
                ],
                usage: {
                    total_tokens: 17
                }
            })}\n\n`);
            stream.write('data: [DONE]\n\n');
            stream.end();
        });

        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: stream
        };
    };

    Globals.config = {
        ai: {
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'mock-model',
            stream: true,
            retryAttempts: 0,
            supress_seed: true
        }
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Stream a response.' }],
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            captureResponsePayload: (payload) => {
                capturedResponse = payload;
            }
        });

        assert.equal(result, 'The quick brown fox jumped over the lazy dog.');
        assert.equal(
            capturedResponse?.choices?.[0]?.message?.content,
            'The quick brown fox jumped over the lazy dog.'
        );
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});
