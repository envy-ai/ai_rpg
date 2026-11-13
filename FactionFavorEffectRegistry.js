'use strict';

/**
 * Typed, engine-guaranteed effects that a faction favor may carry.
 *
 * Each handler provides:
 * - description: one line used in generation prompts.
 * - normalize(params, label): validates stored params and returns a canonical copy.
 * - prepare(effect, context): validates activation-time state and returns a plan.
 *   It must not mutate anything; failures here leave the world unchanged.
 * - apply(effect, plan, context): performs the mutation and returns
 *   { summary, details, grantGuard? }.
 */

const requireText = (value, label) => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string.`);
    }
    return value.trim();
};

const requirePlainObject = (value, label) => {
    if (value === null || value === undefined) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object.`);
    }
    return value;
};

const rejectUnknownKeys = (params, allowed, label) => {
    for (const key of Object.keys(params)) {
        if (!allowed.includes(key)) {
            const valid = allowed.length ? allowed.join(', ') : 'none';
            throw new Error(`${label} has unknown field "${key}". Valid fields: ${valid}.`);
        }
    }
};

const requireDependency = (context, name) => {
    const dependency = context?.deps?.[name];
    if (typeof dependency !== 'function') {
        throw new Error(`Favor effect requires the "${name}" dependency.`);
    }
    return dependency;
};

const locationIsControlledBy = (location, factionId, findRegionById) => {
    if (!location || !factionId) return false;
    if (location.controllingFactionId === factionId) return true;
    const regionId = typeof location.regionId === 'string' ? location.regionId : null;
    const region = regionId && typeof findRegionById === 'function' ? findRegionById(regionId) : null;
    return Boolean(region && region.controllingFactionId === factionId);
};

const handlers = {
    'reveal-route': {
        description: 'Reveals one hidden route near territory the faction controls. No extra fields.',
        normalize(params, label) {
            rejectUnknownKeys(requirePlainObject(params, label), [], label);
            return {};
        },
        prepare(effect, context) {
            const { faction, deps } = context;
            const getAllLocations = requireDependency(context, 'getAllLocations');
            const findRegionById = typeof deps.findRegionById === 'function' ? deps.findRegionById : null;
            const currentRegionId = context.location?.regionId || null;
            const candidates = [];
            for (const location of getAllLocations()) {
                if (!location || location.isStub === true) continue;
                if (typeof location.getAvailableDirections !== 'function' || typeof location.getExit !== 'function') continue;
                if (!locationIsControlledBy(location, faction.id, findRegionById)) continue;
                for (const direction of location.getAvailableDirections()) {
                    const exit = location.getExit(direction);
                    if (!exit || exit.hiddenFromPlayer !== true) continue;
                    const destinationId = typeof exit.destination === 'string' ? exit.destination.trim() : '';
                    if (!destinationId) continue;
                    candidates.push({ location, exit, direction, destinationId });
                }
            }
            if (!candidates.length) {
                throw new Error(`${faction.name} knows of no hidden routes in territory it controls, so this favor cannot be used right now.`);
            }
            candidates.sort((left, right) => {
                const leftLocal = left.location.regionId === currentRegionId ? 0 : 1;
                const rightLocal = right.location.regionId === currentRegionId ? 0 : 1;
                if (leftLocal !== rightLocal) return leftLocal - rightLocal;
                return `${left.location.id}:${left.exit.id}`.localeCompare(`${right.location.id}:${right.exit.id}`);
            });
            return candidates[0];
        },
        apply(effect, plan, context) {
            const { revealHiddenExit } = require('./HiddenDiscovery.js');
            const findLocationById = requireDependency(context, 'findLocationById');
            revealHiddenExit({
                sourceLocation: plan.location,
                exitId: plan.exit.id,
                expectedDestinationLocationId: plan.destinationId,
                allowAlreadyVisible: true,
                findLocationById
            });
            const destination = findLocationById(plan.destinationId);
            const destinationName = destination?.name || plan.destinationId;
            return {
                summary: `Revealed a hidden route from ${plan.location.name || plan.location.id} to ${destinationName}.`,
                details: {
                    sourceLocationId: plan.location.id,
                    exitId: plan.exit.id,
                    destinationLocationId: plan.destinationId
                }
            };
        }
    },

    'grant-item': {
        description: 'Gives the player one item (itemName, itemDescription).',
        normalize(params, label) {
            const source = requirePlainObject(params, label);
            rejectUnknownKeys(source, ['name', 'description'], label);
            return {
                name: requireText(source.name, `${label}.name`),
                description: requireText(source.description, `${label}.description`)
            };
        },
        prepare(effect, context) {
            requireDependency(context, 'generateItemsByNames');
            return {};
        },
        async apply(effect, plan, context) {
            const generateItemsByNames = requireDependency(context, 'generateItemsByNames');
            const created = await generateItemsByNames({
                itemNames: [effect.params.name],
                owner: context.player,
                seeds: [{ name: effect.params.name, description: effect.params.description, itemOrScenery: 'item' }],
                options: {
                    mergeStacks: false,
                    creationMetadata: { factionFavorId: context.favor.id, factionId: context.faction.id }
                }
            });
            if (!Array.isArray(created) || created.length !== 1) {
                throw new Error(`Favor "${context.favor.name}" item "${effect.params.name}" did not generate exactly once.`);
            }
            const itemName = typeof created[0]?.name === 'string' && created[0].name.trim()
                ? created[0].name.trim()
                : effect.params.name;
            return {
                summary: `The player received ${itemName}.`,
                details: { itemId: created[0]?.id || null, itemName },
                grantGuard: { itemNames: Array.from(new Set([itemName, effect.params.name])) }
            };
        }
    },

    'grant-currency': {
        description: 'Gives the player currency (amount, a positive whole number).',
        normalize(params, label) {
            const source = requirePlainObject(params, label);
            rejectUnknownKeys(source, ['amount'], label);
            const amount = Number(source.amount);
            if (!Number.isSafeInteger(amount) || amount <= 0) {
                throw new Error(`${label}.amount must be a positive whole number.`);
            }
            return { amount };
        },
        prepare(effect, context) {
            if (typeof context.player?.adjustCurrency !== 'function') {
                throw new Error('grant-currency requires a player that can hold currency.');
            }
            return {};
        },
        apply(effect, plan, context) {
            context.player.adjustCurrency(effect.params.amount);
            return {
                summary: `The player received ${effect.params.amount} currency.`,
                details: { amount: effect.params.amount },
                grantGuard: { currencyAmount: effect.params.amount }
            };
        }
    },

    'fast-travel': {
        description: 'Takes the player to a visited location the faction controls; the player picks the destination. No extra fields.',
        normalize(params, label) {
            rejectUnknownKeys(requirePlainObject(params, label), [], label);
            return {};
        },
        prepare(effect, context) {
            const destinationId = typeof context.fastTravelLocationId === 'string' ? context.fastTravelLocationId.trim() : '';
            if (!destinationId) {
                throw new Error(`Favor "${context.favor.name}" needs a fastTravelLocationId. Pick one of the faction's locations.`);
            }
            const targets = context.listFastTravelTargets();
            const target = targets.find(entry => entry.id === destinationId);
            if (!target) {
                const valid = targets.map(entry => entry.name).join(', ') || 'none';
                throw new Error(`Location "${destinationId}" is not a visited location controlled by ${context.faction.name}. Valid destinations: ${valid}.`);
            }
            return { target };
        },
        apply(effect, plan) {
            // Movement itself runs through the ordinary fast-travel turn and
            // teleport flow so arrival processing stays identical to map travel.
            return {
                summary: `${plan.target.name} is the destination; the faction provides passage there.`,
                details: { destinationLocationId: plan.target.id, destinationName: plan.target.name }
            };
        }
    },

    'restore-needs': {
        description: 'Sets need bars to a percentage, as a meal or a night of lodging would (needBars: a name and a percentage from 0 to 100 for each).',
        normalize(params, label) {
            const source = requirePlainObject(params, label);
            rejectUnknownKeys(source, ['bars'], label);
            if (!Array.isArray(source.bars) || !source.bars.length) {
                throw new Error(`${label}.bars must be a non-empty list of { needBar, percentage }.`);
            }
            const seen = new Set();
            const bars = source.bars.map((entry, index) => {
                const entryLabel = `${label}.bars[${index}]`;
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                    throw new Error(`${entryLabel} must be an object with needBar and percentage.`);
                }
                rejectUnknownKeys(entry, ['needBar', 'percentage'], entryLabel);
                const needBar = requireText(entry.needBar, `${entryLabel}.needBar`);
                const percentage = Number(entry.percentage);
                if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
                    throw new Error(`${entryLabel}.percentage must be a number from 0 to 100.`);
                }
                const key = needBar.toLowerCase();
                if (seen.has(key)) throw new Error(`${entryLabel}.needBar "${needBar}" is listed more than once.`);
                seen.add(key);
                return { needBar, percentage };
            });
            return { bars };
        },
        prepare(effect, context) {
            const player = context.player;
            if (typeof player?.getNeedBars !== 'function' || typeof player.setNeedBarPercentages !== 'function') {
                throw new Error('restore-needs requires a player with need bars.');
            }
            const activeBars = player.getNeedBars({ scope: 'active' });
            const resolved = effect.params.bars.map((entry) => {
                const key = entry.needBar.toLowerCase();
                const bar = activeBars.find(candidate => String(candidate.id || '').toLowerCase() === key
                    || String(candidate.name || '').toLowerCase() === key);
                if (!bar) {
                    const valid = activeBars.map(candidate => candidate.name || candidate.id).join(', ') || 'none';
                    throw new Error(`Need bar "${entry.needBar}" is not active for the player. Active need bars: ${valid}.`);
                }
                return { id: bar.id, name: bar.name || bar.id, percentage: entry.percentage };
            });
            return { resolved };
        },
        apply(effect, plan, context) {
            context.player.setNeedBarPercentages(plan.resolved.map(entry => ({ id: entry.id, percentage: entry.percentage })));
            const text = plan.resolved.map(entry => `${entry.name} ${entry.percentage}%`).join(', ');
            return {
                summary: `The player's needs were restored (${text}).`,
                details: { bars: plan.resolved }
            };
        }
    }
};

class FactionFavorEffectRegistry {
    static get types() {
        return Object.keys(handlers);
    }

    static has(type) {
        return Object.prototype.hasOwnProperty.call(handlers, type);
    }

    static get(type) {
        if (!FactionFavorEffectRegistry.has(type)) {
            throw new Error(`Unknown favor effect type "${type}". Valid types: ${FactionFavorEffectRegistry.types.join(', ')}.`);
        }
        return handlers[type];
    }

    static describeAll() {
        return Object.entries(handlers).map(([type, handler]) => ({ type, description: handler.description }));
    }

    static normalize(effect, label = 'effect') {
        if (effect === null || effect === undefined) return null;
        if (typeof effect !== 'object' || Array.isArray(effect)) {
            throw new Error(`${label} must be null or an object with type and params.`);
        }
        const type = typeof effect.type === 'string' ? effect.type.trim() : '';
        if (!type || type === 'none') return null;
        const handler = FactionFavorEffectRegistry.get(type);
        return { type, params: handler.normalize(effect.params, `${label}.params`) };
    }
}

module.exports = FactionFavorEffectRegistry;
