const HOUSEKEEPING_PROSE_ENTRY_TYPES = new Set([
    '',
    'player-action',
    'npc-action',
    'quest-reward',
    'random-event',
    'while-you-were-away-player'
]);

const HOUSEKEEPING_EVENT_ENTRY_TYPES = new Set([
    'event-summary',
    'status-summary'
]);

function normalizeHistoryText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeTurnId(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeTurnTimestamp(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }
    const timestampMs = Date.parse(value.trim());
    return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null;
}

function normalizeEntryType(entry) {
    return typeof entry?.type === 'string' ? entry.type.trim().toLowerCase() : '';
}

function isHousekeepingPlayerTurnStart(entry) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }
    if (typeof entry.role !== 'string' || entry.role.trim().toLowerCase() !== 'user') {
        return false;
    }
    if (entry?.metadata?.excludeFromBaseContextHistory === true) {
        return false;
    }
    const entryType = normalizeEntryType(entry);
    return entryType === '' || entryType === 'player-action';
}

function appendUniqueText(target, value) {
    const normalized = normalizeHistoryText(value);
    if (!normalized || target.includes(normalized)) {
        return;
    }
    target.push(normalized);
}

function collectHousekeepingPlayerTurns(chatHistory) {
    if (!Array.isArray(chatHistory)) {
        throw new Error('Chat history is unavailable for housekeeping context.');
    }

    const turns = [];
    let currentTurn = null;
    for (const entry of chatHistory) {
        if (isHousekeepingPlayerTurnStart(entry)) {
            const turnId = normalizeTurnId(entry.id);
            if (!turnId) {
                throw new Error('A player turn in chat history is missing an id.');
            }
            currentTurn = {
                turnId,
                timestamp: normalizeTurnTimestamp(entry.timestamp),
                playerAction: normalizeHistoryText(entry.content),
                prose: [],
                eventText: [],
                isSynthetic: false
            };
            turns.push(currentTurn);
            continue;
        }

        if (!currentTurn || !entry || typeof entry !== 'object') {
            continue;
        }
        const entryType = normalizeEntryType(entry);
        if (HOUSEKEEPING_EVENT_ENTRY_TYPES.has(entryType)) {
            appendUniqueText(currentTurn.eventText, entry.content);
            continue;
        }
        const role = typeof entry.role === 'string' ? entry.role.trim().toLowerCase() : '';
        if (role === 'assistant' && HOUSEKEEPING_PROSE_ENTRY_TYPES.has(entryType)) {
            appendUniqueText(currentTurn.prose, entry.content);
        }
    }

    return turns;
}

function resolveInitialTurnCount(interval) {
    const numeric = Number(interval);
    if (!Number.isInteger(numeric) || numeric < 1) {
        throw new Error('Housekeeping history interval must be an integer greater than or equal to 1.');
    }
    return numeric;
}

function buildHousekeepingTurnHistory(chatHistory, {
    lastRunTurnId = null,
    lastRunTurnTimestamp = null,
    interval = 1,
    currentTurnId = null,
    currentActionText = '',
    currentProse = '',
    currentEventText = ''
} = {}) {
    const allTurns = collectHousekeepingPlayerTurns(chatHistory);
    const normalizedLastRunTurnId = normalizeTurnId(lastRunTurnId);
    const normalizedLastRunTurnTimestamp = normalizeTurnTimestamp(lastRunTurnTimestamp);
    if (lastRunTurnTimestamp !== null
        && lastRunTurnTimestamp !== undefined
        && !normalizedLastRunTurnTimestamp) {
        throw new Error('Housekeeping history boundary timestamp must be a valid timestamp string.');
    }
    const normalizedCurrentTurnId = normalizeTurnId(currentTurnId);
    let selectedTurns;
    let mode;
    let missingBoundaryTurnId = null;

    if (normalizedLastRunTurnId) {
        const boundaryIndex = allTurns.findIndex(turn => turn.turnId === normalizedLastRunTurnId);
        if (boundaryIndex === -1) {
            missingBoundaryTurnId = normalizedLastRunTurnId;
            if (normalizedLastRunTurnTimestamp) {
                const boundaryTimestampMs = Date.parse(normalizedLastRunTurnTimestamp);
                const firstTurnAfterBoundaryIndex = allTurns.findIndex(turn => (
                    turn.timestamp && Date.parse(turn.timestamp) > boundaryTimestampMs
                ));
                selectedTurns = firstTurnAfterBoundaryIndex === -1
                    ? []
                    : allTurns.slice(firstTurnAfterBoundaryIndex);
                mode = 'since-deleted-boundary';
            } else {
                const initialTurnCount = resolveInitialTurnCount(interval);
                selectedTurns = allTurns.slice(-initialTurnCount);
                mode = 'deleted-boundary-fallback';
            }
        } else {
            selectedTurns = allTurns.slice(boundaryIndex + 1);
            mode = 'since-last-run';
        }
    } else {
        const initialTurnCount = resolveInitialTurnCount(interval);
        selectedTurns = allTurns.slice(-initialTurnCount);
        mode = 'initial-interval';
    }

    selectedTurns = selectedTurns.map(turn => ({
        ...turn,
        prose: turn.prose.slice(),
        eventText: turn.eventText.slice()
    }));

    let currentTurn = normalizedCurrentTurnId
        ? selectedTurns.find(turn => turn.turnId === normalizedCurrentTurnId) || null
        : null;
    if (!currentTurn && !normalizedCurrentTurnId) {
        const normalizedActionText = normalizeHistoryText(currentActionText);
        const normalizedCurrentProse = normalizeHistoryText(currentProse);
        currentTurn = [...selectedTurns].reverse().find(turn => {
            if (normalizedActionText && turn.playerAction === normalizedActionText) {
                return true;
            }
            return normalizedCurrentProse && turn.prose.some(prose => (
                prose === normalizedCurrentProse
                || prose.includes(normalizedCurrentProse)
            ));
        }) || null;
    }
    const hasCurrentSupplement = Boolean(
        normalizeHistoryText(currentActionText)
        || normalizeHistoryText(currentProse)
        || normalizeHistoryText(currentEventText)
    );

    if (!currentTurn && hasCurrentSupplement) {
        const currentTurnExistsBeforeBoundary = normalizedCurrentTurnId
            && allTurns.some(turn => turn.turnId === normalizedCurrentTurnId);
        if (currentTurnExistsBeforeBoundary) {
            throw new Error(
                `The current housekeeping turn (${normalizedCurrentTurnId}) is not after the last housekeeping boundary.`
            );
        }
        currentTurn = {
            turnId: normalizedCurrentTurnId,
            timestamp: null,
            playerAction: '',
            prose: [],
            eventText: [],
            isSynthetic: true
        };
        selectedTurns.push(currentTurn);
    }

    if (currentTurn) {
        const normalizedActionText = normalizeHistoryText(currentActionText);
        if (normalizedActionText) {
            currentTurn.playerAction = normalizedActionText;
        }
        const normalizedCurrentProse = normalizeHistoryText(currentProse);
        if (normalizedCurrentProse && !currentTurn.prose.includes(normalizedCurrentProse)) {
            if (!currentTurn.isSynthetic && currentTurn.prose.length) {
                currentTurn.prose[0] = normalizedCurrentProse;
            } else {
                currentTurn.prose.push(normalizedCurrentProse);
            }
        }
        appendUniqueText(currentTurn.eventText, currentEventText);
    }

    const lastPersistedTurn = [...selectedTurns]
        .reverse()
        .find(turn => !turn.isSynthetic && normalizeTurnId(turn.turnId));

    return {
        mode,
        turns: selectedTurns,
        lastIncludedTurnId: lastPersistedTurn?.turnId || null,
        lastIncludedTurnTimestamp: lastPersistedTurn?.timestamp || null,
        missingBoundaryTurnId
    };
}

module.exports = {
    HOUSEKEEPING_PROSE_ENTRY_TYPES,
    HOUSEKEEPING_EVENT_ENTRY_TYPES,
    normalizeTurnId,
    normalizeTurnTimestamp,
    isHousekeepingPlayerTurnStart,
    collectHousekeepingPlayerTurns,
    buildHousekeepingTurnHistory
};
