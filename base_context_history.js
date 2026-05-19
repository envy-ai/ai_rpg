function normalizeEntryType(entry) {
    return typeof entry?.type === 'string' ? entry.type.trim().toLowerCase() : '';
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

module.exports = {
    shouldIncludeEntryInBaseContextHistory
};
