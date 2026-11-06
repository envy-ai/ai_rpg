import { TabList } from './tab-list.js';

let nextTabsId = 1;

/** Adopt existing tab buttons and retained panels without owning their content. */
export class Tabs {
    constructor({ tabs, initialId, activeClass = 'active', onChange = null, onActivate = null } = {}) {
        if (!Array.isArray(tabs) || !tabs.length) throw new TypeError('Tabs requires a nonempty tabs array.');
        this.document = tabs[0]?.button?.ownerDocument;
        this.view = this.document?.defaultView;
        this.tabs = [];
        this.activeClass = activeClass;
        this.onChange = onChange;
        this.onActivate = onActivate;
        this.destroyed = false;
        this.prefix = `ui-tabs-${nextTabsId++}`;
        this.nextId = 0;
        const ids = new Set();
        for (const entry of tabs) {
            this.validate(entry);
            if (ids.has(entry.id)) throw new TypeError(`Duplicate tab id "${entry.id}".`);
            ids.add(entry.id);
        }
        this.selection = new TabList({ items: tabs, initialId, activeClass, onActivate: (id, detail) => this.didActivate(id, detail) });
        for (const entry of tabs) this.adopt(entry);
        this.syncPanels();
    }

    assertAlive() {
        if (this.destroyed) throw new Error('Tabs has been destroyed. Create a new instance to remount.');
    }

    validate(entry) {
        if (typeof entry?.id !== 'string' || !entry.id || this.tabs.some(tab => tab.id === entry.id)) throw new TypeError('Each tab requires a unique nonempty string id.');
        if (!this.view || !(entry.button instanceof this.view.HTMLElement) || !(entry.panel instanceof this.view.HTMLElement) || entry.button.ownerDocument !== this.document || entry.panel.ownerDocument !== this.document) throw new TypeError(`Tab "${entry.id}" requires a button and panel in the same document.`);
    }

    adopt(entry) {
        const { button, panel } = entry;
        const index = this.nextId++;
        if (!button.id) button.id = `${this.prefix}-tab-${index}`;
        if (!panel.id) panel.id = `${this.prefix}-panel-${index}`;
        button.setAttribute('aria-controls', panel.id);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', button.id);
        this.tabs.push({ ...entry });
    }

    get activeId() {
        this.assertAlive();
        return this.selection.activeId;
    }

    isDisabled(button) {
        return this.selection.isDisabled(button);
    }

    syncPanels() {
        for (const { id, panel } of this.tabs) {
            const active = id === this.selection.activeId;
            panel.classList.toggle(this.activeClass, active);
            panel.hidden = !active;
        }
    }

    didActivate(id, detail) {
        this.syncPanels();
        if (detail.changed) this.onChange?.(id);
        if (!this.destroyed) this.onActivate?.(id, detail);
    }

    activate(id, options) {
        this.assertAlive();
        this.selection.activate(id, options);
        // Silent activation still reconciles retained panels.
        if (!this.destroyed) this.syncPanels();
    }

    add(entry) {
        this.assertAlive();
        this.validate(entry);
        const unregister = this.selection.add(entry);
        this.adopt(entry);
        this.syncPanels();
        const adopted = this.tabs[this.tabs.length - 1];
        return () => {
            if (this.destroyed || !this.tabs.includes(adopted)) return;
            unregister();
            this.tabs.splice(this.tabs.indexOf(adopted), 1);
            adopted.panel.classList.remove(this.activeClass);
            adopted.panel.hidden = true;
            adopted.button.classList.remove(this.activeClass);
            adopted.button.setAttribute('aria-selected', 'false');
            adopted.button.tabIndex = -1;
            this.syncPanels();
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.selection.destroy();
        this.tabs = this.document = this.view = this.selection = this.onChange = this.onActivate = null;
    }
}
