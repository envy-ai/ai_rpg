const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Region = require('../Region.js');
const Location = require('../Location.js');
const Thing = require('../Thing.js');
const ImportItemCommand = require('../slashcommands/import_item.js');

test('import_item disables the slash-command execution overlay', () => {
    assert.equal(ImportItemCommand.showExecutionOverlay, false);
});

test('import_item execute requests a generic file upload action', async () => {
    let replyPayload = null;

    await ImportItemCommand.execute({
        reply: async (payload) => {
            replyPayload = payload;
        }
    }, {});

    assert.ok(replyPayload);
    assert.equal(replyPayload.ephemeral, false);
    assert.match(replyPayload.content, /Choose one or more XML files/);
    assert.match(replyPayload.content, /current location level plus any XML relativeLevel adjustment/);
    assert.deepEqual(replyPayload.action, {
        type: 'request_file_upload',
        title: 'Import XML Items',
        description: 'Upload XML containing <item>, <thing>, or <scenery> entries. Every parsed entry will be placed in your current location and assigned either the explicit slash-command level or the current location level plus XML relativeLevel.',
        accept: '.xml,text/xml,application/xml',
        multiple: true,
        uploadMessage: 'Importing XML items...'
    });
});

test('import_item validates level as a positive integer', () => {
    assert.deepEqual(
        ImportItemCommand.validateArgs({ level: 0 }),
        ['Argument "level" must be a positive integer.']
    );
});

test('import_item handleUpload imports every parsed entry into the invoking player location', async () => {
    const previousConfig = Globals.config;
    const previousPlayer = Globals.currentPlayer;
    const createdLocations = [];

    Player.clearRuntimeRegistries();
    Region.clear();
    Thing.clear();
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };

    try {
        const region = new Region({
            id: 'import-item-region-test',
            name: 'Anchorpoint Station',
            description: 'A patched-together salvage station.'
        });

        const location = new Location({
            id: 'import-item-location-test',
            name: 'Docking Bay 7',
            description: 'A cluttered docking berth.',
            baseLevel: 7,
            regionId: region.id
        });
        createdLocations.push(location);

        const player = new Player({
            id: 'import-item-player-test',
            name: 'Baato',
            location: location.id
        });
        Globals.currentPlayer = player;

        const replies = [];
        const thingRegistry = new Map();
        const parsedItemsByContent = new Map([
            ['<xml-one/>', [
                {
                    name: 'Sovereign\'s Depth-Spear',
                    description: 'An imported spear.',
                    shortDescription: 'Legendary spear',
                    itemOrScenery: 'item',
                    type: 'Weapon (Spear)',
                    slot: 'hands',
                    rarity: 'Legendary',
                    value: 850,
                    weight: 3,
                    relativeLevel: 4,
                    attributeBonuses: [
                        { attribute: 'wisdom', bonus: 3 },
                        { attribute: 'dexterity', bonus: 3 }
                    ],
                    causeStatusEffectOnTarget: {
                        name: 'Thermal Cataclysm',
                        description: 'Burns and freezes the target.',
                        duration: '5 minutes'
                    },
                    causeStatusEffectOnEquipper: {
                        name: 'Sovereign\'s Mercy',
                        description: 'Lets the wielder breathe underwater.'
                    },
                    isSalvageable: true
                },
                {
                    name: 'Dockside Idol',
                    description: 'An imported decorative idol.',
                    shortDescription: 'Weathered idol',
                    itemOrScenery: 'scenery',
                    type: 'scenery'
                }
            ]],
            ['<xml-two/>', [
                {
                    name: 'Harpoon Rack',
                    description: 'A rack of imported harpoons.',
                    shortDescription: 'Harpoons on display',
                    itemOrScenery: 'item',
                    type: 'Tool',
                    slot: 'hands'
                }
            ]]
        ]);

        await ImportItemCommand.handleUpload({
            user: { id: player.id },
            currentPlayer: player,
            thingRegistry,
            parseThingsXml: async (content) => parsedItemsByContent.get(content) || [],
            reply: async (payload) => {
                replies.push(payload);
            }
        }, {}, [
            { filename: 'first.xml', content: '<xml-one/>' },
            { filename: 'second.xml', content: '<xml-two/>' }
        ]);

        assert.equal(thingRegistry.size, 3);
        assert.equal(location.thingIds.length, 3);
        assert.equal(location.things.length, 3);

        const spear = location.things.find(thing => thing.name === 'Sovereign\'s Depth-Spear');
        assert.ok(spear);
        assert.equal(spear.thingType, 'item');
        assert.equal(spear.causeStatusEffectOnTarget?.name, 'Thermal Cataclysm');
        assert.equal(spear.causeStatusEffectOnTarget?.description, 'Burns and freezes the target.');
        assert.equal(spear.causeStatusEffectOnTarget?.duration, 5);
        assert.equal(spear.causeStatusEffectOnEquipper?.name, 'Sovereign\'s Mercy');
        assert.equal(spear.causeStatusEffectOnEquipper?.description, 'Lets the wielder breathe underwater.');
        assert.equal(spear.metadata.locationId, location.id);
        assert.equal(spear.metadata.isSalvageable, true);
        assert.equal(spear.level, 11);
        assert.equal(spear.relativeLevel, null);
        assert.equal(spear.metadata.level, 11);
        assert.equal(Object.prototype.hasOwnProperty.call(spear.metadata, 'relativeLevel'), false);

        const idol = location.things.find(thing => thing.name === 'Dockside Idol');
        assert.ok(idol);
        assert.equal(idol.thingType, 'scenery');
        assert.equal(idol.level, 7);

        const rack = location.things.find(thing => thing.name === 'Harpoon Rack');
        assert.ok(rack);
        assert.equal(rack.level, 7);

        assert.equal(replies.length, 1);
        assert.match(replies[0].content, /Imported 3 entries into Docking Bay 7 using location base level 7 with XML relativeLevel adjustments/);
        assert.match(replies[0].content, /first\.xml: 2; second\.xml: 1/);
    } finally {
        Globals.config = previousConfig;
        Globals.currentPlayer = previousPlayer;
        Player.clearRuntimeRegistries();
        Thing.clear();
        Region.clear();
        for (const location of createdLocations) {
            Location.removeFromIndex(location);
        }
    }
});

test('import_item handleUpload uses the explicit slash-command level when provided', async () => {
    const previousConfig = Globals.config;
    const previousPlayer = Globals.currentPlayer;
    const createdLocations = [];

    Player.clearRuntimeRegistries();
    Region.clear();
    Thing.clear();
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };

    try {
        const region = new Region({
            id: 'import-item-override-region-test',
            name: 'Anchorpoint Station',
            description: 'A patched-together salvage station.'
        });

        const location = new Location({
            id: 'import-item-override-location-test',
            name: 'Docking Bay 7',
            description: 'A cluttered docking berth.',
            baseLevel: 3,
            regionId: region.id
        });
        createdLocations.push(location);

        const player = new Player({
            id: 'import-item-override-player-test',
            name: 'Baato',
            location: location.id
        });
        Globals.currentPlayer = player;

        const replies = [];
        const thingRegistry = new Map();

        await ImportItemCommand.handleUpload({
            user: { id: player.id },
            currentPlayer: player,
            thingRegistry,
            parseThingsXml: async () => [{
                name: 'Override Spear',
                description: 'An imported spear.',
                itemOrScenery: 'item',
                relativeLevel: 99
            }],
            reply: async (payload) => {
                replies.push(payload);
            }
        }, { level: 12 }, [
            { filename: 'override.xml', content: '<xml/>' }
        ]);

        const imported = location.things.find(thing => thing.name === 'Override Spear');
        assert.ok(imported);
        assert.equal(imported.level, 12);
        assert.equal(imported.relativeLevel, null);
        assert.equal(imported.metadata.level, 12);
        assert.equal(Object.prototype.hasOwnProperty.call(imported.metadata, 'relativeLevel'), false);
        assert.match(replies[0].content, /at level 12/);
    } finally {
        Globals.config = previousConfig;
        Globals.currentPlayer = previousPlayer;
        Player.clearRuntimeRegistries();
        Thing.clear();
        Region.clear();
        for (const location of createdLocations) {
            Location.removeFromIndex(location);
        }
    }
});

test('import_item handleUpload fails loudly when an uploaded file has no importable entries', async () => {
    const previousConfig = Globals.config;
    const previousPlayer = Globals.currentPlayer;
    const createdLocations = [];

    Player.clearRuntimeRegistries();
    Region.clear();
    Thing.clear();
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };

    try {
        const region = new Region({
            id: 'import-item-empty-region-test',
            name: 'Anchorpoint Station',
            description: 'A patched-together salvage station.'
        });

        const location = new Location({
            id: 'import-item-empty-location-test',
            name: 'Docking Bay 7',
            description: 'A cluttered docking berth.',
            regionId: region.id
        });
        createdLocations.push(location);

        const player = new Player({
            id: 'import-item-empty-player-test',
            name: 'Baato',
            location: location.id
        });
        Globals.currentPlayer = player;

        await assert.rejects(
            () => ImportItemCommand.handleUpload({
                user: { id: player.id },
                currentPlayer: player,
                thingRegistry: new Map(),
                parseThingsXml: async () => [],
                reply: async () => {}
            }, {}, [
                { filename: 'empty.xml', content: '<empty/>' }
            ]),
            /empty\.xml.*did not contain any importable/
        );
    } finally {
        Globals.config = previousConfig;
        Globals.currentPlayer = previousPlayer;
        Player.clearRuntimeRegistries();
        Thing.clear();
        Region.clear();
        for (const location of createdLocations) {
            Location.removeFromIndex(location);
        }
    }
});
