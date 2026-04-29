const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');

function createLocation() {
    return {
        id: 'test-location',
        name: 'Test Location',
        things: []
    };
}

function setupEvents({ generateItemsByNames, ensureNpcByName, findActorByName } = {}) {
    const actors = new Map();
    Events.initialize({
        getConfig: () => ({ omit_npc_generation: true }),
        generateItemsByNames: generateItemsByNames || (async ({ itemNames }) => (
            itemNames.map((name, index) => ({ id: `thing-${index}`, name }))
        )),
        ensureNpcByName: ensureNpcByName || (async (name) => ({ id: `npc-${name}`, name })),
        findActorByName: findActorByName || ((name) => actors.get(String(name || '').trim().toLowerCase()) || null),
        findActorById: () => null,
        players: actors,
        things: new Map()
    });
    Events._resetTrackingSets();
    Globals.processedMove = false;
    return { actors };
}

test('item_appear writes regenerated final item names back to structured events', async () => {
    setupEvents({
        generateItemsByNames: async () => [{ id: 'thing-final', name: 'Bloodglass Knife' }]
    });

    const structured = {
        parsed: {
            item_appear: [{
                name: 'Glimmering Knife',
                quantity: 1,
                description: 'A sharp ritual knife.'
            }]
        },
        rawEntries: {}
    };

    await Events.applyEventOutcomes(structured, {
        location: createLocation()
    });

    assert.equal(structured.parsed.item_appear[0].name, 'Bloodglass Knife');
    assert.equal(structured.parsed.item_appear[0].originalName, 'Glimmering Knife');
    assert.equal(Events.newItems.has('Bloodglass Knife'), true);
});

test('scenery_appear and harvest_gather preserve final generated names for summaries', async () => {
    const actor = {
        id: 'actor-ada',
        name: 'Ada',
        addInventoryItem() {
            return true;
        }
    };
    setupEvents({
        findActorByName: (name) => (String(name || '').trim().toLowerCase() === 'ada' ? actor : null),
        generateItemsByNames: async ({ itemNames, options }) => {
            const requested = itemNames[0];
            if (options?.treatAsScenery) {
                return [{ id: 'scenery-final', name: 'Ironwood Training Yard' }];
            }
            return [{ id: 'harvest-final', name: requested === 'Glimmering Herb' ? 'Redleaf Herb' : requested }];
        }
    });

    const structured = {
        parsed: {
            scenery_appear: ['Glimmering Training Yard'],
            harvest_gather: [{
                harvester: 'Ada',
                item: 'Glimmering Herb',
                quantity: 2,
                source: 'garden bed'
            }]
        },
        rawEntries: {}
    };

    await Events.applyEventOutcomes(structured, {
        location: createLocation()
    });

    assert.equal(structured.parsed.scenery_appear[0], 'Ironwood Training Yard');
    assert.equal(structured.parsed.harvest_gather[0].item, 'Redleaf Herb');
    assert.equal(structured.parsed.harvest_gather[0].originalItem, 'Glimmering Herb');
});

test('item_to_npc tracks only the finalized generated character name', async () => {
    const animatedThing = {
        id: 'thing-animated',
        name: 'Glimmering Statue',
        metadata: { locationId: 'test-location' },
        whoseInventory: () => [],
        removeFromWorld() {}
    };
    const things = new Map([[animatedThing.id, animatedThing]]);
    Events.initialize({
        getConfig: () => ({ omit_npc_generation: true }),
        findThingByName: (name) => (name === 'Glimmering Statue' ? animatedThing : null),
        ensureNpcByName: async () => ({ id: 'npc-final', name: 'Mara Stonewake' }),
        findRegionByLocationId: () => null,
        Location: {
            get: () => createLocation()
        },
        players: new Map(),
        things
    });
    Events._resetTrackingSets();

    const structured = {
        parsed: {
            item_to_npc: [{
                item: 'Glimmering Statue',
                npc: 'Glimmering Statue'
            }]
        },
        rawEntries: {}
    };

    await Events.applyEventOutcomes(structured, {
        location: createLocation()
    });

    assert.equal(structured.parsed.item_to_npc[0].npc, 'Mara Stonewake');
    assert.equal(structured.parsed.item_to_npc[0].originalNpc, 'Glimmering Statue');
    assert.equal(Events.newCharacters.has('Mara Stonewake'), true);
    assert.equal(Events.newCharacters.has('Glimmering Statue'), false);
});
