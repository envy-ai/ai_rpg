import { nativeDialogOwnsKeys } from './overlay-context.js';

const activeByDocument = new WeakMap();

/** Owned popup dismissal/portal lifetime; placement and action policy are injected. */
export class AnchoredPopup {
    constructor(root, { trigger = null, portalTarget = null, position = null, onOpen = null, onClose = null, closeOnAction = true, repositionOnScroll = true, repositionOnResize = true, closeOnResize = false, outsideBoundary = null, outsideEvents = ['pointerdown', 'click'], dismissOnEscape = true, restoreFocusOnEscape = true } = {}) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement)) throw new TypeError('AnchoredPopup requires an HTML root.');
        if (trigger && (!(trigger instanceof view.HTMLElement) || trigger.ownerDocument !== root.ownerDocument)) throw new TypeError('AnchoredPopup trigger must belong to its document.');
        if (portalTarget && (!(portalTarget instanceof view.HTMLElement) || portalTarget.ownerDocument !== root.ownerDocument)) throw new TypeError('AnchoredPopup portal target must belong to its document.');
        if (outsideBoundary && (!(outsideBoundary instanceof view.HTMLElement) || outsideBoundary.ownerDocument !== root.ownerDocument)) throw new TypeError('AnchoredPopup outside boundary must belong to its document.');
        if (!Array.isArray(outsideEvents) || outsideEvents.some(type => !['pointerdown', 'mousedown', 'click', 'contextmenu'].includes(type))) throw new TypeError('AnchoredPopup outside events must be pointerdown, mousedown, click or contextmenu.');
        Object.assign(this, { root, trigger, portalTarget, position, onOpen, onClose, closeOnAction, repositionOnScroll, repositionOnResize, closeOnResize, outsideBoundary, outsideEvents, dismissOnEscape, restoreFocusOnEscape });
        this.document = root.ownerDocument;
        this.view = view;
        this.opened = false;
        this.destroyed = false;
        root.hidden = true;
        this.detachObserver = new view.MutationObserver(() => {
            if (!root.isConnected || (trigger && !trigger.isConnected)) this.close({ reason: 'detached' });
        });
    }

    assertAlive() {
        if (this.destroyed) throw new Error('AnchoredPopup has been destroyed. Create a new instance before opening it.');
    }

    get isOpen() { this.assertAlive(); return this.opened; }

    reposition() {
        this.assertAlive();
        if (this.opened) this.position?.({ root: this.root, trigger: this.trigger, point: this.point });
    }

    open({ point = null, initialFocus = null } = {}) {
        this.assertAlive();
        const previous = activeByDocument.get(this.document);
        if (previous && previous !== this) previous.close({ reason: 'switch' });
        if (this.opened) this.close({ reason: 'reopen' });
        this.assertAlive();
        const { root, trigger, document, view } = this;
        this.originalParent = root.parentNode;
        this.originalNextSibling = root.nextSibling;
        this.originalPosition = { left: root.style.left, top: root.style.top, right: root.style.right };
        if (this.portalTarget) this.portalTarget.append(root);
        if (!root.isConnected) throw new Error('AnchoredPopup root must be mounted or have a mounted portal target before opening.');
        this.point = point;
        this.opened = true;
        activeByDocument.set(document, this);
        root.hidden = false;
        root.classList.add('is-open');
        trigger?.setAttribute('aria-expanded', 'true');
        this.activeListeners = new view.AbortController();
        const signal = this.activeListeners.signal;
        const inside = (event, element) => element && event.composedPath().includes(element);
        const outside = event => {
            if (!inside(event, root) && !inside(event, trigger) && !inside(event, this.outsideBoundary)) this.close({ reason: 'outside' });
        };
        for (const type of this.outsideEvents) {
            if (type !== 'click') document.addEventListener(type, outside, { capture: true, signal });
        }
        document.addEventListener('click', event => {
            if (!inside(event, root)) { if (this.outsideEvents.includes('click')) outside(event); return; }
            const action = event.target instanceof view.Element ? event.target.closest('button, a[href], [data-popup-dismiss]') : null;
            if (this.closeOnAction && action && root.contains(action)) this.close({ reason: 'action', restoreFocus: root.contains(document.activeElement) });
        }, { capture: true, signal });
        document.addEventListener('keydown', event => {
            if (!this.dismissOnEscape || event.key !== 'Escape' || event.defaultPrevented || nativeDialogOwnsKeys(document, root, trigger)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this.close({ reason: 'escape', restoreFocus: this.restoreFocusOnEscape });
        }, { capture: true, signal });
        if (this.repositionOnScroll) view.addEventListener('scroll', () => this.reposition(), { capture: true, signal });
        if (this.closeOnResize) view.addEventListener('resize', () => this.close({ reason: 'resize' }), { signal });
        else if (this.repositionOnResize) view.addEventListener('resize', () => this.reposition(), { signal });
        this.detachObserver.observe(document.documentElement, { childList: true, subtree: true });
        this.reposition();
        this.onOpen?.();
        initialFocus?.focus();
    }

    close({ restoreFocus = false, reason = 'api' } = {}) {
        this.assertAlive();
        if (!this.opened) return;
        const { root, trigger, document, originalParent, originalNextSibling, originalPosition, onClose } = this;
        this.opened = false;
        this.activeListeners.abort();
        this.activeListeners = null;
        this.detachObserver.disconnect();
        if (activeByDocument.get(document) === this) activeByDocument.delete(document);
        root.hidden = true;
        root.classList.remove('is-open');
        trigger?.setAttribute('aria-expanded', 'false');
        if (this.portalTarget) {
            if (originalParent?.isConnected) {
                if (originalNextSibling?.parentNode === originalParent) originalParent.insertBefore(root, originalNextSibling);
                else originalParent.append(root);
            } else root.remove();
        }
        Object.assign(root.style, originalPosition);
        this.originalParent = this.originalNextSibling = this.originalPosition = this.point = null;
        if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
        onClose?.({ reason });
    }

    destroy() {
        if (this.destroyed) return;
        try { this.close({ reason: 'destroy' }); }
        finally {
            if (!this.destroyed) {
                this.activeListeners?.abort();
                this.detachObserver.disconnect();
                this.root = this.trigger = this.portalTarget = this.outsideBoundary = this.document = this.view = null;
                this.outsideEvents = null;
                this.onOpen = this.onClose = this.position = this.detachObserver = this.activeListeners = null;
                this.destroyed = true;
            }
        }
    }
}
