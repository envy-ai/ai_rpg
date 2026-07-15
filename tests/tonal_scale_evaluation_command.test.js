const test = require('node:test');
const assert = require('node:assert/strict');

const {
  initializeSlashCommands,
  getSlashCommandModule
} = require('../SlashCommandRegistry.js');

function getCommand(name = 'tonal_scale_evaluation') {
  initializeSlashCommands();
  const command = getSlashCommandModule(name);
  assert.ok(command, `${name} command should be registered`);
  return command;
}

function createInteraction({
  runTonalScaleEvaluationPrompt = async () => ({
    evaluation: 'Idealism:\n  Current State: Hope is fragile.',
    storedEntry: {
      id: 'entry_tonal_1',
      type: 'tonal-scale-evaluation'
    }
  })
} = {}) {
  const replies = [];
  return {
    replies,
    runTonalScaleEvaluationPrompt,
    reply: async payload => {
      replies.push(payload);
    }
  };
}

test('tonal_scale_evaluation command is registered', () => {
  const command = getCommand();

  assert.equal(command.usage, '/tonal_scale_evaluation');
  assert.match(command.description, /tonal scale/i);
});

test('tonal_scale_evaluation command persists a visible prompt-excluded chat entry through the runner', async () => {
  const command = getCommand();
  const calls = [];
  const interaction = createInteraction({
    runTonalScaleEvaluationPrompt: async payload => {
      calls.push(payload);
      return {
        evaluation: 'Idealism:\n  Current State: Hope is fragile.',
        storedEntry: {
          id: 'entry_tonal_1',
          type: 'tonal-scale-evaluation',
          content: 'Tonal scale evaluation\n\nIdealism:\n  Current State: Hope is fragile.',
          metadata: {
            excludeFromBaseContextHistory: true
          }
        }
      };
    }
  });

  await command.execute(interaction, {});

  assert.deepEqual(calls, [{ storeChatEntry: true }]);
  assert.deepEqual(interaction.replies, [{ content: '', ephemeral: false }]);
});

test('tonal_scale_evaluation command fails if the runner does not store a chat entry', async () => {
  const command = getCommand();
  const interaction = createInteraction({
    runTonalScaleEvaluationPrompt: async () => ({
      evaluation: 'Idealism:\n  Current State: Hope is fragile.',
      storedEntry: null
    })
  });

  await assert.rejects(
    () => command.execute(interaction, {}),
    /Tonal scale evaluation prompt did not store a chat entry\./
  );
});

test('tonal_scale_evaluation command reports empty output clearly', async () => {
  const command = getCommand();
  const interaction = createInteraction({
    runTonalScaleEvaluationPrompt: async () => ({
      evaluation: ''
    })
  });

  await assert.rejects(
    () => command.execute(interaction, {}),
    /Tonal scale evaluation prompt did not return an evaluation\./
  );
});

test('tonal_scale_evaluation command fails loudly without a runner', async () => {
  const command = getCommand();
  const interaction = createInteraction({ runTonalScaleEvaluationPrompt: null });

  await assert.rejects(
    () => command.execute(interaction, {}),
    /Tonal scale evaluation is unavailable in this command context\./
  );
});
