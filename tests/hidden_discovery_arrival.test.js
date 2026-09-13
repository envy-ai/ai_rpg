const test = require('node:test');
const assert = require('node:assert/strict');

const Thing = require('../Thing.js');
const LocationExit = require('../LocationExit.js');
const { runAutomaticHiddenDiscoveryForFirstEntry } = require('../HiddenDiscovery.js');

test.afterEach(() => Thing.clear());

test('first-entry discovery snapshots targets and records one independent result per initial target', async () => {
    const cache = new Thing({
        id: 'arrival-cache',
        name: 'Hidden Cache',
        description: 'A hidden cache.',
        thingType: 'item',
        hiddenFromPlayer: true,
        discoveryDifficulty: 'Easy',
        enrichStatusEffects: false
    });
    const door = new LocationExit({
        id: 'arrival-door',
        destination: 'elsewhere',
        name: 'Hidden Door',
        hiddenFromPlayer: true,
        discoveryDifficulty: 'Hard'
    });
    const location = {
        id: 'arrival-location',
        baseLevel: 9,
        things: [cache],
        getAvailableDirections: () => ['east'],
        getExit: () => door
    };
    const recorded = [];
    let rolls = 0;
    const result = await runAutomaticHiddenDiscoveryForFirstEntry({
        player: { id: 'player' },
        location,
        wasVisitedBeforeArrival: false,
        perceptionAttribute: 'Awareness',
        resolveActionOutcome: () => {
            rolls += 1;
            if (rolls === 1) {
                location.things.push(new Thing({
                    id: 'late-hidden-thing',
                    name: 'Late Hidden Thing',
                    description: 'Added after the arrival snapshot.',
                    thingType: 'scenery',
                    hiddenFromPlayer: true,
                    discoveryDifficulty: 'Medium',
                    enrichStatusEffects: false
                }));
            }
            return { success: rolls === 1, skill: 'Notice', locationLevel: 9 };
        },
        recordResult: check => recorded.push(check)
    });

    assert.equal(rolls, 2);
    assert.deepEqual(recorded.map(check => [check.targetType, check.targetId, check.success]), [
        ['thing', 'arrival-cache', true],
        ['exit', 'arrival-door', false]
    ]);
    assert.equal(cache.hiddenFromPlayer, false);
    assert.equal(door.hiddenFromPlayer, true);
    assert.equal(location.things[1].hiddenFromPlayer, true);
    assert.equal(result.locationRefreshRequested, true);
});

test('failed hidden discovery survives save hydration and a revisit does not reroll', async () => {
    const cache = new Thing({
        id: 'failed-cache',
        name: 'Failed Cache',
        description: 'A cache that was not noticed.',
        thingType: 'item',
        hiddenFromPlayer: true,
        discoveryDifficulty: 'Legendary',
        enrichStatusEffects: false
    });
    const location = {
        id: 'failed-location',
        things: [cache],
        getAvailableDirections: () => [],
        getExit: () => null
    };
    await runAutomaticHiddenDiscoveryForFirstEntry({
        player: { id: 'player' },
        location,
        wasVisitedBeforeArrival: false,
        perceptionAttribute: 'Awareness',
        resolveActionOutcome: () => ({ success: false })
    });
    const hydrated = Thing.fromJSON(cache.toJSON(), { register: false });
    assert.deepEqual([hydrated.hiddenFromPlayer, hydrated.discoveryDifficulty], [true, 'Legendary']);

    const revisit = await runAutomaticHiddenDiscoveryForFirstEntry({
        player: { id: 'player' },
        location: { ...location, things: [hydrated] },
        wasVisitedBeforeArrival: true,
        perceptionAttribute: 'Awareness',
        resolveActionOutcome: () => {
            throw new Error('A revisit must not roll hidden discovery again.');
        }
    });
    assert.deepEqual(revisit.checks, []);
});
