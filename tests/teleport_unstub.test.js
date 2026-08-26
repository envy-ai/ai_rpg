const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
const Player = require('../Player.js');
const TeleportCommand = require('../slashcommands/teleport.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

const rootDir = path.join(__dirname, '..');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-teleport-unstub-'
    }, run);
}

function makeInteraction(playerId, replies) {
    return {
        user: { id: playerId },
        reply: (payload) => {
            replies.push(payload);
            return payload;
        }
    };
}

function makeStubLocation(region, { name, isRegionEntryStub = false } = {}) {
    return new Location({
        name,
        isStub: true,
        stubMetadata: isRegionEntryStub
            ? { isRegionEntryStub: true, targetRegionId: 'region_pending_1' }
            : { themeHint: 'cave' },
        regionId: region.id
    });
}

test('teleport to a regular stub expands it before moving the player', async () => {
    await withTempPlayerEnvironment(async () => {
        const region = new Region({ name: 'Home Region', description: 'Origin region.' });
        const origin = new Location({ name: 'Origin', description: 'Start.', baseLevel: 1, regionId: region.id });
        const stub = makeStubLocation(region, { name: 'Stub Cave' });
        const player = new Player({ name: 'Exis', isNPC: false });
        player.setLocation(origin);

        const expansionCalls = [];
        const replies = [];
        const helpers = {
            scheduleStubExpansion: async (location) => {
                expansionCalls.push(location.id);
                location.promoteFromStub({
                    description: 'A fully realized cave.',
                    baseLevel: 1,
                    npcIds: [],
                    thingIds: []
                });
            },
            expandRegionEntryStub: async () => {
                throw new Error('expandRegionEntryStub must not be used for a regular stub.');
            }
        };

        const previousResolver = TeleportCommand._resolveExpansionHelpers;
        TeleportCommand._resolveExpansionHelpers = () => helpers;
        try {
            await TeleportCommand.execute(makeInteraction(player.id, replies), { destination: stub.id });
        } finally {
            TeleportCommand._resolveExpansionHelpers = previousResolver;
        }

        assert.deepEqual(expansionCalls, [stub.id]);
        assert.equal(stub.isStub, false);
        assert.equal(player.currentLocation, stub.id);
        assert.match(replies[0]?.content || '', /Teleported to Stub Cave/);
    });
});

test('teleport to a region entry stub expands the region and moves to the expanded location', async () => {
    await withTempPlayerEnvironment(async () => {
        const region = new Region({ name: 'Home Region', description: 'Origin region.' });
        const origin = new Location({ name: 'Origin', description: 'Start.', baseLevel: 1, regionId: region.id });
        const stub = makeStubLocation(region, { name: 'Region Gate', isRegionEntryStub: true });
        const player = new Player({ name: 'Exis', isNPC: false });
        player.setLocation(origin);

        const expandedRegion = new Region({ name: 'Unstubbed Region', description: 'Now real.' });
        const expandedLocation = new Location({
            name: 'Gate Town',
            description: 'A real gate town.',
            baseLevel: 2,
            regionId: expandedRegion.id
        });

        const expansionCalls = [];
        const replies = [];
        const helpers = {
            scheduleStubExpansion: async () => {
                throw new Error('scheduleStubExpansion must not be used for a region entry stub.');
            },
            expandRegionEntryStub: async (location) => {
                expansionCalls.push(location.id);
                return expandedLocation;
            }
        };

        const previousResolver = TeleportCommand._resolveExpansionHelpers;
        TeleportCommand._resolveExpansionHelpers = () => helpers;
        try {
            await TeleportCommand.execute(makeInteraction(player.id, replies), { destination: stub.id });
        } finally {
            TeleportCommand._resolveExpansionHelpers = previousResolver;
        }

        assert.deepEqual(expansionCalls, [stub.id]);
        assert.equal(player.currentLocation, expandedLocation.id);
        assert.match(replies[0]?.content || '', /Teleported to Gate Town/);
    });
});

test('teleport to a non-stub location skips expansion entirely', async () => {
    await withTempPlayerEnvironment(async () => {
        const region = new Region({ name: 'Home Region', description: 'Origin region.' });
        const origin = new Location({ name: 'Origin', description: 'Start.', baseLevel: 1, regionId: region.id });
        const real = new Location({ name: 'Real Place', description: 'Not a stub.', baseLevel: 1, regionId: region.id });
        const player = new Player({ name: 'Exis', isNPC: false });
        player.setLocation(origin);

        const replies = [];
        const helpers = {
            scheduleStubExpansion: async () => {
                throw new Error('Expansion must not run for a non-stub destination.');
            },
            expandRegionEntryStub: async () => {
                throw new Error('Expansion must not run for a non-stub destination.');
            }
        };

        const previousResolver = TeleportCommand._resolveExpansionHelpers;
        TeleportCommand._resolveExpansionHelpers = () => helpers;
        try {
            await TeleportCommand.execute(makeInteraction(player.id, replies), { destination: real.id });
        } finally {
            TeleportCommand._resolveExpansionHelpers = previousResolver;
        }

        assert.equal(player.currentLocation, real.id);
        assert.match(replies[0]?.content || '', /Teleported to Real Place/);
    });
});

test('expansion that leaves the location stubbed fails instead of moving the player', async () => {
    await withTempPlayerEnvironment(async () => {
        const region = new Region({ name: 'Home Region', description: 'Origin region.' });
        const origin = new Location({ name: 'Origin', description: 'Start.', baseLevel: 1, regionId: region.id });
        const stub = makeStubLocation(region, { name: 'Stub Cave' });
        const player = new Player({ name: 'Exis', isNPC: false });
        player.setLocation(origin);

        const helpers = {
            scheduleStubExpansion: async () => {},
            expandRegionEntryStub: async () => null
        };

        await assert.rejects(
            TeleportCommand.expandStubDestination(stub, helpers),
            /still stubbed after expansion/
        );
        assert.equal(player.currentLocation, origin.id);

        await assert.rejects(
            TeleportCommand.expandStubDestination(
                makeStubLocation(region, { name: 'Gate', isRegionEntryStub: true }),
                helpers
            ),
            /Failed to expand the region/
        );
    });
});

test('story-tool player teleport un-stubs stub destinations in the API route', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const start = apiSource.indexOf('if (!isNpc && storyToolTeleport) {');
    assert.notEqual(start, -1, 'Unable to locate storyToolTeleport branch');
    const end = apiSource.indexOf('const partyMemberIds = isNpc', start);
    assert.notEqual(end, -1, 'Unable to locate end of storyToolTeleport branch');
    const route = apiSource.slice(start, end);

    assert.match(route, /effectiveDestinationLocation\.isStub/);
    assert.match(route, /stubMetadata\?\.isRegionEntryStub/);
    assert.match(route, /expandRegionEntryStub\(effectiveDestinationLocation\)/);
    assert.match(route, /scheduleStubExpansion\(effectiveDestinationLocation, \{\}\)/);
    assert.match(route, /still stubbed after expansion/);
    assert.match(route, /npc\.setLocation\(effectiveDestinationLocation\.id\)/);
    assert.match(route, /gameLocations\.set\(effectiveDestinationLocation\.id, effectiveDestinationLocation\)/);
});

test('region-map stub menu offers player teleport via the story-tool path', () => {
    const mapSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'map.js'), 'utf8');
    const start = mapSource.indexOf('const openStubContextMenu = (node, anchorPoint) => {');
    assert.notEqual(start, -1, 'Unable to locate openStubContextMenu');
    const end = mapSource.indexOf("cy.on('cxttap', 'edge'", start);
    assert.notEqual(end, -1, 'Unable to locate end of openStubContextMenu');
    const menu = mapSource.slice(start, end);

    assert.match(menu, /teleportBtn\.textContent = 'Teleport player here';/);
    assert.match(menu, /window\.currentPlayerData/);
    assert.match(menu, /window\.teleportNpcToLocation\(playerRecord, stubId, \{ storyToolTeleport: true \}\)/);
    assert.match(menu, /menu\.appendChild\(teleportBtn\);/);
});

test('shared hydrated-location map menu offers and executes player teleport via the story-tool path', async () => {
    const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
    const helperStart = viewSource.indexOf('async function teleportPlayerToSelectedMapLocation()');
    assert.notEqual(helperStart, -1, 'Unable to locate hydrated-location teleport helper');
    const helperEnd = viewSource.indexOf('async function expandSelectedMapStub()', helperStart);
    assert.notEqual(helperEnd, -1, 'Unable to locate end of hydrated-location teleport helper');
    const helper = viewSource.slice(helperStart, helperEnd);

    assert.match(viewSource, /id="mapLocationMenuTeleportPlayerButton"[^>]*>Teleport Player Here</);
    assert.match(viewSource, /const mapLocationMenuTeleportPlayerButton = document\.getElementById\('mapLocationMenuTeleportPlayerButton'\);/);
    assert.match(helper, /window\.currentPlayerData/);
    assert.match(helper, /playerRecord\.locationId \|\| playerRecord\.currentLocation/);
    assert.match(helper, /teleportNpcToLocation\(playerRecord, targetLocation\.id, \{ storyToolTeleport: true \}\)/);
    assert.match(helper, /targetLocation\.isStub \? ' It will be expanded first\.'/);
    assert.match(viewSource, /mapLocationMenuTeleportPlayerButton\.addEventListener\('click'/);

    const teleportCalls = [];
    let regionMapRefreshes = 0;
    let contextClears = 0;
    let overlayShows = 0;
    let overlayHides = 0;
    const targetLocation = { id: 'loc_hydrated', name: 'Hydrated Place', isStub: false };
    const playerRecord = { id: 'player_1', name: 'Player', locationId: 'loc_origin', isNPC: false };
    const context = vm.createContext({
        getLocationMenuContext: () => targetLocation,
        clearLocationMenuContext: () => { contextClears += 1; },
        showLocationOverlay: () => { overlayShows += 1; },
        hideLocationOverlay: () => { overlayHides += 1; },
        teleportNpcToLocation: async (...args) => { teleportCalls.push(args); },
        alert: message => { throw new Error(`Unexpected alert: ${message}`); },
        console: { warn: () => {} },
        document: {
            querySelector: selector => ({
                classList: { contains: () => selector === '[data-tab="map"]' }
            })
        },
        window: {
            currentPlayerData: playerRecord,
            confirm: message => message === 'Teleport the player to "Hydrated Place"?',
            loadRegionMap: async () => { regionMapRefreshes += 1; },
            loadWorldMap: async () => { throw new Error('Inactive World Map should not refresh.'); }
        }
    });
    vm.runInContext(`${helper}\nthis.teleportPlayerToSelectedMapLocation = teleportPlayerToSelectedMapLocation;`, context);
    await context.teleportPlayerToSelectedMapLocation();

    assert.equal(teleportCalls.length, 1);
    assert.equal(teleportCalls[0][0], playerRecord);
    assert.equal(teleportCalls[0][1], targetLocation.id);
    assert.equal(teleportCalls[0][2]?.storyToolTeleport, true);
    assert.equal(regionMapRefreshes, 1);
    assert.equal(contextClears, 1);
    assert.equal(overlayShows, 1);
    assert.equal(overlayHides, 1);
});
