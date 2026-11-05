/** Queue bottom scrolling with injected host readiness/follow/selection policy. */
export class FollowScroll {
    constructor(root, { canScroll = () => true, isFollowing = null, onFollowChange = null, trackIntent = false, observe = false, initialPending = false, requireVisible = false } = {}) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement)) throw new TypeError('FollowScroll requires an HTML scroll host.');
        Object.assign(this, { root, view, canScroll, isFollowing, onFollowChange, trackIntent, requireVisible });
        this.following = true; this.lastTop = 0; this.pending = initialPending; this.pendingForce = false; this.frame = null; this.destroyed = false;
        this.listeners = new view.AbortController();
        if (trackIntent) root.addEventListener('scroll', () => this.captureIntent(), { passive: true, signal: this.listeners.signal });
        if (observe) {
            this.targets = new Set();
            this.resize = new view.ResizeObserver(() => { if (!this.destroyed) this.request(); });
            this.resize.observe(root);
            const sync = () => {
                const next = new Set(root.children);
                for (const element of this.targets) if (!next.has(element)) this.resize.unobserve(element);
                for (const element of next) if (!this.targets.has(element)) this.resize.observe(element);
                this.targets = next;
                this.request();
            };
            this.mutation = new view.MutationObserver(records => {
                if (this.destroyed) return;
                if (records.some(record => record.type === 'childList' && record.target === root)) sync();
                else this.request();
            });
            this.mutation.observe(root, { childList: true, subtree: true, characterData: true });
            sync();
        }
    }
    static hasSelection(root) {
        const selection = root?.ownerDocument?.defaultView?.getSelection();
        if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return false;
        for (let index = 0; index < selection.rangeCount; index++) if (selection.getRangeAt(index).intersectsNode(root)) return true;
        return false;
    }
    assertAlive() { if (this.destroyed) throw new Error('FollowScroll has been destroyed.'); }
    atBottom() { this.assertAlive(); return this.root.scrollHeight - this.root.clientHeight - this.root.scrollTop <= 2; }
    setFollowing(value) { this.following = value; this.onFollowChange?.(value); }
    captureIntent() {
        this.assertAlive();
        const top = this.root.scrollTop;
        if (this.atBottom()) this.setFollowing(true);
        else if (top < this.lastTop) { this.setFollowing(false); this.pending = false; this.pendingForce = false; }
        this.lastTop = top;
    }
    scrollNow() {
        this.assertAlive();
        this.root.scrollTop = this.root.scrollHeight;
        this.lastTop = this.root.scrollTop;
    }
    request({ force = false, immediate = false } = {}) {
        this.assertAlive();
        if (force) this.setFollowing(true);
        else if (this.trackIntent) this.captureIntent();
        if (!force && !(this.isFollowing ? this.isFollowing() : this.following)) return;
        if (immediate && this.root.getClientRects().length) this.scrollNow();
        this.pending = true; this.pendingForce ||= force;
        this.flush();
    }
    flush() {
        this.assertAlive();
        if (!this.pending || this.frame !== null || !this.canScroll({ force: this.pendingForce })) return;
        this.frame = this.view.requestAnimationFrame(() => {
            this.frame = null;
            if (this.trackIntent) this.captureIntent();
            if (!this.pending || !this.root.isConnected || !this.canScroll({ force: this.pendingForce })
                || (this.requireVisible && (!this.root.getClientRects().length || this.root.clientHeight === 0))) return;
            this.pending = false; this.pendingForce = false;
            this.scrollNow();
        });
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.listeners.abort();
        this.resize?.disconnect(); this.mutation?.disconnect();
        if (this.frame !== null) this.view.cancelAnimationFrame(this.frame);
        this.root = this.view = this.listeners = this.resize = this.mutation = this.targets = this.canScroll = this.isFollowing = this.onFollowChange = null;
        this.frame = null;
    }
}
