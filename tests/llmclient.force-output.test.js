const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

test('LLMClient.chatCompletion includes the prompt label in chat completion error log filenames', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    const tempBaseDir = fs.mkdtempSync(path.join(tmpRoot, 'llmclient-error-log-'));

    axios.post = async () => {
        const error = new Error('Synthetic chat completion failure.');
        error.status = 500;
        throw error;
    };
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Trigger an error.' }],
            metadataLabel: 'event_checks',
            errorLogLabel: 'events-xml',
            validateXML: false,
            stream: false,
            retryAttempts: 0,
            output: 'silent'
        });

        assert.equal(result, '');
        const logDir = path.join(tempBaseDir, 'logs');
        const filenames = fs.readdirSync(logDir);
        assert.ok(
            filenames.some(filename => /^ERROR_chatCompletionError_events-xml_\d+\.log$/.test(filename)),
            `Expected events-xml chat completion error log, got: ${filenames.join(', ')}`
        );
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
});

test('LLMClient.chatCompletion marks per-attempt error logs when another retry will run', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    const tempBaseDir = fs.mkdtempSync(path.join(tmpRoot, 'llmclient-retry-log-'));
    let calls = 0;

    axios.post = async (_endpoint, payload) => {
        calls += 1;
        if (calls === 1) {
            const error = new Error('Synthetic transient chat completion failure.');
            error.status = 500;
            throw error;
        }
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'mock_response',
                model: payload.model,
                choices: [
                    {
                        message: { content: 'Recovered response.' },
                        finish_reason: 'stop'
                    }
                ],
                usage: { total_tokens: 12 }
            }
        };
    };
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 1,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Trigger one transient error.' }],
            metadataLabel: 'while_you_were_away',
            validateXML: false,
            stream: false,
            retryAttempts: 1,
            output: 'silent'
        });

        assert.equal(result, 'Recovered response.');
        assert.equal(calls, 2);
        const logDir = path.join(tempBaseDir, 'logs');
        const filenames = fs.readdirSync(logDir);
        const retryLogName = filenames.find(filename => /^ERROR_chatCompletionError_while_you_were_away_\d+\.log$/.test(filename));
        assert.ok(retryLogName, `Expected while-you-were-away retry log, got: ${filenames.join(', ')}`);
        const retryLog = fs.readFileSync(path.join(logDir, retryLogName), 'utf8');
        assert.match(retryLog, /"attemptNumber":1/);
        assert.match(retryLog, /"maxAttempts":2/);
        assert.match(retryLog, /"willRetry":true/);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
});

test('LLMClient.writeLogFile preserves retry metadata on errors with custom toJSON', { concurrency: false }, () => {
    const originalBaseDir = Globals.baseDir;
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    const tempBaseDir = fs.mkdtempSync(path.join(tmpRoot, 'llmclient-error-json-'));

    const error = new Error('Synthetic streamed timeout.');
    error.name = 'AggregateError';
    error.code = 'ETIMEDOUT';
    error.attemptNumber = 2;
    error.maxAttempts = 7;
    error.willRetry = true;
    error.toJSON = () => ({
        message: error.message,
        name: error.name,
        code: error.code,
        config: {
            responseType: 'stream'
        }
    });

    Globals.baseDir = tempBaseDir;

    try {
        const filePath = LLMClient.writeLogFile({
            prefix: 'chatCompletionError',
            metadataLabel: 'events-xml',
            error,
            payload: ''
        });

        const content = fs.readFileSync(filePath, 'utf8');
        assert.match(content, /"code":"ETIMEDOUT"/);
        assert.match(content, /"attemptNumber":2/);
        assert.match(content, /"maxAttempts":7/);
        assert.match(content, /"willRetry":true/);
    } finally {
        Globals.baseDir = originalBaseDir;
    }
});

test('LLMClient.chatCompletion uses forceOutput string without network call', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let onResponsePayload = null;
    let capturedRequest = null;
    let capturedResponse = null;

    axios.post = async () => {
        throw new Error('axios.post should not be called when forceOutput is provided.');
    };
    Globals.config = null;

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Run deterministic test.' }],
            forceOutput: '<final>Deterministic response</final>',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            captureRequestPayload: (payload) => {
                capturedRequest = payload;
            },
            captureResponsePayload: (payload) => {
                capturedResponse = payload;
            },
            onResponse: (response) => {
                onResponsePayload = response;
            }
        });

        assert.equal(result, '<final>Deterministic response</final>');
        assert.ok(capturedRequest && capturedRequest.stream === false);
        assert.equal(capturedRequest.forceOutput, '<final>Deterministic response</final>');
        assert.ok(capturedResponse?.choices?.[0]?.message?.content === '<final>Deterministic response</final>');
        assert.ok(onResponsePayload?.data?.choices?.[0]?.message?.content === '<final>Deterministic response</final>');
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion validates the final XML block when strict XML output has surrounding text', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const response = [
        'analysis before',
        '<response>hello</response>',
        '',
        'more analysis',
        '<response>world</response>',
        'analysis after'
    ].join('\n');

    axios.post = async () => {
        throw new Error('axios.post should not be called when forceOutput is provided.');
    };
    Globals.config = null;

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Run deterministic XML validation test.' }],
            forceOutput: response,
            validateXML: true,
            validateXMLStrict: true,
            output: 'silent',
            retryAttempts: 0
        });

        assert.equal(result, response);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion checks required tags against the final XML block', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const response = [
        '<response><editedText>draft</editedText></response>',
        '<response><other>final</other></response>'
    ].join('\n');

    axios.post = async () => {
        throw new Error('axios.post should not be called when forceOutput is provided.');
    };
    Globals.config = null;

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Run deterministic required-tag test.' }],
            forceOutput: response,
            validateXML: true,
            validateXMLStrict: true,
            requiredTags: ['editedText'],
            output: 'silent',
            retryAttempts: 0
        });

        assert.equal(result, '');
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion logs AI override profile summary without dumping override details', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalStdoutWrite = process.stdout.write;
    let stdoutOutput = '';
    let capturedPayload = null;

    process.stdout.write = function writeCapturedStdout(chunk, encoding, callback) {
        stdoutOutput += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        if (typeof encoding === 'function') {
            encoding();
        } else if (typeof callback === 'function') {
            callback();
        }
        return true;
    };
    axios.post = async (_endpoint, payload) => {
        capturedPayload = payload;
        return {
            status: 200,
            data: {
                choices: [
                    {
                        message: {
                            content: '<final>Override response</final>'
                        },
                        finish_reason: 'stop'
                    }
                ]
            }
        };
    };
    Globals.config = {
        ai: {
            endpoint: 'http://example.test/v1',
            apiKey: 'test-key',
            model: 'base-model',
            stream: false,
            supress_seed: true,
            max_concurrent_requests: 1
        },
        ai_model_overrides: {
            prose: {
                prompts: ['player_action'],
                model: 'override-model',
                temperature: 0.4,
                custom_args: {
                    provider_options: {
                        proseMode: true
                    }
                },
                headers: {
                    'X-Test-Override': 'yes'
                }
            }
        }
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Test override logging.' }],
            metadataLabel: 'player_action',
            validateXML: false,
            stream: false,
            retryAttempts: 0
        });

        assert.equal(result, '<final>Override response</final>');
        assert.equal(capturedPayload?.model, 'override-model');
        assert.equal(capturedPayload?.temperature, 0.4);

        const overrideSummaryLine = stdoutOutput
            .split(/\r?\n/)
            .find(line => line.includes('Applying AI model overrides for player_action'));
        assert.equal(
            overrideSummaryLine,
            'Applying AI model overrides for player_action (profiles: prose)'
        );
        assert.equal(stdoutOutput.includes('Applying AI config override for player_action'), false);
    } finally {
        process.stdout.write = originalStdoutWrite;
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion resolves forced outputs from fixture by metadataLabel', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalFixtureEnv = process.env.LLM_FORCE_OUTPUTS_FILE;
    const fixturePath = path.join(
        os.tmpdir(),
        `llm_force_outputs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`
    );
    const fixture = {
        strict: true,
        byMetadataLabel: {
            test_label: [
                '<final>Fixture response 1</final>',
                '<final>Fixture response 2</final>'
            ]
        }
    };

    let firstCapturedRequest = null;
    let secondCapturedRequest = null;
    axios.post = async () => {
        throw new Error('axios.post should not be called when forced-output fixture is provided.');
    };
    Globals.config = null;
    process.env.LLM_FORCE_OUTPUTS_FILE = fixturePath;
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    LLMClient.resetForcedOutputState();

    try {
        const firstResult = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Fixture test turn one.' }],
            metadataLabel: 'Test Label',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            captureRequestPayload: (payload) => {
                firstCapturedRequest = payload;
            }
        });
        const secondResult = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Fixture test turn two.' }],
            metadataLabel: 'Test Label',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            captureRequestPayload: (payload) => {
                secondCapturedRequest = payload;
            }
        });

        assert.equal(firstResult, '<final>Fixture response 1</final>');
        assert.equal(secondResult, '<final>Fixture response 2</final>');
        assert.equal(firstCapturedRequest?.forceOutput, '<final>Fixture response 1</final>');
        assert.equal(secondCapturedRequest?.forceOutput, '<final>Fixture response 2</final>');
    } finally {
        if (fs.existsSync(fixturePath)) {
            fs.rmSync(fixturePath, { force: true });
        }
        if (originalFixtureEnv === undefined) {
            delete process.env.LLM_FORCE_OUTPUTS_FILE;
        } else {
            process.env.LLM_FORCE_OUTPUTS_FILE = originalFixtureEnv;
        }
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        LLMClient.resetForcedOutputState();
    }
});

test('LLMClient.chatCompletion throws when strict forced-output fixture bucket is exhausted', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalFixtureEnv = process.env.LLM_FORCE_OUTPUTS_FILE;
    const fixturePath = path.join(
        os.tmpdir(),
        `llm_force_outputs_exhaust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`
    );
    const fixture = {
        strict: true,
        byMetadataLabel: {
            only_once: ['<final>Single response</final>']
        }
    };

    axios.post = async () => {
        throw new Error('axios.post should not be called when forced-output fixture is provided.');
    };
    Globals.config = null;
    process.env.LLM_FORCE_OUTPUTS_FILE = fixturePath;
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    LLMClient.resetForcedOutputState();

    try {
        const firstResult = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'First call uses only fixture entry.' }],
            metadataLabel: 'only_once',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        });
        assert.equal(firstResult, '<final>Single response</final>');

        await assert.rejects(
            () => LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Second call should fail when bucket is exhausted.' }],
                metadataLabel: 'only_once',
                requiredRegex: /<final>[\s\S]*?<\/final>/,
                validateXML: false,
                output: 'silent',
                retryAttempts: 0
            }),
            /Forced output bucket "only_once" is exhausted/
        );
    } finally {
        if (fs.existsSync(fixturePath)) {
            fs.rmSync(fixturePath, { force: true });
        }
        if (originalFixtureEnv === undefined) {
            delete process.env.LLM_FORCE_OUTPUTS_FILE;
        } else {
            process.env.LLM_FORCE_OUTPUTS_FILE = originalFixtureEnv;
        }
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        LLMClient.resetForcedOutputState();
    }
});

test('LLMClient.chatCompletion resolves prompt_<label> forced-output buckets', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalFixtureEnv = process.env.LLM_FORCE_OUTPUTS_FILE;
    const fixturePath = path.join(
        os.tmpdir(),
        `llm_force_outputs_prompt_prefix_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`
    );
    const fixture = {
        strict: true,
        byMetadataLabel: {
            prompt_quest_check: ['<quests></quests>']
        }
    };

    axios.post = async () => {
        throw new Error('axios.post should not be called when forced-output fixture is provided.');
    };
    Globals.config = null;
    process.env.LLM_FORCE_OUTPUTS_FILE = fixturePath;
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    LLMClient.resetForcedOutputState();

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Quest check fixture fallback test.' }],
            metadataLabel: 'quest_check',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        });
        assert.equal(result, '<quests></quests>');
    } finally {
        if (fs.existsSync(fixturePath)) {
            fs.rmSync(fixturePath, { force: true });
        }
        if (originalFixtureEnv === undefined) {
            delete process.env.LLM_FORCE_OUTPUTS_FILE;
        } else {
            process.env.LLM_FORCE_OUTPUTS_FILE = originalFixtureEnv;
        }
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        LLMClient.resetForcedOutputState();
    }
});

test('LLMClient.chatCompletion resolves <label>_group_N buckets in order', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalFixtureEnv = process.env.LLM_FORCE_OUTPUTS_FILE;
    const fixturePath = path.join(
        os.tmpdir(),
        `llm_force_outputs_grouped_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`
    );
    const fixture = {
        strict: true,
        byMetadataLabel: {
            event_checks_group_2: ['group-2'],
            event_checks_group_1: ['group-1']
        }
    };

    axios.post = async () => {
        throw new Error('axios.post should not be called when forced-output fixture is provided.');
    };
    Globals.config = null;
    process.env.LLM_FORCE_OUTPUTS_FILE = fixturePath;
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    LLMClient.resetForcedOutputState();

    try {
        const first = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Event checks group 1 request.' }],
            metadataLabel: 'event_checks',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        });
        const second = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Event checks group 2 request.' }],
            metadataLabel: 'event_checks',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        });

        assert.equal(first, 'group-1');
        assert.equal(second, 'group-2');
    } finally {
        if (fs.existsSync(fixturePath)) {
            fs.rmSync(fixturePath, { force: true });
        }
        if (originalFixtureEnv === undefined) {
            delete process.env.LLM_FORCE_OUTPUTS_FILE;
        } else {
            process.env.LLM_FORCE_OUTPUTS_FILE = originalFixtureEnv;
        }
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        LLMClient.resetForcedOutputState();
    }
});

test('LLMClient.chatCompletion prepends cachebuster to the final user message only', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const messages = [
        { role: 'system', content: 'System instructions.' },
        { role: 'user', content: 'Earlier user message.' },
        { role: 'assistant', content: 'Intermediate assistant reply.' },
        { role: 'user', content: 'Main prompt body.' }
    ];
    const originalMessagesSnapshot = JSON.stringify(messages);
    let capturedRequest = null;

    axios.post = async (_endpoint, payload) => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: {
            id: 'mock_response',
            model: payload.model,
            choices: [
                {
                    message: { content: 'Cachebuster response.' },
                    finish_reason: 'stop'
                }
            ],
            usage: { total_tokens: 12 }
        }
    });
    Globals.config = {
        ai: {
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'mock-model',
            stream: false,
            cachebuster: true,
            retryAttempts: 0,
            supress_seed: true
        }
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            captureRequestPayload: (payload) => {
                capturedRequest = payload;
            }
        });

        assert.equal(result, 'Cachebuster response.');
        assert.ok(capturedRequest);
        assert.equal(JSON.stringify(messages), originalMessagesSnapshot);
        assert.equal(capturedRequest.messages[0].content, 'System instructions.');
        assert.equal(capturedRequest.messages[1].content, 'Earlier user message.');
        assert.equal(capturedRequest.messages[2].content, 'Intermediate assistant reply.');
        assert.match(
            capturedRequest.messages[3].content,
            /^\[cachebuster:[0-9a-f-]{36}\]\n\nMain prompt body\.$/
        );
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion turns the recent-story marker into a user-message boundary before cachebusting', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const marker = LLMClient.getRecentStoryMessageBoundaryMarker();
    const messages = [
        { role: 'system', content: 'System instructions.' },
        {
            role: 'user',
            content: `<gameState><stableContext>Stable.</stableContext>${marker}  <recentStoryHistory>Recent.</recentStoryHistory></gameState>`
        }
    ];
    const originalMessagesSnapshot = JSON.stringify(messages);
    let capturedRequest = null;

    axios.post = async (_endpoint, payload) => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: {
            id: 'mock_response',
            model: payload.model,
            choices: [
                {
                    message: { content: 'Boundary response.' },
                    finish_reason: 'stop'
                }
            ],
            usage: { total_tokens: 12 }
        }
    });
    Globals.config = {
        ai: {
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'mock-model',
            stream: false,
            cachebuster: true,
            retryAttempts: 0,
            supress_seed: true
        }
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            captureRequestPayload: (payload) => {
                capturedRequest = payload;
            }
        });

        assert.equal(result, 'Boundary response.');
        assert.equal(JSON.stringify(messages), originalMessagesSnapshot);
        assert.equal(capturedRequest.messages.length, 3);
        assert.equal(capturedRequest.messages[1].role, 'user');
        assert.equal(
            capturedRequest.messages[1].content,
            '<gameState><stableContext>Stable.</stableContext>'
        );
        assert.equal(capturedRequest.messages[2].role, 'user');
        assert.match(
            capturedRequest.messages[2].content,
            /^\[cachebuster:[0-9a-f-]{36}\]\n\n  <recentStoryHistory>Recent\.<\/recentStoryHistory><\/gameState>$/
        );
        assert.equal(
            capturedRequest.messages.some(message => String(message.content).includes(marker)),
            false
        );
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient section and recent-story expansion preserves later TinyBrain transcript chronology', () => {
    const recentStoryMarker = LLMClient.getRecentStoryMessageBoundaryMarker();
    const sectionMarker = LLMClient.getBaseContextSectionMessageBoundaryMarker();
    const messages = [
        { role: 'system', content: 'System instructions.' },
        {
            role: 'user',
            content: [
                '<setting>Stable.</setting>',
                sectionMarker,
                '<currentLocation>Scene.</currentLocation>',
                sectionMarker,
                '<player>Player.</player>',
                recentStoryMarker,
                '<recentStoryHistory>Recent.</recentStoryHistory>'
            ].join('')
        },
        { role: 'assistant', content: 'Checkpoint one response.' },
        { role: 'user', content: 'Checkpoint two prompt.' }
    ];

    const expanded = LLMClient.expandPromptMessageBoundaries(messages);

    assert.deepEqual(expanded, [
        { role: 'system', content: 'System instructions.' },
        { role: 'user', content: '<setting>Stable.</setting>' },
        { role: 'user', content: '<currentLocation>Scene.</currentLocation>' },
        { role: 'user', content: '<player>Player.</player>' },
        { role: 'user', content: '<recentStoryHistory>Recent.</recentStoryHistory>' },
        { role: 'assistant', content: 'Checkpoint one response.' },
        { role: 'user', content: 'Checkpoint two prompt.' }
    ]);
    assert.equal(JSON.stringify(messages).includes(sectionMarker), true);
    assert.equal(JSON.stringify(messages).includes(recentStoryMarker), true);
});

test('LLMClient rejects adjacent or misplaced internal message boundaries', () => {
    const sectionMarker = LLMClient.getBaseContextSectionMessageBoundaryMarker();

    assert.throws(
        () => LLMClient.expandPromptMessageBoundaries([
            { role: 'user', content: `First.${sectionMarker}${sectionMarker}Second.` }
        ]),
        /require non-empty content between every boundary/
    );
    assert.throws(
        () => LLMClient.expandPromptMessageBoundaries([
            { role: 'assistant', content: `First.${sectionMarker}Second.` }
        ]),
        /may only appear in a user message/
    );
});

test('LLMClient.chatCompletion supports forceOutput tool calls and skips terminal text validation for tool rounds', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let onResponsePayload = null;

    axios.post = async () => {
        throw new Error('axios.post should not be called when forceOutput is provided.');
    };
    Globals.config = null;

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Find Bob.' }],
            forceOutput: {
                model: 'mock-model',
                finishReason: 'tool_calls',
                message: {
                    content: '',
                    tool_calls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'locateNpcs',
                                arguments: '{"query":"Bob"}'
                            }
                        }
                    ]
                }
            },
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            expectedXmlRootTag: 'final',
            output: 'silent',
            retryAttempts: 0,
            onResponse: (response) => {
                onResponsePayload = response;
            }
        });

        assert.equal(result, '');
        assert.ok(onResponsePayload);
        assert.equal(onResponsePayload.data.model, 'mock-model');
        assert.equal(onResponsePayload.data.choices[0].finish_reason, 'tool_calls');
        assert.equal(onResponsePayload.data.choices[0].message.tool_calls.length, 1);
        assert.equal(onResponsePayload.data.choices[0].message.tool_calls[0].function.name, 'locateNpcs');
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion validateXMLStrict fails malformed forced XML output before returning a final response', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;

    axios.post = async () => {
        throw new Error('axios.post should not be called when forceOutput is provided.');
    };
    Globals.config = null;

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Strict XML validation test.' }],
            forceOutput: '<editedText>broken<editedText>',
            validateXML: true,
            validateXMLStrict: true,
            output: 'silent',
            retryAttempts: 0
        });

        assert.equal(
            result,
            '',
            'Malformed XML should fail validation and exhaust retries before producing a final response.'
        );
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion retries when the expected XML root is not closed', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    const tempBaseDir = fs.mkdtempSync(path.join(tmpRoot, 'llmclient-expected-root-'));
    const validResponse = '<quests><quest><index>3</index></quest></quests>';
    let calls = 0;

    axios.post = async (_endpoint, payload) => {
        calls += 1;
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `mock_response_${calls}`,
                model: payload.model,
                choices: [
                    {
                        message: {
                            content: calls === 1
                                ? '<quests><quest><index>1</index></quest>'
                                : validResponse
                        },
                        finish_reason: 'stop'
                    }
                ],
                usage: { total_tokens: 12 }
            }
        };
    };
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 1,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Return quest status XML.' }],
            metadataLabel: 'quest_check',
            validateXML: true,
            expectedXmlRootTag: 'quests',
            stream: false,
            retryAttempts: 1,
            waitAfterError: 0,
            output: 'silent'
        });

        assert.equal(calls, 2);
        assert.equal(result, validResponse);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
});

test('LLMClient.chatCompletion validates any configured complete XML root inside surrounding text', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;

    axios.post = async () => {
        throw new Error('axios.post should not be called when forceOutput is provided.');
    };
    Globals.config = { strictXMLParsing: false };

    try {
        const response = 'Analysis first.\n<rejected><reason>No action.</reason></rejected>\nTrailing note.';
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Return one player-action result.' }],
            forceOutput: response,
            validateXML: true,
            expectedXmlRootTags: ['turnResult', 'moveTurnResult', 'rejected'],
            output: 'silent',
            retryAttempts: 0
        });

        assert.equal(result, response);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion rejects an incomplete expected XML root even when whole-response XML validation is disabled', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;

    axios.post = async () => {
        throw new Error('axios.post should not be called when forceOutput is provided.');
    };
    Globals.config = null;

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Return housekeeping XML.' }],
            forceOutput: '<housekeeping><updates></updates>',
            validateXML: false,
            expectedXmlRootTag: 'housekeeping',
            output: 'silent',
            retryAttempts: 0
        });

        assert.equal(result, '');
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});
