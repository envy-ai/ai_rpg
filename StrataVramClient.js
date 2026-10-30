const axios = require('axios');
const { DEFAULT_STRATA_MIN_FREE_VRAM_MIB } = require('./ImageGenerationHandoff.js');
const { throwIfAborted } = require('./image_client_utils.js');

/** Coordinate Strata GPU ownership while retaining the configured endpoint and model identity. */
class StrataVramClient {
    constructor({ endpoint, model, minFreeVramMiB = DEFAULT_STRATA_MIN_FREE_VRAM_MIB, headers = {},
        timeoutMs = 120000, httpClient = axios, signal = null, handoffMode = 'elastic' } = {}) {
        if (typeof endpoint !== 'string' || !endpoint.trim()) throw new Error('Strata endpoint is required.');
        if (typeof model !== 'string' || !model.trim()) throw new Error('Strata model is required.');
        if (!Number.isSafeInteger(minFreeVramMiB) || minFreeVramMiB <= 0) throw new Error('Strata minFreeVramMiB must be a positive integer.');
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Strata timeoutMs must be positive.');
        if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw new Error('Strata headers must be an object.');
        if (typeof httpClient?.get !== 'function' || typeof httpClient?.post !== 'function') {
            throw new Error('Strata HTTP client must expose get() and post().');
        }
        if (handoffMode !== 'elastic' && handoffMode !== 'ram_standby') {
            throw new Error('Strata handoffMode must be "elastic" or "ram_standby".');
        }
        this.baseUrl = StrataVramClient.resolveApiBaseUrl(endpoint);
        this.model = model.trim();
        this.minFreeVramMiB = minFreeVramMiB;
        this.headers = { ...headers, 'Content-Type': 'application/json' };
        this.timeoutMs = timeoutMs;
        this.httpClient = httpClient;
        this.signal = signal;
        this.handoffMode = handoffMode;
        this.identity = null;
        this.instanceId = null;
        this.releaseMayHaveStarted = false;
    }

    static resolveApiBaseUrl(endpoint) {
        const url = new URL(endpoint.trim());
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Strata endpoint must use HTTP or HTTPS.');
        url.search = '';
        url.hash = '';
        url.pathname = url.pathname.replace(/\/chat\/completions\/?$/i, '').replace(/\/v1\/?$/i, '').replace(/\/+$/, '') + '/v1';
        return url.toString().replace(/\/$/, '');
    }

    requestOptions({ recovery = false } = {}) {
        if (!recovery) throwIfAborted(this.signal, 'Strata handoff cancelled.');
        return { headers: { ...this.headers }, timeout: this.timeoutMs,
            ...(!recovery && this.signal ? { signal: this.signal } : {}) };
    }

    async getStatus({ recovery = false, requireLoaded = true } = {}) {
        const response = await this.httpClient.get(`${this.baseUrl}/status`, this.requestOptions({ recovery }));
        const status = response?.data;
        if (!status || status.service !== 'strata' || status.model !== this.model) {
            throw new Error(`Strata status must identify service "strata" and configured model "${this.model}".`);
        }
        if (this.handoffMode === 'ram_standby') {
            if (status.gpu_residency?.capable !== true || !['gpu_ready', 'ram_resident'].includes(status.gpu_residency?.state)) {
                throw new Error(`Strata model "${this.model}" must support RAM standby and report a valid GPU residency state.`);
            }
            if (!Number.isSafeInteger(status.gpu_residency.locked_mib) || status.gpu_residency.locked_mib <= 0) {
                throw new Error('Strata status must confirm locked model pages for RAM standby.');
            }
            if (requireLoaded && (status.loaded !== true || status.gpu_residency.state !== 'gpu_ready')) {
                throw new Error(`Strata model "${this.model}" must already be GPU ready before RAM standby.`);
            }
        } else if (status.loaded !== true || status.vram?.elastic !== true) {
            throw new Error(`Strata model "${this.model}" must already be loaded with elastic VRAM enabled.`);
        }
        if (!Number.isSafeInteger(status.started) || status.started < 0) {
            throw new Error('Strata status is missing its server start identity.');
        }
        if (!Number.isSafeInteger(status.machine?.gpu?.total_mib) || status.machine.gpu.total_mib <= 0) {
            throw new Error('Strata status is missing a positive integer machine.gpu.total_mib.');
        }
        if (this.identity !== null && status.started !== this.identity) {
            throw new Error('Strata server identity changed during the image handoff.');
        }
        if (this.handoffMode === 'ram_standby') {
            const id = status.gpu_residency.instance_id;
            if (typeof id !== 'string' || !id) throw new Error('Strata RAM standby status is missing its instance identity.');
            if (this.instanceId !== null && id !== this.instanceId) {
                throw new Error('Strata server instance changed during the image handoff.');
            }
        }
        return status;
    }

    validateResize(data) {
        if (!data || data.status !== 'ok') throw new Error('Strata VRAM resize did not return status "ok" for a loaded model.');
        for (const key of ['reserve_mib', 'vram_free_mib', 'expert_cache_mib', 'expert_cache_full_mib', 'expert_slots', 'expert_slots_full']) {
            if (!Number.isSafeInteger(data[key]) || data[key] < 0) throw new Error(`Strata VRAM response has invalid ${key}.`);
        }
        if (data.expert_cache_mib > data.expert_cache_full_mib || data.expert_slots > data.expert_slots_full) {
            throw new Error('Strata VRAM response exceeds its full expert cache.');
        }
        return data;
    }

    async releaseForImages() {
        if (this.handoffMode !== 'elastic') throw new Error('Elastic VRAM release requires handoffMode "elastic".');
        try {
            const status = await this.getStatus();
            this.identity = status.started;
            const totalMiB = status.machine.gpu.total_mib;
            if (this.minFreeVramMiB > totalMiB) {
                throw new Error(`Strata minimum free VRAM ${this.minFreeVramMiB} MiB exceeds GPU total ${totalMiB} MiB.`);
            }
            const options = this.requestOptions();
            this.releaseMayHaveStarted = true; // An HTTP timeout cannot prove the control command did not run.
            const response = await this.httpClient.post(`${this.baseUrl}/vram`, { reserve_mib: totalMiB }, options);
            const result = this.validateResize(response?.data);
            if (result.reserve_mib !== totalMiB) throw new Error('Strata did not confirm the requested GPU-total VRAM reserve.');
            if (result.vram_free_mib < this.minFreeVramMiB) {
                throw new Error(`Strata freed ${result.vram_free_mib} MiB total; image rendering requires ${this.minFreeVramMiB} MiB.`);
            }
            await this.getStatus();
            throwIfAborted(this.signal, 'Strata handoff cancelled before image rendering.');
            return result;
        } catch (error) {
            error.releaseMayHaveStarted = this.releaseMayHaveStarted;
            throw error;
        }
    }

    async restore() {
        if (this.handoffMode !== 'elastic') throw new Error('Elastic VRAM restore requires handoffMode "elastic".');
        // Recovery is deliberately independent of an aborted image/prompt signal.
        await this.getStatus({ recovery: true });
        const response = await this.httpClient.post(`${this.baseUrl}/vram`, { reserve_mib: null }, this.requestOptions({ recovery: true }));
        const result = this.validateResize(response?.data);
        await this.getStatus({ recovery: true });
        this.releaseMayHaveStarted = false;
        return result;
    }

    async standbyForImages() {
        if (this.handoffMode !== 'ram_standby') throw new Error('RAM standby requires handoffMode "ram_standby".');
        try {
            const status = await this.getStatus({ requireLoaded: false });
            this.identity = status.started;
            this.instanceId = status.gpu_residency.instance_id;
            const totalMiB = status.machine.gpu.total_mib;
            if (this.minFreeVramMiB > totalMiB) {
                throw new Error(`Strata minimum free VRAM ${this.minFreeVramMiB} MiB exceeds GPU total ${totalMiB} MiB.`);
            }
            this.releaseMayHaveStarted = true;
            const response = await this.httpClient.post(`${this.baseUrl}/standby`, { model: this.model }, this.requestOptions());
            const data = response?.data;
            if (data?.status !== 'ram_resident' || data.gpu_residency?.state !== 'ram_resident'
                || data.gpu_residency?.engine_pid !== null || data.gpu_residency?.vision_pid !== null
                || !Number.isSafeInteger(data.gpu_residency?.locked_mib) || data.gpu_residency.locked_mib <= 0
                || !Number.isSafeInteger(data.vram_free_mib) || data.vram_free_mib < this.minFreeVramMiB) {
                throw new Error('Strata did not confirm complete RAM standby, stopped GPU workers, and sufficient free VRAM.');
            }
            const after = await this.getStatus({ requireLoaded: false });
            if (after.loaded !== false || after.gpu_residency.state !== 'ram_resident'
                || after.gpu_residency.engine_pid !== null || after.gpu_residency.vision_pid !== null) {
                throw new Error('Strata status does not confirm RAM residency after standby.');
            }
            throwIfAborted(this.signal, 'Strata handoff cancelled before image rendering.');
            this.releaseMayHaveStarted = false;
            return data;
        } catch (error) {
            error.releaseMayHaveStarted = this.releaseMayHaveStarted;
            throw error;
        }
    }
}

module.exports = StrataVramClient;
