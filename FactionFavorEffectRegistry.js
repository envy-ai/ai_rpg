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
        description: 'Gives the player one item (itemName, itemDescription). Set contentsSource to target to deliver a container holding the requested target item.',
        normalize(params, label) {
            const source = requirePlainObject(params, label);
            rejectUnknownKeys(source, ['name', 'description', 'contentsSource'], label);
            const contentsSource = source.contentsSource === undefined || source.contentsSource === null
                ? '' : source.contentsSource;
            if (typeof contentsSource !== 'string' || (contentsSource.trim() && contentsSource.trim() !== 'target')) {
                throw new Error(`${label}.contentsSource must be "target" or omitted/empty. Use "target" to fill a container from the activation target, or leave it empty for a fixed item.`);
            }
            return {
                name: requireText(source.name, `${label}.name`),
                description: requireText(source.description, `${label}.description`),
                ...(contentsSource.trim() ? { contentsSource: 'target' } : {})
            };
        },
        prepare(effect, context) {
            requireDependency(context, 'generateItemsByNames');
            if (effect.params.contentsSource === 'target') {
                requireDependency(context, 'generateContainerContentsForThing');
                requireText(context.target, 'favorActivation.target');
            }
            return {};
        },
        async apply(effect, plan, context) {
            const generateItemsByNames = requireDependency(context, 'generateItemsByNames');
            const targetContents = effect.params.contentsSource === 'target';
            const ownedThings = [];
            try {
                const created = await generateItemsByNames({
                    itemNames: [effect.params.name],
                    owner: context.player,
                    seeds: [{
                        name: effect.params.name,
                        description: effect.params.description,
                        itemOrScenery: 'item',
                        ...(targetContents ? { isContainer: true, containerContents: [{ name: context.target, count: 1 }] } : {})
                    }],
                    options: {
                        mergeStacks: false,
                        creationMetadata: { factionFavorId: context.favor.id, factionId: context.faction.id },
                        ...(targetContents ? { onCreated: thing => ownedThings.push(thing) } : {})
                    }
                });
                if (!Array.isArray(created) || created.length !== 1) {
                    throw new Error(`Favor "${context.favor.name}" item "${effect.params.name}" did not generate exactly once.`);
                }
                const item = created[0];
                let contents = [];
                if (targetContents) {
                    if (!item.isContainer || !Array.isArray(item.containerContents)
                        || !item.containerContents.some(entry => entry.name === context.target && entry.count >= 1)) {
                        throw new Error(`Favor "${context.favor.name}" effect.params.contentsSource requires containerContents to include favorActivation.target "${context.target}". Keep this seed on the generated container before hydration.`);
                    }
                    contents = await context.deps.generateContainerContentsForThing({
                        container: item,
                        location: context.location,
                        onCreated: things => ownedThings.push(...things)
                    });
                    if (!Array.isArray(contents) || !contents.length || item.containerContents.length) {
                        throw new Error(`Favor "${context.favor.name}" did not finish hydrating the requested container contents.`);
                    }
                    const attachedIds = new Set(item.getInventoryItems().map(thing => thing.id));
                    if (contents.some(thing => !thing?.id || !attachedIds.has(thing.id)) || attachedIds.size !== contents.length) {
                        throw new Error(`Favor "${context.favor.name}" generated contents were not all attached to the granted container. Generate and attach every requested item before completing the favor.`);
                    }
                }
                const itemName = typeof item?.name === 'string' && item.name.trim()
                    ? item.name.trim() : effect.params.name;
                const contentNames = contents.map(thing => thing.name);
                return {
                    summary: targetContents
                        ? `The player received ${itemName} containing ${contents.map(thing => `${thing.count || 1} ${thing.name}`).join(', ')}.`
                        : `The player received ${itemName}.`,
                    details: { itemId: item?.id || null, itemName,
                        ...(targetContents ? { containedItemIds: contents.map(thing => thing.id), containedItemNames: contentNames } : {}) },
                    grantGuard: { itemNames: Array.from(new Set([itemName, effect.params.name,
                        ...(targetContents ? [context.target, ...contentNames] : [])])) }
                };
            } catch (error) {
                if (!targetContents || !ownedThings.length) throw error;
                const Thing = require('./Thing.js');
                const rollbackErrors = [];
                for (const thing of ownedThings.slice().reverse()) {
                    try {
                        if (thing?.id && Thing.getById(thing.id) === thing) thing.delete({ remember: false });
                    } catch (rollbackError) {
                        rollbackErrors.push(rollbackError);
                    }
                }
                if (rollbackErrors.length) {
                    throw new AggregateError([error, ...rollbackErrors], `Favor "${context.favor.name}" failed and item rollback was incomplete: ${error.message}`, { cause: error });
                }
                throw error;
            }
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
