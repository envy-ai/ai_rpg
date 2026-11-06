const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_ROOT = path.join(ROOT, 'public');
const ASSETS_ROOT = path.join(ROOT, 'assets');
const VIEWS_ROOT = path.join(ROOT, 'views');
const FIXTURE_URL = 'http://127.0.0.1:4173/';
const renderEnvironment = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(VIEWS_ROOT),
    { autoescape: true, throwOnUndefined: false }
);

function renderPlayDocument() {
    return renderEnvironment.render('index.njk', {
        title: 'Prompt failure fixture',
        currentPage: 'chat',
        characterPortraitWidth: 3,
        characterPortraitHeight: 4,
        clientMessageHistory: { maxMessages: 100, pruneTo: 80 },
        currentSetting: {},
        gameLoaded: true,
        availableSkills: [],
        thingImageBadges: [],
        thingContextActions: [],
        thingEditFields: [],
        playerEditFields: [],
        rarityDefinitions: [],
        needBarDefinitions: [],
        pointPoolFormulas: {}
    });
}

function renderNonPlayDocument() {
    return renderEnvironment.renderString(`<!DOCTYPE html>
<html lang="en">
<head>
    {% set pageTitleValue = 'Prompt failure non-Play fixture' %}
    {% include "_includes/head-common.njk" %}
</head>
<body>
    <main class="container" aria-label="Non-Play fixture">
        <h1>World manager fixture</h1>
        <label for="worldFixtureInput">World name</label>
        <input id="worldFixtureInput" value="Fixture World">
    </main>
</body>
</html>`, {});
}

function renderNewGameDocument(url) {
    const defaults = {
        playerName: 'Mira Vale', playerDescription: 'A cartographer.', playerClass: 'Scout', playerRace: 'Human',
        playerLevel: 3, startMonth: 1, startDay: 2, startTime: 9, startingCurrency: 12,
        startingLocation: 'Begin near the old north gate.',
        calendarMonths: [{ name: 'Frostwake', lengthDays: 30 }],
        availableClasses: ['Scout'], availableRaces: ['Human'], existingSkills: ['Athletics'], pointPoolFormulas: {}
    };
    return renderEnvironment.render('new-game.njk', {
        title: 'Start New Game', currentPage: 'new-game', newGameDefaults: defaults,
        currentSetting: { id: 'fixture-profile', name: 'Fixture Profile' },
        draftToken: new URL(url).searchParams.get('draftToken')
    });
}

function contentTypeFor(filePath) {
    return ({
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf'
    })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function installIsolatedPlayFixture(page) {
    const fixture = { blockedWrites: [], externalRequests: [], pageErrors: [], chatResponses: [] };
    page.on('pageerror', error => fixture.pageErrors.push(error.stack || error.message));
    await page.addInitScript(() => {
        window.WebSocket = class FixtureWebSocket {
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;
            readyState = FixtureWebSocket.CONNECTING;
            addEventListener() {}
            removeEventListener() {}
            send() {}
            close() { this.readyState = FixtureWebSocket.CLOSED; }
        };
    });
    await page.route('**/*', async route => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.origin !== new URL(FIXTURE_URL).origin) {
            if (requestUrl.hostname === 'fonts.googleapis.com' || requestUrl.hostname === 'fonts.gstatic.com') {
                await route.abort();
                return;
            }
            fixture.externalRequests.push(requestUrl.href);
            await route.abort();
            return;
        }

        const pathname = decodeURIComponent(requestUrl.pathname);
        if (pathname === '/') {
            await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: renderPlayDocument() });
            return;
        }
        if (pathname === '/api/chat/history') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, history: [] })
            });
            return;
        }
        if (pathname === '/api/chat' && route.request().method() === 'POST') {
            const reply = fixture.chatResponses.shift();
            if (!reply) {
                fixture.blockedWrites.push('POST /api/chat');
                await route.fulfill({
                    status: 405,
                    contentType: 'application/json',
                    body: JSON.stringify({ success: false, error: 'No chat response was queued in the isolated fixture.' })
                });
                return;
            }
            await route.fulfill({
                status: reply.status,
                contentType: 'application/json',
                body: JSON.stringify(reply.body)
            });
            return;
        }
        if (pathname.startsWith('/api/')) {
            if (route.request().method() !== 'GET' && route.request().method() !== 'HEAD') {
                fixture.blockedWrites.push(`${route.request().method()} ${pathname}`);
                await route.fulfill({
                    status: 405,
                    contentType: 'application/json',
                    body: JSON.stringify({ success: false, error: 'Writes are disabled in the isolated prompt-failure fixture.' })
                });
            } else {
                const payload = pathname === '/api/attributes' ? { success: true, attributes: {} } : { success: true };
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
            }
            return;
        }

        const assetRoot = pathname.startsWith('/assets/') ? ASSETS_ROOT : PUBLIC_ROOT;
        const relativePath = pathname.startsWith('/assets/') ? pathname.slice('/assets'.length) : pathname;
        const assetPath = path.resolve(assetRoot, `.${relativePath}`);
        if (assetPath.startsWith(`${assetRoot}${path.sep}`) && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
            await route.fulfill({
                status: 200,
                contentType: contentTypeFor(assetPath),
                body: fs.readFileSync(assetPath)
            });
            return;
        }
        await route.fulfill({ status: 404, body: `Missing isolated fixture asset: ${pathname}` });
    });

    await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.AIRPG_CHAT?.handlePromptFailed && window.AIRPG_CHAT?.handleWebSocketMessage);
    return fixture;
}

function makeFailure(id, overrides = {}) {
    return {
        id,
        metadataLabel: 'player_action_tinybrain',
        kind: 'tinybrain',
        message: 'Synthetic model response failed validation.',
        stack: 'Error: Synthetic model response failed validation.\n    at fixture',
        transportAttempts: 2,
        validationRetries: 1,
        toolCalls: { attempted: 3, executed: 1, denied: 2, limit: 2, limitUnit: 'calls' },
        serverTime: '2026-10-26T12:00:00.000Z',
        ...overrides
    };
}

async function dispatchFailure(page, payload) {
    await page.evaluate((failure) => {
        window.AIRPG_CHAT.handleWebSocketMessage({ data: JSON.stringify({ type: 'prompt_failed', ...failure }) });
    }, payload);
}

async function assertIsolated(fixture) {
    expect(fixture.blockedWrites).toEqual([]);
    expect(fixture.externalRequests).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
}

async function installIsolatedNonPlayFixture(page) {
    const fixture = { externalRequests: [], pageErrors: [] };
    page.on('pageerror', error => fixture.pageErrors.push(error.stack || error.message));
    await page.addInitScript(() => {
        window.__fixtureSockets = [];
        window.WebSocket = class FixtureWebSocket {
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;
            constructor(url) {
                this.url = url;
                this.readyState = FixtureWebSocket.OPEN;
                this.listeners = new Map();
                window.__fixtureSockets.push(this);
            }
            addEventListener(name, listener) {
                if (!this.listeners.has(name)) this.listeners.set(name, new Set());
                this.listeners.get(name).add(listener);
            }
            removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
            emit(name, event) { for (const listener of this.listeners.get(name) || []) listener(event); }
            send() {}
            close() { this.readyState = FixtureWebSocket.CLOSED; }
        };
    });
    await page.route('**/*', async route => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.origin !== new URL(FIXTURE_URL).origin) {
            if (requestUrl.hostname === 'fonts.googleapis.com' || requestUrl.hostname === 'fonts.gstatic.com') {
                await route.abort();
                return;
            }
            fixture.externalRequests.push(requestUrl.href);
            await route.abort();
            return;
        }

        const pathname = decodeURIComponent(requestUrl.pathname);
        if (pathname === '/') {
            await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: renderNonPlayDocument() });
            return;
        }
        if (pathname.startsWith('/api/')) {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
            return;
        }
        const assetRoot = pathname.startsWith('/assets/') ? ASSETS_ROOT : PUBLIC_ROOT;
        const relativePath = pathname.startsWith('/assets/') ? pathname.slice('/assets'.length) : pathname;
        const assetPath = path.resolve(assetRoot, `.${relativePath}`);
        if (assetPath.startsWith(`${assetRoot}${path.sep}`) && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
            await route.fulfill({
                status: 200,
                contentType: contentTypeFor(assetPath),
                body: fs.readFileSync(assetPath)
            });
            return;
        }
        await route.fulfill({ status: 404, body: `Missing isolated fixture asset: ${pathname}` });
    });

    await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.AIRPG_PROMPT_WINDOWS && window.AIRPG_PAGE_FEEDBACK?.socket);
    return fixture;
}

async function installIsolatedNewGameFixture(page) {
    const fixture = { externalRequests: [], pageErrors: [], apiRequests: [], postNewGame: null };
    page.on('pageerror', error => fixture.pageErrors.push(error.stack || error.message));
    page.on('dialog', async dialog => { if (dialog.type() === 'confirm') await dialog.accept(); else await dialog.dismiss(); });
    await page.addInitScript(() => {
        window.__fixtureNewGameSockets = [];
        window.WebSocket = class FixtureWebSocket {
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;
            constructor(url) {
                this.url = url;
                this.readyState = FixtureWebSocket.CONNECTING;
                this.listeners = new Map();
                window.__fixtureNewGameSockets.push(this);
                Promise.resolve().then(() => { this.readyState = FixtureWebSocket.OPEN; this.emit('open', {}); });
            }
            addEventListener(name, listener) {
                if (!this.listeners.has(name)) this.listeners.set(name, new Set());
                this.listeners.get(name).add(listener);
            }
            removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
            emit(name, event) { for (const listener of this.listeners.get(name) || []) listener(event); }
            send() {}
            close() { this.readyState = FixtureWebSocket.CLOSED; }
        };
    });
    await page.route('**/*', async route => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.origin !== new URL(FIXTURE_URL).origin) {
            if (requestUrl.hostname === 'fonts.googleapis.com' || requestUrl.hostname === 'fonts.gstatic.com') {
                await route.abort();
                return;
            }
            fixture.externalRequests.push(requestUrl.href);
            await route.abort();
            return;
        }
        const pathname = decodeURIComponent(requestUrl.pathname);
        if (pathname === '/new-game') {
            await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: renderNewGameDocument(requestUrl.href) });
            return;
        }
        if (pathname.startsWith('/api/')) {
            fixture.apiRequests.push(`${route.request().method()} ${pathname}`);
            if (pathname === '/api/new-game/drafts/story-authoring:prompt-failure-token') {
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                    success: true,
                    draft: { fields: {
                        playerName: 'Reviewed Protagonist', playerDescription: 'A careful guide.', playerClass: 'Scout', playerRace: 'Human',
                        playerLevel: 3, startMonth: 1, startDay: 2, startTime: 9, startingCurrency: 12,
                        startingLocation: 'The north gate.',
                        attributes: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
                        skills: { Athletics: 1 }
                    } }
                }) });
                return;
            }
            if (pathname === '/api/new-game' && route.request().method() === 'POST' && fixture.postNewGame) {
                await fixture.postNewGame(route);
                return;
            }
            const payload = pathname === '/api/attributes'
                ? { success: true, attributes: { strength: { label: 'Strength' }, dexterity: { label: 'Dexterity' }, constitution: { label: 'Constitution' }, intelligence: { label: 'Intelligence' }, wisdom: { label: 'Wisdom' }, charisma: { label: 'Charisma' } } }
                : { success: true, pendingLoad: null };
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
            return;
        }
        const assetRoot = pathname.startsWith('/assets/') ? ASSETS_ROOT : PUBLIC_ROOT;
        const relativePath = pathname.startsWith('/assets/') ? pathname.slice('/assets'.length) : pathname;
        const assetPath = path.resolve(assetRoot, `.${relativePath}`);
        if (assetPath.startsWith(`${assetRoot}${path.sep}`) && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
            await route.fulfill({ status: 200, contentType: contentTypeFor(assetPath), body: fs.readFileSync(assetPath) });
            return;
        }
        await route.fulfill({ status: 404, body: `Missing isolated fixture asset: ${pathname}` });
    });
    await page.goto(`${FIXTURE_URL}new-game?draftToken=story-authoring%3Aprompt-failure-token`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__fixtureNewGameSockets?.length > 0 && window.AIRPG_PAGE_FEEDBACK && window.AIRPG_PROMPT_WINDOWS);
    await expect(page.locator('#newGameForm')).toBeVisible();
    await expect(page.locator('#startBtn')).toBeEnabled();
    return fixture;
}

async function dispatchStandaloneFailure(page, payload) {
    await page.evaluate((failure) => {
        const sockets = window.__fixtureSockets;
        if (sockets.length !== 1) throw new Error(`Expected one standalone feedback socket, got ${sockets.length}.`);
        sockets[0].emit('message', { data: JSON.stringify({ type: 'prompt_failed', ...failure }) });
    }, payload);
}

test.describe('terminal prompt failure windows in an isolated rendered Play page', () => {
    test('opens separate modeless windows without taking focus or blocking the chat composer', async ({ page }) => {
        const fixture = await installIsolatedPlayFixture(page);
        const composer = page.locator('#messageInput');
        const modalBackdropsBefore = await page.locator('.modal-backdrop:visible').count();
        await composer.focus();
        await dispatchFailure(page, makeFailure('failure-one'));
        await dispatchFailure(page, makeFailure('failure-two', {
            metadataLabel: 'region_generation',
            kind: 'completion',
            message: 'Second synthetic failure.'
        }));

        const windows = page.locator('.prompt-failure-viewer');
        await expect(windows).toHaveCount(2);
        await expect(composer).toBeFocused();
        await expect(page.locator('body')).not.toHaveClass(/modal-open/);
        expect(await page.locator('.modal-backdrop:visible').count()).toBe(modalBackdropsBefore);
        await expect(windows.nth(0)).toHaveAttribute('aria-modal', 'false');
        await expect(windows.nth(1)).toHaveAttribute('aria-modal', 'false');
        await expect(windows.nth(0)).toContainText('player_action_tinybrain');
        await expect(windows.nth(0)).toContainText('Synthetic model response failed validation.');
        await expect(windows.nth(0)).toContainText('Tool calls attempted');
        await expect(windows.nth(0)).toContainText('3');
        await expect(windows.nth(0)).toContainText('2 calls');
        await expect(windows.nth(0)).toContainText('Model attempts: 2');
        await expect(windows.nth(0)).toContainText('Validation retries: 1');
        await page.screenshot({ path: 'tmp/prompt-failure-two-windows-desktop.png', fullPage: true });

        await composer.fill('The chat remains usable.');
        await expect(composer).toHaveValue('The chat remains usable.');
        await expect(page.locator('body')).not.toHaveClass(/modal-open/);
        await assertIsolated(fixture);
    });

    test('closes windows independently, ignores duplicate ids, and renders error strings as text', async ({ page }) => {
        const fixture = await installIsolatedPlayFixture(page);
        const injection = '<img src=x onerror="window.promptFailureXss = true"> <script>window.promptFailureXss = true</script>';
        const payload = makeFailure('independent-failure', { message: injection, stack: injection });
        await dispatchFailure(page, payload);
        await dispatchFailure(page, payload);
        await dispatchFailure(page, makeFailure('second-independent-failure'));

        const windows = page.locator('.prompt-failure-viewer');
        await expect(windows).toHaveCount(2);
        const first = page.locator('.prompt-failure-viewer[data-failure-id="independent-failure"]');
        await expect(first.locator('.prompt-failure-viewer__reason')).toHaveText(injection);
        await expect(first.locator('.prompt-failure-viewer__reason img, .prompt-failure-viewer__reason script')).toHaveCount(0);
        const details = first.locator('.prompt-failure-viewer__details');
        await details.evaluate(element => { element.open = true; });
        const stackText = details.locator('pre');
        await expect(stackText).toHaveText(injection);
        await expect(stackText.locator('img, script')).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveClass(/modal-open/);

        const second = page.locator('.prompt-failure-viewer[data-failure-id="second-independent-failure"]');
        // Windows intentionally stack; close the topmost one first, then the window beneath it.
        await second.locator('.prompt-progress-viewer__close').click();
        await expect(second).toHaveCount(0);
        await expect(page.locator('.prompt-failure-viewer')).toHaveCount(1);

        await first.locator('.prompt-progress-viewer__close').click();
        await expect(first).toHaveCount(0);
        await expect(page.locator('.prompt-failure-viewer')).toHaveCount(0);
        await dispatchFailure(page, makeFailure('escape-failure'));
        const remaining = page.locator('.prompt-failure-viewer[data-failure-id="escape-failure"]');
        await remaining.locator('.prompt-failure-viewer__details summary').focus();
        await page.keyboard.press('Escape');
        await expect(remaining).toHaveCount(0);
        await expect(page.locator('.prompt-failure-viewer')).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveClass(/modal-open/);
        await assertIsolated(fixture);
    });

    test('failure details remain usable on a narrow phone viewport', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const fixture = await installIsolatedPlayFixture(page);
        await page.locator('#messageInput').focus();
        await dispatchFailure(page, makeFailure('mobile-failure', {
            message: `Mobile failure details. ${'A long diagnostic sentence that must wrap without widening the window. '.repeat(8)}`,
            stack: `Error: mobile failure\n${'at generated/test/path.js:1:1\n'.repeat(24)}`
        }));

        const viewer = page.locator('.prompt-failure-viewer');
        const box = await viewer.boundingBox();
        expect(box).not.toBeNull();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(391);
        await viewer.locator('.prompt-failure-viewer__details summary').click();
        await expect(viewer.locator('.prompt-failure-viewer__details pre')).toBeVisible();
        await expect(viewer.locator('.prompt-failure-viewer__details pre')).toContainText('generated/test/path.js');
        await viewer.locator('.prompt-progress-viewer__content').evaluate(element => { element.scrollTop = 0; });
        await expect(viewer.locator('.prompt-progress-viewer__close')).toBeVisible();
        await expect(page.locator('#messageInput')).toBeEnabled();
        await expect(page.locator('body')).not.toHaveClass(/modal-open/);
        await page.screenshot({ path: 'tmp/prompt-failure-window-mobile.png', fullPage: true });
        await assertIsolated(fixture);
    });

    test('the shared prompt viewer still opens and retains its response actions alongside failure windows', async ({ page }) => {
        const fixture = await installIsolatedPlayFixture(page);
        await dispatchFailure(page, makeFailure('shared-viewer-failure'));
        await page.evaluate(() => {
            window.AIRPG_CHAT.renderPromptProgress([{
                id: 'shared-progress-entry',
                label: 'ordinary_prompt',
                model: 'fixture-model',
                promptText: 'Fixture prompt.',
                previewText: 'Fixture response.',
                receivedCount: 17,
                progressFraction: 0.3
            }]);
            window.AIRPG_CHAT.openPromptProgressViewer('shared-progress-entry');
        });

        const promptViewer = page.locator('.prompt-progress-viewer[data-prompt-id="shared-progress-entry"]');
        await expect(promptViewer).toBeVisible();
        await expect(promptViewer.locator('.prompt-progress-viewer__follow-input')).toBeVisible();
        await expect(promptViewer.locator('.prompt-progress-viewer__copy')).toBeVisible();
        await expect(promptViewer.locator('.prompt-progress-viewer__response-inline')).toContainText('Fixture response.');
        await expect(page.locator('.prompt-failure-viewer')).toHaveCount(1);
        await assertIsolated(fixture);
    });

    test('a new failure window rises above an already-focused prompt viewer without taking composer focus', async ({ page }) => {
        const fixture = await installIsolatedPlayFixture(page);
        await page.evaluate(() => {
            window.AIRPG_CHAT.renderPromptProgress([{
                id: 'previously-focused-prompt',
                label: 'older_prompt',
                model: 'fixture-model',
                promptText: 'Older prompt.',
                previewText: 'Older response.',
                receivedCount: 14,
                progressFraction: 0.25
            }]);
            window.AIRPG_CHAT.openPromptProgressViewer('previously-focused-prompt');
        });
        const previousViewer = page.locator('.prompt-progress-viewer[data-prompt-id="previously-focused-prompt"]');
        await previousViewer.focus();
        const previousLayer = await previousViewer.evaluate(viewer => Number.parseInt(getComputedStyle(viewer).zIndex, 10));

        const composer = page.locator('#messageInput');
        await composer.focus();
        await dispatchFailure(page, makeFailure('newer-failure-window'));
        const failureViewer = page.locator('.prompt-failure-viewer[data-failure-id="newer-failure-window"]');
        const failureLayer = await failureViewer.evaluate(viewer => Number.parseInt(getComputedStyle(viewer).zIndex, 10));

        expect(failureLayer).toBeGreaterThan(previousLayer);
        await expect(composer).toBeFocused();
        await expect(previousViewer).toBeVisible();
        await expect(failureViewer).toBeVisible();
        await assertIsolated(fixture);
    });

    test('the matching chat failure payload is deduplicated, while an unrelated chat error still opens its modal', async ({ page }) => {
        const fixture = await installIsolatedPlayFixture(page);
        const failure = makeFailure('http-failure-id');
        fixture.chatResponses.push({ status: 500, body: { error: 'Prompt operation failed.', promptFailure: failure } });
        fixture.chatResponses.push({ status: 500, body: { error: 'Unrelated chat operation failed.' } });
        await page.evaluate(() => {
            const feedback = window.AIRPG_PAGE_FEEDBACK;
            const original = feedback.showError.bind(feedback);
            window.promptFailureModalCalls = [];
            feedback.showError = message => {
                window.promptFailureModalCalls.push(message);
                return original(message);
            };
        });

        await dispatchFailure(page, failure);
        await page.evaluate(() => window.AIRPG_CHAT.submitChatMessage('Synthetic prompt failure').catch(() => {}));
        await expect(page.locator('.prompt-failure-viewer')).toHaveCount(1);
        expect(await page.evaluate(() => window.promptFailureModalCalls)).toEqual([]);
        await expect.poll(() => page.evaluate(() => window.AIRPG_CHAT.pendingRequests.size)).toBe(0);

        await page.evaluate(() => window.AIRPG_CHAT.submitChatMessage('Synthetic unrelated chat failure').catch(() => {}));
        await expect.poll(() => page.evaluate(() => window.promptFailureModalCalls.length)).toBe(1);
        await expect(page.locator('.prompt-failure-viewer')).toHaveCount(1);
        await expect(page.locator('dialog[open]')).toHaveCount(1);
        await assertIsolated(fixture);
    });

    test('the non-Play feedback socket opens the shared failure window, deduplicates HTTP errors, and keeps business errors modal', async ({ page }) => {
        const fixture = await installIsolatedNonPlayFixture(page);
        const failure = makeFailure('non-play-failure', {
            metadataLabel: 'world_profile_generation',
            message: 'Synthetic non-Play generation failure.'
        });
        await dispatchStandaloneFailure(page, failure);

        const viewer = page.locator('.prompt-failure-viewer[data-failure-id="non-play-failure"]');
        await expect(viewer).toBeVisible();
        await expect(viewer).toContainText('world_profile_generation');
        await expect(viewer).toContainText('Synthetic non-Play generation failure.');
        await expect(page.locator('dialog[open]')).toHaveCount(0);
        expect(await page.evaluate(() => window.__fixtureSockets.length)).toBe(1);

        await page.evaluate((envelope) => {
            window.AIRPG_PAGE_FEEDBACK.showError({
                error: 'HTTP request failed after realtime failure.',
                promptFailure: envelope
            });
        }, failure);
        await expect(page.locator('.prompt-failure-viewer')).toHaveCount(1);
        await expect(page.locator('dialog[open]')).toHaveCount(0);
        expect(await page.evaluate(() => window.__fixtureSockets.length)).toBe(1);

        await page.evaluate(() => window.AIRPG_PAGE_FEEDBACK.showError(new Error('Unrelated world-manager error.')));
        const businessDialog = page.locator('dialog.page-feedback-dialog[open]');
        await expect(businessDialog).toBeVisible();
        await expect(businessDialog).toContainText('Unrelated world-manager error.');
        await expect(page.locator('.prompt-failure-viewer')).toHaveCount(1);
        await expect(page.locator('body')).not.toHaveClass(/modal-open/);

        expect(fixture.externalRequests).toEqual([]);
        expect(fixture.pageErrors).toEqual([]);
    });

    test('ordinary new-game startup failure status opens the shared modeless window in Play', async ({ page }) => {
        const fixture = await installIsolatedPlayFixture(page);
        const failure = makeFailure('new-game-startup-stream-failure', {
            metadataLabel: 'faction_generation', kind: 'parse_retry',
            message: 'Faction core generation failed after three attempts.', transportAttempts: 3, validationRetries: 2
        });
        await page.evaluate(envelope => window.AIRPG_CHAT.handleWebSocketMessage({ data: JSON.stringify({
            type: 'chat_status', scope: 'new_game', stage: 'new_game:error',
            message: envelope.message, promptFailure: envelope
        }) }), failure);
        const viewer = page.locator('.prompt-failure-viewer[data-failure-id="new-game-startup-stream-failure"]');
        await expect(viewer).toBeVisible();
        await expect(viewer).toContainText('Faction core generation failed after three attempts.');
        await expect(viewer).toContainText('2');
        await expect(page.locator('dialog[open]')).toHaveCount(0);
        await assertIsolated(fixture);
    });

    test('reviewed new-game HTTP failure and matching startup status share one prompt window', async ({ page }) => {
        const fixture = await installIsolatedNewGameFixture(page);
        const failure = makeFailure('reviewed-new-game-shared-failure', {
            metadataLabel: 'starting_techniques', kind: 'parse_retry',
            message: 'Starting technique authoring failed after three attempts.', transportAttempts: 3, validationRetries: 2
        });
        let submittedPayload = null;
        fixture.postNewGame = async route => {
            submittedPayload = route.request().postDataJSON();
            await page.evaluate(({ envelope, requestId }) => window.__fixtureNewGameSockets[0].emit('message', { data: JSON.stringify({
                type: 'chat_status', scope: 'new_game', stage: 'new_game:error', requestId,
                message: envelope.message, promptFailure: envelope
            }) }), { envelope: failure, requestId: submittedPayload.requestId });
            await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({
                success: false, error: 'Failed to create new game.', details: failure.message,
                code: 'STARTUP_PROMPT_FAILED', stack: failure.stack, promptFailure: failure
            }) });
        };
        await page.locator('#startBtn').click();
        const viewer = page.locator('.prompt-failure-viewer[data-failure-id="reviewed-new-game-shared-failure"]');
        await expect(viewer).toBeVisible();
        await expect(viewer).toContainText('Starting technique authoring failed after three attempts.');
        await expect(page.locator('.prompt-failure-viewer')).toHaveCount(1);
        await expect(page.locator('dialog[open]')).toHaveCount(0);
        await expect.poll(() => submittedPayload).not.toBeNull();
        expect(submittedPayload.draftToken).toBe('story-authoring:prompt-failure-token');
        expect(fixture.apiRequests).toContain('POST /api/new-game');
        expect(fixture.externalRequests).toEqual([]);
        expect(fixture.pageErrors).toEqual([]);
    });
});

test('terminal viewer drag and close stop polling while an in-flight response finishes', async ({ page }) => {
    const fixture = await installIsolatedPlayFixture(page);
    let release, requests = 0;
    await page.route('**/api/terminal-output**', async route => {
        requests++;
        await new Promise(resolve => { release = resolve; });
        await route.fulfill({ json: { success: true, source: 'llama', output: 'Late output', cursor: 11, reset: true, available: true } });
    });
    await page.locator('#terminalOutputButton').click();
    const viewer = page.locator('.terminal-output-viewer');
    await expect(viewer).toBeVisible();
    await expect.poll(() => requests).toBe(1);
    const header = viewer.locator('.terminal-output-viewer__header');
    const before = await viewer.boundingBox();
    const box = await header.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 15); await page.mouse.down();
    await page.mouse.move(box.x + 65, box.y + 45); await page.mouse.up();
    const after = await viewer.boundingBox();
    expect(after.x !== before.x || after.y !== before.y).toBe(true);
    await viewer.locator('.prompt-progress-viewer__close').click();
    await expect(viewer).toHaveCount(0);
    release();
    await expect.poll(() => page.evaluate(() => window.AIRPG_CHAT.terminalOutputPollTimer)).toBe(null);
    await page.waitForTimeout(900);
    expect(requests).toBe(1);
    expect(await page.evaluate(() => window.AIRPG_CHAT.terminalOutputDragState.active)).toBe(false);
    expect(fixture.pageErrors).toEqual([]); expect(fixture.blockedWrites).toEqual([]);
});

test('terminal reader preserves selected text through incremental and replacement updates', async ({ page }) => {
    const fixture = await installIsolatedPlayFixture(page);
    await page.route('**/api/terminal-output**', route => route.fulfill({ json: { success: true, source: 'llama', output: 'Stable terminal', cursor: 15, reset: true, available: true } }));
    await page.locator('#terminalOutputButton').click();
    const output = page.locator('.terminal-output-viewer__output'); await expect(output).toHaveText('Stable terminal');
    await output.evaluate(element => { const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 6); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    await page.evaluate(() => { const chat = window.AIRPG_CHAT; chat.terminalOutputTextBySource.set('llama', 'Stable terminal appended'); chat.renderTerminalOutputText(); });
    await expect(output).toHaveText('Stable terminal appended'); expect(await page.evaluate(() => getSelection().toString())).toBe('Stable');
    await page.evaluate(() => { const chat = window.AIRPG_CHAT; chat.terminalOutputTextBySource.set('llama', 'Stable replacement'); chat.renderTerminalOutputText(); });
    await expect(output).toHaveText('Stable replacement'); expect(await page.evaluate(() => getSelection().toString())).toBe('Stable');
    await page.locator('.terminal-output-viewer .prompt-progress-viewer__close').click();
    expect(fixture.pageErrors).toEqual([]); expect(fixture.blockedWrites).toEqual([]);
});

test('player input panel drag survives queued requests and stops when hidden', async ({ page }) => {
    const fixture = await installIsolatedPlayFixture(page);
    await page.evaluate(async () => {
        await window.AIRPG_CHAT.handlePlayerInputRequest({ inputRequestId: 'one', question: 'First question' });
        await window.AIRPG_CHAT.handlePlayerInputRequest({ inputRequestId: 'two', question: 'Second question' });
    });
    const panel = page.locator('#playerInputRequestPanel');
    const header = page.locator('#playerInputRequestHeader');
    await expect(panel).toBeVisible(); await expect(panel).toContainText('First question');
    const before = await panel.boundingBox(), box = await header.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 15); await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 45); await page.mouse.up();
    const after = await panel.boundingBox();
    expect(after.x !== before.x || after.y !== before.y).toBe(true);
    await page.evaluate(() => window.AIRPG_CHAT.handlePlayerInputRequestClosed({ inputRequestId: 'one' }));
    await expect(panel).toContainText('Second question');
    await page.evaluate(() => window.AIRPG_CHAT.handlePlayerInputRequestClosed({ inputRequestId: 'two' }));
    await expect(panel).toBeHidden();
    expect(await page.evaluate(() => ({ active: window.AIRPG_CHAT.playerInputRequestDragState.active, queued: window.AIRPG_CHAT.playerInputRequestQueue.length }))).toEqual({ active: false, queued: 0 });
    expect(fixture.pageErrors).toEqual([]); expect(fixture.blockedWrites).toEqual([]);
});

test('mandatory recovery owns focus and Escape until a pending response completes', async ({ page }) => {
    const fixture = await installIsolatedPlayFixture(page);
    let release, writes = [];
    await page.route('**/api/chat/user-input-response', async route => {
        writes.push(route.request().postDataJSON());
        await new Promise(resolve => { release = resolve; });
        await route.fulfill({ json: { success: true } });
    });
    await page.locator('#messageInput').focus();
    await page.evaluate(() => window.AIRPG_CHAT.handlePlayerInputRequest({
        inputRequestId: 'recovery-fixture', mode: 'choice', promptLabel: 'vehicle_route_recovery', title: 'Travel stopped', question: 'Choose how to proceed.',
        choices: [{ value: 'rerun', label: 'Re-run turn' }, { value: 'accept-route', label: 'Accept and time-skip' }, { value: 'skip-events', label: 'Skip events' }]
    }));
    const dialog = page.getByRole('dialog', { name: 'Travel stopped' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
    const buttons = dialog.getByRole('button');
    await buttons.last().focus(); await page.keyboard.press('Tab');
    await expect(dialog.locator('summary')).toBeFocused();
    await dialog.locator('[data-recovery-choice="skip-events"]').click();
    await expect.poll(() => writes.length).toBe(1);
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-recovery-choice="skip-events"]')).toBeDisabled();
    release();
    await expect(dialog).toHaveCount(0); await expect(page.locator('#messageInput')).toBeFocused();
    expect(writes[0]).toMatchObject({ inputRequestId: 'recovery-fixture', answer: 'skip-events' });
    expect(fixture.pageErrors).toEqual([]); expect(fixture.blockedWrites).toEqual([]);
});

test('chat bubble filter keeps selection open and Escape dismisses only its popup', async ({ page }) => {
    const fixture = await installIsolatedPlayFixture(page);
    await page.evaluate(() => { window.AIRPG_CHAT.chatBubbleTypes.set('fixture', 'Fixture type'); });
    const trigger = page.locator('#chatBubbleFilterToggle'), popup = page.locator('#chatBubbleFilterPopover');
    await trigger.click(); await expect(popup).toBeVisible();
    const choice = popup.getByLabel('Fixture type');
    await choice.uncheck(); await expect(popup).toBeVisible(); await expect(choice).not.toBeChecked();
    await page.keyboard.press('Escape'); await expect(popup).toBeHidden(); await expect(trigger).toBeFocused();
    await trigger.click(); await expect(choice).not.toBeChecked();
    await page.locator('#messageInput').click(); await expect(popup).toBeHidden();
    expect(fixture.pageErrors).toEqual([]); expect(fixture.blockedWrites).toEqual([]);
});

test('isolated Play progress snapshots update modal mirrors and preserve viewer identity', async ({ page }) => {
    const fixture = await installIsolatedPlayFixture(page);
    await page.evaluate(() => {
        const modal = document.querySelector('#npcMemoriesModal'); modal.removeAttribute('hidden'); modal.setAttribute('aria-hidden', 'false');
        window.AIRPG_CHAT.schedulePromptProgressRender([{ id: 'fixture-progress', label: 'Fixture prompt', progressFraction: 0.25, promptText: 'Stable prompt', failedResponses: ['Stable failure'], previewText: 'Stable response' }], { force: true });
    });
    const fill = page.locator('#npcMemoriesModal .modal__prompt-progress-fill');
    await expect(fill).toHaveCount(1);
    expect(await fill.evaluate(el => parseFloat(el.style.width))).toBeGreaterThan(20);
    await page.evaluate(() => window.AIRPG_CHAT.openPromptProgressViewer('fixture-progress'));
    const viewer = page.locator('.prompt-progress-viewer[data-prompt-id="fixture-progress"]');
    await expect(viewer).toBeVisible();
    await page.evaluate(() => window.AIRPG_CHAT.setPromptProgressDockState('table', { persist: false }));
    const cancel = page.locator('.prompt-progress-table .prompt-progress-cancel');
    await expect(cancel).toBeVisible(); await cancel.focus();
    await cancel.evaluate(button => { window.fixtureFocusedCancel = button; });
    await viewer.locator('.prompt-progress-viewer__response-inline').evaluate(element => { const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 6); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    await page.evaluate(() => window.AIRPG_CHAT.schedulePromptProgressRender([{ id: 'fixture-progress', label: 'Fixture prompt', progressFraction: 0.8, promptText: 'Stable prompt extended', failedResponses: ['Stable failure extended'], previewText: 'Stable response extended' }], { force: true }));
    await expect.poll(() => fill.evaluate(el => parseFloat(el.style.width))).toBeGreaterThan(75);
    await expect(cancel).toBeFocused();
    expect(await cancel.evaluate(button => button === window.fixtureFocusedCancel)).toBe(true);
    await expect(viewer.locator('.prompt-progress-viewer__response-inline')).toContainText('Stable response extended');
    expect(await page.evaluate(() => getSelection().toString())).toBe('Stable');
    await expect(viewer.locator('.prompt-progress-viewer__prompt-inline')).toContainText('Stable prompt extended');
    await expect(viewer.locator('.prompt-progress-viewer__failed-response-inline')).toContainText('Stable failure extended');
    await page.evaluate(() => window.AIRPG_CHAT.schedulePromptProgressRender([], { force: true }));
    await expect(fill).toHaveCount(0);
    await assertIsolated(fixture);
});

test('standalone owned prompt rows retain focus and independent pending actions across snapshots', async ({ page }) => {
    const fixture = await installIsolatedNonPlayFixture(page);
    let release, called = 0;
    await page.route('**/api/prompts/first/cancel', async route => { called += 1; await new Promise(resolve => { release = resolve; }); await route.fulfill({ json: { success: true } }); });
    await page.evaluate(() => {
        const feedback = window.AIRPG_PAGE_FEEDBACK;
        feedback.setJobs('fixture', [{ id: 'job', status: 'running', promptIds: ['first', 'second'] }]);
        window.__fixtureSockets[0].emit('message', { data: JSON.stringify({ type: 'prompt_progress', entries: [{ id: 'first', label: 'First', receivedCount: 1 }, { id: 'second', label: 'Second', receivedCount: 1 }] }) });
    });
    const first = page.locator('.page-feedback-progress__row').filter({ hasText: 'First' });
    const second = page.locator('.page-feedback-progress__row').filter({ hasText: 'Second' });
    const secondCancel = second.getByRole('button', { name: 'Cancel' });
    await secondCancel.focus(); await secondCancel.evaluate(button => { window.fixtureSecondCancel = button; });
    await page.evaluate(() => window.__fixtureSockets[0].emit('message', { data: JSON.stringify({ type: 'prompt_progress', entries: [{ id: 'first', label: 'First', receivedCount: 2 }, { id: 'second', label: 'Second', receivedCount: 2 }] }) }));
    await expect(secondCancel).toBeFocused(); expect(await secondCancel.evaluate(button => button === window.fixtureSecondCancel)).toBe(true);
    await first.getByRole('button', { name: 'Cancel' }).click(); await expect.poll(() => called).toBe(1);
    await expect(first.getByRole('button', { name: 'Cancel' })).toBeDisabled(); await expect(secondCancel).toBeEnabled();
    await page.evaluate(() => window.__fixtureSockets[0].emit('message', { data: JSON.stringify({ type: 'prompt_progress', entries: [{ id: 'first', label: 'First', receivedCount: 3 }, { id: 'second', label: 'Second', receivedCount: 3 }] }) }));
    await expect(first.getByRole('button', { name: 'Cancel' })).toBeDisabled(); await expect(secondCancel).toBeEnabled();
    release(); await expect(first.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await page.evaluate(() => window.AIRPG_PAGE_FEEDBACK.setJobs('fixture', []));
    await expect(page.locator('.page-feedback-progress__row')).toHaveCount(0);
    expect(fixture.pageErrors).toEqual([]); expect(fixture.externalRequests).toEqual([]);
});
