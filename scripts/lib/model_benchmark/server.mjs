import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function isPortAvailable(port, host = '127.0.0.1') {
    return await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.once('error', error => {
            if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
            else reject(error);
        });
        probe.listen({ port, host }, () => probe.close(() => resolve(true)));
    });
}

export async function waitForHttpReady(baseUrl, {
    timeoutMs = 600_000,
    pollIntervalMs = 250,
    child = null
} = {}) {
    const startedAt = Date.now();
    while (true) {
        if (child?.exitCode !== null) {
            throw new Error(`Benchmark game server exited before readiness with code ${child.exitCode}.`);
        }
        try {
            const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) });
            if (response.status < 500) return { status: response.status, durationMs: Date.now() - startedAt };
        } catch {
            // The managed server may still be validating configuration or preloading the model.
        }
        if (Date.now() - startedAt >= timeoutMs) {
            throw new Error(`Timed out after ${timeoutMs}ms waiting for benchmark game server ${baseUrl}.`);
        }
        await delay(pollIntervalMs);
    }
}

async function waitForExit(child, timeoutMs) {
    if (!child || child.exitCode !== null) return true;
    return await Promise.race([
        new Promise(resolve => child.once('exit', () => resolve(true))),
        delay(timeoutMs).then(() => false)
    ]);
}

export class ManagedBenchmarkServer {
    constructor({
        root,
        port,
        configPath,
        logPath,
        startupTimeoutMs = 600_000,
        environment = process.env
    }) {
        this.root = root;
        this.port = port;
        this.configPath = configPath;
        this.logPath = logPath;
        this.startupTimeoutMs = startupTimeoutMs;
        this.environment = environment;
        this.child = null;
        this.logStream = null;
        this.startedAt = null;
    }

    get baseUrl() {
        return `http://127.0.0.1:${this.port}`;
    }

    get wsUrl() {
        return `ws://127.0.0.1:${this.port}/ws`;
    }

    get running() {
        return Boolean(this.child) && this.child.exitCode === null;
    }

    async start() {
        if (this.child) throw new Error('Benchmark game server has already been started.');
        if (!await isPortAvailable(this.port)) {
            throw new Error(`Benchmark port ${this.port} is already occupied; refusing to terminate an unknown process.`);
        }
        await fsPromises.mkdir(path.dirname(this.logPath), { recursive: true });
        this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' });
        this.startedAt = new Date().toISOString();
        this.logStream.write(`\n=== benchmark server start ${this.startedAt} ===\n`);
        this.child = spawn(process.execPath, [
            path.join(this.root, 'server.js'),
            '--config-override',
            this.configPath,
            '--port',
            String(this.port)
        ], {
            cwd: this.root,
            env: this.environment,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        this.child.stdout.pipe(this.logStream, { end: false });
        this.child.stderr.pipe(this.logStream, { end: false });
        try {
            const readiness = await waitForHttpReady(this.baseUrl, {
                timeoutMs: this.startupTimeoutMs,
                child: this.child
            });
            return { pid: this.child.pid, ...readiness };
        } catch (error) {
            await this.stop();
            throw new Error(`${error.message} See ${this.logPath}.`);
        }
    }

    async stop({ gracefulTimeoutMs = 30_000 } = {}) {
        const child = this.child;
        if (child && child.exitCode === null) {
            child.kill('SIGTERM');
            if (!await waitForExit(child, gracefulTimeoutMs) && child.exitCode === null) {
                child.kill('SIGKILL');
                await waitForExit(child, 5_000);
            }
        }
        if (this.logStream) {
            await new Promise(resolve => this.logStream.end(resolve));
        }
        this.child = null;
        this.logStream = null;
    }
}
