const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nunjucks = require('nunjucks');

const {
    parseLocationExitSuggestions,
    shouldEncourageNewExitSuggestions
} = require('../LocationExitSuggestions.js');
const { runPromptWithParseRetries } = require('../PromptRetryPolicy.js');

const promptsDir = path.join(__dirname, '..', 'prompts');
const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(promptsDir),
    { autoescape: false }
);

function loadCreateSuggestedExitStubs({ createLocationFromEvent, createRegionStubFromEvent }) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function createSuggestedExitStubs(location, suggestions = []) {');
    const end = source.indexOf('\nconst stubExpansionPromises = new Map();', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate createSuggestedExitStubs in server.js');
    }

    const context = {
        createLocationFromEvent,
        createRegionStubFromEvent
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.createSuggestedExitStubs = createSuggestedExitStubs;`,
        context
    );
    return context.createSuggestedExitStubs;
}

function loadBuildLocationExitDiscoveryContext(gameLocations) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function buildLocationExitDiscoveryContext(location, originLocation = null) {');
    const end = source.indexOf('\nfunction filterNewExitSuggestionsToUnknownPlaces(suggestions = []) {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate buildLocationExitDiscoveryContext in server.js');
    }

    const context = { gameLocations, Set };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.buildLocationExitDiscoveryContext = buildLocationExitDiscoveryContext;`,
        context
    );
    return context.buildLocationExitDiscoveryContext;
}

test('suggested exits create the requested stub kinds and persist an empty decision', async () => {
    const calls = [];
    const createSuggestedExitStubs = loadCreateSuggestedExitStubs({
        createLocationFromEvent: async (options) => {
            calls.push({ kind: 'location', options });
            return { id: 'loc_child', name: options.name, isStub: true };
        },
        createRegionStubFromEvent: async (options) => {
            calls.push({ kind: 'region', options });
            return { id: 'loc_region_entry', name: options.name, isStub: true };
        }
    });
    let markCount = 0;
    const sourceLocation = {
        id: 'loc_source',
        name: 'Windcut Shelf',
        regionId: 'region_source',
        markStubsGenerated() {
            markCount += 1;
        }
    };
    const suggestions = [
        {
            destinationType: 'location',
            name: 'Goat Bell Ledge',
            description: 'A narrow switchback follows old bell posts.',
            travelTimeMinutes: 15
        },
        {
            destinationType: 'region',
            name: 'Cloudbreak Vale',
            description: 'A high pass descends into an unseen valley.',
            travelTimeMinutes: 120
        }
    ];

    const created = await createSuggestedExitStubs(sourceLocation, suggestions);
    assert.deepEqual(JSON.parse(JSON.stringify(created)), [
        { id: 'loc_child', name: 'Goat Bell Ledge', destinationType: 'location' },
        { id: 'loc_region_entry', name: 'Cloudbreak Vale', destinationType: 'region' }
    ]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].kind, 'location');
    assert.equal(calls[0].options.targetRegionId, 'region_source');
    assert.equal(calls[0].options.expandStub, false);
    assert.equal(calls[1].kind, 'region');
    assert.equal(calls[1].options.originLocation, sourceLocation);
    assert.equal(markCount, 1);

    calls.length = 0;
    markCount = 0;
    assert.deepEqual(JSON.parse(JSON.stringify(await createSuggestedExitStubs(sourceLocation, []))), []);
    assert.equal(calls.length, 0);
    assert.equal(markCount, 1);
});

test('location exit suggestions accept an explicit zero-exit decision', () => {
    const suggestions = parseLocationExitSuggestions(`
        <location>
            <name>Quiet Cellar</name>
            <newExits></newExits>
        </location>
    `, { required: true });

    assert.deepEqual(suggestions, []);
});

test('location exit suggestions parse location and region stubs without imposing a count', () => {
    const suggestions = parseLocationExitSuggestions(`
        <location>
            <name>Windcut Shelf</name>
            <newExits>
                <exit>
                    <destinationType>location</destinationType>
                    <name>Goat Bell Ledge</name>
                    <description>A narrow switchback follows old bell posts.</description>
                    <travelTime>15 minutes</travelTime>
                </exit>
                <exit>
                    <destinationType>region</destinationType>
                    <name>Cloudbreak Vale</name>
                    <description>A high pass descends into an unseen valley.</description>
                    <travelTime>2 hours</travelTime>
                </exit>
            </newExits>
        </location>
    `, { required: true });

    assert.deepEqual(suggestions, [
        {
            destinationType: 'location',
            name: 'Goat Bell Ledge',
            description: 'A narrow switchback follows old bell posts.',
            travelTimeMinutes: 15
        },
        {
            destinationType: 'region',
            name: 'Cloudbreak Vale',
            description: 'A high pass descends into an unseen valley.',
            travelTimeMinutes: 120
        }
    ]);
});

test('location exit suggestions collapse duplicate names that differ only by leading the', () => {
    const suggestions = parseLocationExitSuggestions(`
        <location>
            <name>Windcut Shelf</name>
            <newExits>
                <exit>
                    <destinationType>location</destinationType>
                    <name>The Goat Bell Ledge</name>
                    <description>A narrow switchback follows old bell posts.</description>
                    <travelTime>15 minutes</travelTime>
                </exit>
                <exit>
                    <destinationType>location</destinationType>
                    <name>Goat Bell Ledge</name>
                    <description>The same switchback without its article.</description>
                    <travelTime>15 minutes</travelTime>
                </exit>
            </newExits>
        </location>
    `, { required: true });

    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].name, 'The Goat Bell Ledge');
});

test('location exit suggestions reject missing decisions and malformed entries', () => {
    assert.throws(
        () => parseLocationExitSuggestions('<location><name>Closed Room</name></location>', { required: true }),
        /missing the required <newExits> decision/
    );
    assert.throws(
        () => parseLocationExitSuggestions(`
            <location>
                <newExits>
                    <exit>
                        <destinationType>road</destinationType>
                        <name>Old Road</name>
                        <description>A weathered road.</description>
                        <travelTime>10 minutes</travelTime>
                    </exit>
                </newExits>
            </location>
        `, { required: true }),
        /unsupported destination type/
    );
});

test('stub prompt requests a contextual zero-or-more exit decision only when enabled', () => {
    const discoveryPrompt = env.render('_includes/location-generator-stub.njk', {
        stubId: 'loc_windcut_shelf',
        stubName: 'Windcut Shelf',
        discoverNewExits: true,
        encourageNewExits: true,
        existingExitDestinations: [{
            destinationType: 'location',
            name: 'Lower Trail',
            description: 'The route back down the mountain.',
            isReturnRoute: true,
            isUnexplored: false
        }]
    });

    assert.match(discoveryPrompt, /<existingExits>/);
    assert.match(discoveryPrompt, /<isReturnRoute>yes<\/isReturnRoute>/);
    assert.match(discoveryPrompt, /Returning zero new exits is fully valid/);
    assert.match(discoveryPrompt, /There is no target count/);
    assert.match(discoveryPrompt, /<newExits>/);

    const unexploredExitPrompt = env.render('_includes/location-generator-stub.njk', {
        stubId: 'loc_windcut_shelf',
        stubName: 'Windcut Shelf',
        discoverNewExits: true,
        encourageNewExits: false,
        existingExitDestinations: [{
            destinationType: 'location',
            name: 'Unopened Observatory',
            description: 'A sealed stair continues upward.',
            isReturnRoute: false,
            isUnexplored: true
        }]
    });
    assert.match(unexploredExitPrompt, /<existingExits>/);
    assert.match(unexploredExitPrompt, /<newExits>/);
    assert.doesNotMatch(unexploredExitPrompt, /ONWARD EXIT DECISION/);
    assert.doesNotMatch(unexploredExitPrompt, /Invent plausible new destinations/);
    assert.doesNotMatch(unexploredExitPrompt, /Mention features hinting at additional unexplored directions/);

    const ordinaryPrompt = env.render('_includes/location-generator-stub.njk', {
        stubId: 'loc_windcut_shelf',
        stubName: 'Windcut Shelf',
        discoverNewExits: false
    });
    assert.doesNotMatch(ordinaryPrompt, /<existingExits>/);
    assert.doesNotMatch(ordinaryPrompt, /<newExits>/);
});

test('new-exit encouragement is enabled only when no existing exit is unexplored', () => {
    assert.equal(shouldEncourageNewExitSuggestions([]), true);
    assert.equal(shouldEncourageNewExitSuggestions([
        { name: 'Lower Trail', isUnexplored: false },
        { name: 'Market Road', isUnexplored: false }
    ]), true);
    assert.equal(shouldEncourageNewExitSuggestions([
        { name: 'Lower Trail', isUnexplored: false },
        { name: 'Unopened Observatory', isUnexplored: true }
    ]), false);
    assert.throws(
        () => shouldEncourageNewExitSuggestions(null),
        /must be an array/
    );
});

test('location exit discovery marks unvisited destinations as unexplored', () => {
    const explored = { id: 'loc-explored', name: 'Market Road', visited: true };
    const unexplored = { id: 'loc-unexplored', name: 'Sealed Observatory', visited: false };
    const gameLocations = new Map([
        [explored.id, explored],
        [unexplored.id, unexplored]
    ]);
    const buildContext = loadBuildLocationExitDiscoveryContext(gameLocations);
    const exitsByDirection = new Map([
        ['west', { destination: explored.id, description: 'A familiar road.' }],
        ['up', { destination: unexplored.id, description: 'A sealed stair.' }]
    ]);
    const location = {
        getAvailableDirections: () => Array.from(exitsByDirection.keys()),
        getExit: direction => exitsByDirection.get(direction) || null
    };

    const exits = buildContext(location, explored);
    assert.equal(exits.find(exit => exit.name === 'Market Road').isUnexplored, false);
    assert.equal(exits.find(exit => exit.name === 'Sealed Observatory').isUnexplored, true);
    assert.equal(shouldEncourageNewExitSuggestions(exits), false);
});

function loadFilterNewExitSuggestionsToUnknownPlaces({
    locationNames = [],
    regionNames = [],
    pendingRegionNames = []
} = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function filterNewExitSuggestionsToUnknownPlaces(suggestions = []) {');
    const end = source.indexOf('\nasync function createSuggestedExitStubs(location, suggestions = []) {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate filterNewExitSuggestionsToUnknownPlaces in server.js');
    }

    const normalize = value => value.trim().toLowerCase();
    const context = {
        findLocationByNameLoose: name => locationNames.some(candidate => normalize(candidate) === normalize(name))
            ? { name }
            : null,
        findRegionByNameLoose: name => regionNames.some(candidate => normalize(candidate) === normalize(name))
            ? { name }
            : null,
        pendingRegionStubs: new Map(pendingRegionNames.map((name, index) => [String(index), { name }]))
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.filterNewExitSuggestionsToUnknownPlaces = filterNewExitSuggestionsToUnknownPlaces;`,
        context
    );
    return context.filterNewExitSuggestionsToUnknownPlaces;
}

test('location exit suggestions ignore repeated destination names after validating each entry', () => {
    const suggestions = parseLocationExitSuggestions(`
        <location>
            <newExits>
                <exit>
                    <destinationType>location</destinationType>
                    <name>Old Road</name>
                    <description>A weathered road climbs east.</description>
                    <travelTime>10 minutes</travelTime>
                </exit>
                <exit>
                    <destinationType>region</destinationType>
                    <name>  OLD   ROAD </name>
                    <description>A second rendition of the same destination.</description>
                    <travelTime>20 minutes</travelTime>
                </exit>
                <exit>
                    <destinationType>region</destinationType>
                    <name>Glass Lowlands</name>
                    <description>A distant basin shines beyond the ridge.</description>
                    <travelTime>3 hours</travelTime>
                </exit>
            </newExits>
        </location>
    `, { required: true });

    assert.deepEqual(suggestions, [
        {
            destinationType: 'location',
            name: 'Old Road',
            description: 'A weathered road climbs east.',
            travelTimeMinutes: 10
        },
        {
            destinationType: 'region',
            name: 'Glass Lowlands',
            description: 'A distant basin shines beyond the ridge.',
            travelTimeMinutes: 180
        }
    ]);
});

test('malformed duplicate destination entries still fail parser validation', () => {
    assert.throws(
        () => parseLocationExitSuggestions(`
            <location>
                <newExits>
                    <exit>
                        <destinationType>location</destinationType>
                        <name>Old Road</name>
                        <description>A weathered road.</description>
                        <travelTime>10 minutes</travelTime>
                    </exit>
                    <exit>
                        <destinationType>location</destinationType>
                        <name>old road</name>
                        <travelTime>10 minutes</travelTime>
                    </exit>
                </newExits>
            </location>
        `, { required: true }),
        /must contain exactly one <description> field/
    );
});

test('already-known location, region, and pending-region destinations are ignored', () => {
    const filterSuggestions = loadFilterNewExitSuggestionsToUnknownPlaces({
        locationNames: ['Lower Trail'],
        regionNames: ['Cloudbreak Vale'],
        pendingRegionNames: ['Ashen Reach']
    });
    const suggestions = [
        { destinationType: 'location', name: 'lower   trail' },
        { destinationType: 'region', name: 'CLOUDBREAK VALE' },
        { destinationType: 'region', name: ' Ashen Reach ' },
        { destinationType: 'location', name: 'Goat Bell Ledge' }
    ];

    assert.deepEqual(
        JSON.parse(JSON.stringify(filterSuggestions(suggestions))),
        [{ destinationType: 'location', name: 'Goat Bell Ledge' }]
    );
});

test('malformed new exits can be regenerated through the bounded parser retry policy', async () => {
    const responses = [
        '<location><newExits><exit><destinationType>road</destinationType></exit></newExits></location>',
        '<location><newExits></newExits></location>'
    ];
    const result = await runPromptWithParseRetries({
        messages: [{ role: 'user', content: 'Generate a location.' }],
        maxAttempts: 2,
        complete: async () => responses.shift(),
        parse: response => parseLocationExitSuggestions(response, { required: true }),
        retainRejectedResponse: false,
        buildRetryInstruction: error => `Correct the location XML: ${error.message}`
    });

    assert.equal(result.attempts, 2);
    assert.deepEqual(result.value, []);
});

test('location generation automatically validates new exits for every ordinary stub expansion', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function generateLocationFromPrompt(options = {}) {');
    const end = source.indexOf('\nfunction renderRegionEntrancePrompt()', start);
    const functionSource = source.slice(start, end);

    assert.match(functionSource, /isStubExpansion\s*&& !stubLocation\.hasGeneratedStubs/);
    assert.match(functionSource, /shouldEncourageNewExitSuggestions\(existingExitDestinations\)/);
    assert.match(functionSource, /runPromptWithParseRetries\(\{/);
    assert.match(functionSource, /parseLocationExitSuggestions\(responseText, \{ required: true \}\)/);
    assert.doesNotMatch(functionSource, /discoverNewExits = false/);
});
