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
  const command = getSlashCommandModule('regen_party_images');
  assert.ok(command, 'regen_party_images command should be registered');
  return command;
}

async function withPlayerState(callback) {
  const previousConfig = Globals.config;
  const previousCurrentPlayer = Globals.currentPlayer;
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
    Globals.currentPlayer = previousCurrentPlayer;
    Globals.config = previousConfig;
  }
}

function createInteraction({
  currentPlayer = null,
  clientId = 'client-regeneration-test',
  generatePlayerImage = async () => ({ success: true, jobId: 'job-test' })
} = {}) {
  const replies = [];
  return {
    user: { id: currentPlayer?.id || null },
    currentPlayer,
    clientId,
    replies,
    generatePlayerImage,
    reply: async payload => {
      replies.push(payload);
    }
  };
}

test('regen_party_images command is registered', () => {
  getCommand();
});

test('regen_party_images regenerates only NPC party members with force and client id', async () => withPlayerState(async () => {
  const command = getCommand();
  const player = new Player({
    id: 'regen-party-player',
    name: 'Baato',
    partyMembers: ['regen-party-npc-a', 'regen-party-non-npc', 'regen-party-npc-b', 'missing-party-id']
  });
  new Player({
    id: 'regen-party-npc-a',
    name: 'Ithelwen',
    isNPC: true
  });
  new Player({
    id: 'regen-party-non-npc',
    name: 'Other Player',
    isNPC: false
  });
  new Player({
    id: 'regen-party-npc-b',
    name: 'Marta',
    isNPC: true
  });

  const calls = [];
  const interaction = createInteraction({
    currentPlayer: player,
    clientId: 'client-party-images',
    generatePlayerImage: async (member, options) => {
      calls.push({ member, options });
      return { success: true, jobId: `job-${member.id}` };
    }
  });

  await command.execute(interaction, {});

  assert.deepEqual(calls.map(call => call.member.name), ['Ithelwen', 'Marta']);
  assert.deepEqual(calls.map(call => call.options), [
    { force: true, clientId: 'client-party-images' },
    { force: true, clientId: 'client-party-images' }
  ]);
  assert.equal(interaction.replies.length, 1);
  assert.equal(interaction.replies[0].ephemeral, false);
  assert.match(interaction.replies[0].content, /Queued portraits \(2\): Ithelwen, Marta/);
  assert.match(interaction.replies[0].content, /Skipped party entries \(2\): Other Player \(not an NPC\), missing-party-id \(not found\)/);
  assert.doesNotMatch(interaction.replies[0].content, /Baato/);
}));

test('regen_party_images reports when the player has no NPC party members', async () => withPlayerState(async () => {
  const command = getCommand();
  const player = new Player({
    id: 'regen-party-empty-player',
    name: 'Baato',
    partyMembers: []
  });
  let generateCalled = false;
  const interaction = createInteraction({
    currentPlayer: player,
    generatePlayerImage: async () => {
      generateCalled = true;
      return { success: true };
    }
  });

  await command.execute(interaction, {});

  assert.equal(generateCalled, false);
  assert.deepEqual(interaction.replies, [{
    content: 'No NPC party members are available for portrait regeneration.',
    ephemeral: false
  }]);
}));

test('regen_party_images starts party portrait requests concurrently for prompt batching', async () => withPlayerState(async () => {
  const command = getCommand();
  const player = new Player({
    id: 'regen-party-concurrent-player',
    name: 'Baato',
    partyMembers: ['regen-party-concurrent-a', 'regen-party-concurrent-b']
  });
  new Player({
    id: 'regen-party-concurrent-a',
    name: 'Ithelwen',
    isNPC: true
  });
  new Player({
    id: 'regen-party-concurrent-b',
    name: 'Marta',
    isNPC: true
  });

  const calls = [];
  const resolvers = [];
  const interaction = createInteraction({
    currentPlayer: player,
    generatePlayerImage: async member => {
      calls.push(member.name);
      return new Promise(resolve => {
        resolvers.push(() => resolve({ success: true, jobId: `job-${member.id}` }));
      });
    }
  });

  const execution = command.execute(interaction, {});
  await Promise.resolve();

  assert.deepEqual(calls, ['Ithelwen', 'Marta']);
  assert.equal(resolvers.length, 2);

  resolvers.forEach(resolve => resolve());
  await execution;

  assert.equal(interaction.replies.length, 1);
  assert.match(interaction.replies[0].content, /Queued portraits \(2\): Ithelwen, Marta/);
}));

test('regen_party_images fails loudly when the image helper is unavailable', async () => withPlayerState(async () => {
  const command = getCommand();
  const player = new Player({
    id: 'regen-party-helper-player',
    name: 'Baato',
    partyMembers: ['regen-party-helper-npc']
  });
  new Player({
    id: 'regen-party-helper-npc',
    name: 'Marta',
    isNPC: true
  });
  const interaction = createInteraction({
    currentPlayer: player,
    generatePlayerImage: null
  });

  await assert.rejects(
    () => command.execute(interaction, {}),
    /Portrait image generation helper is unavailable in slash-command context\./
  );
}));
