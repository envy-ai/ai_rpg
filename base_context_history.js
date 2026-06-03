function normalizeEntryType(entry) {
    return typeof entry?.type === 'string' ? entry.type.trim().toLowerCase() : '';
}

function normalizeEntryRole(entry) {
    return typeof entry?.role === 'string' ? entry.role.trim().toLowerCase() : '';
}

const PROMPT_DIAGNOSTIC_ENTRY_TYPES = new Set([
    'check-results',
    'tool-call-debug'
]);

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

module.exports = {
    shouldExcludeEntryFromPromptHistory,
    shouldIncludeEntryInBaseContextHistory
};
