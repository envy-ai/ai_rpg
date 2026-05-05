const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

test('new-exit route can target an existing pending region directly', () => {
    const source = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const routeStart = source.indexOf("app.post('/api/locations/:id/exits'");
    const routeEnd = source.indexOf("app.delete('/api/locations/:id/exits/:exitId", routeStart);
    assert.notEqual(routeStart, -1);
    assert.notEqual(routeEnd, -1);
    const routeSource = source.slice(routeStart, routeEnd);

    const targetingRegionIndex = routeSource.indexOf('const targetingExistingRegion = normalizedType === \'region\' && Boolean(targetRegionId);');
    const existingRegionBranchIndex = routeSource.indexOf('if (targetingExistingRegion) {');
    const newRegionBranchIndex = routeSource.indexOf('} else if (normalizedType === \'region\') {');
    const newLocationBranchIndex = routeSource.indexOf('} else if (normalizedType === \'location\') {');

    assert(targetingRegionIndex > -1, 'route should detect existing-region targets');
    assert(existingRegionBranchIndex > targetingRegionIndex, 'route should branch for existing-region targets');
    assert(newRegionBranchIndex > existingRegionBranchIndex, 'existing-region branch should run before new-region creation');
    assert(newLocationBranchIndex > existingRegionBranchIndex, 'existing-region branch should run before new-location creation');
    assert.match(routeSource, /pendingRegionStubs\.get\(targetRegionId\)/);
    assert.match(routeSource, /metadata\.isRegionEntryStub && \(metadata\.targetRegionId === targetRegionId \|\| metadata\.regionId === targetRegionId\)/);
    assert.match(routeSource, /destinationRegion:\s*destinationRegionForExit/);
});

test('new-exit modal allows blank location when a pending region is selected', () => {
    const source = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');

    assert.match(source, /Use pending region entrance/);
    assert.match(source, /function isNewExitPendingRegionSelected/);
    assert.match(source, /const targetPendingRegionEntry = Boolean\(/);
    assert.match(source, /const type = creatingNewRegion \|\| targetPendingRegionEntry \? 'region' : 'location';/);
    assert.doesNotMatch(source, /removePlaceholder\(\)/);
});

test('delete-exit route preserves pending regions while other exits still target them', () => {
    const source = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const routeStart = source.indexOf("app.delete('/api/locations/:id/exits/:exitId'");
    const routeEnd = source.indexOf("app.get('/api/stubs/:id'", routeStart);
    assert.notEqual(routeStart, -1);
    assert.notEqual(routeEnd, -1);

    const routeSource = source.slice(routeStart, routeEnd);

    assert.match(source, /function collectExitReferencesToPendingRegion\(pendingRegionId\)/);
    assert.match(source, /function exitTargetsPendingRegion\(exit, pendingRegionId\)/);
    assert.match(source, /function resolvePendingRegionIdForLocation\(location\)/);
    assert.match(source, /function deletePendingRegionStubRecord\(pendingRegionId/);
    assert.doesNotMatch(routeSource, /destinationMetadata\?\.isRegionEntryStub\s*\|\|\s*pendingRegionStub/);
    assert.match(routeSource, /stubInfo\.locationIds\.includes\(destinationLocation\.id\)/);
    assert.match(routeSource, /pendingRegionStub\.entranceStubId === destinationLocation\.id/);
    assert.match(routeSource, /collectExitReferencesToPendingRegion\(resolvedRegionStubId\)/);
    assert.match(routeSource, /remainingPendingRegionExits\.length === 0/);
    assert.match(routeSource, /deletePendingRegionStubRecord\(resolvedRegionStubId/);
    assert.match(routeSource, /remainingExitCount: remainingPendingRegionExits\.length/);
});
