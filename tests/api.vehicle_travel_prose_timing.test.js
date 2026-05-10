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

test('travelProse timed vehicle trips leave prompt-authored event-check time advancement intact', () => {
    const source = sliceApiSource(
        'async function runTravelProseEventChecks',
        '\n        function recordSkillCheckEntry'
    );

    assert.match(
        source,
        /let vehicleStartedTimedTrip = false;/,
        'runTravelProseEventChecks should track timed vehicle trip starts'
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

test('travelProse vehicle state changes and due arrivals request a final client location refresh', () => {
    const travelSource = sliceApiSource(
        'async function runTravelProseEventChecks',
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
        'runTravelProseEventChecks should include vehicleStateChanged in empty results'
    );
    assert.match(
        travelSource,
        /vehicleStateChanged,\s+location,/,
        'runTravelProseEventChecks should return vehicleStateChanged with travel results'
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

test('travelProse event checks on active vehicles process all prose at the onboard location', () => {
    const source = sliceApiSource(
        'async function runTravelProseEventChecks',
        '\n        function recordSkillCheckEntry'
    );

    assert.match(
        source,
        /const travelProseEventLocationRepresentsVehicle = Boolean\(\s+resolveActiveVehicleLabelForLocation\(location\)\s+\);/,
        'runTravelProseEventChecks should detect location and region vehicle contexts'
    );
    assert.match(
        source,
        /const hasEffectivePlayerDestination = Boolean\(effectivePlayerDestinationText\);/,
        'runTravelProseEventChecks should separate player-destination movement from event-check splitting'
    );
    assert.match(
        source,
        /const shouldSplitEventChecks = hasEffectivePlayerDestination && !travelProseEventLocationRepresentsVehicle;/,
        'active vehicle travel prose should not split event checks across origin/destination'
    );
    assert.match(
        source,
        /if \(hasEffectivePlayerDestination\) \{/,
        'active vehicle travel prose should still preserve existing player-destination movement handling'
    );
    assert.match(
        source,
        /locationOverride: travelProseEventLocationRepresentsVehicle\s+\? travelProseEventLocation\s+: location \|\| null/,
        'combined active-vehicle event checks should run at the original onboard location'
    );
});
