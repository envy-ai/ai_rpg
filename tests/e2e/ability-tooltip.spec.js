const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const ASSETS = path.join(ROOT, 'assets');
const URL = 'http://0.0.0.0:4173/';
const statesByPage = new WeakMap();
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(ROOT, 'views')), { autoescape: true });
const player = {
    id: 'fixture-player', name: 'Fixture Hero', abilities: [
        { id: 'ability-a', name: 'Arcane <Ward>', type: 'Active', level: 3, shortDescription: 'Brief <summary>.', description: 'A full & detailed description with <b>literal markup</b>.', statusEffects: [{ name: 'Guard <&>', duration: -1, attributes: [{ attribute: 'Strength', modifier: 2, percentModifier: 20 }], techniqueGrants: [{ techniqueId: 'ward', techniqueName: 'Wardcraft Technique' }] }] },
        { id: 'ability-b', name: 'Steady', type: 'Passive', level: 1, shortDescription: 'One description.', description: 'One description.' }
    ]
};

async function setup(page, { openPlayerChooser = true, gameLoaded = true, apiHandler = null, seedPlayer = true } = {}) {
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
                    await route.fulfill({ status: response.status || 200, json: response.body || {} });
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
    await page.evaluate(({ data, seed }) => { window.renderEntityImage = async ({ element }) => { element.textContent = 'Icon'; return { imageId: 'fixture-icon' }; }; if (seed) window.updateChatPlayerPanel(data); }, { data: player, seed: seedPlayer });
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
    await card.locator('summary[aria-label="Image options for Arcane <Ward>"]').click();
    await expect(card.getByRole('button', { name: 'Regenerate image' })).toBeVisible();
    await expect(input).toHaveValue('before [Arcane <Ward>]after');
    await page.keyboard.press('Escape');
    await expect(chooser).toBeVisible();
    await choice.focus();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(chooser).toBeHidden();
    await expect(tooltip).toBeHidden();
    expect(fixture.writes).toEqual([]);
    expect(fixture.errors).toEqual([]);
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
