import { PointerDrag } from './pointer-drag.js';
import { nativeDialogOwnsKeys } from './overlay-context.js';

const layers = new WeakMap();

/** Modeless window behavior; application anchoring/content stay with the host. */
export class FloatingWindow {
    constructor(root, { header = null, closeButton = null, onClose = null, nextLayer = null, drag = {}, dismissOnEscape = true } = {}) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement)) throw new TypeError('FloatingWindow requires a root element.');
        Object.assign(this, { root, onClose });
        this.destroyed = false;
        this.listeners = new view.AbortController();
        const raise = () => {
            const layer = nextLayer ? nextLayer() : (layers.get(root.ownerDocument) || 0) + 1;
            if (!nextLayer) layers.set(root.ownerDocument, layer);
            root.style.zIndex = String(layer);
        };
        const requestClose = () => { if (this.onClose) this.onClose(); else { this.destroy(); root.remove(); } };
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'false');
        root.classList.add('floating-window');
        root.tabIndex = 0;
        closeButton?.addEventListener('click', requestClose, { signal: this.listeners.signal });
        root.addEventListener('keydown', event => {
            if (!dismissOnEscape || event.key !== 'Escape' || event.defaultPrevented || !root.contains(root.ownerDocument.activeElement) || nativeDialogOwnsKeys(root.ownerDocument, root)) return;
            event.preventDefault();
            event.stopPropagation();
            requestClose();
        }, { signal: this.listeners.signal });
        root.addEventListener('pointerdown', raise, { signal: this.listeners.signal });
        root.addEventListener('focusin', raise, { signal: this.listeners.signal });
        if (header) this.drag = new PointerDrag(root, header, drag);
        raise();
    }

    static create({ document = globalThis.document, ariaLabel, onClose, nextLayer, drag } = {}) {
        if (!document?.defaultView) throw new TypeError('FloatingWindow.create requires a browser document.');
        if (typeof ariaLabel !== 'string' || !ariaLabel.trim()) throw new TypeError('FloatingWindow.create requires an accessible ariaLabel.');
        const node = (tag, part) => {
            const element = document.createElement(tag);
            element.className = `floating-window__${part}`;
            return element;
        };
        const root = document.createElement('aside');
        root.setAttribute('aria-label', ariaLabel);
        root.setAttribute('aria-live', 'polite');
        const header = node('div', 'header');
        const meta = node('div', 'meta');
        const title = node('div', 'title');
        const subtitle = node('div', 'subtitle');
        const actions = node('div', 'actions');
        const closeButton = node('button', 'close');
        closeButton.type = 'button';
        closeButton.textContent = '×';
        closeButton.title = 'Close window (Escape while focused)';
        closeButton.setAttribute('aria-label', `Close ${ariaLabel}`);
        actions.append(closeButton);
        meta.append(title, subtitle);
        header.append(meta, actions);
        const content = node('div', 'content');
        root.append(header, content);
        const instance = new FloatingWindow(root, { header, closeButton, onClose, nextLayer, drag });
        instance.elements = { root, header, meta, title, subtitle, actions, closeButton, content };
        return instance;
    }

    destroy() {
        if (this.destroyed) return;
        try { this.drag?.destroy(); }
        finally {
            this.listeners.abort();
            this.root = this.drag = this.listeners = this.elements = this.onClose = null;
            this.destroyed = true;
        }
    }
}
