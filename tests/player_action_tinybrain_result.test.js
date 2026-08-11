const test = require('node:test');
const assert = require('node:assert/strict');

const Utils = require('../Utils.js');
const {
    buildPlayerActionTinyBrainResult
} = require('../PlayerActionTinyBrainResult.js');

function parse(xml) {
    return Utils.parseXmlDocumentStrict(xml, 'text/xml').documentElement;
}

function baseMoveAssignments(overrides = {}) {
    return {
        movementKind: 'destination',
        proseScopes: ['origin', 'destination'],
        playerDestination: { location: 'Market Gate', region: null },
        playerTravelDuration: { text: '5 minutes', minutes: 5 },
        accompanyingCharacters: [],
        originProse: 'You leave the inn.',
        destinationProse: 'The market opens before you.',
        hiddenNotes: null,
        ...overrides
    };
}

function vehicleContext(overrides = {}) {
    return {
        currentVehicle: {
            vehicleKind: 'region',
            name: 'The Shuttle & Star',
            destination: 'Old Port',
            vehicleInfo: {
                isUnderway: false,
                hasArrived: false
            },
            ...overrides
        }
    };
}

test('player-action TinyBrain result builder assembles a normal result safely', () => {
    const xml = buildPlayerActionTinyBrainResult({
        assignments: {
            movementKind: 'none',
            normalProse: 'Mira says, "Use <this> & wait for ]]> safely."',
            hiddenNotes: 'The latch is newly broken & dangerous.',
            timeReasoning: 'A short exchange & inspection.',
            timeDuration: { text: '2 minutes', minutes: 2 }
        },
        templateContext: { currentVehicle: null }
    });
    const root = parse(xml);

    assert.equal(root.tagName, 'turnResult');
    assert.equal(root.getElementsByTagName('prose')[0].textContent, 'Mira says, "Use <this> & wait for ]]> safely."');
    assert.equal(root.getElementsByTagName('hidden')[0].textContent, 'The latch is newly broken & dangerous.');
    assert.equal(root.getElementsByTagName('duration')[0].textContent, '2 minutes');
    assert.match(xml, /A short exchange &amp; inspection\./);
});

test('player-action TinyBrain result builder uses authoritative player travel metadata', () => {
    const xml = buildPlayerActionTinyBrainResult({
        assignments: baseMoveAssignments({
            movementKind: undefined,
            playerDestination: undefined,
            playerTravelDuration: undefined,
            hiddenNotes: 'The gate guard noticed the player.'
        }),
        templateContext: {
            currentVehicle: null,
            playerActionTravelDestination: {
                location: 'Canonical Gate',
                region: 'Canonical City',
                travelTimeMinutes: 12
            },
            playerActionTravelMovementKind: 'destination'
        }
    });
    const root = parse(xml);

    assert.equal(root.tagName, 'moveTurnResult');
    assert.equal(root.getElementsByTagName('location')[0].textContent, 'Canonical Gate');
    assert.equal(root.getElementsByTagName('region')[0].textContent, 'Canonical City');
    assert.equal(root.getElementsByTagName('travelTime')[0].textContent, '12 minutes');
    assert.equal(root.getElementsByTagName('hidden')[0].textContent, 'The gate guard noticed the player.');
});

test('player-action TinyBrain result builder uses canonical programmatic destination time', () => {
    const destinationContextResolver = () => ({
        resolved: true,
        locationName: 'Canonical Square',
        regionName: 'Canonical City',
        travelDuration: { text: '0 minutes', minutes: 0 }
    });
    const xml = buildPlayerActionTinyBrainResult({
        assignments: baseMoveAssignments({
            playerTravelDuration: undefined
        }),
        templateContext: {
            currentVehicle: null,
            playerActionDestinationContextResolver: destinationContextResolver
        }
    });

    assert.match(xml, /<location>Canonical Square<\/location>/);
    assert.match(xml, /<region>Canonical City<\/region>/);
    assert.match(xml, /<travelTime>0 minutes<\/travelTime>/);
    assert.throws(
        () => buildPlayerActionTinyBrainResult({
            assignments: baseMoveAssignments(),
            templateContext: {
                currentVehicle: null,
                playerActionDestinationContextResolver: destinationContextResolver
            }
        }),
        /must be absent when travel time was resolved programmatically/i
    );
});

test('player-action TinyBrain result builder requires a consistent authoritative movement type', () => {
    const authoritativeDestination = {
        location: 'Canonical Gate',
        region: 'Canonical City',
        travelTimeMinutes: 12
    };
    assert.throws(
        () => buildPlayerActionTinyBrainResult({
            assignments: baseMoveAssignments({ movementKind: undefined }),
            templateContext: {
                currentVehicle: null,
                playerActionTravelDestination: authoritativeDestination
            }
        }),
        /travel movement must be "destination"; received "undefined"/i
    );
    assert.throws(
        () => buildPlayerActionTinyBrainResult({
            assignments: baseMoveAssignments({ movementKind: undefined }),
            templateContext: {
                ...vehicleContext({ vehicleInfo: { isUnderway: true, hasArrived: false } }),
                playerActionTravelDestination: authoritativeDestination,
                playerActionTravelMovementKind: 'destination'
            }
        }),
        /travel movement must be "disembark"; received "destination"/i
    );
    assert.throws(
        () => buildPlayerActionTinyBrainResult({
            assignments: baseMoveAssignments(),
            templateContext: {
                currentVehicle: null,
                playerActionTravelMovementKind: 'destination'
            }
        }),
        /requires an authoritative travel destination/i
    );
});

test('player-action TinyBrain result builder serializes validated exact accompanying names', () => {
    const xml = buildPlayerActionTinyBrainResult({
        assignments: baseMoveAssignments({
            accompanyingCharacters: ['Mira & Vale', 'Tal Stone']
        }),
        templateContext: {
            currentVehicle: null,
            playerActionAccompanyingCharacters: [
                { name: 'Mira & Vale', aliases: ['Mira'] },
                { name: 'Tal Stone', aliases: [] }
            ]
        }
    });
    const root = parse(xml);
    const accompanyingRoot = root.getElementsByTagName('accompanyingCharacters')[0];

    assert.ok(accompanyingRoot);
    assert.deepEqual(
        Array.from(accompanyingRoot.getElementsByTagName('name')).map(node => node.textContent),
        ['Mira & Vale', 'Tal Stone']
    );
    assert.match(xml, /<name>Mira &amp; Vale<\/name>/);
});

test('player-action TinyBrain result builder rejects invalid accompanying selections', () => {
    assert.throws(
        () => buildPlayerActionTinyBrainResult({
            assignments: baseMoveAssignments({ accompanyingCharacters: ['Unknown Guide'] }),
            templateContext: {
                currentVehicle: null,
                playerActionAccompanyingCharacters: [{ name: 'Mira Vale', aliases: ['Mira'] }]
            }
        }),
        /allowed exact character name/i
    );
    assert.throws(
        () => buildPlayerActionTinyBrainResult({
            assignments: baseMoveAssignments({ accompanyingCharacters: ['Mira Vale', 'Mira Vale'] }),
            templateContext: {
                currentVehicle: null,
                playerActionAccompanyingCharacters: [{ name: 'Mira Vale', aliases: ['Mira'] }]
            }
        }),
        /duplicated/i
    );
});

test('player-action TinyBrain result builder preserves underway vehicle normal turns', () => {
    const xml = buildPlayerActionTinyBrainResult({
        assignments: {
            movementKind: 'none',
            vehicleDecision: 'unchanged',
            normalProse: 'The train keeps rolling while the conversation continues.',
            hiddenNotes: null,
            timeReasoning: 'They talk while the vehicle moves.',
            timeDuration: { text: '10 minutes', minutes: 10 }
        },
        templateContext: vehicleContext({
            vehicleInfo: { isUnderway: true, hasArrived: false }
        })
    });

    assert.equal(parse(xml).tagName, 'turnResult');
    assert.doesNotMatch(xml, /<vehicleInfo>/);
});

test('player-action TinyBrain result builder handles vehicle departure, stop, and redirect', () => {
    const departure = buildPlayerActionTinyBrainResult({
        assignments: baseMoveAssignments({
            movementKind: 'none',
            vehicleDecision: 'depart',
            playerDestination: undefined,
            playerTravelDuration: undefined,
            vehicleDestination: { location: 'North Dock', region: 'Harbor' },
            vehicleTravelDuration: { text: '20 minutes', minutes: 20 }
        }),
        templateContext: vehicleContext()
    });
    assert.match(departure, /<name>The Shuttle &amp; Star<\/name>/);
    assert.match(departure, /<vehicleDestination>/);
    assert.doesNotMatch(departure, /<playerDestination>/);

    const stop = buildPlayerActionTinyBrainResult({
        assignments: baseMoveAssignments({
            movementKind: 'none',
            vehicleDecision: 'stop',
            playerDestination: undefined,
            playerTravelDuration: undefined
        }),
        templateContext: vehicleContext({
            vehicleInfo: { isUnderway: true, hasArrived: false }
        })
    });
    assert.match(stop, /<travelTime>0 minutes<\/travelTime>/);
    assert.doesNotMatch(stop, /<vehicleDestination>/);

    const redirect = buildPlayerActionTinyBrainResult({
        assignments: baseMoveAssignments({
            movementKind: 'none',
            vehicleDecision: 'redirect',
            playerDestination: undefined,
            playerTravelDuration: undefined,
            vehicleDestination: { location: null, region: 'Eastern Reach' },
            vehicleTravelDuration: { text: '2 hours', minutes: 120 }
        }),
        templateContext: vehicleContext({
            vehicleInfo: { isUnderway: true, hasArrived: false }
        })
    });
    assert.match(redirect, /<region>Eastern Reach<\/region>/);
    assert.match(redirect, /<travelTime>2 hours<\/travelTime>/);
});

test('player-action TinyBrain result builder omits vehicleInfo for inside moves and disembarkation', () => {
    for (const [movementKind, vehicleDecision] of [
        ['inside_vehicle', 'unchanged'],
        ['disembark', 'unchanged'],
        ['disembark', 'stop_for_exit']
    ]) {
        const xml = buildPlayerActionTinyBrainResult({
            assignments: baseMoveAssignments({
                movementKind,
                vehicleDecision,
                playerDestination: { location: 'Observation Deck', region: null },
                playerTravelDuration: { text: '1 minute', minutes: 1 }
            }),
            templateContext: vehicleContext({
                vehicleInfo: { isUnderway: true, hasArrived: false }
            })
        });
        assert.equal(parse(xml).tagName, 'moveTurnResult');
        assert.doesNotMatch(xml, /<vehicleInfo>/);
        assert.match(xml, /<playerDestination>/);
    }
});

test('player-action TinyBrain result builder keeps movement within a location vehicle onboard', () => {
    const xml = buildPlayerActionTinyBrainResult({
        assignments: baseMoveAssignments({
            movementKind: 'inside_vehicle',
            vehicleDecision: 'unchanged',
            playerDestination: undefined,
            playerTravelDuration: undefined,
            accompanyingCharacters: undefined,
            proseScopes: ['destination'],
            originProse: undefined,
            destinationProse: 'You reach the driver booth without leaving the tram.'
        }),
        templateContext: vehicleContext({
            vehicleKind: 'location',
            vehicleInfo: { isUnderway: true, hasArrived: false }
        })
    });

    assert.equal(parse(xml).tagName, 'moveTurnResult');
    assert.doesNotMatch(xml, /<vehicleInfo>/);
    assert.doesNotMatch(xml, /<playerDestination>/);
    assert.doesNotMatch(xml, /<accompanyingCharacters>/);
    assert.match(xml, /<destinationProse>/);

    assert.throws(
        () => buildPlayerActionTinyBrainResult({
            assignments: baseMoveAssignments({
                movementKind: 'inside_vehicle',
                vehicleDecision: 'unchanged'
            }),
            templateContext: vehicleContext({
                vehicleKind: 'location',
                vehicleInfo: { isUnderway: true, hasArrived: false }
            })
        }),
        /must not provide a player destination, travel duration, or accompanying-character selection/
    );
});

test('player-action TinyBrain result builder rejects contradictory branch state', () => {
    assert.throws(
        () => buildPlayerActionTinyBrainResult({
            assignments: baseMoveAssignments({
                movementKind: 'inside_vehicle',
                vehicleDecision: 'redirect'
            }),
            templateContext: vehicleContext({
                vehicleInfo: { isUnderway: true, hasArrived: false }
            })
        }),
        /cannot change vehicle state/i
    );
    assert.throws(
        () => buildPlayerActionTinyBrainResult({
            assignments: baseMoveAssignments({ proseScopes: [] }),
            templateContext: { currentVehicle: null }
        }),
        /at least one prose scope/i
    );
});
