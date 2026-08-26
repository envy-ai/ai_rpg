const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');

function createLocation() {
    return {
        id: 'location-bridge',
        name: 'Old Bridge',
        npcIds: []
    };
}

async function applyHiddenFirstAppearance({ emittedName, resolveDirectly }) {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousProcessedMove = Globals.processedMove;
    const hiddenNpc = {
        id: 'npc-nyx',
        name: 'Nyx Underbridge',
        aliases: ['Nyx', 'Bridge Woman'],
        isNPC: true,
        isDead: false,
        hiddenFromPlayer: true,
        currentLocation: 'location-bridge'
    };
    const players = new Map([[hiddenNpc.id, hiddenNpc]]);
    let ensureCalls = 0;

    try {
        Globals.processedMove = false;
        Events.initialize({
            getConfig: () => ({ omit_npc_generation: false }),
            players,
            findActorByName: (name) => {
                const normalized = String(name || '').trim().toLowerCase();
                if (normalized === hiddenNpc.name.toLowerCase()) {
                    return hiddenNpc;
                }
                if (resolveDirectly && normalized === emittedName.toLowerCase()) {
                    return hiddenNpc;
                }
                return null;
            },
            ensureNpcByName: async (name) => {
                ensureCalls += 1;
                const normalized = String(name || '').trim().toLowerCase();
                if (hiddenNpc.aliases.some((alias) => alias.toLowerCase() === normalized)) {
                    return hiddenNpc;
                }
                throw new Error(`Unexpected NPC generation for ${name}.`);
            },
            getActiveSettingSnapshot: () => ({
                hidingAttribute: 'Agility',
                hidingSkill: 'Stealth',
                perceptionAttribute: 'Awareness',
                perceptionSkill: 'Notice'
            })
        });
        Events._resetTrackingSets();

        const structured = {
            parsed: {
                npc_first_appearance: [emittedName],
                npc_arrival_departure: [{
                    name: emittedName,
                    action: 'arrived',
                    destination: null,
                    firstAppearance: true
                }]
            },
            rawEntries: {
                npc_first_appearance: emittedName
            }
        };
        const context = await Events.applyEventOutcomes(structured, {
            location: createLocation()
        });

        return {
            context,
            ensureCalls,
            hiddenNpc,
            structured,
            trackedAsNew: Events.newCharacters.has(hiddenNpc.name),
            trackedAsArrived: Events.arrivedCharacters.has(hiddenNpc.name)
        };
    } finally {
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._resetTrackingSets();
        Globals.processedMove = previousProcessedMove;
    }
}

test('npcFirstAppearance reveals an exact-name hidden NPC without treating it as new', async () => {
    const result = await applyHiddenFirstAppearance({
        emittedName: 'Nyx Underbridge',
        resolveDirectly: true
    });

    assert.equal(result.ensureCalls, 0);
    assert.equal(result.hiddenNpc.hiddenFromPlayer, false);
    assert.equal(result.context.locationRefreshRequested, true);
    assert.deepEqual(result.structured.parsed.npc_first_appearance, []);
    assert.deepEqual(result.structured.parsed.npc_arrival_departure, []);
    assert.deepEqual(result.structured.parsed.reveal_hidden_npc, [{
        name: 'Nyx Underbridge',
        description: 'Nyx Underbridge is revealed in the scene.',
        useOpposedCheck: false,
        convertedFromFirstAppearance: true,
        npcName: 'Nyx Underbridge',
        success: true
    }]);
});

test('npcFirstAppearance resolves a hidden NPC alias and reveals the stored NPC instead of generating one', async () => {
    const result = await applyHiddenFirstAppearance({
        emittedName: 'Bridge Woman',
        resolveDirectly: false
    });

    assert.equal(result.ensureCalls, 1);
    assert.equal(result.hiddenNpc.hiddenFromPlayer, false);
    assert.equal(result.hiddenNpc.currentLocation, 'location-bridge');
    assert.equal(result.context.locationRefreshRequested, true);
    assert.deepEqual(result.structured.parsed.npc_first_appearance, []);
    assert.deepEqual(result.structured.parsed.npc_arrival_departure, []);
    assert.equal(result.trackedAsNew, false);
    assert.equal(result.trackedAsArrived, false);
    assert.equal(result.structured.parsed.reveal_hidden_npc[0].name, 'Nyx Underbridge');
    assert.equal(result.structured.parsed.reveal_hidden_npc[0].success, true);
});
