/* global window, document */
'use strict';
(function () {
    const TYPES = ['story', 'part', 'chapter', 'scene', 'subscene'];
    const NAMES = { story: 'premise', part: 'part', chapter: 'chapter', scene: 'scene', subscene: 'sub-scene' };
    const PLURALS = { part: 'parts', chapter: 'chapters', scene: 'scenes', subscene: 'sub-scenes' };
    const STRINGS = ['title', 'synopsis', 'intent', 'outline', 'authorNotes', 'setup', 'conflict', 'actorGoal', 'actorNotes', 'narrativePurpose', 'privateDirection'];
    const LISTS = ['constraints', 'characterRefs', 'placeRefs', 'prerequisites', 'revelations', 'unresolvedThreads', 'completionCriteria', 'failureConditions', 'continuityInputs', 'continuityOutputs'];
    const LABELS = { title: 'Title', synopsis: 'Synopsis', intent: 'Intent', outline: 'Outline', authorNotes: 'Local author notes', setup: 'Setup', conflict: 'Attempt or conflict', actorGoal: 'Protagonist goal', actorNotes: 'Protagonist notes', narrativePurpose: 'Dramatic purpose', privateDirection: 'Private author direction', constraints: 'Constraints', characterRefs: 'Character references', placeRefs: 'Place references', prerequisites: 'Prerequisites', revelations: 'Planned revelations', unresolvedThreads: 'Open threads', completionCriteria: 'Completion criteria', failureConditions: 'Possible unfavorable outcomes', continuityInputs: 'Intended incoming facts', continuityOutputs: 'Intended resulting facts', style: 'Tone and style', premise: 'Premise', mainPlot: 'Main plot', worldBrief: 'World brief', protagonistBrief: 'Protagonist brief', settingFields: 'World profile details', newGameFields: 'Protagonist and opening details' };
    const FEEDBACK_SCOPE = 'story-authoring.editor';
    const ACTIVE_JOB = ['queued', 'running'];
    const ACTIVE_RUN = ['queued', 'running', 'pause-requested'];
    const clone = value => JSON.parse(JSON.stringify(value));
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const label = key => LABELS[key] || String(key).replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
    const uuid = () => {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        const h = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    };
    const button = (action, text, attrs = '', primary = false) => `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-secondary'}" data-action="${action}" ${attrs}>${esc(text)}</button>`;
    const errorFrom = value => {
        const error = new Error(value.error || value.message || 'Story operation failed.');
        if (value.stack) error.stack = value.stack;
        error.code = value.code;
        return error;
    };
    const pretty = value => Array.isArray(value) ? value.map(pretty).join('\n') : value && typeof value === 'object' ? Object.entries(value).map(([k, v]) => `${label(k)}: ${pretty(v)}`).join('\n') : String(value ?? '');

    class StoryEditor {
        constructor(root) {
            this.root = root;
            if (!window.AIRPG_PAGE_FEEDBACK || typeof window.AIRPG_PAGE_FEEDBACK.showError !== 'function' || typeof window.AIRPG_PAGE_FEEDBACK.trackJob !== 'function' || typeof window.AIRPG_PAGE_FEEDBACK.setJobs !== 'function') throw new Error('The shared page feedback controller is unavailable for Stories.');
            if (!window.AIRPGModalSubmitShortcuts) throw new Error('The shared form shortcut controller is unavailable for Stories.');
            this.apiBase = root.dataset.apiBase;
            this.pageBase = root.dataset.pageBase;
            this.project = null;
            this.nodeId = null;
            this.tab = 'outline';
            this.buffers = new Map();
            this.sourceDrafts = new Map();
            this.formFills = new Map();
            this.newStoryDraft = { controls: { title: '', premise: '', mainPlot: '', style: '', constraints: '', authorNotes: '' }, fieldChanges: {} };
            this.creationGeneration = null;
            this.creationDialogId = null;
            this.generationInstructions = {};
            this.library = [];
            this.errors = new Set();
            this.expanded = new Set();
            this.disclosures = new Set();
            this.busy = false;
            this.polling = false;
            this.yoloEnabled = false;
            this.yoloScope = null;
            this.setupAttempt = null;
            this.boundState = null;
            this.sourceCatalog = null;
            this.dialogKind = null;
            this.dialogTicket = 0;
            this.dialogCloseRequested = false;
            this.dialogReopenPending = false;
            this.dialogLifecycle = new window.AIRPG_WIDGETS.NativeDialog(this.el('story-dialog'), {
                onClose: () => this.onNativeDialogClosed()
            });
            this.install();
            this.installDockSpacing();
            this.restoreBuffers();
            this.openUrl().catch(error => this.fail(error));
            this.timer = window.setInterval(() => this.poll().catch(error => this.fail(error)), 2000);
        }

        el(id) { return this.root.querySelector(`#${id}`); }
        nodes() { return Object.values(this.project?.nodes || {}); }
        node(id = this.nodeId) {
            const node = this.project?.nodes[id];
            if (!node) throw new Error('The selected story section is unavailable.');
            return node;
        }
        children(node, archived = false) { return node.children.map(id => this.node(id)).filter(n => archived || !n.archived); }
        ancestors(id = this.nodeId) {
            const path = [];
            let n = this.node(id);
            while (n.parentId) { n = this.node(n.parentId); path.unshift(n); }
            return path;
        }
        path(id) { return [...this.ancestors(id), this.node(id)].map(n => n.content.title || NAMES[n.type]).join(' / '); }
        status(n) {
            if (!['draft', 'approved', 'stale'].includes(n.reviewStatus)) throw new Error('The server did not provide this section’s review status.');
            return n.reviewStatus;
        }
        badge(n) {
            const state = this.status(n);
            let html = `<span class="stories__badge stories__badge--${state}">${{ draft: 'Draft', approved: 'Approved by you', stale: 'Needs re-review' }[state]}</span>`;
            if (n.review.machineAcceptedByRunId && n.review.machineAcceptedRevision === n.contentRevision) html += '<span class="stories__badge stories__badge--machine">Accepted by YOLO</span>';
            if (n.execution.status !== 'unwritten') html += `<span class="stories__badge">${esc({ resolved: 'Written', 'needs-review': 'Outcome needs review', 'in-progress': 'Writing', paused: 'Writing paused', waived: 'Waived by author' }[n.execution.status])}</span>`;
            return html;
        }
        bufferKey(id = this.nodeId) { return `${this.project.id}/${id}${this.readOnlyProject ? '/saved' : ''}`; }
        buffer(id = this.nodeId) {
            const key = this.bufferKey(id);
            if (!this.buffers.has(key)) this.buffers.set(key, { storyId: this.project.id, nodeId: id, revision: this.project.revision, base: clone(this.node(id).content), content: clone(this.node(id).content), style: this.project.style, baseStyle: this.project.style, dirty: false });
            return this.buffers.get(key);
        }
        anyDirty() { return Array.from(this.buffers.values()).some(b => b.dirty) || Array.from(this.sourceDrafts.values()).some(b => b.dirty); }
        currentDirty() { return !this.readOnlyProject && (this.buffer().dirty || Boolean(this.sourceDrafts.get(this.project.id)?.dirty)); }
        persistBuffers() {
            window.sessionStorage.setItem('airpg.story-editor.buffers', JSON.stringify(Array.from(this.buffers.entries()).filter(([, b]) => b.dirty || Array.from(this.formFills.values()).some(f => !f.consumed && f.storyId === b.storyId && f.nodeId === b.nodeId))));
            window.sessionStorage.setItem('airpg.story-editor.sources', JSON.stringify(Array.from(this.sourceDrafts.entries()).filter(([, b]) => b.dirty)));
            window.sessionStorage.setItem('airpg.story-editor.form-fills', JSON.stringify(Array.from(this.formFills.entries())));
        }
        restoreBuffers() {
            const instructions = window.sessionStorage.getItem('airpg.story-editor.generation-instructions');
            if (instructions) {
                const values = JSON.parse(instructions);
                if (!values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some(value => typeof value !== 'string')) throw new Error('Saved generation instructions are malformed.');
                this.generationInstructions = values;
            }
            const creation = window.sessionStorage.getItem('airpg.story-editor.new-story');
            if (creation) {
                const saved = JSON.parse(creation);
                if (!saved?.draft?.controls || !saved.draft.fieldChanges) throw new Error('Saved new story draft is malformed.');
                this.newStoryDraft = saved.draft;
                if (!Object.hasOwn(this.newStoryDraft.controls, 'mainPlot')) this.newStoryDraft.controls.mainPlot = '';
                this.creationGeneration = saved.generation || null;
                if (this.creationGeneration && !this.creationGeneration.consumed && !Object.hasOwn(this.creationGeneration.controls, 'mainPlot')) {
                    const pending = !this.creationGeneration.closed && (!this.creationGeneration.job || ACTIVE_JOB.includes(this.creationGeneration.job.status));
                    this.creationGeneration.closed = true;
                    this.creationGeneration.consumed = true;
                    if (pending) {
                        this.creationGeneration.interruption = 'This generation predates the Main plot field and was interrupted. Your draft is retained; generate missing fields again.';
                        this.creationGeneration.cancelAfterUpdate = true;
                    }
                }
                this.persistNewStoryDraft();
            }
            const fills = window.sessionStorage.getItem('airpg.story-editor.form-fills');
            if (fills) {
                const entries = JSON.parse(fills);
                if (!Array.isArray(entries)) throw new Error('Saved form-generation tracking is malformed.');
                this.formFills = new Map(entries);
            }
            const saved = window.sessionStorage.getItem('airpg.story-editor.buffers');
            if (saved) {
                const entries = JSON.parse(saved);
                if (!Array.isArray(entries)) throw new Error('Saved editor buffers are malformed.');
                this.buffers = new Map(entries);
            }
            const sources = window.sessionStorage.getItem('airpg.story-editor.sources');
            if (sources) {
                const entries = JSON.parse(sources);
                if (!Array.isArray(entries)) throw new Error('Saved source choices are malformed.');
                this.sourceDrafts = new Map(entries);
            }
            const setups = window.sessionStorage.getItem('airpg.story-editor.setup-drafts');
            if (setups) {
                const saved = JSON.parse(setups);
                this.setupDrafts = saved.fields;
                this.setupControlDrafts = saved.controls;
                this.setupSelections = saved.selections;
                this.removedSetupFields = new Map(saved.removed || []);
                this.typedArrayShapes = new Map(saved.shapes || []);
                this.setupDescriptorsByJob = new Map(saved.descriptors || []);
            }
            const attempt = window.sessionStorage.getItem('airpg.story-editor.setup-attempt');
            if (attempt) this.setupAttempt = JSON.parse(attempt);
        }
        persistSetupDrafts() {
            window.sessionStorage.setItem('airpg.story-editor.setup-drafts', JSON.stringify({ fields: this.setupDrafts || {}, controls: this.setupControlDrafts || {}, selections: this.setupSelections || {}, removed: Array.from(this.removedSetupFields || []), shapes: Array.from(this.typedArrayShapes || []), descriptors: Array.from(this.setupDescriptorsByJob || []) }));
        }
        install() {
            this.root.addEventListener('click', event => {
                const action = event.target.closest('[data-action]');
                const tab = event.target.closest('[data-tab]');
                if (action) { event.preventDefault(); this.act(action.dataset.action, action).catch(error => this.fail(error, action)); }
                else if (tab) this.selectTab(tab.dataset.tab).catch(error => this.fail(error));
            });
            this.root.addEventListener('input', event => {
                try {
                const instructionKey = event.target.dataset.generationKey;
                if (instructionKey) {
                    this.generationInstructions[instructionKey] = event.target.value;
                    window.sessionStorage.setItem('airpg.story-editor.generation-instructions', JSON.stringify(this.generationInstructions));
                }
                const creationField = event.target.dataset.newField;
                if (creationField) {
                    this.newStoryDraft.controls[creationField] = event.target.value;
                    this.newStoryDraft.fieldChanges[creationField] = (this.newStoryDraft.fieldChanges[creationField] || 0) + 1;
                    this.persistNewStoryDraft();
                }
                const field = event.target.dataset.field;
                if (field) {
                    const b = this.buffer();
                    b.fieldChanges ||= {};
                    b.fieldChanges[field] = (b.fieldChanges[field] || 0) + 1;
                    if (field === 'style') b.style = event.target.value;
                    else b.content[field] = LISTS.includes(field) ? event.target.value.split('\n').map(s => s.trim()).filter(Boolean) : event.target.value;
                    b.dirty = JSON.stringify(b.content) !== JSON.stringify(b.base) || b.style !== b.baseStyle;
                    this.persistBuffers();
                    this.renderSaveStatus();
                    this.updateEditActions();
                }
                if (event.target.id === 'story-search') this.renderLibrary();
                } catch (error) { this.fail(error); }
            });
            this.root.addEventListener('change', event => {
                if (['story-sort', 'story-show-archive'].includes(event.target.id)) this.renderLibrary();
                if (event.target.id === 'story-import-file') this.importFile(event.target.files[0]).catch(error => this.fail(error));
                if (event.target.id === 'story-yolo-enabled') {
                    this.yoloEnabled = event.target.checked;
                    const run = this.currentRun();
                    if (!this.yoloEnabled && run && ACTIVE_RUN.includes(run.status)) this.runControl(run.id, 'pause').catch(error => this.fail(error));
                    this.el('story-yolo-start')?.toggleAttribute('disabled', !this.yoloEnabled || this.buffer().dirty);
                }
            });
            this.root.addEventListener('toggle', event => {
                if (event.target.dataset.disclosure) {
                    const key = event.target.dataset.disclosure;
                    if (event.target.open) this.disclosures.add(key); else this.disclosures.delete(key);
                }
                if (event.target.dataset.tree) {
                    if (event.target.open) this.expanded.add(event.target.dataset.tree); else this.expanded.delete(event.target.dataset.tree);
                }
            }, true);
            window.addEventListener('popstate', () => this.openUrl(true).catch(error => this.fail(error)));
            window.addEventListener('beforeunload', event => { if (this.anyDirty()) { event.preventDefault(); event.returnValue = ''; } });
            document.addEventListener('keydown', event => {
                if (document.querySelector('dialog.page-feedback-dialog[open]')) return;
                if (['instructions', 'generate', 'play-approvals'].includes(this.dialogKind) && ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' || event.altKey && event.key === 'ArrowUp')) { event.preventDefault(); return; }
                if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 's' && this.project) { event.preventDefault(); const trigger = document.activeElement; this.save().catch(error => this.fail(error, trigger)); }
                if (event.altKey && event.key === 'ArrowUp' && !event.target.closest('input, textarea, select, [contenteditable]') && this.project && this.node().parentId) { event.preventDefault(); this.navigate(this.project.id, this.node().parentId).catch(error => this.fail(error)); }
                if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'g' && this.dialogKind === 'create' && !this.el('story-dialog').hidden) { const fill = this.el('story-new-fill'); if (fill && !fill.disabled) { event.preventDefault(); fill.click(); } }
                if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'g' && this.project && this.tab === 'outline' && !this.el('story-workspace').hidden && this.el('story-dialog').hidden) {
                    const fill = this.el('story-fill-fields');
                    if (fill && !fill.disabled) { event.preventDefault(); fill.click(); }
                }
            });
            window.addEventListener('pagehide', event => {
                if (event.persisted) return;
                window.clearInterval(this.timer);
                ++this.dialogTicket;
                this.dialogLifecycle.destroy();
                window.AIRPG_MODAL_STACK.setLock('story-authoring.dialog', false);
            });
            this.el('story-dialog').addEventListener('cancel', event => { event.preventDefault(); this.closeDialog(); });
        }
        installDockSpacing() {
            const measure = () => {
                const dock = document.querySelector('.page-feedback-progress');
                if (!dock) return;
                if (this.observedDock !== dock) {
                    this.observedDock = dock;
                    this.dockObserver?.disconnect();
                    this.dockObserver = new ResizeObserver(() => this.measureDock());
                    this.dockObserver.observe(dock);
                }
                this.measureDock();
            };
            this.dockMountObserver = new MutationObserver(measure);
            this.dockMountObserver.observe(document.body, { childList: true, subtree: false });
            measure();
            this.root.addEventListener('focusin', event => {
                if (event.target.matches('textarea, input:not([type=checkbox]), select') && window.matchMedia('(max-width: 540px)').matches) event.target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            });
            window.addEventListener('pagehide', event => { if (event.persisted) return; this.dockObserver?.disconnect(); this.dockMountObserver.disconnect(); });
        }
        measureDock() {
            const dock = this.observedDock;
            const height = !dock || dock.hidden ? 0 : dock.getBoundingClientRect().height + 24;
            this.root.style.setProperty('--stories-prompt-space', `${height}px`);
        }
        async api(path, method = 'GET', body) {
            const response = await window.fetch(`${this.apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            let data;
            try { data = await response.json(); }
            catch (error) { throw new Error(`Stories could not read the server response (${response.status}): ${error.message}`); }
            if (!response.ok || data.success !== true) {
                const error = errorFrom(data);
                error.status = response.status;
                error.currentRevision = data.currentRevision;
                error.receipt = data.receipt;
                throw error;
            }
            return data;
        }
        envelope(extra = {}, revision = this.project.revision, requestId = uuid()) { return { expectedRevision: revision, requestId, ...extra }; }
        async mutate(path, extra = {}, { method = 'POST', revision, requestId, dirty = false } = {}) {
            if (this.busy) throw new Error('Wait for the current story change to finish.');
            if (this.readOnlyProject && !['/reconcile', '/execution/prepare'].includes(path)) throw new Error('This saved timeline is read-only. Import it as a copy for durable author editing.');
            if (!dirty && this.buffer().dirty) throw new Error('Save your changes before this action. Your text is retained.');
            const storyId = this.project.id;
            this.busy = true;
            this.updateEditActions();
            try {
                const data = await this.api(`/stories/${storyId}${path}`, method, this.envelope(extra, revision, requestId));
                if (data.project?.id === storyId && this.project.id === storyId) this.acceptProject(data.project);
                if (data.boundState) { this.boundState = data.boundState; this.renderReconciliation(); }
                return data;
            } finally { this.busy = false; this.updateEditActions(); }
        }
        acceptProject(project) {
            if (!project?.nodes?.[project.rootId]) throw new Error('The server returned an invalid story project.');
            const previous = this.project;
            const bookkeepingOnly = previous?.id === project.id && this.authoringContext(previous) === this.authoringContext(project);
            const changed = this.project?.id !== project.id || this.project?.revision !== project.revision;
            this.project = project;
            let retainedRevisionAdvanced = false;
            for (const [key, b] of this.buffers) {
                // Advance only a baseline captured at the last observed project revision.
                // Locally typed content stays intact; any authored context change still conflicts.
                if (b.storyId === project.id && b.revision === previous?.revision && project.revision > b.revision && bookkeepingOnly && JSON.stringify(b.base) === JSON.stringify(project.nodes[b.nodeId]?.content) && b.baseStyle === project.style) {
                    b.revision = project.revision;
                    retainedRevisionAdvanced ||= b.dirty;
                }
                if (b.storyId !== project.id || b.dirty || b.nodeId === this.nodeId || Array.from(this.formFills.values()).some(f => !f.consumed && f.storyId === b.storyId && f.nodeId === b.nodeId)) continue;
                this.buffers.delete(key);
            }
            if (retainedRevisionAdvanced) this.persistBuffers();
            if (!project.nodes[this.nodeId]) this.nodeId = project.rootId;
            for (const a of this.ancestors()) this.expanded.add(a.id);
            if (changed) { this.renderChrome(); this.renderActivity(); }
            else { this.renderSaveStatus(); this.syncFeedbackJobs(); }
        }
        authoringContext(project) {
            const bookkeeping = new Set(['revision', 'updatedAt', 'mutations', 'jobs', 'proposals', 'outlineRuns']);
            return JSON.stringify(Object.fromEntries(Object.entries(project).filter(([key]) => !bookkeeping.has(key))));
        }
        async loadLibrary() {
            const data = await this.api('/stories?archived=true');
            this.library = data.stories;
            for (const e of data.errors || []) this.fail(errorFrom({ ...e, error: `Story file ${e.file}: ${e.error}` }));
            this.renderLibrary();
        }
        async openUrl(fromHistory = false) {
            const suffix = window.location.pathname.startsWith(this.pageBase) ? window.location.pathname.slice(this.pageBase.length).split('/').filter(Boolean) : [];
            const knownPath = window.location.pathname.startsWith(this.pageBase);
            const storyId = knownPath ? suffix[0] : this.root.dataset.storyId;
            const nodeId = knownPath ? suffix[1] : this.root.dataset.nodeId;
            const tab = new URLSearchParams(window.location.search).get('tab') || 'outline';
            if (!['outline', 'sources', 'continuity', 'written'].includes(tab)) throw new Error('Unknown story section in this link.');
            if (fromHistory && this.project && this.currentDirty()) {
                const proceed = await this.leaveReview();
                if (!proceed) { this.writeUrl(true); return; }
            }
            if (!storyId) { this.project = null; this.showLibrary(); await this.loadLibrary(); return; }
            if (storyId !== this.project?.id) window.AIRPG_PAGE_FEEDBACK.setJobs(FEEDBACK_SCOPE, []);
            const data = await this.api(`/stories/${encodeURIComponent(storyId)}`);
            this.nodeId = nodeId || data.project.rootId;
            if (!data.project.nodes[this.nodeId]) throw new Error('This link names a story section that no longer exists.');
            this.tab = tab;
            this.readOnlyProject = Boolean(data.readOnly); this.libraryMissing = Boolean(data.libraryMissing);
            this.boundState = data.boundState || null;
            this.acceptProject(data.project);
            this.el('story-library').hidden = true;
            this.el('story-workspace').hidden = false;
            this.renderSection();
            if (tab === 'sources') await this.loadSources();
            if (this.project.binding) await this.loadBoundState();
        }
        writeUrl(replace = false) {
            const url = this.project ? `${this.pageBase}/${this.project.id}/${this.nodeId}${this.tab === 'outline' ? '' : `?tab=${this.tab}`}` : this.pageBase;
            window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
        }
        async navigate(storyId, nodeId, tab = this.tab) {
            if (['drawer', 'preparation'].includes(this.dialogKind)) this.closeDialog();
            const priorNodeId = this.nodeId;
            if (this.project && this.currentDirty() && !(await this.leaveReview())) return;
            if (storyId !== this.project?.id) {
                window.AIRPG_PAGE_FEEDBACK.setJobs(FEEDBACK_SCOPE, []);
                const data = await this.api(`/stories/${storyId}`);
                this.project = data.project;
                this.readOnlyProject = Boolean(data.readOnly); this.libraryMissing = Boolean(data.libraryMissing);
                this.boundState = data.boundState || null;
            }
            this.nodeId = nodeId || this.project.rootId;
            if (priorNodeId !== this.nodeId) { this.yoloEnabled = false; this.yoloScope = this.nodeId; }
            this.tab = tab;
            this.node();
            this.acceptProject(this.project);
            this.el('story-library').hidden = true;
            this.el('story-workspace').hidden = false;
            this.writeUrl();
            this.renderSection();
            if (this.dialogKind === 'drawer') this.closeDialog();
            if (tab === 'sources') await this.loadSources();
            this.el('story-detail').focus({ preventScroll: true });
        }
        showLibrary() {
            window.AIRPG_PAGE_FEEDBACK.setJobs(FEEDBACK_SCOPE, []);
            this.el('story-library').hidden = false;
            this.el('story-workspace').hidden = true;
            this.el('story-title').textContent = '';
            this.el('story-save-status').textContent = 'Story library';
        }
        async selectTab(tab) {
            if (this.tab === tab) return;
            if (this.currentDirty() && !(await this.leaveReview())) return;
            this.tab = tab;
            this.writeUrl();
            this.renderChrome();
            this.renderSection();
            if (tab === 'sources') await this.loadSources();
        }
        renderLibrary() {
            const search = this.el('story-search').value.trim().toLowerCase();
            const archive = this.el('story-show-archive').checked;
            const sort = this.el('story-sort').value;
            const stories = this.library.filter(s => (archive || !s.archived) && `${s.title} ${s.premise}`.toLowerCase().includes(search)).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : String(b[sort === 'created' ? 'createdAt' : 'updatedAt']).localeCompare(String(a[sort === 'created' ? 'createdAt' : 'updatedAt'])));
            this.el('story-library-list').innerHTML = stories.length ? stories.map(s => `<article class="stories__card"><h3><a href="${this.pageBase}/${esc(s.id)}" data-action="open-story" data-id="${esc(s.id)}">${esc(s.title)}</a>${s.archived ? ' · Archived' : ''}</h3><p>${esc(s.premise)}</p><p class="help-text">Updated ${esc(new Date(s.updatedAt).toLocaleString())} · ${s.binding ? 'Attached to a game' : 'Standalone story'}${s.reviewDepth ? ` · ${s.reviewDepth === 'unreviewed' ? 'Awaiting human review' : `Deepest reviewed section: ${esc(NAMES[s.reviewDepth] || s.reviewDepth)}`}` : ''}</p>${s.sourceSummary ? `<p class="help-text">${esc(s.sourceSummary.replace(/profile world/g, 'World profile').replace(/live world/g, 'Current game world').replace(/saved world/g, 'Saved game world').replace(/live protagonist/g, 'Current-game protagonist').replace(/saved protagonist/g, 'Saved protagonist').replace(/concept protagonist/g, 'Character concept').replace(/Story-first world/g, 'World from story').replace(/Story-first protagonist/g, 'Protagonist from story'))}</p>` : ''}${s.nextStepLabel ? `<p class="help-text">${esc(s.nextStepLabel.replace(/subscene/g, 'sub-scene').replace(/story:/g, 'premise:'))}</p>` : ''}${s.libraryMissing ? '<p class="stories__notice">This story is carried by the loaded save. Import it as a copy to create an independent authoring library entry.</p>' : ''}<div class="stories__row">${button('open-story', 'Open', `data-id="${esc(s.id)}"`)}${button('duplicate-story', 'Duplicate', `data-id="${esc(s.id)}" data-revision="${s.revision}" ${s.readOnly ? 'disabled' : ''}`)}${button('archive-story', s.archived ? 'Restore' : 'Archive', `data-id="${esc(s.id)}" data-revision="${s.revision}" data-archived="${!s.archived}" ${s.readOnly ? 'disabled' : ''}`)}${s.readOnly ? '' : button('export', 'Export', `data-id="${esc(s.id)}"`)}${s.nextNodeId ? button('open-story', 'Next unfinished', `data-id="${esc(s.id)}" data-node="${esc(s.nextNodeId)}"`) : ''}</div></article>`).join('') : '<p class="stories__empty">No stories here yet. Begin with a premise, or import a story.</p>';
        }
        renderChrome() {
            if (!this.project) return;
            this.el('story-title').textContent = ` / ${this.project.title}`;
            this.el('story-tabs').querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === this.tab ? 'page' : 'false'));
            this.renderSaveStatus();
            this.renderTree();
            const n = this.node();
            this.el('story-outline-panel').querySelectorAll('[data-action="add"], [data-action="export"]').forEach(control => control.disabled = this.readOnlyProject || (control.dataset.action === 'add' && n.type === 'subscene'));
            const path = [...this.ancestors(), n];
            this.el('story-breadcrumbs').innerHTML = path.map((a, i) => `${i ? '<span aria-hidden="true"> / </span>' : ''}<a href="${this.pageBase}/${this.project.id}/${a.id}" data-action="select-node" data-node="${a.id}" ${a.id === n.id ? 'aria-current="location"' : ''}>${esc(a.content.title || NAMES[a.type])}</a>`).join('');
            const siblings = n.parentId ? this.children(this.node(n.parentId)) : [n];
            const index = siblings.findIndex(a => a.id === n.id);
            this.el('story-neighbors').innerHTML = `${button('select-node', 'Previous', index > 0 ? `data-node="${siblings[index - 1].id}"` : 'disabled')}<span>${esc(NAMES[n.type])} ${index + 1} of ${siblings.length}</span>${button('select-node', n.parentId ? `Up to ${NAMES[this.node(n.parentId).type]}` : 'Up', n.parentId ? `data-node="${n.parentId}"` : 'disabled')}${button('select-node', 'Next', index < siblings.length - 1 ? `data-node="${siblings[index + 1].id}"` : 'disabled')}`;
            this.renderReconciliation();
            const localConflict = this.el('story-local-conflict');
            const sourceDraft = this.sourceDrafts.get(this.project.id);
            const contentConflict = this.buffer().dirty && this.buffer().revision !== this.project.revision;
            const sourceConflict = sourceDraft?.dirty && sourceDraft.revision !== this.project.revision;
            localConflict.hidden = !(contentConflict || sourceConflict);
            localConflict.innerHTML = localConflict.hidden ? '' : `<p class="stories__notice">A newer saved story is available. Your local changes are retained.</p>${contentConflict ? button('review-buffer-conflict', 'Review my edits against saved story') : ''}${sourceConflict ? button('review-source-conflict', 'Review my source choices against saved story') : ''}`;
        }
        renderSaveStatus() {
            if (!this.project) return;
            const b = this.buffer();
            const stale = b.dirty && b.revision !== this.project.revision;
            this.el('story-save-status').textContent = this.readOnlyProject ? 'Saved game story · read-only' : this.busy ? 'Updating story…' : stale ? 'Unsaved changes · newer story available' : this.currentDirty() ? 'Unsaved changes' : 'Story saved';
        }
        renderTree() {
            const active = document.activeElement;
            const selectedNode = active?.closest('#story-tree [data-node]')?.dataset.node;
            const selectedDisclosure = active?.closest('#story-tree details')?.dataset.tree;
            const row = n => `<a class="stories__tree-link${n.id === this.nodeId ? ' is-selected' : ''}" href="${this.pageBase}/${this.project.id}/${n.id}" data-action="select-node" data-node="${n.id}" ${n.id === this.nodeId ? 'aria-current="location"' : ''}><span>${esc(NAMES[n.type])} · ${esc(n.content.title)}</span><span class="stories__statuses">${this.badge(n)}</span></a>`;
            const tree = n => {
                const children = this.children(n);
                return `<li>${children.length ? `<details data-tree="${n.id}" ${this.expanded.has(n.id) || n.id === this.project.rootId ? 'open' : ''}><summary>${esc(NAMES[n.type])} · ${esc(n.content.title)}</summary>${row(n)}<ul>${children.map(tree).join('')}</ul></details>` : `${row(n)}${n.type !== 'subscene' && n.collection.state === 'ungenerated' ? `<span class="help-text">${esc(PLURALS[TYPES[TYPES.indexOf(n.type) + 1]])} deferred</span>` : ''}`}</li>`;
            };
            this.el('story-tree').innerHTML = `<ul class="stories__tree">${tree(this.node(this.project.rootId))}</ul>`;
            this.el('story-archive-list').innerHTML = this.nodes().filter(n => n.archived && !this.node(n.parentId).archived).map(n => `<div class="stories__card"><p>${esc(this.path(n.id))}</p>${button('restore-node', 'Restore this subtree', `data-node="${n.id}" ${this.readOnlyProject ? 'disabled' : ''}`)}${button('select-node', 'Inspect', `data-node="${n.id}"`)}</div>`).join('') || '<p class="help-text">No archived sections.</p>';
            if (this.dialogKind === 'drawer') this.el('story-dialog-body').innerHTML = this.drawerHtml();
            if (selectedNode) this.el('story-tree').querySelector(`[data-node="${selectedNode}"]`)?.focus({ preventScroll: true });
            else if (selectedDisclosure) this.el('story-tree').querySelector(`[data-tree="${selectedDisclosure}"] > summary`)?.focus({ preventScroll: true });
        }
        drawerHtml() {
            return `<div class="stories__row">${button('add', 'Add section…', this.readOnlyProject || this.node().type === 'subscene' ? 'disabled' : '')}${button('next-unfinished', 'First unfinished')}</div>${this.el('story-tree').innerHTML}${this.details('drawer-archive', 'Archived sections', this.el('story-archive-list').innerHTML)}${button('export', 'Export story', this.readOnlyProject ? 'disabled' : '')}`;
        }
        field(key, value, { readonly = false, prefix = 'story-field', short = false } = {}) {
            const id = `${prefix}-${key}`;
            const root = this.node().type === 'story';
            const caption = root && key === 'synopsis' ? 'Premise' : root && key === 'outline' ? 'Main plot' : label(key);
            return `<div class="form-group"><label for="${esc(id)}">${esc(caption)}</label>${key === 'title' ? `<input id="${esc(id)}" data-field="${key}" value="${esc(value)}" ${readonly ? 'readonly' : ''}>` : `<textarea id="${esc(id)}" rows="${key === 'outline' ? 6 : short ? 2 : 3}" data-field="${key}" ${readonly ? 'readonly' : ''}>${esc(Array.isArray(value) ? value.join('\n') : value)}</textarea>`}${root && key === 'outline' ? '<p class="help-text">Guide the overall conflict, story arc, and ending direction.</p>' : ''}${LISTS.includes(key) ? '<p class="help-text">One item per line.</p>' : ''}${['actorGoal', 'actorNotes'].includes(key) ? '<p class="help-text">Visible to the protagonist. Review for private information.</p>' : ''}${key === 'privateDirection' ? '<p class="help-text">Private creative direction. Kept separate from protagonist knowledge.</p>' : ''}</div>`;
        }
        details(key, title, html, open = false) {
            return window.AIRPG_WIDGETS.disclosureMarkup({
                document, summaryText: String(title ?? ''), bodyHtml: html,
                className: 'stories__disclosure', dataset: { disclosure: key }, open: this.disclosures.has(key) || open
            });
        }
        renderSection() {
            this.renderChrome();
            if (this.tab === 'sources') return this.renderSources();
            if (this.tab === 'continuity') return this.renderContinuity();
            if (this.tab === 'written') return this.renderWritten();
            const n = this.node();
            if (this.buffers.has(this.bufferKey()) && !this.buffers.get(this.bufferKey()).dirty && !Array.from(this.formFills.values()).some(f => !f.consumed && f.storyId === this.project.id && f.nodeId === n.id)) this.buffers.delete(this.bufferKey());
            const b = this.buffer();
            const readonly = this.readOnlyProject || n.archived || !['unwritten', 'waived'].includes(n.execution.status);
            const common = n.type === 'story' ? ['title', 'synopsis', 'outline', 'intent'] : ['title', 'synopsis', 'intent', 'outline'];
            const leaf = n.type === 'subscene' ? ['setup', 'conflict', 'actorGoal', 'actorNotes', 'completionCriteria', 'failureConditions', 'privateDirection'] : ['narrativePurpose', 'setup', 'conflict'];
            const advanced = [...STRINGS, ...LISTS].filter(k => ![...common, ...leaf, 'authorNotes', 'continuityInputs', 'continuityOutputs'].includes(k));
            const inherited = this.ancestors().filter(a => a.content.authorNotes).map(a => `<article><a href="${this.pageBase}/${this.project.id}/${a.id}" data-action="select-node" data-node="${a.id}">${esc(a.content.title)}</a><p class="stories__prose">${esc(a.content.authorNotes)}</p></article>`).join('') || '<p class="help-text">No inherited author notes.</p>';
            const history = n.history.map((h, i) => `<article class="stories__card"><p>Earlier draft · ${esc(new Date(h.at).toLocaleString())}</p><dl>${Object.entries(h.content || {}).filter(([, v]) => Array.isArray(v) ? v.length : v).map(([k, v]) => `<dt>${esc(label(k))}</dt><dd class="stories__prose">${esc(pretty(v))}</dd>`).join('')}</dl>${readonly ? '' : button('restore-history', 'Restore as a new draft', `data-index="${i}"`)}</article>`).reverse().join('') || '<p class="help-text">Earlier drafts appear here after an edit.</p>';
            const gate = this.gateReason(n);
            const children = this.children(n);
            const activeOutcome = Object.values(this.project.jobs).some(j => j.kind === 'outcome' && j.nodeId === n.id && ACTIVE_JOB.includes(j.status));
            const pendingOutcomeReceipt = this.allReceipts().find(r => r.subsceneId === n.id && !r.accepted);
            const pendingOutcomeProposal = pendingOutcomeReceipt && this.receiptProposal(pendingOutcomeReceipt);
            const siblings = n.parentId ? this.children(this.node(n.parentId)) : [];
            this.el('story-section').innerHTML = `${this.readOnlyProject ? '<p class="stories__notice">This is the pinned saved story. Import it as a copy to edit and synchronize future work independently.</p>' + button('import-as-copy', 'Import saved story as a copy') : ''}<div class="stories__row"><h2>${esc(n.content.title || 'Untitled section')}</h2><div class="stories__statuses">${this.badge(n)}</div></div>${n.archived ? '<p class="stories__notice">This section is archived. Restore it to edit or expand it.</p>' : ''}${readonly ? `<p class="help-text">${this.readOnlyProject ? 'This pinned saved timeline is read-only. Import it as a copy for author editing.' : 'Written and active sections are read-only. Review actual outcomes below; revise future sections separately.'}</p>` : ''}${n.review.invalidationReasons.length ? `<div class="stories__notice"><strong>Needs re-review</strong><ul>${n.review.invalidationReasons.map(r => `<li>${esc(pretty(r))}</li>`).join('')}</ul>${this.ancestors().map(a => `<a href="${this.pageBase}/${this.project.id}/${a.id}" data-action="select-node" data-node="${a.id}">${esc(a.content.title)}</a>`).join(' · ')}</div>` : ''}${b.dirty && b.revision !== this.project.revision ? '<p class="stories__notice">A newer saved story exists. Your edits are retained. Review differences before saving.</p>' + button('review-buffer-conflict', 'Review saved differences') : ''}${siblings.length > 1 ? this.details('siblings', `Review all ${PLURALS[n.type] || 'siblings'}`, this.reviewList(siblings)) : ''}<form id="story-edit-form" aria-label="Edit selected story section"><div class="stories__row">${button('fill-fields', 'Generate missing fields', `id="story-fill-fields" title="Generate missing fields (Alt+G)" ${readonly ? 'disabled' : ''}`, true)}<p class="help-text">Fills empty fields using story and game context. Keeps your existing values.</p></div><div data-ctrl-enter-submit="#story-save">${common.map(k => this.field(k, b.content[k], { readonly })).join('')}${n.type === 'story' ? this.field('style', b.style, { readonly }) : ''}${leaf.map(k => this.field(k, b.content[k], { readonly })).join('')}${this.details('notes', 'Author notes', this.field('authorNotes', b.content.authorNotes, { readonly }) + this.details('inherited', 'Inherited guidance', inherited))}${this.details('continuity-local', `Continuity for this ${NAMES[n.type]}`, this.field('continuityInputs', b.content.continuityInputs, { readonly }) + this.field('continuityOutputs', b.content.continuityOutputs, { readonly }) + this.factsHtml())}${this.details('advanced', 'Additional outline details', advanced.map(k => this.field(k, b.content[k], { readonly })).join(''))}</div><div class="stories__actions"><button id="story-save" type="submit" class="btn btn-primary" ${readonly ? 'disabled' : ''}>Save changes</button>${button('approve', `Approve ${NAMES[n.type]}`, `id="story-approve" ${readonly || b.dirty ? 'disabled' : ''}`)}${button('regenerate', 'Regenerate…', `data-edit-action ${readonly || b.dirty ? 'disabled' : ''}`)}${n.type !== 'subscene' ? button('generate', `Generate ${PLURALS[TYPES[TYPES.indexOf(n.type) + 1]]}`, `data-edit-action ${gate || b.dirty || children.length ? 'disabled' : ''}`) : button('review-play', 'Review for Play', `data-edit-action ${!this.playReviewAvailable(n.id) || b.dirty || !this.project.binding ? 'disabled' : ''}`)}</div></form>${gate ? `<p class="help-text">${esc(gate)}</p>${this.partsGateLinks(n)}` : ''}${n.type === 'subscene' && !this.project.binding ? `<p class="help-text">Set up a world and protagonist before writing.</p>${button('setup-tab', 'Set up world & protagonist')}` : ''}${n.type === 'scene' ? button('review-play', 'Review this scene for Play', `data-scope="scene" ${!this.playReviewAvailable(n.id, 'scene') || !this.project.binding || b.dirty ? 'disabled' : ''}`) : ''}${children.length ? this.details('children', `Review ${PLURALS[TYPES[TYPES.indexOf(n.type) + 1]]}`, this.reviewList(children), true) : ''}<div id="story-yolo-host">${this.yoloHtml()}</div>${this.details('more', 'More actions', `<div class="stories__row stories__mobile-secondary">${button('regenerate', 'Regenerate…', `data-edit-action ${readonly || b.dirty ? 'disabled' : ''}`)}${n.type !== 'subscene' ? button('generate', `Generate ${PLURALS[TYPES[TYPES.indexOf(n.type) + 1]]}`, `data-edit-action ${gate || b.dirty || children.length ? 'disabled' : ''}`) : button('review-play', 'Review for Play', `data-edit-action ${!this.playReviewAvailable(n.id) || b.dirty || !this.project.binding ? 'disabled' : ''}`)}</div><div class="stories__row">${n.type !== 'subscene' ? button('add', `Add ${NAMES[TYPES[TYPES.indexOf(n.type) + 1]]}`, readonly ? 'disabled' : '') : ''}${button('move-up', 'Move up', n.parentId && !readonly ? '' : 'disabled')}${button('move-down', 'Move down', n.parentId && !readonly ? '' : 'disabled')}${button('archive-node', 'Archive subtree…', n.parentId && !n.archived && !this.readOnlyProject ? '' : 'disabled')}${button('waive', 'Mark unnecessary…', readonly ? 'disabled' : '')}</div>`)}${this.details('history', 'Earlier drafts and approvals', `<p>${n.review.approvedAt ? `Last human approval: ${esc(new Date(n.review.approvedAt).toLocaleString())}. ${this.status(n) === 'stale' ? 'This approval needs re-review.' : ''}` : 'No human approval recorded yet.'}</p>` + history)}${this.project.binding && (n.content.characterRefs.length || n.content.placeRefs.length) ? button('prepare-entities', 'Review required characters and places', `data-node="${n.id}"`) : ''}<section id="story-preparation-receipts">${this.preparationReceiptsHtml()}</section><div id="story-node-outcomes">${n.type !== 'subscene' && children.length && children.every(c => ['resolved', 'waived'].includes(c.execution.status)) && n.execution.status !== 'resolved' && this.project.binding ? '<p class="stories__notice">Child work is resolved. This enclosing dramatic outcome still needs its own evidence-backed review.</p>' + (pendingOutcomeProposal ? '' : button('prepare-enclosing', `Prepare ${NAMES[n.type]} outcome review`, `data-node="${n.id}" ${activeOutcome ? 'disabled' : ''}`)) : ''}${this.receiptsHtml(n.id)}</div>`;
            this.el('story-edit-form').addEventListener('submit', event => { event.preventDefault(); const trigger = event.submitter || this.el('story-save'); this.save().catch(error => this.fail(error, trigger)); });
            this.updateEditActions();
            this.renderActivity();
        }
        reviewList(nodes) {
            return `<ol class="stories__review-list">${nodes.map(n => `<li class="stories__card"><a href="${this.pageBase}/${this.project.id}/${n.id}" data-action="select-node" data-node="${n.id}">${esc(n.content.title)}</a><p>${esc(n.content.intent || n.content.synopsis)}</p><div class="stories__statuses">${this.badge(n)}</div>${n.type === 'part' ? `<label class="stories__check"><input type="checkbox" name="reviewed-part" value="${n.id}">I reviewed this part</label>` : ''}<div class="stories__row">${button('move-up', 'Move up', `data-node="${n.id}"`)}${button('move-down', 'Move down', `data-node="${n.id}"`)}</div></li>`).join('')}</ol>${nodes.every(n => n.type === 'part') ? button('approve-parts', 'Approve all reviewed parts') : ''}`;
        }
        gateReason(n) {
            if (n.archived) return 'Restore this section before generation.';
            if (n.type === 'part') {
                const count = this.children(this.node(this.project.rootId)).filter(p => this.status(p) !== 'approved').length;
                if (count) return `${count} ${count === 1 ? 'part still needs' : 'parts still need'} review. All current parts must be approved before any chapters are generated.`;
            }
            if (this.status(n) !== 'approved') return `Review and approve this ${NAMES[n.type]} before generating its next level.`;
            return '';
        }
        partsGateLinks(n) { return n.type === 'part' ? this.children(this.node(this.project.rootId)).filter(p => this.status(p) !== 'approved').map(p => `<a href="${this.pageBase}/${this.project.id}/${p.id}" data-action="select-node" data-node="${p.id}">${esc(p.content.title)}</a>`).join(' · ') : ''; }
        updateEditActions() {
            this.renderSaveStatus();
            if (!this.project) return;
            const b = this.buffer();
            const n = this.node();
            const readonly = this.readOnlyProject || n.archived || !['unwritten', 'waived'].includes(n.execution.status);
            const save = this.el('story-save');
            if (save) save.disabled = this.busy || readonly || !b.dirty;
            const approve = this.el('story-approve');
            if (approve) approve.disabled = this.busy || b.dirty || readonly;
            const fill = this.el('story-fill-fields');
            if (fill) {
                const generating = Object.values(this.project.jobs).some(j => j.kind === 'fill' && j.nodeId === n.id && ACTIVE_JOB.includes(j.status));
                fill.disabled = this.busy || readonly || generating || Boolean(this.sourceDrafts.get(this.project.id)?.dirty);
                fill.textContent = generating ? 'Generating missing fields…' : 'Generate missing fields';
            }
            this.root.querySelectorAll('[data-edit-action]').forEach(button => {
                const action = button.dataset.action;
                button.disabled = this.busy || b.dirty || (readonly && action !== 'review-play') || (action === 'generate' && Boolean(this.gateReason(n) || this.children(n).length)) || (action === 'review-play' && (!this.project.binding || !this.playReviewAvailable(n.id, button.dataset.scope || 'subscene')));
            });
            const start = this.el('story-yolo-start');
            const yoloCheckbox = this.el('story-yolo-enabled');
            if (yoloCheckbox) yoloCheckbox.disabled = Boolean(this.readOnlyProject);
            if (start) start.disabled = this.busy || b.dirty || !this.yoloEnabled || n.archived || this.readOnlyProject;
        }
        async save() {
            const b = this.buffer();
            if (!b.dirty) { if (this.sourceDrafts.get(this.project.id)?.dirty) return this.saveSourceDraft(); return; }
            if (Object.values(this.project.jobs).some(job => ACTIVE_JOB.includes(job.status)) || Object.values(this.project.outlineRuns).some(run => ACTIVE_RUN.includes(run.status))) await this.refreshProject();
            const captured = clone(b.content);
            const style = b.style;
            let contentSaved = false;
            if (JSON.stringify(captured) !== JSON.stringify(b.base)) {
                const data = await this.mutate(`/nodes/${b.nodeId}`, { patch: captured }, { method: 'PATCH', revision: b.revision, dirty: true });
                b.base = captured;
                b.revision = data.project.revision;
                contentSaved = true;
            }
            if (b.nodeId === this.project.rootId && style !== b.baseStyle) {
                try {
                    const styled = await this.mutate('', { patch: { style } }, { method: 'PATCH', revision: b.revision, dirty: true });
                    b.baseStyle = style;
                    b.revision = styled.project.revision;
                } catch (error) {
                    if (contentSaved) error.context = 'The story content was saved. Tone and style changes remain unsaved in your local draft.';
                    this.persistBuffers();
                    throw error;
                }
            }
            b.dirty = JSON.stringify(b.content) !== JSON.stringify(b.base) || b.style !== b.baseStyle;
            this.persistBuffers();
            this.renderSaveStatus();
            this.updateEditActions();
            if (this.sourceDrafts.get(this.project.id)?.dirty) await this.saveSourceDraft();
            this.announce('Story changes saved. Game autosave is separate.');
        }
        announce(message) { this.el('story-announcement').textContent = message; }
        fail(error, returnFocus = document.activeElement) {
            console.error('[Stories]', error);
            const details = error.stack || error.message;
            if (!this.errors.has(details)) {
                this.errors.add(details);
                this.el('story-errors').hidden = false;
                this.el('story-errors').insertAdjacentHTML('beforeend', `<article class="stories__error" role="alert"><strong>${esc(error.message)}</strong>${error.context ? `<p>${esc(error.context)}</p>` : ''}${error.receipt ? `<p>Setup stage: ${esc(error.receipt.status)}</p><ul>${Object.entries(error.receipt.stages || {}).map(([key, done]) => `<li>${esc(label(key))} · ${done ? 'Complete' : 'Pending'}</li>`).join('')}</ul>` : ''}${error.status === 409 ? '<p>Your edits and suggestions are retained. Review the latest saved version before retrying.</p>' : ''}<details><summary>Error details</summary><pre>${esc(details)}</pre></details></article>`);
                window.AIRPG_PAGE_FEEDBACK?.showError(error, { returnFocus });
            }
            this.announce(error.message);
            if (error.status === 409 && this.project) this.refreshProject().catch(refreshError => this.fail(refreshError));
        }
        async refreshProject() {
            const storyId = this.project.id;
            const data = await this.api(`/stories/${storyId}`);
            if (this.project?.id !== storyId) return;
            this.readOnlyProject = Boolean(data.readOnly); this.libraryMissing = Boolean(data.libraryMissing);
            this.acceptProject(data.project);
            if (data.boundState) this.boundState = data.boundState;
        }
        async leaveReview() {
            return new Promise(resolve => {
                this.dialog('Unsaved changes', '<p>Save your edits before leaving this section, keep editing, or discard this local draft.</p><div class="stories__row">' + button('leave-save', 'Save and continue', '', true) + button('leave-keep', 'Keep editing') + button('leave-discard', 'Discard local changes') + '</div>', 'unsaved');
                this.leaveResolve = resolve;
            });
        }
        dialog(title, content, kind = 'review', footer = '', { suspendParent = false, initialFocus } = {}) {
            const initialOpen = !this.el('story-dialog').open;
            if (suspendParent && !initialOpen) {
                const body = document.createDocumentFragment(), previousFooter = document.createDocumentFragment();
                const parent = { title: this.el('story-dialog-title').textContent, kind: this.dialogKind, body, footer: previousFooter, footerHidden: this.el('story-dialog-footer').hidden, focus: document.activeElement };
                while (this.el('story-dialog-body').firstChild) body.append(this.el('story-dialog-body').firstChild);
                while (this.el('story-dialog-footer').firstChild) previousFooter.append(this.el('story-dialog-footer').firstChild);
                this.dialogStack ||= [];
                this.dialogStack.push(parent);
            }
            if (initialOpen && this.el('story-dialog').hidden && !this.dialogCloseRequested) this.dialogTrigger = document.activeElement;
            else if (!suspendParent && this.dialogKind === 'create') {
                this.creationDialogId = null;
                this.cancelCreationGeneration().catch(error => this.fail(error));
            }
            this.dialogKind = kind;
            this.el('story-dialog-title').textContent = title;
            this.el('story-dialog-body').innerHTML = content;
            this.el('story-dialog-footer').innerHTML = footer;
            this.el('story-dialog-footer').hidden = !footer;
            this.el('story-dialog').hidden = false;
            this.el('story-dialog').classList.toggle('stories__drawer', kind === 'drawer');
            window.AIRPG_MODAL_STACK.setLock('story-authoring.dialog', true);
            const ticket = ++this.dialogTicket;
            if (initialOpen) this.openNativeDialog(initialFocus, ticket);
            else this.focusDialog(initialFocus, ticket);
        }
        closeDialog({ nativeClosed = false } = {}) {
            ++this.dialogTicket;
            this.dialogReopenPending = false;
            this.playApprovalRequest = null;
            this.generationInstructionRequest = null;
            if (this.dialogStack?.length) {
                const parent = this.dialogStack.pop();
                this.el('story-dialog-title').textContent = parent.title;
                this.el('story-dialog-body').replaceChildren(parent.body);
                this.el('story-dialog-footer').replaceChildren(parent.footer);
                this.el('story-dialog-footer').hidden = parent.footerHidden;
                this.dialogKind = parent.kind;
                this.el('story-dialog').classList.toggle('stories__drawer', parent.kind === 'drawer');
                this.updateCreationActions();
                if (nativeClosed) this.openNativeDialog(null, this.dialogTicket, parent.focus);
                else if (parent.focus?.isConnected) parent.focus.focus({ preventScroll: true });
                return;
            }
            if (this.dialogKind === 'create') {
                this.creationDialogId = null;
                this.cancelCreationGeneration().catch(error => this.fail(error));
            }
            if (this.el('story-dialog').open && !nativeClosed) {
                this.dialogCloseRequested = true;
                this.dialogLifecycle.close();
            }
            this.el('story-dialog').hidden = true;
            this.dialogKind = null;
            window.AIRPG_MODAL_STACK.setLock('story-authoring.dialog', false);
            if (this.leaveResolve) { this.leaveResolve(false); this.leaveResolve = null; }
        }
        focusDialog(initialFocus, ticket, retainedFocus = null) {
            window.requestAnimationFrame(() => {
                if (ticket !== this.dialogTicket || this.el('story-dialog').hidden || !this.el('story-dialog').open) return;
                const target = retainedFocus?.isConnected ? retainedFocus
                    : (initialFocus && this.el('story-dialog').querySelector(initialFocus))
                        || this.el('story-dialog-body').querySelector('input:not([type="checkbox"]), textarea, button, a, summary')
                        || this.el('story-dialog').querySelector('.modal__close');
                target.focus({ preventScroll: true });
            });
        }
        openNativeDialog(initialFocus, ticket, retainedFocus = null) {
            this.dialogReopenPending = true;
            this.dialogLifecycle.whenClosed().then(() => {
                if (ticket !== this.dialogTicket || this.el('story-dialog').hidden) return;
                this.dialogReopenPending = false;
                this.dialogLifecycle.open({ returnFocus: this.dialogTrigger });
                this.focusDialog(initialFocus, ticket, retainedFocus);
            }).catch(error => this.fail(error));
        }
        onNativeDialogClosed() {
            this.dialogCloseRequested = false;
            if (!this.dialogReopenPending && !this.el('story-dialog').hidden) this.closeDialog({ nativeClosed: true });
            if (this.el('story-dialog').hidden && !this.dialogTrigger?.isConnected) this.el('story-detail').focus({ preventScroll: true });
        }
        async act(action, target) {
            const id = target.dataset.node || this.nodeId;
            switch (action) {
            case 'close-dialog': return this.closeDialog();
            case 'library':
                if (this.project && this.currentDirty() && !(await this.leaveReview())) return;
                this.project = null; this.writeUrl(); this.showLibrary(); return this.loadLibrary();
            case 'open-story': return this.navigate(target.dataset.id, target.dataset.node, 'outline');
            case 'select-node': if (!this.el('story-dialog').hidden) this.closeDialog(); return this.navigate(this.project.id, id);
            case 'new-story': return this.newStory();
            case 'new-fill': {
                const dialogId = this.creationDialogId;
                return this.instructionsDialog('Generate missing fields', 'Fill empty fields in this new story.', 'new-story', feedback => {
                    if (this.creationDialogId !== dialogId) throw new Error('The New story form changed. Your instructions are retained.');
                    return this.generateNewStoryFields(feedback);
                }, { suspendParent: true });
            }
            case 'cancel-new-fill': return this.cancelCreationGeneration();
            case 'import': this.el('story-import-file').click(); return;
            case 'export': return this.exportStory(target.dataset.id || this.project.id);
            case 'duplicate-story': return this.libraryAction('duplicate', target);
            case 'archive-story': return this.libraryAction('archive', target);
            case 'outline-drawer': return this.dialog('Outline', this.drawerHtml(), 'drawer');
            case 'next-unfinished': {
                const frontier = this.frontier(this.node(this.project.rootId));
                if (!frontier) return this.announce('All sections are resolved or waived.');
                return this.navigate(this.project.id, frontier.id, 'outline');
            }
            case 'setup-tab': if (!this.el('story-dialog').hidden) this.closeDialog(); return this.selectTab('sources');
            case 'save': return this.save();
            case 'approve': await this.mutate('/approve', { nodeIds: [id] }); this.renderSection(); return this.announce('This revision is approved by you.');
            case 'approve-parts': {
                const nodeIds = Array.from(this.root.querySelectorAll('[name="reviewed-part"]:checked')).map(input => input.value);
                if (!nodeIds.length) throw new Error('Mark the parts you reviewed before approving them.');
                await this.mutate('/approve', { nodeIds }); this.renderSection(); return;
            }
            case 'fill-fields': return this.fillInstructionsDialog();
            case 'merge-fill': return this.mergeFormFill(target.dataset.id);
            case 'generate': return this.generationDialog('expand');
            case 'regenerate': return this.generationDialog('refine');
            case 'add': if (this.dialogKind === 'drawer') this.closeDialog(); return this.addDialog();
            case 'move-up': case 'move-down': return this.moveNode(id, action === 'move-up' ? -1 : 1);
            case 'archive-node': return this.confirmArchive(id);
            case 'restore-node': await this.mutate('/archive', { nodeId: id, archived: false }); this.renderSection(); return;
            case 'confirm-archive': await this.mutate('/archive', { nodeId: target.dataset.node, archived: true }); this.closeDialog(); this.renderSection(); return;
            case 'waive': return this.waiveDialog();
            case 'restore-history': {
                const h = this.node().history[Number(target.dataset.index)];
                if (!h?.content) throw new Error('The earlier draft is unavailable.');
                const b = this.buffer(); b.content = clone(h.content); b.dirty = true; this.persistBuffers(); this.renderSection(); return this.announce('Earlier content restored to the local draft. Save to create a new revision.');
            }
            case 'leave-keep': return this.closeDialog();
            case 'leave-save': case 'leave-discard': {
                if (action === 'leave-save') await this.save();
                else { for (const fill of this.formFills.values()) if (fill.storyId === this.project.id && fill.nodeId === this.nodeId) fill.consumed = true; this.buffers.delete(this.bufferKey()); this.sourceDrafts.delete(this.project.id); this.sourcesDirty = false; this.persistBuffers(); }
                const resolve = this.leaveResolve; this.leaveResolve = null; this.closeDialog(); resolve(true); return;
            }
            case 'review-buffer-conflict': return this.bufferConflict();
            case 'review-source-conflict': return this.sourceConflict();
            case 'source-rebase': {
                const draft = this.sourceDrafts.get(this.project.id);
                draft.revision = this.project.revision; this.sourcesRevision = this.project.revision;
                this.persistBuffers(); this.closeDialog(); this.renderChrome(); return;
            }
            case 'buffer-rebase': {
                const b = this.buffer(); b.revision = this.project.revision; b.base = clone(this.node().content); b.baseStyle = this.project.style;
                this.persistBuffers(); this.closeDialog(); this.renderSection(); return;
            }
            case 'view-proposal': return this.proposalDialog(target.dataset.id);
            case 'apply-proposal': return this.applyProposal(target.dataset.id);
            case 'reject-proposal': await this.mutate(`/proposals/${target.dataset.id}/reject`); this.closeDialog(); this.renderSection(); return;
            case 'cancel-job': if (this.readOnlyProject) throw new Error('Import this saved timeline as a copy before changing its work.'); await this.api(`/stories/${this.project.id}/jobs/${target.dataset.id}/cancel`, 'POST', { requestId: uuid() }); await this.refreshProject(); return;
            case 'retry-job': {
                const job = this.project.jobs[target.dataset.id];
                if (!job) throw new Error('The generation to retry is unavailable.');
                await this.navigate(this.project.id, job.nodeId);
                if (job.kind === 'fill') return this.fillInstructionsDialog(job.feedback);
                if (['expand', 'refine'].includes(job.kind)) return this.generationDialog(job.kind, job);
                const storyId = this.project.id, nodeId = this.nodeId;
                return this.instructionsDialog('Generate a new suggestion', `Scope: ${this.path(nodeId)}`, `${storyId}/${nodeId}/${job.kind}`, async feedback => {
                    this.requireGenerationTarget(storyId, nodeId);
                    await this.mutate(`/jobs/${job.id}/retry`, { feedback });
                    this.renderActivity();
                }, { feedback: job.feedback });
            }
            case 'yolo-start': return this.startYolo();
            case 'yolo-scope': return this.chooseYoloScope();
            case 'set-yolo-scope': this.yoloScope = target.dataset.node; this.closeDialog(); this.el('story-yolo-host').innerHTML = this.yoloHtml(); return;
            case 'pause-run': case 'cancel-run': return this.runControl(target.dataset.id, action === 'pause-run' ? 'pause' : 'cancel');
            case 'resume-run': return this.resumeReview(target.dataset.id);
            case 'confirm-resume-run': await this.runControl(target.dataset.id, 'resume', { acceptRefreshedContext: true }); this.closeDialog(); return;
            case 'review-run': return this.navigate(this.project.id, this.project.outlineRuns[target.dataset.id].rootId, 'outline');
            case 'save-sources': return this.saveSources();
            case 'binding-preview': return this.bindingPreview();
            case 'binding-commit': await this.mutate('/binding-commit', { previewId: target.dataset.id, reviewed: true }); this.closeDialog(); this.renderSources(); return this.loadBoundState();
            case 'setup-preview': {
                const storyId = this.project.id, nodeId = this.nodeId;
                return this.instructionsDialog('Generate editable setup preview', `Scope: ${this.project.title}`, `${storyId}/${nodeId}/briefs`, feedback => {
                    this.requireGenerationTarget(storyId, nodeId);
                    return this.materializationPreview(feedback);
                });
            }
            case 'setup-commit': return this.commitSetup(target);
            case 'typed-add-entry': case 'typed-duplicate-entry': case 'typed-remove-entry': return this.editTypedCollection(target, action);
            case 'typed-add-field': case 'typed-remove-field': return this.editSetupField(target, action);
            case 'resume-setup': return this.resumeSetup(target.dataset.id);
            case 'review-play': return this.playReview(target.dataset.scope || 'subscene');
            case 'prepare-play': return this.preparePlay(target.dataset.scope);
            case 'prepare-entities': return this.preparationPreview(target.dataset.node || this.nodeId);
            case 'review-preparation': return this.preparationReview(this.project.previews[target.dataset.id]);
            case 'commit-preparation': return this.commitPreparation(target.dataset.id);
            case 'open-play': return this.openPlay(target.dataset.packet, target.dataset.url);
            case 'accept-outcome': return this.acceptOutcome(target.dataset.receipt, target.dataset.proposal);
            case 'prepare-enclosing': case 'generate-outcome': {
                const storyId = this.project.id, nodeId = id, selectedNodeId = this.nodeId;
                return this.instructionsDialog('Generate outcome review', `Scope: ${this.path(nodeId)}. Use actual evidence; instructions cannot change what happened.`, `${storyId}/${nodeId}/outcome`, async feedback => {
                    this.requireGenerationTarget(storyId, selectedNodeId);
                    const data = await this.mutate('/execution/prepare-outcome', { nodeId, reviewed: true, feedback });
                    await this.refreshProject(); this.renderSection();
                    if (data.job) window.AIRPG_PAGE_FEEDBACK.trackJob({ ...data.job, ownerScope: FEEDBACK_SCOPE, label: this.path(nodeId) });
                    this.announce('Preparing outcome review from the preserved actual evidence.');
                });
            }
            case 'review-outcome': return this.outcomeDialog(target.dataset.receipt, target.dataset.proposal);
            case 'add-fact': return this.factDialog();
            case 'edit-fact': return this.factDialog(target.dataset.id);
            case 'remove-fact': return this.removeFact(target.dataset.id);
            case 'review-timelines': return this.reviewTimelines();
            case 'continue-saved': case 'import-as-copy': case 'retry-sync': case 'adopt-library': return this.reconcile(action);
            default: throw new Error(`Unknown Stories action: ${action}.`);
            }
        }
        newStory() {
            const values = this.newStoryDraft.controls;
            this.dialog('New story', `<form id="story-new-form"><div class="stories__row">${button('new-fill', 'Generate missing fields', 'id="story-new-fill" title="Generate missing fields (Alt+G)"', true)}${button('cancel-new-fill', 'Cancel generation', 'id="story-new-fill-cancel" hidden')}<p class="help-text">Fills empty fields using your idea and game context. Keeps your existing values.</p></div><p id="story-new-generation-status" class="help-text" role="status"></p><div class="form-group"><label for="story-new-title">Title</label><input id="story-new-title" name="title" data-new-field="title" value="${esc(values.title)}" required></div><div class="form-group"><label for="story-new-premise">Premise</label><textarea id="story-new-premise" name="premise" data-new-field="premise" rows="5" required>${esc(values.premise)}</textarea></div><div class="form-group"><label for="story-new-main-plot">Main plot</label><textarea id="story-new-main-plot" name="mainPlot" data-new-field="mainPlot" rows="6">${esc(values.mainPlot)}</textarea><p class="help-text">Guide the overall conflict, story arc, and ending direction.</p></div>${this.details('new-options', 'Tone, constraints and author notes', `<div class="form-group"><label for="story-new-style">Tone and style</label><textarea id="story-new-style" name="style" data-new-field="style">${esc(values.style)}</textarea></div><div class="form-group"><label for="story-new-constraints">Constraints · one per line</label><textarea id="story-new-constraints" name="constraints" data-new-field="constraints">${esc(values.constraints)}</textarea></div><div class="form-group"><label for="story-new-notes">Author notes</label><textarea id="story-new-notes" name="authorNotes" data-new-field="authorNotes">${esc(values.authorNotes)}</textarea></div>`)}</form>`, 'create', '<button id="story-new-create" type="submit" form="story-new-form" class="btn btn-primary">Create story</button>');
            this.creationDialogId = uuid();
            this.updateCreationActions();
            const interrupted = this.creationGeneration;
            if (interrupted?.interruption) {
                this.fail(Object.assign(new Error(interrupted.interruption), { code: 'STORY_DRAFT_SCHEMA_CHANGED' }), this.el('story-new-fill'));
                if (interrupted.cancelAfterUpdate) {
                    interrupted.cancelAfterUpdate = false;
                    this.persistNewStoryDraft();
                    this.api(`/story-drafts/jobs/${interrupted.id}/cancel`, 'POST', { requestId: uuid() }).catch(error => {
                        if (error.code === 'STORY_DRAFT_JOB_UNAVAILABLE') {
                            interrupted.cancellationUnavailable = true;
                            this.persistNewStoryDraft();
                        } else this.fail(error, this.el('story-new-fill'));
                    });
                }
            }
            this.el('story-new-form').addEventListener('submit', event => {
                event.preventDefault();
                this.submitDialog(async form => {
                    const data = new FormData(form);
                    const result = await this.api('/stories', 'POST', { requestId: uuid(), title: data.get('title'), premise: data.get('premise'), mainPlot: data.get('mainPlot'), style: data.get('style'), authorNotes: data.get('authorNotes'), constraints: String(data.get('constraints')).split('\n').map(s => s.trim()).filter(Boolean) });
                    this.newStoryDraft = { controls: { title: '', premise: '', mainPlot: '', style: '', constraints: '', authorNotes: '' }, fieldChanges: {} };
                    this.creationGeneration = null;
                    delete this.generationInstructions['new-story'];
                    window.sessionStorage.setItem('airpg.story-editor.generation-instructions', JSON.stringify(this.generationInstructions));
                    this.persistNewStoryDraft();
                    this.closeDialog();
                    await this.navigate(result.project.id, result.project.rootId, 'outline');
                }, event.target).catch(error => this.fail(error));
            });
        }
        persistNewStoryDraft() {
            window.sessionStorage.setItem('airpg.story-editor.new-story', JSON.stringify({ draft: this.newStoryDraft, generation: this.creationGeneration }));
        }
        updateCreationActions() {
            if (this.dialogKind !== 'create') return;
            const job = this.creationGeneration?.job;
            const active = Boolean(this.creationGeneration && !this.creationGeneration.closed && (!job || ACTIVE_JOB.includes(job.status)));
            this.el('story-new-fill').disabled = active;
            this.el('story-new-fill').textContent = active ? 'Generating missing fields…' : 'Generate missing fields';
            this.el('story-new-fill-cancel').hidden = !active;
            this.el('story-new-create').disabled = active;
            this.el('story-new-generation-status').textContent = active ? 'Your form stays editable while generation runs.' : this.creationGeneration?.interruption || (job?.status === 'cancelled' ? 'Generation cancelled. Your draft is retained.' : '');
        }
        async generateNewStoryFields(feedback = '') {
            const createOpen = this.dialogKind === 'create' || this.dialogKind === 'instructions' && this.dialogStack?.at(-1)?.kind === 'create';
            const active = this.creationGeneration && !this.creationGeneration.closed && (!this.creationGeneration.job || ACTIVE_JOB.includes(this.creationGeneration.job.status));
            if (!createOpen || this.el('story-dialog').hidden || active) throw new Error('Open the available New story form before generating fields.');
            const controls = clone(this.newStoryDraft.controls);
            const draft = { ...controls, constraints: controls.constraints.split('\n').map(s => s.trim()).filter(Boolean) };
            const generation = { id: uuid(), job: null, controls, changes: clone(this.newStoryDraft.fieldChanges), closed: false, consumed: false };
            const dialogId = this.creationDialogId;
            this.creationGeneration = generation;
            this.pendingCreationLaunch = generation.id;
            this.persistNewStoryDraft();
            this.updateCreationActions();
            try {
                const result = await this.api('/story-drafts/generations', 'POST', { requestId: generation.id, draft, feedback });
                generation.job = result.job;
                if (generation.closed || this.creationGeneration !== generation || this.creationDialogId !== dialogId) {
                    await this.api(`/story-drafts/jobs/${generation.id}/cancel`, 'POST', { requestId: uuid() });
                    return;
                }
                this.persistNewStoryDraft();
                this.syncFeedbackJobs();
                this.updateCreationActions();
            } catch (error) {
                generation.closed = true;
                this.persistNewStoryDraft();
                this.updateCreationActions();
                throw error;
            } finally { if (this.pendingCreationLaunch === generation.id) this.pendingCreationLaunch = null; }
        }
        async cancelCreationGeneration() {
            const generation = this.creationGeneration;
            if (!generation || generation.closed || generation.consumed) return;
            generation.closed = true;
            this.persistNewStoryDraft();
            this.updateCreationActions();
            this.syncFeedbackJobs();
            if (generation.job && ACTIVE_JOB.includes(generation.job.status)) {
                const result = await this.api(`/story-drafts/jobs/${generation.id}/cancel`, 'POST', { requestId: uuid() });
                generation.job = result.job;
                this.persistNewStoryDraft();
            }
            this.syncFeedbackJobs();
        }
        async pollCreationGeneration() {
            const generation = this.creationGeneration;
            if (!generation || generation.closed || generation.consumed || this.pendingCreationLaunch === generation.id || this.pollingCreation) return;
            this.pollingCreation = true;
            try {
                const { job } = await this.api(`/story-drafts/jobs/${generation.id}`);
                if (this.creationGeneration !== generation || generation.closed) return;
                generation.job = job;
                if (!ACTIVE_JOB.includes(job.status)) {
                    generation.consumed = true;
                    if (job.status === 'completed') {
                        for (const field of Object.keys(generation.controls)) {
                            const valid = value => field === 'constraints' ? Array.isArray(value) && value.every(item => typeof item === 'string') : typeof value === 'string';
                            if (!valid(job.draft?.[field]) || !valid(job.candidate?.[field])) throw new Error(`Generated new story field ${field} is malformed. Your draft is retained.`);
                        }
                        for (const field of Object.keys(generation.controls)) {
                            const before = job.draft[field];
                            if ((Array.isArray(before) ? before.length : before.trim()) || this.newStoryDraft.controls[field] !== generation.controls[field] || (this.newStoryDraft.fieldChanges[field] || 0) !== (generation.changes[field] || 0)) continue;
                            const value = Array.isArray(job.candidate[field]) ? job.candidate[field].join('\n') : job.candidate[field];
                            this.newStoryDraft.controls[field] = value;
                            const control = this.el('story-new-form')?.querySelector(`[data-new-field="${field}"]`);
                            if (control) control.value = value;
                        }
                        this.announce('New story fields filled. Create story when ready.');
                    } else if (job.error && job.status !== 'cancelled') this.fail(errorFrom(job.error), this.el('story-new-fill'));
                }
                this.persistNewStoryDraft();
                this.syncFeedbackJobs();
                this.updateCreationActions();
            } catch (error) {
                generation.closed = true;
                this.persistNewStoryDraft();
                this.syncFeedbackJobs();
                this.updateCreationActions();
                throw error;
            } finally { this.pollingCreation = false; }
        }
        async submitDialog(fn, form) {
            const buttons = Array.from(form.elements).filter(control => control.type === 'submit');
            buttons.forEach(b => b.disabled = true);
            try { return await fn(form); } finally { buttons.forEach(b => b.disabled = false); }
        }
        async importFile(file) {
            if (!file) return;
            const documentValue = JSON.parse(await file.text());
            this.importDocument = documentValue;
            this.dialog('Import story', `<p>Import <strong>${esc(documentValue.project?.title || 'this story')}</strong> as a new copy. Existing stories and saved games remain separate.</p><form id="story-import-form"><div class="form-group"><label for="story-import-mode">Identity</label><select id="story-import-mode"><option value="copy">Import a new copy</option><option value="new">Keep supplied identity · must be unused</option></select></div><button type="submit" class="btn btn-primary">Import story</button></form>`, 'import');
            this.el('story-import-form').addEventListener('submit', event => {
                event.preventDefault();
                this.submitDialog(async () => {
                    const result = await this.api('/stories/import', 'POST', { requestId: uuid(), document: this.importDocument, mode: this.el('story-import-mode').value });
                    this.closeDialog(); this.el('story-import-file').value = ''; await this.navigate(result.project.id, result.project.rootId, 'outline');
                }, event.target).catch(error => this.fail(error));
            });
        }
        async exportStory(id) {
            const data = await this.api(`/stories/${id}/export`);
            const { success, ...documentValue } = data;
            if (documentValue.format !== 'story-authoring-project') throw new Error('The server did not provide a portable story export.');
            const url = URL.createObjectURL(new Blob([JSON.stringify(documentValue, null, 2)], { type: 'application/json' }));
            const a = document.createElement('a'); a.href = url; a.download = `${documentValue.project.title.replace(/[^a-z0-9_-]/gi, '_')}.story.json`; a.click(); URL.revokeObjectURL(url);
            this.announce('Story exported.');
        }
        async libraryAction(action, target) {
            const storyId = target.dataset.id;
            if (action === 'archive' && target.dataset.archived === 'true') {
                this.dialog('Archive story', `<p>Archive this story in the library? It can be restored from the archived list. Its written history remains available.</p><form id="story-library-action"><button type="submit" class="btn btn-primary">Archive story</button></form>`, 'archive');
                this.el('story-library-action').addEventListener('submit', event => {
                    event.preventDefault(); this.submitDialog(async () => { await this.api(`/stories/${storyId}/archive`, 'POST', { expectedRevision: Number(target.dataset.revision), requestId: uuid(), archived: true }); this.closeDialog(); await this.loadLibrary(); }, event.target).catch(error => this.fail(error));
                });
                return;
            }
            const data = await this.api(`/stories/${storyId}/${action}`, 'POST', { expectedRevision: Number(target.dataset.revision), requestId: uuid(), ...(action === 'archive' ? { archived: false } : {}) });
            if (action === 'duplicate') await this.navigate(data.project.id, data.project.rootId, 'outline');
            else await this.loadLibrary();
        }
        addDialog() {
            const parent = this.node();
            if (parent.type === 'subscene') throw new Error('Sub-scenes have no child level.');
            this.dialog(`Add ${NAMES[TYPES[TYPES.indexOf(parent.type) + 1]]}`, `<p>Inside ${esc(this.path(parent.id))}</p><form id="story-add-form"><div class="form-group"><label for="story-add-title">Title</label><input id="story-add-title" name="title" required></div><div class="form-group"><label for="story-add-intent">Intent</label><textarea id="story-add-intent" name="intent" rows="3" required></textarea></div><button type="submit" class="btn btn-primary">Add section</button></form>`, 'add');
            this.el('story-add-form').addEventListener('submit', event => {
                event.preventDefault(); this.submitDialog(async form => { const values = new FormData(form); const result = await this.mutate('/nodes', { parentId: parent.id, content: { title: values.get('title'), synopsis: values.get('intent'), intent: values.get('intent') } }); this.closeDialog(); await this.navigate(this.project.id, result.nodeId, 'outline'); }, event.target).catch(error => this.fail(error));
            });
        }
        async moveNode(id, direction) {
            const n = this.node(id);
            if (!n.parentId) throw new Error('The premise cannot be reordered.');
            const ids = this.children(this.node(n.parentId)).map(c => c.id);
            const index = ids.indexOf(id);
            if (index + direction < 0 || index + direction >= ids.length) return this.announce('This section is already at the end of the list.');
            [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
            await this.mutate('/reorder', { parentId: n.parentId, childIds: ids }); this.renderSection(); this.announce(`Moved ${n.content.title} to position ${index + direction + 1}.`);
        }
        confirmArchive(id) { this.dialog('Archive subtree', `<p>Archive <strong>${esc(this.path(id))}</strong> and its descendants? This can affect future reviews. Written evidence is retained. Restore from Archived sections.</p>${button('confirm-archive', 'Archive subtree', `data-node="${id}"`, true)}`, 'archive'); }
        waiveDialog() {
            const id = this.nodeId;
            this.dialog('Mark planned work unnecessary', '<p>This records an author waiver, separate from work written in Play.</p><form id="story-waive-form"><div class="form-group"><label for="story-waive-reason">Reason</label><textarea id="story-waive-reason" required></textarea></div><button type="submit" class="btn btn-primary">Record waiver</button></form>', 'waive');
            this.el('story-waive-form').addEventListener('submit', event => { event.preventDefault(); this.submitDialog(async () => { await this.mutate('/waive', { nodeId: id, reason: this.el('story-waive-reason').value }); this.closeDialog(); this.renderSection(); }, event.target).catch(error => this.fail(error)); });
        }
        sourceConflict() {
            const draft = this.sourceDrafts.get(this.project.id);
            this.dialog('Review saved source differences', this.diffHtml(this.project.sources, draft.selection, 'Saved sources', 'Your source choices') + '<p>Your selected sources are retained. Accept refreshed context explicitly before retrying the save.</p>' + button('source-rebase', 'Keep my source choices with refreshed context', '', true), 'conflict');
        }
        bufferConflict() {
            const b = this.buffer();
            this.dialog('Review newer saved story', '<p>Your local edits are preserved. Compare them with the current saved section, then explicitly keep your edits against the current story.</p>' + this.diffHtml({ ...this.node().content, ...(b.nodeId === this.project.rootId ? { style: this.project.style } : {}) }, { ...b.content, ...(b.nodeId === this.project.rootId ? { style: b.style } : {}) }, 'Saved now', 'Your local edits') + button('buffer-rebase', 'Keep my edits with refreshed context', '', true), 'conflict');
        }
        frontier(n) {
            if (n.archived || ['resolved', 'waived'].includes(n.execution.status)) return null;
            if (n.type === 'subscene') return n;
            const children = this.children(n);
            if (!children.length && n.collection.state !== 'waived') return n;
            for (const c of children) { const next = this.frontier(c); if (next) return next; }
            return n.collection.state === 'waived' ? null : n;
        }
        generationInstructionsField(key, feedback) {
            if (!Object.hasOwn(this.generationInstructions, key)) this.generationInstructions[key] = feedback === undefined ? '' : feedback;
            window.sessionStorage.setItem('airpg.story-editor.generation-instructions', JSON.stringify(this.generationInstructions));
            return `<div class="form-group"><label for="story-generation-feedback">Generation instructions (optional)</label><textarea id="story-generation-feedback" rows="4" data-generation-key="${esc(key)}">${esc(this.generationInstructions[key])}</textarea><p class="help-text">Applies only to this generation. Your permanent author notes stay unchanged.</p></div>`;
        }
        requireGenerationTarget(storyId, nodeId) {
            if (this.project?.id !== storyId || this.nodeId !== nodeId) throw new Error('The selected story section changed. Your instructions are retained; open generation for the current section.');
        }
        instructionsDialog(title, scope, key, generate, { suspendParent = false, feedback } = {}) {
            const request = { id: uuid() };
            this.dialog(title, `<p>${esc(scope)}</p><form id="story-instructions-form" data-ctrl-enter-submit="#story-instructions-generate">${this.generationInstructionsField(key, feedback)}</form>`, 'instructions', button('close-dialog', 'Cancel') + `<button id="story-instructions-generate" type="submit" form="story-instructions-form" class="btn btn-primary">${esc(title)}</button>`, { suspendParent });
            this.generationInstructionRequest = request;
            this.el('story-instructions-form').addEventListener('submit', event => {
                event.preventDefault();
                this.submitDialog(async () => {
                    if (this.generationInstructionRequest !== request) throw new Error('This generation dialog is no longer active.');
                    const instructions = this.el('story-generation-feedback').value;
                    await generate(instructions);
                    if (this.generationInstructionRequest === request && this.dialogKind === 'instructions') this.closeDialog();
                }, event.target).catch(error => this.fail(error, event.submitter || this.el('story-generation-feedback')));
            });
        }
        fillInstructionsDialog(feedback) {
            const storyId = this.project.id, nodeId = this.nodeId;
            return this.instructionsDialog('Generate missing fields', `Fill empty fields in ${this.path(nodeId)}. Existing values stay in place.`, `${storyId}/${nodeId}/fill`, instructions => {
                this.requireGenerationTarget(storyId, nodeId);
                return this.generateMissingFields(instructions);
            }, { feedback });
        }
        async generateMissingFields(feedback = '') {
            const storyId = this.project.id;
            const n = this.node();
            if (this.readOnlyProject || n.archived || !['unwritten', 'waived'].includes(n.execution.status)) throw new Error('This section cannot be edited.');
            if (this.sourceDrafts.get(this.project.id)?.dirty) throw new Error('Save your source choices before generating fields.');
            if (Object.values(this.project.jobs).some(j => j.kind === 'fill' && j.nodeId === n.id && ACTIVE_JOB.includes(j.status))) throw new Error('Missing fields are already being generated for this section.');
            await this.refreshProject();
            this.requireGenerationTarget(storyId, n.id);
            const b = this.buffer(n.id), draft = { content: clone(b.content), style: b.style };
            const changes = clone(b.fieldChanges || {});
            const result = await this.mutate('/generations', { nodeId: n.id, kind: 'fill', draft, feedback }, { dirty: true, revision: b.revision });
            this.formFills.set(result.job.id, { storyId, nodeId: n.id, fieldChanges: changes, consumed: false });
            this.persistBuffers();
            if (this.project?.id !== storyId) return;
            window.AIRPG_PAGE_FEEDBACK.trackJob({ ...result.job, ownerScope: FEEDBACK_SCOPE, label: this.path(n.id) });
            await this.refreshProject();
            this.updateEditActions();
            this.announce('Generating missing fields. Your draft stays editable.');
        }
        async mergeFormFill(jobId, automatic = false) {
            const tracking = this.formFills.get(jobId);
            if (automatic && (!tracking || tracking.consumed)) return;
            const storyId = this.project.id;
            const { job, proposal } = await this.api(`/stories/${storyId}/jobs/${jobId}`);
            if (this.project?.id !== storyId) return;
            if (job.kind !== 'fill' || job.status !== 'completed' || !proposal?.candidate) throw new Error('This form generation is unavailable or stale. Generate missing fields again.');
            await this.refreshProject();
            if (this.project?.id !== storyId || this.readOnlyProject) return;
            const n = this.node(job.nodeId), b = this.buffer(job.nodeId);
            if (n.archived || !['unwritten', 'waived'].includes(n.execution.status)) throw new Error('This section can no longer receive generated fields.');
            if (b.revision !== this.project.revision) throw new Error('Your draft has newer saved context to review before filling fields. Your text is retained.');
            const changed = [];
            for (const field of [...STRINGS, ...LISTS, ...(n.type === 'story' ? ['style'] : [])]) {
                const before = field === 'style' ? job.draft.style : job.draft.content[field];
                const current = field === 'style' ? b.style : b.content[field];
                if ((Array.isArray(before) ? before.length : before.trim()) || JSON.stringify(current) !== JSON.stringify(before)) continue;
                if (automatic && (b.fieldChanges?.[field] || 0) !== (tracking.fieldChanges[field] || 0)) continue;
                const value = field === 'style' ? proposal.candidate.style : proposal.candidate.content[field];
                if (JSON.stringify(current) === JSON.stringify(value)) continue;
                if (field === 'style') b.style = value; else b.content[field] = clone(value);
                changed.push(field);
            }
            b.dirty = JSON.stringify(b.content) !== JSON.stringify(b.base) || b.style !== b.baseStyle;
            this.formFills.set(jobId, { ...(tracking || {}), storyId, nodeId: n.id, consumed: true });
            this.persistBuffers();
            if (this.nodeId === n.id && this.tab === 'outline') {
                for (const field of changed) {
                    const control = this.el('story-section').querySelector(`[data-field="${field}"]`);
                    if (control) control.value = pretty(field === 'style' ? b.style : b.content[field]);
                }
                this.updateEditActions();
            }
            this.renderActivity();
            this.announce(changed.length ? 'Missing fields filled in your draft. Save changes when ready.' : 'Your existing draft was preserved. No fields needed filling.');
            if (!automatic) this.closeDialog();
        }
        async consumeFormFills() {
            for (const [id, tracking] of this.formFills) {
                if (tracking.storyId !== this.project?.id || tracking.consumed) continue;
                const job = this.project.jobs[id];
                if (!job || ACTIVE_JOB.includes(job.status)) continue;
                if (job.status === 'completed') {
                    try { await this.mergeFormFill(id, true); }
                    catch (error) { tracking.consumed = true; this.persistBuffers(); this.fail(error); }
                } else {
                    tracking.consumed = true;
                    this.persistBuffers();
                    if (job.error) this.fail(errorFrom(job.error));
                }
            }
        }
        generationDialog(kind, priorJob = null) {
            const n = this.node(), storyId = this.project.id;
            const key = `${storyId}/${n.id}/${kind}`, request = { id: uuid() };
            const title = kind === 'expand' ? `Generate ${PLURALS[TYPES[TYPES.indexOf(n.type) + 1]]}` : 'Regenerate suggestion';
            const siblings = n.parentId ? this.children(this.node(n.parentId)).filter(c => ['unwritten', 'waived'].includes(c.execution.status)) : [];
            this.dialog(title, `<p>Scope: ${esc(this.path(n.id))}</p><p class="help-text">Existing text stays in place until you review and use a suggestion. Generated sections require your approval.</p><form id="story-generate-form" data-ctrl-enter-submit="#story-generation-submit">${this.generationInstructionsField(key, priorJob?.feedback)}${kind === 'expand' ? `<div class="form-group"><label for="story-generation-count">Number of sections</label><input id="story-generation-count" type="number" min="1" step="1" placeholder="Choose a finite structure automatically" value="${priorJob?.count ?? ''}"></div>` : `<div class="form-group"><label for="story-generation-scope">Suggestion scope</label><select id="story-generation-scope"><option value="node">This section</option><option value="siblings">Selected unwritten siblings</option><option value="descendants">Unwritten descendants of this section</option></select></div>${this.details('regenerate-siblings', 'Choose siblings', siblings.map(s => `<label class="stories__check"><input type="checkbox" name="suggestion-sibling" value="${s.id}">${esc(s.content.title)}</label>`).join(''))}`}</form>`, 'generate', button('close-dialog', 'Cancel') + `<button id="story-generation-submit" type="submit" form="story-generate-form" class="btn btn-primary">${esc(title)}</button>`);
            this.generationInstructionRequest = request;
            this.el('story-generate-form').addEventListener('submit', event => {
                event.preventDefault(); this.submitDialog(async () => {
                    if (this.generationInstructionRequest !== request) throw new Error('This generation dialog is no longer active.');
                    this.requireGenerationTarget(storyId, n.id);
                    const feedback = this.el('story-generation-feedback').value;
                    const countText = this.el('story-generation-count')?.value;
                    const count = countText ? Number(countText) : undefined;
                    if (count !== undefined && (!Number.isSafeInteger(count) || count <= 0)) throw new Error('Number of sections must be a positive whole number.');
                    const scope = this.el('story-generation-scope')?.value || 'node';
                    let ids = [n.id];
                    if (scope === 'siblings') ids = Array.from(this.root.querySelectorAll('[name="suggestion-sibling"]:checked')).map(el => el.value);
                    if (scope === 'descendants') {
                        const collect = node => this.children(node).flatMap(c => [c, ...collect(c)]);
                        ids = collect(n).filter(c => ['unwritten', 'waived'].includes(c.execution.status)).map(c => c.id);
                    }
                    if (!ids.length) throw new Error('Select at least one unwritten section.');
                    for (const nodeId of ids) {
                        this.requireGenerationTarget(storyId, n.id);
                        const result = await this.mutate('/generations', { nodeId, kind, feedback, ...(count === undefined ? {} : { count }) });
                        window.AIRPG_PAGE_FEEDBACK?.trackJob({ ...result.job, ownerScope: FEEDBACK_SCOPE, label: this.path(result.job.nodeId) });
                    }
                    if (this.generationInstructionRequest === request && this.dialogKind === 'generate') this.closeDialog();
                    this.renderActivity(); this.announce('Suggestions queued for review.');
                }, event.target).catch(error => this.fail(error));
            });
        }
        diffHtml(before, after, beforeLabel = 'Current', afterLabel = 'Suggested') {
            const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
            const rows = keys.map(key => {
                const changed = JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]);
                return {
                    label: `${label(key)}${changed ? ' · Changed' : ''}`, changed,
                    before: pretty(before?.[key]) || 'Empty', after: pretty(after?.[key]) || 'Empty'
                };
            });
            return window.AIRPG_WIDGETS.createFieldComparison({
                document, rows, beforeLabel, afterLabel,
                classNames: { root: 'stories__diff', field: 'stories__diff-field', columns: 'stories__diff-columns', text: 'stories__prose' }
            }).outerHTML;
        }
        proposalDialog(id) {
            const proposal = this.project.proposals[id];
            if (!proposal) throw new Error('This suggestion is unavailable.');
            if (proposal.kind === 'fill') {
                const job = this.project.jobs[proposal.jobId];
                this.dialog('Generated missing fields', this.diffHtml(job.draft, proposal.candidate, 'Submitted draft', 'Generated fields') + '<p class="help-text">Fills blanks in your local draft. Save and approval remain separate.</p>' + button('merge-fill', 'Fill remaining blanks', `data-id="${job.id}" ${job.status !== 'completed' || this.readOnlyProject ? 'disabled' : ''}`, true), 'fill');
                return;
            }
            if (proposal.kind === 'briefs') {
                if (this.readOnlyProject) return this.dialog('Saved setup suggestion · read-only', this.typedFields(proposal.candidate, [], true) + button('import-as-copy', 'Import saved story as a copy', '', true), 'saved-setup');
                return this.setupReview(proposal);
            }
            if (proposal.kind === 'outcome') {
                const receipt = Object.values(this.project.receipts).find(r => r.proposalId === id || r.outcomeProposalId === id || this.project.jobs[proposal.jobId]?.receiptId === r.id);
                if (!receipt) throw new Error('This outcome suggestion has no corresponding actual-play receipt.');
                return this.outcomeDialog(receipt.id, id);
            }
            let diff;
            if (proposal.kind === 'expand') diff = proposal.candidate.children.map((content, index) => `<article><h3>Suggested ${index + 1} · ${esc(content.title)}</h3>${this.diffHtml({}, content)}</article>`).join('');
            else if (proposal.kind === 'revision') diff = proposal.candidate.changes.map(change => `<article><label class="stories__check"><input type="checkbox" name="revision-selection" value="${change.nodeId}" checked>Review change to ${esc(this.path(change.nodeId))}</label><p>${esc(change.reason)}</p>${this.evidenceHtml(change.evidenceIds)}${this.diffHtml(this.node(change.nodeId).content, change.content)}</article>`).join('');
            else diff = this.diffHtml(proposal.before?.content || proposal.before || this.node(proposal.nodeId).content, proposal.candidate.content);
            this.dialog('Review suggestion', `<p>${esc(this.path(proposal.nodeId))}</p>${proposal.feedback ? `<p>Suggestion instructions: ${esc(proposal.feedback)}</p>` : ''}${diff}<p class="help-text">Using a suggestion creates a draft. Your approval is a separate step.</p><div class="stories__row">${button('apply-proposal', 'Use suggestion', `data-id="${id}" ${this.buffer().dirty || this.readOnlyProject ? 'disabled' : ''}`, true)}${button('reject-proposal', 'Keep current', `data-id="${id}" ${this.buffer().dirty || this.readOnlyProject ? 'disabled' : ''}`)}</div>${this.buffer().dirty ? '<p class="stories__notice">Save your local changes before accepting or rejecting this suggestion.</p>' : ''}`, 'proposal');
        }
        async applyProposal(id) {
            const proposal = this.project.proposals[id];
            const selectedNodeIds = proposal.kind === 'revision' ? Array.from(this.root.querySelectorAll('[name="revision-selection"]:checked')).map(el => el.value) : undefined;
            if (selectedNodeIds && !selectedNodeIds.length) throw new Error('Select a future change to apply, or keep the current outline.');
            await this.mutate(`/proposals/${id}/apply`, selectedNodeIds ? { selectedNodeIds } : {}); this.closeDialog(); this.renderSection(); this.announce('Suggestion saved as a draft.');
        }
        syncFeedbackJobs() {
            const jobs = !this.project || this.readOnlyProject ? [] : [
                ...Object.values(this.project.jobs).map(job => ({ ...job, label: this.path(job.nodeId) })),
                ...Object.values(this.project.outlineRuns).map(run => ({ ...run, label: this.path(run.rootId), kind: 'Filling outline' }))
            ];
            if (this.creationGeneration?.job && !this.creationGeneration.closed && !this.creationGeneration.consumed) jobs.push({ ...this.creationGeneration.job, label: 'New story · missing fields' });
            window.AIRPG_PAGE_FEEDBACK.setJobs(FEEDBACK_SCOPE, jobs);
        }
        renderActivity() {
            this.syncFeedbackJobs();
            if (!this.project) return;
            const jobs = Object.values(this.project.jobs);
            const proposals = Object.values(this.project.proposals).filter(p => p.status === 'pending' && !(p.kind === 'fill' && this.formFills.get(p.jobId)?.consumed));
            this.el('story-activity').innerHTML = `${jobs.length ? this.details('jobs', 'Generation activity', jobs.map(j => `<article class="stories__card"><p><strong>${esc(this.path(j.nodeId))}</strong> · ${esc(j.kind === 'fill' ? 'Generating missing fields' : j.kind === 'briefs' ? 'Preparing setup' : j.kind === 'expand' ? 'Expanding outline' : j.kind === 'outcome' ? 'Reviewing actual outcome' : 'Suggesting changes')} · ${esc(j.status)}</p>${j.error ? `<p class="stories__error">${esc(j.error.error)}</p><details><summary>Error details</summary><pre>${esc(j.error.stack)}</pre></details>` : ''}<div class="stories__row">${ACTIVE_JOB.includes(j.status) && !this.readOnlyProject ? button('cancel-job', j.kind === 'fill' ? 'Cancel generation' : 'Cancel this suggestion', `data-id="${j.id}"`) : ''}${['failed', 'cancelled', 'conflicted', 'interrupted'].includes(j.status) ? button('retry-job', j.kind === 'fill' ? 'Generate missing fields again' : 'Generate a new suggestion', `data-id="${j.id}" ${(j.kind !== 'fill' && this.buffer().dirty) || this.readOnlyProject ? 'disabled' : ''}`) : ''}${j.proposalId && this.project.proposals[j.proposalId]?.status === 'pending' ? button('view-proposal', j.kind === 'fill' ? 'View generated fields' : 'Review suggestion', `data-id="${j.proposalId}"`) : ''}</div></article>`).join(''), jobs.some(j => ACTIVE_JOB.includes(j.status))) : ''}${proposals.length ? `<div class="stories__suggestions"><h3>Suggestions ready for review</h3>${proposals.map(p => button('view-proposal', `${p.kind === 'fill' ? 'Generated missing fields' : p.kind === 'briefs' ? 'Setup preview' : p.kind === 'outcome' ? 'Actual outcome' : p.kind === 'revision' ? 'Future outline changes' : 'Outline suggestion'} · ${this.node(p.nodeId).content.title}`, `data-id="${p.id}"`)).join('')}</div>` : ''}`;
            for (const j of jobs) if (j.error && !(j.kind === 'fill' && j.error.code === 'STORY_CANDIDATE_STALE')) this.fail(errorFrom(j.error));
        }
        currentRun() {
            const runs = Object.values(this.project?.outlineRuns || {});
            return runs.find(r => ACTIVE_RUN.includes(r.status)) || runs.find(r => ['paused', 'failed', 'conflicted'].includes(r.status)) || runs[runs.length - 1];
        }
        yoloHtml() {
            const run = this.currentRun();
            if (this.readOnlyProject) return this.details('yolo', 'Saved outline work · read-only', `<p>Import this saved timeline as a copy before changing outline work. Refresh does not resume it.</p>${run ? `<p>Recorded state: ${esc(run.status)} · ${Array.isArray(run.completedSteps) ? run.completedSteps.length : run.completedSteps || 0} steps recorded.</p>` : ''}`);
            const scope = run && !['completed', 'cancelled'].includes(run.status) ? run.rootId : this.yoloScope || this.nodeId;
            const n = this.node(scope);
            const completed = Array.isArray(run?.completedSteps) ? run.completedSteps.length : run?.completedSteps || 0;
            const generated = Array.isArray(run?.completedSteps) ? run.completedSteps.filter(step => step.kind !== 'node-complete').length : completed;
            const pending = Number.isSafeInteger(run?.knownRemainingSteps) ? run.knownRemainingSteps : null;
            const preserved = this.children(n).length ? 'Existing sections are preserved.' : 'Missing collections are planned once, then filled in order.';
            let content = `<div class="form-group"><label for="story-yolo-scope">Scope</label><textarea id="story-yolo-scope" readonly rows="2">${esc(this.path(scope))}</textarea></div><p>Complete through: ${n.type === 'subscene' ? 'Missing sub-scene details and protagonist goals' : 'Sub-scenes and protagonist goals'}</p><p class="help-text">Skips approval stops inside this scope. Keeps existing text. New sections are marked Accepted by YOLO. Does not start Play or create a world.</p>`;
            if (run && !['completed', 'cancelled'].includes(run.status)) {
                content += `<p><strong>${esc({ 'pause-requested': 'Finishing this step, then pausing', conflicted: 'Review changes before resuming', failed: 'Stopped on an error', paused: 'Paused · resume is explicit' }[run.status] || run.status)}</strong> · ${run.currentNodeId ? esc(this.path(run.currentNodeId)) : esc(this.path(run.rootId))}</p><p>${completed} steps complete${pending === null ? '' : ` · ${pending} known pending steps`}${pending === null ? ' · Remaining work is being planned' : ' · More may be planned'}</p>${ACTIVE_RUN.includes(run.status) ? '<progress aria-label="Outline work in progress"></progress>' : ''}${run.error ? `<div class="stories__error"><strong>${esc(run.error.error || run.error.message)}</strong><details><summary>Error details</summary><pre>${esc(run.error.stack)}</pre></details></div>` : ''}<div class="stories__row">${ACTIVE_RUN.includes(run.status) ? button('pause-run', 'Pause after this step', `data-id="${run.id}" ${run.status === 'pause-requested' ? 'disabled' : ''}`) + button('cancel-run', 'Cancel run', `data-id="${run.id}"`) : button('resume-run', 'Review and resume this scope', `data-id="${run.id}"`) + button('cancel-run', 'Cancel run', `data-id="${run.id}"`)}</div>`;
            } else {
                if (run) content += `<p>${run.status === 'completed' ? generated ? 'Outline run complete. Human review is still required.' : 'Nothing missing in this scope.' : 'Run cancelled. Completed sections were retained.'}</p>${button('review-run', 'Review generated sections', `data-id="${run.id}"`)}`;
                content += `<label class="stories__check"><input id="story-yolo-enabled" type="checkbox" ${this.yoloEnabled ? 'checked' : ''}>Enable YOLO for this scope</label>${button('yolo-scope', 'Change scope…')}<p class="help-text">${preserved}</p><div class="form-group"><label for="story-yolo-policy">Structure</label><select id="story-yolo-policy"><option value="automatic">Plan missing sections automatically</option><option value="counts">Choose finite counts for missing collections</option></select></div>${this.details('yolo-counts', 'Finite counts', TYPES.slice(TYPES.indexOf(n.type) + 1).map(type => `<div class="form-group"><label for="story-yolo-count-${type}">${esc(label(PLURALS[type]))} per parent</label><input type="number" min="1" step="1" id="story-yolo-count-${type}" value="2"></div>`).join(''))}${button('yolo-start', `Start YOLO for ${n.type === 'story' ? 'whole story' : `this ${NAMES[n.type]}`}`, `id="story-yolo-start" ${!this.yoloEnabled || this.buffer().dirty ? 'disabled' : ''}`, true)}`;
            }
            return this.details('yolo', `YOLO · Fill outline${run ? ` · ${run.status}` : ''}`, content, Boolean(run && ACTIVE_RUN.includes(run.status)));
        }
        chooseYoloScope() { this.dialog('Choose YOLO scope', `<p>Select the exact outline subtree to fill. Scope stays fixed while running.</p><div class="stories__scope-list">${this.nodes().filter(n => !n.archived).map(n => button('set-yolo-scope', this.path(n.id), `data-node="${n.id}"`)).join('')}</div>`, 'scope'); }
        async startYolo() {
            if (!this.yoloEnabled) throw new Error('Enable YOLO explicitly before starting.');
            const rootId = this.yoloScope || this.nodeId;
            const counts = {};
            if (this.el('story-yolo-policy').value === 'counts') {
                for (const type of TYPES.slice(TYPES.indexOf(this.node(rootId).type) + 1)) {
                    const value = Number(this.el(`story-yolo-count-${type}`).value);
                    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${PLURALS[type]} count must be a positive whole number.`);
                    counts[type] = value;
                }
            }
            const data = await this.mutate('/outline-runs', { rootId, mode: 'yolo', ...(Object.keys(counts).length ? { counts } : {}) });
            this.yoloEnabled = false; this.yoloScope = rootId;
            this.el('story-yolo-host').innerHTML = this.yoloHtml();
            window.AIRPG_PAGE_FEEDBACK?.trackJob({ ...data.run, ownerScope: FEEDBACK_SCOPE, label: this.path(data.run.rootId), kind: 'Filling outline' });
            this.announce(`YOLO started for ${this.path(rootId)}.`);
        }
        async runControl(id, operation, extra = {}) {
            if (this.readOnlyProject) throw new Error('Import this saved timeline as a copy before changing outline work.');
            const path = `/stories/${this.project.id}/outline-runs/${id}/${operation}`;
            const data = await this.api(path, 'POST', operation === 'resume' ? this.envelope(extra) : { requestId: uuid() });
            if (data.project) this.acceptProject(data.project); else await this.refreshProject();
            if (this.el('story-yolo-host')) this.el('story-yolo-host').innerHTML = this.yoloHtml();
            this.announce(operation === 'pause' ? 'The outline run will pause after this step.' : operation === 'cancel' ? 'The outline run was cancelled. Completed sections remain.' : 'This outline scope resumed.');
        }
        resumeReview(id) {
            const run = this.project.outlineRuns[id];
            this.dialog('Review outline run before resuming', `<p>Resume ${esc(this.path(run.rootId))} using the current saved context. Existing text and completed steps are retained.</p>${run.error ? `<p>${esc(run.error.error)}</p><details><summary>Error details</summary><pre>${esc(run.error.stack)}</pre></details>` : ''}<p>Changes to the selected outline, sources, or actual continuity are rechecked before work continues.</p>${button('confirm-resume-run', 'Resume this scope with refreshed context', `data-id="${id}" ${this.buffer().dirty || this.readOnlyProject ? 'disabled' : ''}`, true)}`, 'resume');
        }
        async poll() {
            await this.pollCreationGeneration();
            if (!this.project || this.polling || this.busy) return;
            this.polling = true;
            const storyId = this.project.id;
            try {
                const jobs = this.readOnlyProject ? [] : Object.values(this.project.jobs).filter(j => ACTIVE_JOB.includes(j.status));
                const runs = this.readOnlyProject ? [] : Object.values(this.project.outlineRuns).filter(r => ACTIVE_RUN.includes(r.status));
                for (const job of jobs) await this.api(`/stories/${storyId}/jobs/${job.id}`);
                for (const run of runs) await this.api(`/stories/${storyId}/outline-runs/${run.id}`);
                const data = await this.api(`/stories/${storyId}`);
                if (this.project?.id !== storyId) return;
                const beforeNode = this.node();
                const selectionChanged = JSON.stringify({ content: beforeNode.content, children: beforeNode.children, archived: beforeNode.archived, review: beforeNode.reviewStatus, execution: beforeNode.execution }) !== JSON.stringify({ content: data.project.nodes[this.nodeId]?.content, children: data.project.nodes[this.nodeId]?.children, archived: data.project.nodes[this.nodeId]?.archived, review: data.project.nodes[this.nodeId]?.reviewStatus, execution: data.project.nodes[this.nodeId]?.execution });
                const focusedAction = document.activeElement?.closest('#story-section [data-action]')?.dataset.action;
                const focusedId = document.activeElement?.id;
                const dirty = this.currentDirty();
                this.readOnlyProject = Boolean(data.readOnly); this.libraryMissing = Boolean(data.libraryMissing);
                this.acceptProject(data.project);
                await this.consumeFormFills();
                this.updateEditActions();
                if (data.boundState) { this.boundState = data.boundState; this.renderReconciliation(); }
                if (selectionChanged && !dirty && !document.activeElement.closest?.('#story-section input, #story-section textarea, #story-section select') && this.el('story-dialog').hidden && this.tab !== 'sources') this.renderSection();
                else if (runs.length && this.el('story-yolo-host')) this.el('story-yolo-host').innerHTML = this.yoloHtml();
                if (focusedId && this.el(focusedId)) this.el(focusedId).focus({ preventScroll: true });
                else if (focusedAction) this.el('story-section').querySelector(`[data-action="${focusedAction}"]`)?.focus({ preventScroll: true });
                for (const run of Object.values(this.project.outlineRuns)) if (run.error) this.fail(errorFrom(run.error));
            } finally { this.polling = false; }
        }
        async loadSources() {
            this.sourceCatalog = await this.api('/sources');
            if (this.tab === 'sources') this.renderSources();
        }
        sourceValue(source, collection) {
            if (!source) return '';
            if (source.kind === 'concept') return 'concept';
            const index = collection.findIndex(s => s.kind === source.kind && s.id === source.id && s.saveType === source.saveType);
            if (index < 0) return 'unavailable';
            return String(index);
        }
        renderSources() {
            const draft = this.readOnlyProject ? null : this.sourceDrafts.get(this.project.id);
            const sources = draft?.selection || this.project.sources;
            this.sourcesDirty = Boolean(draft?.dirty);
            this.sourcesRevision = draft?.revision || this.project.revision;
            const catalog = this.sourceCatalog;
            if (!catalog) { this.el('story-section').innerHTML = '<h2>World &amp; protagonist</h2><p role="status">Loading available sources…</p>'; return; }
            const worldValue = this.sourceValue(sources.world, catalog.worlds);
            const characterValue = this.sourceValue(sources.protagonist, catalog.protagonists);
            const concept = sources.protagonist?.concept || { name: '', description: '', class: '', race: '', personalityType: '', personalityTraits: [], personalityNotes: '', goals: [] };
            const options = (items, current) => items.map((s, i) => `<option value="${i}" ${current === String(i) ? 'selected' : ''}>${esc(s.label)} · ${s.kind === 'profile' ? 'Reusable world profile' : s.kind === 'saved' ? 'Saved game · read-only planning' : 'Current game'}</option>`).join('');
            this.el('story-section').innerHTML = `<h2>World &amp; protagonist</h2><p>Choose either source, both, or neither. Planning previews leave the current game untouched.</p><form id="story-sources-form"><div class="stories__source-grid"><section><h3>World source</h3><div class="form-group"><label for="story-world-source">World</label><select id="story-world-source"><option value="">Create from story · no existing world</option>${worldValue === 'unavailable' ? '<option value="unavailable" selected>Selected source unavailable · choose another explicitly</option>' : ''}${options(catalog.worlds, worldValue)}</select></div><p class="help-text">A world profile is a reusable recipe. An existing game world includes lived history. Saved worlds are read for planning; writing there requires the ordinary Load action on Play.</p></section><section><h3>Protagonist source</h3><div class="form-group"><label for="story-protagonist-source">Protagonist</label><select id="story-protagonist-source"><option value="">Create from story · no existing protagonist</option><option value="concept" ${characterValue === 'concept' ? 'selected' : ''}>Adapt a character concept</option>${characterValue === 'unavailable' ? '<option value="unavailable" selected>Selected protagonist unavailable · choose another explicitly</option>' : ''}${options(catalog.protagonists, characterValue)}</select></div><div class="form-group"><label for="story-character-mode">Reuse approach</label><select id="story-character-mode"><option value="concept" ${sources.characterMode === 'concept' ? 'selected' : ''}>Review concept adaptation to world</option><option value="existing" ${sources.characterMode === 'existing' ? 'selected' : ''}>Preserve actual protagonist in same game world</option></select></div><p class="help-text">Incompatible mechanics require reviewed concept adaptation. Actual reuse preserves the same-world character and memories.</p></section></div>${this.details('concept', 'Character concept details', this.typedFields(concept, ['concept']))}<div class="stories__row"><button type="submit" class="btn btn-primary">Save source choices</button>${button('binding-preview', 'Review source compatibility')}${button('setup-preview', 'Prepare editable setup preview')}</div><p id="story-source-status" role="status">${this.sourcesDirty ? 'Unsaved source choices' : 'Sources saved.'}</p></form><p class="help-text">Setup uses approved outline depth. Future entities stay intended facts; only initial playable setup is created.</p><section id="story-setup-receipts">${this.setupReceiptsHtml()}</section>`;
            const form = this.el('story-sources-form');
            if (this.readOnlyProject) {
                form.querySelectorAll('input, textarea, select, button').forEach(control => control.disabled = true);
                form.insertAdjacentHTML('beforebegin', '<p class="stories__notice">This saved timeline is read-only. Import it as a copy to edit its source choices or prepare new setup.</p>' + button('import-as-copy', 'Import saved story as a copy'));
            }
            const changed = () => {
                try {
                    const selection = this.readSources();
                    this.sourcesDirty = JSON.stringify(selection) !== JSON.stringify(this.project.sources);
                    this.sourceDrafts.set(this.project.id, { revision: this.sourcesRevision, selection, dirty: this.sourcesDirty });
                    this.persistBuffers(); this.renderSaveStatus();
                    this.el('story-source-status').textContent = this.sourcesDirty ? 'Unsaved source choices' : 'Sources saved.';
                } catch (error) { this.fail(error); }
            };
            form.addEventListener('input', changed);
            form.addEventListener('change', changed);
            form.addEventListener('submit', event => { event.preventDefault(); this.saveSources().catch(error => this.fail(error)); });
        }
        readSources() {
            const w = this.el('story-world-source').value;
            const c = this.el('story-protagonist-source').value;
            if (w === 'unavailable' || c === 'unavailable') throw new Error('Select an available source before saving.');
            const source = item => ({ kind: item.kind, id: item.id, ...(item.saveId ? { saveId: item.saveId } : {}), ...(item.saveType ? { saveType: item.saveType } : {}) });
            const selected = { world: w === '' ? null : source(this.sourceCatalog.worlds[Number(w)]), protagonist: c === '' ? null : c === 'concept' ? { kind: 'concept', concept: this.readTyped({ concept: clone(this.sourceDrafts.get(this.project.id)?.selection.protagonist?.concept || this.project.sources.protagonist?.concept || { name: '', description: '', class: '', race: '', personalityType: '', personalityTraits: [], personalityNotes: '', goals: [] }) }, this.el('story-sources-form')).concept } : source(this.sourceCatalog.protagonists[Number(c)]), characterMode: this.el('story-character-mode').value };
            if (selected.world) delete selected.world.saveId;
            return selected;
        }
        async saveSources() {
            const sources = this.readSources();
            this.sourceDrafts.set(this.project.id, { revision: this.sourcesRevision, selection: sources, dirty: true });
            await this.saveSourceDraft();
            this.sourcesDirty = false;
            this.el('story-source-status').textContent = 'Source choices saved.';
            this.announce('Source choices saved. No game changes were made.');
        }
        async saveSourceDraft() {
            const draft = this.sourceDrafts.get(this.project.id);
            if (!draft?.dirty) return;
            await this.mutate('', { patch: { sources: draft.selection } }, { method: 'PATCH', revision: draft.revision });
            this.sourceDrafts.delete(this.project.id);
            this.sourcesDirty = false; this.sourcesRevision = this.project.revision;
            this.persistBuffers(); this.renderSaveStatus();
        }
        requireSavedSources() { if (this.sourcesDirty) throw new Error('Save the source choices before generating a preview. Your choices are retained.'); }
        authorWorldSource(world) {
            if (!world) return null;
            const setting = world.setting || {};
            const profile = Object.fromEntries(['name', 'description', 'theme', 'genre', 'tone', 'writingStyleNotes', 'startingLocationType'].filter(key => setting[key] !== undefined).map(key => [key, setting[key]]));
            const places = Object.values(world.world?.locations || {}).map(place => ({ name: place.name, description: place.description }));
            const history = (world.history || []).filter(entry => !entry.hidden && ['user', 'assistant'].includes(entry.role)).map(entry => ({ role: entry.role === 'assistant' ? 'Written passage' : 'Protagonist action', content: entry.content }));
            return { profile, ...(places.length ? { actualPlaces: places } : {}), ...(history.length ? { livedHistory: history } : {}) };
        }
        projectionHtml(title, value) {
            const section = document.createElement('section');
            const heading = document.createElement('h3');
            heading.textContent = String(title ?? '');
            section.append(heading);
            if (!value) {
                const empty = document.createElement('p');
                empty.textContent = 'No source selected.';
                section.append(empty);
            } else section.append(window.AIRPG_WIDGETS.createValueProjection({
                document, value, formatKey: label, formatValue: value => String(value ?? ''),
                classNames: { text: 'stories__prose' }
            }));
            return section.outerHTML;
        }
        async bindingPreview() {
            this.requireSavedSources();
            const data = await this.mutate('/binding-preview', { sources: this.project.sources });
            const p = data.preview;
            this.lastSourcePreview = p;
            this.lastSourcePreviewStoryId = this.project.id;
            const matchingLive = p.sources.world?.kind === 'live' && p.sources.protagonist?.kind === 'live' && p.compatibility.compatible;
            this.dialog('Review sources and compatibility', `<p>This preview has made no changes to the current game.</p><h3>Compatibility</h3><p>${p.compatibility.compatible ? 'Compatible source selection' : 'Resolve these conflicts before setup'}</p><ul>${p.compatibility.conflicts.map(c => `<li>${esc(c)}</li>`).join('')}</ul>${p.compatibility.adaptationRequired ? '<p class="stories__notice">Character concept adaptation is required. Review concrete changes in the setup preview before creating anything.</p>' : ''}<h3>Planned changes</h3><ul>${this.sourcePlannedWrites(p).map(w => `<li>${esc(w)}</li>`).join('')}</ul>${this.details('source-world-review', 'World source · read-only', this.projectionHtml('Selected world', this.authorWorldSource(p.world)))}${this.details('source-protagonist-review', 'Protagonist source · read-only', this.projectionHtml('Selected protagonist', p.protagonist?.concept || p.protagonist))}${matchingLive ? `<p>Attach the reviewed story to the selected current-game protagonist without replacing this world's history.</p>${button('binding-commit', 'Attach to current game', `data-id="${p.id}"`, true)}` : '<p>Use Prepare editable setup preview to create a profile or adapt a protagonist. Saved-world writing requires the normal Load action on Play.</p>'}`, 'binding');
        }
        sourcePlannedWrites(preview) {
            const switching = preview.bindingSwitch;
            const previousTitle = switching && this.library.find(story => story.id === switching.fromStoryId)?.title || 'the previous story';
            return preview.plannedWrites.map(write => {
                if (!switching) return write;
                return write.replaceAll(switching.fromStoryId, previousTitle).replaceAll(switching.toStoryId, this.project.title);
            });
        }
        async materializationPreview(feedback = '') {
            const storyId = this.project.id, nodeId = this.nodeId;
            this.requireSavedSources();
            const sourceReview = await this.mutate('/binding-preview', { sources: this.project.sources });
            this.requireGenerationTarget(storyId, nodeId);
            this.lastSourcePreview = sourceReview.preview;
            this.lastSourcePreviewStoryId = this.project.id;
            const data = await this.mutate('/materialization-preview', { sources: this.project.sources, feedback });
            this.requireGenerationTarget(storyId, nodeId);
            this.lastSourcePreview = { ...this.lastSourcePreview, bindingSwitch: data.bindingSwitch };
            this.setupDescriptorsByJob ||= new Map();
            this.setupDescriptorsByJob.set(data.job.id, data.setupFieldDescriptors);
            this.persistSetupDrafts();
            window.AIRPG_PAGE_FEEDBACK?.trackJob({ ...data.job, ownerScope: FEEDBACK_SCOPE, label: this.path(data.job.nodeId) });
            this.renderActivity();
            this.announce('Setup preview queued. Review it before creating a world or protagonist.');
        }
        typedNativeFieldHtml(value, path, readonly, { fieldLabel, id, type, options = null, strings = false }) {
            const nativeType = options ? 'select' : type === 'boolean' ? 'checkbox' : type === 'number' ? 'number' : 'textarea';
            const control = window.AIRPG_WIDGETS.createField({
                document, label: fieldLabel, id, className: 'form-group', type: nativeType,
                value: strings ? value.join('\n') : value,
                rows: strings ? 2 : String(value || '').length > 200 ? 4 : 2,
                step: nativeType === 'number' ? 'any' : undefined
            });
            const { field, input, label: nativeLabel } = control;
            input.dataset.typedPath = JSON.stringify(path);
            input.dataset.typedKind = strings ? 'strings' : type === 'boolean' || type === 'number' ? type : value === null ? 'nullable' : 'string';
            if (options) {
                const append = (rawValue, text) => {
                    const option = document.createElement('option');
                    option.value = String(rawValue ?? '');
                    option.textContent = String(text ?? '');
                    input.append(option);
                };
                if (!options.some(option => String(option.value) === String(value))) append(value, `${value ?? ''} · Current reviewed value`);
                options.forEach(option => append(option.value, option.label || option.value));
                input.value = String(value ?? '');
                input.disabled = readonly;
            } else if (type === 'boolean') {
                input.checked = value;
                input.disabled = readonly;
                input.removeAttribute('value');
                nativeLabel.className = 'stories__check';
                nativeLabel.prepend(input);
                field.replaceChildren(nativeLabel);
            } else input.readOnly = readonly;
            if (strings) {
                const help = document.createElement('p');
                help.className = 'help-text';
                help.textContent = 'One item per line.';
                field.append(help);
            }
            return window.AIRPG_WIDGETS.serializeField(control);
        }
        typedFields(value, path = [], readonly = false) {
            const descriptor = this.setupDescriptor(path);
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                const fields = Object.entries(value).map(([key, v]) => {
                    const fieldPath = [...path, key];
                    const fieldDescriptor = this.setupDescriptor(fieldPath);
                    const content = v !== null && typeof v === 'object' && !Array.isArray(v) ? this.details(`typed-${fieldPath.join('-')}`, fieldDescriptor?.label || label(key), this.typedFields(v, fieldPath, readonly)) : this.typedFields(v, fieldPath, readonly);
                    const editable = !readonly && ['settingFields', 'newGameFields'].includes(path[0]) && fieldDescriptor?.required !== true;
                    return editable ? `<section class="stories__setup-field">${content}${button('typed-remove-field', `Remove ${fieldDescriptor?.label || label(key)}`, `data-path="${esc(JSON.stringify(fieldPath))}"`)}</section>` : content;
                }).join('');
                return fields + (readonly ? '' : this.setupAddFieldHtml(value, path, descriptor));
            }
            const key = path[path.length - 1];
            const fieldLabel = descriptor?.label || (typeof key === 'number' ? 'Value' : label(key));
            const pathValue = esc(JSON.stringify(path));
            const id = `story-typed-${path.join('-').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
            if (Array.isArray(value)) {
                this.typedArrayShapes ||= new Map();
                const shapeKey = JSON.stringify([this.setupProposalId, ...path]);
                const editableCollection = ['settingFields', 'newGameFields'].includes(path[0]);
                if (value.length && value.some(v => typeof v !== 'string')) this.typedArrayShapes.set(shapeKey, clone(value[value.length - 1]));
                if (descriptor?.kind !== 'collection' && value.every(v => typeof v === 'string') && !this.typedArrayShapes.has(shapeKey)) return this.typedNativeFieldHtml(value, path, readonly, { fieldLabel, id, type: 'string', strings: true });
                return `<fieldset><legend>${esc(descriptor?.label || label(key))}</legend>${value.map((v, i) => `<div class="stories__card"><h4>Entry ${i + 1}</h4>${this.typedFields(v, [...path, i], readonly)}${readonly || !editableCollection ? '' : button('typed-remove-entry', 'Remove this entry', `data-path="${pathValue}" data-index="${i}"`)}</div>`).join('')}${readonly || !editableCollection ? '' : `${descriptor?.item ? button('typed-add-entry', 'Add entry', `data-path="${pathValue}"`) : ''}${value.length || this.typedArrayShapes.has(shapeKey) ? button('typed-duplicate-entry', value.length ? 'Duplicate entry for editing' : 'Restore entry with reviewed fields', `data-path="${pathValue}"`) : descriptor?.item ? '' : '<p class="help-text">No entries proposed.</p>'}`}</fieldset>`;
            }
            const type = value === null && descriptor?.kind === 'number' ? 'number' : typeof value;
            const options = Array.isArray(descriptor?.options) && ['string', 'number'].includes(type) ? descriptor.options : null;
            return this.typedNativeFieldHtml(value, path, readonly, { fieldLabel, id, type, options });
        }
        setupDescriptor(path) {
            if (!['settingFields', 'newGameFields'].includes(path[0])) return null;
            let descriptor = { kind: 'object', properties: this.setupDescriptors?.[path[0]] || [] };
            for (const key of path.slice(1)) {
                descriptor = typeof key === 'number' ? descriptor?.item : descriptor?.properties?.find(field => field.key === key) || descriptor?.value;
                if (!descriptor) return null;
            }
            return descriptor;
        }
        setupAddFieldHtml(value, path, descriptor) {
            if (!['settingFields', 'newGameFields'].includes(path[0])) return '';
            const properties = [...(descriptor?.properties || [])];
            for (const key of descriptor?.keyChoices || []) if (!properties.some(field => field.key === key)) properties.push({ key, ...descriptor.value });
            const choices = [...properties];
            for (const savedKey of this.removedSetupFields?.keys() || []) {
                const removedPath = JSON.parse(savedKey);
                if (removedPath[0] === this.setupProposalId && removedPath.length === path.length + 2 && path.every((key, index) => removedPath[index + 1] === key)) {
                    const key = removedPath[removedPath.length - 1];
                    if (!choices.some(field => field.key === key)) choices.push({ key });
                }
            }
            const omitted = choices.filter(field => !Object.hasOwn(value, field.key));
            if (!omitted.length) return '<p class="help-text">All available details are included.</p>';
            const id = `story-add-${path.join('-').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
            return `<div class="form-group"><label for="${id}">Optional detail for ${esc(label(path[path.length - 1]))}</label><select id="${id}">${omitted.map(field => `<option value="${esc(field.key)}">${esc(field.label || label(field.key))}</option>`).join('')}</select>${button('typed-add-field', 'Add selected detail', `data-parent="${esc(JSON.stringify(path))}" data-select="${id}"`)}</div>`;
        }
        setupSeed(descriptor) {
            if (descriptor.generated === 'uuid') return uuid();
            if (Object.hasOwn(descriptor, 'initialValue')) return clone(descriptor.initialValue);
            if (['strings', 'collection'].includes(descriptor.kind)) return [];
            if (descriptor.kind === 'object') return {};
            if (['number', 'nullable'].includes(descriptor.kind)) return null;
            if (descriptor.kind === 'boolean') return false;
            if (descriptor.kind === 'string') return '';
            throw new Error('The selected setup detail has an unsupported field type.');
        }
        setupFieldsHtml(value, group) {
            const descriptors = this.setupDescriptors?.[group];
            if (!Array.isArray(descriptors)) throw new Error('The setup field descriptions are unavailable. Reopen the setup review after refreshing sources.');
            for (const key of Object.keys(value)) if (!descriptors.some(field => field.key === key)) throw new Error(`The setup field ${label(key)} is absent from the published field descriptions.`);
            return this.typedFields(value, [group]);
        }
        async editSetupField(target, action) {
            if (this.dialogKind !== 'setup') throw new Error('This field is outside the active setup review.');
            const id = this.setupProposalId;
            const draft = this.readTyped(this.setupDrafts[id], this.el('story-setup-review'));
            const path = action === 'typed-add-field' ? [...JSON.parse(target.dataset.parent), this.el(target.dataset.select).value] : JSON.parse(target.dataset.path);
            const descriptor = this.setupDescriptor(path);
            let owner = draft;
            for (const key of path.slice(0, -1)) owner = owner[key];
            const key = path[path.length - 1];
            this.removedSetupFields ||= new Map();
            const savedKey = JSON.stringify([id, ...path]);
            if (action === 'typed-remove-field') {
                if (descriptor?.required) throw new Error('This required setup detail cannot be removed.');
                this.removedSetupFields.set(savedKey, clone(owner[key]));
                delete owner[key];
            } else {
                if (Object.hasOwn(owner, key)) throw new Error('This setup detail is already included.');
                if (!descriptor && !this.removedSetupFields.has(savedKey)) throw new Error('The selected detail is absent from the published setup fields.');
                owner[key] = this.removedSetupFields.has(savedKey) ? clone(this.removedSetupFields.get(savedKey)) : this.setupSeed(descriptor);
            }
            await this.redrawSetupDraft(id, draft);
            this.focusSetupPath(action === 'typed-add-field' ? path : path.slice(0, -1));
            this.announce(action === 'typed-add-field' ? 'Detail added to the local setup preview. Review its value.' : 'Optional detail removed from the local setup preview.');
        }
        async redrawSetupDraft(id, draft) {
            const mode = this.el('story-setup-mode').value;
            const player = this.el('story-setup-player')?.value;
            this.setupDrafts[id] = draft;
            delete this.setupControlDrafts[id];
            this.persistSetupDrafts();
            this.closeDialog(); await this.setupReview(this.project.proposals[id]);
            this.el('story-setup-mode').value = mode;
            this.el('story-setup-mode').dispatchEvent(new Event('change'));
            if (this.el('story-setup-player')) this.el('story-setup-player').value = player || '';
            this.renderSetupAttachment();
        }
        focusSetupPath(path) {
            window.requestAnimationFrame(() => {
                const form = this.el('story-setup-review');
                if (!form || this.dialogKind !== 'setup') return;
                const control = Array.from(form.querySelectorAll('[data-typed-path]')).find(item => path.every((key, index) => JSON.parse(item.dataset.typedPath)[index] === key)) || this.el(`story-add-${path.join('-').replace(/[^a-zA-Z0-9_-]/g, '_')}`) || Array.from(form.querySelectorAll('[data-path]')).find(item => item.dataset.path === JSON.stringify(path));
                for (let disclosure = control?.closest('details'); disclosure; disclosure = disclosure.parentElement.closest('details')) disclosure.open = true;
                control?.focus();
                control?.scrollIntoView({ block: 'nearest' });
            });
        }
        async editTypedCollection(target, action) {
            if (this.dialogKind !== 'setup') throw new Error('This collection is outside the active setup review.');
            const id = this.setupProposalId;
            const draft = this.readTyped(this.setupDrafts[id], this.el('story-setup-review'));
            const path = JSON.parse(target.dataset.path);
            let list = draft;
            for (const key of path) list = list[key];
            if (!Array.isArray(list)) throw new Error('The reviewed collection is unavailable.');
            if (action === 'typed-add-entry') {
                const item = this.setupDescriptor(path)?.item;
                if (!item) throw new Error('The published setup fields do not describe this entry.');
                list.push(this.setupSeed(item));
            } else if (action === 'typed-duplicate-entry') {
                const shape = list.length ? list[list.length - 1] : this.typedArrayShapes.get(JSON.stringify([this.setupProposalId, ...path]));
                if (shape === undefined) throw new Error('An authoritative entry shape is required before adding to this collection.');
                const copy = clone(shape);
                for (const field of this.setupDescriptor(path)?.item?.properties || []) if (field.generated === 'uuid' && Object.hasOwn(copy, field.key)) copy[field.key] = uuid();
                list.push(copy);
            } else list.splice(Number(target.dataset.index), 1);
            await this.redrawSetupDraft(id, draft);
            this.focusSetupPath(action === 'typed-remove-entry' ? path : [...path, list.length - 1]);
            this.announce(action === 'typed-duplicate-entry' ? 'Entry duplicated for editing. Review the new values.' : action === 'typed-add-entry' ? 'Entry added to the local preview. Review its fields.' : 'Entry removed from the local setup preview.');
        }
        readTyped(original, form) {
            const result = clone(original);
            for (const control of form.querySelectorAll('[data-typed-path]')) {
                const path = JSON.parse(control.dataset.typedPath);
                let owner = result;
                for (const key of path.slice(0, -1)) {
                    if (owner[key] === undefined) throw new Error(`The reviewed field ${path.join(' / ')} is unavailable.`);
                    owner = owner[key];
                }
                const kind = control.dataset.typedKind;
                let value;
                if (kind === 'boolean') value = control.checked;
                else if (kind === 'number') {
                    value = Number(control.value);
                    if (!control.value.trim() || !Number.isFinite(value)) throw new Error(`${label(path[path.length - 1])} must be a finite number.`);
                } else if (kind === 'strings') value = Array.isArray(owner[path[path.length - 1]]) && control.value === owner[path[path.length - 1]].join('\n') ? clone(owner[path[path.length - 1]]) : control.value.split('\n').filter(s => s.trim());
                else if (kind === 'nullable' && !control.value) value = null;
                else value = control.value;
                owner[path[path.length - 1]] = value;
            }
            return result;
        }
        async setupReview(proposal) {
            const candidate = clone(this.setupDrafts?.[proposal.id] || proposal.candidate);
            this.setupDrafts ||= {};
            this.setupDrafts[proposal.id] = candidate;
            this.setupControlDrafts ||= {};
            this.setupProposalId = proposal.id;
            const job = this.project.jobs[proposal.jobId];
            if (!this.sourceCatalog) await this.loadSources();
            this.setupDescriptors = this.setupDescriptorsByJob?.get(job.id) || this.sourceCatalog.setupFieldDescriptors;
            const sources = job.sourceSelection || this.project.sources;
            if (!this.lastSourcePreview || this.lastSourcePreviewStoryId !== this.project.id || JSON.stringify(this.lastSourcePreview.sources) !== JSON.stringify(sources)) {
                const sourceReview = await this.mutate('/binding-preview', { sources });
                this.requireGenerationTarget(storyId, nodeId);
            this.lastSourcePreview = sourceReview.preview;
                this.lastSourcePreviewStoryId = this.project.id;
            }
            const actualWorld = sources.world?.kind === 'live';
            const players = (this.sourceCatalog?.protagonists || []).filter(p => p.kind === 'live');
            this.dialog('Review world & protagonist setup', `<p>Source: ${sources.world ? esc(sources.world.kind === 'profile' ? 'Reusable world profile recipe' : sources.world.kind === 'saved' ? 'Saved game world · planning only' : 'Current actual game world') : 'World created from story'} · ${sources.protagonist ? esc(sources.characterMode === 'concept' ? 'Reviewed character concept adaptation' : 'Actual protagonist reuse') : 'Protagonist created from story'}.</p><p>Only initial playable setup is created. Intended future entities remain in the outline and continuity notes.</p><form id="story-setup-review" data-ctrl-enter-submit="[data-action='setup-commit']">${this.typedFields({ worldBrief: candidate.worldBrief, protagonistBrief: candidate.protagonistBrief }, [], false)}${sources.protagonist && sources.characterMode === 'concept' ? this.details('adaptation-review', 'Review character concept adaptation', this.projectionHtml('Original concept source', this.lastSourcePreview.protagonist?.concept || sources.protagonist.concept) + this.projectionHtml('Proposed protagonist', candidate.newGameFields), true) : ''}${this.details('world-fields', 'Editable world profile details', this.setupFieldsHtml(candidate.settingFields, 'settingFields'), true)}${this.details('protagonist-fields', 'Editable protagonist and opening details', this.setupFieldsHtml(candidate.newGameFields, 'newGameFields'), true)}<div class="form-group"><label for="story-setup-mode">Setup destination</label><select id="story-setup-mode"><option value="new-game">Save cloned world profile and continue to New Game</option>${actualWorld ? '<option value="existing-world">Create or select protagonist in current world · preserve history</option>' : ''}</select></div>${actualWorld ? `<div class="form-group"><label for="story-setup-player">Protagonist in current world</label><select id="story-setup-player"><option value="">Create the reviewed protagonist</option>${players.map(p => `<option value="${esc(p.id)}" ${sources.protagonist?.kind === 'live' && sources.protagonist.id === p.id ? 'selected' : ''}>Select ${esc(p.label)} · keep actual state</option>`).join('')}</select></div>` : ''}<section id="story-setup-attachment" class="stories__notice" aria-live="polite" aria-label="Story attachment changes"></section><label class="stories__check"><input id="story-setup-reviewed" type="checkbox" required>I reviewed the concrete fields, source adaptation, and planned changes</label><div class="stories__row">${button('setup-commit', 'Save reviewed world profile', `data-id="${proposal.id}"`, true)}${button('reject-proposal', 'Keep current setup', `data-id="${proposal.id}"`)}</div><div id="story-setup-result"></div></form>`, 'setup');
            const form = this.el('story-setup-review');
            this.el('story-setup-mode').addEventListener('change', () => {
                this.renderSetupAttachment();
            });
            if (this.setupControlDrafts[proposal.id]) {
                for (const control of form.querySelectorAll('[data-typed-path]')) {
                    const saved = this.setupControlDrafts[proposal.id][control.dataset.typedPath];
                    if (!saved) continue;
                    control.value = saved.value; control.checked = saved.checked;
                }
            }
            form.addEventListener('input', () => {
                this.setupControlDrafts[proposal.id] = Object.fromEntries(Array.from(form.querySelectorAll('[data-typed-path]')).map(control => [control.dataset.typedPath, { value: control.value, checked: control.checked }]));
                this.persistSetupDrafts();
            });
            this.setupSelections ||= {};
            const selection = this.setupSelections[proposal.id];
            if (selection) {
                this.el('story-setup-mode').value = selection.mode;
                if (this.el('story-setup-player')) this.el('story-setup-player').value = selection.player || '';
                this.el('story-setup-mode').dispatchEvent(new Event('change'));
            }
            form.addEventListener('change', event => {
                if (['story-setup-mode', 'story-setup-player'].includes(event.target.id)) {
                    this.el('story-setup-reviewed').checked = false;
                    this.renderSetupAttachment();
                }
                this.setupSelections[proposal.id] = { mode: this.el('story-setup-mode').value, player: this.el('story-setup-player')?.value };
                this.persistSetupDrafts();
            });
            this.renderSetupAttachment();
        }
        setupAttachmentState() {
            const mode = this.el('story-setup-mode').value;
            const protagonistId = mode === 'existing-world' ? this.el('story-setup-player')?.value : '';
            const preview = this.lastSourcePreview;
            const protagonistName = this.sourceCatalog.protagonists.find(player => player.kind === 'live' && player.id === protagonistId)?.label || 'the selected protagonist';
            const prior = this.setupAttempt?.storyId === this.project.id && this.setupAttempt.body.proposalId === this.setupProposalId ? this.setupAttempt.body : null;
            const resuming = prior?.mode === mode && (prior.protagonistId || '') === (protagonistId || '') && Object.values(this.project.materializations).some(receipt => receipt.requestId === prior.requestId);
            let reason = null;
            if (mode === 'existing-world' && protagonistId && !resuming) {
                if (preview?.sources.protagonist?.kind !== 'live' || preview.sources.protagonist.id !== protagonistId) reason = `Review ${protagonistName} as the protagonist source before attachment. Choose that source in World & protagonist, save the choices, and prepare a fresh setup preview. Your setup draft is retained.`;
                else if (!preview.compatibility.compatible) reason = preview.compatibility.conflicts.join('\n');
                else if (preview.bindingSwitch?.compatible === false) reason = preview.bindingSwitch.conflict;
            }
            const actorReviewed = preview?.sources.protagonist?.kind === 'live' && preview.sources.protagonist.id === protagonistId;
            return { mode, protagonistId, protagonistName, preview, reason, resuming, actorReviewed };
        }
        renderSetupAttachment() {
            const host = this.el('story-setup-attachment');
            if (!host) return;
            const state = this.setupAttachmentState();
            const commit = this.el('story-setup-review').querySelector('[data-action="setup-commit"]');
            commit.textContent = state.mode === 'new-game' ? 'Save reviewed world profile' : 'Create or select protagonist and attach story';
            commit.disabled = this.busy || Boolean(state.reason);
            if (state.mode === 'new-game') {
                host.innerHTML = '<h3>Profile now · new game only after Start</h3><p>Saving creates a world profile and leaves the current protagonist’s story and history in place. The new story is attached to its new protagonist only when you explicitly Start on New Game.</p>';
                return;
            }
            if (!state.protagonistId) {
                host.innerHTML = `<h3>Create a protagonist for ${esc(this.project.title)}</h3><p>Setup selects the newly created protagonist and attaches this fresh outline. Other protagonists keep their own story attachments. Current world history is preserved; writing remains paused.</p>`;
                return;
            }
            const switching = state.actorReviewed ? state.preview.bindingSwitch : null;
            const previousTitle = switching && this.library.find(story => story.id === switching.fromStoryId)?.title || 'their previous story';
            host.innerHTML = `<h3>Attach ${esc(state.protagonistName)} to ${esc(this.project.title)}</h3>${switching ? `<p>On commit, this replaces ${esc(state.protagonistName)}’s active attachment to ${esc(previousTitle)} with this fresh outline.</p>${switching.priorEvidence === 'preserved-in-library' ? '<p>The previous story’s written history, actual outcomes and preparation evidence remain preserved in its separate library entry. They are not transferred into this fresh outline.</p>' : '<p>Previous actual history is not transferred into this fresh outline.</p>'}` : state.actorReviewed ? '<p>On commit, this selects the protagonist and attaches the fresh outline.</p>' : state.resuming ? '<p>Resume retains the original reviewed attachment and completed stages.</p>' : '<p>The selected protagonist’s current story attachment is not covered by this source preview.</p>'}<p>Actual character state and current world history are preserved. Writing remains paused.</p>${state.resuming ? '<p>Resume keeps the original reviewed protagonist, destination and completed stages. The remaining prerequisites are checked again by the server.</p>' : ''}${state.reason ? `<p class="stories__error">${esc(state.reason)}</p>${button('setup-tab', 'Review world & protagonist source')}` : switching ? '<p>Attachment rechecks settled prior work and preservation of its actual evidence before replacing the active story.</p>' : ''}`;
        }
        setupReceiptsHtml() {
            const receipts = Object.values(this.project.materializations || {});
            return receipts.length ? `<h3>Setup progress</h3>${receipts.map(r => `<article class="stories__card"><h4>${esc(r.settingFields?.name || 'Reviewed setup')} · ${esc(r.status)}</h4><ul>${Object.entries(r.stages || {}).map(([stage, done]) => `<li>${esc(label(stage))}: ${done ? 'Complete' : 'Pending'}</li>`).join('')}</ul>${r.error ? `<p class="stories__error">${esc(r.error.error)}</p><details><summary>Error details</summary><pre>${esc(r.error.stack)}</pre></details>` : ''}${r.draftToken && r.status === 'awaiting-start' ? `<a class="btn btn-primary" href="/new-game?draftToken=${encodeURIComponent(r.draftToken)}" target="_blank" rel="noopener">Continue to New Game · explicit Start required</a>` : ''}${r.status === 'failed' ? button('resume-setup', 'Resume this setup', `data-id="${r.id}"`) : ''}${r.status === 'completed' ? '<p>Actual setup complete. Story writing is paused until you review and start it in Play.</p>' : ''}</article>`).join('')}` : '';
        }
        async commitSetup(target) {
            if (this.busy) throw new Error('Reviewed setup is already in progress. Wait for its receipt before resuming.');
            if (!this.el('story-setup-reviewed').checked) throw new Error('Review the concrete setup fields and acknowledge the planned changes first.');
            const proposal = this.project.proposals[target.dataset.id];
            const fields = this.readTyped(this.setupDrafts[proposal.id], this.el('story-setup-review'));
            this.setupDrafts[proposal.id] = clone(fields);
            const mode = this.el('story-setup-mode').value;
            const protagonistId = mode === 'existing-world' ? this.el('story-setup-player')?.value : '';
            const reviewed = { proposalId: proposal.id, reviewed: true, ...fields, mode, ...(protagonistId ? { protagonistId } : {}) };
            const prior = this.setupAttempt?.storyId === this.project.id && this.setupAttempt.body.proposalId === proposal.id ? this.setupAttempt.body : null;
            if (prior) {
                const { expectedRevision, requestId, ...previousReview } = prior;
                if (JSON.stringify(previousReview) !== JSON.stringify(reviewed)) throw new Error('This setup already has a reviewed attempt. Resume its exact pending stages from Setup progress, or prepare a new preview to review different fields. Your changed draft is retained.');
            }
            const reason = this.setupAttachmentState().reason;
            if (reason) throw new Error(reason);
            const body = prior || this.envelope(reviewed);
            this.setupAttempt = { storyId: this.project.id, body };
            window.sessionStorage.setItem('airpg.story-editor.setup-attempt', JSON.stringify(this.setupAttempt));
            await this.sendSetup(this.setupAttempt);
        }
        async sendSetup(attempt) {
            if (this.readOnlyProject) throw new Error('Import this saved timeline as a copy before creating reviewed setup.');
            if (this.busy) throw new Error('A story change is already in progress.');
            this.busy = true;
            const commitButtons = Array.from(this.root.querySelectorAll('[data-action="setup-commit"], #story-resume-setup button[type="submit"]'));
            commitButtons.forEach(button => button.disabled = true);
            if (this.el('story-setup-result')) this.el('story-setup-result').innerHTML = '<p role="status">Preparing the reviewed setup. Completed stages will appear in its receipt.</p><progress aria-label="Reviewed setup in progress"></progress>';
            try {
                const data = await this.api(`/stories/${attempt.storyId}/materialization-commit`, 'POST', attempt.body);
                await this.refreshProject();
                const receipts = this.setupReceiptsHtml();
                if (this.el('story-setup-result')) this.el('story-setup-result').innerHTML = receipts;
                if (this.el('story-setup-receipts')) this.el('story-setup-receipts').innerHTML = receipts;
                if (data.newGameUrl) this.announce('Reviewed world profile saved. Continue to New Game and explicitly Start there.');
                else if (data.receipt?.status === 'completed') this.announce('Setup complete. Play remains paused.');
                else this.announce(`Setup stage: ${data.receipt?.status || 'Receipt available for review'}.`);
            } catch (error) {
                try {
                    await this.refreshProject();
                    if (this.el('story-setup-result')) this.el('story-setup-result').innerHTML = this.setupReceiptsHtml();
                    if (this.el('story-setup-receipts')) this.el('story-setup-receipts').innerHTML = this.setupReceiptsHtml();
                } catch (refreshError) { error.stack = `${error.stack}\n\nReading setup receipt also failed:\n${refreshError.stack}`; }
                throw error;
            } finally { this.busy = false; commitButtons.forEach(button => button.disabled = false); this.updateEditActions(); if (this.dialogKind === 'setup') this.renderSetupAttachment(); }
        }
        async resumeSetup(id) {
            const r = this.project.materializations[id];
            if (!r || r.status !== 'failed') throw new Error('This setup has no failed stage to resume.');
            const original = window.sessionStorage.getItem('airpg.story-editor.setup-attempt');
            const attempt = original ? JSON.parse(original) : null;
            const body = attempt?.body.requestId === r.requestId ? attempt.body : this.envelope({ proposalId: r.proposalId, reviewed: true, settingFields: r.settingFields, newGameFields: r.newGameFields, ...(r.worldBrief ? { worldBrief: r.worldBrief } : {}), ...(r.protagonistBrief ? { protagonistBrief: r.protagonistBrief } : {}), mode: r.mode, ...(r.protagonistId ? { protagonistId: r.protagonistId } : {}) }, this.project.revision, r.requestId);
            if (this.dialogKind === 'setup') return this.sendSetup({ storyId: this.project.id, body });
            this.dialog('Resume setup', `<p>Resume only the pending stages for ${esc(r.settingFields.name)}. Previously committed stages are retained.</p><ul>${Object.entries(r.stages).map(([stage, done]) => `<li>${esc(label(stage))} · ${done ? 'Complete' : 'Pending'}</li>`).join('')}</ul><form id="story-resume-setup"><button type="submit" class="btn btn-primary">Resume pending stages</button></form><div id="story-setup-result"></div>`, 'setup-resume');
            this.el('story-resume-setup').addEventListener('submit', event => { event.preventDefault(); this.submitDialog(() => this.sendSetup({ storyId: this.project.id, body }), event.target).catch(error => this.fail(error)); });
        }
        factsHtml() {
            const facts = this.project.bible || [];
            const group = (title, items, observed) => `<section><h3>${title}</h3>${items.length ? items.map(f => `<article class="stories__card"><h4>${esc(f.category || 'Continuity fact')}</h4><p class="stories__prose">${esc(f.text)}</p><p class="help-text">${observed ? 'Observed in play' : f.provenance === 'approved-plan' ? 'Approved plan · intended' : 'Author intent'}</p>${this.details(`fact-${f.id}`, 'Knowledge and evidence', `<p>Known by: ${esc(f.knownBy?.join(', ') || 'Private author planning')}</p>${f.canonicalRef ? this.projectionHtml('Canonical reference', f.canonicalRef) : ''}${this.evidenceHtml(f.evidence || [])}`)}${observed ? '' : `<div class="stories__row">${button('edit-fact', 'Edit intended fact', `data-id="${f.id}" ${this.readOnlyProject ? 'disabled' : ''}`)}${button('remove-fact', 'Remove intended fact…', `data-id="${f.id}" ${this.readOnlyProject ? 'disabled' : ''}`)}</div>`}</article>`).join('') : '<p class="help-text">No facts recorded here.</p>'}</section>`;
            return group('Intended facts', facts.filter(f => f.provenance !== 'observed-game-fact'), false) + group('Observed in play', facts.filter(f => f.provenance === 'observed-game-fact'), true);
        }
        renderContinuity() {
            this.el('story-section').innerHTML = `<h2>Continuity</h2><p>Intentions guide future writing. Observed facts require actual game evidence and stay separate from outline approval.</p>${button('add-fact', 'Add intended fact', this.readOnlyProject ? 'disabled' : '')}${this.factsHtml()}<h3>Open threads</h3>${this.nodes().filter(n => !n.archived && n.content.unresolvedThreads.length).map(n => `<article class="stories__card"><a href="${this.pageBase}/${this.project.id}/${n.id}" data-action="select-node" data-node="${n.id}">${esc(this.path(n.id))}</a><ul>${n.content.unresolvedThreads.map(t => `<li>${esc(t)}</li>`).join('')}</ul></article>`).join('') || '<p class="help-text">Open threads will appear as you develop the outline.</p>'}<h3>Actual outcomes and future changes</h3>${this.receiptsHtml()}`;
            this.renderActivity();
        }
        factDialog(id) {
            const fact = id ? this.project.bible.find(f => f.id === id) : { id: uuid(), category: 'Continuity', text: '', provenance: 'author-intent', knownBy: [], canonicalRef: null, evidence: [] };
            if (!fact || fact.provenance === 'observed-game-fact') throw new Error('Observed game facts cannot be rewritten through outline editing.');
            this.dialog(id ? 'Edit intended fact' : 'Add intended fact', `<form id="story-fact-form">${this.typedFields({ category: fact.category, text: fact.text, knownBy: fact.knownBy }, [])}<div class="form-group"><label for="story-fact-provenance">Origin</label><select id="story-fact-provenance"><option value="author-intent" ${fact.provenance === 'author-intent' ? 'selected' : ''}>Author intent</option><option value="approved-plan" ${fact.provenance === 'approved-plan' ? 'selected' : ''}>Approved plan · still an intention</option></select></div>${fact.canonicalRef ? this.details('fact-reference', 'Canonical reference', this.typedFields(fact.canonicalRef, ['canonicalRef'])) : ''}<p class="help-text">Known by is explicit reveal scope. Blank means private planning; writing this fact here does not reveal it to the protagonist.</p><button type="submit" class="btn btn-primary">Save intended fact</button></form>`, 'fact');
            this.el('story-fact-form').addEventListener('submit', event => {
                event.preventDefault(); this.submitDialog(async form => {
                    const edited = this.readTyped({ category: fact.category, text: fact.text, knownBy: fact.knownBy, canonicalRef: fact.canonicalRef }, form);
                    if (!edited.text.trim()) throw new Error('Write the intended fact before saving.');
                    const value = { ...fact, ...edited, provenance: this.el('story-fact-provenance').value };
                    const bible = this.project.bible.filter(f => f.id !== fact.id).concat([value]);
                    await this.mutate('', { patch: { bible } }, { method: 'PATCH' }); this.closeDialog(); this.renderSection();
                }, event.target).catch(error => this.fail(error));
            });
        }
        removeFact(id) {
            const fact = this.project.bible.find(f => f.id === id);
            if (!fact || fact.provenance === 'observed-game-fact') throw new Error('Actual observed facts cannot be removed from outline history.');
            this.dialog('Remove intended fact', `<p>${esc(fact.text)}</p><p>Removing this intended fact may require reviewing dependent future sections. Actual game history is retained.</p><form id="story-remove-fact"><button type="submit" class="btn btn-primary">Remove intended fact</button></form>`, 'fact');
            this.el('story-remove-fact').addEventListener('submit', event => { event.preventDefault(); this.submitDialog(async () => { await this.mutate('', { patch: { bible: this.project.bible.filter(f => f.id !== id) } }, { method: 'PATCH' }); this.closeDialog(); this.renderSection(); }, event.target).catch(error => this.fail(error)); });
        }
        allReceipts() {
            const source = this.executionProject();
            return Object.values(source === this.boundState?.snapshot ? { ...source.receipts, ...this.boundState.receipts } : source.receipts);
        }
        evidenceHtml(ids) {
            if (!ids.length) return '<p class="help-text">No observed evidence attached.</p>';
            return `<ul class="stories__evidence">${ids.map(value => {
                const id = typeof value === 'object' ? value.historyId || value.id : value;
                const entry = this.allReceipts().flatMap(r => r.history || []).find(e => String(e.id) === String(id));
                return `<li>${entry ? `<a href="${this.pageBase}/${this.project.id}/${this.nodeId}?tab=written#story-evidence-${encodeURIComponent(id)}">${esc(entry.role === 'assistant' ? 'Written passage' : 'Protagonist action')}</a><blockquote class="stories__prose">${esc(entry.content)}</blockquote>` : `Evidence reference: ${esc(id)}`}</li>`;
            }).join('')}</ul>`;
        }
        receiptProposal(r) {
            return Object.values(this.project.proposals).find(p => p.kind === 'outcome' && this.project.jobs[p.jobId]?.receiptId === r.id && p.status === 'pending');
        }
        receiptsHtml(nodeId) {
            const receipts = this.allReceipts().filter(r => !nodeId || r.subsceneId === nodeId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
            if (!receipts.length) return '<p class="help-text">No actual play outcomes recorded for this scope yet.</p>';
            return receipts.map(r => {
                const proposal = this.receiptProposal(r);
                const active = Object.values(this.project.jobs).some(j => j.receiptId === r.id && ACTIVE_JOB.includes(j.status));
                return `<article class="stories__card"><h3>${esc(this.project.nodes[r.subsceneId]?.content.title || `Written ${NAMES[r.nodeType] || 'sub-scene'}`)} · ${r.accepted ? 'Outcome accepted' : 'Outcome needs review'}</h3><p class="stories__prose">${esc(r.summary || r.reason)}</p>${r.criteria?.length ? `<ul>${r.criteria.map(c => `<li>${esc(c.criterion)} · ${esc(c.result)}</li>`).join('')}</ul>` : ''}${r.deviations?.length ? `<h4>Actual deviations</h4><ul>${r.deviations.map(d => `<li>${esc(d.description)}</li>`).join('')}</ul>` : ''}${this.details(`receipt-${r.id}`, 'Actual play evidence · read-only', this.evidenceHtml(r.evidenceIds || []))}${!r.accepted && this.readOnlyProject ? '<p class="help-text">Import this saved story as a copy before preparing or accepting its outcome review.</p>' + button('import-as-copy', 'Import saved story as a copy') : !r.accepted ? proposal ? button('review-outcome', 'Review actual outcome', `data-receipt="${r.id}" data-proposal="${proposal.id}"`) : `<p class="help-text">${active ? 'Preparing actual-outcome suggestion…' : 'The outcome summary needs a new suggestion.'}</p>${button('generate-outcome', 'Prepare outcome review', `data-receipt="${r.id}" data-node="${r.subsceneId}" ${active ? 'disabled' : ''}`)}` : '<p class="help-text">Accepted as actual history, including unfavorable outcomes. Future outline changes are reviewed separately.</p>'}</article>`;
            }).join('');
        }
        renderWritten() {
            const receipts = this.allReceipts().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
            const entries = [];
            const seen = new Set();
            for (const r of receipts) for (const entry of r.history || []) {
                if (seen.has(String(entry.id))) continue;
                seen.add(String(entry.id)); entries.push({ ...entry, nodeId: r.subsceneId });
            }
            this.el('story-section').innerHTML = `<h2>Written story</h2><p>Actual Play history is read-only here. Outcome review and future outline changes remain separate.</p><p class="help-text">${this.executionProject() === this.boundState?.snapshot ? 'Showing the pinned saved timeline; library outcomes remain separate.' : 'Showing this library timeline; saved-game outcomes remain separate until explicit reconciliation.'}</p>${this.receiptsHtml()}<h3>Chronological play history</h3>${entries.map(e => `<article id="story-evidence-${esc(encodeURIComponent(e.id))}" class="stories__card"><p class="help-text">${esc(e.role === 'assistant' ? 'Written passage' : 'Protagonist action')} · <a href="${this.pageBase}/${this.project.id}/${e.nodeId}" data-action="select-node" data-node="${e.nodeId}">${esc(this.project.nodes[e.nodeId]?.content.title || 'Story section')}</a></p><div class="stories__prose">${esc(e.content)}</div></article>`).join('') || '<p class="stories__empty">Write an approved sub-scene in Play to record actual story history.</p>'}`;
            if (window.location.hash.startsWith('#story-evidence-')) window.requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView());
        }
        outcomeDialog(receiptId, proposalId) {
            const r = this.allReceipts().find(x => x.id === receiptId);
            const p = this.project.proposals[proposalId];
            if (!r || !p || p.kind !== 'outcome') throw new Error('The actual outcome and its suggestion are unavailable.');
            const c = p.candidate;
            this.dialog('Review actual outcome', `<h3>${esc(this.project.nodes[r.subsceneId]?.content.title || `Written ${NAMES[r.nodeType] || 'sub-scene'}`)}</h3><p class="stories__prose">${esc(c.summary)}</p><h3>Completion criteria</h3><ul>${c.criteria.map(criterion => `<li><strong>${esc(criterion.result)}</strong> · ${esc(criterion.criterion)}${this.evidenceHtml(criterion.evidenceIds)}</li>`).join('')}</ul><h3>Actual deviations</h3>${c.deviations.length ? c.deviations.map(d => `<article><p>${esc(d.description)}</p>${this.evidenceHtml(d.evidenceIds)}</article>`).join('') : '<p>No deviations proposed.</p>'}${this.details('outcome-evidence', 'All actual play evidence', this.evidenceHtml(c.evidenceIds))}<p class="stories__notice">Accepting records what actually happened. Failed attempts and unfavorable resolutions are valid outcomes. It does not approve suggested changes to future sections or rewrite history.</p>${button('accept-outcome', 'Accept actual outcome', `data-receipt="${receiptId}" data-proposal="${proposalId}" ${this.readOnlyProject ? 'disabled' : ''}`, true)}${button('reject-proposal', 'Request a new outcome summary', `data-id="${proposalId}" ${this.readOnlyProject ? 'disabled' : ''}`)}${this.readOnlyProject ? button('import-as-copy', 'Import saved story as a copy') : ''}`, 'outcome');
        }
        async acceptOutcome(receiptId, proposalId) {
            const result = await this.mutate('/execution/accept-outcome', { receiptId, proposalId, reviewed: true });
            this.closeDialog();
            await this.refreshProject();
            this.renderSection();
            this.announce('Actual outcome accepted. Review future outline changes separately before continuing.');
            if (result.revisionJob) window.AIRPG_PAGE_FEEDBACK.trackJob({ ...result.revisionJob, ownerScope: FEEDBACK_SCOPE, label: this.path(result.revisionJob.nodeId) });
            if (result.enclosingOutcome?.job) {
                window.AIRPG_PAGE_FEEDBACK.trackJob({ ...result.enclosingOutcome.job, ownerScope: FEEDBACK_SCOPE, label: this.path(result.enclosingOutcome.receipt.subsceneId) });
                this.announce('Child outcome accepted. The enclosing dramatic outcome now needs its own review. Future outline changes remain separate.');
            }
        }
        async loadBoundState() {
            const data = await this.api(`/stories/${this.project.id}/bound-state`);
            this.boundState = data.boundState;
            this.renderReconciliation();
        }
        renderReconciliation() {
            const state = this.boundState;
            const host = this.el('story-reconciliation');
            host.hidden = !(state?.conflict || state?.pendingSync || state?.requiresCopyBeforeWriting);
            if (host.hidden) return;
            host.innerHTML = `<h2>${state.pendingSync ? 'Story outcome synchronization needs attention' : state.conflict === 'continue-saved' ? 'Continuing the saved story timeline' : "This saved game's story differs from your library"}</h2><p>${state.conflict === 'continue-saved' ? 'This workspace shows the pinned saved outline and actual history. Import it as a copy to edit this timeline; the library remains separate.' : 'Story saves and game snapshots describe separate revisions. Choose how to continue; actual timelines are never silently merged.'}</p>${state.continuationPolicy ? `<p class="stories__notice">${esc(state.continuationPolicy)}</p>` : ''}${state.pendingSync?.error ? `<p class="stories__error">${esc(state.pendingSync.error.error)}</p><details><summary>Error details</summary><pre>${esc(state.pendingSync.error.stack)}</pre></details>` : ''}<div class="stories__row">${state.requiresCopyBeforeWriting ? '' : button('continue-saved', 'Continue saved story')}${button('import-as-copy', 'Import saved story as a copy')}${button('review-timelines', 'Review differences')}${state.pendingSync ? button('retry-sync', 'Retry outcome synchronization') : ''}</div>`;
        }
        timelineDiff(saved, library) {
            const summary = project => ({ title: project.title, premise: project.premise, style: project.style, constraints: project.constraints, authorNotes: project.authorNotes, sources: project.sources, intendedFacts: project.bible.filter(f => f.provenance !== 'observed-game-fact').map(f => ({ category: f.category, text: f.text, knownBy: f.knownBy })), actualOutcomes: Object.values(project.receipts || {}).map(receipt => ({ section: project.nodes[receipt.subsceneId]?.content.title, accepted: receipt.accepted, summary: receipt.summary || receipt.reason, criteria: receipt.criteria, deviations: receipt.deviations, evidence: receipt.evidenceIds })), observedFacts: project.bible.filter(f => f.provenance === 'observed-game-fact').map(f => ({ category: f.category, text: f.text, evidence: f.evidence })) });
            const nodes = [...new Set([...Object.keys(saved.nodes), ...Object.keys(library.nodes)])];
            return this.diffHtml(summary(saved), summary(library), 'Saved game story', 'Library story') + nodes.map(id => {
                const before = saved.nodes[id];
                const after = library.nodes[id];
                if (JSON.stringify(before?.content) === JSON.stringify(after?.content) && before?.archived === after?.archived && JSON.stringify(before?.review) === JSON.stringify(after?.review) && JSON.stringify(before?.children) === JSON.stringify(after?.children)) return '';
                const content = node => node ? { ...node.content, archived: node.archived, review: node.review, children: node.children.map(childId => (node === before ? saved : library).nodes[childId].content.title) } : {};
                return this.details(`timeline-${id}`, `${after?.content.title || before?.content.title} · ${!before ? 'Added to library' : !after ? 'Only in saved timeline' : 'Changed'}`, this.diffHtml(content(before), content(after), 'Saved game story', 'Library story'));
            }).join('');
        }
        async reviewTimelines() {
            const state = this.boundState;
            if (!state) throw new Error('There is no bound saved-story snapshot to review.');
            let library = this.project;
            if (this.readOnlyProject && !state.requiresCopyBeforeWriting) {
                const data = await this.api(`/stories/${this.project.id}/export`);
                if (data.format !== 'story-authoring-project' || !data.project) throw new Error('The independent library story is unavailable for comparison.');
                library = data.project;
            }
            this.timelineReviewRevision = library.revision;
            this.dialog('Review saved story differences', `<p>${state.requiresCopyBeforeWriting ? 'The saved story has no independent library entry.' : `The current game's story snapshot is ${state.snapshotRevision === library.revision ? 'at the same saved revision' : 'a different saved revision from the library'}.`}</p>${state.requiresCopyBeforeWriting ? this.projectionHtml('Saved actual outcomes', state.receipts || {}) : state.snapshot ? this.timelineDiff(state.snapshot, library) : this.projectionHtml('Saved actual outcomes', state.receipts || {}) + this.projectionHtml('Library actual outcomes', library.receipts)}<p>${esc(state.continuationPolicy || 'Actual timelines are never silently merged.')}</p><div class="stories__row">${state.requiresCopyBeforeWriting ? '' : button('continue-saved', 'Continue saved story')}${button('import-as-copy', 'Import as a copy')}${button('adopt-library', 'Adopt reviewed library revisions', state.pendingSync || state.requiresCopyBeforeWriting ? 'disabled' : '', true)}</div>`, 'timelines');
        }
        async reconcile(action) {
            const extraRevision = action === 'retry-sync' ? this.boundState?.pendingSync?.expectedRevision : action === 'adopt-library' ? this.timelineReviewRevision : undefined;
            const data = await this.mutate('/reconcile', { action }, { ...(extraRevision === undefined ? {} : { revision: extraRevision }) });
            if (!this.el('story-dialog').hidden) this.closeDialog();
            if (data.project && data.project.id !== this.project.id) await this.navigate(data.project.id, data.project.rootId, 'outline');
            else { await this.refreshProject(); await this.loadBoundState(); this.renderSection(); }
            this.announce('Saved-story choice recorded. Writing stays paused.');
        }
        preparationReceiptsHtml() {
            return Object.values(this.project.previews || {}).filter(p => p.purpose === 'entities').map(p => `<article class="stories__card"><h3>Required characters and places · ${esc(p.status)}</h3><p>${Object.keys(p.completed || {}).length} of ${p.entities.length} actual entities prepared.</p>${p.error ? `<p class="stories__error">${esc(p.error.error)}</p><details><summary>Error details</summary><pre>${esc(p.error.stack)}</pre></details>` : ''}${p.status === 'completed' ? '<p>Actual preparation complete. Review the sub-scene direction again before Play.</p>' : button('review-preparation', p.status === 'failed' ? 'Review and resume preparation' : 'Review preparation', `data-id="${p.id}"`)}</article>`).join('');
        }
        async preparationPreview(nodeId) {
            if (!this.el('story-dialog').hidden) this.closeDialog();
            if (this.readOnlyProject) {
                this.dialog('Import saved story before preparation', `<p>Import this saved timeline as a copy before changing its actual entity or prerequisite mapping. The actual history is preserved.</p>${button('import-as-copy', 'Import saved story as a copy', '', true)}`, 'copy-required');
                return;
            }
            const data = await this.mutate('/preparations/preview', { nodeId });
            await this.preparationReview(data.preview);
        }
        async preparationReview(preview) {
            if (!preview || preview.purpose !== 'entities') throw new Error('This entity preparation preview is unavailable.');
            if (!this.el('story-dialog').hidden) this.closeDialog();
            const sources = { world: { kind: 'live', id: 'current' }, protagonist: { kind: 'live', id: this.boundState?.binding.protagonistId || this.project.binding.protagonistId }, characterMode: 'existing' };
            const data = await this.mutate('/binding-preview', { sources });
            const world = data.preview.world;
            const locations = Object.values(world.world?.locations || {}).filter(l => !l.isStub);
            const regions = Object.values(world.world?.regions || {});
            const saved = window.sessionStorage.getItem(`airpg.story-editor.preparation.${this.project.id}.${preview.id}`);
            const attempt = saved ? JSON.parse(saved) : null;
            const draftKey = `airpg.story-editor.preparation-draft.${this.project.id}.${preview.id}`;
            const savedDraft = window.sessionStorage.getItem(draftKey);
            const draft = savedDraft ? JSON.parse(savedDraft) : null;
            const entities = attempt?.body.entities || preview.reviewedEntities || draft?.entities || preview.entities;
            const prerequisites = attempt?.body.prerequisites || preview.reviewedPrerequisites || draft?.prerequisites || preview.prerequisites || [];
            this.preparationPrerequisites = clone(prerequisites);
            const evidence = (world.history || []).filter(entry => entry.role === 'assistant' && !entry.hidden && entry.content);
            const blockedNode = (preview.prerequisites || []).some(item => item.kind === 'node');
            if (preview.requestId && !attempt && !preview.reviewedEntities) throw new Error('The persisted preparation is missing its reviewed fields. Keep the retained error receipt and restore its reviewed request before resuming.');
            this.preparationAttempt = attempt;
            this.preparationEntities = clone(entities);
            const locked = Boolean(preview.requestId);
            this.dialog('Review required characters and places', `<p>Prepare only the missing entities needed for ${esc(this.path(preview.nodeId))}. This does not create exits, move the protagonist, or force an outcome. Future intended entities remain plans.</p><form id="story-preparation-form" data-ctrl-enter-submit="[data-action='commit-preparation']">${entities.map((entity, i) => `<fieldset><legend>${esc(entity.kind === 'character' ? 'Required character' : 'Required place')}${preview.completed?.[entity.bibleId] ? ' · Already prepared' : ''}</legend><div class="form-group"><label for="story-entity-name-${i}">Name</label><input id="story-entity-name-${i}" value="${esc(entity.name)}" required ${locked ? 'readonly' : ''}></div><div class="form-group"><label for="story-entity-description-${i}">Description</label><textarea id="story-entity-description-${i}" rows="4" required ${locked ? 'readonly' : ''}>${esc(entity.description)}</textarea></div><div class="form-group"><label for="story-entity-location-${i}">${entity.kind === 'character' ? 'Existing location' : 'Existing region'}</label><select id="story-entity-location-${i}" ${locked ? 'disabled' : ''}>${(entity.kind === 'character' ? locations : regions).map(place => `<option value="${esc(place.id)}" ${place.id === (entity.kind === 'character' ? entity.locationId : entity.regionId) ? 'selected' : ''}>${esc(place.name)}</option>`).join('')}</select></div></fieldset>`).join('')}${this.prerequisitesHtml(prerequisites, evidence, locked)}<label class="stories__check"><input id="story-entities-reviewed" type="checkbox" required>I reviewed the exact entity descriptions and existing destinations</label>${button('commit-preparation', locked ? 'Resume only pending preparations' : 'Create these reviewed entities', `data-id="${preview.id}" ${blockedNode ? 'disabled' : ''}`, true)}<section id="story-preparation-result"></section></form>`, 'preparation');
            const retain = () => {
                if (locked) return;
                const fields = entities.map((entity, i) => ({ ...entity, name: this.el(`story-entity-name-${i}`).value, description: this.el(`story-entity-description-${i}`).value, [entity.kind === 'character' ? 'locationId' : 'regionId']: this.el(`story-entity-location-${i}`).value }));
                const requirements = prerequisites.map((requirement, i) => ({ ...requirement, evidenceIds: Array.from(this.root.querySelectorAll(`[name="story-prerequisite-${i}"]:checked`)).map(input => input.value) }));
                window.sessionStorage.setItem(draftKey, JSON.stringify({ entities: fields, prerequisites: requirements }));
            };
            this.el('story-preparation-form').addEventListener('input', retain);
            this.el('story-preparation-form').addEventListener('change', retain);
        }
        prerequisitesHtml(prerequisites, evidence, locked) {
            if (!prerequisites.length) return '';
            return '<h3>Actual narrative preconditions</h3>' + prerequisites.map((requirement, i) => {
                let content;
                if (requirement.kind === 'node') content = `<p class="stories__notice">Resolve or explicitly waive ${esc(this.project.nodes[requirement.requiredNodeId]?.content.title || 'the referenced earlier section')} first. A citation cannot bypass required work.</p>${button('select-node', 'Review prerequisite section', `data-node="${requirement.requiredNodeId}"`)}`;
                else content = '<p>Select actual observed passages that establish this precondition. Outline approval is not evidence.</p>' + (evidence.map((entry, j) => `<label class="stories__check"><input type="checkbox" name="story-prerequisite-${i}" value="${esc(entry.id)}" ${requirement.evidenceIds?.includes(String(entry.id)) ? 'checked' : ''} ${locked ? 'disabled' : ''}>Observed passage ${j + 1}</label><blockquote class="stories__prose">${esc(entry.content)}</blockquote>`).join('') || '<p>No actual observed passages are available. Play the prerequisite before preparing this branch.</p>');
                return `<fieldset><legend>${esc(requirement.text)}</legend>${content}</fieldset>`;
            }).join('');
        }
        async commitPreparation(previewId) {
            if (this.readOnlyProject) throw new Error('Import this saved timeline as a copy before preparing actual entities.');
            if (this.busy) throw new Error('Entity preparation is already in progress. Wait for its stage receipt.');
            if (!this.el('story-entities-reviewed').checked) throw new Error('Review the exact entity descriptions and destinations first.');
            const preview = this.project.previews[previewId];
            let attempt = this.preparationAttempt;
            if (!attempt) {
                const entities = preview.requestId ? clone(this.preparationEntities) : this.preparationEntities.map((entity, i) => ({ ...entity, name: this.el(`story-entity-name-${i}`).value, description: this.el(`story-entity-description-${i}`).value, [entity.kind === 'character' ? 'locationId' : 'regionId']: this.el(`story-entity-location-${i}`).value }));
                if (entities.some(e => !e.name.trim() || !e.description.trim() || !(e.kind === 'character' ? e.locationId : e.regionId))) throw new Error('Every required entity needs a concrete name, description, and existing destination.');
                const prerequisites = preview.requestId ? clone(this.preparationPrerequisites) : this.preparationPrerequisites.map((requirement, i) => ({ nodeId: requirement.nodeId, text: requirement.text, evidenceIds: Array.from(this.root.querySelectorAll(`[name="story-prerequisite-${i}"]:checked`)).map(input => input.value) }));
                if (prerequisites.some(item => !item.evidenceIds?.length)) throw new Error('Select actual observed evidence for each narrative precondition. Required node work must be resolved or explicitly waived first.');
                attempt = { storyId: this.project.id, body: this.envelope({ previewId, entities, prerequisites, reviewed: true }, this.project.revision, preview.requestId || uuid()) };
                this.preparationAttempt = attempt;
                window.sessionStorage.setItem(`airpg.story-editor.preparation.${this.project.id}.${previewId}`, JSON.stringify(attempt));
            }
            if (this.busy) throw new Error('Wait for the current story operation to finish.');
            this.busy = true;
            const commitButton = this.el('story-preparation-form').querySelector('[data-action="commit-preparation"]');
            commitButton.disabled = true;
            this.el('story-preparation-result').innerHTML = '<p role="status">Preparing the reviewed entities through normal game creation. Completed stages will be retained.</p><progress aria-label="Reviewed entity preparation in progress"></progress>';
            try {
                const data = await this.api(`/stories/${attempt.storyId}/preparations/commit`, 'POST', attempt.body);
                if (data.project) this.acceptProject(data.project);
                if (data.boundState) this.boundState = data.boundState;
                this.renderReconciliation();
                this.el('story-preparation-result').innerHTML = this.preparationReceiptsHtml();
                this.announce('Required entity preparation complete. Review and prepare Play direction explicitly.');
            } catch (error) {
                try { await this.refreshProject(); this.el('story-preparation-result').innerHTML = this.preparationReceiptsHtml(); }
                catch (receiptError) { error.stack += `\n\nReading preparation progress also failed:\n${receiptError.stack}`; }
                throw error;
            } finally { this.busy = false; commitButton.disabled = false; this.updateEditActions(); }
        }
        executionProject() {
            if (this.readOnlyProject || this.boundState?.conflict === 'continue-saved') {
                if (!this.boundState.snapshot) throw new Error('The selected saved story snapshot is unavailable for direction review.');
                return this.boundState.snapshot;
            }
            return this.project;
        }
        playReviewAvailable(id = this.nodeId, scope = 'subscene') {
            if (!this.project.binding || this.boundState?.requiresCopyBeforeWriting || this.boundState?.pendingSync) return false;
            if (this.readOnlyProject || this.boundState?.conflict === 'continue-saved') return this.executionReady(id, scope);
            const source = this.executionProject(), n = source.nodes[id];
            if (!n || n.archived || this.boundState?.execution?.status === 'needs-review') return false;
            const leaves = scope === 'scene' ? n.children.map(childId => source.nodes[childId]).filter(c => !c.archived && c.execution.status === 'unwritten') : [n];
            return leaves.length > 0 && leaves.every(leaf => leaf.type === 'subscene' && leaf.execution.status === 'unwritten');
        }
        async recoverPlayApprovals(scope, action) {
            if (this.readOnlyProject || this.boundState?.conflict === 'continue-saved') return false;
            const storyId = this.project.id, nodeId = this.nodeId;
            const requireTarget = () => { if (this.project?.id !== storyId || this.nodeId !== nodeId) throw new Error('The selected story section changed. Review approvals for the current Play scope before continuing.'); };
            const result = await this.api(`/stories/${storyId}/execution/approval-preview`, 'POST', { nodeId, scope });
            requireTarget();
            if (result.project) this.acceptProject(result.project);
            if (result.boundState) this.boundState = result.boundState;
            const preview = result.approvalPreview;
            if (!preview || preview.storyId !== storyId || preview.nodeId !== nodeId || preview.scope !== scope || !Array.isArray(preview.items)) throw new Error('The Play approval review is malformed.');
            if (!preview.needsRecovery) return false;
            const request = { id: uuid(), storyId, nodeId, scope, action, preview };
            this.playApprovalRequest = request;
            const status = item => item.action === 'sync' ? 'Approved in library · update game approval' : item.libraryStatus === 'stale' ? 'Needs current approval' : 'Needs approval';
            this.dialog('Approve required story sections', `<p>Review the sections required for ${esc(this.path(nodeId))}. Only the listed sections will be approved or have their reviewed approval copied into the current game.</p><ul id="story-play-approvals-list">${preview.items.map(item => `<li><strong>${esc(item.path)}</strong><p class="help-text">${esc(status(item))}</p></li>`).join('')}</ul>${preview.items.length ? '' : '<p>The branch is approved. Confirm updating its matching saved-story revision before continuing.</p>'}<p class="help-text">Story content and actual game history stay unchanged. Play still requires its explicit Start.</p><form id="story-play-approvals-form" data-ctrl-enter-submit="#story-approve-continue"></form>`, 'play-approvals', button('close-dialog', 'Cancel', 'id="story-approval-cancel"') + '<button id="story-approve-continue" type="submit" form="story-play-approvals-form" class="btn btn-primary">Approve all and continue</button>', { initialFocus: '#story-approval-cancel' });
            this.el('story-play-approvals-form').addEventListener('submit', event => {
                event.preventDefault();
                this.submitDialog(async () => {
                    if (this.playApprovalRequest !== request || this.dialogKind !== 'play-approvals') throw new Error('This Play approval review is no longer active.');
                    requireTarget();
                    if (this.buffer().dirty || this.sourceDrafts.get(storyId)?.dirty || this.readOnlyProject) throw new Error('Save or review your current local changes before approving Play scope.');
                    const accepted = await this.mutate('/execution/approve-for-play', { nodeId, scope, reviewed: true, approvalFingerprint: preview.fingerprint }, { revision: preview.libraryRevision, requestId: request.id });
                    if (this.playApprovalRequest !== request || this.dialogKind !== 'play-approvals') return;
                    requireTarget();
                    if (accepted.boundState) this.boundState = accepted.boundState;
                    this.closeDialog(); this.renderSection();
                    if (action === 'prepare') await this.preparePlay(scope); else await this.playReview(scope);
                }, event.target).catch(error => this.fail(error, event.submitter || this.el('story-approval-cancel')));
            });
            return true;
        }
        executionReady(id = this.nodeId, scope = 'subscene') {
            if (this.boundState?.requiresCopyBeforeWriting || this.boundState?.pendingSync) return false;
            const source = this.executionProject();
            const n = source.nodes[id];
            if (!n || n.archived) return false;
            const leaves = scope === 'scene' ? n.children.map(childId => source.nodes[childId]).filter(c => !c.archived && c.execution.status === 'unwritten') : [n];
            if (!leaves.length) return false;
            const approved = node => node.reviewStatus === 'approved';
            return leaves.every(leaf => {
                if (leaf.type !== 'subscene' || leaf.execution.status !== 'unwritten' || !approved(leaf)) return false;
                let parent = leaf.parentId ? source.nodes[leaf.parentId] : null;
                while (parent) {
                    if (!approved(parent)) return false;
                    parent = parent.parentId ? source.nodes[parent.parentId] : null;
                }
                return true;
            });
        }
        async playReview(scope) {
            if (this.boundState?.requiresCopyBeforeWriting) {
                this.dialog('Import saved story before writing', `<p>${esc(this.boundState.continuationPolicy)}</p>${button('import-as-copy', 'Import saved story as a copy', '', true)}`, 'copy-required');
                return;
            }
            try { if (await this.recoverPlayApprovals(scope, 'review')) return; }
            catch (error) { if (error.code === 'STORY_SNAPSHOT_CONFLICT') await this.reviewTimelines(); throw error; }
            const source = this.executionProject();
            const n = source.nodes[this.nodeId];
            if (!n) throw new Error('This library section is absent from the selected saved timeline. Select a saved-story section or review library adoption first.');
            const leaves = scope === 'scene' ? n.children.map(id => source.nodes[id]).filter(c => !c.archived && c.execution.status === 'unwritten') : [n];
            if (!leaves.length) throw new Error('There are no unwritten sub-scenes in this scope.');
            if (!this.executionReady(n.id, scope)) throw new Error('Approve each sub-scene before preparing it for Play.');
            this.dialog('Review for Play', `<p>Ready scope: ${esc(n.content.title)} · ${source === this.project ? 'Reviewed library story' : 'Pinned saved timeline'}</p>${leaves.map(l => `<article class="stories__card"><h3>${esc(l.content.title)}</h3><div class="stories__diff-columns"><section><h4>Protagonist direction</h4><dl><dt>Goal</dt><dd class="stories__prose">${esc(l.content.actorGoal)}</dd><dt>Notes</dt><dd class="stories__prose">${esc(l.content.actorNotes) || 'No protagonist notes.'}</dd></dl></section><section><h4>Private author direction</h4><p class="stories__prose">${esc(l.content.privateDirection || l.content.narrativePurpose)}</p></section></div><h4>Possible outcomes</h4><ul>${l.content.completionCriteria.map(c => `<li>${esc(c)}</li>`).join('')}${l.content.failureConditions.map(c => `<li>Unfavorable resolution: ${esc(c)}</li>`).join('')}</ul></article>`).join('')}<p>Review goal and notes for private information. The game resolves attempts normally; the outline cannot force success. Writing pauses for actual-outcome review at each sub-scene boundary.</p><p class="stories__notice">Preparing does not start writing. Keep the owning Play tab open and explicitly Start there.</p>${button('prepare-play', scope === 'scene' ? 'Prepare approved scene queue for Play' : 'Prepare this sub-scene for Play', `data-scope="${scope}"`, true)}`, 'play');
        }
        async preparePlay(scope) {
            try { if (await this.recoverPlayApprovals(scope, 'prepare')) return; }
            catch (error) { if (error.code === 'STORY_SNAPSHOT_CONFLICT') await this.reviewTimelines(); throw error; }
            let data;
            try { data = await this.mutate('/execution/prepare', { nodeId: this.nodeId, scope, reviewed: true }, { revision: this.executionProject().revision }); }
            catch (error) {
                if (error.code === 'STORY_COPY_REQUIRED') this.el('story-dialog-body').insertAdjacentHTML('beforeend', '<p class="stories__notice">Import this saved story as a copy before new writing. Its actual history is preserved.</p>' + button('import-as-copy', 'Import saved story as a copy', '', true));
                if (['STORY_ENTITIES_REQUIRED', 'STORY_PREREQUISITES_REQUIRED'].includes(error.code)) this.el('story-dialog-body').insertAdjacentHTML('beforeend', '<p class="stories__notice">Required characters, places, or narrative preconditions need actual preparation before this sub-scene can run.</p>' + button('prepare-entities', 'Review required characters and places', `data-node="${this.nodeId}"`));
                throw error;
            }
            this.closeDialog();
            this.dialog('Ready on Play', `<h3>${esc(this.path(data.packet.subsceneId))}</h3><dl><dt>Protagonist goal</dt><dd class="stories__prose">${esc(data.packet.goal)}</dd><dt>Protagonist notes</dt><dd class="stories__prose">${esc(data.packet.notes)}</dd></dl><p>${data.packet.queue.length} approved ${data.packet.queue.length === 1 ? 'sub-scene' : 'sub-scenes'} in the reviewed queue. Actual outcomes need review before the next step.</p><p>Keep Play open while writing. Start remains explicit on Play.</p>${button('open-play', 'Open or focus Play', `data-packet="${data.packet.id}" data-url="${esc(data.playUrl)}"`, true)}<a class="btn btn-secondary" href="${esc(data.playUrl)}" target="airpg-story-play">Open Play in a separate tab</a>`, 'play-ready');
        }
        async openPlay(packetId, url) {
            if (!('BroadcastChannel' in window)) {
                const tab = window.open(url, 'airpg-story-play');
                if (!tab) throw new Error('The browser blocked the Play tab. Use the Open Play link.');
                return;
            }
            const requestId = uuid();
            const channel = new BroadcastChannel('airpg.story-authoring.handoff');
            const replies = [];
            const existing = await new Promise(resolve => {
                channel.onmessage = event => { const m = event.data; if (m.type === 'play-present' && m.requestId === requestId) replies.push(m); };
                channel.postMessage({ type: 'locate-play', requestId });
                window.setTimeout(() => resolve(replies.find(r => r.ownsRun) || replies.find(r => r.visible) || replies[0]), 200);
            });
            if (existing) {
                const acknowledged = await new Promise((resolve, reject) => {
                    const timer = window.setTimeout(() => reject(new Error('The existing Play tab did not acknowledge this packet. Keep it open or use the explicit Play link.')), 3000);
                    channel.onmessage = event => {
                        const m = event.data;
                        if (m.requestId !== requestId || m.ownerId !== existing.ownerId) return;
                        if (m.type === 'packet-ready') { window.clearTimeout(timer); resolve(true); }
                        if (m.type === 'packet-error') { window.clearTimeout(timer); reject(errorFrom(m.error)); }
                    };
                    channel.postMessage({ type: 'prepare-packet', packetId, ownerId: existing.ownerId, requestId });
                }).finally(() => channel.close());
                if (acknowledged) this.announce('The reviewed sub-scene is ready in the existing Play tab. Start it there.');
            } else {
                channel.close();
                const tab = window.open(url, 'airpg-story-play');
                if (!tab) throw new Error('The browser blocked the Play tab. Use the Open Play link.');
            }
        }
    }

    window.StoryEditor = StoryEditor;
    function boot() {
        const root = document.getElementById('story-editor');
        if (!root) return;
        try { window.AIRPG_STORY_EDITOR = new StoryEditor(root); }
        catch (error) {
            console.error('[Stories startup]', error);
            const host = root.querySelector('#story-errors');
            host.hidden = false; host.innerHTML = `<div role="alert" class="stories__error"><strong>${esc(error.message)}</strong><pre>${esc(error.stack)}</pre></div>`;
            window.AIRPG_PAGE_FEEDBACK?.showError(error);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
}());
