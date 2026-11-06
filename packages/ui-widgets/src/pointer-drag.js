/** Owned pointer dragging, preserving the existing window viewport bounds. */
export class PointerDrag {
    constructor(root, handle, { dragState = { active: false, pointerId: null, offsetX: 0, offsetY: 0 }, shouldIgnorePointerDown = null, extraMoveGuard = null, onDragStart = null, onDragMove = null, onDragEnd = null, writePosition = null, capturePointer = false } = {}) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement) || !(handle instanceof view.HTMLElement)) throw new TypeError('PointerDrag requires root and handle elements.');
        if (writePosition !== null && typeof writePosition !== 'function') throw new TypeError('PointerDrag.writePosition must be a function or null.');
        if (typeof capturePointer !== 'boolean') throw new TypeError('PointerDrag.capturePointer must be a boolean.');
        if (handle.ownerDocument !== root.ownerDocument) throw new TypeError('PointerDrag requires root and handle in the same document.');
        Object.assign(this, { root, handle, view, dragState, shouldIgnorePointerDown, extraMoveGuard, onDragStart, onDragMove, onDragEnd, writePosition, capturePointer });
        this.destroyed = false;
        this.listeners = new view.AbortController();
        this.detachObserver = new view.MutationObserver(() => {
            if (!root.isConnected) this.stop();
        });
        this.move = event => {
            if (!dragState.active || event.pointerId !== dragState.pointerId || this.extraMoveGuard?.(event)) return;
            if (this.writePosition) this.writePosition(root, event, dragState);
            else {
                const rect = root.getBoundingClientRect();
                const maxLeft = Math.max(0, view.innerWidth - rect.width);
                const maxTop = Math.max(0, view.innerHeight - rect.height);
                root.style.left = `${Math.min(Math.max(event.clientX - dragState.offsetX, 0), maxLeft)}px`;
                root.style.top = `${Math.min(Math.max(event.clientY - dragState.offsetY, 0), maxTop)}px`;
                root.style.right = 'auto';
            }
            if (this.destroyed || !dragState.active) return;
            this.onDragMove?.(root);
            if (!this.destroyed && dragState.active) root.classList.add('is-dragging');
        };
        this.stop = event => {
            if (!dragState.active || (event?.pointerId !== undefined && event.pointerId !== dragState.pointerId)) return;
            const pointerId = dragState.pointerId;
            dragState.active = false;
            dragState.pointerId = null;
            this.activeListeners?.abort();
            this.activeListeners = null;
            this.detachObserver.disconnect();
            root.classList.remove('is-dragging');
            if (capturePointer && handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
            this.onDragEnd?.();
        };
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0 || this.shouldIgnorePointerDown?.(event)) return;
            this.stop();
            if (this.destroyed) return;
            const rect = root.getBoundingClientRect();
            dragState.active = true;
            dragState.pointerId = event.pointerId;
            try {
                this.onDragStart?.(root, event);
                if (this.destroyed || !dragState.active) return;
                if (capturePointer) handle.setPointerCapture(event.pointerId);
            }
            catch (error) {
                try { this.stop(); }
                catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Pointer drag start and cleanup failed.', { cause: error }); }
                throw error;
            }
            if (this.destroyed || !dragState.active) return;
            dragState.offsetX = event.clientX - rect.left;
            dragState.offsetY = event.clientY - rect.top;
            this.activeListeners = new view.AbortController();
            const options = { signal: this.activeListeners.signal };
            view.addEventListener('pointermove', this.move, options);
            view.addEventListener('pointerup', this.stop, options);
            view.addEventListener('pointercancel', this.stop, options);
            if (capturePointer) handle.addEventListener('lostpointercapture', this.stop, options);
            this.detachObserver.observe(root.ownerDocument.documentElement, { childList: true, subtree: true });
            event.preventDefault();
        }, { signal: this.listeners.signal });
        root.dataset.dragBound = 'true';
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        try { this.stop(); }
        finally {
            this.listeners.abort();
            this.activeListeners?.abort();
            this.detachObserver.disconnect();
            delete this.root.dataset.dragBound;
            this.root = this.handle = this.view = this.dragState = null;
            this.shouldIgnorePointerDown = this.extraMoveGuard = this.onDragStart = this.onDragMove = this.onDragEnd = this.writePosition = null;
            this.listeners = this.activeListeners = this.detachObserver = this.move = this.stop = null;
            this.destroyed = true;
        }
    }
}
