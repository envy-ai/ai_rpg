/** Native modal lifetime; the host retains markup, form state and async work. */
export class NativeDialog {
    constructor(root, { returnFocus = null, onClose = null, removeOnClose = false } = {}) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLDialogElement)) throw new TypeError('NativeDialog requires a native dialog element.');
        this.root = root;
        this.document = root.ownerDocument;
        this.returnFocus = returnFocus;
        this.onClose = onClose;
        this.removeOnClose = removeOnClose;
        this.destroyed = false;
        this._pending = false;
        this.active = false;
        this.listeners = new view.AbortController();
        root.addEventListener('cancel', event => {
            if (this._pending) event.preventDefault();
        }, { signal: this.listeners.signal });
        root.addEventListener('close', () => this.finishClose(), { signal: this.listeners.signal });
    }

    assertAlive() {
        if (this.destroyed) throw new Error('NativeDialog has been destroyed. Create a new instance to use this dialog again.');
    }

    get pending() {
        this.assertAlive();
        return this._pending;
    }

    open({ initialFocus = null, returnFocus = this.returnFocus } = {}) {
        this.assertAlive();
        if (this.root.open) throw new Error('NativeDialog is already open. Close it before opening it again.');
        if (this.active) throw new Error('NativeDialog close has not completed. Wait for the native close event before reopening it.');
        const previous = returnFocus || this.document.activeElement;
        this.previous = previous;
        this.previousId = previous?.id;
        this.root.showModal();
        this.active = true;
        initialFocus?.focus();
    }

    close(returnValue = '') {
        this.assertAlive();
        if (this._pending) return false;
        this.root.close(returnValue);
        return true;
    }

    setPending(pending) {
        this.assertAlive();
        if (typeof pending !== 'boolean') throw new TypeError('NativeDialog.setPending requires a boolean.');
        this._pending = pending;
        this.root.setAttribute('aria-busy', String(pending));
    }

    finishClose() {
        if (!this.active || this.root.open) return;
        this.active = false;
        const { document, previous, previousId, root, removeOnClose } = this;
        this.previous = null;
        this.previousId = null;
        try {
            this.onClose?.();
        } finally {
            if (removeOnClose) {
                root.remove();
                this.destroy();
            }
            const trigger = previous?.isConnected ? previous : previousId ? document.getElementById(previousId) : null;
            trigger?.focus();
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.listeners.abort();
        if (this.root.open) this.root.close();
        this.active = false;
        this.onClose = null;
        this.returnFocus = null;
        this.previous = null;
        this.previousId = null;
        this.root = null;
        this.document = null;
        this.listeners = null;
        this.destroyed = true;
    }
}
