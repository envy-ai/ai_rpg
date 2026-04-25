function formatSceneSummaryRangeValue(value) {
    if (typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (value === undefined) {
        return 'undefined';
    }
    if (value === null) {
        return 'null';
    }
    return String(value);
}

function formatSceneSummaryRangeError({
    totalEntries,
    startIndex,
    endIndex,
    redo,
    parsedStart,
    parsedEnd
} = {}) {
    return [
        `Scene summary range must be within 1-${totalEntries}.`,
        `Called with startIndex=${formatSceneSummaryRangeValue(startIndex)}, endIndex=${formatSceneSummaryRangeValue(endIndex)}, redo=${formatSceneSummaryRangeValue(Boolean(redo))};`,
        `resolved range=${formatSceneSummaryRangeValue(parsedStart)}-${formatSceneSummaryRangeValue(parsedEnd)};`,
        `indexed entries=${formatSceneSummaryRangeValue(totalEntries)}.`
    ].join(' ');
}

module.exports = {
    formatSceneSummaryRangeError
};
