const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('shared map modal renders an accessible ordered route and unavailable state', () => {
    const view = fs.readFileSync(path.join(root, 'views/index.njk'), 'utf8');
    assert.match(view, /id="mapFastTravelRouteSteps"[^>]*class="map-route-inspector__steps"/);
    assert.match(view, /id="mapFastTravelBlockingReason"/);
    assert.match(view, /elements\.confirmButton\.disabled = !preview\.canFastTravel/);
    assert.match(view, /preview\.blockingReason\?\.message/);
    assert.match(view, /event\.key === 'Tab'/);
    assert.match(view, /Unexplored destination/);
    assert.match(view, /route\.textContent = `\$\{step\.fromLocationName\} → \$\{step\.toLocationName\}`/);
    assert.doesNotMatch(view, /route\.textContent = `\$\{step\.direction\}:/);
});

test('region and world maps inspect unvisited non-current locations', () => {
    const regionMap = fs.readFileSync(path.join(root, 'public/js/map.js'), 'utf8');
    const worldMap = fs.readFileSync(path.join(root, 'public/js/world-map.js'), 'utf8');
    assert.doesNotMatch(regionMap, /if \(!node\.data\('visited'\)\) \{\s*return;\s*\}/);
    assert.doesNotMatch(worldMap, /!locationId \|\| !node\.data\('visited'\)/);
    assert.match(regionMap, /window\.travelToAdjacentLocationFromMap\(locationId\)/);
    assert.match(worldMap, /window\.travelToAdjacentLocationFromMap\(locationId\)/);
});
