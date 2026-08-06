const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const axios = require('axios');

const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const {
    LiveDeslopController,
    LiveRepeatedNgramDetector,
    extractLivePlainProse,
    extractLiveProse,
    extractStableLivePlainProse,
    extractStableLiveProse,
    locateDetectedSlop,
    resolveTinyBrainLiveDeslopProseMode
} = require('../LiveDeslop.js');

test('live deslop defaults off and rejects non-boolean AI values', () => {
    const defaultConfig = require('js-yaml').load(
        fs.readFileSync(path.resolve(__dirname, '..', 'config.default.yaml'), 'utf8')
    );
    assert.equal(defaultConfig.ai.live_deslop, false);

    const errors = LLMClient.getConfigurationErrors({
        backend: 'openai_compatible',
        endpoint: 'https://example.invalid/v1/chat/completions',
        apiKey: 'test-key',
        model: 'test-model',
        live_deslop: 'yes'
    });
    assert.match(errors.join('\n'), /live_deslop must be a boolean/i);
});

function makeTokenRecord({ id, token, start, alternatives = [] }) {
    return {
        id,
        token,
        logprob: -0.1,
        top_logprobs: [
            { id, token, logprob: -0.1 },
            ...alternatives
        ],
        start,
        end: start + token.length
    };
}

function streamChunks(chunks) {
    const stream = new Readable({ read() {} });
    process.nextTick(() => {
        for (const chunk of chunks) {
            if (stream.destroyed) {
                break;
            }
            stream.push(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        if (!stream.destroyed) {
            stream.push('data: [DONE]\n\n');
            stream.push(null);
        }
    });
    return stream;
}

function textChunk(token, { id, alternatives = [], finishReason = null } = {}) {
    return {
        choices: [{
            delta: { content: token },
            finish_reason: finishReason,
            logprobs: {
                content: [{
                    id,
                    token,
                    bytes: Array.from(Buffer.from(token)),
                    logprob: -0.1,
                    top_logprobs: [
                        { id, token, logprob: -0.1 },
                        ...alternatives
                    ]
                }]
            }
        }]
    };
}

test('live prose extraction waits for a word boundary and maps all supported prose tags', () => {
    const partial = '<moveTurnResult><originProse>Old road.</originProse><betweenProse>Bright tor';
    const stable = extractStableLiveProse(partial);
    assert.equal(stable.prose, 'Old road.\n\nBright ');

    const complete = extractLiveProse(`${partial}ches</betweenProse></moveTurnResult>`);
    assert.equal(complete.prose, 'Old road.\n\nBright torches');
    assert.equal(
        complete.toRawOffset(complete.prose.indexOf('torches')),
        `${partial}ches</betweenProse></moveTurnResult>`.indexOf('torches')
    );
});

test('live prose extraction excludes XML markup and hidden content while preserving hard ngram boundaries', () => {
    const raw = '<turnResult><prose>Alpha <em reason="delve">Beta</em> gamma '
        + '<hidden>secret delve phrase</hidden> delta.</prose></turnResult>';
    const extraction = extractLiveProse(raw);

    assert.deepEqual(
        extraction.prose.match(/[a-z]+/gi),
        ['Alpha', 'Beta', 'gamma', 'delta']
    );
    assert.deepEqual(
        extraction.ngramSegments.map(segment => segment.text.trim()),
        ['Alpha', 'Beta', 'gamma', 'delta.']
    );
    assert.equal(
        extraction.toRawOffset(extraction.prose.indexOf('Beta')),
        raw.indexOf('Beta')
    );

    const detector = new LiveRepeatedNgramDetector({
        baseSegments: ['Alpha Beta gamma appeared before.']
    });
    assert.deepEqual(
        detector.find(extraction.prose, { segments: extraction.ngramSegments }),
        []
    );
    assert.throws(
        () => locateDetectedSlop({
            prose: extraction.prose,
            slopNgrams: ['alpha beta gamma'],
            ngramSegments: extraction.ngramSegments
        }),
        /could not be located/i
    );
});

test('partial XML tags are excluded from stable live prose', () => {
    const extraction = extractStableLiveProse('<turnResult><prose>Visible words. <hidden');
    assert.equal(extraction.prose, 'Visible words. ');
    assert.deepEqual(
        extraction.ngramSegments.map(segment => segment.text),
        ['Visible words. ']
    );
});

test('plain draft extraction excludes XML and hidden notes while keeping XML as n-gram boundaries', () => {
    const raw = 'Alpha <em>Beta</em> gamma <hidden>secret phrase</hidden> delta';
    const extraction = extractLivePlainProse(raw);

    assert.deepEqual(
        extraction.prose.match(/[a-z]+/gi),
        ['Alpha', 'Beta', 'gamma', 'delta']
    );
    assert.deepEqual(
        extraction.ngramSegments.map(segment => segment.text.trim()),
        ['Alpha', 'Beta', 'gamma', 'delta']
    );
    assert.equal(extraction.toRawOffset(extraction.prose.indexOf('Beta')), raw.indexOf('Beta'));
    assert.equal(extractStableLivePlainProse(raw).prose.trim().endsWith('delta'), false);
});

test('plain draft inspection checks the final word on completion and preserves tools', async () => {
    const responseText = 'A Bad';
    const tokenRecords = [
        makeTokenRecord({ id: 1, token: 'A ', start: 0 }),
        makeTokenRecord({
            id: 2,
            token: 'Bad',
            start: 2,
            alternatives: [{ id: 20, token: 'Calm', logprob: -0.3 }]
        })
    ];
    const controller = new LiveDeslopController({
        detectSlop: async prose => {
            const match = /\bbad\b/i.exec(prose);
            return match
                ? {
                    start: match.index,
                    end: match.index + match[0].length,
                    type: 'word',
                    label: 'bad',
                    slopWords: ['bad'],
                    slopRegexes: [],
                    slopNgrams: []
                }
                : null;
        }
    });

    assert.equal(await controller.inspect({ responseText, tokenRecords, proseMode: 'plain' }), null);
    const decision = await controller.inspect({
        responseText,
        tokenRecords,
        proseMode: 'plain',
        responseComplete: true,
        preserveTools: true
    });

    assert.equal(decision.rewindOffset, 2);
    assert.equal(decision.alternative.token, 'Calm');
    assert.equal(decision.disableTools, false);
});

test('tiny-brain live deslop selects both draft checkpoints and the final structured response', () => {
    const messagesFor = content => [{ role: 'system', content: 'Context.' }, { role: 'user', content }];

    assert.equal(resolveTinyBrainLiveDeslopProseMode({
        messages: messagesFor('Draft Response: Write the first draft.'),
        isFinal: false
    }), 'plain');
    assert.equal(resolveTinyBrainLiveDeslopProseMode({
        messages: messagesFor('Write a second draft that fixes the above issues.'),
        isFinal: false
    }), 'plain');
    assert.equal(resolveTinyBrainLiveDeslopProseMode({
        messages: messagesFor('Analyze the second draft.'),
        isFinal: false
    }), null);
    assert.equal(resolveTinyBrainLiveDeslopProseMode({
        messages: messagesFor('Write the final XML.'),
        isFinal: true
    }), 'structured');
});

test('player-action live stream fallback diagnostics are appended to the active prompt log', () => {
    const apiSource = fs.readFileSync(path.resolve(__dirname, '..', 'api.js'), 'utf8');

    assert.match(
        apiSource,
        /if \(liveDeslopProseMode\) \{\s*stageRequestOptions\.onLiveTokenStreamFallback = async diagnostic/
    );
    assert.doesNotMatch(
        apiSource,
        /if \(shouldUseLiveDeslop\) \{\s*requestOptions\.onLiveTokenStreamFallback/
    );
    assert.match(apiSource, /appendLogSection\(\{\s*title: `\$\{stepLabel\} live token stream fallback`/);
    assert.match(apiSource, /content: formatLiveTokenStreamFallbackLogContent\(diagnostic\)/);
    assert.match(apiSource, /Server response:/);
    assert.match(apiSource, /Backtrace:/);
});

test('slop location maps normalized ngrams back to the beginning of their source phrase', () => {
    const prose = 'A lantern burned in the silent stone corridor.';
    const match = locateDetectedSlop({
        prose,
        slopNgrams: ['lantern burned silent stone']
    });

    assert.equal(match.type, 'ngram');
    assert.equal(prose.slice(match.start, match.end), 'lantern burned in the silent stone');
});

test('live repeated ngram indexing preserves 3-gram and supplemental 6-gram detection', () => {
    const detector = new LiveRepeatedNgramDetector({
        baseSegments: ['The brass lantern burned beside the old gate.'],
        supplementalSegments: ['Snow gathered across six silent weathered ancient marble statues overnight.']
    });

    assert.deepEqual(
        detector.find('A brass lantern burned near the door.'),
        ['brass lantern burned']
    );
    assert.deepEqual(
        detector.find('Six silent weathered ancient marble statues cracked.'),
        ['six silent weathered ancient marble statues']
    );
    assert.deepEqual(detector.find('Nothing overlaps this sentence.'), []);
});

test('live repeated ngram history indexing does not join tokens across XML tags', () => {
    const detector = new LiveRepeatedNgramDetector({
        baseSegments: [
            'Copper <hidden>ignored bronze bridge</hidden> lantern silver doorway',
            'Marble <pause/>statue cracked'
        ]
    });

    assert.deepEqual(detector.find('Copper lantern silver only.'), []);
    assert.deepEqual(detector.find('Marble statue cracked overnight.'), []);
    assert.deepEqual(detector.find('Lantern silver doorway gleamed.'), ['lantern silver doorway']);
});

test('live deslop rewinds one word farther when the slop-start token has no viable alternative', async () => {
    const responseText = '<turnResult><prose>Calm bright delve. </prose></turnResult>';
    const proseStart = responseText.indexOf('Calm');
    const calmStart = proseStart;
    const brightStart = responseText.indexOf(' bright');
    const delveStart = responseText.indexOf(' delve');
    const tokenRecords = [
        makeTokenRecord({ id: 1, token: 'Calm', start: calmStart }),
        makeTokenRecord({
            id: 2,
            token: ' bright',
            start: brightStart,
            alternatives: [{ id: 20, token: ' steady.', logprob: -0.4 }]
        }),
        makeTokenRecord({
            id: 3,
            token: ' delve',
            start: delveStart,
            alternatives: [{ id: 30, token: ' abyss.', logprob: -0.3 }]
        }),
        makeTokenRecord({ id: 4, token: '. ', start: responseText.indexOf('. ') })
    ];
    const detectSlop = async prose => {
        const badMatch = /\b(?:delve|abyss)\b/i.exec(prose);
        return badMatch
            ? {
                start: badMatch.index,
                end: badMatch.index + badMatch[0].length,
                type: 'word',
                label: badMatch[0].toLowerCase(),
                slopWords: [badMatch[0].toLowerCase()],
                slopRegexes: [],
                slopNgrams: []
            }
            : null;
    };
    const controller = new LiveDeslopController({ detectSlop });

    const decision = await controller.inspect({ responseText, tokenRecords });

    assert.equal(decision.rewindOffset, brightStart);
    assert.equal(decision.alternative.token, ' steady.');
    assert.equal(decision.diagnostic.rewoundPastMatch, true);
});

test('live deslop rewind search stops at an XML boundary', async () => {
    const responseText = '<turnResult><prose>Calm <aside/>bright delve. </prose></turnResult>';
    const tokenRecords = [
        makeTokenRecord({
            id: 1,
            token: 'Calm',
            start: responseText.indexOf('Calm'),
            alternatives: [{ id: 10, token: 'Quiet', logprob: -0.2 }]
        }),
        makeTokenRecord({ id: 2, token: '<aside/>', start: responseText.indexOf('<aside/>') }),
        makeTokenRecord({ id: 3, token: 'bright', start: responseText.indexOf('bright') }),
        makeTokenRecord({
            id: 4,
            token: ' delve',
            start: responseText.indexOf(' delve'),
            alternatives: [{ id: 40, token: ' abyss ', logprob: -0.3 }]
        }),
        makeTokenRecord({ id: 5, token: '. ', start: responseText.indexOf('. ') })
    ];
    const detectSlop = async prose => {
        const badMatch = /\b(?:delve|abyss)\b/i.exec(prose);
        return badMatch
            ? {
                start: badMatch.index,
                end: badMatch.index + badMatch[0].length,
                type: 'word',
                label: badMatch[0].toLowerCase(),
                slopWords: [badMatch[0].toLowerCase()],
                slopRegexes: [],
                slopNgrams: []
            }
            : null;
    };
    const controller = new LiveDeslopController({ detectSlop });

    await assert.rejects(
        () => controller.inspect({ responseText, tokenRecords }),
        /preceding XML boundary/i
    );
});

test('LLMClient applies a streamed branch correction as assistant prefill and preserves tools', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tempRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tempRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(tempRoot, 'live-deslop-llm-'));
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: true,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            suppress_seed: true,
            stream_start_timeout: 5,
            stream_continue_timeout: 5
        }
    };

    const prefix = '<turnResult><prose>';
    const payloads = [];
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        const secondRequest = payloads.length === 2;
        return {
            status: 200,
            statusText: 'OK',
            data: secondRequest
                ? streamChunks([
                    textChunk(' story. ', { id: 4 }),
                    textChunk('</prose></turnResult>', { id: 5, finishReason: 'stop' })
                ])
                : streamChunks([
                    textChunk(prefix, { id: 1 }),
                    textChunk('Bad', {
                        id: 2,
                        alternatives: [{ id: 22, token: 'Good', logprob: -0.2 }]
                    }),
                    textChunk(' ', { id: 3 })
                ])
        };
    };

    let corrected = false;
    const completedTokens = [];
    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Continue the story.' }],
            metadataLabel: 'live_deslop_stream_test',
            validateXML: false,
            retryAttempts: 0,
            output: 'silent',
            additionalPayload: {
                logprobs: true,
                top_logprobs: 20,
                tools: [{ type: 'function', function: { name: 'testTool', parameters: { type: 'object' } } }],
                tool_choice: 'auto'
            },
            onStreamToken: async ({ responseText, tokenRecords, token, responseComplete }) => {
                if (responseComplete) {
                    completedTokens.push(token.token);
                }
                if (corrected || responseText !== `${prefix}Bad `) {
                    return null;
                }
                corrected = true;
                const badToken = tokenRecords.find(record => record.token === 'Bad');
                return {
                    rewindOffset: badToken.start,
                    alternative: {
                        id: 22,
                        token: 'Good',
                        logprob: -0.2,
                        top_logprobs: badToken.top_logprobs
                    },
                    disableTools: false
                };
            }
        });

        assert.equal(result, `${prefix}Good story. </prose></turnResult>`);
        assert.equal(payloads.length, 2);
        assert.equal(payloads[0].tools.length, 1);
        assert.equal(payloads[1].tools.length, 1);
        assert.equal(payloads[1].tool_choice, 'auto');
        assert.deepEqual(payloads[1].messages.at(-1), {
            role: 'assistant',
            content: `${prefix}Good`
        });
        assert.deepEqual(completedTokens, ['</prose></turnResult>']);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        LLMClient.resetPromptOutputCharacterStatsForTests();
    }
});

test('LLMClient falls back once from live token streaming and retries after the llama process key changes', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tempRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tempRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(tempRoot, 'live-deslop-stream-fallback-'));
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: true,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            maxTokens: 20,
            suppress_seed: true,
            stream_start_timeout: 5,
            stream_continue_timeout: 5
        }
    };
    LLMClient.resetLiveTokenStreamCapabilitiesForTests();

    const payloads = [];
    const fallbackDiagnostics = [];
    let streamAttempts = 0;
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        if (payload.stream) {
            streamAttempts += 1;
            if (streamAttempts === 1) {
                const error = new Error('Request failed with status code 400');
                error.status = 400;
                error.response = { status: 400, data: { error: 'stream + tools + logprobs unsupported' } };
                throw error;
            }
            return {
                status: 200,
                statusText: 'OK',
                data: streamChunks([
                    textChunk('Streaming works.', { id: 3, finishReason: 'stop' })
                ])
            };
        }
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: 'Fallback works.' },
                    logprobs: {
                        content: [
                            { id: 1, token: 'Fallback', bytes: Array.from(Buffer.from('Fallback')), logprob: -0.1, top_logprobs: [] },
                            { id: 2, token: ' works.', bytes: Array.from(Buffer.from(' works.')), logprob: -0.1, top_logprobs: [] },
                            { id: 248046, token: '', bytes: [], logprob: -0.1, top_logprobs: [] }
                        ]
                    }
                }]
            }
        };
    };

    const makeRequest = capabilityKey => LLMClient.chatCompletion({
        messages: [{ role: 'user', content: 'Continue.' }],
        metadataLabel: 'live_deslop_stream_fallback_test',
        validateXML: false,
        retryAttempts: 0,
        output: 'silent',
        stream: true,
        liveTokenStreamFallbackChunkSize: 500,
        liveTokenStreamCapabilityKey: capabilityKey,
        onLiveTokenStreamFallback: diagnostic => {
            fallbackDiagnostics.push(diagnostic);
        },
        additionalPayload: {
            logprobs: true,
            top_logprobs: 20,
            tools: [{ type: 'function', function: { name: 'testTool', parameters: { type: 'object' } } }],
            tool_choice: 'auto'
        },
        onStreamToken: async () => null
    });

    try {
        assert.equal(await makeRequest('endpoint::managed-pid:10'), 'Fallback works.');
        assert.equal(await makeRequest('endpoint::managed-pid:10'), 'Fallback works.');
        assert.equal(await makeRequest('endpoint::managed-pid:11'), 'Streaming works.');
        assert.deepEqual(payloads.map(payload => payload.stream), [true, false, false, true]);
        assert.equal(payloads.every(payload => payload.tools?.length === 1), true);
        assert.equal(streamAttempts, 2);
        assert.equal(fallbackDiagnostics.length, 1);
        assert.equal(fallbackDiagnostics[0].failureType, 'pre_text_stream_failure');
        assert.equal(fallbackDiagnostics[0].httpStatus, 400);
        assert.equal(fallbackDiagnostics[0].capabilityKey, 'endpoint::managed-pid:10');
        assert.equal(fallbackDiagnostics[0].fallbackChunkSize, 500);
        assert.match(fallbackDiagnostics[0].message, /Request failed with status code 400/);
        assert.match(fallbackDiagnostics[0].responseBody, /stream \+ tools \+ logprobs unsupported/);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        LLMClient.resetLiveTokenStreamCapabilitiesForTests();
        LLMClient.resetPromptOutputCharacterStatsForTests();
    }
});

test('LLMClient accepts streamed tool-call deltas without logprobs', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tempRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tempRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(tempRoot, 'live-deslop-stream-tool-call-'));
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: true,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            maxTokens: 20,
            suppress_seed: true,
            stream_start_timeout: 5,
            stream_continue_timeout: 5
        }
    };

    axios.post = async () => ({
        status: 200,
        statusText: 'OK',
        data: streamChunks([
            {
                choices: [{
                    delta: {
                        tool_calls: [{
                            index: 0,
                            id: 'call_probe',
                            type: 'function',
                            function: { name: 'testTool', arguments: '{}' }
                        }]
                    },
                    finish_reason: null
                }]
            },
            {
                choices: [{ delta: {}, finish_reason: 'tool_calls' }]
            }
        ])
    });

    let normalizedResponse = null;
    let inspectedTextTokens = 0;
    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Use the tool.' }],
            metadataLabel: 'live_deslop_stream_tool_call_test',
            validateXML: false,
            retryAttempts: 0,
            output: 'silent',
            stream: true,
            liveTokenStreamFallbackChunkSize: 500,
            liveTokenStreamCapabilityKey: 'endpoint::managed-pid:20',
            additionalPayload: {
                logprobs: true,
                top_logprobs: 20,
                tools: [{ type: 'function', function: { name: 'testTool', parameters: { type: 'object' } } }],
                tool_choice: 'auto'
            },
            onStreamToken: async () => {
                inspectedTextTokens += 1;
                return null;
            },
            onResponse: response => {
                normalizedResponse = response;
            }
        });

        assert.equal(result, '');
        assert.equal(inspectedTextTokens, 0);
        assert.equal(normalizedResponse.data.choices[0].finish_reason, 'tool_calls');
        assert.equal(normalizedResponse.data.choices[0].message.tool_calls[0].function.name, 'testTool');
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        LLMClient.resetLiveTokenStreamCapabilitiesForTests();
        LLMClient.resetPromptOutputCharacterStatsForTests();
    }
});

test('LLMClient preserves streamed XML content without logprobs but excludes it from live token inspection', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tempRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tempRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(tempRoot, 'live-deslop-stream-opaque-xml-'));
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: true,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            maxTokens: 20,
            suppress_seed: true,
            stream_start_timeout: 5,
            stream_continue_timeout: 5
        }
    };
    LLMClient.resetLiveTokenStreamCapabilitiesForTests();

    const payloads = [];
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        return {
            status: 200,
            statusText: 'OK',
            data: streamChunks([
                {
                    choices: [{ delta: { content: '<move' }, finish_reason: null }]
                },
                textChunk('TurnResult', { id: 1 }),
                {
                    choices: [{ delta: { content: '><destination' }, finish_reason: null }]
                },
                textChunk('Prose>Hello.</destinationProse></moveTurnResult>', {
                    id: 2,
                    finishReason: 'stop'
                })
            ])
        };
    };

    const inspectedTokens = [];
    const fallbackDiagnostics = [];
    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Return XML.' }],
            metadataLabel: 'live_deslop_stream_opaque_xml_test',
            validateXML: false,
            retryAttempts: 0,
            output: 'silent',
            stream: true,
            liveTokenStreamFallbackChunkSize: 500,
            liveTokenStreamCapabilityKey: 'endpoint::managed-pid:opaque-xml',
            onLiveTokenStreamFallback: diagnostic => fallbackDiagnostics.push(diagnostic),
            additionalPayload: {
                logprobs: true,
                top_logprobs: 20,
                tools: [{ type: 'function', function: { name: 'testTool', parameters: { type: 'object' } } }],
                tool_choice: 'auto'
            },
            onStreamToken: async ({ responseText, token, responseComplete }) => {
                inspectedTokens.push({
                    token: token.token,
                    start: token.start,
                    responseText,
                    responseComplete
                });
                return null;
            }
        });

        assert.equal(
            result,
            '<moveTurnResult><destinationProse>Hello.</destinationProse></moveTurnResult>'
        );
        assert.equal(payloads.length, 1);
        assert.equal(fallbackDiagnostics.length, 0);
        assert.deepEqual(inspectedTokens, [
            {
                token: 'TurnResult',
                start: '<move'.length,
                responseText: '<moveTurnResult',
                responseComplete: false
            },
            {
                token: 'Prose>Hello.</destinationProse></moveTurnResult>',
                start: '<moveTurnResult><destination'.length,
                responseText: '<moveTurnResult><destinationProse>Hello.</destinationProse></moveTurnResult>',
                responseComplete: true
            }
        ]);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        LLMClient.resetLiveTokenStreamCapabilitiesForTests();
        LLMClient.resetPromptOutputCharacterStatsForTests();
    }
});

test('LLMClient continues non-stream live token chunks with tools and assistant prefill', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tempRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tempRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(tempRoot, 'live-deslop-chunks-'));
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            maxTokens: 5,
            suppress_seed: true
        }
    };

    const payloads = [];
    const responseData = ({ content, finishReason, tokens }) => ({
        id: 'chunk-test',
        object: 'chat.completion',
        model: 'test-model',
        choices: [{
            index: 0,
            finish_reason: finishReason,
            message: { role: 'assistant', content },
            logprobs: {
                content: tokens.map(({ id, token, bytes }) => ({
                    id,
                    token,
                    ...(bytes === undefined ? {} : { bytes }),
                    logprob: -0.1,
                    top_logprobs: [{ id, token, logprob: -0.1 }]
                }))
            }
        }]
    });
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: payloads.length === 1
                ? responseData({
                    content: 'One two',
                    finishReason: 'length',
                    tokens: [{ id: 1, token: 'One' }, { id: 2, token: ' two' }]
                })
                : responseData({
                    content: 'One two three',
                    finishReason: 'stop',
                    tokens: [
                        { id: 3, token: ' three' },
                        { id: 248046, token: '', bytes: [] }
                    ]
                })
        };
    };

    const seenTokens = [];
    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Continue.' }],
            metadataLabel: 'live_deslop_chunk_test',
            validateXML: false,
            retryAttempts: 0,
            output: 'silent',
            stream: false,
            nonStreamTokenChunkSize: 2,
            additionalPayload: {
                logprobs: true,
                top_logprobs: 20,
                tools: [{ type: 'function', function: { name: 'testTool', parameters: { type: 'object' } } }],
                tool_choice: 'auto'
            },
            onStreamToken: async state => {
                seenTokens.push({ token: state.token.token, responseComplete: state.responseComplete });
                return null;
            }
        });

        assert.equal(result, 'One two three');
        assert.equal(payloads.length, 2);
        assert.equal(payloads[0].stream, false);
        assert.equal(payloads[0].max_tokens, 2);
        assert.equal(payloads[1].max_tokens, 2);
        assert.equal(payloads[0].tools.length, 1);
        assert.equal(payloads[1].tools.length, 1);
        assert.equal(payloads[1].tool_choice, 'auto');
        assert.deepEqual(payloads[1].messages.at(-1), { role: 'assistant', content: 'One two' });
        assert.deepEqual(seenTokens, [
            { token: 'One', responseComplete: false },
            { token: ' two', responseComplete: false },
            { token: ' three', responseComplete: true }
        ]);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        LLMClient.resetPromptOutputCharacterStatsForTests();
    }
});

test('LLMClient rejects an empty non-terminal token in non-stream live metadata', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tempRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tempRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(tempRoot, 'live-deslop-invalid-empty-token-'));
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            maxTokens: 5,
            suppress_seed: true
        }
    };

    axios.post = async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: {
            choices: [{
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: 'Visible' },
                logprobs: {
                    content: [
                        { id: 248046, token: '', bytes: [], logprob: -0.1, top_logprobs: [] },
                        { id: 1, token: 'Visible', bytes: Array.from(Buffer.from('Visible')), logprob: -0.1, top_logprobs: [] }
                    ]
                }
            }]
        }
    });

    try {
        await assert.rejects(
            LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Continue.' }],
                metadataLabel: 'live_deslop_invalid_empty_token_test',
                validateXML: false,
                retryAttempts: 0,
                output: 'silent',
                stream: false,
                nonStreamTokenChunkSize: 5,
                additionalPayload: { logprobs: true, top_logprobs: 20 },
                onStreamToken: async () => null
            }),
            /included an invalid token/
        );
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        LLMClient.resetPromptOutputCharacterStatsForTests();
    }
});

test('LLMClient keeps tools on a non-stream live branch correction', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tempRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tempRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(tempRoot, 'live-deslop-chunk-branch-'));
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            maxTokens: 10,
            suppress_seed: true
        }
    };

    const payloads = [];
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        const secondRequest = payloads.length === 2;
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: {
                        role: 'assistant',
                        content: secondRequest ? 'Good story.' : 'Bad '
                    },
                    logprobs: {
                        content: secondRequest
                            ? [{
                                id: 3,
                                token: ' story.',
                                logprob: -0.1,
                                top_logprobs: [{ id: 3, token: ' story.', logprob: -0.1 }]
                            }]
                            : [
                                {
                                    id: 1,
                                    token: 'Bad',
                                    logprob: -0.1,
                                    top_logprobs: [
                                        { id: 1, token: 'Bad', logprob: -0.1 },
                                        { id: 10, token: 'Good', logprob: -0.2 }
                                    ]
                                },
                                {
                                    id: 2,
                                    token: ' ',
                                    logprob: -0.1,
                                    top_logprobs: [{ id: 2, token: ' ', logprob: -0.1 }]
                                }
                            ]
                    }
                }]
            }
        };
    };

    let corrected = false;
    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Continue.' }],
            metadataLabel: 'live_deslop_chunk_branch_test',
            validateXML: false,
            retryAttempts: 0,
            output: 'silent',
            stream: false,
            nonStreamTokenChunkSize: 5,
            additionalPayload: {
                logprobs: true,
                top_logprobs: 20,
                tools: [{ type: 'function', function: { name: 'testTool', parameters: { type: 'object' } } }],
                tool_choice: 'auto'
            },
            onStreamToken: async ({ responseText, tokenRecords }) => {
                if (corrected || responseText !== 'Bad ') {
                    return null;
                }
                corrected = true;
                const badToken = tokenRecords.find(record => record.token === 'Bad');
                return {
                    rewindOffset: badToken.start,
                    alternative: {
                        id: 10,
                        token: 'Good',
                        logprob: -0.2,
                        top_logprobs: badToken.top_logprobs
                    },
                    disableTools: false
                };
            }
        });

        assert.equal(result, 'Good story.');
        assert.equal(payloads.length, 2);
        assert.equal(payloads[1].tools.length, 1);
        assert.equal(payloads[1].tool_choice, 'auto');
        assert.deepEqual(payloads[1].messages.at(-1), { role: 'assistant', content: 'Good' });
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        LLMClient.resetPromptOutputCharacterStatsForTests();
    }
});
