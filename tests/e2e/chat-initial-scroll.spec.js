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

const historyFixture = () => Array.from({ length: 60 }, (_, index) => ({
    id: `initial-scroll-entry-${index}`,
    timestamp: `2026-10-26T12:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
    role: index % 2 ? 'assistant' : 'user',
    content: `Fixture history entry ${index + 1}: ${'A long rendered chat line for scroll testing. '.repeat(3)}`
}));

function renderPlayDocument() {
    return renderEnvironment.render('index.njk', {
        title: 'Play fixture',
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

async function installIsolatedPlayFixture(page, { delayHistory = false, holdChatPost = false } = {}) {
    const fixture = {
        history: historyFixture(),
        historyRequests: 0,
        releaseHistory: null,
        historyGate: null,
        blockedWrites: [],
        externalRequests: [],
        pageErrors: [],
        chatPosts: [],
        releaseChatPost: null,
        chatPostGate: null,
    };
    page.on('pageerror', error => fixture.pageErrors.push(error.stack || error.message));
    if (holdChatPost) fixture.chatPostGate = new Promise(resolve => { fixture.releaseChatPost = resolve; });
    if (delayHistory) {
        fixture.historyGate = new Promise(resolve => { fixture.releaseHistory = resolve; });
    }

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
            await route.fulfill({
                status: 200,
                contentType: 'text/html; charset=utf-8',
                body: renderPlayDocument()
            });
            return;
        }

        if (pathname === '/api/chat/history') {
            fixture.historyRequests += 1;
            if (fixture.historyGate) await fixture.historyGate;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, history: fixture.history })
            });
            return;
        }

        if (pathname === '/api/chat' && route.request().method() === 'POST' && fixture.chatPostGate) {
            fixture.chatPosts.push(route.request().postDataJSON());
            await fixture.chatPostGate;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
            return;
        }

        if (pathname.startsWith('/api/')) {
            if (route.request().method() !== 'GET' && route.request().method() !== 'HEAD') {
                fixture.blockedWrites.push(`${route.request().method()} ${pathname}`);
                await route.fulfill({
                    status: 405,
                    contentType: 'application/json',
                    body: JSON.stringify({ success: false, error: 'Writes are disabled in the isolated chat fixture.' })
                });
            } else {
                const payload = pathname === '/api/attributes'
                    ? { success: true, attributes: {} }
                    : { success: true };
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(payload)
                });
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
    await page.waitForFunction(() => window.AIRPG_CHAT?.chatLog && window.AIRPG_CHAT?.refreshChatHistory);
    await page.addStyleTag({
        content: '#chatLog { height: 180px !important; max-height: 180px !important; min-height: 0 !important; overflow-y: auto !important; flex: none !important; }'
    });
    return fixture;
}

async function assertIsolated(fixture, page) {
    expect(fixture.blockedWrites).toEqual([]);
    expect(fixture.externalRequests).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
    expect(await page.locator('#chatLog .message').count()).toBeGreaterThan(0);
}

async function expectChatAtBottom(page) {
    await expect.poll(() => page.evaluate(() => {
        const log = window.AIRPG_CHAT.chatLog;
        return {
            overflow: log.scrollHeight > log.clientHeight,
            gap: log.scrollHeight - log.clientHeight - log.scrollTop
        };
    })).toMatchObject({ overflow: true });
    await expect.poll(() => page.evaluate(() => {
        const log = window.AIRPG_CHAT.chatLog;
        return log.scrollHeight - log.clientHeight - log.scrollTop;
    })).toBeLessThanOrEqual(2);
}

test.describe('initial chat scroll behavior in an isolated rendered Play page', () => {
    test('delayed initial history scrolls to the newest message on desktop', async ({ page }) => {
        const fixture = await installIsolatedPlayFixture(page, { delayHistory: true });
        await expect.poll(() => fixture.historyRequests).toBeGreaterThan(0);

        await page.evaluate(() => { window.AIRPG_CHAT.chatLog.scrollTop = 0; });
        fixture.releaseHistory();
        await expect.poll(() => page.evaluate(() => window.AIRPG_CHAT.chatHistoryReady)).toBe(true);
        await expect(page.locator('#chatLog [data-entry-id="initial-scroll-entry-59"]')).toBeVisible();
        await expectChatAtBottom(page);
        await assertIsolated(fixture, page);
    });

    test('returning to Adventure follows the loaded chat bottom, while routine refresh does not pull a reader down', async ({ page }) => {
        const fixture = await installIsolatedPlayFixture(page, { delayHistory: true });
        await expect.poll(() => fixture.historyRequests).toBeGreaterThan(0);
        fixture.releaseHistory();
        await page.waitForFunction(() => window.AIRPG_CHAT.chatHistoryReady && window.AIRPG_CHAT.serverHistory.length === 60);
        await expect(page.locator('#chatLog [data-entry-id="initial-scroll-entry-59"]')).toBeVisible();
        await expectChatAtBottom(page);

        await page.evaluate(() => { window.AIRPG_CHAT.chatLog.scrollTop = 0; });
        await expect.poll(() => page.evaluate(() => {
            const log = window.AIRPG_CHAT.chatLog;
            return log.scrollHeight - log.clientHeight - log.scrollTop;
        })).toBeGreaterThan(32);

        await page.locator('[data-tab="map"]').click();
        await page.locator('[data-tab="adventure"]').click();
        await expectChatAtBottom(page);

        await page.evaluate(() => {
            const chat = window.AIRPG_CHAT;
            chat.chatLog.scrollTop = 0;
            chat.renderPromptProgress([{ id: 'fixture-progress', label: 'Routine refresh', progressFraction: 0.6 }]);
        });
        await page.evaluate(() => window.AIRPG_CHAT.renderPromptProgress([{ id: 'fixture-progress', label: 'Routine refresh', progressFraction: 0.7 }]));
        await page.evaluate(() => window.AIRPG_CHAT.refreshChatHistory());
        await expect.poll(() => page.evaluate(() => window.AIRPG_CHAT.chatLog.scrollTop)).toBe(0);

        fixture.history = fixture.history.map((entry, index) => index === 59
            ? { ...entry, content: `${entry.content} Updated by a routine history refresh.` }
            : entry);
        await page.evaluate(() => window.AIRPG_CHAT.refreshChatHistory());
        await expect.poll(() => page.locator('#chatLog [data-entry-id="initial-scroll-entry-59"] .message-content').textContent())
            .toContain('Updated by a routine history refresh.');
        await expect.poll(() => page.evaluate(() => window.AIRPG_CHAT.chatLog.scrollTop)).toBe(0);
        await assertIsolated(fixture, page);
    });

    test('mobile chat pane waits for delayed history, then opens at the newest message', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const fixture = await installIsolatedPlayFixture(page, { delayHistory: true });
        await expect.poll(() => fixture.historyRequests).toBeGreaterThan(0);

        await page.locator('#mobileAdventurePrimaryNav [data-mobile-adventure-pane="chat"]').click();
        fixture.releaseHistory();

        await page.waitForFunction(() => window.AIRPG_CHAT.chatHistoryReady && window.AIRPG_CHAT.serverHistory.length === 60);
        await expect(page.locator('#chatLog [data-entry-id="initial-scroll-entry-59"]')).toBeVisible();
        await expectChatAtBottom(page);

        await page.evaluate(() => { window.AIRPG_CHAT.chatLog.scrollTop = 0; });
        await expect.poll(() => page.evaluate(() => {
            const log = window.AIRPG_CHAT.chatLog;
            return log.scrollHeight - log.clientHeight - log.scrollTop;
        })).toBeGreaterThan(32);
        await page.locator('#mobileAdventurePrimaryNav [data-mobile-adventure-pane="location"]').click();
        await page.locator('#mobileAdventurePrimaryNav [data-mobile-adventure-pane="chat"]').click();
        await expectChatAtBottom(page);

        await page.evaluate(() => { window.AIRPG_CHAT.chatLog.scrollTop = 0; });
        await page.locator('[data-tab="map"]').click();
        await page.locator('[data-tab="adventure"]').click();
        await expect(page.locator('#mobileAdventurePrimaryNav [data-mobile-adventure-pane="chat"]')).toHaveAttribute('aria-selected', 'true');
        await expectChatAtBottom(page);
        await assertIsolated(fixture, page);
    });
});

for (const viewport of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
    test.describe(`${viewport.name} chat follow behavior`, () => {
        test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: viewport.width, height: viewport.height }); });

        for (const submission of [
            { name: 'Enter action', text: 'Look around', method: 'enter' },
            { name: 'button comment', text: '# A note', method: 'button' },
            { name: 'Enter question', text: '? What is here?', method: 'enter' }
        ]) {
            test(`${submission.name} sends from a scrolled-up position and shows the new item`, async ({ page }) => {
                const fixture = await installIsolatedPlayFixture(page, { holdChatPost: true });
                if (viewport.name === 'mobile') await page.locator('#mobileAdventurePrimaryNav [data-mobile-adventure-pane="chat"]').click();
                await page.waitForFunction(() => window.AIRPG_CHAT.chatHistoryReady && window.AIRPG_CHAT.serverHistory.length === 60);
                await page.evaluate(() => { const log = window.AIRPG_CHAT.chatLog; log.scrollTop = log.scrollHeight; });
                await expectChatAtBottom(page);
                await page.evaluate(() => { window.AIRPG_CHAT.chatLog.scrollTop = 0; });
                await expect.poll(() => page.evaluate(() => window.AIRPG_CHAT.chatLog.scrollTop)).toBe(0);
                await page.locator('#messageInput').fill(submission.text);
                if (submission.method === 'enter') await page.locator('#messageInput').press('Enter');
                else await page.locator('#sendButton').click();
                await expect(page.locator('#chatLog .message').last()).toContainText(submission.text.replace(/^[#?]\s*/, ''));
                await expectChatAtBottom(page);
                await expect.poll(() => fixture.chatPosts.length, { timeout: 5000 }).toBe(1);
                fixture.releaseChatPost();
                await assertIsolated(fixture, page);
            });
        }

        test('new server bubbles and history updates follow only while already at the bottom', async ({ page }, testInfo) => {
            const fixture = await installIsolatedPlayFixture(page);
            if (viewport.name === 'mobile') await page.locator('#mobileAdventurePrimaryNav [data-mobile-adventure-pane="chat"]').click();
            await page.waitForFunction(() => window.AIRPG_CHAT.chatHistoryReady && window.AIRPG_CHAT.serverHistory.length === 60);
            await page.evaluate(() => { const log = window.AIRPG_CHAT.chatLog; log.scrollTop = log.scrollHeight; });
            await expectChatAtBottom(page);
            await page.evaluate(() => window.AIRPG_CHAT.addMessage('ai', 'Server bubble at the bottom. '.repeat(16)));
            await expectChatAtBottom(page);
            await page.evaluate(() => { document.querySelector('#chatLog .message:last-child .message-content').textContent += ' Streamed growth. '.repeat(80); });
            await expectChatAtBottom(page);
            fixture.history.push({ id: 'new-server-entry', timestamp: '2026-10-26T12:05:00.000Z', role: 'assistant', content: 'New server history text. '.repeat(20) });
            await page.evaluate(() => window.AIRPG_CHAT.refreshChatHistory());
            await expect(page.locator('#chatLog [data-entry-id="new-server-entry"]')).toBeVisible();
            await expectChatAtBottom(page);
            const before = await page.evaluate(() => { const log = window.AIRPG_CHAT.chatLog; log.scrollTop = log.scrollHeight - log.clientHeight - 20; return log.scrollTop; });
            await page.evaluate(() => window.AIRPG_CHAT.addNpcMessage('Mira', 'New NPC bubble while reading. '.repeat(16)));
            await expect.poll(() => page.evaluate(() => window.AIRPG_CHAT.chatLog.scrollTop)).toBe(before);
            fixture.history[fixture.history.length - 1].content += ' Later growth. '.repeat(80);
            await page.evaluate(() => window.AIRPG_CHAT.refreshChatHistory());
            await expect.poll(() => page.locator('#chatLog [data-entry-id="new-server-entry"]').textContent()).toContain('Later growth.');
            await expect.poll(() => page.evaluate(() => window.AIRPG_CHAT.chatLog.scrollTop)).toBe(before);
            await page.evaluate(() => window.AIRPG_CHAT.renderPromptProgress([{ id: 'fixture-progress', label: 'Reading', progressFraction: 0.5 }]));
            await expect.poll(() => page.evaluate(() => window.AIRPG_CHAT.chatLog.scrollTop)).toBe(before);
            await page.screenshot({ path: path.join(ROOT, 'tmp', `chat-follow-${viewport.name}.png`) });
            await assertIsolated(fixture, page);
        });
    });
}

test('many small upward scrolls stop following before the next server message', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const fixture = await installIsolatedPlayFixture(page);
    await page.waitForFunction(() => window.AIRPG_CHAT.chatHistoryReady && window.AIRPG_CHAT.serverHistory.length === 60);
    await page.evaluate(() => { const log = window.AIRPG_CHAT.chatLog; log.scrollTop = log.scrollHeight; });
    await expectChatAtBottom(page);
    const before = await page.evaluate(async () => {
        const log = window.AIRPG_CHAT.chatLog;
        for (let i = 0; i < 25; i++) {
            log.scrollTop -= 1;
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        return log.scrollTop;
    });
    await expect.poll(() => page.evaluate(() => { const log = window.AIRPG_CHAT.chatLog; return log.scrollHeight - log.clientHeight - log.scrollTop; })).toBeGreaterThanOrEqual(20);
    await page.evaluate(() => window.AIRPG_CHAT.addMessage('ai', 'More server output. '.repeat(20)));
    await expect.poll(() => page.evaluate(() => window.AIRPG_CHAT.chatLog.scrollTop)).toBe(before);
    await assertIsolated(fixture, page);
});
