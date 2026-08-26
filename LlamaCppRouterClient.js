const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

class LlamaCppRouterClient {
    constructor({
        endpoint,
        model,
        headers = {},
        timeoutMs = 120000,
        pollIntervalMs = 250,
        statusRetryAttempts = 2,
        statusRetryDelayMs = 250,
        slotId = 0,
        slotCacheDirectory = '/dev/shm',
        httpClient = axios,
        fileSystem = fs,
        sleep = null,
        logger = console,
        signal = null
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
        if (!Number.isInteger(slotId) || slotId < 0) {
            throw new Error('llama.cpp router slotId must be a non-negative integer.');
        }
        if (
            typeof slotCacheDirectory !== 'string'
            || !slotCacheDirectory.trim()
            || !path.isAbsolute(slotCacheDirectory.trim())
        ) {
            throw new Error('llama.cpp router slotCacheDirectory must be an absolute path.');
        }
        if (!httpClient || typeof httpClient.get !== 'function' || typeof httpClient.post !== 'function') {
            throw new Error('llama.cpp router HTTP client must expose get() and post().');
        }
        if (
            !fileSystem?.promises
            || typeof fileSystem.promises.access !== 'function'
            || typeof fileSystem.promises.unlink !== 'function'
        ) {
            throw new Error('llama.cpp router fileSystem must expose promises.access() and promises.unlink().');
        }
        if (!logger || typeof logger.warn !== 'function') {
            throw new Error('llama.cpp router logger must expose warn().');
        }
        if (
            signal !== null
            && (
                typeof signal !== 'object'
                || typeof signal.aborted !== 'boolean'
                || typeof signal.addEventListener !== 'function'
            )
        ) {
            throw new Error('llama.cpp router signal must be an AbortSignal when provided.');
        }

        this.baseUrl = LlamaCppRouterClient.resolveRouterBaseUrl(endpoint);
        this.model = model.trim();
        this.headers = { ...headers };
        this.timeoutMs = timeoutMs;
        this.pollIntervalMs = pollIntervalMs;
        this.statusRetryAttempts = statusRetryAttempts;
        this.statusRetryDelayMs = statusRetryDelayMs;
        this.slotId = slotId;
        this.slotCacheDirectory = path.normalize(slotCacheDirectory.trim());
        this.httpClient = httpClient;
        this.fileSystem = fileSystem;
        this.logger = logger;
        this.signal = signal;
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

    static buildSlotCacheFilename(model) {
        if (typeof model !== 'string' || !model.trim()) {
            throw new Error('llama.cpp slot-cache model is required.');
        }
        const normalizedModel = model.trim();
        const safeModel = normalizedModel
            .normalize('NFKD')
            .replace(/[^A-Za-z0-9._-]+/g, '_')
            .replace(/^[_\.\-]+|[_\.\-]+$/g, '')
            .slice(0, 180) || 'model';
        const digest = createHash('sha256').update(normalizedModel).digest('hex').slice(0, 12);
        return `${safeModel}-${digest}-cache.bin`;
    }

    requestOptions() {
        this.throwIfAborted();
        return {
            headers: { ...this.headers },
            timeout: this.timeoutMs,
            ...(this.signal ? { signal: this.signal } : {})
        };
    }

    throwIfAborted() {
        if (!this.signal?.aborted) {
            return;
        }
        if (this.signal.reason instanceof Error) {
            throw this.signal.reason;
        }
        const error = new Error(
            typeof this.signal.reason === 'string' && this.signal.reason.trim()
                ? this.signal.reason.trim()
                : `llama.cpp router operation for model "${this.model}" was cancelled.`
        );
        error.name = 'AbortError';
        error.code = 'ERR_CANCELED';
        throw error;
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
        this.throwIfAborted();
        const url = `${this.baseUrl}/models`;
        const totalAttempts = this.statusRetryAttempts + 1;
        let response;
        for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
            this.throwIfAborted();
            try {
                response = await this.httpClient.get(url, this.requestOptions());
                this.throwIfAborted();
                break;
            } catch (error) {
                this.throwIfAborted();
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
                this.throwIfAborted();
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
        this.throwIfAborted();
        let response;
        try {
            response = await this.httpClient.post(
                `${this.baseUrl}/models/${action}`,
                { model: this.model },
                this.requestOptions()
            );
            this.throwIfAborted();
        } catch (error) {
            this.throwIfAborted();
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

    getSlotCacheFilename() {
        return LlamaCppRouterClient.buildSlotCacheFilename(this.model);
    }

    getSlotCachePath(filename = this.getSlotCacheFilename()) {
        if (
            typeof filename !== 'string'
            || !filename.trim()
            || filename.trim() !== filename
            || path.basename(filename) !== filename
        ) {
            throw new Error('llama.cpp slot-cache filename must be a safe relative filename.');
        }
        return path.join(this.slotCacheDirectory, filename);
    }

    async slotCacheFileExists(filename = this.getSlotCacheFilename()) {
        this.throwIfAborted();
        const cachePath = this.getSlotCachePath(filename);
        try {
            await this.fileSystem.promises.access(cachePath);
            this.throwIfAborted();
            return true;
        } catch (error) {
            this.throwIfAborted();
            if (error?.code === 'ENOENT') {
                return false;
            }
            throw new Error(
                `Failed to inspect llama.cpp slot cache for model "${this.model}" at ${cachePath}: ${error?.message || String(error)}`,
                { cause: error }
            );
        }
    }

    async postSlotAction(action, filename = this.getSlotCacheFilename()) {
        this.throwIfAborted();
        if (action !== 'save' && action !== 'restore') {
            throw new Error(`Unsupported llama.cpp slot-cache action "${action}".`);
        }
        this.getSlotCachePath(filename);
        const normalizedFilename = filename;
        let response;
        try {
            response = await this.httpClient.post(
                `${this.baseUrl}/slots/${this.slotId}?action=${action}`,
                {
                    model: this.model,
                    filename: normalizedFilename
                },
                this.requestOptions()
            );
            this.throwIfAborted();
        } catch (error) {
            this.throwIfAborted();
            throw new Error(
                `Failed to ${action} llama.cpp slot ${this.slotId} cache for model "${this.model}": ${this.describeHttpError(error)}`,
                { cause: error }
            );
        }
        const result = response?.data;
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
            throw new Error(
                `llama.cpp router returned an invalid slot ${action} response for model "${this.model}".`
            );
        }
        if (Number(result.id_slot) !== this.slotId || result.filename !== normalizedFilename) {
            throw new Error(
                `llama.cpp router slot ${action} response did not match slot ${this.slotId} and file "${normalizedFilename}".`
            );
        }
        return result;
    }

    async saveSlotCache(filename = this.getSlotCacheFilename()) {
        const result = await this.postSlotAction('save', filename);
        const cachePath = this.getSlotCachePath(filename);
        if (!await this.slotCacheFileExists(filename)) {
            throw new Error(
                `llama.cpp router reported a saved slot cache for model "${this.model}", but ${cachePath} does not exist.`
            );
        }
        return {
            filename,
            cachePath,
            result
        };
    }

    async restoreSlotCacheIfPresent(filename = this.getSlotCacheFilename()) {
        const cachePath = this.getSlotCachePath(filename);
        if (!await this.slotCacheFileExists(filename)) {
            return {
                restored: false,
                filename,
                cachePath
            };
        }

        const result = await this.postSlotAction('restore', filename);
        try {
            await this.fileSystem.promises.unlink(cachePath);
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                const deleteError = new Error(
                    `Restored llama.cpp slot cache for model "${this.model}" but failed to delete ${cachePath}: ${error?.message || String(error)}`,
                    { cause: error }
                );
                deleteError.slotCacheDeleteFailed = true;
                throw deleteError;
            }
        }
        return {
            restored: true,
            deleted: true,
            filename,
            cachePath,
            result
        };
    }

    async waitForStatus(expectedStatus) {
        this.throwIfAborted();
        const expected = String(expectedStatus || '').trim().toLowerCase();
        if (!expected) {
            throw new Error('Expected llama.cpp model status is required.');
        }
        const deadline = Date.now() + this.timeoutMs;
        let lastStatus = null;

        while (true) {
            this.throwIfAborted();
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
            this.throwIfAborted();
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

    async loadModelIfNeeded() {
        const initialStatus = await this.getModelStatus();
        if (initialStatus.value === 'loaded' || initialStatus.value === 'sleeping') {
            return {
                loadedByClient: false,
                initialStatus: initialStatus.value
            };
        }
        if (initialStatus.value === 'loading') {
            await this.waitForStatus('loaded');
            return {
                loadedByClient: false,
                initialStatus: initialStatus.value
            };
        }
        if (initialStatus.value === 'unloading') {
            await this.waitForStatus('unloaded');
        } else if (initialStatus.value !== 'unloaded') {
            throw new Error(
                `llama.cpp router model "${this.model}" cannot be loaded from unexpected status "${initialStatus.value}".`
            );
        }

        await this.loadModel();
        return {
            loadedByClient: true,
            initialStatus: initialStatus.value
        };
    }
}

module.exports = LlamaCppRouterClient;
