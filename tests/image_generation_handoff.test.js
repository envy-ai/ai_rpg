const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_STRATA_MIN_FREE_VRAM_MIB,
    resolveImageGenerationHandoff,
    validateImageGenerationHandoffs
} = require('../ImageGenerationHandoff.js');
const LLMClient = require('../LLMClient.js');

const openAi = { backend: 'openai_compatible', endpoint: 'http://strata.example/v1', model: 'plain-model' };

test('image-generation handoff is optional and resolves a frozen Strata reserve', () => {
    assert.equal(resolveImageGenerationHandoff(undefined), null);
    assert.equal(resolveImageGenerationHandoff({}), null);
    assert.equal(resolveImageGenerationHandoff({ image_generation_handoff: null }), null);

    const defaulted = resolveImageGenerationHandoff({
        ...openAi,
        image_generation_handoff: { provider: 'strata' }
    });
    assert.deepEqual(defaulted, {
        provider: 'strata', mode: 'elastic', min_free_vram_mib: DEFAULT_STRATA_MIN_FREE_VRAM_MIB
    });
    assert.ok(Object.isFrozen(defaulted));

    assert.deepEqual(resolveImageGenerationHandoff({
        ...openAi,
        image_generation_handoff: { provider: 'strata', min_free_vram_mib: 24564 }
    }), { provider: 'strata', mode: 'elastic', min_free_vram_mib: 24564 });

    assert.deepEqual(resolveImageGenerationHandoff({
        ...openAi,
        image_generation_handoff: { provider: 'strata', mode: 'ram_standby' }
    }), { provider: 'strata', mode: 'ram_standby', min_free_vram_mib: DEFAULT_STRATA_MIN_FREE_VRAM_MIB });
});

test('image-generation handoff rejects malformed provider and reserve values', () => {
    for (const handoff of [
        'strata', [], {}, { provider: 'other' },
        { provider: 'strata', min_free_vram_mib: 0 },
        { provider: 'strata', min_free_vram_mib: -1 },
        { provider: 'strata', min_free_vram_mib: 1.5 },
        { provider: 'strata', min_free_vram_mib: true },
        { provider: 'strata', min_free_vram_mib: Number.MAX_SAFE_INTEGER + 1 },
        { provider: 'strata', mode: 'restart' },
        { provider: 'strata', mode: null },
        { provider: 'strata', reserve_mib: 9000 }
    ]) {
        assert.throws(
            () => resolveImageGenerationHandoff({ ...openAi, image_generation_handoff: handoff }),
            /image_generation_handoff/
        );
    }
});

test('image-generation handoff is mutually exclusive with unload, termination, and managed startup', () => {
    for (const invalidAi of [
        { ...openAi, unload_during_image_generation: true },
        { ...openAi, terminate_during_image_generation: true },
        { ...openAi, local_startup_script_path: '  /tmp/start-llama.sh  ' },
        { ...openAi, backend: 'codex' },
        { ...openAi, unload_during_image_generation: 'true' },
        { ...openAi, terminate_during_image_generation: 1 },
        { ...openAi, local_startup_script_path: 42 }
    ]) {
        assert.throws(() => resolveImageGenerationHandoff({
            ...invalidAi,
            image_generation_handoff: { provider: 'strata' }
        }), /image_generation_handoff|Strata|must be a boolean|string or null/);
    }
});

test('configuration validation checks inherited prompt overrides and image engine conflicts', () => {
    const base = {
        ai: { ...openAi, image_generation_handoff: { provider: 'strata' } },
        imagegen: { engine: 'comfyui' },
        ai_model_overrides: {
            inherited: { prompts: ['image_prompt_generation'], model: 'image-model' },
            disabled: { image_generation_handoff: null }
        }
    };
    const resolver = LLMClient.resolveEffectiveAiConfiguration;
    assert.doesNotThrow(() => validateImageGenerationHandoffs(base, resolver));

    assert.throws(() => validateImageGenerationHandoffs({
        ...base,
        ai_model_overrides: {
            inherited: {
                prompts: ['image_prompt_generation'],
                terminate_during_image_generation: true
            }
        }
    }, resolver), /prompt "image_prompt_generation"/);

    assert.throws(() => validateImageGenerationHandoffs({
        ...base,
        imagegen: { engine: 'nanogpt' }
    }, resolver), /imagegen.engine/);
    assert.throws(() => validateImageGenerationHandoffs({ ...base, unload_model_on_switch: true }, resolver), /unload_model_on_switch/);
    assert.throws(() => validateImageGenerationHandoffs({ ...base, router_preload_model: 'preloaded-router-model' }, resolver), /router_preload_model/);

    assert.throws(() => validateImageGenerationHandoffs({
        ...base,
        ai: { ...base.ai, model: ' ' }
    }, resolver), /configured AI model/);
    assert.throws(() => validateImageGenerationHandoffs({
        ...base,
        ai: { ...base.ai, endpoint: 'ftp://strata.example/v1' }
    }, resolver), /HTTP or HTTPS/);
});

test('configuration validation checks root and multimodal effective handoff settings', () => {
    const rootHandoff = {
        ai: { ...openAi, image_generation_handoff: { provider: 'strata' } },
        imagegen: { engine: 'comfyui' }
    };
    const resolver = LLMClient.resolveEffectiveAiConfiguration;
    assert.doesNotThrow(() => validateImageGenerationHandoffs(rootHandoff, resolver));

    assert.throws(() => validateImageGenerationHandoffs({
        ai: openAi,
        ai_multimodal: {
            backend: 'codex',
            image_generation_handoff: { provider: 'strata' }
        },
        imagegen: { engine: 'comfyui' }
    }, resolver), /ai_multimodal/);
});

test('composed matching prompt overrides are validated without mutating live nested config', () => {
    const live = {
        ai: { ...openAi, image_generation_handoff: { provider: 'strata' } },
        imagegen: { engine: 'comfyui' },
        ai_model_overrides: {
            image: { prompts: ['image_prompt_generation'], model: 'image-model', terminate_during_image_generation: true }
        }
    };
    const before = structuredClone(live);
    assert.throws(() => validateImageGenerationHandoffs(live, LLMClient.resolveEffectiveAiConfiguration), /prompt "image_prompt_generation"/);
    assert.deepEqual(live, before, 'effective-profile validation must leave the source config untouched after rejection');
});
