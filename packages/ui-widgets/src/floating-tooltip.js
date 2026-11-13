/** Pointer/focus-anchored tooltip lifetime, independent of its content and theme. */
export class FloatingTooltip {
    constructor(root, { hideDelay = 180, padding = 16, scrollTargets = [] } = {}) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement)) throw new TypeError('FloatingTooltip requires a root element.');
        if (!Number.isFinite(hideDelay) || hideDelay < 0 || !Number.isFinite(padding) || padding < 0) throw new TypeError('FloatingTooltip hideDelay and padding must be finite nonnegative numbers.');
        this.root = root;
        this.view = view;
        this.hideDelay = hideDelay;
        this.padding = padding;
        this.destroyed = false;
        this.pendingHide = null;
        this.owner = null;
        this.addedClass = !root.classList.contains('floating-tooltip');
        root.classList.add('floating-tooltip');
        this.listeners = new view.AbortController();
        const listen = (target, type, callback, options = {}) => target.addEventListener(type, callback, { ...options, signal: this.listeners.signal });
        listen(root, 'mouseenter', () => this.cancelPendingHide());
        listen(root, 'mouseleave', () => this.hide());
        for (const target of new Set([view, ...scrollTargets])) listen(target, 'scroll', () => this.hide(), { passive: true });
        listen(root.ownerDocument, 'keydown', event => {
            if (event.key === 'Escape' && !root.hidden) this.hide();
        });
    }

    assertAlive() {
        if (this.destroyed) throw new Error('FloatingTooltip has been destroyed. Create a new instance to use this root again.');
    }

    cancelPendingHide() {
        if (this.pendingHide !== null) {
            this.view.clearTimeout(this.pendingHide);
            this.pendingHide = null;
        }
    }

    position(point) {
        const { root, view, padding } = this;
        const rect = root.getBoundingClientRect();
        let x = point.clientX + padding;
        let y = point.clientY + padding;
        if (x + rect.width + padding > view.innerWidth) {
            const left = point.clientX - rect.width - padding;
            x = left >= padding
                ? left
                : Math.max(padding, Math.min(point.clientX - rect.width / 2, view.innerWidth - rect.width - padding));
        }
        if (y + rect.height + padding > view.innerHeight) {
            y = point.clientY - rect.height - padding;
            if (y < padding) y = Math.max(padding, view.innerHeight - rect.height - padding);
        }
        root.style.left = `${x}px`;
        root.style.top = `${y}px`;
    }

    show(content, point, { allowHTML = false, owner = null } = {}) {
        this.assertAlive();
        if (!content || !point) return;
        this.cancelPendingHide();
        this.owner = owner;
        if (allowHTML) this.root.innerHTML = content;
        else this.root.textContent = content;
        this.root.hidden = false;
        this.root.classList.add('visible');
        this.root.classList.remove('is-interactive');
        this.root.scrollTop = 0;
        this.position(point);
    }

    move(point, { owner } = {}) {
        this.assertAlive();
        if (owner !== undefined && this.owner !== owner) return;
        if (!this.root.hidden) this.position(point);
    }

    hide({ defer = false, owner } = {}) {
        this.assertAlive();
        if (owner !== undefined && this.owner !== owner) return;
        this.cancelPendingHide();
        if (defer) {
            if (this.root.scrollHeight > this.root.clientHeight + 1) this.root.classList.add('is-interactive');
            this.pendingHide = this.view.setTimeout(() => this.hide({ owner }), this.hideDelay);
            return;
        }
        this.root.classList.remove('visible', 'is-interactive');
        this.root.hidden = true;
        this.owner = null;
    }

    destroy() {
        if (this.destroyed) return;
        this.hide();
        this.listeners.abort();
        if (this.addedClass) this.root.classList.remove('floating-tooltip');
        this.root = null;
        this.view = null;
        this.listeners = null;
        this.destroyed = true;
    }
}
