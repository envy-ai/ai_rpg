(function () {
    const lightbox = document.getElementById('imageLightbox');
    if (!lightbox) {
        return;
    }

    const lightboxInner = lightbox.querySelector('.image-lightbox__inner');
    const imageEl = document.getElementById('imageLightboxImage');
    const captionEl = document.getElementById('imageLightboxCaption');

    let activeTrigger = null;
    let keyboardListener = null;

    const hideLightbox = () => {
        if (keyboardListener) {
            document.removeEventListener('keydown', keyboardListener);
            keyboardListener = null;
        }

        lightbox.setAttribute('hidden', '');
        lightbox.setAttribute('aria-hidden', 'true');

        if (imageEl) {
            imageEl.removeAttribute('src');
        }

        if (captionEl) {
            captionEl.textContent = '';
            captionEl.setAttribute('hidden', '');
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

    const showLightbox = ({ src, alt, caption, trigger } = {}) => {
        if (!src || !imageEl) {
            return;
        }

        imageEl.setAttribute('src', src);
        imageEl.setAttribute('alt', alt || 'Preview image');

        if (caption && captionEl) {
            captionEl.textContent = caption;
            captionEl.removeAttribute('hidden');
        } else if (captionEl) {
            captionEl.textContent = '';
            captionEl.setAttribute('hidden', '');
        }

        lightbox.removeAttribute('hidden');
        lightbox.setAttribute('aria-hidden', 'false');

        activeTrigger = trigger || null;

        if (!keyboardListener) {
            keyboardListener = (event) => handleKeyPress(event);
            document.addEventListener('keydown', keyboardListener, { passive: false });
        }

        requestAnimationFrame(() => {
            lightbox.focus({ preventScroll: true });
        });
    };

    lightbox.addEventListener('click', () => hideLightbox());
    if (lightboxInner) {
        lightboxInner.addEventListener('click', (event) => {
            event.stopPropagation();
        });
    }

    window.lightboxController = {
        show: showLightbox,
        hide: hideLightbox,
        bind(element, getData) {
            if (!element) {
                return;
            }

            if (element.dataset.lightboxBound === 'true') {
                return;
            }

            element.dataset.lightboxBound = 'true';
            element.classList.add('image-lightbox-trigger');

            element.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();

                const data = typeof getData === 'function' ? getData(element, event) : getData;
                const src = data && data.src ? data.src : element.dataset.lightboxImage;
                if (!src) {
                    return;
                }

                showLightbox({
                    src,
                    alt: data?.alt || element.dataset.lightboxAlt || '',
                    caption: data?.caption || element.dataset.lightboxCaption || '',
                    trigger: element
                });
            });
        }
    };
})();
