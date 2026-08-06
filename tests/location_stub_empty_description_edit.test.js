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

test('stub edit route accepts separate blank long and short descriptions', () => {
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
  assert.match(routeSource, /const hasShortDescription = hasOwn\.call\(body, 'shortDescription'\);/);
  assert.match(routeSource, /Stub short description must be a string/);
  assert.match(routeSource, /const shortDescriptionValue = hasShortDescription \? body\.shortDescription\.trim\(\) : undefined;/);
  assert.match(routeSource, /shortDescription: shortDescriptionValue/);
  assert.match(routeSource, /shortDescription: resolvedShortDescription/);
  assert.doesNotMatch(routeSource, /Stub description cannot be empty/);
  assert.match(routeSource, /typeof body\.description !== 'string'[\s\S]*Stub description must be a string/);

  assert.match(syncSource, /const hasDescriptionUpdate = typeof rawDescription === 'string';/);
  assert.match(syncSource, /const hasShortDescriptionUpdate = typeof rawShortDescription === 'string';/);
  assert.match(syncSource, /const shouldUpdateShortDescription = hasShortDescriptionUpdate \|\| hasDescriptionUpdate;/);
  assert.match(syncSource, /metadata\.shortDescription !== normalizedShortDescription/);
  assert.match(syncSource, /hasDescriptionUpdate && metadata\.blueprintDescription !== normalizedDescription/);
  assert.match(syncSource, /hasDescriptionUpdate && metadata\.stubDescription !== normalizedDescription/);
  assert.match(syncSource, /metadata\.stubShortDescription !== normalizedShortDescription/);
  assert.match(syncSource, /stubLocation\.shortDescription = normalizedShortDescription/);
  assert.match(syncSource, /hasDescriptionUpdate && metadata\.targetRegionDescription !== normalizedDescription/);
  assert.match(syncSource, /hasDescriptionUpdate && updated\.description !== normalizedDescription/);
});

test('stub editor loads, displays, and submits a separate short description', () => {
  const setModeSource = sliceBetween(
    viewSource,
    'function setLocationEditMode',
    'function openLocationEditModalForTarget'
  );
  const openSource = sliceBetween(
    viewSource,
    'function openLocationEditModalForTarget',
    'function openLocationEditModal()'
  );
  const stubSubmitSource = sliceBetween(
    viewSource,
    "if (locationEditMode === 'stub')",
    'const vehicleResult = collectVehicleInfoFromEditor'
  );

  assert.match(setModeSource, /locationEditDescriptionInput\.required = !isStubMode;/);
  assert.match(setModeSource, /toggleLocationEditSection\(locationEditShortDescriptionGroup, true\);/);
  assert.match(setModeSource, /locationEditShortDescriptionInput\.disabled = false;/);
  assert.doesNotMatch(setModeSource, /locationEditShortDescriptionInput\.value = ''/);
  assert.match(openSource, /resolveStubShortDescription\(targetLocation\)/);
  assert.doesNotMatch(stubSubmitSource, /Stub description cannot be empty/);
  assert.match(stubSubmitSource, /description:\s*descriptionValue\.trim\(\)/);
  assert.match(stubSubmitSource, /shortDescription:\s*shortDescriptionValue\.trim\(\)/);
});

test('stub edit docs mention separate short descriptions and blank values', () => {
  assert.match(locationsDocs, /`description` \(required string; may be empty\)/);
  assert.match(locationsDocs, /`shortDescription` \(optional string; may be empty\)/);
  assert.match(modalDocs, /stub descriptions.*may be left empty/i);
  assert.match(modalDocs, /stub short descriptions/i);
  assert.match(readmeDocs, /editable stub short descriptions/i);
});
