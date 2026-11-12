async function inspectWithPromptAwareDeadline(inspect, { hasActivePrompts, timeoutMs = 5000 } = {}) {
    if (typeof inspect !== 'function' || typeof hasActivePrompts !== 'function') {
        throw new TypeError('Managed local LLM inspection requires inspection and prompt-activity callbacks.');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError('Managed local LLM inspection timeoutMs must be a finite number > 0.');
    }
    if (hasActivePrompts()) return inspect(undefined);

    const controller = new AbortController();
    const timeout = setTimeout(() => {
        // A prompt may start while this inspection waits for Strata's serialized
        // runtime work. Waive this inspection's short deadline if that happens.
        if (hasActivePrompts()) return;
        controller.abort(new Error(`Managed local LLM status inspection timed out after ${timeoutMs}ms while no prompt was processing.`));
    }, timeoutMs);
    try {
        return await inspect(controller.signal);
    } catch (cause) {
        if (!controller.signal.aborted) throw cause;
        const error = new Error(controller.signal.reason.message, { cause });
        error.code = 'LOCAL_LLM_STATUS_TIMEOUT';
        error.stack += `\nInspection failure: ${cause?.stack || cause}`;
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

class ManagedLocalLlmController {
    constructor({ resolveConfiguration, inspect, start, stop, withExclusiveModelLifecycle, isPresent = () => false, desiredOn = true }) {
        for (const callback of [resolveConfiguration, inspect, start, stop, withExclusiveModelLifecycle]) {
            if (typeof callback !== 'function') throw new TypeError('Managed local LLM controller requires lifecycle callbacks.');
        }
        Object.assign(this, { resolveConfiguration, inspect, start, stop, withExclusiveModelLifecycle, isPresent });
        if (typeof desiredOn !== 'boolean') throw new TypeError('Managed local LLM initial desiredOn must be a boolean.');
        this.desiredOn = desiredOn;
        this.confirmedOff = !desiredOn;
        this.phase = null;
        // Explicit transition failures require explicit successful recovery.
        this.error = null;
        // Readiness failures belong to the latest inspection and can recover on a poll.
        this.inspectionError = null;
        this.statusInspection = null;
        this.operation = Promise.resolve();
        this.activityActive = false;
        this.pendingTransitions = 0;
        this.revision = 0;
    }
    isConfigured() { return Boolean(this.resolveConfiguration()); }
    snapshot(state = null) {
        const configuration = this.resolveConfiguration();
        const inspectionApplies = configuration && !this.phase && !this.activityActive
            && !(this.confirmedOff && !this.desiredOn);
        const error = this.error || (inspectionApplies ? this.inspectionError : null);
        const resolvedState = state || this.phase || (error ? 'error' : 'off');
        const nextEnabled = resolvedState === 'error'
            ? this.desiredOn && !this.isPresent()
            : !this.desiredOn;
        return { configured: Boolean(configuration), kind: configuration?.kind || null, desiredOn: this.desiredOn,
            nextEnabled, state: resolvedState,
            error: error ? { message: error.message, stack: error.stack } : null };
    }
    assertPromptAllowed() {
        if (this.isConfigured() && !this.desiredOn) {
            const error = new Error('The local LLM is switched off. Turn it on in the application header before sending a local prompt.');
            error.code = 'LOCAL_LLM_OFF';
            error.isModelSwitchError = true;
            throw error;
        }
    }
    async getStatus() {
        if (!this.isConfigured() || this.phase) return this.snapshot();
        if (this.error) return this.snapshot('error');
        if (this.confirmedOff && !this.desiredOn) return this.snapshot('off');
        if (this.activityActive) return this.snapshot('waiting');
        if (this.statusInspection?.revision === this.revision) return this.statusInspection.promise;
        const inspection = { revision: this.revision, promise: null };
        this.statusInspection = inspection;
        inspection.promise = this.#inspectStatus(inspection.revision).finally(() => {
            if (this.statusInspection === inspection) this.statusInspection = null;
        });
        return inspection.promise;
    }
    async #inspectStatus(observedRevision) {
        try {
            const running = await this.inspect();
            if (observedRevision !== this.revision) return this.getStatus();
            if (this.phase || this.activityActive) return this.snapshot(this.phase || 'waiting');
            if (!running && this.desiredOn) throw new Error('The managed local LLM exited or is unavailable. Turn it on to restart it.');
            this.inspectionError = null;
            return this.snapshot(running ? 'running' : 'off');
        } catch (error) {
            if (observedRevision !== this.revision) return this.getStatus();
            if (this.phase || this.activityActive) return this.snapshot(this.phase || 'waiting');
            this.inspectionError = error;
            return this.snapshot('error');
        }
    }
    setEnabled(enabled) {
        if (typeof enabled !== 'boolean') return Promise.reject(new TypeError('enabled must be a boolean.'));
        if (!this.isConfigured()) return Promise.reject(new Error('AI RPG is not configured to manage a local LLM.'));
        this.desiredOn = enabled;
        this.inspectionError = null;
        this.revision += 1;
        this.pendingTransitions += 1;
        this.phase ||= 'waiting';
        const task = this.operation.then(async () => {
            try {
                await this.withExclusiveModelLifecycle(async () => {
                    this.phase = enabled ? 'starting' : 'stopping';
                    if (enabled) {
                        this.confirmedOff = false;
                        await this.start();
                    } else {
                        await this.stop();
                        this.confirmedOff = true;
                    }
                    this.error = null;
                });
            } catch (error) {
                this.error = error;
                throw error;
            } finally {
                this.pendingTransitions -= 1;
                this.phase = this.pendingTransitions ? 'waiting' : null;
            }
            return this.getStatus();
        });
        this.operation = task.catch(() => {});
        return task;
    }
    noteStopped() { this.confirmedOff = true; }
    noteStarting() { this.confirmedOff = false; }
    async withActivity(callback) {
        this.activityActive = true;
        this.inspectionError = null;
        this.revision += 1;
        try { return await callback(); }
        finally { this.activityActive = false; this.revision += 1; }
    }
}

function registerLocalLlmControlRoutes(app, controller) {
    app.get('/api/local-llm', async (req, res) => {
        try { res.json({ success: true, ...await controller.getStatus() }); }
        catch (error) { res.status(500).json({ success: false, error: error.message, stack: error.stack }); }
    });
    app.post('/api/local-llm', async (req, res) => {
        if (!req.body || Object.keys(req.body).length !== 1 || typeof req.body.enabled !== 'boolean') {
            return res.status(400).json({ success: false, error: 'Supply only enabled, a boolean.' });
        }
        try { res.json({ success: true, ...await controller.setEnabled(req.body.enabled) }); }
        catch (error) { res.status(500).json({ success: false, error: error.message, stack: error.stack, status: controller.snapshot('error') }); }
    });
}
module.exports = { ManagedLocalLlmController, registerLocalLlmControlRoutes, inspectWithPromptAwareDeadline };
