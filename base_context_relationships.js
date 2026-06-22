function getActorId(actor) {
    if (!actor || typeof actor !== 'object') {
        return '';
    }
    return typeof actor.id === 'string' ? actor.id.trim() : '';
}

function getActorName(actor, fallbackId = '') {
    if (!actor || typeof actor !== 'object') {
        return fallbackId;
    }
    const name = typeof actor.name === 'string'
        ? actor.name.trim()
        : (typeof actor.getStatus === 'function'
            ? String(actor.getStatus()?.name || '').trim()
            : '');
    return name || fallbackId;
}

function getActorRelationshipEntries(actor) {
    if (!actor || typeof actor !== 'object') {
        return [];
    }

    const source = typeof actor.getRelationships === 'function'
        ? actor.getRelationships()
        : actor.relationships;
    if (!source) {
        return [];
    }

    const entries = source instanceof Map
        ? Array.from(source.entries())
        : (typeof source === 'object' && !Array.isArray(source)
            ? Object.entries(source)
            : null);
    if (!entries) {
        throw new Error('Character relationships must be an object map or Map.');
    }

    return entries.map(([rawTargetId, rawLabel]) => {
        const targetId = typeof rawTargetId === 'string' ? rawTargetId.trim() : '';
        const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
        if (!targetId || !label) {
            throw new Error('Character relationship entries require non-empty target ids and labels.');
        }
        return { targetId, label };
    });
}

function resolveActorById(playersById, id) {
    if (!(playersById instanceof Map)) {
        throw new Error('buildActorRelationshipPromptContext requires playersById to be a Map.');
    }
    return playersById.get(id) || null;
}

function sortRelationshipLines(a, b) {
    const nameDelta = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (nameDelta !== 0) {
        return nameDelta;
    }
    const idA = a.targetId || a.sourceId || '';
    const idB = b.targetId || b.sourceId || '';
    return idA.localeCompare(idB, undefined, { sensitivity: 'base' });
}

function normalizeListedCharacterIds(listedCharacterIds) {
    if (!Array.isArray(listedCharacterIds)) {
        throw new Error('listedCharacterIds must be an array.');
    }
    return new Set(
        listedCharacterIds
            .map(id => (typeof id === 'string' ? id.trim() : ''))
            .filter(Boolean)
    );
}

function buildActorRelationshipPromptContext({
    actor,
    playersById,
    listedCharacterIds = []
} = {}) {
    const actorId = getActorId(actor);
    if (!actorId) {
        return {
            relationships: [],
            reciprocalRelationships: []
        };
    }

    if (!(playersById instanceof Map)) {
        throw new Error('buildActorRelationshipPromptContext requires playersById to be a Map.');
    }

    const listedCharacterIdSet = normalizeListedCharacterIds(listedCharacterIds);
    const relationships = getActorRelationshipEntries(actor)
        .map(({ targetId, label }) => {
            const target = resolveActorById(playersById, targetId);
            return {
                targetId,
                name: getActorName(target, targetId),
                label
            };
        })
        .sort(sortRelationshipLines);

    const reciprocalRelationships = [];
    for (const [rawSourceId, sourceActor] of playersById.entries()) {
        const sourceId = typeof rawSourceId === 'string' && rawSourceId.trim()
            ? rawSourceId.trim()
            : getActorId(sourceActor);
        if (!sourceId || sourceId === actorId || listedCharacterIdSet.has(sourceId)) {
            continue;
        }

        const sourceRelationship = getActorRelationshipEntries(sourceActor)
            .find(entry => entry.targetId === actorId);
        if (!sourceRelationship) {
            continue;
        }

        reciprocalRelationships.push({
            sourceId,
            name: getActorName(sourceActor, sourceId),
            label: sourceRelationship.label
        });
    }
    reciprocalRelationships.sort(sortRelationshipLines);

    return {
        relationships,
        reciprocalRelationships
    };
}

module.exports = {
    buildActorRelationshipPromptContext
};
