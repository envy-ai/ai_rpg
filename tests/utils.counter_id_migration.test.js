const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

// Match server startup: loading LLMClient first completes the Region/StatusEffect cycle.
require('../LLMClient.js');
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

test('new domain objects receive descriptive ids per object type', () => {
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
    const quest = new Quest({ originLocationLevel: 1, relativeLevel: 0,
      name: 'Find the Gate',
      description: 'Find the old gate.',
      objectives: ['Locate the gate.']
    });
    const effect = new StatusEffect({
      name: 'Bleeding',
      description: 'Losing blood.',
      duration: 3
    });

    assert.equal(player.id, 'char_baato');
    assert.equal(npc.id, 'char_hana');
    assert.equal(thing.id, 'thing_coin');
    assert.equal(region.id, 'region_maplebrook');
    assert.equal(location.id, 'loc_farmhouse');
    assert.equal(exit.id, 'exit_a_lane');
    assert.equal(faction.id, 'faction_the_kinship');
    assert.equal(quest.id, 'quest_find_the_gate');
    assert.equal(quest.toJSON().objectives[0].id, 'obj_locate_the_gate');
    assert.equal(effect.toJSON().id, 'status_bleeding');
  });
});

test('old saves retain domain IDs and references until explicit migration', () => {
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
          name: 'Pending Region',
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

    assert.equal(result.metadata.playerId, 'old_player');
    const player = context.players.get('old_player');
    const npc = context.players.get('old_npc');
    const origin = context.gameLocations.get('old_loc_origin');
    const exit = context.gameLocationExits.get('old_exit');
    const region = context.regions.get('old_region_origin');
    assert.equal(player.id, 'old_player');
    assert.equal(npc.id, 'old_npc');
    assert.equal(player.currentLocation, 'old_loc_origin');
    assert.deepEqual(player.toJSON().inventory, ['old_thing_coin']);
    assert.deepEqual(player.toJSON().partyMembers, ['old_npc']);
    assert.equal(player.toJSON().quests[0].id, 'old_quest');
    assert.equal(player.toJSON().quests[0].giverId, 'old_npc');
    assert.equal(player.toJSON().quests[0].objectives[0].id, 'old_objective');
    assert.deepEqual(origin.npcIds, ['old_npc']);
    assert.deepEqual(origin.thingIds, ['old_thing_coin']);
    assert.equal(exit.destination, 'old_loc_destination');
    assert.equal(exit.destinationRegion, 'old_region_destination');
    assert.deepEqual(region.locationIds, ['old_loc_origin']);
    assert.equal(region.vehicleInfo.vehicleExitId, 'old_exit');
    assert.deepEqual(context.pendingRegionStubs.get('old_pending_region').memberLocationIds, ['old_loc_destination']);
    assert.equal(context.chatHistoryRef[0].content, 'old_loc_origin');
    assert.equal(context.chatHistoryRef[0].metadata.locationId, 'old_loc_origin');
    assert.match(context.chatHistoryRef[0].metadata.prose, /old_loc_origin/);
    const newThing = new Thing({ name: 'Copper Coin', description: 'Another coin.', thingType: 'item' });
    assert.notEqual(newThing.id, 'old_thing_coin');
    assert.equal(context.things.get('old_thing_coin').id, 'old_thing_coin');
    const explicit = require('../DomainIdMigration.js').prepare(serialized).serialized;
    assert.notEqual(explicit.metadata.playerId, 'old_player');
    assert.ok(explicit.players[explicit.metadata.playerId]);
    assert.notEqual(explicit.players[explicit.metadata.playerId].currentLocation, 'old_loc_origin');
    assert.equal(serialized.metadata.playerId, 'old_player', 'explicit preparation does not mutate input');
  });
});


test('hydration reserves later actors ability identities before allocating old missing IDs', () => {
  withTempEnvironment(() => {
    const card = name => ({ name, description: 'A talent.', type: 'Passive', level: 1 });
    const first = new Player({ id: 'char_1', name: 'First', abilities: [card('Salvage Scan')] }).toJSON();
    const second = new Player({ id: 'char_2', name: 'Second', abilities: [{ ...card('Existing'), id: 'ability_salvage_scan' }, { ...card('Legacy'), id: 'legacy-uuid-a1b2' }], pendingAbilityOptionsByLevel: { 1: [{ ...card('Pending'), id: 'ability_pending' }] } }).toJSON();
    delete first.abilities[0].id;
    second.pendingAbilityAttachmentDraftsByLevel = { 1: [{ abilityId: 'ability_pending', draft: { statusEffects: [] } }] };
    const context = createHydrationContext();
    Utils.hydrateGameState({ players: { char_1: first, char_2: second } }, context);
    assert.equal(context.players.get('char_1').getAbilities()[0].id, 'ability_salvage_scan_2');
    const restored = context.players.get('char_2');
    assert.deepEqual(restored.getAbilities().map(ability => ability.id), ['ability_salvage_scan', 'legacy-uuid-a1b2']);
    assert.equal(restored.getPendingAbilityAttachmentDraftsForLevel(1)[0].abilityId, 'ability_pending');
  });
});

test('hydration reserves saved world and later actor IDs before allocating missing nested identities', () => {
  withTempEnvironment(() => {
    const first = new Player({ id: 'char_first', name: 'First', statusEffects: [
      { name: 'Cold Front', description: 'A chill.', duration: 3 }
    ], quests: [{ name: 'First Quest', description: 'A task.', objectives: ['Find the key'] }] }).toJSON();
    const second = new Player({ id: 'char_second', name: 'Second', quests: [
      { id: 'quest_second', name: 'Second Quest', description: 'A task.', objectives: [
        { id: 'obj_find_the_key', description: 'Another task.' }
      ] }
    ] }).toJSON();
    delete first.statusEffects[0].id;
    first.quests = [{ id: 'quest_first', name: 'First Quest', description: 'A task.', objectives: [{ description: 'Find the key' }] }];
    second.quests = [{ id: 'quest_second', name: 'Second Quest', description: 'A task.', objectives: [{ id: 'obj_find_the_key', description: 'Another task.' }] }];
    const serialized = {
      metadata: { saveFileSaveVersion: 1.2 },
      players: { char_first: first, char_second: second },
      gameWorld: { locations: { loc_saved: {
        id: 'loc_saved', name: 'Saved', description: 'A place.', baseLevel: 1, regionId: 'region_saved',
        statusEffects: [{ id: 'status_cold_front', name: 'Other', description: 'A status.', duration: 3 }]
      } } }
    };
    const context = createHydrationContext();
    Utils.hydrateGameState(serialized, context);
    const restored = context.players.get('char_first').toJSON();
    assert.equal(restored.statusEffects[0].id, 'status_cold_front_2');
    assert.equal(restored.quests[0].objectives[0].id, 'obj_find_the_key_2');
    assert.equal(context.gameLocations.get('loc_saved').getStatusEffects()[0].id, 'status_cold_front');
  });
});

test('save metadata preserves deleted named IDs across hydration', () => {
  withTempEnvironment(() => {
    assert.equal(IdGenerator.next('thing', 'Lost Copper Coin'), 'thing_lost_copper_coin');
    assert.equal(IdGenerator.next('thing', 'Lost Copper Coin'), 'thing_lost_copper_coin_2');
    const serialized = Utils.serializeGameState({
      gameLocations: new Map(), gameLocationExits: new Map(), regions: new Map(),
      chatHistory: [], generatedImages: new Map(), things: new Map(), players: new Map(),
      skills: new Map(), factions: new Map(), pendingRegionStubs: new Map()
    });
    assert.equal(serialized.metadata.idNameCounters.thing.lost_copper_coin, 2);
    Utils.hydrateGameState(serialized, createHydrationContext());
    assert.equal(IdGenerator.next('thing', 'Lost Copper Coin'), 'thing_lost_copper_coin_3');
  });
});

test('native snapshot migration and hydration preserve the captured world and pending records', () => {
  withTempEnvironment(() => {
    const { assertSnapshotPreserved } = require('../DomainIdMigrationRuntime.js');
    const DomainIdMigration = require('../DomainIdMigration.js');
    const region = new Region({ id: 'region_1', name: 'North March', description: 'A region.' });
    const location = new Location({ id: 'loc_1', name: 'Old Gate', description: 'A gate.', regionId: region.id });
    const exit = new LocationExit({ id: 'exit_1', description: 'A lane.', destination: location.id });
    const player = new Player({ id: 'char_1', name: 'Mira Vale', currentLocation: location.id,
      pendingAbilityOptionsByLevel: { 2: [{ id: 'ability_1', name: 'Quick Step', description: 'Move.', type: 'Passive', level: 2 }] } });
    const previousArrivalStates = Globals._playerArrivalVisitStates;
    const previousProcessedMove = Globals.processedMove;
    try {
    Globals.clearPlayerArrivalVisitStates();
    Globals.recordPlayerArrivalVisitState(location, false);
    const arrivalId = Globals.getPlayerArrivalId(location.id);
    Globals.processedMove = true;
    const manager = new (require('../QuestConfirmationManager.js'))();
    manager.requestConfirmation({ playerId: player.id, locationId: location.id, quest: new Quest({ originLocationLevel: 1, relativeLevel: 0, id: 'quest_1', name: 'Find Key', description: 'Find it.', objectives: [{ id: 'obj_1', description: 'Find key' }] }) });
    const context = createHydrationContext();
    context.players.set(player.id, player);
    context.regions.set(region.id, region);
    context.gameLocations.set(location.id, location);
    context.gameLocationExits.set(exit.id, exit);
    const capture = () => Utils.serializeGameState({ ...context, currentPlayer: [...context.players.values()][0], chatHistory: context.chatHistoryRef,
      pendingQuestConfirmations: manager.serializePending(),
      runtimeIdMigrationState: { playerArrivalVisitStates: Object.fromEntries(Globals._playerArrivalVisitStates), processedMove: Globals.processedMove } });
    const source = capture();
    source.runtimeIdMigrationState = { playerArrivalVisitStates: Object.fromEntries(Globals._playerArrivalVisitStates), processedMove: Globals.processedMove };
    source.metadata.saveFileSaveVersion = 1.2;
    source.gameWorld.locations.loc_1.lastVisitedTime = null;
    const prepared = DomainIdMigration.prepare(source).serialized;
    Utils.hydrateGameState(prepared, { ...context, preserveRuntimeSnapshot: true });
    for (const [id, record] of Object.entries(prepared.gameWorld.regions)) context.regions.get(id).restoreSavedTimestamps(record);
    for (const [id, record] of Object.entries(prepared.gameWorld.locations)) context.gameLocations.get(id).restoreSavedTimestamps(record);
    for (const [id, record] of Object.entries(prepared.gameWorld.locationExits)) context.gameLocationExits.get(id).restoreSavedTimestamps(record);
    manager.hydratePending(prepared.pendingQuestConfirmations);
    Globals._playerArrivalVisitStates = new Map(Object.entries(prepared.runtimeIdMigrationState.playerArrivalVisitStates));
    Globals.processedMove = prepared.runtimeIdMigrationState.processedMove;
    assert.equal(Globals.getPlayerArrivalId('loc_1'), arrivalId);
    assert.equal(Globals.getPlayerArrivalWasVisitedBeforeMove('loc_1'), false);
    assert.equal(Globals.getPlayerArrivalLastVisitedTimeBeforeMove('loc_1'), null);
    const actual = capture();
    actual.runtimeIdMigrationState = { playerArrivalVisitStates: Object.fromEntries(Globals._playerArrivalVisitStates), processedMove: Globals.processedMove };
    // The API preserves metadata explicitly.
    actual.metadata = { ...prepared.metadata, ...actual.metadata, saveFileSaveVersion: prepared.metadata.saveFileSaveVersion };
    assertSnapshotPreserved(prepared, actual);
    Globals._playerArrivalVisitStates = new Map(Object.entries(source.runtimeIdMigrationState.playerArrivalVisitStates));
    Globals.processedMove = source.runtimeIdMigrationState.processedMove;
    assert.equal(Globals.getPlayerArrivalId('loc_1'), arrivalId, 'rollback restores the original arrival identity');
    assert.equal(Globals.getPlayerArrivalWasVisitedBeforeMove('loc_1'), false);
    } finally {
      Globals._playerArrivalVisitStates = previousArrivalStates;
      Globals.processedMove = previousProcessedMove;
    }
  });
});
