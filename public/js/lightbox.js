(function () {
    const lightbox = document.getElementById('imageLightbox');
    if (!lightbox) {
        return;
    }

    const lightboxInner = lightbox.querySelector('.image-lightbox__inner');
    const mediaEl = document.getElementById('imageLightboxMedia');
    const imageEl = document.getElementById('imageLightboxImage');
    const captionEl = document.getElementById('imageLightboxCaption');
    const detailsEl = document.getElementById('imageLightboxDetails');
    const actionsEl = document.getElementById('imageLightboxActions');
    const closeButton = document.getElementById('imageLightboxClose');

    let activeTrigger = null;
    let keyboardListener = null;
    let showSequence = 0;

    const hideLightbox = () => {
        showSequence += 1;
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

        if (activeTrigger && typeof activeTrigger.focus === 'function') {
            activeTrigger.focus({ preventScroll: true });
        }
        activeTrigger = null;
    };

    const handleKeyPress = (event) => {
        if (!event || event.type !== 'keydown') {
            return;
        }

        if (event.key === 'Tab') {
            return;
        }
        if (
            (event.key === 'Enter' || event.key === ' ')
            && event.target instanceof Element
            && event.target.closest('button, a, input, select, textarea')
        ) {
            return;
        }

        // Any keypress should dismiss the lightbox per requirements.
        event.preventDefault();
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

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                if (action.closeBeforeRun) {
                    hideLightbox();
                }
                try {
                    await action.handler({ action, button, hide: hideLightbox });
                    if (!action.closeBeforeRun && action.closeOnSuccess) {
                        hideLightbox();
                    }
                } catch (error) {
                    console.error(`Lightbox action "${action.id}" failed:`, error);
                    window.alert(error?.message || `Failed to ${action.label.toLowerCase()}.`);
                    if (!action.closeBeforeRun && button.isConnected) {
                        button.disabled = false;
                        button.removeAttribute('aria-busy');
                    }
                }
            });
            actionsEl.appendChild(button);
        });
        actionsEl.removeAttribute('hidden');
    };

    const showLightbox = ({ src, alt, caption, trigger, detailsHtml, actions } = {}) => {
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

        requestAnimationFrame(() => {
            if (currentShowSequence !== showSequence || lightbox.hasAttribute('hidden')) {
                return;
            }
            if (lightboxInner) {
                lightboxInner.scrollTop = 0;
            }
            const focusedElement = document.activeElement;
            const focusAlreadyInside = focusedElement instanceof Element
                && focusedElement !== lightbox
                && lightbox.contains(focusedElement);
            if (!focusAlreadyInside) {
                lightbox.focus({ preventScroll: true });
            }
        });
    };

    lightbox.addEventListener('click', () => hideLightbox());
    if (lightboxInner) {
        lightboxInner.addEventListener('click', (event) => {
            event.stopPropagation();
            if (event.target === lightboxInner) {
                hideLightbox();
                return;
            }
        });
    }
    if (mediaEl) {
        mediaEl.addEventListener('click', () => hideLightbox());
    }
    if (detailsEl) {
        detailsEl.addEventListener('click', () => hideLightbox());
    }
    if (closeButton) {
        closeButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            hideLightbox();
        });
    }

    window.lightboxController = {
        show: showLightbox,
        hide: hideLightbox,
        bind(element, getData) {
            if (!element) {
                return;
            }

            element.__airpgLightboxDataProvider = getData;
            element.classList.add('image-lightbox-trigger');

            if (element.dataset.lightboxBound === 'true') {
                return;
            }

            element.dataset.lightboxBound = 'true';

            element.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();

                const provider = element.__airpgLightboxDataProvider;
                const data = typeof provider === 'function' ? provider(element, event) : provider;
                const src = data && data.src ? data.src : element.dataset.lightboxImage;
                const detailsHtml = typeof data?.detailsHtml === 'string' ? data.detailsHtml : '';
                if (!src && !detailsHtml) {
                    return;
                }

                showLightbox({
                    src,
                    alt: data?.alt || element.dataset.lightboxAlt || '',
                    caption: data?.caption || element.dataset.lightboxCaption || '',
                    detailsHtml,
                    actions: data?.actions,
                    trigger: element
                });
            });
        }
    };
})();
