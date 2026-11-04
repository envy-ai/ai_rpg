const fs = require('fs');
const path = require('path');
const axios = require('axios');
const CodexBridgeClient = require('./CodexBridgeClient.js');
const { StrataRuntimeService, runCommand } = require('./StrataRuntimeService.js');

function apiBaseUrl(endpoint) {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash) {
        throw new Error('Managed Strata requires an HTTP endpoint without credentials, query, or fragment.');
    }
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/i, '').replace(/\/v1\/?$/i, '').replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '');
}

function resolveStrataRuntimeConfiguration(aiConfig) {
    const value = aiConfig?.strata_runtime;
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('ai.strata_runtime must be an object or null.');
    for (const key of Object.keys(value)) {
        if (!['executable', 'profile', 'resources', 'termination_trace_path'].includes(key)) throw new Error(`Unknown ai.strata_runtime field: ${key}`);
    }
    if (typeof value.executable !== 'string' || !value.executable.trim() || !path.isAbsolute(value.executable.trim())) {
        throw new Error('ai.strata_runtime.executable must be an absolute executable path.');
    }
    if (typeof value.profile !== 'string' || !value.profile.trim()) throw new Error('ai.strata_runtime.profile must be nonblank.');
    if (!value.resources || typeof value.resources !== 'object' || Array.isArray(value.resources)) throw new Error('ai.strata_runtime.resources is required.');
    for (const key of Object.keys(value.resources)) {
        if (!['memory_max_mib', 'memlock_mib', 'shm_size_mib'].includes(key)) throw new Error(`Unknown Strata runtime resource: ${key}`);
    }
    const resources = {};
    for (const key of ['memory_max_mib', 'memlock_mib', 'shm_size_mib']) {
        const amount = value.resources[key];
        if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(amount * 1048576)) throw new Error(`ai.strata_runtime.resources.${key} must be a positive safe integer in MiB.`);
        resources[key] = amount;
    }
    const terminationTracePath = value.termination_trace_path ?? null;
    if (terminationTracePath !== null && (typeof terminationTracePath !== 'string' || !path.isAbsolute(terminationTracePath) || /[\n\r\0]/.test(terminationTracePath))) {
        throw new Error('ai.strata_runtime.termination_trace_path must be an absolute path or null.');
    }
    if (CodexBridgeClient.normalizeBackend(aiConfig.backend) !== 'openai_compatible') {
        throw new Error('ai.strata_runtime requires the openai_compatible backend.');
    }
    if (typeof aiConfig.model !== 'string' || !aiConfig.model.trim()) throw new Error('ai.strata_runtime requires a configured model.');
    const endpoint = apiBaseUrl(aiConfig.endpoint);
    if (aiConfig.unload_during_image_generation === true || aiConfig.terminate_during_image_generation === true
        || (typeof aiConfig.local_startup_script_path === 'string' && aiConfig.local_startup_script_path.trim())) {
        throw new Error('ai.strata_runtime cannot use llama startup, unload, or termination controls.');
    }
    return Object.freeze({ executable: value.executable.trim(), profile: value.profile.trim(), endpoint, model: aiConfig.model.trim(),
        resources: Object.freeze(resources), terminationTracePath });
}

function validateStrataRuntimeConfigurations(configuration, resolveEffectiveAiConfiguration) {
    const root = resolveStrataRuntimeConfiguration(configuration?.ai);
    const labels = new Set();
    for (const profile of Object.values(configuration?.ai_model_overrides || {})) {
        for (const label of Array.isArray(profile?.prompts) ? profile.prompts : []) {
            if (typeof label === 'string' && label.trim()) labels.add(label.trim());
        }
    }
    const targets = [{ label: 'ai', ai: configuration?.ai }];
    for (const label of labels) targets.push({ label: `prompt "${label}"`, ai: resolveEffectiveAiConfiguration(label, configuration).aiConfig });
    if (configuration?.ai_multimodal?.enabled === true) {
        const multimodalAi = { ...configuration.ai, ...configuration.ai_multimodal };
        targets.push({ label: 'ai_multimodal', ai: multimodalAi });
        for (const label of labels) {
            targets.push({ label: `multimodal prompt "${label}"`, ai: resolveEffectiveAiConfiguration(label,
                { ...configuration, ai: multimodalAi }).aiConfig });
        }
    }
    if (root && (configuration.unload_model_on_switch === true
        || (typeof configuration.router_preload_model === 'string' && configuration.router_preload_model.trim()))) {
        throw new Error('Managed Strata cannot use router model preloading or unload_model_on_switch.');
    }
    for (const target of targets) {
        try {
            const selected = resolveStrataRuntimeConfiguration(target.ai);
            if (selected && (!root || JSON.stringify(selected) !== JSON.stringify(root))) {
                throw new Error('Managed Strata prompt ownership, endpoint, and model must match the root ai.strata_runtime target.');
            }
            if (root && (target.ai?.unload_during_image_generation === true || target.ai?.terminate_during_image_generation === true
                || (typeof target.ai?.local_startup_script_path === 'string' && target.ai.local_startup_script_path.trim()))) {
                throw new Error('Managed Strata cannot coexist with effective llama startup, unload, or termination controls.');
            }
        } catch (cause) {
            throw new Error(`${target.label}: ${cause.message}`, { cause });
        }
    }
    return root;
}

function readProcessStartToken(pid) {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/);
    if (!/^\d+$/.test(fields[19] || '')) throw new Error(`Cannot attest process start identity for PID ${pid}.`);
    return `l:${fields[19]}`;
}

function attestRuntimeHost({ hostPid, profile, ownerPid, ownerToken }) {
    if (!Number.isSafeInteger(hostPid) || hostPid <= 0) return false;
    const args = fs.readFileSync(`/proc/${hostPid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    const hasPair = (key, value) => args.filter(arg => arg === key).length === 1 && args[args.indexOf(key) + 1] === value;
    return hasPair('-m', 'strata_control.runtime') && hasPair('--host', profile)
        && hasPair('--die-with-pid', String(ownerPid)) && hasPair('--die-with-token', ownerToken);
}


class StrataRuntime {
    constructor({ executable, profile, endpoint, model, resources, terminationTracePath = null, runtimeService = null, createRuntimeService = null, ownerPid = process.pid, ownerToken = readProcessStartToken(ownerPid),
        timeoutMs = 600000, beforeStart = async () => {}, runCommand: command = runCommand,
        httpClient = axios, attestHost = attestRuntimeHost, logger = console } = {}) {
        const selected = resolveStrataRuntimeConfiguration({ backend: 'openai_compatible', model, endpoint, strata_runtime: { executable, profile, resources, termination_trace_path: terminationTracePath } });
        if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0 || typeof ownerToken !== 'string' || !ownerToken) throw new Error('Managed Strata requires its owning process identity.');
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600000) throw new Error('Managed Strata timeoutMs must be positive and no more than 600000.');
        if (typeof beforeStart !== 'function' || typeof command !== 'function' || typeof attestHost !== 'function' || typeof httpClient?.get !== 'function') {
            throw new TypeError('Managed Strata requires startup, CLI, host-attestation, and HTTP callbacks.');
        }
        Object.assign(this, selected, { ownerPid, ownerToken, timeoutMs, beforeStart, command, httpClient, attestHost, logger });
        this.createRuntimeService = createRuntimeService || (() => new StrataRuntimeService({ ownerPid, ownerToken, resources: selected.resources, terminationTracePath }));
        this.runtimeService = runtimeService || this.createRuntimeService();
        this.serviceStopped = false;
        for (const method of ['startCommand', 'verifyRuntime', 'stop']) {
            if (typeof this.runtimeService[method] !== 'function') throw new TypeError(`Managed Strata service requires ${method}().`);
        }
        this.ownership = null;
        this.operation = Promise.resolve();
        this.stopping = false;
    }

    getOwnership() { return this.ownership ? { ...this.ownership } : null; }

    enqueue(task) {
        const result = this.operation.then(task, task);
        this.operation = result.then(() => undefined, () => undefined);
        return result;
    }

    async cli(action, extra = [], timeoutMs = this.timeoutMs, signal = null) {
        const command = action === 'start' ? this.runtimeService.startCommand.bind(this.runtimeService) : this.command;
        const result = await command({ executable: this.executable, args: ['runtime', action, '--profile', this.profile, ...extra, '--json'], timeoutMs, ...(signal ? { signal } : {}) });
        let data;
        try { data = JSON.parse(result.stdout); } catch (cause) { throw new Error(`Strata runtime ${action} returned invalid JSON.`, { cause }); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Strata runtime ${action} returned no status object.`);
        if (result.exitCode !== 0) throw new Error(`Strata runtime ${action} failed (exit ${result.exitCode}): ${data.error || data.phase || data.state || result.stderr}`);
        return data;
    }

    async captureOwnership(status, expected = null) {
        if (typeof status.owner_id !== 'string' || !status.owner_id || typeof status.instance_id !== 'string' || !status.instance_id) {
            throw new Error('Strata runtime has no complete owner/instance identity; owner-death cleanup remains armed.');
        }
        if (expected && (status.owner_id !== expected.owner_id || status.instance_id !== expected.instance_id)) {
            throw new Error('Strata runtime changed after startup; refusing replacement ownership.');
        }
        if (!await this.attestHost({ hostPid: status.host_pid, profile: this.profile, ownerPid: this.ownerPid, ownerToken: this.ownerToken })) {
            throw new Error('Strata runtime host does not attest this AI RPG process; refusing adoption or cleanup.');
        }
        await this.runtimeService.verifyRuntime(status);
        this.ownership = { ownerId: status.owner_id, instanceId: status.instance_id, hostPid: status.host_pid, apiStarted: null };
    }

    async verifyStatus(status, { allowRamStandby = false, signal = null } = {}) {
        const owned = this.ownership;
        if (!owned || status.owner_id !== owned.ownerId || status.instance_id !== owned.instanceId || status.host_pid !== owned.hostPid) {
            throw new Error('Managed Strata ownership changed or the owned runtime exited.');
        }
        if (status.state !== 'ready' || status.api_identity_verified !== true || status.launch_attested !== true || status.generation_ready !== true) {
            throw new Error(`Managed Strata is not ready with verified launch identity (state=${status.state}).`);
        }
        await this.runtimeService.verifyRuntime(status, { signal });
        if (apiBaseUrl(status.api_url) !== this.endpoint) throw new Error('Managed Strata runtime endpoint does not match the configured endpoint.');
        const response = await this.httpClient.get(`${this.endpoint}/v1/status`, { timeout: this.timeoutMs, ...(signal ? { signal } : {}) });
        const api = response?.data;
        if (api?.service !== 'strata' || api.model !== this.model || !Number.isSafeInteger(api.started) || api.started < 0) {
            throw new Error('Managed Strata HTTP status does not match its configured service/model/start identity.');
        }
        const ramResident = allowRamStandby && api.gpu_residency?.state === 'ram_resident';
        if (api.loaded !== true && !ramResident) throw new Error('Managed Strata model is neither loaded nor in permitted RAM standby.');
        if (owned.apiStarted !== null && api.started !== owned.apiStarted) throw new Error('Managed Strata HTTP server identity changed.');
        owned.apiStarted = api.started;
        return this.getOwnership();
    }

    start() {
        return this.enqueue(async () => {
            if (this.ownership) return this.verifyStatus(await this.cli('status'));
            if (this.serviceStopped) {
                this.runtimeService = this.createRuntimeService();
                this.serviceStopped = false;
            }
            const before = await this.cli('status');
            if (before.state !== 'stopped' || before.owner_id || before.host_pid) {
                throw new Error(`Strata runtime is already ${before.state} or retains an owner; refusing to adopt or stop an external instance.`);
            }
            await this.beforeStart();
            let expected = null;
            try {
                const started = await this.cli('start', ['--die-with-pid', String(this.ownerPid), '--wait', String(Math.ceil(this.timeoutMs / 1000))], this.timeoutMs + 5000);
                if (started.owner_id && started.instance_id) expected = started;
                const status = await this.cli('status');
                await this.captureOwnership(status, expected);
                const identity = await this.verifyStatus(status);
                this.logger.log(`🧠 Started AI RPG-owned Strata profile "${this.profile}" (${identity.ownerId}/${identity.instanceId}).`);
                return identity;
            } catch (cause) {
                try {
                    if (!this.ownership) {
                        try { await this.captureOwnership(await this.cli('status'), expected); }
                        catch (ownershipError) {
                            // Only the proven unique service can be cleaned before runtime identity is published.
                            await this.runtimeService.stop();
                            this.serviceStopped = true;
                        }
                    }
                    if (this.ownership) await this.stopOwned();
                } catch (cleanupError) {
                    throw new AggregateError([cause, cleanupError], 'Strata startup failed; exact owned cleanup could not complete. Owner-death cleanup remains armed.');
                }
                throw cause;
            }
        });
    }

    ensureReady({ endpoint = this.endpoint, model = this.model, signal = null, allowRamStandby = false } = {}) {
        if (this.stopping) return Promise.reject(new Error('Managed Strata is shutting down.'));
        return this.enqueue(async () => {
            if (this.stopping) throw new Error('Managed Strata is shutting down.');
            if (signal?.aborted) throw signal.reason || new Error('Managed Strata readiness cancelled.');
            if (apiBaseUrl(endpoint) !== this.endpoint || model !== this.model) throw new Error('Prompt endpoint/model does not match the AI RPG-owned Strata target.');
            return this.verifyStatus(await this.cli('status', [], this.timeoutMs, signal), { allowRamStandby, signal });
        });
    }

    async stopOwned() {
        const owned = this.ownership;
        if (!owned) {
            const result = await this.runtimeService.stop();
            this.serviceStopped = true;
            return result;
        }
        let failure = null;
        let alreadyExited = false;
        try {
            const current = await this.cli('status');
            alreadyExited = current.state === 'stopped' && !current.owner_id && !current.host_pid;
            if (!alreadyExited) {
                if (current.owner_id !== owned.ownerId || current.instance_id !== owned.instanceId || current.host_pid !== owned.hostPid) {
                    throw new Error('Strata ownership changed; refusing to stop a replacement or unowned runtime.');
                }
                await this.runtimeService.verifyRuntime(current);
                // The installed CLI's stale-owner cleanup precedes its guards; stop only our exact unit.

            }
        } catch (cause) { failure = cause; }
        try { await this.runtimeService.stop(); }
        catch (cleanupError) {
            if (failure) throw new AggregateError([failure, cleanupError], 'Strata runtime and owned-service cleanup failed.');
            throw cleanupError;
        }
        this.ownership = null;
        this.serviceStopped = true;
        if (failure) throw failure;
        return { ...owned, stopped: true, ...(alreadyExited ? { alreadyExited: true } : {}) };
    }

    stop() {
        this.stopping = true;
        return this.enqueue(async () => {
            try { return await this.stopOwned(); } finally { this.stopping = false; }
        });
    }
}

module.exports = { StrataRuntime, resolveStrataRuntimeConfiguration, validateStrataRuntimeConfigurations, attestRuntimeHost, readProcessStartToken };
