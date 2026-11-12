const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  initializeSlashCommands,
  getSlashCommandModule
} = require('../SlashCommandRegistry.js');

function getCommand() {
  initializeSlashCommands();
  const command = getSlashCommandModule('quest_check');
  assert.ok(command, 'quest_check command should be registered');
  return command;
}

function createInteraction({
  runQuestCheckPrompt = async () => ({
    completedObjectives: [],
    rewards: [],
    errors: [],
    storedEntries: [{ id: 'stored-result' }]
  }),
  requestClientRefresh = () => {}
} = {}) {
  const replies = [];
  return {
    replies,
    runQuestCheckPrompt,
    requestClientRefresh,
    reply: async payload => replies.push(payload)
  };
}

test('quest_check command is registered with no arguments', () => {
  const command = getCommand();

  assert.equal(command.usage, '/quest_check');
  assert.deepEqual(command.args, []);
});

test('quest_check runs the prompt helper and reports applied objectives and rewards', async () => {
  const command = getCommand();
  let callCount = 0;
  const refreshRequests = [];
  const interaction = createInteraction({
    runQuestCheckPrompt: async () => {
      callCount += 1;
      return {
        completedObjectives: [{
          questName: "Skyjitter's Scout Contract",
          objectiveNumber: 2,
          objectiveDescription: 'Inspect the damaged mana cell.',
          reason: 'The cell was inspected at the stall.'
        }],
        rewards: [{
          questName: "Skyjitter's Scout Contract",
          rewards: ['50 XP', '12 credits']
        }],
        errors: [],
        storedEntries: [{ id: 'stored-result' }]
      };
    },
    requestClientRefresh: payload => refreshRequests.push(payload)
  });

  await command.execute(interaction, {});

  assert.equal(callCount, 1);
  assert.deepEqual(refreshRequests, [{
    locationRefreshRequested: true,
    relationshipGraphRefreshRequested: true
  }]);
  assert.equal(interaction.replies.length, 1);
  assert.equal(interaction.replies[0].content, '');
  assert.equal(interaction.replies[0].ephemeral, false);
});

test('quest_check reports a successful check with no new completions', async () => {
  const command = getCommand();
  const interaction = createInteraction();

  await command.execute(interaction, {});

  assert.deepEqual(interaction.replies, [{
    content: '',
    ephemeral: false
  }]);
});

test('quest_check fails loudly when its prompt helper is unavailable', async () => {
  const command = getCommand();
  const interaction = createInteraction({ runQuestCheckPrompt: null });

  await assert.rejects(
    () => command.execute(interaction, {}),
    /Quest check execution is unavailable in this command context\./
  );
});

test('slash command context forces, processes, and resets manual quest checks', () => {
  const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
  const start = source.indexOf('async function runSlashCommandQuestCheckPrompt(');
  const end = source.indexOf('\n        async function reprocessLatestTurnEvents', start);
  assert.notEqual(start, -1, 'manual quest-check helper should exist');
  assert.notEqual(end, -1, 'manual quest-check helper should end before the interaction builder');
  const helperSource = source.slice(start, end);

  assert.match(helperSource, /Events\.runQuestChecks\(\{\s*allowWithoutEventChecks:\s*true,\s*bypassInterval:\s*true\s*\}\)/);
  assert.match(helperSource, /Events\.resetQuestCheckTurnCounter\(\)/);
  assert.match(helperSource, /Events\.parseQuestObjectiveStatusXml\(response\)/);
  assert.match(helperSource, /await Events\.processQuestObjectiveCompletionEntries\(/);
  assert.match(source, /runQuestCheckPrompt:\s*\(\) => runSlashCommandQuestCheckPrompt/);
});
