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

test.afterEach(() => {
  Thing.clear();
  Player.clearRuntimeRegistries();
  clearLocationRegistry();
  Region.clear();
  Globals.config = originalConfig;
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

test('adding and removing contained items updates placement metadata loudly', () => {
  Globals.config = {
    ...(originalConfig && typeof originalConfig === 'object' ? originalConfig : {}),
    baseHealthPerLevel: Number.isFinite(originalConfig?.baseHealthPerLevel)
      ? originalConfig.baseHealthPerLevel
      : 10
  };

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
