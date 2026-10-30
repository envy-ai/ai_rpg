const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function completionResponse(payload, { content = '', toolCalls = [] } = {}) {
    return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: {
            id: `quest-validation-${Math.random().toString(36).slice(2)}`,
            model: payload.model,
            choices: [{
                index: 0,
                finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
                message: {
                    role: 'assistant',
                    content,
                    ...(toolCalls.length ? { tool_calls: toolCalls } : {})
                }
            }],
            usage: { total_tokens: 20 }
        }
    };
}

test('LLMClient feeds rejected tool calls and domain validation errors back within one fixed wire-policy budget', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalRegistry = Globals.modExtensionRegistry;
    const artifactRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(artifactRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(artifactRoot, 'quest-validation-retry-'));
    const payloads = [];
    const rejectedToolCalls = [{
        id: 'call-quest-tool',
        type: 'function',
        function: { name: 'createQuest', arguments: '{"summary":"unrequested"}' }
    }];
    const domainError = 'Each quest reward <item> must contain non-empty <name> and <description> tags.';
    const responseCallbacks = [];

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 2,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };
    Globals.modExtensionRegistry = null;

    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        if (payloads.length === 1) {
            return completionResponse(payload, { toolCalls: rejectedToolCalls });
        }
        if (payloads.length === 2) {
            return completionResponse(payload, {
                content: '<quest><name>Broken Offer</name><objectives><objective><description>Help.</description></objective></objectives><rewards><item><description>Missing name.</description></item></rewards></quest>'
            });
        }
        return completionResponse(payload, {
            content: '<quest><name>Quiet Passage</name><description>Find the hidden path.</description><objectives><objective><description>Locate the path.</description></objective></objectives><rewards><item/><item><name>Moonlit Compass</name><description>A compass that points toward the old road.</description></item></rewards></quest>'
        });
    };

    const messages = [
        { role: 'system', content: 'Generate a quest.' },
        {
            role: 'user',
            content: `Shared game context${LLMClient.getBaseContextEndMarker()}Generate a quest for the player.`
        }
    ];

    try {
        const result = await LLMClient.chatCompletion({
            messages,
            metadataLabel: 'quest_generate',
            expectedXmlRootTag: 'quest',
            validateXML: false,
            responseValidationRetryFeedback: true,
            responseValidator(responseText) {
                if (responseText.includes('Broken Offer')) throw new Error(domainError);
            },
            onResponse: response => responseCallbacks.push(response),
            preserveBaseContextToolDefinitions: true,
            allowToolCalls: false,
            throwOnError: true,
            stream: false,
            retryAttempts: 2,
            waitAfterError: 0,
            output: 'silent'
        });

        assert.match(result, /Quiet Passage/);
        assert.equal(payloads.length, 3, 'tool policy and domain errors consume the configured two retries');
        assert.equal(responseCallbacks.length, 2, 'the rejected tool-call response is stopped before response handlers');
        assert.equal(responseCallbacks[0].data.choices[0].message.content.includes('Broken Offer'), true);
        assert.equal(responseCallbacks[0].data.choices[0].message.tool_calls, undefined);
        assert.match(responseCallbacks[1].data.choices[0].message.content, /Quiet Passage/);
        assert.equal(payloads[0].tools, undefined, 'disabled calls omit native definitions from the wire');
        assert.equal(payloads[0].tool_choice, 'none');

        for (const payload of payloads.slice(1)) {
            assert.equal(payload.tools, undefined, 'corrections retain disabled tool permissions');
            assert.equal(payload.tool_choice, 'none');
            assert.deepEqual(payload.messages[0], { role: 'system', content: 'Generate a quest.' });
            assert.equal(payload.messages[1].role, 'user');
            assert.match(payload.messages[1].content, /Shared game context/);
            assert.equal(payload.messages[2].role, 'user');
            assert.match(payload.messages[2].content, /Generate a quest for the player\./);
        }

        const toolCorrection = payloads[1].messages.slice(-2);
        assert.equal(toolCorrection[0].role, 'assistant');
        assert.match(toolCorrection[0].content, /attempted tool calls were rejected and were NOT EXECUTED/i);
        assert.match(toolCorrection[0].content, /createQuest/);
        assert.match(toolCorrection[1].content, /Do not make any tool calls/i);

        const domainCorrection = payloads[2].messages.slice(-2);
        assert.match(domainCorrection[0].content, /Missing name/);
        assert.match(domainCorrection[1].content, new RegExp(domainError.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.equal(payloads[2].messages.at(-2).role, 'assistant');
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        Globals.modExtensionRegistry = originalRegistry;
    }
});

test('LLMClient throws the last response-validation error when the bounded correction budget is exhausted', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const payloads = [];
    const artifactRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(artifactRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(artifactRoot, 'quest-validation-exhaustion-'));
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 1,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        return completionResponse(payload, { content: '<quest><name>Still broken</name></quest>' });
    };

    try {
        await assert.rejects(LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Generate a quest.' }],
            metadataLabel: 'quest_generate',
            expectedXmlRootTag: 'quest',
            validateXML: false,
            responseValidationRetryFeedback: true,
            responseValidator() { throw new Error('Quest objective list must be non-empty.'); },
            throwOnError: true,
            stream: false,
            retryAttempts: 1,
            waitAfterError: 0,
            output: 'silent'
        }), /Quest objective list must be non-empty\./);
        assert.equal(payloads.length, 2);
        assert.equal(payloads[1].messages.at(-2).content, '<quest><name>Still broken</name></quest>');
        assert.match(payloads[1].messages.at(-1).content, /Quest objective list must be non-empty\./);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
});

test('XML completion corrections add DONE only when the expected response root is actually unfinished', { concurrency: false }, async () => {
    const original = { post: axios.post, config: Globals.config, baseDir: Globals.baseDir };
    const artifactRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(artifactRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(artifactRoot, 'xml-done-retry-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test-key', model: 'test-model', stream: false, retryAttempts: 1, max_concurrent_requests: 1, supress_seed: true } };
    const cases = [
        { bad: '<items><item><name>One</name>', expectDone: true },
        { bad: '<items><item></items>', expectDone: false },
        { bad: '<wrong><item/></wrong>', expectDone: false },
        { bad: 'No XML here', expectDone: false }
    ];
    try {
        for (const { bad, expectDone } of cases) {
            const payloads = [];
            axios.post = async (_endpoint, payload) => {
                payloads.push(structuredClone(payload));
                return completionResponse(payload, { content: payloads.length === 1 ? bad : '<items><item/></items>\nDONE' });
            };
            const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Generate items.' }], metadataLabel: 'items_done_retry', expectedXmlRootTag: 'items', validateXML: true, validateXMLStrict: true, responseValidationRetryFeedback: !expectDone, throwOnError: true, stream: false, retryAttempts: 1, waitAfterError: 0, output: 'silent' });
            assert.match(result, /<\/items>\s*DONE/);
            assert.equal(payloads.length, 2);
            const feedback = payloads[1].messages.at(-1).content;
            assert.match(feedback, /expected|parse|xml/i);
            if (expectDone) {
                assert.match(feedback, /clos(?:e|ing)[\s\S]*tag/i);
                assert.equal((feedback.match(/\bDONE\b/g) || []).length, 1);
            } else assert.doesNotMatch(feedback, /\bDONE\b/);
        }
    } finally { axios.post = original.post; Globals.config = original.config; Globals.baseDir = original.baseDir; }
});

test('LLMClient identifies identical rejected XML without losing the original correction', { concurrency: false }, async () => {
    const original = { post: axios.post, config: Globals.config, baseDir: Globals.baseDir };
    Globals.baseDir = fs.mkdtempSync(path.join(path.resolve(__dirname, '..', 'tmp'), 'xml-repeat-retry-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test-key', model: 'test-model', stream: false, retryAttempts: 3, max_concurrent_requests: 1, supress_seed: true } };
    const payloads = [];
    try {
        axios.post = async (_endpoint, payload) => {
            payloads.push(structuredClone(payload));
            const responses = ['<items><item>', '<items><item>', '<items><item> ', '<items><item/></items>'];
            return completionResponse(payload, { content: responses[payloads.length - 1] });
        };
        await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Generate items.' }], metadataLabel: 'items_repeat_retry', expectedXmlRootTag: 'items', validateXML: true, validateXMLStrict: true, throwOnError: true, stream: false, retryAttempts: 3, waitAfterError: 0, output: 'silent' });
        assert.doesNotMatch(payloads[1].messages.at(-1).content, /Insanity/);
        assert.match(payloads[2].messages.at(-1).content, /"Insanity is doing the same thing over and over again and expecting different results\."/);
        assert.match(payloads[2].messages.at(-1).content, /xml|parse|expected/i);
        assert.equal((payloads[2].messages.at(-1).content.match(/\bDONE\b/g) || []).length, 1);
        assert.doesNotMatch(payloads[3].messages.at(-1).content, /Insanity/);
    } finally { axios.post = original.post; Globals.config = original.config; Globals.baseDir = original.baseDir; }
});

test('LLMClient retains all rejected XML during retries and starts the next request clean', { concurrency: false }, async () => {
    const original = { post: axios.post, config: Globals.config, baseDir: Globals.baseDir };
    Globals.baseDir = fs.mkdtempSync(path.join(path.resolve(__dirname, '..', 'tmp'), 'xml-conversation-retry-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test-key', model: 'test-model', stream: false, retryAttempts: 2, max_concurrent_requests: 1, supress_seed: true } };
    const payloads = [];
    const first = '<items><item>first';
    const second = '<items><item>second';
    try {
        axios.post = async (_endpoint, payload) => {
            payloads.push(structuredClone(payload));
            return completionResponse(payload, { content: [first, second, '<items/>', '<items/>'][payloads.length - 1] });
        };
        const options = { messages: [{ role: 'user', content: 'Generate items.' }], metadataLabel: 'items_conversation_retry', expectedXmlRootTag: 'items', validateXML: true, validateXMLStrict: true, throwOnError: true, stream: false, retryAttempts: 2, waitAfterError: 0, output: 'silent' };
        await LLMClient.chatCompletion(options);
        const rejected = payloads[2].messages.filter(message => message.role === 'assistant').map(message => message.content);
        assert.deepEqual(rejected, [first, second]);
        assert.match(payloads[2].messages.at(-1).content, /DONE/);
        await LLMClient.chatCompletion({ ...options, metadataLabel: 'items_fresh_request' });
        assert.deepEqual(payloads[3].messages, options.messages);
    } finally { axios.post = original.post; Globals.config = original.config; Globals.baseDir = original.baseDir; }
});

test('transport retries do not introduce XML closure instructions', { concurrency: false }, async () => {
    const original = { post: axios.post, config: Globals.config, baseDir: Globals.baseDir };
    const artifactRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(artifactRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(artifactRoot, 'xml-done-transport-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test-key', model: 'test-model', stream: false, retryAttempts: 1, max_concurrent_requests: 1, supress_seed: true } };
    const payloads = [];
    axios.post = async (_url, payload) => {
        payloads.push(structuredClone(payload));
        if (payloads.length === 1) throw Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' });
        return completionResponse(payload, { content: '<items/>' });
    };
    try {
        await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Generate items.' }], metadataLabel: 'items_transport_retry', validateXML: true, validateXMLStrict: true, responseValidationRetryFeedback: true, throwOnError: true, stream: false, retryAttempts: 1, waitAfterNetworkError: 0, waitAfterError: 0, output: 'silent' });
        assert.equal(payloads.length, 2);
        assert.deepEqual(payloads[1].messages, payloads[0].messages);
        assert.doesNotMatch(JSON.stringify(payloads[1].messages), /\bDONE\b/);
    } finally { axios.post = original.post; Globals.config = original.config; Globals.baseDir = original.baseDir; }
});

test('a later unrelated validation failure clears an earlier unclosed XML correction', { concurrency: false }, async () => {
    const original = { post: axios.post, config: Globals.config, baseDir: Globals.baseDir };
    const artifactRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(artifactRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(artifactRoot, 'xml-done-clear-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test-key', model: 'test-model', stream: false, retryAttempts: 2, max_concurrent_requests: 1, supress_seed: true } };
    const payloads = [];
    const replies = ['<items><item>', '<items><item>invalid</item></items>', '<items><item>valid</item></items>'];
    axios.post = async (_url, payload) => { payloads.push(structuredClone(payload)); return completionResponse(payload, { content: replies.shift() }); };
    try {
        const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Generate items.' }], metadataLabel: 'items_clear_stale_retry', expectedXmlRootTag: 'items', validateXML: true, validateXMLStrict: true, responseValidationRetryFeedback: false, responseValidator(text) { if (text.includes('invalid')) throw new Error('Item is semantically invalid.'); }, throwOnError: true, stream: false, retryAttempts: 2, waitAfterError: 0, output: 'silent' });
        assert.match(result, /<item>valid<\/item>/);
        assert.equal(payloads.length, 3);
        assert.match(payloads[1].messages.at(-1).content, /\bDONE\b/);
        assert.deepEqual(payloads[2].messages, payloads[0].messages);
        assert.doesNotMatch(JSON.stringify(payloads[2].messages), /\bDONE\b/);
    } finally { axios.post = original.post; Globals.config = original.config; Globals.baseDir = original.baseDir; }
});

test('custom strict XML validator adds DONE on unclosed response with default feedback disabled, but not semantic failures', { concurrency: false }, async () => {
    const Utils = require('../Utils.js');
    const original = { post: axios.post, config: Globals.config, baseDir: Globals.baseDir };
    const artifactRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(artifactRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(artifactRoot, 'xml-done-custom-validator-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test-key', model: 'test-model', stream: false, retryAttempts: 1, max_concurrent_requests: 1, supress_seed: true } };
    try {
        for (const bad of ['<items><item>', '<items><item>invalid</item></items>']) {
            const payloads = [];
            axios.post = async (_url, payload) => {
                payloads.push(structuredClone(payload));
                return completionResponse(payload, { content: payloads.length === 1 ? bad : '<items><item>valid</item></items>\nDONE' });
            };
            const result = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Generate items.' }], metadataLabel: 'items_custom_validator', validateXML: false, responseValidator(text) { Utils.parseXmlDocumentStrict(text); if (text.includes('invalid')) throw new Error('Item violates semantic policy.'); }, throwOnError: true, stream: false, retryAttempts: 1, waitAfterError: 0, output: 'silent' });
            assert.match(result, /valid<\/item><\/items>\s*DONE/);
            assert.equal(payloads.length, 2);
            if (bad.includes('invalid')) assert.deepEqual(payloads[1].messages, payloads[0].messages);
            else {
                const feedback = payloads[1].messages.at(-1).content;
                assert.match(feedback, /unclosed xml tag\(s\)/i);
                assert.equal((feedback.match(/\bDONE\b/g) || []).length, 1);
            }
        }
    } finally { axios.post = original.post; Globals.config = original.config; Globals.baseDir = original.baseDir; }
});
