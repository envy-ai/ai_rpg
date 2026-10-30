const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Region = require('../Region.js');

test('Region.fromXMLSnippet parses nested exit destinations with travel times', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };

    const xml = `
<region>
  <regionName>Anchorpoint</regionName>
  <regionDescription>A trade hub.</regionDescription>
  <shortDescription>Busy starport region.</shortDescription>
  <locations>
    <location>
      <name>Docking Bay 7</name>
      <description>Ships come and go.</description>
      <shortDescription>A loud docking bay.</shortDescription>
      <relativeLevel>0</relativeLevel>
      <exits>
        <exit>
          <destination>Customs Hall</destination>
          <travelTime>4 minutes</travelTime>
        </exit>
        <exit>
          <destination>Outer Concourse</destination>
          <travelTime>0.5 hours</travelTime>
        </exit>
      </exits>
    </location>
  </locations>
</region>`;

    const region = Region.fromXMLSnippet(xml);
    try {
        assert.equal(region.locationBlueprints.length, 1);
        assert.deepEqual(Array.from(region.locationBlueprints[0].exits), [
            { target: 'Customs Hall', travelTimeMinutes: 4, hiddenFromPlayer: false, discoveryDifficulty: null },
            { target: 'Outer Concourse', travelTimeMinutes: 30, hiddenFromPlayer: false, discoveryDifficulty: null }
        ]);
    } finally {
        Region.removeFromIndex(region);
        Globals.config = previousConfig;
    }
});

test('Region.fromXMLSnippet normalizes explicit zero-minute exits to 1 minute', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };

    const xml = `
<region>
  <regionName>Anchorpoint</regionName>
  <regionDescription>A trade hub.</regionDescription>
  <shortDescription>Busy starport region.</shortDescription>
  <locations>
    <location>
      <name>Docking Bay 7</name>
      <description>Ships come and go.</description>
      <shortDescription>A loud docking bay.</shortDescription>
      <relativeLevel>0</relativeLevel>
      <exits>
        <exit>
          <destination>Customs Hall</destination>
          <travelTime>0 minutes</travelTime>
        </exit>
      </exits>
    </location>
  </locations>
</region>`;

    const region = Region.fromXMLSnippet(xml);
    try {
        assert.equal(region.locationBlueprints.length, 1);
        assert.deepEqual(Array.from(region.locationBlueprints[0].exits), [
            { target: 'Customs Hall', travelTimeMinutes: 1, hiddenFromPlayer: false, discoveryDifficulty: null }
        ]);
    } finally {
        Region.removeFromIndex(region);
        Globals.config = previousConfig;
    }
});

test('Region XML defaults omitted internal-exit discovery fields visible and preserves explicit metadata', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };
    const xml = `
<region>
  <regionName>Hidden Passage Region</regionName>
  <regionDescription>A region with discovered paths.</regionDescription>
  <locations><location>
    <name>Old Courtyard</name><description>A stone courtyard.</description>
    <exits>
      <exit><destination>Open Walkway</destination><travelTime>3 minutes</travelTime></exit>
      <exit><destination>Secret Stair</destination><travelTime>8 minutes</travelTime><hiddenFromPlayer>true</hiddenFromPlayer><discoveryDifficulty>hard</discoveryDifficulty></exit>
    </exits>
  </location></locations>
</region>`;

    let region;
    let restored;
    try {
        const data = Region.parseXMLSnippet(xml);
        assert.equal(Region.getByName('Hidden Passage Region'), null, 'pure parse must not register a Region');
        assert.deepEqual(JSON.parse(JSON.stringify(data.locations[0].exits)), [
            { target: 'Open Walkway', travelTimeMinutes: 3, hiddenFromPlayer: false, discoveryDifficulty: null },
            { target: 'Secret Stair', travelTimeMinutes: 8, hiddenFromPlayer: true, discoveryDifficulty: 'Hard' }
        ]);

        region = new Region(data);
        restored = Region.fromJSON(JSON.parse(JSON.stringify(region.toJSON())));
        assert.deepEqual(JSON.parse(JSON.stringify(restored.locationBlueprints[0].exits)), [
            { target: 'Open Walkway', travelTimeMinutes: 3, hiddenFromPlayer: false, discoveryDifficulty: null },
            { target: 'Secret Stair', travelTimeMinutes: 8, hiddenFromPlayer: true, discoveryDifficulty: 'Hard' }
        ]);
    } finally {
        if (restored) Region.removeFromIndex(restored);
        if (region) Region.removeFromIndex(region);
        Globals.config = previousConfig;
    }
});

test('Region XML parsing keeps the outer region when vehicle destinations contain nested region tags', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };
    const xml = `
<region>
  <regionName>Outer Region</regionName><regionDescription>The intended root region.</regionDescription>
  <shortDescription>Outer region</shortDescription>
  <weather><hasDynamicWeather>false</hasDynamicWeather></weather>
  <locations><location>
    <name>Transit Hub</name><description>A central platform.</description>
    <exits><exit><destination>East Platform</destination><travelTime>3 minutes</travelTime></exit></exits>
    <vehicles><vehicle><name>Regional Shuttle</name><destinations>
      <destination><region>Far Province</region><location>North Station</location></destination>
    </destinations></vehicle></vehicles>
  </location></locations>
</region>
<navigationNotes><containedRegions>Far Province</containedRegions></navigationNotes>`;

    try {
        const parsed = Region.parseXMLSnippet(xml);
        assert.equal(Region.getByName('Outer Region'), null, 'pure parsing does not register the region');
        assert.equal(parsed.name, 'Outer Region');
        assert.equal(parsed.locations.length, 1);
        assert.deepEqual(JSON.parse(JSON.stringify(parsed.locations[0].exits)), [
            { target: 'East Platform', travelTimeMinutes: 3, hiddenFromPlayer: false, discoveryDifficulty: null }
        ]);
        assert.deepEqual(JSON.parse(JSON.stringify(parsed.weather)), {
            hasDynamicWeather: false,
            seasonWeather: []
        });
    } finally {
        Globals.config = previousConfig;
    }
});
