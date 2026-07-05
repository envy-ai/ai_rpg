const test = require('node:test');
const assert = require('node:assert/strict');

const {
  initializeSlashCommands,
  getSlashCommandModule
} = require('../SlashCommandRegistry.js');

function getCommand(name = 'resolve_mystery_threads') {
  initializeSlashCommands();
  const command = getSlashCommandModule(name);
  assert.ok(command, `${name} command should be registered`);
  return command;
}

function createInteraction({
  runMysteryBoxCleanupPrompt = async () => ({
    resolvedThreads: [],
    resolvedBoxes: []
  })
} = {}) {
  const replies = [];
  return {
    replies,
    runMysteryBoxCleanupPrompt,
    reply: async payload => {
      replies.push(payload);
    }
  };
}

test('resolve_mystery_threads command is registered', () => {
  const command = getCommand();

  assert.equal(command.usage, '/resolve_mystery_threads');
  assert.match(command.description, /mystery/i);
});

test('resolve_mystery_threads command lists resolved threads and boxes with thoughts', async () => {
  const command = getCommand();
  const calls = [];
  const interaction = createInteraction({
    runMysteryBoxCleanupPrompt: async payload => {
      calls.push(payload);
      return {
        resolvedThreads: [
          {
            name: 'Ellison Conspiracy',
            thoughts: 'Ellison confessed and the remaining evidence is confirmatory.'
          }
        ],
        resolvedBoxes: [
          {
            name: 'ELLISON-SEVEN',
            thoughts: 'The phrase is now openly known to the player.'
          }
        ]
      };
    }
  });

  await command.execute(interaction, {});

  assert.deepEqual(calls, [{}]);
  assert.equal(interaction.replies.length, 1);
  assert.match(interaction.replies[0].content, /Resolved mystery threads/);
  assert.match(interaction.replies[0].content, /Ellison Conspiracy/);
  assert.match(interaction.replies[0].content, /Ellison confessed/);
  assert.match(interaction.replies[0].content, /Resolved mystery boxes/);
  assert.match(interaction.replies[0].content, /ELLISON-SEVEN/);
  assert.match(interaction.replies[0].content, /openly known/);
  assert.equal(interaction.replies[0].ephemeral, false);
});

test('resolve_mystery_threads command lists resolved decision summaries when applied summaries are empty', async () => {
  const command = getCommand();
  const interaction = createInteraction({
    runMysteryBoxCleanupPrompt: async () => ({
      resolvedThreads: [],
      resolvedBoxes: [],
      decisionResolvedThreads: [],
      decisionResolvedBoxes: [
        {
          name: "Harka's Foundation Resin Note",
          thoughts: 'The note itself was fully shown to the player.'
        }
      ]
    })
  });

  await command.execute(interaction, {});

  assert.equal(interaction.replies.length, 1);
  assert.match(interaction.replies[0].content, /Resolved mystery boxes/);
  assert.match(interaction.replies[0].content, /Harka's Foundation Resin Note/);
  assert.match(interaction.replies[0].content, /fully shown/);
});

test('resolve_mystery_threads command reports no resolved mysteries', async () => {
  const command = getCommand();
  const interaction = createInteraction();

  await command.execute(interaction, {});

  assert.deepEqual(interaction.replies, [{
    content: 'Mystery cleanup completed. No mystery threads or boxes were resolved.',
    ephemeral: false
  }]);
});

test('resolve_mystery_threads command fails loudly without a runner', async () => {
  const command = getCommand();
  const interaction = createInteraction({ runMysteryBoxCleanupPrompt: null });

  await assert.rejects(
    () => command.execute(interaction, {}),
    /Mystery thread cleanup is unavailable in this command context\./
  );
});
