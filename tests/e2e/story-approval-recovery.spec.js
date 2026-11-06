const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const StoryProject = require('../../mods/story-authoring/StoryProject');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE_PATH = '/mods/story-authoring/pages/stories';
const API_BASE = '/api/mods/story-authoring';
const BASE_URL = 'http://127.0.0.1:4175';
const ARTIFACT_ROOT = path.join(ROOT, 'tmp', 'story-approval-recovery-final');
const viewEnvironment = new nunjucks.Environment(
    new nunjucks.FileSystemLoader([
        path.join(ROOT, 'views'),
        path.join(ROOT, 'mods', 'story-authoring', 'views')
    ]),
    { autoescape: true, throwOnUndefined: false }
);

function completeContent(title, extra = {}) {
    return {
        title,
        synopsis: `${title} synopsis`,
        intent: `${title} intent`,
        outline: `${title} outline`,
        authorNotes: '',
        setup: '',
        conflict: '',
        actorGoal: '',
        actorNotes: '',
        narrativePurpose: '',
        privateDirection: '',
        constraints: [],
        characterRefs: [],
        placeRefs: [],
        prerequisites: [],
        revelations: [],
        unresolvedThreads: [],
        completionCriteria: [],
        failureConditions: [],
        continuityInputs: [],
        continuityOutputs: [],
        ...extra
    };
}

function makeProject({ approveLibrary = false, staleChapter = false, staleFill = false } = {}) {
    const project = StoryProject.create({
        requestId: randomUUID(),
        title: 'The Glass Harbor',
        premise: 'A keeper tracks a missing tide ledger.',
        mainPlot: 'The keeper exposes the archive conspiracy and restores the harbor record.'
    });
    const rootId = project.rootId;
    const partId = StoryProject.add(project, rootId, completeContent('Part One'));
    const chapterId = StoryProject.add(project, partId, completeContent('Chapter One'));
    const sceneId = StoryProject.add(project, chapterId, completeContent('The Bell Archive'));
    const firstLeafId = StoryProject.add(project, sceneId, completeContent('Question the keeper', {
        actorGoal: 'Ask the keeper which bell rang before the flood.',
        actorNotes: 'Accept an honest refusal.',
        completionCriteria: ['The keeper identifies the first bell.'],
        failureConditions: ['The keeper refuses to identify the bell.']
    }));
    const secondLeafId = StoryProject.add(project, sceneId, completeContent('Trace the ledger', {
        actorGoal: 'Find where the tide ledger was moved.',
        actorNotes: 'Follow the evidence without assuming success.',
        completionCriteria: ['The ledger trail is established.'],
        failureConditions: ['The trail remains unknown.']
    }));
    const otherSceneId = StoryProject.add(project, chapterId, completeContent('The Unrelated Quay'));
    const unrelatedLeafId = StoryProject.add(project, otherSceneId, completeContent('Inspect the quay', {
        actorGoal: 'Inspect the quay for the archive cart.',
        completionCriteria: ['The cart is accounted for.'],
        failureConditions: ['The cart remains missing.']
    }));
    const otherPartId = StoryProject.add(project, rootId, completeContent('Part Two'));
    const otherChapterId = StoryProject.add(project, otherPartId, completeContent('Chapter Two'));
    const otherBranchSceneId = StoryProject.add(project, otherChapterId, completeContent('The Outer Wall'));
    const otherBranchLeafId = StoryProject.add(project, otherBranchSceneId, completeContent('Search the wall', {
        actorGoal: 'Search for the harbor signal keeper.',
        completionCriteria: ['The signal keeper is found.'],
        failureConditions: ['The signal keeper remains missing.']
    }));
    const nodeIds = { rootId, partId, chapterId, sceneId, firstLeafId, secondLeafId, otherSceneId, unrelatedLeafId, otherPartId, otherChapterId, otherBranchSceneId, otherBranchLeafId };
    const branchIds = [rootId, partId, chapterId, sceneId, firstLeafId, secondLeafId];
    const allIds = Object.keys(project.nodes);
    const binding = {
        bindingId: randomUUID(), storyId: project.id, storyRevision: project.revision,
        worldLineageId: randomUUID(), worldProfileId: 'setting-harbor', protagonistId: 'player-1',
        sources: structuredClone(project.sources), sourceFingerprint: 'source-fingerprint',
        mechanicsFingerprint: 'mechanics-fingerprint', checkpoint: 'checkpoint-1',
        entityMapping: {}, createdAt: new Date().toISOString()
    };
    project.binding = binding;

    if (approveLibrary) StoryProject.approve(project, allIds);
    else StoryProject.approve(project, [partId]);
    if (staleChapter) {
        const review = project.nodes[chapterId].review;
        review.approvedRevision = project.nodes[chapterId].contentRevision;
        review.approvedAt = new Date().toISOString();
        review.dependencies = 'old-approval-dependencies';
        review.invalidationReasons = ['The chapter needs a fresh review.'];
    }

    let snapshot = structuredClone(project);
    if (approveLibrary) {
        for (const nodeId of branchIds) {
            snapshot.nodes[nodeId].review = {
                approvedRevision: null,
                approvedAt: null,
                dependencies: null,
                invalidationReasons: [],
                machineAcceptedByRunId: null,
                machineAcceptedRevision: null
            };
        }
    } else {
        for (const nodeId of branchIds) {
            if (nodeId !== rootId) {
                snapshot.nodes[nodeId].review = {
                    approvedRevision: null,
                    approvedAt: null,
                    dependencies: null,
                    invalidationReasons: [],
                    machineAcceptedByRunId: null,
                    machineAcceptedRevision: null
                };
            }
        }
    }
    snapshot.binding = structuredClone(binding);

    if (staleFill) {
        const jobId = randomUUID();
        project.jobs[jobId] = {
            id: jobId, requestId: randomUUID(), nodeId: firstLeafId, kind: 'fill', status: 'conflicted',
            dependencies: 'old-dependencies', proposalId: null, promptIds: [],
            error: {
                error: 'Story or selected game context changed; generate missing fields again. The candidate is retained.',
                stack: 'Error: Story or selected game context changed; generate missing fields again. The candidate is retained.\n    at StoryGenerationService.status',
                code: 'STORY_CANDIDATE_STALE'
            }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
    }

    return { project, snapshot, nodeIds, branchIds };
}

function boundStateFor(project, snapshot, { conflict = null, pendingSync = null } = {}) {
    return {
        binding: structuredClone(project.binding),
        snapshotRevision: snapshot.revision,
        libraryRevision: project.revision,
        conflict,
        pendingSync,
        execution: { status: 'paused', packetId: null },
        receipts: structuredClone(snapshot.receipts),
        snapshot: StoryProject.view(snapshot),
        requiresCopyBeforeWriting: false,
        continuationPolicy: 'Pinned saved intentions govern execution; actual history remains authoritative.'
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

function approvalItems(project, snapshot, nodeIds) {
    return nodeIds.flatMap(nodeId => {
        const libraryNode = project.nodes[nodeId];
        const pinnedNode = snapshot.nodes[nodeId];
        const libraryStatus = StoryProject.reviewStatus(project, libraryNode);
        const pinnedStatus = StoryProject.reviewStatus(snapshot, pinnedNode);
        if (libraryStatus === 'approved' && pinnedStatus === 'approved' && JSON.stringify(libraryNode.review) === JSON.stringify(pinnedNode.review)) return [];
        const pathNodes = [...StoryProject.ancestors(project, nodeId), libraryNode];
        return [{
            nodeId, type: libraryNode.type,
            path: pathNodes.map(node => node.content.title).join(' / '),
            libraryStatus, pinnedStatus,
            action: libraryStatus === 'approved' ? 'sync' : 'approve'
        }];
    });
}

async function installFixture(page, { projectMode = 'missing', mismatch = false, staleFill = false } = {}) {
    fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
    const fixture = makeProject({
        approveLibrary: projectMode === 'approved-pinned-draft',
        staleChapter: projectMode === 'missing',
        staleFill
    });
    const { project, snapshot, nodeIds, branchIds } = fixture;
    if (mismatch) snapshot.nodes[nodeIds.rootId].content.outline = 'A materially different pinned Main plot.';
    const state = {
        project, snapshot, nodeIds, branchIds, projectMode, mismatch,
        boundState: boundStateFor(project, snapshot, { conflict: mismatch ? 'Saved story snapshot differs from library' : null }),
        requests: [], unexpected: [], pageErrors: [], approvalPreviewCount: 0,
        lastPreview: null, previews: [], beforeContent: JSON.stringify(Object.fromEntries(Object.entries(project.nodes).map(([id, node]) => [id, node.content]))),
        beforeReceipts: JSON.stringify(project.receipts), contentMismatchError: mismatch
    };
    await page.addInitScript(() => {
        window.WebSocket = class MockWebSocket extends EventTarget {
            constructor(url) { super(); this.url = String(url); this.readyState = 1; }
            send() {}
            close() { this.readyState = 3; }
        };
    });
    page.on('pageerror', error => state.pageErrors.push(error.stack || error.message));

    await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const pathname = decodeURIComponent(url.pathname);
        if (url.origin !== BASE_URL) {
            if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') return route.abort();
            state.unexpected.push({ url: url.href, reason: 'External transport is blocked.' });
            return route.abort();
        }
        if (pathname === PAGE_PATH || pathname.startsWith(`${PAGE_PATH}/`)) {
            return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: renderDocument() });
        }
        if (pathname.startsWith('/api/')) {
            const body = request.method() === 'GET' || !request.postData() ? undefined : request.postDataJSON();
            state.requests.push({ method: request.method(), path: pathname, body });
            const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
            if (pathname === '/api/pending-load' && request.method() === 'GET') return json({ success: true, pendingLoad: null });
            if (pathname === `${API_BASE}/stories/${project.id}` && request.method() === 'GET') return json({ success: true, project: StoryProject.view(project) });
            if (pathname === `${API_BASE}/stories/${project.id}/bound-state` && request.method() === 'GET') {
                state.boundState = boundStateFor(project, snapshot, { conflict: mismatch ? 'Saved story snapshot differs from library' : null });
                return json({ success: true, boundState: state.boundState });
            }
            if (pathname === `${API_BASE}/stories/${project.id}/execution/approval-preview` && request.method() === 'POST') {
                state.approvalPreviewCount += 1;
                if (state.contentMismatchError) {
                    return json({ success: false, error: 'Saved and library story content or actual history differs. Review saved story differences before continuing.', code: 'STORY_SNAPSHOT_CONFLICT' }, 409);
                }
                if (projectMode === 'approved-pinned-draft' && state.approvalPreviewCount === 3) {
                    for (const nodeId of branchIds) {
                        snapshot.nodes[nodeId].review = {
                            approvedRevision: null, approvedAt: null, dependencies: null,
                            invalidationReasons: [], machineAcceptedByRunId: null, machineAcceptedRevision: null
                        };
                    }
                }
                const scopeNodeId = body.scope === 'scene' ? body.nodeId : body.nodeId;
                const selected = body.scope === 'scene'
                    ? [...StoryProject.ancestors(project, scopeNodeId), project.nodes[scopeNodeId], ...project.nodes[scopeNodeId].children.map(id => project.nodes[id])].map(node => node.id)
                    : [...StoryProject.ancestors(project, scopeNodeId), project.nodes[scopeNodeId]].map(node => node.id);
                const items = approvalItems(project, snapshot, [...new Set(selected)]);
                const preview = {
                    storyId: project.id, nodeId: scopeNodeId, scope: body.scope,
                    libraryRevision: project.revision, snapshotRevision: snapshot.revision,
                    fingerprint: `approval-fingerprint-${state.approvalPreviewCount}`,
                    items, needsRecovery: items.length > 0 || project.revision !== snapshot.revision
                };
                state.lastPreview = preview;
                state.previews.push(structuredClone(preview));
                state.boundState = boundStateFor(project, snapshot);
                return json({ success: true, project: StoryProject.view(project), approvalPreview: preview, boundState: state.boundState });
            }
            if (pathname === `${API_BASE}/stories/${project.id}/execution/approve-for-play` && request.method() === 'POST') {
                if (body.approvalFingerprint !== state.lastPreview?.fingerprint) return json({ success: false, error: 'Approval preview became stale.', code: 'STORY_APPROVAL_PREVIEW_STALE' }, 409);
                const approveIds = state.lastPreview.items.filter(item => item.action === 'approve').map(item => item.nodeId);
                if (approveIds.length) StoryProject.approve(project, approveIds);
                for (const item of state.lastPreview.items) snapshot.nodes[item.nodeId].review = structuredClone(project.nodes[item.nodeId].review);
                project.revision += 1;
                project.updatedAt = new Date().toISOString();
                project.binding.storyRevision = project.revision;
                snapshot.revision = project.revision;
                snapshot.updatedAt = project.updatedAt;
                snapshot.binding.storyRevision = project.revision;
                state.boundState = boundStateFor(project, snapshot);
                return json({ success: true, project: StoryProject.view(project), boundState: state.boundState });
            }
            if (pathname === `${API_BASE}/stories/${project.id}/execution/prepare` && request.method() === 'POST') {
                return json({ success: true, packet: {
                    id: 'mock-packet', storyId: project.id, subsceneId: nodeIds.firstLeafId,
                    goal: project.nodes[nodeIds.firstLeafId].content.actorGoal,
                    notes: project.nodes[nodeIds.firstLeafId].content.actorNotes,
                    queue: [nodeIds.firstLeafId, nodeIds.secondLeafId]
                }, playUrl: `/play?storyPacket=mock-packet` });
            }
            state.unexpected.push({ method: request.method(), path: pathname, body });
            return json({ success: false, error: `Unexpected mocked API request: ${request.method()} ${pathname}` }, 500);
        }
        const isModAsset = pathname.startsWith('/mods/story-authoring/public/');
        const isApplicationAsset = pathname.startsWith('/css/') || pathname.startsWith('/js/');
        if (isModAsset || isApplicationAsset) {
            const localPath = isModAsset
                ? path.resolve(ROOT, `.${pathname}`)
                : path.resolve(ROOT, 'public', `.${pathname}`);
            const allowedRoot = isModAsset ? path.join(ROOT, 'mods', 'story-authoring', 'public') : path.join(ROOT, 'public');
            if (localPath.startsWith(`${allowedRoot}${path.sep}`) && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
                return route.fulfill({ status: 200, contentType: contentType(localPath), body: fs.readFileSync(localPath) });
            }
            state.unexpected.push({ method: request.method(), path: pathname, reason: 'Missing local page asset.' });
            return route.fulfill({ status: 404, body: 'Missing local fixture asset.' });
        }
        if (pathname.startsWith('/assets/')) return route.abort();
        state.unexpected.push({ method: request.method(), path: pathname, reason: 'Unexpected page request.' });
        return route.fulfill({ status: 404, body: 'Unexpected fixture request.' });
    });

    const selectedNodeId = projectMode === 'scene-queue' || projectMode === 'approved-pinned-draft' ? nodeIds.sceneId : nodeIds.sceneId;
    await page.goto(`${BASE_URL}${PAGE_PATH}/${project.id}/${selectedNodeId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('#story-workspace')).toBeVisible();
    await page.waitForFunction(() => Boolean(window.AIRPG_PAGE_FEEDBACK && window.AIRPG_STORY_EDITOR));
    return state;
}

async function reviewButton(page) {
    const button = page.locator('#story-section [data-action="review-play"][data-scope="scene"]');
    await expect(button).toBeEnabled();
    return button;
}

test('scene Play approval recovery is scoped, cancelable, and resumes review without starting Play', async ({ page }) => {
    const state = await installFixture(page, { projectMode: 'missing', staleFill: true });
    const beforeContent = state.beforeContent;
    const beforeReceipts = state.beforeReceipts;
    const button = await reviewButton(page);

    const activity = page.locator('#story-activity details[data-disclosure="jobs"]');
    await expect(activity).toBeVisible();
    if (!(await activity.evaluate(element => element.open))) await activity.locator(':scope > summary').click();
    await expect(activity).toContainText('Story or selected game context changed');
    await expect(page.locator('dialog.page-feedback-dialog[open]')).toHaveCount(0);

    await button.click();
    await expect(page.locator('#story-dialog-title')).toHaveText('Approve required story sections');
    await expect(page.locator('#story-play-approvals-list')).toContainText('The Glass Harbor / Part One / Chapter One / The Bell Archive / Question the keeper');
    await expect(page.locator('#story-play-approvals-list')).toContainText('The Glass Harbor / Part One / Chapter One / The Bell Archive / Trace the ledger');
    await expect(page.locator('#story-play-approvals-list')).toContainText('Approved in library · update game approval');
    await expect(page.locator('#story-play-approvals-list')).toContainText('Needs current approval');
    await expect(page.locator('#story-play-approvals-list')).not.toContainText('The Unrelated Quay');
    await expect(page.locator('#story-play-approvals-list')).not.toContainText('Part Two');
    expect(state.requests.filter(request => request.path.endsWith('/execution/approval-preview'))).toHaveLength(1);
    expect(state.requests.filter(request => request.path.endsWith('/execution/approve-for-play'))).toHaveLength(0);

    for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.screenshot({
            path: path.join(ARTIFACT_ROOT, viewport.width === 390 ? 'scene-approval-mobile.png' : 'scene-approval-desktop.png'),
            fullPage: false
        });
        if (viewport.width === 1365) {
            await page.locator('#story-approval-cancel').click();
            await expect(page.locator('#story-dialog')).toBeHidden();
            await expect.poll(() => state.requests.filter(request => request.path.endsWith('/execution/approve-for-play')).length).toBe(0);
            await button.click();
            await expect(page.locator('#story-dialog-title')).toHaveText('Approve required story sections');
        } else {
            await page.keyboard.press('Escape');
            await expect(page.locator('#story-dialog')).toBeHidden();
            expect(state.requests.filter(request => request.path.endsWith('/execution/approve-for-play'))).toHaveLength(0);
            await page.setViewportSize({ width: 1365, height: 900 });
            await button.click();
            await expect(page.locator('#story-dialog-title')).toHaveText('Approve required story sections');
        }
    }

    const reviewedPreview = structuredClone(state.lastPreview);
    await page.locator('#story-approve-continue').click();
    await expect(page.locator('#story-dialog-title')).toHaveText('Review for Play');
    const confirmation = state.requests.find(request => request.path.endsWith('/execution/approve-for-play'));
    expect(confirmation.body).toMatchObject({ nodeId: state.nodeIds.sceneId, scope: 'scene', reviewed: true, approvalFingerprint: reviewedPreview.fingerprint });
    expect(confirmation.body.expectedRevision).toBe(state.project.revision - 1);
    expect(state.requests.filter(request => request.path.endsWith('/execution/prepare'))).toHaveLength(0);
    expect(state.requests.some(request => request.path.includes('/play/') || request.path.endsWith('/start'))).toBeFalsy();
    expect(JSON.stringify(Object.fromEntries(Object.entries(state.project.nodes).map(([id, node]) => [id, node.content])))).toBe(beforeContent);
    expect(JSON.stringify(state.project.receipts)).toBe(beforeReceipts);
    expect(state.project.nodes[state.nodeIds.otherSceneId].review.approvedRevision).toBeNull();
    expect(state.project.nodes[state.nodeIds.otherPartId].review.approvedRevision).toBeNull();
    await expect(page.locator('#story-activity')).toContainText('Story or selected game context changed');
    await expect(page.locator('dialog.page-feedback-dialog[open]')).toHaveCount(0);
    expect(state.pageErrors).toEqual([]);
    expect(state.unexpected).toEqual([]);
});

test('approval-only pinned/library differences recover during explicit Prepare and preserve content and outcomes', async ({ page }) => {
    const state = await installFixture(page, { projectMode: 'approved-pinned-draft' });
    const beforeContent = state.beforeContent;
    const beforeReceipts = state.beforeReceipts;
    const button = await reviewButton(page);
    await button.click();
    await expect(page.locator('#story-dialog-title')).toHaveText('Approve required story sections');
    await expect(page.locator('#story-play-approvals-list')).toContainText('Approved in library · update game approval');
    const initiallyRequired = structuredClone(state.lastPreview);
    await page.locator('#story-approve-continue').click();
    await expect(page.locator('#story-dialog-title')).toHaveText('Review for Play');
    await expect(page.getByRole('button', { name: 'Prepare approved scene queue for Play' })).toBeVisible();
    expect(state.requests.filter(request => request.path.endsWith('/execution/approval-preview'))).toHaveLength(2);
    const firstConfirmation = state.requests.find(request => request.path.endsWith('/execution/approve-for-play'));
    expect(firstConfirmation.body.approvalFingerprint).toBe(initiallyRequired.fingerprint);

    await page.getByRole('button', { name: 'Prepare approved scene queue for Play' }).click();
    await expect(page.locator('#story-dialog-title')).toHaveText('Approve required story sections');
    await expect(page.locator('#story-play-approvals-list')).toContainText('Approved in library · update game approval');
    const preparePreview = structuredClone(state.lastPreview);
    await page.locator('#story-approve-continue').click();
    await expect(page.locator('#story-dialog-title')).toHaveText('Ready on Play');

    expect(state.requests.filter(request => request.path.endsWith('/execution/approval-preview'))).toHaveLength(4);
    const confirmations = state.requests.filter(request => request.path.endsWith('/execution/approve-for-play'));
    expect(confirmations).toHaveLength(2);
    expect(confirmations[1].body).toMatchObject({ nodeId: state.nodeIds.sceneId, scope: 'scene', reviewed: true, approvalFingerprint: preparePreview.fingerprint });
    expect(state.requests.filter(request => request.path.endsWith('/execution/prepare'))).toHaveLength(1);
    expect(state.requests.find(request => request.path.endsWith('/execution/prepare')).body.scope).toBe('scene');
    expect(JSON.stringify(Object.fromEntries(Object.entries(state.project.nodes).map(([id, node]) => [id, node.content])))).toBe(beforeContent);
    expect(JSON.stringify(state.project.receipts)).toBe(beforeReceipts);
    for (const nodeId of state.branchIds) {
        expect(StoryProject.reviewStatus(state.project, state.project.nodes[nodeId])).toBe('approved');
        expect(StoryProject.reviewStatus(state.snapshot, state.snapshot.nodes[nodeId])).toBe('approved');
    }
    expect(state.project.nodes[state.nodeIds.otherSceneId].review.approvedRevision).toBeGreaterThan(0);
    expect(state.project.nodes[state.nodeIds.otherPartId].review.approvedRevision).toBeGreaterThan(0);
    expect(state.requests.some(request => request.path.includes('/play/') || request.path.endsWith('/start'))).toBeFalsy();
    expect(state.pageErrors).toEqual([]);
    expect(state.unexpected).toEqual([]);
});

test('real story content differences retain the explicit timeline-review guard instead of opening approval recovery', async ({ page }) => {
    const state = await installFixture(page, { mismatch: true });
    const button = await reviewButton(page);
    await button.click();
    await expect(page.locator('#story-dialog-title')).toHaveText('Review saved story differences');
    await expect(page.locator('#story-dialog-body')).toContainText('A materially different pinned Main plot.');
    await expect(page.locator('#story-play-approvals-form')).toHaveCount(0);
    await expect(page.locator('dialog.page-feedback-dialog[open]')).toBeVisible();
    expect(state.requests.filter(request => request.path.endsWith('/execution/approve-for-play'))).toHaveLength(0);
    expect(state.requests.filter(request => request.path.endsWith('/execution/prepare'))).toHaveLength(0);
    expect(state.pageErrors).toEqual([]);
    expect(state.unexpected).toEqual([]);
});

test('Stories library filters, sorts and shows archived records without activating stale links', async ({ page }) => {
    const state = await installFixture(page);
    await page.evaluate(() => {
        const editor = window.AIRPG_STORY_EDITOR;
        editor.library = [{ id: 'a', title: 'Alpha', premise: 'Harbor', updatedAt: '2026-01-01', createdAt: '2026-01-01', archived: false }, { id: 'b', title: 'Beta', premise: 'Mountains', updatedAt: '2026-01-02', createdAt: '2026-01-02', archived: true }];
        editor.showLibrary(); editor.renderLibrary();
    });
    const list = page.locator('#story-library-list'); await expect(list.locator('.stories__card')).toHaveCount(1);
    await list.getByText('Alpha', { exact: true }).evaluate(link => { window.fixtureOldStoryLink = link; link.addEventListener('click', event => event.preventDefault()); });
    await page.locator('#story-show-archive').check(); await expect(list.locator('.stories__card')).toHaveCount(2);
    await page.locator('#story-sort').selectOption('title'); await expect(list.locator('h3')).toContainText(['Alpha', 'Beta']);
    await page.locator('#story-search').fill('mountains'); await expect(list.locator('.stories__card')).toHaveCount(1); await expect(list).toContainText('Archived');
    const before = page.url(); await page.evaluate(() => window.fixtureOldStoryLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(page.url()).toBe(before); expect(state.pageErrors).toEqual([]); expect(state.unexpected).toEqual([]);
});
