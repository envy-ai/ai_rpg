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
