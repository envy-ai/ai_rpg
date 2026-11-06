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

test('dirty native outline navigation retains URL, draft and expanded selection; phone drawer restores focus', async ({ page }) => {
    const state = await installFixture(page);
    const { sceneId, firstLeafId } = state.nodeIds;
    const tree = page.locator('#story-tree');
    const scene = tree.locator(`details[data-tree="${sceneId}"]`);
    if (!(await scene.evaluate(el => el.open))) await scene.locator(':scope > summary').click();
    const selected = tree.locator(`a[data-node="${sceneId}"]`);
    await expect(selected).toHaveAttribute('aria-current', 'location');
    const draft = page.locator('#story-edit-form [data-field="synopsis"]');
    await draft.fill('A retained local draft.');
    const initialURL = page.url();
    const leaf = tree.locator(`a[data-node="${firstLeafId}"]`);
    await expect(leaf).toHaveAttribute('href', `${PAGE_PATH}/${state.project.id}/${firstLeafId}`);
    await leaf.click();
    await expect(page.locator('#story-dialog-title')).toHaveText('Unsaved changes');
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(draft).toHaveValue('A retained local draft.');
    expect(page.url()).toBe(initialURL);
    await expect(scene).toHaveAttribute('open', '');
    await expect(selected).toHaveAttribute('aria-current', 'location');
    await page.setViewportSize({ width: 390, height: 844 });
    const trigger = page.locator('[data-action="outline-drawer"]');
    await trigger.click();
    await expect(page.locator('#story-dialog-title')).toHaveText('Outline');
    await expect(page.locator(`#story-dialog-body details[data-tree="${sceneId}"]`)).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(page.locator('#story-dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(draft).toHaveValue('A retained local draft.');
    expect(page.url()).toBe(initialURL);
    expect(state.unexpected).toEqual([]);
    expect(state.pageErrors).toEqual([]);
    expect(state.requests.filter(r => r.method !== 'GET')).toEqual([]);
});
