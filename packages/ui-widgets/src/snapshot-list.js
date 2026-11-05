/** Reconcile caller-owned keyed snapshots without knowing their schema or transport. */
export class SnapshotList {
    constructor(root, { key = record => record.id, create, update, dispose = null } = {}) {
        if (!root?.ownerDocument?.defaultView || typeof create !== 'function' || typeof update !== 'function') throw new TypeError('SnapshotList requires an HTML root, create and update callbacks.');
        Object.assign(this, { root, key, create, update, dispose });
        this.entries = new Map(); this.destroyed = false; this.clearing = false; this.rendering = false;
    }
    assertAlive() { if (this.destroyed) throw new Error('SnapshotList has been destroyed.'); }
    release(entry) {
        const errors = [];
        const dispose = this.dispose;
        try { entry.dispose?.(); } catch (error) { errors.push(error); }
        try { dispose?.(entry.element); } catch (error) { errors.push(error); }
        entry.element.remove();
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'SnapshotList row disposal failed.', { cause: errors[0] });
    }
    render(records) {
        this.assertAlive();
        if (this.rendering || this.clearing) throw new Error('SnapshotList cannot render during rendering or disposal.');
        if (!Array.isArray(records)) throw new TypeError('SnapshotList.render requires records.');
        const keys = records.map(this.key);
        if (keys.some(key => typeof key !== 'string' || !key) || new Set(keys).size !== keys.length) throw new Error('SnapshotList records require unique nonempty string keys.');
        this.rendering = true;
        try {
            let cursor = this.root.firstChild;
            records.forEach((record, index) => {
                const key = keys[index];
                let entry = this.entries.get(key);
                if (!entry) {
                    const built = this.create(record);
                    this.assertAlive();
                    const element = built?.element || built;
                    if (!(element instanceof this.root.ownerDocument.defaultView.HTMLElement)) throw new TypeError('SnapshotList create must return an HTML element or {element,dispose}.');
                    entry = { element, dispose: built.dispose };
                    this.entries.set(key, entry);
                }
                this.update(entry.element, record);
                this.assertAlive();
                if (entry.element === cursor) cursor = cursor.nextSibling;
                else this.root.insertBefore(entry.element, cursor);
            });
            const retained = new Set(keys);
            const errors = [];
            for (const [key, entry] of this.entries) if (!retained.has(key)) {
                this.entries.delete(key);
                try { this.release(entry); } catch (error) { errors.push(error); }
                if (this.destroyed) break;
            }
            if (errors.length === 1) throw errors[0];
            if (errors.length) throw new AggregateError(errors, 'SnapshotList removal failed.', { cause: errors[0] });
        } finally { this.rendering = false; }
    }
    clear() {
        this.assertAlive();
        this.releaseAll();
    }
    releaseAll() {
        if (this.clearing) return;
        this.clearing = true;
        const root = this.root, entries = this.entries, dispose = this.dispose;
        this.entries = new Map();
        const errors = [];
        for (const entry of entries.values()) {
            try { entry.dispose?.(); } catch (error) { errors.push(error); }
            try { dispose?.(entry.element); } catch (error) { errors.push(error); }
        }
        root.replaceChildren(); this.clearing = false;
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'SnapshotList disposal failed.', { cause: errors[0] });
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        try { this.releaseAll(); }
        finally { this.root = this.entries = this.key = this.create = this.update = this.dispose = null; }
    }
}
