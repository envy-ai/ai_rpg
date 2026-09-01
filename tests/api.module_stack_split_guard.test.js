const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('manual stack splitting rejects base items and module items with live module links', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const helperStart = source.indexOf('        function hasThingModuleRelationships(thing) {');
    const helperEnd = source.indexOf('        function resolveCraftConsumedThings({', helperStart);
    assert.notEqual(helperStart, -1, 'Could not locate module relationship helper.');
    assert.notEqual(helperEnd, -1, 'Could not locate helper boundary.');
    const helper = source.slice(helperStart, helperEnd);

    const separateStart = source.indexOf("        app.post('/api/things/:id/separate'");
    const start = source.indexOf("        app.post('/api/things/:id/split-stack'");
    const end = source.indexOf("        app.post('/api/things/:id/merge-stacks'", start);
    assert.notEqual(separateStart, -1, 'Could not locate separate route.');
    assert.notEqual(start, -1, 'Could not locate split-stack route.');
    assert.notEqual(end, -1, 'Could not locate route after split-stack.');

    const separateRoute = source.slice(separateStart, start);
    const route = source.slice(start, end);
    assert.match(helper, /getExtensionField\('installedModuleIds'\)/);
    assert.match(helper, /getExtensionField\('moduleInstalledOnItemId'\)/);
    assert.match(separateRoute, /hasThingModuleRelationships\(sourceThing\)/);
    assert.match(separateRoute, /Installed modules must be removed before this thing can be separated\./);
    assert.match(route, /hasThingModuleRelationships\(sourceThing\)/);
    assert.match(route, /Installed modules must be removed before this stack can be split\./);
    assert.ok(
        route.indexOf('hasThingModuleRelationships(sourceThing)') < route.indexOf('sourceThing.copy({'),
        'Module links must be rejected before a copy can duplicate their ids.'
    );
});
