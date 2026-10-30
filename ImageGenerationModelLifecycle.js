const LlamaCppRouterClient = require('./LlamaCppRouterClient.js');
const StrataVramClient = require('./StrataVramClient.js');
const { throwIfAborted } = require('./image_client_utils.js');

class ImageGenerationModelLifecycle {
    constructor({
        resolveRouterTarget,
        withExclusiveModelLifecycle,
        getComfyClient,
        getLocalServerProcess = () => null,
        createRouterClient = options => new LlamaCppRouterClient(options),
        resolveStrataTarget = null,
        createStrataClient = options => new StrataVramClient(options),
        onComfyCacheMonitorFallback = async () => {},
        logger = console
    } = {}) {
        if (typeof resolveRouterTarget !== 'function') {
            throw new Error('ImageGenerationModelLifecycle requires resolveRouterTarget().');
        }
        if (typeof withExclusiveModelLifecycle !== 'function') {
            throw new Error('ImageGenerationModelLifecycle requires withExclusiveModelLifecycle().');
        }
        if (typeof getComfyClient !== 'function') {
            throw new Error('ImageGenerationModelLifecycle requires getComfyClient().');
        }
        if (typeof getLocalServerProcess !== 'function') {
            throw new Error('ImageGenerationModelLifecycle getLocalServerProcess must be a function.');
        }
        if (typeof createRouterClient !== 'function') {
            throw new Error('ImageGenerationModelLifecycle createRouterClient must be a function.');
        }
        if (resolveStrataTarget !== null && typeof resolveStrataTarget !== 'function') {
            throw new Error('ImageGenerationModelLifecycle resolveStrataTarget must be a function.');
        }
        if (typeof createStrataClient !== 'function') {
            throw new Error('ImageGenerationModelLifecycle createStrataClient must be a function.');
        }
        if (typeof onComfyCacheMonitorFallback !== 'function') {
            throw new Error('ImageGenerationModelLifecycle onComfyCacheMonitorFallback must be a function.');
        }

        this.resolveRouterTarget = resolveRouterTarget;
        this.withExclusiveModelLifecycle = withExclusiveModelLifecycle;
        this.getComfyClient = getComfyClient;
        this.getLocalServerProcess = getLocalServerProcess;
        this.createRouterClient = createRouterClient;
        this.resolveStrataTarget = resolveStrataTarget;
        this.createStrataClient = createStrataClient;
        this.onComfyCacheMonitorFallback = onComfyCacheMonitorFallback;
        this.logger = logger;
    }

    async run({ mode = 'none', renderBatch, signal = null } = {}) {
        if (!['none', 'unload', 'terminate', 'strata_vram', 'strata_ram_standby'].includes(mode)) {
            throw new Error('Image model lifecycle mode must be one of: none, unload, terminate, strata_vram, strata_ram_standby.');
        }
        if (typeof renderBatch !== 'function') {
            throw new Error('Image model lifecycle requires renderBatch().');
        }
        if (mode === 'none') {
            return renderBatch();
        }

        return this.withExclusiveModelLifecycle(async () => {
            if (mode === 'strata_vram') {
                return this.runWithStrataVram(renderBatch, signal);
            }
            if (mode === 'strata_ram_standby') {
                return this.runWithStrataRamStandby(renderBatch, signal);
            }
            if (mode === 'terminate') {
                return this.runWithTerminatedLocalServer(renderBatch);
            }
            return this.runWithUnloadedRouterModel(renderBatch);
        });
    }

    async releaseComfyVram() {
        const comfyClient = this.getComfyClient();
        if (!comfyClient || typeof comfyClient.releaseVram !== 'function') {
            throw new Error('ComfyUI Cache Monitor VRAM release is unavailable.');
        }
        const release = await comfyClient.releaseVram();
        if (release?.fallbackUsed) {
            this.logger.warn(`ComfyUI Cache Monitor VRAM release failed; used full /free cleanup instead: ${release.cacheMonitorError}`);
            try {
                await this.onComfyCacheMonitorFallback({ cacheMonitorError: release.cacheMonitorError });
            } catch (notificationError) {
                this.logger.warn(`Failed to broadcast the ComfyUI Cache Monitor fallback warning: ${notificationError?.message || String(notificationError)}`);
            }
        } else {
            this.logger.log('🎨 Asked ComfyUI Cache Monitor to release VRAM while preserving its system-memory cache before text generation resumes.');
        }
    }

    async runWithStrataVram(renderBatch, signal) {
        throwIfAborted(signal, 'Image model lifecycle cancelled.');
        if (!this.resolveStrataTarget) throw new Error('Strata image handoff requires resolveStrataTarget().');
        // Resolve exactly once: a configuration reload must not change the recovery target.
        const target = await this.resolveStrataTarget();
        const strata = this.createStrataClient({ ...target, signal });
        let releaseStarted = false;
        let result;
        const errors = [];
        try {
            const released = await strata.releaseForImages();
            releaseStarted = true;
            this.logger.log(`🧠 Strata made ${released.vram_free_mib} MiB total VRAM available for image rendering while keeping its engine and RAM arena loaded.`);
            throwIfAborted(signal, 'Image model lifecycle cancelled before rendering.');
            result = await renderBatch();
        } catch (error) {
            errors.push(error);
            releaseStarted ||= error?.releaseMayHaveStarted === true || strata.releaseMayHaveStarted === true;
        }
        if (releaseStarted) {
            // Both operations must run even after cancellation or an ambiguous shrink timeout.
            try { await this.releaseComfyVram(); } catch (error) { errors.push(error); }
            try {
                await strata.restore();
                this.logger.log('🧠 Restored Strata\'s startup VRAM reserve without reloading its model.');
            } catch (error) { errors.push(error); }
        }
        if (errors.length > 1) throw new AggregateError(errors, 'Strata image handoff failed; rendering and recovery errors are preserved.');
        if (errors.length === 1) throw errors[0];
        return result;
    }

    async runWithStrataRamStandby(renderBatch, signal) {
        throwIfAborted(signal, 'Image model lifecycle cancelled.');
        if (!this.resolveStrataTarget) throw new Error('Strata image handoff requires resolveStrataTarget().');
        const target = await this.resolveStrataTarget();
        const strata = this.createStrataClient({ ...target, signal });
        let standbyStarted = false;
        let result;
        const errors = [];
        try {
            const standby = await strata.standbyForImages();
            standbyStarted = true;
            this.logger.log(`🧠 Strata entered RAM standby with ${standby.vram_free_mib} MiB VRAM free.`);
            throwIfAborted(signal, 'Image model lifecycle cancelled before rendering.');
            result = await renderBatch();
        } catch (error) {
            errors.push(error);
            standbyStarted ||= error?.releaseMayHaveStarted === true || strata.releaseMayHaveStarted === true;
        }
        if (standbyStarted) {
            try { await this.releaseComfyVram(); } catch (error) { errors.push(error); }
        }
        if (errors.length > 1) throw new AggregateError(errors, 'Strata RAM standby handoff failed; rendering and cleanup errors are preserved.');
        if (errors.length === 1) throw errors[0];
        return result;
    }

    async runWithTerminatedLocalServer(renderBatch) {
        const localServerProcess = this.getLocalServerProcess();
        if (
            !localServerProcess
            || typeof localServerProcess.stop !== 'function'
            || typeof localServerProcess.start !== 'function'
        ) {
            throw new Error('Image model terminate lifecycle requires a managed local llama.cpp server process.');
        }

        const stopped = await localServerProcess.stop();
        this.logger.log(`🧠 Stopped local llama.cpp PID ${stopped.pid} for image rendering.`);

        let result;
        let renderError = null;
        try {
            result = await renderBatch();
        } catch (error) {
            renderError = error;
        }

        let restartError = null;
        try {
            const started = await localServerProcess.start({
                beforeStartOptions: { preserveComfySystemCache: true }
            });
            this.logger.log(`🧠 Restarted local llama.cpp PID ${started.pid} after image rendering.`);
        } catch (error) {
            restartError = error;
        }

        if (renderError && restartError) {
            throw new AggregateError(
                [renderError, restartError],
                'Image rendering failed and the local llama.cpp server could not be restarted.'
            );
        }
        if (restartError) {
            throw restartError;
        }
        if (renderError) {
            throw renderError;
        }
        return result;
    }

    async runWithUnloadedRouterModel(renderBatch) {
        const target = await this.resolveRouterTarget();
        if (!target || typeof target !== 'object') {
            throw new Error('Image model unload lifecycle could not resolve a llama.cpp router target.');
        }
        const router = this.createRouterClient(target);
        let unloadState;
        try {
            unloadState = await router.unloadModelIfLoaded();
        } catch (error) {
            if (error?.unloadMayHaveStarted === true) {
                try {
                    await router.loadModel();
                } catch (reloadError) {
                    throw new AggregateError(
                        [error, reloadError],
                        `llama.cpp model "${target.model}" may have unloaded and could not be restored.`
                    );
                }
            }
            throw error;
        }
        if (unloadState.unloadedByClient) {
            this.logger.log(`🧠 Unloaded llama.cpp model "${target.model}" for image rendering.`);
        } else {
            this.logger.log(`🧠 llama.cpp model "${target.model}" was already unloaded before image rendering.`);
        }

        let result;
        let renderError = null;
        try {
            result = await renderBatch();
        } catch (error) {
            renderError = error;
        }

        try {
            await this.releaseComfyVram();
        } catch (error) {
            this.logger.warn(
                `ComfyUI model cleanup failed before llama.cpp reload: ${error?.message || String(error)}`
            );
        }

        let reloadError = null;
        if (unloadState.unloadedByClient) {
            try {
                await router.loadModel();
                this.logger.log(`🧠 Reloaded llama.cpp model "${target.model}" after image rendering.`);
            } catch (error) {
                reloadError = error;
            }
        }

        if (renderError && reloadError) {
            throw new AggregateError(
                [renderError, reloadError],
                `Image rendering failed and llama.cpp model "${target.model}" could not be reloaded.`
            );
        }
        if (reloadError) {
            throw reloadError;
        }
        if (renderError) {
            throw renderError;
        }
        return result;
    }
}

module.exports = ImageGenerationModelLifecycle;
