const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const TurnEventRecovery = require('../TurnEventRecovery.js');
const VehicleInfo = require('../VehicleInfo.js');
const { createPlayerActionInvalidVehicleRouteError, shouldPropagatePlayerActionEventCheckError } = require('../api.js');
const Utils = require('../Utils.js');
const { collectPlayerActionAutomaticPartyMembers, movePlayerActionAccompanyingCharacters } = require('../PlayerActionCompanions.js');

function makeMovementHarness(answer, { travelTimeMinutes = 0, autosaveName = 'starting-save' } = {}) {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('const moveVehicleFormoveTurnResult = async');
    const end = source.indexOf('\n        const stopVehicleFormoveTurnResult', start);
    assert.ok(start >= 0 && end > start);
    let state = new VehicleInfo({ destinations: ['origin'], currentDestination: 'origin', vehicleExitId: 'exit' });
    let decisions = 0;
    let movements = 0;
    const origin = { id: 'origin', name: 'Concourse', region: { name: 'Lower Spire' } };
    const destination = { id: 'harbor', name: 'Sky-Harbor Platform', region: { name: 'Sky-Harbor' } };
    const target = { label: 'Gondola', kind: 'location', setVehicleInfo: value => { state = new VehicleInfo(value); } };
    const context = {
        Map,
        VehicleInfo, TurnEventRecovery, createPlayerActionInvalidVehicleRouteError,
        EventReprocessor: { planMovement() {} },
        currentPlayer: { id: 'player' },
        Globals: { elapsedTime: 100 },
        gameLocations: new Map([['origin', origin], ['harbor', destination]]),
        resolvemoveTurnResultVehicleState: () => ({
            vehicleTarget: target, normalizedVehicleInfo: state, sourceLocation: origin,
            vehicleExit: { id: 'exit', destination: 'origin' }, icon: '🚋'
        }),
        buildPendingVehicleDestination: () => ({ rawText: 'Sky-Harbor|Sky-Harbor Platform', locationId: 'harbor', regionName: 'Sky-Harbor' }),
        requireLocationId: value => value,
        formatPendingVehicleDestinationLabel: () => 'Sky-Harbor Platform',
        requestPlayerInputFromClient: async request => {
            decisions += 1;
            assert.equal(request.mode, 'choice');
            assert.equal(request.requireConfig, false);
            assert.match(request.details.routeDescription, /Concourse.*Sky-Harbor Platform/);
            assert.deepEqual(state.destinations, ['origin']);
            assert.equal(movements, 0);
            return { answer };
        },
        moveLocationVehicleToDestinationRegionIfNeeded: () => {},
        retargetVehicleExitForTravelTarget: () => { movements += 1; return { moved: true, vehicleExit: { id: 'exit' } }; },
        applyVehicleInfoStateUpdate: ({ normalizedVehicleInfo, updates }) => {
            state = new VehicleInfo({ ...normalizedVehicleInfo.toJSON(), ...updates });
        }
    };
    const move = vm.runInNewContext(`${source.slice(start, end)}\nmoveVehicleFormoveTurnResult;`, context);
    return {
        run: () => move({ vehicleName: 'Gondola', destinationLocation: destination,
            destinationRegion: destination.region, travelTimeMinutes,
            recoveryContext: { stream: { clientId: 'client', isEnabled: true }, autosaveName } }),
        state: () => state,
        counts: () => ({ decisions, movements }),
        context,
        move
    };
}

test('accepting an off-route move requests a character time-skip without modifying the vehicle', async () => {
    const harness = makeMovementHarness('accept-route');
    assert.equal((await harness.run()).acceptedTimeSkip, true);
    assert.deepEqual(harness.state().destinations, ['origin']);
    assert.equal(harness.state().currentDestination, 'origin');
    assert.deepEqual(harness.counts(), { decisions: 1, movements: 0 });
});

test('accepting timed travel does not start an invalid vehicle trip', async () => {
    const harness = makeMovementHarness('accept-route', { travelTimeMinutes: 45 });
    assert.equal((await harness.run()).acceptedTimeSkip, true);
    assert.equal(harness.state().ETA, null);
    assert.equal(harness.state().pendingDestination, null);
    assert.deepEqual(harness.state().destinations, ['origin']);
    assert.deepEqual(harness.counts(), { decisions: 1, movements: 0 });
});

for (const action of ['rerun', 'skip-events']) {
    test(`${action} stops movement without modifying the saved route`, async () => {
        const harness = makeMovementHarness(action);
        await assert.rejects(harness.run, error => {
            assert.equal(TurnEventRecovery.isDecision(error), true);
            assert.equal(error.action, action);
            assert.equal(error.autosaveName, action === 'rerun' ? 'starting-save' : null);
            assert.equal(error.cause.code, 'PLAYER_ACTION_INVALID_VEHICLE_ROUTE');
            return true;
        });
        assert.deepEqual(harness.state().destinations, ['origin']);
        assert.deepEqual(harness.counts(), { decisions: 1, movements: 0 });
    });
}

test('rerun is rejected when this request has no starting autosave', async () => {
    const harness = makeMovementHarness('rerun', { autosaveName: null });
    await assert.rejects(harness.run, /option is unavailable/);
    assert.deepEqual(harness.state().destinations, ['origin']);
});

test('unknown responses cannot approve an off-route destination', async () => {
    const harness = makeMovementHarness('anything');
    await assert.rejects(harness.run, /option is unavailable/);
    assert.equal(harness.counts().movements, 0);
});

test('time skips sum narrated durations without counting the same destination twice', () => {
    assert.equal(TurnEventRecovery.timeSkipMinutes({ vehicleMinutes: 45, onwardMinutes: 15 }), 60);
    assert.equal(TurnEventRecovery.timeSkipMinutes({ vehicleMinutes: 45, onwardMinutes: 45, sameDestination: true }), 45);
    assert.equal(TurnEventRecovery.timeSkipMinutes(), 0);
    assert.throws(() => TurnEventRecovery.timeSkipMinutes({ vehicleMinutes: -1 }), /non-negative integer/);
});

test('travel wrappers preserve recovery decisions and tagged route failures', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    assert.match(source, /catch \(travelMoveError\) \{[\s\S]*?if \(shouldPropagatePlayerActionEventCheckError\(travelMoveError\)\) \{\s+throw travelMoveError;/);
});

function makeTravelHarness({ tinyBrain = false, playerDestination = 'Inn', sameDestination = false, failDestination = false, action = 'accept-route' } = {}) {
    const harness = makeMovementHarness(action);
    const context = harness.context;
    const locations = context.gameLocations;
    const makeLocation = (id, name, regionId, isVehicle = false) => ({
        id, name, regionId, isVehicle, region: { id: regionId, name: regionId }, npcIds: [],
        removeNpcId(id) { this.npcIds = this.npcIds.filter(candidate => candidate !== id); },
        addNpcId(id) { if (!this.npcIds.includes(id)) this.npcIds.push(id); }
    });
    const onboard = makeLocation('vehicle', 'Gondola', 'lower', true);
    const inn = makeLocation('inn', 'Inn', 'harbor-region');
    locations.set('vehicle', onboard);
    locations.set('inn', inn);
    Object.assign(locations.get('harbor'), makeLocation('harbor', 'Sky-Harbor Platform', 'harbor-region'));
    const actor = (id, name, isNPC = true) => ({
        id, name, isNPC, currentLocation: 'vehicle', getPartyMembers: () => id === 'player' ? ['party'] : [],
        setLocation(location) { this.currentLocation = location?.id || null; }
    });
    const player = actor('player', 'Exis', false);
    const party = actor('party', 'Quillmoth');
    const guest = actor('guest', 'Guest');
    const driver = actor('driver', 'Driver');
    onboard.npcIds = ['party', 'guest', 'driver'];
    const players = new Map([player, party, guest, driver].map(actor => [actor.id, actor]));
    const clock = [];
    const eventPasses = [];
    const target = { getVehicleInfo: () => harness.state().toJSON(), resolveSourceLocation: () => onboard, kind: 'location' };
    Object.assign(context, {
        Utils, currentPlayer: player, players, moveVehicleFormoveTurnResult: harness.move,
        shouldPropagatePlayerActionEventCheckError,
        isTinyBrainPromptEnabled: () => tinyBrain,
        stripHiddenNotesFromText: text => text,
        normalizemoveTurnResultVehicleField: text => text,
        normalizemoveTurnResultVehicleTravelTimeField: text => text,
        normalizemoveTurnResultDestinationField: text => text,
        normalizemoveTurnResultTravelTimeField: text => text,
        normalizeTravelDestinationComparisonKey: text => text?.toLowerCase() || '',
        resolvemoveTurnResultVehicleTarget: () => target,
        findLocationExitById: () => ({ sourceLocation: onboard, exit: { id: 'exit', destination: 'origin' } }),
        resolveRegionIdForLocation: location => location?.regionId || 'lower',
        resolveTravelDestinationRegionId: ({ location }) => location?.regionId || null,
        resolvemoveTurnResultDestination: async (name, options) => {
            if (options.allowCreate) assert.equal(options.createOriginExit, false);
            if (failDestination && options.allowCreate) throw new Error('Destination expansion failed');
            const location = [...locations.values()].find(location => location.name === name);
            if (!location) throw new Error(`Missing destination ${name}`);
            return { location, region: location.region };
        },
        ensuremoveTurnResultDestinationUnstubbed: async (location, options) => {
            assert.equal(options.createOriginExit, false);
            return location;
        },
        buildmoveTurnResultDestinationMatchRecord: () => ({}),
        filterVehicleArrivalRecordsForContext: () => [],
        buildVehicleArrivalMatchRecord: () => ({}),
        vehicleArrivalMatchesDestinationRecord: () => false,
        resolveActiveVehicleLabelForLocation: location => location?.isVehicle ? 'Gondola' : null,
        collectPlayerActionAutomaticPartyMembers, movePlayerActionAccompanyingCharacters,
        assertMovementGraphIntegrity: () => {},
        maybeBackfillRegionExitTravelTimesForArrival: () => { throw new Error('Time-skips must not backfill a vehicle route'); },
        findRegionByLocationId: () => null, backfillRegionExitTravelTimes: () => {},
        resolvemoveTurnResultPlayerMoveTimeMinutes: () => { throw new Error('Time-skips must use narrated durations'); },
        adjustWorldTimeByMinutes: async minutes => { clock.push(minutes); return { timeProgress: { advancedMinutes: minutes } }; },
        Events: {
            createTinyBrainEventSequence: () => ({}), shouldRunAutomaticHousekeepingThisTurn: () => false,
            runEventChecks: async options => { eventPasses.push(options); return {}; }
        },
        mergeEventResults: () => ({})
    });
    context.Globals.config = {};
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('async function runmoveTurnResultEventChecks');
    const end = source.indexOf('\n        function recordSkillCheckEntry', start);
    const run = vm.runInNewContext(`${source.slice(start, end)}\nrunmoveTurnResultEventChecks;`, context);
    return { ...harness, player, party, guest, driver, eventPasses, clock,
        runTravel: () => run({
            location: onboard, stream: { clientId: 'client', isEnabled: true },
            recoveryContext: { stream: { clientId: 'client', isEnabled: true }, autosaveName: 'starting-save' },
            moveTurnResultPayload: {
                vehicle: 'Gondola', vehicleDestination: 'Sky-Harbor Platform', vehicleTravelTime: '45 minutes',
                playerDestination: playerDestination || '', playerDestinationTravelTime: sameDestination ? '45 minutes' : '15 minutes',
                originProse: 'Farewell.', betweenProse: 'They travel.', destinationProse: 'They arrive.',
                accompanyingCharacters: ['Guest']
            }
        }) };
}

for (const tinyBrain of [false, true]) {
    test(`${tinyBrain ? 'TinyBrain' : 'standard'} acceptance disembarks player and companions, advances once, and processes destination events`, async () => {
        const harness = makeTravelHarness({ tinyBrain });
        const before = harness.state().toJSON();
        const result = await harness.runTravel();
        assert.equal(result.acceptedTimeSkip, true);
        assert.equal(harness.player.currentLocation, 'inn');
        assert.equal(harness.party.currentLocation, null);
        assert.equal(harness.guest.currentLocation, 'inn');
        assert.equal(harness.driver.currentLocation, 'vehicle');
        assert.deepEqual(harness.clock, [60]);
        assert.deepEqual(harness.state().toJSON(), before);
        const destinationPass = harness.eventPasses.find(pass => !tinyBrain || pass.eventSectionKind === 'destination');
        assert.equal(destinationPass.locationOverride.id, 'inn');
        assert.equal(destinationPass.suppressTimeAdvance, true);
        assert.equal(destinationPass.initialTimeProgress.advancedMinutes, 60);
        assert.equal(harness.counts().movements, 0);
    });
}

test('acceptance without a player destination disembarks at the vehicle stop', async () => {
    const harness = makeTravelHarness({ playerDestination: null });
    await harness.runTravel();
    assert.equal(harness.player.currentLocation, 'harbor');
    assert.deepEqual(harness.clock, [45]);
});

test('an identical vehicle and player destination counts the vehicle duration once', async () => {
    const harness = makeTravelHarness({ playerDestination: 'Sky-Harbor Platform', sameDestination: true });
    await harness.runTravel();
    assert.equal(harness.player.currentLocation, 'harbor');
    assert.deepEqual(harness.clock, [45]);
});

test('failed accepted time-skips surface a fatal error with no vehicle mutation', async () => {
    const harness = makeTravelHarness({ failDestination: true });
    await assert.rejects(harness.runTravel, error => {
        assert.equal(error.code, TurnEventRecovery.failureCode);
        assert.equal(shouldPropagatePlayerActionEventCheckError(error), true);
        return true;
    });
    assert.equal(harness.player.currentLocation, 'vehicle');
    assert.deepEqual(harness.clock, []);
    assert.deepEqual(harness.state().destinations, ['origin']);
});
