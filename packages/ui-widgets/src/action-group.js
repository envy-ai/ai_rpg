import { BusyButton } from './busy-button.js';

const groups = new WeakMap();

/** Keyed native action controls. Transactions and their pending policy belong to callers. */
export class ActionGroup {
    constructor(root, { onAction, renderIcon = null } = {}) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement) || typeof onAction !== 'function') throw new TypeError('ActionGroup requires an HTML root and onAction callback.');
        if (groups.has(root)) throw new Error('ActionGroup root already has an owner.');
        Object.assign(this, { root, onAction, renderIcon });
        this.records = new Map();
        this.buttons = new Map();
        this.pending = new Set();
        this.destroyed = false;
        groups.set(root, this);
        root.dataset.actionGroup = '';
    }
    static get(root) { return groups.get(root) || null; }
    static destroyWithin(root) {
        for (const element of [root, ...root.querySelectorAll('[data-action-group]')]) groups.get(element)?.destroy();
    }
    assertAlive() { if (this.destroyed) throw new Error('ActionGroup has been destroyed.'); }
    update(actions) {
        this.assertAlive();
        if (!Array.isArray(actions)) throw new TypeError('ActionGroup.update requires action descriptors.');
        const seen = new Set();
        for (const action of actions) {
            if (typeof action?.id !== 'string' || !action.id || seen.has(action.id)) throw new Error('ActionGroup actions require unique nonempty string IDs.');
            seen.add(action.id);
        }
        const focused = this.root.ownerDocument.activeElement;
        const retainedFocus = [...this.records].some(([id, record]) => seen.has(id) && record.button === focused) ? focused : null;
        for (const [id, record] of this.records) if (!seen.has(id)) {
            record.listeners.abort(); record.busy.destroy(); record.button.remove(); this.records.delete(id); this.buttons.delete(id); this.pending.delete(id);
        }
        let cursor = Array.from(this.root.children).find(element => [...this.records.values()].some(record => record.button === element)) || null;
        for (const action of actions) {
            let record = this.records.get(action.id);
            if (!record) {
                const button = this.root.ownerDocument.createElement('button');
                button.type = 'button';
                button.dataset.actionId = action.id;
                record = { button, descriptor: action, listeners: new this.root.ownerDocument.defaultView.AbortController(), busy: BusyButton.attach(button, { busyClass: '' }) };
                if (this.renderIcon) button.append(this.renderIcon(action));
                button.addEventListener('click', event => {
                    if (!button.disabled) this.onAction(record.descriptor.id, { event, button, buttons: this.buttons });
                }, { signal: record.listeners.signal });
                this.records.set(action.id, record); this.buttons.set(action.id, button);
            }
            record.descriptor = action;
            const button = record.button;
            button.className = action.className || '';
            if (!this.renderIcon) button.textContent = action.label || action.id;
            if (action.title) button.title = action.title; else button.removeAttribute('title');
            if (action.ariaLabel) button.setAttribute('aria-label', action.ariaLabel); else button.removeAttribute('aria-label');
            button.classList.toggle('is-active', action.active === true);
            record.busy.setBusy(this.pending.has(action.id), { disabled: action.disabled === true });
            if (button === cursor) cursor = cursor.nextSibling;
            else this.root.insertBefore(button, cursor);
        }
        if (retainedFocus?.isConnected && !retainedFocus.disabled && this.root.ownerDocument.activeElement === this.root.ownerDocument.body) retainedFocus.focus({ preventScroll: true });
    }
    setPending(ids, pending) {
        this.assertAlive();
        if (!Array.isArray(ids) || typeof pending !== 'boolean') throw new TypeError('ActionGroup.setPending requires action IDs and a boolean.');
        for (const id of ids) {
            if (pending) this.pending.add(id); else this.pending.delete(id);
            const record = this.records.get(id);
            if (record) record.busy.setBusy(pending, { disabled: record.descriptor.disabled === true });
        }
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const record of this.records.values()) { record.listeners.abort(); record.busy.destroy(); }
        groups.delete(this.root); delete this.root.dataset.actionGroup;
        this.records.clear(); this.buttons.clear(); this.pending.clear();
        this.root = this.records = this.buttons = this.pending = this.onAction = this.renderIcon = null;
    }
}
