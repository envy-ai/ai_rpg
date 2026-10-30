const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_ROOT = path.join(ROOT, 'public');
const ASSETS_ROOT = path.join(ROOT, 'assets');
const VIEWS_ROOT = path.join(ROOT, 'views');
const FIXTURE_URL = 'http://127.0.0.1:4173/new-game';
const renderEnvironment = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(VIEWS_ROOT),
    { autoescape: true, throwOnUndefined: false }
);

const harnesses = new WeakMap();
const blockedFontHosts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

function renderNewGameDocument(url) {
    const noWorld = new URL(url).searchParams.get('fixtureWorld') === 'none';
    const defaults = {
        playerName: 'Mira Vale',
        playerLevel: 3,
        playerDescription: 'A cartographer looking for the old roads.',
        playerClass: 'Scout',
        playerRace: 'Human',
        startMonth: 1,
        startDay: 2,
        startTime: 9,
        startingCurrency: 12,
        startingLocation: 'Begin near the old north gate.',
        calendarMonths: [
            { name: 'Frostwake', lengthDays: 30 },
            { name: 'Thaw', lengthDays: 28 },
            { name: 'Greenrise', lengthDays: 31 }
        ],
        availableClasses: ['Scout', 'Warden'],
        availableRaces: ['Human', 'Elf'],
        existingSkills: ['Athletics', 'Arcana', 'Stealth'],
        pointPoolFormulas: {}
    };
    return renderEnvironment.render('new-game.njk', {
        title: 'Start New Game',
        currentPage: 'new-game',
        newGameDefaults: defaults,
        currentSetting: noWorld ? null : { id: 'fixture-profile', name: 'Fixture Profile' },
        draftToken: new URL(url).searchParams.get('draftToken')
    });
}

function fulfillJson(route, status, payload) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(payload)
    });
}

async function installRenderedFixture(page) {
    const harness = {
        unexpectedRequests: [],
        externalRequests: [],
        pageErrors: [],
        browserDialogs: [],
        apiRequests: [],
        webSockets: [],
        blockNewGameScript: false,
        blockedNewGameScripts: 0,
        allowStartConfirmation: false,
        apiHandlers: new Map()
    };
    harnesses.set(page, harness);
    page.on('pageerror', error => harness.pageErrors.push(error.stack || error.message));
    page.on('dialog', async dialog => {
        harness.browserDialogs.push({ type: dialog.type(), message: dialog.message() });
        if (harness.allowStartConfirmation && dialog.type() === 'confirm') await dialog.accept();
        else await dialog.dismiss();
    });
    page.on('websocket', socket => harness.webSockets.push(socket.url()));

    harness.apiHandlers.set('GET /api/pending-load', async route => fulfillJson(route, 200, { success: true, pendingLoad: null }));
    harness.apiHandlers.set('GET /api/attributes', async route => fulfillJson(route, 200, {
        success: true,
        attributes: {
            strength: { label: 'Strength', abbreviation: 'STR' },
            dexterity: { label: 'Dexterity', abbreviation: 'DEX' },
            constitution: { label: 'Constitution', abbreviation: 'CON' },
            intelligence: { label: 'Intelligence', abbreviation: 'INT' },
            wisdom: { label: 'Wisdom', abbreviation: 'WIS' },
            charisma: { label: 'Charisma', abbreviation: 'CHA' }
        }
    }));

    await page.route('**/*', async route => {
        const requestUrl = new URL(route.request().url());
        const pathname = decodeURIComponent(requestUrl.pathname);
        if (requestUrl.origin !== new URL(FIXTURE_URL).origin) {
            const request = { url: requestUrl.href, host: requestUrl.hostname };
            if (blockedFontHosts.has(requestUrl.hostname)) {
                harness.externalRequests.push({ ...request, allowed: 'blocked Google Fonts stylesheet/font; local system font is used.' });
            } else {
                harness.unexpectedRequests.push(request);
            }
            await route.abort();
            return;
        }

        if (pathname === '/new-game') {
            await route.fulfill({
                status: 200,
                contentType: 'text/html; charset=utf-8',
                body: renderNewGameDocument(requestUrl.href)
            });
            return;
        }

        if (pathname === '/') {
            await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>Fixture Play Page</title>' });
            return;
        }

        if (pathname.startsWith('/api/')) {
            const key = `${route.request().method()} ${pathname}`;
            harness.apiRequests.push(key);
            const handler = harness.apiHandlers.get(key);
            if (handler) {
                await handler(route);
            } else {
                harness.unexpectedRequests.push({ method: route.request().method(), url: requestUrl.href, body: route.request().postData() });
                await fulfillJson(route, 500, { success: false, error: `Unexpected fixture API request: ${key}` });
            }
            return;
        }

        if (pathname === '/js/new-game.js' && harness.blockNewGameScript) {
            harness.blockedNewGameScripts += 1;
            await route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
            return;
        }

        const assetRoot = pathname.startsWith('/assets/') ? ASSETS_ROOT : PUBLIC_ROOT;
        const assetPath = path.resolve(assetRoot, `.${pathname.startsWith('/assets/') ? pathname.slice('/assets'.length) : pathname}`);
        if (assetPath.startsWith(`${assetRoot}${path.sep}`) && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
            const extension = path.extname(assetPath).toLowerCase();
            const contentType = ({
                '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
                '.png': 'image/png', '.webp': 'image/webp', '.woff': 'font/woff',
                '.woff2': 'font/woff2', '.ttf': 'font/ttf'
            })[extension] || 'application/octet-stream';
            await route.fulfill({ status: 200, contentType, body: fs.readFileSync(assetPath) });
            return;
        }

        harness.unexpectedRequests.push({ method: route.request().method(), url: requestUrl.href, reason: 'Missing local fixture asset or route.' });
        await route.fulfill({ status: 404, body: 'Missing fixture route.' });
    });

    await page.goto(FIXTURE_URL);
    await expect(page.locator('#newGameForm')).toBeVisible();
    await expect(page.locator('#attr-strength')).toBeVisible();
}

function setApi(page, method, pathname, handler) {
    harnesses.get(page).apiHandlers.set(`${method} ${pathname}`, handler);
}

async function capturePageFeedbackErrors(page) {
    await page.evaluate(() => {
        window.__newGameSettingsErrors = [];
        const feedback = window.AIRPG_PAGE_FEEDBACK;
        const originalShowError = feedback.showError.bind(feedback);
        feedback.showError = (error, options) => {
            window.__newGameSettingsErrors.push({ message: error?.message, stack: error?.stack, code: error?.code });
            return originalShowError(error, options);
        };
    });
}

function mockSaveList(page, saves) {
    setApi(page, 'GET', '/api/new-game/settings/saves', route => fulfillJson(route, 200, {
        success: true,
        saves,
        count: saves.length,
        directory: '/mocked/new-game-settings'
    }));
}

function settingsPayload(overrides = {}) {
    return {
        playerName: 'Corin Ashdown',
        playerDescription: 'A patient guide.',
        playerClass: 'Warden',
        playerRace: 'Elf',
        playerLevel: 4,
        startMonth: 2,
        startDay: 7,
        startTime: 14,
        startingLocation: 'The south ferry landing.',
        startingCurrency: 25,
        attributes: { strength: 14, dexterity: 12 },
        skills: { Athletics: 3, Arcana: 2 },
        ...overrides
    };
}

function saves(count) {
    return Array.from({ length: count }, (_, index) => {
        const number = index + 1;
        const distinct = number === count;
        const longName = distinct
            ? `Thirty Sixth — ${'a very long saved form name '.repeat(4)}Glass-road Scout ${number}`
            : `Archive ${String(number).padStart(2, '0')} — Mira's route ${number}`;
        return {
            saveName: longName,
            timestamp: `2026-10-${String((number % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
            playerName: distinct ? 'Glass-road Scout' : `Explorer ${number}`,
            playerLevel: distinct ? 11 : number % 6 + 1,
            currentSettingName: distinct ? 'Glass Coast Profile' : `Archive Profile ${number}`,
            totalAttributes: 6,
            totalSkills: 3
        };
    });
}

test.beforeEach(async ({ page }) => {
    fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
    await installRenderedFixture(page);
});

test.afterEach(async ({ page }) => {
    const harness = harnesses.get(page);
    if (!harness) return;
    if (harness.allowStartConfirmation) {
        expect(harness.browserDialogs).toEqual([{ type: 'confirm', message: 'You have unspent points. Start the game anyway?' }]);
    } else {
        expect(harness.browserDialogs, 'New Game settings must not use browser prompts or confirms').toEqual([]);
    }
    expect(harness.unexpectedRequests, 'The isolated fixture must reject unexpected API, asset, and network requests').toEqual([]);
    expect(harness.pageErrors, 'The rendered page must not throw uncaught browser errors').toEqual([]);
    expect(harness.externalRequests.every(request => blockedFontHosts.has(request.host))).toBeTruthy();
});

test('save opens with the suggested name and snapshot, submits blank names, and keeps the original server error on failure', async ({ page }) => {
    await capturePageFeedbackErrors(page);
    let savedBody = null;
    setApi(page, 'POST', '/api/new-game/settings/save', async route => {
        savedBody = route.request().postDataJSON();
        await fulfillJson(route, 200, { success: true, saveName: '2026-10-05T12-00-00-000Z_Mira-Vale' });
    });

    await page.locator('#saveNewGameSettingsBtn').click();
    const saveDialog = page.locator('#saveNewGameSettingsDialog');
    await expect(saveDialog).toBeVisible();
    await expect(page.locator('#newGameSettingsSaveName')).toHaveValue(/^Mira Vale-lvl-3-\d{4}-\d{2}-\d{2}$/);
    await expect(page.locator('#newGameSettingsSaveName')).toBeFocused();
    await expect(page.locator('#newGameSettingsSaveSummary')).toContainText('Mira Vale');
    await expect(page.locator('#newGameSettingsSaveSummary')).toContainText('Frostwake');
    await page.screenshot({ path: path.join(ROOT, 'tmp', 'new-game-form-settings-desktop.png') });

    await page.locator('#newGameSettingsSaveName').fill('   ');
    await page.locator('#saveNewGameSettingsSubmit').click();
    await expect(saveDialog).not.toBeVisible();
    await expect(page.locator('#saveNewGameSettingsBtn')).toBeFocused();
    await expect.poll(() => savedBody).not.toBeNull();
    expect(savedBody.saveName).toBe('');
    expect(savedBody.settings).toMatchObject({ playerName: 'Mira Vale', playerLevel: 3, startMonth: 1, startDay: 2, startTime: 9 });
    expect(Object.keys(savedBody.settings.attributes)).toHaveLength(6);
    expect(savedBody.settings.skills).toMatchObject({ Athletics: 1, Arcana: 1, Stealth: 1 });
    await expect(page.locator('#newGameSettingsStatus')).toContainText('2026-10-05T12-00-00-000Z_Mira-Vale');

    setApi(page, 'POST', '/api/new-game/settings/save', async route => {
        savedBody = route.request().postDataJSON();
        await fulfillJson(route, 400, {
            success: false,
            error: 'Save already exists for this label.',
            code: 'SAVE_ALREADY_EXISTS',
            stack: 'Error: Save already exists for this label.\n    at performNewGameSettingsSave (api.js:54321:9)\n    at routeHandler (api.js:54540:13)'
        });
    });
    await page.locator('#saveNewGameSettingsBtn').click();
    await page.locator('#newGameSettingsSaveName').fill('Keep this proposed label');
    await page.locator('#saveNewGameSettingsSubmit').click();
    await expect(page.locator('#newGameSettingsSaveStatus')).toContainText('Save already exists');
    const errorDialog = page.locator('dialog.page-feedback-dialog');
    await expect(errorDialog).toBeVisible();
    await expect(errorDialog.locator('h2')).toHaveText('Operation stopped');
    await expect(errorDialog).toContainText('Save already exists for this label.');
    await expect(errorDialog).toContainText('api.js:54321:9');
    const capturedErrors = await page.evaluate(() => window.__newGameSettingsErrors);
    expect(capturedErrors.at(-1)).toMatchObject({ code: 'SAVE_ALREADY_EXISTS', stack: expect.stringContaining('api.js:54321:9') });
    await errorDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('#newGameSettingsSaveName')).toHaveValue('Keep this proposed label');
    expect(savedBody.saveName).toBe('Keep this proposed label');
});

test('a loaded world keeps the Start path available and submits the form to the mocked new-game API', async ({ page }) => {
    harnesses.get(page).allowStartConfirmation = true;
    let submittedPayload = null;
    setApi(page, 'POST', '/api/new-game', async route => {
        submittedPayload = route.request().postDataJSON();
        await fulfillJson(route, 200, { success: true });
    });

    await expect(page.locator('#newGameForm')).toHaveAttribute('data-world-loaded', 'true');
    await expect(page.locator('#newGameControls')).toHaveJSProperty('disabled', false);
    await expect(page.locator('#startBtn')).toBeEnabled();
    await page.locator('#playerName').fill('Fixture World Protagonist');
    await page.locator('#startBtn').click();
    await page.waitForURL(/#tab-adventure$/, { timeout: 3000 });
    await expect.poll(() => submittedPayload).not.toBeNull();
    expect(submittedPayload.playerName).toBe('Fixture World Protagonist');
});

test('load searches every save, selects without applying, then posts the deliberate choice and applies calendar and allocator values', async ({ page }) => {
    const entries = saves(36);
    let listAttempts = 0;
    let loadedBody = null;
    setApi(page, 'GET', '/api/new-game/settings/saves', async route => {
        listAttempts += 1;
        if (listAttempts === 1) {
            await fulfillJson(route, 500, {
                success: false,
                error: 'Saved settings directory is temporarily unavailable.',
                code: 'SETTINGS_DIRECTORY_UNAVAILABLE',
                stack: 'Error: Saved settings directory is temporarily unavailable.\n    at listNewGameSettingsSaves (api.js:54590:11)'
            });
            return;
        }
        await fulfillJson(route, 200, { success: true, saves: entries, count: entries.length });
    });
    setApi(page, 'POST', '/api/new-game/settings/load', async route => {
        loadedBody = route.request().postDataJSON();
        await fulfillJson(route, 200, {
            success: true,
            saveName: entries[35].saveName,
            metadata: entries[35],
            settings: settingsPayload()
        });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#playerName').fill('Keep current until Load');
    await page.locator('#loadNewGameSettingsBtn').click();
    const loadDialog = page.locator('#loadNewGameSettingsDialog');
    await expect(loadDialog).toBeVisible();
    await expect(page.locator('#newGameSettingsLoadStatus')).toContainText('temporarily unavailable');
    await expect(page.locator('#newGameSettingsListRetry')).toBeVisible();
    const errorDialog = page.locator('dialog.page-feedback-dialog');
    await expect(errorDialog).toContainText('api.js:54590:11');
    await expect(errorDialog.locator('h2')).toHaveText('Operation stopped');
    await errorDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#newGameSettingsListRetry').click();
    await expect(page.locator('#newGameSettingsChoices input[type="radio"]')).toHaveCount(36);
    await expect(page.locator('#newGameSettingsListRetry')).toBeHidden();
    await expect(page.locator('#loadNewGameSettingsSubmit')).toBeDisabled();

    await page.locator('#newGameSettingsSearch').fill('Glass Coast');
    const choice = page.locator('#newGameSettingsChoices input[type="radio"]');
    await expect(choice).toHaveCount(1);
    await expect(page.locator('#newGameSettingsResultCount')).toContainText('1');
    await page.keyboard.press('Control+Enter');
    await expect(loadDialog).toBeVisible();
    expect(loadedBody).toBeNull();
    await choice.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#loadNewGameSettingsSubmit')).toBeEnabled();
    await expect(page.locator('#playerName')).toHaveValue('Keep current until Load');
    await page.locator('#newGameSettingsSearch').fill('nothing matches this query');
    await expect(page.locator('#loadNewGameSettingsSubmit')).toBeDisabled();
    await expect(page.locator('#playerName')).toHaveValue('Keep current until Load');
    await page.locator('#newGameSettingsSearch').fill('Glass Coast');
    await choice.check();
    await page.screenshot({ path: path.join(ROOT, 'tmp', 'new-game-form-settings-mobile.png') });

    await page.locator('#loadNewGameSettingsSubmit').click();
    await expect.poll(() => loadedBody).not.toBeNull();
    expect(loadedBody.saveName).toBe(entries[35].saveName);
    await expect(loadDialog).not.toBeVisible();
    await expect(page.locator('#loadNewGameSettingsBtn')).toBeFocused();
    await expect(page.locator('#playerName')).toHaveValue('Corin Ashdown');
    await expect(page.locator('#playerLevel')).toHaveValue('4');
    await expect(page.locator('#playerClassSelect')).toHaveValue('Warden');
    await expect(page.locator('#playerRaceSelect')).toHaveValue('Elf');
    await expect(page.locator('#startMonth')).toHaveValue('2');
    await expect(page.locator('#startDay')).toHaveValue('7');
    await expect(page.locator('#startTime')).toHaveValue('14');
    await expect(page.locator('#attr-strength')).toHaveValue('14');
    await expect(page.locator('#newGameSkillsGrid')).toContainText('Athletics');
    await expect(page.locator('#newGameSettingsStatus')).toContainText('Loaded attributes');
    expect(listAttempts).toBe(2);
});

test('an empty save list and search no-match state stay distinct, with Escape returning focus to the trigger', async ({ page }) => {
    mockSaveList(page, []);
    await page.locator('#loadNewGameSettingsBtn').click();
    const loadDialog = page.locator('#loadNewGameSettingsDialog');
    await expect(loadDialog).toBeVisible();
    await expect(page.locator('#newGameSettingsLoadStatus')).toContainText(/No saved new-game form settings found/);
    await page.keyboard.press('Escape');
    await expect(loadDialog).not.toBeVisible();
    await expect(page.locator('#loadNewGameSettingsBtn')).toBeFocused();

    mockSaveList(page, saves(3));
    await page.locator('#loadNewGameSettingsBtn').click();
    await expect(page.locator('#newGameSettingsChoices input[type="radio"]')).toHaveCount(3);
    await page.locator('#newGameSettingsSearch').fill('not present in this library');
    await expect(page.locator('#newGameSettingsChoices input[type="radio"]')).toHaveCount(0);
    await expect(page.locator('#newGameSettingsLoadStatus')).toContainText('No saved settings match');
    await expect(page.locator('#loadNewGameSettingsSubmit')).toBeDisabled();
});

test('canceling a pending list request ignores its late response and does not change the form', async ({ page }) => {
    let finishList;
    setApi(page, 'GET', '/api/new-game/settings/saves', route => new Promise(resolve => {
        finishList = async payload => {
            await fulfillJson(route, 200, payload);
            resolve();
        };
    }));

    await page.locator('#playerName').fill('Unchanged while list waits');
    await page.locator('#loadNewGameSettingsBtn').click();
    await expect.poll(() => typeof finishList).toBe('function');
    const loadDialog = page.locator('#loadNewGameSettingsDialog');
    await expect(loadDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(loadDialog).not.toBeVisible();
    await finishList({ success: true, saves: saves(1), count: 1 });
    await expect(page.locator('#playerName')).toHaveValue('Unchanged while list waits');
    await expect(loadDialog).not.toBeVisible();
});

test('invalid calendar and allocator responses preserve the current form and show the local stack', async ({ page }) => {
    const entries = saves(2);
    let loadedBody = null;
    mockSaveList(page, entries);
    setApi(page, 'POST', '/api/new-game/settings/load', async route => {
        loadedBody = route.request().postDataJSON();
        const settings = loadedBody.saveName === entries[0].saveName
            ? settingsPayload({ playerName: 'Should not apply: calendar', startMonth: 99 })
            : settingsPayload({ playerName: 'Should not apply: allocator shape', skills: 'invalid' });
        await fulfillJson(route, 200, { success: true, saveName: loadedBody.saveName, settings });
    });

    await page.locator('#playerName').fill('Retain this character');
    await page.locator('#startDay').selectOption('5');
    await page.locator('#attr-strength').fill('13');
    await page.locator('#loadNewGameSettingsBtn').click();
    const loadDialog = page.locator('#loadNewGameSettingsDialog');
    await expect(page.locator('#newGameSettingsChoices input[type="radio"]')).toHaveCount(2);

    const errorDialog = page.locator('dialog.page-feedback-dialog');
    const firstChoice = page.locator('#newGameSettingsChoices input[type="radio"]').nth(0);
    await firstChoice.check();
    await page.locator('#loadNewGameSettingsSubmit').click();
    await expect(errorDialog).toBeVisible();
    await expect(errorDialog.locator('h2')).toHaveText('Operation stopped');
    await expect(errorDialog).toContainText('Saved starting month 99 is unavailable');
    await errorDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(loadDialog).toBeVisible();
    await expect(page.locator('#playerName')).toHaveValue('Retain this character');
    await expect(page.locator('#startDay')).toHaveValue('5');
    await expect(page.locator('#attr-strength')).toHaveValue('13');

    await page.locator('#newGameSettingsChoices input[type="radio"]').nth(1).check();
    await page.locator('#loadNewGameSettingsSubmit').click();
    await expect(errorDialog).toBeVisible();
    await expect(errorDialog.locator('h2')).toHaveText('Operation stopped');
    await expect(errorDialog).toContainText('Loaded settings skills must be an object');
    await errorDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('#playerName')).toHaveValue('Retain this character');
    await expect(page.locator('#startDay')).toHaveValue('5');
    await expect(page.locator('#attr-strength')).toHaveValue('13');
    expect(loadedBody.saveName).toBe(entries[1].saveName);
});

test('reviewed draft controls remain locked and mobile dialogs keep actions reachable', async ({ page }) => {
    let draftReadFinished;
    setApi(page, 'GET', '/api/new-game/drafts/story-authoring:fixture-token', route => new Promise(resolve => {
        draftReadFinished = async () => {
            await fulfillJson(route, 200, {
                success: true,
                draft: { fields: settingsPayload({ playerName: 'Reviewed Protagonist' }) }
            });
            resolve();
        };
    }));

    await page.goto(`${FIXTURE_URL}?draftToken=story-authoring%3Afixture-token`);
    await expect.poll(() => typeof draftReadFinished).toBe('function');
    await expect(page.locator('#saveNewGameSettingsBtn')).toBeDisabled();
    await expect(page.locator('#loadNewGameSettingsBtn')).toBeDisabled();
    await expect(page.locator('#startBtn')).toBeDisabled();
    await draftReadFinished();
    await expect(page.locator('#playerName')).toHaveValue('Reviewed Protagonist');
    await expect(page.locator('#playerName')).toBeDisabled();
    await expect(page.locator('#attr-strength')).toBeDisabled();
    await expect(page.locator('#saveNewGameSettingsBtn')).toBeDisabled();
    await expect(page.locator('#loadNewGameSettingsBtn')).toBeDisabled();
    await expect(page.locator('#startBtn')).toBeEnabled();
    expect(harnesses.get(page).unexpectedRequests.filter(request => request.url.includes('/api/new-game/settings/'))).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    // Use a fresh non-draft fixture for the responsive dialog because reviewed forms stay locked.
    await page.goto(FIXTURE_URL);
    mockSaveList(page, saves(36));
    await page.locator('#loadNewGameSettingsBtn').click();
    const dialog = page.locator('#loadNewGameSettingsDialog');
    await expect(dialog).toBeVisible();
    const dialogBounds = await dialog.boundingBox();
    expect(dialogBounds.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(390);
    await page.locator('#newGameSettingsChoices input[type="radio"]').last().check();
    const loadButton = page.locator('#loadNewGameSettingsSubmit');
    await loadButton.scrollIntoViewIfNeeded();
    await expect(loadButton).toBeVisible();
    const buttonBounds = await loadButton.boundingBox();
    expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(390);
});

test('a failed reviewed draft keeps Start disabled', async ({ page }) => {
    setApi(page, 'GET', '/api/new-game/drafts/story-authoring:failed-token', async route => {
        await fulfillJson(route, 404, {
            success: false,
            error: 'Reviewed setup is no longer available.',
            stack: 'Error: Reviewed setup is no longer available.\n    at readReviewedDraft (api.js:54001:7)'
        });
    });
    await page.goto(`${FIXTURE_URL}?draftToken=story-authoring%3Afailed-token`);
    const errorDialog = page.locator('dialog.page-feedback-dialog');
    await expect(errorDialog).toBeVisible();
    await expect(errorDialog).toContainText('Reviewed setup is no longer available.');
    await expect(page.locator('#startBtn')).toBeDisabled();
});

test('without a world, no-world notices stay active and the disabled form cannot start or load a draft', async ({ page }) => {
    const harness = harnesses.get(page);
    harness.apiRequests.length = 0;
    harness.webSockets.length = 0;
    harness.pageErrors.length = 0;
    harness.blockNewGameScript = true;

    const noWorldUrl = `${FIXTURE_URL}?fixtureWorld=none&draftToken=story-authoring%3Afixture-token`;
    await page.goto(noWorldUrl);
    const form = page.locator('#newGameForm');
    const controls = page.locator('#newGameControls');
    await expect(form).toBeVisible();
    await expect(form).toHaveAttribute('data-world-loaded', 'false');
    await expect(controls).toHaveJSProperty('disabled', true);
    await expect(page.locator('#playerName')).toBeDisabled();

    for (const noticeId of ['newGameWorldNoticeTop', 'newGameWorldNoticeBottom']) {
        const notice = page.locator(`#${noticeId}`);
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('No world is loaded');
        const link = notice.getByRole('link', { name: 'Worlds', exact: true });
        await expect(link).toHaveAttribute('href', '/settings');
        await expect(link).toBeEnabled();
    }
    await expect(page.locator('#saveNewGameSettingsBtn')).toBeDisabled();
    await expect(page.locator('#loadNewGameSettingsBtn')).toBeDisabled();
    await expect(page.locator('#startBtn')).toBeDisabled();
    expect(harness.blockedNewGameScripts).toBe(1);

    const backLink = controls.getByRole('link', { name: /Back to Chat/ });
    await expect(backLink).toHaveAttribute('href', '/');
    await expect(backLink).toBeEnabled();
    const headerWorldsLink = page.locator('.app-header .app-nav a[href="/settings"]');
    await expect(headerWorldsLink).toHaveCount(1);
    await expect(headerWorldsLink).toBeEnabled();
    await page.locator('.app-header__brand').focus();
    await expect(page.locator('.app-header__brand')).toBeFocused();

    await page.screenshot({ path: path.join(ROOT, 'tmp', 'new-game-no-world-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(ROOT, 'tmp', 'new-game-no-world-mobile.png'), fullPage: true });
    for (const noticeId of ['newGameWorldNoticeTop', 'newGameWorldNoticeBottom']) {
        const notice = page.locator(`#${noticeId}`);
        const bounds = await notice.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
        const linkBounds = await notice.getByRole('link', { name: 'Worlds', exact: true }).boundingBox();
        expect(linkBounds.x).toBeGreaterThanOrEqual(0);
        expect(linkBounds.x + linkBounds.width).toBeLessThanOrEqual(390);
    }
    const topLink = page.locator('#newGameWorldNoticeTop a');
    const bottomLink = page.locator('#newGameWorldNoticeBottom a');
    await topLink.focus();
    await expect(topLink).toBeFocused();
    await bottomLink.focus();
    await expect(bottomLink).toBeFocused();

    expect(harness.apiRequests.filter(request => request !== 'GET /api/pending-load')).toEqual([]);
    expect(harness.webSockets).toEqual([]);

    harness.blockNewGameScript = false;
    await page.reload();
    await expect(form).toHaveAttribute('data-world-loaded', 'false');
    await expect(controls).toHaveJSProperty('disabled', true);
    const defaultPrevented = await form.evaluate(element => {
        const event = new Event('submit', { bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
    });
    expect(defaultPrevented).toBe(true);
    expect(harness.apiRequests.filter(request => request !== 'GET /api/pending-load')).toEqual([]);
    expect(harness.webSockets).toEqual([]);
});
