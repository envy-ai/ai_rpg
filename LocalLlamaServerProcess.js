const path = require('path');
const { spawn } = require('child_process');

class LocalLlamaServerProcess {
    constructor({
        startupScriptPath,
        beforeStart,
        waitUntilReady = async () => {},
        spawnProcess = spawn,
        signalProcessGroup = (pid, signal) => process.kill(-pid, signal),
        terminationTimeoutMs = 10000,
        logger = console
    } = {}) {
        if (typeof startupScriptPath !== 'string' || !startupScriptPath.trim()) {
            throw new Error('LocalLlamaServerProcess requires a non-empty startupScriptPath.');
        }
        if (typeof beforeStart !== 'function') {
            throw new Error('LocalLlamaServerProcess requires beforeStart().');
        }
        if (typeof waitUntilReady !== 'function') {
            throw new Error('LocalLlamaServerProcess waitUntilReady must be a function.');
        }
        if (typeof spawnProcess !== 'function') {
            throw new Error('LocalLlamaServerProcess spawnProcess must be a function.');
        }
        if (typeof signalProcessGroup !== 'function') {
            throw new Error('LocalLlamaServerProcess signalProcessGroup must be a function.');
        }
        if (!Number.isFinite(terminationTimeoutMs) || terminationTimeoutMs <= 0) {
            throw new Error('LocalLlamaServerProcess terminationTimeoutMs must be a positive number.');
        }

        this.startupScriptPath = path.resolve(startupScriptPath.trim());
        this.beforeStart = beforeStart;
        this.waitUntilReady = waitUntilReady;
        this.spawnProcess = spawnProcess;
        this.signalProcessGroup = signalProcessGroup;
        this.terminationTimeoutMs = terminationTimeoutMs;
        this.logger = logger;
        this.child = null;
        this.pid = null;
        this.expectedExit = false;
    }

    getPid() {
        return this.pid;
    }

    getStartupScriptPath() {
        return this.startupScriptPath;
    }

    isRunning() {
        return Boolean(
            this.child
            && Number.isInteger(this.pid)
            && this.child.exitCode === null
            && this.child.signalCode === null
        );
    }

    async start() {
        if (this.child || this.pid !== null) {
            throw new Error(`Managed llama.cpp server is already running with PID ${this.pid}.`);
        }

        await this.beforeStart();

        let child;
        try {
            child = this.spawnProcess(this.startupScriptPath, [], {
                cwd: path.dirname(this.startupScriptPath),
                detached: true,
                stdio: 'inherit'
            });
        } catch (cause) {
            throw new Error(
                `Failed to run llama.cpp startup script "${this.startupScriptPath}": ${cause?.message || String(cause)}`,
                { cause }
            );
        }

        if (!child || !Number.isInteger(child.pid) || child.pid <= 0) {
            throw new Error(`llama.cpp startup script "${this.startupScriptPath}" did not return a process PID.`);
        }

        this.child = child;
        this.pid = child.pid;
        this.expectedExit = false;

        const spawned = new Promise((resolve, reject) => {
            child.once('spawn', resolve);
            child.once('error', reject);
        });
        const exitedBeforeReady = new Promise((_, reject) => {
            child.once('exit', (code, signal) => {
                reject(new Error(
                    `Managed llama.cpp server PID ${child.pid} exited before becoming ready (code=${code}, signal=${signal || 'none'}).`
                ));
            });
        });

        child.once('exit', (code, signal) => {
            if (this.child !== child) {
                return;
            }
            const wasExpected = this.expectedExit;
            this.child = null;
            this.pid = null;
            this.expectedExit = false;
            if (!wasExpected) {
                this.logger.error(
                    `Managed llama.cpp server exited unexpectedly (code=${code}, signal=${signal || 'none'}).`
                );
            }
        });

        try {
            await Promise.race([spawned, exitedBeforeReady]);
            await Promise.race([
                this.waitUntilReady({ child, pid: child.pid }),
                exitedBeforeReady
            ]);
        } catch (cause) {
            let stopError = null;
            if (this.child === child && this.pid === child.pid) {
                try {
                    await this.stop();
                } catch (error) {
                    stopError = error;
                }
            }
            if (stopError) {
                throw new AggregateError(
                    [cause, stopError],
                    `llama.cpp startup failed and PID ${child.pid} could not be terminated cleanly.`
                );
            }
            throw cause;
        }

        this.logger.log(`🧠 Started managed llama.cpp server with PID ${child.pid}.`);
        return { pid: child.pid };
    }

    async stop() {
        const child = this.child;
        const pid = this.pid;
        if (!child || !Number.isInteger(pid)) {
            throw new Error('Managed llama.cpp server is not running; no saved PID is available to terminate.');
        }

        if (child.exitCode !== null || child.signalCode !== null) {
            this.child = null;
            this.pid = null;
            this.expectedExit = false;
            throw new Error(`Managed llama.cpp server PID ${pid} exited before it could be terminated.`);
        }

        this.expectedExit = true;
        const exitPromise = new Promise(resolve => {
            child.once('exit', (code, signal) => resolve({ code, signal }));
        });

        try {
            this.signalProcessGroup(pid, 'SIGTERM');
        } catch (cause) {
            this.expectedExit = false;
            throw new Error(
                `Failed to terminate managed llama.cpp server process group ${pid}: ${cause?.message || String(cause)}`,
                { cause }
            );
        }

        let timeoutId;
        const gracefulOutcome = await Promise.race([
            exitPromise.then(exit => ({ type: 'exit', exit })),
            new Promise(resolve => {
                timeoutId = setTimeout(() => resolve({ type: 'timeout' }), this.terminationTimeoutMs);
            })
        ]);
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        let exit = gracefulOutcome.exit;
        if (gracefulOutcome.type === 'timeout') {
            try {
                this.signalProcessGroup(pid, 'SIGKILL');
            } catch (cause) {
                this.expectedExit = false;
                throw new Error(
                    `Managed llama.cpp server PID ${pid} ignored SIGTERM and SIGKILL failed: ${cause?.message || String(cause)}`,
                    { cause }
                );
            }

            let forceTimeoutId;
            const forcedOutcome = await Promise.race([
                exitPromise.then(forcedExit => ({ type: 'exit', exit: forcedExit })),
                new Promise(resolve => {
                    forceTimeoutId = setTimeout(() => resolve({ type: 'timeout' }), this.terminationTimeoutMs);
                })
            ]);
            if (forceTimeoutId) {
                clearTimeout(forceTimeoutId);
            }
            if (forcedOutcome.type === 'timeout') {
                this.expectedExit = false;
                throw new Error(`Managed llama.cpp server PID ${pid} did not exit after SIGKILL.`);
            }
            exit = forcedOutcome.exit;
        }

        this.logger.log(`🧠 Terminated managed llama.cpp server PID ${pid}.`);
        return { pid, code: exit.code, signal: exit.signal };
    }

    async switchStartupScriptPath(startupScriptPath) {
        if (typeof startupScriptPath !== 'string' || !startupScriptPath.trim()) {
            throw new Error('Managed llama.cpp startup-script switch requires a non-empty path.');
        }

        const nextStartupScriptPath = path.resolve(startupScriptPath.trim());
        const previousStartupScriptPath = this.startupScriptPath;
        if (nextStartupScriptPath === previousStartupScriptPath) {
            if (!this.isRunning()) {
                throw new Error(
                    `Managed llama.cpp server for startup script "${previousStartupScriptPath}" is not running.`
                );
            }
            return {
                switched: false,
                pid: this.pid,
                startupScriptPath: previousStartupScriptPath
            };
        }

        if (!this.isRunning()) {
            throw new Error(
                `Cannot switch managed llama.cpp startup scripts because "${previousStartupScriptPath}" is not running.`
            );
        }

        await this.stop();
        this.startupScriptPath = nextStartupScriptPath;
        try {
            const started = await this.start();
            return {
                switched: true,
                previousStartupScriptPath,
                startupScriptPath: nextStartupScriptPath,
                pid: started.pid
            };
        } catch (cause) {
            throw new Error(
                `Managed llama.cpp stopped "${previousStartupScriptPath}" but failed to start "${nextStartupScriptPath}": ${cause?.message || String(cause)}`,
                { cause }
            );
        }
    }

    terminateImmediately() {
        if (!Number.isInteger(this.pid)) {
            return false;
        }
        const pid = this.pid;
        this.expectedExit = true;
        this.signalProcessGroup(pid, 'SIGTERM');
        return true;
    }
}

module.exports = LocalLlamaServerProcess;
