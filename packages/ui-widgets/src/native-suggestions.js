import { CollectionView } from './collection-view.js';

const owners = new WeakMap();

/** Suggestions around existing native controls; matching and selected state belong to the host. */
export class NativeSuggestions {
    constructor(input, root, { getMatches, renderOption, onChoose, onError, blurDelay = 100 } = {}) {
        const document = input?.ownerDocument;
        const view = document?.defaultView;
        if (!view || !(input instanceof view.HTMLInputElement) || !(root instanceof view.HTMLElement) || root.ownerDocument !== document) throw new TypeError('NativeSuggestions requires an input and HTML suggestion root in the same document.');
        if ([getMatches, renderOption, onChoose, onError].some(callback => typeof callback !== 'function')) throw new TypeError('NativeSuggestions requires getMatches, renderOption, onChoose and onError callbacks.');
        if (!Number.isFinite(blurDelay) || blurDelay < 0) throw new TypeError('NativeSuggestions blurDelay must be a non-negative finite duration.');
        if (owners.has(input) || owners.has(root)) throw new Error('NativeSuggestions controls already have an owner.');
        Object.assign(this, { input, root, getMatches, renderOption, onChoose, onError, blurDelay, document, view });
        this.destroyed = false;
        this.version = 0;
        this.blurTimer = null;
        this.content = new CollectionView(root);
        this.listeners = new view.AbortController();
        const signal = this.listeners.signal;
        const refresh = options => { void this.refresh(options).catch(error => onError(error)); };
        input.addEventListener('input', () => refresh(), { signal });
        input.addEventListener('focus', () => { this.cancelBlur(); refresh(); }, { signal });
        input.addEventListener('keydown', event => {
            if (event.key === 'Escape') this.hide();
            else if (event.key === 'Enter') { event.preventDefault(); refresh({ chooseFirst: true }); }
        }, { signal });
        input.addEventListener('blur', () => {
            this.cancelBlur();
            this.blurTimer = view.setTimeout(() => { this.blurTimer = null; this.hide(); }, blurDelay);
        }, { signal });
        owners.set(input, this);
        owners.set(root, this);
        this.hide();
    }

    assertAlive() { if (this.destroyed) throw new Error('NativeSuggestions has been destroyed. Create a new owner before using these controls.'); }

    cancelBlur() {
        if (this.blurTimer !== null) this.view.clearTimeout(this.blurTimer);
        this.blurTimer = null;
    }

    async refresh({ chooseFirst = false } = {}) {
        this.assertAlive();
        const query = this.input.value.trim();
        if (!query || this.input.matches(':disabled')) { this.hide(); return; }
        const version = ++this.version;
        this.content.clear();
        this.root.hidden = true;
        const items = await this.getMatches(query);
        if (this.destroyed || version !== this.version || this.input.value.trim() !== query || !this.input.isConnected || !this.root.isConnected || this.input.matches(':disabled')) return;
        if (!Array.isArray(items)) throw new TypeError('NativeSuggestions getMatches must return an array.');
        if (chooseFirst) {
            if (items.length) this.choose(items[0]);
            else this.hide();
            return;
        }
        this.content.render({ items, renderItem: item => {
            const element = this.renderOption(item);
            if (!(element instanceof this.view.HTMLButtonElement) || element.ownerDocument !== this.document) throw new TypeError('NativeSuggestions renderOption must return a native button in the owned document.');
            const listeners = new this.view.AbortController();
            const onError = this.onError;
            element.addEventListener('mousedown', event => {
                event.preventDefault();
                try { this.choose(item); } catch (error) { onError(error); }
            }, { signal: listeners.signal });
            return { element, dispose: () => listeners.abort() };
        } });
    }

    choose(item) {
        this.assertAlive();
        this.onChoose(item);
        if (this.destroyed) return;
        this.input.value = '';
        this.hide();
    }

    hide() {
        this.assertAlive();
        ++this.version;
        this.cancelBlur();
        this.content.clear();
        this.root.hidden = true;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        ++this.version;
        this.cancelBlur();
        this.listeners.abort();
        owners.delete(this.input);
        owners.delete(this.root);
        this.root.hidden = true;
        try { this.content.destroy(); }
        finally { this.input = this.root = this.document = this.view = this.content = this.listeners = this.getMatches = this.renderOption = this.onChoose = this.onError = null; }
    }
}
