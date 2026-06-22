function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function pluralize(count, singular, plural = `${singular}s`) {
    return count === 1 ? singular : plural;
}

function escapeMarkdownInline(value) {
    const text = normalizeString(value);
    return text.replace(/([\\`*_{}\[\]()#+.!|-])/g, '\\$1');
}

function makeOptionalString(value) {
    const normalized = normalizeString(value);
    return normalized || null;
}

function clonePlainValue(value) {
    if (value === null || value === undefined) {
        return value;
    }
    return JSON.parse(JSON.stringify(value));
}

function successfulItemsForInvocation(invocation) {
    if (!invocation || typeof invocation !== 'object') {
        return [];
    }
    const metadata = invocation.metadata && typeof invocation.metadata === 'object'
        ? invocation.metadata
        : null;
    if (!metadata || metadata.error === true) {
        return [];
    }
    if (Array.isArray(metadata.items)) {
        return metadata.items.filter(item => (
            item
            && typeof item === 'object'
            && item.status === 'success'
            && item.error !== true
        ));
    }
    return metadata.status === 'success' ? [metadata] : [];
}

function trackerActionForToolName(toolName) {
    switch (toolName) {
        case 'addTracker':
            return 'added';
        case 'updateTracker':
            return 'updated';
        case 'removeTracker':
            return 'deleted';
        default:
            return null;
    }
}

function trackerActionLabel(action) {
    switch (action) {
        case 'added':
            return 'Added';
        case 'updated':
            return 'Updated';
        case 'deleted':
        case 'removed':
            return 'Deleted';
        default:
            return 'Updated';
    }
}

function collectTrackerUpdates(toolInvocations) {
    const updates = [];
    for (const invocation of Array.isArray(toolInvocations) ? toolInvocations : []) {
        const action = trackerActionForToolName(invocation?.name);
        if (!action) {
            continue;
        }
        for (const item of successfulItemsForInvocation(invocation)) {
            if (item.hiddenFromPlayer === true) {
                continue;
            }
            const name = makeOptionalString(item.name) || makeOptionalString(item.id) || 'Unnamed tracker';
            updates.push({
                action,
                id: makeOptionalString(item.id),
                name,
                type: makeOptionalString(item.type),
                value: makeOptionalString(item.value),
                note: makeOptionalString(item.note)
            });
        }
    }
    return updates;
}

function normalizeRelationshipAction(value) {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized === 'added' || normalized === 'updated' || normalized === 'deleted') {
        return normalized;
    }
    if (normalized === 'removed') {
        return 'deleted';
    }
    return 'updated';
}

function relationshipActionLabel(action) {
    switch (action) {
        case 'added':
            return 'Added';
        case 'deleted':
            return 'Deleted';
        case 'updated':
        default:
            return 'Updated';
    }
}

function normalizeCharacterSummary(value) {
    if (value && typeof value === 'object') {
        const id = makeOptionalString(value.id);
        const name = makeOptionalString(value.name) || id || 'Unknown character';
        return { id, name };
    }
    const text = makeOptionalString(value) || 'Unknown character';
    return { id: null, name: text };
}

function pushRelationshipUpdate(updates, {
    action,
    source,
    target,
    relationship,
    previousRelationship
}) {
    const normalizedAction = normalizeRelationshipAction(action);
    const label = makeOptionalString(relationship);
    if (normalizedAction !== 'deleted' && !label) {
        return;
    }
    updates.push({
        action: normalizedAction,
        characterA: normalizeCharacterSummary(source),
        characterB: normalizeCharacterSummary(target),
        relationship: label,
        previousRelationship: makeOptionalString(previousRelationship)
    });
}

function collectRelationshipUpdates(toolInvocations) {
    const updates = [];
    for (const invocation of Array.isArray(toolInvocations) ? toolInvocations : []) {
        if (invocation?.name !== 'setRelationship') {
            continue;
        }
        for (const item of successfulItemsForInvocation(invocation)) {
            const characterA = normalizeCharacterSummary(item.characterA);
            const characterB = normalizeCharacterSummary(item.characterB);
            pushRelationshipUpdate(updates, {
                action: item.relationshipAction,
                source: characterA,
                target: characterB,
                relationship: item.relationship,
                previousRelationship: item.previousRelationship
            });
            if (item.reciprocalRelationship !== null && item.reciprocalRelationship !== undefined) {
                pushRelationshipUpdate(updates, {
                    action: item.reciprocalRelationshipAction,
                    source: characterB,
                    target: characterA,
                    relationship: item.reciprocalRelationship,
                    previousRelationship: item.previousReciprocalRelationship
                });
            }
        }
    }
    return updates;
}

function formatTrackerUpdatesContent(updates) {
    const lines = [];
    for (const update of updates) {
        const label = trackerActionLabel(update.action);
        const name = escapeMarkdownInline(update.name);
        const value = escapeMarkdownInline(update.value);
        if (update.action === 'deleted') {
            lines.push(`- ${label} **${name}**`);
        } else if (value) {
            lines.push(`- ${label} **${name}**: ${value}`);
        } else {
            lines.push(`- ${label} **${name}**`);
        }
    }
    return lines.join('\n');
}

function formatRelationshipUpdatesContent(updates) {
    const lines = [];
    for (const update of updates) {
        const label = relationshipActionLabel(update.action);
        const sourceName = escapeMarkdownInline(update.characterA?.name || 'Unknown character');
        const targetName = escapeMarkdownInline(update.characterB?.name || 'Unknown character');
        const relationship = escapeMarkdownInline(update.relationship);
        if (update.action === 'deleted') {
            lines.push(`- ${label} **${sourceName}** -> **${targetName}**`);
        } else {
            lines.push(`- ${label} **${sourceName}** -> **${targetName}**: ${relationship}`);
        }
    }
    return lines.join('\n');
}

function buildBaseEntryMetadata({ requestId = null } = {}) {
    const metadata = {
        excludeFromBaseContextHistory: true,
        housekeepingUpdates: true
    };
    const normalizedRequestId = makeOptionalString(requestId);
    if (normalizedRequestId) {
        metadata.requestId = normalizedRequestId;
    }
    return metadata;
}

function buildHousekeepingUpdateLogEntries(toolInvocations, {
    locationId = null,
    requestId = null,
    parentId = null,
    timestamp = null
} = {}) {
    const trackerUpdates = collectTrackerUpdates(toolInvocations);
    const relationshipUpdates = collectRelationshipUpdates(toolInvocations);
    const entries = [];
    const baseLocationId = makeOptionalString(locationId);
    const baseParentId = makeOptionalString(parentId);
    const baseTimestamp = makeOptionalString(timestamp);

    if (trackerUpdates.length) {
        const entry = {
            role: 'assistant',
            type: 'tracker-updates',
            content: formatTrackerUpdatesContent(trackerUpdates),
            summary: `Tracker updates: ${trackerUpdates.length} ${pluralize(trackerUpdates.length, 'change')}.`,
            metadata: {
                ...buildBaseEntryMetadata({ requestId }),
                trackerUpdates: clonePlainValue(trackerUpdates)
            }
        };
        if (baseLocationId) {
            entry.locationId = baseLocationId;
        }
        if (baseParentId) {
            entry.parentId = baseParentId;
        }
        if (baseTimestamp) {
            entry.timestamp = baseTimestamp;
        }
        entries.push(entry);
    }

    if (relationshipUpdates.length) {
        const entry = {
            role: 'assistant',
            type: 'relationship-updates',
            content: formatRelationshipUpdatesContent(relationshipUpdates),
            summary: `Relationship updates: ${relationshipUpdates.length} ${pluralize(relationshipUpdates.length, 'change')}.`,
            metadata: {
                ...buildBaseEntryMetadata({ requestId }),
                relationshipUpdates: clonePlainValue(relationshipUpdates)
            }
        };
        if (baseLocationId) {
            entry.locationId = baseLocationId;
        }
        if (baseParentId) {
            entry.parentId = baseParentId;
        }
        if (baseTimestamp) {
            entry.timestamp = baseTimestamp;
        }
        entries.push(entry);
    }

    return entries;
}

module.exports = {
    buildHousekeepingUpdateLogEntries,
    collectRelationshipUpdates,
    collectTrackerUpdates
};
