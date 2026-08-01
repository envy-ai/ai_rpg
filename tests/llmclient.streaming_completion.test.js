const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const { load } = require('js-yaml');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function makeTempBaseDir(label) {
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    return fs.mkdtempSync(path.join(tmpRoot, `${label}-`));
}

function installStreamingConfig(baseDir) {
    Globals.baseDir = baseDir;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: true,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            suppress_seed: true,
            stream_start_timeout: 5,
            stream_continue_timeout: 5
        }
    };
}

test('Q35 config requests connection close for streamed LLM transport', () => {
    const configPath = path.resolve(__dirname, '..', 'config.yaml.qwen35B-A3B');
    const config = load(fs.readFileSync(configPath, 'utf8'));

    assert.equal(config.ai.stream, true);
    assert.equal(config.ai.headers.Connection, 'close');
});

test('OpenAI-compatible streaming waits for transport end after DONE', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const baseDir = makeTempBaseDir('llm-stream-done');
    let responseStream = null;
    let capturedResponse = null;
    let completionSettled = false;
    let signalDoneEmitted = null;
    const doneEmitted = new Promise(resolve => {
        signalDoneEmitted = resolve;
    });
    installStreamingConfig(baseDir);
    LLMClient.resetPromptOutputCharacterStatsForTests();

    axios.post = async () => {
        responseStream = new EventEmitter();
        setImmediate(() => {
            responseStream.emit('data', 'data: {"choices":[{"delta":{"content":"fast"}}]}\n\n');
            responseStream.emit('data', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11}}\n\nda');
            responseStream.emit('data', 'ta: [DO');
            responseStream.emit('data', 'NE]\n\n');
            signalDoneEmitted();
        });
        return {
            status: 200,
            statusText: 'OK',
            data: responseStream
        };
    };

    try {
        const completionPromise = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Wait for transport completion.' }],
            metadataLabel: 'stream_done_test',
            validateXML: false,
            retryAttempts: 0,
            output: 'silent',
            onResponse: response => {
                capturedResponse = response;
            }
        }).finally(() => {
            completionSettled = true;
        });

        await doneEmitted;
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(completionSettled, false);

        responseStream.emit('end');
        const result = await completionPromise;

        assert.equal(result, 'fast');
        assert.equal(capturedResponse?.data?.choices?.[0]?.finish_reason, 'stop');
        assert.equal(capturedResponse?.data?.usage?.total_tokens, 11);
    } finally {
        responseStream?.removeAllListeners();
        axios.post = originalAxiosPost;
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});

test('OpenAI-compatible streaming still resolves on transport end when DONE is omitted', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const baseDir = makeTempBaseDir('llm-stream-end');
    installStreamingConfig(baseDir);
    LLMClient.resetPromptOutputCharacterStatsForTests();

    axios.post = async () => {
        const responseStream = new Readable({ read() {} });
        process.nextTick(() => {
            responseStream.push('data: {"choices":[{"delta":{"content":"fallback"},"finish_reason":"stop"}]}\n\n');
            responseStream.push(null);
        });
        return {
            status: 200,
            statusText: 'OK',
            data: responseStream
        };
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Use the end fallback.' }],
            metadataLabel: 'stream_end_test',
            validateXML: false,
            retryAttempts: 0,
            output: 'silent'
        });

        assert.equal(result, 'fallback');
    } finally {
        axios.post = originalAxiosPost;
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});
