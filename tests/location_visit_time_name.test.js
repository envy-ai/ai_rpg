const test = require('node:test');
const assert = require('node:assert/strict');

const Location = require('../Location.js');
const Region = require('../Region.js');

function createRegionAndLocation() {
    const suffix = `${Date.now()}_${Math.random()}`;
    const region = new Region({
        id: `region_visit_time_${suffix}`,
        name: `Visit Time Region ${suffix}`,
        description: 'A region for visit-time tests.'
    });
    const location = new Location({
        id: `location_visit_time_${suffix}`,
        name: `Visit Time Location ${suffix}`,
        description: 'A location for visit-time tests.',
        regionId: region.id
    });
    return { region, location };
}

test('Location exposes minutesSinceLastVisit instead of the legacy hour-named helper', () => {
    const { location } = createRegionAndLocation();
    location.lastVisitedTime = 100;

    assert.equal(location.minutesSinceLastVisit(145), 45);
    assert.equal(typeof location.hoursSinceLastVisit, 'undefined');
});

test('Region exposes minutesSinceLastVisit instead of the legacy hour-named helper', () => {
    const { region } = createRegionAndLocation();
    region.lastVisitedTime = 200;

    assert.equal(region.minutesSinceLastVisit(260), 60);
    assert.equal(typeof region.hoursSinceLastVisit, 'undefined');
});
