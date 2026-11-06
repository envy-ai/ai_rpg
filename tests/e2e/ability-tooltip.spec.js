const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const ASSETS = path.join(ROOT, 'assets');
const URL = process.env.PLAYWRIGHT_BASE_URL
    || `http://0.0.0.0:${process.env.PLAYWRIGHT_PORT || 4173}/`;
const statesByPage = new WeakMap();
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(ROOT, 'views')), { autoescape: true });
const player = {
    id: 'fixture-player', name: 'Fixture Hero', abilities: [
        { id: 'ability-a', name: 'Arcane <Ward>', type: 'Active', level: 3, shortDescription: 'Brief <summary>.', description: 'A full & detailed description with <b>literal markup</b>.', statusEffects: [{ name: 'Guard <&>', duration: -1, attributes: [{ attribute: 'Strength', modifier: 2, percentModifier: 20 }], techniqueGrants: [{ techniqueId: 'ward', techniqueName: 'Wardcraft Technique' }] }] },
        { id: 'ability-b', name: 'Steady', type: 'Passive', level: 1, shortDescription: 'One description.', description: 'One description.' }
    ]
};

async function setup(page, { openPlayerChooser = true, gameLoaded = true, apiHandler = null, seedPlayer = true, stubImages = true } = {}) {
    const errors = [], writes = [];
    const apiState = { handler: apiHandler, requests: [], selection: null };
    statesByPage.set(page, apiState);
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.route('**/*', async route => {
        const request = route.request(), url = new globalThis.URL(request.url());
        if (url.origin !== new globalThis.URL(URL).origin) { await route.abort(); return; }
        const pathname = decodeURIComponent(url.pathname);
        if (pathname === '/') {
            await route.fulfill({ contentType: 'text/html', body: env.render('index.njk', {
                title: 'Ability fixture', currentPage: 'chat', characterPortraitWidth: 3, characterPortraitHeight: 4,
                clientMessageHistory: { maxMessages: 100, pruneTo: 80 }, currentSetting: {}, gameLoaded,
                availableSkills: [], thingImageBadges: [], thingContextActions: [], thingEditFields: [], playerEditFields: [],
                rarityDefinitions: [], needBarDefinitions: [], pointPoolFormulas: {}
            }) });
            return;
        }
        if (pathname === '/api/images/request') { await route.fulfill({ json: { skipped: true, reason: 'fixture' } }); return; }
        if (pathname.startsWith('/api/')) {
            const apiRequest = { request, pathname, search: url.search, method: request.method() };
            apiState.requests.push(apiRequest);
            if (typeof apiState.handler === 'function') {
                const response = await apiState.handler(apiRequest);
                if (response) {
                    if (Object.hasOwn(response, 'rawBody')) await route.fulfill({ status: response.status || 200, contentType: 'application/json', body: response.rawBody });
                    else await route.fulfill({ status: response.status || 200, json: response.body || {} });
                    return;
                }
            }
            if (!['GET', 'HEAD'].includes(request.method())) { writes.push(`${request.method()} ${pathname}`); await route.fulfill({ status: 405, json: { error: 'Writes disabled' } }); return; }
            const json = pathname === '/api/player/ability-selection' ? { success: true, player, abilitySelection: apiState.selection || { pending: false, levelsMissing: [] } } : pathname === '/api/player' ? { success: true, player } : pathname === '/api/techniques' ? { actorId: player.id, actorName: player.name, disciplines: [], techniques: [], targets: [], catalog: [{ id: 'ward', name: 'Wardcraft Technique' }] } : pathname === '/api/chat/history' ? { success: true, history: [] } : { success: true, attributes: {} };
            await route.fulfill({ json });
            return;
        }
        const root = pathname.startsWith('/assets/') ? ASSETS : PUBLIC;
        const relative = pathname.startsWith('/assets/') ? pathname.slice('/assets'.length) : pathname;
        const file = path.resolve(root, `.${relative}`);
        if (file.startsWith(`${root}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            const type = ({ '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream';
            await route.fulfill({ contentType: type, body: fs.readFileSync(file) });
        } else await route.fulfill({ status: 404, body: `Missing fixture asset: ${pathname}` });
    });
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.AIRPG_CHAT));
    await page.evaluate(({ data, seed, stub }) => { if (stub) window.renderEntityImage = async ({ element }) => { element.textContent = 'Icon'; return { imageId: 'fixture-icon' }; }; if (seed) window.updateChatPlayerPanel(data); }, { data: player, seed: seedPlayer, stub: stubImages });
    if (openPlayerChooser) {
        await page.locator('#chatPlayerAbilitiesButton').evaluate(button => button.click());
        await expect(page.locator('#playerAbilitiesModal')).toBeVisible();
    }
    return { errors, writes, apiState };
}

function pendingAbilityPayload(level = 1, { optionsReady = true, options = null } = {}) {
    const resolvedOptions = options || [
        { id: `ward-${level}`, name: `Level ${level} Ward`, type: 'Active', level, shortDescription: 'Brief summary.', description: 'Full ability description.' },
        { id: `focus-${level}`, name: `Level ${level} Focus`, type: 'Passive', level, shortDescription: 'Second brief summary.', description: 'Second ability description.' }
    ];
    return {
        pending: true,
        levelsMissing: [level, ...(level < 3 ? [level + 1, level + 2].filter(value => value <= 3) : [])],
        selection: {
            level,
            requiredSelections: 1,
            optionsPerLevel: 2,
            optionsReady,
            preselectedAbilityNames: [],
            options: resolvedOptions
        }
    };
}

test('late Scene Gallery registration reconciles hash and releases its tab on final hide', async ({ page }) => {
    const { errors, writes, apiState } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname }) => pathname === '/api/mods/scene-illustration/jobs' ? { body: { success: true, jobs: [] } } : null });
    await page.evaluate(() => { location.hash = '#tab-scenes-gallery'; });
    await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'mods/scene-illustration/public/js/scene-illustration.js'), 'utf8') });
    const gallery = page.locator('#tab-scenes-gallery-tab');
    await expect(gallery).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-scenes-gallery')).toBeVisible();
    await expect.poll(() => apiState.requests.filter(request => request.pathname === '/api/mods/scene-illustration/jobs').length).toBeGreaterThan(0);
    await page.locator('.tab-button[data-tab="adventure"]').click();
    await expect(page.locator('#tab-scenes-gallery')).toBeHidden();
    await gallery.click(); await expect(page.locator('#tab-scenes-gallery')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.locator('.tab-button[data-tab="adventure"]').click(); await gallery.click();
    await expect(page.locator('#tab-scenes-gallery')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await gallery.evaluate(button => button.click());
    expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test('Scene Gallery keeps neighboring cards when deleting and releases old actions on refresh', async ({ page }) => {
    const jobs = [{ id: 'scene-a', status: 'completed', imageUrl: '/a.png', timestamp: '2026-01-01', prompt: 'First scene' }, { id: 'scene-b', status: 'completed', imageUrl: '/b.png', timestamp: '2026-01-02', prompt: 'Second scene' }];
    const deletes = []; let releaseDelete;
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: async ({ pathname, method }) => {
        if (pathname === '/api/mods/scene-illustration/jobs') return { body: { success: true, jobs } };
        if (pathname.startsWith('/api/mods/scene-illustration/jobs/') && method === 'DELETE') { deletes.push(pathname); await new Promise(resolve => { releaseDelete = resolve; }); return { body: { success: true } }; }
        return null;
    } });
    page.on('dialog', dialog => dialog.accept());
    await page.addScriptTag({ path: path.join(ROOT, 'mods/scene-illustration/public/js/scene-illustration.js') });
    await page.locator('#tab-scenes-gallery-tab').click();
    const cards = page.locator('.gallery-card'); await expect(cards).toHaveCount(2);
    await cards.nth(1).evaluate(element => { window.fixtureGalleryNeighbor = element; });
    await cards.first().locator('.gallery-delete-btn').evaluate(button => button.click());
    await expect.poll(() => deletes.length).toBe(1);
    await cards.nth(1).locator('.gallery-delete-btn').focus(); releaseDelete();
    await expect(cards).toHaveCount(1);
    expect(await cards.first().evaluate(element => element === window.fixtureGalleryNeighbor)).toBe(true);
    await expect(cards.first().locator('.gallery-delete-btn')).toBeFocused();
    expect(deletes).toEqual(['/api/mods/scene-illustration/jobs/scene-a']);
    await cards.first().locator('.gallery-delete-btn').evaluate(button => { window.fixtureOldGalleryDelete = button; });
    await page.locator('#refresh-gallery-btn').click(); await expect(cards).toHaveCount(2);
    await page.evaluate(() => window.fixtureOldGalleryDelete.click()); expect(deletes).toHaveLength(1);
    expect(errors).toEqual([]);
});

test('Scene Gallery ignores a pre-delete refresh after committed deletion', async ({ page }) => {
    const a = { id: 'scene-a', status: 'completed', imageUrl: '/a.png', timestamp: '2026-01-01', prompt: 'First scene' }, b = { id: 'scene-b', status: 'completed', imageUrl: '/b.png', timestamp: '2026-01-02', prompt: 'Second scene' };
    let phase = 'initial', releaseDelete, releaseOld, oldStarted = false, freshStarted = false;
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: async ({ pathname, method }) => {
        if (pathname === '/api/mods/scene-illustration/jobs') {
            if (phase === 'hold') { oldStarted = true; await new Promise(resolve => { releaseOld = resolve; }); return { body: { success: true, jobs: [a, b] } }; }
            if (phase === 'deleted') { freshStarted = true; return { body: { success: true, jobs: [b] } }; }
            return { body: { success: true, jobs: [a, b] } };
        }
        if (pathname === '/api/mods/scene-illustration/jobs/scene-a' && method === 'DELETE') { await new Promise(resolve => { releaseDelete = resolve; }); phase = 'deleted'; return { body: { success: true } }; }
        return null;
    } });
    page.on('dialog', dialog => dialog.accept());
    await page.addScriptTag({ path: path.join(ROOT, 'mods/scene-illustration/public/js/scene-illustration.js') });
    await page.locator('#tab-scenes-gallery-tab').click(); const cards = page.locator('.gallery-card'); await expect(cards).toHaveCount(2);
    await cards.first().locator('.gallery-delete-btn').evaluate(button => button.click()); await expect.poll(() => typeof releaseDelete).toBe('function');
    phase = 'hold'; await page.locator('#refresh-gallery-btn').click(); await expect.poll(() => oldStarted).toBe(true);
    releaseDelete(); await expect.poll(() => freshStarted).toBe(true); await expect(cards).toHaveCount(1); await expect(cards.first()).toContainText('Second scene');
    releaseOld(); await page.waitForTimeout(100);
    await expect(cards).toHaveCount(1); await expect(cards.first()).toContainText('Second scene'); expect(errors).toEqual([]);
});

test('Story Tools tabs retain panels and lazily load or reactivate their owners', async ({ page }) => {
    const { errors, writes, apiState } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname }) => {
        if (pathname === '/api/scene-summaries') return { body: { success: true, sceneSummaries: [] } };
        if (pathname === '/api/mystery-threads') return { body: { success: true, threads: [] } };
        if (pathname === '/api/item-catalogue') return { body: { success: true, generation: 1, definitions: [], families: [], rarityDefinitions: [] } };
        return null;
    } });
    await page.evaluate(() => { window.fixtureCatalogueCalls = 0; const panel = window.itemCataloguePanel, original = panel.activate.bind(panel); panel.activate = (...args) => { window.fixtureCatalogueCalls++; return original(...args); }; window.activateTab('story-tools'); });
    await expect(page.locator('#storyToolsHistoryPanel')).toBeVisible();
    await expect(page.locator('#storyToolsCount')).toBeVisible();
    await page.locator('#storyToolsSceneSummariesTab').click();
    await expect(page.locator('#storyToolsSceneSummariesPanel')).toBeVisible();
    await expect.poll(() => apiState.requests.filter(request => request.pathname === '/api/scene-summaries').length).toBe(1);
    await page.locator('#storyToolsSceneSummariesTab').click();
    expect(apiState.requests.filter(request => request.pathname === '/api/scene-summaries')).toHaveLength(1);
    await page.locator('#storyToolsMysteryBoxesTab').click(); await expect(page.locator('#storyToolsMysteryBoxesPanel')).toBeVisible();
    await page.locator('#storyToolsItemCatalogueTab').click(); await expect(page.locator('#storyToolsItemCataloguePanel')).toBeVisible();
    await page.locator('#storyToolsItemCatalogueTab').click(); expect(await page.evaluate(() => window.fixtureCatalogueCalls)).toBe(2);
    await expect(page.locator('#storyToolsCount')).toBeHidden();
    await page.locator('#storyToolsHistoryTab').click(); await expect(page.locator('#storyToolsCount')).toBeVisible();
    expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test('live, history and insight plausibility share literal native disclosure content', async ({ page }) => {
    const { errors, writes } = await setup(page, { openPlayerChooser: false });
    const result = await page.evaluate(() => {
        const chat = window.AIRPG_CHAT;
        const payload = { structured: { type: 'possible', reason: 'A <literal> & reason' } };
        const live = chat.buildPlausibilityMessageElement({ data: payload, timestamp: null });
        const history = chat.createPlausibilityEntryElement({ plausibility: payload, timestamp: null });
        const insights = chat.prepareAttachmentInsights([{ type: 'plausibility', plausibility: payload }]);
        const skill = chat.buildSkillCheckMessageElement({ resolution: { skill: '<Stealth>', roll: { skillValue: 0 } }, timestamp: null });
        const attack = chat.buildAttackCheckMessageElement({ summary: { hit: false, attacker: { name: 'Fixture' } }, timestamp: null });
        const slop = chat.buildSlopRemovalMessageElement({ data: { slopWords: ['<repeated>'] }, timestamp: null });
        document.body.append(live, history, skill, attack, slop);
        return { live: live.querySelector('details > div').innerHTML, history: history.querySelector('details > div').innerHTML, insight: insights[0]?.html, count: document.querySelectorAll('.plausibility-message details').length };
    });
    expect(result.count).toBe(2); expect(result.history).toBe(result.live); expect(result.insight).toContain(result.live);
    expect(result.live).toContain('&lt;literal&gt;');
    const summary = page.locator('.plausibility-message summary').first(); await summary.focus(); await page.keyboard.press('Enter');
    await expect(summary.locator('..')).toHaveAttribute('open', '');
    await expect(page.locator('.skill-check-message details')).toHaveCount(1);
    await expect(page.locator('.attack-check-message details')).toHaveCount(1);
    await expect(page.locator('.slop-remover-message details')).toHaveCount(1);
    expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test('real Turn State Diff groups disposition changes in native disclosures', async ({ page }) => {
    const { errors, writes } = await setup(page, { openPlayerChooser: false });
    await page.evaluate(() => {
        const items = ['Trust', 'Respect'].map((label, index) => ({ icon: '🙂', category: 'disposition', text: `Bob ${label} +${index + 1}`, metadata: { dispositionChange: { npcId: 'npc-bob', npcName: 'Bob', typeLabel: label, icon: '🙂', delta: index + 1, text: `Bob ${label} +${index + 1}` } } }));
        const drawer = window.TurnStateDiffDrawer.createDrawer([{ type: 'event-summary', summaryItems: items }], { open: true });
        drawer.id = 'fixture-turn-drawer'; document.body.append(drawer);
    });
    const drawer = page.locator('#fixture-turn-drawer');
    await expect(drawer.locator('.turn-diff-drawer__disposition-row')).toHaveCount(1);
    const group = drawer.locator('details'); await expect(group).toHaveCount(1);
    await group.locator('summary').focus(); await page.keyboard.press('Enter'); await expect(group).toHaveAttribute('open', '');
    await expect(group).toContainText('Trust'); await expect(group).toContainText('Respect');
    expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test('Faction and Favorites lists retain selection, eligibility and release stale cards', async ({ page }) => {
    const factions = [{ id: 'f1', name: 'Harbor Guild', tags: ['trade'] }, { id: 'f2', name: 'Hill Order', tags: [] }];
    const locations = [{ id: 'home', name: 'Home', favorite: true, visited: true, regionName: 'Harbor' }, { id: 'far', name: 'Far Gate', favorite: true, visited: true, computedTravelTimeMinutes: 15 }, { id: 'stub', name: 'Unknown', favorite: true, visited: false, isStub: true }];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname, search }) => {
        if (pathname === '/api/factions') return { body: { success: true, factions, playerStandings: {} } };
        if (pathname === '/api/locations' && search.includes('scope=favorites')) return { body: { success: true, locations } };
        return null;
    } });
    await page.evaluate(() => window.refreshFactions());
    await page.locator('#tab-factions-tab').click();
    await expect(page.locator('#factionList .faction-list-item')).toHaveCount(2);
    await page.locator('#factionList .faction-list-item').last().click();
    await expect(page.locator('#factionList .faction-list-item').last()).toHaveClass(/active/);
    await page.locator('#factionList .faction-list-item').first().evaluate(button => { window.fixtureOldFaction = button; });
    await page.evaluate(() => window.refreshFactions()); await page.evaluate(() => window.fixtureOldFaction.click());
    await expect(page.locator('#factionList .faction-list-item').last()).toHaveClass(/active/);
    await page.evaluate(() => { window.lastRenderedLocation = { id: 'home' }; window.fixtureTravel = []; window.travelToAdjacentLocationFromMap = id => { window.fixtureTravel.push(id); }; });
    await page.locator('#tab-favorites-tab').click(); await page.evaluate(() => window.refreshFavoriteLocations());
    const cards = page.locator('#favoritesList .favorite-location-card'); await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Home' })).toBeDisabled(); await expect(cards.filter({ hasText: 'Far Gate' })).toContainText('15');
    await cards.filter({ hasText: 'Far Gate' }).evaluate(button => { window.fixtureOldFavorite = button; });
    await page.evaluate(() => window.refreshFavoriteLocations()); await page.evaluate(() => window.fixtureOldFavorite.click());
    expect(await page.evaluate(() => window.fixtureTravel)).toEqual([]);
    await page.locator('#favoritesList .favorite-location-card').filter({ hasText: 'Far Gate' }).click();
    expect(await page.evaluate(() => window.fixtureTravel)).toEqual(['far']); expect(errors).toEqual([]);
});

test('Story Tools history filters retained entries and disposes old edit actions', async ({ page }) => {
    const history = Array.from({ length: 251 }, (_, index) => ({ id: `entry-${index}`, role: 'assistant', type: 'assistant', content: index === 250 ? 'Red tower stands' : `Find the blue gate ${index}`, timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() }));
    const { errors, writes } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname }) => pathname === '/api/chat/history' ? { body: { success: true, history, count: history.length, worldTime: {} } } : null });
    await page.locator('#tab-story-tools-tab').click();
    const pages = page.locator('#storyToolsPageList .story-tools-page-button');
    await expect(pages).toHaveCount(2); await expect(pages).toHaveText(['1-250', '251-251']);
    await pages.first().click(); await expect(page.locator('.story-tools-entry')).toHaveCount(250);
    await page.locator('.story-tools-entry-edit').first().evaluate(button => { window.fixtureOldHistoryEdit = button; window.fixtureHistoryEdits = 0; window.AIRPG_CHAT.openEditModal = () => window.fixtureHistoryEdits++; });
    await pages.last().click(); await expect(page.locator('.story-tools-entry')).toHaveCount(1);
    await expect(page.locator('.story-tools-entry')).toContainText('Red tower');
    await pages.last().evaluate(button => { window.fixtureOldHistoryPage = button; });
    await page.locator('#storyToolsSearchInput').fill('tower');
    await expect(page.locator('.story-tools-entry')).toHaveCount(1);
    await expect(page.locator('.story-tools-entry')).toContainText('Red tower');
    await expect(pages).toHaveCount(1); await expect(pages.first()).toHaveText('1-1');
    await page.evaluate(() => { window.fixtureOldHistoryEdit.click(); window.fixtureOldHistoryPage.click(); });
    await expect(page.locator('.story-tools-entry')).toContainText('Red tower');
    expect(await page.evaluate(() => window.fixtureHistoryEdits)).toBe(0);
    expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test('Story Tools thread selection rejects stale box details and renders current mentions', async ({ page }) => {
    let releaseOld, oldStarted = false;
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: async ({ pathname }) => {
        if (pathname === '/api/mystery-threads') return { body: { success: true, mysteryThreads: [{ id: 'a', name: 'Alpha', status: 'active', boxCount: 1 }, { id: 'b', name: 'Beta', status: 'active', boxCount: 1 }] } };
        if (pathname.startsWith('/api/mystery-threads/')) { const id = pathname.split('/').at(-1); return { body: { success: true, mysteryThread: { id, name: id, status: 'active', summary: '', constraints: [], boxes: [{ id: `box-${id}`, name: `Box ${id}`, keys: [], mentionCount: 1 }] } } }; }
        if (pathname === '/api/mystery-boxes/box-a') { oldStarted = true; await new Promise(resolve => { releaseOld = resolve; }); return { body: { success: true, mysteryBox: { id: 'box-a', name: 'Stale box', keys: [], text: 'Stale', mentions: [] } } }; }
        if (pathname === '/api/mystery-boxes/box-b') return { body: { success: true, mysteryBox: { id: 'box-b', name: 'Current box', keys: [], text: 'Current', mentions: [{ name: 'Witness', context: '<literal> clue', createdAt: '2026-01-01T00:00:00Z' }] } } };
        return null;
    } });
    await page.locator('#tab-story-tools-tab').click(); await page.locator('#storyToolsMysteryBoxesTab').click();
    await expect.poll(() => oldStarted).toBe(true);
    await page.locator('[data-mystery-thread-id="b"]').click();
    await expect(page.locator('#mysteryBoxNameInput')).toHaveValue('Current box');
    await expect(page.locator('#mysteryBoxMentions .mystery-box-mention')).toContainText('<literal> clue');
    releaseOld(); await page.waitForTimeout(100);
    await expect(page.locator('#mysteryBoxNameInput')).toHaveValue('Current box');
    expect(errors).toEqual([]);
});

test('quest cards preserve ordering and release stale actions while exact requests remain owned', async ({ page }) => {
    const calls = [], releases = [];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: async ({ pathname, method }) => {
        if (method !== 'GET' && (pathname.startsWith('/api/quests/') || pathname.startsWith('/api/player/quests/'))) { calls.push(`${method} ${pathname}`); await new Promise(resolve => releases.push(resolve)); return { body: { success: true } }; }
        return null;
    } });
    page.on('dialog', dialog => dialog.accept());
    const active = [{ id: 'old', name: 'Old quest', lastUpdated: '2025-01-01', objectives: [] }, { id: 'new', name: 'New quest', lastUpdated: '2026-01-01', objectives: [] }];
    const completed = [{ id: 'done', name: 'Done quest', completed: true, rewardClaimed: false, objectives: [] }];
    await page.locator('#tab-quests-tab').click();
    await page.evaluate(({ active, completed }) => window.renderQuestPanel(active, completed), { active, completed });
    const cards = page.locator('.quest-card'); await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('New quest'); await expect(cards.nth(0)).toHaveAttribute('open', '');
    await expect(cards.nth(1)).not.toHaveAttribute('open', ''); await expect(cards.nth(2)).not.toHaveAttribute('open', '');
    await cards.first().locator('.quest-complete-button').evaluate(button => { window.fixtureOldQuestAction = button; });
    await page.evaluate(({ active, completed }) => window.renderQuestPanel(active, completed), { active, completed });
    await page.evaluate(() => window.fixtureOldQuestAction.click()); expect(calls).toEqual([]);
    await page.locator('.quest-card').filter({ hasText: 'New quest' }).locator('.quest-complete-button').click();
    await expect.poll(() => calls).toContain('POST /api/quests/new/complete');
    await page.evaluate(({ active, completed }) => window.renderQuestPanel(active, completed), { active, completed });
    const done = page.locator('.quest-card').filter({ hasText: 'Done quest' }); await done.locator('summary').click(); await done.locator('.quest-retry-rewards-button').click();
    await expect.poll(() => calls).toContain('POST /api/quests/done/retry-rewards');
    await page.evaluate(({ active, completed }) => window.renderQuestPanel(active, completed), { active, completed });
    await page.locator('.quest-card').filter({ hasText: 'New quest' }).locator('.quest-abandon-button').filter({ hasText: 'Abandon' }).click();
    await expect.poll(() => calls).toContain('DELETE /api/player/quests/new');
    expect(calls).toHaveLength(3); releases.forEach(resolve => resolve()); expect(errors).toEqual([]);
});

test('tracker hidden-only state and rerendered controls retain current player data', async ({ page }) => {
    const trackers = [{ id: 'hidden', name: 'Secret clock', value: '2/4', hiddenFromPlayer: true }];
    const { errors, apiState } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname }) => pathname === '/api/player' ? { body: { success: true, player: { ...player, trackers } } } : null });
    await page.waitForLoadState('networkidle');
    const state = await page.evaluate(({ data, trackers }) => {
        window.updateChatPlayerPanel({ ...data, trackers });
        const empty = document.querySelector('#chatTrackersEmpty').textContent;
        document.querySelector('#chatTrackersHiddenToggle').click();
        const card = document.querySelector('.chat-tracker-card'), text = card.textContent;
        const old = card.querySelector('.chat-tracker-card__edit');
        window.updateChatPlayerPanel({ ...data, trackers }); old.click();
        const staleOpened = !document.querySelector('#trackerEditModal').hidden;
        document.querySelector('.chat-tracker-card__edit').click();
        return { empty, text, staleOpened, currentOpened: !document.querySelector('#trackerEditModal').hidden };
    }, { data: player, trackers });
    expect(state).toMatchObject({ empty: 'Only hidden trackers are active.', staleOpened: false, currentOpened: true });
    expect(state.text).toContain('Secret clock'); expect(state.text).toContain('2/4');
    expect(apiState.requests.filter(request => request.method === 'DELETE')).toHaveLength(0); expect(errors).toEqual([]);
});

test('tracker disposal hides only its own tooltip including an interactive hover transfer', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    await page.waitForLoadState('networkidle');
    const result = await page.evaluate(data => {
        const trackers = [{ id: 'clock', name: 'Clock', value: '2/4', description: 'Tracker description' }];
        const update = () => window.updateChatPlayerPanel({ ...data, trackers });
        const trigger = () => document.querySelector('.chat-tracker-card');
        const tooltip = document.querySelector('#inventoryTooltip');
        const point = { clientX: 100, clientY: 100 };
        update(); trigger().dispatchEvent(new MouseEvent('mouseenter', point));
        const first = tooltip.classList.contains('visible');
        const other = document.createElement('button'); document.body.append(other);
        window.floatingTooltipController.show('Other focused tooltip', point, { owner: other, explicit: true });
        update(); const preserved = tooltip.classList.contains('visible') && tooltip.textContent.includes('Other focused tooltip');
        const card = trigger(); card.dispatchEvent(new MouseEvent('mouseenter', point));
        card.dispatchEvent(new MouseEvent('mouseleave', point)); tooltip.dispatchEvent(new MouseEvent('mouseenter', point));
        update(); const removed = !tooltip.classList.contains('visible');
        return { first, preserved, removed };
    }, player);
    expect(result).toEqual({ first: true, preserved: true, removed: true }); expect(errors).toEqual([]);
});

test('stationary ability hover survives repeated prompt progress updates', async ({ page }) => {
    await setup(page);
    const card = page.locator('.player-abilities-card').filter({ hasText: 'Arcane <Ward>' }).locator('.action-card-content');
    const tooltip = page.locator('#inventoryTooltip');
    await page.locator('#playerAbilitiesCloseBtn').focus();
    await card.hover();
    await expect(tooltip).toBeVisible();
    await page.evaluate(() => { window.__hoverSource = document.querySelector('.player-abilities-card .action-card-content'); });
    for (let i = 0; i < 5; i++) {
        await page.evaluate(index => window.AIRPG_CHAT.setPromptProgressDockState(['collapsed', 'one-line', 'table'][index % 3], { persist: false }), i);
        const scrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, body: document.querySelector('#playerAbilitiesModal .modal__body')?.scrollTop || 0 }));
        await page.evaluate(index => window.AIRPG_CHAT.handleWebSocketMessage({ data: JSON.stringify({
            type: 'prompt_progress', entries: [{ id: 'fixture-prompt', label: 'Generating', progressFraction: (index + 1) / 10, receivedCount: index * 100 }]
        }) }), i);
        await page.waitForTimeout(120);
        await expect(tooltip).toBeVisible();
        await page.evaluate(index => window.AIRPG_CHAT.handleWebSocketMessage({ data: JSON.stringify({
            type: 'chat_status', requestId: 'fixture-request', stage: 'generating', message: `Generating ${index}`
        }) }), i);
        await expect(tooltip).toContainText('Arcane <Ward>');
        await expect(tooltip).toBeVisible();
        expect(await page.evaluate(() => window.__hoverSource.isConnected)).toBe(true);
        expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, body: document.querySelector('#playerAbilitiesModal .modal__body')?.scrollTop || 0 }))).toEqual(scrollBefore);
    }
    await page.mouse.move(1, 1);
    await expect(tooltip).toBeHidden();
});

async function openPendingAbilitySelection(page, payload) {
    statesByPage.get(page).selection = payload;
    await page.evaluate(selection => window.requestPlayerAbilitySelectionFlow({ pendingPayload: selection, force: true }), payload);
    await expect(page.locator('#playerAbilitySelectionModal')).toBeVisible();
}

test('ability details appear on hover and focus while chooser actions remain usable', async ({ page }) => {
    const fixture = await setup(page);
    const chooser = page.locator('#playerAbilitiesModal');
    const card = chooser.locator('.player-abilities-card').filter({ hasText: 'Arcane <Ward>' });
    const choice = card.locator('.action-card-content');
    const tooltip = page.locator('#inventoryTooltip');
    await page.locator('#playerAbilitiesCloseBtn').focus();
    await choice.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Arcane <Ward>');
    await expect(tooltip).toContainText('ACTIVE');
    await expect(tooltip).toContainText('Level 3');
    await expect(tooltip).toContainText('Brief <summary>.');
    await expect(tooltip).toContainText('A full & detailed description with <b>literal markup</b>.');
    await expect(tooltip.locator('.tooltip-effect-card').filter({ hasText: 'Guard <&>' })).toContainText('Strength');
    await expect(tooltip).toContainText('+2 and +20%');
    await expect(tooltip).toContainText('Wardcraft Technique');
    await expect(tooltip.locator('b, summary')).toHaveCount(0);
    await page.screenshot({ path: path.join(ROOT, 'tmp', 'ability-tooltip-desktop.png') });
    await page.mouse.move(1, 1);
    await expect(tooltip).toBeHidden();
    await choice.focus();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('A full & detailed description');
    const input = page.locator('#messageInput');
    await input.fill('before after');
    await input.evaluate(element => element.setSelectionRange(7, 7));
    await choice.press('Enter');
    await expect(input).toHaveValue('before [Arcane <Ward>]after');
    await expect(chooser).toBeVisible();
    await expect(tooltip).toBeHidden();
    await expect(card.locator('.action-image-host')).toHaveCount(1);
    await choice.evaluate(element => { window.fixtureOldAbilityChoice = element; });
    await card.locator('summary[aria-label="Image options for Arcane <Ward>"]').click();
    await expect(card.getByRole('button', { name: 'Regenerate image' })).toBeVisible();
    await card.getByRole('button', { name: 'Edit image prompt…' }).evaluate(element => { window.fixtureOldImageEdit = element; });
    await expect(input).toHaveValue('before [Arcane <Ward>]after');
    await page.keyboard.press('Escape');
    await expect(chooser).toBeVisible();
    await choice.focus();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(chooser).toBeHidden();
    await expect(tooltip).toBeHidden();
    await page.evaluate(() => window.fixtureOldAbilityChoice.click());
    await page.evaluate(() => window.fixtureOldImageEdit.click());
    await expect(input).toHaveValue('before [Arcane <Ward>]after');
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
});

test('skill chooser shows current ranks and releases cards on redraw and close', async ({ page }) => {
    let skills = { Stealth: 2, Lore: 0 };
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname }) => pathname === '/api/player' || pathname === '/api/player/ability-selection' ? { body: { success: true, player: { ...player, skills }, abilitySelection: { pending: false, levelsMissing: [] } } } : null });
    await page.waitForLoadState('networkidle');
    await page.evaluate(data => { const actor = { ...data, skills: { Stealth: 2, Lore: 0 } }; window.updateChatPlayerPanel(actor); window.currentNpcData?.set(data.id, actor); }, player);
    await page.locator('#chatPlayerSkillsButton').click();
    const chooser = page.locator('#playerSkillsModal'); await expect(chooser).toBeVisible();
    const cards = chooser.locator('.player-skills-card');
    await expect(cards).toHaveCount(2); await expect(cards.first()).toContainText('Lore'); await expect(cards.first()).toContainText('0');
    await cards.first().evaluate(element => { window.fixtureOldSkill = element; });
    skills = { Stealth: 4 };
    await page.evaluate(data => window.updateChatPlayerPanel({ ...data, skills: { Stealth: 4 } }), player);
    await expect(cards).toHaveCount(1); await expect(cards.first()).toContainText('4');
    const input = page.locator('#messageInput'); await input.fill('before');
    await page.evaluate(() => window.fixtureOldSkill.click()); await expect(input).toHaveValue('before');
    await cards.first().press('Enter'); await expect(input).toHaveValue('before[Stealth]');
    await cards.first().evaluate(element => { window.fixtureClosedSkill = element; });
    await page.keyboard.press('Escape'); await expect(chooser).toBeHidden();
    await page.evaluate(() => window.fixtureClosedSkill.click()); await expect(input).toHaveValue('before[Stealth]');
    expect(errors).toEqual([]);
});

test('pending action image prompt cannot open an editor after final pagehide', async ({ page }) => {
    let release, started = false;
    const { errors } = await setup(page, { apiHandler: async ({ pathname, method }) => {
        if (pathname === '/api/images/prompt' && method === 'POST') { started = true; await new Promise(resolve => { release = resolve; }); return { body: { success: true, prompt: 'Fixture prompt' } }; }
        return null;
    } });
    const card = page.locator('.player-abilities-card').filter({ hasText: 'Arcane <Ward>' });
    await card.locator('summary').click(); await card.getByRole('button', { name: 'Edit image prompt…' }).click();
    await expect.poll(() => started).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    release();
    await page.waitForTimeout(100);
    await expect.poll(() => page.evaluate(() => document.querySelector('#entityImagePromptModal')?.hidden)).not.toBe(false);
    expect(errors).toEqual([]);
});

test('pending action image prompt survives a card rebuild without duplicate requests', async ({ page }) => {
    let release, requests = 0;
    const { errors } = await setup(page, { apiHandler: async ({ pathname, method }) => {
        if (pathname === '/api/images/prompt' && method === 'POST') { requests++; await new Promise(resolve => { release = resolve; }); return { body: { success: true, prompt: 'Retained fixture prompt' } }; }
        return null;
    } });
    const card = page.locator('.player-abilities-card').filter({ hasText: 'Arcane <Ward>' });
    await card.locator('summary').click(); await card.getByRole('button', { name: 'Edit image prompt…' }).click();
    await expect.poll(() => requests).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.evaluate(data => window.updateChatPlayerPanel(data), player);
    release();
    await expect(page.locator('#entityImagePromptModal')).toBeVisible();
    await expect(page.locator('#entityImagePromptTextarea')).toHaveValue('Retained fixture prompt');
    expect(requests).toBe(1); expect(errors).toEqual([]);
});

test('pending ability chooser survives cached hide but ignores final unload', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    let release, requests = 0;
    await page.route('**/api/player', async route => {
        requests++; await new Promise(resolve => { release = resolve; });
        await route.fulfill({ json: { success: true, player } }).catch(() => {});
    });
    await page.locator('#chatPlayerAbilitiesButton').click(); await expect.poll(() => requests).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    release(); await expect(page.locator('#playerAbilitiesModal')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('#playerAbilitiesModal')).toBeHidden();
    await page.locator('#chatPlayerAbilitiesButton').click(); await expect.poll(() => requests).toBe(2);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    release(); await page.waitForTimeout(100);
    await expect(page.locator('#playerAbilitiesModal')).toBeHidden();
    expect(errors).toEqual([]);
});

test('focused ability tooltip fits a narrow viewport and closes with the chooser', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await setup(page);
    const choice = page.locator('#playerAbilitiesModal .action-card-content').filter({ hasText: 'Arcane <Ward>' });
    await page.locator('#playerAbilitiesCloseBtn').focus();
    await choice.focus();
    const tooltip = page.locator('#inventoryTooltip');
    await expect(tooltip).toBeVisible();
    const box = await tooltip.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: path.join(ROOT, 'tmp', 'ability-tooltip-mobile.png') });
    await page.locator('#playerAbilitiesCloseBtn').click();
    await expect(tooltip).toBeHidden();
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
});

test('level-up ability choices show full tooltips without breaking selection, decline, or modal lifecycle', async ({ page }) => {
    const fixture = await setup(page, { openPlayerChooser: false });
    const payload = {
        pending: true,
        levelsMissing: [3],
        selection: {
            level: 3,
            requiredSelections: 1,
            optionsPerLevel: 2,
            preselectedAbilityNames: [],
            options: [
                {
                    id: 'preview-ward', imageId: 'saved-ward-image', imagePrompt: 'Saved ward prompt',
                    name: 'Ward <of &>',
                    type: 'Active',
                    level: 3,
                    shortDescription: 'A brief <summary> & note.',
                    description: 'Full & detailed text with <b>literal markup</b>.',
                    attachmentDraft: { statusEffects: [{
                        name: 'Guard <&>',
                        description: 'A status detail that must appear in the full tooltip.',
                        duration: -1,
                        attributes: [{ attribute: 'Strength', modifier: 2, percentModifier: 20 }],
                        techniqueEntries: [{ candidate: { name: 'Wardcraft Technique' } }]
                    }] }
                },
                {
                    id: 'preview-focus', name: 'Steady Focus',
                    type: 'Passive',
                    level: 3,
                    shortDescription: 'A second option.',
                    description: 'A second full description.'
                }
            ]
        }
    };
    fixture.apiState.selection = payload;
    await page.evaluate(selection => window.requestPlayerAbilitySelectionFlow({ pendingPayload: selection, force: true }), payload);

    const modal = page.locator('#playerAbilitySelectionModal');
    await expect(modal).toBeVisible();
    const card = modal.locator('.player-ability-selection-card').filter({ hasText: 'Ward <of &>' });
    const select = card.locator('.player-ability-selection-card-select');
    const decline = card.locator('.player-ability-selection-decline-toggle');
    const tooltip = page.locator('#inventoryTooltip');

    const imageHost = card.locator('.action-image-host');
    await expect(imageHost).toHaveAttribute('data-image-lazy', 'true');
    await expect(imageHost).toHaveAttribute('data-image-entity-id', 'fixture-player:preview-ward');
    const imageOptions = await imageHost.evaluate(host => ({ ...host.__actionImage.options }));
    expect(imageOptions.imageId).toBe('saved-ward-image');
    expect(imageOptions.imagePrompt).toBe('Saved ward prompt');
    await expect(card.locator('button button')).toHaveCount(0);
    await card.locator('summary[aria-label="Image options for Ward <of &>"]').click();
    await expect(card.getByRole('button', { name: 'Regenerate image' })).toBeVisible();
    await expect(select).toHaveAttribute('aria-pressed', 'false');
    await expect(decline).toHaveAttribute('aria-pressed', 'false');
    await card.locator('summary[aria-label="Image options for Ward <of &>"]').click();

    await select.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Ward <of &>');
    await expect(tooltip).toContainText('ACTIVE');
    await expect(tooltip).toContainText('Level 3');
    await expect(tooltip).toContainText('A brief <summary> & note.');
    await expect(tooltip).toContainText('Full & detailed text with <b>literal markup</b>.');
    await expect(tooltip.locator('.tooltip-effect-card').filter({ hasText: 'Guard <&>' })).toContainText('Strength');
    await expect(tooltip).toContainText('+2 and +20%');
    await expect(tooltip).toContainText('Wardcraft Technique');
    await expect(tooltip.locator('b, summary')).toHaveCount(0);

    await page.mouse.move(1, 1);
    await expect(tooltip).toBeHidden();
    await select.focus();
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('.tooltip-effect-card').filter({ hasText: 'Guard <&>' })).toContainText('Strength');
    await expect(tooltip).toContainText('+2 and +20%');

    await page.evaluate(async selection => {
        await window.requestPlayerAbilitySelectionFlow({ pendingPayload: selection, force: true });
    }, payload);
    await expect(tooltip).toBeHidden();
    await expect(modal).toBeVisible();

    const rerenderedCard = modal.locator('.player-ability-selection-card').filter({ hasText: 'Ward <of &>' });
    const rerenderedSelect = rerenderedCard.locator('.player-ability-selection-card-select');
    const rerenderedDecline = rerenderedCard.locator('.player-ability-selection-decline-toggle');
    await rerenderedSelect.click();
    await expect(rerenderedSelect).toHaveAttribute('aria-pressed', 'true');
    await rerenderedDecline.click();
    await expect(rerenderedDecline).toHaveAttribute('aria-pressed', 'true');
    await expect(rerenderedSelect).toHaveAttribute('aria-pressed', 'false');

    await rerenderedSelect.focus();
    await expect(tooltip).toBeVisible();
    fixture.apiState.selection = { pending: false, levelsMissing: [] };
    await page.evaluate(() => window.requestPlayerAbilitySelectionFlow({ force: true }));
    await expect(modal).toBeHidden();
    await expect(tooltip).toBeHidden();
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
});

test('failed ability submit keeps the draft for retry and deduplicates the matching global prompt event', async ({ page }) => {
    const failure = {
        id: 'ability-submit-prompt-failure',
        metadataLabel: 'player_ability_options',
        message: 'Ability selection could not continue after option generation failed.'
    };
    let attempt = 0;
    const fixture = await setup(page, {
        openPlayerChooser: false,
        apiHandler: ({ pathname }) => {
            if (pathname !== '/api/player/ability-selection/submit') return null;
            attempt += 1;
            if (attempt === 1) {
                return { status: 400, body: {
                    success: false, error: failure.message, code: 'ABILITY_SELECTION_FAILED',
                    stack: 'Synthetic ability submit stack', promptFailure: failure
                } };
            }
            if (attempt === 2) {
                return { status: 500, body: {
                    success: false, error: 'Temporary ability-selection service failure.',
                    code: 'ABILITY_SELECTION_UNAVAILABLE',
                    stack: 'Temporary ability-selection service failure.\n    at submitPlayerAbilitySelection (fixture.js:20:5)'
                } };
            }
            fixture.apiState.selection = pendingAbilityPayload(2);
            return { body: {
                success: true,
                pending: true,
                abilitySelection: pendingAbilityPayload(2),
                gameIntroGenerated: false
            } };
        }
    });
    await openPendingAbilitySelection(page, pendingAbilityPayload(1));
    const modal = page.locator('#playerAbilitySelectionModal');
    const card = modal.locator('.player-ability-selection-card').filter({ hasText: 'Level 1 Ward' });
    const select = card.locator('.player-ability-selection-card-select');
    const decline = modal.locator('.player-ability-selection-card').filter({ hasText: 'Level 1 Focus' }).locator('.player-ability-selection-decline-toggle');
    await select.click();
    await decline.click();
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    await expect(decline).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#playerAbilitySelectionSubmitBtn').click();
    const viewer = page.locator('.prompt-failure-viewer[data-failure-id="ability-submit-prompt-failure"]');
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText(failure.message);
    await page.evaluate(envelope => window.AIRPG_PROMPT_WINDOWS.showFailure(envelope), failure);
    await expect(page.locator('.prompt-failure-viewer')).toHaveCount(1);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(modal).toBeVisible();
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    await expect(decline).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#playerAbilitySelectionSubmitBtn').click();
    const errorDialog = page.locator('dialog.page-feedback-dialog[open]');
    await expect(errorDialog).toBeVisible();
    await expect(errorDialog).toContainText('Temporary ability-selection service failure.');
    await expect(modal).toBeVisible();
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    await expect(decline).toHaveAttribute('aria-pressed', 'true');
    await errorDialog.getByRole('button', { name: 'Close' }).click();
    await expect(errorDialog).toHaveCount(0);

    await page.locator('#playerAbilitySelectionSubmitBtn').click();
    await expect(page.locator('#playerAbilitySelectionTitle')).toHaveText('Choose Abilities for Level 2');
    await expect(modal).toBeVisible();
    expect(attempt).toBe(3);
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});

test('next-level option generation failure opens shared error UI and can recover without stale cards', async ({ page }) => {
    const failure = {
        id: 'ability-next-level-generation-failure',
        metadataLabel: 'player_ability_options',
        message: 'Failed to generate options for the next ability level.'
    };
    let generationFailed = true;
    const fixture = await setup(page, {
        openPlayerChooser: false,
        apiHandler: ({ pathname, search }) => {
            if (pathname !== '/api/player/ability-selection') return null;
            if (search.includes('generateOptions=1')) {
                return generationFailed
                    ? { status: 500, body: { success: false, error: failure.message, code: 'ABILITY_OPTIONS_FAILED', stack: 'Synthetic generation stack', promptFailure: failure } }
                    : { body: { success: true, pending: true, abilitySelection: pendingAbilityPayload(1), player } };
            }
            return { body: { success: true, player, pending: true, abilitySelection: pendingAbilityPayload(1, { optionsReady: false }) } };
        }
    });
    const incomplete = pendingAbilityPayload(1, { optionsReady: false });
    await page.evaluate(async selection => {
        await window.requestPlayerAbilitySelectionFlow({ pendingPayload: selection, force: true }).catch(() => {});
    }, incomplete);

    const viewer = page.locator('.prompt-failure-viewer[data-failure-id="ability-next-level-generation-failure"]');
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText(failure.message);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('#playerAbilitySelectionModal')).toBeVisible();
    await expect(page.locator('#playerAbilitySelectionCards .player-ability-selection-card')).toHaveCount(0);

    generationFailed = false;
    await openPendingAbilitySelection(page, incomplete);
    const modal = page.locator('#playerAbilitySelectionModal');
    await expect(modal.locator('.player-ability-selection-card')).toHaveCount(2);
    await expect(page.locator('.prompt-failure-viewer')).toHaveCount(1);
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});

test('deferred opening-scene failure appears after committed choices without retrying the submission', async ({ page }) => {
    const failure = {
        id: 'deferred-opening-scene-failure',
        metadataLabel: 'game_intro',
        message: 'Opening scene generation failed after saving abilities.'
    };
    let submitCount = 0;
    const fixture = await setup(page, {
        openPlayerChooser: false,
        apiHandler: ({ pathname }) => {
            if (pathname === '/api/player/ability-selection/submit') {
                submitCount += 1;
                return { body: {
                    success: true,
                    pending: false,
                    abilitySelection: { pending: false, levelsMissing: [] },
                    gameIntroGenerated: false,
                    gameIntroError: {
                        message: failure.message,
                        code: 'GAME_INTRO_FAILED',
                        stack: `${failure.message}\n    at runGameIntroPrompt (fixture.js:44:7)`,
                        promptFailure: failure
                    }
                } };
            }
            if (pathname === '/api/player/ability-selection') {
                return { body: { success: true, player, pending: submitCount === 0, abilitySelection: submitCount === 0 ? pendingAbilityPayload(3) : { pending: false, levelsMissing: [] } } };
            }
            return null;
        }
    });
    await openPendingAbilitySelection(page, pendingAbilityPayload(3));
    const modal = page.locator('#playerAbilitySelectionModal');
    await modal.locator('.player-ability-selection-card-select').first().click();
    await page.locator('#playerAbilitySelectionSubmitBtn').click();

    const viewer = page.locator('.prompt-failure-viewer[data-failure-id="deferred-opening-scene-failure"]');
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText(failure.message);
    await expect(modal).toBeHidden();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.evaluate(envelope => window.AIRPG_PROMPT_WINDOWS.showFailure(envelope), failure);
    await expect(page.locator('.prompt-failure-viewer')).toHaveCount(1);
    expect(submitCount).toBe(1);
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});

test('stale unloaded-game chooser closes and explains that a save must be loaded', async ({ page }) => {
    const fixture = await setup(page, {
        openPlayerChooser: false,
        apiHandler: ({ pathname }) => pathname === '/api/player/ability-selection/submit'
            ? { status: 409, body: {
                success: false,
                error: 'No game is loaded. Load your saved game before submitting ability choices.',
                code: 'GAME_NOT_LOADED',
                stack: 'No game is loaded. Load your saved game before submitting ability choices.\n    at submitPlayerAbilitySelection (fixture.js:30:5)'
            } }
            : null
    });
    await openPendingAbilitySelection(page, pendingAbilityPayload(1));
    const modal = page.locator('#playerAbilitySelectionModal');
    await modal.locator('.player-ability-selection-card-select').first().click();
    await page.locator('#playerAbilitySelectionSubmitBtn').click();

    await expect(modal).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__AIRPG_GAME_LOADED__)).toBe(false);
    const errorDialog = page.locator('dialog.page-feedback-dialog[open]');
    await expect(errorDialog).toBeVisible();
    await expect(errorDialog).toContainText('Load your saved game before submitting ability choices.');
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});


test('level-up icons and controls fit a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await setup(page, { openPlayerChooser: false });
    await openPendingAbilitySelection(page, pendingAbilityPayload(1));
    const card = page.locator('#playerAbilitySelectionModal .player-ability-selection-card').first();
    const bounds = await card.evaluate(element => {
        const cardRect = element.getBoundingClientRect();
        const iconRect = element.querySelector('.action-image').getBoundingClientRect();
        const selectRect = element.querySelector('.player-ability-selection-card-select').getBoundingClientRect();
        const declineRect = element.querySelector('.player-ability-selection-decline-toggle').getBoundingClientRect();
        return { left: cardRect.left, right: cardRect.right, iconRight: iconRect.right, selectRight: selectRect.right, declineRight: declineRect.right, scroll: document.documentElement.scrollWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(390);
    expect(bounds.iconRight).toBeLessThanOrEqual(bounds.right);
    expect(bounds.selectRight).toBeLessThanOrEqual(bounds.right);
    expect(bounds.declineRight).toBeLessThanOrEqual(bounds.right);
    expect(bounds.scroll).toBeLessThanOrEqual(390);
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});

test('last-row image menu remains reachable on a narrow scrollable selection', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    const fixture = await setup(page, { openPlayerChooser: false });
    const options = Array.from({ length: 8 }, (_, index) => ({ id: `option-${index}`, name: `Option ${index}`, type: 'Passive', level: 1, description: 'Fixture ability.' }));
    await openPendingAbilitySelection(page, pendingAbilityPayload(1, { options }));
    const card = page.locator('#playerAbilitySelectionModal .player-ability-selection-card').last();
    const menu = card.locator('summary[aria-label="Image options for Option 7"]');
    await menu.scrollIntoViewIfNeeded();
    await menu.click();
    const lastAction = card.getByRole('button', { name: 'Edit image prompt…' });
    await lastAction.scrollIntoViewIfNeeded();
    await expect(lastAction).toBeVisible();
    const visible = await lastAction.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, hit: element.contains(document.elementFromPoint(x, y)) };
    });
    expect(visible.top).toBeGreaterThanOrEqual(0);
    expect(visible.bottom).toBeLessThanOrEqual(600);
    expect(visible.left).toBeGreaterThanOrEqual(0);
    expect(visible.right).toBeLessThanOrEqual(390);
    expect(visible.hit).toBe(true);
    await page.screenshot({ path: path.join(ROOT, 'tmp', 'ability-selection-bottom-menu.png') });
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});


test('pending ability status hydrates the player before drawing icons and retains controls', async ({ page }) => {
    let releasePlayer;
    const waitForPlayer = new Promise(resolve => { releasePlayer = resolve; });
    const fixture = await setup(page, {
        openPlayerChooser: false,
        seedPlayer: false,
        apiHandler: async ({ pathname }) => {
            if (pathname !== '/api/player/ability-selection') return null;
            await waitForPlayer;
            return { body: { success: true, player, abilitySelection: pendingAbilityPayload(3) } };
        }
    });
    await page.evaluate(() => { window.currentPlayerData = null; });
    fixture.apiState.requests.length = 0;
    const payload = pendingAbilityPayload(3);
    await page.evaluate(selection => window.handlePendingAbilitySelectionPayload(selection), payload);
    await expect.poll(() => fixture.apiState.requests.filter(request => request.pathname === '/api/player/ability-selection').length, { timeout: 5000 }).toBeGreaterThan(0);
    await expect(page.locator('dialog.page-feedback-dialog[open]')).toHaveCount(0);
    releasePlayer();
    const modal = page.locator('#playerAbilitySelectionModal');
    await expect(modal).toBeVisible();
    const first = modal.locator('.player-ability-selection-card').filter({ hasText: 'Level 3 Ward' });
    const select = first.locator('.player-ability-selection-card-select');
    const decline = first.locator('.player-ability-selection-decline-toggle');
    await expect(first.locator('.action-image-host')).toHaveAttribute('data-image-entity-id', 'fixture-player:ward-3');
    await select.focus();
    await expect(page.locator('#inventoryTooltip')).toBeVisible();
    await expect(page.locator('#inventoryTooltip')).toContainText('Full ability description.');
    await select.click();
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    await decline.click();
    await expect(select).toHaveAttribute('aria-pressed', 'false');
    await expect(decline).toHaveAttribute('aria-pressed', 'true');
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});

test('late player hydration cannot replace a newer actor ability selection', async ({ page }) => {
    let releasePlayer;
    const gate = new Promise(resolve => { releasePlayer = resolve; });
    const replacement = { ...player, id: 'new-world-player', name: 'New World Player' };
    let newerWorld = false;
    const fixture = await setup(page, {
        openPlayerChooser: false,
        seedPlayer: false,
        apiHandler: async ({ pathname, search }) => {
            if (pathname === '/api/techniques') return { body: { actorId: new URLSearchParams(search).get('actor'), actorName: newerWorld ? replacement.name : player.name, disciplines: [], techniques: [], targets: [], catalog: [{ id: 'ward', name: 'Wardcraft Technique' }] } };
            if (pathname !== '/api/player/ability-selection') return null;
            if (newerWorld) return { body: { success: true, player: replacement, abilitySelection: pendingAbilityPayload(2) } };
            await gate;
            return { body: { success: true, player, abilitySelection: pendingAbilityPayload(3) } };
        }
    });
    await page.evaluate(() => { window.currentPlayerData = null; });
    fixture.apiState.requests.length = 0;
    await page.evaluate(selection => window.handlePendingAbilitySelectionPayload(selection), pendingAbilityPayload(3));
    await expect.poll(() => fixture.apiState.requests.filter(request => request.pathname === '/api/player/ability-selection').length, { timeout: 5000 }).toBeGreaterThan(0);
    newerWorld = true;
    await page.evaluate(async ({ actor, selection }) => {
        window.updateChatPlayerPanel(actor);
        await window.requestPlayerAbilitySelectionFlow({ pendingPayload: selection, force: true });
    }, { actor: replacement, selection: pendingAbilityPayload(2) });
    const modal = page.locator('#playerAbilitySelectionModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.player-ability-selection-card').filter({ hasText: 'Level 2 Ward' }).locator('.action-image-host')).toHaveAttribute('data-image-entity-id', 'new-world-player:ward-2');
    const oldResponse = page.waitForResponse(response => new globalThis.URL(response.url()).pathname === '/api/player/ability-selection');
    releasePlayer();
    await (await oldResponse).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect.poll(() => page.evaluate(() => window.currentPlayerData?.id)).toBe('new-world-player');
    await expect(modal.locator('.player-ability-selection-card').filter({ hasText: 'Level 2 Ward' }).locator('.action-image-host')).toHaveAttribute('data-image-entity-id', 'new-world-player:ward-2');
    await expect(page.locator('dialog.page-feedback-dialog[open]')).toHaveCount(0);
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});

test('pending ability hydration is discarded when the game unloads before the response', async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const fixture = await setup(page, {
        openPlayerChooser: false,
        seedPlayer: false,
        apiHandler: async ({ pathname }) => {
            if (pathname !== '/api/player/ability-selection') return null;
            await gate;
            return { body: { success: true, player, abilitySelection: pendingAbilityPayload(3) } };
        }
    });
    await page.evaluate(() => { window.currentPlayerData = null; });
    fixture.apiState.requests.length = 0;
    await page.evaluate(selection => window.handlePendingAbilitySelectionPayload(selection), pendingAbilityPayload(3));
    await expect.poll(() => fixture.apiState.requests.filter(request => request.pathname === '/api/player/ability-selection').length, { timeout: 5000 }).toBeGreaterThan(0);
    await page.evaluate(() => window.setAirpgGameLoaded(false));
    const response = page.waitForResponse(item => new globalThis.URL(item.url()).pathname === '/api/player/ability-selection');
    release();
    await (await response).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('#playerAbilitySelectionModal')).toBeHidden();
    await expect(page.locator('dialog.page-feedback-dialog[open]')).toHaveCount(0);
    expect(await page.evaluate(() => window.currentPlayerData?.id || null)).toBeNull();
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});

test('player and NPC ability/status grants display escaped canonical technique names without fetching on hover', async ({ page }) => {
    const legacyId = 'technique_3619c6cc-12b7-43b1-8367-c577aa80680a';
    const catalog = [{ id: 'technique_1', name: 'Ward <&> Strike' }, { id: legacyId, name: 'Piston </script> Kick' }];
    let selectedPlayer = player;
    const fixture = await setup(page, {
        openPlayerChooser: false,
        apiHandler: ({ pathname, search }) => {
            if (pathname === '/api/player') return { body: { success: true, player: selectedPlayer } };
            if (pathname !== '/api/techniques') return null;
            const actorId = new URLSearchParams(search).get('actor') || player.id;
            return { body: { actorId, actorName: 'Fixture', disciplines: [], techniques: [], targets: [], catalog } };
        }
    });
    const grants = [{ techniqueId: 'technique_1', definitionRevision: 1 }, { techniqueId: legacyId, definitionRevision: 1 }];
    const grantStatus = { id: 'status-fixture', name: 'Gifted', description: 'Grants actions.', duration: -1, techniqueGrants: grants };
    const actor = { ...player, abilities: [{ ...player.abilities[0], statusEffects: [grantStatus] }], statusEffects: [grantStatus], attributeInfo: {} };
    selectedPlayer = actor;
    await page.evaluate(data => window.updateChatPlayerPanel(data), actor);
    await page.locator('#chatPlayerAbilitiesButton').evaluate(button => button.click());
    const chooser = page.locator('#playerAbilitiesModal');
    await expect(chooser).toBeVisible();
    const card = chooser.locator('.player-abilities-card').filter({ hasText: 'Arcane <Ward>' });
    await expect(card).toContainText('Ward <&> Strike');
    await expect(card).toContainText('Piston </script> Kick');
    await page.waitForLoadState('networkidle');
    const beforeHover = fixture.apiState.requests.filter(item => item.pathname === '/api/techniques').length;
    await card.locator('.action-card-content').hover();
    const tooltip = page.locator('#inventoryTooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Ward <&> Strike');
    await expect(tooltip).toContainText('Piston </script> Kick');
    await expect(tooltip.locator('.tooltip-effect-card').filter({ hasText: 'Gifted' })).toContainText('Ward <&> Strike');
    await expect(tooltip.locator('kick, strike')).toHaveCount(0);
    const thingTooltip = await page.evaluate(status => {
        const host = document.createElement('div');
        host.innerHTML = formatThingTooltip({ name: 'Grant Item', description: 'A fixture item.', thingType: 'item', causeStatusEffectOnTarget: status });
        return { text: host.textContent, scripts: host.querySelectorAll('script').length, cards: host.querySelectorAll('.tooltip-effect-card').length };
    }, grantStatus);
    expect(thingTooltip.text).toContain('Ward <&> Strike');
    expect(thingTooltip.text).toContain('Piston </script> Kick');
    expect(thingTooltip.scripts).toBe(0);
    expect(thingTooltip.cards).toBe(1);
    expect(fixture.apiState.requests.filter(item => item.pathname === '/api/techniques').length).toBe(beforeHover);
    await page.locator('#playerAbilitiesCloseBtn').click();
    catalog.push({ id: 'technique_2', name: 'New <Guard>' });
    const npcStatus = { ...grantStatus, techniqueGrants: [...grants, { techniqueId: 'technique_2', definitionRevision: 1 }] };
    const npc = { ...actor, id: 'fixture-npc', name: 'Fixture NPC', isNPC: true, statusEffects: [npcStatus] };
    await page.evaluate(data => window.showNpcViewModal(data), npc);
    const modal = page.locator('#npcViewModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#npcViewAbilities')).toContainText('Piston </script> Kick');
    await expect(modal.locator('#npcViewStatuses')).toContainText('Ward <&> Strike');
    await expect(modal.locator('#npcViewStatuses')).toContainText('New <Guard>');
    await expect(modal.locator('#npcViewStatuses kick, #npcViewStatuses strike')).toHaveCount(0);
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});

test('location NPC tooltip waits for a missing technique catalogue name and rejects unknown grants', async ({ page }) => {
    let releaseCatalogue;
    let releaseUnknownCatalogue;
    const catalogue = new Promise(resolve => { releaseCatalogue = resolve; });
    const unknownCatalogue = new Promise(resolve => { releaseUnknownCatalogue = resolve; });
    let npcCatalogueRequests = 0;
    const fixture = await setup(page, {
        openPlayerChooser: false,
        seedPlayer: false,
        apiHandler: ({ pathname, search }) => {
            if (pathname === '/api/images/location-variant/request') return { body: { success: true, skipped: true, reason: 'fixture' } };
            if (pathname !== '/api/techniques') return null;
            const actorId = new URLSearchParams(search).get('actor');
            if (actorId === 'new-npc') {
                npcCatalogueRequests++;
                return npcCatalogueRequests === 1
                    ? catalogue.then(body => ({ body }))
                    : unknownCatalogue.then(body => ({ body }));
            }
            return { body: { actorId, actorName: 'Fixture', disciplines: [], techniques: [], targets: [], catalog: [] } };
        }
    });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('techniques:catalogue', { detail: { catalog: [] } })));

    const npc = {
        id: 'new-npc', name: 'Freshly Generated Scout', isNPC: true, level: 1,
        statusEffects: [{ id: 'fresh-grant', name: 'New Technique Gift', duration: -1, techniqueGrants: [{ techniqueId: 'technique_fresh_grant' }] }],
        needBars: []
    };
    await page.evaluate(actor => {
        window.__locationUpdateDone = false;
        window.__locationUpdate = window.updateLocationDisplay({ id: 'fresh-location', name: 'Fresh Location', npcs: [actor], things: [], exits: {} })
            .then(() => { window.__locationUpdateDone = true; });
    }, npc);
    await expect.poll(() => npcCatalogueRequests).toBe(1);
    expect(await page.evaluate(() => window.__locationUpdateDone)).toBe(false);
    releaseCatalogue({ actorId: 'new-npc', actorName: npc.name, disciplines: [], techniques: [], targets: [], catalog: [{ id: 'technique_fresh_grant', name: 'Newly Catalogued <Strike>' }] });
    await page.evaluate(() => window.__locationUpdate);

    const tooltip = page.locator('#inventoryTooltip');
    await page.locator('#locationNPCs .location-entity-card').first().hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Newly Catalogued <Strike>');
    await expect(tooltip.locator('strike')).toHaveCount(0);
    expect(fixture.errors).toEqual([]);

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('techniques:catalogue', { detail: { catalog: [] } })));
    const unknownNpc = {
        ...npc,
        statusEffects: [{ id: 'unknown-grant', name: 'Unresolved Gift', duration: -1, techniqueGrants: [{ techniqueId: 'technique_genuinely_unknown' }] }]
    };
    await page.evaluate(actor => {
        window.__unknownLocationUpdate = window.updateLocationDisplay({ id: 'unknown-location', name: 'Unknown Location', npcs: [actor], things: [], exits: {} })
            .then(() => null, error => error.message);
    }, unknownNpc);
    await expect.poll(() => npcCatalogueRequests).toBe(2);
    releaseUnknownCatalogue({ actorId: 'new-npc', actorName: npc.name, disciplines: [], techniques: [], targets: [], catalog: [] });
    await expect.poll(() => page.evaluate(() => window.__unknownLocationUpdate)).toBe('Technique grant references unknown catalogue identity technique_genuinely_unknown.');
    await expect(page.locator('dialog.page-feedback-dialog[open]')).toBeVisible();
    await expect(page.locator('dialog.page-feedback-dialog[open]')).toContainText('Technique grant references unknown catalogue identity technique_genuinely_unknown');
    await expect(page.locator('#locationNPCs')).not.toContainText('technique_genuinely_unknown');
    await page.keyboard.press('Escape');
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});

test('rich NPC effect cards show descriptions and stat rows at desktop and phone widths', async ({ page }) => {
    const fixture = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname }) => pathname === '/api/images/location-variant/request' ? { body: { success: true, skipped: true, reason: 'fixture' } } : null });
    const npc = {
        id: 'effect-npc', name: 'GraveWatcher7', description: 'Fixture.', isNPC: true, level: 1, class: 'Scout', race: 'Ghoul Girl',
        statusEffects: [
            { name: 'Cryptic Gaze', description: 'Passively reveals traps and stealthed foes.', duration: -1, skills: [{ skill: 'Perception', modifier: 2 }] },
            { name: 'Necrotic Touch', description: 'A touch carries a mild decay effect.', duration: -1 },
            { name: 'Shadow Blended', description: 'The Ghoul Girl has blended into shadows.', duration: -1, skills: [{ skill: 'Stealth', modifier: 3 }] },
            { name: 'Finite <effect>', description: 'A temporary effect & consequence. '.repeat(12), duration: 65, attributes: [{ attribute: 'Strength', modifier: -2, percentModifier: 10 }], maxHealthPercent: -5, needBars: [{ name: 'Hunger', delta: -1 }] }
        ], needBars: []
    };
    await page.evaluate(async actor => window.updateLocationDisplay({ id: 'effect-location', name: 'Fixture Location', description: 'Fixture.', npcs: [actor], things: [], exits: {} }), npc);
    const card = page.locator('#locationNPCs .location-entity-card').first();
    const tooltip = page.locator('#inventoryTooltip');
    for (const [label, width, height] of [['desktop', 1024, 768], ['phone', 375, 812]]) {
        await page.setViewportSize({ width, height });
        if (label === 'phone') {
            await page.getByRole('tab', { name: /^NPCs/ }).click();
            await page.waitForFunction(() => Date.now() >= touchTooltipSuppressUntil);
        }
        const cardBounds = await card.boundingBox();
        expect(cardBounds).not.toBeNull();
        await page.mouse.move(cardBounds.x + 10, cardBounds.y + 10);
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toContainText('Cryptic Gaze');
        await expect(tooltip).toContainText('Passively reveals traps and stealthed foes.');
        await expect(tooltip).toContainText('Necrotic Touch');
        await expect(tooltip).toContainText('A touch carries a mild decay effect.');
        await expect(tooltip).toContainText('Shadow Blended');
        await expect(tooltip).toContainText('Perception');
        await expect(tooltip).toContainText('+2');
        await expect(tooltip).toContainText('Stealth');
        await expect(tooltip).toContainText('+3');
        await expect(tooltip).toContainText('Finite <effect>');
        await expect(tooltip).toContainText('1 hour, 5 minutes');
        await expect(tooltip).toContainText('-2');
        await expect(tooltip).toContainText('+10%');
        await expect(tooltip).toContainText('-5%');
        await expect(tooltip).toContainText('Hunger');
        const gaze = tooltip.locator('.tooltip-effect-card').filter({ hasText: 'Cryptic Gaze' });
        const necrotic = tooltip.locator('.tooltip-effect-card').filter({ hasText: 'Necrotic Touch' });
        const shadow = tooltip.locator('.tooltip-effect-card').filter({ hasText: 'Shadow Blended' });
        await expect(gaze.locator('table')).toHaveCount(1);
        await expect(shadow.locator('table')).toHaveCount(1);
        await expect(necrotic.locator('table')).toHaveCount(0);
        await expect(gaze.locator('thead th')).toHaveText(['Stat', 'Change']);
        await expect(tooltip.locator('effect')).toHaveCount(0);
        const bounds = await tooltip.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
        await page.screenshot({ path: path.join(ROOT, 'tmp', `active-effect-${label}.png`) });
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 10);
        await expect(tooltip).toBeVisible();
        const overflow = await tooltip.evaluate(element => element.scrollHeight > element.clientHeight);
        if (label === 'phone') expect(overflow).toBe(true);
        if (overflow) {
            await page.mouse.wheel(0, 2000);
            await expect.poll(() => tooltip.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        }
        const visibleLast = await tooltip.locator('.tooltip-effect-card').filter({ hasText: 'Finite <effect>' }).evaluate(element => {
            const card = element.getBoundingClientRect(), scroll = element.closest('#inventoryTooltip').getBoundingClientRect();
            return card.bottom <= scroll.bottom && card.top < scroll.bottom;
        });
        expect(visibleLast).toBe(true);
        await page.mouse.move(1, 1);
        await expect(tooltip).toBeHidden();
    }
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});

test('closing the ability chooser dismisses its tooltip while the pointer is over it', async ({ page }) => {
    const fixture = await setup(page);
    const choice = page.locator('#playerAbilitiesModal .action-card-content').filter({ hasText: 'Arcane <Ward>' });
    const tooltip = page.locator('#inventoryTooltip');
    await choice.hover();
    await expect(tooltip).toBeVisible();
    const bounds = await tooltip.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 8);
    await expect(tooltip).toBeVisible();
    await page.locator('#playerAbilitiesCloseBtn').evaluate(button => button.click());
    await expect(page.locator('#playerAbilitiesModal')).toBeHidden();
    await expect(tooltip).toBeHidden();
    expect(fixture.errors).toEqual([]);
    expect(fixture.writes).toEqual([]);
});

test('party tooltip shows member details and dismisses when its panel scrolls', async ({ page }) => {
    const { errors, writes } = await setup(page, { openPlayerChooser: false });
    await page.locator('#tab-party-tab').click();
    await page.evaluate(() => window.updatePartyDisplay([{ id: 'party-fixture', name: 'Fixture Companion', description: 'A patient guide.', isNPC: true, health: 12, maxHealth: 20, needBars: [] }]));
    const card = page.locator('#partyMembers .party-card');
    await expect(card).toHaveCount(1);
    await card.hover();
    const tooltip = page.locator('#partyTooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Fixture Companion');
    await expect(tooltip).toContainText('A patient guide.');
    await page.locator('.party-panel').dispatchEvent('scroll');
    await expect(tooltip).toBeHidden();
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
});

test('NPC memory and goal editors preserve reordered text in isolated saves', async ({ page }) => {
    const saves = [];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (method === 'PUT' && ['/api/npcs/fixture-npc/memories', '/api/npcs/fixture-npc/goals'].includes(pathname)) {
            saves.push({ pathname, body: request.postDataJSON() });
            return { body: { success: true } };
        }
        return null;
    } });
    await page.evaluate(() => window.showNpcMemoriesModal({ id: 'fixture-npc', name: 'Companion', importantMemories: ['First memory', 'Second memory'] }));
    const memories = page.locator('#npcMemoriesList');
    await expect(memories.locator('textarea')).toHaveCount(2);
    await memories.locator('[data-repeater-handle]').nth(1).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await page.locator('#npcMemoriesSaveBtn').click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].body).toEqual({ memories: ['Second memory', 'First memory'] });
    await page.evaluate(() => window.showNpcGoalsModal({ id: 'fixture-npc', name: 'Companion', personality: { goals: ['First goal', 'Second goal'] } }));
    const goals = page.locator('#npcGoalsList');
    await expect(goals.locator('textarea')).toHaveCount(2);
    await goals.locator('[data-repeater-action="remove"]').first().click();
    await page.locator('#npcGoalsSaveBtn').click();
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1].body).toEqual({ goals: ['Second goal'] });
    expect(errors).toEqual([]);
});

test('NPC needs slider and number stay synchronized and save the changed value', async ({ page }) => {
    const saves = [];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname === '/api/npcs/fixture-npc/needs') {
            if (method === 'PUT') saves.push(request.postDataJSON());
            return { body: { success: true, npc: { id: 'fixture-npc', name: 'Companion' }, needs: [{ id: 'energy', name: 'Energy', min: 0, max: 100, value: method === 'PUT' ? 37 : 70 }] } };
        }
        return null;
    } });
    await page.evaluate(() => window.showNpcNeedsModal({ id: 'fixture-npc', name: 'Companion', isNPC: true }));
    const slider = page.locator('#npcNeedsList input[type="range"]');
    const number = page.locator('#npcNeedsList input[type="number"]');
    await expect(number).toHaveValue('70');
    await number.fill('37');
    await expect(slider).toHaveValue('37');
    await expect(page.locator('#npcNeedsSaveBtn')).toBeEnabled();
    await page.locator('#npcNeedsSaveBtn').click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual({ needs: [{ id: 'energy', value: 37 }] });
    expect(errors).toEqual([]);
});

test('NPC status edits retain hidden metadata, unknown modifiers, and explicit zero values', async ({ page }) => {
    const saves = [];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname === '/api/npcs/fixture-status' && method === 'PUT') {
            saves.push(request.postDataJSON());
            return { body: { success: true, npc: { id: 'fixture-status', name: 'Fixture NPC' } } };
        }
        return null;
    } });
    await page.evaluate(() => window.showNpcEditModal({ id: 'fixture-status', name: 'Fixture NPC', isNPC: true, level: 1, intrinsicStatusEffects: [{ id: 'status-keep', name: 'Ward', description: 'Original', duration: 0, maxHealthPercent: 0, appliedAt: 123, customMarker: 'retained', techniqueGrants: [{ techniqueId: 'ward' }], attributes: [{ attribute: 'missing_attribute', modifier: 0, percentModifier: 0 }] }] }));
    const row = page.locator('#npcEditStatusEffectsList .thing-edit-status-row');
    await expect(row).toHaveCount(1);
    await row.locator('.thing-edit-status-description').fill('Changed');
    await expect(row.locator('.thing-modifier-select option:checked')).toContainText(/unavailable/i);
    await expect(row.locator('.thing-modifier-value')).toHaveValue('0');
    await expect(row.locator('.thing-modifier-percent')).toHaveValue('0');
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        const overflow = await row.locator('.thing-modifier-field').evaluateAll(fields => fields.filter(field => field.scrollWidth > field.clientWidth + 1).map(field => field.textContent.trim()));
        expect(overflow).toEqual([]);
        await page.screenshot({ path: `tmp/npc-status-${width}.png` });
    }
    await page.locator('#npcEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].statusEffects[0]).toMatchObject({ id: 'status-keep', name: 'Ward', description: 'Changed', duration: 0, maxHealthPercent: 0, appliedAt: 123, customMarker: 'retained', techniqueGrants: [{ techniqueId: 'ward' }], attributes: [{ attribute: 'missing_attribute', modifier: 0, percentModifier: 0 }] });
    expect(errors).toEqual([]);
});

test('Location status editor excludes need modifiers and retains saved effect metadata', async ({ page }) => {
    const saves = [];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname === '/api/exits/options') return { body: { success: true, regions: [{ id: 'region-fixture', name: 'Fixture Region', locations: [] }] } };
        if (pathname === '/api/locations/fixture-location' && method === 'PUT') {
            saves.push(request.postDataJSON());
            return { body: { success: true, location: { id: 'fixture-location', name: 'Fixture Location', baseLevel: 1 } } };
        }
        return null;
    } });
    await page.evaluate(() => window.updateLocationDisplay({ id: 'fixture-location', name: 'Fixture Location', regionId: 'region-fixture', baseLevel: 1, dangerLevel: 1, statusEffects: [{ id: 'location-effect', name: 'Hidden name', description: 'Original', duration: 0, maxHealthPercent: 0, appliedAt: 123, customMarker: 'retained' }], npcs: [], things: [], exits: {} }));
    await page.locator('#locationImageMenuButton').click();
    await page.locator('#locationImageEditButton').click();
    const row = page.locator('#locationEditStatusEffectsList .thing-edit-status-row');
    await expect(row).toHaveCount(1);
    await row.locator('.thing-edit-status-description').fill('Changed');
    await row.getByRole('button', { name: /add modifier/i }).click();
    expect((await row.locator('.thing-modifier-select option').allTextContents()).join(' ')).not.toMatch(/need/i);
    await row.locator('.thing-modifier-row').last().getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('#locationEditRegion')).toBeEnabled();
    await page.locator('#locationEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].statusEffects[0]).toMatchObject({ id: 'location-effect', name: 'Hidden name', description: 'Changed', duration: 0, maxHealthPercent: 0, appliedAt: 123, customMarker: 'retained' });
    expect(errors).toEqual([]);
});

test('item effect edits preserve equipper duration and hidden metadata', async ({ page }) => {
    const saves = [];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname === '/api/things/fixture-item' && method === 'PUT') {
            saves.push(request.postDataJSON());
            return { body: { success: true, thing: { id: 'fixture-item', name: 'Fixture Item' } } };
        }
        return null;
    } });
    await page.evaluate(() => window.showThingEditModal({ id: 'fixture-item', name: 'Fixture Item', itemOrScenery: 'item', level: 1, slot: 'weapon', causeStatusEffectOnEquipper: { id: 'item-effect', name: 'Ward', description: 'Original', duration: 42, maxHealthPercent: 0, appliedAt: 123, customMarker: 'retained' } }));
    await expect(page.locator('#thingEditModal')).toBeVisible();
    await page.locator('#thingEditCauseStatusEffectEquipperDescription').evaluate(input => { input.value = 'Changed'; });
    await page.locator('#thingEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].causeStatusEffectOnEquipper).toMatchObject({ id: 'item-effect', name: 'Ward', description: 'Changed', duration: 42, maxHealthPercent: 0, appliedAt: 123, customMarker: 'retained' });
    expect(errors).toEqual([]);
});

test('Play calendar retains nested season drafts through tab changes and reorder', async ({ page }) => {
    const saves = [];
    const calendar = { yearName: 'Fixture Era', months: [{ name: 'Dawn', lengthDays: 30, seasonName: 'Spring' }], weekdays: ['Firstday'], seasons: [
        { name: 'Spring', startMonth: 'Dawn', startDay: 1, description: 'First season', timeDescriptions: [{ timeOfDay: 6, description: 'Morning light' }] },
        { name: 'Summer', startMonth: 'Dawn', startDay: 2, description: 'Second season', timeDescriptions: [{ timeOfDay: 18, description: 'Evening light' }] }
    ], holidays: [] };
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname === '/api/calendar') {
            if (method === 'PUT') { saves.push(request.postDataJSON()); return { body: { success: true, calendarDefinition: request.postDataJSON().calendarDefinition } }; }
            return { body: { success: true, calendarDefinition: calendar } };
        }
        return null;
    } });
    await page.evaluate(() => window.updateLocationDisplay({ id: 'fixture-location', name: 'Fixture Location', baseLevel: 1, npcs: [], things: [], exits: {} }));
    await page.locator('#locationImageMenuButton').click(); await page.locator('#locationCalendarEditButton').click();
    await expect(page.locator('#calendarEditYearName')).toHaveValue('Fixture Era');
    await page.locator('#calendarEditTabSeasons').click();
    const panels = page.locator('#calendarEditSeasonPanels .calendar-edit-season-panel');
    await expect(panels).toHaveCount(2);
    await panels.nth(0).locator('.calendar-edit-time-description').fill('Edited morning');
    await page.locator('#calendarEditSeasonTabs button').nth(1).click();
    await panels.nth(1).locator('.calendar-edit-season-description').fill('Edited summer');
    await panels.nth(1).getByRole('button', { name: 'Move Up' }).first().click();
    await page.locator('#calendarEditSaveBtn').click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].calendarDefinition.seasons).toMatchObject([
        { name: 'Summer', description: 'Edited summer', timeDescriptions: [{ timeOfDay: 18, description: 'Evening light' }] },
        { name: 'Spring', description: 'First season', timeDescriptions: [{ timeOfDay: 6, description: 'Edited morning' }] }
    ]);
    expect(errors).toEqual([]);
});

test('shared NPC backdrop remains until both memory and goal dialogs close', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    await page.evaluate(async () => {
        const npc = { id: 'fixture-npc', name: 'Companion', importantMemories: ['Memory'], goals: ['Goal'] };
        await window.showNpcMemoriesModal(npc);
        await window.showNpcGoalsModal(npc);
    });
    const backdrop = page.locator('#npcModalBackdrop');
    await expect(page.locator('#npcMemoriesModal')).toBeVisible(); await expect(page.locator('#npcGoalsModal')).toBeVisible();
    await expect(backdrop).not.toHaveAttribute('hidden', '');
    await page.locator('#npcMemoriesCloseBtn').evaluate(button => button.click());
    await expect(page.locator('#npcMemoriesModal')).toBeHidden(); await expect(page.locator('#npcGoalsModal')).toBeVisible();
    await expect(backdrop).not.toHaveAttribute('hidden', ''); await expect(page.locator('body')).toHaveClass(/modal-open/);
    await page.locator('#npcGoalsCloseBtn').click();
    await expect(backdrop).toHaveAttribute('hidden', ''); await expect(page.locator('body')).not.toHaveClass(/modal-open/);
    expect(errors).toEqual([]);
});

test('Play character editor preserves player status metadata and zero modifiers on save', async ({ page }) => {
    const effect = { id: 'player-status', name: 'Hidden ward', description: 'Original', duration: 0, maxHealthPercent: 0, appliedAt: 5, customMarker: 'retained', attributes: [{ attribute: 'strength', modifier: 0, percentModifier: 0 }] };
    const playerData = { id: 'fixture-player', name: 'Fixture Hero', level: 1, health: 10, maxHealth: 20, attributes: { strength: 10 }, skills: {}, abilities: [], statusEffects: [effect] };
    const saves = [];
    const { errors } = await setup(page, { openPlayerChooser: false, seedPlayer: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname === '/api/player' && method === 'GET') return { body: { success: true, player: playerData } };
        if (pathname === '/api/player/update-stats' && method === 'POST') { saves.push(request.postDataJSON()); return { body: { success: true, player: playerData } }; }
        return null;
    } });
    await page.locator('#tab-character-tab').click();
    const row = page.locator('#playerStatusEffectsList .thing-edit-status-row');
    await expect(row).toHaveCount(1);
    await row.locator('.thing-edit-status-description').fill('Edited');
    await page.locator('#player-stats-form').evaluate(form => form.requestSubmit());
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].statusEffects[0]).toMatchObject({ ...effect, description: 'Edited' });
    expect(errors).toEqual([]);
});

test('NPC and map context menu actions retain their selected targets', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname }) => {
        if (pathname === '/api/locations/remote-location') return { body: { success: true, location: { id: 'remote-location', name: 'Remote Ruins', baseLevel: 2, dangerLevel: 1, statusEffects: [], exits: {} } } };
        if (pathname === '/api/exits/options') return { body: { success: true, regions: [] } };
        return null;
    } });
    await page.evaluate(() => {
        const card = document.createElement('div'); card.id = 'npc-context-fixture'; document.querySelector('#tab-adventure').append(card);
        window.registerNpcContextMenu(card, { id: 'npc-context', name: 'Context Companion', isNPC: true, importantMemories: ['Kept memory'] });
    });
    const card = page.locator('#npc-context-fixture');
    await card.locator('.npc-card-menu-button').click();
    await page.locator('.npc-card-menu').getByRole('button', { name: 'Memories' }).click();
    await expect(page.locator('#npcMemoriesModalTitle')).toContainText('Context Companion');
    await expect(page.locator('#npcMemoriesList textarea')).toHaveValue('Kept memory');
    await page.locator('#npcMemoriesCloseBtn').click();
    await page.evaluate(() => window.openLocationContextMenuForLocationId('remote-location', { useFloatingMenu: true, anchorPoint: { x: 250, y: 200 } }));
    await page.locator('#mapLocationMenuEditButton').click();
    await expect(page.locator('#locationEditName')).toHaveValue('Remote Ruins');
    expect(errors).toEqual([]);
});

test('Play calendar keeps minimum season and light rows and preserves nested ordering', async ({ page }) => {
    const saves = [];
    const calendar = { yearName: 'Era', months: [{ name: 'Dawn', lengthDays: 30 }], weekdays: ['Firstday'], seasons: [], holidays: [] };
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname === '/api/calendar') {
            if (method === 'PUT') { saves.push(request.postDataJSON()); return { body: { success: true, calendarDefinition: request.postDataJSON().calendarDefinition } }; }
            return { body: { success: true, calendarDefinition: calendar } };
        }
        return null;
    } });
    await page.evaluate(() => window.updateLocationDisplay({ id: 'fixture-location', name: 'Fixture Location', baseLevel: 1, npcs: [], things: [], exits: {} }));
    await page.locator('#locationImageMenuButton').click(); await page.locator('#locationCalendarEditButton').click();
    await page.locator('#calendarEditTabSeasons').click();
    const season = page.locator('#calendarEditSeasonPanels .calendar-edit-season-panel');
    await expect(season).toHaveCount(1);
    await expect(season.locator('.calendar-edit-time-row')).toHaveCount(1);
    await season.locator('.calendar-edit-time-row').getByRole('button', { name: 'Remove Time' }).click();
    await expect(season.locator('.calendar-edit-time-row')).toHaveCount(0);
    await season.getByRole('button', { name: 'Remove Season' }).click();
    await expect(page.locator('#calendarEditSeasonPanels .calendar-edit-season-panel')).toHaveCount(1);
    await expect(season.locator('.calendar-edit-time-row')).toHaveCount(1);
    await season.locator('.calendar-edit-season-name').fill('Spring');
    await season.locator('.calendar-edit-time-of-day').first().fill('6');
    await season.locator('.calendar-edit-time-description').first().fill('Dawn');
    await season.locator('.calendar-edit-time-add').click();
    await season.locator('.calendar-edit-time-of-day').last().fill('18');
    await season.locator('.calendar-edit-time-description').last().fill('Dusk');
    await season.locator('.calendar-edit-time-row').last().getByRole('button', { name: 'Move Up' }).click();
    await page.locator('#calendarEditSaveBtn').click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].calendarDefinition.seasons[0].timeDescriptions).toEqual([{ timeOfDay: 18, description: 'Dusk' }, { timeOfDay: 6, description: 'Dawn' }]);
    expect(errors).toEqual([]);
});

test('location item sort and view popovers own Escape and preserve selected view', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    await page.evaluate(() => window.updateLocationDisplay({ id: 'fixture-location', name: 'Fixture Location', baseLevel: 1, npcs: [], exits: {}, things: [{ id: 'item-a', name: 'Apple', thingType: 'item' }], thingIds: ['item-a'] }));
    const sort = page.locator('#locationItemsSort'), sortTrigger = page.locator('#locationItemsSortToggle');
    await sortTrigger.click(); await expect(sort).toBeVisible();
    await page.keyboard.press('Escape'); await expect(sort).toBeHidden(); await expect(sortTrigger).toBeFocused();
    const view = page.locator('#locationItemsView'), viewTrigger = page.locator('#locationItemsViewToggle');
    await viewTrigger.click(); await expect(view).toBeVisible();
    await view.locator('[data-view-mode="grid"]').click();
    await expect(view).toBeHidden();
    await viewTrigger.click();
    await expect(view.locator('[data-view-mode="grid"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#locationName').click(); await expect(view).toBeHidden();
    expect(errors).toEqual([]);
});

test('map edge popup keeps its no-Escape policy and is released on map reload', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname }) => {
        if (pathname === '/api/map/region') return { body: { success: true, region: { regionId: 'fixture-region', regionName: 'Fixture Region', currentLocationId: 'a', locations: [
            { id: 'a', name: 'A', exits: [{ id: 'exit-a-b', destination: 'b' }] }, { id: 'b', name: 'B', exits: [] }
        ] } } };
        return null;
    } });
    await page.locator('#tab-map-tab').click();
    await page.evaluate(() => window.loadRegionMap('fixture-region'));
    await expect.poll(() => page.evaluate(() => typeof cyInstance !== 'undefined' && cyInstance && cyInstance.edges().length)).toBe(1);
    await page.evaluate(() => cyInstance.edges().first().emit({ type: 'cxttap', renderedPosition: { x: 100, y: 100 } }));
    const popup = page.locator('.map-edge-menu');
    await expect(popup).toBeVisible(); await expect(popup).toContainText('Delete exit');
    await page.keyboard.press('Escape'); await expect(popup).toBeVisible();
    await page.evaluate(() => window.loadRegionMap('fixture-region'));
    await expect(popup).toHaveCount(0);
    await page.evaluate(() => window.loadRegionMap('fixture-region'));
    const opened = await page.evaluate(() => {
        const container = document.querySelector('#mapContainer'), edge = cyInstance.edges().first();
        const a = edge.source().position(), b = edge.target().position(), pan = cyInstance.pan(), zoom = cyInstance.zoom(), rect = container.getBoundingClientRect();
        let count = 0;
        const append = document.body.appendChild;
        document.body.appendChild = function (node) { if (node.classList?.contains('map-edge-menu')) count += 1; return append.call(this, node); };
        try { container.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + (a.x + b.x) / 2 * zoom + pan.x, clientY: rect.top + (a.y + b.y) / 2 * zoom + pan.y })); }
        finally { document.body.appendChild = append; }
        return count;
    });
    expect(opened).toBe(1);
    await expect(popup).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('lightbox and native feedback own Escape above an underlying custom dialog', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    await page.evaluate(async () => {
        await window.showNpcMemoriesModal({ id: 'fixture-npc', name: 'Companion', importantMemories: ['Memory'] });
        window.lightboxController.show({ detailsHtml: '<p>Lightbox details</p>', trigger: document.querySelector('#npcMemoriesAddBtn') });
    });
    const memories = page.locator('#npcMemoriesModal'), lightbox = page.locator('#imageLightbox');
    await expect(memories).toBeVisible(); await expect(lightbox).toBeVisible();
    expect(await page.evaluate(() => { const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); document.querySelector('#imageLightbox').dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
    await page.evaluate(() => window.AIRPG_PAGE_FEEDBACK.showError(new Error('Nested feedback'), { returnFocus: document.querySelector('#imageLightboxClose') }));
    const feedback = page.locator('dialog.page-feedback-dialog');
    await expect(feedback).toBeVisible();
    await page.keyboard.press('Escape'); await expect(feedback).toHaveCount(0); await expect(lightbox).toBeVisible(); await expect(memories).toBeVisible();
    await page.keyboard.press('Escape'); await expect(lightbox).toBeHidden(); await expect(memories).toBeVisible();
    await expect(page.locator('#npcMemoriesAddBtn')).toBeFocused();
    expect(errors).toEqual([]);
});

test('late lightbox action completion does not close a newer view', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { errors } = await setup(page, { openPlayerChooser: false });
    await page.evaluate(() => {
        window.lightboxController.show({ detailsHtml: '<p>First view</p>', actions: [{ id: 'slow', label: 'Slow action', handler: () => new Promise(resolve => { window.releaseLightboxAction = resolve; }) }] });
    });
    const lightbox = page.locator('#imageLightbox');
    await lightbox.getByRole('button', { name: 'Slow action' }).click();
    await expect(lightbox.getByRole('button', { name: 'Slow action' })).toBeDisabled();
    await page.evaluate(() => window.lightboxController.show({ detailsHtml: '<p>Newer view</p>' }));
    await page.evaluate(() => window.releaseLightboxAction());
    await expect(lightbox).toBeVisible(); await expect(lightbox).toContainText('Newer view');
    await page.keyboard.press('x'); await expect(lightbox).toBeHidden();
    expect(errors).toEqual([]);
});

test('container allows distinct in-flight transfers and ignores late results after switching sessions', async ({ page }) => {
    const pending = [], writes = [];
    const item = id => ({ id, name: `Item ${id}`, thingType: 'item', count: 1 });
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: async ({ request, pathname, method }) => {
        if (pathname === '/api/things/box-a/container' && method === 'GET') return { body: { success: true, container: { id: 'box-a', name: 'Box A', isContainer: true }, contents: [], playerInventory: [item('one'), item('two')] } };
        if (pathname === '/api/things/box-b/container' && method === 'GET') return { body: { success: true, container: { id: 'box-b', name: 'Box B', isContainer: true }, contents: [item('new')], playerInventory: [] } };
        if (pathname === '/api/things/box-a/container/move-in' && method === 'POST') {
            writes.push(request.postDataJSON());
            await new Promise(resolve => pending.push(resolve));
            return { body: { success: true, container: { id: 'box-a', name: 'Box A', isContainer: true }, contents: [item('stale')], playerInventory: [] } };
        }
        return null;
    } });
    await page.evaluate(() => window.updateLocationDisplay({ id: 'fixture-location', name: 'Fixture Location', baseLevel: 1, npcs: [], exits: {}, things: [{ id: 'box-a', name: 'Box A', thingType: 'item', isContainer: true }, { id: 'box-b', name: 'Box B', thingType: 'item', isContainer: true }] }));
    const openBox = async id => {
        const card = page.locator(`#locationItems .thing-collection-entry[data-thing-id="${id}"]`);
        await card.locator('.thing-card-menu-button').click();
        await page.locator('.thing-card-menu-item:visible').filter({ hasText: 'Open Container' }).last().click();
    };
    await openBox('box-a');
    await page.locator('#containerPlayerInventoryGrid [data-thing-id="one"]').click({ modifiers: ['Shift'] });
    await page.locator('#containerPlayerInventoryGrid [data-thing-id="two"]').click({ modifiers: ['Shift'] });
    await expect.poll(() => writes.length).toBe(2);
    expect(writes.map(write => write.thingId).sort()).toEqual(['one', 'two']);
    await page.locator('#thingContainerCloseBtn').click();
    await openBox('box-b');
    await expect(page.locator('#thingContainerModal')).toContainText('Box B');
    let completed = 0;
    page.on('response', response => { if (response.url().endsWith('/box-a/container/move-in')) completed += 1; });
    pending.forEach(resolve => resolve());
    await expect.poll(() => completed).toBe(2);
    await expect(page.locator('#containerContentsGrid [data-thing-id="new"]')).toHaveCount(1);
    await expect(page.locator('#thingContainerModal')).toContainText('Box B');
    await expect(page.locator('#containerContentsGrid [data-thing-id="new"]')).toHaveCount(1);
    await expect(page.locator('#containerContentsGrid [data-thing-id="stale"]')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('popup inside a lightbox consumes Escape before the lightbox closes', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    await page.evaluate(() => {
        window.lightboxController.show({ detailsHtml: '<details id="lightbox-popup"><summary>Options</summary><button>Action</button></details>' });
        window.AIRPG_WIDGETS.PopupDismissal.bind(document.querySelector('#lightbox-popup'));
    });
    const lightbox = page.locator('#imageLightbox'), popup = page.locator('#lightbox-popup');
    await popup.evaluate(node => { node.open = true; }); await expect(popup).toHaveAttribute('open', '');
    await page.keyboard.press('Escape'); await expect(popup).not.toHaveAttribute('open', ''); await expect(lightbox).toBeVisible();
    await page.keyboard.press('Escape'); await expect(lightbox).toBeHidden();
    expect(errors).toEqual([]);
});

test('Thing and NPC extension fields preserve typed values and remount owned rows', async ({ page }) => {
    const saves = [];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (method === 'PUT' && ['/api/things/typed-item', '/api/npcs/typed-npc'].includes(pathname)) {
            saves.push({ pathname, payload: request.postDataJSON() });
            return { body: { success: true, thing: { id: 'typed-item', name: 'Typed Item' }, npc: { id: 'typed-npc', name: 'Typed NPC' } } };
        }
        return null;
    } });
    await page.evaluate(() => {
        const fields = [
            { fieldName: 'countMod', type: 'integer', defaultValue: 7 },
            { fieldName: 'flagMod', type: 'boolean', defaultValue: true },
            { fieldName: 'listMod', type: 'array', defaultValue: ['default'] },
            { fieldName: 'objectMod', type: 'object', defaultValue: { default: true } },
            { fieldName: 'blankMod', type: 'string', defaultValue: 'default' }
        ];
        window.AIRPG_CONFIG.thingEditFields = fields; window.AIRPG_CONFIG.playerEditFields = fields;
        window.showThingEditModal({ id: 'typed-item', name: 'Typed Item', itemOrScenery: 'item', level: 1, countMod: 0, metadata: { countMod: 9, flagMod: false, listMod: [], objectMod: {}, blankMod: null } });
    });
    await expect(page.locator('#thingEditModField_countMod')).toHaveValue('0');
    await expect(page.locator('#thingEditModField_flagMod')).not.toBeChecked();
    await expect(page.locator('#thingEditModField_listMod')).toHaveValue('[]');
    await expect(page.locator('#thingEditModField_objectMod')).toHaveValue('{}');
    await expect(page.locator('#thingEditModField_blankMod')).toHaveValue('');
    await page.locator('#thingEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].payload).toMatchObject({ countMod: 0, flagMod: false, listMod: [], objectMod: {}, blankMod: null });
    await page.evaluate(() => window.showThingEditModal({ id: 'typed-item', name: 'Typed Item', itemOrScenery: 'item', level: 1 }));
    await expect(page.locator('#thingEditModField_countMod')).toHaveValue('7');
    const metadataBefore = await page.locator('#thingEditMetadataList .thing-edit-metadata-row').count();
    await page.locator('#thingMetadataAddBtn').click();
    await expect(page.locator('#thingEditMetadataList .thing-edit-metadata-row')).toHaveCount(metadataBefore + 1);
    await page.locator('#thingEditMetadataList .thing-edit-metadata-row').last().getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('#thingEditMetadataList .thing-edit-metadata-row')).toHaveCount(metadataBefore);
    await page.locator('#thingEditCloseBtn').click();
    await page.evaluate(() => window.showNpcEditModal({ id: 'typed-npc', name: 'Typed NPC', isNPC: true, level: 1, countMod: 0, flagMod: false, listMod: [], objectMod: {}, blankMod: null }));
    await expect(page.locator('#npcEditModField_countMod')).toHaveValue('0');
    await page.locator('#npcEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1].payload).toMatchObject({ countMod: 0, flagMod: false, listMod: [], objectMod: {}, blankMod: null });
    await page.evaluate(() => window.showNpcEditModal({ id: 'typed-npc', name: 'Typed NPC', isNPC: true, level: 1 }));
    await expect(page.locator('#npcEditModField_countMod')).toHaveValue('7');
    const before = await page.locator('#npcEditAbilities .npc-ability-row').count();
    await page.locator('#npcAddAbilityBtn').click();
    await expect(page.locator('#npcEditAbilities .npc-ability-row')).toHaveCount(before + 1);
    await page.locator('#npcEditAbilities .npc-ability-row').last().getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('#npcEditAbilities .npc-ability-row')).toHaveCount(before);
    expect(errors).toEqual([]);
});

test('crafting and module workbench collections render their real inventory holders', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    await page.evaluate(async () => {
        const base = { id: 'base', name: 'Base item', thingType: 'item', moduleSlots: [{ type: 'scope' }] };
        const module = { id: 'scope', name: 'Scope module', thingType: 'item', moduleType: 'scope' };
        window.currentPlayerData = { ...window.currentPlayerData, id: 'fixture-player', inventory: [base, module] };
        window.currentNpcData.set('fixture-player', window.currentPlayerData);
        await openCraftingModal({ mode: 'craft' });
    });
    await expect(page.locator('#craftingInventoryGrid [data-thing-id="base"]')).toHaveCount(1);
    await expect(page.locator('#craftingInventoryGrid [data-thing-id="scope"]')).toHaveCount(1);
    await page.locator('#craftingModalCloseBtn').click();
    await page.evaluate(() => openModuleWorkbenchModal(window.currentPlayerData.inventory[0], { context: 'player-inventory' }));
    await expect(page.locator('#moduleWorkbenchInventoryGrid [data-thing-id="scope"]')).toHaveCount(1);
    await expect(page.locator('#moduleWorkbenchInventoryGrid [data-thing-id="base"]')).toHaveCount(0);
    await page.locator('#moduleWorkbenchCloseBtn').click();
    expect(errors).toEqual([]);
});

test('module context choices preserve exact IDs, compatibility and cancellation policy', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    const fixtures = { base: { id: 'base', name: 'Base', moduleSlots: [{ type: 'scope' }] }, one: { id: 'scope-a', name: 'Scope A', moduleType: 'scope' }, two: { id: 'scope-b', name: 'Scope B', moduleType: 'scope' }, wrong: { id: 'wrong', name: 'Wrong', moduleType: 'other' } };
    await page.evaluate(({ base, one, two, wrong }) => {
        window.fixtureModule = { base, one, two, wrong };
        window.currentPlayerData = { ...window.currentPlayerData, inventory: [base, one, two, wrong] };
        window.fixtureChoose = () => window.prepareModulesContextActionRequest({ fullId: 'modules:install-module' }, base, { context: 'player-inventory' }).then(value => { window.fixtureModuleResult = value; }, error => { window.fixtureModuleError = error.message; });
        window.fixtureChoose();
    }, fixtures);
    const modal = page.locator('.npc-selection-modal'); await expect(modal).toBeVisible();
    await expect(modal.locator('.npc-selection-item')).toHaveCount(2); await modal.getByRole('button', { name: 'Scope B' }).click();
    await expect.poll(() => page.evaluate(() => window.fixtureModuleResult)).toMatchObject({ baseItemId: 'base', moduleItemId: 'scope-b', baseItemSource: 'inventory', moduleItemSource: 'inventory', slotType: 'scope' });
    await page.evaluate(() => { window.fixtureModuleError = ''; window.fixtureChoose(); }); await expect(modal).toBeVisible(); await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.fixtureModuleError)).toBe('Choose a valid module item.');
    const branches = await page.evaluate(async () => {
        const { base, one, wrong } = window.fixtureModule;
        window.currentPlayerData.inventory = [base, one, wrong];
        const single = await window.prepareModulesContextActionRequest({ fullId: 'modules:install-module' }, base, { context: 'player-inventory' });
        window.currentPlayerData.inventory = [base, wrong];
        let empty; try { await window.prepareModulesContextActionRequest({ fullId: 'modules:install-module' }, base, { context: 'player-inventory' }); } catch (error) { empty = error.message; }
        return { single, empty };
    });
    expect(branches.single.moduleItemId).toBe('scope-a'); expect(branches.empty).toBe('No compatible module item found.');
    await page.evaluate(() => {
        const { base, one } = window.fixtureModule;
        const otherBase = { id: 'base-2', name: 'Second base', moduleSlots: [{ type: 'scope' }] };
        window.currentPlayerData.inventory = [base, otherBase, one];
        window.prepareModulesContextActionRequest({ fullId: 'modules:install-module' }, one, { context: 'player-inventory' }).then(value => { window.fixtureBaseChoice = value; });
    });
    await modal.getByRole('button', { name: 'Second base' }).click();
    await expect.poll(() => page.evaluate(() => window.fixtureBaseChoice)).toMatchObject({ baseItemId: 'base-2', moduleItemId: 'scope-a', slotType: 'scope' });
    await page.evaluate(() => {
        const { base, one, two } = window.fixtureModule; base.installedModuleIds = [one.id, two.id];
        window.currentPlayerData.inventory = [base, one, two];
        window.prepareModulesContextActionRequest({ fullId: 'modules:remove-module' }, base, { context: 'player-inventory' }).then(value => { window.fixtureRemoveChoice = value; });
    });
    await modal.getByRole('button', { name: 'Scope A' }).click();
    await expect.poll(() => page.evaluate(() => window.fixtureRemoveChoice)).toMatchObject({ baseItemId: 'base', moduleItemId: 'scope-a', baseItemSource: 'inventory', moduleItemSource: 'inventory' });
    expect(errors).toEqual([]);
});

test('workbench keeps fixed occupied slots and releases detached remove controls', async ({ page }) => {
    const { errors, apiState } = await setup(page, { openPlayerChooser: false });
    await page.evaluate(() => {
        const base = { id: 'base', name: 'Base', moduleSlots: [{ type: 'scope' }, { type: 'grip' }], installedModuleIds: ['scope'] };
        const scope = { id: 'scope', name: 'Installed scope', moduleType: 'scope', moduleInstalledOnItemId: 'base' };
        window.currentPlayerData = { ...window.currentPlayerData, inventory: [base, scope] };
        window.openModuleWorkbenchModal(base, { context: 'player-inventory' });
    });
    const slots = page.locator('#moduleWorkbenchSlots .module-workbench__slot'); await expect(slots).toHaveCount(2);
    await expect(slots.nth(0)).toHaveAttribute('data-slot-index', '0'); await expect(slots.nth(0)).toHaveAttribute('data-module-id', 'scope');
    await expect(slots.nth(1)).toHaveAttribute('data-slot-index', '1'); await expect(slots.nth(1)).toContainText('Empty');
    await slots.first().locator('.module-workbench__remove-button').evaluate(button => { window.fixtureOldModuleRemove = button; });
    await page.locator('#moduleWorkbenchCloseBtn').click();
    await page.evaluate(() => window.fixtureOldModuleRemove.click());
    expect(apiState.requests.filter(request => request.method !== 'GET')).toHaveLength(0); expect(errors).toEqual([]);
});

test('committed workbench install cannot overwrite a reopened session', async ({ page }) => {
    let release, requestBody;
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: async ({ pathname, method, request }) => {
        if (pathname === '/api/mod-thing-context-actions/modules%3Ainstall-module' || (pathname === '/api/mod-thing-context-actions/modules:install-module' && method === 'POST')) {
            requestBody = request.postDataJSON(); await new Promise(resolve => { release = resolve; }); return { body: { success: true } };
        }
        return null;
    } });
    await page.evaluate(() => {
        const a = { id: 'base-a', name: 'Base A', moduleSlots: [{ type: 'scope' }] }, b = { id: 'base-b', name: 'Base B', moduleSlots: [{ type: 'grip' }] }, module = { id: 'scope', name: 'Scope', moduleType: 'scope' };
        window.fixtureWorkbenchBases = [a, b]; window.currentPlayerData = { ...window.currentPlayerData, inventory: [a, b, module] };
        window.openModuleWorkbenchModal(a, { context: 'player-inventory' });
    });
    await page.locator('#moduleWorkbenchInventoryGrid [data-thing-id="scope"]').click();
    await expect.poll(() => Boolean(requestBody)).toBe(true);
    expect(requestBody).toMatchObject({ baseItemId: 'base-a', moduleItemId: 'scope', slotType: 'scope' });
    await page.locator('#moduleWorkbenchCloseBtn').click();
    await page.evaluate(() => window.openModuleWorkbenchModal(window.fixtureWorkbenchBases[1], { context: 'player-inventory' }));
    await expect(page.locator('#moduleWorkbenchTitle')).toContainText('Base B');
    const before = await page.locator('#moduleWorkbenchSlots').innerText(); release(); await page.waitForTimeout(100);
    await expect(page.locator('#moduleWorkbenchTitle')).toContainText('Base B');
    expect(await page.locator('#moduleWorkbenchSlots').innerText()).toBe(before);
    await expect(page.locator('#moduleWorkbenchStatus')).not.toContainText('Installed Scope');
    expect(errors).toEqual([]);
});

test('craft assignment works and late unequip cannot assign into a reopened session', async ({ page }) => {
    let release, unequip;
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: async ({ pathname, method, request }) => {
        if (pathname === '/api/npcs/fixture-player/equipment' && method === 'POST') { unequip = request.postDataJSON(); await new Promise(resolve => { release = resolve; }); return { body: { success: true } }; }
        return null;
    } });
    page.on('dialog', dialog => dialog.accept());
    await page.evaluate(async () => {
        const loose = { id: 'loose', name: 'Loose item', thingType: 'item' }, worn = { id: 'worn', name: 'Worn item', thingType: 'item', isEquipped: true }, light = { id: 'light', name: 'Light item', thingType: 'item' }, touch = { id: 'touch', name: 'Touch item', thingType: 'item' };
        window.fixtureCraftLight = light; window.currentPlayerData = { ...window.currentPlayerData, inventory: [loose, worn, light, touch] }; window.currentNpcData.set('fixture-player', window.currentPlayerData);
        await window.openCraftingModal({ mode: 'craft' });
    });
    await page.evaluate(() => window.assignItemToCraftingSlot(0, 'loose'));
    await expect(page.locator('#craftingSlots [data-slot-index="0"]')).toContainText('Loose item');
    await page.evaluate(async () => { window.fixtureOldCraftAction = window.createCraftingItemLightboxActions(window.fixtureCraftLight)[0]; await window.fixtureOldCraftAction.handler(); });
    await expect(page.locator('#craftingSlots [data-slot-index="1"]')).toContainText('Light item');
    await page.evaluate(() => { const event = new DragEvent('drop', { bubbles: true, dataTransfer: new DataTransfer() }); event.dataTransfer.setData('text/x-thing-id', 'worn'); document.querySelector('#craftingSlots [data-slot-index="2"]').dispatchEvent(event); });
    await expect.poll(() => Boolean(unequip)).toBe(true); expect(unequip).toMatchObject({ itemId: 'worn', action: 'unequip' });
    await page.locator('#craftingModalCloseBtn').click(); await page.evaluate(() => window.openCraftingModal({ mode: 'craft' }));
    await expect(page.locator('#craftingSlots [data-slot-index="2"]')).not.toContainText('Worn item');
    release(); await page.waitForTimeout(100);
    await expect(page.locator('#craftingSlots [data-slot-index="2"]')).not.toContainText('Worn item');
    expect(await page.evaluate(async () => { try { await window.fixtureOldCraftAction.handler(); return ''; } catch (error) { return error.message; } })).toMatch(/session has changed/i);
    const slot = page.locator('#craftingSlots [data-slot-index="0"]'); await slot.scrollIntoViewIfNeeded();
    const box = await slot.boundingBox();
    await page.evaluate(({ x, y }) => window.handleCraftingInventoryTouchDrop({ currentX: x, currentY: y, thing: { id: 'touch' } }), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await expect(slot).toContainText('Touch item');
    expect(errors).toEqual([]);
});

test('scene illustration binds replacement message images to the shared lightbox', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    await page.addScriptTag({ path: path.join(ROOT, 'mods/scene-illustration/public/js/scene-illustration.js') });
    await page.waitForFunction(() => window.AIRPG_CHAT._sceneIllustrationRenderingHooked === true);
    await page.evaluate(() => {
        const target = document.createElement('div'); target.id = 'scene-message-fixture'; document.body.append(target);
        window.AIRPG_CHAT.setMessageContent(target, '![First scene](/first-scene.png)');
    });
    const image = page.locator('#scene-message-fixture img');
    await expect(image).toHaveAttribute('data-lightbox-bound', 'true');
    await image.click();
    await expect(page.locator('#imageLightbox img')).toHaveAttribute('alt', 'First scene');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.AIRPG_CHAT.setMessageContent(document.querySelector('#scene-message-fixture'), '![Second scene](/second-scene.png)'));
    await expect(image).toHaveAttribute('data-lightbox-bound', 'true');
    await image.click();
    await expect(page.locator('#imageLightbox img')).toHaveAttribute('alt', 'Second scene');
    expect(errors).toEqual([]);
});

test('Thing and NPC row labels and controls fit at desktop and phone widths', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    async function assertGeometry(selector) {
        const problems = await page.locator(selector).evaluateAll(rows => rows.flatMap(row => {
            const bounds = row.getBoundingClientRect();
            const elements = [...row.querySelectorAll('label, input, select, textarea, button')].filter(el => el.getClientRects().length);
            const boxes = elements.map(el => ({ el, rect: el.getBoundingClientRect() }));
            const issues = [];
            for (const { el, rect } of boxes) {
                if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) issues.push(`${el.className || el.tagName} outside row`);
                if (el.tagName === 'LABEL') {
                    const input = el.htmlFor && row.querySelector(`#${CSS.escape(el.htmlFor)}`);
                    if (input && input.getClientRects().length && rect.bottom > input.getBoundingClientRect().top + 1) issues.push(`${el.textContent.trim()} label overlaps input`);
                }
            }
            for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i], b = boxes[j];
                if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
                if (Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 1 && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 1) issues.push(`${a.el.className || a.el.tagName} overlaps ${b.el.className || b.el.tagName}`);
            }
            return issues;
        }));
        expect(problems).toEqual([]);
    }
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(() => window.showThingEditModal({ id: 'geometry-item', name: 'Geometry item', itemOrScenery: 'item', level: 1 }));
        await page.locator('#thingAttributeBonusAddBtn').click();
        await assertGeometry('#thingEditMetadataList .thing-edit-metadata-row, #thingEditAttributeBonusesList .thing-edit-bonus-row');
        await page.screenshot({ path: `tmp/form-thing-${width}.png` });
        await page.locator('#thingEditCloseBtn').click();
        await page.evaluate(() => window.showNpcEditModal({ id: 'geometry-npc', name: 'Geometry NPC', isNPC: true, level: 1 }));
        await assertGeometry('#npcEditSkills .npc-skill-row, #npcEditAbilities .npc-ability-row');
        await page.screenshot({ path: `tmp/form-npc-${width}.png` });
        await page.locator('#npcEditCloseBtn').click();
    }
    expect(errors).toEqual([]);
});

test('failed lightbox action shows original error and restores focus to the action', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { errors } = await setup(page, { openPlayerChooser: false });
    await page.evaluate(() => window.lightboxController.show({ detailsHtml: '<p>Failure case</p>', actions: [{ id: 'fail', label: 'Fail action', handler: () => { throw new Error('Fixture action failure'); } }] }));
    const action = page.getByRole('button', { name: 'Fail action' });
    await action.click();
    const feedback = page.locator('dialog.page-feedback-dialog');
    await expect(feedback).toContainText('Fixture action failure');
    await expect(page.locator('#imageLightbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(feedback).toHaveCount(0);
    await expect(action).toBeEnabled();
    await expect(action).toBeFocused();
    expect(errors).toEqual([]);
});

test('Thing editor retains unavailable saved module type and slot identifiers on unrelated edits', async ({ page }) => {
    const saves = [];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname.startsWith('/api/things/module-') && method === 'PUT') {
            saves.push({ pathname, payload: request.postDataJSON() });
            return { body: { success: true, thing: { id: pathname.split('/').pop(), name: 'Saved item' } } };
        }
        return null;
    } });
    await page.evaluate(() => {
        window.currentSetting = { modSettings: { modules: { slotTypes: [{ id: 'scope', label: 'Scope' }] } } };
        window.AIRPG_CONFIG.thingEditFields = [{ fieldName: 'moduleType', type: 'string' }, { fieldName: 'moduleSlots', type: 'array' }];
        window.showThingEditModal({ id: 'module-type', name: 'Old module', itemOrScenery: 'item', level: 1, moduleType: 'retired-type' });
    });
    const type = page.locator('.thing-edit-module-type');
    await expect(type).toHaveValue('retired-type');
    await expect(type.locator('option:checked')).toContainText('(unavailable)');
    await page.locator('#thingEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].payload.moduleType).toBe('retired-type');
    await expect(page.locator('#thingEditModal')).toBeHidden();
    await page.evaluate(() => window.showThingEditModal({ id: 'module-slot', name: 'Old equipment', itemOrScenery: 'item', level: 1, slot: 'weapon', moduleSlots: [{ type: 'retired-slot' }] }));
    const slot = page.locator('.thing-edit-module-slot-type');
    await expect(slot).toHaveValue('retired-slot');
    await expect(slot.locator('option:checked')).toContainText('(unavailable)');
    await page.locator('#thingEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1].payload.moduleSlots).toEqual([{ type: 'retired-slot' }]);
    expect(errors).toEqual([]);
});

test('persisted pagehide preserves Play collections and lightbox bindings', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    await page.addScriptTag({ path: path.join(ROOT, 'mods/scene-illustration/public/js/scene-illustration.js') });
    await page.waitForFunction(() => window.AIRPG_CHAT._sceneIllustrationRenderingHooked === true);
    await page.evaluate(() => {
        window.updateLocationDisplay({ id: 'cache-location', name: 'Cached', baseLevel: 1, npcs: [], exits: {}, things: [{ id: 'old-item', name: 'Old', thingType: 'item' }] });
        const target = document.createElement('div'); target.id = 'cache-message'; document.body.append(target);
        window.AIRPG_CHAT.setMessageContent(target, '![Cached scene](/cached-scene.png)');
    });
    await expect(page.locator('#locationItems [data-thing-id="old-item"]')).toHaveCount(1);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.evaluate(() => window.updateLocationDisplay({ id: 'cache-location', name: 'Cached', baseLevel: 1, npcs: [], exits: {}, things: [{ id: 'new-item', name: 'New', thingType: 'item' }] }));
    await expect(page.locator('#locationItems [data-thing-id="new-item"]')).toHaveCount(1);
    await expect(page.locator('#locationItems [data-thing-id="old-item"]')).toHaveCount(0);
    await page.locator('#cache-message img').click();
    await expect(page.locator('#imageLightbox img')).toHaveAttribute('alt', 'Cached scene');
    await page.keyboard.press('Escape');
    await expect(page.locator('#imageLightbox')).toBeHidden();
    const disposed = await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        try { window.lightboxController.show({ detailsHtml: '<p>Should not reopen</p>' }); return false; }
        catch (error) { return /destroyed/.test(error.message); }
    });
    expect(disposed).toBe(true);
    expect(errors).toEqual([]);
});

test('real world and relationship graphs replace engines while preserving visible topology', async ({ page }) => {
    const world = { currentLocationId: 'place-a', regions: [{ id: 'region-a', name: 'Region A' }], locations: [
        { id: 'place-a', name: 'Place A', regionId: 'region-a', visited: true, exits: [{ id: 'exit-ab', destination: 'place-b' }] },
        { id: 'place-b', name: 'Place B', regionId: 'region-a', visited: true, exits: [] }
    ] };
    const players = [
        { id: 'actor-a', name: 'Actor A', relationships: { 'actor-b': 'trusts', 'missing-actor': 'misses', 'hidden-actor': 'secret' } },
        { id: 'actor-b', name: 'Actor B', relationships: { 'actor-a': 'knows' } },
        { id: 'hidden-actor', name: 'Hidden Actor', hiddenFromPlayer: true, relationships: { 'actor-a': 'secret' } }
    ];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname }) => {
        if (pathname === '/api/map/world') return { body: { success: true, world } };
        if (pathname === '/api/players') return { body: { success: true, players, currentPlayer: 'actor-a' } };
        return null;
    } });
    await page.locator('#tab-world-map-tab').click();
    await expect.poll(() => page.evaluate(() => document.querySelector('#worldMapContainer')._cyreg?.cy?.nodes().length || 0)).toBeGreaterThan(0);
    const worldState = await page.evaluate(() => {
        const cy = document.querySelector('#worldMapContainer')._cyreg.cy; window.testOldWorldCy = cy;
        return { a: cy.getElementById('place-a').length, b: cy.getElementById('place-b').length, edges: cy.edges().length };
    });
    expect(worldState.a).toBe(1); expect(worldState.b).toBe(1); expect(worldState.edges).toBeGreaterThan(0);
    await expect(page.locator('#worldMapContainer .cy-convex-hull-layer')).toHaveCount(1);
    await page.evaluate(() => {
        const canvas = document.querySelector('#worldMapContainer .cy-convex-hull-layer');
        const engine = window.testOldWorldCy, destroy = engine.destroy;
        engine.destroy = function (...args) { window.hullConnectedAtDestroy = canvas.isConnected; return destroy.apply(this, args); };
    });
    await page.evaluate(() => window.loadWorldMap());
    expect(await page.evaluate(() => window.testOldWorldCy.destroyed())).toBe(true);
    expect(await page.evaluate(() => window.hullConnectedAtDestroy)).toBe(false);
    await page.locator('#tab-relationships-tab').click();
    await expect.poll(() => page.evaluate(() => document.querySelector('#relationshipGraphContainer')._cyreg?.cy?.edges().length || 0)).toBeGreaterThan(0);
    const relationshipState = await page.evaluate(() => {
        const cy = document.querySelector('#relationshipGraphContainer')._cyreg.cy; window.testOldRelationshipsCy = cy;
        return { ids: cy.nodes().map(node => node.id()), edges: cy.edges().length };
    });
    expect(relationshipState.ids).toContain('character:actor-a'); expect(relationshipState.ids).toContain('character:actor-b');
    expect(relationshipState.ids).not.toContain('character:hidden-actor'); expect(relationshipState.ids.join(' ')).toContain('missing-actor');
    expect(relationshipState.edges).toBe(3);
    await page.evaluate(() => window.loadRelationshipGraph());
    expect(await page.evaluate(() => window.testOldRelationshipsCy.destroyed())).toBe(true);
    expect(errors).toEqual([]);
});

test('Location vehicle picker preserves route order, selected destination and zero ETA', async ({ page }) => {
    const writes = [];
    const options = [{ id: 'dock-a', name: 'Alpha Dock', label: 'Alpha Dock [Harbor]', regionName: 'Harbor' }, { id: 'dock-b', name: 'Beta Dock', label: 'Beta Dock [Harbor]', regionName: 'Harbor' }];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, search, method }) => {
        if (pathname === '/api/locations' && search.includes('scope=named')) return { body: { success: true, locations: options } };
        if (pathname === '/api/exits/options') return { body: { success: true, regions: [{ id: 'region-fixture', name: 'Harbor', locations: [] }] } };
        if (pathname === '/api/locations/vehicle-location' && method === 'PUT') { writes.push(request.postDataJSON()); return { body: { success: true, location: { id: 'vehicle-location', name: 'Boat', baseLevel: 1 } } }; }
        return null;
    } });
    await page.evaluate(() => window.updateLocationDisplay({ id: 'vehicle-location', name: 'Boat', regionId: 'region-fixture', baseLevel: 1, dangerLevel: 1, npcs: [], things: [], exits: {}, isVehicle: true, vehicleInfo: { currentDestination: 'unknown-dock', destinations: ['unknown-dock'], ETA: 0 } }));
    await page.locator('#locationImageMenuButton').click(); await page.locator('#locationImageEditButton').click();
    await expect(page.locator('#locationEditVehicleCurrentDestinationSelection')).toContainText('unknown-dock');
    await expect(page.locator('#locationEditVehicleDestinationsList')).toContainText('unknown-dock');
    const search = page.locator('#locationEditVehicleDestinationsSearch'), suggestions = page.locator('#locationEditVehicleDestinationsSuggestions');
    await search.fill('dock'); await expect(suggestions.getByRole('button')).toHaveCount(2);
    await search.press('Enter');
    await expect(page.locator('#locationEditVehicleDestinationsList .vehicle-destination-row')).toHaveCount(2);
    await search.fill('dock'); await expect(suggestions.getByRole('button')).toHaveCount(1);
    await suggestions.getByRole('button').dispatchEvent('mousedown');
    await expect(page.locator('#locationEditVehicleDestinationsList .vehicle-destination-row')).toHaveCount(3);
    await page.locator('#locationEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].vehicleInfo).toMatchObject({ currentDestination: 'unknown-dock', destinations: ['unknown-dock', 'dock-a', 'dock-b'], ETA: 0 });
    expect(errors).toEqual([]);
});

test('Region vehicle current destination can be selected and cleared with ETA validation', async ({ page }) => {
    const writes = [];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, search, method }) => {
        if (pathname === '/api/locations' && search.includes('scope=named')) return { body: { success: true, locations: [{ id: 'dock-a', name: 'Alpha Dock', label: 'Alpha Dock [Harbor]', regionName: 'Harbor' }] } };
        if (pathname === '/api/regions/region-fixture' && method === 'GET') return { body: { success: true, region: { id: 'region-fixture', name: 'Harbor', averageLevel: 1, vehicleInfo: { currentDestination: 'dock-a', destinations: ['dock-a'], ETA: 0 } }, parentOptions: [] } };
        if (pathname === '/api/map/region') return { body: { success: true, region: { regionId: 'region-fixture', regionName: 'Harbor', locations: [] } } };
        if (pathname === '/api/regions/region-fixture' && method === 'PUT') { writes.push(request.postDataJSON()); return { body: { success: true, region: { id: 'region-fixture', name: 'Harbor' } } }; }
        return null;
    } });
    await page.evaluate(() => window.updateLocationDisplay({ id: 'vehicle-location', name: 'Boat', regionId: 'region-fixture', baseLevel: 1, npcs: [], things: [], exits: {} }));
    await page.locator('#locationImageMenuButton').click(); await page.locator('#locationRegionEditButton').click();
    await expect(page.locator('#regionEditSaveBtn')).toBeEnabled();
    await page.locator('#regionEditVehicleCurrentDestinationSelection .vehicle-current-destination-clear').click();
    await page.locator('#regionEditForm').evaluate(form => form.requestSubmit());
    await expect(page.locator('#regionEditStatus')).toContainText('Vehicle destination is required when ETA is set');
    expect(writes).toHaveLength(0);
    const search = page.locator('#regionEditVehicleCurrentDestinationSearch');
    await search.fill('alpha');
    await expect(page.locator('#regionEditVehicleCurrentDestinationSuggestions')).toContainText('Alpha Dock');
    await search.press('Enter');
    await page.locator('#regionEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].vehicleInfo).toMatchObject({ currentDestination: 'dock-a', destinations: ['dock-a'], ETA: 0 });
    expect(errors).toEqual([]);
});

test('late vehicle location results cannot reopen suggestions after the editor closes', async ({ page }) => {
    let release, requested = 0;
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: async ({ pathname, search }) => {
        if (pathname === '/api/locations' && search.includes('scope=named')) {
            requested += 1; await new Promise(resolve => { release = resolve; });
            return { body: { success: true, locations: [{ id: 'late', name: 'Late Dock', label: 'Late Dock' }] } };
        }
        if (pathname === '/api/exits/options') return { body: { success: true, regions: [{ id: 'region-fixture', name: 'Harbor', locations: [] }] } };
        return null;
    } });
    await page.evaluate(() => window.updateLocationDisplay({ id: 'vehicle-location', name: 'Boat', regionId: 'region-fixture', baseLevel: 1, npcs: [], things: [], exits: {}, isVehicle: true, vehicleInfo: {} }));
    await page.locator('#locationImageMenuButton').click(); await page.locator('#locationImageEditButton').click();
    const input = page.locator('#locationEditVehicleCurrentDestinationSearch');
    await page.evaluate(() => invalidateTeleportLocationCache());
    await input.fill('late'); await expect.poll(() => requested).toBe(1);
    await page.locator('#locationEditCloseBtn').click();
    const response = page.waitForResponse(value => value.url().includes('/api/locations?scope=named'));
    release();
    await response;
    await page.locator('#locationImageMenuButton').click(); await page.locator('#locationImageEditButton').click();
    await expect(page.locator('#locationEditVehicleCurrentDestinationSuggestions')).toBeHidden();
    await expect(input).toHaveValue('');
    expect(errors).toEqual([]);
});

test('vehicle pending-region snapshot and route survive an unrelated Location edit', async ({ page }) => {
    const writes = [], pending = { rawText: 'Far Harbor|', regionName: 'Far Harbor', locationName: null, regionId: null, locationId: null };
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname === '/api/exits/options') return { body: { success: true, regions: [{ id: 'region-fixture', name: 'Harbor', locations: [] }] } };
        if (pathname === '/api/locations/pending-boat' && method === 'PUT') { writes.push(request.postDataJSON()); return { body: { success: true, location: { id: 'pending-boat', name: 'Boat', baseLevel: 1 } } }; }
        return null;
    } });
    await page.evaluate(pendingDestination => window.updateLocationDisplay({ id: 'pending-boat', name: 'Boat', regionId: 'region-fixture', baseLevel: 1, dangerLevel: 1, npcs: [], things: [], exits: {}, isVehicle: true, vehicleInfo: { pendingDestination, destinations: ['pending-region:Far Harbor'], ETA: 0 } }), pending);
    await page.locator('#locationImageMenuButton').click(); await page.locator('#locationImageEditButton').click();
    await expect(page.locator('#locationEditVehicleCurrentDestinationSelection')).toContainText('Far Harbor');
    await expect(page.locator('#locationEditVehicleDestinationsList')).toContainText('Far Harbor');
    await page.locator('#locationEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].vehicleInfo).toMatchObject({ currentDestination: null, pendingDestination: pending, destinations: ['pending-region:Far Harbor'], ETA: 0 });
    expect(errors).toEqual([]);
});

test('vehicle search failure retains selected route and deliberate retry loads choices', async ({ page }) => {
    let fail = false, attempts = 0;
    const options = [{ id: 'dock-a', name: 'Alpha Dock', label: 'Alpha Dock' }, { id: 'dock-b', name: 'Beta Dock', label: 'Beta Dock' }];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname, search }) => {
        if (pathname === '/api/locations' && search.includes('scope=named')) { attempts += 1; return fail ? { status: 503, body: { success: false, error: 'Fixture lookup failed' } } : { body: { success: true, locations: options } }; }
        if (pathname === '/api/exits/options') return { body: { success: true, regions: [{ id: 'region-fixture', name: 'Harbor', locations: [] }] } };
        return null;
    } });
    await page.evaluate(() => window.updateLocationDisplay({ id: 'retry-boat', name: 'Boat', regionId: 'region-fixture', baseLevel: 1, npcs: [], things: [], exits: {}, isVehicle: true, vehicleInfo: { currentDestination: 'dock-a', destinations: ['dock-a'], ETA: 0 } }));
    await page.locator('#locationImageMenuButton').click(); await page.locator('#locationImageEditButton').click();
    await expect(page.locator('#locationEditVehicleDestinationsList')).toContainText('Alpha Dock');
    fail = true; await page.evaluate(() => invalidateTeleportLocationCache());
    const input = page.locator('#locationEditVehicleDestinationsSearch');
    await input.fill('beta');
    const feedback = page.locator('dialog.page-feedback-dialog'); await expect(feedback).toContainText('Fixture lookup failed');
    await expect(page.locator('#locationEditVehicleDestinationsList')).toContainText('Alpha Dock');
    fail = false; await page.keyboard.press('Escape');
    await input.fill('bet'); await expect(page.locator('#locationEditVehicleDestinationsSuggestions')).toContainText('Beta Dock');
    expect(attempts).toBeGreaterThanOrEqual(2); expect(errors).toEqual([]);
});

test('graph loaders show original JSON errors and recover on deliberate retry', async ({ page }) => {
    let failing = null;
    const region = { regionId: 'r', regionName: 'Fixture Region', currentLocationId: 'a', locations: [{ id: 'a', name: 'A', exits: [] }] };
    const world = { currentLocationId: 'a', regions: [{ id: 'r', name: 'Region' }], locations: [{ id: 'a', name: 'A', regionId: 'r', exits: [] }] };
    const players = [{ id: 'a', name: 'A', relationships: { b: 'knows' } }, { id: 'b', name: 'B', relationships: {} }];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname }) => {
        if (pathname === failing) return { rawBody: '{broken json' };
        if (pathname === '/api/map/region') return { body: { success: true, region } };
        if (pathname === '/api/map/world') return { body: { success: true, world } };
        if (pathname === '/api/players') return { body: { success: true, players, currentPlayer: 'a' } };
        return null;
    } });
    await page.evaluate(() => {
        const feedback = window.AIRPG_PAGE_FEEDBACK, showError = feedback.showError.bind(feedback);
        window.fixtureGraphErrors = [];
        feedback.showError = (error, options) => { window.fixtureGraphErrors.push({ name: error?.name, message: error?.message, stack: error?.stack }); return showError(error, options); };
    });
    for (const entry of [
        { path: '/api/map/region', tab: '#tab-map-tab', container: '#mapContainer', load: 'loadRegionMap' },
        { path: '/api/map/world', tab: '#tab-world-map-tab', container: '#worldMapContainer', load: 'loadWorldMap' },
        { path: '/api/players', tab: '#tab-relationships-tab', container: '#relationshipGraphContainer', load: 'loadRelationshipGraph' }
    ]) {
        failing = null;
        await page.locator(entry.tab).click();
        await expect.poll(() => page.evaluate(selector => document.querySelector(selector)._cyreg?.cy?.nodes().length || 0, entry.container)).toBeGreaterThan(0);
        // Region tab also schedules a 100ms activation load; let it settle before the intentional failure.
        await page.waitForTimeout(200);
        failing = entry.path;
        const previous = await page.evaluate(() => window.fixtureGraphErrors.length);
        await page.evaluate(load => window[load](), entry.load);
        const feedback = page.locator('dialog.page-feedback-dialog');
        await expect(feedback).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.fixtureGraphErrors.length)).toBe(previous + 1);
        const actual = await page.evaluate(() => window.fixtureGraphErrors.at(-1));
        expect(actual.name).toBe('SyntaxError'); expect(actual.stack).toContain('SyntaxError'); expect(actual.message).toBeTruthy();
        await expect(feedback).toContainText(actual.message);
        await expect(page.locator(entry.container)).toContainText(actual.message);
        failing = null;
        await page.keyboard.press('Escape'); await expect(feedback).toHaveCount(0);
        await page.evaluate(load => window[load](), entry.load);
        await expect.poll(() => page.evaluate(selector => document.querySelector(selector)._cyreg?.cy?.nodes().length || 0, entry.container)).toBeGreaterThan(0);
    }
    await expect(page.locator('#relationshipGraphReloadButton')).toBeEnabled();
    expect(errors).toEqual([]);
});

test('Region weather rows retain drafts, validation and save semantics through reopen', async ({ page }) => {
    const writes = [];
    const region = { id: 'weather-region', name: 'Harbor', averageLevel: 1, weather: { hasDynamicWeather: true, seasonWeather: [{ seasonName: 'Spring', weatherTypes: [{ name: 'Rain', description: 'Soft rain', relativeFrequency: 2, durationRange: '30 minutes - 2 hours' }] }] } };
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname === '/api/regions/weather-region' && method === 'GET') return { body: { success: true, region } };
        if (pathname === '/api/regions/weather-region' && method === 'PUT') { writes.push(request.postDataJSON()); return { body: { success: true, region } }; }
        return null;
    } });
    await page.evaluate(() => window.updateLocationDisplay({ id: 'weather-location', name: 'Dock', regionId: 'weather-region', baseLevel: 1, npcs: [], things: [], exits: {} }));
    const open = async () => { await page.locator('#locationImageMenuButton').click(); await page.locator('#locationWeatherEditButton').click(); await expect(page.locator('#regionWeatherEditSaveBtn')).toBeEnabled(); };
    await open();
    let row = page.locator('.region-weather-type-row').first();
    await expect(row.locator('.region-weather-type-name')).toHaveValue('Rain');
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        const issues = await row.evaluate(element => {
            const bounds = element.getBoundingClientRect();
            const boxes = [...element.querySelectorAll('label, input, textarea, button')].filter(control => control.getClientRects().length).map(control => ({ control, box: control.getBoundingClientRect() }));
            const result = [];
            for (const { control, box } of boxes) if (box.left < bounds.left - 1 || box.right > bounds.right + 1) result.push(`${control.className || control.tagName} outside row`);
            for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i], b = boxes[j];
                if (!a.control.contains(b.control) && !b.control.contains(a.control) && Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1 && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1) result.push(`${a.control.className || a.control.tagName} overlaps ${b.control.className || b.control.tagName}`);
            }
            return result;
        });
        expect(issues).toEqual([]);
    }
    await row.locator('.region-weather-type-frequency').fill('0');
    await page.locator('#regionWeatherEditForm').evaluate(form => form.requestSubmit());
    await expect(page.locator('#regionWeatherEditStatus')).toContainText('must be greater than zero');
    await expect(row.locator('.region-weather-type-frequency')).toBeFocused();
    expect(writes).toHaveLength(0);
    await row.locator('.region-weather-type-frequency').fill('3');
    await row.locator('.region-weather-type-description').fill('Edited rain');
    await page.locator('.region-weather-type-add').first().click();
    row = page.locator('.region-weather-type-row').last();
    await row.locator('.region-weather-type-name').fill('Wind');
    await row.locator('.region-weather-type-description').fill('Strong wind');
    await row.locator('.region-weather-type-frequency').fill('1');
    await row.locator('.region-weather-type-duration').fill('one hour');
    await page.locator('#regionWeatherEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].weather).toEqual({ hasDynamicWeather: true, seasonWeather: [{ seasonName: 'Spring', weatherTypes: [{ name: 'Rain', description: 'Edited rain', relativeFrequency: 3, durationRange: '30 minutes - 2 hours' }, { name: 'Wind', description: 'Strong wind', relativeFrequency: 1, durationRange: 'one hour' }] }] });
    await expect(page.locator('#regionWeatherEditModal')).toBeHidden();
    await open();
    await page.locator('.region-weather-type-remove').first().click();
    await expect(page.locator('.region-weather-type-row')).toHaveCount(0);
    await page.locator('#regionWeatherEditForm').evaluate(form => form.requestSubmit());
    await expect(page.locator('#regionWeatherEditStatus')).toContainText('At least one weather type');
    await page.locator('.region-weather-type-add').click();
    await expect(page.locator('.region-weather-type-row')).toHaveCount(1);
    await page.evaluate(() => { window.fixtureOldWeatherAdd = document.querySelector('.region-weather-type-add'); });
    await page.locator('.region-weather-season-remove').click();
    await page.evaluate(() => window.fixtureOldWeatherAdd.click());
    await expect(page.locator('.region-weather-season')).toHaveCount(0);
    await page.locator('#regionWeatherAddSeasonBtn').click();
    await expect(page.locator('.region-weather-type-row')).toHaveCount(1);
    await page.locator('#regionWeatherDynamicWeather').uncheck();
    await page.locator('#regionWeatherEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1].weather).toEqual({ hasDynamicWeather: false, seasonWeather: [] });
    expect(errors).toEqual([]);
});

test('Region secret rows preserve ordered values and add/remove after reopen', async ({ page }) => {
    const writes = [];
    const region = { id: 'secret-region', name: 'Harbor', averageLevel: 1, secrets: ['First hidden note', 'Second hidden note'] };
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname === '/api/regions/secret-region' && method === 'GET') return { body: { success: true, region, parentOptions: [] } };
        if (pathname === '/api/map/region') return { body: { success: true, region: { regionId: 'secret-region', regionName: 'Harbor', locations: [] } } };
        if (pathname === '/api/regions/secret-region' && method === 'PUT') { writes.push(request.postDataJSON()); return { body: { success: true, region } }; }
        return null;
    } });
    await page.evaluate(() => window.updateLocationDisplay({ id: 'secret-location', name: 'Dock', regionId: 'secret-region', baseLevel: 1, npcs: [], things: [], exits: {} }));
    const open = async () => { await page.locator('#locationImageMenuButton').click(); await page.locator('#locationRegionEditButton').click(); await expect(page.locator('#regionEditSaveBtn')).toBeEnabled(); await page.locator('#regionEditSecretsDetails summary').click(); };
    await open();
    const rows = page.locator('#regionEditSecretsList .region-edit-secret-row');
    await expect(rows).toHaveCount(2);
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        const geometry = await rows.first().evaluate(row => { const parent = row.getBoundingClientRect(), label = row.querySelector('label').getBoundingClientRect(), input = row.querySelector('textarea').getBoundingClientRect(); return { inside: label.left >= parent.left - 1 && label.right <= parent.right + 1 && input.left >= parent.left - 1 && input.right <= parent.right + 1, above: label.bottom <= input.top + 1 }; });
        expect(geometry).toEqual({ inside: true, above: true });
    }
    await rows.first().locator('textarea').fill('Edited first');
    await rows.last().getByRole('button', { name: 'Remove' }).click();
    await page.locator('#regionEditSecretsAddBtn').click();
    await rows.last().locator('textarea').fill('New last');
    await page.locator('#regionEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].secrets).toEqual(['Edited first', 'New last']);
    await expect(page.locator('#regionEditModal')).toBeHidden();
    await open();
    await page.locator('#regionEditSecretsAddBtn').click();
    await expect(rows).toHaveCount(3);
    await rows.last().getByRole('button', { name: 'Remove' }).click();
    await expect(rows).toHaveCount(2);
    expect(errors).toEqual([]);
});

test('Quest editor preserves objective IDs and reward values through save and reopen', async ({ page }) => {
    const writes = [];
    const quest = { id: 'quest-fixture', name: 'Find the ledger', description: 'A mystery', rewardCurrency: 0, rewardXp: 0, rewardItems: [{ name: 'Key', description: 'Brass' }], rewardFactionReputation: { 'missing-faction': 3 }, objectives: [{ id: 'objective-fixture', description: 'Find the ledger', optional: true, completed: false }] };
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname === '/api/quest/edit' && method === 'POST') { writes.push(request.postDataJSON()); return { body: { success: true } }; }
        if (pathname === '/api/factions') return { body: { success: true, factions: [] } };
        if (pathname === '/api/players') return { body: { success: true, players: [] } };
        if (pathname === '/api/quests/reward-benefit-options') return { body: { success: true, routeKnowledge: [] } };
        return null;
    } });
    await page.locator('#tab-quests-tab').click();
    await page.evaluate(value => window.renderQuestPanel([value], []), quest);
    const card = page.locator('.quest-card').filter({ hasText: 'Find the ledger' });
    if (!(await card.evaluate(element => element.open))) await card.locator('summary').click();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    const objective = page.locator('#questEditObjectives .quest-edit-objective-row').first();
    await expect(page.locator('#questEditModal')).toBeVisible();
    await objective.locator('input[type=text]').fill('Find the old ledger');
    await expect(objective.locator('input[type=text]')).toHaveValue('Find the old ledger');
    await page.locator('#questEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ rewardCurrency: 0, rewardXp: 0, rewardItems: [{ name: 'Key', description: 'Brass' }], objectives: [{ id: 'objective-fixture', description: 'Find the old ledger', optional: true, completed: false }] });
    expect(writes[0].rewardFactionReputation).toEqual(expect.arrayContaining([expect.objectContaining({ factionId: 'missing-faction', amount: 3 })]));
    await page.evaluate(value => window.renderQuestPanel([value], []), quest);
    if (!(await card.evaluate(element => element.open))) await card.locator('summary').click();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    const before = await page.locator('#questEditObjectives .quest-edit-objective-row').count();
    await page.locator('#questEditAddObjective').click();
    await expect(page.locator('#questEditObjectives .quest-edit-objective-row')).toHaveCount(before + 1);
    await page.locator('#questEditObjectives .quest-edit-objective-row').last().getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('#questEditObjectives .quest-edit-objective-row')).toHaveCount(before);
    expect(errors).toEqual([]);
});

test('Quest editor saves existing benefits while directory requests are pending and ignores late rows', async ({ page }) => {
    const writes = [], pending = []; let hold = false;
    const benefits = [{ id: 'party-old', type: 'party-member', targetId: 'npc-missing', label: 'Old Companion', description: null, role: null }, { id: 'route-old', type: 'knowledge', subtype: 'route', targetId: 'exit-missing', sourceLocationId: 'source-old', destinationLocationId: 'destination-old', label: 'Old passage', description: null }];
    const quest = { id: 'quest-pending', name: 'Old quest', rewardCurrency: 0, rewardXp: 0, objectives: [{ id: 'old-objective', description: 'Keep draft' }], appliedRewardBenefitIds: ['route-old'], rewardBenefits: benefits };
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: async ({ request, pathname, method }) => {
        if (hold && (pathname === '/api/players' || pathname === '/api/quests/reward-benefit-options')) {
            await new Promise(resolve => pending.push(resolve));
            return { body: pathname === '/api/players' ? { success: true, players: [] } : { success: true, routeKnowledge: [] } };
        }
        if (pathname === '/api/quest/edit' && method === 'POST') { writes.push(request.postDataJSON()); return { body: { success: true } }; }
        if (pathname === '/api/factions') return { body: { success: true, factions: [] } };
        return null;
    } });
    await page.locator('#tab-quests-tab').click();
    await page.evaluate(value => window.renderQuestPanel([value], []), quest);
    hold = true;
    const card = page.locator('.quest-card').filter({ hasText: 'Old quest' });
    if (!(await card.evaluate(element => element.open))) await card.locator('summary').click();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect.poll(() => pending.length).toBeGreaterThanOrEqual(2);
    const appliedRoute = page.locator('.quest-edit-reward-row--route-knowledge');
    await expect(appliedRoute.locator('select')).toBeDisabled();
    await expect(appliedRoute.getByRole('button', { name: 'Remove' })).toBeDisabled();
    await page.evaluate(() => { window.fixtureOldQuestSelects = [...document.querySelectorAll('#questEditRewardBenefitsRows select')]; window.fixtureOldQuestCounts = window.fixtureOldQuestSelects.map(select => select.options.length); });
    await page.locator('#questEditDescription').fill('Edited while loading');
    await page.locator('#questEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].rewardBenefits).toEqual(expect.arrayContaining(benefits.map(value => expect.objectContaining(value))));
    await expect(page.locator('#questEditModal')).toBeHidden();
    const completed = [page.waitForResponse(response => response.url().includes('/api/quests/reward-benefit-options')), page.waitForResponse(response => response.url().endsWith('/api/players'))];
    pending.forEach(resolve => resolve()); await Promise.all(completed);
    expect(await page.evaluate(() => window.fixtureOldQuestSelects.every((select, index) => !select.isConnected && select.options.length === window.fixtureOldQuestCounts[index]))).toBe(true);
    expect(errors).toEqual([]);
});

test('Quest reward and objective row controls fit desktop and phone layouts', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname }) => {
        if (pathname === '/api/players') return { body: { success: true, players: [] } };
        if (pathname === '/api/factions') return { body: { success: true, factions: [] } };
        if (pathname === '/api/quests/reward-benefit-options') return { body: { success: true, routeKnowledge: [] } };
        return null;
    } });
    await page.locator('#tab-quests-tab').click();
    await page.evaluate(() => window.renderQuestPanel([{ id: 'geometry-quest', name: 'Geometry Quest', objectives: [{ description: 'Task' }] }], []));
    const card = page.locator('.quest-card').filter({ hasText: 'Geometry Quest' });
    if (!(await card.evaluate(element => element.open))) await card.locator('summary').click();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#questEditAddRouteKnowledgeReward').click();
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        const issues = await page.locator('#questEditModal .quest-edit-reward-row, #questEditModal .quest-edit-objective-row').evaluateAll(rows => rows.flatMap(row => {
            const bounds = row.getBoundingClientRect();
            const boxes = [...row.querySelectorAll('label, input, select, textarea, button')].filter(control => control.getClientRects().length).map(control => ({ control, rect: control.getBoundingClientRect() }));
            const result = [];
            for (const { control, rect } of boxes) if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) result.push(`${row.className}: ${control.className || control.tagName} outside row`);
            for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i], b = boxes[j];
                if (!a.control.contains(b.control) && !b.control.contains(a.control) && Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 1 && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 1) result.push(`${row.className}: ${a.control.className || a.control.tagName} overlaps ${b.control.className || b.control.tagName}`);
            }
            return result;
        }));
        expect(issues).toEqual([]);
        await page.screenshot({ path: `tmp/quest-rows-${width}.png` });
    }
    expect(errors).toEqual([]);
});

test('Quest shared NPC lookup failure reports once and retains saved targets for retry', async ({ page }) => {
    let failDirectory = false, failures = 0; const writes = [];
    const quest = { id: 'quest-failure', name: 'Failure quest', rewardCurrency: 0, rewardXp: 0, objectives: [{ id: 'objective', description: 'Preserve' }], rewardNpcDispositions: [{ npcId: 'npc-a', npcName: 'First NPC', dispositions: [{ type: 'friendly', intensity: 2, reason: 'Help' }] }], rewardBenefits: [{ id: 'benefit-a', type: 'party-member', targetId: 'npc-b', label: 'Second NPC', description: null, role: null }] };
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ request, pathname, method }) => {
        if (pathname === '/api/players') { if (failDirectory) { failures += 1; return { status: 503, body: { success: false, error: 'Fixture NPC lookup failed' } }; } return { body: { success: true, players: [] } }; }
        if (pathname === '/api/factions') return { body: { success: true, factions: [] } };
        if (pathname === '/api/quest/edit' && method === 'POST') { writes.push(request.postDataJSON()); return { body: { success: true } }; }
        return null;
    } });
    await page.locator('#tab-quests-tab').click(); await page.evaluate(value => window.renderQuestPanel([value], []), quest);
    await page.evaluate(() => { const feedback = window.AIRPG_PAGE_FEEDBACK, original = feedback.showError.bind(feedback); window.fixtureQuestErrors = []; feedback.showError = (error, options) => { window.fixtureQuestErrors.push(error.stack); return original(error, options); }; });
    failDirectory = true;
    const card = page.locator('.quest-card').filter({ hasText: 'Failure quest' });
    if (!(await card.evaluate(element => element.open))) await card.locator('summary').click();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    const feedback = page.locator('dialog.page-feedback-dialog');
    await expect(feedback).toHaveCount(1); await expect(feedback).toContainText('Fixture NPC lookup failed');
    expect(await page.evaluate(() => window.fixtureQuestErrors)).toHaveLength(1);
    expect((await page.evaluate(() => window.fixtureQuestErrors[0]))).toContain('Fixture NPC lookup failed');
    await expect(page.locator('.quest-edit-reward-npc-select')).toHaveValue('npc-a');
    await expect(page.locator('.quest-edit-reward-party-member-select')).toHaveValue('npc-b');
    await page.keyboard.press('Escape');
    await page.locator('#questEditForm').evaluate(form => form.requestSubmit());
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].rewardNpcDispositions[0]).toMatchObject({ npcId: 'npc-a' });
    expect(writes[0].rewardBenefits[0]).toMatchObject({ id: 'benefit-a', targetId: 'npc-b' });
    const prior = failures;
    await page.evaluate(value => window.renderQuestPanel([value], []), quest);
    if (!(await card.evaluate(element => element.open))) await card.locator('summary').click();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect.poll(() => failures).toBeGreaterThan(prior);
    await expect(feedback).toHaveCount(1); await expect(feedback).toContainText('Fixture NPC lookup failed');
    expect(await page.evaluate(() => window.fixtureQuestErrors)).toHaveLength(2);
    expect(errors).toEqual([]);
});

test('image job progress updates and clears the actual location overlay', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false, stubImages: false });
    await page.evaluate(() => { const element = document.createElement('div'); element.id = 'fixture-image-host'; document.body.append(element); return renderEntityImage({ element, entityType: 'location', entityId: 'image-location', imageId: null, enableLightbox: false }); });
    await expect(page.locator('#fixture-image-host')).toHaveAttribute('data-image-entity-id', 'image-location');
    const send = progress => page.evaluate(value => window.dispatchEvent(new CustomEvent('image:job-progress', { detail: { jobId: 'image-job', payload: { entityType: 'location', entityId: 'image-location' }, job: { status: 'processing', isRendering: true, renderProgress: value } } })), progress);
    await send(0);
    const fill = page.locator('#fixture-image-host .entity-image-render-state__progress-fill');
    await expect(fill).toHaveCSS('width', '0px');
    await send(75);
    await expect(fill).toHaveAttribute('style', /width:\s*75%/);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('image:job-progress', { detail: { jobId: 'image-job', payload: { entityType: 'location', entityId: 'image-location' }, job: { status: 'completed', isRendering: false } } })));
    await expect(fill).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('Scene Illustration reports queued and failed requests without losing queue ownership', async ({ page }) => {
    let requests = 0; const pending = [];
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: async ({ pathname, method }) => {
        if (pathname === '/api/mods/scene-illustration/generate' && method === 'POST') {
            const attempt = ++requests; await new Promise(resolve => pending.push(resolve));
            return attempt === 1 ? { body: { success: true } } : { status: 500, body: { success: false, error: 'Fixture illustration failure', stack: 'Error: Fixture illustration failure\n    at scene-fixture.js:42:3' } };
        }
        return null;
    } });
    await page.evaluate(() => {
        const row = document.createElement('div'); row.className = 'message ai-message'; row.dataset.timestamp = 'fixture-scene';
        const actions = document.createElement('div'); actions.className = 'message-actions'; row.append(actions); document.querySelector('#chatLog').append(row);
    });
    await page.addScriptTag({ path: path.join(ROOT, 'mods/scene-illustration/public/js/scene-illustration.js') });
    const button = page.locator('.message[data-timestamp="fixture-scene"] .message-action--scene-illustration');
    await expect(button).toBeVisible();
    await button.click(); await button.click(); await expect.poll(() => requests).toBe(2);
    await expect(button).toHaveAttribute('data-queue-count', '2');
    pending[0](); await expect(page.getByText('Scene illustration added to queue')).toBeVisible();
    pending[1]();
    const feedback = page.locator('dialog.page-feedback-dialog');
    await expect(feedback).toContainText('Fixture illustration failure');
    await expect(feedback).toContainText('scene-fixture.js:42:3');
    await expect(button).toHaveAttribute('data-queue-count', '1');
    expect(errors).toEqual([]);
});

test('search selection filters choices and keeps pending selection scoped to its modal', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    await page.evaluate(() => {
        window.fixtureSelections = [];
        window.showSearchSelectionModal({ title: 'Fixture chooser', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }], onSelect: entry => { window.fixtureSelections.push(entry.id); return new Promise(resolve => { window.fixtureReleaseSelection = resolve; }); } });
    });
    const modal = page.locator('.npc-selection-modal');
    const search = modal.locator('input[type=search]');
    await expect(search).toBeEnabled(); await search.fill('bet');
    await expect(modal.locator('.npc-selection-item')).toHaveCount(1);
    await modal.getByRole('button', { name: 'Beta' }).evaluate(button => { window.fixtureOldChoice = button; });
    await modal.getByRole('button', { name: 'Beta' }).click();
    await expect(search).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(modal).toBeVisible();
    expect(await page.evaluate(() => window.fixtureSelections)).toEqual(['b']);
    await page.evaluate(() => window.fixtureReleaseSelection());
    await expect(modal).toHaveCount(0);
    await page.evaluate(() => window.fixtureOldChoice.click());
    expect(await page.evaluate(() => window.fixtureSelections)).toEqual(['b']);
    await page.evaluate(() => {
        window.showSearchSelectionModal({ title: 'Slow chooser', loadOptions: () => new Promise(resolve => { window.fixtureReleaseChoices = resolve; }), onSelect: () => {} });
    });
    await expect(page.locator('.npc-selection-modal')).toBeVisible();
    await page.locator('.npc-selection-cancel').click();
    await page.evaluate(() => window.fixtureReleaseChoices([{ id: 'late', label: 'Late' }]));
    await expect(page.locator('.npc-selection-modal')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('chat send busy presentation preserves independent disabled state and current content', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false });
    const button = page.locator('#sendButton');
    await page.evaluate(() => { const button = document.querySelector('#sendButton'); button.textContent = 'Current send label'; window.AIRPG_CHAT.setSendButtonLoading(true); document.querySelector('#messageInput').disabled = true; });
    await expect(button).toBeDisabled(); await expect(button).toHaveAttribute('aria-busy', 'true');
    await page.evaluate(() => window.AIRPG_CHAT.setSendButtonLoading(false));
    await expect(button).toBeDisabled(); await expect(button).toHaveText('Current send label');
    await expect(button).not.toHaveAttribute('aria-busy');
    expect(errors).toEqual([]);
});

test('Play load dialog keeps native select loading, empty and saved-game options', async ({ page }) => {
    let release; const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: async ({ pathname, search }) => {
        if (pathname === '/api/saves' && search.includes('type=saves')) { await new Promise(resolve => { release = resolve; }); return { body: { success: true, saves: [{ saveName: 'first', playerName: 'One', level: 1 }, { saveName: 'second', playerName: 'Two', level: 2 }] } }; }
        if (pathname === '/api/saves' && search.includes('type=autosaves')) return { body: { success: true, saves: [] } };
        return null;
    } });
    await page.locator('#loadGameBtn').click();
    const select = page.locator('#loadGameSelect');
    await expect(select).toBeVisible(); await expect(select).toBeDisabled(); await expect(select.locator('option:checked')).toBeDisabled();
    await expect.poll(() => typeof release).toBe('function'); release();
    await expect(select).toBeEnabled(); await expect(select).toHaveValue('first'); await expect(select.locator('option')).toHaveCount(2);
    await page.locator('input[name=loadGameSource][value=autosaves]').check();
    await expect(select).toBeVisible(); await expect(select).toBeDisabled();
    await expect(select.locator('option')).toHaveCount(1); await expect(select.locator('option')).toBeDisabled();
    await page.locator('#loadGameCancelBtn').click(); await expect(page.locator('#loadGameModal')).toBeHidden();
    expect(errors).toEqual([]);
});

test('stack keeper choices retain group selections and release replaced cards', async ({ page }) => {
    const { errors } = await setup(page, { openPlayerChooser: false, apiHandler: ({ pathname, method }) => {
        if (pathname === '/api/things/ai-combine-candidates' && method === 'POST') return { body: { success: true, groups: [{ itemIds: ['a', 'b'], reason: 'Pair one' }, { itemIds: ['c', 'd'], reason: 'Pair two' }] } };
        return null;
    } });
    await page.evaluate(() => window.updateLocationDisplay({ id: 'stacks', name: 'Stacks', baseLevel: 1, npcs: [], exits: {}, things: ['a', 'b', 'c', 'd'].map(id => ({ id, name: `Stack ${id}`, thingType: 'item', count: 1 })) }));
    await page.locator('#locationItemsCombineBtn').click();
    const modal = page.locator('#thingStackCombinerModal'), cards = modal.locator('.thing-stack-combiner-card');
    await expect(modal).toBeVisible(); await expect(cards).toHaveCount(2);
    await cards.first().evaluate(element => { window.fixtureOldStackCard = element; });
    await cards.first().click(); await page.locator('#thingStackCombinerNextBtn').click();
    await expect(page.locator('#thingStackCombinerProgress')).toContainText('2 of 2');
    await cards.last().click(); await page.locator('#thingStackCombinerBackBtn').click();
    await expect(page.locator('#thingStackCombinerProgress')).toContainText('1 of 2');
    await expect(cards.first()).toHaveClass(/selected/);
    await page.locator('#thingStackCombinerCancelBtn').click();
    await expect(modal).toBeHidden();
    await page.locator('#locationItemsCombineBtn').click(); await expect(modal).toBeVisible();
    await page.evaluate(() => window.fixtureOldStackCard.click());
    await expect(cards.first()).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#thingStackCombinerNextBtn')).toHaveText('Skip');
    expect(errors).toEqual([]);
});
