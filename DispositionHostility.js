'use strict';

function resolveTargetId(target) {
    if (typeof target === 'string') {
        const trimmed = target.trim();
        return trimmed || null;
    }
    if (target && typeof target.id === 'string') {
        const trimmed = target.id.trim();
        return trimmed || null;
    }
    return null;
}

function isActorDispositionHostile(actor, target, dispositionDefinitions) {
    if (!actor || typeof actor !== 'object') {
        throw new TypeError('Disposition hostility requires an actor object.');
    }
    if (!dispositionDefinitions || typeof dispositionDefinitions !== 'object') {
        throw new TypeError('Disposition hostility requires disposition definitions.');
    }

    const targetId = resolveTargetId(target);
    if (!targetId || targetId === actor.id) {
        return false;
    }
    if (typeof actor.getDisposition !== 'function') {
        throw new TypeError('Disposition hostility requires actor.getDisposition(targetId, type).');
    }

    const dispositionTypes = dispositionDefinitions.types;
    if (!dispositionTypes || typeof dispositionTypes !== 'object') {
        throw new TypeError('Disposition hostility requires dispositionDefinitions.types.');
    }

    for (const definition of Object.values(dispositionTypes)) {
        if (!definition || definition.hostileThreshold === null || definition.hostileThreshold === undefined) {
            continue;
        }
        const key = definition.key || definition.label;
        const threshold = Number(definition.hostileThreshold);
        if (!key || !Number.isFinite(threshold)) {
            continue;
        }
        const value = Number(actor.getDisposition(targetId, key));
        if (Number.isFinite(value) && value <= threshold) {
            return true;
        }
    }
    return false;
}

module.exports = {
    isActorDispositionHostile,
    resolveTargetId
};
