const owners = new WeakMap();

/** Owned line numbers and vertical scroll synchronization for a native textarea. */
export class TextGutter {
    constructor(input, gutter) {
        const view = input?.ownerDocument?.defaultView;
        if (!view || !(input instanceof view.HTMLTextAreaElement) || !(gutter instanceof view.HTMLElement) || gutter.ownerDocument !== input.ownerDocument) throw new TypeError('TextGutter requires a textarea and gutter in the same document.');
        if (owners.has(input)) throw new Error('TextGutter textarea already has an owner. Destroy it before binding again.');
        this.input = input;
        this.gutter = gutter;
        this.destroyed = false;
        this.listeners = new view.AbortController();
        owners.set(input, this);
        input.addEventListener('scroll', () => this.sync(), { passive: true, signal: this.listeners.signal });
    }

    assertAlive() {
        if (this.destroyed) throw new Error('TextGutter has been destroyed. Create a new owner before updating.');
    }

    setText(text, { resetScroll = false } = {}) {
        this.assertAlive();
        if (typeof text !== 'string') throw new TypeError('TextGutter.setText requires literal string text.');
        if (this.input.value !== text) this.input.value = text;
        const lineCount = text === '' ? 0 : text.split('\n').length;
        this.gutter.textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join('\n');
        if (resetScroll) {
            this.input.scrollTop = 0;
            this.input.scrollLeft = 0;
        }
        this.sync();
        return lineCount;
    }

    sync() {
        this.assertAlive();
        this.gutter.scrollTop = this.input.scrollTop;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.listeners.abort();
        owners.delete(this.input);
        this.input = this.gutter = this.listeners = null;
    }
}
