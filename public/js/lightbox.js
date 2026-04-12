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

    let activeTrigger = null;
    let keyboardListener = null;

    const hideLightbox = () => {
        if (keyboardListener) {
            document.removeEventListener('keydown', keyboardListener);
            keyboardListener = null;
        }

        lightbox.setAttribute('hidden', '');
        lightbox.setAttribute('aria-hidden', 'true');
        lightbox.classList.remove('image-lightbox--details', 'image-lightbox--details-only');

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

        // Any keypress should dismiss the lightbox per requirements.
        event.preventDefault();
        hideLightbox();
    };

    const showLightbox = ({ src, alt, caption, trigger, detailsHtml } = {}) => {
        const hasSource = Boolean(src && imageEl);
        const hasDetails = typeof detailsHtml === 'string' && detailsHtml.trim().length > 0;

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

        lightbox.removeAttribute('hidden');
        lightbox.setAttribute('aria-hidden', 'false');

        activeTrigger = trigger || null;

        if (!keyboardListener) {
            keyboardListener = (event) => handleKeyPress(event);
            document.addEventListener('keydown', keyboardListener, { passive: false });
        }

        requestAnimationFrame(() => {
            if (lightboxInner) {
                lightboxInner.scrollTop = 0;
            }
            lightbox.focus({ preventScroll: true });
        });
    };

    lightbox.addEventListener('click', () => hideLightbox());
    if (lightboxInner) {
        lightboxInner.addEventListener('click', (event) => {
            event.stopPropagation();
        });
    }
    if (mediaEl) {
        mediaEl.addEventListener('click', () => hideLightbox());
    }
    if (detailsEl) {
        detailsEl.addEventListener('click', () => hideLightbox());
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
                    trigger: element
                });
            });
        }
    };
})();
