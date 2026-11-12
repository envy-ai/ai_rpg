const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'http://0.0.0.0:4173/';
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(ROOT, 'views')), { autoescape: true });

async function setup(page, slashResponse) {
    const posts = [];
    let history = [];
    await page.route('**/*', async route => {
        const request = route.request(), url = new globalThis.URL(request.url());
        if (url.origin !== new globalThis.URL(URL).origin) return route.abort();
        const pathname = decodeURIComponent(url.pathname);
        if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: env.render('index.njk', {
            title: 'Replay fixture', currentPage: 'chat', characterPortraitWidth: 3, characterPortraitHeight: 4,
            clientMessageHistory: { maxMessages: 100, pruneTo: 80 }, currentSetting: {}, gameLoaded: true,
            availableSkills: [], thingImageBadges: [], thingContextActions: [], thingEditFields: [], playerEditFields: [],
            rarityDefinitions: [], needBarDefinitions: [], pointPoolFormulas: {}
        }) });
        if (pathname.startsWith('/api/')) {
            if (pathname === '/api/images/request') return route.fulfill({ json: { skipped: true, reason: 'fixture' } });
            if (request.method() !== 'GET') posts.push({ path: pathname, body: request.postDataJSON() });
            if (pathname === '/api/slash-command') { history = slashResponse.history || history; return route.fulfill({ status: slashResponse.status || 200, json: slashResponse.body }); }
            if (request.method() !== 'GET') return route.fulfill({ status: 405, json: { error: 'Writes disabled by fixture.' } });
            const json = pathname === '/api/player/ability-selection' ? { success: true, abilitySelection: { pending: false } }
                : pathname === '/api/player' ? { success: true, player: { id: 'fixture-player', name: 'Hero', abilities: [] } }
                : pathname === '/api/techniques' ? { actorId: 'fixture-player', actorName: 'Hero', catalog: [], disciplines: [], techniques: [], targets: [] }
                : pathname === '/api/chat/history' ? { success: true, history } : { success: true };
            return route.fulfill({ json });
        }
        const root = pathname.startsWith('/assets/') ? path.join(ROOT, 'assets') : path.join(ROOT, 'public');
        const relative = pathname.startsWith('/assets/') ? pathname.slice('/assets'.length) : pathname;
        const file = path.resolve(root, `.${relative}`);
        if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404 });
        return route.fulfill({ contentType: ({ '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.AIRPG_CHAT));
    await page.evaluate(() => window.updateChatPlayerPanel({ id: 'fixture-player', name: 'Hero', abilities: [] }));
    await page.waitForFunction(() => !window.isPlayerAbilitySelectionBlockingGameplay?.());
    return posts;
}

async function send(page) {
    await page.locator('#messageInput').fill('/reprocess_events');
    await expect(page.locator('#sendButton')).toBeEnabled();
    await page.locator('#sendButton').click();
}

test('no-argument replay command posts to slash API and displays its reply', async ({ page }) => {
    const posts = await setup(page, { body: { success: true, replies: [{ content: 'Reprocessed 1 event pass.', ephemeral: false }] } });
    await send(page);
    await expect(page.getByText('Reprocessed 1 event pass.')).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe('/api/slash-command');
    expect(posts[0].body.command).toBe('reprocess_events');
    expect(posts[0].body.argsText).toBe('');
    expect(posts[0].body.args).toEqual({});
});

test('replay failure keeps its warning and stack visible in the persistent error dialog', async ({ page }) => {
    const posts = await setup(page, { status: 500, body: { success: false, error: 'Replay failed', stack: 'Replay failed\n    at EventReprocessor.run', warnings: ['Previously applied events may be applied again.'] } });
    await send(page);
    const dialog = page.locator('dialog.page-feedback-dialog[open]');
    await expect(dialog).toContainText('Previously applied events may be applied again.');
    await expect(dialog).toContainText('at EventReprocessor.run');
    expect(posts.map(entry => entry.path)).toEqual(['/api/slash-command']);
});

test('prompt failure viewer keeps replay warnings visible for a mixed-case command', async ({ page }) => {
    const posts = await setup(page, { status: 500, body: {
        success: false, error: 'Replay failed', stack: 'Replay failed\n    at EventReprocessor.run',
        warnings: ['Previously applied events may be applied again.'], promptFailure: { id: 'failure-1', message: 'Model failure' }
    } });
    await page.evaluate(() => {
        window.__fixturePromptFailures = [];
        window.AIRPG_CHAT.handlePromptFailed = payload => window.__fixturePromptFailures.push(payload);
    });
    await page.locator('#messageInput').fill('/REPROCESS_EVENTS');
    await page.locator('#sendButton').click();
    await expect(page.getByText('Previously applied events may be applied again.')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__fixturePromptFailures.length)).toBe(1);
    expect(posts.map(entry => entry.path)).toEqual(['/api/slash-command']);
});


test('manual quest-check history survives refresh without duplicate success text', async ({ page }) => {
    const history = [
        { id: 'objective-1', role: 'assistant', type: 'event-summary', content: 'Quest update: Return the seal', summaryTitle: 'Quest update', summaryItems: [{ icon: '✅', text: 'Return the seal', category: 'quest_reward', sourceType: 'completed_quest_objective' }], locationId: 'loc', timestamp: '2026-11-10T00:00:00.000Z' },
        { id: 'gift-1', role: 'assistant', type: 'event-summary', content: 'Quest completed: Silver key', summaryTitle: 'Quest completed', summaryItems: [{ icon: '🎁', text: 'Silver key', category: 'quest_reward' }], locationId: 'loc', timestamp: '2026-11-10T00:00:00.500Z' },
        { id: 'reward-1', role: 'assistant', type: 'quest-reward', content: 'The reeve thanks you.', locationId: 'loc', timestamp: '2026-11-10T00:00:01.000Z' }
    ];
    const posts = await setup(page, { body: { success: true, replies: [{ content: '', ephemeral: false }] }, history });
    await page.locator('#messageInput').fill('/quest_check');
    await page.locator('#sendButton').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].body.command).toBe('quest_check');
    await page.evaluate(() => window.AIRPG_CHAT.handleChatHistoryUpdated({}));
    await expect(page.locator('p').getByText('Return the seal', { exact: true })).toHaveCount(1);
    await expect(page.locator('p').getByText('The reeve thanks you.', { exact: true })).toHaveCount(1);
    await expect(page.locator('p').getByText('Silver key', { exact: true })).toHaveCount(1);
    await page.evaluate(() => window.AIRPG_CHAT.refreshChatHistory({ throwOnError: true }));
    await expect(page.locator('p').getByText('Return the seal', { exact: true })).toHaveCount(1);
    await expect(page.locator('p').getByText('The reeve thanks you.', { exact: true })).toHaveCount(1);
    await expect(page.locator('p').getByText('Silver key', { exact: true })).toHaveCount(1);
    await expect(page.getByText(/Quest check completed|Command 'quest_check' executed/)).toHaveCount(0);
});

test('visible return prose and its event summary survive a history refresh', async ({ page }) => {
    const history = [
        { id: 'arrival', role: 'assistant', type: 'player-action', content: 'You arrive at the square.', locationId: 'loc', timestamp: '2026-11-10T00:00:00.000Z' },
        { id: 'wywa', role: 'assistant', type: 'while-you-were-away-player', content: 'The repaired fountain runs again.', parentId: 'arrival', locationId: 'loc', timestamp: '2026-11-10T00:00:01.000Z' },
        { id: 'wywa-event', role: 'assistant', type: 'event-summary', content: 'The fountain was repaired.', parentId: 'wywa', summaryTitle: 'Events', summaryItems: [{ icon: '📋', text: 'The fountain was repaired.', category: 'location', sourceType: 'alter_location' }], locationId: 'loc', timestamp: '2026-11-10T00:00:02.000Z' }
    ];
    await setup(page, { body: { success: true, replies: [{ content: '', ephemeral: false }] }, history });
    await send(page);
    await page.evaluate(() => window.AIRPG_CHAT.refreshChatHistory({ throwOnError: true }));
    const reunion = page.locator('[data-entry-id="wywa"]');
    await expect(reunion).toContainText('The repaired fountain runs again.');
    await expect(reunion).toContainText('What changed');
    await expect(reunion.locator('.turn-diff-drawer__text')).toContainText('The fountain was repaired.');
    await page.evaluate(() => window.AIRPG_CHAT.refreshChatHistory({ throwOnError: true }));
    await expect(page.locator('[data-entry-id="wywa"]')).toHaveCount(1);
    await expect(page.locator('[data-entry-id="wywa"]')).toContainText('The repaired fountain runs again.');
});
