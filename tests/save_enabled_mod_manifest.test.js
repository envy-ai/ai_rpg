const assert = require('node:assert/strict');
const test = require('node:test');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');

test('serializeGameState stores the active enabled mod manifest in metadata', () => {
  const previousSceneSummaries = Globals.sceneSummaries;
  Globals.sceneSummaries = { serialize: () => ({}) };
  let serialized;
  try {
    serialized = Utils.serializeGameState({
      gameLocations: new Map(),
      gameLocationExits: new Map(),
      regions: new Map(),
      chatHistory: [],
      generatedImages: new Map(),
      things: new Map(),
      players: new Map(),
      skills: new Map(),
      factions: new Map(),
      enabledMods: ['spells', 'implants']
    });
  } finally {
    Globals.sceneSummaries = previousSceneSummaries;
  }

  assert.deepEqual(serialized.metadata.enabledMods, ['implants', 'spells']);
});
