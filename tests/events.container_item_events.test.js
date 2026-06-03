const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');
const Thing = require('../Thing.js');
const Player = require('../Player.js');
const Location = require('../Location.js');
const Region = require('../Region.js');

const originalConfig = Globals.config;

function clearLocationRegistry() {
    for (const location of Location.getAll()) {
        Location.removeFromIndex(location);
    }
}

function makeWorld() {
    Globals.config = {
        ...(originalConfig && typeof originalConfig === 'object' ? originalConfig : {}),
        baseHealthPerLevel: Number.isFinite(originalConfig?.baseHealthPerLevel)
            ? originalConfig.baseHealthPerLevel
            : 10,
    };

    const region = new Region({
        id: 'region-container-test',
        name: 'Container Test Region',
        description: 'A region for container event tests.',
    });
    const location = new Location({
        id: 'location-container-test',
        name: 'Container Test Room',
        description: 'A room for container event tests.',
        regionId: region.id,
    });
    const player = new Player({
        id: 'player-container-test',
        name: 'Baato',
        description: 'A test player.',
        isNPC: false,
        location: location.id,
    });
    player.setLocation(location);

    return { region, location, player };
}

test.afterEach(() => {
    Events.initialize({});
    Thing.clear();
    Player.clearRuntimeRegistries();
    clearLocationRegistry();
    Region.clear();
    Globals.config = originalConfig;
});

test('XML event parser converts container item tags to event entries', () => {
    const parsed = Events._parseXmlEventCheckResponse(`
<events>
  <putItemInContainer>
    <character>player</character>
    <fullItemName>Iron Spike</fullItemName>
    <quantity>2</quantity>
    <containerName>Travel Chest</containerName>
  </putItemInContainer>
  <removeItemFromContainer>
    <fullItemName>Silver Gear</fullItemName>
    <quantity>1</quantity>
    <containerName>Travel Chest</containerName>
  </removeItemFromContainer>
</events>
`);

    assert.deepEqual(parsed.structured.parsed.put_item_in_container, [
        {
            character: 'player',
            item: 'Iron Spike',
            quantity: 2,
            containerName: 'Travel Chest',
        },
    ]);
    assert.deepEqual(parsed.structured.parsed.remove_item_from_container, [
        {
            character: null,
            item: 'Silver Gear',
            quantity: 1,
            containerName: 'Travel Chest',
        },
    ]);
});

test('put_item_in_container moves a partial actor stack into a named container', async () => {
    const { location, player } = makeWorld();
    const chest = new Thing({
        id: 'thing-travel-chest',
        name: 'Travel Chest',
        description: 'A sturdy travel chest.',
        thingType: 'scenery',
        isContainer: true,
    });
    const spikeStack = new Thing({
        id: 'thing-iron-spikes',
        name: 'Iron Spike',
        description: 'A stack of iron spikes.',
        thingType: 'item',
        count: 5,
    });

    location.addThingId(chest.id);
    player.addInventoryItem(spikeStack);

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: true }),
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return normalized === 'player' || normalized === 'baato' ? player : null;
        },
    });

    await Events.applyEventOutcomes({
        parsed: {
            put_item_in_container: [{
                character: 'player',
                item: 'Iron Spike',
                quantity: 2,
                containerName: 'Travel Chest',
            }],
        },
        rawEntries: {},
    }, { location });

    assert.equal(spikeStack.count, 3);
    assert.equal(player.hasInventoryItem(spikeStack.id), true);

    const containedSpikes = chest.getInventoryItems()
        .filter(thing => thing.name === 'Iron Spike');
    assert.equal(containedSpikes.length, 1);
    assert.equal(containedSpikes[0].count, 2);
    assert.equal(containedSpikes[0].metadata.containerId, chest.id);
});

test('put_item_in_container continues applying later entries after one missing item', async () => {
    const { location, player } = makeWorld();
    const chest = new Thing({
        id: 'thing-batch-chest',
        name: 'Batch Chest',
        description: 'A chest for batch event testing.',
        thingType: 'scenery',
        isContainer: true,
    });
    const firstCog = new Thing({
        id: 'thing-first-cog',
        name: 'First Cog',
        description: 'The first cog.',
        thingType: 'item',
    });
    const secondCog = new Thing({
        id: 'thing-second-cog',
        name: 'Second Cog',
        description: 'The second cog.',
        thingType: 'item',
    });

    location.addThingId(chest.id);
    player.addInventoryItem(firstCog);
    player.addInventoryItem(secondCog);

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
        warnings.push(args.map(String).join(' '));
    };

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: true }),
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return normalized === 'player' || normalized === 'baato' ? player : null;
        },
    });

    try {
        await Events.applyEventOutcomes({
            parsed: {
                put_item_in_container: [
                    {
                        character: 'player',
                        item: 'First Cog',
                        quantity: 1,
                        containerName: 'Batch Chest',
                    },
                    {
                        character: 'player',
                        item: 'Missing Cog',
                        quantity: 1,
                        containerName: 'Batch Chest',
                    },
                    {
                        character: 'player',
                        item: 'Second Cog',
                        quantity: 1,
                        containerName: 'Batch Chest',
                    },
                ],
            },
            rawEntries: {},
        }, { location });
    } finally {
        console.warn = originalWarn;
    }

    const containedNames = chest.getInventoryItems().map(thing => thing.name).sort();
    assert.deepEqual(containedNames, ['First Cog', 'Second Cog']);
    assert.equal(player.hasInventoryItem(firstCog.id), false);
    assert.equal(player.hasInventoryItem(secondCog.id), false);
    assert.match(warnings.join('\n'), /put_item_in_container/i);
    assert.match(warnings.join('\n'), /Missing Cog/);
});

test('remove_item_from_container moves a partial contained stack to the current location when no actor is named', async () => {
    const { location } = makeWorld();
    const chest = new Thing({
        id: 'thing-supply-chest',
        name: 'Supply Chest',
        description: 'A supply chest.',
        thingType: 'scenery',
        isContainer: true,
    });
    const gearStack = new Thing({
        id: 'thing-silver-gears',
        name: 'Silver Gear',
        description: 'A stack of silver gears.',
        thingType: 'item',
        count: 4,
    });

    location.addThingId(chest.id);
    chest.addInventoryItem(gearStack);

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: true }),
        findThingByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return normalized === 'doomed chest' ? chest : null;
        },
    });

    await Events.applyEventOutcomes({
        parsed: {
            remove_item_from_container: [{
                character: null,
                item: 'Silver Gear',
                quantity: 2,
                containerName: 'Supply Chest',
            }],
        },
        rawEntries: {},
    }, { location });

    assert.equal(gearStack.count, 2);
    assert.equal(chest.hasInventoryItem(gearStack.id), true);

    const looseGears = location.thingIds
        .map(id => Thing.getById(id))
        .filter(thing => thing?.name === 'Silver Gear');
    assert.equal(looseGears.length, 1);
    assert.equal(looseGears[0].count, 2);
    assert.equal(looseGears[0].metadata.locationId, location.id);
    assert.equal(looseGears[0].metadata.containerId, undefined);
});

test('remove_item_from_container generates missing container contents before giving them to an actor', async () => {
    const { location, player } = makeWorld();
    const chest = new Thing({
        id: 'thing-hidden-cache',
        name: 'Hidden Cache',
        description: 'A hidden cache.',
        thingType: 'scenery',
        isContainer: true,
    });
    location.addThingId(chest.id);

    const generatedItems = [];
    Events.initialize({
        getConfig: () => ({ omit_npc_generation: true }),
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return normalized === 'player' || normalized === 'baato' ? player : null;
        },
        generateItemsByNames: async ({ itemNames, location: generationLocation }) => {
            assert.equal(generationLocation, location);
            return itemNames.map((name, index) => {
                const thing = new Thing({
                    id: `thing-generated-cache-item-${index}`,
                    name,
                    description: `Generated ${name}.`,
                    thingType: 'item',
                });
                generatedItems.push(thing);
                location.addThingId(thing.id);
                return thing;
            });
        },
    });

    await Events.applyEventOutcomes({
        parsed: {
            remove_item_from_container: [{
                character: 'player',
                item: 'Cache Key',
                quantity: 3,
                containerName: 'Hidden Cache',
            }],
        },
        rawEntries: {},
    }, { location });

    assert.equal(generatedItems.length, 1);
    assert.equal(generatedItems[0].name, 'Cache Key');
    assert.equal(generatedItems[0].count, 3);
    assert.equal(chest.hasInventoryItem(generatedItems[0].id), false);
    assert.equal(player.hasInventoryItem(generatedItems[0].id), true);
    assert.equal(generatedItems[0].metadata.ownerId, player.id);
    assert.equal(generatedItems[0].metadata.containerId, undefined);
});

test('consume_item drops container contents into its location before deleting it', async () => {
    const { location } = makeWorld();
    const chest = new Thing({
        id: 'thing-doomed-chest',
        name: 'Doomed Chest',
        description: 'A chest about to be destroyed.',
        thingType: 'scenery',
        isContainer: true,
    });
    const gear = new Thing({
        id: 'thing-contained-gear',
        name: 'Contained Gear',
        description: 'A gear inside the chest.',
        thingType: 'item',
    });

    location.addThingId(chest.id);
    chest.addInventoryItem(gear);

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: true }),
        findThingByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return normalized === 'doomed chest' ? chest : null;
        },
    });

    await Events.applyEventOutcomes({
        parsed: {
            consume_item: [{
                item: 'Doomed Chest',
                quantity: 1,
                consumption: 'smashed apart',
            }],
        },
        rawEntries: {},
    }, { location });

    assert.equal(Thing.getById(chest.id), null);
    assert.equal(Thing.getById(gear.id), gear);
    assert.equal(location.thingIds.includes(chest.id), false);
    assert.equal(location.thingIds.includes(gear.id), true);
    assert.equal(gear.metadata.locationId, location.id);
    assert.equal(gear.metadata.containerId, undefined);
});
