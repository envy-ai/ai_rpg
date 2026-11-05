import { setFieldState } from './field.js';
const owners = new WeakMap();

/** Native sentinel/custom-entry pair with explicit host edit eligibility. */
export class OtherEntry {
    constructor(select, input, { otherValue, enabled, focusEmpty = true } = {}) {
        const view = select?.ownerDocument?.defaultView;
        if (!view || !(select instanceof view.HTMLSelectElement) || !(input instanceof view.HTMLInputElement) || input.type !== 'text' || input.ownerDocument !== select.ownerDocument) throw new TypeError('OtherEntry requires a select and type="text" input in the same document.');
        if (typeof otherValue !== 'string' || !otherValue || typeof enabled !== 'boolean' || typeof focusEmpty !== 'boolean') throw new TypeError('OtherEntry requires a nonempty otherValue and explicit enabled/focusEmpty booleans.');
        if (owners.has(select) || owners.has(input)) throw new Error('OtherEntry controls already have an owner. Destroy it before binding again.');
        Object.assign(this, { select, input, otherValue, enabled, focusEmpty });
        this.labels = Array.from(input.labels);
        this.destroyed = false;
        this.listeners = new view.AbortController();
        owners.set(select, this);
        owners.set(input, this);
        select.addEventListener('change', () => this.sync(), { signal: this.listeners.signal });
        this.sync();
    }

    assertAlive() { if (this.destroyed) throw new Error('OtherEntry has been destroyed. Create a new owner before using these controls.'); }

    sync() {
        this.assertAlive();
        const active = this.select.value === this.otherValue;
        setFieldState(this.input, { visible: active, disabled: !active || !this.enabled }, { visibility: 'display' });
        for (const label of this.labels) setFieldState(label, { visible: active }, { visibility: 'display' });
        if (active && this.enabled && this.focusEmpty && !this.input.value) this.input.focus();
    }

    setEnabled(enabled) {
        this.assertAlive();
        if (typeof enabled !== 'boolean') throw new TypeError('OtherEntry.setEnabled requires explicit true or false host eligibility.');
        this.enabled = enabled;
        this.sync();
    }

    destroy() {
        if (this.destroyed) return;
        this.listeners.abort();
        owners.delete(this.select);
        owners.delete(this.input);
        this.destroyed = true;
        this.select = this.input = this.labels = this.listeners = null;
    }
}
