#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT_DIR = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT_DIR, 'tmp', 'playwright_new_game_run');
const SERVER_LOG_PATH = path.join(ARTIFACT_DIR, 'server.log');
const RESULT_PATH = path.join(ARTIFACT_DIR, 'result.json');
const SCREENSHOT_PATH = path.join(ARTIFACT_DIR, 'final-chat.png');

const PORT = Number.parseInt(process.env.PLAYWRIGHT_PORT || '', 10) || 4173;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_READY_TIMEOUT_MS = 180000;
const NEW_GAME_TIMEOUT_MS = 1800000;
const CHAT_TIMEOUT_MS = 600000;

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

let serverProcess = null;
let browser = null;
let page = null;
let runStartTimestamp = Date.now();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const elapsedSeconds = () => Math.round((Date.now() - runStartTimestamp) / 1000);
const log = (message) => {
    console.log(`[pw-e2e +${elapsedSeconds()}s] ${message}`);
};
const startProgressLogger = (label, intervalMs = 30000) => {
    const startedAt = Date.now();
    return setInterval(() => {
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        log(`${label}... ${seconds}s elapsed`);
    }, intervalMs);
};
const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(timeoutMessage));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
};
const waitForCurrentPlayerName = async ({
    pageHandle,
    expectedName,
    timeoutMs,
    pollIntervalMs = 5000,
    getClientError = null
}) => {
    const start = Date.now();
    let lastState = null;
    while ((Date.now() - start) < timeoutMs) {
        if (typeof getClientError === 'function') {
            const clientError = getClientError();
            if (clientError) {
                throw new Error(`Browser reported new-game failure: ${clientError}`);
            }
        }

        lastState = await pageHandle.evaluate(async () => {
            try {
                const response = await fetch('/api/player', { method: 'GET', cache: 'no-store' });
                const payload = await response.json().catch(() => ({}));
                return {
                    ok: response.ok,
                    status: response.status,
                    success: Boolean(payload?.success),
                    player: payload?.player || null,
                    error: payload?.error || payload?.details || null
                };
            } catch (error) {
                return {
                    ok: false,
                    status: 0,
                    success: false,
                    player: null,
                    error: error?.message || String(error)
                };
            }
        });

        const currentName = typeof lastState?.player?.name === 'string'
            ? lastState.player.name.trim()
            : '';
        if (lastState?.success && currentName === expectedName) {
            return lastState;
        }

        await sleep(pollIntervalMs);
    }

    throw new Error(`Timed out waiting for current player "${expectedName}". Last observed state: ${JSON.stringify(lastState)}`);
};

const waitForServerReady = async () => {
    const start = Date.now();
    let lastProgressLog = 0;
    while ((Date.now() - start) < SERVER_READY_TIMEOUT_MS) {
        if (serverProcess && serverProcess.exitCode !== null) {
            throw new Error(
                `Server exited before readiness (code=${serverProcess.exitCode}, signal=${serverProcess.signalCode || 'none'}).`
            );
        }
        try {
            const response = await fetch(`${BASE_URL}/api/hello`, { method: 'GET' });
            if (response.ok) {
                log('Server is ready.');
                return;
            }
        } catch (_) {
            // Retry until timeout.
        }
        if ((Date.now() - lastProgressLog) >= 10000) {
            lastProgressLog = Date.now();
            const waitSeconds = Math.round((Date.now() - start) / 1000);
            log(`Waiting for server readiness... ${waitSeconds}s elapsed`);
        }
        await sleep(500);
    }
    throw new Error(`Server did not become ready within ${SERVER_READY_TIMEOUT_MS}ms.`);
};

const startServer = async () => {
    log(`Starting server on ${BASE_URL}`);
    const logStream = fs.createWriteStream(SERVER_LOG_PATH, { flags: 'w' });
    serverProcess = spawn('npm', ['run', 'start', '--', '--port', String(PORT)], {
        cwd: ROOT_DIR,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', chunk => {
        logStream.write(chunk);
        process.stdout.write(chunk);
    });
    serverProcess.stderr.on('data', chunk => {
        logStream.write(chunk);
        process.stderr.write(chunk);
    });

    serverProcess.once('exit', (code, signal) => {
        log(`Server process exited (code=${code}, signal=${signal || 'none'}).`);
    });

    const startupErrorPromise = new Promise((_, reject) => {
        serverProcess.once('error', error => {
            reject(new Error(`Failed to start server process: ${error.message}`));
        });
    });

    await Promise.race([
        waitForServerReady(),
        startupErrorPromise
    ]);
};

const stopServer = async () => {
    if (!serverProcess) {
        return;
    }
    if (serverProcess.exitCode !== null) {
        log(`Server already stopped (code=${serverProcess.exitCode}, signal=${serverProcess.signalCode || 'none'}).`);
        return;
    }
    if (serverProcess.killed) {
        return;
    }

    log('Stopping server process.');
    const proc = serverProcess;
    await new Promise(resolve => {
        if (proc.exitCode !== null) {
            resolve();
            return;
        }

        const killTimeout = setTimeout(() => {
            if (proc.exitCode === null && !proc.killed) {
                proc.kill('SIGKILL');
            }
        }, 5000);

        proc.once('exit', () => {
            clearTimeout(killTimeout);
            resolve();
        });
        proc.kill('SIGTERM');
    });
};

const runFlow = async () => {
    log('Launching Chromium (headless).');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(120000);

    page.on('dialog', async dialog => {
        try {
            await dialog.accept();
        } catch (_) {
            // Ignore dialog accept failures.
        }
    });
    let newGameClientError = '';
    page.on('console', msg => {
        const text = typeof msg?.text === 'function' ? msg.text().trim() : '';
        if (!text) {
            return;
        }
        if (/New game creation failed:/i.test(text)) {
            newGameClientError = text;
            log(`Browser console reported new-game failure: ${text}`);
        }
    });

    const runStamp = Date.now();
    const settingName = `PW E2E ${runStamp}`;
    const playerName = `PW Hero ${runStamp}`;
    const lookAroundMessage = 'look around';

    log(`Creating setting "${settingName}" on /settings.`);
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
    await page.fill('#name', settingName);
    await page.fill('#description', 'Playwright-generated end-to-end test setting.');
    await page.fill('#theme', 'Fantasy');
    await page.fill('#genre', 'Adventure');
    await page.click('#submitBtn');

    log('Waiting for setting save success message.');
    await page.waitForFunction(() => {
        const el = document.querySelector('#statusMessage');
        return Boolean(el && /success/i.test(el.textContent || ''));
    }, { timeout: 180000 });

    const currentSetting = await page.evaluate(async () => {
        const response = await fetch('/api/settings/current');
        return response.json();
    });
    if (!currentSetting || !currentSetting.success || !currentSetting.setting) {
        throw new Error('Failed to verify applied setting after creation.');
    }
    if (currentSetting.setting.name !== settingName) {
        throw new Error(`Applied setting mismatch. Expected "${settingName}", received "${currentSetting.setting.name}".`);
    }
    log(`Setting "${settingName}" saved and applied.`);

    log(`Opening /new-game and starting as "${playerName}".`);
    await page.goto(`${BASE_URL}/new-game`, { waitUntil: 'domcontentloaded' });
    await page.fill('#playerName', playerName);

    const newGameRequestPromise = page.waitForRequest(req => (
        req.url().includes('/api/new-game') && req.method() === 'POST'
    ), { timeout: 120000 });

    log('Submitting new game form.');
    await page.click('#startBtn');
    const newGameRequest = await newGameRequestPromise;
    log('Detected /api/new-game request dispatch.');

    const newGameProgressLog = startProgressLogger('Still waiting for new game generation', 30000);
    let readyPlayerState = null;
    let newGameJson = null;
    try {
        log('Waiting for /api/new-game response.');
        const newGameResponse = await withTimeout(
            newGameRequest.response(),
            NEW_GAME_TIMEOUT_MS,
            `Timed out waiting for /api/new-game response after ${NEW_GAME_TIMEOUT_MS}ms.`
        );
        if (newGameResponse) {
            const rawNewGameBody = await newGameResponse.text().catch(() => '');
            let parsedNewGameBody = null;
            if (rawNewGameBody && rawNewGameBody.trim().length > 0) {
                try {
                    parsedNewGameBody = JSON.parse(rawNewGameBody);
                } catch (parseError) {
                    log(`Could not parse /api/new-game response as JSON: ${parseError.message}`);
                }
            }

            if (!newGameResponse.ok) {
                const payloadText = rawNewGameBody && rawNewGameBody.trim().length > 0
                    ? rawNewGameBody
                    : JSON.stringify(parsedNewGameBody || {});
                throw new Error(`New game request failed: status=${newGameResponse.status()} payload=${payloadText}`);
            }
            if (parsedNewGameBody && parsedNewGameBody.success === false) {
                throw new Error(`New game request failed: status=${newGameResponse.status()} payload=${JSON.stringify(parsedNewGameBody)}`);
            }
            newGameJson = parsedNewGameBody;
            log('New game API response captured successfully.');
        } else {
            log('No /api/new-game response object was captured; waiting on /api/player readiness.');
        }

        log('Waiting for redirect into adventure view.');
        await page.waitForURL(url => (
            url.origin === new URL(BASE_URL).origin
            && (url.pathname === '/' || url.href.startsWith(`${BASE_URL}/#tab-adventure`))
        ), { timeout: 180000 });
        await page.waitForSelector('#messageInput', { timeout: 180000 });
        await page.waitForSelector('#sendButton', { timeout: 180000 });
        log('Adventure UI is ready.');

        readyPlayerState = await waitForCurrentPlayerName({
            pageHandle: page,
            expectedName: playerName,
            timeoutMs: NEW_GAME_TIMEOUT_MS,
            pollIntervalMs: 5000,
            getClientError: () => newGameClientError
        });
        if (!newGameJson) {
            newGameJson = {
                success: true,
                player: readyPlayerState.player || {}
            };
        }
        log(`New game generation completed for player "${playerName}".`);
    } finally {
        clearInterval(newGameProgressLog);
    }

    await page.fill('#messageInput', lookAroundMessage);
    const chatResponsePromise = page.waitForResponse(resp => (
        resp.url().includes('/api/chat') && resp.request().method() === 'POST'
    ), { timeout: CHAT_TIMEOUT_MS });
    log('Sending "look around" to /api/chat.');
    await page.click('#sendButton');

    const chatResponse = await chatResponsePromise;
    const chatJson = await chatResponse.json();
    if (!chatResponse.ok) {
        throw new Error(`Chat request failed with status ${chatResponse.status()}: ${JSON.stringify(chatJson)}`);
    }
    if (!chatJson || typeof chatJson.response !== 'string' || !chatJson.response.trim()) {
        throw new Error(`Chat response missing narrative payload: ${JSON.stringify(chatJson)}`);
    }
    log('Received narrative response from /api/chat.');

    await page.waitForTimeout(3000);
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    log(`Saved screenshot to ${path.relative(ROOT_DIR, SCREENSHOT_PATH)}.`);

    const result = {
        success: true,
        baseUrl: BASE_URL,
        settingName,
        playerName,
        lookAroundMessage,
        newGameSummary: {
            playerId: newGameJson?.player?.id || null,
            playerName: newGameJson?.player?.name || null,
            locationId: newGameJson?.startingLocation?.id || null,
            locationName: newGameJson?.startingLocation?.name || null
        },
        chatResponsePreview: chatJson.response.slice(0, 240),
        artifacts: {
            serverLog: path.relative(ROOT_DIR, SERVER_LOG_PATH),
            resultJson: path.relative(ROOT_DIR, RESULT_PATH),
            screenshot: path.relative(ROOT_DIR, SCREENSHOT_PATH)
        }
    };

    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2), 'utf8');
    return result;
};

const main = async () => {
    runStartTimestamp = Date.now();
    log('Starting end-to-end new game flow.');
    try {
        await startServer();
        const result = await runFlow();
        log('Flow completed successfully.');
        console.log(JSON.stringify(result, null, 2));
    } finally {
        if (page && !page.isClosed()) {
            await page.close().catch(() => {});
        }
        if (browser) {
            await browser.close().catch(() => {});
        }
        await stopServer();
    }
};

main().catch(error => {
    const failurePayload = {
        success: false,
        error: error?.message || String(error),
        artifacts: {
            serverLog: path.relative(ROOT_DIR, SERVER_LOG_PATH),
            resultJson: path.relative(ROOT_DIR, RESULT_PATH),
            screenshot: path.relative(ROOT_DIR, SCREENSHOT_PATH)
        }
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(failurePayload, null, 2), 'utf8');
    console.error(failurePayload.error);
    process.exit(1);
});
