const OMIT_ENTRY_MARKERS = [
    '🛠️ Crafting Results',
    '📋 Events',
    '🗒️ Quest',
    '✅ Quest',
    '✨ Additional',
    '♻️ Salvage'
];

function containsOmittedMarker(text) {
    if (typeof text !== 'string') {
        return false;
    }
    return OMIT_ENTRY_MARKERS.some(marker => text.includes(marker));
}

function resolveSummaryHeader(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const rawTitle = typeof entry.summaryTitle === 'string' ? entry.summaryTitle.trim() : '';
    if (rawTitle) {
        return rawTitle;
    }
    const rawContent = typeof entry.content === 'string' ? entry.content.trim() : '';
    if (!rawContent) {
        return null;
    }
    const firstLine = rawContent.split('\n')[0]?.trim();
    return firstLine || null;
}

function shouldExcludeSummaryEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }
    const rawType = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '';
    if (rawType === 'status-summary') {
        return true;
    }
    if (rawType !== 'event-summary') {
        return false;
    }
    const header = resolveSummaryHeader(entry);
    if (!header) {
        return false;
    }
    const normalizedHeader = header.toLowerCase();
    return normalizedHeader.startsWith('📋 events')
        || normalizedHeader.startsWith('🌾 harvest results');
}

function isSystemEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }
    const rawRole = typeof entry.role === 'string' ? entry.role.trim().toLowerCase() : '';
    return rawRole === 'system';
}

function stripLineMarker(line) {
    if (typeof line !== 'string') {
        return '';
    }
    return line.replace(/^(!{1,2}|#)\s*/, '');
}

function isSceneIllustrationLine(line) {
    if (typeof line !== 'string') {
        return false;
    }
    return /^\s*!\[Scene Illustration\]\([^)]*\)\s*$/.test(line);
}

function normalizeEntryText(text) {
    if (typeof text !== 'string') {
        return '';
    }
    const lines = text.split('\n');
    const cleanedLines = [];
    for (const line of lines) {
        if (isSceneIllustrationLine(line)) {
            continue;
        }
        cleanedLines.push(stripLineMarker(line));
    }
    const joined = cleanedLines.join('\n');
    return joined.replace(/\n+/g, '\n\n').trim();
}

function resolveRoleLabel(rawRole, playerName) {
    if (!rawRole || typeof rawRole !== 'string') {
        return '';
    }
    const normalized = rawRole.trim();
    if (!normalized) {
        return '';
    }
    const lower = normalized.toLowerCase();
    if (lower === 'user') {
        if (!playerName) {
            throw new Error('Player name is required to format user entries.');
        }
        return playerName;
    }
    if (lower === 'assistant') {
        return 'Storyteller';
    }
    return normalized;
}

function resolveEntryRecordId(entry) {
    if (!entry || typeof entry !== 'object') {
        throw new Error('Chat history entry is invalid.');
    }
    const rawId = entry.id;
    if (typeof rawId !== 'string') {
        throw new Error('Chat history entry is missing a record ID.');
    }
    const trimmed = rawId.trim();
    if (!trimmed) {
        throw new Error('Chat history entry has an empty record ID.');
    }
    return trimmed;
}

function filterChatHistoryEntries(chatHistory, { excludeSummaries = true } = {}) {
    if (!Array.isArray(chatHistory)) {
        throw new Error('Chat history is unavailable.');
    }
    const shouldExclude = typeof excludeSummaries === 'boolean' ? excludeSummaries : true;
    return chatHistory.filter(entry => {
        if (isSystemEntry(entry)) {
            return false;
        }
        const content = typeof entry?.content === 'string' ? entry.content : '';
        const summary = typeof entry?.summary === 'string' ? entry.summary : '';
        if (containsOmittedMarker(content) || containsOmittedMarker(summary)) {
            return false;
        }
        if (shouldExclude && shouldExcludeSummaryEntry(entry)) {
            return false;
        }
        return true;
    });
}

module.exports = {
    OMIT_ENTRY_MARKERS,
    containsOmittedMarker,
    resolveSummaryHeader,
    shouldExcludeSummaryEntry,
    isSystemEntry,
    stripLineMarker,
    isSceneIllustrationLine,
    normalizeEntryText,
    resolveRoleLabel,
    resolveEntryRecordId,
    filterChatHistoryEntries
};
