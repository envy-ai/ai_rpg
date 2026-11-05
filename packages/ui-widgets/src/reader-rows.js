import { Repeater } from './repeater.js';

const owners = new WeakMap();
const roots = new WeakMap();

/** Native row ownership and ordered readers; markup and validation remain callers'. */
export class ReaderRows {
    constructor(root) {
        if (roots.has(root)) throw new Error('ReaderRows root already has an owner. Destroy it before remounting.');
        this.root = root;
        this.entries = new Map();
        this.destroyed = false;
        this.clearing = false;
        this.repeater = new Repeater(root, {
            onChange: ({ action, row }) => {
                if (action === 'remove') this.release(row);
            }
        });
        this.listeners = new root.ownerDocument.defaultView.AbortController();
        roots.set(root, this);
        root.dataset.readerRows = '';
    }

    static destroyWithin(root) {
        if (!root?.querySelectorAll) throw new TypeError('ReaderRows.destroyWithin requires a DOM subtree.');
        const errors = [];
        for (const candidate of [root, ...root.querySelectorAll('[data-reader-rows]')]) {
            try { roots.get(candidate)?.destroy(); } catch (error) { errors.push(error); }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'ReaderRows failed to dispose nested row owners.', { cause: errors[0] });
    }

    assertAlive() {
        if (this.destroyed) throw new Error('ReaderRows has been destroyed. Create a new owner to remount.');
        if (this.clearing) throw new Error('ReaderRows is releasing its rows. Wait for clear() to finish before adding, removing or reading rows.');
    }

    get signal() {
        this.assertAlive();
        return this.listeners.signal;
    }

    add(row, read, { dispose = null, removeButton = null } = {}) {
        this.assertAlive();
        const view = this.root.ownerDocument.defaultView;
        if (!(row instanceof view.HTMLElement) || row.ownerDocument !== this.root.ownerDocument || row.contains(this.root)) throw new TypeError('ReaderRows.add requires a native HTML row in its root document, separate from the root.');
        if (owners.has(row)) throw new Error('ReaderRows.add cannot adopt an already owned row. Remove it through its current owner before adding it.');
        if (row.parentElement && row.parentElement !== this.root) throw new Error('ReaderRows.add cannot adopt a row from another parent. Supply a detached row or a direct child of this root.');
        if (typeof read !== 'function') throw new TypeError('ReaderRows.add requires a reader function.');
        if (dispose !== null && typeof dispose !== 'function') throw new TypeError('ReaderRows dispose must be a function when supplied.');
        if (removeButton !== null && (!(removeButton instanceof view.HTMLButtonElement) || !row.contains(removeButton))) throw new TypeError('ReaderRows removeButton must be a native button inside its row.');
        const listeners = new view.AbortController();
        this.entries.set(row, { read, dispose, listeners });
        owners.set(row, this);
        this.repeater.add(row, { notify: false });
        removeButton?.addEventListener('click', () => this.remove(row), { signal: listeners.signal });
        return row;
    }

    remove(row) {
        this.assertAlive();
        if (!this.entries.has(row) || row.parentElement !== this.root) throw new Error('ReaderRows.remove requires a registered direct child row.');
        this.repeater.remove(row, { restoreFocus: false });
    }

    read() {
        this.assertAlive();
        const rows = Array.from(this.root.children);
        if (rows.length !== this.entries.size || rows.some(row => !this.entries.has(row))) throw new Error('ReaderRows root has unregistered or detached rows. Use add/remove to change its rows before reading.');
        return rows.map(row => { const { read } = this.entries.get(row); return read(); });
    }

    release(row) {
        const entry = this.entries?.get(row);
        if (!entry) return;
        this.entries.delete(row);
        owners.delete(row);
        entry.listeners.abort();
        const { dispose } = entry;
        dispose?.();
    }

    releaseAll() {
        const errors = [];
        for (const row of [...this.entries.keys()]) {
            try { this.release(row); } catch (error) { errors.push(error); }
        }
        return errors;
    }

    finishErrors(errors) {
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'ReaderRows failed to dispose multiple owned rows.', { cause: errors[0] });
    }

    clear() {
        if (this.clearing) return;
        this.assertAlive();
        this.clearing = true;
        const root = this.root;
        const errors = this.releaseAll();
        try {
            if (this.destroyed) root.replaceChildren();
            else this.repeater.clear();
        } finally {
            this.clearing = false;
        }
        this.finishErrors(errors);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.listeners.abort();
        const errors = this.releaseAll();
        this.repeater.destroy();
        roots.delete(this.root);
        delete this.root.dataset.readerRows;
        this.entries = this.listeners = this.repeater = this.root = null;
        this.finishErrors(errors);
    }
}
