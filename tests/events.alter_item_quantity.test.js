const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Thing = require('../Thing.js');
const Location = require('../Location.js');
const Region = require('../Region.js');

function clearLocationRegistry() {
    for (const location of Location.getAll()) {
        Location.removeFromIndex(location);
    }
}

test.afterEach(() => {
    Thing.clear();
    clearLocationRegistry();
    Region.clear();
});

test('alter_item parser captures quantity before new item name', () => {
    const parser = Events._buildParsers().alter_item;

    const parsed = parser(
        'Iron Arrow -> 2 -> Fire Arrow -> Flame-treated arrows. | Wood Plank -> all -> Charred Plank -> Burned evenly.',
    );

    assert.deepEqual(parsed, [
        {
            originalName: 'Iron Arrow',
            quantity: 2,
            newName: 'Fire Arrow',
            changeDescription: 'Flame-treated arrows.',
            from: 'Iron Arrow',
            to: 'Fire Arrow',
            description: 'Flame-treated arrows.',
        },
        {
            originalName: 'Wood Plank',
            quantity: 'all',
            newName: 'Charred Plank',
            changeDescription: 'Burned evenly.',
            from: 'Wood Plank',
            to: 'Charred Plank',
            description: 'Burned evenly.',
        },
    ]);
});

test('alter_item splits a partial stack and alters the new stack only', async () => {
    const region = new Region({
        id: 'region-test',
        name: 'Test Region',
        description: 'A test region.',
    });
    const location = new Location({
        id: 'location-test',
        name: 'Test Room',
        description: 'A test room.',
        regionId: region.id,
    });
    const arrowStack = new Thing({
        id: 'thing-iron-arrows',
        name: 'Iron Arrow',
        description: 'Plain iron arrows.',
        thingType: 'item',
        count: 5,
    });
    location.addThingId(arrowStack.id);

    const alteredIds = [];
    Events.initialize({
        Location,
        findThingByName: (name) => Thing.getByName(name),
        alterThingByPrompt: async ({ thing, newName, changeDescription }) => {
            assert.notEqual(thing.id, arrowStack.id);
            assert.equal(thing.count, 2);
            alteredIds.push(thing.id);
            thing.name = newName;
            thing.description = changeDescription;
            return {
                originalName: 'Iron Arrow',
                newName,
                changeDescription,
                thing,
            };
        },
    });

    try {
        await Events._handlers.alter_item.call(
            Events,
            [
                {
                    originalName: 'Iron Arrow',
                    quantity: 2,
                    newName: 'Fire Arrow',
                    changeDescription: 'Flame-treated arrows.',
                },
            ],
            { location },
        );
    } finally {
        Events.initialize({});
    }

    assert.equal(arrowStack.name, 'Iron Arrow');
    assert.equal(arrowStack.count, 3);
    assert.equal(alteredIds.length, 1);

    const alteredStack = Thing.getById(alteredIds[0]);
    assert.ok(alteredStack);
    assert.equal(alteredStack.name, 'Fire Arrow');
    assert.equal(alteredStack.count, 2);
    assert.equal(alteredStack.metadata.locationId, location.id);
    assert.deepEqual(new Set(location.thingIds), new Set([arrowStack.id, alteredStack.id]));
});

test('alter_item keeps a partial split inside the source container', async () => {
    const chest = new Thing({
        id: 'thing-arrow-chest',
        name: 'Arrow Chest',
        description: 'A small arrow chest.',
        thingType: 'scenery',
        isContainer: true,
    });
    const arrowStack = new Thing({
        id: 'thing-container-arrows',
        name: 'Iron Arrow',
        description: 'Plain iron arrows.',
        thingType: 'item',
        count: 5,
    });
    chest.addInventoryItem(arrowStack);

    const alteredIds = [];
    Events.initialize({
        findThingByName: (name) => Thing.getByName(name),
        alterThingByPrompt: async ({ thing, newName, changeDescription }) => {
            alteredIds.push(thing.id);
            thing.name = newName;
            thing.description = changeDescription;
            return {
                originalName: 'Iron Arrow',
                newName,
                changeDescription,
                thing,
            };
        },
    });

    try {
        await Events._handlers.alter_item.call(
            Events,
            [
                {
                    originalName: 'Iron Arrow',
                    quantity: 2,
                    newName: 'Fire Arrow',
                    changeDescription: 'Flame-treated arrows.',
                },
            ],
            {},
        );
    } finally {
        Events.initialize({});
    }

    const alteredStack = Thing.getById(alteredIds[0]);
    assert.ok(alteredStack);
    assert.equal(arrowStack.count, 3);
    assert.equal(alteredStack.count, 2);
    assert.equal(chest.hasInventoryItem(arrowStack.id), true);
    assert.equal(chest.hasInventoryItem(alteredStack.id), true);
    assert.equal(alteredStack.metadata.containerId, chest.id);
});
