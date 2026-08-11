const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

function readApiSource() {
    return fs.readFileSync(require.resolve('../api.js'), 'utf8');
}

function sliceApiSource(startNeedle, endNeedle) {
    const source = readApiSource();
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate source marker: ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate source marker: ${endNeedle}`);
    return source.slice(start, end);
}

test('moveTurnResult timed vehicle trips leave prompt-authored event-check time advancement intact', () => {
    const source = sliceApiSource(
        'async function runmoveTurnResultEventChecks',
        '\n        function recordSkillCheckEntry'
    );

    assert.match(
        source,
        /let vehicleStartedTimedTrip = false;/,
        'runmoveTurnResultEventChecks should track timed vehicle trip starts'
    );
    assert.match(
        source,
        /if \(vehicleMoveResult\?\.startedTrip\) \{\s+vehicleStartedTimedTrip = true;\s+vehicleStateChanged = true;\s+\}/,
        'started vehicle trips should be treated as vehicle state changes'
    );
    assert.match(
        source,
        /suppressTimeAdvance: Boolean\(suppressTimeAdvance\),/,
        'combined travel-prose event checks should not add extra time suppression after starting a timed vehicle trip'
    );
    assert.doesNotMatch(
        source,
        /suppressTimePassedAtOrAboveMinutes/,
        'combined travel-prose event checks should let the LLM decide whether full trip time elapsed'
    );
});

test('moveTurnResult destinationless zero-minute vehicle updates cancel an underway trip', () => {
    const apiSource = readApiSource();
    const source = sliceApiSource(
        'async function runmoveTurnResultEventChecks',
        '\n        function recordSkillCheckEntry'
    );

    assert.match(
        apiSource,
        /const stopVehicleFormoveTurnResult = \(vehicleName\) => \{[\s\S]*?if \(!normalizedVehicleInfo\.isUnderway\)[\s\S]*?pendingDestination: null,[\s\S]*?ETA: null,[\s\S]*?departureTime: null/,
        'destinationless stops should require an underway vehicle and cancel its pending timed trip'
    );
    assert.match(
        source,
        /if \(travelVehicleName && !effectiveVehicleDestinationText\) \{[\s\S]*?vehicleTravelTimeMinutes !== 0[\s\S]*?stopVehicleFormoveTurnResult\(travelVehicleName\);[\s\S]*?vehicleStateChanged = true;/,
        'a vehicle name without a destination should be accepted only as a zero-minute stop and request a state refresh'
    );
});

test('redirecting an underway vehicle back to its tracked departure exit starts a new timed trip', () => {
    const apiSource = readApiSource();
    const source = sliceApiSource(
        'async function runmoveTurnResultEventChecks',
        '\n        function recordSkillCheckEntry'
    );

    assert.match(
        apiSource,
        /const shouldStartTimedTrip = Boolean\([\s\S]*?travelTimeMinutes > 0[\s\S]*?currentOutsideLocationId[\s\S]*?normalizedVehicleInfo\.isUnderway[\s\S]*?currentOutsideLocationId !== destinationId/,
        'an underway vehicle should start timed travel even when redirecting to the location still referenced by its hidden outside exit'
    );
    assert.match(
        source,
        /let vehicleWasUnderway = false;[\s\S]*?vehicleWasUnderway = normalizedVehicleInfo\.isUnderway;[\s\S]*?const vehicleWillStartTimedTrip = Boolean\([\s\S]*?vehicleWasUnderway[\s\S]*?vehicleCurrentOutsideLocationId !== resolvedVehicleDestinationId/,
        'projected vehicle movement should use the same underway redirect rule as the authoritative mutation'
    );
});

test('off-route vehicle redirects remain fatal if they reach the mutation boundary', () => {
    const {
        createPlayerActionInvalidVehicleRouteError,
        shouldPropagatePlayerActionEventCheckError
    } = require('../api.js');
    const routeError = createPlayerActionInvalidVehicleRouteError(
        'Vehicle "QA Clockwork Tram" cannot travel to "Ember Hollow Village Square" because that destination is not in its allowed route.'
    );

    assert.equal(routeError.code, 'PLAYER_ACTION_INVALID_VEHICLE_ROUTE');
    assert.equal(shouldPropagatePlayerActionEventCheckError(routeError), true);
    assert.equal(shouldPropagatePlayerActionEventCheckError(new Error('ordinary optional event-check failure')), false);

    const apiSource = readApiSource();
    assert.match(
        apiSource,
        /throw createPlayerActionInvalidVehicleRouteError\([\s\S]*?not in its allowed route/,
        'the vehicle mutation boundary should tag off-route redirects explicitly'
    );
    assert.match(
        apiSource,
        /catch \(eventError\) \{\s+if \(shouldPropagatePlayerActionEventCheckError\(eventError\)\) \{\s+throw eventError;/,
        'the player-action event-check wrapper must not turn an invalid route into a successful HTTP response'
    );
});

test('moveTurnResult vehicle state changes and due arrivals request a final client location refresh', () => {
    const travelSource = sliceApiSource(
        'async function runmoveTurnResultEventChecks',
        '\n        function recordSkillCheckEntry'
    );
    const playerActionSource = sliceApiSource(
        'const suppressDirectTravelPromptMutation = Boolean(currentActionIsTravel',
        'questResult = await Events.runQuestChecks();'
    );
    const respondSource = sliceApiSource(
        'const respond = async (payload, statusCode = 200) => {',
        '\n                try {'
    );

    assert.match(
        travelSource,
        /vehicleStateChanged: false/,
        'runmoveTurnResultEventChecks should include vehicleStateChanged in empty results'
    );
    assert.match(
        travelSource,
        /vehicleStateChanged,\s+timeAdjustment: playerMoveTimeAdjustment,\s+location,/,
        'runmoveTurnResultEventChecks should return vehicleStateChanged with travel results'
    );
    assert.match(
        playerActionSource,
        /if \(travelResult\.vehicleStateChanged\) \{\s+responseData\.locationRefreshRequested = true;\s+\}/,
        'player-action travel-prose handling should request a final refresh after vehicle state changes'
    );
    assert.match(
        respondSource,
        /const dueVehicleArrivals = await processDueVehicleArrivals\(\);/,
        'respond should capture due vehicle arrivals instead of discarding them'
    );
    assert.match(
        respondSource,
        /payload\.locationRefreshRequested = true;/,
        'respond should request a client refresh when relevant vehicle arrivals finalize'
    );
});

test('moveTurnResult event checks on active vehicles process all prose at the onboard location', () => {
    const source = sliceApiSource(
        'async function runmoveTurnResultEventChecks',
        '\n        function recordSkillCheckEntry'
    );

    assert.match(
        source,
        /const moveTurnResultEventLocationRepresentsVehicle = Boolean\(\s+resolveActiveVehicleLabelForLocation\(location\)\s+\);/,
        'runmoveTurnResultEventChecks should detect location and region vehicle contexts'
    );
    assert.match(
        source,
        /const hasEffectivePlayerDestination = Boolean\(effectivePlayerDestinationText\);/,
        'runTravelProseEventChecks should separate player-destination movement from event-check splitting'
    );
    assert.match(
        source,
        /const shouldSplitEventChecks = hasEffectivePlayerDestination && !moveTurnResultEventLocationRepresentsVehicle;/,
        'active vehicle travel prose should not split event checks across origin/destination'
    );
    assert.match(
        source,
        /if \(hasEffectivePlayerDestination\) \{/,
        'active vehicle travel prose should still preserve existing player-destination movement handling'
    );
    assert.match(
        source,
        /locationOverride: moveTurnResultEventLocationRepresentsVehicle\s+\? moveTurnResultEventLocation\s+: location \|\| null/,
        'combined active-vehicle event checks should run at the original onboard location'
    );
});
