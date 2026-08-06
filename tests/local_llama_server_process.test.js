const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const LocalLlamaServerProcess = require('../LocalLlamaServerProcess.js');

function createFakeChild(pid = 4321) {
    const child = new EventEmitter();
    child.pid = pid;
    child.exitCode = null;
    child.signalCode = null;
    return child;
}

test('managed local llama server clears ComfyUI before spawning and retains the returned PID', async () => {
    const events = [];
    const child = createFakeChild();
    const processManager = new LocalLlamaServerProcess({
        startupScriptPath: '/tmp/start-llama.sh',
        beforeStart: async () => events.push('comfy-unload'),
        spawnProcess: (scriptPath, args, options) => {
            events.push(['spawn-script', scriptPath, args, options.cwd, options.detached]);
            setImmediate(() => child.emit('spawn'));
            return child;
        },
        waitUntilReady: async ({ pid }) => events.push(['ready', pid]),
        signalProcessGroup: () => {},
        logger: { log: () => {}, error: () => {} }
    });

    const result = await processManager.start();

    assert.equal(result.pid, 4321);
    assert.equal(processManager.getPid(), 4321);
    assert.deepEqual(events, [
        'comfy-unload',
        ['spawn-script', '/tmp/start-llama.sh', [], '/tmp', true],
        ['ready', 4321]
    ]);
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
