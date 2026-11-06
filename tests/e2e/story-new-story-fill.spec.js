const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');
const StoryProject = require('../../mods/story-authoring/StoryProject');

const ROOT = path.resolve(__dirname, '..', '..');
const VIEWS_ROOT = path.join(ROOT, 'views');
const MOD_VIEWS_ROOT = path.join(ROOT, 'mods', 'story-authoring', 'views');
const PAGE_PATH = '/mods/story-authoring/pages/stories';
const API_BASE = '/api/mods/story-authoring';
const BASE_URL = 'http://127.0.0.1:4175';
const ARTIFACT_ROOT = path.join(ROOT, 'tmp', 'story-generation-instructions-final-2');
const viewEnvironment = new nunjucks.Environment(
    new nunjucks.FileSystemLoader([VIEWS_ROOT, MOD_VIEWS_ROOT]),
    { autoescape: true, throwOnUndefined: false }
);

function json(route, payload, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
}

function makeProject(body) {
    const project = StoryProject.create({
        requestId: body.requestId,
        title: body.title,
        premise: body.premise,
        mainPlot: body.mainPlot,
        style: body.style,
        constraints: body.constraints,
        authorNotes: body.authorNotes
    });
    for (const node of Object.values(project.nodes)) node.reviewStatus = 'draft';
    return project;
}

function candidateFrom(draft) {
    return {
        title: draft.title,
        premise: draft.premise,
        mainPlot: draft.mainPlot || 'The keeper exposes the bell-signal conspiracy and restores the harbor archive.',
        authorNotes: draft.authorNotes || 'Generated author notes from the premise.',
        constraints: draft.constraints?.length ? draft.constraints : ['Keep the storm close to the harbor.'],
        style: draft.style || 'A restrained maritime mystery.'
    };
}

function renderDocument() {
    return viewEnvironment.render('mod-page.njk', {
        page: { title: 'Stories', template: 'story-editor.njk' },
        pageTitleValue: 'Stories — AI RPG',
        appHeaderTitle: 'Stories',
        currentPage: 'story-authoring:stories',
        modNavigationItems: [{ url: PAGE_PATH, modName: 'story-authoring', id: 'stories', navigationLabel: 'Stories' }],
        modStyles: ['/mods/story-authoring/public/css/story-editor.css'],
        modScripts: ['/mods/story-authoring/public/js/story-editor.js']
    });
}

function contentType(filename) {
    return filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
}

async function expandCreationOptions(page) {
    const disclosure = page.locator('#story-dialog [data-disclosure="new-options"]');
    if (!(await disclosure.evaluate(element => element.open))) await disclosure.locator(':scope > summary').click();
    await expect(disclosure).toHaveJSProperty('open', true);
}

async function startNewStoryFill(page, instructions = '') {
    await page.locator('#story-new-fill').click();
    await expect(page.locator('#story-instructions-form')).toBeVisible();
    if (instructions) await page.locator('#story-generation-feedback').fill(instructions);
    await page.locator('#story-instructions-generate').click();
}

async function installFixture(page, { mode = 'success', delayLaunch = false } = {}) {
    fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
    const state = {
        mode,
        library: [],
        projects: new Map(),
        jobs: new Map(),
        requests: [],
        released: false,
        pageErrors: [],
        unexpected: []
    };
    let signalLaunchArrived;
    let releaseLaunch;
    state.launchArrived = new Promise(resolve => { signalLaunchArrived = resolve; });
    state.releaseLaunch = new Promise(resolve => { releaseLaunch = resolve; });
    state.signalLaunchArrived = signalLaunchArrived;
    state.releaseDelayedLaunch = releaseLaunch;
    page.on('pageerror', error => state.pageErrors.push(error.stack || error.message));
    await page.addInitScript(() => {
        // PageFeedbackController stays real; only its websocket transport has no server.
        window.WebSocket = class MockWebSocket extends EventTarget {
            constructor(url) { super(); this.url = String(url); this.readyState = 1; }
            send() {}
            close() { this.readyState = 3; }
        };
    });

    await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const pathname = decodeURIComponent(url.pathname);
        if (url.origin !== BASE_URL) {
            if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort();
            state.unexpected.push({ url: url.href, reason: 'External transport is blocked.' });
            return route.abort();
        }

        if (pathname === PAGE_PATH || pathname.startsWith(`${PAGE_PATH}/`)) {
            return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: renderDocument() });
        }
        if (pathname.startsWith('/api/')) {
            const body = request.method() === 'GET' || !request.postData() ? undefined : request.postDataJSON();
            state.requests.push({ method: request.method(), path: pathname, body });
            if (pathname === '/api/pending-load' && request.method() === 'GET') return json(route, { success: true, pendingLoad: null });
            if (pathname === `${API_BASE}/stories` && request.method() === 'GET') return json(route, { success: true, stories: state.library });
            if (pathname === `${API_BASE}/sources` && request.method() === 'GET') return json(route, { success: true, runtime: { loaded: false }, worlds: [], protagonists: [] });

            const generationPath = `${API_BASE}/story-drafts/generations`;
            if (pathname === generationPath && request.method() === 'POST') {
                const id = body.requestId;
                const job = {
                    id, requestId: body.requestId, kind: 'create-fill', status: 'running', feedback: body.feedback || '', promptIds: ['mock-create-fill-prompt'],
                    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), draft: structuredClone(body.draft),
                    candidate: null, error: null
                };
                state.jobs.set(id, job);
                if (delayLaunch) {
                    state.signalLaunchArrived();
                    await state.releaseLaunch;
                }
                return json(route, { success: true, job });
            }
            const jobMatch = pathname.match(new RegExp(`^${API_BASE}/story-drafts/jobs/([^/]+)$`));
            if (jobMatch && request.method() === 'GET') {
                const job = state.jobs.get(jobMatch[1]);
                if (!job) return json(route, { success: false, error: 'Creation fill job was not found.' }, 404);
                if (state.released && job.status === 'running') {
                    if (state.mode === 'error') {
                        job.status = 'failed';
                        job.error = { error: 'Precreation fill failed with its original error.', stack: 'Error: Precreation fill failed with its original error.\n    at mocked provider', code: 'MOCK_PROVIDER_ERROR' };
                    } else if (state.mode === 'cancelled') {
                        job.status = 'cancelled';
                    } else {
                        job.status = 'completed';
                        job.candidate = candidateFrom(job.draft);
                    }
                }
                return json(route, { success: true, job });
            }
            const cancelMatch = pathname.match(new RegExp(`^${API_BASE}/story-drafts/jobs/([^/]+)/cancel$`));
            if (cancelMatch && request.method() === 'POST') {
                const job = state.jobs.get(cancelMatch[1]);
                if (!job) return json(route, { success: false, error: 'Creation fill job was not found.' }, 404);
                job.status = 'cancelled';
                return json(route, { success: true, job });
            }
            if (pathname === `${API_BASE}/stories` && request.method() === 'POST') {
                const project = makeProject(body);
                state.projects.set(project.id, project);
                state.library.push({ id: project.id, title: project.title, premise: project.premise, revision: project.revision, createdAt: project.createdAt, updatedAt: project.updatedAt, archived: false, binding: null });
                return json(route, { success: true, project });
            }
            const projectMatch = pathname.match(new RegExp(`^${API_BASE}/stories/([^/]+)$`));
            if (projectMatch && request.method() === 'GET') {
                const project = state.projects.get(projectMatch[1]);
                if (!project) return json(route, { success: false, error: 'Story was not found.' }, 404);
                return json(route, { success: true, project });
            }
            state.unexpected.push({ method: request.method(), path: pathname, body });
            return json(route, { success: false, error: `Unexpected mocked API request: ${request.method()} ${pathname}` }, 500);
        }

        const assetPrefix = pathname.startsWith('/mods/story-authoring/public/')
            ? path.join(ROOT, 'mods', 'story-authoring', 'public')
            : pathname.startsWith('/css/') || pathname.startsWith('/js/')
                ? path.join(ROOT, 'public')
                : null;
        if (assetPrefix) {
            const assetPath = pathname.startsWith('/mods/story-authoring/public/')
                ? path.resolve(ROOT, `.${pathname}`)
                : path.resolve(ROOT, 'public', `.${pathname}`);
            const allowedRoot = pathname.startsWith('/mods/story-authoring/public/')
                ? path.join(ROOT, 'mods', 'story-authoring', 'public')
                : ROOT;
            if (assetPath.startsWith(`${allowedRoot}${path.sep}`) && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
                return route.fulfill({ status: 200, contentType: contentType(assetPath), body: fs.readFileSync(assetPath) });
            }
            state.unexpected.push({ method: request.method(), path: pathname, reason: 'Missing local page asset.' });
            return route.fulfill({ status: 404, body: 'Missing local fixture asset.' });
        }
        if (pathname.startsWith('/assets/')) return route.abort();
        state.unexpected.push({ method: request.method(), path: pathname, reason: 'Unexpected page request.' });
        return route.fulfill({ status: 404, body: 'Unexpected fixture request.' });
    });

    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('#story-library')).toBeVisible();
    await page.waitForFunction(() => Boolean(window.AIRPG_PAGE_FEEDBACK && window.AIRPG_STORY_EDITOR));
    return state;
}

async function assertModalAboveHeader(page) {
    const result = await page.locator('#story-dialog').evaluate(dialog => {
        const title = dialog.querySelector('#story-dialog-title');
        const close = dialog.querySelector('[data-action="close-dialog"]');
        const header = document.querySelector('.app-header');
        const point = element => {
            const rect = element.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, top: rect.top, right: rect.right, bottom: rect.bottom };
        };
        const titlePoint = point(title), closePoint = point(close);
        const titleHit = document.elementFromPoint(titlePoint.x, titlePoint.y);
        const closeHit = document.elementFromPoint(closePoint.x, closePoint.y);
        return {
            titleHitInside: Boolean(titleHit && (titleHit === title || title.contains(titleHit))),
            closeHitInside: Boolean(closeHit && (closeHit === close || close.contains(closeHit))),
            titleCoveredByHeader: Boolean(titleHit && header.contains(titleHit)),
            closeCoveredByHeader: Boolean(closeHit && header.contains(closeHit)),
            titleTop: titlePoint.top,
            closeRight: closePoint.right,
            closeBottom: closePoint.bottom,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight
        };
    });
    expect(result.titleHitInside, JSON.stringify(result)).toBeTruthy();
    expect(result.closeHitInside, JSON.stringify(result)).toBeTruthy();
    expect(result.titleCoveredByHeader, JSON.stringify(result)).toBeFalsy();
    expect(result.closeCoveredByHeader, JSON.stringify(result)).toBeFalsy();
    expect(result.titleTop).toBeGreaterThanOrEqual(0);
    expect(result.closeRight).toBeLessThanOrEqual(result.viewportWidth);
    expect(result.closeBottom).toBeLessThanOrEqual(result.viewportHeight);
}

test('new story fill waits for Create, preserves seeds and typing, and keeps dialogs layered', async ({ page }) => {
    const state = await installFixture(page);
    const newStory = page.getByRole('button', { name: 'New story' });
    for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await newStory.click();
        await expect(page.getByRole('dialog', { name: 'New story' })).toBeVisible();
        await assertModalAboveHeader(page);
        await expect(page.locator('#story-new-fill')).toBeFocused();
        await expect(page.getByLabel('Main plot')).toBeVisible();
        await expandCreationOptions(page);
        await page.screenshot({
            path: path.join(ARTIFACT_ROOT, viewport.width === 390 ? 'story-create-modal-mobile.png' : 'story-create-modal-desktop.png'),
            fullPage: true
        });
        await page.locator('#story-new-fill').click();
        await expect(page.locator('#story-instructions-form')).toBeVisible();
        await assertModalAboveHeader(page);
        await page.locator('#story-generation-feedback').fill('Use a finite arc that respects the Main plot.');
        await page.screenshot({
            path: path.join(ARTIFACT_ROOT, viewport.width === 390 ? 'story-instructions-new-mobile.png' : 'story-instructions-new-desktop.png'),
            fullPage: true
        });
        await page.keyboard.press('Escape');
        await expect(page.locator('#story-dialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#story-dialog')).toBeHidden();
        await expect(newStory).toBeFocused();
    }

    await page.setViewportSize({ width: 1365, height: 900 });
    await newStory.click();
    const dialog = page.getByRole('dialog', { name: 'New story' });
    await page.locator('#story-new-title').fill('The Glass Harbor');
    await page.locator('#story-new-premise').fill('A keeper seeks the tide ledger before the flood gates close.');
    await expandCreationOptions(page);
    await page.locator('#story-new-notes').fill('Keep the archivist cautious.');
    await page.evaluate(() => { window.__parentTitleControl = document.querySelector('#story-new-title'); });
    await page.locator('#story-new-fill').click();
    await expect(page.locator('#story-instructions-form')).toBeVisible();
    expect(state.requests.some(request => request.method === 'POST' && request.path.endsWith('/story-drafts/generations'))).toBeFalsy();
    await expect(page.locator('#story-generation-feedback')).toBeVisible();
    await page.locator('#story-generation-feedback').fill('Keep the conspiracy human-scale.');
    await page.locator('#story-instructions-generate').click();

    await expect.poll(() => state.requests.filter(request => request.method === 'POST' && request.path.endsWith('/story-drafts/generations')).length).toBe(1);
    await expect(page.locator('#story-new-fill-cancel')).toBeVisible();
    expect(state.requests.some(request => request.method === 'POST' && request.path === `${API_BASE}/stories`)).toBeFalsy();
    const fillRequest = state.requests.find(request => request.path.endsWith('/story-drafts/generations'));
    expect(fillRequest.body.feedback).toBe('Keep the conspiracy human-scale.');
    expect(await page.evaluate(() => document.querySelector('#story-new-title') === window.__parentTitleControl)).toBeTruthy();
    expect(fillRequest.body.draft).toMatchObject({
        title: 'The Glass Harbor',
        premise: 'A keeper seeks the tide ledger before the flood gates close.',
        mainPlot: '',
        authorNotes: 'Keep the archivist cautious.'
    });

    await page.locator('#story-new-style').fill('Typed while generation was pending.');
    state.released = true;
    await expect(page.locator('#story-new-style')).toHaveValue('Typed while generation was pending.', { timeout: 10000 });
    await expect(page.locator('#story-new-constraints')).toHaveValue('Keep the storm close to the harbor.');
    await expect(page.locator('#story-new-notes')).toHaveValue('Keep the archivist cautious.');
    await expect(page.locator('#story-new-main-plot')).toHaveValue('The keeper exposes the bell-signal conspiracy and restores the harbor archive.');
    expect(state.requests.some(request => request.method === 'POST' && request.path === `${API_BASE}/stories`)).toBeFalsy();
    expect(state.library).toHaveLength(0);

    await page.screenshot({ path: path.join(ARTIFACT_ROOT, 'story-create-filled-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Create story' }).click();
    await expect.poll(() => state.requests.filter(request => request.method === 'POST' && request.path === `${API_BASE}/stories`).length).toBe(1);
    await expect(page.locator('#story-edit-form')).toBeVisible();
    expect(state.library).toHaveLength(1);
    expect(state.library[0].title).toBe('The Glass Harbor');
    const createRequest = state.requests.find(request => request.method === 'POST' && request.path === `${API_BASE}/stories`);
    expect(createRequest.body.mainPlot).toBe('The keeper exposes the bell-signal conspiracy and restores the harbor archive.');
    const createdProject = state.projects.values().next().value;
    expect(createdProject.nodes[createdProject.rootId].content.outline).toBe(createRequest.body.mainPlot);
    await expect(page.locator('#story-field-outline')).toBeVisible();
    await expect(page.locator('#story-edit-form [data-field="outline"]')).toHaveValue(createRequest.body.mainPlot);
    const rootLabels = await page.locator('#story-edit-form label').allTextContents();
    expect(rootLabels.indexOf('Premise')).toBeLessThan(rootLabels.indexOf('Main plot'));
    expect(rootLabels.indexOf('Main plot')).toBeLessThan(rootLabels.indexOf('Intent'));
    await page.screenshot({ path: path.join(ARTIFACT_ROOT, 'story-main-plot-root-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(ARTIFACT_ROOT, 'story-main-plot-root-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1365, height: 900 });

    const regenerate = page.getByRole('button', { name: 'Regenerate…' });
    await regenerate.click();
    await expect(page.getByRole('dialog', { name: 'Regenerate suggestion' })).toBeVisible();
    await expect(page.locator('#story-dialog-body')).toContainText('Suggestion scope');
    await expect(page.locator('#story-dialog-body')).toContainText('Generation instructions (optional)');
    await page.keyboard.press('Escape');
    await expect(page.locator('#story-dialog')).toBeHidden();
    await expect(regenerate).toBeFocused();
    expect(state.pageErrors).toEqual([]);
    expect(state.unexpected).toEqual([]);
});

test('new story fill provider errors retain the creation draft and show shared feedback above the native dialog', async ({ page }) => {
    const state = await installFixture(page, { mode: 'error' });
    await page.getByRole('button', { name: 'New story' }).click();
    await page.locator('#story-new-title').fill('The Storm Ledger');
    await page.locator('#story-new-premise').fill('An archivist protects a ledger as floodwater rises.');
    await expandCreationOptions(page);
    await page.locator('#story-new-notes').fill('Do not turn the keeper into a villain.');
    await startNewStoryFill(page, 'Let a failed attempt remain dramatically valid.');
    await expect.poll(() => state.jobs.size).toBe(1);
    state.released = true;
    const feedback = page.locator('dialog.page-feedback-dialog[open]');
    await expect(feedback).toBeVisible({ timeout: 10000 });
    await expect(feedback).toContainText('Precreation fill failed with its original error.');
    const layerCheck = await feedback.evaluate(dialog => {
        const rect = dialog.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(hit && dialog.contains(hit));
    });
    expect(layerCheck).toBeTruthy();
    await page.screenshot({ path: path.join(ARTIFACT_ROOT, 'story-create-fill-error-layer.png'), fullPage: true });
    expect(await page.locator('#story-dialog').isVisible()).toBeTruthy();
    await page.keyboard.press('Escape');
    await expect(feedback).toBeHidden();
    await expect(page.locator('#story-dialog')).toBeVisible();
    await expect(page.locator('#story-new-title')).toHaveValue('The Storm Ledger');
    await expect(page.locator('#story-new-premise')).toHaveValue('An archivist protects a ledger as floodwater rises.');
    await expect(page.locator('#story-new-notes')).toHaveValue('Do not turn the keeper into a villain.');

    const failedJob = Array.from(state.jobs.values())[0];
    expect(failedJob.status).toBe('failed');
    expect(state.library).toHaveLength(0);
    expect(state.pageErrors).toEqual([]);
    expect(state.unexpected).toEqual([]);
});

test('new story fill cancellation retains draft values without creating a story', async ({ page }) => {
    const state = await installFixture(page, { mode: 'cancelled' });
    await page.getByRole('button', { name: 'New story' }).click();
    await page.locator('#story-new-title').fill('The Storm Ledger');
    await page.locator('#story-new-premise').fill('An archivist protects a ledger as floodwater rises.');
    await expandCreationOptions(page);
    await page.locator('#story-new-notes').fill('Do not turn the keeper into a villain.');
    await startNewStoryFill(page, 'Preserve the keeper’s agency.');
    await expect.poll(() => state.jobs.size).toBe(1);
    const latestJob = Array.from(state.jobs.values())[0];
    await page.locator('#story-new-fill-cancel').click();
    await expect.poll(() => state.requests.some(request => request.method === 'POST' && request.path.endsWith(`/story-drafts/jobs/${latestJob.id}/cancel`))).toBeTruthy();
    expect(latestJob.status).toBe('cancelled');
    await expect(page.locator('#story-new-title')).toHaveValue('The Storm Ledger');
    await expect(page.locator('#story-new-notes')).toHaveValue('Do not turn the keeper into a villain.');
    expect(latestJob.status).toBe('cancelled');
    expect(state.library).toHaveLength(0);
    expect(state.pageErrors).toEqual([]);
    expect(state.unexpected).toEqual([]);
});

test('closing while the launch request is pending cancels its late job and retains the reopened draft', async ({ page }) => {
    const state = await installFixture(page, { delayLaunch: true });
    const newStory = page.getByRole('button', { name: 'New story' });
    await newStory.click();
    await page.locator('#story-new-title').fill('The Delayed Tide');
    await page.locator('#story-new-premise').fill('A keeper races the closing harbor gates.');
    await startNewStoryFill(page, 'Follow the harbor ledger conflict.');
    await state.launchArrived;

    await page.keyboard.press('Escape');
    await expect(page.locator('#story-instructions-form')).toBeHidden();
    await expect(page.locator('#story-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#story-dialog')).toBeHidden();
    await newStory.click();
    await expect(page.locator('#story-new-title')).toHaveValue('The Delayed Tide');
    await expect(page.locator('#story-new-premise')).toHaveValue('A keeper races the closing harbor gates.');
    state.releaseDelayedLaunch();

    await expect.poll(() => state.requests.some(request => request.method === 'POST' && request.path.endsWith(`/story-drafts/jobs/${Array.from(state.jobs.keys())[0]}/cancel`))).toBeTruthy();
    expect(Array.from(state.jobs.values())[0].status).toBe('cancelled');
    await expect(page.locator('#story-new-title')).toHaveValue('The Delayed Tide');
    await expect(page.locator('#story-new-premise')).toHaveValue('A keeper races the closing harbor gates.');
    expect(state.library).toHaveLength(0);
    expect(state.pageErrors).toEqual([]);
    expect(state.unexpected).toEqual([]);
});

test('persisted pagehide keeps Stories dialog and nested instructions usable until real unload', async ({ page }) => {
    const state = await installFixture(page);
    const newStory = page.getByRole('button', { name: 'New story' });
    await newStory.click();
    await page.locator('#story-new-title').fill('Cached story');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.locator('#story-new-premise').fill('Draft survives the cached page.');
    await page.locator('#story-new-fill').click();
    await expect(page.locator('#story-instructions-form')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#story-new-title')).toHaveValue('Cached story');
    await page.keyboard.press('Escape');
    await expect(page.locator('#story-dialog')).toBeHidden();
    await newStory.click();
    await expect(page.locator('#story-new-premise')).toHaveValue('Draft survives the cached page.');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await expect(page.locator('#story-dialog')).not.toHaveJSProperty('open', true);
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);
    expect(state.pageErrors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('Stories reviewed scalar fields retain types, escaped text and unavailable options', async ({ page }) => {
    const state = await installFixture(page);
    await page.evaluate(() => {
        const editor = window.AIRPG_STORY_EDITOR;
        editor.setupDescriptors = { settingFields: [
            { key: 'count', kind: 'number' }, { key: 'enabled', kind: 'boolean' }, { key: 'note', kind: 'nullable' },
            { key: 'description', kind: 'string' }, { key: 'tags', kind: 'strings' },
            { key: 'mode', kind: 'string', options: [{ value: 'known', label: 'Known' }] }
        ] };
        editor.setupProposalId = 'fixture-review';
        window.fixtureReviewed = { settingFields: { count: 0, enabled: false, note: null, description: 'Line <one> & "two"\nnext', tags: ['first', 'second'], mode: 'unavailable' } };
        const form = document.createElement('form'); form.id = 'fixture-reviewed-fields';
        form.innerHTML = editor.typedFields(window.fixtureReviewed.settingFields, ['settingFields']);
        document.body.append(form);
        const readonly = document.createElement('div'); readonly.id = 'fixture-readonly-fields';
        readonly.innerHTML = editor.typedFields(window.fixtureReviewed.settingFields, ['settingFields'], true);
        document.body.append(readonly);
    });
    const form = page.locator('#fixture-reviewed-fields');
    await expect(form.locator('#story-typed-settingFields-count')).toHaveValue('0');
    await expect(form.locator('#story-typed-settingFields-enabled')).not.toBeChecked();
    await expect(form.locator('#story-typed-settingFields-note')).toHaveValue('');
    await expect(form.locator('#story-typed-settingFields-description')).toHaveValue('Line <one> & "two"\nnext');
    await expect(form.locator('#story-typed-settingFields-mode')).toHaveValue('unavailable');
    await expect(page.locator('#fixture-readonly-fields #story-typed-settingFields-enabled')).toBeDisabled();
    await expect(page.locator('#fixture-readonly-fields #story-typed-settingFields-description')).toHaveAttribute('readonly', '');
    await form.locator('#story-typed-settingFields-description').fill('Edited <text>\nnew line');
    expect(await page.evaluate(() => window.AIRPG_STORY_EDITOR.readTyped(window.fixtureReviewed, document.querySelector('#fixture-reviewed-fields')))).toEqual({ settingFields: { count: 0, enabled: false, note: null, description: 'Edited <text>\nnew line', tags: ['first', 'second'], mode: 'unavailable' } });
    expect(state.pageErrors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('reviewed setup redraw preserves nested entries and restores optional values with focus', async ({ page }) => {
    const state = await installFixture(page);
    await page.evaluate(async () => {
        const editor = window.AIRPG_STORY_EDITOR;
        const id = 'nested-review';
        const sources = { world: null, protagonist: null };
        const proposal = { id, jobId: 'nested-job', candidate: {
            worldBrief: 'A <literal> world', protagonistBrief: '',
            settingFields: { options: { count: 0, enabled: false, note: null, text: 'A <literal> & "quoted"' }, mapping: { alpha: 'map <literal>' }, entries: [{ name: 'first', count: 0 }] },
            newGameFields: {}
        } };
        editor.project = { id: 'nested-story', title: 'Nested', sources, jobs: { 'nested-job': { id: 'nested-job', sourceSelection: sources } }, proposals: { [id]: proposal }, materializations: {} };
        editor.sourceCatalog = { protagonists: [], setupFieldDescriptors: {
            settingFields: [
                { key: 'options', kind: 'object', properties: [
                    { key: 'count', kind: 'number' }, { key: 'enabled', kind: 'boolean' },
                    { key: 'note', kind: 'nullable' }, { key: 'text', kind: 'string' },
                    { key: 'extra', kind: 'string' }
                ] },
                { key: 'mapping', kind: 'map', keyChoices: ['alpha', 'beta'], value: { kind: 'string' } },
                { key: 'entries', kind: 'collection', item: { kind: 'object', initialValue: { name: '', count: 0 }, properties: [{ key: 'name', kind: 'string' }, { key: 'count', kind: 'number' }] } }
            ], newGameFields: []
        } };
        editor.lastSourcePreview = { sources };
        editor.lastSourcePreviewStoryId = editor.project.id;
        await editor.setupReview(proposal);
    });
    const dialog = page.locator('#story-dialog');
    const field = name => dialog.locator(`#story-typed-settingFields-options-${name}`);
    await expect(field('count')).toHaveValue('0');
    await expect(field('enabled')).not.toBeChecked();
    await expect(field('note')).toHaveValue('');
    await expect(field('text')).toHaveValue('A <literal> & "quoted"');
    await dialog.getByText('Options', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Remove Text', exact: true }).click();
    await dialog.locator('#story-add-settingFields-options').selectOption('text');
    await dialog.getByRole('button', { name: 'Add selected detail' }).last().click();
    await expect(field('text')).toHaveValue('A <literal> & "quoted"');
    await expect(field('text')).toBeFocused();
    await expect(field('text').locator('xpath=ancestor::details[1]')).toHaveJSProperty('open', true);
    await dialog.getByText('Mapping', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Remove Alpha' }).click();
    await dialog.locator('#story-add-settingFields-mapping').selectOption('alpha');
    await dialog.locator('#story-add-settingFields-mapping').locator('..').getByRole('button', { name: 'Add selected detail' }).click();
    await expect(dialog.locator('#story-typed-settingFields-mapping-alpha')).toHaveValue('map <literal>');
    await expect(dialog.locator('#story-typed-settingFields-mapping-alpha')).toBeFocused();
    await dialog.getByRole('button', { name: 'Duplicate entry for editing' }).click();
    await expect(dialog.locator('#story-typed-settingFields-entries-1-name')).toHaveValue('first');
    await expect(dialog.locator('#story-typed-settingFields-entries-1-name')).toBeFocused();
    await dialog.getByRole('button', { name: 'Remove this entry' }).last().click();
    await dialog.getByRole('button', { name: 'Remove this entry' }).click();
    await dialog.getByRole('button', { name: 'Restore entry with reviewed fields' }).click();
    await expect(dialog.locator('#story-typed-settingFields-entries-0-name')).toHaveValue('first');
    await dialog.getByRole('button', { name: 'Add entry', exact: true }).click();
    await expect(dialog.locator('#story-typed-settingFields-entries-1-name')).toHaveValue('');
    await expect(dialog.locator('#story-typed-settingFields-entries-1-name')).toBeFocused();
    const draft = await page.evaluate(() => window.AIRPG_STORY_EDITOR.readTyped(window.AIRPG_STORY_EDITOR.setupDrafts['nested-review'], document.querySelector('#story-setup-review')));
    expect(draft.settingFields).toEqual({ options: { count: 0, enabled: false, note: null, text: 'A <literal> & "quoted"' }, mapping: { alpha: 'map <literal>' }, entries: [{ name: 'first', count: 0 }, { name: '', count: 0 }] });
    expect(state.pageErrors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('Stories source view presents staged setup receipts and explicit handoff', async ({ page }) => {
    const state = await installFixture(page);
    await page.evaluate(() => {
        const editor = window.AIRPG_STORY_EDITOR;
        editor.project = { id: 'receipts-story', revision: 1, sources: { world: null, protagonist: null }, materializations: {
            staged: { id: 'staged', status: 'awaiting-start', settingFields: { name: 'Reviewed <world>' }, stages: { profileSaved: true, characterCreated: false }, draftToken: 'token & value' },
            failed: { id: 'failed', status: 'failed', stages: { profileSaved: true, characterCreated: false }, error: { error: 'Setup <error>', stack: 'trace & detail' } },
            done: { id: 'done', status: 'completed', stages: { characterCreated: true } }
        } };
        editor.sourceCatalog = { worlds: [], protagonists: [] };
        editor.renderSources();
        document.querySelector('#story-workspace').hidden = false;
    });
    const receipts = page.locator('#story-setup-receipts');
    await expect(receipts).toContainText('Reviewed <world> · awaiting-start');
    await expect(receipts).toContainText('Profile Saved: Complete');
    await expect(receipts).toContainText('Character Created: Pending');
    await expect(receipts).toContainText('Setup <error>');
    await expect(receipts.getByRole('button', { name: 'Resume this setup' })).toBeVisible();
    await expect(receipts.getByRole('link', { name: /explicit Start required/ })).toHaveAttribute('href', '/new-game?draftToken=token%20%26%20value');
    await expect(receipts).toContainText('Actual setup complete. Story writing is paused until you review and start it in Play.');
    await receipts.getByText('Error details').click();
    await expect(receipts.locator('pre')).toHaveText('trace & detail');
    expect(state.pageErrors).toEqual([]); expect(state.unexpected).toEqual([]);
});
