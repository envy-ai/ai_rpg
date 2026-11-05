/** Owned transient notices; application error policy stays outside this host. */
export class NoticeHost {
    constructor(root) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement)) throw new TypeError('NoticeHost requires an HTML root.');
        this.root = root; this.entries = new Set();
    }
    show(text, { kind = 'info', duration = 4000, exitDuration = 300, className = '' } = {}) {
        if (!this.root) throw new Error('NoticeHost has been destroyed.');
        if (typeof text !== 'string') throw new TypeError('NoticeHost text must be a string; report Error objects through the host application error UI.');
        for (const [field, value] of Object.entries({ duration, exitDuration })) if (!Number.isFinite(value) || value < 0) throw new TypeError(`NoticeHost ${field} must be a finite nonnegative duration.`);
        const root = this.root, view = root.ownerDocument.defaultView;
        const element = root.ownerDocument.createElement('div');
        element.className = `notice-host__notice ${className}`.trim();
        element.dataset.kind = kind;
        element.style.setProperty('--notice-exit-duration', `${exitDuration}ms`);
        element.textContent = text;
        let ttl = null, exit = null, closed = false, exiting = false;
        const destroy = () => {
            if (closed) return; closed = true;
            if (ttl !== null) view.clearTimeout(ttl);
            if (exit !== null) view.clearTimeout(exit);
            this.entries?.delete(handle); element.remove();
        };
        const dismiss = () => {
            if (closed || exiting) return; exiting = true;
            if (ttl !== null) view.clearTimeout(ttl);
            ttl = null;
            element.classList.add('notice-host__notice--leaving');
            if (exitDuration === 0) destroy(); else exit = view.setTimeout(destroy, exitDuration);
        };
        const handle = { element, dismiss, destroy };
        this.entries.add(handle); root.append(element);
        ttl = view.setTimeout(dismiss, duration);
        return handle;
    }
    destroy() {
        if (!this.root) return;
        for (const handle of [...this.entries]) handle.destroy();
        this.root = this.entries = null;
    }
}
