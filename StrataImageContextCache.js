const fs = require('fs');
const path = require('path');
const axios = require('axios');
const StrataVramClient = require('./StrataVramClient.js');
const { DEFAULT_STRATA_CONTEXT_CACHE_DIRECTORY } = require('./ImageGenerationHandoff.js');
const { throwIfAborted } = require('./image_client_utils.js');

/** One disposable disk snapshot across an already-exclusive image batch. */
class StrataImageContextCache {
    constructor({ endpoint, model, headers = {}, contextCacheDirectory = DEFAULT_STRATA_CONTEXT_CACHE_DIRECTORY, filename,
        ensureRuntimeReady, timeoutMs = 600000, httpClient = axios,
        fileSystem = fs.promises, uid = process.getuid(), signal = null } = {}) {
        if (typeof model !== 'string' || !model.trim()) throw new Error('Strata image context cache requires a model.');
        if (typeof contextCacheDirectory !== 'string' || !path.isAbsolute(contextCacheDirectory)) {
            throw new Error('Strata image context cache requires an absolute contextCacheDirectory.');
        }
        if (typeof filename !== 'string' || !/^strata_image_cache_[1-9]\d*\.bin$/.test(filename)) {
            throw new Error('Strata image context cache filename must use an allocated strata_image_cache integer ID and .bin extension.');
        }
        if (typeof ensureRuntimeReady !== 'function') throw new TypeError('Strata image context cache requires ensureRuntimeReady().');
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Strata image context cache timeoutMs must be positive.');
        if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw new TypeError('Strata image context cache headers must be an object.');
        if (typeof httpClient?.get !== 'function' || typeof httpClient?.post !== 'function') throw new TypeError('Strata image context cache HTTP client requires get() and post().');
        this.apiBaseUrl = StrataVramClient.resolveApiBaseUrl(endpoint);
        this.rootUrl = this.apiBaseUrl.replace(/\/v1$/, '');
        Object.assign(this, { model: model.trim(), headers: { ...headers, 'Content-Type': 'application/json' },
            directory: path.resolve(contextCacheDirectory), filename, ensureRuntimeReady,
            timeoutMs, httpClient, fileSystem, uid, signal });
        this.filePath = path.join(this.directory, filename);
        this.identity = null;
        this.ownership = null;
        this.snapshot = null;
    }

    get hasSavedSnapshot() { return this.snapshot !== null; }

    options({ recovery = false, dispatchedSave = false } = {}) {
        return { headers: { ...this.headers }, timeout: this.timeoutMs,
            ...(!recovery && !dispatchedSave && this.signal ? { signal: this.signal } : {}) };
    }

    async validateDirectory() {
        const stat = await this.fileSystem.lstat(this.directory);
        const trustedOwner = stat.uid === 0 || stat.uid === this.uid;
        const sharedWrite = (stat.mode & 0o022) !== 0;
        const sticky = (stat.mode & 0o1000) !== 0;
        if (!stat.isDirectory() || stat.isSymbolicLink() || !trustedOwner || (sharedWrite && !sticky)) {
            throw new Error(`Strata image context cache directory ${this.directory} must be a real directory owned by root or the AI RPG user; group/other-writable directories require the sticky bit (for example, /tmp mode 1777).`);
        }
        if (await this.fileSystem.realpath(this.directory) !== this.directory) {
            throw new Error(`Strata image context cache directory ${this.directory} must not traverse symbolic links.`);
        }
        await this.fileSystem.access(this.directory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    }

    async verifyIdentity({ recovery = false } = {}) {
        if (!recovery) throwIfAborted(this.signal, 'Strata image context save cancelled.');
        const ownership = await this.ensureRuntimeReady(recovery ? {} : { signal: this.signal });
        if (!ownership || typeof ownership.ownerId !== 'string' || !ownership.ownerId
            || typeof ownership.instanceId !== 'string' || !ownership.instanceId
            || !Number.isSafeInteger(ownership.hostPid) || ownership.hostPid <= 0
            || !Number.isSafeInteger(ownership.apiStarted) || ownership.apiStarted < 0) {
            throw new Error('Strata image context cache requires verified managed runtime ownership and API start identity.');
        }
        if (this.ownership && ['ownerId', 'instanceId', 'hostPid', 'apiStarted'].some(key => ownership[key] !== this.ownership[key])) {
            throw new Error('Strata managed runtime identity changed during image context caching; refusing session restore.');
        }
        const { data } = await this.httpClient.get(`${this.apiBaseUrl}/status`, this.options({ recovery }));
        if (data?.service !== 'strata' || data.model !== this.model || data.loaded !== true
            || !Number.isSafeInteger(data.started) || data.started < 0 || data.started !== ownership.apiStarted) {
            throw new Error(`Strata image context cache status must identify the loaded owned model "${this.model}" and its API start identity.`);
        }
        if (this.identity !== null && data.started !== this.identity) throw new Error('Strata server changed during image context caching.');
        this.identity = data.started;
        this.ownership = { ...ownership };
    }

    validateResponse(data, action) {
        const tokenKey = action === 'save' ? 'n_saved' : 'n_restored';
        const byteKey = action === 'save' ? 'n_written' : 'n_read';
        const timingKey = action === 'save' ? 'save_ms' : 'restore_ms';
        if (data?.id_slot !== 0 || data.filename !== this.filename) {
            throw new Error(`Strata image context ${action} must confirm slot 0 and filename ${this.filename}.`);
        }
        for (const key of [tokenKey, byteKey]) {
            if (!Number.isSafeInteger(data[key]) || data[key] <= 0) throw new Error(`Strata image context ${action} returned invalid ${key}; expected a positive integer.`);
        }
        if (!Number.isFinite(data.timings?.[timingKey]) || data.timings[timingKey] < 0) {
            throw new Error(`Strata image context ${action} returned invalid timings.${timingKey}.`);
        }
        return data;
    }

    async verifyFile(bytes) {
        let stat;
        try { stat = await this.fileSystem.lstat(this.filePath); }
        catch (cause) {
            throw new Error(`Cannot inspect Strata image context snapshot ${this.filePath}. Check the native slot_save_path matches ai.strata_context_cache_directory. ${cause.message}`, { cause });
        }
        if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== this.uid || (stat.mode & 0o077) !== 0 || stat.size !== bytes) {
            throw new Error(`Strata image context snapshot ${this.filePath} must be a private regular file owned by AI RPG with exactly ${bytes} bytes. Check the native slot_save_path matches ai.strata_context_cache_directory.`);
        }
        return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
    }

    async save() {
        try {
            await this.validateDirectory();
            await this.verifyIdentity();
            let existing = null;
            try { existing = await this.fileSystem.lstat(this.filePath); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (existing) {
                throw new Error(`An earlier Strata image context snapshot remains at ${this.filePath}; recover or remove that disposable snapshot explicitly before retrying. Refusing to overwrite or restore an older batch's context.`);
            }
            let response;
            try {
                // Once dispatched, finish the bounded SAVE even if image cancellation
                // arrives. Its acknowledgement determines whether recovery is needed.
                response = await this.httpClient.post(`${this.rootUrl}/slots/0?action=save`,
                    { filename: this.filename }, this.options({ dispatchedSave: true }));
            } catch (error) {
                const refusal = error?.response?.data?.error;
                if (error?.response?.status === 400 && refusal?.kind === 'invalid'
                    && refusal.message === 'no complete session to save' && refusal.published !== true) {
                    await this.verifyIdentity({ recovery: true });
                    return { saved: false, reason: 'no_complete_session' };
                }
                throw error;
            }
            const data = this.validateResponse(response?.data, 'save');
            const file = await this.verifyFile(data.n_written);
            this.snapshot = { ...file, tokens: data.n_saved, bytes: data.n_written };
            await this.verifyIdentity({ recovery: true });
            return { saved: true, filename: this.filename, tokens: data.n_saved, bytes: data.n_written };
        } catch (cause) {
            throw new Error(`Failed to save Strata image context at ${this.filePath}: ${cause.message}`, { cause });
        }
    }

    async restore() {
        if (!this.snapshot) throw new Error('Strata image context restore requires a verified snapshot saved by this image batch.');
        try {
            await this.verifyIdentity({ recovery: true });
            const file = await this.verifyFile(this.snapshot.bytes);
            if (['dev', 'ino', 'size', 'mtimeMs'].some(key => file[key] !== this.snapshot[key])) {
                throw new Error('Strata image context snapshot changed during rendering; refusing to restore an unrelated context.');
            }
            const response = await this.httpClient.post(`${this.rootUrl}/slots/0?action=restore`,
                { filename: this.filename }, this.options({ recovery: true }));
            const data = this.validateResponse(response?.data, 'restore');
            if (data.n_restored !== this.snapshot.tokens || data.n_read !== this.snapshot.bytes) {
                throw new Error('Strata image context restore token/byte counts do not match this batch\'s saved snapshot.');
            }
            await this.verifyIdentity({ recovery: true });
            // Delete only this client's acknowledged snapshot, never scan cache/log directories.
            await this.fileSystem.unlink(this.filePath);
            this.snapshot = null;
            return data;
        } catch (cause) {
            throw new Error(`Failed to restore Strata image context; snapshot retained at ${this.filePath}: ${cause.message}`, { cause });
        }
    }
}

module.exports = StrataImageContextCache;
