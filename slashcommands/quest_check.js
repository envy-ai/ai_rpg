const SlashCommandBase = require('../SlashCommandBase.js');

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatObjective(objective) {
  const questName = objective?.questName || objective?.questId || 'Unknown quest';
  const description = objective?.objectiveDescription
    || `Objective ${Number(objective?.objectiveNumber) || '?'}`;
  const reason = typeof objective?.reason === 'string' && objective.reason.trim()
    ? ` — ${objective.reason.trim()}`
    : '';
  return `- **${questName}:** ${description}${reason}`;
}

function formatReward(reward) {
  const questName = reward?.questName || reward?.questId || 'Unknown quest';
  const rewardLines = Array.isArray(reward?.rewards)
    ? reward.rewards.filter(line => typeof line === 'string' && line.trim())
    : [];
  return rewardLines.length
    ? `- **${questName}:** ${rewardLines.join(', ')}`
    : `- **${questName}:** rewards applied`;
}

class QuestCheckCommand extends SlashCommandBase {
  static get name() {
    return 'quest_check';
  }

  static get description() {
    return 'Run the quest checker prompt immediately and apply its results.';
  }

  static get args() {
    return [];
  }

  static get usage() {
    return '/quest_check';
  }

  static async execute(interaction) {
    const runQuestCheck = interaction?.runQuestCheckPrompt;
    if (typeof runQuestCheck !== 'function') {
      throw new Error('Quest check execution is unavailable in this command context.');
    }

    const result = await runQuestCheck();
    if (!result || typeof result !== 'object') {
      throw new Error('Quest check prompt did not produce a result.');
    }

    const completedObjectives = Array.isArray(result.completedObjectives)
      ? result.completedObjectives
      : [];
    const rewards = Array.isArray(result.rewards) ? result.rewards : [];
    const errors = Array.isArray(result.errors) ? result.errors.filter(Boolean) : [];
    const sections = [
      `Quest check completed. Applied ${pluralize(completedObjectives.length, 'new objective completion')} and ${pluralize(rewards.length, 'quest reward')}.`
    ];

    if (completedObjectives.length) {
      sections.push(`Completed objectives\n\n${completedObjectives.map(formatObjective).join('\n')}`);
    }
    if (rewards.length) {
      sections.push(`Quest rewards\n\n${rewards.map(formatReward).join('\n')}`);
    }
    if (errors.length) {
      sections.push(`Quest processing errors\n\n${errors.map(error => `- ${error?.message || String(error)}`).join('\n')}`);
    }

    if (
      (completedObjectives.length || rewards.length)
      && typeof interaction.requestClientRefresh === 'function'
    ) {
      interaction.requestClientRefresh({
        locationRefreshRequested: true,
        relationshipGraphRefreshRequested: true
      });
    }

    await interaction.reply({
      content: sections.join('\n\n'),
      ephemeral: errors.length > 0
    });
  }
}

module.exports = QuestCheckCommand;
