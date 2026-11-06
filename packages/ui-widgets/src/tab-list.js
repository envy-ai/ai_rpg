/** Native button selection and roving focus without panel or route ownership. */
export class TabList {
    constructor({ items, initialId, activeClass = 'active', onChange = null, onActivate = null } = {}) {
        if (!Array.isArray(items) || !items.length) throw new TypeError('TabList requires a nonempty items array.');
        this.document = items[0]?.button?.ownerDocument;
        this.view = this.document?.defaultView;
        this.items = [];
        this.activeClass = activeClass;
        this.onChange = onChange;
        this.onActivate = onActivate;
        this.destroyed = false;
        const ids = new Set();
        for (const item of items) {
            this.validate(item);
            if (ids.has(item.id)) throw new TypeError(`Duplicate tab id "${item.id}".`);
            ids.add(item.id);
        }
        const initial = initialId === undefined
            ? items.find(({ button }) => button.classList.contains(activeClass) && !this.isDisabled(button))?.id || items.find(({ button }) => !this.isDisabled(button))?.id
            : initialId;
        const selected = items.find(item => item.id === initial);
        if (!selected || this.isDisabled(selected.button)) throw new Error(`Unknown or disabled initial tab "${initial}". Provide a known enabled tab.`);
        for (const item of items) this.add(item);
        this.activate(initial, { notify: false });
    }

    assertAlive() {
        if (this.destroyed) throw new Error('TabList has been destroyed. Create a new instance to remount.');
    }

    validate(item) {
        if (typeof item?.id !== 'string' || !item.id || this.items.some(entry => entry.id === item.id)) throw new TypeError('Each tab requires a unique nonempty string id.');
        if (!this.view || !(item.button instanceof this.view.HTMLElement) || item.button.ownerDocument !== this.document) throw new TypeError(`Tab "${item.id}" requires a button in the same document.`);
    }

    isDisabled(button) {
        return button.matches(':disabled') || button.getAttribute('aria-disabled') === 'true';
    }

    get activeId() {
        this.assertAlive();
        return this._activeId;
    }

    add(item) {
        this.assertAlive();
        this.validate(item);
        const entry = { id: item.id, button: item.button, listeners: new this.view.AbortController() };
        this.items.push(entry);
        const { button } = entry;
        button.setAttribute('role', 'tab');
        button.parentElement?.setAttribute('role', 'tablist');
        button.classList.remove(this.activeClass);
        button.setAttribute('aria-selected', 'false');
        button.tabIndex = -1;
        button.addEventListener('click', () => {
            if (!this.isDisabled(button)) this.activate(entry.id, { source: 'click' });
        }, { signal: entry.listeners.signal });
        button.addEventListener('keydown', event => this.onKeydown(event, entry), { signal: entry.listeners.signal });
        return () => {
            if (this.destroyed || !this.items.includes(entry)) return;
            entry.listeners.abort();
            this.items.splice(this.items.indexOf(entry), 1);
            if (this._activeId === entry.id) {
                this._activeId = undefined;
                const next = this.items.find(({ button }) => !this.isDisabled(button));
                if (next) this.activate(next.id, { notify: false });
            }
        };
    }

    activate(id, { focus = false, notify = true, source = 'programmatic' } = {}) {
        this.assertAlive();
        const selected = this.items.find(entry => entry.id === id);
        if (!selected) throw new Error(`Unknown tab "${id}". Use one of: ${this.items.map(entry => entry.id).join(', ')}.`);
        if (this.isDisabled(selected.button)) throw new Error(`Tab "${id}" is disabled. Enable it before activation.`);
        const changed = this._activeId !== id;
        this._activeId = id;
        for (const entry of this.items) {
            const active = entry === selected;
            entry.button.classList.toggle(this.activeClass, active);
            entry.button.setAttribute('aria-selected', String(active));
            entry.button.tabIndex = active ? 0 : -1;
        }
        if (focus) selected.button.focus();
        if (notify && changed) this.onChange?.(id);
        if (notify && !this.destroyed) this.onActivate?.(id, { changed, source });
    }

    onKeydown(event, entry) {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
        const available = this.items.filter(({ button }) => !this.isDisabled(button));
        if (!available.length) return;
        const current = available.indexOf(entry);
        let next;
        if (event.key === 'Home') next = available[0];
        else if (event.key === 'End') next = available[available.length - 1];
        else next = available[(current + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length];
        event.preventDefault();
        this.activate(next.id, { focus: true, source: 'keyboard' });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const entry of this.items) entry.listeners.abort();
        this.items = this.document = this.view = this.onChange = this.onActivate = null;
    }
}
