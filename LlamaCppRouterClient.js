const axios = require('axios');

class LlamaCppRouterClient {
    constructor({
        endpoint,
        model,
        headers = {},
        timeoutMs = 120000,
        pollIntervalMs = 250,
        statusRetryAttempts = 2,
        statusRetryDelayMs = 250,
        httpClient = axios,
        sleep = null,
        logger = console
    } = {}) {
        if (typeof endpoint !== 'string' || !endpoint.trim()) {
            throw new Error('llama.cpp router endpoint is required.');
        }
        if (typeof model !== 'string' || !model.trim()) {
            throw new Error('llama.cpp router model is required.');
        }
        if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
            throw new Error('llama.cpp router headers must be an object.');
        }
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new Error('llama.cpp router timeoutMs must be a positive number.');
        }
        if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
            throw new Error('llama.cpp router pollIntervalMs must be a non-negative number.');
        }
        if (!Number.isInteger(statusRetryAttempts) || statusRetryAttempts < 0) {
            throw new Error('llama.cpp router statusRetryAttempts must be a non-negative integer.');
        }
        if (!Number.isFinite(statusRetryDelayMs) || statusRetryDelayMs < 0) {
            throw new Error('llama.cpp router statusRetryDelayMs must be a non-negative number.');
        }
        if (!httpClient || typeof httpClient.get !== 'function' || typeof httpClient.post !== 'function') {
            throw new Error('llama.cpp router HTTP client must expose get() and post().');
        }
        if (!logger || typeof logger.warn !== 'function') {
            throw new Error('llama.cpp router logger must expose warn().');
        }

        this.baseUrl = LlamaCppRouterClient.resolveRouterBaseUrl(endpoint);
        this.model = model.trim();
        this.headers = { ...headers };
        this.timeoutMs = timeoutMs;
        this.pollIntervalMs = pollIntervalMs;
        this.statusRetryAttempts = statusRetryAttempts;
        this.statusRetryDelayMs = statusRetryDelayMs;
        this.httpClient = httpClient;
        this.logger = logger;
        this.sleep = typeof sleep === 'function'
            ? sleep
            : milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    static resolveRouterBaseUrl(endpoint) {
        let parsed;
        try {
            parsed = new URL(endpoint.trim());
        } catch (error) {
            throw new Error(`Invalid llama.cpp router endpoint: ${error.message}`);
        }

        parsed.search = '';
        parsed.hash = '';
        parsed.pathname = parsed.pathname
            .replace(/\/chat\/completions\/?$/i, '')
            .replace(/\/v1\/?$/i, '')
            .replace(/\/+$/g, '');

        return parsed.toString().replace(/\/$/, '');
    }

    requestOptions() {
        return {
            headers: { ...this.headers },
            timeout: this.timeoutMs
        };
    }

    describeHttpError(error) {
        const responseBody = error?.response?.data;
        const responseMessage = responseBody?.error?.message
            || responseBody?.error
            || responseBody?.message;
        return responseMessage || error?.message || String(error);
    }

    isTransientStatusError(error) {
        const status = Number(error?.response?.status);
        if (Number.isFinite(status)) {
            return status === 408 || status === 429 || status >= 500;
        }
        return true;
    }

    async listModels() {
        const url = `${this.baseUrl}/models`;
        const totalAttempts = this.statusRetryAttempts + 1;
        let response;
        for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
            try {
                response = await this.httpClient.get(url, this.requestOptions());
                break;
            } catch (error) {
                const shouldRetry = attempt < totalAttempts && this.isTransientStatusError(error);
                if (!shouldRetry) {
                    const attemptSummary = attempt > 1 ? ` after ${attempt} attempts` : '';
                    throw new Error(
                        `Failed to query llama.cpp router models at ${url}${attemptSummary}: ${this.describeHttpError(error)}`
                    );
                }
                this.logger.warn(
                    `Transient llama.cpp router status failure (${attempt}/${totalAttempts}): ${this.describeHttpError(error)}; retrying.`
                );
                await this.sleep(this.statusRetryDelayMs);
            }
        }

        const models = response?.data?.data;
        if (!Array.isArray(models)) {
            throw new Error('llama.cpp router /models response did not contain a data array.');
        }
        return models;
    }

    async getModelStatus() {
        const models = await this.listModels();
        const entry = models.find(candidate => candidate?.id === this.model);
        if (!entry) {
            throw new Error(`llama.cpp router does not list configured model "${this.model}".`);
        }
        const value = typeof entry?.status?.value === 'string'
            ? entry.status.value.trim().toLowerCase()
            : '';
        if (!value) {
            throw new Error(`llama.cpp router model "${this.model}" has no status value.`);
        }
        if (entry?.status?.failed === true) {
            throw new Error(`llama.cpp router reports model "${this.model}" in failed ${value} state.`);
        }
        return { value, entry };
    }

    async postModelAction(action) {
        let response;
        try {
            response = await this.httpClient.post(
                `${this.baseUrl}/models/${action}`,
                { model: this.model },
                this.requestOptions()
            );
        } catch (error) {
            throw new Error(
                `Failed to ${action} llama.cpp model "${this.model}": ${this.describeHttpError(error)}`
            );
        }
        if (response?.data?.success !== true) {
            throw new Error(
                `llama.cpp router did not confirm ${action} for model "${this.model}".`
            );
        }
    }

    async waitForStatus(expectedStatus) {
        const expected = String(expectedStatus || '').trim().toLowerCase();
        if (!expected) {
            throw new Error('Expected llama.cpp model status is required.');
        }
        const deadline = Date.now() + this.timeoutMs;
        let lastStatus = null;

        while (true) {
            const status = await this.getModelStatus();
            lastStatus = status.value;
            if (lastStatus === expected) {
                return status;
            }
            if (Date.now() >= deadline) {
                throw new Error(
                    `Timed out waiting for llama.cpp model "${this.model}" to become ${expected}; last status was ${lastStatus}.`
                );
            }
            await this.sleep(this.pollIntervalMs);
        }
    }

    async unloadModelIfLoaded() {
        const initialStatus = await this.getModelStatus();
        if (initialStatus.value === 'unloaded') {
            return {
                unloadedByClient: false,
                initialStatus: initialStatus.value
            };
        }

        await this.postModelAction('unload');
        try {
            await this.waitForStatus('unloaded');
        } catch (error) {
            error.unloadMayHaveStarted = true;
            throw error;
        }
        return {
            unloadedByClient: true,
            initialStatus: initialStatus.value
        };
    }

    async loadModel() {
        await this.postModelAction('load');
        await this.waitForStatus('loaded');
    }
}

module.exports = LlamaCppRouterClient;
