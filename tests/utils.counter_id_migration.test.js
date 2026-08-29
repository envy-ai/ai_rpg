const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Thing = require('../Thing.js');
const Location = require('../Location.js');
const LocationExit = require('../LocationExit.js');
const Region = require('../Region.js');
const Faction = require('../Faction.js');
const Quest = require('../Quest.js');
const StatusEffect = require('../StatusEffect.js');
const Utils = require('../Utils.js');
const IdGenerator = require('../IdGenerator.js');
const {
  createTempDefsDir,
  withStandardTestConfig
} = require('./helpers/needBarFixtures.js');
const {
  createHydrationContext,
  createSceneSummariesStub
} = require('./helpers/locationFixtures.js');

function clearLocationRegistry() {
  for (const location of Location.getAll()) {
    Location.removeFromIndex(location);
  }
}

function createTempDefs() {
  return createTempDefsDir({
    prefix: 'ai-rpg-counter-ids-',
    attributes: [
      { id: 'constitution', label: 'Constitution', default: 10 }
    ]
  });
}

function withTempEnvironment(run) {
  const tempBaseDir = createTempDefs();
  const previousBaseDir = Globals.baseDir;
  const previousConfig = Globals.config;
  const previousSceneSummaries = Globals.sceneSummaries;

  Player.clearRuntimeRegistries();
  Thing.clear();
  clearLocationRegistry();
  Region.clear();
  Faction.clear();
  IdGenerator.reset();

  Globals.baseDir = tempBaseDir;
  Globals.config = withStandardTestConfig(previousConfig, { preserveBaseHealth: false });
  Globals.sceneSummaries = createSceneSummariesStub();
  Player.reloadDefinitionCaches({ refreshInstances: false });

  try {
    run();
  } finally {
    Player.clearRuntimeRegistries();
    Thing.clear();
    clearLocationRegistry();
    Region.clear();
    Faction.clear();
    IdGenerator.reset();
    Globals.baseDir = previousBaseDir;
    Globals.config = previousConfig;
    Globals.sceneSummaries = previousSceneSummaries;
    Player.reloadDefinitionCaches({ refreshInstances: false });
    fs.rmSync(tempBaseDir, { recursive: true, force: true });
  }
}

test('new domain objects receive compact counter ids per object type', () => {
  withTempEnvironment(() => {
    const player = new Player({ name: 'Baato', description: 'The player.' });
    const npc = new Player({ name: 'Hana', description: 'A merchant.', isNPC: true });
    const thing = new Thing({ name: 'Coin', description: 'A coin.', thingType: 'item' });
    const region = new Region({ name: 'Maplebrook', description: 'A quiet region.' });
    const location = new Location({
      name: 'Farmhouse',
      description: 'A farmhouse.',
      regionId: region.id
    });
    const exit = new LocationExit({ description: 'A lane.', destination: location.id });
    const faction = new Faction({
      name: 'The Kinship',
      description: 'A local faction.'
    });
    const quest = new Quest({
      name: 'Find the Gate',
      description: 'Find the old gate.',
      objectives: ['Locate the gate.']
    });
    const effect = new StatusEffect({
      name: 'Bleeding',
      description: 'Losing blood.',
      duration: 3
    });

    assert.equal(player.id, 'char_1');
    assert.equal(npc.id, 'char_2');
    assert.equal(thing.id, 'thing_1');
    assert.equal(region.id, 'region_1');
    assert.equal(location.id, 'loc_1');
    assert.equal(exit.id, 'exit_1');
    assert.equal(faction.id, 'faction_1');
    assert.equal(quest.id, 'quest_1');
    assert.equal(quest.toJSON().objectives[0].id, 'obj_1');
    assert.equal(effect.toJSON().id, 'status_1');
  });
});

test('old saves migrate domain object ids and structured references to compact counters', () => {
  withTempEnvironment(() => {
    const serialized = {
      gameWorld: {
        locations: {
          old_loc_origin: {
            id: 'old_loc_origin',
            name: 'Farmhouse Exterior',
            description: 'Outside the farmhouse.',
            baseLevel: 1,
            regionId: 'old_region_origin',
            controllingFactionId: 'old_faction_main',
            npcIds: ['old_npc'],
            thingIds: ['old_thing_coin'],
            statusEffects: [
              { name: 'Fogbound', description: 'Fog clings here.', duration: 5 }
            ],
            exits: {
              north: {
                id: 'old_exit',
                description: 'A lane north.',
                destination: 'old_loc_destination',
                destinationRegion: 'old_region_destination',
                travelTimeMinutes: 2,
                bidirectional: true
              }
            }
          },
          old_loc_destination: {
            id: 'old_loc_destination',
            name: 'Front Porch',
            description: 'A front porch.',
            baseLevel: 1,
            regionId: 'old_region_destination',
            npcIds: [],
            thingIds: []
          }
        },
        locationExits: {
          old_exit: {
            id: 'old_exit',
            description: 'A lane north.',
            destination: 'old_loc_destination',
            destinationRegion: 'old_region_destination',
            travelTimeMinutes: 2,
            bidirectional: true
          }
        },
        regions: {
          old_region_origin: {
            id: 'old_region_origin',
            name: 'Maplebrook',
            description: 'A quiet region.',
            locationIds: ['old_loc_origin'],
            entranceLocationId: 'old_loc_origin',
            controllingFactionId: 'old_faction_main',
            vehicleInfo: {
              currentDestination: 'old_loc_destination',
              destinations: ['old_loc_destination'],
              vehicleExitId: 'old_exit'
            },
            statusEffects: [
              { name: 'Stormfront', description: 'A storm is near.', duration: 7 }
            ]
          },
          old_region_destination: {
            id: 'old_region_destination',
            name: 'Porch Region',
            description: 'A tiny region.',
            locationIds: ['old_loc_destination'],
            entranceLocationId: 'old_loc_destination'
          }
        }
      },
      chatHistory: [
        {
          role: 'assistant',
          content: 'old_loc_origin',
          metadata: {
            locationId: 'old_loc_origin',
            prose: 'Do not rewrite embedded old_loc_origin prose references.'
          }
        }
      ],
      generatedImages: {},
      things: {
        old_thing_coin: {
          id: 'old_thing_coin',
          name: 'Copper Coin',
          description: 'A copper coin.',
          thingType: 'item',
          metadata: {
            ownerId: 'old_player',
            locationId: 'old_loc_origin'
          },
          statusEffects: [
            { name: 'Cursed', description: 'The coin is unlucky.', duration: -1 }
          ]
        }
      },
      players: {
        old_npc: {
          id: 'old_npc',
          name: 'Hana',
          description: 'A merchant.',
          isNPC: true,
          currentLocation: 'old_loc_origin',
          statusEffects: [
            { name: 'Bleeding', description: 'A bleeding wound.', duration: 4 }
          ]
        },
        old_player: {
          id: 'old_player',
          name: 'Baato',
          description: 'The player.',
          isNPC: false,
          currentLocation: 'old_loc_origin',
          inventory: ['old_thing_coin'],
          partyMembers: ['old_npc'],
          dispositions: {
            old_npc: { value: 5, text: 'Friendly.' }
          },
          quests: [
            {
              id: 'old_quest',
              name: 'Find the Porch',
              description: 'Find the porch.',
              giverId: 'old_npc',
              rewardItems: ['old_thing_coin'],
              objectives: [
                {
                  id: 'old_objective',
                  description: 'Reach the porch.',
                  completed: false
                }
              ]
            }
          ]
        }
      },
      factions: {
        old_faction_main: {
          id: 'old_faction_main',
          name: 'Farmstead Kin',
          description: 'A faction.',
          relations: {
            old_faction_peer: {
              status: 'neutral',
              notes: 'Known neighbors.'
            }
          }
        },
        old_faction_peer: {
          id: 'old_faction_peer',
          name: 'Neighbor Circle',
          description: 'Another faction.'
        }
      },
      skills: [],
      metadata: {
        saveFileSaveVersion: 1.1,
        playerId: 'old_player'
      },
      setting: null,
      chatSummaries: {},
      sceneSummaries: {},
      pendingRegionStubs: {
        old_pending_region: {
          id: 'old_pending_region',
          sourceLocationId: 'old_loc_origin',
          exitId: 'old_exit',
          memberLocationIds: ['old_loc_destination']
        }
      },
      worldTime: null,
      calendarDefinition: null,
      gameConfigOverrideYaml: ''
    };

    const context = createHydrationContext();
    const result = Utils.hydrateGameState(serialized, context);

    assert.equal(result.metadata.saveFileSaveVersion, 1.2);
    assert.equal(result.metadata.playerId, 'char_1');
    assert.deepEqual(result.metadata.idCounters, {
      char: 2,
      thing: 1,
      loc: 2,
      exit: 1,
      region: 3,
      faction: 2,
      quest: 1,
      obj: 1,
      status: 4
    });

    const player = context.players.get('char_1');
    const npc = context.players.get('char_2');
    const origin = context.gameLocations.get('loc_1');
    const destination = context.gameLocations.get('loc_2');
    const exit = context.gameLocationExits.get('exit_1');
    const region = context.regions.get('region_1');
    const faction = context.factions.get('faction_1');

    assert.equal(player.id, 'char_1');
    assert.equal(npc.id, 'char_2');
    assert.equal(player.currentLocation, 'loc_1');
    assert.deepEqual(player.toJSON().inventory, ['thing_1']);
    assert.deepEqual(player.toJSON().partyMembers, ['char_2']);
    assert.equal(player.toJSON().quests[0].id, 'quest_1');
    assert.equal(player.toJSON().quests[0].giverId, 'char_2');
    assert.deepEqual(player.toJSON().quests[0].rewardItems[0], {
      name: 'thing_1',
      description: ''
    });
    assert.equal(player.toJSON().quests[0].objectives[0].id, 'obj_1');
    assert.equal(npc.toJSON().statusEffects[0].id, 'status_1');

    assert.equal(origin.id, 'loc_1');
    assert.equal(destination.id, 'loc_2');
    assert.deepEqual(origin.npcIds, ['char_2']);
    assert.deepEqual(origin.thingIds, ['thing_1']);
    assert.equal(origin.getStatusEffects()[0].id, 'status_3');
    assert.equal(exit.id, 'exit_1');
    assert.equal(exit.destination, 'loc_2');
    assert.equal(exit.destinationRegion, 'region_2');
    assert.deepEqual(region.locationIds, ['loc_1']);
    assert.equal(region.entranceLocationId, 'loc_1');
    assert.equal(region.vehicleInfo.currentDestination, 'loc_2');
    assert.deepEqual(region.vehicleInfo.destinations, ['loc_2']);
    assert.equal(region.vehicleInfo.vehicleExitId, 'exit_1');
    assert.deepEqual(Object.keys(faction.toJSON().relations), ['faction_2']);
    assert.deepEqual(context.pendingRegionStubs.get('region_3').memberLocationIds, ['loc_2']);
    assert.equal(context.chatHistoryRef[0].content, 'loc_1');
    assert.equal(context.chatHistoryRef[0].metadata.locationId, 'loc_1');
    assert.equal(
      context.chatHistoryRef[0].metadata.prose,
      'Do not rewrite embedded old_loc_origin prose references.'
    );
  });
});
