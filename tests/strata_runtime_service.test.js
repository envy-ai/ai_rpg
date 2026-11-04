const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { StrataRuntimeService } = require('../StrataRuntimeService.js');
const resources = { memory_max_mib: 90112, memlock_mib: 98304, shm_size_mib: 61440 };
const mib = 1048576;
function fixture() {
    let exists = false, invocation = '0123456789abcdef0123456789abcdef', active = 'active';
    let cgroup = '/system.slice/owned.service', reportedCgroup = '/system.slice/owned.service';
    const calls = [];
    const properties = () => ({ LoadState: 'loaded', ActiveState: active, Type: 'oneshot', RemainAfterExit: 'yes', User: '1000', Group: '1001', WorkingDirectory: '/fake/home', MemoryMax: String(resources.memory_max_mib * mib), MemorySwapMax: '0', LimitMEMLOCK: String(resources.memlock_mib * mib), TemporaryFileSystem: `/dev/shm:rw,size=${resources.shm_size_mib * mib},mode=1777`, IOAccounting: 'yes', OOMScoreAdjust: '300', OOMPolicy: 'kill', KillMode: 'control-group', Restart: 'no', InvocationID: invocation, ControlGroup: reportedCgroup });
    const service = new StrataRuntimeService({ ownerPid: 456, ownerToken: 'l:789', resources, terminationTracePath: '/fake/trace.jsonl', uid: 1000, gid: 1001, homeDirectory: '/fake/home', baseDirectory: path.join(__dirname, '..', 'tmp', 'strata-service-tests'), readProcessCgroup: async () => cgroup,
        runCommand: async call => {
            calls.push(call);
            if (call.executable === '/usr/bin/systemctl') return { exitCode: 0, stdout: exists ? Object.entries(properties()).map(([key, value]) => `${key}=${value}`).join('\n') : 'LoadState=not-found', stderr: '' };
            if (call.args[1] === '/usr/bin/systemd-run') {
                exists = true;
                const stdout = call.args.find(arg => arg.startsWith('--property=StandardOutput=append:')).split('append:')[1];
                fs.writeFileSync(stdout, '{"state":"ready"}');
                return { exitCode: 0, stdout: '', stderr: '' };
            }
            if (call.args[1] === '/usr/bin/systemctl') { active = 'inactive'; return { exitCode: 0, stdout: '', stderr: '' }; }
            throw new Error('Unexpected command');
        } });
    return { service, calls, setInvocation: value => { invocation = value; }, setCgroup: value => { cgroup = value; }, setReportedCgroup: value => { reportedCgroup = value; } };
}

test('contained launch builds resource-limited service and verifies receipt plus process cgroups', async () => {
    const h = fixture();
    const result = await h.service.startCommand({ executable: '/fake/strata', args: ['runtime', 'start', '--profile', 'p', '--die-with-pid', '456', '--wait', '300', '--json'], timeoutMs: 5000 });
    assert.deepEqual(JSON.parse(result.stdout), { state: 'ready' });
    const launch = h.calls.find(call => call.executable === '/usr/bin/sudo');
    assert.equal(launch.args[0], '-n');
    assert.ok(launch.args.includes('--service-type=oneshot'));
    assert.ok(launch.args.includes('--property=RemainAfterExit=yes'));
    assert.ok(launch.args.includes(`--property=MemoryMax=${resources.memory_max_mib * mib}`));
    assert.ok(launch.args.includes('--property=MemorySwapMax=0'));
    assert.ok(launch.args.includes(`--property=LimitMEMLOCK=${resources.memlock_mib * mib}`));
    assert.ok(launch.args.includes(`--property=TemporaryFileSystem=/dev/shm:rw,size=${resources.shm_size_mib * mib},mode=1777`));
    assert.ok(launch.args.includes('--property=User=1000'));
    assert.ok(launch.args.includes('--property=Group=1001'));
    assert.ok(launch.args.includes('--setenv=STRATA_TERMINATION_TRACE_PATH=/fake/trace.jsonl'));
    const systemdArgs = launch.args.slice(0, launch.args.indexOf('/fake/strata'));
    assert.equal(systemdArgs.some(arg => ['--wait', '--pipe', '--no-block'].includes(arg)), false);
    assert.ok(launch.args.slice(launch.args.indexOf('/fake/strata') + 1).includes('--wait'));
    await h.service.verifyRuntime({ host_pid: 123, child_pid: 124 });
    const receipt = await h.service.stop();
    assert.equal(receipt.invocationId, '0123456789abcdef0123456789abcdef');
    assert.equal(receipt.stopped, true);
    assert.ok(h.calls.some(call => call.args[1] === '/usr/bin/systemctl' && call.args.includes(h.service.unitName)));
    const other = fixture();
    assert.notEqual(other.service.unitName, h.service.unitName);
});

test('contained service refuses out-of-cgroup processes and replacement invocation', async () => {
    const h = fixture();
    await h.service.startCommand({ executable: '/fake/strata', args: ['runtime', 'start'], timeoutMs: 5000 });
    h.setCgroup('/external');
    await assert.rejects(h.service.verifyRuntime({ host_pid: 123, child_pid: 124 }), /outside.*cgroup/i);
    h.setInvocation('ffffffffffffffffffffffffffffffff');
    await assert.rejects(h.service.stop(), /invocation changed/i);
    assert.equal(h.calls.some(call => call.args[1] === '/usr/bin/systemctl'), false);
});

test('contained service forwards readiness cancellation to the systemctl inspection', async () => {
    const h = fixture();
    await h.service.startCommand({ executable: '/fake/strata', args: ['runtime', 'start'], timeoutMs: 5000 });
    const controller = new AbortController();
    await h.service.verifyRuntime({ host_pid: 123, child_pid: 124 }, { signal: controller.signal });
    const show = h.calls.filter(call => call.executable === '/usr/bin/systemctl').at(-1);
    assert.equal(show.signal, controller.signal);
});

test('empty retained unit can be stopped but cannot establish live runtime containment', async () => {
    const h = fixture();
    await h.service.startCommand({ executable: '/fake/strata', args: ['runtime', 'start'], timeoutMs: 5000 });
    h.setReportedCgroup('');
    await assert.rejects(h.service.verifyRuntime({ host_pid: 123, child_pid: 124 }), /no live service cgroup/i);
    const stopped = await h.service.stop();
    assert.equal(stopped.stopped, true);
});
