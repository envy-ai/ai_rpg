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
            { target: 'Customs Hall', travelTimeMinutes: 4 },
            { target: 'Outer Concourse', travelTimeMinutes: 30 }
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
            { target: 'Customs Hall', travelTimeMinutes: 1 }
        ]);
    } finally {
        Region.removeFromIndex(region);
        Globals.config = previousConfig;
    }
});
