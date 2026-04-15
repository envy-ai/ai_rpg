#!/usr/bin/env node

const fs = require('fs');
const readline = require('readline');

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

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function writeStdoutLine(payload) {
    return writeStdout(`${JSON.stringify(payload)}\n`);
}

async function runFakeAppServer() {
    const rateLimits = process.env.FAKE_CODEX_RATE_LIMITS
        ? JSON.parse(process.env.FAKE_CODEX_RATE_LIMITS)
        : {
            rateLimits: {
                limitId: 'codex',
                limitName: 'Codex',
                planType: 'pro',
                primary: {
                    usedPercent: 23,
                    resetsAt: 1777000000000,
                    windowDurationMins: 300
                },
                secondary: null,
                credits: {
                    hasCredits: true,
                    unlimited: false,
                    balance: '12.34'
                }
            }
        };

    const rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity
    });

    for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
            await writeStdoutLine({
                id: message.id,
                result: {
                    userAgent: 'fake-codex-app-server',
                    codexHome: process.env.CODEX_HOME || '/tmp/fake-codex-home',
                    platformFamily: 'unix',
                    platformOs: 'linux'
                }
            });
            continue;
        }
        if (message.method === 'account/rateLimits/read') {
            await writeStdoutLine({
                id: message.id,
                result: rateLimits
            });
            continue;
        }
        await writeStdoutLine({
            id: message.id,
            error: {
                code: -32601,
                message: `Unsupported fake app-server method: ${message.method}`
            }
        });
    }
}

(async () => {
    const args = process.argv.slice(2);
    if (args[0] === 'app-server') {
        await runFakeAppServer();
        return;
    }
    const stdinText = readStdin();
    const outputPath = getArgValue(args, '-o');
    const argLogPath = process.env.FAKE_CODEX_ARG_LOG || '';
    const responseText = process.env.FAKE_CODEX_RESPONSE || '{"content":"fake codex response"}';
    const threadId = process.env.FAKE_CODEX_THREAD_ID || 'fake-thread-id';
    const exitCode = Number.parseInt(process.env.FAKE_CODEX_EXIT_CODE || '0', 10);
    const delayMs = Number.parseInt(process.env.FAKE_CODEX_DELAY_MS || '0', 10);
    const stdoutEvents = (() => {
        const raw = process.env.FAKE_CODEX_STDOUT_EVENTS;
        if (!raw) {
            return [
                { type: 'thread.started', thread_id: threadId }
            ];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            throw new Error('FAKE_CODEX_STDOUT_EVENTS must decode to an array.');
        }
        return parsed;
    })();

    if (argLogPath) {
        fs.writeFileSync(argLogPath, JSON.stringify({
            args,
            stdinText,
            cwd: process.cwd(),
            codexHome: process.env.CODEX_HOME || ''
        }, null, 2));
    }

    for (let index = 0; index < stdoutEvents.length; index += 1) {
        const event = stdoutEvents[index];
        await writeStdoutLine(event);
        if (delayMs > 0 && index < stdoutEvents.length - 1) {
            await sleep(delayMs);
        }
    }

    if (outputPath) {
        fs.writeFileSync(outputPath, responseText, 'utf8');
    }

    process.exitCode = Number.isInteger(exitCode) ? exitCode : 0;
})().catch((error) => {
    const message = error?.stack || error?.message || String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
