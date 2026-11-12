'use strict';

const fs = require('fs');
const path = require('path');

const CATEGORY = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const ID = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)*)_([1-9]\d*)$/;

/** Durable ranges are claimed with exclusive file creation, independently of saves. */
class OperationalIdAllocator {
    constructor({ directory = process.env.AIRPG_ID_STORE_DIR || path.join(__dirname, 'runtime-id-leases') } = {}) {
        this.directory = path.resolve(directory);
        Object.defineProperty(this, 'blockSize', { value: 1024 });
        this.ranges = new Map();
        this.highWater = new Map();
        this.claims = new Set();
        this.initialized = false;
    }

    #category(category) {
        if (typeof category !== 'string' || !CATEGORY.test(category)) throw new Error('Sequential ID category must be lowercase snake_case text, starting with a letter.');
        return category;
    }

    #initialize() {
        if (this.initialized) return;
        fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
            const filename = entry.name;
            const match = /^(.*)\.([1-9]\d*)\.lease$/.exec(filename);
            if (!entry.isFile() || !match || !CATEGORY.test(match[1]) || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) % this.blockSize !== 0) throw new Error(`Invalid sequential ID lease ${filename}; restore the allocator store before generating IDs.`);
            const end = Number(match[2]);
            this.claims.add(filename);
            this.highWater.set(match[1], Math.max(this.highWater.get(match[1]) || 0, end));
        }
        this.initialized = true;
    }

    #claim(category, minimum = 0) {
        this.#initialize();
        let end = Math.max(this.highWater.get(category) || 0, minimum) + this.blockSize;
        while (true) {
            if (!Number.isSafeInteger(end)) throw new Error(`Sequential ID counter exhausted for ${category}.`);
            const filename = path.join(this.directory, `${category}.${end}.lease`);
            let descriptor;
            try { descriptor = fs.openSync(filename, 'wx', 0o600); }
            catch (error) {
                if (error.code !== 'EEXIST') throw error;
                end += this.blockSize;
                continue;
            }
            try { fs.fsyncSync(descriptor); }
            finally { fs.closeSync(descriptor); }
            const directoryDescriptor = fs.openSync(this.directory, 'r');
            try { fs.fsyncSync(directoryDescriptor); }
            finally { fs.closeSync(directoryDescriptor); }
            this.highWater.set(category, end);
            this.claims.add(`${category}.${end}.lease`);
            return { category, next: end - this.blockSize + 1, end };
        }
    }

    reserve(category, count = this.blockSize) {
        this.#category(category);
        if (!Number.isSafeInteger(count) || count < 1 || count > this.blockSize) throw new Error(`Sequential ID reservation count must be an integer from 1 through the block size (${this.blockSize}); request another independent range for more IDs.`);
        this.#initialize();
        // Every reservation gets whole exclusive blocks; discarded tails stay consumed.
        const range = this.#claim(category);
        return { category, start: range.next, end: range.end };
    }

    next(category) {
        this.#category(category);
        let range = this.ranges.get(category);
        if (!range || range.next > range.end) {
            range = this.#claim(category);
            this.ranges.set(category, range);
        }
        return `${category}_${range.next++}`;
    }

    discardRanges() {
        this.ranges.clear();
    }

    register(id) {
        if (typeof id !== 'string') return;
        const match = ID.exec(id);
        if (!match) return;
        const ordinal = Number(match[2]);
        if (!Number.isSafeInteger(ordinal)) throw new Error(`Sequential ID ${id} exceeds the safe integer counter range.`);
        const category = match[1];
        this.#initialize();
        // Reserve the exact block containing an imported ID, including against
        // other processes whose next block candidate predates this import.
        const end = Math.ceil(ordinal / this.blockSize) * this.blockSize;
        if (!Number.isSafeInteger(end)) throw new Error(`Sequential ID counter exhausted for ${category}.`);
        const filename = `${category}.${end}.lease`;
        const range = this.ranges.get(category);
        if (range && ordinal >= range.next && ordinal <= range.end) range.next = ordinal + 1;
        if (this.claims.has(filename)) return;
        let descriptor;
        try { descriptor = fs.openSync(path.join(this.directory, filename), 'wx', 0o600); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        if (descriptor !== undefined) {
            try { fs.fsyncSync(descriptor); }
            finally { fs.closeSync(descriptor); }
            const directoryDescriptor = fs.openSync(this.directory, 'r');
            try { fs.fsyncSync(directoryDescriptor); }
            finally { fs.closeSync(directoryDescriptor); }
        }
        if (range && end > range.end) this.ranges.delete(category);
        this.claims.add(filename);
        this.highWater.set(category, Math.max(this.highWater.get(category) || 0, end));
    }
}

let singleton;
function getOperationalIdAllocator() {
    singleton ||= new OperationalIdAllocator();
    return singleton;
}

module.exports = { OperationalIdAllocator, getOperationalIdAllocator };
