const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const LocalLlamaServerProcess = require('../LocalLlamaServerProcess.js');

function createFakeChild(pid = 4321) {
    const child = new EventEmitter();
    child.pid = pid;
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    return child;
}

test('managed local llama server clears ComfyUI before spawning and retains the returned PID', async () => {
    const events = [];
    const child = createFakeChild();
    const processManager = new LocalLlamaServerProcess({
        startupScriptPath: '/tmp/start-llama.sh',
        beforeStart: async options => events.push(['comfy-unload', options]),
        spawnProcess: (scriptPath, args, options) => {
            events.push(['spawn-script', scriptPath, args, options.cwd, options.detached, options.stdio]);
            setImmediate(() => child.emit('spawn'));
            return child;
        },
        waitUntilReady: async ({ pid }) => events.push(['ready', pid]),
        signalProcessGroup: () => {},
        logger: { log: () => {}, error: () => {} }
    });

    const result = await processManager.start({
        beforeStartOptions: { preserveComfySystemCache: true }
    });

    assert.equal(result.pid, 4321);
    assert.equal(processManager.getPid(), 4321);
    assert.deepEqual(events, [
        ['comfy-unload', { preserveComfySystemCache: true }],
        ['spawn-script', '/tmp/start-llama.sh', [], '/tmp', true, ['inherit', 'pipe', 'pipe']],
        ['ready', 4321]
    ]);
});

test('managed local llama server mirrors and retains a bounded terminal-output snapshot', async () => {
    const child = createFakeChild(4322);
    const mirroredStdout = [];
    const mirroredStderr = [];
    const processManager = new LocalLlamaServerProcess({
        startupScriptPath: '/tmp/start-llama.sh',
        beforeStart: async () => {},
        spawnProcess: () => {
            setImmediate(() => child.emit('spawn'));
            return child;
        },
        waitUntilReady: async () => {},
        writeStdout: chunk => mirroredStdout.push(chunk.toString()),
        writeStderr: chunk => mirroredStderr.push(chunk.toString()),
        signalProcessGroup: () => {},
        logger: { log: () => {}, error: () => {} }
    });

    await processManager.start();
    child.stdout.write('\u001b[32mloaded\u001b[0m\n');
    child.stderr.write('warning\n');

    assert.deepEqual(mirroredStdout, ['\u001b[32mloaded\u001b[0m\n']);
    assert.deepEqual(mirroredStderr, ['warning\n']);
    assert.deepEqual(processManager.getOutputSnapshot(), {
        output: 'loaded\nwarning\n',
        cursor: 15,
        startCursor: 0,
        reset: true,
        truncated: false
    });
    assert.deepEqual(processManager.getOutputSnapshot(7), {
        output: 'warning\n',
        cursor: 15,
        startCursor: 0,
        reset: false,
        truncated: false
    });
});

test('managed local llama server terminates the saved process group PID', async () => {
    const signals = [];
    const child = createFakeChild(5432);
    const processManager = new LocalLlamaServerProcess({
        startupScriptPath: '/tmp/start-llama.sh',
        beforeStart: async () => {},
        spawnProcess: () => {
            setImmediate(() => child.emit('spawn'));
            return child;
        },
        waitUntilReady: async () => {},
        signalProcessGroup: (pid, signal) => {
            signals.push([pid, signal]);
            if (signal === 'SIGTERM') {
                child.signalCode = signal;
                setImmediate(() => child.emit('exit', null, signal));
            }
        },
        logger: { log: () => {}, error: () => {} }
    });
    await processManager.start();

    const result = await processManager.stop();

    assert.deepEqual(signals, [[5432, 'SIGTERM']]);
    assert.equal(result.pid, 5432);
    assert.equal(processManager.getPid(), null);
});

test('managed local llama server does not run the startup script when ComfyUI cleanup fails', async () => {
    let spawnCalled = false;
    const processManager = new LocalLlamaServerProcess({
        startupScriptPath: '/tmp/start-llama.sh',
        beforeStart: async () => {
            throw new Error('ComfyUI free failed');
        },
        spawnProcess: () => {
            spawnCalled = true;
            return createFakeChild();
        },
        signalProcessGroup: () => {},
        logger: { log: () => {}, error: () => {} }
    });

    await assert.rejects(() => processManager.start(), /ComfyUI free failed/);
    assert.equal(spawnCalled, false);
    assert.equal(processManager.getPid(), null);
});

test('managed local llama server switches different startup scripts and leaves the same script running', async () => {
    const events = [];
    const children = [createFakeChild(6101), createFakeChild(6102)];
    let spawnIndex = 0;
    const processManager = new LocalLlamaServerProcess({
        startupScriptPath: '/tmp/start-base.sh',
        beforeStart: async () => events.push('comfy-unload'),
        spawnProcess: (scriptPath) => {
            const child = children[spawnIndex++];
            events.push(`spawn:${scriptPath}`);
            setImmediate(() => child.emit('spawn'));
            return child;
        },
        waitUntilReady: async ({ pid }) => events.push(`ready:${pid}`),
        signalProcessGroup: (pid, signal) => {
            events.push(`signal:${pid}:${signal}`);
            const child = children.find(candidate => candidate.pid === pid);
            child.signalCode = signal;
            setImmediate(() => child.emit('exit', null, signal));
        },
        logger: { log: () => {}, error: () => {} }
    });

    await processManager.start();
    const sameScript = await processManager.switchStartupScriptPath('/tmp/./start-base.sh');
    const switched = await processManager.switchStartupScriptPath('/tmp/start-prose.sh');

    assert.deepEqual(sameScript, {
        switched: false,
        pid: 6101,
        startupScriptPath: '/tmp/start-base.sh'
    });
    assert.deepEqual(switched, {
        switched: true,
        previousStartupScriptPath: '/tmp/start-base.sh',
        startupScriptPath: '/tmp/start-prose.sh',
        pid: 6102
    });
    assert.equal(processManager.getStartupScriptPath(), '/tmp/start-prose.sh');
    assert.deepEqual(events, [
        'comfy-unload',
        'spawn:/tmp/start-base.sh',
        'ready:6101',
        'signal:6101:SIGTERM',
        'comfy-unload',
        'spawn:/tmp/start-prose.sh',
        'ready:6102'
    ]);
});
