'use strict';

const FactionFavorEffectRegistry = require('./FactionFavorEffectRegistry.js');

const STATUS = Object.freeze({
    LOCKED: 'locked',
    COOLDOWN: 'cooldown',
    NEEDS_PRESENCE: 'needs-presence',
    AVAILABLE: 'available'
});

const MAX_TARGET_LENGTH = 300;

function formatDuration(minutes) {
    const Utils = require('./Utils.js');
    return Utils.formatMinutesAsDuration(Math.max(0, Math.round(minutes))) || `${minutes} minutes`;
}

function resolveConfig(config = {}) {
    const section = config?.faction_favors;
    if (section === undefined || section === null) {
        return { enabled: true, rivalWitnessPenalty: 1 };
    }
    if (typeof section !== 'object' || Array.isArray(section)) {
        throw new Error('faction_favors must be a mapping with enabled and rival_witness_penalty.');
    }
    const enabled = section.enabled === undefined ? true : section.enabled;
    if (typeof enabled !== 'boolean') {
        throw new Error('faction_favors.enabled must be true or false.');
    }
    const penalty = section.rival_witness_penalty === undefined ? 1 : section.rival_witness_penalty;
    if (!Number.isSafeInteger(penalty) || penalty < 0) {
        throw new Error('faction_favors.rival_witness_penalty must be a whole number of 0 or more (0 disables rival penalties).');
    }
    return { enabled, rivalWitnessPenalty: penalty };
}

function getPlayerStanding(player, factionId) {
    const standing = typeof player?.getFactionStanding === 'function' ? player.getFactionStanding(factionId) : null;
    return Number.isFinite(standing) ? standing : 0;
}

function resolveTier(faction, player) {
    const standing = getPlayerStanding(player, faction.id);
    return { standing, tier: faction.resolveReputationTier(standing) };
}

function tierLabelFor(faction, threshold) {
    const tier = faction.reputationTiers.find(entry => entry.threshold === threshold);
    return tier?.label || `standing ${threshold}`;
}

function collectSceneActors({ player, location, deps }) {
    const actors = [];
    const findActorById = typeof deps?.findActorById === 'function' ? deps.findActorById : () => null;
    const ids = new Set();
    for (const id of (Array.isArray(location?.npcIds) ? location.npcIds : [])) ids.add(id);
    const partyIds = typeof player?.getPartyMembers === 'function' ? player.getPartyMembers() : [];
    for (const id of partyIds) ids.add(id);
    for (const id of ids) {
        const actor = findActorById(id);
        if (!actor || actor === player || actor.isDead === true) continue;
        actors.push(actor);
    }
    return actors;
}

function hasFactionPresence({ faction, player, location, deps }) {
    if (!location) return false;
    if (location.controllingFactionId === faction.id) return true;
    const findRegionById = typeof deps?.findRegionById === 'function' ? deps.findRegionById : null;
    const region = location.regionId && findRegionById ? findRegionById(location.regionId) : null;
    if (region && region.controllingFactionId === faction.id) return true;
    return collectSceneActors({ player, location, deps }).some(actor => actor.factionId === faction.id);
}

function getFavorStatus({ player, faction, favor, location, worldMinute, deps }) {
    const { standing, tier } = resolveTier(faction, player);
    if (!tier || tier.threshold < favor.minThreshold) {
        return {
            status: STATUS.LOCKED,
            standing,
            reason: `Requires ${tierLabelFor(faction, favor.minThreshold)} standing with ${faction.name}.`
        };
    }
    const usage = typeof player?.getFavorUsage === 'function' ? player.getFavorUsage(favor.id) : null;
    if (usage) {
        const readyAtWorldMinute = usage.lastUsedWorldMinute + favor.cooldownMinutes;
        if (worldMinute < readyAtWorldMinute) {
            const readyInMinutes = readyAtWorldMinute - worldMinute;
            return {
                status: STATUS.COOLDOWN,
                standing,
                readyAtWorldMinute,
                readyInMinutes,
                readyIn: formatDuration(readyInMinutes),
                reason: `${favor.name} is ready again in ${formatDuration(readyInMinutes)}.`
            };
        }
    }
    if (favor.presence === 'faction-presence' && !hasFactionPresence({ faction, player, location, deps })) {
        return {
            status: STATUS.NEEDS_PRESENCE,
            standing,
            reason: `${favor.name} needs ${faction.name}'s presence: a location or region they control, or one of their members nearby.`
        };
    }
    return { status: STATUS.AVAILABLE, standing, reason: null };
}

/** Favors with status for every faction, ordered by faction name then threshold. */
function listPlayerFavors({ player, factions, location, worldMinute, deps, includeLocked = true }) {
    const rows = [];
    const sortedFactions = Array.from(factions || []).filter(Boolean)
        .sort((left, right) => left.name.localeCompare(right.name));
    for (const faction of sortedFactions) {
        const favors = faction.favors.slice().sort((left, right) => left.minThreshold - right.minThreshold
            || left.name.localeCompare(right.name));
        for (const favor of favors) {
            const status = getFavorStatus({ player, faction, favor, location, worldMinute, deps });
            if (!includeLocked && status.status === STATUS.LOCKED) continue;
            rows.push({
                faction: {
                    id: faction.id,
                    name: faction.name,
                    imageId: faction.imageId || null
                },
                favor,
                tierLabel: tierLabelFor(faction, favor.minThreshold),
                cooldown: formatDuration(favor.cooldownMinutes),
                ...status
            });
        }
    }
    return rows;
}

/** Compact rows for the base-context <factionFavors> block. Locked favors are omitted. */
function buildPromptRows(options) {
    return listPlayerFavors({ ...options, includeLocked: false }).map(row => ({
        factionName: row.faction.name,
        name: row.favor.name,
        shortDescription: row.favor.shortDescription,
        status: row.status === STATUS.COOLDOWN
            ? `ready in ${row.readyIn}`
            : (row.status === STATUS.NEEDS_PRESENCE ? 'needs presence' : 'available')
    }));
}

function listFastTravelTargets({ faction, player, deps }) {
    const getAllLocations = typeof deps?.getAllLocations === 'function' ? deps.getAllLocations : () => [];
    const findRegionById = typeof deps?.findRegionById === 'function' ? deps.findRegionById : null;
    const currentLocationId = player?.currentLocation || null;
    const targets = [];
    for (const location of getAllLocations()) {
        if (!location || location.isStub === true || location.visited !== true) continue;
        if (location.id === currentLocationId) continue;
        const region = location.regionId && findRegionById ? findRegionById(location.regionId) : null;
        const controlled = location.controllingFactionId === faction.id
            || Boolean(region && region.controllingFactionId === faction.id);
        if (!controlled) continue;
        targets.push({ id: location.id, name: location.name || location.id, regionName: region?.name || null });
    }
    return targets.sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeActivationRequest(raw) {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('favorActivation must be an object with favorId and optional target or fastTravelLocationId.');
    }
    for (const key of Object.keys(raw)) {
        if (!['favorId', 'target', 'fastTravelLocationId'].includes(key)) {
            throw new Error(`favorActivation has unknown field "${key}". Valid fields: favorId, target, fastTravelLocationId.`);
        }
    }
    if (typeof raw.favorId !== 'string' || !raw.favorId.trim()) {
        throw new Error('favorActivation.favorId must be a non-empty favor id.');
    }
    if (raw.target !== undefined && raw.target !== null && typeof raw.target !== 'string') {
        throw new Error('favorActivation.target must be a string when provided.');
    }
    const target = typeof raw.target === 'string' ? raw.target.trim() : '';
    if (target.length > MAX_TARGET_LENGTH) {
        throw new Error(`favorActivation.target must be ${MAX_TARGET_LENGTH} characters or fewer.`);
    }
    if (raw.fastTravelLocationId !== undefined && raw.fastTravelLocationId !== null
        && (typeof raw.fastTravelLocationId !== 'string' || !raw.fastTravelLocationId.trim())) {
        throw new Error('favorActivation.fastTravelLocationId must be a non-empty location id when provided.');
    }
    return {
        favorId: raw.favorId.trim(),
        target,
        fastTravelLocationId: typeof raw.fastTravelLocationId === 'string' ? raw.fastTravelLocationId.trim() : null
    };
}

function buildActionText({ faction, favor, target }) {
    const base = `I call in a favor from ${faction.name}: ${favor.name}.`;
    return target ? `${base} ${target}` : base;
}

function computeRivalPenalties({ faction, player, location, deps, basePenalty }) {
    if (!basePenalty) return [];
    const getAllFactions = typeof deps?.getAllFactions === 'function' ? deps.getAllFactions : () => [];
    const actors = collectSceneActors({ player, location, deps });
    const penalties = [];
    for (const other of getAllFactions()) {
        if (!other || other.id === faction.id) continue;
        const relation = other.getRelation(faction.id);
        if (!relation || (relation.status !== 'rival' && relation.status !== 'hostile')) continue;
        const witnesses = actors.filter(actor => actor.factionId === other.id);
        if (!witnesses.length) continue;
        const amount = relation.status === 'hostile' ? basePenalty * 2 : basePenalty;
        penalties.push({
            factionId: other.id,
            factionName: other.name,
            relation: relation.status,
            amount: -amount,
            witnessNames: witnesses.map(actor => actor.name).filter(Boolean)
        });
    }
    return penalties;
}

/**
 * Validates and applies a favor activation. Nothing changes if validation
 * fails. The cooldown is recorded only after the effect and rival penalties
 * succeed, so a failure there leaves the favor usable.
 */
async function activate({ request, player, location, worldMinute, config, deps }) {
    const settings = resolveConfig(config);
    if (!settings.enabled) {
        throw new Error('Faction favors are disabled (faction_favors.enabled is false).');
    }
    if (!player) {
        throw new Error('A current player is required to call in a favor.');
    }
    const findFavor = typeof deps?.findFavor === 'function' ? deps.findFavor : null;
    const found = findFavor ? findFavor(request.favorId) : null;
    if (!found) {
        throw new Error(`Favor "${request.favorId}" does not exist.`);
    }
    const { faction, favor } = found;
    const status = getFavorStatus({ player, faction, favor, location, worldMinute, deps });
    if (status.status !== STATUS.AVAILABLE) {
        const error = new Error(status.reason || `${favor.name} is not available.`);
        error.code = 'FAVOR_UNAVAILABLE';
        error.favorStatus = status.status;
        throw error;
    }
    if (favor.requiresTarget && !request.target) {
        throw new Error(`${favor.name} needs a target: ${favor.targetPrompt}`);
    }

    const effectContext = {
        player,
        faction,
        favor,
        location,
        target: request.target,
        deps,
        fastTravelLocationId: request.fastTravelLocationId,
        listFastTravelTargets: () => listFastTravelTargets({ faction, player, deps })
    };
    const handler = favor.effect ? FactionFavorEffectRegistry.get(favor.effect.type) : null;
    const plan = handler ? handler.prepare(favor.effect, effectContext) : null;
    let effectResult = null;
    if (handler) {
        try {
            effectResult = await handler.apply(favor.effect, plan, effectContext);
        } catch (error) {
            const wrapped = new Error(`Applying ${favor.name} (${favor.effect.type}) failed: ${error.message}. The favor was not used and its cooldown did not start.`, { cause: error });
            wrapped.favorStage = 'apply';
            throw wrapped;
        }
    }

    const rivalPenalties = computeRivalPenalties({
        faction, player, location, deps, basePenalty: settings.rivalWitnessPenalty
    });
    for (const penalty of rivalPenalties) {
        player.setFactionStanding(penalty.factionId, getPlayerStanding(player, penalty.factionId) + penalty.amount);
    }

    player.recordFavorUse(favor.id, worldMinute);

    const grantGuard = effectResult?.grantGuard
        ? { favorId: favor.id, favorName: favor.name, factionName: faction.name, ...effectResult.grantGuard }
        : null;
    const actionText = buildActionText({ faction, favor, target: request.target });
    const fastTravel = favor.effect?.type === 'fast-travel' ? effectResult.details : null;

    return {
        faction,
        favor,
        target: request.target,
        actionText,
        effectResult,
        rivalPenalties,
        grantGuard,
        fastTravel,
        promptContext: {
            factionName: faction.name,
            favorName: favor.name,
            description: favor.description,
            target: request.target || '',
            effectSummary: effectResult?.summary || '',
            rivalPenaltySummary: rivalPenalties.map(entry =>
                `${entry.factionName} (${entry.relation}) saw this; standing with them ${entry.amount}.`).join(' ')
        },
        metadata: {
            favorId: favor.id,
            factionId: faction.id,
            favorName: favor.name,
            factionName: faction.name,
            effectType: favor.effect?.type || null,
            effectSummary: effectResult?.summary || null,
            rivalPenalties
        }
    };
}

module.exports = {
    STATUS,
    resolveConfig,
    getFavorStatus,
    hasFactionPresence,
    listPlayerFavors,
    buildPromptRows,
    listFastTravelTargets,
    normalizeActivationRequest,
    buildActionText,
    computeRivalPenalties,
    activate
};
