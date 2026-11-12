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

test('TinyBrain technique action retains its reservation for nested destination expansion', { concurrency: false, timeout: 5000 }, async () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const line = source.split('\n').find(value => value.includes("if (toolCall.functionName === 'useTechnique') return withNestedPrompt"));
    assert.ok(line, 'TinyBrain technique execution must retain its reservation');
    const priorConfig = Globals.config, priorPost = axios.post;
    const model = `technique-yield-${Date.now()}`;
    Globals.config = { max_concurrent_requests_all_models: 1, ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test-key', model, stream: false, retryAttempts: 0, max_concurrent_requests: 1 } };
    const started = [], committed = [];
    axios.post = async (_url, payload) => { const label = payload.messages[0].content; started.push(label); return { status: 200, statusText: 'OK', headers: {}, config: {}, data: { id: 'response', object: 'chat.completion', created: 1, model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: label } }] } }; };
    try {
        await LLMClient.withPromptQueueReservation(async queueReservation => {
            await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'before' }], model, queueReservation, validateXML: false, output: 'silent' });
            const executeTechniqueOperation = async () => {
                await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'stub expansion' }], model, validateXML: false, output: 'silent' });
                return { content: 'Arrived at Courtyard.', metadata: { techniqueDestinationContext: { name: 'Courtyard' } } };
            };
            const session = { commit: key => committed.push(key), reject: (_key, error) => { throw error; } };
            const runner = fs.readFileSync(require.resolve('../TinyBrainPromptRunner.js'), 'utf8');
            assert.match(runner, /withNestedPrompt: callback => LLMClient\.withPromptQueueReservationNested\(queueReservation, callback\)/);
            const withNestedPrompt = callback => LLMClient.withPromptQueueReservationNested(queueReservation, callback);
            const execute = new Function('withNestedPrompt', 'executeTechniqueOperation', 'playerTechniqueSession', 'techniqueTurnId', 'injectedDieRollOverride', 'forcedSkillCheckRollResolver', `return toolCall => { ${line} };`)(withNestedPrompt, executeTechniqueOperation, session, 'turn', null, null);
            const result = await execute({ functionName: 'useTechnique', id: 'turn:resolution:1', techniqueAttemptKey: 'attempt', argumentsObject: {} });
            assert.match(result.content, /Arrived at Courtyard/);
            assert.deepEqual(result.metadata.techniqueDestinationContext, { name: 'Courtyard' });
            const formatted = require('../PlayerActionResolutionPlan.js').formatPlayerActionResolutionResults([{ name: 'useTechnique', content: result.content, metadata: result.metadata }]);
            assert.match(formatted, /Arrived at Courtyard/);
            await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'after' }], model, queueReservation, validateXML: false, output: 'silent' });
        });
        assert.deepEqual(started, ['before', 'stub expansion', 'after']);
        assert.deepEqual(committed, ['attempt']);
    } finally { Globals.config = priorConfig; axios.post = priorPost; }
});

test('a foreground request queued for a busy model does not block a background request for a free model', { concurrency: false, timeout: 5000 }, async () => {
    const originalPost = axios.post;
    const originalConfig = Globals.config;
    const modelA = `capacity-a-${Date.now()}`;
    const modelB = `capacity-b-${Date.now()}`;
    const firstGate = createDeferred();
    const firstStarted = createDeferred();
    const otherStarted = createDeferred();
    const started = [];
    Globals.config = {
        max_concurrent_requests_all_models: 2,
        ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test-key', model: modelA, stream: false, retryAttempts: 0, max_concurrent_requests: 1 }
    };
    axios.post = async (_url, payload) => {
        const label = payload.messages[0].content;
        started.push(label);
        if (label === 'first A') { firstStarted.resolve(); await firstGate.promise; }
        if (label === 'free B') otherStarted.resolve();
        return { status: 200, data: { model: payload.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: label } }] } };
    };
    const request = (label, model, runInBackground = false) => LLMClient.chatCompletion({ messages: [{ role: 'user', content: label }], model, runInBackground, metadataLabel: 'queue_capacity_test', validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true });
    try {
        const first = request('first A', modelA);
        await firstStarted.promise;
        const waiting = request('waiting A', modelA);
        await flushTurn();
        const other = request('free B', modelB, true);
        await otherStarted.promise;
        assert.deepEqual(started, ['first A', 'free B']);
        firstGate.resolve();
        await Promise.all([first, waiting, other]);
        assert.deepEqual(started, ['first A', 'free B', 'waiting A']);
    } finally {
        firstGate.resolve();
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});

test('inherited parallel child requests serialize, cancelled children leave the owner usable', { concurrency: false, timeout: 10000 }, async () => {
    const oldConfig = Globals.config, oldPost = axios.post;
    const firstStarted = createDeferred(), firstGate = createDeferred();
    const queued = new AbortController();
    const labels = [];
    Globals.config = { max_concurrent_requests_all_models: 1, ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test-key', model: `nested-parallel-${Date.now()}`, stream: false, retryAttempts: 0, max_concurrent_requests: 1 } };
    axios.post = async (_url, payload) => {
        const label = payload.messages[0].content;
        labels.push(label);
        if (label === 'child one') { firstStarted.resolve(); await firstGate.promise; }
        return { status: 200, data: { model: payload.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: label } }] } };
    };
    const request = (label, extra = {}) => LLMClient.chatCompletion({ messages: [{ role: 'user', content: label }], metadataLabel: 'nested_parallel_test', validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true, ...extra });
    try {
        await LLMClient.withPromptQueueReservation(async reservation => {
            await request('root', { queueReservation: reservation });
            await LLMClient.withPromptQueueReservationNested(reservation, async () => {
                const first = request('child one');
                await firstStarted.promise;
                const cancelled = request('cancelled child', { signal: queued.signal });
                const cancelledOutcome = cancelled.then(() => null, error => error);
                const second = request('child two');
                await flushTurn();
                assert.deepEqual(labels, ['root', 'child one']);
                queued.abort(new Error('Cancel queued child'));
                assert.match((await cancelledOutcome).message, /Cancel queued child/);
                firstGate.resolve();
                assert.deepEqual(await Promise.all([first, second]), ['child one', 'child two']);
            });
            await request('root final', { queueReservation: reservation });
        });
        assert.deepEqual(labels, ['root', 'child one', 'child two', 'root final']);
    } finally { firstGate.resolve(); queued.abort(); Globals.config = oldConfig; axios.post = oldPost; }
});

test('explicit concurrent reservation use and self-nesting response callbacks fail without deadlock', { concurrency: false, timeout: 10000 }, async () => {
    const oldConfig = Globals.config, oldPost = axios.post;
    const started = createDeferred(), gate = createDeferred();
    let nested;
    Globals.config = { max_concurrent_requests_all_models: 1, ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test-key', model: `nested-reentrancy-${Date.now()}`, stream: false, retryAttempts: 0, max_concurrent_requests: 1 } };
    axios.post = async (_url, payload) => {
        const label = payload.messages[0].content;
        if (label === 'held') { started.resolve(); await gate.promise; }
        return { status: 200, data: { model: payload.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: label } }] } };
    };
    const request = (label, extra = {}) => LLMClient.chatCompletion({ messages: [{ role: 'user', content: label }], metadataLabel: 'nested_reentrancy_test', validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true, ...extra });
    try {
        await LLMClient.withPromptQueueReservation(async reservation => {
            const first = request('held', { queueReservation: reservation });
            await started.promise;
            await assert.rejects(request('explicit misuse', { queueReservation: reservation }), /concurrent|active/i);
            gate.resolve();
            await first;
            await LLMClient.withPromptQueueReservationNested(reservation, () => request('callback', { onResponse: () => {
                nested = request('self nested');
                nested.catch(() => {});
            } }));
            await assert.rejects(nested, /concurrent|active|reentrant|nested/i);
            assert.equal(await request('after', { queueReservation: reservation }), 'after');
        });
    } finally { gate.resolve(); Globals.config = oldConfig; axios.post = oldPost; }
});

test('parallel nested failure preserves its error, drains siblings, and releases the waiting outsider', { concurrency: false, timeout: 10000 }, async () => {
    const oldConfig = Globals.config, oldPost = axios.post;
    const firstStarted = createDeferred(), failFirst = createDeferred(), siblingGate = createDeferred();
    const calls = [];
    Globals.config = { max_concurrent_requests_all_models: 1, ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test-key', model: `nested-failure-${Date.now()}`, stream: false, retryAttempts: 0, max_concurrent_requests: 1 } };
    axios.post = async (_url, payload) => {
        const label = payload.messages[0].content;
        calls.push(label);
        if (label === 'fail child') { firstStarted.resolve(); await failFirst.promise; throw new Error('Original nested transport failure'); }
        if (label === 'sibling child') await siblingGate.promise;
        return { status: 200, data: { model: payload.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: label } }] } };
    };
    const request = (label, extra = {}) => LLMClient.chatCompletion({ messages: [{ role: 'user', content: label }], metadataLabel: 'nested_parallel_failure_test', validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true, ...extra });
    try {
        const running = LLMClient.withPromptQueueReservation(async reservation => {
            await request('root', { queueReservation: reservation });
            await LLMClient.withPromptQueueReservationNested(reservation, () => Promise.all([request('fail child'), request('sibling child')]));
        });
        const outcome = running.then(() => null, error => error);
        await firstStarted.promise;
        const outsider = request('outsider');
        await flushTurn();
        assert.deepEqual(calls, ['root', 'fail child']);
        failFirst.resolve();
        await flushTurn();
        siblingGate.resolve();
        assert.match((await outcome).message, /Original nested transport failure/);
        assert.equal(await outsider, 'outsider');
        assert.equal(calls.at(-1), 'outsider');
    } finally { failFirst.resolve(); siblingGate.resolve(); Globals.config = oldConfig; axios.post = oldPost; }
});
