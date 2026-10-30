const test = require('node:test');
const assert = require('node:assert/strict');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

test('Strata management target resolves effective image-prompt endpoint, model, headers, auth, timeout, and reserve', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'http://strata.example:8080/v1/chat/completions',
            apiKey: 'base-key',
            model: 'base-model',
            image_generation_handoff: { provider: 'strata', min_free_vram_mib: 12000 },
            baseTimeoutSeconds: 31,
            headers: { 'X-Base': 'base' }
        },
        ai_model_overrides: {
            image_prompt: {
                prompts: ['image_prompt_generation'],
                model: 'effective-image-prompt-model',
                image_generation_handoff: { provider: 'strata', min_free_vram_mib: 12288 },
                headers: { 'X-Profile': 'selected' }
            }
        }
    };

    try {
        const target = await LLMClient.resolveStrataVramManagementTarget();
        assert.deepEqual(target, {
            endpoint: 'http://strata.example:8080/v1/chat/completions',
            model: 'effective-image-prompt-model',
            headers: {
                'Content-Type': 'application/json',
                'X-Base': 'base',
                'X-Profile': 'selected',
                Authorization: 'Bearer base-key'
            },
            timeoutMs: 31000,
            minFreeVramMiB: 12288,
            handoffMode: 'elastic'
        });
    } finally {
        Globals.config = originalConfig;
    }
});

test('Strata target resolves RAM-standby mode from the effective image-prompt profile', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    Globals.config = {
        ai: {
            backend: 'openai_compatible', endpoint: 'http://strata.example/v1', apiKey: 'base-key', model: 'base-model',
            image_generation_handoff: { provider: 'strata', mode: 'elastic' }
        },
        imagegen: { engine: 'comfyui' },
        ai_model_overrides: {
            image_prompt: {
                prompts: ['image_prompt_generation'],
                image_generation_handoff: { provider: 'strata', mode: 'ram_standby', min_free_vram_mib: 13000 }
            }
        }
    };
    try {
        const target = await LLMClient.resolveStrataVramManagementTarget();
        assert.equal(target.model, 'base-model');
        assert.equal(target.handoffMode, 'ram_standby');
        assert.equal(target.minFreeVramMiB, 13000);
    } finally {
        Globals.config = originalConfig;
    }
});

test('Strata target rejects missing handoff, invalid effective backend, and missing model', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    try {
        Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'http://strata.example/v1', apiKey: 'k', model: 'm' } };
        await assert.rejects(LLMClient.resolveStrataVramManagementTarget(), /not enabled/);

        Globals.config = { ai: {
            backend: 'codex', endpoint: 'http://strata.example/v1', apiKey: 'k', model: 'm',
            image_generation_handoff: { provider: 'strata' }
        } };
        await assert.rejects(LLMClient.resolveStrataVramManagementTarget(), /openai_compatible/);

        Globals.config = { ai: {
            backend: 'openai_compatible', endpoint: 'http://strata.example/v1', apiKey: 'k', model: ' ',
            image_generation_handoff: { provider: 'strata' }
        } };
        await assert.rejects(LLMClient.resolveStrataVramManagementTarget(), /configured AI model/);
    } finally {
        Globals.config = originalConfig;
    }
});
