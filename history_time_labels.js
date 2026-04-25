const Globals = require('./Globals.js');

function normalizeWorldTimeSnapshot(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('History world-time snapshot must be an object.');
    }

    const rawDayIndex = Number(value.dayIndex);
    const rawTimeMinutes = Number(value.timeMinutes);
    if (!Number.isFinite(rawDayIndex) || rawDayIndex < 0) {
        throw new Error('History world-time snapshot dayIndex must be a non-negative number.');
    }
    if (!Number.isFinite(rawTimeMinutes) || rawTimeMinutes < 0) {
        throw new Error('History world-time snapshot timeMinutes must be a non-negative number.');
    }

    const timeConfig = Globals.getTimeConfig();
    const cycleLengthMinutes = Number(timeConfig.cycleLengthMinutes);
    if (!Number.isFinite(cycleLengthMinutes) || cycleLengthMinutes <= 0) {
        throw new Error('Cannot format history world time without a positive cycle length.');
    }

    const totalMinutes = Math.round((Math.floor(rawDayIndex) * cycleLengthMinutes) + rawTimeMinutes);
    const dayIndex = Math.floor(totalMinutes / cycleLengthMinutes);
    const timeMinutes = totalMinutes - (dayIndex * cycleLengthMinutes);
    return { dayIndex, timeMinutes };
}

function getCurrentWorldTimeSnapshotForHistoryEntry() {
    if (!Globals.worldTime) {
        return null;
    }
    const snapshot = Globals.getSerializedWorldTime();
    return normalizeWorldTimeSnapshot(snapshot);
}

function getEntryWorldTimeSnapshot(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const metadata = entry.metadata && typeof entry.metadata === 'object'
        ? entry.metadata
        : null;
    if (metadata && Object.prototype.hasOwnProperty.call(metadata, 'worldTime')) {
        return normalizeWorldTimeSnapshot(metadata.worldTime);
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'worldTime')) {
        return normalizeWorldTimeSnapshot(entry.worldTime);
    }
    return null;
}

function formatRelativeDayReference(worldTime, { currentWorldTime = Globals.worldTime } = {}) {
    const snapshot = normalizeWorldTimeSnapshot(worldTime);
    if (!snapshot) {
        return '';
    }
    const currentSnapshot = normalizeWorldTimeSnapshot(currentWorldTime);
    if (!currentSnapshot) {
        return `Day ${snapshot.dayIndex + 1}`;
    }

    const dayDifference = currentSnapshot.dayIndex - snapshot.dayIndex;
    if (dayDifference === 0) {
        return 'today';
    }
    if (dayDifference === 1) {
        return 'yesterday';
    }

    const absoluteDifference = Math.abs(dayDifference);
    const dayNoun = absoluteDifference === 1 ? 'day' : 'days';
    if (dayDifference > 0) {
        return `${absoluteDifference} ${dayNoun} ago`;
    }
    return `in ${absoluteDifference} ${dayNoun}`;
}

function formatWorldTimeLabel(worldTime, options = {}) {
    const snapshot = normalizeWorldTimeSnapshot(worldTime);
    if (!snapshot) {
        return '';
    }
    const relativeDayReference = formatRelativeDayReference(snapshot, options);
    const timeLabel = Globals.formatTime(snapshot, { skipEnsure: true });
    const dateLabel = Globals.formatDate(snapshot, { skipEnsure: true });
    const joiner = relativeDayReference.startsWith('Day ') ? ', ' : ' at ';
    return `${relativeDayReference}${joiner}${timeLabel} (${dateLabel})`;
}

function formatEntryWorldTimeLabel(entry) {
    const snapshot = getEntryWorldTimeSnapshot(entry);
    return snapshot ? formatWorldTimeLabel(snapshot) : '';
}

function shouldAnnotateHistorySpeaker({ roleRaw } = {}) {
    const normalizedRole = typeof roleRaw === 'string' ? roleRaw.trim().toLowerCase() : '';
    return normalizedRole !== 'assistant';
}

function formatHistoryEntrySpeakerPrefix(entry, { roleLabel, roleRaw } = {}) {
    const label = typeof roleLabel === 'string' && roleLabel.trim()
        ? roleLabel.trim()
        : 'Storyteller';
    if (!shouldAnnotateHistorySpeaker({ roleRaw })) {
        return `[${label}]`;
    }
    const timeLabel = formatEntryWorldTimeLabel(entry);
    return timeLabel ? `[${label}][${timeLabel}]` : `[${label}]`;
}

function formatSceneStartWorldTimeLabel(sceneStartEntry) {
    return formatEntryWorldTimeLabel(sceneStartEntry);
}

module.exports = {
    formatEntryWorldTimeLabel,
    formatHistoryEntrySpeakerPrefix,
    formatRelativeDayReference,
    formatSceneStartWorldTimeLabel,
    formatWorldTimeLabel,
    getCurrentWorldTimeSnapshotForHistoryEntry,
    getEntryWorldTimeSnapshot,
    normalizeWorldTimeSnapshot,
    shouldAnnotateHistorySpeaker
};
