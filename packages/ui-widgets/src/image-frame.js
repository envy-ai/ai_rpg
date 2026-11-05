const frames = new WeakMap();

/** Own a native image/placeholder lifetime without choosing URLs, jobs or badge policy. */
export class ImageFrame {
    constructor(root) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement)) throw new TypeError('ImageFrame requires an HTML host.');
        if (frames.has(root)) throw new Error('ImageFrame host already has an owner. Use ImageFrame.attach or destroy the old owner.');
        this.root = root;
        this.sequence = 0;
        this.destroyed = false;
        frames.set(root, this);
        root.dataset.imageFrame = '';
    }

    static attach(root) { return frames.get(root) || new ImageFrame(root); }
    static destroyWithin(root) {
        if (!root?.querySelectorAll) throw new TypeError('ImageFrame.destroyWithin requires a DOM subtree.');
        const errors = [];
        for (const element of [root, ...root.querySelectorAll('[data-image-frame]')]) {
            try { frames.get(element)?.destroy(); } catch (error) { errors.push(error); }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'ImageFrame nested disposal failed.', { cause: errors[0] });
    }
    assertAlive() { if (this.destroyed) throw new Error('ImageFrame has been destroyed. Attach a new owner before rendering.'); }

    show({ src = null, alt = '', placeholderHtml = '', errorHtml = placeholderHtml, loading = 'lazy', draggable = null, onImage = null, onError = null } = {}) {
        this.assertAlive();
        const root = this.root;
        const sequence = ++this.sequence;
        this.listeners?.abort();
        const previousCleanup = this.imageCleanup;
        this.imageCleanup = null;
        previousCleanup?.();
        if (this.destroyed || sequence !== this.sequence) return null;
        if (!src) { root.innerHTML = placeholderHtml; return null; }
        const image = root.ownerDocument.createElement('img');
        image.alt = alt;
        image.loading = loading;
        if (draggable !== null) { image.draggable = draggable; image.setAttribute('draggable', String(draggable)); }
        this.listeners = new root.ownerDocument.defaultView.AbortController();
        image.addEventListener('error', event => {
            if (this.destroyed || sequence !== this.sequence || image.parentElement !== root) return;
            this.listeners.abort();
            const cleanup = this.imageCleanup;
            this.imageCleanup = null;
            cleanup?.();
            if (this.destroyed || sequence !== this.sequence || image.parentElement !== root) return;
            root.innerHTML = errorHtml;
            onError?.(event);
        }, { signal: this.listeners.signal });
        root.replaceChildren(image);
        image.src = src;
        const cleanup = onImage?.(image);
        if (cleanup !== undefined && typeof cleanup !== 'function') throw new TypeError('ImageFrame onImage may return an image binding cleanup function.');
        if (this.destroyed || sequence !== this.sequence || image.parentElement !== root) cleanup?.();
        else this.imageCleanup = cleanup || null;
        return image;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        ++this.sequence;
        this.listeners?.abort();
        const root = this.root;
        const cleanup = this.imageCleanup;
        this.imageCleanup = null;
        frames.delete(root);
        delete root.dataset.imageFrame;
        try { cleanup?.(); }
        finally {
            this.root = this.listeners = this.imageCleanup = null;
        }
    }
}
