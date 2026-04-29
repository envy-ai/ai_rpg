const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Events = require('../Events.js');
const Globals = require('../Globals.js');
const Player = require('../Player.js');

function createTempNeedBarEnvironment() {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-event-need-ticks-'));

    const writeFile = (relativePath, content) => {
        const targetPath = path.join(tempBaseDir, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf8');
    };

    writeFile('defs/attributes.yaml', `
attributes:
  strength:
    label: Strength
    default: 5
  constitution:
    label: Constitution
    default: 5
`);
    writeFile('defs/gear_slots.yaml', 'gear_slots: {}\n');
    writeFile('defs/dispositions.yaml', 'dispositions: {}\nrange: {}\n');
    writeFile('defs/need_bars.yaml', `
need_values:
  increase:
    small: 10
  decrease:
    small: 10
need_bars:
  stamina:
    name: Stamina
    player: true
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 100
    change_per_minute: -1
`);

    return tempBaseDir;
}

function baseTestConfig(previousConfig = {}) {
    return {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        ai: {},
        event_checks: { enabled: true, use_xml: false },
        quests: { enabled: false },
        omit_npc_generation: true,
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10,
        formulas: {
            ...(previousConfig?.formulas && typeof previousConfig.formulas === 'object' ? previousConfig.formulas : {}),
            character_creation: {
                ...(previousConfig?.formulas?.character_creation && typeof previousConfig.formulas.character_creation === 'object'
                    ? previousConfig.formulas.character_creation
                    : {}),
                attribute_pool_formula: previousConfig?.formulas?.character_creation?.attribute_pool_formula ?? '0',
                skill_pool_formula: previousConfig?.formulas?.character_creation?.skill_pool_formula ?? '0',
                max_attribute: previousConfig?.formulas?.character_creation?.max_attribute ?? '999',
                max_skill: previousConfig?.formulas?.character_creation?.max_skill ?? '999'
            }
        }
    };
}

function createEventNeedTickFixture() {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const previousWorldTime = Globals.worldTime;
    const previousCurrentPlayer = Globals.currentPlayer;
    const previousProcessedMove = Globals.processedMove;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const tempBaseDir = createTempNeedBarEnvironment();

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = baseTestConfig(previousConfig);
    Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };
    Globals.processedMove = false;
    Player.reloadDefinitionCaches({ refreshInstances: false });

    const origin = { id: 'origin', name: 'Origin', isVehicle: false, vehicleInfo: null };
    const destination = { id: 'destination', name: 'Destination', isVehicle: false, vehicleInfo: null };
    const locations = new Map([
        [origin.id, origin],
        [origin.name, origin],
        [destination.id, destination],
        [destination.name, destination]
    ]);
    const player = new Player({
        id: 'event-need-tick-player',
        name: 'Wanderer',
        location: origin.id
    });
    let currentLocationId = origin.id;
    Object.defineProperty(player, 'currentLocation', {
        configurable: true,
        get() {
            return currentLocationId;
        }
    });
    player.setLocation = (location) => {
        currentLocationId = typeof location === 'object' ? location.id : location;
    };
    Globals.currentPlayer = player;

    Events.initialize({
        getConfig: () => Globals.config,
        getCurrentPlayer: () => player,
        currentPlayer: player,
        findActorByName: (name) => {
            if (typeof name === 'string' && name.trim() === 'Wanderer') {
                return player;
            }
            return null;
        },
        Location: {
            get: (reference) => locations.get(reference) || null,
            findByName: (name) => locations.get(name) || null,
            findShortestTravelTimeMinutes: () => 5
        },
        findLocationByNameLoose: (name) => locations.get(name) || null,
        findRegionByLocationId: () => null
    });

    Player.applyStatusEffectNeedBarsToAll();

    return {
        player,
        origin,
        destination,
        cleanup() {
            Events._deps = previousDeps;
            Events._baseTimeout = previousTimeout;
            Events._parsers = previousParsers;
            Events._aggregators = previousAggregators;
            Events._handlers = previousHandlers;
            Player.clearRuntimeRegistries();
            Globals.baseDir = previousBaseDir;
            Globals.config = previousConfig;
            Globals.worldTime = previousWorldTime;
            Globals.currentPlayer = previousCurrentPlayer;
            Globals.processedMove = previousProcessedMove;
            Player.reloadDefinitionCaches({ refreshInstances: false });
            fs.rmSync(tempBaseDir, { recursive: true, force: true });
        }
    };
}

test('time_passed ticks need bars before event-based need bar changes', async () => {
    const fixture = createEventNeedTickFixture();
    try {
        const context = await Events.applyEventOutcomes({
            parsed: {
                time_passed: 5,
                needbar_change: [{
                    character: 'Wanderer',
                    bar: 'Stamina',
                    direction: 'increase',
                    magnitude: 'small',
                    reason: 'rested after the effort'
                }]
            },
            rawEntries: {}
        }, {
            player: fixture.player,
            needBarChanges: []
        });

        assert.equal(Globals.getTotalWorldMinutes(), 5);
        assert.equal(fixture.player.getNeedBarValue('stamina'), 100);
        assert.equal(context.timeBasedNeedBarAdjustments.length, 1);
        assert.equal(context.timeBasedNeedBarAdjustments[0].delta, -5);
        assert.equal(context.needBarChanges.length, 1);
        assert.equal(context.needBarChanges[0].previousValue, 95);
        assert.equal(context.needBarChanges[0].newValue, 100);
        assert.equal(context.needBarChanges[0].delta, 5);
    } finally {
        fixture.cleanup();
    }
});

test('event movement travel time ticks need bars before event-based need bar changes', async () => {
    const fixture = createEventNeedTickFixture();
    try {
        const context = await Events.applyEventOutcomes({
            parsed: {
                move_location: ['Destination'],
                needbar_change: [{
                    character: 'Wanderer',
                    bar: 'Stamina',
                    direction: 'increase',
                    magnitude: 'small',
                    reason: 'caught breath on arrival'
                }]
            },
            rawEntries: {}
        }, {
            player: fixture.player,
            location: fixture.origin,
            needBarChanges: []
        });

        assert.equal(fixture.player.currentLocation, 'destination');
        assert.equal(context.timeProgress.advancedMinutes, 5);
        assert.equal(context.timeProgress.source, 'event_move_travel');
        assert.equal(context.suppressTimeAdvance, true);
        assert.equal(fixture.player.getNeedBarValue('stamina'), 100);
        assert.equal(context.timeBasedNeedBarAdjustments.length, 1);
        assert.equal(context.timeBasedNeedBarAdjustments[0].delta, -5);
        assert.equal(context.needBarChanges.length, 1);
        assert.equal(context.needBarChanges[0].previousValue, 95);
        assert.equal(context.needBarChanges[0].newValue, 100);
        assert.equal(context.needBarChanges[0].delta, 5);
    } finally {
        fixture.cleanup();
    }
});
