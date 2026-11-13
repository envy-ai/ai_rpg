const meters = new WeakMap();

/** Present a supplied fraction and state; numeric estimation/normalization stays with callers. */
export class ProgressMeter {
    constructor(root, { fill = root?.firstElementChild, completeClass = '', waitingClass = '', contextClass = '' } = {}) {
        if (!root?.ownerDocument?.defaultView || !fill || !root.contains(fill)) throw new TypeError('ProgressMeter requires a root and contained fill.');
        if (meters.has(root)) throw new Error('ProgressMeter root already has an owner.');
        Object.assign(this, { root, fill, completeClass, waitingClass, contextClass });
        meters.set(root, this); root.dataset.progressMeter = '';
    }
    static attach(root, options) { return meters.get(root) || new ProgressMeter(root, options); }
    static destroyWithin(root) { for (const element of [root, ...root.querySelectorAll('[data-progress-meter]')]) meters.get(element)?.destroy(); }
    update({ fraction = 0, complete = false, waiting = false, context = false } = {}) {
        if (!this.root) throw new Error('ProgressMeter has been destroyed.');
        if (!Number.isFinite(fraction)) throw new TypeError('ProgressMeter fraction must be a finite number; supply a computed fraction, including explicit 0.');
        if (this.completeClass) this.root.classList.toggle(this.completeClass, complete);
        if (this.waitingClass) this.root.classList.toggle(this.waitingClass, waiting);
        if (this.contextClass) this.root.classList.toggle(this.contextClass, context && !complete && !waiting);
        const width = `${fraction * 100}%`;
        if (this.fill.style.width !== width) this.fill.style.width = width;
    }
    destroy() {
        if (!this.root) return;
        meters.delete(this.root); delete this.root.dataset.progressMeter;
        this.root = this.fill = this.completeClass = this.waitingClass = this.contextClass = null;
    }
}

/** Mirror one snapshot into an explicit set of supplied surfaces. */
export class ProgressMirrors {
    constructor({ document, classNames = {} }) {
        if (!document?.defaultView) throw new TypeError('ProgressMirrors requires a browser document.');
        this.document = document; this.classNames = classNames; this.entries = new Map();
    }
    update(targets, { active, fraction, waiting = false, context = false }) {
        if (!this.document) throw new Error('ProgressMirrors has been destroyed.');
        const retained = new Set(active ? targets : []);
        for (const [target, entry] of this.entries) if (!retained.has(target)) {
            entry.meter.destroy(); entry.bar.remove(); this.entries.delete(target);
        }
        for (const target of retained) {
            if (target.ownerDocument !== this.document) throw new TypeError('ProgressMirrors targets must belong to its document.');
            let entry = this.entries.get(target);
            if (entry && entry.bar.parentElement !== target) {
                entry.meter.destroy(); entry.bar.remove(); this.entries.delete(target); entry = null;
            }
            if (!entry) {
                const bar = this.document.createElement('div'), fill = this.document.createElement('div');
                bar.className = this.classNames.bar || 'progress-mirror';
                fill.className = this.classNames.fill || 'progress-mirror__fill';
                bar.setAttribute('aria-hidden', 'true'); bar.append(fill); target.append(bar);
                entry = { bar, meter: new ProgressMeter(bar, { fill, waitingClass: this.classNames.waiting || '', contextClass: this.classNames.context || 'progress-mirror--context' }) };
                this.entries.set(target, entry);
            }
            entry.meter.update({ fraction, waiting, context });
        }
    }
    destroy() {
        if (!this.document) return;
        this.update([], { active: false });
        this.document = this.entries = this.classNames = null;
    }
}
