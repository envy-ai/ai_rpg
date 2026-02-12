class SceneSummaries {
    constructor() {
        this._scenes = [];
        this._entryIdToIndex = new Map();
        this._entryIdToNpcNames = new Map();
        this._metadata = { version: 1, updatedAt: null };
    }

    clear() {
        this._scenes = [];
        this._entryIdToIndex.clear();
        this._entryIdToNpcNames.clear();
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

        const normalizedScenes = [];
        for (const scene of scenes) {
            const normalized = this.#normalizeScene(scene);
            normalizedScenes.push(normalized);
        }

        let replacementStart = normalizedScenes[0].startIndex;
        let replacementEnd = normalizedScenes[0].endIndex;
        for (const scene of normalizedScenes) {
            if (scene.startIndex < replacementStart) {
                replacementStart = scene.startIndex;
            }
            if (scene.endIndex > replacementEnd) {
                replacementEnd = scene.endIndex;
            }
        }

        this._scenes = this._scenes.filter(scene => {
            if (!scene || typeof scene !== 'object') {
                return false;
            }
            return scene.endIndex < replacementStart || scene.startIndex > replacementEnd;
        });

        for (const scene of normalizedScenes) {
            this._scenes.push(scene);
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

    ingestNpcNamesFromEntries(entries = []) {
        if (!Array.isArray(entries)) {
            throw new Error('Entries list must be an array.');
        }

        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            const entryId = typeof entry.id === 'string' ? entry.id.trim() : '';
            if (!entryId || !this._entryIdToIndex.has(entryId)) {
                continue;
            }
            const npcNames = Array.isArray(entry?.metadata?.npcNames)
                ? entry.metadata.npcNames
                    .map(name => (typeof name === 'string' ? name.trim() : ''))
                    .filter(Boolean)
                : [];
            if (!npcNames.length) {
                continue;
            }
            this._entryIdToNpcNames.set(entryId, npcNames);
        }
    }

    getAbsentCharactersByScene(characterNames = []) {
        if (!Array.isArray(characterNames)) {
            throw new Error('Character list must be an array of names.');
        }
        const normalizedNames = [];
        const seenNames = new Set();
        for (const name of characterNames) {
            if (typeof name !== 'string') {
                throw new Error('Character list must contain only string names.');
            }
            const trimmed = name.trim();
            if (!trimmed || seenNames.has(trimmed)) {
                continue;
            }
            normalizedNames.push(trimmed);
            seenNames.add(trimmed);
        }

        const scenes = this.getScenesInOrder();
        const absentByScene = new Map();
        if (scenes.length === 0) {
            return absentByScene;
        }

        const indexToNpcNames = new Map();
        for (const [entryId, index] of this._entryIdToIndex.entries()) {
            if (!Number.isInteger(index) || index <= 0) {
                continue;
            }
            const npcNames = this._entryIdToNpcNames.get(entryId);
            if (!Array.isArray(npcNames) || npcNames.length === 0) {
                continue;
            }
            indexToNpcNames.set(index, npcNames);
        }

        for (const scene of scenes) {
            const present = new Set();
            for (let idx = scene.startIndex; idx <= scene.endIndex; idx += 1) {
                const names = indexToNpcNames.get(idx);
                if (!names) {
                    continue;
                }
                for (const name of names) {
                    if (typeof name === 'string' && name.trim()) {
                        present.add(name.trim());
                    }
                }
            }
            const absent = normalizedNames.filter(name => !present.has(name));
            absentByScene.set(scene.startIndex, absent);
        }

        return absentByScene;
    }

    serialize() {
        return {
            version: 1,
            metadata: { ...this._metadata },
            scenes: this.getScenes(),
            entryIndexMap: Array.from(this._entryIdToIndex.entries())
                .map(([entryId, index]) => {
                    const npcNames = this._entryIdToNpcNames.get(entryId);
                    return {
                        entryId,
                        index,
                        npcNames: Array.isArray(npcNames) ? npcNames.slice() : undefined
                    };
                })
                .sort((a, b) => a.index - b.index)
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
            const npcNames = Array.isArray(entry?.npcNames)
                ? entry.npcNames
                    .map(name => (typeof name === 'string' ? name.trim() : ''))
                    .filter(Boolean)
                : [];
            const existing = this._entryIdToIndex.get(entryId);
            if (existing !== undefined && existing !== index) {
                throw new Error(`Scene summary entryIndexMap index mismatch for ${entryId}.`);
            }
            this._entryIdToIndex.set(entryId, index);
            if (npcNames.length) {
                this._entryIdToNpcNames.set(entryId, npcNames);
            } else {
                this._entryIdToNpcNames.delete(entryId);
            }
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
        const details = scene.details === undefined ? [] : scene.details;
        if (!Array.isArray(details)) {
            throw new Error('Scene summary entry details must be an array when provided.');
        }
        const normalizedDetails = details
            .map((detail) => {
                if (typeof detail !== 'string') {
                    throw new Error('Scene summary detail must be a string.');
                }
                return detail.trim();
            })
            .filter(Boolean);
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
            details: normalizedDetails,
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
            details: Array.isArray(scene.details) ? scene.details.slice() : [],
            quotes: Array.isArray(scene.quotes)
                ? scene.quotes.map(quote => ({ character: quote.character, text: quote.text }))
                : []
        };
    }
}

module.exports = SceneSummaries;
