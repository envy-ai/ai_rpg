'use strict';

const IdGenerator = require('./IdGenerator.js');
const FactionFavorEffectRegistry = require('./FactionFavorEffectRegistry.js');

const PRESENCE_VALUES = Object.freeze(['anywhere', 'faction-presence']);

const requireText = (value, label) => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string.`);
    }
    return value.trim();
};

const optionalText = (value, label) => {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
    return value.trim();
};

const parseBoolean = (value, label) => {
    if (value === undefined || value === null || value === '') return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase();
        if (lowered === 'true') return true;
        if (lowered === 'false') return false;
    }
    throw new Error(`${label} must be true or false.`);
};

const parseCooldownMinutes = (raw, label) => {
    if (raw.cooldownMinutes !== undefined && raw.cooldownMinutes !== null && raw.cooldownMinutes !== '') {
        const minutes = Number(raw.cooldownMinutes);
        if (!Number.isSafeInteger(minutes) || minutes <= 0) {
            throw new Error(`${label}.cooldownMinutes must be a positive whole number of minutes.`);
        }
        return minutes;
    }
    if (raw.cooldown === undefined || raw.cooldown === null || raw.cooldown === '') {
        throw new Error(`${label} requires a cooldown, such as "3 days" or cooldownMinutes.`);
    }
    if (typeof raw.cooldown === 'number') {
        if (!Number.isSafeInteger(raw.cooldown) || raw.cooldown <= 0) {
            throw new Error(`${label}.cooldown must be a positive whole number of minutes or a duration such as "3 days".`);
        }
        return raw.cooldown;
    }
    const Utils = require('./Utils.js');
    let minutes;
    try {
        minutes = Utils.parseDurationToMinutes(String(raw.cooldown), { fieldName: `${label}.cooldown` });
    } catch (error) {
        throw new Error(`${label}.cooldown "${raw.cooldown}" is not a valid duration. Use a duration such as "12 hours" or "3 days".`, { cause: error });
    }
    if (!Number.isSafeInteger(minutes) || minutes <= 0) {
        throw new Error(`${label}.cooldown must be a positive duration such as "12 hours" or "3 days".`);
    }
    return minutes;
};

/**
 * Validates one favor against its faction's reputation tiers.
 *
 * @param {object} raw favor fields
 * @param {object} options
 * @param {Array<{threshold:number,label:string}>} options.tiers the faction's normalized tiers
 * @param {string} options.factionName for error messages
 * @param {number} options.index position in the faction's favor list
 * @param {boolean} options.register allocate/register ids (false for detached drafts)
 */
function normalizeFavor(raw, { tiers = [], factionName = 'faction', index = 0, register = true } = {}) {
    const label = `Faction "${factionName}" favor ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`${label} must be an object.`);
    }
    const name = requireText(raw.name, `${label}.name`);
    const named = `Faction "${factionName}" favor "${name}"`;
    const shortDescription = requireText(raw.shortDescription, `${named}.shortDescription`);
    const description = requireText(raw.description, `${named}.description`);

    const minThreshold = Number(raw.minThreshold);
    const positiveThresholds = tiers.map(tier => Number(tier.threshold)).filter(value => Number.isFinite(value) && value > 0);
    if (!Number.isFinite(minThreshold) || !positiveThresholds.includes(minThreshold)) {
        const valid = positiveThresholds.length ? positiveThresholds.join(', ') : 'none (the faction has no reputation tier above 0)';
        throw new Error(`${named}.minThreshold ${raw.minThreshold} does not match a reputation tier above 0. Valid thresholds: ${valid}.`);
    }

    const cooldownMinutes = parseCooldownMinutes(raw, named);
    const requiresTarget = parseBoolean(raw.requiresTarget, `${named}.requiresTarget`);
    const targetPrompt = optionalText(raw.targetPrompt, `${named}.targetPrompt`);
    if (requiresTarget && !targetPrompt) {
        throw new Error(`${named}.targetPrompt is required when requiresTarget is true; it is the hint shown in the target field.`);
    }

    const presence = typeof raw.presence === 'string' && raw.presence.trim()
        ? raw.presence.trim().toLowerCase()
        : 'anywhere';
    if (!PRESENCE_VALUES.includes(presence)) {
        throw new Error(`${named}.presence "${raw.presence}" is invalid. Use one of: ${PRESENCE_VALUES.join(', ')}.`);
    }

    const effect = FactionFavorEffectRegistry.normalize(raw.effect, `${named}.effect`);
    if (effect?.type === 'grant-item' && effect.params.contentsSource === 'target' && !requiresTarget) {
        throw new Error(`${named}.requiresTarget must be true when effect.params.contentsSource is "target". Set requiresTarget to true and supply targetPrompt, or omit contentsSource for a fixed item.`);
    }

    const imageId = typeof raw.imageId === 'string' && raw.imageId.trim() ? raw.imageId.trim() : null;
    const imagePrompt = optionalText(raw.imagePrompt, `${named}.imagePrompt`);

    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;
    if (id && register) {
        IdGenerator.register('favor', id);
    } else if (!id && register) {
        id = IdGenerator.next('favor', name);
    }

    return {
        id,
        name,
        shortDescription,
        description,
        minThreshold,
        cooldownMinutes,
        requiresTarget,
        targetPrompt: requiresTarget ? targetPrompt : '',
        presence,
        effect,
        imageId,
        imagePrompt
    };
}

function normalizeFavorList(value, { tiers = [], factionName = 'faction', register = true } = {}) {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new Error(`Faction "${factionName}" favors must be an array.`);
    }
    const favors = value.map((raw, index) => normalizeFavor(raw, { tiers, factionName, index, register }));
    const seenIds = new Set();
    const seenNames = new Set();
    for (const favor of favors) {
        if (favor.id) {
            if (seenIds.has(favor.id)) throw new Error(`Faction "${factionName}" lists favor id "${favor.id}" more than once.`);
            seenIds.add(favor.id);
        }
        const nameKey = favor.name.toLowerCase();
        if (seenNames.has(nameKey)) throw new Error(`Faction "${factionName}" has more than one favor named "${favor.name}". Favor names must be unique within a faction.`);
        seenNames.add(nameKey);
    }
    return favors;
}

function cloneFavor(favor) {
    return {
        ...favor,
        effect: favor.effect ? { type: favor.effect.type, params: JSON.parse(JSON.stringify(favor.effect.params || {})) } : null
    };
}

module.exports = {
    PRESENCE_VALUES,
    normalizeFavor,
    normalizeFavorList,
    cloneFavor
};
