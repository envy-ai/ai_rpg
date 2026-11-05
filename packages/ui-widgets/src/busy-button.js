const owners = new WeakMap();

/** Native busy chrome with explicit current host eligibility, never a disabled-state snapshot. */
export class BusyButton {
    constructor(button, { busyClass = 'is-loading' } = {}) {
        const view = button?.ownerDocument?.defaultView;
        if (!view || !(button instanceof view.HTMLButtonElement)) throw new TypeError('BusyButton requires a native button.');
        if (owners.has(button)) throw new Error('BusyButton button already has an owner.');
        this.button = button; this.busyClass = busyClass; this.busy = false; this.destroyed = false;
        this.idleNodes = [...button.childNodes]; this.ownedBusyNodes = null;
        owners.set(button, this); button.dataset.busyButton = '';
    }
    static attach(button, options) { return owners.get(button) || new BusyButton(button, options); }
    static get(button) { return owners.get(button) || null; }
    static destroyWithin(root) { for (const button of [root, ...root.querySelectorAll('[data-busy-button]')]) owners.get(button)?.destroy(); }
    assertAlive() { if (!this.button) throw new Error('BusyButton has been destroyed.'); }
    contentNodes(content) {
        const document = this.button.ownerDocument;
        const nodes = typeof content === 'string' ? [document.createTextNode(content)]
            : Array.isArray(content) ? content : content?.nodeType === 11 ? [...content.childNodes] : [content];
        if (nodes.some(node => !(node instanceof document.defaultView.Node) || node.ownerDocument !== document || node === this.button || node.contains?.(this.button))) throw new TypeError('BusyButton content must be text or native nodes in its button document.');
        return nodes;
    }
    setIdleState({ disabled, content } = {}) {
        this.assertAlive();
        if (typeof disabled !== 'boolean') throw new TypeError('BusyButton idle disabled must be the current host eligibility boolean.');
        if (content !== undefined) this.idleNodes = this.contentNodes(content);
        this.button.disabled = this.busy || disabled;
        if (!this.busy && content !== undefined) this.button.replaceChildren(...this.idleNodes);
    }
    setBusy(busy, { disabled, content, busyContent } = {}) {
        this.assertAlive();
        if (typeof busy !== 'boolean' || typeof disabled !== 'boolean') throw new TypeError('BusyButton.setBusy requires a busy boolean and explicit current idle disabled boolean; do not restore a captured disabled snapshot.');
        const button = this.button;
        const wasBusy = this.busy;
        const idleNodes = content !== undefined ? this.contentNodes(content) : null;
        const busyNodes = busyContent !== undefined ? this.contentNodes(busyContent) : null;
        if (idleNodes) this.idleNodes = idleNodes;
        if (busy && !wasBusy && !idleNodes) this.idleNodes = [...button.childNodes];
        this.busy = busy;
        if (busy && busyNodes) { button.replaceChildren(...busyNodes); this.ownedBusyNodes = [...button.childNodes]; }
        if (!busy) {
            const current = [...button.childNodes];
            const stillOwned = this.ownedBusyNodes && current.length === this.ownedBusyNodes.length && current.every((node, index) => node === this.ownedBusyNodes[index]);
            if (idleNodes || (wasBusy && stillOwned)) button.replaceChildren(...this.idleNodes);
            else this.idleNodes = current;
            this.ownedBusyNodes = null;
        }
        if (this.busyClass) button.classList.toggle(this.busyClass, busy);
        if (busy) button.setAttribute('aria-busy', 'true'); else button.removeAttribute('aria-busy');
        button.disabled = busy || disabled;
    }
    destroy() {
        if (!this.button) return;
        this.destroyed = true;
        owners.delete(this.button); delete this.button.dataset.busyButton;
        this.button = this.idleNodes = this.ownedBusyNodes = this.busyClass = null;
    }
}
