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

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function writeStdoutLine(payload) {
    return writeStdout(`${JSON.stringify(payload)}\n`);
}

async function runFakeAppServer(args = []) {
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
    const appServerLogPath = process.env.FAKE_CODEX_APP_SERVER_LOG || '';
    const requests = [];
    const defaultThreadId = process.env.FAKE_CODEX_APP_SERVER_THREAD_ID || process.env.FAKE_CODEX_THREAD_ID || 'fake-app-thread-id';
    const defaultResponseText = process.env.FAKE_CODEX_APP_SERVER_FINAL_TEXT || process.env.FAKE_CODEX_RESPONSE || '{"content":"fake codex response"}';
    const defaultThreadList = process.env.FAKE_CODEX_APP_SERVER_THREADS
        ? JSON.parse(process.env.FAKE_CODEX_APP_SERVER_THREADS)
        : [
            {
                id: defaultThreadId,
                forkedFromId: null,
                preview: '',
                ephemeral: false,
                modelProvider: 'openai',
                createdAt: 1,
                updatedAt: 2,
                status: { type: 'idle' },
                path: null,
                cwd: process.cwd(),
                cliVersion: 'fake',
                source: 'appServer',
                agentNickname: null,
                agentRole: null,
                gitInfo: null,
                name: null,
                turns: []
            }
        ];
    const defaultUsage = process.env.FAKE_CODEX_APP_SERVER_USAGE
        ? JSON.parse(process.env.FAKE_CODEX_APP_SERVER_USAGE)
        : {
            totalTokens: 99,
            inputTokens: 88,
            cachedInputTokens: 11,
            outputTokens: 11,
            reasoningOutputTokens: 0
        };

    process.stdin.resume();

    const maybeWriteLog = () => {
        if (!appServerLogPath) {
            return;
        }
        fs.writeFileSync(appServerLogPath, JSON.stringify({
            args,
            requests,
            cwd: process.cwd(),
            codexHome: process.env.CODEX_HOME || ''
        }, null, 2));
    };
    process.on('exit', maybeWriteLog);
    process.on('SIGTERM', () => {
        maybeWriteLog();
        process.exit(0);
    });

    const buildThread = (threadId, { ephemeral = false } = {}) => ({
        id: threadId,
        forkedFromId: null,
        preview: '',
        ephemeral,
        modelProvider: 'openai',
        createdAt: 1,
        updatedAt: 2,
        status: { type: 'idle' },
        path: null,
        cwd: process.cwd(),
        cliVersion: 'fake',
        source: 'appServer',
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: null,
        turns: []
    });

    const emitTurnNotifications = async ({ threadId, turnId, finalText }) => {
        const userText = (() => {
            const turnStartRequest = requests.find(entry => entry.method === 'turn/start');
            const firstInput = Array.isArray(turnStartRequest?.params?.input) ? turnStartRequest.params.input[0] : null;
            return typeof firstInput?.text === 'string' ? firstInput.text : 'fake prompt';
        })();
        const configuredNotifications = process.env.FAKE_CODEX_APP_SERVER_NOTIFICATIONS
            ? JSON.parse(process.env.FAKE_CODEX_APP_SERVER_NOTIFICATIONS)
            : null;
        if (Array.isArray(configuredNotifications)) {
            for (const payload of configuredNotifications) {
                await writeStdoutLine(payload);
            }
            return;
        }
        const deltaChunks = process.env.FAKE_CODEX_APP_SERVER_DELTAS
            ? JSON.parse(process.env.FAKE_CODEX_APP_SERVER_DELTAS)
            : finalText.match(/.{1,8}/g) || [finalText];

        await writeStdoutLine({
            method: 'turn/started',
            params: {
                threadId,
                turn: {
                    id: turnId,
                    items: [],
                    status: 'inProgress',
                    error: null,
                    startedAt: 1,
                    completedAt: null,
                    durationMs: null
                }
            }
        });
        await writeStdoutLine({
            method: 'item/started',
            params: {
                item: {
                    type: 'userMessage',
                    id: 'fake-user-item',
                    content: [{ type: 'text', text: userText }]
                },
                threadId,
                turnId
            }
        });
        await writeStdoutLine({
            method: 'item/completed',
            params: {
                item: {
                    type: 'userMessage',
                    id: 'fake-user-item',
                    content: [{ type: 'text', text: userText }]
                },
                threadId,
                turnId
            }
        });
        await writeStdoutLine({
            method: 'item/started',
            params: {
                item: {
                    type: 'agentMessage',
                    id: 'fake-agent-item',
                    text: '',
                    phase: 'final_answer',
                    memoryCitation: null
                },
                threadId,
                turnId
            }
        });
        for (const delta of deltaChunks) {
            await writeStdoutLine({
                method: 'item/agentMessage/delta',
                params: {
                    threadId,
                    turnId,
                    itemId: 'fake-agent-item',
                    delta
                }
            });
        }
        await writeStdoutLine({
            method: 'item/completed',
            params: {
                item: {
                    type: 'agentMessage',
                    id: 'fake-agent-item',
                    text: finalText,
                    phase: 'final_answer',
                    memoryCitation: null
                },
                threadId,
                turnId
            }
        });
        await writeStdoutLine({
            method: 'thread/tokenUsage/updated',
            params: {
                threadId,
                turnId,
                tokenUsage: {
                    total: defaultUsage,
                    last: defaultUsage,
                    modelContextWindow: 9999
                }
            }
        });
        await writeStdoutLine({
            method: 'turn/completed',
            params: {
                threadId,
                turn: {
                    id: turnId,
                    items: [],
                    status: 'completed',
                    error: null,
                    startedAt: 1,
                    completedAt: 2,
                    durationMs: 1000
                }
            }
        });
    };

    const handleMessage = async (message) => {
        requests.push(message);
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
            return;
        }
        if (message.method === 'account/rateLimits/read') {
            await writeStdoutLine({
                id: message.id,
                result: rateLimits
            });
            return;
        }
        if (message.method === 'thread/list') {
            await writeStdoutLine({
                id: message.id,
                result: {
                    data: defaultThreadList,
                    nextCursor: null
                }
            });
            return;
        }
        if (message.method === 'thread/start') {
            const threadId = process.env.FAKE_CODEX_APP_SERVER_THREAD_ID || 'fake-app-thread-id';
            await writeStdoutLine({
                method: 'thread/started',
                params: {
                    thread: buildThread(threadId, { ephemeral: true })
                }
            });
            await writeStdoutLine({
                id: message.id,
                result: {
                    approvalPolicy: message.params?.approvalPolicy || 'never',
                    approvalsReviewer: 'user',
                    cwd: message.params?.cwd || process.cwd(),
                    model: message.params?.model || 'gpt-5.4-mini',
                    modelProvider: 'openai',
                    reasoningEffort: message.params?.effort || message.params?.reasoningEffort || null,
                    sandbox: {
                        type: 'readOnly',
                        access: { type: 'fullAccess' },
                        networkAccess: false
                    },
                    serviceTier: null,
                    thread: buildThread(threadId, { ephemeral: Boolean(message.params?.ephemeral) })
                }
            });
            return;
        }
        if (message.method === 'thread/resume') {
            const threadId = message.params?.threadId || defaultThreadId;
            await writeStdoutLine({
                id: message.id,
                result: {
                    approvalPolicy: message.params?.approvalPolicy || 'never',
                    approvalsReviewer: 'user',
                    cwd: message.params?.cwd || process.cwd(),
                    model: message.params?.model || 'gpt-5.4-mini',
                    modelProvider: 'openai',
                    reasoningEffort: message.params?.effort || message.params?.reasoningEffort || null,
                    sandbox: {
                        type: 'readOnly',
                        access: { type: 'fullAccess' },
                        networkAccess: false
                    },
                    serviceTier: null,
                    thread: buildThread(threadId, { ephemeral: false })
                }
            });
            return;
        }
        if (message.method === 'turn/start') {
            const threadId = message.params?.threadId || defaultThreadId;
            const turnId = process.env.FAKE_CODEX_APP_SERVER_TURN_ID || 'fake-turn-id';
            await writeStdoutLine({
                id: message.id,
                result: {
                    turn: {
                        id: turnId,
                        items: [],
                        status: 'inProgress',
                        error: null,
                        startedAt: null,
                        completedAt: null,
                        durationMs: null
                    }
                }
            });
            await emitTurnNotifications({
                threadId,
                turnId,
                finalText: defaultResponseText
            });
            return;
        }
        await writeStdoutLine({
            id: message.id,
            error: {
                code: -32601,
                message: `Unsupported fake app-server method: ${message.method}`
            }
        });
    };

    await new Promise((resolve, reject) => {
        let buffer = '';
        let queue = Promise.resolve();

        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) {
                    continue;
                }
                queue = queue.then(async () => {
                    const message = JSON.parse(line);
                    await handleMessage(message);
                });
            }
        });
        process.stdin.on('end', () => {
            const trailingLine = buffer.trim();
            if (trailingLine) {
                queue = queue.then(async () => {
                    const message = JSON.parse(trailingLine);
                    await handleMessage(message);
                });
            }
            queue.then(resolve, reject);
        });
        process.stdin.on('error', reject);
    });
    maybeWriteLog();
}

(async () => {
    const args = process.argv.slice(2);
    if (args[0] === 'app-server') {
        await runFakeAppServer(args);
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
