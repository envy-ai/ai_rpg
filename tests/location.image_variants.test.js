const test = require('node:test');
const assert = require('node:assert/strict');

const Location = require('../Location.js');
const Region = require('../Region.js');

function createRegion() {
  return new Region({
    id: `region_test_${Date.now()}_${Math.random()}`,
    name: `Test Region ${Math.random()}`,
    description: 'A test region.'
  });
}

test('Location image variants persist through toJSON and constructor hydration', () => {
  const region = createRegion();
  const location = new Location({
    id: `location_test_${Date.now()}_${Math.random()}`,
    name: 'Rainy Square',
    description: 'A public square.',
    regionId: region.id,
    imageId: 'base-image'
  });

  location.setImageVariant('base-image__daylight__rain', {
    sourceImageId: 'base-image',
    imageId: 'variant-image',
    jobId: null,
    conditions: {
      lightingLabel: 'Daylight',
      weatherName: 'Rain'
    },
    prompt: 'Edit the image for rain.'
  });

  const serialized = location.toJSON();
  assert.equal(serialized.imageVariants['base-image__daylight__rain'].imageId, 'variant-image');

  const hydrated = new Location({
    ...serialized,
    id: `location_test_hydrated_${Date.now()}_${Math.random()}`,
    regionId: region.id,
    checkRegionId: true
  });

  assert.equal(
    hydrated.getImageVariant('base-image__daylight__rain').conditions.weatherName,
    'Rain'
  );
});

test('Location image variant clearing returns removed entries and supports source filtering', () => {
  const region = createRegion();
  const location = new Location({
    id: `location_test_clear_${Date.now()}_${Math.random()}`,
    name: 'Fog Gate',
    description: 'A gate in fog.',
    regionId: region.id,
    imageId: 'base-a'
  });

  location.setImageVariant('base-a__night__fog', {
    sourceImageId: 'base-a',
    imageId: 'variant-a'
  });
  location.setImageVariant('base-b__night__fog', {
    sourceImageId: 'base-b',
    imageId: 'variant-b'
  });

  const removed = location.clearImageVariants({ sourceImageId: 'base-a' });
  assert.deepEqual(removed.map(entry => entry.imageId), ['variant-a']);
  assert.equal(location.getImageVariant('base-a__night__fog'), null);
  assert.equal(location.getImageVariant('base-b__night__fog').imageId, 'variant-b');
});

test('Location image variant cache misses when the source image id changes', () => {
  const region = createRegion();
  const location = new Location({
    id: `location_test_source_${Date.now()}_${Math.random()}`,
    name: 'Changing Plaza',
    description: 'A plaza with a new mural.',
    regionId: region.id,
    imageId: 'base-old'
  });

  location.setImageVariant('base-old__daylight__clear', {
    sourceImageId: 'base-old',
    imageId: 'variant-old'
  });

  location.imageId = 'base-new';

  assert.equal(location.getImageVariant('base-new__daylight__clear'), null);
  assert.equal(location.getImageVariant('base-old__daylight__clear').sourceImageId, 'base-old');
});
