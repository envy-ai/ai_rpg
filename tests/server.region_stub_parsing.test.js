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

function loadParseRegionExitsResponse() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function parseRegionExitsResponse(xmlSnippet) {');
    const end = source.indexOf('\nasync function renderRegionStubPrompt({', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate parseRegionExitsResponse in server.js');
    }

    const functionSource = source.slice(start, end);
    const context = { Utils, console };
    vm.createContext(context);
    vm.runInContext(`${functionSource}\nthis.parseRegionExitsResponse = parseRegionExitsResponse;`, context);
    return context.parseRegionExitsResponse;
}

function loadGenerateRegionExitStubs() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function generateRegionExitStubs({');
    const end = source.indexOf('\nasync function generateVehicleStubs({', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate generateRegionExitStubs in server.js');
    }

    const functionSource = source.slice(start, end);
    const ensureCalls = [];
    const pendingRegionStubs = new Map();
    const gameLocations = new Map();

    class StubLocation {
        static findByName() {
            return null;
        }

        constructor(data = {}) {
            Object.assign(this, data);
            this.id = data.id || 'stub-location-id';
            this.name = data.name || 'Unnamed Stub';
            this.stubMetadata = data.stubMetadata || {};
        }
    }

    const context = {
        console,
        getBannedLocationNameSet: () => new Set(),
        isLocationNameBanned: () => false,
        Region: { getByName: () => null },
        regenerateRegionNames: async () => {},
        normalizeRegionLocationName: (value) => String(value || '').trim().toLowerCase(),
        gameLocations,
        resolveFactionNameToId: () => ({ id: null }),
        connectExistingRegion: async () => {
            throw new Error('connectExistingRegion should not be called in this test');
        },
        Location: StubLocation,
        generateRegionStubId: () => 'region_stub_test',
        clampLevel: (value) => value,
        directionKeyFromName: () => 'north',
        randomIntInclusive: () => 123,
        normalizeDirection: (value) => value,
        ensureLocationNameAllowed: async () => {},
        ensureExitConnection: (...args) => {
            ensureCalls.push(args);
            return { id: `exit_${ensureCalls.length}` };
        },
        pendingRegionStubs
    };
    vm.createContext(context);
    vm.runInContext(`${functionSource}\nthis.generateRegionExitStubs = generateRegionExitStubs;`, context);
    return {
        generateRegionExitStubs: context.generateRegionExitStubs,
        ensureCalls,
        pendingRegionStubs,
        gameLocations
    };
}

function loadConnectExistingRegion() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function connectExistingRegion({');
    const end = source.indexOf('\n\nfunction parseRegionEntranceResponse(xmlSnippet) {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate connectExistingRegion in server.js');
    }

    const functionSource = source.slice(start, end);
    const ensureCalls = [];
    const gameLocations = new Map();

    const context = {
        console,
        chooseExistingRegionExit: async () => ({ name: 'Remote Gate' }),
        normalizeRegionLocationName: (value) => String(value || '').trim().toLowerCase(),
        gameLocations,
        currentPlayer: { level: 1 },
        ensureExitConnection: (...args) => {
            ensureCalls.push(args);
            return { id: `exit_${ensureCalls.length}` };
        }
    };
    vm.createContext(context);
    vm.runInContext(`${functionSource}\nthis.connectExistingRegion = connectExistingRegion;`, context);
    return {
        connectExistingRegion: context.connectExistingRegion,
        ensureCalls,
        gameLocations
    };
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

test('parseRegionExitsResponse parses stubRegion travel times into integer minutes', () => {
    const previousConfig = Globals.config;
    Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };

    try {
        const parseRegionExitsResponse = loadParseRegionExitsResponse();
        const xml = `
<location>
  <name>Town Square</name>
  <regionExits>
    <stubRegion type="connectedRegion">
      <regionName>Clockwork Quarter</regionName>
      <regionDescription>A district of gears.</regionDescription>
      <relativeLevel>2</relativeLevel>
      <relationshipToCurrentRegion>Adjacent</relationshipToCurrentRegion>
      <travelTime>1.5 hours</travelTime>
    </stubRegion>
  </regionExits>
</location>`;

        const exits = parseRegionExitsResponse(xml);

        assert.equal(exits.length, 1);
        assert.deepEqual(
            toPlainJson(exits),
            [
                {
                    name: 'Clockwork Quarter',
                    description: 'A district of gears.',
                    relativeLevel: 2,
                    relationship: 'Adjacent',
                    exitLocation: 'Town Square',
                    exitVehicle: null,
                    controllingFaction: null,
                    travelTimeMinutes: 90
                }
            ]
        );
    } finally {
        Globals.config = previousConfig;
    }
});

test('generateRegionExitStubs applies parsed travel time to new pending region exits without persisting it on the stub record', async () => {
    const {
        generateRegionExitStubs,
        ensureCalls,
        pendingRegionStubs,
        gameLocations
    } = loadGenerateRegionExitStubs();

    const sourceLocation = {
        id: 'source-location-id',
        name: 'Town Square',
        getAvailableDirections: () => [],
        getExit: () => null
    };
    gameLocations.set(sourceLocation.id, sourceLocation);

    const region = {
        id: 'region-id',
        name: 'Market Ward',
        locationIds: [sourceLocation.id],
        parentRegionId: null,
        entranceLocationId: sourceLocation.id
    };
    const stubMap = new Map([
        ['town square', sourceLocation]
    ]);

    await generateRegionExitStubs({
        region,
        stubMap,
        settingDescription: 'Bustling market city',
        regionAverageLevel: 5,
        predefinedDefinitions: [
            {
                name: 'Clockwork Quarter',
                description: 'A district of gears.',
                relativeLevel: 2,
                relationship: 'Adjacent',
                exitLocation: 'Town Square',
                exitVehicle: null,
                controllingFaction: null,
                travelTimeMinutes: 45
            }
        ]
    });

    assert.equal(ensureCalls.length, 1);
    assert.equal(ensureCalls[0][2].travelTimeMinutes, 45);

    const pendingStub = pendingRegionStubs.get('region_stub_test');
    assert.ok(pendingStub);
    assert.equal(Object.prototype.hasOwnProperty.call(pendingStub, 'travelTimeMinutes'), false);
});

test('connectExistingRegion mirrors parsed travel time onto both directions for existing regions', async () => {
    const {
        connectExistingRegion,
        ensureCalls,
        gameLocations
    } = loadConnectExistingRegion();

    const sourceLocation = {
        id: 'source-location-id',
        name: 'Town Square',
        baseLevel: 5
    };
    const remoteLocation = {
        id: 'remote-location-id',
        name: 'Remote Gate'
    };
    gameLocations.set(remoteLocation.id, remoteLocation);

    await connectExistingRegion({
        region: {
            id: 'source-region-id',
            name: 'Market Ward',
            averageLevel: 5
        },
        sourceLocation,
        existingRegion: {
            id: 'target-region-id',
            name: 'Clockwork Quarter',
            locationIds: [remoteLocation.id]
        },
        definition: {
            travelTimeMinutes: 30,
            exitVehicle: null,
            relativeLevel: null
        }
    });

    assert.equal(ensureCalls.length, 2);
    assert.equal(ensureCalls[0][2].travelTimeMinutes, 30);
    assert.equal(ensureCalls[1][2].travelTimeMinutes, 30);
});
