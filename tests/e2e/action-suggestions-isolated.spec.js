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

test('saved special prefixes and edited plain text use their normal message presentation', async ({ page }) => {
    const fixture = await installFixture(page);
    const result = await page.evaluate(() => {
        const chat = window.AIRPG_CHAT;
        const timestamp = '2026-10-26T12:00:00.000Z';
        const user = (id, content, extra = {}) => ({ id, timestamp, role: 'user', content, ...extra });
        chat.updateServerHistory([
            user('question', 'What now?', { type: 'user-question', metadata: { inputPrefix: '?' } }),
            user('private', 'A clue', { type: 'user-generic-prompt', metadata: { inputPrefix: '@@' } }),
            user('no-context', 'Continue', { type: 'user-generic-prompt', metadata: { inputPrefix: '\\' } }),
            user('forced', '!! Storm'), user('comment', '# Pause'),
            { id: 'edited', timestamp, role: 'assistant', type: 'event-summary', content: '<b>Literal & text</b>', metadata: { editedPlainText: true } }
        ]);
        const node = id => chat.chatLog.querySelector(`[data-entry-id="${id}"]`);
        const first = node('question');
        const values = Object.fromEntries(['question', 'private', 'no-context', 'forced', 'comment', 'edited'].map(id => [id, node(id).querySelector('.message-content').textContent.trim()]));
        const labels = ['question', 'private', 'no-context'].map(id => node(id).querySelector('.message-sender').textContent);
        chat.renderChatHistory();
        return { values, labels, retained: node('question') === first, markdownBold: Boolean(node('edited').querySelector('.message-content b')), staleSummary: Boolean(node('edited').querySelector('.event-summary')) };
    });
    expect(result.values).toEqual({ question: '? What now?', private: '@@ A clue', 'no-context': '\\ Continue', forced: '!! Storm', comment: 'Pause', edited: 'Literal & text' });
    expect(result.labels).toEqual(['👤 You · Question', '👤 You · Private meta prompt', '👤 You · No-context prompt']);
    expect(result.retained).toBe(true); expect(result.markdownBold).toBe(true); expect(result.staleSummary).toBe(false); expect(fixture.pageErrors).toEqual([]);
});

test('empty action cancellation sends nothing and explicit continuation posts empty content', async ({ page }) => {
    const fixture = await installFixture(page);
    await expect(page.locator('#sendButton')).toBeEnabled();
    await page.locator('#sendButton').click();
    await expect(page.locator('#emptyActionConfirmModal')).toBeVisible();
    expect(fixture.chatRequests).toHaveLength(0);
    await page.locator('#emptyActionConfirmCancelBtn').click();
    await expect(page.locator('#emptyActionConfirmModal')).toBeHidden();
    await expect(page.locator('#messageInput')).toBeFocused();
    expect(fixture.chatRequests).toHaveLength(0);
    await page.locator('#sendButton').click();
    await page.locator('#emptyActionConfirmSubmitBtn').click();
    await expect.poll(() => fixture.chatRequests.length).toBe(1);
    expect(fixture.chatRequests[0].messages.at(-1)).toMatchObject({ role: 'user', content: '' });
    expect(fixture.pageErrors).toEqual([]); expect(fixture.blockedWrites).toEqual([]);
});

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

test('mobile navigation retains native details and the live dock across responsive changes', async ({ page }) => {
    const fixture = await installFixture(page);
    await page.evaluate(() => {
        window.fixtureDock = document.querySelector('#promptProgressDock');
        window.AIRPG_CHAT.renderPromptProgress([{ id: 'nav-fixture', label: 'Navigation progress', progressFraction: 0.5 }]);
    });
    await page.locator('[data-mobile-adventure-pane="location"]').click();
    const location = page.locator('#mobileAdventureLocationSubnav');
    await location.locator('[data-mobile-location-pane="npcs"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(location.locator('[data-mobile-location-pane="things"]')).toBeFocused();
    await expect(page.locator('.location-things')).toHaveAttribute('open', '');
    await location.locator('[data-mobile-location-pane="npcs"]').click();
    await expect(page.locator('.location-npcs')).toHaveAttribute('open', '');
    await expect(location.locator('[data-mobile-count="npcs"]')).toHaveText('0');
    await page.locator('[data-mobile-adventure-pane="player-party"]').click();
    const player = page.locator('#mobileAdventurePlayerSubnav');
    await player.locator('[data-mobile-player-pane="player"]').focus();
    await page.keyboard.press('End'); await expect(player.locator('[data-mobile-player-pane="trackers"]')).toBeFocused();
    await page.locator('[data-mobile-adventure-pane="chat"]').click();
    await page.locator('#messageInput').fill('preserved draft');
    await page.setViewportSize({ width: 800, height: 844 });
    expect(await page.evaluate(() => document.querySelector('#promptProgressDock') === window.fixtureDock)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.querySelector('#promptProgressDock') === window.fixtureDock)).toBe(true);
    await expect(page.locator('#promptProgressDock')).toContainText('Navigation progress');
    await expect(page.locator('#messageInput')).toHaveValue('preserved draft');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.locator('[data-mobile-adventure-pane="location"]').click();
    await expect(page.locator('#mobileAdventurePrimaryNav [data-mobile-adventure-pane="location"]')).toHaveAttribute('aria-selected', 'true');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await page.locator('[data-mobile-adventure-pane="chat"]').evaluate(button => button.click());
    await expect(page.locator('#mobileAdventurePrimaryNav [data-mobile-adventure-pane="location"]')).toHaveAttribute('aria-selected', 'true');
    expect(fixture.pageErrors).toEqual([]); expect(fixture.externalRequests).toEqual([]); expect(fixture.blockedWrites).toEqual([]);
});

test('automatic redo settles current action after history replacement on success and failure', async ({ page }) => {
    const fixture = await installFixture(page);
    for (const failure of [false, true]) {
        await page.evaluate(failure => {
            const chat = window.AIRPG_CHAT;
            chat.peekPendingRedoAction = () => ({ content: 'redo fixture' }); chat.consumePendingRedoAction = () => ({ content: 'redo fixture' });
            chat.submitChatMessage = () => new Promise((resolve, reject) => { window.fixtureRedoFinish = () => failure ? reject(new Error('fixture redo failure')) : resolve(); });
            chat.updateServerHistory([{ id: `old-${failure}`, role: 'assistant', type: 'player-action', content: 'Old action', timestamp: '2026-01-01T00:00:00Z' }]);
            window.fixtureOldRedo = document.querySelector('.message-action--redo');
            window.fixtureRedoTask = chat.tryRunPendingRedo();
            chat.updateServerHistory([{ id: `new-${failure}`, role: 'assistant', type: 'player-action', content: 'New action', timestamp: '2026-01-01T00:01:00Z' }]);
        }, failure);
        const current = page.locator('.message-action--redo'); await expect(current).toBeDisabled();
        await page.evaluate(async () => { window.fixtureOldRedo.click(); window.fixtureRedoFinish(); await window.fixtureRedoTask; });
        await expect(current).toBeEnabled();
    }
    expect(fixture.pageErrors).toEqual([]); expect(fixture.blockedWrites).toEqual([]);
});

test('quest offer pending decision remains scoped across replaced history rows', async ({ page }) => {
    const fixture = await installFixture(page); let release, bodies = [];
    await page.route('**/api/quests/confirm', async route => { bodies.push(route.request().postDataJSON()); await new Promise(resolve => { release = resolve; }); await route.fulfill({ status: 500, json: { success: false, error: 'Fixture decision failed', stack: 'Error: Fixture decision failed\n    at quest-offer:42' } }); });
    await page.evaluate(() => { window.fixtureOffer = { id: 'offer', role: 'assistant', type: 'quest-offer', confirmationId: 'confirm-1', quest: { name: 'Fixture Quest', objectives: [] }, status: 'pending', timestamp: '2026-01-01T00:00:00Z' }; window.AIRPG_CHAT.updateServerHistory([window.fixtureOffer]); });
    const offer = page.locator('.quest-offer-message');
    await page.locator('#messageInput').fill('A retained next turn');
    await page.locator('#sendButton').click();
    await expect(page.locator('#questDecisionReminderModal')).toBeVisible();
    expect(fixture.chatRequests).toHaveLength(0); expect(bodies).toHaveLength(0);
    await page.locator('#questDecisionReminderKeepReadingBtn').click();
    await expect(page.locator('#messageInput')).toHaveValue('A retained next turn');
    await page.locator('#sendButton').click();
    await page.locator('#questDecisionReminderReviewBtn').click();
    await expect(offer).toHaveAttribute('data-confirmation-id', 'confirm-1');
    await expect(offer.locator('.quest-offer')).toHaveAttribute('open', '');
    await expect(page.locator('#messageInput')).toHaveValue('A retained next turn');
    expect(fixture.chatRequests).toHaveLength(0); expect(bodies).toHaveLength(0);
    await offer.locator('.quest-offer__accept').evaluate(button => { window.fixtureOldAccept = button; });
    await offer.locator('.quest-offer__accept').click(); await expect.poll(() => bodies.length).toBe(1);
    await page.evaluate(() => window.AIRPG_CHAT.updateServerHistory([{ ...window.fixtureOffer, quest: { ...window.fixtureOffer.quest, description: 'Updated' } }]));
    await offer.locator('summary').click(); await expect(offer.locator('.quest-offer__accept')).toBeDisabled();
    await page.evaluate(() => window.fixtureOldAccept.click()); expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ confirmationId: 'confirm-1', decision: 'accept' });
    release(); await expect(page.getByRole('dialog', { name: 'Operation stopped' })).toContainText('quest-offer:42');
    await expect(offer.locator('.quest-offer__accept')).toBeEnabled();
    expect(fixture.pageErrors).toEqual([]);
});

test('Chat history replacement releases old edit and delete actions', async ({ page }) => {
    const fixture = await installFixture(page);
    await page.evaluate(() => {
        const chat = window.AIRPG_CHAT;
        chat.updateServerHistory([{ id: 'old', role: 'assistant', type: 'assistant', content: 'Old text', timestamp: '2026-01-01T00:00:00Z' }]);
        window.fixtureOldEdit = document.querySelector('.message-action--edit'); window.fixtureOldDelete = document.querySelector('.message-action--delete');
        chat.updateServerHistory([{ id: 'new', role: 'assistant', type: 'assistant', content: 'Current text', timestamp: '2026-01-01T00:01:00Z' }]);
        window.fixtureOldEdit.click(); window.fixtureOldDelete.click();
    });
    await expect(page.locator('.chat-edit-modal')).toBeHidden();
    await page.locator('.message-action--edit').click();
    await expect(page.locator('.chat-edit-modal__textarea')).toHaveValue('Current text');
    await page.locator('.chat-edit-modal__cancel').click();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.locator('.message-action--edit').click(); await expect(page.locator('.chat-edit-modal__textarea')).toHaveValue('Current text');
    await page.locator('.chat-edit-modal__cancel').click();
    await page.locator('.message-action--edit').evaluate(button => { window.fixtureFinalEdit = button; });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await page.evaluate(() => window.fixtureFinalEdit.click()); await expect(page.locator('.chat-edit-modal')).toHaveCount(0);
    expect(fixture.blockedWrites).toEqual([]); expect(fixture.pageErrors).toEqual([]);
});

test('tool-call debug entry exposes persistent delete without edit', async ({ page }) => {
    const fixture = await installFixture(page);
    await page.evaluate(() => {
        const entry = window.AIRPG_CHAT.createToolCallDebugEntryElement({ id: 'debug-1', timestamp: '2026-01-01T00:00:00Z', role: 'system', type: 'tool-call-debug', content: 'Tool calls', toolCalls: [] });
        document.body.append(entry);
    });
    const actions = page.locator('.message-actions--persistent'); await expect(actions).toHaveCount(1);
    await expect(actions.locator('.message-action--delete')).toHaveAttribute('aria-label', 'Delete message');
    await expect(actions.locator('.message-action--edit')).toHaveCount(0); expect(fixture.pageErrors).toEqual([]);
});

test('pending message edits preserve a newer draft and stop UI work on final hide', async ({ page }) => {
    const fixture = await installFixture(page);
    const pending = []; const bodies = []; let completed = 0;
    await page.route('**/api/chat/message', async route => {
        bodies.push(route.request().postDataJSON());
        const status = await new Promise(resolve => pending.push(resolve));
        await route.fulfill({ status, json: status === 200 ? { success: true } : { error: 'Late failure', stack: 'Error: Late failure\n    at late-edit:12' } });
        completed += 1;
    });
    await page.evaluate(() => {
        const chat = window.AIRPG_CHAT;
        window.fixtureEditA = { id: 'edit-a', role: 'assistant', content: 'Original A' };
        window.fixtureEditB = { id: 'edit-b', role: 'assistant', content: 'Original B' };
        const refresh = chat.refreshChatHistory.bind(chat);
        chat.refreshChatHistory = (...args) => { window.fixtureEditRefreshes = (window.fixtureEditRefreshes || 0) + 1; return refresh(...args); };
        chat.openEditModal(window.fixtureEditA);
    });
    await page.locator('.chat-edit-modal__textarea').fill('Saved A');
    await page.locator('.chat-edit-modal__save').click();
    await expect.poll(() => pending.length).toBe(1);
    await page.evaluate(() => window.AIRPG_CHAT.openEditModal(window.fixtureEditB));
    await page.locator('.chat-edit-modal__textarea').fill('Unsaved B');
    pending[0](200);
    await expect.poll(() => page.evaluate(() => window.fixtureEditRefreshes || 0)).toBe(1);
    await expect(page.locator('.chat-edit-modal__textarea')).toHaveValue('Unsaved B');
    await expect(page.locator('.chat-edit-modal')).toBeVisible();
    await page.locator('.chat-edit-modal__save').click();
    await expect.poll(() => pending.length).toBe(2);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    pending[1](500);
    await expect.poll(() => completed).toBe(2);
    await expect.poll(() => page.evaluate(() => window.AIRPG_CHAT.messageUiDisposed)).toBe(true);
    await expect(page.locator('.chat-edit-modal')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Operation stopped' })).toHaveCount(0);
    expect(bodies).toMatchObject([{ id: 'edit-a', content: 'Saved A' }, { id: 'edit-b', content: 'Unsaved B' }]);
    expect(fixture.pageErrors).toEqual([]);
});

test('Adventure separators retain direction, keyboard reset and drag cleanup', async ({ page }) => {
    const fixture = await installFixture(page);
    await page.setViewportSize({ width: 1600, height: 900 });
    const location = page.locator('#adventureLocationResizeHandle');
    const party = page.locator('#adventurePartyResizeHandle');
    await expect(location).toBeVisible();
    const width = target => page.locator(target).evaluate(element => element.getBoundingClientRect().width);
    const drag = async (handle, delta) => {
        const box = await handle.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
    };
    const beforeLocation = await width('.location-block'); await drag(location, 50);
    expect(await width('.location-block')).toBeGreaterThan(beforeLocation);
    const beforeParty = await width('.chat-sidebar'); await drag(party, -50);
    expect(await width('.chat-sidebar')).toBeGreaterThan(beforeParty);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aiRpg.adventurePanelWidths')))).toMatchObject({ location: expect.any(Number), party: expect.any(Number) });
    await location.focus(); await page.keyboard.press('Home');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aiRpg.adventurePanelWidths')).location)).toBeUndefined();
    await location.press('Shift+ArrowRight');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aiRpg.adventurePanelWidths')).location)).toEqual(expect.any(Number));
    const box = await party.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await expect(page.locator('body')).toHaveClass(/adventure-panel-resize-active/);
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.locator('body')).not.toHaveClass(/adventure-panel-resize-active/);
    await page.mouse.up();
    expect(fixture.pageErrors).toEqual([]); expect(fixture.externalRequests).toEqual([]); expect(fixture.blockedWrites).toEqual([]);
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
