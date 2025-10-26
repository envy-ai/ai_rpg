const axios = require('axios');
const Globals = require('./Globals.js');
const { response } = require('express');

class LLMClient {
    static ensureAiConfig() {
        const globalConfig = Globals?.config;
        if (!globalConfig || typeof globalConfig !== 'object') {
            throw new Error('Globals.config is not set; AI configuration unavailable.');
        }
        const aiConfig = globalConfig.ai;
        if (!aiConfig || typeof aiConfig !== 'object') {
            throw new Error('Globals.config.ai is not set; AI configuration unavailable.');
        }
        return aiConfig;
    }

    static baseTimeoutMilliseconds() {
        const globalConfig = Globals?.config;
        const seconds = Number(globalConfig?.ai?.baseTimeoutSeconds);
        if (Number.isFinite(seconds) && seconds > 0) {
            return seconds * 1000;
        }
        return 120 * 1000;
    }

    static resolveTimeout(timeoutMs, multiplier = 1) {
        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            return timeoutMs;
        }
        const base = LLMClient.baseTimeoutMilliseconds();
        const factor = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
        const computed = base * factor;
        if (!Number.isFinite(computed) || computed <= 0) {
            throw new Error('Invalid timeout; cannot resolve effective timeout for LLM call.');
        }
        return Math.min(Number.MAX_SAFE_INTEGER, computed);
    }

    static resolveChatEndpoint(endpoint) {
        const candidate = typeof endpoint === 'string' && endpoint.trim()
            ? endpoint.trim()
            : null;

        if (!candidate) {
            throw new Error('LLM endpoint is not configured.');
        }

        if (/\/chat\/completions\/?$/i.test(candidate)) {
            return candidate.endsWith('/')
                ? candidate.slice(0, -1)
                : candidate;
        }

        return candidate.endsWith('/')
            ? `${candidate}chat/completions`
            : `${candidate}/chat/completions`;
    }

    static resolveTemperature(explicit, fallback) {
        if (Number.isFinite(explicit)) {
            return explicit;
        }
        if (Number.isFinite(fallback)) {
            return fallback;
        }
        return 0.7;
    }

    static async chatCompletion({
        messages,
        maxTokens,
        temperature,
        model,
        apiKey,
        endpoint,
        timeoutMs,
        timeoutScale = 1,
        metadataLabel = '',
        metadata,
        retryAttempts = null,
        headers = {},
        additionalPayload = {},
        onResponse = null
    } = {}) {
        const aiConfig = LLMClient.ensureAiConfig();

        if (metadataLabel) {
            console.log(`🧠 LLMClient.chatCompletion called with metadataLabel: ${metadataLabel}`);
        } else {
            console.log('🧠 LLMClient.chatCompletion called without metadataLabel.');
            console.trace();
        }

        const payload = additionalPayload && typeof additionalPayload === 'object'
            ? { ...additionalPayload }
            : {};

        if (Array.isArray(messages)) {
            payload.messages = messages;
        }

        if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
            throw new Error('LLMClient.chatCompletion requires at least one message.');
        }

        const resolvedModel = model || payload.model || aiConfig.model;
        if (!resolvedModel) {
            throw new Error('AI model is not configured.');
        }
        payload.model = resolvedModel;

        if (maxTokens !== undefined) {
            if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
                throw new Error('maxTokens must be a positive number when provided.');
            }
            payload.max_tokens = maxTokens;
        } else if (payload.max_tokens === undefined && Number.isFinite(aiConfig.maxTokens) && aiConfig.maxTokens > 0) {
            payload.max_tokens = aiConfig.maxTokens;
        }

        const resolvedTemperature = LLMClient.resolveTemperature(
            temperature,
            payload.temperature !== undefined ? payload.temperature : aiConfig.temperature
        );
        payload.temperature = resolvedTemperature;

        retryAttempts = Number.isInteger(retryAttempts) && retryAttempts >= 0 ? retryAttempts : Globals.config.ai.retryAttempts || 0;

        const resolvedEndpoint = LLMClient.resolveChatEndpoint(endpoint || aiConfig.endpoint);
        const resolvedApiKey = apiKey || aiConfig.apiKey;
        if (!resolvedApiKey) {
            throw new Error('AI API key is not configured.');
        }

        const resolvedTimeout = LLMClient.resolveTimeout(timeoutMs, timeoutScale);

        const requestHeaders = {
            'Authorization': `Bearer ${resolvedApiKey}`,
            'Content-Type': 'application/json',
            ...headers
        };

        const axiosOptions = {
            headers: requestHeaders,
            timeout: resolvedTimeout
        };

        response.reasoning = { "enabled": false };

        if (metadataLabel && metadata) {
            axiosOptions.metadata = { ...metadata, aiMetricsLabel: metadataLabel };
        } else if (metadataLabel) {
            axiosOptions.metadata = { aiMetricsLabel: metadataLabel };
        } else if (metadata) {
            axiosOptions.metadata = metadata;
        }

        let attempt = 0;
        let responseContent = '';
        while (attempt <= retryAttempts) {
            try {
                const response = await axios.post(resolvedEndpoint, payload, axiosOptions);
                if (typeof onResponse === 'function') {
                    onResponse(response);
                }
                responseContent = response.data?.choices?.[0]?.message?.content || '';
                // Check for presence of <think></think> tags and log a warning to the console with the contents of the tags
                if (/<think>[\s\S]*?<\/think>/i.test(responseContent)) {
                    const thinkTags = responseContent.match(/<think>[\s\S]*?<\/think>/gi);
                    console.warn('⚠️ Response content contains <think></think> tags');
                }
                // Check if <think></think> tags are present and remove them and anything inside
                const thinkTagPattern = /<think>[\s\S]*?<\/think>/gi;
                responseContent = responseContent.replace(thinkTagPattern, '').trim();

                if (responseContent) break;
                console.error(`Empty response content received (attempt ${attempt + 1}).`);
                if (attempt === retryAttempts) {
                    console.error('Max retry attempts reached. Failing the chat completion request.');
                    console.debug(error);
                    return '';
                }
            } catch (error) {
                console.error(`Error occurred during chat completion (attempt ${attempt + 1}):`, error);
                if (attempt === retryAttempts) {
                    console.error('Max retry attempts reached. Failing the chat completion request.');
                    console.debug(error);
                    return '';
                }
            }
            console.error(`Retrying chat completion (attempt ${attempt + 2} of ${retryAttempts + 1})...`);
            attempt++;
        }

        return responseContent;
    }
}

module.exports = LLMClient;
