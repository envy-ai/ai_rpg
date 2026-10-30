(() => {
    'use strict';
    // Shared by Play's live viewers and terminal failures on every app page.
    class PromptWindows {
        constructor() {
            this.promptFailureWindows = new Map();
            this.promptFailureEventIds = new Set();
            this.windowCounter = 0;
        }

        nextStackOffset(spacing = 24) {
            this.windowCounter += 1;
            return ((this.windowCounter - 1) % 6) * spacing;
        }

        bindPanelDragInteractions(panel, header, {
            dragState,
            shouldIgnorePointerDown = null,
            extraMoveGuard = null,
            onDragStart = null,
            onDragMove = null,
            onDragEnd = null
        } = {}) {
            if (!panel || !header || !dragState || panel.dataset.dragBound === 'true') {
                return;
            }

            const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

            const onPointerMove = (event) => {
                if (!dragState.active || event.pointerId !== dragState.pointerId) {
                    return;
                }
                if (extraMoveGuard && extraMoveGuard(event)) {
                    return;
                }
                const rect = panel.getBoundingClientRect();
                const maxLeft = Math.max(0, window.innerWidth - rect.width);
                const maxTop = Math.max(0, window.innerHeight - rect.height);
                const left = clamp(event.clientX - dragState.offsetX, 0, maxLeft);
                const top = clamp(event.clientY - dragState.offsetY, 0, maxTop);
                panel.style.left = `${left}px`;
                panel.style.top = `${top}px`;
                panel.style.right = 'auto';
                if (onDragMove) {
                    onDragMove(panel);
                }
                panel.classList.add('is-dragging');
            };

            const stopDragging = (event) => {
                if (!dragState.active) {
                    return;
                }
                if (event && event.pointerId !== undefined && event.pointerId !== dragState.pointerId) {
                    return;
                }
                dragState.active = false;
                dragState.pointerId = null;
                if (onDragEnd) {
                    onDragEnd();
                }
                panel.classList.remove('is-dragging');
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', stopDragging);
                window.removeEventListener('pointercancel', stopDragging);
            };

            header.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) {
                    return;
                }
                if (shouldIgnorePointerDown && shouldIgnorePointerDown(event)) {
                    return;
                }
                const rect = panel.getBoundingClientRect();
                dragState.active = true;
                dragState.pointerId = event.pointerId;
                if (onDragStart) {
                    onDragStart(panel, event);
                }
                dragState.offsetX = event.clientX - rect.left;
                dragState.offsetY = event.clientY - rect.top;
                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', stopDragging);
                window.addEventListener('pointercancel', stopDragging);
                event.preventDefault();
            });

            panel.dataset.dragBound = 'true';
        }


        getPromptProgressSafeTopOffsetPx() {
            const SAFE_MARGIN = 12;
            let maxBottom = SAFE_MARGIN;
            const candidates = [
                document.querySelector('.app-header') || document.querySelector('.header'),
                document.querySelector('.tab-bar')
            ];

            for (const element of candidates) {
                if (!element) {
                    continue;
                }
                const rect = element.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) {
                    continue;
                }
                maxBottom = Math.max(maxBottom, Math.ceil(rect.bottom) + SAFE_MARGIN);
            }

            const maxTop = Math.max(SAFE_MARGIN, window.innerHeight - 180);
            return Math.min(maxBottom, maxTop);
        }


        applyPromptProgressViewerAutoAnchor(viewer) {
            if (!viewer || viewer.dataset.autoAnchored === 'false') {
                return;
            }
            const stackOffset = Number(viewer.dataset.stackOffset || 0);
            const safeStackOffset = Number.isFinite(stackOffset) ? stackOffset : 0;
            viewer.style.left = 'auto';
            viewer.style.right = window.innerWidth <= 900 ? '10px' : `${16 + safeStackOffset}px`;
            viewer.style.top = `${this.getPromptProgressSafeTopOffsetPx() + safeStackOffset}px`;
            viewer.dataset.autoAnchored = 'true';
        }


        createPromptViewerShell({ viewerState, ariaLabel, onClose }) {
            const viewer = document.createElement('aside');
            viewer.className = 'prompt-progress-viewer';
            viewer.setAttribute('role', 'dialog');
            viewer.setAttribute('aria-modal', 'false');
            viewer.setAttribute('aria-live', 'polite');
            viewer.setAttribute('aria-label', ariaLabel);
            viewer.tabIndex = 0;
            viewer.dataset.autoAnchored = 'true';
            viewer.dataset.viewerId = viewerState.id;
            viewer.dataset.stackOffset = String(viewerState.stackOffset || 0);
            const header = document.createElement('div');
            header.className = 'prompt-progress-viewer__header';
            const meta = document.createElement('div');
            meta.className = 'prompt-progress-viewer__meta';
            const title = document.createElement('div');
            title.className = 'prompt-progress-viewer__title';
            const subtitle = document.createElement('div');
            subtitle.className = 'prompt-progress-viewer__subtitle';
            const actions = document.createElement('div');
            actions.className = 'prompt-progress-viewer__actions';
            const closeButton = document.createElement('button');
            closeButton.type = 'button';
            closeButton.className = 'prompt-progress-viewer__close';
            closeButton.textContent = '×';
            closeButton.title = 'Close window (Escape while focused)';
            closeButton.setAttribute('aria-label', `Close ${ariaLabel}`);
            closeButton.addEventListener('click', onClose);
            actions.appendChild(closeButton);
            meta.append(title, subtitle);
            header.append(meta, actions);
            const content = document.createElement('div');
            content.className = 'prompt-progress-viewer__content';
            viewer.append(header, content);
            viewer.addEventListener('keydown', event => {
                if (event.key === 'Escape' && viewer.contains(document.activeElement)) {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                }
            });
            const raiseWindow = () => {
                this.promptViewerLayer = (this.promptViewerLayer || 11110) + 1;
                viewer.style.zIndex = String(this.promptViewerLayer);
            };
            viewer.addEventListener('pointerdown', raiseWindow);
            viewer.addEventListener('focusin', raiseWindow);
            raiseWindow();
            this.bindPanelDragInteractions(viewer, header, {
                dragState: { active: false, pointerId: null, offsetX: 0, offsetY: 0 },
                shouldIgnorePointerDown: event => Boolean(event.target?.closest('.prompt-progress-viewer__actions')),
                onDragStart: panel => { panel.dataset.autoAnchored = 'false'; },
                onDragMove: panel => { panel.dataset.autoAnchored = 'false'; }
            });
            viewerState.element = viewer;
            return { viewer, header, title, subtitle, actions, closeButton, content };
        }


        showFailure(payload) {
            if (!payload || typeof payload.id !== 'string' || !payload.id
                || typeof payload.metadataLabel !== 'string' || typeof payload.message !== 'string') {
                throw new Error('Invalid prompt_failed payload.');
            }
            if (this.promptFailureEventIds.has(payload.id)) return this.promptFailureWindows.get(payload.id)?.element || null;
            this.promptFailureEventIds.add(payload.id);
            const viewerState = {
                id: `prompt-failure-${payload.id}`,
                stackOffset: this.nextStackOffset(40),
                element: null
            };
            const { viewer, title, subtitle, content } = this.createPromptViewerShell({
                viewerState,
                ariaLabel: `Failed prompt: ${payload.metadataLabel}`,
                onClose: () => {
                    viewerState.element.remove();
                    this.promptFailureWindows.delete(payload.id);
                }
            });
            viewer.classList.add('prompt-failure-viewer');
            viewer.dataset.failureId = payload.id;
            title.textContent = 'Prompt failed';
            subtitle.textContent = payload.metadataLabel;
            const reason = document.createElement('p');
            reason.className = 'prompt-failure-viewer__reason';
            reason.textContent = payload.message;
            content.appendChild(reason);

            const counts = document.createElement('dl');
            counts.className = 'prompt-failure-viewer__counts';
            const addCount = (label, value) => {
                const item = document.createElement('div');
                const term = document.createElement('dt');
                const description = document.createElement('dd');
                term.textContent = label;
                description.textContent = value;
                item.append(term, description);
                counts.appendChild(item);
            };
            for (const [field, label] of [['attempted', 'Tool calls attempted'], ['executed', 'Executed'], ['denied', 'Denied']]) {
                addCount(label, Number.isInteger(payload.toolCalls?.[field]) ? String(payload.toolCalls[field]) : 'Not recorded');
            }
            if (Number.isInteger(payload.toolCalls?.limit)) {
                addCount('Tool limit', `${payload.toolCalls.limit} ${payload.toolCalls.limitUnit || 'calls'}`);
            }
            if (Number.isInteger(payload.toolCalls?.cached) && payload.toolCalls.cached > 0) {
                addCount('Cached results', String(payload.toolCalls.cached));
            }
            content.appendChild(counts);
            const attempts = [];
            if (Number.isInteger(payload.transportAttempts)) attempts.push(`Model attempts: ${payload.transportAttempts}`);
            if (Number.isInteger(payload.validationRetries) && payload.validationRetries > 0) attempts.push(`Validation retries: ${payload.validationRetries}`);
            if (attempts.length) {
                const attemptText = document.createElement('p');
                attemptText.className = 'prompt-failure-viewer__attempts';
                attemptText.textContent = attempts.join(' · ');
                content.appendChild(attemptText);
            }
            if (typeof payload.stack === 'string' && payload.stack) {
                const details = document.createElement('details');
                details.className = 'prompt-failure-viewer__details';
                const summary = document.createElement('summary');
                summary.textContent = 'Details / stack trace';
                const stack = document.createElement('pre');
                stack.textContent = payload.stack;
                details.append(summary, stack);
                content.appendChild(details);
            }
            this.promptFailureWindows.set(payload.id, viewerState);
            this.applyPromptProgressViewerAutoAnchor(viewer);
            document.body.appendChild(viewer);
            return viewer;
        }

    }
    window.AIRPG_PROMPT_WINDOWS = new PromptWindows();
})();
