const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const axios = require('axios');

const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const {
    TinyBrainXmlRepetitionDetector,
    findTinyBrainXmlRepetition
} = require('../TinyBrainXmlRepetition.js');

function longBlock(name, marker) {
    return `<${name}><nested kind=">">${marker.repeat(60)}</nested></${name}>`;
}

function streamChunks(chunks) {
    const stream = new Readable({ read() {} });
    process.nextTick(() => {
        for (const chunk of chunks) {
            if (stream.destroyed) {
                break;
            }
            const delta = {};
            if (chunk.content !== undefined) {
                delta.content = chunk.content;
            }
            if (Array.isArray(chunk.toolCalls)) {
                delta.tool_calls = chunk.toolCalls;
            }
            stream.push(`data: ${JSON.stringify({
                choices: [{
                    delta,
                    finish_reason: chunk.finishReason || null
                }]
            })}\n\n`);
        }
        if (!stream.destroyed) {
            stream.push('data: [DONE]\n\n');
            stream.push(null);
        }
    });
    return stream;
}

function installLlmTestConfiguration(tempPrefix, { enabled = true } = {}) {
    const tempRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tempRoot, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(tempRoot, tempPrefix));
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            suppress_seed: true,
            stream_start_timeout: 5,
            stream_continue_timeout: 5,
            xml_repetition_fix: enabled
        }
    };
}

async function runXmlProtectedCompletion(maxContinuations, onCorrection = null) {
    const complete = () => LLMClient.chatCompletion({
        messages: [{ role: 'user', content: 'Generate the XML.' }],
        metadataLabel: 'xml_repetition_stream_test',
        validateXML: false,
        retryAttempts: 0,
        output: 'silent',
        additionalPayload: {
            tools: [{
                type: 'function',
                function: {
                    name: 'testTool',
                    parameters: { type: 'object' }
                }
            }],
            tool_choice: 'auto'
        }
    });
    if (!LLMClient.isTinyBrainXmlRepetitionFixEnabled()) {
        return complete();
    }
    return LLMClient.withTinyBrainXmlRepetitionFix({
        metadataLabel: 'xml_repetition_stream_test',
        maxContinuations
    }, () => (
        typeof onCorrection === 'function'
            ? LLMClient.withTinyBrainXmlRepetitionLogger(onCorrection, complete)
            : complete()
    ));
}

test('XML repetition recovery defaults off and rejects non-boolean AI values', () => {
    const defaultConfig = require('js-yaml').load(
        fs.readFileSync(path.resolve(__dirname, '..', 'config.default.yaml'), 'utf8')
    );
    assert.equal(defaultConfig.ai.xml_repetition_fix, false);

    const errors = LLMClient.getConfigurationErrors({
        backend: 'openai_compatible',
        endpoint: 'https://example.invalid/v1/chat/completions',
        apiKey: 'test-key',
        model: 'test-model',
        xml_repetition_fix: 'yes'
    });
    assert.match(errors.join('\n'), /xml_repetition_fix must be a boolean/i);
});

test('detects and truncates an immediately repeated balanced XML block', () => {
    const block = longBlock('entry', 'a');
    const prefix = 'Planning text\n';
    const response = `${prefix}${block}\n   ${block}`;
    const detection = findTinyBrainXmlRepetition(response);

    assert.equal(detection.pattern, 'AA');
    assert.equal(detection.truncateOffset, response.lastIndexOf(block));
    assert.equal(response.slice(0, detection.truncateOffset).trimEnd(), `${prefix}${block}`.trimEnd());
    assert.equal(detection.blocks[1].raw, block);
});

test('detects sibling ABAB repetition without confusing nested elements for siblings', () => {
    const blockA = longBlock('alpha', 'a');
    const blockB = longBlock('beta', 'b');
    const response = `<root>${blockA}\n${blockB}\n${blockA}\n${blockB}</root>`;
    const detection = findTinyBrainXmlRepetition(response);

    assert.equal(detection.pattern, 'ABAB');
    assert.equal(detection.truncateOffset, response.indexOf(blockA, response.indexOf(blockB) + blockB.length));
    assert.deepEqual(detection.blocks.map(block => block.name), ['alpha', 'beta', 'alpha', 'beta']);
});

test('requires more than 50 exact raw characters and preserves internal whitespace significance', () => {
    const exactlyFifty = `<x>${'a'.repeat(43)}</x>`;
    assert.equal(exactlyFifty.length, 50);
    assert.equal(findTinyBrainXmlRepetition(`${exactlyFifty}${exactlyFifty}`), null);

    const first = longBlock('entry', 'a');
    const changed = first.replace('a'.repeat(10), `a${' '.repeat(1)}${'a'.repeat(8)}`);
    assert.equal(findTinyBrainXmlRepetition(`${first}\n${changed}`), null);
});

test('handles comments, CDATA, quoted greater-than signs, and incomplete incremental XML', () => {
    const block = '<entry flag=">"><!-- ignored <fake></fake> --><data><![CDATA[<raw></raw>]]></data>'
        + `${'z'.repeat(60)}</entry>`;
    const detector = new TinyBrainXmlRepetitionDetector();

    assert.equal(detector.inspect(`${block}\n<entry flag=">">`), null);
    assert.equal(detector.inspect(`${block}\n${block.slice(0, -1)}`), null);
    const detection = detector.inspect(`${block}\n${block}`);
    assert.equal(detection.pattern, 'AA');
});

test('does not treat self-closing tags as completed content blocks', () => {
    const selfClosing = `<entry value="${'x'.repeat(80)}"/>`;
    assert.equal(findTinyBrainXmlRepetition(`${selfClosing}${selfClosing}`), null);
});

test('LLMClient aborts a duplicate XML stream, removes the copy, and requests continue', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    installLlmTestConfiguration('tinybrain-xml-repetition-');

    const block = longBlock('entry', 'a');
    const tail = longBlock('tail', 'b');
    const payloads = [];
    const corrections = [];
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        return {
            status: 200,
            statusText: 'OK',
            data: payloads.length === 1
                ? streamChunks([
                    { content: block },
                    {
                        content: `\n  ${block}`,
                        toolCalls: [{
                            index: 0,
                            id: 'partial-call',
                            type: 'function',
                            function: {
                                name: 'testTool',
                                arguments: '{"unfinished":'
                            }
                        }]
                    }
                ])
                : streamChunks([
                    { content: tail },
                    { finishReason: 'stop' }
                ])
        };
    };

    try {
        const result = await runXmlProtectedCompletion(1, correction => {
            corrections.push(correction);
        });

        assert.equal(result, `${block}${tail}`);
        assert.equal(payloads.length, 2);
        assert.equal(payloads[0].stream, true);
        assert.equal(payloads[1].tools.length, 1);
        assert.deepEqual(payloads[1].messages.slice(-2), [
            { role: 'assistant', content: block },
            { role: 'user', content: 'continue' }
        ]);
        assert.equal(corrections.length, 1);
        assert.equal(corrections[0].acceptedPrefix, block);
        assert.equal(corrections[0].continuationPrompt, 'continue');
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        LLMClient.resetPromptOutputCharacterStatsForTests();
    }
});

test('LLMClient leaves duplicate XML untouched when the setting is disabled', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    installLlmTestConfiguration('tinybrain-xml-repetition-disabled-', { enabled: false });

    const block = longBlock('entry', 'd');
    const payloads = [];
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        return {
            status: 200,
            statusText: 'OK',
            data: {
                choices: [{
                    message: { content: `${block}${block}` },
                    finish_reason: 'stop'
                }]
            }
        };
    };

    try {
        const result = await runXmlProtectedCompletion(1);
        assert.equal(result, `${block}${block}`);
        assert.equal(payloads.length, 1);
        assert.equal(payloads[0].stream, false);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        LLMClient.resetPromptOutputCharacterStatsForTests();
    }
});

test('LLMClient fails loudly when XML continuation recovery is exhausted', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    installLlmTestConfiguration('tinybrain-xml-repetition-exhausted-');

    const block = longBlock('entry', 'e');
    let requestCount = 0;
    axios.post = async () => {
        requestCount += 1;
        return {
            status: 200,
            statusText: 'OK',
            data: requestCount === 1
                ? streamChunks([{ content: `${block}${block}` }])
                : streamChunks([{ content: block }])
        };
    };

    try {
        await assert.rejects(
            () => runXmlProtectedCompletion(1),
            /XML repetition recovery exhausted its 1 continuation attempt/i
        );
        assert.equal(requestCount, 2);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        LLMClient.resetPromptOutputCharacterStatsForTests();
    }
});
