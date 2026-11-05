const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { test, expect } = require('@playwright/test');
const StoryProject = require('../../mods/story-authoring/StoryProject');
const StoryGenerationService = require('../../mods/story-authoring/StoryGenerationService');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE_BASE = '/mods/story-authoring/pages/stories';
const API_BASE = '/api/mods/story-authoring';
const BASE_URL = 'http://127.0.0.1:4174';
const outputDirectory = path.join(ROOT, 'tmp', 'story-form-fill-instructions');
const viewEnvironment = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(path.join(ROOT, 'mods', 'story-authoring', 'views')),
    { autoescape: true, throwOnUndefined: false }
);

function completedPatch(draft) {
    const patch = { content: {} };
    for (const [key, value] of Object.entries(draft.content)) {
        if (Array.isArray(value) ? value.length === 0 : !value.trim()) {
            patch.content[key] = Array.isArray(value)
                ? ['characterRefs', 'placeRefs'].includes(key) ? [] : [`Generated ${key}.`]
                : `Generated ${key}.`;
        }
    }
    if (!draft.style.trim()) patch.style = 'A restrained harbor mystery.';
    return patch;
}

function renderPage(storyId, rootId) {
    const editor = viewEnvironment.render('story-editor.njk', { apiBase: API_BASE, storyId, nodeId: rootId });
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/public/css/main.css"><link rel="stylesheet" href="/mods/story-authoring/public/css/story-editor.css"></head><body>${editor}<script>window.AIRPG_PAGE_FEEDBACK={showError(error){(window.__storyErrors ||= []).push(error?.stack || error?.message || String(error));},trackJob(){},setJobs(){}};</script><script src="/public/js/widgets/controls.js"></script><script src="/public/js/widgets/overlays.js"></script><script src="/public/js/widgets/modal-stack.js"></script><script src="/public/js/modal-submit-shortcuts.js"></script><script src="/mods/story-authoring/public/js/story-editor.js"></script></body></html>`;
}

function decorateProject(project) {
    for (const node of Object.values(project.nodes)) node.reviewStatus = 'draft';
    return project;
}

test('Generate missing fields preserves typing made while generation is pending', async ({ page }) => {
    fs.mkdirSync(outputDirectory, { recursive: true });
    const project = decorateProject(StoryProject.create({
        requestId: 'form-fill-browser-fixture',
        title: 'The Glass Harbor',
        premise: 'A keeper seeks the missing tide ledger.'
    }));
    const storyId = project.id;
    const rootId = project.rootId;
    let pendingJob = null;
    let proposal = null;
    let released = false;
    const requests = [];
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.stack || error.message));

    await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const pathname = decodeURIComponent(url.pathname);
        if (url.origin !== BASE_URL) return route.abort();

        if (pathname === `${PAGE_BASE}/${storyId}/${rootId}`) {
            return route.fulfill({ status: 200, contentType: 'text/html', body: renderPage(storyId, rootId) });
        }
        if (['/public/js/modal-submit-shortcuts.js', '/public/js/widgets/overlays.js', '/public/js/widgets/modal-stack.js'].includes(pathname)) {
            return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, pathname.slice(1))) });
        }
        if (pathname.startsWith('/public/css/')) {
            const localPath = path.resolve(ROOT, `.${pathname}`);
            if (!localPath.startsWith(path.join(ROOT, 'public', 'css') + path.sep) || !fs.existsSync(localPath)) {
                return route.fulfill({ status: 404, body: 'Missing local application stylesheet.' });
            }
            return route.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(localPath) });
        }
        if (pathname.startsWith('/mods/story-authoring/public/')) {
            const localPath = path.resolve(ROOT, `.${pathname}`);
            if (!localPath.startsWith(path.join(ROOT, 'mods', 'story-authoring', 'public') + path.sep) || !fs.existsSync(localPath)) {
                return route.fulfill({ status: 404, body: 'Missing local story editor asset.' });
            }
            const contentType = pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
            return route.fulfill({ status: 200, contentType, body: fs.readFileSync(localPath) });
        }

        if (!pathname.startsWith(`${API_BASE}/`)) return route.fulfill({ status: 404, body: 'Unexpected fixture request.' });
        const apiPath = pathname.slice(API_BASE.length);
        requests.push({ method: request.method(), path: apiPath, body: request.postDataJSON() });
        const json = payload => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, ...payload }) });
        if (request.method() === 'GET' && apiPath === `/stories/${storyId}`) {
            if (released && pendingJob) pendingJob.status = 'completed';
            return json({ project: structuredClone(project) });
        }
        if (request.method() === 'POST' && apiPath === `/stories/${storyId}/generations`) {
            const body = request.postDataJSON();
            expect(body.kind).toBe('fill');
            expect(body.nodeId).toBe(rootId);
            pendingJob = {
                id: 'fill-job-1', requestId: body.requestId, nodeId: rootId, kind: 'fill', count: null,
                status: 'running', dependencies: StoryProject.dependencies(project, rootId), promptIds: [],
                proposalId: null, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                feedback: body.feedback || '', yoloRunId: null, receiptId: null, draft: structuredClone(body.draft)
            };
            project.jobs[pendingJob.id] = pendingJob;
            project.revision++;
            return json({ job: pendingJob, project: structuredClone(project) });
        }
        if (request.method() === 'GET' && apiPath === `/stories/${storyId}/jobs/fill-job-1`) {
            if (released && pendingJob) {
                pendingJob.status = 'completed';
                const candidate = StoryGenerationService.parse(JSON.stringify(completedPatch(pendingJob.draft)), 'fill', {
                    type: 'story', project, draft: pendingJob.draft
                });
                proposal = {
                    id: 'fill-proposal-1', jobId: pendingJob.id, nodeId: rootId, kind: 'fill', status: 'pending',
                    dependencies: pendingJob.dependencies, candidate, before: structuredClone(pendingJob.draft.content), feedback: pendingJob.feedback
                };
                pendingJob.proposalId = proposal.id;
                project.proposals[proposal.id] = proposal;
            }
            return json({ job: structuredClone(pendingJob), proposal: proposal && structuredClone(proposal), projectRevision: project.revision });
        }
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: `Unexpected mocked API request: ${request.method()} ${apiPath}` }) });
    });

    await page.goto(`${BASE_URL}${PAGE_BASE}/${storyId}/${rootId}`);
    const fillButton = page.getByRole('button', { name: 'Generate missing fields' });
    await expect(fillButton).toBeEnabled();
    await fillButton.click();
    await expect(page.locator('#story-instructions-form')).toBeVisible();
    expect(requests.filter(request => request.method === 'POST' && request.path.endsWith('/generations'))).toHaveLength(0);
    await page.locator('#story-generation-feedback').fill('Keep the harbor mystery intimate.');
    await page.keyboard.press('Escape');
    await expect(page.locator('#story-instructions-form')).toBeHidden();
    await expect(fillButton).toBeEnabled();
    await fillButton.click();
    await expect(page.locator('#story-generation-feedback')).toHaveValue('Keep the harbor mystery intimate.');
    await page.locator('#story-instructions-generate').click();
    await expect.poll(() => requests.filter(request => request.method === 'POST' && request.path.endsWith('/generations')).length).toBe(1);
    await expect(page.locator('#story-fill-fields')).toBeDisabled();
    expect(requests.find(request => request.method === 'POST').body.draft.content).toEqual(project.nodes[rootId].content);
    expect(requests.find(request => request.method === 'POST').body.feedback).toBe('Keep the harbor mystery intimate.');

    await page.keyboard.press('Alt+g');
    await expect.poll(() => requests.filter(request => request.method === 'POST' && request.path.endsWith('/generations')).length).toBe(1);

    const notesDisclosure = page.locator('#story-section details[data-disclosure="notes"]');
    if (!(await notesDisclosure.getAttribute('open'))) await notesDisclosure.locator(':scope > summary').click();
    const notes = page.locator('#story-field-authorNotes');
    await notes.fill('Typed while generation was running.');
    released = true;
    await page.evaluate(() => window.AIRPG_STORY_EDITOR.poll());

    await expect(notes).toHaveValue('Typed while generation was running.');
    await expect(page.locator('#story-field-setup')).toHaveValue('Generated setup.');
    await expect(page.locator('#story-field-style')).toHaveValue('A restrained harbor mystery.');
    await expect(page.locator('#story-announcement')).toContainText('Missing fields filled in your draft');
    expect(project.nodes[rootId].content.authorNotes).toBe('');
    expect(project.nodes[rootId].content.setup).toBe('');
    expect(requests.filter(request => request.method === 'POST' && request.path.includes('/generations'))).toHaveLength(1);
    expect(pageErrors).toEqual([]);

    await page.screenshot({ path: path.join(outputDirectory, 'story-form-fill-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(outputDirectory, 'story-form-fill-mobile.png'), fullPage: true });
});
