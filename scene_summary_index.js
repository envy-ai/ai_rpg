const {
    containsOmittedMarker,
    normalizeEntryText,
    resolveEntryRecordId,
    shouldExcludeSummaryEntry
} = require('./chat_history_utils.js');

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

    const role = typeof entry.role === 'string' ? entry.role.trim().toLowerCase() : '';
    if (role === 'system') {
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

module.exports = {
    HIDDEN_SCENE_SUMMARY_ENTRY_TYPES,
    countSceneSummaryIndexEntries,
    getSceneSummaryIndexText,
    isHiddenSceneSummaryEntry,
    shouldIncludeEntryInSceneSummaryIndex
};
