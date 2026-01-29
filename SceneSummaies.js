class SceneSummaries {
    constructor() {
        this._scenes = [];
        this._entryIdToIndex = new Map();
        this._metadata = { version: 1, updatedAt: null };
    }

    clear() {
        this._scenes = [];
        this._entryIdToIndex.clear();
        this._metadata = { version: 1, updatedAt: null };
    }

    addSummaryResult(summaryResult) {
        if (!summaryResult || typeof summaryResult !== 'object') {
            throw new Error('Scene summary result is required.');
        }
        const scenes = summaryResult.scenes;
        if (!Array.isArray(scenes) || scenes.length === 0) {
            throw new Error('Scene summary result must include scenes.');
        }
        const entryIndexMap = summaryResult.entryIndexMap;
        if (!Array.isArray(entryIndexMap) || entryIndexMap.length === 0) {
            throw new Error('Scene summary result is missing entry index mapping.');
        }

        this.#ingestEntryIndexMap(entryIndexMap);

        for (const scene of scenes) {
            const normalized = this.#normalizeScene(scene);
            this._scenes.push(normalized);
        }

        this._metadata.updatedAt = new Date().toISOString();
        if (summaryResult.summarizedRange) {
            this._metadata.lastSummarizedRange = {
                start: summaryResult.summarizedRange.start,
                end: summaryResult.summarizedRange.end
            };
        }
    }

    containsEntry(entryId) {
        const normalizedId = typeof entryId === 'string' ? entryId.trim() : '';
        if (!normalizedId) {
            return false;
        }
        const index = this._entryIdToIndex.get(normalizedId);
        if (!Number.isInteger(index)) {
            return false;
        }
        return this._scenes.some(scene => scene.startIndex <= index && index <= scene.endIndex);
    }

    getFirstUnsummarizedIndex(totalEntries) {
        const total = Number(totalEntries);
        if (!Number.isInteger(total) || total <= 0) {
            throw new Error('Total entries must be a positive integer.');
        }
        if (this._scenes.length === 0) {
            return 1;
        }
        const ordered = this.getScenesInOrder();
        let cursor = 1;
        for (const scene of ordered) {
            if (scene.startIndex > cursor) {
                return cursor;
            }
            if (scene.endIndex >= cursor) {
                cursor = scene.endIndex + 1;
            }
            if (cursor > total) {
                return null;
            }
        }
        return cursor <= total ? cursor : null;
    }

    deleteSummariesOverlappingRange(startIndex, endIndex) {
        const start = Number(startIndex);
        const end = Number(endIndex);
        if (!Number.isInteger(start) || start <= 0) {
            throw new Error('Delete range start index must be a positive integer.');
        }
        if (!Number.isInteger(end) || end <= 0) {
            throw new Error('Delete range end index must be a positive integer.');
        }
        if (end < start) {
            throw new Error('Delete range end must be greater than or equal to start.');
        }

        const removed = [];
        const kept = [];
        for (const scene of this._scenes) {
            if (scene.startIndex <= end && scene.endIndex >= start) {
                removed.push(scene);
            } else {
                kept.push(scene);
            }
        }

        if (removed.length === 0) {
            return { start, end };
        }

        this._scenes = kept;
        this._metadata.updatedAt = new Date().toISOString();

        let removedStart = removed[0].startIndex;
        let removedEnd = removed[0].endIndex;
        for (const scene of removed) {
            if (scene.startIndex < removedStart) {
                removedStart = scene.startIndex;
            }
            if (scene.endIndex > removedEnd) {
                removedEnd = scene.endIndex;
            }
        }

        const baseStart = Math.min(start, removedStart);
        const baseEnd = Math.max(end, removedEnd);

        const overlaps = kept
            .filter(scene => scene.startIndex <= baseEnd && scene.endIndex >= baseStart)
            .map(scene => ({
                start: Math.max(scene.startIndex, baseStart),
                end: Math.min(scene.endIndex, baseEnd)
            }))
            .sort((a, b) => a.start - b.start);

        const merged = [];
        for (const interval of overlaps) {
            const last = merged[merged.length - 1];
            if (!last || interval.start > last.end + 1) {
                merged.push({ ...interval });
            } else if (interval.end > last.end) {
                last.end = interval.end;
            }
        }

        const gaps = [];
        let cursor = baseStart;
        for (const interval of merged) {
            if (interval.start > cursor) {
                gaps.push({ start: cursor, end: interval.start - 1 });
            }
            cursor = Math.max(cursor, interval.end + 1);
            if (cursor > baseEnd) {
                break;
            }
        }
        if (cursor <= baseEnd) {
            gaps.push({ start: cursor, end: baseEnd });
        }

        if (gaps.length === 0) {
            return { start: baseStart, end: baseEnd };
        }

        const gapStart = gaps[0].start;
        const gapEnd = gaps[gaps.length - 1].end;
        return { start: gapStart, end: gapEnd };
    }

    getScenes() {
        return this._scenes.map(scene => this.#cloneScene(scene));
    }

    getScenesInOrder() {
        return this.getScenes().sort((a, b) => a.startIndex - b.startIndex);
    }

    serialize() {
        return {
            version: 1,
            metadata: { ...this._metadata },
            scenes: this.getScenes(),
            entryIndexMap: Array.from(this._entryIdToIndex.entries()).map(([entryId, index]) => ({
                entryId,
                index
            }))
        };
    }

    load(data = {}) {
        this.clear();
        if (!data || typeof data !== 'object') {
            return;
        }

        const scenes = Array.isArray(data.scenes) ? data.scenes : [];
        const entryIndexMap = Array.isArray(data.entryIndexMap) ? data.entryIndexMap : [];
        if (scenes.length === 0 && entryIndexMap.length === 0) {
            return;
        }
        if (scenes.length === 0 || entryIndexMap.length === 0) {
            throw new Error('Scene summaries data is incomplete.');
        }

        this.#ingestEntryIndexMap(entryIndexMap);
        for (const scene of scenes) {
            const normalized = this.#normalizeScene(scene);
            this._scenes.push(normalized);
        }

        if (data.metadata && typeof data.metadata === 'object') {
            this._metadata = {
                ...this._metadata,
                ...data.metadata
            };
        }
    }

    #ingestEntryIndexMap(entryIndexMap) {
        for (const entry of entryIndexMap) {
            const entryId = typeof entry?.entryId === 'string' ? entry.entryId.trim() : '';
            const index = Number(entry?.index);
            if (!entryId) {
                throw new Error('Scene summary entryIndexMap entry is missing entryId.');
            }
            if (!Number.isInteger(index) || index <= 0) {
                throw new Error(`Scene summary entryIndexMap entry has invalid index for ${entryId}.`);
            }
            const existing = this._entryIdToIndex.get(entryId);
            if (existing !== undefined && existing !== index) {
                throw new Error(`Scene summary entryIndexMap index mismatch for ${entryId}.`);
            }
            this._entryIdToIndex.set(entryId, index);
        }
    }

    #normalizeScene(scene) {
        if (!scene || typeof scene !== 'object') {
            throw new Error('Scene summary entry is invalid.');
        }
        const startIndex = Number(scene.startIndex);
        const endIndex = Number(scene.endIndex);
        if (!Number.isInteger(startIndex) || startIndex <= 0) {
            throw new Error('Scene summary entry is missing a valid startIndex.');
        }
        if (!Number.isInteger(endIndex) || endIndex < startIndex) {
            throw new Error('Scene summary entry is missing a valid endIndex.');
        }
        const startEntryId = typeof scene.startEntryId === 'string' ? scene.startEntryId.trim() : '';
        const endEntryId = typeof scene.endEntryId === 'string' ? scene.endEntryId.trim() : '';
        if (!startEntryId) {
            throw new Error('Scene summary entry is missing a startEntryId.');
        }
        if (!endEntryId) {
            throw new Error('Scene summary entry is missing an endEntryId.');
        }
        const summary = typeof scene.summary === 'string' ? scene.summary.trim() : '';
        if (!summary) {
            throw new Error('Scene summary entry is missing a summary.');
        }
        const quotes = Array.isArray(scene.quotes) ? scene.quotes : [];
        const normalizedQuotes = quotes.map((quote) => {
            if (!quote || typeof quote !== 'object') {
                throw new Error('Scene summary quote is invalid.');
            }
            const character = typeof quote.character === 'string' ? quote.character.trim() : '';
            const text = typeof quote.text === 'string' ? quote.text.trim() : '';
            if (!character || !text) {
                throw new Error('Scene summary quote is missing character or text.');
            }
            return { character, text };
        });

        return {
            startIndex,
            endIndex,
            startEntryId,
            endEntryId,
            summary,
            quotes: normalizedQuotes
        };
    }

    #cloneScene(scene) {
        return {
            startIndex: scene.startIndex,
            endIndex: scene.endIndex,
            startEntryId: scene.startEntryId,
            endEntryId: scene.endEntryId,
            summary: scene.summary,
            quotes: Array.isArray(scene.quotes)
                ? scene.quotes.map(quote => ({ character: quote.character, text: quote.text }))
                : []
        };
    }
}

module.exports = SceneSummaries;
