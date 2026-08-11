const Globals = require('./Globals.js');
const Location = require('./Location.js');
const Player = require('./Player.js');
const Region = require('./Region.js');
const Utils = require('./Utils.js');

function optionalTrimmedString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeDestination(destination) {
    if (!destination || typeof destination !== 'object' || Array.isArray(destination)) {
        throw new TypeError('Player-action destination context requires a destination object.');
    }
    const locationId = optionalTrimmedString(destination.locationId);
    const regionId = optionalTrimmedString(destination.regionId);
    const location = optionalTrimmedString(destination.location);
    const region = optionalTrimmedString(destination.region);
    if (!locationId && !location && !region) {
        throw new Error('Player-action destination context requires a location id, location name, or region name.');
    }

    let explicitTravelTimeMinutes = null;
    if (destination.travelTimeMinutes !== null && destination.travelTimeMinutes !== undefined) {
        explicitTravelTimeMinutes = Number(destination.travelTimeMinutes);
        if (!Number.isInteger(explicitTravelTimeMinutes) || explicitTravelTimeMinutes < 0) {
            throw new Error('Player-action destination travel time must be a non-negative integer when provided.');
        }
    }

    return {
        locationId,
        regionId,
        location,
        region,
        explicitTravelTimeMinutes
    };
}

function requireArray(value, label) {
    if (!Array.isArray(value)) {
        throw new TypeError(`${label} must be an array.`);
    }
    return value;
}

function exactTextMatch(left, right) {
    return optionalTrimmedString(left)?.toLowerCase() === optionalTrimmedString(right)?.toLowerCase();
}

function resolveExactRegion({ regionId, regionName, regions }) {
    if (regionId) {
        const region = regions.find(candidate => candidate?.id === regionId) || null;
        if (!region) {
            throw new Error(`Player-action destination references missing region id "${regionId}".`);
        }
        if (regionName && !exactTextMatch(region?.name, regionName)) {
            throw new Error(
                `Player-action destination region id "${regionId}" is named "${region?.name || 'unknown'}", not "${regionName}".`
            );
        }
        return region;
    }
    if (!regionName) {
        return null;
    }
    const matches = regions.filter(candidate => exactTextMatch(candidate?.name, regionName));
    if (matches.length > 1) {
        throw new Error(`Player-action destination region "${regionName}" is ambiguous.`);
    }
    return matches[0] || null;
}

function resolveExistingLocation(destination, { locations, regions }) {
    if (destination.locationId) {
        const location = locations.find(candidate => candidate?.id === destination.locationId) || null;
        if (!location) {
            throw new Error(`Player-action destination references missing location id "${destination.locationId}".`);
        }
        if (destination.location && !exactTextMatch(location?.name, destination.location)) {
            throw new Error(
                `Player-action destination location id "${destination.locationId}" is named "${location?.name || 'unknown'}", not "${destination.location}".`
            );
        }
        const region = resolveExactRegion({
            regionId: destination.regionId || optionalTrimmedString(location?.regionId),
            regionName: destination.region,
            regions
        });
        if (region && optionalTrimmedString(location?.regionId) !== optionalTrimmedString(region?.id)) {
            throw new Error(
                `Player-action destination location "${location?.name || destination.locationId}" does not belong to region "${region?.name || region?.id}".`
            );
        }
        return { location, region };
    }

    if (!destination.location) {
        return { location: null, region: null };
    }

    const requestedRegion = resolveExactRegion({
        regionId: destination.regionId,
        regionName: destination.region,
        regions
    });
    let matches = locations.filter(candidate => exactTextMatch(candidate?.name, destination.location));
    if (destination.region || destination.regionId) {
        if (!requestedRegion) {
            return { location: null, region: null };
        }
        matches = matches.filter(candidate => (
            optionalTrimmedString(candidate?.regionId) === optionalTrimmedString(requestedRegion.id)
        ));
    }
    if (matches.length > 1) {
        const labels = matches.map(candidate => `${candidate?.name || 'unnamed'} (${candidate?.id || 'no id'})`);
        throw new Error(
            `Player-action destination location "${destination.location}" is ambiguous: ${labels.join(', ')}.`
        );
    }
    if (!matches.length) {
        return { location: null, region: null };
    }
    const location = matches[0];
    const region = requestedRegion
        || regions.find(candidate => candidate?.id === location?.regionId)
        || null;
    return { location, region };
}

function resolveDescription(location) {
    const candidates = [
        location?.description,
        location?.stubMetadata?.stubDescription,
        location?.stubMetadata?.blueprintDescription,
        location?.shortDescription,
        location?.stubMetadata?.stubShortDescription,
        location?.stubMetadata?.shortDescription
    ];
    const description = candidates.find(candidate => optionalTrimmedString(candidate));
    return optionalTrimmedString(description) || 'No description recorded.';
}

function resolvePresentNpcNames(location, players) {
    const names = [];
    const seen = new Set();
    for (const actor of players) {
        if (!actor || actor.isNPC !== true || actor.hiddenFromPlayer === true || actor.isInPlayerParty === true) {
            continue;
        }
        const isAlive = typeof actor.isAlive === 'function'
            ? actor.isAlive()
            : actor.isDead !== true;
        if (!isAlive || optionalTrimmedString(actor.currentLocation) !== optionalTrimmedString(location.id)) {
            continue;
        }
        const name = optionalTrimmedString(actor.name);
        if (!name) {
            throw new Error(`NPC "${actor.id || 'unknown'}" at player-action destination "${location.name || location.id}" is missing a name.`);
        }
        const key = name.toLowerCase();
        if (!seen.has(key)) {
            names.push(name);
            seen.add(key);
        }
    }
    return names.sort((left, right) => left.localeCompare(right));
}

function createTravelDuration(minutes) {
    if (minutes === null || minutes === undefined) {
        return null;
    }
    if (!Number.isInteger(minutes) || minutes < 0) {
        throw new Error('Resolved player-action travel time must be a non-negative integer.');
    }
    const text = Utils.formatMinutesAsDuration(minutes);
    if (!text) {
        throw new Error('Resolved player-action travel time could not be formatted.');
    }
    return Object.freeze({ text, minutes });
}

function unresolvedContext(destination, travelTimeMinutes) {
    return Object.freeze({
        resolved: false,
        requestedLocation: destination.location,
        requestedRegion: destination.region,
        locationId: null,
        locationName: null,
        regionId: null,
        regionName: null,
        description: null,
        visitedBefore: false,
        lastVisitedTime: null,
        minutesSinceLastVisitAtPrompt: null,
        presentNpcNames: Object.freeze([]),
        travelTimeMinutes,
        travelDuration: createTravelDuration(travelTimeMinutes)
    });
}

function resolvePlayerActionDestinationContext(destinationInput, {
    originLocationId = null,
    currentWorldMinutes = undefined,
    locations = Location.getAll(),
    regions = Region.getAll(),
    players = Player.getAll(),
    findTravelTimeMinutes = Location.findShortestTravelTimeMinutes.bind(Location)
} = {}) {
    const destination = normalizeDestination(destinationInput);
    const resolvedLocations = requireArray(locations, 'Player-action destination locations');
    const resolvedRegions = requireArray(regions, 'Player-action destination regions');
    const resolvedPlayers = requireArray(players, 'Player-action destination players');
    if (typeof findTravelTimeMinutes !== 'function') {
        throw new TypeError('Player-action destination travel-time resolver must be a function.');
    }

    const explicitTravelTimeMinutes = destination.explicitTravelTimeMinutes;
    const { location, region } = resolveExistingLocation(destination, {
        locations: resolvedLocations,
        regions: resolvedRegions
    });
    if (!location) {
        return unresolvedContext(destination, explicitTravelTimeMinutes);
    }

    let travelTimeMinutes = explicitTravelTimeMinutes;
    const normalizedOriginLocationId = optionalTrimmedString(originLocationId);
    if (travelTimeMinutes === null && normalizedOriginLocationId) {
        const originLocation = resolvedLocations.find(candidate => candidate?.id === normalizedOriginLocationId) || null;
        if (!originLocation) {
            throw new Error(`Player-action destination context references missing origin location "${normalizedOriginLocationId}".`);
        }
        const resolvedTravelTime = findTravelTimeMinutes(originLocation, location);
        if (resolvedTravelTime !== null && resolvedTravelTime !== undefined) {
            travelTimeMinutes = Number(resolvedTravelTime);
            if (!Number.isInteger(travelTimeMinutes) || travelTimeMinutes < 0) {
                throw new Error('Player-action destination route resolver returned an invalid travel time.');
            }
        }
    }

    const visitedBefore = location.visited === true;
    const rawLastVisitedTime = location.lastVisitedTime;
    const lastVisitedTime = rawLastVisitedTime !== null
        && rawLastVisitedTime !== undefined
        && Number.isFinite(Number(rawLastVisitedTime))
        ? Number(rawLastVisitedTime)
        : null;
    const effectiveCurrentWorldMinutes = currentWorldMinutes === undefined
        ? Number(Globals.getTotalWorldMinutes())
        : Number(currentWorldMinutes);
    if (!Number.isFinite(effectiveCurrentWorldMinutes) || !Number.isInteger(effectiveCurrentWorldMinutes)) {
        throw new Error('Player-action destination context requires current world time as an integer minute value.');
    }
    const minutesSinceLastVisitAtPrompt = visitedBefore && lastVisitedTime !== null
        && effectiveCurrentWorldMinutes >= lastVisitedTime
        ? effectiveCurrentWorldMinutes - lastVisitedTime
        : null;
    const presentNpcNames = Object.freeze(resolvePresentNpcNames(location, resolvedPlayers));

    return Object.freeze({
        resolved: true,
        requestedLocation: destination.location,
        requestedRegion: destination.region,
        locationId: optionalTrimmedString(location.id),
        locationName: optionalTrimmedString(location.name),
        regionId: optionalTrimmedString(region?.id) || optionalTrimmedString(location.regionId),
        regionName: optionalTrimmedString(region?.name),
        description: resolveDescription(location),
        visitedBefore,
        lastVisitedTime,
        minutesSinceLastVisitAtPrompt,
        presentNpcNames,
        travelTimeMinutes,
        travelDuration: createTravelDuration(travelTimeMinutes)
    });
}

function formatPlayerActionDestinationAbsence(destinationContext, travelDuration = null) {
    if (!destinationContext || typeof destinationContext !== 'object' || Array.isArray(destinationContext)) {
        throw new TypeError('Player-action destination absence formatter requires a destination context object.');
    }
    const baseMinutes = destinationContext.minutesSinceLastVisitAtPrompt;
    if (baseMinutes === null || baseMinutes === undefined) {
        return null;
    }
    if (!Number.isInteger(baseMinutes) || baseMinutes < 0) {
        throw new Error('Player-action destination absence context has invalid elapsed minutes.');
    }
    const duration = travelDuration || destinationContext.travelDuration;
    if (!duration || typeof duration !== 'object' || Array.isArray(duration)) {
        throw new Error('Player-action destination absence formatting requires a resolved travel duration.');
    }
    const travelMinutes = Number(duration.minutes);
    if (!Number.isInteger(travelMinutes) || travelMinutes < 0) {
        throw new Error('Player-action destination absence travel duration must be a non-negative integer.');
    }
    return Utils.formatMinutesAsDuration(baseMinutes + travelMinutes);
}

module.exports = {
    createTravelDuration,
    formatPlayerActionDestinationAbsence,
    resolvePlayerActionDestinationContext
};
