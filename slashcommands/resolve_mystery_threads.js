const SlashCommandBase = require('../SlashCommandBase.js');

function formatResolvedList(items = []) {
  return items
    .map(item => {
      const name = typeof item?.name === 'string' && item.name.trim()
        ? item.name.trim()
        : 'Unnamed mystery';
      const thoughts = typeof item?.thoughts === 'string' && item.thoughts.trim()
        ? item.thoughts.trim()
        : 'No thoughts provided.';
      return `- ${name}: ${thoughts}`;
    })
    .join('\n');
}

function mergeResolvedLists(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const item of list) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const id = typeof item.id === 'string' && item.id.trim()
        ? item.id.trim()
        : '';
      const name = typeof item.name === 'string' && item.name.trim()
        ? item.name.trim()
        : '';
      const key = id || name.toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

class ResolveMysteryThreadsCommand extends SlashCommandBase {
  static get name() {
    return 'resolve_mystery_threads';
  }

  static get description() {
    return 'Run the mystery cleanup prompt and list resolved mystery threads and boxes.';
  }

  static get args() {
    return [];
  }

  static get usage() {
    return '/resolve_mystery_threads';
  }

  static async execute(interaction) {
    const runMysteryBoxCleanup = interaction?.runMysteryBoxCleanupPrompt;
    if (typeof runMysteryBoxCleanup !== 'function') {
      throw new Error('Mystery thread cleanup is unavailable in this command context.');
    }

    const result = await runMysteryBoxCleanup({});
    if (!result || typeof result !== 'object') {
      throw new Error('Mystery cleanup prompt did not produce a result.');
    }

    const resolvedThreads = mergeResolvedLists(
      result.resolvedThreads,
      result.decisionResolvedThreads
    );
    const resolvedBoxes = mergeResolvedLists(
      result.resolvedBoxes,
      result.decisionResolvedBoxes
    );

    if (!resolvedThreads.length && !resolvedBoxes.length) {
      await interaction.reply({
        content: 'Mystery cleanup completed. No mystery threads or boxes were resolved.',
        ephemeral: false
      });
      return;
    }

    const sections = [];
    if (resolvedThreads.length) {
      sections.push(`Resolved mystery threads\n\n${formatResolvedList(resolvedThreads)}`);
    }
    if (resolvedBoxes.length) {
      sections.push(`Resolved mystery boxes\n\n${formatResolvedList(resolvedBoxes)}`);
    }

    await interaction.reply({
      content: sections.join('\n\n'),
      ephemeral: false
    });
  }
}

module.exports = ResolveMysteryThreadsCommand;
