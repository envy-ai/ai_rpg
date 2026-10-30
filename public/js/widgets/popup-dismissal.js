(() => {
    'use strict';
    const bindings = new WeakMap();
    let active = null;
    const detachObserver = new MutationObserver(() => {
        if (active && !active.root.isConnected) close(active);
    });

    function close(entry, { restoreFocus = false } = {}) {
        entry.root.open = false;
        if (active === entry) {
            active = null;
            detachObserver.disconnect();
        }
        if (restoreFocus && entry.trigger.isConnected) entry.trigger.focus({ preventScroll: true });
    }

    function activate(entry) {
        if (!entry.root.open || !entry.root.isConnected) return;
        if (active && active !== entry) close(active);
        active = entry;
        detachObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function current() {
        if (active?.root.isConnected && active.root.open) return active;
        if (active) close(active);
        // Native toggle events are queued. A click/keydown can arrive before one
        // when a host opens its details programmatically in the same task.
        for (const root of document.querySelectorAll('details[data-popup-dismissal][open]')) {
            const entry = bindings.get(root);
            if (entry) activate(entry);
        }
        return active;
    }

    function inside(event, root) {
        return event.composedPath().includes(root);
    }

    function outside(event) {
        const entry = current();
        if (entry && !inside(event, entry.root)) close(entry);
    }
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('click', event => {
        const entry = current();
        if (!entry) return;
        if (!inside(event, entry.root)) { close(entry); return; }
        const action = event.target instanceof Element ? event.target.closest('button, a[href], [data-popup-dismiss]') : null;
        if (action && entry.root.contains(action) && !entry.trigger.contains(action)) {
            // Close and restore focus synchronously, before any action handler can
            // open another dialog. Never schedule focus work after the callback.
            close(entry, { restoreFocus: entry.root.contains(document.activeElement) });
        }
    }, true);
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        const entry = current();
        if (!entry) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        close(entry, { restoreFocus: true });
    }, true);

    function bind(root, { trigger = root?.querySelector(':scope > summary') } = {}) {
        if (!(root instanceof HTMLDetailsElement) || trigger?.tagName !== 'SUMMARY' || trigger.parentElement !== root) throw new TypeError('PopupDismissal requires native details and its summary trigger.');
        const previous = bindings.get(root);
        if (previous) return previous.controller;
        const entry = { root, trigger };
        const sync = () => {
            if (root.open) activate(entry);
            else if (active === entry) close(entry);
        };
        const afterActivation = () => queueMicrotask(() => { if (bindings.get(root) === entry) sync(); });
        root.dataset.popupDismissal = 'true';
        root.addEventListener('toggle', sync);
        trigger.addEventListener('click', afterActivation);
        const controller = {
            close: options => close(entry, options),
            destroy() {
                close(entry);
                root.removeEventListener('toggle', sync);
                trigger.removeEventListener('click', afterActivation);
                delete root.dataset.popupDismissal;
                bindings.delete(root);
            }
        };
        entry.controller = controller;
        bindings.set(root, entry);
        sync();
        return controller;
    }
    window.AIRPG_WIDGETS = window.AIRPG_WIDGETS || {};
    window.AIRPG_WIDGETS.PopupDismissal = { bind };
})();
