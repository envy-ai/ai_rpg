const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const mapSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'map.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');

test('API exposes explicit stub expansion instead of relying on location fetch side effects', () => {
    const routeStart = apiSource.indexOf("app.post('/api/stubs/:id/expand'");
    const routeEnd = apiSource.indexOf("app.delete('/api/stubs/:id'", routeStart);

    assert.notEqual(routeStart, -1, 'stub expansion route should exist');
    assert.notEqual(routeEnd, -1, 'stub expansion route should be registered before stub deletion');

    const routeSource = apiSource.slice(routeStart, routeEnd);
    assert.match(routeSource, /expandRegionEntryStub\(stubLocation\)/);
    assert.match(routeSource, /scheduleStubExpansion\(stubLocation/);
    assert.match(routeSource, /buildLocationResponse\(expandedLocation\)/);
    assert.match(routeSource, /expandedRegion/);
});

test('API exposes a dedicated location relocation route with selected exit removal', () => {
    const routeStart = apiSource.indexOf("app.post('/api/locations/:id/relocate'");
    const routeEnd = apiSource.indexOf("app.delete('/api/locations/:id'", routeStart);

    assert.notEqual(routeStart, -1, 'location relocation route should exist before location deletion');
    assert.notEqual(routeEnd, -1, 'relocation route should be registered before location deletion');

    const routeSource = apiSource.slice(routeStart, routeEnd);
    assert.match(routeSource, /targetRegionId/);
    assert.match(routeSource, /removeExitIds/);
    assert.match(routeSource, /makeRegionEntrance/);
    assert.match(routeSource, /pendingRegionStubs\.has\(targetRegionId\)/);
    assert.match(routeSource, /location\.regionId = targetRegionId/);
    assert.match(routeSource, /findExitById\(candidateLocation, exitId\)/);
    assert.match(routeSource, /removeExitStrict\(candidateLocation/);
    assert.match(routeSource, /removedExits/);
});

test('map location context menu exposes explicit unstub actions for stubs', () => {
    assert.match(viewSource, /id="mapLocationMenuUnstubButton"/);
    assert.match(viewSource, /const mapLocationMenuUnstubButton = document\.getElementById\('mapLocationMenuUnstubButton'\);/);
    assert.match(viewSource, /function syncMapLocationContextMenuActions\(\)/);
    assert.match(viewSource, /targetLocation\.isStub/);
    assert.match(viewSource, /targetLocation\.stubMetadata\?\.isRegionEntryStub/);
    assert.match(viewSource, /async function expandSelectedMapStub\(\)/);
    assert.match(viewSource, /\/api\/stubs\/\$\{encodeURIComponent\(targetLocation\.id\)\}\/expand/);
});

test('region-map stub menu can expand stubs without travel', () => {
    assert.match(mapSource, /expandStub = async \(stubId\) =>/);
    assert.match(mapSource, /\/api\/stubs\/\$\{encodeURIComponent\(stubId\)\}\/expand/);
    assert.match(mapSource, /unstubBtn\.textContent = isRegionStub \? 'Unstub region' : 'Unstub location';/);
    assert.match(mapSource, /await expandStub\(stubId\);/);
});

test('location edit modal supports region relocation and exit cleanup', () => {
    assert.match(viewSource, /id="locationEditRegionGroup"/);
    assert.match(viewSource, /id="locationEditRegion"/);
    assert.match(viewSource, /id="locationEditRelocationSection"/);
    assert.match(viewSource, /id="locationEditRelocationExitList"/);
    assert.match(viewSource, /id="locationEditMakeRegionEntrance"/);
    assert.match(viewSource, /function populateLocationEditRegionSelect/);
    assert.match(viewSource, /function renderLocationRelocationExitOptions/);
    assert.match(viewSource, /function collectSelectedLocationRelocationExitIds/);
    assert.match(viewSource, /\/api\/locations\/\$\{encodeURIComponent\(targetLocation\.id\)\}\/relocate/);
    assert.match(viewSource, /removeExitIds: collectSelectedLocationRelocationExitIds\(\)/);
    assert.match(viewSource, /makeRegionEntrance: Boolean\(locationEditMakeRegionEntranceInput\?\.checked\)/);
});

test('location relocation controls have dedicated styling hooks', () => {
    assert.match(scssSource, /\.location-edit-relocation-section/);
    assert.match(scssSource, /\.location-edit-relocation-exit-list/);
    assert.match(scssSource, /\.location-edit-relocation-exit-option/);
});
