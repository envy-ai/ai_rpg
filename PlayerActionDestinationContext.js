const Globals = require('./Globals.js');
const Location = require('./Location.js');
const Player = require('./Player.js');
const Region = require('./Region.js');
const Utils = require('./Utils.js');
const { assertNewLocationNameAvailable, getLocationCreationPendingRegionStubs } = require('./LocationCreationNameGuard.js');
const { normalizeDuplicateName } = require('./DuplicateNameUtils.js');

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

function resolveExistingLocation(destination, {
    locations,
    regions,
    unresolvedOnAmbiguousName = false
}) {
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
        const locationRegionId = optionalTrimmedString(location?.regionId);
        const hasBackingRegion = locationRegionId && regions.some(candidate => candidate?.id === locationRegionId);
        if (location.isStub === true && !hasBackingRegion) {
            return { location: null, region: null };
        }
        const region = resolveExactRegion({
            regionId: destination.regionId || locationRegionId,
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
        if (unresolvedOnAmbiguousName) {
            return { location: null, region: null };
        }
        const labels = matches.map(candidate => `${candidate?.name || 'unnamed'} (${candidate?.id || 'no id'})`);
        throw new Error(
            `Player-action destination location "${destination.location}" is ambiguous: ${labels.join(', ')}.`
        );
    }
    if (!matches.length) {
        return { location: null, region: null };
    }
    const location = matches[0];
    const locationRegionId = optionalTrimmedString(location?.regionId);
    const hasBackingRegion = locationRegionId && regions.some(candidate => candidate?.id === locationRegionId);
    if (location.isStub === true && !hasBackingRegion) {
        return { location: null, region: null };
    }
    const region = requestedRegion
        || regions.find(candidate => candidate?.id === locationRegionId)
        || null;
    return { location, region };
}

function resolveShortDescription(location) {
    const candidates = [
        location?.shortDescription,
        location?.stubMetadata?.stubShortDescription,
        location?.stubMetadata?.shortDescription
    ];
    return optionalTrimmedString(candidates.find(candidate => optionalTrimmedString(candidate)));
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

function resolveExitSummaries(location, locations, regions) {
    const rawExits = location?.exits;
    let entries = [];
    if (rawExits === null || rawExits === undefined) {
        return Object.freeze([]);
    }
    if (rawExits instanceof Map) {
        entries = Array.from(rawExits.entries());
    } else if (typeof rawExits === 'object' && !Array.isArray(rawExits)) {
        entries = Object.entries(rawExits);
    } else {
        throw new TypeError(`Player-action destination "${location?.name || location?.id || 'unknown'}" exits must be a Map or object.`);
    }

    const summaries = entries.filter(([, exit]) => exit?.hiddenFromPlayer !== true).map(([rawDirection, exit]) => {
        const direction = optionalTrimmedString(rawDirection);
        if (!direction) {
            throw new Error(`Player-action destination "${location?.name || location?.id || 'unknown'}" has an exit without a direction.`);
        }
        if (!exit || typeof exit !== 'object' || Array.isArray(exit)) {
            throw new Error(`Player-action destination "${location?.name || location?.id || 'unknown'}" has an invalid ${direction} exit.`);
        }
        const destinationId = optionalTrimmedString(exit.destination);
        if (!destinationId) {
            throw new Error(`Player-action destination "${location?.name || location?.id || 'unknown'}" has a ${direction} exit without a destination.`);
        }
        const destinationLocation = locations.find(candidate => candidate?.id === destinationId) || null;
        const destinationName = optionalTrimmedString(destinationLocation?.name)
            || optionalTrimmedString(exit.name)
            || destinationId;
        const destinationRegionId = optionalTrimmedString(destinationLocation?.regionId)
            || optionalTrimmedString(exit.destinationRegion);
        const destinationRegion = destinationRegionId
            ? regions.find(candidate => candidate?.id === destinationRegionId) || null
            : null;
        let travelTimeMinutes = null;
        if (exit.travelTimeMinutes !== null && exit.travelTimeMinutes !== undefined) {
            travelTimeMinutes = Number(exit.travelTimeMinutes);
            if (!Number.isInteger(travelTimeMinutes) || travelTimeMinutes < 0) {
                throw new Error(
                    `Player-action destination "${location?.name || location?.id || 'unknown'}" has an invalid ${direction} exit travel time.`
                );
            }
        }
        return Object.freeze({
            direction,
            destinationId,
            destinationName,
            destinationRegionName: optionalTrimmedString(destinationRegion?.name),
            description: optionalTrimmedString(exit.description),
            travelTimeMinutes
        });
    });

    return Object.freeze(summaries.sort((left, right) => left.direction.localeCompare(right.direction)));
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
        shortDescription: null,
        description: null,
        visitedBefore: false,
        lastVisitedTime: null,
        minutesSinceLastVisitAtPrompt: null,
        presentNpcNames: Object.freeze([]),
        exitSummaries: Object.freeze([]),
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
    findTravelTimeMinutes = Location.findShortestTravelTimeMinutes.bind(Location),
    unresolvedOnAmbiguousName = false
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
        regions: resolvedRegions,
        unresolvedOnAmbiguousName
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
    const exitSummaries = resolveExitSummaries(location, resolvedLocations, resolvedRegions);

    return Object.freeze({
        resolved: true,
        requestedLocation: destination.location,
        requestedRegion: destination.region,
        locationId: optionalTrimmedString(location.id),
        locationName: optionalTrimmedString(location.name),
        regionId: optionalTrimmedString(region?.id) || optionalTrimmedString(location.regionId),
        regionName: optionalTrimmedString(region?.name),
        shortDescription: resolveShortDescription(location),
        description: resolveDescription(location),
        visitedBefore,
        lastVisitedTime,
        minutesSinceLastVisitAtPrompt,
        presentNpcNames,
        exitSummaries,
        travelTimeMinutes,
        travelDuration: createTravelDuration(travelTimeMinutes)
    });
}

function resolvePlayerActionDestinationPreviewContext(destinationInput, options = {}) {
    return resolvePlayerActionDestinationContext(destinationInput, {
        ...options,
        unresolvedOnAmbiguousName: true
    });
}

function resolveReusableDestinationLocation(destination, { locations, regions, pendingRegionStubs, resolveRegionEntry = false }) {
    const pendingRegions = pendingRegionStubs === null ? [] : pendingRegionStubs instanceof Map
        ? Array.from(pendingRegionStubs.values())
        : requireArray(pendingRegionStubs, 'Player-action destination pending regions');
    const regionRecords = [
        ...regions.map(region => ({ region, names: [region?.name] })),
        ...pendingRegions.map(region => ({
            region,
            names: [region?.id, region?.name, region?.originalName, region?.targetRegionName]
        }))
    ];
    let requestedRegionId = destination.regionId;
    if (destination.region || requestedRegionId) {
        const normalizedRegion = normalizeDuplicateName(destination.region);
        const matches = regionRecords.filter(({ region, names }) => (
            region && (requestedRegionId
                ? region.id === requestedRegionId
                : names.some(name => normalizeDuplicateName(name) === normalizedRegion))
        ));
        const ids = new Set(matches.map(({ region }) => optionalTrimmedString(region.id)));
        if (ids.size > 1) {
            throw new Error(`Player-action destination region "${destination.region || requestedRegionId}" is ambiguous.`);
        }
        if (!matches.length) {
            if (requestedRegionId) {
                throw new Error(`Player-action destination references missing region id "${requestedRegionId}".`);
            }
            return null;
        }
        if (ids.has(null)) {
            throw new Error(`Player-action destination region "${destination.region || requestedRegionId}" is missing its id.`);
        }
        if (destination.region && !matches.some(({ names }) => names.some(name => normalizeDuplicateName(name) === normalizedRegion))) {
            throw new Error(`Player-action destination region id "${requestedRegionId}" does not match region "${destination.region}".`);
        }
        requestedRegionId = matches[0].region.id;
    }

    if (!destination.location && !destination.locationId) {
        if (!resolveRegionEntry || !requestedRegionId) return null;
        const region = regionRecords.find(record => record.region.id === requestedRegionId).region;
        // The movement executor uses the recorded entrance, then the first
        // resolvable member. Read those identities without generating anything.
        const entryIds = [region.entranceLocationId, ...(Array.isArray(region.locationIds) ? region.locationIds : [])];
        for (const id of entryIds) {
            const location = locations.find(candidate => candidate?.id === optionalTrimmedString(id));
            if (location) return location;
        }
        return null;
    }

    const normalizedLocation = normalizeDuplicateName(destination.location);
    let matches = locations.filter(location => destination.locationId
        ? location?.id === destination.locationId
        : (normalizeDuplicateName(location?.name) === normalizedLocation
            || optionalTrimmedString(location?.id)?.toLowerCase() === normalizedLocation));
    if (destination.locationId && !matches.length) {
        throw new Error(`Player-action destination references missing location id "${destination.locationId}".`);
    }
    if (destination.locationId && destination.location && !matches.some(location => normalizeDuplicateName(location.name) === normalizedLocation)) {
        throw new Error(`Player-action destination location id "${destination.locationId}" does not match location "${destination.location}".`);
    }
    if (requestedRegionId) {
        matches = matches.filter(location => {
            const recordedRegionId = optionalTrimmedString(location?.stubMetadata?.regionId)
                || optionalTrimmedString(location?.stubMetadata?.targetRegionId)
                || optionalTrimmedString(location?.regionId);
            return recordedRegionId === requestedRegionId || regionRecords.some(({ region }) => (
                region?.id === requestedRegionId && Array.isArray(region.locationIds) && region.locationIds.includes(location.id)
            ));
        });
        if (destination.locationId && !matches.length) {
            throw new Error(`Player-action destination location "${destination.locationId}" does not belong to region "${destination.region || requestedRegionId}".`);
        }
    }
    if (matches.length > 1) {
        throw new Error(`Player-action destination location "${destination.location}" is ambiguous: ${matches.map(location => `${location.name} (${location.id})`).join(', ')}.`);
    }
    return matches[0] || null;
}

function assertPlayerActionDestinationChangesLocation(destinationInput, {
    originLocationId = null,
    locations = Location.getAll(),
    regions = Region.getAll(),
    pendingRegionStubs = getLocationCreationPendingRegionStubs()
} = {}) {
    const originId = optionalTrimmedString(originLocationId);
    if (!originId) return;
    const resolvedLocations = requireArray(locations, 'Player-action destination locations');
    const resolvedRegions = requireArray(regions, 'Player-action destination regions');
    const origin = resolvedLocations.find(location => location?.id === originId);
    if (!origin) throw new Error(`playerDestination references missing captured origin location ${originId}. Restore the original location context before choosing travel.`);
    const destination = normalizeDestination(destinationInput);
    const options = { locations: resolvedLocations, regions: resolvedRegions, pendingRegionStubs, resolveRegionEntry: true };
    let location = resolveReusableDestinationLocation(destination, options);
    if (!location && destination.location && destination.region && exactTextMatch(destination.location, destination.region)) {
        location = resolveReusableDestinationLocation({ ...destination, location: null }, options);
    }
    if (location?.id === originId) {
        const error = new Error(`playerDestination travel resolves to the current location "${origin.name}" (${originId}). Choose the actual different destination supported by the action, or stay here without a player destination and keep final prose at the current location. Do not invent a destination or narrate arrival elsewhere while retaining this origin.`);
        error.code = 'PLAYER_ACTION_DESTINATION_SAME_LOCATION';
        throw error;
    }
}

function assertPlayerActionDestinationAvailable(destinationInput, {
    locations = Location.getAll(),
    regions = Region.getAll(),
    pendingRegionStubs = getLocationCreationPendingRegionStubs()
} = {}) {
    const destination = normalizeDestination(destinationInput);
    if (!destination.location) {
        return;
    }
    const location = resolveReusableDestinationLocation(destination, {
        locations: requireArray(locations, 'Player-action destination locations'),
        regions: requireArray(regions, 'Player-action destination regions'),
        pendingRegionStubs
    });
    // Existing saved locations remain valid, including historical name collisions.
    // Only a destination requiring a new ordinary location reserves a new name.
    if (!location) {
        // The movement executor already interprets an otherwise unresolved
        // Location/Region pair with identical names as region-only travel.
        if (destination.region && exactTextMatch(destination.location, destination.region)) {
            return;
        }
        assertNewLocationNameAvailable(destination.location, {
            regions,
            ...(pendingRegionStubs === undefined ? {} : { pendingRegionStubs })
        });
    }
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
    assertPlayerActionDestinationAvailable,
    assertPlayerActionDestinationChangesLocation,
    createTravelDuration,
    formatPlayerActionDestinationAbsence,
    resolvePlayerActionDestinationContext,
    resolvePlayerActionDestinationPreviewContext
};
