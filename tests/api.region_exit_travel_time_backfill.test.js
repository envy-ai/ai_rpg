const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const api = require('../api.js');

test('arrival travel-time backfill runs for destination region when entering a different region', async () => {
    const originRegion = { id: 'region-origin', name: 'Old Quarter' };
    const destinationRegion = { id: 'region-destination', name: 'Glass Harbor' };
    const originLocation = { id: 'location-origin', name: 'Old Gate' };
    const destinationLocation = { id: 'location-destination', name: 'North Pier' };
    const calls = [];

    const result = await api.maybeBackfillRegionExitTravelTimesForArrival({
        originLocation,
        destinationLocation,
        findRegionByLocationId: (locationId) => {
            if (locationId === originLocation.id) {
                return originRegion;
            }
            if (locationId === destinationLocation.id) {
                return destinationRegion;
            }
            return null;
        },
        backfillRegionExitTravelTimes: async (payload) => {
            calls.push(payload);
            return { promptUsed: true, generatedExitCount: 2 };
        }
    });

    assert.deepEqual(calls, [{ region: destinationRegion, locationOverride: destinationLocation }]);
    assert.deepEqual(result, { promptUsed: true, generatedExitCount: 2 });
});

test('arrival travel-time backfill skips same-region movement', async () => {
    const region = { id: 'region-same', name: 'Market Ward' };
    const originLocation = { id: 'location-origin', name: 'South Lane' };
    const destinationLocation = { id: 'location-destination', name: 'North Lane' };

    const result = await api.maybeBackfillRegionExitTravelTimesForArrival({
        originLocation,
        destinationLocation,
        findRegionByLocationId: () => region,
        backfillRegionExitTravelTimes: async () => {
            throw new Error('Backfill should not run for same-region movement.');
        }
    });

    assert.equal(result, null);
});

test('arrival travel-time backfill ignores helper failures so movement can continue', async () => {
    const originRegion = { id: 'region-origin', name: 'Old Quarter' };
    const destinationRegion = { id: 'region-destination', name: 'Glass Harbor' };
    const originLocation = { id: 'location-origin', name: 'Old Gate' };
    const destinationLocation = { id: 'location-destination', name: 'North Pier' };

    const result = await api.maybeBackfillRegionExitTravelTimesForArrival({
        originLocation,
        destinationLocation,
        findRegionByLocationId: (locationId) => {
            if (locationId === originLocation.id) {
                return originRegion;
            }
            if (locationId === destinationLocation.id) {
                return destinationRegion;
            }
            return null;
        },
        backfillRegionExitTravelTimes: async () => {
            throw new Error('prompt render failed');
        }
    });

    assert.equal(result, null);
});

test('/api/player/move backfills destination-region travel times before resolving move duration', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    const routeStart = source.indexOf("app.post('/api/player/move'");
    const routeEnd = source.indexOf('\n        });', routeStart);
    assert.notEqual(routeStart, -1, 'player move route should exist');
    assert.notEqual(routeEnd, -1, 'player move route should have a closing route block');
    const routeSource = source.slice(routeStart, routeEnd);
    const backfillIndex = routeSource.indexOf('await maybeBackfillRegionExitTravelTimesForArrival');
    const durationIndex = routeSource.indexOf('resolveExitTravelTimeForTraversal');

    assert.notEqual(backfillIndex, -1, 'player move route should run destination-region travel-time backfill');
    assert.notEqual(durationIndex, -1, 'player move route should resolve exit travel duration');
    assert.ok(
        backfillIndex < durationIndex,
        'travel-time backfill should happen before resolving the move duration so updated exit times can apply immediately'
    );
});

test('move-turn prose movement backfills destination-region travel times before resolving move duration', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    const helperStart = source.indexOf('async function runmoveTurnResultEventChecks');
    const helperEnd = source.indexOf('\n        function recordSkillCheckEntry', helperStart);
    assert.notEqual(helperStart, -1, 'move-turn event helper should exist');
    assert.notEqual(helperEnd, -1, 'move-turn event helper should have a stable end marker');
    const helperSource = source.slice(helperStart, helperEnd);
    const backfillIndex = helperSource.indexOf('await maybeBackfillRegionExitTravelTimesForArrival');
    const durationIndex = helperSource.indexOf('resolvemoveTurnResultPlayerMoveTimeMinutes');

    assert.notEqual(backfillIndex, -1, 'move-turn player movement should run destination-region travel-time backfill');
    assert.notEqual(durationIndex, -1, 'move-turn player movement should resolve travel duration');
    assert.ok(
        backfillIndex < durationIndex,
        'move-turn travel-time backfill should happen before resolving movement duration'
    );
});

test('event-driven travel enforcement backfills destination-region travel times before resolving exit duration', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
    const enforcementStart = source.indexOf('if (travelMetadataIsEventDriven && currentActionIsTravel)');
    const enforcementEnd = source.indexOf('\n                    if (plausibilityInfo?.structured || plausibilityInfo?.raw)', enforcementStart);
    assert.notEqual(enforcementStart, -1, 'event-driven travel enforcement block should exist');
    assert.notEqual(enforcementEnd, -1, 'event-driven travel enforcement block should have a stable end marker');
    const enforcementSource = source.slice(enforcementStart, enforcementEnd);
    const backfillIndex = enforcementSource.indexOf('await maybeBackfillRegionExitTravelTimesForArrival');
    const durationIndex = enforcementSource.indexOf('eventDrivenExitTravelTimeMinutes = resolveExitTravelTimeForTraversal');

    assert.notEqual(backfillIndex, -1, 'event-driven travel enforcement should backfill destination-region travel times');
    assert.notEqual(durationIndex, -1, 'event-driven travel enforcement should resolve the selected exit duration');
    assert.ok(
        backfillIndex < durationIndex,
        'event-driven travel backfill should happen before resolving selected exit duration'
    );
});

test('server renders set_travel_times through the base-context prompt', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const functionStart = source.indexOf('function renderRegionExitTravelTimesPrompt');
    const functionEnd = source.indexOf('\nfunction parseRegionExitTravelTimesResponse', functionStart);
    assert.notEqual(functionStart, -1, 'renderRegionExitTravelTimesPrompt should exist');
    assert.notEqual(functionEnd, -1, 'renderRegionExitTravelTimesPrompt should have a stable end marker');
    const functionSource = source.slice(functionStart, functionEnd);

    assert.match(functionSource, /promptEnv\.render\('base-context\.xml\.njk'/);
    assert.match(functionSource, /promptType:\s*'set_travel_times'/);
    assert.doesNotMatch(functionSource, /region-exit-travel-times\.xml\.njk/);
});

test('legacy region exit travel-time wrapper prompt is removed', () => {
    assert.equal(
        fs.existsSync(path.join(__dirname, '..', 'prompts', 'region-exit-travel-times.xml.njk')),
        false
    );
});

test('server travel-time backfill records prompt failures without throwing', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const functionStart = source.indexOf('async function backfillRegionExitTravelTimes');
    const functionEnd = source.indexOf('\nfunction parseRegionExitsResponse', functionStart);
    assert.notEqual(functionStart, -1, 'backfillRegionExitTravelTimes should exist');
    assert.notEqual(functionEnd, -1, 'backfillRegionExitTravelTimes should have a stable end marker');
    const functionSource = source.slice(functionStart, functionEnd);

    assert.match(functionSource, /catch\s*\(\s*error\s*\)/);
    assert.match(functionSource, /promptFailed:\s*true/);
    assert.match(functionSource, /promptError:/);
});

test('set travel times prompt renders via base context and only lists pending zero-minute exits', () => {
    const env = nunjucks.configure(path.join(__dirname, '..', 'prompts'), { autoescape: false });
    env.addGlobal('randomword', () => 'test');
    const rendered = env.render('base-context.xml.njk', {
        config: {
            extra_system_instructions: '',
            prompt_uses_caching: false
        },
        promptType: 'set_travel_times',
        setting: {
            name: 'Test Setting',
            description: 'A test setting.',
            genre: 'fantasy',
            tone: 'grounded',
            theme: 'travel',
            baseContextPreamble: '',
            startingLocationType: 'Settlement',
            magicLevel: 'Low',
            techLevel: 'Low',
            difficulty: 'Normal',
            currencyName: 'coin',
            currencyNamePlural: 'coins',
            currencyValueNotes: '',
            writingStyleNotes: '',
            races: [],
            attributes: [],
            skills: []
        },
        currentRegion: {
            name: 'Glass Harbor',
            description: 'A port of mirrored bridges.',
            secrets: [],
            locations: [],
            connectedRegions: []
        },
        currentLocation: {
            name: 'North Pier',
            description: 'A busy pier.',
            statusEffects: [],
            exits: [],
            items: [],
            npcs: []
        },
        currentPlayer: {
            name: 'Tester',
            description: 'A traveler.',
            statusEffects: [],
            skills: [],
            abilities: [],
            inventory: [],
            needs: [],
            currentQuests: []
        },
        party: [],
        npcs: [],
        factions: [],
        trackers: [],
        gameHistory: '',
        recentGameHistory: '',
        worldOutline: { regions: [] },
        worldTime: {},
        region: {
            id: 'region-destination',
            name: 'Glass Harbor',
            description: 'A port of mirrored bridges.'
        },
        allLocationsInRegion: [
            { id: 'location-zero-a', name: 'North Pier', description: 'A busy pier.' },
            { id: 'location-zero-b', name: 'Customs Arch', description: 'A scanner arch.' }
        ],
        knownExits: [
            {
                sourceLocationId: 'location-known-a',
                sourceLocationName: 'Old Road',
                destinationLocationId: 'location-known-b',
                destinationLocationName: 'West Gate',
                travelTimeMinutes: 12
            }
        ],
        pendingExits: [
            {
                sourceLocationId: 'location-zero-a',
                sourceLocationName: 'North Pier',
                sourceLocationDescription: 'A busy pier.',
                destinationLocationId: 'location-zero-b',
                destinationLocationName: 'Customs Arch',
                destinationLocationDescription: 'A scanner arch.'
            }
        ]
    });

    assert.match(rendered, /North Pier/);
    assert.match(rendered, /Customs Arch/);
    assert.doesNotMatch(rendered, /Old Road/);
    assert.doesNotMatch(rendered, /West Gate/);
    assert.match(rendered, /<sourceLocationId>Exact source id/);
    assert.doesNotMatch(rendered, /<id><!-- The id of the exit/);
});
