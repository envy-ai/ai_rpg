const test = require('node:test');
const assert = require('node:assert/strict');

const {
    loadBuildBasePromptContext
} = require('./helpers/baseContextFixtures.js');
const {
    isExitButtonTravelToExterior
} = require('../api.js');

function buildLocation(name, { exits = {} } = {}) {
    return {
        id: `loc_${name.toLowerCase().replace(/\s+/g, '_')}`,
        name,
        description: 'A test location.',
        items: [],
        scenery: [],
        npcIds: [],
        getDetails: () => ({
            name,
            description: 'A test location.',
            exits,
            npcIds: []
        }),
        getAvailableDirections: () => Object.keys(exits),
        getExit: direction => exits[direction] || null
    };
}

test('base context only exposes isExterior when the caller marks an exterior exit action', () => {
    const buildBasePromptContext = loadBuildBasePromptContext();

    const currentExteriorContext = buildBasePromptContext({
        locationOverride: buildLocation('Moon Gate ExTeRiOr')
    });
    const exteriorExitContext = buildBasePromptContext({
        locationOverride: buildLocation('Moon Gate Interior'),
        isExterior: true
    });

    assert.equal(currentExteriorContext.isExterior, false);
    assert.equal(currentExteriorContext.currentLocation.isExterior, true);
    assert.equal(exteriorExitContext.isExterior, true);
    assert.equal(exteriorExitContext.currentLocation.isExterior, false);
});

test('base context sets isExterior to false when there is no current location', () => {
    const buildBasePromptContext = loadBuildBasePromptContext();

    assert.equal(buildBasePromptContext().isExterior, false);
});

test('current location context recognizes a matching interior region exit case-insensitively', () => {
    const buildBasePromptContext = loadBuildBasePromptContext();
    const context = buildBasePromptContext({
        locationOverride: buildLocation('Moon Gate', {
            exits: {
                inward: {
                    relativeName: 'Interior Door',
                    region: { name: '  moon   gate INTERIOR  ' }
                }
            }
        })
    });

    assert.equal(context.currentLocation.isExterior, true);
    assert.equal(context.currentLocation.exits[0].destinationRegionName, 'moon   gate INTERIOR');
});

test('exit-button travel detects exterior destination names case-insensitively', () => {
    assert.equal(isExitButtonTravelToExterior({
        isTravelAction: true,
        travelContext: {
            exit: { id: 'exit_1' },
            destinationLocation: buildLocation('Moon Gate ExTeRiOr')
        }
    }), true);

    assert.equal(isExitButtonTravelToExterior({
        isTravelAction: true,
        travelContext: {
            exit: { id: 'exit_2' },
            destinationLocation: buildLocation('Moon Gate Interior')
        }
    }), false);
});

test('exit-button travel recognizes a location connected to its matching interior region as exterior', () => {
    const destinationLocation = buildLocation('Moon Gate', {
        exits: {
            inward: {
                region: { name: '  moon   gate INTERIOR  ' }
            }
        }
    });

    assert.equal(isExitButtonTravelToExterior({
        isTravelAction: true,
        travelContext: {
            exit: { id: 'exit_3' },
            destinationLocation
        }
    }), true);

    assert.equal(isExitButtonTravelToExterior({
        isTravelAction: true,
        travelContext: {
            exit: { id: 'exit_4' },
            destinationLocation: buildLocation('Moon Gate', {
                exits: {
                    elsewhere: { region: { name: 'Moon Gate Back Room' } }
                }
            })
        }
    }), false);
});

test('exterior destinations do not count without an exit-button travel action', () => {
    const destinationLocation = buildLocation('Moon Gate Exterior');

    assert.equal(isExitButtonTravelToExterior({
        isTravelAction: false,
        travelContext: {
            exit: { id: 'exit_1' },
            destinationLocation
        }
    }), false);
    assert.equal(isExitButtonTravelToExterior({
        isTravelAction: true,
        travelContext: {
            exit: null,
            destinationLocation
        }
    }), false);
});
