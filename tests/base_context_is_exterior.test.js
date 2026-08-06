const test = require('node:test');
const assert = require('node:assert/strict');

const {
    loadBuildBasePromptContext
} = require('./helpers/baseContextFixtures.js');
const {
    isExitButtonTravelToExterior
} = require('../api.js');

function buildLocation(name) {
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
            exits: {},
            npcIds: []
        })
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
    assert.equal(exteriorExitContext.isExterior, true);
});

test('base context sets isExterior to false when there is no current location', () => {
    const buildBasePromptContext = loadBuildBasePromptContext();

    assert.equal(buildBasePromptContext().isExterior, false);
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
