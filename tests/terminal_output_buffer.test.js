const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const {
    TerminalOutputBuffer,
    installProcessOutputCapture
} = require('../TerminalOutputBuffer.js');

test('terminal output buffer strips ANSI codes and provides cursor deltas', () => {
    const output = new TerminalOutputBuffer({ maxCharacters: 20 });
    output.append('\u001b[31mred\u001b[0m\n');
    const first = output.read();
    output.append('next\n');

    assert.deepEqual(first, {
        output: 'red\n',
        cursor: 4,
        startCursor: 0,
        reset: true,
        truncated: false
    });
    assert.deepEqual(output.read(first.cursor), {
        output: 'next\n',
        cursor: 9,
        startCursor: 0,
        reset: false,
        truncated: false
    });
});

test('terminal output buffer resets stale cursors after truncation', () => {
    const output = new TerminalOutputBuffer({ maxCharacters: 5 });
    output.append('12345678');

    assert.deepEqual(output.read(2), {
        output: '45678',
        cursor: 8,
        startCursor: 3,
        reset: true,
        truncated: true
    });
});

test('clearing a terminal buffer preserves monotonic cursors across process runs', () => {
    const output = new TerminalOutputBuffer({ maxCharacters: 20 });
    output.append('old output');
    const oldCursor = output.read().cursor;
    output.clear();
    output.append('new output');

    assert.deepEqual(output.read(oldCursor), {
        output: 'new output',
        cursor: 20,
        startCursor: 10,
        reset: false,
        truncated: false
    });
    assert.equal(output.read(3).reset, true);
});

test('process output capture tees stdout and stderr without mixing passthrough writes into capture', () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let stdoutText = '';
    let stderrText = '';
    stdout.on('data', chunk => { stdoutText += chunk.toString(); });
    stderr.on('data', chunk => { stderrText += chunk.toString(); });
    const capture = installProcessOutputCapture({ stdout, stderr, maxCharacters: 100 });

    stdout.write('app out\n');
    stderr.write('app error\n');
    capture.writeStdoutPassthrough('llama out\n');

    assert.equal(stdoutText, 'app out\nllama out\n');
    assert.equal(stderrText, 'app error\n');
    assert.equal(capture.outputBuffer.read().output, 'app out\napp error\n');
    capture.restore();
});
