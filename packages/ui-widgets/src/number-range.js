/** Synchronize existing native range/number controls; callers own numeric policy. */
export class NumberRange {
    constructor(range, number, { normalize = value => value, onChange = null } = {}) {
        const view = range?.ownerDocument?.defaultView;
        if (!view || !(range instanceof view.HTMLInputElement) || range.type !== 'range' || !(number instanceof view.HTMLInputElement) || number.type !== 'number' || number.ownerDocument !== range.ownerDocument) throw new TypeError('NumberRange requires range and number inputs in the same document.');
        if (typeof normalize !== 'function') throw new TypeError('NumberRange normalize must be a function.');
        this.range = range;
        this.number = number;
        this.normalize = normalize;
        this.onChange = onChange;
        this.destroyed = false;
        this.listeners = new view.AbortController();
        const signal = this.listeners.signal;
        range.addEventListener('input', () => this.setValue(Number(range.value)), { signal });
        number.addEventListener('input', () => {
            const parsed = Number(number.value);
            if (Number.isFinite(parsed)) this.setValue(parsed);
        }, { signal });
        number.addEventListener('blur', () => this.setValue(Number(number.value)), { signal });
    }

    assertAlive() {
        if (this.destroyed) throw new Error('NumberRange has been destroyed. Create a new instance to remount.');
    }

    setValue(value, { notify = true } = {}) {
        this.assertAlive();
        if (!Number.isFinite(value)) throw new TypeError('NumberRange value must be a finite number.');
        const normalized = this.normalize(value);
        if (!Number.isFinite(normalized)) throw new TypeError('NumberRange normalize must return a finite number.');
        this.range.value = String(normalized);
        this.number.value = String(normalized);
        if (notify) this.onChange?.(normalized);
        return normalized;
    }

    setDisabled(disabled) {
        this.assertAlive();
        if (typeof disabled !== 'boolean') throw new TypeError('NumberRange.setDisabled requires a boolean.');
        this.range.disabled = this.number.disabled = disabled;
    }

    destroy() {
        if (this.destroyed) return;
        this.listeners.abort();
        this.range = this.number = this.normalize = this.onChange = this.listeners = null;
        this.destroyed = true;
    }
}
