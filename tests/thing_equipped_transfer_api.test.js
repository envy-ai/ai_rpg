const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function readThingRoute(apiSource, route, nextMarker) {
  const start = apiSource.indexOf(`app.post('${route}'`);
  const end = apiSource.indexOf(nextMarker, start);
  assert.notEqual(start, -1, `Unable to locate ${route}.`);
  assert.notEqual(end, -1, `Unable to locate end marker for ${route}.`);
  return apiSource.slice(start, end);
}

test('all direct Thing transfer routes reject equipped items before mutation', () => {
  const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
  const routes = [
    readThingRoute(apiSource, '/api/things/:id/give', "app.post('/api/things/:id/teleport'"),
    readThingRoute(apiSource, '/api/things/:id/teleport', 'function detachThingFromContainingContainers'),
    readThingRoute(apiSource, '/api/things/:id/drop', '// Delete a thing')
  ];

  for (const routeSource of routes) {
    assert.match(routeSource, /if \(thing\.isEquipped \|\| thing\.equippedSlot\)/);
    assert.match(routeSource, /Equipped items must be unequipped before they can be moved\./);
    assert.match(routeSource, /status\(400\)/);
  }
});
