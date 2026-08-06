const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const axios = require('axios');
const ComfyUIClient = require('../ComfyUIClient.js');

class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    static instances = [];

    constructor(url) {
        super();
        this.url = url;
        this.readyState = 0;
        FakeWebSocket.instances.push(this);
        setImmediate(() => {
            this.readyState = FakeWebSocket.OPEN;
            this.emit('open');
        });
    }

    close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.emit('close');
    }
}

test('ComfyUI client forwards current sampler progress from the prompt WebSocket', { concurrency: false }, async () => {
    const originalPost = axios.post;
    const originalGet = axios.get;
    FakeWebSocket.instances = [];
    let queuedPayload = null;
    let historyComplete = false;

    axios.post = async (_url, payload) => {
        queuedPayload = payload;
        return { data: { prompt_id: payload.prompt_id } };
    };
    axios.get = async (_url) => ({
        data: {
            'progress-prompt': {
                outputs: historyComplete
                    ? {
                        9: {
                            images: [{ filename: 'result.png', subfolder: '', type: 'output' }]
                        }
                    }
                    : {}
            }
        }
    });

    try {
        const client = new ComfyUIClient({
            imagegen: {
                server: { host: 'comfy.example', port: 8188 }
            }
        }, { WebSocketImpl: FakeWebSocket });
        const queued = await client.queuePrompt({ 1: { class_type: 'KSampler' } }, 'progress-prompt');
        assert.equal(queued.success, true);
        assert.equal(queued.clientId, queuedPayload.client_id);

        const progressEvents = [];
        const completionPromise = client.waitForCompletion('progress-prompt', 1000, 5, {
            clientId: queued.clientId,
            onProgress: progress => progressEvents.push(progress)
        });

        while (!FakeWebSocket.instances.length || FakeWebSocket.instances[0].readyState !== FakeWebSocket.OPEN) {
            await new Promise(resolve => setImmediate(resolve));
        }
        const socket = FakeWebSocket.instances[0];
        assert.equal(socket.url, `ws://comfy.example:8188/ws?clientId=${encodeURIComponent(queued.clientId)}`);

        socket.emit('message', Buffer.from(JSON.stringify({
            type: 'progress',
            data: {
                prompt_id: 'different-prompt',
                node: '12',
                value: 4,
                max: 8
            }
        })), false);
        socket.emit('message', Buffer.from(JSON.stringify({
            type: 'progress',
            data: {
                prompt_id: 'progress-prompt',
                node: '12',
                value: 3,
                max: 8
            }
        })), false);
        historyComplete = true;

        const result = await completionPromise;
        assert.equal(result.success, true);
        assert.equal(result.images[0].filename, 'result.png');
        assert.deepEqual(progressEvents, [{
            promptId: 'progress-prompt',
            nodeId: '12',
            value: 3,
            max: 8,
            fraction: 0.375
        }]);
        assert.equal(socket.readyState, FakeWebSocket.CLOSED);
    } finally {
        axios.post = originalPost;
        axios.get = originalGet;
    }
});

test('ComfyUI client deletes queued prompt ids and interrupts active execution', { concurrency: false }, async () => {
    const originalPost = axios.post;
    const requests = [];
    axios.post = async (url, payload) => {
        requests.push({ url, payload });
        return { data: {} };
    };

    try {
        const client = new ComfyUIClient({
            imagegen: {
                server: { host: 'comfy.example', port: 8188 }
            }
        });
        const result = await client.cancelPrompts(['prompt-b', 'prompt-a', 'prompt-b']);

        assert.deepEqual(result.deletedPromptIds, ['prompt-b', 'prompt-a']);
        assert.equal(result.interrupted, true);
        assert.deepEqual(requests, [
            {
                url: 'http://comfy.example:8188/queue',
                payload: { delete: ['prompt-b', 'prompt-a'] }
            },
            {
                url: 'http://comfy.example:8188/interrupt',
                payload: {}
            }
        ]);
    } finally {
        axios.post = originalPost;
    }
});

test('ComfyUI completion polling stops immediately when its signal is aborted', { concurrency: false }, async () => {
    const originalGet = axios.get;
    let historyRequestCount = 0;
    axios.get = async () => {
        historyRequestCount += 1;
        return { data: {} };
    };

    try {
        const client = new ComfyUIClient({
            imagegen: {
                server: { host: 'comfy.example', port: 8188 }
            }
        });
        const controller = new AbortController();
        const completionPromise = client.waitForCompletion('cancel-me', 300000, 300000, {
            signal: controller.signal
        });

        while (historyRequestCount === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }
        controller.abort('load requested');

        await assert.rejects(completionPromise, error => (
            error?.name === 'AbortError' && /load requested/.test(error.message)
        ));
        assert.equal(historyRequestCount, 1);
    } finally {
        axios.get = originalGet;
    }
});
