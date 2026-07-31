const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const {
  initializeSlashCommands,
  getSlashCommandModule
} = require('../SlashCommandRegistry.js');
const {
  createTempDefsDir,
  withStandardTestConfig
} = require('./helpers/needBarFixtures.js');

function writeTempDefs() {
  return createTempDefsDir({
    prefix: 'ai-rpg-refill-needs-',
    attributes: [
      { id: 'strength', label: 'Strength', default: 5 },
      { id: 'constitution', label: 'Constitution', default: 5 }
    ],
    needBarsYaml: `
need_bars:
  morale:
    name: Morale
    player: false
    party: true
    non_party: true
    min: 0
    max: 120
    initial: 25
  stamina:
    name: Stamina
    player: true
    party: true
    non_party: true
    min: 0
    max: 80
    initial: 10
  focus:
    name: Focus
    player: true
    party: false
    non_party: false
    min: 0
    max: 50
    initial: 5
`
  });
}

async function withRefillNeedsState(callback) {
  const previousBaseDir = Globals.baseDir;
  const previousConfig = Globals.config;
  const previousGameLoaded = Globals.gameLoaded;
  const previousCurrentPlayer = Globals.currentPlayer;
  const tempBaseDir = writeTempDefs();

  Player.clearRuntimeRegistries();
  Globals.baseDir = tempBaseDir;
  Globals.currentPlayer = null;
  Globals.gameLoaded = true;
  Globals.config = withStandardTestConfig(previousConfig);
  Player.reloadDefinitionCaches({ refreshInstances: false });

  try {
    return await callback();
  } finally {
    Player.clearRuntimeRegistries();
    Globals.baseDir = previousBaseDir;
    Globals.config = previousConfig;
    Globals.gameLoaded = previousGameLoaded;
    Globals.currentPlayer = previousCurrentPlayer;
    Player.reloadDefinitionCaches({ refreshInstances: false });
    fs.rmSync(tempBaseDir, { recursive: true, force: true });
  }
}

function getCommand() {
  initializeSlashCommands();
  const command = getSlashCommandModule('refill_needs');
  assert.ok(command, 'refill_needs command should be registered');
  return command;
}

function createInteraction({ argsText, userId = 'refill-needs-player' } = {}) {
  const replies = [];
  const refreshRequests = [];
  return {
    replies,
    refreshRequests,
    interaction: {
      user: { id: userId },
      argsText,
      requestClientRefresh: payload => {
        refreshRequests.push(payload);
      },
      reply: async payload => {
        replies.push(payload);
      }
    }
  };
}

test('refill_needs command is registered', () => {
  getCommand();
});

test('/refill_needs refills a named NPC by alias to each stored bar max', async () => withRefillNeedsState(async () => {
  const command = getCommand();
  const player = new Player({
    id: 'refill-needs-player',
    name: 'Baato'
  });
  const quartermaster = new Player({
    id: 'refill-needs-quartermaster',
    name: 'Quartermaster Vale',
    aliases: ['Vale'],
    isNPC: true,
    needBars: [
      { id: 'morale', value: 31 },
      { id: 'stamina', value: 12 }
    ]
  });
  const bystander = new Player({
    id: 'refill-needs-bystander',
    name: 'Bystander Noll',
    isNPC: true,
    needBars: [
      { id: 'morale', value: 44 },
      { id: 'stamina', value: 22 }
    ]
  });

  const { interaction, replies, refreshRequests } = createInteraction({ argsText: 'Vale', userId: player.id });
  await command.execute(interaction, {});

  assert.equal(quartermaster.getNeedBarValue('morale'), 120);
  assert.equal(quartermaster.getNeedBarValue('stamina'), 80);
  assert.equal(bystander.getNeedBarValue('morale'), 44);
  assert.equal(bystander.getNeedBarValue('stamina'), 22);
  assert.deepEqual(replies, [{
    content: 'Refilled 2 stored need bars for Quartermaster Vale.',
    ephemeral: false
  }]);
  assert.deepEqual(refreshRequests, [{ locationRefreshRequested: true }]);
}));

test('/refill_needs all refills every NPC and excludes player actors', async () => withRefillNeedsState(async () => {
  const command = getCommand();
  const player = new Player({
    id: 'refill-needs-player',
    name: 'Baato',
    needBars: [
      { id: 'stamina', value: 11 },
      { id: 'focus', value: 6 }
    ]
  });
  const firstNpc = new Player({
    id: 'refill-needs-all-a',
    name: 'Dockhand Pell',
    isNPC: true,
    needBars: [
      { id: 'morale', value: 1 },
      { id: 'stamina', value: 2 }
    ]
  });
  const secondNpc = new Player({
    id: 'refill-needs-all-b',
    name: 'Mira Dawn',
    isNPC: true,
    needBars: [
      { id: 'morale', value: 3 },
      { id: 'stamina', value: 4 }
    ]
  });

  const { interaction, replies } = createInteraction({ argsText: 'all', userId: player.id });
  await command.execute(interaction, {});

  assert.equal(firstNpc.getNeedBarValue('morale'), 120);
  assert.equal(firstNpc.getNeedBarValue('stamina'), 80);
  assert.equal(secondNpc.getNeedBarValue('morale'), 120);
  assert.equal(secondNpc.getNeedBarValue('stamina'), 80);
  assert.equal(player.getNeedBarValue('stamina'), 11);
  assert.equal(player.getNeedBarValue('focus'), 6);
  assert.deepEqual(replies, [{
    content: 'Refilled 4 stored need bars for 2 NPCs: Dockhand Pell and Mira Dawn.',
    ephemeral: false
  }]);
}));

test('/refill_needs rejects non-NPC targets', async () => withRefillNeedsState(async () => {
  const command = getCommand();
  const player = new Player({
    id: 'refill-needs-player',
    name: 'Baato'
  });

  const { interaction } = createInteraction({ argsText: 'Baato', userId: player.id });

  await assert.rejects(
    () => command.execute(interaction, {}),
    /Character "Baato" is not an NPC\./
  );
}));
