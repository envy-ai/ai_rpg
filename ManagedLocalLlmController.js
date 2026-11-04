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
        this.error = null;
        this.operation = Promise.resolve();
        this.activityActive = false;
        this.pendingTransitions = 0;
        this.revision = 0;
    }
    isConfigured() { return Boolean(this.resolveConfiguration()); }
    snapshot(state = null) {
        const configuration = this.resolveConfiguration();
        const resolvedState = state || this.phase || (this.error ? 'error' : 'off');
        const nextEnabled = resolvedState === 'error'
            ? this.desiredOn && !this.isPresent()
            : !this.desiredOn;
        return { configured: Boolean(configuration), kind: configuration?.kind || null, desiredOn: this.desiredOn,
            nextEnabled, state: resolvedState,
            error: this.error ? { message: this.error.message, stack: this.error.stack } : null };
    }
    assertPromptAllowed() {
        if (this.isConfigured() && !this.desiredOn) {
            const error = new Error('The local LLM is switched off. Turn it on in the application header before sending a local prompt.');
            error.isModelSwitchError = true;
            throw error;
        }
    }
    async getStatus() {
        if (!this.isConfigured() || this.phase) return this.snapshot();
        if (this.error) return this.snapshot('error');
        if (this.confirmedOff && !this.desiredOn) return this.snapshot('off');
        if (this.activityActive) return this.snapshot('waiting');
        const observedRevision = this.revision;
        try {
            const running = await this.inspect();
            if (observedRevision !== this.revision) return this.getStatus();
            if (this.phase || this.activityActive) return this.snapshot(this.phase || 'waiting');
            if (!running && this.desiredOn) throw new Error('The managed local LLM exited or is unavailable. Turn it on to restart it.');
            if (running) this.error = null;
            return this.snapshot(running ? 'running' : 'off');
        } catch (error) {
            if (observedRevision !== this.revision) return this.getStatus();
            if (this.phase || this.activityActive) return this.snapshot(this.phase || 'waiting');
            this.error = error;
            return this.snapshot('error');
        }
    }
    setEnabled(enabled) {
        if (typeof enabled !== 'boolean') return Promise.reject(new TypeError('enabled must be a boolean.'));
        if (!this.isConfigured()) return Promise.reject(new Error('AI RPG is not configured to manage a local LLM.'));
        this.desiredOn = enabled;
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
module.exports = { ManagedLocalLlmController, registerLocalLlmControlRoutes };
