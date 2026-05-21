const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const rootDir = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const locationsDocs = fs.readFileSync(path.join(rootDir, 'docs', 'api', 'locations.md'), 'utf8');
const modalDocs = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'modals_overlays.md'), 'utf8');
const readmeDocs = fs.readFileSync(path.join(rootDir, 'docs', 'README.md'), 'utf8');

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notStrictEqual(start, -1, `Missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notStrictEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('stub edit route accepts blank descriptions and clears stub description metadata', () => {
  const routeSource = sliceBetween(
    apiSource,
    "app.put('/api/stubs/:id'",
    "app.post('/api/stubs/:id/expand'"
  );
  const syncSource = sliceBetween(
    apiSource,
    'function syncStubPresentationWithExit',
    "app.get('/api/exits/options'"
  );

  assert.match(routeSource, /const descriptionValue = typeof body\.description === 'string' \? body\.description\.trim\(\) : '';/);
  assert.doesNotMatch(routeSource, /Stub description cannot be empty/);
  assert.match(routeSource, /typeof body\.description !== 'string'[\s\S]*Stub description must be a string/);

  assert.match(syncSource, /const hasDescriptionUpdate = typeof rawDescription === 'string';/);
  assert.match(syncSource, /hasDescriptionUpdate && metadata\.shortDescription !== normalizedDescription/);
  assert.match(syncSource, /hasDescriptionUpdate && metadata\.blueprintDescription !== normalizedDescription/);
  assert.match(syncSource, /hasDescriptionUpdate && metadata\.stubDescription !== normalizedDescription/);
  assert.match(syncSource, /hasDescriptionUpdate && metadata\.stubShortDescription !== normalizedDescription/);
  assert.match(syncSource, /hasDescriptionUpdate && metadata\.targetRegionDescription !== normalizedDescription/);
  assert.match(syncSource, /hasDescriptionUpdate && updated\.description !== normalizedDescription/);
});

test('stub editor submits blank descriptions instead of blocking them client-side', () => {
  const setModeSource = sliceBetween(
    viewSource,
    'function setLocationEditMode',
    'function openLocationEditModalForTarget'
  );
  const stubSubmitSource = sliceBetween(
    viewSource,
    "if (locationEditMode === 'stub')",
    'const vehicleResult = collectVehicleInfoFromEditor'
  );

  assert.match(setModeSource, /locationEditDescriptionInput\.required = !isStubMode;/);
  assert.doesNotMatch(stubSubmitSource, /Stub description cannot be empty/);
  assert.match(stubSubmitSource, /description:\s*descriptionValue\.trim\(\)/);
});

test('stub edit docs mention that descriptions may be empty', () => {
  assert.match(locationsDocs, /`description` \(required string; may be empty\)/);
  assert.match(modalDocs, /stub descriptions may be left empty/i);
  assert.match(readmeDocs, /blank stub descriptions/i);
});
