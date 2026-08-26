const { StringDecoder } = require('string_decoder');

const DEFAULT_MAX_CHARACTERS = 1000000;
const ANSI_ESCAPE_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function normalizeTerminalOutput(value) {
    if (typeof value !== 'string') {
        throw new TypeError('Terminal output must be a string.');
    }
    return value.replace(ANSI_ESCAPE_PATTERN, '');
}

class TerminalOutputBuffer {
    constructor({ maxCharacters = DEFAULT_MAX_CHARACTERS } = {}) {
        if (!Number.isInteger(maxCharacters) || maxCharacters <= 0) {
            throw new Error('TerminalOutputBuffer maxCharacters must be a positive integer.');
        }
        this.maxCharacters = maxCharacters;
        this.text = '';
        this.startCursor = 0;
        this.endCursor = 0;
        this.truncated = false;
    }

    append(value) {
        const text = normalizeTerminalOutput(value);
        if (!text) {
            return this.endCursor;
        }

        this.text += text;
        this.endCursor += text.length;
        if (this.text.length > this.maxCharacters) {
            const discardedCharacters = this.text.length - this.maxCharacters;
            this.text = this.text.slice(discardedCharacters);
            this.startCursor += discardedCharacters;
            this.truncated = true;
        }
        return this.endCursor;
    }

    clear() {
        this.text = '';
        this.startCursor = this.endCursor;
        this.truncated = false;
    }

    read(cursor = null) {
        if (cursor !== null && (!Number.isInteger(cursor) || cursor < 0)) {
            throw new Error('Terminal output cursor must be a non-negative integer or null.');
        }

        const reset = cursor === null || cursor < this.startCursor || cursor > this.endCursor;
        const output = reset
            ? this.text
            : this.text.slice(cursor - this.startCursor);
        return {
            output,
            cursor: this.endCursor,
            startCursor: this.startCursor,
            reset,
            truncated: this.truncated
        };
    }
}

function createStreamCapture(stream, outputBuffer) {
    if (!stream || typeof stream.write !== 'function') {
        throw new Error('Terminal stream capture requires a writable stream.');
    }
    if (!(outputBuffer instanceof TerminalOutputBuffer)) {
        throw new Error('Terminal stream capture requires a TerminalOutputBuffer.');
    }

    const originalWrite = stream.write.bind(stream);
    const decoder = new StringDecoder('utf8');
    const capturedWrite = function capturedTerminalWrite(chunk, encoding, callback) {
        if (typeof chunk === 'string') {
            outputBuffer.append(chunk);
        } else if (Buffer.isBuffer(chunk) || ArrayBuffer.isView(chunk)) {
            outputBuffer.append(decoder.write(Buffer.from(chunk)));
        } else {
            throw new TypeError('Terminal stream writes must contain a string, Buffer, or typed array.');
        }
        return originalWrite(chunk, encoding, callback);
    };
    stream.write = capturedWrite;

    return {
        passthroughWrite: originalWrite,
        restore() {
            if (stream.write === capturedWrite) {
                stream.write = originalWrite;
            }
        }
    };
}

function installProcessOutputCapture({
    stdout = process.stdout,
    stderr = process.stderr,
    maxCharacters = DEFAULT_MAX_CHARACTERS
} = {}) {
    const outputBuffer = new TerminalOutputBuffer({ maxCharacters });
    const stdoutCapture = createStreamCapture(stdout, outputBuffer);
    const stderrCapture = createStreamCapture(stderr, outputBuffer);
    let restored = false;

    return {
        outputBuffer,
        writeStdoutPassthrough: stdoutCapture.passthroughWrite,
        writeStderrPassthrough: stderrCapture.passthroughWrite,
        restore() {
            if (restored) {
                return;
            }
            restored = true;
            stdoutCapture.restore();
            stderrCapture.restore();
        }
    };
}

module.exports = {
    DEFAULT_MAX_CHARACTERS,
    TerminalOutputBuffer,
    installProcessOutputCapture,
    normalizeTerminalOutput
};
