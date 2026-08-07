const Utils = require('./Utils.js');
const {
    normalizePlayerActionAccompanyingCharacterSelection
} = require('./PlayerActionCompanions.js');

const PLAYER_ACTION_MOVEMENT = Object.freeze({
    NONE: 'none',
    DESTINATION: 'destination',
    INSIDE_VEHICLE: 'inside_vehicle',
    DISEMBARK: 'disembark'
});

const PLAYER_ACTION_VEHICLE_DECISION = Object.freeze({
    UNCHANGED: 'unchanged',
    DEPART: 'depart',
    STOP: 'stop',
    REDIRECT: 'redirect',
    STOP_FOR_EXIT: 'stop_for_exit'
});

const PLAYER_ACTION_PROSE_SCOPE = Object.freeze({
    ORIGIN: 'origin',
    BETWEEN: 'between',
    DESTINATION: 'destination'
});

function requirePlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object.`);
    }
    return value;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string.`);
    }
    return value.trim();
}

function optionalTrimmedString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function escapeXmlText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function wrapCdata(value) {
    return `<![CDATA[${String(value ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function normalizeDuration(value, label, { minimumMinutes = 0 } = {}) {
    requirePlainObject(value, label);
    const text = requireNonEmptyString(value.text, `${label} text`);
    const minutes = Number(value.minutes);
    if (!Number.isInteger(minutes) || minutes < minimumMinutes) {
        throw new Error(`${label} minutes must be an integer of at least ${minimumMinutes}.`);
    }
    const parsedMinutes = Utils.parseDurationToMinutes(text, { fieldName: label });
    if (parsedMinutes !== minutes) {
        throw new Error(`${label} text and parsed minutes disagree.`);
    }
    return { text, minutes };
}

function normalizeDestination(value, label) {
    requirePlainObject(value, label);
    const location = optionalTrimmedString(value.location);
    const region = optionalTrimmedString(value.region);
    if (!location && !region) {
        throw new Error(`${label} requires a location or region.`);
    }
    return { location, region };
}

function renderDestination(tagName, destination, duration = null) {
    const lines = [`  <${tagName}>`];
    if (destination.location) {
        lines.push(`    <location>${escapeXmlText(destination.location)}</location>`);
    }
    if (destination.region) {
        lines.push(`    <region>${escapeXmlText(destination.region)}</region>`);
    }
    if (duration) {
        lines.push(`    <travelTime>${escapeXmlText(duration.text)}</travelTime>`);
    }
    lines.push(`  </${tagName}>`);
    return lines;
}

function normalizeAuthoritativeDestination(value) {
    if (value === null || value === undefined) {
        return null;
    }
    requirePlainObject(value, 'Authoritative player travel destination');
    const destination = normalizeDestination(value, 'Authoritative player travel destination');
    const rawMinutes = value.travelTimeMinutes;
    if (rawMinutes === null || rawMinutes === undefined) {
        return { destination, duration: null };
    }
    const minutes = Number(rawMinutes);
    if (!Number.isInteger(minutes) || minutes < 0) {
        throw new Error('Authoritative player travel time must be a non-negative integer when provided.');
    }
    return {
        destination,
        duration: minutes > 0 ? { text: `${minutes} minutes`, minutes } : null
    };
}

function validateMovementAndVehicle({ movement, vehicleDecision, currentVehicle }) {
    const movementValues = new Set(Object.values(PLAYER_ACTION_MOVEMENT));
    const vehicleValues = new Set(Object.values(PLAYER_ACTION_VEHICLE_DECISION));
    if (!movementValues.has(movement)) {
        throw new Error(`Unknown player-action movement value "${movement}".`);
    }
    if (!vehicleValues.has(vehicleDecision)) {
        throw new Error(`Unknown player-action vehicle decision "${vehicleDecision}".`);
    }

    if (!currentVehicle) {
        if (![PLAYER_ACTION_MOVEMENT.NONE, PLAYER_ACTION_MOVEMENT.DESTINATION].includes(movement)) {
            throw new Error(`Player-action movement "${movement}" requires a current vehicle.`);
        }
        if (vehicleDecision !== PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED) {
            throw new Error('A vehicle decision other than unchanged requires a current vehicle.');
        }
        return;
    }

    if (movement === PLAYER_ACTION_MOVEMENT.DESTINATION) {
        throw new Error('A player leaving a current vehicle must use disembark movement.');
    }
    if (
        movement === PLAYER_ACTION_MOVEMENT.INSIDE_VEHICLE
        && vehicleDecision !== PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED
    ) {
        throw new Error('Moving inside a vehicle cannot change vehicle state.');
    }
    if (
        movement === PLAYER_ACTION_MOVEMENT.DISEMBARK
        && ![
            PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED,
            PLAYER_ACTION_VEHICLE_DECISION.STOP_FOR_EXIT
        ].includes(vehicleDecision)
    ) {
        throw new Error('Disembarking permits only unchanged or stop_for_exit vehicle decisions.');
    }
    if (
        movement === PLAYER_ACTION_MOVEMENT.NONE
        && vehicleDecision === PLAYER_ACTION_VEHICLE_DECISION.STOP_FOR_EXIT
    ) {
        throw new Error('stop_for_exit requires disembark movement.');
    }

    const isUnderway = currentVehicle?.vehicleInfo?.isUnderway === true
        || currentVehicle?.isUnderway === true;
    if (vehicleDecision === PLAYER_ACTION_VEHICLE_DECISION.DEPART && isUnderway) {
        throw new Error('An underway vehicle cannot depart again.');
    }
    if (
        [PLAYER_ACTION_VEHICLE_DECISION.STOP, PLAYER_ACTION_VEHICLE_DECISION.REDIRECT].includes(vehicleDecision)
        && !isUnderway
    ) {
        throw new Error(`${vehicleDecision} requires an underway vehicle.`);
    }
    if (vehicleDecision === PLAYER_ACTION_VEHICLE_DECISION.STOP_FOR_EXIT && !isUnderway) {
        throw new Error('stop_for_exit requires an underway vehicle.');
    }
}

function resolvePlayerActionMovement({ assignments, templateContext, currentVehicle, authoritativeDestination }) {
    const authoritativeMovement = templateContext.playerActionTravelMovementKind;
    if (authoritativeDestination) {
        const expectedMovement = currentVehicle
            ? PLAYER_ACTION_MOVEMENT.DISEMBARK
            : PLAYER_ACTION_MOVEMENT.DESTINATION;
        if (authoritativeMovement !== expectedMovement) {
            throw new Error(
                `Authoritative player-action travel movement must be "${expectedMovement}"; received "${authoritativeMovement}".`
            );
        }
        if (
            assignments.movementKind !== undefined
            && assignments.movementKind !== authoritativeMovement
        ) {
            throw new Error(
                `Parsed player-action movement "${assignments.movementKind}" conflicts with authoritative movement "${authoritativeMovement}".`
            );
        }
        return authoritativeMovement;
    }
    if (authoritativeMovement !== null && authoritativeMovement !== undefined) {
        throw new Error('Authoritative player-action movement requires an authoritative travel destination.');
    }
    return assignments.movementKind;
}

function buildNormalTurnResult(assignments) {
    const prose = requireNonEmptyString(assignments.normalProse, 'Normal-turn prose');
    const reasoning = requireNonEmptyString(assignments.timeReasoning, 'Normal-turn time reasoning');
    const duration = normalizeDuration(assignments.timeDuration, 'Normal-turn duration', {
        minimumMinutes: 1
    });
    const hiddenNotes = optionalTrimmedString(assignments.hiddenNotes);
    const lines = [
        '<turnResult>',
        `  <prose>${wrapCdata(prose)}</prose>`
    ];
    if (hiddenNotes) {
        lines.push(`  <hidden>${wrapCdata(hiddenNotes)}</hidden>`);
    }
    lines.push(
        '  <timePassed>',
        `    <reasoning>${escapeXmlText(reasoning)}</reasoning>`,
        `    <duration>${escapeXmlText(duration.text)}</duration>`,
        '  </timePassed>',
        '</turnResult>'
    );
    return lines.join('\n');
}

function buildMoveTurnResult({
    assignments,
    currentVehicle,
    movement,
    vehicleDecision,
    authoritativePlayerDestination,
    allowedAccompanyingCharacters
}) {
    if (!Array.isArray(assignments.proseScopes) || !assignments.proseScopes.length) {
        throw new Error('Move-turn result requires at least one prose scope.');
    }
    const allowedScopes = new Set(Object.values(PLAYER_ACTION_PROSE_SCOPE));
    const seenScopes = new Set();
    for (const scope of assignments.proseScopes) {
        if (!allowedScopes.has(scope) || seenScopes.has(scope)) {
            throw new Error(`Move-turn prose scope "${scope}" is invalid or duplicated.`);
        }
        seenScopes.add(scope);
    }

    const proseByScope = {
        [PLAYER_ACTION_PROSE_SCOPE.ORIGIN]: assignments.originProse,
        [PLAYER_ACTION_PROSE_SCOPE.BETWEEN]: assignments.betweenProse,
        [PLAYER_ACTION_PROSE_SCOPE.DESTINATION]: assignments.destinationProse
    };
    for (const scope of seenScopes) {
        requireNonEmptyString(proseByScope[scope], `Move-turn ${scope} prose`);
    }

    const playerMoves = movement !== PLAYER_ACTION_MOVEMENT.NONE;
    let playerDestination = null;
    let playerDuration = null;
    if (playerMoves) {
        if (authoritativePlayerDestination) {
            playerDestination = authoritativePlayerDestination.destination;
            playerDuration = authoritativePlayerDestination.duration;
        } else {
            playerDestination = normalizeDestination(assignments.playerDestination, 'Player destination');
            playerDuration = normalizeDuration(assignments.playerTravelDuration, 'Player travel duration', {
                minimumMinutes: 1
            });
        }
    }
    const accompanyingCharacters = playerMoves
        ? normalizePlayerActionAccompanyingCharacterSelection(
            assignments.accompanyingCharacters,
            allowedAccompanyingCharacters
        )
        : [];

    const emitsVehicleInfo = movement === PLAYER_ACTION_MOVEMENT.NONE
        && [
            PLAYER_ACTION_VEHICLE_DECISION.DEPART,
            PLAYER_ACTION_VEHICLE_DECISION.STOP,
            PLAYER_ACTION_VEHICLE_DECISION.REDIRECT
        ].includes(vehicleDecision);
    let vehicleName = null;
    let vehicleDestination = null;
    let vehicleDuration = null;
    if (emitsVehicleInfo) {
        vehicleName = requireNonEmptyString(currentVehicle?.name, 'Current vehicle name');
        if (vehicleDecision === PLAYER_ACTION_VEHICLE_DECISION.STOP) {
            vehicleDuration = { text: '0 minutes', minutes: 0 };
        } else {
            vehicleDestination = normalizeDestination(assignments.vehicleDestination, 'Vehicle destination');
            vehicleDuration = normalizeDuration(assignments.vehicleTravelDuration, 'Vehicle travel duration', {
                minimumMinutes: 1
            });
        }
    }

    const lines = ['<moveTurnResult>'];
    if (emitsVehicleInfo) {
        lines.push('  <vehicleInfo>');
        lines.push(`    <name>${escapeXmlText(vehicleName)}</name>`);
        lines.push(`    <travelTime>${escapeXmlText(vehicleDuration.text)}</travelTime>`);
        if (vehicleDestination) {
            lines.push(...renderDestination('vehicleDestination', vehicleDestination).map(line => `  ${line}`));
        }
        lines.push('  </vehicleInfo>');
    }
    if (playerDestination) {
        lines.push(...renderDestination('playerDestination', playerDestination, playerDuration));
        lines.push('  <accompanyingCharacters>');
        for (const characterName of accompanyingCharacters) {
            lines.push(`    <name>${escapeXmlText(characterName)}</name>`);
        }
        lines.push('  </accompanyingCharacters>');
    }
    for (const [scope, tagName] of [
        [PLAYER_ACTION_PROSE_SCOPE.ORIGIN, 'originProse'],
        [PLAYER_ACTION_PROSE_SCOPE.BETWEEN, 'betweenProse'],
        [PLAYER_ACTION_PROSE_SCOPE.DESTINATION, 'destinationProse']
    ]) {
        if (seenScopes.has(scope)) {
            lines.push(`  <${tagName}>${wrapCdata(requireNonEmptyString(proseByScope[scope], `${scope} prose`))}</${tagName}>`);
        }
    }
    const hiddenNotes = optionalTrimmedString(assignments.hiddenNotes);
    if (hiddenNotes) {
        lines.push(`  <hidden>${wrapCdata(hiddenNotes)}</hidden>`);
    }
    lines.push('</moveTurnResult>');
    return lines.join('\n');
}

function buildPlayerActionTinyBrainResult({ assignments, templateContext } = {}) {
    requirePlainObject(assignments, 'Player-action TinyBrain assignments');
    requirePlainObject(templateContext, 'Player-action TinyBrain template context');
    const currentVehicle = templateContext.currentVehicle
        && typeof templateContext.currentVehicle === 'object'
        && !Array.isArray(templateContext.currentVehicle)
        ? templateContext.currentVehicle
        : null;
    const authoritativePlayerDestination = normalizeAuthoritativeDestination(
        templateContext.playerActionTravelDestination
    );
    const movement = resolvePlayerActionMovement({
        assignments,
        templateContext,
        currentVehicle,
        authoritativeDestination: authoritativePlayerDestination
    });
    const vehicleDecision = currentVehicle
        ? assignments.vehicleDecision
        : PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED;
    validateMovementAndVehicle({ movement, vehicleDecision, currentVehicle });

    const isMoveTurn = movement !== PLAYER_ACTION_MOVEMENT.NONE
        || vehicleDecision !== PLAYER_ACTION_VEHICLE_DECISION.UNCHANGED;
    if (!isMoveTurn) {
        return buildNormalTurnResult(assignments);
    }
    return buildMoveTurnResult({
        assignments,
        currentVehicle,
        movement,
        vehicleDecision,
        authoritativePlayerDestination,
        allowedAccompanyingCharacters: templateContext.playerActionAccompanyingCharacters || []
    });
}

module.exports = {
    PLAYER_ACTION_MOVEMENT,
    PLAYER_ACTION_PROSE_SCOPE,
    PLAYER_ACTION_VEHICLE_DECISION,
    buildPlayerActionTinyBrainResult,
    escapeXmlText,
    wrapCdata
};
