const test = require('node:test');
const assert = require('node:assert/strict');

const {
    formatPlayerActionDestinationAbsence,
    resolvePlayerActionDestinationContext,
    resolvePlayerActionDestinationPreviewContext
} = require('../PlayerActionDestinationContext.js');

function fixtures() {
    const regions = [
        { id: 'old-town', name: 'Old Town' },
        { id: 'harbor', name: 'Harbor' }
    ];
    const locations = [
        {
            id: 'gate',
            name: 'Market Gate',
            regionId: 'old-town',
            description: 'A stone arch opens onto the market road.',
            visited: true,
            lastVisitedTime: 100
        },
        {
            id: 'square',
            name: 'Town Square',
            regionId: 'old-town',
            shortDescription: 'The old town gathering place.',
            description: 'A broad square surrounds an old fountain.',
            exits: new Map([
                ['west', {
                    destination: 'gate',
                    description: 'A cobbled lane passes beneath the market arch.',
                    travelTimeMinutes: 15
                }]
            ]),
            visited: true,
            lastVisitedTime: 120
        },
        {
            id: 'harbor-square',
            name: 'Town Square',
            regionId: 'harbor',
            stubMetadata: { stubDescription: 'A windblown plaza above the docks.' },
            visited: false,
            lastVisitedTime: null
        }
    ];
    const players = [
        { id: 'ada', name: 'Ada', isNPC: true, currentLocation: 'square', isDead: false },
        { id: 'merek', name: 'Merek', isNPC: true, currentLocation: 'square', isDead: false },
        { id: 'hidden', name: 'Hidden Scout', isNPC: true, currentLocation: 'square', hiddenFromPlayer: true },
        { id: 'dead', name: 'Dead Guard', isNPC: true, currentLocation: 'square', isDead: true },
        { id: 'party', name: 'Party Friend', isNPC: true, currentLocation: 'square', isInPlayerParty: true },
        { id: 'player', name: 'Player', isNPC: false, currentLocation: 'gate' }
    ];
    return { regions, locations, players };
}

test('player-action destination context resolves canonical revisit facts and exact arrival absence', () => {
    const { regions, locations, players } = fixtures();
    const context = resolvePlayerActionDestinationContext({
        location: 'Town Square',
        region: 'Old Town'
    }, {
        originLocationId: 'gate',
        currentWorldMinutes: 180,
        regions,
        locations,
        players,
        findTravelTimeMinutes: (origin, destination) => {
            assert.equal(origin.id, 'gate');
            assert.equal(destination.id, 'square');
            return 15;
        }
    });

    assert.equal(context.resolved, true);
    assert.equal(context.locationId, 'square');
    assert.equal(context.locationName, 'Town Square');
    assert.equal(context.regionName, 'Old Town');
    assert.equal(context.shortDescription, 'The old town gathering place.');
    assert.equal(context.description, 'A broad square surrounds an old fountain.');
    assert.equal(context.visitedBefore, true);
    assert.equal(context.minutesSinceLastVisitAtPrompt, 60);
    assert.deepEqual(context.presentNpcNames, ['Ada', 'Merek']);
    assert.deepEqual(context.exitSummaries, [{
        direction: 'west',
        destinationId: 'gate',
        destinationName: 'Market Gate',
        destinationRegionName: 'Old Town',
        description: 'A cobbled lane passes beneath the market arch.',
        travelTimeMinutes: 15
    }]);
    assert.deepEqual(context.travelDuration, { text: '15 minutes', minutes: 15 });
    assert.equal(formatPlayerActionDestinationAbsence(context), '1 hour, 15 minutes');
});

test('player-action destination context treats zero as a resolved programmatic duration', () => {
    const { regions, locations, players } = fixtures();
    const context = resolvePlayerActionDestinationContext({
        locationId: 'square',
        location: 'Town Square',
        regionId: 'old-town',
        region: 'Old Town'
    }, {
        originLocationId: 'square',
        currentWorldMinutes: 180,
        regions,
        locations,
        players,
        findTravelTimeMinutes: () => 0
    });

    assert.equal(context.travelTimeMinutes, 0);
    assert.deepEqual(context.travelDuration, { text: '0 minutes', minutes: 0 });
});

test('player-action destination context is unresolved for a missing destination and rejects ambiguity', () => {
    const { regions, locations, players } = fixtures();
    const unresolved = resolvePlayerActionDestinationContext({
        location: 'Unknown Clearing',
        region: 'Old Town'
    }, {
        currentWorldMinutes: 180,
        regions,
        locations,
        players
    });
    assert.equal(unresolved.resolved, false);
    assert.equal(unresolved.shortDescription, null);
    assert.equal(unresolved.description, null);
    assert.deepEqual(unresolved.exitSummaries, []);

    assert.throws(
        () => resolvePlayerActionDestinationContext({ location: 'Town Square', region: null }, {
            currentWorldMinutes: 180,
            regions,
            locations,
            players
        }),
        /ambiguous/i
    );
});

test('player-action destination context treats an unresolved region stub as new rather than failing template rendering', () => {
    const { regions, locations, players } = fixtures();
    locations.push({
        id: 'ridge-outpost-interior',
        name: 'Ridge Outpost Interior',
        regionId: 'unknown-region-stub',
        isStub: true,
        shortDescription: 'An unexplored path leading inside the outpost.'
    });

    const input = {
        locationId: 'ridge-outpost-interior',
        location: 'Ridge Outpost Interior',
        regionId: 'unknown-region-stub',
        region: 'Unknown Region'
    };
    const context = resolvePlayerActionDestinationContext(input, {
        currentWorldMinutes: 180,
        regions,
        locations,
        players
    });
    const preview = resolvePlayerActionDestinationPreviewContext(input, {
        currentWorldMinutes: 180,
        regions,
        locations,
        players
    });

    assert.equal(context.resolved, false);
    assert.equal(preview.resolved, false);
    assert.equal(context.locationId, null);
    assert.deepEqual(context.exitSummaries, []);
});

test('player-action destination context continues to reject a non-stub location with a missing region', () => {
    const { regions, locations, players } = fixtures();
    locations.push({
        id: 'corrupt-location',
        name: 'Corrupt Location',
        regionId: 'missing-region',
        isStub: false
    });

    assert.throws(
        () => resolvePlayerActionDestinationContext({ locationId: 'corrupt-location' }, {
            currentWorldMinutes: 180,
            regions,
            locations,
            players
        }),
        /missing region id "missing-region"/i
    );
});

test('player-action destination preview skips ambiguous name-only context without guessing', () => {
    const { regions, locations, players } = fixtures();
    const context = resolvePlayerActionDestinationPreviewContext({
        location: 'Town Square',
        region: null
    }, {
        currentWorldMinutes: 180,
        regions,
        locations,
        players
    });

    assert.equal(context.resolved, false);
    assert.equal(context.requestedLocation, 'Town Square');
    assert.deepEqual(context.presentNpcNames, []);
    assert.deepEqual(context.exitSummaries, []);
});

test('player-action destination context skips exact absence when legacy visit time is missing', () => {
    const { regions, locations, players } = fixtures();
    locations[1].lastVisitedTime = null;
    const context = resolvePlayerActionDestinationContext({
        location: 'Town Square',
        region: 'Old Town',
        travelTimeMinutes: 5
    }, {
        currentWorldMinutes: 180,
        regions,
        locations,
        players
    });
    assert.equal(context.visitedBefore, true);
    assert.equal(context.minutesSinceLastVisitAtPrompt, null);
    assert.equal(formatPlayerActionDestinationAbsence(context), null);
});
