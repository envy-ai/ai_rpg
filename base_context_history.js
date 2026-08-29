function normalizeEntryType(entry) {
    return typeof entry?.type === 'string' ? entry.type.trim().toLowerCase() : '';
}

function normalizeEntryRole(entry) {
    return typeof entry?.role === 'string' ? entry.role.trim().toLowerCase() : '';
}

const PROMPT_DIAGNOSTIC_ENTRY_TYPES = new Set([
    'check-results',
    'game-improvement-suggestions',
    'relationship-updates',
    'tonal-scale-evaluation',
    'tracker-updates',
    'tool-call-debug'
]);

const warnedDeletedSceneSummaryCoverage = new Set();

function isDiagnosticHistoryText(text) {
    if (typeof text !== 'string') {
        return false;
    }
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }
    return /^Tool calls for\b/i.test(trimmed)
        || /^Tool call debug:\s+\d+\s+calls?\b/i.test(trimmed)
        || /^Checks for\b/i.test(trimmed)
        || /^Checks:\s+\d+\s+checks?\b/i.test(trimmed);
}

function shouldExcludeEntryFromPromptHistory(entry) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }
    if (normalizeEntryRole(entry) === 'system') {
        return true;
    }
    if (entry.ephemeral === true) {
        return true;
    }

    const entryType = normalizeEntryType(entry);
    if (PROMPT_DIAGNOSTIC_ENTRY_TYPES.has(entryType)) {
        return true;
    }

    const metadata = entry.metadata && typeof entry.metadata === 'object'
        ? entry.metadata
        : null;
    if (metadata?.debugToolCalls === true || metadata?.checkResults === true) {
        return true;
    }
    if (Array.isArray(entry.toolCalls) || Array.isArray(entry.checkResults)) {
        return true;
    }
    return isDiagnosticHistoryText(entry.content) || isDiagnosticHistoryText(entry.summary);
}

function shouldIncludeEntryInBaseContextHistory(entry, {
    includeAllEntryTypes = false,
    omitEventSummaryHistory = false,
    hasRenderableContent = false
} = {}) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }
    if (!hasRenderableContent) {
        return false;
    }
    if (shouldExcludeEntryFromPromptHistory(entry)) {
        return false;
    }

    if (includeAllEntryTypes) {
        return true;
    }

    const entryType = normalizeEntryType(entry);
    if (entryType === 'status-summary' || entryType === 'level-up') {
        return false;
    }
    if (omitEventSummaryHistory && entryType === 'event-summary') {
        return false;
    }

    const metadata = entry.metadata && typeof entry.metadata === 'object'
        ? entry.metadata
        : null;
    if (metadata?.excludeFromBaseContextHistory === true) {
        return false;
    }

    return true;
}

function normalizeEntryId(entry) {
    return typeof entry?.id === 'string' ? entry.id.trim() : '';
}

function resolveRecentHistoryBatchInterval(value, defaultValue = 10) {
    if (!Number.isInteger(defaultValue) || defaultValue < 1) {
        throw new Error('Default recent-history batch interval must be an integer greater than or equal to 1.');
    }
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    const interval = Number(value);
    if (!Number.isInteger(interval) || interval < 1) {
        throw new Error('recent_history_batch_interval must be an integer greater than or equal to 1 when provided');
    }
    return interval;
}

function resolveBatchedRecentHistoryTurnCount({
    totalTurns,
    minimumRecentTurns,
    batchInterval
}) {
    if (!Number.isInteger(totalTurns) || totalTurns < 0) {
        throw new Error('Total base-context history turns must be a non-negative integer.');
    }
    if (!Number.isInteger(minimumRecentTurns) || minimumRecentTurns < 0) {
        throw new Error('Minimum recent base-context history turns must be a non-negative integer.');
    }
    if (!Number.isInteger(batchInterval) || batchInterval < 1) {
        throw new Error('Recent-history batch interval must be an integer greater than or equal to 1.');
    }
    if (minimumRecentTurns === 0 || totalTurns === 0) {
        return 0;
    }
    if (totalTurns <= minimumRecentTurns) {
        return totalTurns;
    }

    const turnsBeyondMinimum = totalTurns - minimumRecentTurns;
    return minimumRecentTurns + (turnsBeyondMinimum % batchInterval);
}

function partitionBaseContextHistoryBySceneCoverage({
    historyEntries,
    relevantHistory,
    sceneSummaries,
    maxSummarizedEntries
}) {
    if (!Array.isArray(historyEntries)) {
        throw new Error('Base-context history entries must be an array.');
    }
    if (!Array.isArray(relevantHistory)) {
        throw new Error('Relevant base-context history must be an array.');
    }
    if (!sceneSummaries || typeof sceneSummaries !== 'object') {
        throw new Error('Scene summary store is unavailable for base-context history partitioning.');
    }
    if (typeof sceneSummaries.getContiguousSummarizedEndIndex !== 'function') {
        throw new Error('Scene summary store cannot resolve contiguous summary coverage.');
    }
    if (typeof sceneSummaries.serialize !== 'function') {
        throw new Error('Scene summary store cannot serialize its entry mapping.');
    }
    if (!Number.isInteger(maxSummarizedEntries) || maxSummarizedEntries < 0) {
        throw new Error('Maximum summarized base-context history entries must be a non-negative integer.');
    }

    const summarizedEndIndex = sceneSummaries.getContiguousSummarizedEndIndex();
    if (!Number.isInteger(summarizedEndIndex) || summarizedEndIndex < 0) {
        throw new Error('Scene summary store returned an invalid contiguous coverage boundary.');
    }
    if (summarizedEndIndex === 0) {
        return {
            summaryCandidates: [],
            tailEntries: relevantHistory.slice(),
            summarizedEndIndex: 0,
            summarizedThroughEntryId: null
        };
    }

    const serialized = sceneSummaries.serialize();
    if (!Array.isArray(serialized?.entryIndexMap)) {
        throw new Error('Scene summary store is missing its entry index mapping.');
    }
    const boundaryMapping = serialized.entryIndexMap.find(entry => Number(entry?.index) === summarizedEndIndex);
    const storedSummarizedThroughEntryId = normalizeEntryId({ id: boundaryMapping?.entryId });
    if (!storedSummarizedThroughEntryId) {
        throw new Error(`Scene summary entry mapping is missing contiguous boundary index ${summarizedEndIndex}.`);
    }

    const historyPositionByEntry = new Map();
    const historyPositionById = new Map();
    for (let index = 0; index < historyEntries.length; index += 1) {
        const entry = historyEntries[index];
        historyPositionByEntry.set(entry, index);
        const entryId = normalizeEntryId(entry);
        if (!entryId) {
            continue;
        }
        if (historyPositionById.has(entryId)) {
            throw new Error(`Base-context history contains duplicate entry ID '${entryId}'.`);
        }
        historyPositionById.set(entryId, index);
    }

    const deletedCoveredEntryIds = serialized.entryIndexMap
        .filter(entry => (
            Number(entry?.index) <= summarizedEndIndex
            && !historyPositionById.has(normalizeEntryId({ id: entry?.entryId }))
        ))
        .map(entry => normalizeEntryId({ id: entry?.entryId }))
        .filter(Boolean);
    if (deletedCoveredEntryIds.length) {
        const warningKey = deletedCoveredEntryIds.slice().sort().join('|');
        if (!warnedDeletedSceneSummaryCoverage.has(warningKey)) {
            warnedDeletedSceneSummaryCoverage.add(warningKey);
            console.warn(
                `Scene summary source entries were deleted from chat history (${deletedCoveredEntryIds.join(', ')}); `
                + 'treating all remaining history as uncovered until summaries are rebuilt.'
            );
        }
        return {
            summaryCandidates: [],
            tailEntries: relevantHistory.slice(),
            summarizedEndIndex,
            summarizedThroughEntryId: null,
            storedSummarizedThroughEntryId,
            boundaryWasDeleted: deletedCoveredEntryIds.includes(storedSummarizedThroughEntryId),
            coverageHasDeletedEntries: true,
            deletedCoveredEntryIds
        };
    }
    const summarizedThroughEntryId = storedSummarizedThroughEntryId;
    const summarizedThroughHistoryPosition = historyPositionById.get(summarizedThroughEntryId);

    const coveredEntries = [];
    const uncoveredEntries = [];
    for (const entry of relevantHistory) {
        let historyPosition = historyPositionByEntry.get(entry);
        if (!Number.isInteger(historyPosition)) {
            const entryId = normalizeEntryId(entry);
            historyPosition = entryId ? historyPositionById.get(entryId) : null;
        }
        if (!Number.isInteger(historyPosition)) {
            throw new Error('Relevant base-context history contains an entry that is missing from chat history.');
        }
        if (historyPosition <= summarizedThroughHistoryPosition) {
            coveredEntries.push(entry);
        } else {
            uncoveredEntries.push(entry);
        }
    }

    const summaryCandidates = maxSummarizedEntries > 0
        ? coveredEntries.slice(-maxSummarizedEntries)
        : [];
    return {
        summaryCandidates,
        tailEntries: uncoveredEntries,
        summarizedEndIndex,
        summarizedThroughEntryId,
        storedSummarizedThroughEntryId,
        boundaryWasDeleted: false,
        coverageHasDeletedEntries: false,
        deletedCoveredEntryIds: []
    };
}

module.exports = {
    partitionBaseContextHistoryBySceneCoverage,
    resolveBatchedRecentHistoryTurnCount,
    resolveRecentHistoryBatchInterval,
    shouldExcludeEntryFromPromptHistory,
    shouldIncludeEntryInBaseContextHistory
};
