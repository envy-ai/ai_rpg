/** Explicit custom-modal/backdrop ownership; owners retain dismissal and async policy. */
export class ModalStack {
    constructor({ document = globalThis.document, lockTarget = document?.body, lockClass = 'modal-open' } = {}) {
        if (!document?.defaultView || !lockTarget?.classList) throw new TypeError('ModalStack requires a browser document and scroll-lock target.');
        Object.assign(this, { document, lockTarget, lockClass });
        this.entries = new Map();
        this.locks = new Set();
        this.order = [];
        this.destroyed = false;
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
        this.entries.set(root, { backdrop, lockScroll });
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

    get top() { this.assertAlive(); return this.order[this.order.length - 1] || null; }

    unregister(root) {
        this.assertAlive();
        if (!this.entries.has(root)) return;
        this.setVisible(root, false);
        this.entries.delete(root);
        this.sync();
    }

    destroy() {
        if (this.destroyed) return;
        for (const root of this.entries.keys()) { root.hidden = true; root.setAttribute('aria-hidden', 'true'); }
        this.locks.clear();
        this.sync();
        this.entries.clear();
        this.order = [];
        this.document = this.lockTarget = null;
        this.destroyed = true;
    }
}
