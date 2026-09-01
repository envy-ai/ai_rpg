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
        const staged = new SceneSummaries();
        staged._scenes = this.getScenes();
        staged._entryIdToIndex = new Map(this._entryIdToIndex);
        staged._entryIdToNpcNames = new Map(
            Array.from(this._entryIdToNpcNames.entries()).map(([entryId, npcNames]) => [
                entryId,
                Array.isArray(npcNames) ? npcNames.slice() : npcNames
            ])
        );
        staged._metadata = { ...this._metadata };
        if (this._metadata.lastSummarizedRange) {
            staged._metadata.lastSummarizedRange = { ...this._metadata.lastSummarizedRange };
        }

        staged.#applySummaryResult(summaryResult);

        this._scenes = staged._scenes;
        this._entryIdToIndex = staged._entryIdToIndex;
        this._entryIdToNpcNames = staged._entryIdToNpcNames;
        this._metadata = staged._metadata;
    }

    #applySummaryResult(summaryResult) {
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

        if (summaryResult.summarizedRange) {
            const summarizedStart = Number(summaryResult.summarizedRange.start);
            const summarizedEnd = Number(summaryResult.summarizedRange.end);
            if (!Number.isInteger(summarizedStart) || summarizedStart <= 0) {
                throw new Error('Scene summary summarizedRange is missing a valid start.');
            }
            if (!Number.isInteger(summarizedEnd) || summarizedEnd < summarizedStart) {
                throw new Error('Scene summary summarizedRange is missing a valid end.');
            }
            replacementStart = summarizedStart;
            replacementEnd = summarizedEnd;
        }

        const partialOverlap = this._scenes.find(scene => (
            scene
            && typeof scene === 'object'
            && scene.startIndex <= replacementEnd
            && scene.endIndex >= replacementStart
            && (scene.startIndex < replacementStart || scene.endIndex > replacementEnd)
        ));
        if (partialOverlap) {
            throw new Error(
                `Scene summary replacement range ${replacementStart}-${replacementEnd} partially overlaps `
                + `stored scene ${partialOverlap.startIndex}-${partialOverlap.endIndex}.`
            );
        }

        this.#removeEntryMappingsInRange(replacementStart, replacementEnd);
        this.#ingestEntryIndexMap(entryIndexMap);
        this.#anchorScenesToSummarizedRange(normalizedScenes, summaryResult.summarizedRange);

        for (const mapping of entryIndexMap) {
            const index = Number(mapping?.index);
            if (!normalizedScenes.some(scene => scene.startIndex <= index && index <= scene.endIndex)) {
                throw new Error(
                    `Scene summary entryIndexMap index ${index} lies outside the committed scene coverage `
                    + `${replacementStart}-${replacementEnd}.`
                );
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

        this.#pruneEntryMappingsToStoredScenes();
        this.#validateStoredMappingCoverage();

        this._metadata.updatedAt = new Date().toISOString();
        if (summaryResult.summarizedRange) {
            this._metadata.lastSummarizedRange = {
                start: summaryResult.summarizedRange.start,
                end: summaryResult.summarizedRange.end
            };
        }
    }

    replaceWithSummaryResult(summaryResult) {
        const replacement = new SceneSummaries();
        replacement.addSummaryResult(summaryResult);

        this._scenes = replacement._scenes;
        this._entryIdToIndex = replacement._entryIdToIndex;
        this._entryIdToNpcNames = replacement._entryIdToNpcNames;
        this._metadata = replacement._metadata;
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

    getContiguousSummarizedEndIndex() {
        if (this._scenes.length === 0) {
            return 0;
        }

        const ordered = this.getScenesInOrder();
        let cursor = 1;
        for (const scene of ordered) {
            if (scene.startIndex > cursor) {
                break;
            }
            if (scene.endIndex >= cursor) {
                cursor = scene.endIndex + 1;
            }
        }
        return cursor - 1;
    }

    getFirstUnsummarizedIndex(totalEntries) {
        const total = Number(totalEntries);
        if (!Number.isInteger(total) || total <= 0) {
            throw new Error('Total entries must be a positive integer.');
        }
        const summarizedEndIndex = this.getContiguousSummarizedEndIndex();
        return summarizedEndIndex >= total ? null : summarizedEndIndex + 1;
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
        this.#pruneEntryMappingsToStoredScenes();
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

    invalidateFromEntryIds(entryIds = []) {
        if (!Array.isArray(entryIds)) {
            throw new Error('Scene summary invalidation entry ids must be an array.');
        }
        const indexes = entryIds
            .map(entryId => (typeof entryId === 'string' ? entryId.trim() : ''))
            .filter(Boolean)
            .map(entryId => this._entryIdToIndex.get(entryId))
            .filter(index => Number.isInteger(index) && index > 0);
        if (!indexes.length) {
            return null;
        }

        const earliestIndex = Math.min(...indexes);
        const affectedScene = this.getScenesInOrder().find(scene => (
            scene.startIndex <= earliestIndex && earliestIndex <= scene.endIndex
        ));
        if (!affectedScene) {
            throw new Error(
                `Scene summary invalidation could not find a stored scene covering entry index ${earliestIndex}.`
            );
        }

        const invalidatedFromIndex = affectedScene.startIndex;
        const removedScenes = this._scenes.filter(scene => scene.endIndex >= invalidatedFromIndex);
        this._scenes = this._scenes.filter(scene => scene.endIndex < invalidatedFromIndex);
        this.#pruneEntryMappingsToStoredScenes();
        this.#validateStoredMappingCoverage();
        this._metadata.updatedAt = new Date().toISOString();

        return {
            invalidatedFromIndex,
            earliestMissingIndex: earliestIndex,
            removedSceneCount: removedScenes.length,
            preservedThroughIndex: this.getContiguousSummarizedEndIndex()
        };
    }

    #anchorScenesToSummarizedRange(normalizedScenes, summarizedRange) {
        if (!summarizedRange) {
            return;
        }
        if (!Array.isArray(normalizedScenes) || normalizedScenes.length === 0) {
            throw new Error('Scene summary result must include scenes before anchoring coverage.');
        }

        const start = Number(summarizedRange.start);
        const end = Number(summarizedRange.end);
        if (!Number.isInteger(start) || start <= 0) {
            throw new Error('Scene summary summarizedRange is missing a valid start.');
        }
        if (!Number.isInteger(end) || end < start) {
            throw new Error('Scene summary summarizedRange is missing a valid end.');
        }

        const ordered = normalizedScenes.slice().sort((a, b) => a.startIndex - b.startIndex);
        const firstScene = ordered[0];
        const lastScene = ordered[ordered.length - 1];

        if (start < firstScene.startIndex) {
            const startEntryId = this.#entryIdForIndex(start);
            if (!startEntryId) {
                throw new Error(`Scene summary entryIndexMap is missing entry ID for summarized range start ${start}.`);
            }
            firstScene.startIndex = start;
            firstScene.startEntryId = startEntryId;
        }

        if (end > lastScene.endIndex) {
            const endEntryId = this.#entryIdForIndex(end);
            if (!endEntryId) {
                throw new Error(`Scene summary entryIndexMap is missing entry ID for summarized range end ${end}.`);
            }
            lastScene.endIndex = end;
            lastScene.endEntryId = endEntryId;
        }

        let cursor = start;
        for (const scene of ordered) {
            if (scene.startIndex !== cursor) {
                throw new Error(
                    `Scene summary scenes do not continuously cover summarized range ${start}-${end}; `
                    + `expected the next scene to start at ${cursor}, received ${scene.startIndex}.`
                );
            }
            cursor = scene.endIndex + 1;
        }
        if (cursor !== end + 1) {
            throw new Error(
                `Scene summary scenes do not continuously cover summarized range ${start}-${end}; `
                + `coverage ends at ${cursor - 1}.`
            );
        }
    }

    getScenes() {
        return this._scenes.map(scene => this.#cloneScene(scene));
    }

    getScenesInOrder() {
        return this.getScenes().sort((a, b) => a.startIndex - b.startIndex);
    }

    updateSceneAtDisplayIndex(displayIndex, updates = {}) {
        const index = Number(displayIndex);
        if (!Number.isInteger(index) || index <= 0) {
            throw new Error('Scene summary display number must be a positive integer.');
        }
        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
            throw new Error('Scene summary updates must be an object.');
        }

        const ordered = this._scenes
            .map((scene, originalIndex) => ({ scene, originalIndex }))
            .sort((a, b) => a.scene.startIndex - b.scene.startIndex);
        const target = ordered[index - 1];
        if (!target) {
            throw new Error(`Scene summary ${index} not found.`);
        }

        const nextScene = {
            ...target.scene,
            summary: Object.prototype.hasOwnProperty.call(updates, 'summary')
                ? updates.summary
                : target.scene.summary,
            details: Object.prototype.hasOwnProperty.call(updates, 'details')
                ? updates.details
                : target.scene.details,
            quotes: Object.prototype.hasOwnProperty.call(updates, 'quotes')
                ? updates.quotes
                : target.scene.quotes
        };

        const normalized = this.#normalizeScene(nextScene);
        this._scenes[target.originalIndex] = normalized;
        this._metadata.updatedAt = new Date().toISOString();
        return this.#cloneScene(normalized);
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

    load(data = {}, { authoritativeEntryIndexMap = null } = {}) {
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

        for (const scene of scenes) {
            const normalized = this.#normalizeScene(scene);
            this._scenes.push(normalized);
        }

        const orderedScenes = this.getScenesInOrder();
        for (let index = 1; index < orderedScenes.length; index += 1) {
            if (orderedScenes[index].startIndex <= orderedScenes[index - 1].endIndex) {
                throw new Error(
                    `Stored scene ${orderedScenes[index].startIndex}-${orderedScenes[index].endIndex} overlaps `
                    + `stored scene ${orderedScenes[index - 1].startIndex}-${orderedScenes[index - 1].endIndex}.`
                );
            }
        }

        const normalizedMappings = entryIndexMap.map(entry => this.#normalizeEntryIndexMapping(entry));
        const coveredMappings = normalizedMappings.filter(mapping => this.#isIndexCovered(mapping.index));
        let invalidatedFromIndex = null;

        if (Array.isArray(authoritativeEntryIndexMap)) {
            const authoritativeByIndex = new Map();
            for (const entry of authoritativeEntryIndexMap) {
                const normalized = this.#normalizeEntryIndexMapping(entry);
                if (authoritativeByIndex.has(normalized.index)) {
                    throw new Error(`Authoritative scene summary index contains duplicate index ${normalized.index}.`);
                }
                authoritativeByIndex.set(normalized.index, normalized.entryId);
            }

            const candidatesByIndex = new Map();
            for (const mapping of coveredMappings) {
                if (!candidatesByIndex.has(mapping.index)) {
                    candidatesByIndex.set(mapping.index, []);
                }
                candidatesByIndex.get(mapping.index).push(mapping);
            }

            for (const scene of orderedScenes) {
                for (let index = scene.startIndex; index <= scene.endIndex; index += 1) {
                    const authoritativeEntryId = authoritativeByIndex.get(index);
                    const candidates = candidatesByIndex.get(index) || [];
                    const matching = candidates.find(candidate => candidate.entryId === authoritativeEntryId);
                    if (!authoritativeEntryId || !matching) {
                        invalidatedFromIndex = scene.startIndex;
                        break;
                    }
                    this.#ingestEntryIndexMap([matching]);
                }
                if (invalidatedFromIndex !== null) {
                    break;
                }
            }

            if (invalidatedFromIndex !== null) {
                this._scenes = this._scenes.filter(scene => scene.endIndex < invalidatedFromIndex);
            }
        } else {
            this.#ingestEntryIndexMap(coveredMappings);
        }

        this.#pruneEntryMappingsToStoredScenes();
        this.#validateStoredMappingCoverage();

        if (data.metadata && typeof data.metadata === 'object') {
            this._metadata = {
                ...this._metadata,
                ...data.metadata
            };
        }
        const prunedMappingCount = entryIndexMap.length - this._entryIdToIndex.size;
        if (invalidatedFromIndex !== null || prunedMappingCount > 0) {
            this._metadata.updatedAt = new Date().toISOString();
        }
        return {
            invalidatedFromIndex,
            prunedMappingCount
        };
    }

    #ingestEntryIndexMap(entryIndexMap) {
        const entryIdSeenInBatch = new Set();
        const indexToEntryId = new Map(
            Array.from(this._entryIdToIndex.entries()).map(([entryId, index]) => [index, entryId])
        );
        for (const entry of entryIndexMap) {
            const { entryId, index, npcNames } = this.#normalizeEntryIndexMapping(entry);
            if (entryIdSeenInBatch.has(entryId)) {
                throw new Error(`Scene summary entryIndexMap contains duplicate entry ID ${entryId}.`);
            }
            entryIdSeenInBatch.add(entryId);
            const existing = this._entryIdToIndex.get(entryId);
            if (existing !== undefined && existing !== index) {
                throw new Error(`Scene summary entryIndexMap index mismatch for ${entryId}.`);
            }
            const existingEntryIdAtIndex = indexToEntryId.get(index);
            if (existingEntryIdAtIndex !== undefined && existingEntryIdAtIndex !== entryId) {
                throw new Error(
                    `Scene summary entryIndexMap index ${index} is assigned to both `
                    + `${existingEntryIdAtIndex} and ${entryId}.`
                );
            }
            this._entryIdToIndex.set(entryId, index);
            indexToEntryId.set(index, entryId);
            if (npcNames.length) {
                this._entryIdToNpcNames.set(entryId, npcNames);
            } else {
                this._entryIdToNpcNames.delete(entryId);
            }
        }
    }

    #normalizeEntryIndexMapping(entry) {
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
        return { entryId, index, npcNames };
    }

    #removeEntryMappingsInRange(startIndex, endIndex) {
        for (const [entryId, index] of this._entryIdToIndex.entries()) {
            if (startIndex <= index && index <= endIndex) {
                this._entryIdToIndex.delete(entryId);
                this._entryIdToNpcNames.delete(entryId);
            }
        }
    }

    #isIndexCovered(index) {
        return this._scenes.some(scene => scene.startIndex <= index && index <= scene.endIndex);
    }

    #pruneEntryMappingsToStoredScenes() {
        for (const [entryId, index] of this._entryIdToIndex.entries()) {
            if (!this.#isIndexCovered(index)) {
                this._entryIdToIndex.delete(entryId);
                this._entryIdToNpcNames.delete(entryId);
            }
        }
    }

    #validateStoredMappingCoverage() {
        const indexToEntryId = new Map();
        for (const [entryId, index] of this._entryIdToIndex.entries()) {
            const existingEntryId = indexToEntryId.get(index);
            if (existingEntryId && existingEntryId !== entryId) {
                throw new Error(
                    `Scene summary entry index ${index} is assigned to both ${existingEntryId} and ${entryId}.`
                );
            }
            indexToEntryId.set(index, entryId);
        }

        for (const scene of this._scenes) {
            for (let index = scene.startIndex; index <= scene.endIndex; index += 1) {
                if (!indexToEntryId.has(index)) {
                    throw new Error(`Scene summary entry mapping is missing covered index ${index}.`);
                }
            }
            if (indexToEntryId.get(scene.startIndex) !== scene.startEntryId) {
                throw new Error(`Scene summary start entry ID does not match index ${scene.startIndex}.`);
            }
            if (indexToEntryId.get(scene.endIndex) !== scene.endEntryId) {
                throw new Error(`Scene summary end entry ID does not match index ${scene.endIndex}.`);
            }
        }
    }

    #entryIdForIndex(targetIndex) {
        for (const [entryId, index] of this._entryIdToIndex.entries()) {
            if (index === targetIndex) {
                return entryId;
            }
        }
        return null;
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
