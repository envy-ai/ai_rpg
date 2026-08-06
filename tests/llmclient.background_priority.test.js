const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function createDeferred() {
    let resolve;
    const promise = new Promise(innerResolve => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

function flushTurn() {
    return new Promise(resolve => setImmediate(resolve));
}

test('background LLM requests leave one configured slot available for foreground prompts', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const modelName = `priority-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const started = [];
    const backgroundOne = createDeferred();
    const backgroundTwo = createDeferred();

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: modelName,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 2
        }
    };

    axios.post = async (_endpoint, payload) => {
        const label = payload?.messages?.[0]?.content || '';
        started.push(label);
        if (label === 'background one') {
            await backgroundOne.promise;
        }
        if (label === 'background two') {
            await backgroundTwo.promise;
        }
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `response-${label.replace(/\s+/g, '-')}`,
                object: 'chat.completion',
                created: 1,
                model: modelName,
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                            role: 'assistant',
                            content: `<final>${label}</final>`
                        }
                    }
                ]
            }
        };
    };

    try {
        const firstBackground = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'background one' }],
            metadataLabel: 'npc_memories_background_one',
            runInBackground: true,
            validateXML: false,
            output: 'silent'
        });
        const secondBackground = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'background two' }],
            metadataLabel: 'npc_memories_background_two',
            runInBackground: true,
            validateXML: false,
            output: 'silent'
        });

        await flushTurn();
        assert.deepEqual(started, ['background one']);

        const foreground = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'foreground travel' }],
            metadataLabel: 'player_action',
            validateXML: false,
            output: 'silent'
        });

        await flushTurn();
        assert.deepEqual(started, ['background one', 'foreground travel']);

        backgroundOne.resolve();
        backgroundTwo.resolve();
        await Promise.all([firstBackground, secondBackground, foreground]);
        assert.deepEqual(started, ['background one', 'foreground travel', 'background two']);
    } finally {
        backgroundOne.resolve();
        backgroundTwo.resolve();
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('root max_concurrent_requests_all_models caps requests across model semaphore keys', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const modelOne = `global-cap-one-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const modelTwo = `global-cap-two-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const started = [];
    const firstRequest = createDeferred();

    Globals.config = {
        max_concurrent_requests_all_models: 1,
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: modelOne,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 2
        }
    };

    axios.post = async (_endpoint, payload) => {
        const label = payload?.messages?.[0]?.content || '';
        started.push(`${payload?.model || ''}:${label}`);
        if (label === 'first model request') {
            await firstRequest.promise;
        }
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `response-${label.replace(/\s+/g, '-')}`,
                object: 'chat.completion',
                created: 1,
                model: payload?.model || modelOne,
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                            role: 'assistant',
                            content: `<final>${label}</final>`
                        }
                    }
                ]
            }
        };
    };

    try {
        const first = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'first model request' }],
            model: modelOne,
            metadataLabel: 'global_cap_first',
            validateXML: false,
            output: 'silent'
        });
        const second = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'second model request' }],
            model: modelTwo,
            metadataLabel: 'global_cap_second',
            validateXML: false,
            output: 'silent'
        });

        await flushTurn();
        assert.deepEqual(started, [`${modelOne}:first model request`]);

        firstRequest.resolve();
        await Promise.all([first, second]);
        assert.deepEqual(started, [
            `${modelOne}:first model request`,
            `${modelTwo}:second model request`
        ]);
    } finally {
        firstRequest.resolve();
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('root max_concurrent_requests_all_models rejects invalid values loudly', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let axiosCalled = false;

    Globals.config = {
        max_concurrent_requests_all_models: 0,
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: `invalid-global-cap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 2
        }
    };

    axios.post = async () => {
        axiosCalled = true;
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'invalid-global-cap-response',
                object: 'chat.completion',
                created: 1,
                model: Globals.config.ai.model,
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '<final>unexpected</final>'
                        }
                    }
                ]
            }
        };
    };

    try {
        await assert.rejects(
            () => LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'invalid global cap' }],
                metadataLabel: 'invalid_global_cap',
                validateXML: false,
                output: 'silent'
            }),
            /max_concurrent_requests_all_models must be a positive integer/
        );
        assert.equal(axiosCalled, false);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('prompt queue reservation retains a model semaphore permit between staged calls', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const modelName = `reserved-model-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const started = [];
    let competingRequest = null;

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: modelName,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1
        }
    };

    axios.post = async (_endpoint, payload) => {
        const label = payload?.messages?.[0]?.content || '';
        started.push(label);
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `response-${label.replace(/\s+/g, '-')}`,
                object: 'chat.completion',
                created: 1,
                model: modelName,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: label }
                }]
            }
        };
    };

    try {
        await LLMClient.withPromptQueueReservation(async (queueReservation) => {
            await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'reserved stage one' }],
                metadataLabel: 'player_action',
                queueReservation,
                validateXML: false,
                output: 'silent'
            });

            competingRequest = LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'competing prompt' }],
                metadataLabel: 'plot_analysis',
                validateXML: false,
                output: 'silent'
            });
            await flushTurn();
            assert.deepEqual(started, ['reserved stage one']);

            await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'reserved stage two' }],
                metadataLabel: 'player_action',
                queueReservation,
                validateXML: false,
                output: 'silent'
            });
            assert.deepEqual(started, ['reserved stage one', 'reserved stage two']);
        });

        await competingRequest;
        assert.deepEqual(started, [
            'reserved stage one',
            'reserved stage two',
            'competing prompt'
        ]);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('prompt queue reservation retains the all-model permit across staged calls', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const modelOne = `reserved-global-one-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const modelTwo = `reserved-global-two-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const started = [];
    let competingRequest = null;

    Globals.config = {
        max_concurrent_requests_all_models: 1,
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: modelOne,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 2
        }
    };

    axios.post = async (_endpoint, payload) => {
        const label = payload?.messages?.[0]?.content || '';
        started.push(`${payload?.model || ''}:${label}`);
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `response-${label.replace(/\s+/g, '-')}`,
                object: 'chat.completion',
                created: 1,
                model: payload?.model || modelOne,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: label }
                }]
            }
        };
    };

    try {
        await LLMClient.withPromptQueueReservation(async (queueReservation) => {
            await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'reserved global stage one' }],
                model: modelOne,
                metadataLabel: 'player_action',
                queueReservation,
                validateXML: false,
                output: 'silent'
            });

            competingRequest = LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'other model prompt' }],
                model: modelTwo,
                metadataLabel: 'plot_analysis',
                validateXML: false,
                output: 'silent'
            });
            await flushTurn();
            assert.deepEqual(started, [`${modelOne}:reserved global stage one`]);

            await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'reserved global stage two' }],
                model: modelOne,
                metadataLabel: 'player_action',
                queueReservation,
                validateXML: false,
                output: 'silent'
            });
            assert.deepEqual(started, [
                `${modelOne}:reserved global stage one`,
                `${modelOne}:reserved global stage two`
            ]);
        });

        await competingRequest;
        assert.deepEqual(started, [
            `${modelOne}:reserved global stage one`,
            `${modelOne}:reserved global stage two`,
            `${modelTwo}:other model prompt`
        ]);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('prompt queue reservation can yield permits for a nested different-model prompt', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const modelOne = `reserved-yield-one-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const modelTwo = `reserved-yield-two-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const started = [];

    Globals.config = {
        max_concurrent_requests_all_models: 1,
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: modelOne,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1
        }
    };

    axios.post = async (_endpoint, payload) => {
        const label = payload?.messages?.[0]?.content || '';
        started.push(`${payload?.model || ''}:${label}`);
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `response-${label.replace(/\s+/g, '-')}`,
                object: 'chat.completion',
                created: 1,
                model: payload?.model || modelOne,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: label }
                }]
            }
        };
    };

    try {
        await LLMClient.withPromptQueueReservation(async (queueReservation) => {
            await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'reserved stage one' }],
                model: modelOne,
                metadataLabel: 'player_action',
                queueReservation,
                validateXML: false,
                output: 'silent'
            });

            await LLMClient.withPromptQueueReservationYield(queueReservation, async () => {
                await LLMClient.chatCompletion({
                    messages: [{ role: 'user', content: 'nested tool prompt' }],
                    model: modelTwo,
                    metadataLabel: 'alter_location',
                    validateXML: false,
                    output: 'silent'
                });
            });

            await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'reserved stage two' }],
                model: modelOne,
                metadataLabel: 'player_action',
                queueReservation,
                validateXML: false,
                output: 'silent'
            });
        });

        assert.deepEqual(started, [
            `${modelOne}:reserved stage one`,
            `${modelTwo}:nested tool prompt`,
            `${modelOne}:reserved stage two`
        ]);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('prompt queue reservation reacquires its permits when yielded work fails', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const modelName = `reserved-yield-failure-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const started = [];

    Globals.config = {
        max_concurrent_requests_all_models: 1,
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: modelName,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1
        }
    };
    axios.post = async (_endpoint, payload) => {
        const label = payload?.messages?.[0]?.content || '';
        started.push(label);
        return {
            status: 200,
            data: {
                model: modelName,
                choices: [{
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: label }
                }]
            }
        };
    };

    try {
        await LLMClient.withPromptQueueReservation(async (queueReservation) => {
            await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'stage before failure' }],
                metadataLabel: 'player_action',
                queueReservation,
                validateXML: false,
                output: 'silent'
            });
            await assert.rejects(
                () => LLMClient.withPromptQueueReservationYield(queueReservation, async () => {
                    throw new Error('nested tool failed');
                }),
                /nested tool failed/
            );
            await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'stage after failure' }],
                metadataLabel: 'player_action',
                queueReservation,
                validateXML: false,
                output: 'silent'
            });
        });

        assert.deepEqual(started, ['stage before failure', 'stage after failure']);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('prompt queue reservation releases permits when its callback fails', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const modelName = `reserved-failure-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const started = [];

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: modelName,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1
        }
    };

    axios.post = async (_endpoint, payload) => {
        const label = payload?.messages?.[0]?.content || '';
        started.push(label);
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `response-${label.replace(/\s+/g, '-')}`,
                object: 'chat.completion',
                created: 1,
                model: modelName,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: label }
                }]
            }
        };
    };

    try {
        await assert.rejects(
            () => LLMClient.withPromptQueueReservation(async (queueReservation) => {
                await LLMClient.chatCompletion({
                    messages: [{ role: 'user', content: 'reserved before failure' }],
                    metadataLabel: 'player_action',
                    queueReservation,
                    validateXML: false,
                    output: 'silent'
                });
                throw new Error('intentional reservation failure');
            }),
            /intentional reservation failure/
        );

        await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'request after failure' }],
            metadataLabel: 'plot_analysis',
            validateXML: false,
            output: 'silent'
        });
        assert.deepEqual(started, ['reserved before failure', 'request after failure']);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('prompt queue reservation retains its permit across transport retries', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const modelName = `reserved-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const started = [];
    let retryStageAttempts = 0;
    let competingRequest = null;

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: modelName,
            stream: false,
            retryAttempts: 1,
            waitAfterError: 0,
            waitAfterNetworkError: 0,
            max_concurrent_requests: 1
        }
    };

    axios.post = async (_endpoint, payload) => {
        const label = payload?.messages?.[0]?.content || '';
        started.push(label);
        if (label === 'reserved retry stage') {
            retryStageAttempts += 1;
            if (retryStageAttempts === 1) {
                const error = new Error('intentional retryable network failure');
                error.code = 'ECONNRESET';
                throw error;
            }
        }
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `response-${label.replace(/\s+/g, '-')}`,
                object: 'chat.completion',
                created: 1,
                model: modelName,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: label }
                }]
            }
        };
    };

    try {
        await LLMClient.withPromptQueueReservation(async (queueReservation) => {
            await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'reserved initial stage' }],
                metadataLabel: 'player_action',
                queueReservation,
                validateXML: false,
                output: 'silent'
            });

            competingRequest = LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'competing during retry' }],
                metadataLabel: 'plot_analysis',
                validateXML: false,
                output: 'silent'
            });
            await flushTurn();

            const response = await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'reserved retry stage' }],
                metadataLabel: 'player_action',
                queueReservation,
                validateXML: false,
                output: 'silent'
            });
            assert.equal(response, 'reserved retry stage');
            assert.equal(retryStageAttempts, 2);
            assert.deepEqual(started, [
                'reserved initial stage',
                'reserved retry stage',
                'reserved retry stage'
            ]);
        });

        await competingRequest;
        assert.deepEqual(started, [
            'reserved initial stage',
            'reserved retry stage',
            'reserved retry stage',
            'competing during retry'
        ]);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('a failed foreground prompt retries before already queued prompts', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const modelName = `retry-front-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const firstFailure = createDeferred();
    const retryCompletion = createDeferred();
    const started = [];
    let failedPromptAttempts = 0;

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: modelName,
            stream: false,
            retryAttempts: 1,
            waitAfterError: 0,
            waitAfterNetworkError: 0,
            max_concurrent_requests: 1
        }
    };

    axios.post = async (_endpoint, payload) => {
        const label = payload?.messages?.[0]?.content || '';
        started.push(label);
        if (label === 'failed prompt') {
            failedPromptAttempts += 1;
            if (failedPromptAttempts === 1) {
                await firstFailure.promise;
                const error = new Error('intentional first-attempt failure');
                error.code = 'ECONNRESET';
                throw error;
            }
            await retryCompletion.promise;
        }
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `response-${label.replace(/\s+/g, '-')}`,
                object: 'chat.completion',
                created: 1,
                model: modelName,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: label }
                }]
            }
        };
    };

    try {
        const failed = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'failed prompt' }],
            metadataLabel: 'retry_front_failed',
            validateXML: false,
            output: 'silent'
        });
        await flushTurn();

        const queuedOne = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'queued one' }],
            metadataLabel: 'retry_front_queued_one',
            validateXML: false,
            output: 'silent'
        });
        const queuedTwo = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'queued two' }],
            metadataLabel: 'retry_front_queued_two',
            validateXML: false,
            output: 'silent'
        });
        await flushTurn();
        assert.deepEqual(started, ['failed prompt']);

        firstFailure.resolve();
        await flushTurn();
        await flushTurn();
        assert.deepEqual(started, ['failed prompt', 'failed prompt']);

        retryCompletion.resolve();
        await Promise.all([failed, queuedOne, queuedTwo]);
        assert.deepEqual(started, [
            'failed prompt',
            'failed prompt',
            'queued one',
            'queued two'
        ]);
    } finally {
        firstFailure.resolve();
        retryCompletion.resolve();
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('a failed background prompt retries before background peers without bypassing foreground work', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const modelName = `retry-front-background-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const firstFailure = createDeferred();
    const retryCompletion = createDeferred();
    const started = [];
    let failedPromptAttempts = 0;

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: modelName,
            stream: false,
            retryAttempts: 1,
            waitAfterError: 0,
            waitAfterNetworkError: 0,
            max_concurrent_requests: 1
        }
    };

    axios.post = async (_endpoint, payload) => {
        const label = payload?.messages?.[0]?.content || '';
        started.push(label);
        if (label === 'failed background') {
            failedPromptAttempts += 1;
            if (failedPromptAttempts === 1) {
                await firstFailure.promise;
                const error = new Error('intentional background failure');
                error.code = 'ECONNRESET';
                throw error;
            }
            await retryCompletion.promise;
        }
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `response-${label.replace(/\s+/g, '-')}`,
                object: 'chat.completion',
                created: 1,
                model: modelName,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: label }
                }]
            }
        };
    };

    try {
        const failed = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'failed background' }],
            metadataLabel: 'retry_front_background_failed',
            runInBackground: true,
            validateXML: false,
            output: 'silent'
        });
        await flushTurn();

        const backgroundPeer = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'background peer' }],
            metadataLabel: 'retry_front_background_peer',
            runInBackground: true,
            validateXML: false,
            output: 'silent'
        });
        const foreground = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'foreground peer' }],
            metadataLabel: 'retry_front_foreground_peer',
            validateXML: false,
            output: 'silent'
        });
        await flushTurn();
        assert.deepEqual(started, ['failed background']);

        firstFailure.resolve();
        await flushTurn();
        await flushTurn();
        await flushTurn();
        assert.deepEqual(started, [
            'failed background',
            'foreground peer',
            'failed background'
        ]);

        retryCompletion.resolve();
        await Promise.all([failed, backgroundPeer, foreground]);
        assert.deepEqual(started, [
            'failed background',
            'foreground peer',
            'failed background',
            'background peer'
        ]);
    } finally {
        firstFailure.resolve();
        retryCompletion.resolve();
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('a failed prompt keeps retry priority at the all-model queue', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const modelOne = `retry-front-global-one-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const modelTwo = `retry-front-global-two-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const firstFailure = createDeferred();
    const retryCompletion = createDeferred();
    const started = [];
    let failedPromptAttempts = 0;

    Globals.config = {
        max_concurrent_requests_all_models: 1,
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: modelOne,
            stream: false,
            retryAttempts: 1,
            waitAfterError: 0,
            waitAfterNetworkError: 0,
            max_concurrent_requests: 1
        }
    };

    axios.post = async (_endpoint, payload) => {
        const label = payload?.messages?.[0]?.content || '';
        started.push(label);
        if (label === 'global failed prompt') {
            failedPromptAttempts += 1;
            if (failedPromptAttempts === 1) {
                await firstFailure.promise;
                const error = new Error('intentional all-model first-attempt failure');
                error.code = 'ECONNRESET';
                throw error;
            }
            await retryCompletion.promise;
        }
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `response-${label.replace(/\s+/g, '-')}`,
                object: 'chat.completion',
                created: 1,
                model: payload?.model || modelOne,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: label }
                }]
            }
        };
    };

    try {
        const failed = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'global failed prompt' }],
            model: modelOne,
            metadataLabel: 'retry_front_global_failed',
            validateXML: false,
            output: 'silent'
        });
        await flushTurn();

        const queuedOtherModel = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'queued other model' }],
            model: modelTwo,
            metadataLabel: 'retry_front_global_queued',
            validateXML: false,
            output: 'silent'
        });
        await flushTurn();
        assert.deepEqual(started, ['global failed prompt']);

        firstFailure.resolve();
        await flushTurn();
        await flushTurn();
        assert.deepEqual(started, ['global failed prompt', 'global failed prompt']);

        retryCompletion.resolve();
        await Promise.all([failed, queuedOtherModel]);
        assert.deepEqual(started, [
            'global failed prompt',
            'global failed prompt',
            'queued other model'
        ]);
    } finally {
        firstFailure.resolve();
        retryCompletion.resolve();
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});
