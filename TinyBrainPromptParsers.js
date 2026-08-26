const Utils = require('./Utils.js');
const { isDeepStrictEqual } = require('node:util');
const {
    UPDATE_OBJECT_FIELD_NAMES_BY_TYPE,
    UPDATE_OBJECT_TYPE_VALUES
} = require('./chat_tool_calls.js');
const {
    PLAYER_ACTION_MOVEMENT,
    PLAYER_ACTION_PROSE_SCOPE,
    PLAYER_ACTION_VEHICLE_DECISION
} = require('./PlayerActionTinyBrainResult.js');
const {
    normalizePlayerActionAccompanyingCharacterSelection
} = require('./PlayerActionCompanions.js');

const NON_MUTATING_SCHEDULED_EVENT_TOOL_NAMES = new Set([
    'moreInfo',
    'getHistory',
    'getFullScene',
    'requestUserInput',
    'listMysteryBoxes',
    'findMysteryBoxes',
    'getMysteryBox',
    'listMysteryThreads',
    'getMysteryThread',
    'listLocationEntities',
    'getTravelTime',
    'locateNpcs',
    'locateThings'
]);

function isNonMutatingScheduledEventToolName(name) {
    return typeof name === 'string'
        && NON_MUTATING_SCHEDULED_EVENT_TOOL_NAMES.has(name.trim());
}

function requireResponseText(response, label) {
    if (typeof response !== 'string' || !response.trim()) {
        throw new Error(`${label} requires a non-empty response.`);
    }
    return response.trim();
}

function parseStrictXml(response, label) {
    const raw = requireResponseText(response, label);
    const unfenced = raw
        .replace(/^```(?:xml)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    const extracted = Utils.extractFinalXmlBlockFromResponse(unfenced);
    const xml = extracted || unfenced;
    let doc;
    try {
        doc = Utils.parseXmlDocumentStrict(xml, 'text/xml');
    } catch (error) {
        throw new Error(`${label} contains malformed XML: ${error.message}`);
    }
    return { xml, doc, root: doc.documentElement };
}

function normalizedTagName(node) {
    return String(node?.tagName || '').trim().toLowerCase();
}

function directChildElements(node) {
    return Array.from(node?.childNodes || []).filter(child => child?.nodeType === 1);
}

function directTextContent(node) {
    return Array.from(node?.childNodes || [])
        .filter(child => child?.nodeType === 3 || child?.nodeType === 4)
        .map(child => String(child.nodeValue || ''))
        .join('')
        .trim();
}

function directChildrenByTagName(node, tagName) {
    const expected = String(tagName || '').toLowerCase();
    return directChildElements(node).filter(child => normalizedTagName(child) === expected);
}

function requireSingleDirectChild(node, tagName, label, { allowEmpty = false } = {}) {
    const matches = directChildrenByTagName(node, tagName);
    if (matches.length !== 1) {
        throw new Error(`${label} requires exactly one direct <${tagName}> child.`);
    }
    const text = String(matches[0].textContent || '').trim();
    if (!allowEmpty && !text) {
        throw new Error(`${label} requires non-empty <${tagName}> content.`);
    }
    return { node: matches[0], text };
}

function rejectUnexpectedDirectChildren(node, allowedTags, label) {
    const allowed = new Set(allowedTags.map(tag => String(tag).toLowerCase()));
    const unexpected = directChildElements(node)
        .map(normalizedTagName)
        .filter(tag => !allowed.has(tag));
    if (unexpected.length) {
        throw new Error(`${label} contains unexpected direct child <${unexpected[0]}>.`);
    }
}

function requirePositiveIntegerArgument(value, label) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return parsed;
}

function rejectNestedElements(node, label) {
    const nested = directChildElements(node);
    if (nested.length) {
        throw new Error(`${label} must contain text only, not <${normalizedTagName(nested[0])}>.`);
    }
}

function parseSceneSummaryBoundaries(response, entryCount) {
    const totalEntries = requirePositiveIntegerArgument(
        entryCount,
        'Scene-summary boundary parser entry count'
    );
    const { root } = parseStrictXml(response, 'scene-summary boundaries');
    if (normalizedTagName(root) !== 'sceneboundaries') {
        throw new Error('Scene-summary boundaries must use one <sceneBoundaries> root.');
    }
    if (directTextContent(root)) {
        throw new Error('Scene-summary boundaries cannot contain text outside <boundary> entries.');
    }
    rejectUnexpectedDirectChildren(root, ['boundary'], 'Scene-summary boundaries');
    const boundaryNodes = directChildrenByTagName(root, 'boundary');
    if (boundaryNodes.length < 2) {
        throw new Error(
            'Scene-summary boundaries require at least two starts: one completed scene and one following-scene boundary.'
        );
    }

    const boundaries = boundaryNodes.map((boundaryNode, boundaryIndex) => {
        const label = `Scene-summary boundary ${boundaryIndex + 1}`;
        if (directTextContent(boundaryNode)) {
            throw new Error(`${label} cannot contain text outside its fields.`);
        }
        rejectUnexpectedDirectChildren(boundaryNode, ['index', 'reason'], label);
        const indexField = requireSingleDirectChild(boundaryNode, 'index', label);
        const reasonField = requireSingleDirectChild(boundaryNode, 'reason', label);
        rejectNestedElements(indexField.node, `${label} <index>`);
        rejectNestedElements(reasonField.node, `${label} <reason>`);
        if (!/^\d+$/.test(indexField.text)) {
            throw new Error(`${label} <index> must be a positive integer.`);
        }
        const index = Number(indexField.text);
        if (!Number.isInteger(index) || index <= 0 || index > totalEntries) {
            throw new Error(`${label} index ${indexField.text} is outside entries 1-${totalEntries}.`);
        }
        return {
            index,
            reason: reasonField.text
        };
    });

    for (let index = 1; index < boundaries.length; index += 1) {
        if (boundaries[index].index <= boundaries[index - 1].index) {
            throw new Error('Scene-summary boundary indices must be unique and strictly ascending.');
        }
    }

    return {
        value: boundaries,
        normalizedResponse: root.toString()
    };
}

function parseSceneSummaryEntry(response, expectedStartIndex, expectedEndIndex) {
    const expectedStart = requirePositiveIntegerArgument(
        expectedStartIndex,
        'Scene-summary entry expected start index'
    );
    const expectedEnd = requirePositiveIntegerArgument(
        expectedEndIndex,
        'Scene-summary entry expected end index'
    );
    if (expectedEnd < expectedStart) {
        throw new Error('Scene-summary entry expected end index must not precede its start index.');
    }

    const { root } = parseStrictXml(response, `scene-summary entry ${expectedStart}-${expectedEnd}`);
    if (normalizedTagName(root) !== 'scene') {
        throw new Error('Scene-summary entry must use one <scene> root.');
    }
    if (directTextContent(root)) {
        throw new Error('Scene-summary entry cannot contain text outside its fields.');
    }
    rejectUnexpectedDirectChildren(root, ['index', 'summary', 'details', 'quote'], 'Scene-summary entry');

    const indexField = requireSingleDirectChild(root, 'index', 'Scene-summary entry');
    const summaryField = requireSingleDirectChild(root, 'summary', 'Scene-summary entry');
    const detailsField = requireSingleDirectChild(root, 'details', 'Scene-summary entry', {
        allowEmpty: true
    });
    rejectNestedElements(indexField.node, 'Scene-summary entry <index>');
    rejectNestedElements(summaryField.node, 'Scene-summary entry <summary>');
    rejectNestedElements(detailsField.node, 'Scene-summary entry <details>');

    if (!/^\d+$/.test(indexField.text) || Number(indexField.text) !== expectedStart) {
        throw new Error(`Scene-summary entry must use the assigned start index ${expectedStart}.`);
    }

    const details = detailsField.text
        .split(/\r?\n/)
        .map(line => line.trim())
        .map(line => line.replace(/^(?:[-*]+|\d+[.)])\s+/, '').trim())
        .filter(Boolean);
    const quoteNodes = directChildrenByTagName(root, 'quote');
    if (quoteNodes.length > 2) {
        throw new Error('Scene-summary entry permits at most two notable quotes.');
    }
    const quotes = quoteNodes.map((quoteNode, quoteIndex) => {
        const label = `Scene-summary quote ${quoteIndex + 1}`;
        if (directTextContent(quoteNode)) {
            throw new Error(`${label} cannot contain text outside its fields.`);
        }
        rejectUnexpectedDirectChildren(quoteNode, ['character', 'text'], label);
        const characterField = requireSingleDirectChild(quoteNode, 'character', label);
        const textField = requireSingleDirectChild(quoteNode, 'text', label);
        rejectNestedElements(characterField.node, `${label} <character>`);
        rejectNestedElements(textField.node, `${label} <text>`);
        return {
            character: characterField.text,
            text: textField.text
        };
    });

    return {
        value: {
            localStartIndex: expectedStart,
            localEndIndex: expectedEnd,
            summary: summaryField.text,
            details,
            quotes
        },
        normalizedResponse: root.toString()
    };
}

function parseBooleanText(text, fieldLabel) {
    const normalized = String(text || '').trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes') {
        return true;
    }
    if (normalized === 'false' || normalized === 'no') {
        return false;
    }
    throw new Error(`${fieldLabel} must be true/false or yes/no.`);
}

function normalizePlainResponse(response, label) {
    return requireResponseText(response, label)
        .replace(/^```(?:text)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function normalizeCompactChoiceResponse(response, label) {
    let normalized = normalizePlainResponse(response, label)
        .replace(/^[*_`~]+|[*_`~]+$/g, '')
        .trim()
        .replace(/^answer\s*:\s*/i, '')
        .trim();
    normalized = normalized.replace(/[.!]+$/g, '').trim();
    normalized = normalized
        .replace(/^[*_`~]+|[*_`~]+$/g, '')
        .trim();
    return normalized;
}

function rejectPlayerActionResultMarkup(response, label, { rejectHidden = false } = {}) {
    const forbidden = rejectHidden
        ? /<\/?(?:turnResult|moveTurnResult|hidden)\b/i
        : /<\/?(?:turnResult|moveTurnResult)\b/i;
    if (forbidden.test(response)) {
        throw new Error(`${label} must not contain player-action result XML.`);
    }
}

function parsePlayerActionDestinationNameOrNa(response, parseContext = {}) {
    const currentToolInvocations = Array.isArray(parseContext?.currentToolInvocations)
        ? parseContext.currentToolInvocations
        : [];
    if (currentToolInvocations.length) {
        throw new Error(
            'Player-action destination-name context checkpoint must not make tool calls.'
        );
    }

    const normalized = normalizePlainResponse(response, 'player-action destination name')
        .replace(/^[*_`~]+|[*_`~]+$/g, '')
        .replace(/^answer\s*:\s*/i, '')
        .trim();
    if (/^N\s*\/?\s*A\.?$/i.test(normalized)) {
        return { value: null, normalizedResponse: 'N/A' };
    }
    const lines = normalized.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length !== 1) {
        throw new Error('Player-action destination name must be one line or exactly N/A.');
    }
    let location = lines[0]
        .replace(/^[-*]\s+/, '')
        .replace(/^Location\s*:\s*/i, '')
        .trim();
    const first = location.charAt(0);
    const last = location.charAt(location.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        location = location.slice(1, -1).trim();
    }
    if (!location || /^N\s*\/?\s*A\.?$/i.test(location)) {
        return { value: null, normalizedResponse: 'N/A' };
    }
    if (/<\/?[A-Za-z][^>]*>/.test(location)) {
        throw new Error('Player-action destination name must not contain XML markup.');
    }
    return {
        value: { location, region: null },
        normalizedResponse: location
    };
}

function parsePlayerActionMovement(response, onVehicle = false) {
    const normalized = normalizeCompactChoiceResponse(response, 'player-action movement').toUpperCase();
    const values = {
        NONE: PLAYER_ACTION_MOVEMENT.NONE,
        DESTINATION: PLAYER_ACTION_MOVEMENT.DESTINATION,
        INSIDE_VEHICLE: PLAYER_ACTION_MOVEMENT.INSIDE_VEHICLE,
        DISEMBARK: PLAYER_ACTION_MOVEMENT.DISEMBARK
    };
    if (!Object.hasOwn(values, normalized)) {
        throw new Error('Player-action movement must be exactly one allowed movement keyword.');
    }
    const value = values[normalized];
    if (onVehicle === true) {
        if (value === PLAYER_ACTION_MOVEMENT.DESTINATION) {
            throw new Error('Player movement from a vehicle must use DISEMBARK instead of DESTINATION.');
        }
    } else if (![PLAYER_ACTION_MOVEMENT.NONE, PLAYER_ACTION_MOVEMENT.DESTINATION].includes(value)) {
        throw new Error(`Player movement ${normalized} requires a current vehicle.`);
    }
    return { value };
}

function parsePlayerActionVehicleDecision(
    response,
    movement,
    isUnderway = false
) {
    if (!Object.values(PLAYER_ACTION_MOVEMENT).includes(movement)) {
        throw new Error('Player-action vehicle decision requires a valid movement value.');
    }
    const normalized = normalizeCompactChoiceResponse(response, 'player-action vehicle decision').toUpperCase();
    const values = {
        UNCHANGED: PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED,
        DEPART: PLAYER_ACTION_VEHICLE_DECISION.DEPART,
        STOP: PLAYER_ACTION_VEHICLE_DECISION.STOP,
        REDIRECT: PLAYER_ACTION_VEHICLE_DECISION.REDIRECT,
        STOP_FOR_EXIT: PLAYER_ACTION_VEHICLE_DECISION.STOP_FOR_EXIT
    };
    if (!Object.hasOwn(values, normalized)) {
        throw new Error('Player-action vehicle decision must be exactly one allowed vehicle keyword.');
    }
    const value = values[normalized];
    let allowed = [];
    if (movement === PLAYER_ACTION_MOVEMENT.INSIDE_VEHICLE) {
        allowed = [PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED];
    } else if (movement === PLAYER_ACTION_MOVEMENT.DISEMBARK) {
        allowed = isUnderway === true
            ? [PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED, PLAYER_ACTION_VEHICLE_DECISION.STOP_FOR_EXIT]
            : [PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED];
    } else if (movement === PLAYER_ACTION_MOVEMENT.NONE) {
        allowed = isUnderway === true
            ? [
                PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED,
                PLAYER_ACTION_VEHICLE_DECISION.STOP,
                PLAYER_ACTION_VEHICLE_DECISION.REDIRECT
            ]
            : [PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED, PLAYER_ACTION_VEHICLE_DECISION.DEPART];
    }
    if (!allowed.includes(value)) {
        throw new Error(`Vehicle decision ${normalized} is not valid for the current movement and vehicle state.`);
    }
    return { value };
}

function parsePlayerActionProseScope(response) {
    const normalized = normalizeCompactChoiceResponse(response, 'player-action prose scope').toUpperCase();
    const rawValues = normalized
        .split(/\s*(?:,|;|\r?\n|\band\b)\s*/i)
        .map(value => value.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean);
    if (!rawValues.length) {
        throw new Error('Player-action prose scope requires at least one scope.');
    }
    const values = {
        ORIGIN: PLAYER_ACTION_PROSE_SCOPE.ORIGIN,
        BETWEEN: PLAYER_ACTION_PROSE_SCOPE.BETWEEN,
        DESTINATION: PLAYER_ACTION_PROSE_SCOPE.DESTINATION
    };
    const seen = new Set();
    for (const rawValue of rawValues) {
        if (!Object.hasOwn(values, rawValue)) {
            throw new Error(`Unknown player-action prose scope "${rawValue}".`);
        }
        const value = values[rawValue];
        seen.add(value);
    }
    const canonicalOrder = Object.values(PLAYER_ACTION_PROSE_SCOPE).filter(value => seen.has(value));
    return { value: canonicalOrder };
}

function parsePlayerActionDestination(response) {
    const normalized = normalizePlainResponse(response, 'player-action destination');
    rejectPlayerActionResultMarkup(normalized, 'Player-action destination');
    const fields = new Map();
    const lines = normalized
        .replace(/^answer\s*:\s*/i, '')
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*[-*]\s*/, '').trim())
        .filter(Boolean);
    for (const line of lines) {
        const match = line.match(/^(Location|Region):\s*(.+)$/i);
        if (!match) {
            throw new Error('Player-action destination must contain only Location and Region lines.');
        }
        const key = match[1].toLowerCase();
        if (fields.has(key)) {
            throw new Error(`Player-action destination contains duplicate ${match[1]} lines.`);
        }
        fields.set(key, match[2]);
    }
    if (fields.size !== 2 || !fields.has('location') || !fields.has('region')) {
        throw new Error('Player-action destination must contain exactly Location and Region lines.');
    }
    const normalizeValue = (value) => {
        const trimmed = value.trim();
        return /^n\s*\/\s*a\.?$/i.test(trimmed) ? null : trimmed;
    };
    const location = normalizeValue(fields.get('location'));
    const region = normalizeValue(fields.get('region'));
    if (!location && !region) {
        throw new Error('Player-action destination requires a location or region.');
    }
    return { value: { location, region } };
}

function normalizeExactRouteText(value) {
    return typeof value === 'string' && value.trim()
        ? value.trim().toLowerCase().replace(/\s+/g, ' ')
        : null;
}

function parsePlayerActionVehicleDestination(response, currentVehicle = null, parseContext = null) {
    const parsed = parsePlayerActionDestination(response);
    if (!currentVehicle || typeof currentVehicle !== 'object' || Array.isArray(currentVehicle)) {
        throw new Error('Player-action vehicle destination requires current vehicle context.');
    }
    const vehicleInfo = currentVehicle.vehicleInfo;
    if (!vehicleInfo || typeof vehicleInfo !== 'object' || Array.isArray(vehicleInfo)) {
        throw new Error('Player-action vehicle destination requires current vehicle route state.');
    }
    const routeEntries = vehicleInfo.destinations === undefined
        ? []
        : vehicleInfo.destinations;
    if (!Array.isArray(routeEntries)) {
        throw new Error('Player-action current vehicle destinations must be an array.');
    }
    if (!routeEntries.length) {
        return parsed;
    }

    const allowedDestinations = currentVehicle.allowedDestinations;
    if (!Array.isArray(allowedDestinations) || allowedDestinations.length !== routeEntries.length) {
        throw new Error(
            'Player-action fixed-route vehicle context must provide every canonical allowed destination.'
        );
    }
    const retryState = parseContext?.retryState;
    if (retryState !== undefined && (
        !retryState
        || typeof retryState !== 'object'
        || Array.isArray(retryState)
    )) {
        throw new Error('Player-action vehicle destination retry state must be an object.');
    }
    const normalizedRouteEntries = new Set(routeEntries.map(entry => String(entry)));
    const normalizedLocation = normalizeExactRouteText(parsed.value.location);
    const normalizedRegion = normalizeExactRouteText(parsed.value.region);
    const parsedDestination = {
        location: parsed.value.location,
        region: parsed.value.region,
        normalizedLocation,
        normalizedRegion
    };
    if (retryState) {
        const anchorKey = 'playerActionVehicleDestination';
        const anchored = retryState[anchorKey];
        if (!anchored) {
            retryState[anchorKey] = Object.freeze(parsedDestination);
        } else if (
            anchored.normalizedLocation !== normalizedLocation
            || anchored.normalizedRegion !== normalizedRegion
        ) {
            const initialLabel = [anchored.location, anchored.region].filter(Boolean).join(' — ');
            const replacementLabel = [parsed.value.location, parsed.value.region].filter(Boolean).join(' — ');
            throw new Error(
                `Player-action vehicle-destination retry may not replace the initially extracted destination `
                + `"${initialLabel}" with "${replacementLabel}". Preserve the same mechanical destination `
                + `and correct only its representation.`
            );
        }
    }
    const matches = [];
    for (const [index, candidate] of allowedDestinations.entries()) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            throw new Error(`Player-action allowed vehicle destination ${index + 1} must be an object.`);
        }
        if (typeof candidate.routeEntry !== 'string' || !normalizedRouteEntries.has(candidate.routeEntry)) {
            throw new Error(
                `Player-action allowed vehicle destination ${index + 1} does not match the current vehicle route.`
            );
        }
        const kind = typeof candidate.kind === 'string' ? candidate.kind.trim().toLowerCase() : '';
        const candidateRegion = normalizeExactRouteText(candidate.regionName);
        if (kind === 'location') {
            const candidateLocation = normalizeExactRouteText(candidate.locationName);
            const candidateLocationId = normalizeExactRouteText(candidate.locationId);
            if (!candidateLocation || !candidateLocationId) {
                throw new Error(
                    `Player-action allowed vehicle destination ${index + 1} is missing canonical location identity.`
                );
            }
            const locationMatches = normalizedLocation === candidateLocation
                || normalizedLocation === candidateLocationId;
            const regionMatches = !normalizedRegion || normalizedRegion === candidateRegion;
            if (locationMatches && regionMatches) {
                matches.push(candidate);
            }
            continue;
        }
        if (kind === 'region') {
            if (!candidateRegion) {
                throw new Error(
                    `Player-action allowed vehicle destination ${index + 1} is missing a canonical region name.`
                );
            }
            if (normalizedRegion === candidateRegion) {
                matches.push(candidate);
            }
            continue;
        }
        throw new Error(
            `Player-action allowed vehicle destination ${index + 1} has unknown kind "${candidate.kind}".`
        );
    }

    const routeLabels = allowedDestinations.map(candidate => (
        candidate.kind === 'location'
            ? [candidate.locationName, candidate.regionName].filter(Boolean).join(' — ')
            : candidate.regionName
    ));
    const requestedLabel = [parsed.value.location, parsed.value.region].filter(Boolean).join(' — ');
    if (!matches.length) {
        throw new Error(
            `Vehicle "${currentVehicle.name || 'current vehicle'}" cannot travel to "${requestedLabel}" `
            + `because that destination is not in its allowed route. Allowed destinations: ${routeLabels.join(', ')}.`
        );
    }
    if (matches.length > 1) {
        throw new Error(
            `Player-action vehicle destination "${requestedLabel}" is ambiguous within the allowed route.`
        );
    }

    const matched = matches[0];
    if (matched.kind === 'location') {
        return {
            value: {
                location: matched.locationName,
                region: matched.regionName || parsed.value.region
            }
        };
    }
    return {
        value: {
            location: parsed.value.location,
            region: matched.regionName
        }
    };
}

function parsePlayerActionDestinationChanges(response) {
    const normalized = normalizePlainResponse(response, 'player-action destination changes');
    rejectPlayerActionResultMarkup(normalized, 'Player-action destination changes', { rejectHidden: true });
    if (/^(?:NONE|N\s*\/\s*A)$/i.test(normalized)) {
        return { value: [], normalizedResponse: 'NONE' };
    }

    const lines = normalized.split(/\r?\n/).filter(line => line.trim());
    const changes = [];
    const seen = new Set();
    for (const line of lines) {
        const match = line.match(/^\s*-\s+(.+?)\s*$/);
        if (!match || !match[1].trim()) {
            throw new Error('Player-action destination changes must be exactly NONE or a Markdown bullet list.');
        }
        const change = match[1].trim();
        if (/^n\s*\/\s*a$/i.test(change) || /^none$/i.test(change)) {
            throw new Error('Player-action destination changes cannot mix NONE or N/A with bullets.');
        }
        if (/<\/?(?:turnResult|moveTurnResult|hidden)\b/i.test(change)) {
            throw new Error('Player-action destination changes must not contain player-action result XML.');
        }
        const key = change.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) {
            throw new Error(`Player-action destination changes contains duplicate bullet "${change}".`);
        }
        seen.add(key);
        changes.push(change);
    }
    if (!changes.length) {
        throw new Error('Player-action destination changes requires NONE or at least one Markdown bullet.');
    }
    return {
        value: changes,
        normalizedResponse: changes.map(change => `- ${change}`).join('\n')
    };
}

function parsePlayerActionExplicitDuration(response) {
    const normalized = normalizePlainResponse(response, 'player-action explicit duration');
    rejectPlayerActionResultMarkup(normalized, 'Player-action explicit duration');
    if (/^none$/i.test(normalized)) {
        return { value: null, normalizedResponse: 'NONE' };
    }
    const parsed = parsePlayerActionDuration(normalized, 1);
    return {
        value: parsed.value,
        normalizedResponse: parsed.value.text
    };
}

function parsePlayerActionDuration(response, minimumMinutes = 1) {
    const normalized = normalizePlainResponse(response, 'player-action duration');
    if (!Number.isInteger(minimumMinutes) || minimumMinutes < 0) {
        throw new RangeError('Player-action duration minimum must be a non-negative integer.');
    }
    rejectPlayerActionResultMarkup(normalized, 'Player-action duration');
    let minutes;
    try {
        minutes = Utils.parseDurationToMinutes(normalized, {
            fieldName: 'player-action duration'
        });
    } catch (error) {
        throw new Error(`Player-action duration is invalid: ${error.message}`);
    }
    if (!Number.isInteger(minutes) || minutes < minimumMinutes) {
        throw new Error(`Player-action duration must resolve to an integer of at least ${minimumMinutes} minutes.`);
    }
    return { value: { text: normalized, minutes } };
}

function parsePlayerActionCharacterNameSelection(response, allowedCharacters, label) {
    const normalized = normalizeCompactChoiceResponse(response, label.toLowerCase());
    rejectPlayerActionResultMarkup(normalized, label);
    if (/^none$/i.test(normalized)) {
        return { value: [] };
    }
    let identifiers = normalized
        .split(/\r?\n/)
        .map(value => value.replace(/^\s*[-*]\s*/, '').trim())
        .filter(Boolean);
    if (identifiers.some(value => !value)) {
        throw new Error(`${label} must use one exact character name or alias per non-empty line.`);
    }
    if (identifiers.length === 1 && identifiers[0].includes(',')) {
        try {
            return {
                value: normalizePlayerActionAccompanyingCharacterSelection(
                    identifiers,
                    allowedCharacters
                )
            };
        } catch (wholeIdentifierError) {
            identifiers = identifiers[0].split(',').map(value => value.trim()).filter(Boolean);
        }
    }
    return {
        value: normalizePlayerActionAccompanyingCharacterSelection(
            identifiers,
            allowedCharacters
        )
    };
}

function parsePlayerActionAccompanyingCharacters(response, allowedCharacters = []) {
    return parsePlayerActionCharacterNameSelection(
        response,
        allowedCharacters,
        'Player-action accompanying characters'
    );
}

function parsePlayerActionHiddenContests(response, hiddenContestContext = {}) {
    const { xml, root } = parseStrictXml(response, 'player-action hidden contests');
    if (normalizedTagName(root) !== 'hiddencontests') {
        throw new Error('Player-action hidden contests must use <hiddenContests> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['contest'], 'Player-action hidden contests');
    if (directTextContent(root)) {
        throw new Error('Player-action hidden contests cannot contain text outside <contest> elements.');
    }

    if (!hiddenContestContext || typeof hiddenContestContext !== 'object' || Array.isArray(hiddenContestContext)) {
        throw new TypeError('Player-action hidden contests require a character context object.');
    }
    const player = hiddenContestContext.player;
    const npcs = hiddenContestContext.npcs;
    if (!player || typeof player !== 'object' || Array.isArray(player)) {
        throw new TypeError('Player-action hidden contests require a player descriptor.');
    }
    if (!Array.isArray(npcs)) {
        throw new TypeError('Player-action hidden contests require an NPC descriptor array.');
    }

    const requireCharacterDescriptor = (descriptor, label) => {
        if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
            throw new TypeError(`${label} must be a character descriptor.`);
        }
        if (typeof descriptor.id !== 'string' || !descriptor.id.trim()) {
            throw new Error(`${label} requires a non-empty id.`);
        }
        if (typeof descriptor.name !== 'string' || !descriptor.name.trim()) {
            throw new Error(`${label} requires a non-empty name.`);
        }
        if (descriptor.aliases !== undefined && !Array.isArray(descriptor.aliases)) {
            throw new TypeError(`${label} aliases must be an array when provided.`);
        }
        return {
            id: descriptor.id.trim(),
            name: descriptor.name.trim(),
            aliases: Array.isArray(descriptor.aliases)
                ? descriptor.aliases.map((alias, index) => {
                    if (typeof alias !== 'string' || !alias.trim()) {
                        throw new Error(`${label} alias ${index + 1} must be a non-empty string.`);
                    }
                    return alias.trim();
                })
                : [],
            isNPC: descriptor.isNPC === true,
            hiddenFromPlayer: descriptor.hiddenFromPlayer === true
        };
    };

    const canonicalPlayer = requireCharacterDescriptor(player, 'Hidden-contest player');
    if (canonicalPlayer.isNPC) {
        throw new Error('Hidden-contest player descriptor cannot be an NPC.');
    }
    const canonicalNpcs = npcs.map((npc, index) => {
        const canonical = requireCharacterDescriptor(npc, `Hidden-contest NPC ${index + 1}`);
        if (!canonical.isNPC) {
            throw new Error(`Hidden-contest NPC "${canonical.name}" must be marked as an NPC.`);
        }
        return canonical;
    });

    const identifiers = new Map();
    const registerIdentifier = (identifier, character) => {
        const key = identifier.trim().toLowerCase();
        const matches = identifiers.get(key) || [];
        if (!matches.some(match => match.id === character.id)) {
            matches.push(character);
        }
        identifiers.set(key, matches);
    };
    for (const character of [canonicalPlayer, ...canonicalNpcs]) {
        registerIdentifier(character.name, character);
        for (const alias of character.aliases) {
            registerIdentifier(alias, character);
        }
    }
    for (const playerAlias of ['player', 'the player', 'you']) {
        registerIdentifier(playerAlias, canonicalPlayer);
    }
    const resolveCharacter = (identifier, label) => {
        const matches = identifiers.get(identifier.trim().toLowerCase()) || [];
        if (!matches.length) {
            throw new Error(`${label} "${identifier}" is not an eligible local character name or alias.`);
        }
        if (matches.length > 1) {
            throw new Error(`${label} "${identifier}" is ambiguous between ${matches.map(match => match.name).join(' and ')}.`);
        }
        return matches[0];
    };

    const contests = [];
    const seen = new Set();
    for (const [index, contestNode] of directChildrenByTagName(root, 'contest').entries()) {
        const label = `Player-action hidden contest ${index + 1}`;
        rejectUnexpectedDirectChildren(contestNode, ['action', 'actor', 'opponent'], label);
        if (directTextContent(contestNode)) {
            throw new Error(`${label} cannot contain text outside its named fields.`);
        }
        const requirePlainField = tagName => {
            const field = requireSingleDirectChild(contestNode, tagName, label);
            if (directChildElements(field.node).length) {
                throw new Error(`${label} <${tagName}> must contain plain text only.`);
            }
            return field.text;
        };
        const actionText = requirePlainField('action').toLowerCase();
        if (actionText !== 'reveal' && actionText !== 'hide') {
            throw new Error(`${label} <action> must be exactly reveal or hide.`);
        }
        const actorText = requirePlainField('actor');
        const opponentText = requirePlainField('opponent');
        const actor = resolveCharacter(actorText, `${label} actor`);
        const opponent = resolveCharacter(opponentText, `${label} opponent`);
        if (actor.id === opponent.id) {
            throw new Error(`${label} actor and opponent cannot be the same character.`);
        }

        if (actionText === 'reveal') {
            if (actor.id !== canonicalPlayer.id) {
                throw new Error(`${label} reveal actor must be the current player.`);
            }
            if (!opponent.isNPC || opponent.hiddenFromPlayer !== true) {
                throw new Error(`${label} reveal opponent must be a currently hidden local NPC.`);
            }
        } else {
            if (!actor.isNPC || actor.hiddenFromPlayer === true) {
                throw new Error(`${label} hide actor must be a currently visible local NPC.`);
            }
            if (opponent.id !== canonicalPlayer.id) {
                throw new Error(`${label} hide opponent must be the current player.`);
            }
        }

        const key = `${actionText}:${actor.id}:${opponent.id}`;
        if (seen.has(key)) {
            throw new Error(`${label} duplicates an earlier hidden contest.`);
        }
        seen.add(key);
        contests.push({
            action: actionText === 'reveal' ? 'reveal_hidden_npc' : 'hide_visible_npc',
            actorId: actor.id,
            actorName: actor.name,
            opponentId: opponent.id,
            opponentName: opponent.name,
            npcId: actionText === 'reveal' ? opponent.id : actor.id,
            npcName: actionText === 'reveal' ? opponent.name : actor.name
        });
    }

    return { value: contests, normalizedResponse: xml };
}

function parsePlayerActionRequiredProse(response) {
    const normalized = normalizePlainResponse(response, 'player-action prose');
    rejectPlayerActionResultMarkup(normalized, 'Player-action prose', { rejectHidden: true });
    if (/<(?:\/?[A-Za-z_][A-Za-z0-9_.:-]*(?:\s[^<>]*?)?\/?>|!\[CDATA\[|\?xml\b)/i.test(normalized)) {
        throw new Error('Player-action prose must contain prose only, without XML markup.');
    }
    return { value: normalized };
}

function parsePlayerActionOptionalProse(response) {
    const normalized = normalizePlainResponse(response, 'optional player-action prose');
    if (/^n\s*(?:[/._-]\s*)?a\.?$/i.test(normalized)) {
        return { value: null, normalizedResponse: 'N/A' };
    }
    rejectPlayerActionResultMarkup(normalized, 'Optional player-action prose', { rejectHidden: true });
    if (/<(?:\/?[A-Za-z_][A-Za-z0-9_.:-]*(?:\s[^<>]*?)?\/?>|!\[CDATA\[|\?xml\b)/i.test(normalized)) {
        throw new Error('Optional player-action prose must contain prose only, without XML markup, or exactly N/A.');
    }
    return { value: normalized };
}

function parsePlayerActionHiddenNotes(response) {
    const normalized = normalizePlainResponse(response, 'player-action hidden notes');
    if (/^n\s*\/\s*a\.?$/i.test(normalized)) {
        return { value: null };
    }
    rejectPlayerActionResultMarkup(normalized, 'Player-action hidden notes', { rejectHidden: true });
    return { value: normalized };
}

function parsePlayerActionTimeReasoning(response) {
    const normalized = normalizePlainResponse(response, 'player-action time reasoning');
    rejectPlayerActionResultMarkup(normalized, 'Player-action time reasoning', { rejectHidden: true });
    return { value: normalized };
}

function parseExactXmlRoot(response, expectedRoot, { allowEmptyRoot = false } = {}) {
    const rootLabel = `<${expectedRoot}> response`;
    const parsed = parseStrictXml(response, rootLabel);
    if (normalizedTagName(parsed.root) !== String(expectedRoot).toLowerCase()) {
        throw new Error(`${rootLabel} must use <${expectedRoot}> as its document root.`);
    }
    if (!allowEmptyRoot && !String(parsed.root.textContent || '').trim() && !directChildElements(parsed.root).length) {
        throw new Error(`${rootLabel} cannot be empty.`);
    }
    return { value: parsed.xml, normalizedResponse: parsed.xml };
}

function parseNeedBarCharactersResult(response, allowedNeedBarIds = []) {
    if (
        !Array.isArray(allowedNeedBarIds)
        || allowedNeedBarIds.some(id => typeof id !== 'string' || !id.trim())
    ) {
        throw new TypeError('Need-bar characters parser requires an array of non-empty need-bar ids.');
    }

    const { xml, root } = parseStrictXml(response, 'need-bar characters result');
    let normalizedXml = xml;
    let normalizedMagnitudeAlias = false;
    if (normalizedTagName(root) !== 'characters') {
        throw new Error('Need-bar characters result must use <characters> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['character'], 'Need-bar characters result');

    const allowedIds = new Map(
        allowedNeedBarIds.map(id => [id.trim().toLowerCase(), id.trim()])
    );
    const seenCharacters = new Set();
    for (const characterNode of directChildrenByTagName(root, 'character')) {
        rejectUnexpectedDirectChildren(
            characterNode,
            ['name', 'affectedNeedBars'],
            'Need-bar character'
        );
        const characterName = requireSingleDirectChild(
            characterNode,
            'name',
            'Need-bar character'
        ).text;
        const characterKey = characterName.toLowerCase();
        if (seenCharacters.has(characterKey)) {
            throw new Error(`Need-bar characters result contains duplicate character "${characterName}".`);
        }
        seenCharacters.add(characterKey);

        const affectedNeedBars = requireSingleDirectChild(
            characterNode,
            'affectedNeedBars',
            'Need-bar character',
            { allowEmpty: true }
        ).node;
        rejectUnexpectedDirectChildren(
            affectedNeedBars,
            ['needBar'],
            `Need-bar character "${characterName}"`
        );
        const needBarNodes = directChildrenByTagName(affectedNeedBars, 'needBar');
        if (!needBarNodes.length) {
            throw new Error(
                `Need-bar character "${characterName}" must contain at least one affected <needBar>.`
            );
        }

        const seenNeedBars = new Set();
        for (const needBarNode of needBarNodes) {
            rejectUnexpectedDirectChildren(
                needBarNode,
                ['id', 'changeDirection', 'change', 'reason'],
                `Need-bar entry for "${characterName}"`
            );
            const id = requireSingleDirectChild(
                needBarNode,
                'id',
                `Need-bar entry for "${characterName}"`
            ).text;
            const idKey = id.toLowerCase();
            if (seenNeedBars.has(idKey)) {
                throw new Error(
                    `Need-bar character "${characterName}" contains duplicate need bar "${id}".`
                );
            }
            seenNeedBars.add(idKey);
            if (allowedIds.size && !allowedIds.has(idKey)) {
                throw new Error(`Need-bar characters result contains unknown need-bar id "${id}".`);
            }

            const direction = requireSingleDirectChild(
                needBarNode,
                'changeDirection',
                `Need-bar entry for "${characterName}"`
            ).text.toLowerCase();
            if (!['increase', 'decrease'].includes(direction)) {
                throw new Error('Need-bar <changeDirection> must be exactly increase or decrease.');
            }

            const magnitudeField = requireSingleDirectChild(
                needBarNode,
                'change',
                `Need-bar entry for "${characterName}"`
            );
            const magnitudeAlias = magnitudeField.text.toLowerCase();
            const magnitude = magnitudeAlias === 'fill'
                ? 'full'
                : (magnitudeAlias === 'drain' ? 'empty' : magnitudeAlias);
            if (!['small', 'medium', 'large', 'all', 'full', 'empty'].includes(magnitude)) {
                throw new Error(
                    'Need-bar <change> must be exactly small, medium, large, all, full/fill, or empty/drain.'
                );
            }
            if (
                (magnitude === 'full' && direction !== 'increase')
                || (magnitude === 'empty' && direction !== 'decrease')
            ) {
                throw new Error(
                    `Need-bar <change>${magnitude}</change> requires <changeDirection>${magnitude === 'full' ? 'increase' : 'decrease'}</changeDirection>.`
                );
            }
            if (magnitude !== magnitudeAlias) {
                magnitudeField.node.textContent = magnitude;
                normalizedMagnitudeAlias = true;
            }

            requireSingleDirectChild(
                needBarNode,
                'reason',
                `Need-bar entry for "${characterName}"`
            );
        }
    }

    if (normalizedMagnitudeAlias) {
        normalizedXml = root.toString();
    }
    return { value: normalizedXml, normalizedResponse: normalizedXml };
}

function parseRevisionDecision(response) {
    const { xml, root } = parseStrictXml(response, 'revision decision');
    if (normalizedTagName(root) !== 'revisiondecision') {
        throw new Error('Revision decision must use <revisionDecision> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['revise', 'issues'], 'Revision decision');
    const revise = parseBooleanText(
        requireSingleDirectChild(root, 'revise', 'Revision decision').text,
        'Revision decision <revise>'
    );
    const issues = directChildrenByTagName(root, 'issues');
    if (issues.length > 1) {
        throw new Error('Revision decision may contain at most one direct <issues> child.');
    }
    const issueText = issues.length ? String(issues[0].textContent || '').trim() : '';
    if (revise && !issueText) {
        throw new Error('Revision decision requires non-empty <issues> when revision is requested.');
    }
    return {
        value: { revise, issues: issueText, xml },
        normalizedResponse: xml
    };
}

function parseAllowedCharacterSelection(response, allowedNames, minimum = 0, maximum = 3) {
    if (!Array.isArray(allowedNames) || allowedNames.some(name => typeof name !== 'string' || !name.trim())) {
        throw new TypeError('Allowed character selection requires an array of non-empty names.');
    }
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || maximum < minimum) {
        throw new RangeError('Allowed character selection requires valid integer bounds.');
    }
    const { xml, root } = parseStrictXml(response, 'character selection');
    if (normalizedTagName(root) !== 'selectedcharacters') {
        throw new Error('Character selection must use <selectedCharacters> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['name'], 'Character selection');
    const canonicalNames = new Map(allowedNames.map(name => [name.trim().toLowerCase(), name.trim()]));
    const selected = directChildrenByTagName(root, 'name').map(node => String(node.textContent || '').trim());
    if (selected.length < minimum || selected.length > maximum) {
        throw new Error(`Character selection must contain between ${minimum} and ${maximum} names.`);
    }
    const seen = new Set();
    const resolved = selected.map(name => {
        const canonical = canonicalNames.get(name.toLowerCase());
        if (!canonical) {
            throw new Error(`Character selection contains unavailable character "${name}".`);
        }
        const key = canonical.toLowerCase();
        if (seen.has(key)) {
            throw new Error(`Character selection contains duplicate character "${canonical}".`);
        }
        seen.add(key);
        return canonical;
    });
    return { value: resolved, normalizedResponse: xml };
}

function parseNarrativeScope(response) {
    const { xml, root } = parseStrictXml(response, 'narrative scope');
    if (normalizedTagName(root) !== 'narrativescope') {
        throw new Error('Narrative scope must use <narrativeScope> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['travel', 'before', 'during', 'after'], 'Narrative scope');
    const traveling = parseBooleanText(
        requireSingleDirectChild(root, 'travel', 'Narrative scope').text,
        'Narrative scope <travel>'
    );
    const readOptional = tagName => {
        const matches = directChildrenByTagName(root, tagName);
        if (matches.length > 1) {
            throw new Error(`Narrative scope may contain at most one direct <${tagName}> child.`);
        }
        return matches.length ? String(matches[0].textContent || '').trim() : '';
    };
    return {
        value: {
            travel: traveling,
            before: readOptional('before'),
            during: readOptional('during'),
            after: readOptional('after')
        },
        normalizedResponse: xml
    };
}

function parseOutcomeAcknowledgement(response, expectedFacts = []) {
    if (!Array.isArray(expectedFacts) || expectedFacts.some(fact => typeof fact !== 'string' || !fact.trim())) {
        throw new TypeError('Outcome acknowledgement requires an array of non-empty expected facts.');
    }
    const { xml, root } = parseStrictXml(response, 'outcome acknowledgement');
    if (normalizedTagName(root) !== 'outcomeacknowledgement') {
        throw new Error('Outcome acknowledgement must use <outcomeAcknowledgement> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['fact'], 'Outcome acknowledgement');
    const facts = directChildrenByTagName(root, 'fact').map(node => String(node.textContent || '').trim());
    if (facts.length !== expectedFacts.length) {
        throw new Error(`Outcome acknowledgement requires exactly ${expectedFacts.length} facts.`);
    }
    const unmatchedFacts = [...facts];
    expectedFacts.forEach((expected) => {
        const index = unmatchedFacts.indexOf(expected);
        if (index < 0) {
            throw new Error(`Outcome acknowledgement must include exact fact "${expected}".`);
        }
        unmatchedFacts.splice(index, 1);
    });
    return { value: facts, normalizedResponse: xml };
}

function parseQuestRewardResult(response, expectedRewards) {
    const expectedRewardList = Array.isArray(expectedRewards)
        ? expectedRewards.map(reward => String(reward).trim())
        : null;
    const expectedRewardCount = expectedRewardList
        ? expectedRewardList.length
        : expectedRewards;
    if (
        !Number.isInteger(expectedRewardCount)
        || expectedRewardCount < 1
        || (expectedRewardList && expectedRewardList.some(reward => !reward))
    ) {
        throw new RangeError('Quest reward parser requires a positive count or non-empty reward list.');
    }
    const { xml, root } = parseStrictXml(response, 'quest reward result');
    if (normalizedTagName(root) !== 'questrewardresult') {
        throw new Error('Quest reward result must use <questRewardResult> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['prose', 'rewardcoverage'], 'Quest reward result');
    requireSingleDirectChild(root, 'prose', 'Quest reward result');
    const coverageNodes = directChildrenByTagName(root, 'rewardcoverage');
    if (coverageNodes.length !== expectedRewardCount) {
        throw new Error(`Quest reward result requires exactly ${expectedRewardCount} <rewardCoverage> entries.`);
    }
    const seenIndexes = new Set();
    coverageNodes.forEach(node => {
        const indexText = requireSingleDirectChild(node, 'index', 'Quest reward coverage').text;
        const index = Number(indexText);
        if (!Number.isInteger(index) || index < 1 || index > expectedRewardCount || seenIndexes.has(index)) {
            throw new Error(`Quest reward coverage contains invalid or duplicate index "${indexText}".`);
        }
        seenIndexes.add(index);
        const included = requireSingleDirectChild(node, 'included', 'Quest reward coverage').text;
        if (expectedRewardList && included !== expectedRewardList[index - 1]) {
            throw new Error(
                `Quest reward coverage ${index} must exactly match "${expectedRewardList[index - 1]}".`
            );
        }
    });
    return {
        value: {
            xml,
            prose: requireSingleDirectChild(root, 'prose', 'Quest reward result').text,
            coveredRewardIndexes: Array.from(seenIndexes).sort((left, right) => left - right)
        },
        normalizedResponse: xml
    };
}

function parseGameIntroResult(response) {
    const { xml, root } = parseStrictXml(response, 'game intro result');
    if (normalizedTagName(root) !== 'gameintro') {
        throw new Error('Game intro result must use <gameIntro> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['introprose'], 'Game intro result');
    requireSingleDirectChild(root, 'introProse', 'Game intro result');
    return { value: xml, normalizedResponse: xml };
}

function parseTurnNarrativeResult(response, { allowTravel = true } = {}) {
    const { xml, root } = parseStrictXml(response, 'turn narrative result');
    const rootName = normalizedTagName(root);
    const allowedRoots = allowTravel ? ['turnresult', 'moveturnresult'] : ['turnresult'];
    if (!allowedRoots.includes(rootName)) {
        throw new Error(`Turn narrative result must use ${allowTravel ? '<turnResult> or <moveTurnResult>' : '<turnResult>'} as its document root.`);
    }
    if (rootName === 'turnresult') {
        requireSingleDirectChild(root, 'prose', 'Turn narrative result');
    } else {
        const proseTags = ['originprose', 'betweenprose', 'destinationprose'];
        if (!proseTags.some(tag => directChildrenByTagName(root, tag).some(node => String(node.textContent || '').trim()))) {
            throw new Error('Move turn narrative result requires player-facing travel prose.');
        }
    }
    return { value: xml, normalizedResponse: xml };
}

function parseCraftNarrativeResult(response, {
    requireOtherEffect = false,
    expectedDurationMinutes = null
} = {}) {
    const { xml, root } = parseStrictXml(response, 'craft narrative result');
    if (normalizedTagName(root) !== 'result') {
        throw new Error('Craft narrative result must use <result> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['description', 'othereffectdescription', 'timepassed'], 'Craft narrative result');
    requireSingleDirectChild(root, 'description', 'Craft narrative result');
    const otherEffects = directChildrenByTagName(root, 'otherEffectDescription');
    if (requireOtherEffect && (otherEffects.length !== 1 || !String(otherEffects[0].textContent || '').trim())) {
        throw new Error('Craft narrative result requires one non-empty <otherEffectDescription>.');
    }
    if (!requireOtherEffect && otherEffects.length > 1) {
        throw new Error('Craft narrative result may contain at most one <otherEffectDescription>.');
    }
    const timePassedNode = requireSingleDirectChild(root, 'timePassed', 'Craft narrative result').node;
    if (expectedDurationMinutes !== null) {
        if (!Number.isInteger(expectedDurationMinutes) || expectedDurationMinutes < 1) {
            throw new RangeError('Craft narrative expected duration must be a positive integer.');
        }
        const durationText = requireSingleDirectChild(
            timePassedNode,
            'duration',
            'Craft narrative <timePassed>'
        ).text;
        let parsedDurationMinutes;
        try {
            parsedDurationMinutes = Utils.parseDurationToMinutes(durationText, {
                fieldName: 'craft narrative duration'
            });
        } catch (error) {
            throw new Error(`Craft narrative duration is invalid: ${error.message}`);
        }
        if (parsedDurationMinutes !== expectedDurationMinutes) {
            throw new Error(
                `Craft narrative duration must resolve to exactly ${expectedDurationMinutes} minutes.`
            );
        }
    }
    return { value: xml, normalizedResponse: xml };
}

function parseLocationModificationNarrativeResult(response, { expectedDurationMinutes = null } = {}) {
    const parsed = parseCraftNarrativeResult(response, {
        requireOtherEffect: false,
        expectedDurationMinutes
    });
    const { root } = parseStrictXml(response, 'location modification narrative result');
    requireSingleDirectChild(root, 'otherEffectDescription', 'Location modification narrative result', { allowEmpty: true });
    return parsed;
}

function parseContainerOpenNarrativeResult(response, {
    expectedToolName = null,
    expectedSuccess = null
} = {}) {
    const { xml, root } = parseStrictXml(response, 'container open result');
    if (normalizedTagName(root) !== 'containeropenresult') {
        throw new Error('Container open result must use <containerOpenResult> as its document root.');
    }
    rejectUnexpectedDirectChildren(
        root,
        ['toolused', 'checkresult', 'success', 'permanentlyopened', 'prose', 'timepassed'],
        'Container open result'
    );
    const toolUsed = requireSingleDirectChild(root, 'toolUsed', 'Container open result').text;
    if (!['resolveSkillCheck', 'resolveOpposedSkillCheck'].includes(toolUsed)) {
        throw new Error('Container open result <toolUsed> must name the check tool that was used.');
    }
    if (expectedToolName !== null && toolUsed !== expectedToolName) {
        throw new Error(`Container open result <toolUsed> must exactly match "${expectedToolName}".`);
    }
    const checkResult = requireSingleDirectChild(root, 'checkResult', 'Container open result').text;
    const success = parseBooleanText(
        requireSingleDirectChild(root, 'success', 'Container open result').text,
        'Container open result <success>'
    );
    if (expectedSuccess !== null && typeof expectedSuccess !== 'boolean') {
        throw new TypeError('Container open expected success must be a boolean when provided.');
    }
    if (expectedSuccess !== null && success !== expectedSuccess) {
        throw new Error(
            `Container open result <success> must match the authoritative check result (${expectedSuccess}).`
        );
    }
    const permanentlyOpened = parseBooleanText(
        requireSingleDirectChild(root, 'permanentlyOpened', 'Container open result').text,
        'Container open result <permanentlyOpened>'
    );
    if (!success && permanentlyOpened) {
        throw new Error('A failed container-open check cannot permanently open the container.');
    }
    const prose = requireSingleDirectChild(root, 'prose', 'Container open result').text;
    const timePassedNode = requireSingleDirectChild(root, 'timePassed', 'Container open result').node;
    const durationText = requireSingleDirectChild(
        timePassedNode,
        'duration',
        'Container open result <timePassed>'
    ).text;
    let timePassedMinutes;
    try {
        timePassedMinutes = Utils.parseDurationToMinutes(durationText, {
            fieldName: 'container open result duration'
        });
    } catch (error) {
        throw new Error(`Container open result duration is invalid: ${error.message}`);
    }
    return {
        value: xml,
        normalizedResponse: xml,
        semantic: {
            toolUsed,
            checkResult,
            success,
            permanentlyOpened,
            prose,
            timePassedMinutes
        }
    };
}

function parseWhileYouWereAwayResult(response) {
    const { xml, root } = parseStrictXml(response, 'while-you-were-away result');
    if (normalizedTagName(root) !== 'response') {
        throw new Error('While-you-were-away result must use <response> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['proseforplayer', 'characterupdates', 'itemscenerymoves'], 'While-you-were-away result');
    const proseNodes = directChildrenByTagName(root, 'proseForPlayer');
    if (proseNodes.length > 1) {
        throw new Error('While-you-were-away result may contain at most one direct <proseForPlayer> child.');
    }
    if (proseNodes.length === 1) {
        requireSingleDirectChild(root, 'proseForPlayer', 'While-you-were-away result', { allowEmpty: true });
    }
    const characterUpdatesRoot = requireSingleDirectChild(
        root,
        'characterUpdates',
        'While-you-were-away result',
        { allowEmpty: true }
    ).node;
    validateWhileAwayCharacterUpdatesRoot(characterUpdatesRoot, {
        label: 'While-you-were-away result <characterUpdates>',
        allowHere: true
    });
    const itemSceneryMovesRoot = requireSingleDirectChild(
        root,
        'itemSceneryMoves',
        'While-you-were-away result',
        { allowEmpty: true }
    ).node;
    validateWhileAwayItemSceneryMovesRoot(itemSceneryMovesRoot, {
        label: 'While-you-were-away result <itemSceneryMoves>'
    });
    return { value: xml, normalizedResponse: xml };
}

function validateWhileAwayTravelDestination(node, {
    label,
    requireHere = false,
    allowHere = false
} = {}) {
    if (!node) {
        if (requireHere) {
            throw new Error(`${label} requires <travelDestination>HERE</travelDestination>.`);
        }
        return;
    }
    rejectUnexpectedDirectChildren(node, ['location', 'region'], `${label} <travelDestination>`);
    const children = directChildElements(node);
    const directText = directTextContent(node);
    if (requireHere) {
        if (children.length || directText.toUpperCase() !== 'HERE') {
            throw new Error(`${label} requires <travelDestination>HERE</travelDestination>.`);
        }
        return;
    }
    if (!children.length) {
        if (allowHere && directText.toUpperCase() === 'HERE') {
            return;
        }
        throw new Error(
            `${label} <travelDestination> must use <location> and/or <region> child tags${allowHere ? ' or the exact HERE sentinel' : ''}.`
        );
    }
    if (directText) {
        throw new Error(`${label} <travelDestination> must not mix text with <location> or <region> child tags.`);
    }
    if (directChildrenByTagName(node, 'location').length > 1 || directChildrenByTagName(node, 'region').length > 1) {
        throw new Error(`${label} <travelDestination> may contain at most one <location> and one <region>.`);
    }
    const destinationParts = children.map(child => String(child.textContent || '').trim()).filter(Boolean);
    if (!destinationParts.length) {
        throw new Error(`${label} requires a non-empty destination location or region.`);
    }
}

function validateWhileAwayNeedBarValue(value, label) {
    const normalized = String(value || '').trim();
    if (/^n\s*\/\s*a\.?$/i.test(normalized)) {
        return;
    }
    const match = normalized.match(/^(\d+(?:\.\d+)?)\s*%?$/);
    if (!match) {
        throw new Error(`${label} must be a percentage from 0 to 100 or N/A.`);
    }
    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
        throw new Error(`${label} must be between 0 and 100 percent.`);
    }
}

function validateWhileAwayCharacterUpdateElement(root, {
    expectedName = null,
    label = 'While-you-were-away character update',
    requireHere = false,
    allowHere = false
} = {}) {
    if (normalizedTagName(root) !== 'characterupdate') {
        throw new Error(`${label} must use <characterUpdate> as its document root.`);
    }
    rejectUnexpectedDirectChildren(
        root,
        ['name', 'needbarchanges', 'traveldestination', 'update'],
        label
    );
    const name = requireSingleDirectChild(root, 'name', label).text;
    if (expectedName !== null && name !== expectedName) {
        throw new Error(`${label} name must exactly match "${expectedName}".`);
    }

    const needBarChangesRoot = requireSingleDirectChild(
        root,
        'needBarChanges',
        label,
        { allowEmpty: true }
    ).node;
    rejectUnexpectedDirectChildren(needBarChangesRoot, ['needbareffect'], `${label} <needBarChanges>`);
    const seenNeedBarIds = new Set();
    for (const [index, effectNode] of directChildrenByTagName(needBarChangesRoot, 'needBarEffect').entries()) {
        const effectLabel = `${label} needBarEffect #${index + 1}`;
        rejectUnexpectedDirectChildren(effectNode, ['needbarid', 'value'], effectLabel);
        const needBarId = requireSingleDirectChild(effectNode, 'needBarId', effectLabel).text;
        const value = requireSingleDirectChild(effectNode, 'value', effectLabel).text;
        validateWhileAwayNeedBarValue(value, `${effectLabel} <value>`);
        const needBarKey = needBarId.toLowerCase();
        if (seenNeedBarIds.has(needBarKey)) {
            throw new Error(`${label} contains duplicate need bar "${needBarId}".`);
        }
        seenNeedBarIds.add(needBarKey);
    }

    const travelDestinationNodes = directChildrenByTagName(root, 'travelDestination');
    if (travelDestinationNodes.length > 1) {
        throw new Error(`${label} may contain at most one <travelDestination>.`);
    }
    validateWhileAwayTravelDestination(travelDestinationNodes[0] || null, {
        label,
        requireHere,
        allowHere
    });
    requireSingleDirectChild(root, 'update', label);
    return name;
}

function validateWhileAwayCharacterUpdatesRoot(root, {
    label = 'While-you-were-away character updates',
    requireHere = false,
    allowHere = false
} = {}) {
    rejectUnexpectedDirectChildren(root, ['characterupdate'], label);
    const seenNames = new Set();
    for (const [index, updateNode] of directChildrenByTagName(root, 'characterUpdate').entries()) {
        const name = validateWhileAwayCharacterUpdateElement(updateNode, {
            label: `${label} entry #${index + 1}`,
            requireHere,
            allowHere
        });
        const nameKey = name.toLowerCase();
        if (seenNames.has(nameKey)) {
            throw new Error(`${label} contains duplicate character "${name}".`);
        }
        seenNames.add(nameKey);
    }
}

function validateWhileAwayItemSceneryMovesRoot(root, {
    label = 'While-you-were-away item/scenery moves'
} = {}) {
    rejectUnexpectedDirectChildren(root, ['itemname'], label);
    const seenNames = new Set();
    for (const [index, itemNode] of directChildrenByTagName(root, 'itemName').entries()) {
        const name = String(itemNode.textContent || '').trim();
        if (!name) {
            throw new Error(`${label} itemName #${index + 1} must not be empty.`);
        }
        const nameKey = name.toLowerCase();
        if (seenNames.has(nameKey)) {
            throw new Error(`${label} contains duplicate item/scenery name "${name}".`);
        }
        seenNames.add(nameKey);
    }
}

function parseWhileAwayCharacterUpdate(response, expectedName) {
    if (typeof expectedName !== 'string' || !expectedName.trim()) {
        throw new TypeError('While-you-were-away character update requires an expected name.');
    }
    const { xml, root } = parseStrictXml(response, 'while-you-were-away character update');
    const trimmedExpectedName = expectedName.trim();
    const name = validateWhileAwayCharacterUpdateElement(root, {
        expectedName: trimmedExpectedName,
        label: 'While-you-were-away character update'
    });
    return {
        value: { xml, name },
        normalizedResponse: xml
    };
}

function parseWhileAwayArrivalUpdates(response) {
    const { xml, root } = parseStrictXml(response, 'while-you-were-away arrival updates');
    if (normalizedTagName(root) !== 'characterupdates') {
        throw new Error('While-you-were-away arrival updates must use <characterUpdates> as its document root.');
    }
    validateWhileAwayCharacterUpdatesRoot(root, {
        label: 'While-you-were-away arrival updates',
        requireHere: true
    });
    return { value: xml, normalizedResponse: xml };
}

function canonicalizeXmlElement(node) {
    const attributes = Array.from(node?.attributes || [])
        .map(attribute => [String(attribute.name), String(attribute.value)])
        .sort((left, right) => left[0].localeCompare(right[0]));
    const children = Array.from(node?.childNodes || []).flatMap(child => {
        if (child?.nodeType === 1) {
            return [canonicalizeXmlElement(child)];
        }
        if (child?.nodeType === 3 || child?.nodeType === 4) {
            const text = String(child.nodeValue || '').replace(/\s+/g, ' ').trim();
            return text ? [{ text }] : [];
        }
        return [];
    });
    return { tag: normalizedTagName(node), attributes, children };
}

function parseXmlRootForComparison(xml, expectedRoot, label) {
    const parsed = parseStrictXml(xml, label);
    if (normalizedTagName(parsed.root) !== expectedRoot.toLowerCase()) {
        throw new Error(`${label} must use <${expectedRoot}> as its document root.`);
    }
    return parsed.root;
}

function parseWhileYouWereAwayStagedResult(response, {
    characterUpdateXml = [],
    arrivalUpdatesXml,
    itemSceneryMovesXml
} = {}) {
    if (!Array.isArray(characterUpdateXml)) {
        throw new TypeError('Staged while-you-were-away character updates must be an array.');
    }
    const parsedFinal = parseWhileYouWereAwayResult(response);
    const finalRoot = parseXmlRootForComparison(response, 'response', 'staged while-you-were-away final response');
    const finalUpdatesRoot = requireSingleDirectChild(
        finalRoot,
        'characterUpdates',
        'Staged while-you-were-away final response',
        { allowEmpty: true }
    ).node;
    const finalMoveRoot = requireSingleDirectChild(
        finalRoot,
        'itemSceneryMoves',
        'Staged while-you-were-away final response',
        { allowEmpty: true }
    ).node;
    const expectedUpdateNodes = characterUpdateXml.map((xml, index) => (
        parseXmlRootForComparison(xml, 'characterUpdate', `staged character update ${index + 1}`)
    ));
    const arrivalsRoot = parseXmlRootForComparison(
        arrivalUpdatesXml,
        'characterUpdates',
        'staged arrival updates'
    );
    expectedUpdateNodes.push(...directChildrenByTagName(arrivalsRoot, 'characterUpdate'));
    const finalUpdateNodes = directChildrenByTagName(finalUpdatesRoot, 'characterUpdate');
    if (finalUpdateNodes.length !== expectedUpdateNodes.length) {
        throw new Error('Final while-you-were-away response changed the staged character-update count.');
    }
    const finalUpdatesByName = new Map(finalUpdateNodes.map(node => [
        requireSingleDirectChild(node, 'name', 'Final staged while-you-were-away character update').text.toLowerCase(),
        node
    ]));
    expectedUpdateNodes.forEach((expectedNode, index) => {
        const expectedName = requireSingleDirectChild(
            expectedNode,
            'name',
            `Staged while-you-were-away character update ${index + 1}`
        ).text;
        const finalNode = finalUpdatesByName.get(expectedName.toLowerCase());
        if (
            !finalNode
            || JSON.stringify(canonicalizeXmlElement(expectedNode))
                !== JSON.stringify(canonicalizeXmlElement(finalNode))
        ) {
            throw new Error(`Final while-you-were-away response changed staged character update "${expectedName}".`);
        }
    });
    const expectedMoveRoot = parseXmlRootForComparison(
        itemSceneryMovesXml,
        'itemSceneryMoves',
        'staged item/scenery moves'
    );
    const canonicalItemNames = root => directChildrenByTagName(root, 'itemName')
        .map(node => String(node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase())
        .sort();
    if (JSON.stringify(canonicalItemNames(expectedMoveRoot)) !== JSON.stringify(canonicalItemNames(finalMoveRoot))) {
        throw new Error('Final while-you-were-away response changed the staged item/scenery moves.');
    }
    return {
        ...parsedFinal,
        normalizedResponse: parsedFinal.value
    };
}

function parseScheduledEventNarrativeResult(response) {
    const { xml, root } = parseStrictXml(response, 'scheduled event result');
    if (normalizedTagName(root) !== 'scheduledeventresult') {
        throw new Error('Scheduled event result must use <scheduledEventResult> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['summary', 'proseforplayer'], 'Scheduled event result');
    const children = directChildElements(root);
    if (!children.length) {
        return { value: xml, normalizedResponse: xml };
    }
    requireSingleDirectChild(root, 'summary', 'Scheduled event result');
    if (directChildrenByTagName(root, 'proseForPlayer').length > 1) {
        throw new Error('Scheduled event result may contain at most one <proseForPlayer>.');
    }
    return { value: xml, normalizedResponse: xml };
}

function parseScheduledEventApplicability(response) {
    const { root } = parseStrictXml(response, 'scheduled event applicability');
    if (normalizedTagName(root) !== 'applicability') {
        throw new Error('Scheduled event applicability must use <applicability> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['decision', 'reason'], 'Scheduled event applicability');
    const decision = requireSingleDirectChild(
        root,
        'decision',
        'Scheduled event applicability'
    ).text.toLowerCase();
    requireSingleDirectChild(root, 'reason', 'Scheduled event applicability');
    if (decision !== 'yes' && decision !== 'no') {
        throw new Error('Scheduled event <decision> must be exactly yes or no.');
    }
    return { value: decision === 'yes' };
}

function normalizeScheduledEventContractText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseJsonObjectText(text, label) {
    let value;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new Error(`${label} must contain valid JSON: ${error.message}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must decode to a JSON object.`);
    }
    return value;
}

function validateScheduledEventPlannedToolArguments(name, argumentsObject, label) {
    if (name !== 'editChatLogEntry') {
        return;
    }

    const hasEntry = Object.hasOwn(argumentsObject, 'entry');
    const hasIndex = Object.hasOwn(argumentsObject, 'index');
    const entryIsValid = hasEntry
        && typeof argumentsObject.entry === 'string'
        && Boolean(argumentsObject.entry.trim());
    const indexIsValid = hasIndex
        && Number.isInteger(argumentsObject.index)
        && argumentsObject.index >= 0;
    if (!entryIsValid && !indexIsValid) {
        throw new Error(
            `${label} editChatLogEntry requires either a non-empty string "entry" `
            + 'or a zero-based non-negative integer "index".'
        );
    }
    if (hasEntry && !entryIsValid) {
        throw new Error(`${label} editChatLogEntry "entry" must be a non-empty string.`);
    }
    if (hasIndex && !indexIsValid) {
        throw new Error(
            `${label} editChatLogEntry "index" must be a zero-based non-negative integer.`
        );
    }
    if (typeof argumentsObject.content !== 'string' || !argumentsObject.content.trim()) {
        throw new Error(`${label} editChatLogEntry requires non-empty string "content".`);
    }
}

function parseScheduledEventToolPlan(response, scheduledEventText, availableToolNames = []) {
    const authoritativeEvent = typeof scheduledEventText === 'string'
        ? scheduledEventText.trim()
        : '';
    if (!authoritativeEvent) {
        throw new Error('Scheduled event tool plan requires the authoritative event text.');
    }
    if (
        !Array.isArray(availableToolNames)
        || availableToolNames.some(name => typeof name !== 'string' || !name.trim())
    ) {
        throw new TypeError('Scheduled event tool plan requires an array of available tool names.');
    }

    const { xml, root } = parseStrictXml(response, 'scheduled event tool plan');
    if (normalizedTagName(root) !== 'toolplan') {
        throw new Error('Scheduled event tool plan must use <toolPlan> as its document root.');
    }
    rejectUnexpectedDirectChildren(
        root,
        ['directUpdates', 'otherTools'],
        'Scheduled event tool plan'
    );
    const directUpdatesNode = requireSingleDirectChild(
        root,
        'directUpdates',
        'Scheduled event tool plan',
        { allowEmpty: true }
    ).node;
    rejectUnexpectedDirectChildren(
        directUpdatesNode,
        ['update'],
        'Scheduled event tool plan <directUpdates>'
    );
    const directUpdates = [];
    const directUpdateKeys = new Set();
    for (const [index, updateNode] of directChildrenByTagName(directUpdatesNode, 'update').entries()) {
        const label = `Scheduled event direct update ${index + 1}`;
        rejectUnexpectedDirectChildren(
            updateNode,
            ['objectType', 'object', 'field', 'valueJson'],
            label
        );
        const objectType = requireSingleDirectChild(updateNode, 'objectType', label).text;
        if (!UPDATE_OBJECT_TYPE_VALUES.includes(objectType)) {
            throw new Error(`${label} contains unsupported object type "${objectType}".`);
        }
        const object = requireSingleDirectChild(
            updateNode,
            'object',
            label
        ).text;
        const field = requireSingleDirectChild(updateNode, 'field', label).text;
        const allowedFields = UPDATE_OBJECT_FIELD_NAMES_BY_TYPE[objectType] || [];
        if (!allowedFields.includes(field)) {
            throw new Error(`${label} contains unsupported ${objectType} field "${field}".`);
        }
        const valueJson = requireSingleDirectChild(updateNode, 'valueJson', label).text;
        let value;
        try {
            value = JSON.parse(valueJson);
        } catch (error) {
            throw new Error(`${label} <valueJson> must contain valid JSON: ${error.message}`);
        }
        const key = JSON.stringify([
            objectType,
            normalizeScheduledEventContractText(object),
            field
        ]);
        if (directUpdateKeys.has(key)) {
            const existing = directUpdates.find(update => JSON.stringify([
                update.objectType,
                normalizeScheduledEventContractText(update.object),
                update.field
            ]) === key);
            if (existing && isDeepStrictEqual(existing.value, value)) {
                continue;
            }
            throw new Error(`${label} conflicts with an earlier direct update for the same field.`);
        }
        directUpdateKeys.add(key);
        directUpdates.push({
            objectType,
            object,
            field,
            value
        });
    }

    const otherToolsNode = requireSingleDirectChild(
        root,
        'otherTools',
        'Scheduled event tool plan',
        { allowEmpty: true }
    ).node;
    rejectUnexpectedDirectChildren(otherToolsNode, ['tool'], 'Scheduled event tool plan <otherTools>');
    const availableToolNameSet = new Set(availableToolNames.map(name => name.trim()));
    const otherTools = [];
    const otherToolKeys = new Set();
    for (const [index, toolNode] of directChildrenByTagName(otherToolsNode, 'tool').entries()) {
        const label = `Scheduled event planned tool ${index + 1}`;
        rejectUnexpectedDirectChildren(toolNode, ['name', 'argumentsJson'], label);
        const name = requireSingleDirectChild(toolNode, 'name', label).text;
        if (name === 'updateObjectFields') {
            throw new Error('Scheduled event updateObjectFields calls must be represented in <directUpdates>.');
        }
        if (!availableToolNameSet.has(name)) {
            throw new Error(`${label} names unavailable tool "${name}".`);
        }
        const argumentsJson = requireSingleDirectChild(toolNode, 'argumentsJson', label).text;
        const argumentsObject = parseJsonObjectText(argumentsJson, `${label} <argumentsJson>`);
        validateScheduledEventPlannedToolArguments(name, argumentsObject, label);
        const key = JSON.stringify([name, argumentsObject]);
        if (otherToolKeys.has(key)) {
            continue;
        }
        otherToolKeys.add(key);
        otherTools.push({ name, argumentsObject });
    }

    const mutatingOtherTools = otherTools.filter(tool => (
        !NON_MUTATING_SCHEDULED_EVENT_TOOL_NAMES.has(tool.name)
    ));
    const stateChangeRequired = directUpdates.length > 0 || mutatingOtherTools.length > 0;
    return {
        value: {
            event: authoritativeEvent,
            stateChangeRequired,
            directUpdates,
            otherTools
        },
        normalizedResponse: xml
    };
}

function requireScheduledEventToolPlan(toolPlan, authoritativeEvent) {
    if (!toolPlan || typeof toolPlan !== 'object' || Array.isArray(toolPlan)) {
        throw new Error('Scheduled event tool execution requires its parsed tool plan.');
    }
    if (toolPlan.event !== authoritativeEvent) {
        throw new Error('Scheduled event tool execution plan does not match the authoritative event.');
    }
    if (typeof toolPlan.stateChangeRequired !== 'boolean') {
        throw new Error('Scheduled event tool execution plan is missing stateChangeRequired.');
    }
    if (!Array.isArray(toolPlan.directUpdates) || !Array.isArray(toolPlan.otherTools)) {
        throw new Error('Scheduled event tool execution plan has malformed planned calls.');
    }
    return toolPlan;
}

function scheduledEventObjectReferenceMatches(value, plannedUpdate) {
    const normalized = normalizeScheduledEventContractText(value);
    return Boolean(normalized)
        && normalizeScheduledEventContractText(plannedUpdate.object) === normalized;
}

function validateScheduledEventToolCallAgainstPlan(toolCall, toolPlan) {
    const authoritativeEvent = typeof toolPlan?.event === 'string' ? toolPlan.event : '';
    const plan = requireScheduledEventToolPlan(toolPlan, authoritativeEvent);
    const name = typeof toolCall?.name === 'string'
        ? toolCall.name.trim()
        : (typeof toolCall?.functionName === 'string' ? toolCall.functionName.trim() : '');
    const argumentsObject = toolCall?.argumentsObject;
    if (!name || !argumentsObject || typeof argumentsObject !== 'object' || Array.isArray(argumentsObject)) {
        throw new Error('Scheduled event tool call validation requires a named call with structured arguments.');
    }
    if (!plan.stateChangeRequired && name === 'updateObjectFields') {
        throw new Error('The accepted scheduled event tool plan requires no state-changing tool calls.');
    }

    if (name === 'updateObjectFields') {
        const objectType = typeof argumentsObject.objectType === 'string'
            ? argumentsObject.objectType.trim()
            : '';
        const object = typeof argumentsObject.object === 'string'
            ? argumentsObject.object.trim()
            : '';
        const fields = argumentsObject.fields;
        if (!objectType || !object || !fields || typeof fields !== 'object' || Array.isArray(fields)) {
            throw new Error('Scheduled event updateObjectFields call must provide objectType, object, and fields.');
        }
        const entries = Object.entries(fields);
        if (!entries.length) {
            throw new Error('Scheduled event updateObjectFields call must include at least one planned field.');
        }
        for (const [field, value] of entries) {
            const matchingUpdate = plan.directUpdates.find(update => (
                update.objectType === objectType
                && scheduledEventObjectReferenceMatches(object, update)
                && update.field === field
                && isDeepStrictEqual(update.value, value)
            ));
            if (!matchingUpdate) {
                throw new Error(
                    `Scheduled event updateObjectFields field "${field}" is not an exact match for the accepted `
                    + 'tool plan. Use only the planned target, field, and value.'
                );
            }
        }
        return true;
    }

    const matchingTool = plan.otherTools.find(tool => (
        tool.name === name && isDeepStrictEqual(tool.argumentsObject, argumentsObject)
    ));
    if (!matchingTool) {
        throw new Error(
            `Scheduled event tool call "${name}" is not an exact match for the accepted tool plan.`
        );
    }
    if (!plan.stateChangeRequired && !NON_MUTATING_SCHEDULED_EVENT_TOOL_NAMES.has(name)) {
        throw new Error('The accepted scheduled event tool plan requires no state-changing tool calls.');
    }
    return true;
}

function parseScheduledEventToolExecution(response, scheduledEventText, toolPlan, parseContext = {}) {
    const normalizedResponse = requireResponseText(response, 'scheduled event tool execution');
    const authoritativeEvent = typeof scheduledEventText === 'string'
        ? scheduledEventText.trim()
        : '';
    if (!authoritativeEvent) {
        throw new Error('Scheduled event tool execution requires the authoritative event text.');
    }
    const plan = requireScheduledEventToolPlan(toolPlan, authoritativeEvent);

    const invocations = Array.isArray(parseContext.currentToolInvocations)
        ? parseContext.currentToolInvocations
        : [];
    const plannedCallCount = plan.directUpdates.length + plan.otherTools.length;
    if (plannedCallCount > 0 && !invocations.length) {
        throw new Error(
            'Scheduled event tool execution requires at least one successful planned tool call before completion.'
        );
    }
    for (const invocation of invocations) {
        validateScheduledEventToolCallAgainstPlan(invocation, plan);
    }

    for (const update of plan.directUpdates) {
        const completed = invocations.some(invocation => {
            if (invocation?.name !== 'updateObjectFields' || invocation?.metadata?.error === true) {
                return false;
            }
            const metadata = invocation.metadata || {};
            const updatedValues = metadata.updatedValues || invocation.argumentsObject?.fields;
            return metadata.objectType === update.objectType
                && (
                    scheduledEventObjectReferenceMatches(metadata.objectId, update)
                    || scheduledEventObjectReferenceMatches(metadata.objectName, update)
                )
                && updatedValues
                && Object.hasOwn(updatedValues, update.field)
                && isDeepStrictEqual(updatedValues[update.field], update.value);
        });
        if (!completed) {
            throw new Error(
                `Scheduled event direct update for ${update.objectType} "${update.object}" `
                + `field "${update.field}" has not completed with the exact planned value. Make that planned call now.`
            );
        }
    }
    for (const plannedTool of plan.otherTools) {
        const completed = invocations.some(invocation => (
            invocation?.name === plannedTool.name
            && invocation?.metadata?.error !== true
            && isDeepStrictEqual(invocation.argumentsObject, plannedTool.argumentsObject)
        ));
        if (!completed) {
            throw new Error(
                `Scheduled event planned tool "${plannedTool.name}" has not completed with its exact planned arguments.`
            );
        }
    }

    return { value: normalizedResponse };
}

function parseScheduledEventSummary(response) {
    const { root } = parseStrictXml(response, 'scheduled event summary');
    if (normalizedTagName(root) !== 'summary') {
        throw new Error('Scheduled event summary must use <summary> as its document root.');
    }
    if (directChildElements(root).length) {
        throw new Error('Scheduled event <summary> must contain text only.');
    }
    const summary = String(root.textContent || '').trim();
    if (!summary) {
        throw new Error('Scheduled event <summary> must not be empty.');
    }
    const nullSentinel = summary.toLowerCase();
    if (new Set(['n/a', 'n.a.', 'n-a', 'na', 'none', 'not applicable', 'nothing']).has(nullSentinel)) {
        throw new Error('Scheduled event <summary> must describe what happened; a null sentinel is not a summary.');
    }
    return { value: summary };
}

function parseScheduledEventStagedResult(response, {
    happened,
    expectedSummary = '',
    playerPresent = false
} = {}) {
    const parsed = parseScheduledEventNarrativeResult(response);
    const { root } = parseStrictXml(response, 'staged scheduled event result');
    if (!happened) {
        if (directChildElements(root).length || String(root.textContent || '').trim()) {
            throw new Error('Skipped staged scheduled event must return an empty <scheduledEventResult/>.');
        }
        return parsed;
    }
    const summary = requireSingleDirectChild(root, 'summary', 'Staged scheduled event result').text;
    if (summary !== String(expectedSummary || '').trim()) {
        throw new Error('Final scheduled event summary must exactly match the approved summary checkpoint.');
    }
    const playerProseNodes = directChildrenByTagName(root, 'proseForPlayer');
    if (playerPresent && (playerProseNodes.length !== 1 || !String(playerProseNodes[0].textContent || '').trim())) {
        throw new Error('Staged scheduled event in the player location requires non-empty <proseForPlayer>.');
    }
    if (!playerPresent && playerProseNodes.length) {
        throw new Error('Offscreen staged scheduled event must not include <proseForPlayer>.');
    }
    return parsed;
}

function canonicalizeInterruptionResult(root) {
    const proseTags = new Set(['prose', 'originprose', 'betweenprose', 'destinationprose']);
    const visit = node => {
        const tag = normalizedTagName(node);
        if (proseTags.has(tag)) {
            return { tag, playerFacingProse: true };
        }
        const attributes = Array.from(node?.attributes || [])
            .map(attribute => [String(attribute.name), String(attribute.value)])
            .sort((left, right) => left[0].localeCompare(right[0]));
        const children = Array.from(node?.childNodes || []).flatMap(child => {
            if (child?.nodeType === 1) {
                return [visit(child)];
            }
            if (child?.nodeType === 3 || child?.nodeType === 4) {
                const text = String(child.nodeValue || '').replace(/\s+/g, ' ').trim();
                return text ? [{ text }] : [];
            }
            return [];
        });
        return { tag, attributes, children };
    };
    return visit(root);
}

function parseScheduledEventInterruptionRewrite(response, originalXml) {
    const finalParsed = parseStrictXml(response, 'scheduled-event interruption rewrite');
    const originalParsed = parseStrictXml(originalXml, 'original scheduled-event interruption XML');
    const finalRootName = normalizedTagName(finalParsed.root);
    const originalRootName = normalizedTagName(originalParsed.root);
    if (!['turnresult', 'moveturnresult'].includes(originalRootName)) {
        throw new Error('Original scheduled-event interruption XML must use <turnResult> or <moveTurnResult>.');
    }
    if (finalRootName !== originalRootName) {
        throw new Error('Scheduled-event interruption rewrite changed the original XML root.');
    }
    if (
        JSON.stringify(canonicalizeInterruptionResult(finalParsed.root))
        !== JSON.stringify(canonicalizeInterruptionResult(originalParsed.root))
    ) {
        throw new Error('Scheduled-event interruption rewrite changed a non-prose XML field.');
    }
    parseTurnNarrativeResult(response, { allowTravel: true });
    return {
        value: finalParsed.xml,
        normalizedResponse: finalParsed.xml
    };
}

module.exports = {
    isNonMutatingScheduledEventToolName,
    parseAllowedCharacterSelection,
    parseContainerOpenNarrativeResult,
    parseCraftNarrativeResult,
    parseExactXmlRoot,
    parseGameIntroResult,
    parseLocationModificationNarrativeResult,
    parseNeedBarCharactersResult,
    parseNarrativeScope,
    parseOutcomeAcknowledgement,
    parsePlayerActionDestination,
    parsePlayerActionVehicleDestination,
    parsePlayerActionDestinationChanges,
    parsePlayerActionExplicitDuration,
    parsePlayerActionDuration,
    parsePlayerActionAccompanyingCharacters,
    parsePlayerActionHiddenContests,
    parsePlayerActionHiddenNotes,
    parsePlayerActionDestinationNameOrNa,
    parsePlayerActionMovement,
    parsePlayerActionOptionalProse,
    parsePlayerActionProseScope,
    parsePlayerActionRequiredProse,
    parsePlayerActionTimeReasoning,
    parsePlayerActionVehicleDecision,
    parseQuestRewardResult,
    parseRevisionDecision,
    parseScheduledEventApplicability,
    parseScheduledEventNarrativeResult,
    parseScheduledEventToolPlan,
    parseScheduledEventToolExecution,
    validateScheduledEventToolCallAgainstPlan,
    parseScheduledEventSummary,
    parseSceneSummaryBoundaries,
    parseSceneSummaryEntry,
    parseScheduledEventInterruptionRewrite,
    parseScheduledEventStagedResult,
    parseTurnNarrativeResult,
    parseWhileAwayArrivalUpdates,
    parseWhileAwayCharacterUpdate,
    parseWhileYouWereAwayResult,
    parseWhileYouWereAwayStagedResult
};
