const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function deferred() {
    let resolve;
    const promise = new Promise(innerResolve => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

test('cancel-all terminates an untracked non-stream prompt without transport retries', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalPost = axios.post;
    const requestStarted = deferred();
    const requestCancelled = deferred();
    let transportCalls = 0;

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'http://provider.example/v1',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 6,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };
    axios.post = async (_url, _payload, options = {}) => {
        transportCalls += 1;
        requestStarted.resolve();
        return await new Promise((resolve, reject) => {
            const onAbort = () => {
                requestCancelled.resolve();
                reject(options.signal?.reason || new Error('cancelled'));
            };
            if (options.signal?.aborted) {
                onAbort();
                return;
            }
            options.signal?.addEventListener('abort', onAbort, { once: true });
        });
    };

    try {
        const completion = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Wait until cancelled.' }],
            metadataLabel: 'cancel_all_non_stream_test',
            validateXML: false,
            output: 'silent'
        });
        await requestStarted.promise;

        const cancellation = LLMClient.cancelAllPrompts('Stop & Undo requested.');
        await requestCancelled.promise;

        await assert.rejects(
            completion,
            error => {
                assert.equal(error.code, 'PROMPT_CANCELLED');
                assert.match(error.message, /Stop & Undo requested/);
                return true;
            }
        );
        const drain = await LLMClient.waitForPromptDrain({ timeoutMs: 1000, pollIntervalMs: 5 });

        assert.equal(cancellation.canceledCount, 1);
        assert.deepEqual(cancellation.canceledPromptIds, []);
        assert.equal(transportCalls, 1);
        assert.equal(drain.activeAttemptCount, 0);
    } finally {
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});

test('cancel-all invalidates a staged queue reservation between completion steps', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'http://provider.example/v1',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };

    try {
        await LLMClient.withPromptQueueReservation(async queueReservation => {
            const cancellation = LLMClient.cancelAllPrompts('Stop between TinyBrain stages.');
            assert.equal(cancellation.activeReservationsBefore, 1);

            await assert.rejects(
                LLMClient.chatCompletion({
                    messages: [{ role: 'user', content: 'This stage must never start.' }],
                    metadataLabel: 'cancelled_reserved_stage_test',
                    queueReservation,
                    forceOutput: 'unexpected',
                    validateXML: false,
                    output: 'silent'
                }),
                error => {
                    assert.equal(error.code, 'PROMPT_CANCELLED');
                    assert.match(error.message, /Stop between TinyBrain stages/);
                    return true;
                }
            );
        });

        const drain = await LLMClient.waitForPromptDrain({ timeoutMs: 1000, pollIntervalMs: 5 });
        assert.equal(drain.activeReservationCount, 0);
    } finally {
        Globals.config = originalConfig;
    }
});
