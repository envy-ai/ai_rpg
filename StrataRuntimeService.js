const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

let nextAttempt = 0;

function runCommand({ executable, args, timeoutMs, signal }) {
    return new Promise((resolve, reject) => {
        execFile(executable, args, { encoding: 'utf8', timeout: timeoutMs, signal, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error && (typeof error.code !== 'number' || error.killed || error.signal)) reject(error);
            else resolve({ exitCode: error?.code || 0, stdout, stderr });
        });
    });
}

function readProcessCgroup(pid) {
    const entries = fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim().split('\n');
    const unified = entries.find(entry => entry.startsWith('0::'));
    if (!unified) throw new Error(`Cannot verify unified cgroup for Strata PID ${pid}.`);
    return unified.slice(3);
}

class StrataRuntimeService {
    constructor({ ownerPid, ownerToken, resources, terminationTracePath = null, runCommand: command = runCommand,
        readProcessCgroup: processCgroup = readProcessCgroup, baseDirectory = path.join(__dirname, 'tmp'),
        uid = process.getuid(), gid = process.getgid(), homeDirectory = os.homedir() }) {
        if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0 || !/^l:\d+$/.test(ownerToken)) throw new Error('Strata service requires a Linux owner PID/start token.');
        for (const key of ['memory_max_mib', 'memlock_mib', 'shm_size_mib']) {
            if (!Number.isSafeInteger(resources?.[key]) || resources[key] <= 0 || !Number.isSafeInteger(resources[key] * 1048576)) {
                throw new Error(`Strata service resources.${key} must be a positive safe integer in MiB.`);
            }
        }
        Object.assign(this, { resources, terminationTracePath, command, processCgroup, baseDirectory, uid, gid, homeDirectory });
        this.unitName = `ai-rpg-strata-${ownerPid}-${ownerToken.slice(2)}-${++nextAttempt}.service`;
        this.receipt = null;
        this.launchAttempted = false;
        this.removed = false;
    }

    async show({ signal = null } = {}) {
        const result = await this.command({ executable: '/usr/bin/systemctl', args: ['show', this.unitName, '--no-pager'], timeoutMs: 15000, ...(signal ? { signal } : {}) });
        const properties = Object.fromEntries(result.stdout.split('\n').filter(line => line.includes('=')).map(line => {
            const index = line.indexOf('=');
            return [line.slice(0, index), line.slice(index + 1)];
        }));
        if (properties.LoadState === 'not-found') return null;
        if (result.exitCode !== 0) throw new Error(`Cannot inspect owned Strata service: ${result.stderr}`);
        return properties;
    }

    verifyProperties(properties) {
        const expected = {
            Type: 'oneshot', RemainAfterExit: 'yes', User: String(this.uid), Group: String(this.gid), WorkingDirectory: this.homeDirectory,
            MemoryMax: String(this.resources.memory_max_mib * 1048576), MemorySwapMax: '0', LimitMEMLOCK: String(this.resources.memlock_mib * 1048576),
            IOAccounting: 'yes', OOMScoreAdjust: '300', OOMPolicy: 'kill', KillMode: 'control-group', Restart: 'no'
        };
        for (const [key, value] of Object.entries(expected)) {
            if (properties[key] !== value) throw new Error(`Strata service ${key} does not match required containment.`);
        }
        const mounts = properties.TemporaryFileSystem?.split(' ') || [];
        const shm = `/dev/shm:rw,size=${this.resources.shm_size_mib * 1048576},mode=1777`;
        if (!mounts.includes(shm)) throw new Error('Strata service private /dev/shm does not match required containment.');
        if (!/^[a-f0-9]{32}$/.test(properties.InvocationID || '') || (properties.ControlGroup && !properties.ControlGroup.startsWith('/'))) {
            throw new Error('Strata service has no verifiable invocation/cgroup identity.');
        }
    }

    async captureUnit(options = {}) {
        const properties = await this.show(options);
        if (!properties) { this.removed = true; return; }
        this.verifyProperties(properties);
        if (this.receipt && (this.receipt.invocationId !== properties.InvocationID
            || (this.receipt.controlGroup && properties.ControlGroup && this.receipt.controlGroup !== properties.ControlGroup))) {
            throw new Error('Strata service invocation changed or cgroup changed; refusing replacement.');
        }
        this.receipt = { unitName: this.unitName, invocationId: properties.InvocationID,
            controlGroup: properties.ControlGroup || this.receipt?.controlGroup || null };
        return properties;
    }

    async startCommand({ executable, args, timeoutMs }) {
        if (this.launchAttempted || await this.show()) throw new Error('Strata service name already exists; refusing reuse.');
        this.launchAttempted = true;
        fs.mkdirSync(this.baseDirectory, { recursive: true });
        const directory = fs.mkdtempSync(path.join(this.baseDirectory, 'strata-runtime-'));
        fs.chmodSync(directory, 0o700);
        const stdoutPath = path.join(directory, 'start.json');
        const stderrPath = path.join(directory, 'start.stderr');
        for (const filename of [stdoutPath, stderrPath]) fs.closeSync(fs.openSync(filename, 'wx', 0o600));
        const properties = {
            RemainAfterExit: 'yes', User: this.uid, Group: this.gid, WorkingDirectory: this.homeDirectory,
            MemoryMax: this.resources.memory_max_mib * 1048576, MemorySwapMax: 0, LimitMEMLOCK: this.resources.memlock_mib * 1048576,
            TemporaryFileSystem: `/dev/shm:rw,size=${this.resources.shm_size_mib * 1048576},mode=1777`,
            IOAccounting: 'yes', OOMScoreAdjust: 300, OOMPolicy: 'kill', TimeoutStartSec: '900s', TimeoutStopSec: '360s',
            KillMode: 'control-group', Restart: 'no', StandardOutput: `append:${stdoutPath}`, StandardError: `append:${stderrPath}`
        };
        const launchArgs = ['-n', '/usr/bin/systemd-run', `--unit=${this.unitName}`, '--no-ask-password', '--collect', '--service-type=oneshot',
            ...Object.entries(properties).map(([key, value]) => `--property=${key}=${value}`)];
        if (this.terminationTracePath) launchArgs.push(`--setenv=STRATA_TERMINATION_TRACE_PATH=${this.terminationTracePath}`);
        launchArgs.push(executable, ...args);
        let result;
        let failure;
        try {
            result = await this.command({ executable: '/usr/bin/sudo', args: launchArgs, timeoutMs: 905000 });
        } catch (cause) { failure = cause; }
        await this.captureUnit();
        if (failure) throw failure;
        return { exitCode: result.exitCode, stdout: fs.readFileSync(stdoutPath, 'utf8'),
            stderr: fs.readFileSync(stderrPath, 'utf8') || result.stderr };
    }

    async verifyRuntime(status, { signal = null } = {}) {
        if (!this.receipt) throw new Error('Strata runtime has no captured contained-service identity.');
        const properties = await this.captureUnit({ signal });
        if (this.removed) throw new Error('Owned Strata service exited.');
        if (!properties.ControlGroup) throw new Error('Strata runtime has no live service cgroup for process verification.');
        for (const pid of [status.host_pid, status.child_pid]) {
            if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Strata runtime has no valid host/API PID for containment verification.');
            const group = await this.processCgroup(pid);
            if (group !== this.receipt.controlGroup && !group.startsWith(`${this.receipt.controlGroup}/`)) {
                throw new Error(`Strata PID ${pid} is outside its owned service cgroup.`);
            }
        }
    }

    async stop() {
        if (!this.launchAttempted || this.removed) return null;
        if (!this.receipt) throw new Error('Cannot stop Strata service without captured invocation identity.');
        const properties = await this.show();
        if (!properties) { this.removed = true; return { stopped: true, alreadyExited: true }; }
        this.verifyProperties(properties);
        if (properties.InvocationID !== this.receipt.invocationId
            || (properties.ControlGroup && this.receipt.controlGroup && properties.ControlGroup !== this.receipt.controlGroup)) {
            throw new Error('Strata service invocation changed; refusing to stop replacement.');
        }
        const result = await this.command({ executable: '/usr/bin/sudo', args: ['-n', '/usr/bin/systemctl', 'stop', this.unitName, '--no-ask-password'], timeoutMs: 365000 });
        if (result.exitCode !== 0) throw new Error(`Could not stop owned Strata service: ${result.stderr}`);
        const after = await this.show();
        if (after && (after.InvocationID !== this.receipt.invocationId || !['inactive', 'failed'].includes(after.ActiveState))) {
            throw new Error('Strata service stop did not confirm the captured invocation stopped.');
        }
        this.removed = true;
        return { ...this.receipt, stopped: true };
    }
}

module.exports = { StrataRuntimeService, runCommand, readProcessCgroup };
