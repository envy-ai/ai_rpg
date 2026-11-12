(function (root, factory) {
    const exported = factory();
    if (typeof module === 'object' && module.exports) module.exports = exported;
    else if (root.SEQUENTIAL_IDS_ENABLED === true) {
        if (!root.SEQUENTIAL_ID_BOOTSTRAP) throw new Error('Sequential ID capability requires server-owned bootstrap ranges.');
        root.SequentialIds = new exported.SequentialIdClient({
            ranges: root.SEQUENTIAL_ID_BOOTSTRAP.ranges,
            reserve: async category => {
                const response = await root.fetch('/api/ids/reserve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }) });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || `Sequential ID reservation failed (${response.status}).`);
                return result.range;
            },
            onError: error => root.dispatchEvent(new ErrorEvent('error', { error, message: error.message }))
        });
    }
})(typeof window === 'undefined' ? globalThis : window, function () {
    'use strict';
    class SequentialIdClient {
        constructor({ ranges, reserve, onError = error => { throw error; } }) {
            if (!Array.isArray(ranges) || typeof reserve !== 'function') throw new Error('Sequential IDs require bootstrap ranges and an asynchronous reservation function.');
            this.ranges = new Map();
            this.reservedEnds = new Map();
            this.pending = new Map();
            this.failures = new Map();
            this.reserve = reserve;
            this.onError = onError;
            for (const range of ranges) this.#append(range);
        }
        #append(range) {
            if (!range || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(range.category) || !Number.isSafeInteger(range.start) || range.start < 1 || !Number.isSafeInteger(range.end) || range.end < range.start) throw new Error('Sequential ID reservation returned an invalid category or integer range.');
            const entries = this.ranges.get(range.category) || [];
            if (range.start <= (this.reservedEnds.get(range.category) || 0)) throw new Error(`Sequential ID reservation overlaps an existing or consumed ${range.category} range.`);
            entries.push({ ...range, next: range.start });
            this.ranges.set(range.category, entries);
            this.reservedEnds.set(range.category, range.end);
        }
        #refill(category) {
            if (this.pending.has(category) || this.failures.has(category)) return;
            const pending = Promise.resolve().then(() => this.reserve(category)).then(range => {
                if (range?.category !== category) throw new Error(`Sequential ID reservation returned the wrong category for ${category}.`);
                this.#append(range);
            }).catch(error => {
                this.failures.set(category, error);
                this.onError(error);
            }).finally(() => this.pending.delete(category));
            this.pending.set(category, pending);
        }
        next(category) {
            if (this.failures.has(category)) throw new Error(`Sequential ID allocation for ${category} failed; reload after resolving the reservation error.`, { cause: this.failures.get(category) });
            const entries = this.ranges.get(category);
            if (!entries) throw new Error(`Sequential ID bootstrap has no ${category} range.`);
            while (entries.length && entries[0].next > entries[0].end) entries.shift();
            if (!entries.length) throw new Error(`Sequential ID range for ${category} is exhausted; await its reservation or reload. No alternate ID was generated.`);
            const range = entries[0];
            const id = `${category}_${range.next++}`;
            const remaining = entries.reduce((sum, value) => sum + value.end - value.next + 1, 0);
            if (remaining <= 128) this.#refill(category);
            return id;
        }
    }
    return { SequentialIdClient };
});
