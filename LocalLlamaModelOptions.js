'use strict';

const LlamaCppRouterClient = require('./LlamaCppRouterClient.js');

function isLoopbackHostname(hostname) {
    const normalized = typeof hostname === 'string' ? hostname.trim().toLowerCase() : '';
    return normalized === 'localhost'
        || normalized === '127.0.0.1'
        || normalized === '0.0.0.0'
        || normalized === '::1'
        || normalized === '[::1]';
}

function usesLocalLlamaCppEndpoint(aiConfig) {
    if (aiConfig?.backend !== 'openai_compatible' || typeof aiConfig?.endpoint !== 'string') {
        return false;
    }
    if (typeof aiConfig.local_startup_script_path === 'string' && aiConfig.local_startup_script_path.trim()) {
        return true;
    }
    try {
        return isLoopbackHostname(new URL(aiConfig.endpoint.trim()).hostname);
    } catch (_error) {
        return false;
    }
}

async function listAdvertisedLocalLlamaModels(aiConfig, {
    httpClient,
    timeoutMs = 3000,
    logger = console
} = {}) {
    if (!usesLocalLlamaCppEndpoint(aiConfig)) {
        throw new Error('Advertised llama.cpp models can only be queried from a local OpenAI-compatible endpoint.');
    }
    const headers = { ...(aiConfig.headers || {}) };
    const hasAuthorization = Object.keys(headers).some(name => name.toLowerCase() === 'authorization');
    if (!hasAuthorization && typeof aiConfig.apiKey === 'string' && aiConfig.apiKey.trim()) {
        headers.Authorization = `Bearer ${aiConfig.apiKey.trim()}`;
    }
    const client = new LlamaCppRouterClient({
        endpoint: aiConfig.endpoint,
        model: typeof aiConfig.model === 'string' && aiConfig.model.trim()
            ? aiConfig.model.trim()
            : '__model_list__',
        headers,
        timeoutMs,
        statusRetryAttempts: 0,
        httpClient,
        logger
    });
    const entries = await client.listModels();
    return Array.from(new Set(entries
        .map(entry => typeof entry?.id === 'string' ? entry.id.trim() : '')
        .filter(Boolean)));
}

module.exports = {
    isLoopbackHostname,
    usesLocalLlamaCppEndpoint,
    listAdvertisedLocalLlamaModels
};
