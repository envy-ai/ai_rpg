(function () {
    const root = document.getElementById('imageLightbox');
    if (!root) return;
    const stack = window.AIRPG_MODAL_STACK;
    const controller = new window.AIRPG_WIDGETS.Lightbox(root, {
        inner: root.querySelector('.image-lightbox__inner'),
        media: document.getElementById('imageLightboxMedia'),
        image: document.getElementById('imageLightboxImage'),
        caption: document.getElementById('imageLightboxCaption'),
        details: document.getElementById('imageLightboxDetails'),
        actions: document.getElementById('imageLightboxActions'),
        closeButton: document.getElementById('imageLightboxClose'),
        canHandleKeys: () => !stack.top || stack.resolveTop([stack.top, root]) === root,
        onError: (error, { action, button }) => {
            console.error(`Lightbox action "${action.id}" failed:`, error);
            window.AIRPG_PAGE_FEEDBACK.showError(error, { returnFocus: button.isConnected ? button : document.activeElement });
        }
    });
    window.lightboxController = controller;
    const dispose = event => {
        if (event.persisted) return;
        window.removeEventListener('pagehide', dispose);
        controller.destroy();
    };
    window.addEventListener('pagehide', dispose);
})();
