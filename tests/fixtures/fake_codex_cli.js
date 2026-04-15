#!/usr/bin/env node

const fs = require('fs');

function readStdin() {
    try {
        return fs.readFileSync(0, 'utf8');
    } catch (error) {
        if (error && typeof error === 'object' && error.code === 'EOF') {
            return '';
        }
        throw error;
    }
}

function getArgValue(args, flag) {
    const index = args.indexOf(flag);
    if (index < 0 || index + 1 >= args.length) {
        return '';
    }
    return args[index + 1];
}

function writeStdout(text) {
    return new Promise((resolve, reject) => {
        process.stdout.write(text, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

(async () => {
    const args = process.argv.slice(2);
    const stdinText = readStdin();
    const outputPath = getArgValue(args, '-o');
    const argLogPath = process.env.FAKE_CODEX_ARG_LOG || '';
    const responseText = process.env.FAKE_CODEX_RESPONSE || '{"content":"fake codex response"}';
    const threadId = process.env.FAKE_CODEX_THREAD_ID || 'fake-thread-id';
    const exitCode = Number.parseInt(process.env.FAKE_CODEX_EXIT_CODE || '0', 10);

    if (argLogPath) {
        fs.writeFileSync(argLogPath, JSON.stringify({
            args,
            stdinText,
            cwd: process.cwd(),
            codexHome: process.env.CODEX_HOME || ''
        }, null, 2));
    }

    await writeStdout(`${JSON.stringify({ type: 'thread.started', thread_id: threadId })}\n`);

    if (outputPath) {
        fs.writeFileSync(outputPath, responseText, 'utf8');
    }

    process.exitCode = Number.isInteger(exitCode) ? exitCode : 0;
})().catch((error) => {
    const message = error?.stack || error?.message || String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
