const test = require('node:test');
const assert = require('node:assert/strict');

const Location = require('../Location.js');
const Region = require('../Region.js');
const Globals = require('../Globals.js');

Globals.config = Globals.config || {};

function uniqueId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function cleanupLocation(location) {
    if (location) {
        Location.removeFromIndex(location);
    }
}

function cleanupRegion(region) {
    if (region) {
        Region.removeFromIndex(region);
    }
}

test('Region.fromXMLSnippet accepts generator output without optional random event or concept sections', () => {
    const region = Region.fromXMLSnippet(`
<region>
  <regionName>${uniqueId('Optional Sections Region')}</regionName>
  <regionDescription>A test region with only required generator fields.</regionDescription>
  <shortDescription>A sparse generated region.</shortDescription>
  <relativeLevel>1</relativeLevel>
  <numImportantNPCs>0</numImportantNPCs>
  <weather>
    <hasDynamicWeather>false</hasDynamicWeather>
  </weather>
  <locations>
    <location>
      <name>Quiet Platform</name>
      <description>A two-paragraph location body would normally be here.</description>
      <shortDescription>A quiet generated platform.</shortDescription>
      <hasWeather>no</hasWeather>
      <controllingFaction>None</controllingFaction>
      <relativeLevel>0</relativeLevel>
      <numNPCs>0</numNPCs>
      <numHostiles>0</numHostiles>
      <exits></exits>
    </location>
  </locations>
  <secrets></secrets>
</region>`);

    try {
        assert.deepEqual(region.randomEvents, []);
        assert.deepEqual(region.characterConcepts, []);
        assert.deepEqual(region.enemyConcepts, []);
        assert.equal(region.locationBlueprints.length, 1);
    } finally {
        cleanupRegion(region);
    }
});

test('Location.fromXMLSnippet promotes a stub without optional random event or concept sections', () => {
    const region = new Region({
        id: uniqueId('region_optional_location_sections'),
        name: uniqueId('Optional Location Section Region'),
        description: 'A region for optional location section tests.'
    });
    let stub = null;
    try {
        stub = new Location({
            id: uniqueId('loc_optional_sections_stub'),
            name: 'Quiet Hangar Shelf',
            description: null,
            shortDescription: 'A windswept platform.',
            baseLevel: null,
            regionId: region.id,
            isStub: true,
            stubMetadata: {
                regionId: region.id,
                shortDescription: 'A windswept platform.',
                locationPurpose: 'Test optional generator sections.'
            }
        });

        const expanded = Location.fromXMLSnippet(`
<location>
  <name>Quiet Hangar Shelf</name>
  <description>A windswept platform waits under a cold sky.</description>
  <relativeLevel>0</relativeLevel>
  <numNpcs>0</numNpcs>
  <numHostiles>0</numHostiles>
  <numItems>1</numItems>
  <numScenery>2</numScenery>
  <shortDescription>A cold windswept platform.</shortDescription>
</location>`, {
            existingLocation: stub,
            baseLevelFallback: 3,
            relativeLevelBase: 3,
            regionId: region.id
        });

        assert.equal(expanded, stub);
        assert.equal(expanded.isStub, false);
        assert.deepEqual(expanded.randomEvents, []);
        assert.deepEqual(expanded.characterConcepts, []);
        assert.deepEqual(expanded.enemyConcepts, []);
    } finally {
        cleanupLocation(stub);
        cleanupRegion(region);
    }
});
