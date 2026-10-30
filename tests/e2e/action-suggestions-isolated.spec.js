const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_URL = 'http://127.0.0.1:4173/';
const roots = {
    views: path.join(ROOT, 'views'),
    public: path.join(ROOT, 'public'),
    assets: path.join(ROOT, 'assets')
};
const renderEnvironment = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(roots.views),
    { autoescape: true, throwOnUndefined: false }
);

function renderPlayDocument() {
    return renderEnvironment.render('index.njk', {
        title: 'Isolated Play fixture',
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

function historyFixture() {
    return Array.from({ length: 60 }, (_, index) => ({
        id: `action-suggestions-entry-${index}`,
        timestamp: `2026-10-26T12:00:${String(index % 60).padStart(2, '0')}.000Z`,
        role: index % 2 ? 'assistant' : 'user',
        content: `Fixture history entry ${index + 1}: ${'A rendered chat line for composer layout testing. '.repeat(3)}`
    }));
}

function contentTypeFor(filePath) {
    return ({
        '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
    })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function installFixture(page) {
    const fixture = { suggestionRequests: 0, chatRequests: [], inputResponses: [], blockedWrites: [], pageErrors: [], externalRequests: [], history: historyFixture() };
    page.on('pageerror', error => fixture.pageErrors.push(error.stack || error.message));
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
        if (pathname === '/api/chat/action-suggestions') {
            fixture.suggestionRequests += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ suggestions: [
                    'Ask the guard about the closed gate.',
                    'Examine the muddy footprints by the archway.',
                    'Offer the merchant a fair trade for local news.'
                ] })
            });
            return;
        }
        if (pathname === '/api/chat') {
            fixture.chatRequests.push(route.request().postDataJSON());
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: 'Done.', messages: [], worldTime: {} }) });
            return;
        }
        if (pathname === '/api/chat/history') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, history: fixture.history }) });
            return;
        }
        if (pathname === '/api/chat/user-input-response') {
            fixture.inputResponses.push(route.request().postDataJSON());
            await route.fulfill({ json: { success: true } });
            return;
        }
        if (pathname.startsWith('/api/')) {
            if (!['GET', 'HEAD'].includes(route.request().method())) fixture.blockedWrites.push(`${route.request().method()} ${pathname}`);
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, attributes: {} }) });
            return;
        }
        const assetRoot = pathname.startsWith('/assets/') ? roots.assets : roots.public;
        const relativePath = pathname.startsWith('/assets/') ? pathname.slice('/assets'.length) : pathname;
        const assetPath = path.resolve(assetRoot, `.${relativePath}`);
        if (assetPath.startsWith(`${assetRoot}${path.sep}`) && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
            await route.fulfill({ status: 200, contentType: contentTypeFor(assetPath), body: fs.readFileSync(assetPath) });
            return;
        }
        await route.fulfill({ status: 404, body: `Missing isolated fixture asset: ${pathname}` });
    });
    await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.AIRPG_CHAT));
    await page.waitForFunction(() => window.AIRPG_CHAT.chatHistoryReady);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobileAdventurePrimaryNav [data-mobile-adventure-pane="chat"]').click();
    await expect(page.locator('#chatLog .message')).toHaveCount(60);
    return fixture;
}

test('integer input accepts a typed unary plus and rejects malformed values', async ({ page }) => {
    const fixture = await installFixture(page);
    await page.evaluate(() => window.AIRPG_CHAT.handlePlayerInputRequest({
        inputRequestId: 'signed-roll', mode: 'integer', question: 'Enter a roll.'
    }));
    const input = page.locator('#playerInputRequestNumericAnswer');
    const submit = page.locator('#playerInputRequestSubmitBtn');
    await expect(input).toBeVisible();
    for (const invalid of ['+', '++3', '+-3', '3.5']) {
        await input.fill(invalid);
        await submit.click();
        await expect(page.locator('#playerInputRequestStatus')).toContainText('Enter an integer roll.');
        expect(fixture.inputResponses).toHaveLength(0);
    }
    await input.fill('');
    await input.pressSequentially('+3');
    await expect(input).toHaveValue('+3');
    await submit.click();
    await expect.poll(() => fixture.inputResponses.length).toBe(1);
    expect(fixture.inputResponses[0]).toMatchObject({ inputRequestId: 'signed-roll', answer: '+3' });
});

async function measureButton(page) {
    return page.locator('#suggestActionsButton').evaluate(button => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
            display: style.display,
            visibility: style.visibility,
            disabled: button.disabled,
            bounds: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
            viewportWidth: document.documentElement.clientWidth,
            documentWidth: document.documentElement.scrollWidth,
            inViewport: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= document.documentElement.clientWidth && rect.top >= 0 && rect.bottom <= document.documentElement.clientHeight,
            hitTarget: (() => {
                const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                return document.elementFromPoint(point.x, point.y)?.closest('#suggestActionsButton') === button;
            })(),
            ancestors: (() => {
                const values = [];
                for (let node = button; node && values.length < 8; node = node.parentElement) {
                    const ancestorStyle = getComputedStyle(node);
                    values.push({ tag: node.tagName, id: node.id, className: String(node.className), display: ancestorStyle.display, visibility: ancestorStyle.visibility, rect: (() => { const box = node.getBoundingClientRect(); return [box.left, box.right, box.top, box.bottom]; })() });
                }
                return values;
            })()
        };
    });
}

test('Suggest actions remains reachable at phone widths and submits one selected action', async ({ page }) => {
    const fixture = await installFixture(page);
    const input = page.locator('#messageInput');
    await input.fill('Keep this draft.');

    const geometry = {};
    for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        geometry[width] = await measureButton(page);
    }
    for (const width of [1280, 390, 320]) {
        expect(geometry[width].display, `${width}px display: ${JSON.stringify(geometry[width])}`).not.toBe('none');
        expect(geometry[width].visibility, `${width}px visibility: ${JSON.stringify(geometry[width])}`).toBe('visible');
        expect(geometry[width].inViewport, `${width}px button viewport bounds: ${JSON.stringify(geometry[width])}`).toBe(true);
        expect(geometry[width].hitTarget, `${width}px button hit target: ${JSON.stringify(geometry[width])}`).toBe(true);
        expect(geometry[width].documentWidth, `${width}px horizontal overflow`).toBeLessThanOrEqual(width);
    }
    test.info().annotations.push({ type: 'button-geometry', description: JSON.stringify(geometry) });

    await page.setViewportSize({ width: 390, height: 844 });
    fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'tmp/mobile-suggest-actions.png') });
    await page.locator('#suggestActionsButton').click();
    await expect(page.locator('#actionSuggestionsModal')).toBeVisible();
    await expect(page.locator('.action-suggestion-button')).toHaveCount(3);
    await page.locator('#actionSuggestionsCancelBtn').click();
    await expect(page.locator('#actionSuggestionsModal')).toBeHidden();
    await expect(input).toHaveValue('Keep this draft.');

    await page.evaluate(() => {
        window.AIRPG_CHAT.renderPromptProgress([{ id: 'fixture-progress', label: 'Dock overlap check', progressFraction: 0.6 }]);
        window.AIRPG_CHAT.setPromptProgressDockState('table');
    });
    await expect(page.locator('#promptProgressDock')).toBeVisible();
    const dockGeometry = await page.evaluate(() => {
        const composer = document.querySelector('#mobileAdventureChatPane .input-area').getBoundingClientRect();
        const dock = document.querySelector('#promptProgressDock').getBoundingClientRect();
        const button = document.querySelector('#suggestActionsButton').getBoundingClientRect();
        return { composerBottom: composer.bottom, buttonBottom: button.bottom, dockTop: dock.top, dockBottom: dock.bottom, viewportBottom: document.documentElement.clientHeight };
    });
    expect(dockGeometry.composerBottom, JSON.stringify(dockGeometry)).toBeLessThanOrEqual(dockGeometry.dockTop);
    expect(dockGeometry.buttonBottom, JSON.stringify(dockGeometry)).toBeLessThanOrEqual(dockGeometry.dockTop);

    await page.locator('#suggestActionsButton').click();
    await expect(page.locator('.action-suggestion-button')).toHaveCount(3);
    await page.locator('.action-suggestion-button').nth(1).click();
    await expect.poll(() => fixture.chatRequests.length).toBe(1);
    expect(fixture.chatRequests[0].messages.at(-1)).toMatchObject({
        role: 'user',
        content: 'Examine the muddy footprints by the archway.'
    });
    await expect(page.locator('#actionSuggestionsModal')).toBeHidden();
    expect(fixture.suggestionRequests).toBe(2);
    expect(fixture.blockedWrites).toEqual([]);
    expect(fixture.externalRequests).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
});
