const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

test('player equipment route rejects string-valued equip errors instead of treating them as success', () => {
  const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
  const routeStart = apiSource.indexOf("app.post('/api/player/equip'");
  const routeEnd = apiSource.indexOf('// Player Stats Configuration Routes', routeStart);

  assert.notEqual(routeStart, -1, 'Unable to locate /api/player/equip route.');
  assert.notEqual(routeEnd, -1, 'Unable to locate the end of /api/player/equip route.');

  const routeSource = apiSource.slice(routeStart, routeEnd);
  assert.match(routeSource, /const equipResult = currentPlayer\.equipItemInSlot\(targetItem, resolvedSlotName\);/);
  assert.match(routeSource, /if \(equipResult !== true\)/);
  assert.match(routeSource, /typeof equipResult === 'string' && equipResult\.trim\(\)/);
  assert.doesNotMatch(routeSource, /actionSucceeded = currentPlayer\.equipItemInSlot/);
});
