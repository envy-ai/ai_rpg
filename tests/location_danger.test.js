const test = require('node:test');
const assert = require('node:assert/strict');

const Faction = require('../Faction.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
const {
    FACTION_DANGER_MATRIX,
    calculateArrivalProbability,
    loadLocationDangerDefinition,
    resolveAntagonismBand,
    resolveEffectiveLocationDanger,
    resolveFactionDangerRating,
    selectDangerSource,
    validateLocationDangerDefinition
} = require('../LocationDanger.js');
const {
    HostileArrivalInvalidatedError,
    LocationHostileArrivalService,
    assertHostileDraftCapacity,
    buildArrivalPlan,
    countLivingHostiles
} = require('../LocationHostileArrivalService.js');

function cleanup() {
    Location.clear();
    Region.clear();
    Faction.clear();
}

test('definition loads exact half lives and caps', () => {
    const definition = loadLocationDangerDefinition({ baseDir: require('node:path').resolve(__dirname, '..') });
    assert.deepEqual(definition.arrivalProbabilityByRating[1], { halfLifeMinutes: null, cap: 0 });
    assert.deepEqual(definition.arrivalProbabilityByRating[2], { halfLifeMinutes: 43200, cap: 0.25 });
    assert.deepEqual(definition.arrivalProbabilityByRating[3], { halfLifeMinutes: 10080, cap: 0.5 });
    assert.deepEqual(definition.arrivalProbabilityByRating[4], { halfLifeMinutes: 2880, cap: 0.67 });
    assert.deepEqual(definition.arrivalProbabilityByRating[5], { halfLifeMinutes: 720, cap: 0.8 });
});

test('definition validator rejects malformed thresholds and curves', () => {
    assert.throws(() => validateLocationDangerDefinition({}), /faction_standing_thresholds/);
    const valid = {
        faction_standing_thresholds: {
            dislikes_below: 0, unfriendly_below: -20, hostile_below: -40,
            severe_enemy_below: -60, extermination_below: -80
        },
        arrival_probability_by_rating: {
            1: { half_life: null, cap: 0 }, 2: { half_life: '30 days', cap: .25 },
            3: { half_life: '7 days', cap: .5 }, 4: { half_life: '2 days', cap: .67 },
            5: { half_life: '12 hours', cap: .8 }
        }
    };
    assert.throws(() => validateLocationDangerDefinition({
        ...valid,
        faction_standing_thresholds: { ...valid.faction_standing_thresholds, hostile_below: -10 }
    }), /must satisfy/);
    assert.throws(() => validateLocationDangerDefinition({
        ...valid,
        arrival_probability_by_rating: { ...valid.arrival_probability_by_rating, 3: { half_life: '0 minutes', cap: .5 } }
    }), /half_life/);
});

test('standing boundaries and all faction matrix cells are exact', () => {
    const thresholds = loadLocationDangerDefinition({ baseDir: require('node:path').resolve(__dirname, '..') }).factionStandingThresholds;
    const cases = [[0, 0], [-0.01, 1], [-20, 1], [-20.01, 2], [-40, 2], [-40.01, 3], [-60, 3], [-60.01, 4], [-80, 4], [-80.01, 5]];
    for (const [standing, band] of cases) assert.equal(resolveAntagonismBand(standing, thresholds), band);
    for (let band = 0; band < FACTION_DANGER_MATRIX.length; band += 1) {
        const standing = [0, -1, -21, -41, -61, -81][band];
        for (let violence = 1; violence <= 5; violence += 1) {
            const result = resolveFactionDangerRating({ standing, violenceLevel: violence, thresholds });
            assert.equal(result.factionRating, FACTION_DANGER_MATRIX[band][violence - 1]);
            assert.equal(result.factionContribution, result.factionRating - 1);
        }
    }
    assert.equal(resolveFactionDangerRating({ standing: -100, violenceLevel: null, thresholds }).factionContribution, 0);
});

test('effective location danger clamps only the immediate sum without mutating storage', () => {
    cleanup();
    const parent = new Region({ id: 'danger-parent', name: 'Parent', description: 'Parent', dangerModifier: 99 });
    const region = new Region({ id: 'danger-child', name: 'Child', description: 'Child', parentRegionId: parent.id, dangerModifier: -7 });
    const location = new Location({ id: 'danger-location', name: 'Site', description: 'Site', regionId: region.id, dangerLevel: 10 });
    const result = resolveEffectiveLocationDanger(location);
    assert.deepEqual(result, {
        locationBaseDanger: 10, regionId: region.id, regionDangerModifier: -7,
        rawDangerLevel: 3, effectiveDangerLevel: 3, wildContribution: 2
    });
    assert.equal(location.dangerLevel, 10);
    assert.equal(region.dangerModifier, -7);
    cleanup();
});

test('arrival curve reaches half and three-quarter cap and never reaches cap', () => {
    const curves = loadLocationDangerDefinition({ baseDir: require('node:path').resolve(__dirname, '..') }).arrivalProbabilityByRating;
    for (let rating = 2; rating <= 5; rating += 1) {
        const { halfLifeMinutes, cap } = curves[rating];
        assert.equal(calculateArrivalProbability(rating, halfLifeMinutes, curves), cap / 2);
        assert.ok(Math.abs(calculateArrivalProbability(rating, halfLifeMinutes * 2, curves) - cap * .75) < 1e-12);
        assert.ok(calculateArrivalProbability(rating, halfLifeMinutes * 100, curves) <= cap);
    }
    assert.equal(calculateArrivalProbability(1, 999999, curves), 0);
});

test('source selection uses exact rating-minus-one weights', () => {
    assert.equal(selectDangerSource({ wildRating: 1, factionRating: 5, random: () => .999 }), 'faction');
    assert.equal(selectDangerSource({ wildRating: 5, factionRating: 1, random: () => 0 }), 'wild');
    assert.equal(selectDangerSource({ wildRating: 3, factionRating: 5, random: () => .32 }), 'wild');
    assert.equal(selectDangerSource({ wildRating: 3, factionRating: 5, random: () => .34 }), 'faction');
});

test('arrival plan never rolls first visits, null timestamps, or full locations', () => {
    cleanup();
    const region = new Region({ id: 'plan-region', name: 'Plan Region', description: 'Region' });
    const location = new Location({ id: 'plan-location', name: 'Plan Site', description: 'Site', regionId: region.id, dangerLevel: 5, generationHints: { numHostiles: 2 } });
    const player = { id: 'player', getFactionStanding: () => null };
    const players = new Map();
    let rolls = 0;
    const random = () => { rolls += 1; return 0; };
    assert.equal(buildArrivalPlan({ destination: location, wasVisitedBeforeArrival: false, player, players, currentWorldMinute: 100, priorLastVisitedTime: 0, random }).shouldGenerate, false);
    assert.equal(buildArrivalPlan({ destination: location, wasVisitedBeforeArrival: true, player, players, currentWorldMinute: 100, priorLastVisitedTime: null, random }).shouldGenerate, false);
    assert.equal(rolls, 0);
    assert.throws(() => buildArrivalPlan({ destination: location, wasVisitedBeforeArrival: true, player, players, currentWorldMinute: 10, priorLastVisitedTime: 11, random }), /future/);
    cleanup();
});

test('hostile occupancy uses canonical dispositions and includes hidden living NPCs', () => {
    const defs = { types: { trust: { key: 'trust', hostileThreshold: -10 } } };
    const location = { id: 'occupancy', npcIds: ['hidden', 'dead', 'departed', 'stale'] };
    const target = { id: 'player' };
    const makeNpc = (id, value, extra = {}) => ({ id, isNPC: true, currentLocation: 'occupancy', getDisposition: () => value, ...extra });
    const players = new Map([
        ['hidden', makeNpc('hidden', -20, { hiddenFromPlayer: true })],
        ['dead', makeNpc('dead', -20, { isDead: true })],
        ['departed', makeNpc('departed', -20, { currentLocation: 'elsewhere' })],
        ['stale', makeNpc('stale', 10, { isHostile: true })]
    ]);
    assert.equal(countLivingHostiles({ location, player: target, players, dispositionDefinitions: defs }), 1);
});

test('service preserves a successful source across generator retry and is idempotent', async () => {
    cleanup();
    const region = new Region({ id: 'service-region', name: 'Service Region', description: 'Region' });
    const destination = new Location({ id: 'service-location', name: 'Service Site', description: 'Site', regionId: region.id, dangerLevel: 5, generationHints: { numHostiles: 1 } });
    const player = { id: 'player', getFactionStanding: () => null };
    const players = new Map();
    const service = new LocationHostileArrivalService({ random: () => 0, diagnosticLogger: () => {} });
    const options = { arrivalId: 'arrival-1', destination, wasVisitedBeforeArrival: true, priorLastVisitedTime: 0, currentWorldMinute: 100000, player, players };
    await assert.rejects(service.run(options, {
        generateBatch: async () => { throw new Error('generation failed'); },
        revalidate: async () => {}, commitBatch: async () => []
    }), /generation failed/);
    assert.equal(service.toJSON().pendingAttempts[0].source, 'wild');
    const result = await service.run(options, {
        generateBatch: async plan => [{ name: 'Wolf', source: plan.source }],
        revalidate: async () => {}, commitBatch: async (_plan, drafts) => drafts
    });
    assert.equal(result.generated[0].source, 'wild');
    const duplicate = await service.run(options, {
        generateBatch: async () => { throw new Error('must not run'); },
        revalidate: async () => {}, commitBatch: async () => []
    });
    assert.equal(duplicate.shouldGenerate, false);
    cleanup();
});

test('a later real arrival resumes a pending destination attempt without rerolling its source', async () => {
    cleanup();
    const region = new Region({ id: 'resume-region', name: 'Resume Region', description: 'Region' });
    const destination = new Location({ id: 'resume-location', name: 'Resume Site', description: 'Site', regionId: region.id, dangerLevel: 5, generationHints: { numHostiles: 1 } });
    const player = { id: 'player', getFactionStanding: () => null };
    const players = new Map();
    let randomCalls = 0;
    const service = new LocationHostileArrivalService({
        random: () => {
            randomCalls += 1;
            return 0;
        },
        diagnosticLogger: () => {}
    });
    const firstArrival = { arrivalId: 'arrival-failed', destination, wasVisitedBeforeArrival: true, priorLastVisitedTime: 0, currentWorldMinute: 100000, player, players };
    await assert.rejects(service.run(firstArrival, {
        generateBatch: async () => { throw new Error('generation failed'); },
        revalidate: async () => {}, commitBatch: async () => []
    }), /generation failed/);
    const randomCallsAfterFailure = randomCalls;

    const resumed = await service.run({ ...firstArrival, arrivalId: 'arrival-later' }, {
        generateBatch: async plan => [{ name: 'Wolf', source: plan.source }],
        revalidate: async () => {}, commitBatch: async (_plan, drafts) => drafts
    });

    assert.equal(resumed.pendingAttempt.arrivalId, 'arrival-failed');
    assert.equal(resumed.diagnostic.requestedArrivalId, 'arrival-later');
    assert.equal(resumed.diagnostic.resumed, true);
    assert.equal(randomCalls, randomCallsAfterFailure);
    assert.deepEqual(
        new Set(service.toJSON().completedArrivalIds),
        new Set(['arrival-failed', 'arrival-later'])
    );
    const duplicateLaterArrival = await service.run({ ...firstArrival, arrivalId: 'arrival-later' }, {
        generateBatch: async () => { throw new Error('must not generate for the completed alias'); },
        revalidate: async () => {}, commitBatch: async () => []
    });
    assert.equal(duplicateLaterArrival.shouldGenerate, false);
    assert.equal(duplicateLaterArrival.diagnostic.skipReason, 'arrival_already_completed');
    cleanup();
});

test('precommit capacity invalidation cancels a pending attempt while generation failures retain it', async () => {
    cleanup();
    const region = new Region({ id: 'capacity-region', name: 'Capacity Region', description: 'Region' });
    const destination = new Location({ id: 'capacity-location', name: 'Capacity Site', description: 'Site', regionId: region.id, dangerLevel: 5, generationHints: { numHostiles: 2 } });
    const player = { id: 'player', getFactionStanding: () => null };
    const players = new Map();
    const service = new LocationHostileArrivalService({ random: () => 0, diagnosticLogger: () => {} });
    const options = { arrivalId: 'capacity-arrival', destination, wasVisitedBeforeArrival: true, priorLastVisitedTime: 0, currentWorldMinute: 100000, player, players };

    await assert.rejects(service.run(options, {
        generateBatch: async () => {
            destination.generationHints = {
                ...destination.generationHints,
                numHostiles: 1
            };
            return [{ name: 'Wolf One' }, { name: 'Wolf Two' }];
        },
        revalidate: async (_plan, drafts) => assertHostileDraftCapacity({
            destination,
            currentHostileCount: 0,
            draftCount: drafts.length
        }),
        commitBatch: async () => { throw new Error('must not commit'); }
    }), error => error instanceof HostileArrivalInvalidatedError);

    assert.equal(service.toJSON().pendingAttempts.length, 0);
    assert.deepEqual(service.toJSON().completedArrivalIds, ['capacity-arrival']);
    cleanup();
});

test('explicit state invalidation cancels a stale faction-source attempt', async () => {
    cleanup();
    const region = new Region({ id: 'invalidated-region', name: 'Invalidated Region', description: 'Region' });
    const destination = new Location({ id: 'invalidated-location', name: 'Invalidated Site', description: 'Site', regionId: region.id, dangerLevel: 5, generationHints: { numHostiles: 1 } });
    const player = { id: 'player', getFactionStanding: () => null };
    const players = new Map();
    const service = new LocationHostileArrivalService({ random: () => 0, diagnosticLogger: () => {} });
    service.hydrate({
        pendingAttempts: [{
            id: 'hostile_arrival_invalidated-arrival',
            arrivalId: 'invalidated-arrival',
            destinationId: destination.id,
            source: 'faction',
            factionId: 'faction-gone-hostile',
            maximumCount: 1,
            status: 'pending',
            diagnostic: { selectedSource: 'faction' }
        }]
    });
    const options = { arrivalId: 'replacement-arrival', destination, wasVisitedBeforeArrival: true, priorLastVisitedTime: 0, currentWorldMinute: 100000, player, players };

    await assert.rejects(service.run(options, {
        generateBatch: async () => [{ name: 'Wolf' }],
        revalidate: async () => {
            throw new HostileArrivalInvalidatedError('Faction standing changed before commit.');
        },
        commitBatch: async () => { throw new Error('must not commit'); }
    }), /Faction standing changed/);

    assert.equal(service.toJSON().pendingAttempts.length, 0);
    assert.deepEqual(
        new Set(service.toJSON().completedArrivalIds),
        new Set(['invalidated-arrival', 'replacement-arrival'])
    );
    cleanup();
});
