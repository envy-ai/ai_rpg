import { nativeDialogOwnsKeys, trapFocus } from './overlay-context.js';

/** Explicit custom-modal ownership with injected dismissal/focus/async policies. */
export class ModalStack {
    constructor({ document = globalThis.document, lockTarget = document?.body, lockClass = 'modal-open', resolveTop = roots => roots[roots.length - 1] || null } = {}) {
        if (!document?.defaultView || !lockTarget?.classList) throw new TypeError('ModalStack requires a browser document and scroll-lock target.');
        Object.assign(this, { document, lockTarget, lockClass, resolveTop });
        this.entries = new Map();
        this.locks = new Set();
        this.order = [];
        this.destroyed = false;
        this.listeners = new document.defaultView.AbortController();
        document.addEventListener('keydown', event => {
            if (event.defaultPrevented || !['Escape', 'Tab'].includes(event.key)) return;
            const root = this.top;
            if (!root || nativeDialogOwnsKeys(document, root)) return;
            const entry = this.entries.get(root);
            if (event.key === 'Escape' && entry.escape !== 'ignore') {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (entry.escape === 'dismiss') this.requestDismiss(root, { reason: 'escape' });
            } else if (event.key === 'Tab' && entry.trapFocus) {
                event.stopImmediatePropagation();
                this.trapRootFocus(root, event);
            }
        }, { signal: this.listeners.signal });
    }

    assertAlive() {
        if (this.destroyed) throw new Error('ModalStack has been destroyed. Create a new owner before registering modals.');
    }

    register(root, { backdrop = null, lockScroll = true } = {}) {
        this.assertAlive();
        const view = this.document.defaultView;
        if (!(root instanceof view.HTMLElement) || root.ownerDocument !== this.document || root instanceof view.HTMLDialogElement) throw new TypeError('ModalStack requires a custom HTML modal in its document. Native dialogs use NativeDialog.');
        if (backdrop && (!(backdrop instanceof view.HTMLElement) || backdrop.ownerDocument !== this.document)) throw new TypeError('ModalStack backdrop must belong to its document.');
        if (this.entries.has(root)) return this;
        const entry = {
            backdrop, lockScroll, onDismiss: null, canDismiss: () => true,
            escape: 'ignore', trapFocus: false, focusables: null, dismissOnBackdrop: false,
            pending: false, focus: null, listeners: new view.AbortController()
        };
        this.entries.set(root, entry);
        root.addEventListener('click', event => {
            if (entry.dismissOnBackdrop && event.target === root) this.requestDismiss(root, { reason: 'backdrop' });
        }, { signal: entry.listeners.signal });
        this.sync();
        return this;
    }

    setVisible(root, visible) {
        this.assertAlive();
        if (!this.entries.has(root)) throw new Error(`ModalStack has no registration for "${root?.id || root?.className || 'unknown modal'}". Register it before changing visibility.`);
        if (typeof visible !== 'boolean') throw new TypeError('ModalStack visibility must be a boolean.');
        root.hidden = !visible;
        root.setAttribute('aria-hidden', String(!visible));
        this.order = this.order.filter(entry => entry !== root);
        if (visible) this.order.push(root);
        this.sync();
    }

    configure(root, options = {}) {
        this.assertAlive();
        const entry = this.entries.get(root);
        if (!entry) throw new Error('ModalStack.configure requires a registered root.');
        for (const key of ['onDismiss', 'canDismiss', 'focusables']) {
            if (options[key] !== undefined && options[key] !== null && typeof options[key] !== 'function') throw new TypeError(`ModalStack ${key} must be a function or null.`);
        }
        if (options.escape !== undefined && !['ignore', 'block', 'dismiss'].includes(options.escape)) throw new TypeError('ModalStack escape must be ignore, block or dismiss.');
        for (const key of ['trapFocus', 'dismissOnBackdrop']) if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new TypeError(`ModalStack ${key} must be a boolean.`);
        for (const key of ['onDismiss', 'canDismiss', 'escape', 'trapFocus', 'focusables', 'dismissOnBackdrop']) if (options[key] !== undefined) entry[key] = options[key];
        if (options.onDismiss !== undefined && options.escape === undefined) entry.escape = typeof options.onDismiss === 'function' ? 'dismiss' : 'ignore';
        return this;
    }

    requestDismiss(root, { reason = 'api' } = {}) {
        this.assertAlive();
        const entry = this.entries.get(root);
        if (!entry) throw new Error('ModalStack.requestDismiss requires a registered root.');
        const request = { root, reason };
        if (root.hidden || this.top !== root || nativeDialogOwnsKeys(this.document, root) || entry.pending || entry.escape === 'block' || entry.canDismiss?.(request) === false) return false;
        if (entry.onDismiss) return entry.onDismiss(request) !== false;
        this.setVisible(root, false);
        return true;
    }

    setPending(root, pending) {
        this.assertAlive();
        const entry = this.entries.get(root);
        if (!entry || typeof pending !== 'boolean') throw new TypeError('ModalStack.setPending requires a registered root and boolean.');
        entry.pending = pending;
        root.setAttribute('aria-busy', String(pending));
    }

    rememberFocus(root, target = this.document.activeElement) {
        this.assertAlive();
        const entry = this.entries.get(root);
        if (!entry) throw new Error('ModalStack.rememberFocus requires a registered root.');
        entry.focus = target ? { element: target, id: target.id } : null;
    }

    restoreFocus(root, { target, onlyIfInside = false } = {}) {
        this.assertAlive();
        const entry = this.entries.get(root);
        if (!entry) throw new Error('ModalStack.restoreFocus requires a registered root.');
        const candidate = typeof target === 'function' ? target() : target;
        const record = target === undefined ? entry.focus : candidate ? { element: candidate, id: candidate.id } : null;
        entry.focus = null;
        if (onlyIfInside && !root.contains(this.document.activeElement)) return false;
        const element = record?.element?.isConnected ? record.element : record?.id ? this.document.getElementById(record.id) : null;
        if (!element?.focus) return false;
        element.focus();
        return true;
    }

    trapRootFocus(root, event) {
        const entry = this.entries.get(root);
        const controls = entry.focusables ? entry.focusables() : [...root.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]')].filter(element => {
            if (element.matches(':disabled') || element.tabIndex < 0 || element.closest('[hidden]') || !element.getClientRects().length) return false;
            const visibility = this.document.defaultView.getComputedStyle(element).visibility;
            return visibility !== 'hidden' && visibility !== 'collapse';
        });
        trapFocus(event, { document: this.document, controls });
    }

    setLock(owner, locked) {
        this.assertAlive();
        if (typeof owner !== 'string' || !owner.trim() || typeof locked !== 'boolean') throw new TypeError('ModalStack.setLock requires an owner name and boolean state.');
        if (locked) this.locks.add(owner);
        else this.locks.delete(owner);
        this.sync();
    }

    sync() {
        this.assertAlive();
        const backdrops = new Map();
        let locked = this.locks.size > 0;
        this.order = this.order.filter(root => this.entries.has(root) && !root.hidden);
        for (const [root, entry] of this.entries) {
            const visible = !root.hidden;
            if (visible && !this.order.includes(root)) this.order.push(root);
            if (entry.backdrop) backdrops.set(entry.backdrop, Boolean(backdrops.get(entry.backdrop) || visible));
            locked ||= visible && entry.lockScroll;
        }
        for (const [backdrop, visible] of backdrops) backdrop.hidden = !visible;
        this.lockTarget.classList.toggle(this.lockClass, locked);
    }

    get top() { this.assertAlive(); return this.resolveTop(this.order.filter(root => !root.hidden)); }

    unregister(root) {
        this.assertAlive();
        if (!this.entries.has(root)) return;
        this.setVisible(root, false);
        this.entries.get(root).listeners.abort();
        this.entries.delete(root);
        this.sync();
    }

    destroy() {
        if (this.destroyed) return;
        this.listeners.abort();
        for (const [root, entry] of this.entries) { root.hidden = true; root.setAttribute('aria-hidden', 'true'); entry.listeners.abort(); }
        this.locks.clear();
        this.sync();
        this.entries.clear();
        this.order = [];
        this.document = this.lockTarget = this.resolveTop = this.listeners = null;
        this.destroyed = true;
    }
}
