/** An adopted graph viewport with an injected engine and explicit active-generation resources. */
export class GraphHost {
    constructor(root, { createEngine = null, destroyEngine = engine => engine.destroy(), statusClasses = {} } = {}) {
        const view = root?.ownerDocument?.defaultView;
        if (!view || !(root instanceof view.HTMLElement)) throw new TypeError('GraphHost requires an HTML root.');
        if (createEngine !== null && typeof createEngine !== 'function') throw new TypeError('GraphHost createEngine must be a function when supplied.');
        if (typeof destroyEngine !== 'function') throw new TypeError('GraphHost destroyEngine must be a function.');
        Object.assign(this, { root, createEngine, destroyEngine, statusClasses });
        this.active = null;
        this.destroyed = false;
        this.releasing = false;
        this.mounting = false;
    }

    assertAlive() { if (this.destroyed) throw new Error('GraphHost has been destroyed. Create a new owner before mounting.'); }
    requireActive() {
        this.assertAlive();
        if (!this.active) throw new Error('GraphHost requires an active engine generation. Call mount first.');
        return this.active;
    }
    get engine() { this.assertAlive(); return this.active?.engine || null; }
    get signal() { return this.requireActive().listeners.signal; }

    mount(engine) {
        this.assertAlive();
        if (this.releasing || this.mounting) throw new Error('GraphHost cannot mount during engine creation or disposal.');
        if (engine === undefined && !this.createEngine) throw new Error('GraphHost.mount requires an injected engine or createEngine factory.');
        this.clear();
        this.assertAlive();
        const root = this.root;
        const active = { engine: null, listeners: new root.ownerDocument.defaultView.AbortController(), resources: new Set(), timers: new Set() };
        this.active = active;
        this.mounting = true;
        const destroyEngine = this.destroyEngine;
        try {
            const created = engine === undefined ? this.createEngine(root, { signal: active.listeners.signal }) : engine;
            if (!created || !['object', 'function'].includes(typeof created)) throw new TypeError('GraphHost engine factory must return an engine object.');
            if (this.destroyed || this.active !== active) {
                destroyEngine(created);
                throw new Error('GraphHost was disposed while its engine was being created.');
            }
            active.engine = created;
            return created;
        } catch (error) {
            const errors = [error];
            try { this.releaseActive(); } catch (cleanupError) { errors.push(cleanupError); }
            try { root.replaceChildren(); } catch (cleanupError) { errors.push(cleanupError); }
            if (errors.length > 1) throw new AggregateError(errors, 'GraphHost engine creation and cleanup failed.', { cause: error });
            throw error;
        } finally { this.mounting = false; }
    }

    own(dispose) {
        const active = this.requireActive();
        if (typeof dispose !== 'function') throw new TypeError('GraphHost.own requires a disposal function.');
        const release = () => {
            if (!dispose) return;
            const callback = dispose;
            dispose = null;
            active.resources.delete(release);
            callback();
        };
        active.resources.add(release);
        return release;
    }

    listen(target, type, callback, options = {}) {
        const active = this.requireActive();
        if (!target?.addEventListener) throw new TypeError('GraphHost.listen requires a DOM event target.');
        const nativeOptions = typeof options === 'boolean' ? { capture: options } : options || {};
        if (nativeOptions.signal) throw new TypeError('GraphHost.listen owns its AbortSignal; do not supply another signal.');
        target.addEventListener(type, this.guard(callback), { ...nativeOptions, signal: active.listeners.signal });
    }

    guard(callback) {
        const active = this.requireActive();
        if (typeof callback !== 'function') throw new TypeError('GraphHost.guard requires a callback.');
        const owner = this;
        return function (...args) {
            if (!owner.destroyed && owner.active === active) return callback.apply(this, args);
        };
    }

    defer(callback, delay = 0) {
        const active = this.requireActive();
        const view = this.root.ownerDocument.defaultView;
        const guarded = this.guard(callback);
        const timer = view.setTimeout(() => { active.timers.delete(timer); guarded(); }, delay);
        active.timers.add(timer);
        return () => { active.timers.delete(timer); view.clearTimeout(timer); };
    }

    releaseActive() {
        const active = this.active;
        if (!active || this.releasing) return;
        this.active = null;
        this.releasing = true;
        const view = this.root.ownerDocument.defaultView;
        const destroyEngine = this.destroyEngine;
        const errors = [];
        active.listeners.abort();
        for (const timer of active.timers) view.clearTimeout(timer);
        active.timers.clear();
        try {
            for (const release of [...active.resources].reverse()) {
                try { release(); } catch (error) { errors.push(error); }
            }
            if (active.engine) {
                try { destroyEngine(active.engine); } catch (error) { errors.push(error); }
                active.engine = null;
            }
        } finally { this.releasing = false; }
        if (errors.length === 1) throw errors[0];
        if (errors.length) throw new AggregateError(errors, 'GraphHost resource disposal failed.', { cause: errors[0] });
    }

    clear() {
        this.assertAlive();
        if (this.releasing) return;
        const root = this.root;
        const statusClasses = this.statusClasses;
        try { this.releaseActive(); }
        finally {
            root.replaceChildren();
            for (const className of Object.values(statusClasses)) if (className) root.classList.remove(className);
        }
    }

    status(content, { kind = 'info' } = {}) {
        this.assertAlive();
        const view = this.root.ownerDocument.defaultView;
        if (typeof content !== 'string' && (!(content instanceof view.HTMLElement) || content.ownerDocument !== this.root.ownerDocument)) throw new TypeError('GraphHost.status requires text or an HTML element in its document.');
        this.clear();
        this.assertAlive();
        const { root, statusClasses } = this;
        if (statusClasses.status) root.classList.add(statusClasses.status);
        if (statusClasses.error) root.classList.toggle(statusClasses.error, kind === 'error');
        if (typeof content === 'string') root.textContent = content;
        else root.append(content);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        const root = this.root;
        const statusClasses = this.statusClasses;
        try { this.releaseActive(); }
        finally {
            root.replaceChildren();
            for (const className of Object.values(statusClasses)) if (className) root.classList.remove(className);
            this.root = this.createEngine = this.destroyEngine = this.statusClasses = null;
        }
    }
}
