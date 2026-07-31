const {
    containsOmittedMarker,
    normalizeEntryText,
    resolveEntryRecordId,
    shouldExcludeSummaryEntry
} = require('./chat_history_utils.js');
const {
    shouldExcludeEntryFromPromptHistory
} = require('./base_context_history.js');

const HIDDEN_SCENE_SUMMARY_ENTRY_TYPES = new Set([
    'supplemental-story-info',
    'offscreen-npc-activity-daily',
    'offscreen-npc-activity-weekly',
    'while-you-were-away',
    'plot-summary',
    'plot-expander'
]);

function isHiddenSceneSummaryEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }
    const entryType = typeof entry.type === 'string' ? entry.type.trim() : '';
    return HIDDEN_SCENE_SUMMARY_ENTRY_TYPES.has(entryType);
}

function shouldIncludeEntryInSceneSummaryIndex(entry, { excludeSummaries = true } = {}) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }

    if (shouldExcludeEntryFromPromptHistory(entry)) {
        return false;
    }

    const metadata = entry.metadata && typeof entry.metadata === 'object'
        ? entry.metadata
        : null;
    if (metadata?.excludeFromBaseContextHistory === true) {
        return false;
    }

    const entryType = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '';
    if (
        entryType === 'plot-summary'
        || entryType === 'plot-expander'
        || entryType === 'event-summary'
        || entryType === 'status-summary'
    ) {
        return false;
    }

    if (excludeSummaries && shouldExcludeSummaryEntry(entry)) {
        return false;
    }

    if (isHiddenSceneSummaryEntry(entry)) {
        return true;
    }

    const content = typeof entry.content === 'string' ? entry.content : '';
    const summary = typeof entry.summary === 'string' ? entry.summary : '';
    if (containsOmittedMarker(content) || containsOmittedMarker(summary)) {
        return false;
    }

    return true;
}

function getSceneSummaryIndexText(entry) {
    if (!entry || typeof entry !== 'object') {
        return '';
    }
    const content = typeof entry.content === 'string' ? entry.content.trim() : '';
    const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
    return normalizeEntryText(content || summary);
}

function countSceneSummaryIndexEntries(entries, options = {}) {
    if (!Array.isArray(entries)) {
        throw new Error('Chat history is unavailable for scene summary counting.');
    }

    let count = 0;
    for (const entry of entries) {
        if (!shouldIncludeEntryInSceneSummaryIndex(entry, options)) {
            continue;
        }
        if (!getSceneSummaryIndexText(entry)) {
            continue;
        }
        resolveEntryRecordId(entry);
        count += 1;
    }
    return count;
}

function normalizeSceneSummaryIntervals(scenes, totalEntries, { requirePositiveStart = false } = {}) {
    const total = Number(totalEntries);
    if (!Number.isInteger(total) || total <= 0 || !Array.isArray(scenes)) {
        return [];
    }

    return scenes
        .map(scene => ({
            start: Number(scene?.startIndex),
            end: Number(scene?.endIndex)
        }))
        .filter(interval => (
            Number.isInteger(interval.start)
            && Number.isInteger(interval.end)
            && (!requirePositiveStart || (interval.start > 0 && interval.end >= interval.start))
        ))
        .map(interval => ({
            start: Math.max(1, interval.start),
            end: Math.min(total, interval.end)
        }))
        .filter(interval => interval.end >= interval.start)
        .sort((a, b) => a.start - b.start);
}

function walkSceneSummaryIntervals(intervals, totalEntries) {
    const gaps = [];
    let summarized = 0;
    let cursor = 1;
    for (const interval of intervals) {
        if (interval.end < cursor) {
            continue;
        }
        if (interval.start > cursor) {
            gaps.push({ start: cursor, end: interval.start - 1 });
        }
        const start = Math.max(cursor, interval.start);
        const end = Math.min(interval.end, totalEntries);
        if (end >= start) {
            summarized += end - start + 1;
            cursor = end + 1;
        }
        if (cursor > totalEntries) {
            break;
        }
    }
    if (cursor <= totalEntries) {
        gaps.push({ start: cursor, end: totalEntries });
    }
    return { summarized, gaps };
}

module.exports = {
    HIDDEN_SCENE_SUMMARY_ENTRY_TYPES,
    countSceneSummaryIndexEntries,
    getSceneSummaryIndexText,
    isHiddenSceneSummaryEntry,
    normalizeSceneSummaryIntervals,
    shouldIncludeEntryInSceneSummaryIndex,
    walkSceneSummaryIntervals
};
