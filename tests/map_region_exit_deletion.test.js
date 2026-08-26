const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mapSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'map.js'), 'utf8');

test('region-exit edges retain the authoritative exit id used by deletion', () => {
    const edgeStart = mapSource.indexOf('regionExitEdges.push({');
    assert.notEqual(edgeStart, -1, 'Unable to locate region-exit edge construction');
    const edgeEnd = mapSource.indexOf("classes: 'region-exit-edge'", edgeStart);
    assert.notEqual(edgeEnd, -1, 'Unable to locate end of region-exit edge construction');
    const edgeSource = mapSource.slice(edgeStart, edgeEnd);

    assert.match(edgeSource, /source: loc\.id/);
    assert.match(edgeSource, /forwardExitId: exit\.id \|\| null/);

    const deleteStart = mapSource.indexOf('const deleteEdgeAndExit = async (edge) => {');
    assert.notEqual(deleteStart, -1, 'Unable to locate map-edge deletion helper');
    const deleteEnd = mapSource.indexOf('const createContextMenuContainer', deleteStart);
    assert.notEqual(deleteEnd, -1, 'Unable to locate end of map-edge deletion helper');
    const deleteSource = mapSource.slice(deleteStart, deleteEnd);

    assert.match(deleteSource, /const forwardExitId = edge\.data\('forwardExitId'\) \|\| null/);
    assert.match(deleteSource, /performDelete\(sourceId, forwardExitId\)/);
    assert.match(deleteSource, /targetNode\.hasClass\('region-exit'\)/);
    assert.match(deleteSource, /targetNode\.connectedEdges\(\)\.empty\(\)/);
    assert.match(deleteSource, /getVehicleOverlayNodeId\(targetId\)/);
    assert.match(deleteSource, /cyInstance\.remove\(vehicleOverlay\)/);
    assert.match(deleteSource, /cyInstance\.remove\(targetNode\)/);
});
