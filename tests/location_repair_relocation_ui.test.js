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

test('ordinary location stub edits can move the stub between live or pending regions', () => {
    const routeStart = apiSource.indexOf("app.put('/api/stubs/:id'");
    const routeEnd = apiSource.indexOf("app.post('/api/stubs/:id/expand'", routeStart);

    assert.notEqual(routeStart, -1, 'stub update route should exist');
    assert.notEqual(routeEnd, -1, 'stub update route should appear before stub expansion');

    const routeSource = apiSource.slice(routeStart, routeEnd);
    assert.match(routeSource, /const hasTargetRegion = hasOwn\.call\(body, 'targetRegionId'\);/);
    assert.match(routeSource, /Cannot change the target region of a region-entry stub/);
    assert.match(routeSource, /regions\.has\(resolvedTargetRegionId\)/);
    assert.match(routeSource, /pendingRegionStubs\.has\(resolvedTargetRegionId\)/);
    assert.match(routeSource, /removeStubFromRegionMemberships\(stubId, previousTargetRegionId\)/);
    assert.match(routeSource, /addStubToRegionMembership\(stubId, resolvedTargetRegionId\)/);
    assert.match(routeSource, /stubLocation\.setStubRegionId\(resolvedTargetRegionId, \{ requireLiveRegion: false \}\)/);
});

test('ordinary location stub editor exposes region selector and submits target region', () => {
    const setModeSource = viewSource.slice(
        viewSource.indexOf('function setLocationEditMode'),
        viewSource.indexOf('function openLocationEditModalForTarget')
    );
    const openSource = viewSource.slice(
        viewSource.indexOf('function openLocationEditModalForTarget'),
        viewSource.indexOf('function openLocationEditModal()')
    );
    const stubSubmitSource = viewSource.slice(
        viewSource.indexOf("if (locationEditMode === 'stub')"),
        viewSource.indexOf('const vehicleResult = collectVehicleInfoFromEditor', viewSource.indexOf("if (locationEditMode === 'stub')"))
    );

    assert.match(setModeSource, /const showStubRegionSelector = isStubMode && !isRegionStub;/);
    assert.match(setModeSource, /toggleLocationEditSection\(locationEditRegionGroup, !isStubMode \|\| showStubRegionSelector\)/);
    assert.match(setModeSource, /locationEditRegionSelect\.disabled = isRegionStub;/);
    assert.match(openSource, /if \(stubContext && !stubContext\.isRegionEntryStub\)/);
    assert.match(openSource, /populateLocationEditRegionSelect\(targetLocation\)/);
    assert.match(stubSubmitSource, /payload\.targetRegionId = resolveLocationEditSelectedRegionId\(\);/);
    assert.match(stubSubmitSource, /Stub region is required/);
});

test('location relocation controls have dedicated styling hooks', () => {
    assert.match(scssSource, /\.location-edit-relocation-section/);
    assert.match(scssSource, /\.location-edit-relocation-exit-list/);
    assert.match(scssSource, /\.location-edit-relocation-exit-option/);
});
