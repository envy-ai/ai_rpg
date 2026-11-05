let nextTabsId = 1;

/** Adopt existing tab buttons and panels without owning their content. */
export class Tabs {
    constructor({ tabs, initialId, activeClass = 'active', onChange = null } = {}) {
        if (!Array.isArray(tabs) || !tabs.length) throw new TypeError('Tabs requires a nonempty tabs array.');
        const document = tabs[0]?.button?.ownerDocument;
        const view = document?.defaultView;
        const ids = new Set();
        for (const entry of tabs) {
            if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) throw new TypeError('Each tab requires a unique nonempty string id.');
            if (!view || !(entry.button instanceof view.HTMLElement) || !(entry.panel instanceof view.HTMLElement) || entry.button.ownerDocument !== document || entry.panel.ownerDocument !== document) throw new TypeError(`Tab "${entry.id}" requires a button and panel in the same document.`);
            ids.add(entry.id);
        }
        this.tabs = tabs.map(entry => ({ ...entry }));
        this.activeClass = activeClass;
        this.onChange = onChange;
        this.destroyed = false;
        this.listeners = new view.AbortController();
        const initial = initialId === undefined
            ? this.tabs.find(({ button }) => button.classList.contains(activeClass) && !this.isDisabled(button))?.id || this.tabs.find(({ button }) => !this.isDisabled(button))?.id
            : initialId;
        const selected = this.tabs.find(entry => entry.id === initial);
        if (!selected) throw new Error(`Unknown initial tab "${initial}". Provide a known enabled tab.`);
        if (this.isDisabled(selected.button)) throw new Error(`Initial tab "${initial}" is disabled. Enable it or choose another tab.`);
        const prefix = `ui-tabs-${nextTabsId++}`;
        this.tabs.forEach(({ button, panel }, index) => {
            if (!button.id) button.id = `${prefix}-tab-${index}`;
            if (!panel.id) panel.id = `${prefix}-panel-${index}`;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-controls', panel.id);
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', button.id);
            button.parentElement?.setAttribute('role', 'tablist');
            button.addEventListener('click', () => {
                if (!this.isDisabled(button)) this.activate(this.tabs[index].id);
            }, { signal: this.listeners.signal });
            button.addEventListener('keydown', event => this.onKeydown(event, index), { signal: this.listeners.signal });
        });
        this.activate(initial, { notify: false });
    }

    assertAlive() {
        if (this.destroyed) throw new Error('Tabs has been destroyed. Create a new instance to remount.');
    }

    isDisabled(button) {
        return button.disabled || button.getAttribute('aria-disabled') === 'true';
    }

    get activeId() {
        this.assertAlive();
        return this._activeId;
    }

    activate(id, { focus = false, notify = true } = {}) {
        this.assertAlive();
        const selected = this.tabs.find(entry => entry.id === id);
        if (!selected) throw new Error(`Unknown tab "${id}". Use one of: ${this.tabs.map(entry => entry.id).join(', ')}.`);
        if (this.isDisabled(selected.button)) throw new Error(`Tab "${id}" is disabled. Enable it before activation.`);
        const changed = this._activeId !== id;
        this._activeId = id;
        this.tabs.forEach(({ id: entryId, button, panel }) => {
            const active = entryId === id;
            button.classList.toggle(this.activeClass, active);
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
            panel.classList.toggle(this.activeClass, active);
            panel.hidden = !active;
        });
        if (focus) selected.button.focus();
        if (notify && changed) this.onChange?.(id);
    }

    onKeydown(event, index) {
        const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (!keys.includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
        const available = this.tabs.filter(({ button }) => !this.isDisabled(button));
        if (!available.length) return;
        const current = available.indexOf(this.tabs[index]);
        let next;
        if (event.key === 'Home') next = available[0];
        else if (event.key === 'End') next = available[available.length - 1];
        else next = available[(current + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length];
        event.preventDefault();
        this.activate(next.id, { focus: true });
    }

    destroy() {
        if (this.destroyed) return;
        this.listeners.abort();
        this.tabs = null;
        this.onChange = null;
        this.listeners = null;
        this.destroyed = true;
    }
}
