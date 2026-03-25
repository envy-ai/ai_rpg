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
        assert.deepEqual(
            Array.from(locations, location => location.name),
            ['Hangar Edge', 'Debris Field Theta']
        );
    } finally {
        Globals.config = previousConfig;
    }
});
