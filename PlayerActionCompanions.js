function requireMap(value, label) {
    if (!(value instanceof Map)) {
        throw new TypeError(`${label} must be a Map.`);
    }
    return value;
}

function requireLocation(value, label) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id.trim()) {
        throw new TypeError(`${label} must be a location object with a non-empty id.`);
    }
    return value;
}

function normalizeIdentifier(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string.`);
    }
    return value.trim();
}

function getActorAliases(actor) {
    let aliases = [];
    if (typeof actor?.getAliases === 'function') {
        aliases = actor.getAliases();
    } else if (actor?.aliases instanceof Set) {
        aliases = Array.from(actor.aliases);
    } else if (Array.isArray(actor?.aliases)) {
        aliases = actor.aliases;
    }
    if (!Array.isArray(aliases)) {
        throw new TypeError(`Aliases for "${actor?.name || actor?.id || 'unknown character'}" must be an array or Set.`);
    }

    const canonicalKey = String(actor?.name || '').trim().toLowerCase();
    const seen = new Set();
    return aliases
        .map(alias => normalizeIdentifier(alias, `Alias for "${actor?.name || actor?.id || 'unknown character'}"`))
        .filter(alias => {
            const key = alias.toLowerCase();
            if (key === canonicalKey || seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
}

function getPartyMemberIds(currentPlayer) {
    if (!currentPlayer || typeof currentPlayer.getPartyMembers !== 'function') {
        throw new TypeError('Player-action companion handling requires currentPlayer.getPartyMembers().');
    }
    const source = currentPlayer.getPartyMembers();
    if (!Array.isArray(source) && !(source instanceof Set)) {
        throw new TypeError('currentPlayer.getPartyMembers() must return an array or Set.');
    }
    return Array.from(source).map((id, index) => normalizeIdentifier(
        id,
        `Party member id ${index + 1}`
    ));
}

function getLocationNpcIds(location) {
    const source = Array.isArray(location?.npcIds)
        ? location.npcIds
        : (typeof location?.getNpcIds === 'function' ? Array.from(location.getNpcIds()) : []);
    return source.map((id, index) => normalizeIdentifier(id, `Location NPC id ${index + 1}`));
}

function buildIdentifierIndex(characterDescriptors) {
    if (!Array.isArray(characterDescriptors)) {
        throw new TypeError('Allowed accompanying characters must be an array.');
    }
    const identifiers = new Map();
    const canonicalNames = new Set();
    for (const [index, descriptor] of characterDescriptors.entries()) {
        if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
            throw new TypeError(`Allowed accompanying character ${index + 1} must be an object.`);
        }
        const name = normalizeIdentifier(descriptor.name, `Allowed accompanying character ${index + 1} name`);
        const canonicalKey = name.toLowerCase();
        if (canonicalNames.has(canonicalKey)) {
            throw new Error(`Allowed accompanying character name "${name}" is duplicated.`);
        }
        canonicalNames.add(canonicalKey);
        const aliases = descriptor.aliases === undefined ? [] : descriptor.aliases;
        if (!Array.isArray(aliases)) {
            throw new TypeError(`Aliases for allowed accompanying character "${name}" must be an array.`);
        }
        const values = [name, ...aliases.map((alias, aliasIndex) => normalizeIdentifier(
            alias,
            `Alias ${aliasIndex + 1} for allowed accompanying character "${name}"`
        ))];
        for (const identifier of values) {
            const key = identifier.toLowerCase();
            const matches = identifiers.get(key) || [];
            if (!matches.some(existing => existing.name.toLowerCase() === canonicalKey)) {
                matches.push({ name, identifier });
            }
            identifiers.set(key, matches);
        }
    }
    return identifiers;
}

function normalizePlayerActionAccompanyingCharacterSelection(
    characterNames,
    allowedCharacters
) {
    if (!Array.isArray(characterNames)) {
        throw new TypeError('Player-action accompanying character selection must be an array.');
    }
    const identifiers = buildIdentifierIndex(allowedCharacters);
    const seen = new Set();
    return characterNames.map((identifier, index) => {
        const requested = normalizeIdentifier(identifier, `Accompanying character ${index + 1}`);
        const matches = identifiers.get(requested.toLowerCase());
        if (!matches?.length) {
            throw new Error(`"${requested}" is not an allowed exact character name or alias.`);
        }
        if (matches.length > 1) {
            const names = matches.map(match => `"${match.name}"`);
            throw new Error(
                `Accompanying character identifier "${requested}" is ambiguous between ${names.join(' and ')}.`
            );
        }
        const [match] = matches;
        const canonicalKey = match.name.toLowerCase();
        if (seen.has(canonicalKey)) {
            throw new Error(`Accompanying character "${match.name}" is duplicated.`);
        }
        seen.add(canonicalKey);
        return match.name;
    });
}

function collectPlayerActionAccompanyingCharacters({ currentPlayer, location, players } = {}) {
    requireMap(players, 'Player-action players');
    const originLocation = requireLocation(location, 'Player-action origin location');
    const partyMemberIds = getPartyMemberIds(currentPlayer);
    const orderedIds = [...partyMemberIds, ...getLocationNpcIds(originLocation)];
    const seenIds = new Set();
    const descriptors = [];

    for (const actorId of orderedIds) {
        if (seenIds.has(actorId)) {
            continue;
        }
        seenIds.add(actorId);
        const actor = players.get(actorId);
        if (!actor) {
            throw new Error(`Player-action accompanying character candidate id "${actorId}" was not found.`);
        }
        if (actor.id === currentPlayer?.id || actor.isNPC !== true || actor.isDead === true) {
            continue;
        }
        descriptors.push({
            name: normalizeIdentifier(actor.name, `Character name for "${actorId}"`),
            aliases: getActorAliases(actor)
        });
    }

    buildIdentifierIndex(descriptors);
    return descriptors;
}

function collectPlayerActionHiddenContestContext({ currentPlayer, location, players } = {}) {
    requireMap(players, 'Player-action hidden-contest players');
    const originLocation = requireLocation(location, 'Player-action hidden-contest location');
    if (!currentPlayer || typeof currentPlayer !== 'object') {
        throw new TypeError('Player-action hidden-contest handling requires a current player.');
    }
    const describeActor = actor => ({
        id: normalizeIdentifier(actor?.id, 'Hidden-contest character id'),
        name: normalizeIdentifier(actor?.name, `Hidden-contest character name for "${actor?.id || 'unknown'}"`),
        aliases: getActorAliases(actor),
        isNPC: actor?.isNPC === true,
        hiddenFromPlayer: actor?.hiddenFromPlayer === true
    });
    const orderedNpcIds = [
        ...getPartyMemberIds(currentPlayer),
        ...getLocationNpcIds(originLocation)
    ];
    const seenIds = new Set();
    const npcs = [];
    for (const actorId of orderedNpcIds) {
        if (seenIds.has(actorId)) {
            continue;
        }
        seenIds.add(actorId);
        const actor = players.get(actorId);
        if (!actor) {
            throw new Error(`Player-action hidden-contest candidate id "${actorId}" was not found.`);
        }
        if (actor.id === currentPlayer.id || actor.isNPC !== true || actor.isDead === true) {
            continue;
        }
        npcs.push(describeActor(actor));
    }
    return {
        player: describeActor(currentPlayer),
        npcs
    };
}

function normalizeHiddenContestToolValue(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const normalized = String(value).trim().replace(/\s+/g, ' ').toLowerCase();
    if (!normalized || normalized === 'n/a' || normalized === 'none' || normalized === 'null') {
        return null;
    }
    return normalized;
}

function hiddenContestActorIdentifiers(actor, currentPlayer) {
    if (!actor || typeof actor !== 'object') {
        throw new TypeError('Pre-resolved hidden contest references an invalid character.');
    }
    const identifiers = new Set([
        normalizeHiddenContestToolValue(actor.id),
        normalizeHiddenContestToolValue(actor.name),
        ...getActorAliases(actor).map(normalizeHiddenContestToolValue)
    ].filter(Boolean));
    if (actor.id === currentPlayer?.id) {
        identifiers.add('player');
        identifiers.add('the player');
        identifiers.add('you');
    }
    return identifiers;
}

function cloneHiddenContestResolution(resolution) {
    try {
        return JSON.parse(JSON.stringify(resolution));
    } catch (error) {
        throw new Error(`Unable to clone pre-resolved hidden contest result: ${error.message}`);
    }
}

function resolvePreResolvedPlayerActionHiddenContestToolCall(toolCall, {
    hiddenNpcChecks = [],
    currentPlayer,
    players
} = {}) {
    if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
        throw new TypeError('Pre-resolved hidden contest matching requires a tool-call object.');
    }
    if (!Array.isArray(hiddenNpcChecks)) {
        throw new TypeError('Pre-resolved hidden contest matching requires a hiddenNpcChecks array.');
    }
    const functionName = typeof toolCall.functionName === 'string' && toolCall.functionName.trim()
        ? toolCall.functionName.trim()
        : (typeof toolCall.name === 'string' ? toolCall.name.trim() : '');
    if (functionName !== 'resolveOpposedSkillCheck' && functionName !== 'resolveOpposedPlausibilityCheck') {
        return null;
    }
    if (!hiddenNpcChecks.length) {
        return null;
    }
    requireMap(players, 'Pre-resolved hidden contest players');
    if (!currentPlayer || typeof currentPlayer !== 'object') {
        throw new TypeError('Pre-resolved hidden contest matching requires the current player.');
    }
    const args = toolCall.argumentsObject;
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return null;
    }

    const actorWasSupplied = Object.prototype.hasOwnProperty.call(args, 'actor');
    const actorReference = normalizeHiddenContestToolValue(args.actor);
    if (actorWasSupplied && !actorReference) {
        return null;
    }
    const opponentReference = normalizeHiddenContestToolValue(args.opponent);
    const skill = normalizeHiddenContestToolValue(args.skill);
    const attribute = normalizeHiddenContestToolValue(args.attribute);
    const opponentSkill = normalizeHiddenContestToolValue(args.opponentSkill);
    const opponentAttribute = normalizeHiddenContestToolValue(args.opponentAttribute);
    if (!opponentReference || !attribute || !opponentAttribute) {
        return null;
    }

    const matches = hiddenNpcChecks.filter((check, index) => {
        if (!check || typeof check !== 'object' || Array.isArray(check)) {
            throw new TypeError(`Pre-resolved hidden contest ${index + 1} must be an object.`);
        }
        const resolution = check.resolution;
        if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) {
            throw new Error(`Pre-resolved hidden contest ${index + 1} is missing its resolution.`);
        }
        const actor = players.get(check.actorId) || null;
        const opponent = players.get(check.opponentId) || null;
        if (!actor || !opponent) {
            throw new Error(`Pre-resolved hidden contest ${index + 1} no longer resolves both characters.`);
        }
        if (!hiddenContestActorIdentifiers(opponent, currentPlayer).has(opponentReference)) {
            return false;
        }
        if (actorReference && !hiddenContestActorIdentifiers(actor, currentPlayer).has(actorReference)) {
            return false;
        }
        return normalizeHiddenContestToolValue(resolution.skill) === skill
            && normalizeHiddenContestToolValue(resolution.attribute) === attribute
            && normalizeHiddenContestToolValue(resolution.opponent?.skill) === opponentSkill
            && normalizeHiddenContestToolValue(resolution.opponent?.attribute) === opponentAttribute;
    });

    if (!matches.length) {
        return null;
    }
    if (matches.length > 1) {
        throw new Error(
            `Opposed check matches ${matches.length} pre-resolved hidden contests; provide an explicit actor to disambiguate it.`
        );
    }

    const [match] = matches;
    const actionResolution = cloneHiddenContestResolution(match.resolution);
    const resultLabel = typeof actionResolution.label === 'string' && actionResolution.label.trim()
        ? actionResolution.label.trim()
        : (typeof actionResolution.degree === 'string' && actionResolution.degree.trim()
            ? actionResolution.degree.trim()
            : (actionResolution.success === true ? 'success' : 'failure'));
    return {
        content: resultLabel,
        metadata: {
            result: resultLabel,
            checkType: 'opposed',
            actor: match.actorName,
            opponent: match.opponentName,
            actionResolution,
            cached: true,
            preResolvedHiddenNpcCheck: true,
            suppressCheckResultsRecord: true
        }
    };
}

function movePlayerActionAccompanyingCharacters({
    characterNames,
    currentPlayer,
    originLocation,
    destinationLocation,
    players,
    gameLocations
} = {}) {
    requireMap(players, 'Player-action players');
    requireMap(gameLocations, 'Player-action locations');
    const origin = requireLocation(originLocation, 'Player-action companion origin');
    const destination = requireLocation(destinationLocation, 'Player-action companion destination');
    if (!Array.isArray(characterNames)) {
        throw new TypeError('Player-action accompanying character names must be an array.');
    }
    if (!characterNames.length) {
        return [];
    }

    const allowedCharacters = collectPlayerActionAccompanyingCharacters({
        currentPlayer,
        location: origin,
        players
    });
    const canonicalNames = normalizePlayerActionAccompanyingCharacterSelection(
        characterNames,
        allowedCharacters
    );
    const partyMemberIds = new Set(getPartyMemberIds(currentPlayer));
    const actorsByCanonicalName = new Map();
    for (const actor of players.values()) {
        if (actor && typeof actor.name === 'string' && actor.name.trim()) {
            const key = actor.name.trim().toLowerCase();
            if (actorsByCanonicalName.has(key) && actorsByCanonicalName.get(key) !== actor) {
                throw new Error(`More than one character has the exact name "${actor.name.trim()}".`);
            }
            actorsByCanonicalName.set(key, actor);
        }
    }

    const movementPlan = canonicalNames.map(name => {
        const actor = actorsByCanonicalName.get(name.toLowerCase());
        if (!actor) {
            throw new Error(`Unable to resolve an exact character named "${name}".`);
        }
        const isPartyMember = partyMemberIds.has(actor.id);
        if (!isPartyMember && actor.currentLocation !== origin.id) {
            throw new Error(`Accompanying character "${name}" is not present at the movement origin.`);
        }
        if (typeof actor.setLocation !== 'function') {
            throw new Error(`Accompanying character "${name}" cannot move because setLocation is unavailable.`);
        }
        return { actor, isPartyMember, name };
    });

    for (const { actor, isPartyMember, name } of movementPlan) {
        for (const candidateLocation of gameLocations.values()) {
            if (candidateLocation && typeof candidateLocation.removeNpcId === 'function') {
                candidateLocation.removeNpcId(actor.id);
            }
        }
        if (isPartyMember) {
            actor.setLocation(null);
            if (actor.currentLocation !== null && actor.currentLocation !== undefined) {
                throw new Error(`Accompanying party member "${name}" did not remain off-location with the player.`);
            }
        } else {
            actor.setLocation(destination);
            if (actor.currentLocation !== destination.id) {
                throw new Error(`Accompanying character "${name}" did not reach destination "${destination.id}".`);
            }
            if (typeof destination.addNpcId !== 'function') {
                throw new Error(`Destination "${destination.id}" cannot register accompanying character "${name}".`);
            }
            destination.addNpcId(actor.id);
        }
    }

    return canonicalNames;
}

module.exports = {
    collectPlayerActionAccompanyingCharacters,
    collectPlayerActionHiddenContestContext,
    movePlayerActionAccompanyingCharacters,
    normalizePlayerActionAccompanyingCharacterSelection,
    resolvePreResolvedPlayerActionHiddenContestToolCall
};
