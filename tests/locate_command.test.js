const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Player = require('../Player.js');
const Region = require('../Region.js');
const Thing = require('../Thing.js');
const LocateCommand = require('../slashcommands/locate.js');

function withLocateCommandState(callback) {
    const previousConfig = Globals.config;
    const previousCurrentPlayer = Globals.currentPlayer;
    const createdLocations = [];

    Player.clearRuntimeRegistries();
    Region.clear();
    Thing.clear();
    Globals.currentPlayer = null;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };

    const createLocation = (options) => {
        const location = new Location(options);
        createdLocations.push(location);
        return location;
    };

    return Promise.resolve()
        .then(() => callback({ createLocation }))
        .finally(() => {
            Globals.currentPlayer = previousCurrentPlayer;
            Globals.config = previousConfig;
            Player.clearRuntimeRegistries();
            Region.clear();
            Thing.clear();
            for (const location of createdLocations) {
                Location.removeFromIndex(location);
            }
        });
}

function createInteraction(argsText) {
    const replies = [];
    return {
        replies,
        interaction: {
            argsText,
            reply: async (payload) => {
                replies.push(payload);
            }
        }
    };
}

test('/locate returns all exact NPC name or alias matches in markdown', async () => withLocateCommandState(async ({ createLocation }) => {
    const region = new Region({
        id: 'locate-command-region',
        name: 'Glass Marches',
        description: 'A bright desert of glass dunes.'
    });
    const bazaar = createLocation({
        id: 'locate-command-bazaar',
        name: 'Mirror Bazaar',
        description: 'A market of reflected awnings.',
        regionId: region.id
    });
    const cistern = createLocation({
        id: 'locate-command-cistern',
        name: 'Old Cistern',
        description: 'A cool chamber beneath the market.',
        regionId: region.id
    });
    region.addLocation(bazaar.id);
    region.addLocation(cistern.id);

    new Player({
        id: 'locate-command-npc-one',
        name: 'Mira Dawn',
        aliases: ['Blade'],
        isNPC: true,
        location: bazaar.id
    });
    new Player({
        id: 'locate-command-npc-two',
        name: 'Mira Dusk',
        aliases: ['Blade'],
        isNPC: true,
        location: cistern.id
    });

    const { interaction, replies } = createInteraction('Blade');
    await LocateCommand.execute(interaction, {});

    assert.equal(replies.length, 1);
    assert.equal(replies[0].ephemeral, false);
    assert.match(replies[0].content, /^Locate results for "Blade":/);
    assert.match(replies[0].content, /\| NPC \| Location \| Region \| Matched \|/);
    assert.match(replies[0].content, /\| Mira Dawn \| Mirror Bazaar \| Glass Marches \| alias: Blade \|/);
    assert.match(replies[0].content, /\| Mira Dusk \| Old Cistern \| Glass Marches \| alias: Blade \|/);
    assert.doesNotMatch(replies[0].content, /\| Type \|/);
}));

test('/locate does not return NPC substring or thing matches', async () => withLocateCommandState(async ({ createLocation }) => {
    const region = new Region({
        id: 'locate-command-no-substring-region',
        name: 'Copper Quarter',
        description: 'A district of copper rooftops.'
    });
    const workshop = createLocation({
        id: 'locate-command-workshop',
        name: 'Clockmaker Workshop',
        description: 'A room full of ticking brass.',
        regionId: region.id
    });
    region.addLocation(workshop.id);

    new Player({
        id: 'locate-command-ashara',
        name: 'Captain Ashara',
        aliases: ['The Mapmaker'],
        isNPC: true,
        location: workshop.id
    });
    new Thing({
        id: 'locate-command-thing-ash',
        name: 'Ash',
        description: 'A pinch of gray ash.',
        thingType: 'item'
    });

    const { interaction, replies } = createInteraction('Ash');
    await LocateCommand.execute(interaction, {});

    assert.deepEqual(replies, [{
        content: 'No NPCs found for name or alias "Ash".',
        ephemeral: false
    }]);
}));
