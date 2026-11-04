const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { StrataRuntimeService } = require('../StrataRuntimeService.js');
const { readProcessStartToken } = require('../StrataRuntime.js');

test('real contained service applies resource limits and cleans up after an inert child', { timeout: 120000, skip: process.env.STRATA_RUNTIME_SERVICE_REAL_PROBE !== '1' }, async () => {
    const runtime = new StrataRuntimeService({ ownerPid: process.pid, ownerToken: readProcessStartToken(process.pid), resources: { memory_max_mib: 16384, memlock_mib: 98304, shm_size_mib: 61440 }, baseDirectory: path.join(__dirname, '..', 'tmp', 'strata-service-real-probe') });
    const python = [
        'import json,os,resource',
        "cg=open('/proc/self/cgroup').read().strip().split('0::',1)[1]",
        "m=open('/sys/fs/cgroup'+cg+'/memory.max').read().strip()",
        "s=open('/sys/fs/cgroup'+cg+'/memory.swap.max').read().strip()",
        "v=os.statvfs('/dev/shm')",
        "print(json.dumps({'memory':m,'swap':s,'memlock':resource.getrlimit(resource.RLIMIT_MEMLOCK),'shm':v.f_blocks*v.f_frsize,'uid':os.getuid(),'gid':os.getgid()}),flush=True)"
    ].join(';');
    let probeError;
    try {
        const result = await runtime.startCommand({ executable: '/usr/bin/python3', args: ['-c', python], timeoutMs: 30000 });
        assert.equal(result.exitCode, 0, result.stderr);
        const child = JSON.parse(result.stdout);
        assert.equal(child.memory, String(16384 * 1048576));
        assert.equal(child.swap, '0');
        assert.equal(child.memlock[0], 98304 * 1048576);
        assert.equal(child.memlock[1], 98304 * 1048576);
        assert.equal(child.shm, 61440 * 1048576);
        assert.equal(child.uid, process.getuid());
        assert.equal(child.gid, process.getgid());
        assert.ok(runtime.receipt?.invocationId);
    } catch (error) { probeError = error; } finally {
        if (runtime.receipt || runtime.removed) {
            await runtime.stop();
        } else if (runtime.launchAttempted) {
            const props = await runtime.show();
            if (props) {
                console.error('probe identity:', JSON.stringify({ unit: runtime.unitName, invocation: props.InvocationID, controlGroup: props.ControlGroup, activeState: props.ActiveState }));
                assert.match(props.ExecStart || '', /python3.*memory\.max/);
                require('node:child_process').execFileSync('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'stop', runtime.unitName, '--no-ask-password']);
            }
        }
    }
    if (probeError) throw probeError;
    const properties = await runtime.show();
    assert.ok(properties === null || ['inactive', 'failed'].includes(properties.ActiveState));
});
