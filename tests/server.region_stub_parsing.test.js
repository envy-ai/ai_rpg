const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');

function loadParseRegionStubLocations() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function parseRegionStubLocations(xmlSnippet) {');
    const end = source.indexOf('\nfunction parseRegionVehicleDefinitions(xmlSnippet) {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate parseRegionStubLocations in server.js');
    }

    const functionSource = source.slice(start, end);
    const context = { Utils, console };
    vm.createContext(context);
    vm.runInContext(`${functionSource}\nthis.parseRegionStubLocations = parseRegionStubLocations;`, context);
    return context.parseRegionStubLocations;
}

function toPlainJson(value) {
    return JSON.parse(JSON.stringify(value));
}

test('parseRegionStubLocations ignores nested vehicle destination location tags', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };

    try {
        const parseRegionStubLocations = loadParseRegionStubLocations();
        const xml = `
<region>
  <locations>
    <location>
      <name>Hangar Edge</name>
      <description>A docking edge.</description>
      <vehicles>
        <vehicle>
          <name>Shuttle</name>
          <destinations>
            <destination>
              <region>Anchorpoint Station</region>
              <location>Docking Bay 7</location>
            </destination>
          </destinations>
        </vehicle>
      </vehicles>
    </location>
    <location>
      <name>Debris Field Theta</name>
      <description>A dangerous salvage zone.</description>
    </location>
  </locations>
</region>`;

        const locations = parseRegionStubLocations(xml);

        assert.equal(locations.length, 2);
        assert.deepEqual(Array.from(locations, location => location.name), [
            'Hangar Edge',
            'Debris Field Theta'
        ]);
        assert.deepEqual(
            toPlainJson(Array.from(locations, location => location.exits)),
            [[], []]
        );
    } finally {
        Globals.config = previousConfig;
    }
});

test('parseRegionStubLocations parses per-exit travel times into integer minutes', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };

    try {
        const parseRegionStubLocations = loadParseRegionStubLocations();
        const xml = `
<region>
  <locations>
    <location>
      <name>Town Square</name>
      <description>The center of town.</description>
      <exits>
        <exit>
          <destination>North Gate</destination>
          <travelTime>5 minutes</travelTime>
        </exit>
        <exit>
          <destination>Clocktower</destination>
          <travelTime>1.5 hours</travelTime>
        </exit>
      </exits>
    </location>
  </locations>
</region>`;

        const locations = parseRegionStubLocations(xml);

        assert.equal(locations.length, 1);
        assert.deepEqual(
            toPlainJson(Array.from(locations[0].exits)),
            [
                { target: 'North Gate', travelTimeMinutes: 5 },
                { target: 'Clocktower', travelTimeMinutes: 90 }
            ]
        );
    } finally {
        Globals.config = previousConfig;
    }
});

test('parseRegionStubLocations normalizes explicit zero-minute exits to 1 minute', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };

    try {
        const parseRegionStubLocations = loadParseRegionStubLocations();
        const xml = `
<region>
  <locations>
    <location>
      <name>Town Square</name>
      <description>The center of town.</description>
      <exits>
        <exit>
          <destination>North Gate</destination>
          <travelTime>0 minutes</travelTime>
        </exit>
      </exits>
    </location>
  </locations>
</region>`;

        const locations = parseRegionStubLocations(xml);

        assert.equal(locations.length, 1);
        assert.deepEqual(
            toPlainJson(Array.from(locations[0].exits)),
            [
                { target: 'North Gate', travelTimeMinutes: 1 }
            ]
        );
    } finally {
        Globals.config = previousConfig;
    }
});
