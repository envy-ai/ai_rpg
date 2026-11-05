const surfaces = new WeakMap();

/** Adopt text/state/visibility presentation and one replaceable expiry timer. */
export class StatusSurface {
    constructor(root, { textElement = root, stateAttribute = null, stateClasses = {}, stateColors = null, visibleClass = '', hideMode = 'hidden', display = 'block', clearStateWhenHidden = false } = {}) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement) || !root.contains(textElement)) throw new TypeError('StatusSurface requires an HTML root and contained text element.');
        if (!['hidden', 'display'].includes(hideMode)) throw new TypeError('StatusSurface hideMode must be hidden or display.');
        if (surfaces.has(root)) throw new Error('StatusSurface root already has an owner.');
        Object.assign(this, { root, textElement, stateAttribute, stateClasses, stateColors, visibleClass, hideMode, display, clearStateWhenHidden });
        this.timer = null; this.sequence = 0;
        surfaces.set(root, this); root.dataset.statusSurface = '';
    }
    static attach(root, options) { return surfaces.get(root) || new StatusSurface(root, options); }
    static destroyWithin(root) { for (const element of [root, ...root.querySelectorAll('[data-status-surface]')]) surfaces.get(element)?.destroy(); }
    setVisible(visible) {
        if (this.hideMode === 'display') this.root.style.display = visible ? this.display : 'none';
        else this.root.hidden = !visible;
        if (this.visibleClass) this.root.classList.toggle(this.visibleClass, visible);
    }
    update({ text, state = '', visible = Boolean(text), busy, autoHideMs = null } = {}) {
        if (!this.root) throw new Error('StatusSurface has been destroyed.');
        if (typeof text !== 'string' || typeof visible !== 'boolean') throw new TypeError('StatusSurface text must be a string and visible must be a boolean.');
        if (autoHideMs !== null && (!Number.isFinite(autoHideMs) || autoHideMs < 0)) throw new TypeError('StatusSurface autoHideMs must be null or a finite nonnegative duration.');
        if (busy !== undefined && typeof busy !== 'boolean') throw new TypeError('StatusSurface busy must be a boolean when supplied.');
        const view = this.root.ownerDocument.defaultView;
        if (this.timer !== null) view.clearTimeout(this.timer);
        this.timer = null;
        const sequence = ++this.sequence;
        this.textElement.textContent = text;
        if (this.stateAttribute) {
            if (!visible && this.clearStateWhenHidden) this.root.removeAttribute(this.stateAttribute);
            else this.root.setAttribute(this.stateAttribute, state);
        }
        for (const className of Object.values(this.stateClasses)) if (className) this.root.classList.toggle(className, this.stateClasses[state] === className);
        if (this.stateColors) this.root.style.color = this.stateColors[state] || '';
        if (busy !== undefined) this.root.setAttribute('aria-busy', String(busy));
        this.setVisible(visible);
        if (autoHideMs !== null && visible) this.timer = view.setTimeout(() => {
            if (!this.root || sequence !== this.sequence) return;
            this.timer = null; this.setVisible(false);
        }, autoHideMs);
    }
    destroy() {
        if (!this.root) return;
        if (this.timer !== null) this.root.ownerDocument.defaultView.clearTimeout(this.timer);
        ++this.sequence;
        surfaces.delete(this.root); delete this.root.dataset.statusSurface;
        this.root = this.textElement = this.stateAttribute = this.stateClasses = this.stateColors = this.visibleClass = this.hideMode = this.display = null;
        this.timer = null;
    }
}
