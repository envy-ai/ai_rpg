const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const {
  initializeSlashCommands,
  getSlashCommandModule
} = require('../SlashCommandRegistry.js');

function getCommand() {
  initializeSlashCommands();
  const command = getSlashCommandModule('clear_relationships');
  assert.ok(command, 'clear_relationships command should be registered');
  return command;
}

async function withPlayerState(callback) {
  const previousConfig = Globals.config;
  Player.clearRuntimeRegistries();
  Globals.config = {
    ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
    baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
      ? previousConfig.baseHealthPerLevel
      : 10
  };

  try {
    return await callback();
  } finally {
    Player.clearRuntimeRegistries();
    Globals.config = previousConfig;
  }
}

function createInteraction({ performGameSave = async () => {}, requestClientRefresh = () => {} } = {}) {
  const replies = [];
  return {
    replies,
    performGameSave,
    requestClientRefresh,
    reply: async payload => {
      replies.push(payload);
    }
  };
}

test('clear_relationships command is registered', () => {
  getCommand();
});

test('clear_relationships clears every current character relationship and saves', async () => withPlayerState(async () => {
  const command = getCommand();
  const player = new Player({
    id: 'clear-rel-player',
    name: 'Baato',
    relationships: {
      'clear-rel-npc-a': 'trusted ally'
    }
  });
  const npcA = new Player({
    id: 'clear-rel-npc-a',
    name: 'Ithelwen',
    isNPC: true,
    relationships: {
      'clear-rel-player': 'curious patron',
      'clear-rel-npc-b': 'old rival'
    }
  });
  const npcB = new Player({
    id: 'clear-rel-npc-b',
    name: 'Marta',
    isNPC: true,
    relationships: {
      'clear-rel-npc-a': 'watchful rival'
    }
  });

  let saveCount = 0;
  const refreshRequests = [];
  const interaction = createInteraction({
    performGameSave: async () => {
      saveCount += 1;
    },
    requestClientRefresh: payload => {
      refreshRequests.push(payload);
    }
  });

  await command.execute(interaction, {});

  assert.deepEqual(player.getRelationships(), {});
  assert.deepEqual(npcA.getRelationships(), {});
  assert.deepEqual(npcB.getRelationships(), {});
  assert.equal(saveCount, 1);
  assert.deepEqual(refreshRequests, [{ relationshipGraphRefreshRequested: true }]);
  assert.equal(interaction.replies.length, 1);
  assert.equal(interaction.replies[0].ephemeral, false);
  assert.match(interaction.replies[0].content, /Cleared 4 relationship edges across 3 characters\./);
}));

test('clear_relationships reports when no relationships exist without saving', async () => withPlayerState(async () => {
  const command = getCommand();
  new Player({ id: 'clear-rel-empty-player', name: 'Baato' });
  new Player({ id: 'clear-rel-empty-npc', name: 'Ithelwen', isNPC: true });

  let saveCount = 0;
  const interaction = createInteraction({
    performGameSave: async () => {
      saveCount += 1;
    }
  });

  await command.execute(interaction, {});

  assert.equal(saveCount, 0);
  assert.deepEqual(interaction.replies, [{
    content: 'No current relationships are recorded.',
    ephemeral: false
  }]);
}));

test('clear_relationships fails loudly when mutated relationships cannot be saved', async () => withPlayerState(async () => {
  const command = getCommand();
  new Player({
    id: 'clear-rel-unsaved-player',
    name: 'Baato',
    relationships: {
      'clear-rel-unsaved-npc': 'old rival'
    }
  });
  new Player({ id: 'clear-rel-unsaved-npc', name: 'Ithelwen', isNPC: true });

  const interaction = createInteraction({ performGameSave: null });

  await assert.rejects(
    () => command.execute(interaction, {}),
    /performGameSave is unavailable; cannot persist relationship clearing\./
  );
}));
