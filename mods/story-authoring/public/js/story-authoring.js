/* global window, document, navigator */
'use strict';

(function () {
    class StoryAuthoringRunner {
        constructor(chat) {
            this.chat = chat;
            this.ownerId = chat.generateRequestId();
            this.run = null;
            this.running = false;
            this.pauseRequested = false;
            this.busy = false;
            this.saved = null;
            this.notesDirty = false;
            this.heartbeatBusy = false;
            this.uiDisposed = false;
            this.uiListeners = new window.AbortController();
            this.mount();
            this.unregisterInput = chat.registerPlayerInputRequestHandler(payload => this.handleInput(payload));
            if (typeof window.registerPlayerAbilitySelectionHandler !== 'function') throw new Error('The ability selection controller hook is unavailable.');
            this.unregisterAbilities = window.registerPlayerAbilitySelectionHandler(() => Boolean(this.run && this.running && !this.pauseRequested));
            window.addEventListener('pagehide', event => {
                try { this.leave(); }
                finally { if (!event.persisted) this.disposeUI(); }
            }, { signal: this.uiListeners.signal });
            document.addEventListener('keydown', event => {
                if (event.ctrlKey && event.shiftKey && event.code === 'KeyP' && this.run) {
                    event.preventDefault();
                    this.pause().catch(error => this.error(error));
                }
            }, { signal: this.uiListeners.signal });
            this.pollTimer = window.setInterval(() => {
                if (!this.running && !this.busy) this.refresh().catch(error => this.error(error));
            }, 3000);
            this.installStoryHandoff();
            this.refresh().then(() => {
                const packetId = new URLSearchParams(window.location.search).get('storyPacket');
                if (packetId && !this.uiDisposed) return this.loadStoryPacket(packetId);
            }).catch(error => this.error(error));
        }

        mount() {
            const widgets = window.AIRPG_WIDGETS;
            if (!widgets?.createDisclosure || !widgets.createField || !widgets.ActionGroup || !widgets.StatusSurface) throw new Error('The shared widgets are unavailable for Story Authoring.');
            const { details: panel } = widgets.createDisclosure({ document, summaryText: 'Story Authoring', className: 'story-authoring' });
            panel.id = 'storyAuthoringPanel';
            panel.insertAdjacentHTML('beforeend', `
                <div class="story-authoring__body">
                    <div class="story-authoring__save"><button id="storyAuthoringSave" class="btn btn-secondary" type="button">Save notes and goal</button><span id="storyAuthoringSaveStatus" aria-live="polite"></span></div>
                    <div class="story-authoring__actions"></div>
                    <div class="story-authoring__undo"><button id="storyAuthoringUndo" class="btn btn-secondary" type="button" title="Stop prompts and restore the latest autosave"><img src="/assets/material-icons/misc/cancel.svg" alt="" aria-hidden="true">Stop &amp; Undo</button></div>
                    <p id="storyAuthoringStatus" role="status" aria-live="polite">Loading authoring state…</p>
                    <dl><dt>Latest action</dt><dd id="storyAuthoringLatestAction">No action chosen yet.</dd><dt>Completion reason</dt><dd id="storyAuthoringCompletionReason">Scene unfinished.</dd></dl>
                    <p class="story-authoring__hint">Keep Play open while writing. Ctrl+Shift+P pauses. Notes take effect at the next decision.</p>
                    <div id="storyAuthoringPacket" hidden aria-live="polite"></div>
                    <a class="btn btn-secondary" href="/mods/story-authoring/pages/stories" target="_blank" rel="noopener">Open Stories in another tab</a>
                </div>`);
            const goal = widgets.createField({ document, label: 'Scene or chapter goal', className: 'form-group', type: 'textarea', id: 'storyAuthoringGoal', rows: 3, placeholder: 'The ending this scene should reach' });
            const notes = widgets.createField({ document, label: 'Author notes', className: 'form-group', type: 'textarea', id: 'storyAuthoringNotes', rows: 3, placeholder: 'Tone, characterization and creative direction' });
            panel.querySelector('.story-authoring__body').prepend(goal.field, notes.field);
            const chatLog = document.getElementById('chatLog');
            if (!chatLog) throw new Error('The Play chat pane is unavailable for Story Authoring.');
            chatLog.before(panel);
            this.panelAnchor = document.createComment('story-authoring-panel');
            panel.before(this.panelAnchor);
            this.panel = panel;
            const node = name => panel.querySelector(`#storyAuthoring${name}`);
            this.goal = node('Goal');
            this.notes = node('Notes');
            this.status = node('Status');
            this.latest = node('LatestAction');
            this.completion = node('CompletionReason');
            this.actions = new widgets.ActionGroup(panel.querySelector('.story-authoring__actions'), {
                onAction: id => {
                    const operation = id === 'pause' ? this.pause() : this.begin(id === 'resume');
                    operation.catch(error => this.error(error));
                }
            });
            this.renderActions({});
            this.startButton = this.actions.buttons.get('start');
            this.pauseButton = this.actions.buttons.get('pause');
            this.resumeButton = this.actions.buttons.get('resume');
            for (const [id, button] of this.actions.buttons) button.id = `storyAuthoring${id[0].toUpperCase()}${id.slice(1)}`;
            this.saveButton = node('Save');
            this.saveStatus = node('SaveStatus');
            this.undoButton = node('Undo');
            this.packetPanel = node('Packet');
            this.checkpointActions = new widgets.ActionGroup(this.packetPanel, { onAction: () => this.useManualGoal() });
            this.statusSurface = widgets.StatusSurface.attach(this.status);
            this.saveSurface = widgets.StatusSurface.attach(this.saveStatus);
            for (const field of [this.goal, this.notes]) field.addEventListener('input', () => {
                this.notesDirty = true;
                this.saveSurface.update({ text: 'Unsaved changes' });
            }, { signal: this.uiListeners.signal });
            this.saveButton.addEventListener('click', () => this.saveSettings().catch(error => this.error(error)), { signal: this.uiListeners.signal });
            this.undoButton.addEventListener('click', () => this.undo().catch(error => this.error(error)), { signal: this.uiListeners.signal });
            const abilityModal = document.getElementById('playerAbilitySelectionModal');
            if (!abilityModal) throw new Error('The ability selection modal is unavailable.');
            const authorButton = document.createElement('button');
            authorButton.id = 'storyAuthoringUseForAbilities';
            authorButton.type = 'button';
            authorButton.className = 'btn btn-secondary';
            authorButton.textContent = 'Use Story Authoring';
            this.authorButton = authorButton;
            authorButton.addEventListener('click', () => {
                authorButton.after(panel);
                panel.open = true;
                this.goal.focus();
            }, { signal: this.uiListeners.signal });
            abilityModal.querySelector('.modal__body').prepend(authorButton);
            this.abilityModalObserver = new MutationObserver(() => {
                if (abilityModal.hidden && abilityModal.contains(panel)) {
                    this.panelAnchor.after(panel);
                    panel.querySelector('summary').focus();
                }
            });
            this.abilityModalObserver.observe(abilityModal, { attributes: true, attributeFilter: ['hidden'] });
        }

        installStoryHandoff() {
            if (!('BroadcastChannel' in window)) return;
            const channel = this.handoffChannel = new BroadcastChannel('airpg.story-authoring.handoff');
            channel.onmessage = event => {
                if (this.handoffChannel !== channel || this.uiDisposed) return;
                const message = event.data;
                if (message.type === 'locate-play') {
                    this.handoffChannel.postMessage({ type: 'play-present', requestId: message.requestId, ownerId: this.ownerId, ownsRun: Boolean(this.run), visible: document.visibilityState === 'visible' });
                } else if (message.type === 'prepare-packet' && message.ownerId === this.ownerId) {
                    this.loadStoryPacket(message.packetId).then(() => {
                        if (this.handoffChannel !== channel || this.uiDisposed) return;
                        window.focus();
                        channel.postMessage({ type: 'packet-ready', requestId: message.requestId, ownerId: this.ownerId });
                    }).catch(error => {
                        this.error(error);
                        if (this.handoffChannel !== channel || this.uiDisposed) return;
                        channel.postMessage({ type: 'packet-error', requestId: message.requestId, ownerId: this.ownerId, error: { error: error.message, stack: error.stack, code: error.code } });
                    });
                }
            };
        }

        async loadStoryPacket(packetId) {
            if (this.busy || this.running || this.run) throw new Error('Pause and settle the current writing run before reviewing another sub-scene.');
            const current = await this.refresh();
            if (current.run) throw new Error('Pause and settle the current writing owner before receiving another sub-scene.');
            const storyId = current.saved?.storyBinding?.binding?.storyId;
            if (!storyId) throw new Error('This game has no bound story for the reviewed direction. Set up or attach the story in Stories first.');
            const data = await this.api(`stories/${encodeURIComponent(storyId)}/execution/packets/${encodeURIComponent(packetId)}`, null, 'GET');
            if (!data.packet || typeof data.packet.goal !== 'string' || typeof data.packet.notes !== 'string') throw new Error('The server returned an invalid reviewed story direction.');
            if (this.uiDisposed) return;
            if (!this.packet) this.manualBuffer = { goal: this.goal.value, notes: this.notes.value, dirty: this.notesDirty };
            this.packet = data.packet;
            this.notesDirty = false;
            this.goal.value = this.packet.goal;
            this.notes.value = this.packet.notes;
            this.goal.readOnly = this.notes.readOnly = true;
            this.saveButton.disabled = true;
            this.startButton.textContent = 'Start reviewed sub-scene';
            this.panel.open = true;
            this.renderStoryCheckpoint();
            this.startButton.focus();
        }

        useManualGoal() {
            if (this.run || this.busy || this.running) { this.error(new Error('Pause and settle writing before switching to a manual goal.')); return; }
            this.packet = null;
            this.goal.readOnly = this.notes.readOnly = false;
            if (this.manualBuffer) {
                this.goal.value = this.manualBuffer.goal;
                this.notes.value = this.manualBuffer.notes;
                this.notesDirty = this.manualBuffer.dirty;
            }
            this.manualBuffer = null;
            const url = new URL(window.location.href);
            url.searchParams.delete('storyPacket');
            window.history.replaceState({}, '', url);
            this.startButton.textContent = 'Start';
            this.refresh().catch(error => this.error(error));
        }

        renderStoryCheckpoint() {
            if (this.uiDisposed) return;
            const binding = this.saved?.storyBinding;
            const execution = binding?.execution || this.saved?.storyExecution;
            const receipt = execution?.receiptId ? binding?.receipts?.[execution.receiptId] : null;
            this.packetPanel.hidden = !(this.packet || binding);
            this.checkpointActions.update([]);
            this.packetPanel.replaceChildren();
            if (this.packet) {
                const p = document.createElement('p');
                p.textContent = 'Reviewed story direction is ready. Start explicitly below. Keep this Play tab open; writing pauses at the actual-outcome boundary.';
                this.packetPanel.append(p);
                this.checkpointActions.update([{ id: 'manual', label: 'Return to manual goal writing', className: 'btn btn-secondary', disabled: Boolean(this.run || this.busy || this.running) }]);
                this.checkpointActions.buttons.get('manual').dataset.storyManual = 'true';
            }
            if (binding) {
                const p = document.createElement('p');
                p.textContent = binding.pendingSync ? 'Story outcome synchronization needs review. Next writing is blocked.' : execution?.status === 'needs-review' ? 'Actual outcome recorded. Review and accept it in Stories before continuing.' : 'Story writing is separate from outline approval and game autosave.';
                this.packetPanel.append(p);
                if (receipt) {
                    const reason = document.createElement('p'); reason.textContent = receipt.summary || receipt.reason; this.packetPanel.append(reason);
                }
                const link = document.createElement('a');
                link.className = 'btn btn-secondary'; link.target = '_blank'; link.rel = 'noopener';
                link.href = `/mods/story-authoring/pages/stories/${binding.binding.storyId}/${this.packet?.subsceneId || binding.snapshot.rootId}?tab=written`;
                link.textContent = 'Review actual outcome in Stories';
                this.packetPanel.append(link);
            }
        }

        async api(path, body, method = 'POST') {
            const response = await window.fetch(`/api/mods/story-authoring/${path}`, {
                method,
                headers: { 'Content-Type': 'application/json' },
                ...(method === 'GET' ? {} : { body: JSON.stringify({ ownerId: this.ownerId, runId: this.run?.runId, ...body }) })
            });
            const data = await response.json();
            if (!response.ok || data.success !== true) {
                const error = new Error(data.error || `Story Authoring request failed: HTTP ${response.status}.`);
                if (data.stack) error.stack = data.stack;
                error.code = data.code;
                throw error;
            }
            return data;
        }

        render(data) {
            this.saved = data.saved || this.saved;
            if (data.runFailure && data.runFailure.stack !== this.lastRunFailureStack) {
                this.lastRunFailureStack = data.runFailure.stack;
                this.pauseRequested = true;
                const error = new Error(data.runFailure.error);
                error.stack = data.runFailure.stack || error.stack;
                this.error(error);
            }
            this.available = data.available;
            if (this.uiDisposed) return;
            const elsewhere = data.run && data.run.ownerId !== this.ownerId;
            if (!this.packet && !this.notesDirty && this.saved) {
                this.goal.value = this.saved.goal;
                this.notes.value = this.saved.notes;
            }
            this.renderActions(data);
            this.saveButton.disabled = !data.available || elsewhere || Boolean(this.packet);
            this.goal.disabled = !data.available || elsewhere;
            this.notes.disabled = !data.available || elsewhere;
            this.goal.readOnly = this.notes.readOnly = Boolean(this.packet);
            this.latest.textContent = this.saved?.latestAction || 'No action chosen yet.';
            this.completion.textContent = this.saved?.completionReason || 'Scene unfinished.';
            this.renderStoryCheckpoint();
            const turns = this.saved?.completedTurns || 0;
            const status = !data.available ? 'Load or start a game to write.'
                : elsewhere ? 'Another Play page owns the writing run.'
                    : data.run ? `${data.run.pauseRequested ? 'Pausing after current work' : ({ idle: 'Writing', deciding: 'Choosing next action', ready: 'Action chosen', turn: 'Resolving turn', input: 'Choosing narrative response', choice: 'Resolving protagonist choice', finalizing: 'Finishing continuity work', settling: 'Turn completed' }[data.run.phase] || data.run.phase)} · ${turns} completed turns`
                        : this.saved?.completed ? `${this.packet || this.saved?.storyBinding ? 'Scene resolved · review actual outcome' : 'Goal reached'} · ${turns} completed turns`
                            : `Paused · ${turns} completed turns`;
            this.statusSurface.update({ text: status });
        }

        renderActions(data) {
            const storyExecution = this.saved?.storyBinding?.execution || this.saved?.storyExecution;
            const sameUnfinishedPacket = this.packet && storyExecution?.packetId === this.packet.id && ['in-progress', 'paused', 'needs-review'].includes(storyExecution.status);
            this.actions.update([
                { id: 'start', label: this.packet ? 'Start reviewed sub-scene' : 'Start', className: 'btn btn-primary', disabled: !data.available || Boolean(data.run) || this.busy || Boolean(sameUnfinishedPacket) },
                { id: 'pause', label: 'Pause after this turn', title: 'Ctrl+Shift+P', className: 'btn btn-secondary', disabled: !data.run || data.run.ownerId !== this.ownerId || this.pauseRequested },
                { id: 'resume', label: 'Resume', className: 'btn btn-secondary', disabled: !data.available || Boolean(data.run) || this.busy || !this.saved?.sceneId || Boolean(this.saved.completed) }
            ]);
        }

        async refresh() {
            const data = await this.api('state', null, 'GET');
            this.render(data);
            return data;
        }

        async saveSettings() {
            if (this.packet) throw new Error('This reviewed story direction is frozen. Return to manual goal writing to edit goal and notes.');
            const goal = this.goal.value;
            const notes = this.notes.value;
            const data = await this.api('settings', { goal, notes }, 'PUT');
            if (this.goal.value === goal && this.notes.value === notes) {
                this.notesDirty = false;
                if (!this.uiDisposed) this.saveSurface.update({ text: 'Saved' });
            }
            this.saved = data.saved;
        }

        async begin(resume) {
            if (this.busy || this.running) throw new Error('Writing is already starting or running.');
            this.busy = true;
            this.startButton.disabled = this.resumeButton.disabled = true;
            let operationError = null;
            try {
                const savedPacketId = this.saved?.storyBinding?.execution?.packetId || this.saved?.storyExecution?.packetId;
                const packetId = this.packet?.id || (resume ? savedPacketId : null);
                if (!packetId) await this.saveSettings();
                if (this.uiDisposed) return;
                const data = await this.api('start', { resume, clientId: this.chat.clientId, ...(packetId ? { packetId } : {}) });
                this.run = data.run;
                // A submitted start may settle after final departure. Release its owner
                // without installing scheduling or protagonist UI in the retired document.
                if (this.uiDisposed) {
                    await this.pause();
                    return;
                }
                this.lastDisplayedErrorStack = null;
                this.lastRunFailureStack = null;
                this.pauseRequested = false;
                this.running = true;
                this.render(data);
                this.heartbeatTimer = window.setInterval(() => this.heartbeat(), 10000);
                await window.requestPlayerAbilitySelectionFlow({ force: true });
                await this.loop();
            } catch (error) {
                operationError = error;
                if (this.run) await this.pause().catch(pauseError => this.reportSecondaryError(error, pauseError));
                throw error;
            } finally {
                this.running = false;
                this.busy = false;
                window.clearInterval(this.heartbeatTimer);
                try {
                    const state = await this.refresh();
                    if (!state.run) this.run = null;
                    if (state.available && !this.uiDisposed) await window.requestPlayerAbilitySelectionFlow({ force: true });
                } catch (cleanupError) {
                    if (!operationError) throw cleanupError;
                    this.reportSecondaryError(operationError, cleanupError);
                }
            }
        }

        async heartbeat() {
            if (!this.run || this.heartbeatBusy) return;
            this.heartbeatBusy = true;
            try {
                this.render(await this.api('heartbeat', {}));
            } catch (error) {
                this.pauseRequested = true;
                window.clearInterval(this.heartbeatTimer);
                try {
                    await this.pause();
                } catch (pauseError) {
                    error.stack = `${error.stack || error.message}\n\nPause request also failed:\n${pauseError.stack || pauseError.message}`;
                }
                this.error(error);
            } finally { this.heartbeatBusy = false; }
        }

        async refreshGame() {
            await this.chat.refreshChatHistory({ throwOnError: true });
            await this.chat.checkLocationUpdate({ throwOnError: true });
        }

        async submitChoice(decision) {
            const metadata = { modName: 'story-authoring', runId: this.run.runId, decisionId: decision.decisionId };
            const quest = decision.kind === 'quest';
            const body = quest ? { confirmationId: decision.confirmationId, accepted: decision.accepted }
                : { level: decision.level, selectedAbilityNames: decision.selectedAbilityNames };
            const response = await window.fetch(quest ? '/api/quests/confirm' : '/api/player/ability-selection/submit', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...body, clientId: this.chat.clientId, modRequest: metadata })
            });
            const data = await response.json();
            if (!response.ok || data.success !== true) {
                const error = new Error(data.error || `Protagonist choice failed: HTTP ${response.status}.`);
                if (data.stack) error.stack = data.stack;
                throw error;
            }
            if (!quest) {
                if (typeof window.requestPlayerAbilitySelectionFlow !== 'function') throw new Error('The ability selection UI is unavailable.');
                await window.requestPlayerAbilitySelectionFlow({ pendingPayload: data.abilitySelection, force: true });
            }
            await this.refreshGame();
        }

        async loop() {
            let operationError = null;
            try {
                while (this.run && !this.pauseRequested) {
                    if (this.notesDirty) await this.saveSettings();
                    if (this.pauseRequested) break;
                    const result = await this.api('decision', {});
                    this.render(result.state);
                    if (this.pauseRequested) break;
                    const decision = result.decision;
                    if (decision.kind === 'complete') { this.run = null; break; }
                    if (result.choiceApplied) { await this.refreshGame(); continue; }
                    if (['quest', 'abilities'].includes(decision.kind)) await this.submitChoice(decision);
                    else if (decision.kind === 'action') {
                        await this.chat.dispatchAutomatedMessage(decision.action, {
                            modRequest: { modName: 'story-authoring', runId: this.run.runId, decisionId: decision.decisionId },
                            requireSuccessfulTurn: true
                        });
                    } else throw new Error(`Unexpected authoring decision: ${decision.kind}.`);
                    // Rendering and refresh have completed. The server additionally settles detached continuity.
                    const state = await this.refresh();
                    if (!state.run) { this.run = null; break; }
                    const settled = await this.api('settle', {});
                    this.render(settled);
                    if (!settled.run) this.run = null;
                }
            } catch (error) {
                if (error.code !== 'STORY_AUTHORING_PAUSED' || !this.pauseRequested) {
                    operationError = error;
                    await this.pause().catch(pauseError => this.reportSecondaryError(error, pauseError));
                    throw error;
                }
            } finally {
                if (this.pauseRequested && this.run) {
                    try {
                        const state = await this.refresh();
                        if (!state.run) this.run = null;
                    } catch (cleanupError) {
                        if (!operationError) throw cleanupError;
                        this.reportSecondaryError(operationError, cleanupError);
                    }
                }
            }
        }

        async pause() {
            this.pauseRequested = true;
            if (!this.uiDisposed) this.pauseButton.disabled = true;
            if (!this.run) return;
            const state = await this.api('pause', {});
            this.render(state);
            // Retain the local identity until an already submitted turn has returned.
            if (!state.run && !this.running) this.run = null;
        }

        async undo() {
            this.pauseRequested = true;
            const restored = await this.chat.cancelAllPromptsAndLoadLatestAutosave({ triggerButton: this.undoButton });
            if (!restored) throw new Error('Stop & Undo did not restore an autosave. See the original game error.');
            this.run = null;
            await this.refresh();
        }

        async handleInput(payload) {
            if (!this.run || !this.running) return false;
            if (payload.mode && payload.mode !== 'text') {
                await this.pause();
                this.error(new Error(`Story Authoring paused for technical input: ${payload.question || payload.promptLabel}. Resolve it in the existing game panel.`));
                return false;
            }
            try {
                const result = await this.api('input', { question: payload.question, mode: 'text', promptLabel: payload.promptLabel });
                const response = await window.fetch('/api/chat/user-input-response', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ inputRequestId: payload.inputRequestId, clientId: this.chat.clientId, requestId: payload.requestId, answer: result.answer })
                });
                const data = await response.json();
                if (!response.ok || data.success !== true) {
                    const error = new Error(data.error || 'The narrative answer was not accepted.');
                    if (data.stack) error.stack = data.stack;
                    error.code = data.code;
                    throw error;
                }
                return true;
            } catch (error) {
                await this.pause().catch(pauseError => this.reportSecondaryError(error, pauseError));
                this.error(error);
                return false;
            }
        }

        leave() {
            this.pauseRequested = true;
            window.clearInterval(this.heartbeatTimer);
            window.clearInterval(this.pollTimer);
            if (this.handoffChannel) {
                this.handoffChannel.onmessage = null;
                this.handoffChannel.close();
                this.handoffChannel = null;
            }
            if (this.run) navigator.sendBeacon('/api/mods/story-authoring/pause', new Blob([JSON.stringify({ ownerId: this.ownerId, runId: this.run.runId })], { type: 'application/json' }));
        }

        disposeUI() {
            if (this.uiDisposed) return;
            this.uiDisposed = true;
            const errors = [];
            for (const release of [
                () => this.uiListeners.abort(),
                () => this.unregisterInput(),
                () => this.unregisterAbilities(),
                () => this.abilityModalObserver.disconnect(),
                () => this.actions.destroy(),
                () => this.checkpointActions.destroy(),
                () => this.statusSurface.destroy(),
                () => this.saveSurface.destroy(),
                () => this.authorButton.remove(),
                () => this.panel.remove(),
                () => this.panelAnchor.remove()
            ]) {
                try { release(); } catch (error) { errors.push(error); }
            }
            if (errors.length === 1) throw errors[0];
            if (errors.length) throw new AggregateError(errors, 'Story Authoring UI cleanup failed.', { cause: errors[0] });
        }

        reportSecondaryError(originalError, secondaryError) {
            console.error('[Story Authoring cleanup]', secondaryError);
            originalError.stack = `${originalError.stack || originalError.message}\n\nCleanup also failed:\n${secondaryError.stack || secondaryError.message}`;
            this.error(originalError);
        }

        error(error) {
            const details = error.stack || error.message;
            if (details === this.lastDisplayedErrorStack) return;
            this.lastDisplayedErrorStack = details;
            console.error('[Story Authoring]', error);
            if (!this.uiDisposed) this.chat.showChatErrorPopup(details);
        }
    }

    window.StoryAuthoringRunner = StoryAuthoringRunner;
    const boot = (attempt = 0) => {
        if (!document.getElementById('chatLog')) return;
        if (!window.AIRPG_CHAT) {
            if (attempt >= 100) throw new Error('The chat controller did not initialize for Story Authoring.');
            window.setTimeout(() => boot(attempt + 1), 100);
            return;
        }
        window.AIRPG_STORY_AUTHORING = new StoryAuthoringRunner(window.AIRPG_CHAT);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot());
    else boot();
}());
