#!/usr/bin/env node

const fs = require('fs');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function writeStdoutLine(payload) {
    return new Promise((resolve, reject) => {
        process.stdout.write(`${JSON.stringify(payload)}\n`, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function writeLog() {
    const logPath = process.env.FAKE_CLINE_LOG_PATH || '';
    if (!logPath) {
        return;
    }
    fs.writeFileSync(logPath, JSON.stringify({
        args: process.argv.slice(2),
        cwd: process.cwd(),
        stdin: globalThis.fakeClineStdin || '',
        env: {
            CLINE_WRAPPER_PATH: process.env.CLINE_WRAPPER_PATH || '',
            CLINE_BIN_PATH: process.env.CLINE_BIN_PATH || ''
        }
    }, null, 2));
}

function readStdin() {
    return new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
            data += chunk;
        });
        process.stdin.on('error', reject);
        process.stdin.on('end', () => resolve(data));
    });
}

async function main() {
    process.on('SIGTERM', () => {
        writeLog();
        process.exit(0);
    });

    globalThis.fakeClineStdin = await readStdin();

    const delayMs = Number(process.env.FAKE_CLINE_DELAY_MS || 0);
    if (Number.isFinite(delayMs) && delayMs > 0) {
        await sleep(delayMs);
    }

    const configuredEvents = process.env.FAKE_CLINE_STDOUT_EVENTS
        ? JSON.parse(process.env.FAKE_CLINE_STDOUT_EVENTS)
        : null;
    if (Array.isArray(configuredEvents)) {
        for (const event of configuredEvents) {
            await writeStdoutLine(event);
        }
    } else {
        const finalText = process.env.FAKE_CLINE_RESPONSE || '{"content":"fake cline response"}';
        const splitIndex = Math.max(1, Math.floor(finalText.length / 2));
        await writeStdoutLine({
            type: 'agent_event',
            event: {
                text: finalText.slice(0, splitIndex)
            }
        });
        await writeStdoutLine({
            type: 'agent_event',
            event: {
                text: finalText
            }
        });
    }

    writeLog();
    const exitCode = Number(process.env.FAKE_CLINE_EXIT_CODE || 0);
    process.exit(Number.isInteger(exitCode) ? exitCode : 0);
}

main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    writeLog();
    process.exit(1);
});
