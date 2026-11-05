import { nativeDialogOwnsKeys } from './overlay-context.js';

/** Adopt an image/details viewer; providers, requests and error presentation stay injected. */
export class Lightbox {
    constructor(root, { inner = null, media = null, image = null, caption = null, details = null, actions = null, closeButton = null, onError = error => { throw error; }, canHandleKeys = () => true } = {}) {
        let view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement)) throw new TypeError('Lightbox requires an HTML root.');
        for (const element of [inner, media, image, caption, details, actions, closeButton]) {
            if (element && (!(element instanceof view.HTMLElement) || !root.contains(element))) throw new TypeError('Lightbox elements must be HTML descendants of its root.');
        }
        let document = root.ownerDocument;
        let lightbox = root;
        let lightboxInner = inner, mediaEl = media, imageEl = image, captionEl = caption, detailsEl = details, actionsEl = actions;
        let activeTrigger = null;
        let keyboardListener = null;
        let showSequence = 0;
        let actionListeners = null;
        let destroyed = false;
        const listeners = new view.AbortController();
        const bindings = new WeakMap();
        const bindingRefs = new Set();
        const assertAlive = () => { if (destroyed) throw new Error('Lightbox has been destroyed. Create a new owner before showing media.'); };

        const hideLightbox = () => {
            showSequence += 1;
            actionListeners?.abort();
            actionListeners = null;
            if (keyboardListener) {
                document.removeEventListener('keydown', keyboardListener);
                keyboardListener = null;
            }

            lightbox.setAttribute('hidden', '');
            lightbox.setAttribute('aria-hidden', 'true');
            lightbox.classList.remove('image-lightbox--details', 'image-lightbox--details-only', 'image-lightbox--actions');

            if (actionsEl) {
                actionsEl.replaceChildren();
                actionsEl.setAttribute('hidden', '');
            }

            if (imageEl) {
                imageEl.removeAttribute('src');
                imageEl.setAttribute('hidden', '');
            }

            if (captionEl) {
                captionEl.textContent = '';
                captionEl.setAttribute('hidden', '');
            }

            if (mediaEl) {
                mediaEl.removeAttribute('hidden');
            }

            if (detailsEl) {
                detailsEl.innerHTML = '';
                detailsEl.setAttribute('hidden', '');
                detailsEl.scrollTop = 0;
            }

            if (lightboxInner) {
                lightboxInner.scrollTop = 0;
            }

            const trigger = activeTrigger;
            activeTrigger = null;
            if (trigger && typeof trigger.focus === 'function') trigger.focus({ preventScroll: true });
        };

        const handleKeyPress = (event) => {
            if (!event || event.type !== 'keydown') {
                return;
            }

            if (event.defaultPrevented || nativeDialogOwnsKeys(document, lightbox) || !canHandleKeys(event)) return;

            if (event.key === 'Tab') {
                return;
            }
            if (
                (event.key === 'Enter' || event.key === ' ')
                && event.target instanceof view.Element
                && event.target.closest('button, a, input, select, textarea')
            ) {
                return;
            }

            // Any keypress should dismiss the lightbox per requirements.
            event.preventDefault();
            event.stopImmediatePropagation();
            hideLightbox();
        };

        const normalizeActions = (actions) => {
            if (actions === null || actions === undefined) {
                return [];
            }
            if (!Array.isArray(actions)) {
                throw new Error('Lightbox actions must be an array.');
            }
            return actions.map((action, index) => {
                if (!action || typeof action !== 'object') {
                    throw new Error(`Lightbox action at index ${index} must be an object.`);
                }
                const id = typeof action.id === 'string' ? action.id.trim() : '';
                const label = typeof action.label === 'string' ? action.label.trim() : '';
                if (!id || !label || typeof action.handler !== 'function') {
                    throw new Error(`Lightbox action at index ${index} requires id, label, and handler.`);
                }
                return {
                    ...action,
                    id,
                    label,
                    disabled: Boolean(action.disabled),
                    closeBeforeRun: Boolean(action.closeBeforeRun),
                    closeOnSuccess: action.closeOnSuccess !== false
                };
            });
        };

        const renderActions = (actions) => {
            actionListeners?.abort();
            actionListeners = new view.AbortController();
            if (!actionsEl) {
                if (actions.length) {
                    throw new Error('Lightbox action container is unavailable.');
                }
                return;
            }

            actionsEl.replaceChildren();
            if (!actions.length) {
                actionsEl.setAttribute('hidden', '');
                return;
            }

            actions.forEach(action => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'image-lightbox__action';
                button.dataset.lightboxActionId = action.id;
                button.textContent = action.label;
                button.disabled = action.disabled;
                if (action.disabledReason) {
                    button.title = String(action.disabledReason);
                    button.setAttribute('aria-label', `${action.label}: ${action.disabledReason}`);
                }
                button.addEventListener('click', async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (button.disabled) {
                        return;
                    }

                    const actionSequence = showSequence;
                    const reportError = onError;
                    button.disabled = true;
                    button.setAttribute('aria-busy', 'true');
                    if (action.closeBeforeRun) {
                        hideLightbox();
                    }
                    try {
                        await action.handler({ action, button, hide: () => {
                            if (!destroyed && actionSequence === showSequence) hideLightbox();
                        } });
                        if (!destroyed && actionSequence === showSequence && !action.closeBeforeRun && action.closeOnSuccess) {
                            hideLightbox();
                        }
                    } catch (error) {
                        try { reportError(error, { action, button }); }
                        finally {
                            if (!action.closeBeforeRun && button.isConnected) {
                                button.disabled = false;
                                button.removeAttribute('aria-busy');
                            }
                        }
                    }
                }, { signal: actionListeners.signal });
                actionsEl.appendChild(button);
            });
            actionsEl.removeAttribute('hidden');
        };

        const showLightbox = ({ src, alt, caption, trigger, detailsHtml, actions } = {}) => {
            assertAlive();
            const hasSource = Boolean(src && imageEl);
            const hasDetails = typeof detailsHtml === 'string' && detailsHtml.trim().length > 0;
            const normalizedActions = normalizeActions(actions);

            if (!hasSource && !hasDetails) {
                return;
            }

            if (hasSource) {
                imageEl.setAttribute('src', src);
                imageEl.setAttribute('alt', alt || 'Preview image');
                imageEl.removeAttribute('hidden');
                mediaEl?.removeAttribute('hidden');
            } else if (imageEl) {
                imageEl.removeAttribute('src');
                imageEl.setAttribute('alt', alt || 'Preview image');
                imageEl.setAttribute('hidden', '');
                mediaEl?.setAttribute('hidden', '');
            }

            if (!hasDetails && caption && captionEl) {
                captionEl.textContent = caption;
                captionEl.removeAttribute('hidden');
            } else if (captionEl) {
                captionEl.textContent = '';
                captionEl.setAttribute('hidden', '');
            }

            if (detailsEl) {
                if (hasDetails) {
                    detailsEl.innerHTML = detailsHtml;
                    detailsEl.removeAttribute('hidden');
                    detailsEl.scrollTop = 0;
                } else {
                    detailsEl.innerHTML = '';
                    detailsEl.setAttribute('hidden', '');
                }
            }

            lightbox.classList.toggle('image-lightbox--details', hasDetails);
            lightbox.classList.toggle('image-lightbox--details-only', hasDetails && !hasSource);
            lightbox.classList.toggle('image-lightbox--actions', normalizedActions.length > 0);
            renderActions(normalizedActions);

            lightbox.removeAttribute('hidden');
            lightbox.setAttribute('aria-hidden', 'false');
            const currentShowSequence = ++showSequence;

            activeTrigger = trigger || null;

            if (!keyboardListener) {
                keyboardListener = (event) => handleKeyPress(event);
                document.addEventListener('keydown', keyboardListener, { passive: false });
            }

            view.requestAnimationFrame(() => {
                if (destroyed || currentShowSequence !== showSequence || lightbox.hasAttribute('hidden')) {
                    return;
                }
                if (lightboxInner) {
                    lightboxInner.scrollTop = 0;
                }
                const focusedElement = document.activeElement;
                const focusAlreadyInside = focusedElement instanceof view.Element
                    && focusedElement !== lightbox
                    && lightbox.contains(focusedElement);
                if (!focusAlreadyInside) {
                    lightbox.focus({ preventScroll: true });
                }
            });
        };

        lightbox.addEventListener('click', () => hideLightbox(), { signal: listeners.signal });
        if (lightboxInner) {
            lightboxInner.addEventListener('click', (event) => {
                event.stopPropagation();
                if (event.target === lightboxInner) {
                    hideLightbox();
                    return;
                }
            }, { signal: listeners.signal });
        }
        if (mediaEl) {
            mediaEl.addEventListener('click', () => hideLightbox(), { signal: listeners.signal });
        }
        if (detailsEl) {
            detailsEl.addEventListener('click', () => hideLightbox(), { signal: listeners.signal });
        }
        if (closeButton) {
            closeButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                hideLightbox();
            }, { signal: listeners.signal });
        }


        this.show = showLightbox;
        this.hide = () => { assertAlive(); hideLightbox(); };
        this.bind = (element, provider) => {
            assertAlive();
            if (!(element instanceof view.HTMLElement) || element.ownerDocument !== document) throw new TypeError('Lightbox.bind requires an HTML trigger in its document.');
            const previous = bindings.get(element);
            if (previous) { previous.provider = provider; return previous.controller; }
            const record = { provider, listeners: new view.AbortController(), ref: new WeakRef(element) };
            const controller = { destroy() {
                if (bindings.get(element) !== record) return;
                record.listeners.abort();
                bindings.delete(element);
                bindingRefs.delete(record.ref);
                delete element.dataset.lightboxBound;
                element.classList.remove('image-lightbox-trigger');
            } };
            record.controller = controller;
            bindings.set(element, record);
            bindingRefs.add(record.ref);
            element.classList.add('image-lightbox-trigger');
            element.dataset.lightboxBound = 'true';
            element.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const data = typeof record.provider === 'function' ? record.provider(element, event) : record.provider;
                const src = data?.src || element.dataset.lightboxImage;
                const detailsHtml = typeof data?.detailsHtml === 'string' ? data.detailsHtml : '';
                if (!src && !detailsHtml) return;
                showLightbox({ src, detailsHtml, alt: data?.alt || element.dataset.lightboxAlt || '', caption: data?.caption || element.dataset.lightboxCaption || '', actions: data?.actions, trigger: element });
            }, { signal: record.listeners.signal });
            return controller;
        };
        this.destroy = () => {
            if (destroyed) return;
            destroyed = true;
            try { hideLightbox(); }
            finally {
                listeners.abort();
                for (const ref of bindingRefs) { const element = ref.deref(); if (element) bindings.get(element)?.controller.destroy(); }
                bindingRefs.clear();
                lightbox = lightboxInner = mediaEl = imageEl = captionEl = detailsEl = actionsEl = document = null;
                root = inner = media = image = caption = details = actions = closeButton = onError = canHandleKeys = view = null;
            }
        };
        Object.defineProperty(this, 'isOpen', { get: () => { assertAlive(); return !lightbox.hidden; } });
    }
}
