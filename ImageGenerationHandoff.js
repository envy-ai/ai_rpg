const CodexBridgeClient = require('./CodexBridgeClient.js');

const DEFAULT_STRATA_MIN_FREE_VRAM_MIB = 12288;

/** Resolve an effective AI profile's optional handoff without changing legacy modes. */
function resolveImageGenerationHandoff(aiConfig) {
    const value = aiConfig?.image_generation_handoff;
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('ai.image_generation_handoff must be an object or null.');
    }
    if (value.provider !== 'strata') {
        throw new Error('ai.image_generation_handoff.provider must be "strata".');
    }
    for (const key of Object.keys(value)) {
        if (key !== 'provider' && key !== 'min_free_vram_mib' && key !== 'mode') {
            throw new Error(`ai.image_generation_handoff has unknown key "${key}".`);
        }
    }
    for (const key of ['unload_during_image_generation', 'terminate_during_image_generation']) {
        if (aiConfig[key] !== undefined && typeof aiConfig[key] !== 'boolean') {
            throw new Error(`ai.${key} must be a boolean when provided.`);
        }
    }
    const minimum = value.min_free_vram_mib === undefined ? DEFAULT_STRATA_MIN_FREE_VRAM_MIB : value.min_free_vram_mib;
    const mode = value.mode === undefined ? 'elastic' : value.mode;
    if (mode !== 'elastic' && mode !== 'ram_standby') {
        throw new Error('ai.image_generation_handoff.mode must be "elastic" or "ram_standby".');
    }
    if (!Number.isSafeInteger(minimum) || minimum <= 0) {
        throw new Error('ai.image_generation_handoff.min_free_vram_mib must be a positive integer of total free MiB.');
    }
    if (aiConfig.unload_during_image_generation === true || aiConfig.terminate_during_image_generation === true) {
        throw new Error('ai.image_generation_handoff cannot be combined with unload_during_image_generation or terminate_during_image_generation.');
    }
    if (CodexBridgeClient.normalizeBackend(aiConfig.backend) !== 'openai_compatible') {
        throw new Error('Strata image_generation_handoff requires the openai_compatible backend.');
    }
    if (aiConfig.local_startup_script_path !== undefined && aiConfig.local_startup_script_path !== null
        && typeof aiConfig.local_startup_script_path !== 'string') {
        throw new Error('ai.local_startup_script_path must be a string or null.');
    }
    if (typeof aiConfig.local_startup_script_path === 'string' && aiConfig.local_startup_script_path.trim()) {
        throw new Error('Strata image_generation_handoff requires a blank llama.cpp local_startup_script_path; use ai.strata_runtime for native ownership.');
    }
    return Object.freeze({ provider: 'strata', mode, min_free_vram_mib: minimum });
}

/** Validate before applying a merged configuration, including inherited prompt profiles. */
function validateImageGenerationHandoffs(configuration, resolveEffectiveAiConfiguration) {
    if (typeof resolveEffectiveAiConfiguration !== 'function') {
        throw new Error('Image generation handoff validation requires the effective AI profile resolver.');
    }
    const rootAi = configuration?.ai;
    const profiles = [{ label: 'ai', ai: rootAi }];
    const promptLabels = new Set();
    for (const profile of Object.values(configuration?.ai_model_overrides || {})) {
        if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
            for (const label of Array.isArray(profile.prompts) ? profile.prompts : []) {
                if (typeof label === 'string' && label.trim()) promptLabels.add(label);
            }
        }
    }
    for (const label of promptLabels) {
        profiles.push({ label: `prompt "${label}"`, promptLabel: label });
    }
    if (configuration?.ai_multimodal && typeof configuration.ai_multimodal === 'object') {
        profiles.push({ label: 'ai_multimodal', ai: configuration.ai_multimodal });
    }
    for (const { label, ai: directAi, promptLabel } of profiles) {
        try {
            const ai = promptLabel === undefined
                ? directAi
                : resolveEffectiveAiConfiguration(promptLabel, configuration).aiConfig;
            if (!resolveImageGenerationHandoff(ai)) continue;
            if (typeof ai.model !== 'string' || !ai.model.trim()) {
                throw new Error('Strata image_generation_handoff requires a configured AI model.');
            }
            const endpoint = new URL(ai.endpoint);
            if (!['http:', 'https:'].includes(endpoint.protocol)) {
                throw new Error('Strata image_generation_handoff endpoint must use HTTP or HTTPS.');
            }
            if (String(configuration?.imagegen?.engine || 'comfyui').trim().toLowerCase() !== 'comfyui') {
                throw new Error('Strata image_generation_handoff requires imagegen.engine to be comfyui.');
            }
            if (configuration?.unload_model_on_switch === true) {
                throw new Error('Strata image_generation_handoff cannot be combined with unload_model_on_switch.');
            }
            if (typeof configuration?.router_preload_model === 'string' && configuration.router_preload_model.trim()) {
                throw new Error('Strata image_generation_handoff requires a blank router_preload_model.');
            }
        } catch (cause) {
            throw new Error(`${label}: ${cause.message}`, { cause });
        }
    }
}

module.exports = {
    DEFAULT_STRATA_MIN_FREE_VRAM_MIB,
    resolveImageGenerationHandoff,
    validateImageGenerationHandoffs
};
