'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const NanoGPTImageClient = require('../NanoGPTImageClient.js');
const OpenAIImageClient = require('../OpenAIImageClient.js');

test('remote image clients assign local sequential IDs without sending them to providers', async () => {
    const original = axios.post;
    const requests = [];
    axios.post = async (url, payload) => {
        requests.push({ url, payload });
        return { data: { data: [{ b64_json: Buffer.from('fixture').toString('base64') }] } };
    };
    try {
        const config = { imagegen: { apiKey: 'test-only', model: 'fixture' } };
        const nano = await new NanoGPTImageClient(config).generateImage({ prompt: 'test' });
        const openai = await new OpenAIImageClient(config).generateImage({ prompt: 'test' });
        assert.match(nano.requestId, /^image_request_\d+$/);
        assert.match(openai.requestId, /^image_request_\d+$/);
        assert.notEqual(nano.requestId, openai.requestId);
        for (const request of requests) {
            assert.doesNotMatch(JSON.stringify(request.payload), /image_request_/);
        }
    } finally { axios.post = original; }
});
