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

test('item_appear still generates items during NPC turns when player movement is locked', async () => {
    const previousProcessedMove = Globals.processedMove;
    let generatedItemNames = [];
    try {
        setupEvents({
            generateItemsByNames: async ({ itemNames }) => {
                generatedItemNames = itemNames.slice();
                return itemNames.map((name, index) => ({ id: `thing-${index}`, name }));
            }
        });
        Globals.processedMove = true;

        const structured = {
            parsed: {
                item_appear: [{
                    name: 'Military-Grade Pulse Rifle',
                    quantity: 6,
                    description: 'Factory-greased military pulse rifles.'
                }]
            },
            rawEntries: {}
        };

        await Events.applyEventOutcomes(structured, {
            location: createLocation(),
            isNpcTurn: true
        });

        assert.deepEqual(generatedItemNames, ['Military-Grade Pulse Rifle']);
        assert.equal(structured.parsed.item_appear[0].name, 'Military-Grade Pulse Rifle');
        assert.equal(Events.newItems.has('Military-Grade Pulse Rifle'), true);
    } finally {
        Globals.processedMove = previousProcessedMove;
    }
});

test('item_appear increments an existing same-name scene item stack', async () => {
    let generateCalled = false;
    setupEvents({
        generateItemsByNames: async () => {
            generateCalled = true;
            return [{ id: 'thing-generated', name: "Midnight Ramen's House Noodle Bowl" }];
        }
    });

    const existingNoodles = {
        id: 'thing-noodles',
        name: "Midnight Ramen's House Noodle Bowl",
        count: 1,
        metadata: { locationId: 'test-location', count: 1 }
    };
    const location = createLocation();
    location.things.push(existingNoodles);

    const structured = {
        parsed: {
            item_appear: [{
                name: "Midnight Ramen's House Noodle Bowl",
                quantity: 4,
                description: 'Hot takeout bowls from Midnight Ramen.'
            }]
        },
        rawEntries: {}
    };

    await Events.applyEventOutcomes(structured, { location });

    assert.equal(generateCalled, false);
    assert.equal(existingNoodles.count, 5);
    assert.equal(existingNoodles.metadata.count, 5);
    assert.equal(Events.newItems.has("Midnight Ramen's House Noodle Bowl"), true);
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

test('scenery_appear still generates scenery during NPC turns when player movement is locked', async () => {
    const previousProcessedMove = Globals.processedMove;
    let generatedItemNames = [];
    let generatedOptions = null;
    try {
        setupEvents({
            generateItemsByNames: async ({ itemNames, options }) => {
                generatedItemNames = itemNames.slice();
                generatedOptions = options || null;
                return itemNames.map((name, index) => ({ id: `scenery-${index}`, name }));
            }
        });
        Globals.processedMove = true;

        const structured = {
            parsed: {
                scenery_appear: ['Open Armory Vault']
            },
            rawEntries: {}
        };

        await Events.applyEventOutcomes(structured, {
            location: createLocation(),
            isNpcTurn: true
        });

        assert.deepEqual(generatedItemNames, ['Open Armory Vault']);
        assert.equal(generatedOptions?.treatAsScenery, true);
        assert.equal(Events.newItems.has('Open Armory Vault'), true);
    } finally {
        Globals.processedMove = previousProcessedMove;
    }
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
