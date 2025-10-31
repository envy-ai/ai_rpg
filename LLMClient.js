const axios = require('axios');
const Globals = require('./Globals.js');
const { response } = require('express');
const Utils = require('./Utils.js');
const { dump } = require('js-yaml');

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

    static writeLogFile({
        prefix = 'log',
        metadataLabel = '',
        payload = '',
        serializeJson = false,
        onFailureMessage = 'Failed to write log file',
        error = '',
    } = {}) {
        try {
            const fs = require('fs');
            const path = require('path');
            const baseDir = Globals?.baseDir || process.cwd();
            const logDir = path.join(baseDir, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const safeLabel = metadataLabel
                ? metadataLabel.replace(/[^a-z0-9_-]/gi, '_')
                : 'unknown';
            const filePath = path.join(logDir, `ERROR_${prefix}_${safeLabel}_${Date.now()}.log`);

            let dataToWrite = payload;
            if (serializeJson) {
                dataToWrite = JSON.stringify(payload, null, 2);
            } else if (typeof payload !== 'string') {
                dataToWrite = JSON.stringify(payload ?? '', null, 2);
            }

            error = JSON.stringify(error);
            if (error) {
                dataToWrite = `Error Details:\n${error}\n\nPayload:\n${dataToWrite}`;
            }

            fs.writeFileSync(filePath, dataToWrite || '', 'utf8');
            return filePath;
        } catch (error) {
            console.warn(`${onFailureMessage}: ${error.message}`);
            return null;
        }
    }

    static #cloneAiConfig() {
        const source = LLMClient.ensureAiConfig();
        try {
            return JSON.parse(JSON.stringify(source));
        } catch (error) {
            throw new Error(`Failed to clone AI configuration: ${error.message}`);
        }
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
        onResponse = null,
        validateXML = true,
        requiredTags = [],
        waitAfterError = 0,
        dumpReasoningToConsole = false,
        debug = false,
        frequencyPenalty = null,
        presencePenalty = null,
    } = {}) {
        if (debug) {
            console.log('LLMClient.chatCompletion called with parameters:');
            console.log({
                messages,
                maxTokens,
                temperature,
                model,
                apiKey: apiKey ? '***REDACTED***' : null,
                endpoint,
                timeoutMs,
                timeoutScale,
                metadataLabel,
                metadata,
                retryAttempts,
                headers,
                additionalPayload,
                validateXML,
                requiredTags,
                waitAfterError,
                dumpReasoningToConsole,
            });
        }
        const aiConfig = LLMClient.#cloneAiConfig();

        //check if Globals.config.prompt_ai_overrides[metadataLabel] exists, and if so, iterate through the keys and set the corresponding variables
        console.log(`Checking for AI config overrides for metadataLabel: ${metadataLabel}`);
        if (metadataLabel && Globals.config.prompt_ai_overrides && Globals.config.prompt_ai_overrides[metadataLabel]) {
            const overrides = Globals.config.prompt_ai_overrides[metadataLabel];
            console.log(`Applying AI config overrides for ${metadataLabel}:`, overrides);
            for (const [key, value] of Object.entries(overrides)) {
                console.log(`Applying AI config override for ${metadataLabel}: setting ${key} to ${value}`);
                aiConfig[key] = value;
            }
        }



        if (metadataLabel) {
            console.log(`🧠 LLMClient.chatCompletion called with metadataLabel: ${metadataLabel}`);
        } else {
            console.log('🧠 LLMClient.chatCompletion called without metadataLabel.');
            console.trace();
        }

        const payload = additionalPayload && typeof additionalPayload === 'object'
            ? { ...additionalPayload }
            : {};

        if (aiConfig.frequency_penalty !== undefined && frequencyPenalty === null) {
            payload.frequency_penalty = frequencyPenalty !== null ? frequencyPenalty : aiConfig.frequency_penalty;
        }

        if (aiConfig.presence_penalty !== undefined && presencePenalty === null) {
            payload.presence_penalty = presencePenalty !== null ? presencePenalty : aiConfig.presence_penalty;
        }

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

                // On any 5xx response, wait waitAfterError seconds and then retry
                if (response.status >= 500 && response.status < 600) {
                    console.error(`Server error from LLM (status ${response.status}) on attempt ${attempt + 1}.`);
                    if (waitAfterError > 0) {
                        console.log(`Waiting ${waitAfterError} seconds before retrying...`);
                        await new Promise(resolve => setTimeout(resolve, waitAfterError * 1000));
                    }
                    throw new Error(`Server error from LLM (status ${response.status}).`);
                }

                if (typeof onResponse === 'function') {
                    onResponse(response);
                }
                responseContent = response.data?.choices?.[0]?.message?.content || '';
                if (debug) {
                    console.log('Raw LLM response content:', responseContent);
                }
                // Check for presence of <think></think> tags and log a warning to the console with the contents of the tags
                let thinkTags = [];
                if (/<think>[\s\S]*?<\/think>/i.test(responseContent)) {
                    thinkTags = responseContent.match(/<think>[\s\S]*?<\/think>/gi);
                    console.warn('⚠️ Response content contains <think></think> tags');
                }
                // Check if <think></think> tags are present and remove them and anything inside
                const thinkTagPattern = /<think>[\s\S]*?<\/think>/gi;
                responseContent = responseContent.replace(thinkTagPattern, '').trim();


                if (responseContent.trim() === '') {
                    console.error(`Empty response content received (attempt ${attempt + 1}).`);
                    if (thinkTags.length > 0) {
                        console.warn('⚠️ Contents of <think></think> tags:', thinkTags);
                    }
                    throw new Error('Received empty response content from LLM.');
                }

                if (dumpReasoningToConsole && thinkTags.length > 0) {
                    console.log('💡 Dumping reasoning from <think></think> tags to console:');
                    thinkTags.forEach(tag => console.log(` - ${tag}`));
                }

                if (debug) {
                    try {
                        const fs = require('fs');
                        const path = require('path');
                        const baseDir = Globals?.baseDir || process.cwd();
                        const logDir = path.join(baseDir, 'logs');
                        if (!fs.existsSync(logDir)) {
                            fs.mkdirSync(logDir, { recursive: true });
                        }
                        const safeLabel = metadataLabel
                            ? metadataLabel.replace(/[^a-z0-9_-]/gi, '_')
                            : 'unknown';
                        const timestamp = Date.now();
                        const filePath = path.join(logDir, `debug_${safeLabel}_${timestamp}.log`);

                        const logPayload = {
                            timestamp,
                            metadataLabel,
                            parameters: {
                                maxTokens,
                                temperature: resolvedTemperature,
                                model: payload.model,
                                endpoint: resolvedEndpoint,
                                timeoutMs: resolvedTimeout,
                                frequencyPenalty,
                                presencePenalty,
                                timeoutScale,
                                retryAttempts,
                                waitAfterError,
                                validateXML,
                                requiredTags,
                                dumpReasoningToConsole
                            },
                            aiConfigOverride: aiConfig,
                            requestPayload: payload,
                            rawResponse: response.data,
                            messages
                        };

                        fs.writeFileSync(filePath, JSON.stringify(logPayload, null, 2), 'utf8');
                        console.log(`Debug log written to ${filePath}`);
                    } catch (debugError) {
                        console.warn('Failed to write debug log file:', debugError.message);
                    }
                }

                if (validateXML) {
                    try {
                        Utils.parseXmlDocument(responseContent);
                    } catch (xmlError) {
                        console.error(`XML validation failed (attempt ${attempt + 1}):`, xmlError);
                        const filePath = LLMClient.writeLogFile({
                            prefix: 'invalidXML',
                            metadataLabel,
                            error: xmlError,
                            payload: responseContent || '',
                            onFailureMessage: 'Failed to write invalid XML log file'
                        });
                        if (filePath) {
                            console.warn(`Invalid XML response logged to ${filePath}`);
                        }
                        throw xmlError;
                    }

                    // use regex to check for required tags
                    for (const tag of requiredTags) {
                        const tagPattern = new RegExp(`<${tag}[\s\S]*?>[\s\S]*?<\/${tag}>`, 'i');
                        if (!tagPattern.test(responseContent)) {
                            const errorMsg = `Required XML tag <${tag}> is missing in the response (attempt ${attempt + 1}).`;
                            const filePath = LLMClient.writeLogFile({
                                prefix: 'missingTag',
                                metadataLabel,
                                error: errorMsg,
                                payload: responseContent || '',
                                onFailureMessage: 'Failed to write missing tag log file'
                            });
                            if (filePath) {
                                console.warn(`Invalid XML response logged to ${filePath}`);
                            }
                            console.error(errorMsg);
                            throw new Error(errorMsg);
                        }
                    }
                    return responseContent;
                } else {
                    return responseContent;
                }

            } catch (error) {
                console.error(`Error occurred during chat completion (attempt ${attempt + 1}): `, error.message);

                const filePath = LLMClient.writeLogFile({
                    prefix: 'chatCompletionError',
                    metadataLabel,
                    error: error,
                    payload: responseContent || '',
                    onFailureMessage: 'Failed to write chat completion error log file'
                });
                if (filePath) {
                    console.warn(`Chat completion error response logged to ${filePath}`);
                }

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
