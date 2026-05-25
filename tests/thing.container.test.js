const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Thing = require('../Thing.js');
const Player = require('../Player.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
const Utils = require('../Utils.js');
const Globals = require('../Globals.js');

const originalConfig = Globals.config;

function clearLocationRegistry() {
  for (const location of Location.getAll()) {
    Location.removeFromIndex(location);
  }
}

function makeTempSaveDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-thing-container-save-'));
}

function ensurePlayerTestConfig() {
  Globals.config = {
    ...(originalConfig && typeof originalConfig === 'object' ? originalConfig : {}),
    baseHealthPerLevel: Number.isFinite(originalConfig?.baseHealthPerLevel)
      ? originalConfig.baseHealthPerLevel
      : 10
  };
}

test.afterEach(() => {
  Thing.clear();
  Player.clearRuntimeRegistries();
  clearLocationRegistry();
  Region.clear();
  Globals.config = originalConfig;
});

test('adding a matching item stack to player inventory merges into the existing stack', () => {
  ensurePlayerTestConfig();

  const player = new Player({
    id: 'player-stack-merge',
    name: 'Stack Merge Tester'
  });
  const firstStack = new Thing({
    id: 'thing-player-copper-1',
    name: 'Copper Coin',
    description: 'A plain copper coin.',
    thingType: 'item',
    count: 2
  });
  const secondStack = new Thing({
    id: 'thing-player-copper-2',
    name: 'Copper Coin',
    description: 'A plain copper coin.',
    thingType: 'item',
    count: 3
  });

  player.addInventoryItem(firstStack);
  player.addInventoryItem(secondStack);

  assert.deepEqual(player.getInventoryItems().map(item => item.id), [firstStack.id]);
  assert.equal(firstStack.count, 5);
  assert.equal(Thing.getById(secondStack.id), null);
});

test('adding a matching item stack to a container merges into the existing stack', () => {
  const pouch = new Thing({
    id: 'thing-stack-pouch',
    name: 'Coin Pouch',
    description: 'A small coin pouch.',
    thingType: 'item',
    isContainer: true
  });
  const firstStack = new Thing({
    id: 'thing-container-silver-1',
    name: 'Silver Coin',
    description: 'A plain silver coin.',
    thingType: 'item',
    count: 4
  });
  const secondStack = new Thing({
    id: 'thing-container-silver-2',
    name: 'Silver Coin',
    description: 'A plain silver coin.',
    thingType: 'item',
    count: 6
  });

  pouch.addInventoryItem(firstStack);
  pouch.addInventoryItem(secondStack);

  assert.deepEqual(pouch.getInventoryItems().map(item => item.id), [firstStack.id]);
  assert.equal(firstStack.count, 10);
  assert.equal(Thing.getById(secondStack.id), null);
});

test('adding a matching loose item stack to a location merges into the existing stack', () => {
  const runtimeThings = new Map();
  Thing.registerRuntimeRegistry(runtimeThings);
  try {
    const region = new Region({
      id: 'region-stack-merge',
      name: 'Stack Merge Region',
      description: 'A region for stack merging.'
    });
    const location = new Location({
      id: 'location-stack-merge',
      name: 'Stack Merge Location',
      description: 'A location for stack merging.',
      regionId: region.id
    });
    const firstStack = new Thing({
      id: 'thing-location-iron-1',
      name: 'Iron Spike',
      description: 'A plain iron spike.',
      thingType: 'item',
      count: 5
    });
    const secondStack = new Thing({
      id: 'thing-location-iron-2',
      name: 'Iron Spike',
      description: 'A plain iron spike.',
      thingType: 'item',
      count: 7
    });
    runtimeThings.set(firstStack.id, firstStack);
    runtimeThings.set(secondStack.id, secondStack);

    location.addThingId(firstStack.id);
    location.addThingId(secondStack.id);

    assert.deepEqual(location.thingIds, [firstStack.id]);
    assert.equal(firstStack.count, 12);
    assert.equal(Thing.getById(secondStack.id), null);
    assert.equal(runtimeThings.has(secondStack.id), false);
  } finally {
    Thing.unregisterRuntimeRegistry(runtimeThings);
  }
});

test('container flag and inventory ids persist through JSON and saves', () => {
  const chest = new Thing({
    id: 'thing-chest',
    name: 'Travel Chest',
    description: 'A sturdy chest.',
    thingType: 'scenery',
    isContainer: true
  });
  const apple = new Thing({
    id: 'thing-apple',
    name: 'Apple',
    description: 'A red apple.',
    thingType: 'item'
  });

  chest.addInventoryItem(apple);

  const restored = Thing.fromJSON(chest.toJSON());
  assert.equal(restored.isContainer, true);
  assert.deepEqual(restored.containedThingIds, ['thing-apple']);

  const saveDir = makeTempSaveDir();
  try {
    Utils.writeSerializedGameState(saveDir, {
      gameWorld: {},
      chatHistory: [],
      generatedImages: {},
      things: {
        [chest.id]: chest.toJSON(),
        [apple.id]: apple.toJSON()
      },
      players: {},
      factions: {},
      skills: [],
      metadata: {},
      pendingRegionStubs: {},
      worldTime: null,
      calendarDefinition: null,
      gameConfigOverrideYaml: '',
      chatSummaries: {},
      sceneSummaries: {}
    });

    const reloaded = Utils.loadSerializedGameState(saveDir);
    assert.equal(reloaded.things[chest.id].isContainer, true);
    assert.deepEqual(reloaded.things[chest.id].containedThingIds, [apple.id]);
    assert.equal(reloaded.things[apple.id].metadata.containerId, chest.id);
  } finally {
    fs.rmSync(saveDir, { recursive: true, force: true });
  }
});

test('pending container contents normalize and persist through JSON and saves', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  let crate;
  try {
    crate = new Thing({
      id: 'thing-pending-crate',
      name: 'Sealed Supply Crate',
      description: 'A sealed crate with a manifest tag.',
      thingType: 'scenery',
      isContainer: false,
      containerContents: [
        { name: 'Signal Flares', count: '3 flares' },
        { name: 'Folded Map' }
      ]
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(crate.isContainer, true);
  assert.match(warnings.join('\n'), /container contents/i);
  assert.deepEqual(crate.containerContents, [
    { name: 'Signal Flares', count: 3 },
    { name: 'Folded Map', count: 1 }
  ]);

  const restored = Thing.fromJSON(crate.toJSON());
  assert.equal(restored.isContainer, true);
  assert.deepEqual(restored.containerContents, [
    { name: 'Signal Flares', count: 3 },
    { name: 'Folded Map', count: 1 }
  ]);

  const empty = new Thing({
    id: 'thing-empty-container',
    name: 'Empty Box',
    description: 'An empty box.',
    thingType: 'item',
    isContainer: true,
    containerContents: []
  });
  assert.deepEqual(empty.containerContents, []);

  const saveDir = makeTempSaveDir();
  try {
    Utils.writeSerializedGameState(saveDir, {
      gameWorld: {},
      chatHistory: [],
      generatedImages: {},
      things: {
        [crate.id]: crate.toJSON(),
        [empty.id]: empty.toJSON()
      },
      players: {},
      factions: {},
      skills: [],
      metadata: {},
      pendingRegionStubs: {},
      worldTime: null,
      calendarDefinition: null,
      gameConfigOverrideYaml: '',
      chatSummaries: {},
      sceneSummaries: {}
    });

    const reloaded = Utils.loadSerializedGameState(saveDir);
    assert.deepEqual(reloaded.things[crate.id].containerContents, [
      { name: 'Signal Flares', count: 3 },
      { name: 'Folded Map', count: 1 }
    ]);
    assert.deepEqual(reloaded.things[empty.id].containerContents, []);
  } finally {
    fs.rmSync(saveDir, { recursive: true, force: true });
  }
});

test('pending container contents ignore empty sentinels and zero-count seeds', () => {
  const pouch = new Thing({
    id: 'thing-mostly-empty-pouch',
    name: 'Mostly Empty Pouch',
    description: 'A pouch with a misleading manifest.',
    thingType: 'item',
    isContainer: true,
    containerContents: [
      { name: 'empty' },
      { name: 'None' },
      { name: 'N/A' },
      { name: 'Signal Flares', count: 0 },
      { name: 'Empty Vial', count: 1 }
    ]
  });

  assert.deepEqual(pouch.containerContents, [
    { name: 'Empty Vial', count: 1 }
  ]);

  const restored = Thing.fromJSON(pouch.toJSON());
  assert.deepEqual(restored.containerContents, [
    { name: 'Empty Vial', count: 1 }
  ]);
});

test('requiresCheckToOpen persists through Thing JSON', () => {
  const safe = new Thing({
    id: 'thing-locked-safe',
    name: 'Locked Safe',
    description: 'A safe with a stubborn dial.',
    thingType: 'scenery',
    isContainer: true,
    requiresCheckToOpen: true
  });

  assert.equal(safe.requiresCheckToOpen, true);
  assert.equal(safe.toJSON().requiresCheckToOpen, true);
  assert.equal(safe.toJSON().metadata.requiresCheckToOpen, true);

  const restored = Thing.fromJSON(safe.toJSON());
  assert.equal(restored.requiresCheckToOpen, true);
});

test('adding and removing contained items updates placement metadata loudly', () => {
  ensurePlayerTestConfig();

  const player = new Player({
    id: 'player-1',
    name: 'Tester',
    description: 'Test player.',
    isNPC: false
  });
  const region = new Region({
    id: 'region-1',
    name: 'Test Region',
    description: 'A test region.'
  });
  const location = new Location({
    id: 'location-1',
    name: 'Test Room',
    description: 'A room for tests.',
    regionId: region.id
  });
  const box = new Thing({
    id: 'thing-box',
    name: 'Box',
    description: 'A box.',
    thingType: 'item',
    isContainer: true
  });
  const coin = new Thing({
    id: 'thing-coin',
    name: 'Coin',
    description: 'A coin.',
    thingType: 'item'
  });

  player.addInventoryItem(coin);
  location.addThingId(box.id);

  box.addInventoryItem(coin);
  assert.equal(player.hasInventoryItem(coin.id), false);
  assert.equal(box.hasInventoryItem(coin.id), true);
  assert.equal(coin.metadata.containerId, box.id);
  assert.equal(coin.metadata.ownerId, undefined);
  assert.equal(coin.metadata.playerId, undefined);
  assert.equal(coin.metadata.locationId, undefined);

  assert.equal(box.removeInventoryItem(coin), true);
  assert.equal(box.hasInventoryItem(coin.id), false);
  assert.equal(coin.metadata.containerId, undefined);
});

test('removeFromWorld cleans items out of containing inventories', () => {
  const cabinet = new Thing({
    id: 'thing-cabinet',
    name: 'Cabinet',
    description: 'A cabinet.',
    thingType: 'scenery',
    isContainer: true
  });
  const key = new Thing({
    id: 'thing-key',
    name: 'Key',
    description: 'A small key.',
    thingType: 'item'
  });

  cabinet.addInventoryItem(key);
  assert.equal(cabinet.hasInventoryItem(key.id), true);

  key.removeFromWorld();
  assert.equal(cabinet.hasInventoryItem(key.id), false);
  assert.deepEqual(cabinet.containedThingIds, []);
});

test('nested containers reject self and descendant cycles', () => {
  const satchel = new Thing({
    id: 'thing-satchel',
    name: 'Satchel',
    description: 'A worn satchel.',
    thingType: 'item',
    isContainer: true
  });
  const pouch = new Thing({
    id: 'thing-pouch',
    name: 'Pouch',
    description: 'A small pouch.',
    thingType: 'item',
    isContainer: true
  });

  assert.throws(() => satchel.addInventoryItem(satchel), /cannot contain itself/i);

  satchel.addInventoryItem(pouch);
  assert.throws(() => pouch.addInventoryItem(satchel), /descendants/i);
});

test('deleting non-empty containers is rejected, but contained non-container deletion cleans parent', () => {
  const crate = new Thing({
    id: 'thing-crate',
    name: 'Crate',
    description: 'A storage crate.',
    thingType: 'scenery',
    isContainer: true
  });
  const nail = new Thing({
    id: 'thing-nail',
    name: 'Nail',
    description: 'A bent nail.',
    thingType: 'item'
  });

  crate.addInventoryItem(nail);
  assert.throws(() => crate.delete(), /Cannot delete non-empty container/);

  nail.delete();
  assert.equal(crate.hasInventoryItem(nail.id), false);
  assert.deepEqual(crate.containedThingIds, []);

  assert.doesNotThrow(() => crate.delete());
});
