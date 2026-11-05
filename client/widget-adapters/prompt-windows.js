import { PointerDrag, FloatingWindow } from '../../packages/ui-widgets/src/index.js';

(() => {
    'use strict';
    // Shared by Play's live viewers and terminal failures on every app page.
    class PromptWindows {
        constructor() {
            this.promptFailureWindows = new Map();
            this.promptFailureEventIds = new Set();
            this.windowCounter = 0;
            this.dragControllers = new WeakMap();
            this.windowControllers = new WeakMap();
        }

        nextStackOffset(spacing = 24) {
            this.windowCounter += 1;
            return ((this.windowCounter - 1) % 6) * spacing;
        }

        bindPanelDragInteractions(panel, header, options = {}) {
            if (!panel || !header || !options.dragState) return;
            const previous = this.dragControllers.get(panel);
            if (previous && !previous.destroyed) return previous;
            const controller = new PointerDrag(panel, header, options);
            this.dragControllers.set(panel, controller);
            return controller;
        }

        nextWindowLayer() {
            this.promptViewerLayer = (this.promptViewerLayer || 11110) + 1;
            return this.promptViewerLayer;
        }

        adoptFloatingWindow(viewer, options) {
            const instance = new FloatingWindow(viewer, { ...options, nextLayer: () => this.nextWindowLayer() });
            this.windowControllers.set(viewer, instance);
            return instance;
        }

        destroyViewer(viewer) {
            if (!viewer) return;
            this.windowControllers.get(viewer)?.destroy();
            this.dragControllers.get(viewer)?.destroy();
            this.windowControllers.delete(viewer);
            this.dragControllers.delete(viewer);
            viewer.remove();
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
            const instance = FloatingWindow.create({
                document, ariaLabel, onClose,
                nextLayer: () => this.nextWindowLayer(),
                drag: {
                    shouldIgnorePointerDown: event => Boolean(event.target?.closest('.prompt-progress-viewer__actions')),
                    onDragStart: panel => { panel.dataset.autoAnchored = 'false'; },
                    onDragMove: panel => { panel.dataset.autoAnchored = 'false'; }
                }
            });
            const { root: viewer, header, meta, title, subtitle, actions, closeButton, content } = instance.elements;
            for (const [element, part] of [[header, 'header'], [meta, 'meta'], [title, 'title'], [subtitle, 'subtitle'], [actions, 'actions'], [closeButton, 'close'], [content, 'content']]) {
                element.classList.add(`prompt-progress-viewer__${part}`);
            }
            viewer.classList.add('prompt-progress-viewer');
            viewer.dataset.autoAnchored = 'true';
            viewer.dataset.viewerId = viewerState.id;
            viewer.dataset.stackOffset = String(viewerState.stackOffset || 0);
            this.windowControllers.set(viewer, instance);
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
                    this.destroyViewer(viewerState.element);
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
