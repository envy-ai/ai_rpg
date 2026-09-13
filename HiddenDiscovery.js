'use strict';

const DISCOVERY_DIFFICULTY_LABELS = Object.freeze([
    'Trivial',
    'Easy',
    'Medium',
    'Hard',
    'Very Hard',
    'Legendary'
]);

const LABEL_BY_KEY = new Map(
    DISCOVERY_DIFFICULTY_LABELS.map(label => [label.toLowerCase().replace(/[\s_-]+/g, ''), label])
);

function normalizeDiscoveryDifficulty(value, { allowNull = true, fieldName = 'discoveryDifficulty' } = {}) {
    if (value === null || value === undefined || value === '') {
        if (allowNull) return null;
        throw new Error(`${fieldName} is required for a hidden target.`);
    }
    if (typeof value !== 'string') {
        throw new TypeError(`${fieldName} must be a difficulty label or null.`);
    }
    const normalized = LABEL_BY_KEY.get(value.trim().toLowerCase().replace(/[\s_-]+/g, '')) || null;
    if (!normalized) {
        throw new Error(`${fieldName} must be one of: ${DISCOVERY_DIFFICULTY_LABELS.join(', ')}.`);
    }
    return normalized;
}

function normalizeHiddenFlag(value, { fieldName = 'hiddenFromPlayer' } = {}) {
    if (typeof value !== 'boolean') {
        throw new TypeError(`${fieldName} must be a boolean.`);
    }
    return value;
}

function validateHiddenDiscoveryPair({ hiddenFromPlayer = false, discoveryDifficulty = null } = {}, {
    targetLabel = 'Target'
} = {}) {
    const hidden = normalizeHiddenFlag(hiddenFromPlayer, { fieldName: `${targetLabel} hiddenFromPlayer` });
    const difficulty = normalizeDiscoveryDifficulty(discoveryDifficulty, {
        allowNull: !hidden,
        fieldName: `${targetLabel} discoveryDifficulty`
    });
    if (!hidden && difficulty !== null) {
        throw new Error(`${targetLabel} discoveryDifficulty must be null when hiddenFromPlayer is false.`);
    }
    return Object.freeze({ hiddenFromPlayer: hidden, discoveryDifficulty: difficulty });
}

function normalizeOptionalSkill(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return !text || /^n\/?a$/i.test(text) || /^none$/i.test(text) ? null : text;
}

function buildHiddenDiscoveryPlausibility({ targetName, discoveryDifficulty, perceptionAttribute, perceptionSkill = null } = {}) {
    const name = typeof targetName === 'string' && targetName.trim() ? targetName.trim() : 'a hidden feature';
    const attribute = typeof perceptionAttribute === 'string' ? perceptionAttribute.trim() : '';
    if (!attribute) {
        throw new Error('Automatic hidden discovery requires the active setting perceptionAttribute.');
    }
    const difficulty = normalizeDiscoveryDifficulty(discoveryDifficulty, {
        allowNull: false,
        fieldName: `Hidden target "${name}" discoveryDifficulty`
    });
    const skill = normalizeOptionalSkill(perceptionSkill);
    const reason = `The player attempts to notice ${name}.`;
    return {
        type: 'Plausible',
        reason,
        skillCheck: {
            reason,
            skill,
            attribute,
            difficulty,
            checkType: 'unopposed',
            circumstanceModifiers: []
        }
    };
}

function assertThingVisibleToPlayerForInteraction(thing, { action = 'interact with' } = {}) {
    if (!thing || typeof thing !== 'object') {
        throw new TypeError(`Cannot ${action} an invalid Thing.`);
    }
    if (thing.hiddenFromPlayer === true) {
        throw new Error(`Cannot ${action} hidden Thing "${thing.name || thing.id || 'unknown'}" until it is revealed.`);
    }
    return thing;
}

function assertExitVisibleToPlayerForTravel(exit, { direction = null } = {}) {
    if (!exit || typeof exit !== 'object') {
        throw new TypeError('Cannot travel through an invalid exit.');
    }
    if (exit.hiddenFromPlayer === true) {
        const label = direction || exit.name || exit.id || 'unknown';
        throw new Error(`Cannot travel through hidden exit "${label}" until it is revealed.`);
    }
    return exit;
}

async function runAutomaticHiddenDiscoveryForFirstEntry({
    player,
    location,
    wasVisitedBeforeArrival,
    perceptionAttribute,
    perceptionSkill = null,
    resolveActionOutcome,
    recordResult = null
} = {}) {
    if (wasVisitedBeforeArrival !== false) return { checks: [], revealed: [], locationRefreshRequested: false };
    if (!player || !location) throw new Error('Automatic hidden discovery requires a player and destination location.');
    if (typeof resolveActionOutcome !== 'function') throw new Error('Automatic hidden discovery requires resolveActionOutcome.');
    if (recordResult !== null && typeof recordResult !== 'function') throw new TypeError('Automatic hidden discovery recordResult must be a function or null.');

    const targets = [];
    for (const thing of Array.isArray(location.things) ? location.things : []) {
        if (thing?.hiddenFromPlayer === true) targets.push({ targetType: 'thing', thingType: thing.thingType || null, target: thing });
    }
    for (const direction of typeof location.getAvailableDirections === 'function' ? location.getAvailableDirections() : []) {
        const exit = location.getExit(direction);
        if (exit?.hiddenFromPlayer === true) targets.push({ targetType: 'exit', target: exit, direction });
    }

    const checks = [];
    const revealed = [];
    for (const targetEntry of targets) {
        const target = targetEntry.target;
        const targetName = targetEntry.targetType === 'exit'
            ? (target.name || target.description || targetEntry.direction || target.id)
            : (target.name || target.id);
        const plausibility = buildHiddenDiscoveryPlausibility({
            targetName,
            discoveryDifficulty: target.discoveryDifficulty,
            perceptionAttribute,
            perceptionSkill
        });
        const resolution = await resolveActionOutcome({ plausibility, player });
        if (!resolution || typeof resolution !== 'object') {
            throw new Error(`Automatic hidden discovery for "${targetName}" did not return an action resolution.`);
        }
        if (resolution.success === true) {
            target.setHiddenDiscovery({ hiddenFromPlayer: false, discoveryDifficulty: null });
            revealed.push(target);
        }
        const check = {
            automaticHiddenDiscovery: true,
            targetType: targetEntry.targetType,
            targetId: target.id || null,
            targetName: targetName || null,
            direction: targetEntry.direction || null,
            thingType: targetEntry.thingType || null,
            success: resolution.success === true,
            resolution
        };
        checks.push(check);
        if (recordResult) await recordResult(check);
    }
    return { checks, revealed, locationRefreshRequested: revealed.length > 0 };
}

module.exports = {
    DISCOVERY_DIFFICULTY_LABELS,
    normalizeDiscoveryDifficulty,
    validateHiddenDiscoveryPair,
    buildHiddenDiscoveryPlausibility,
    assertThingVisibleToPlayerForInteraction,
    assertExitVisibleToPlayerForTravel,
    runAutomaticHiddenDiscoveryForFirstEntry
};
