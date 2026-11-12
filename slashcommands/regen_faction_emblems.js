const Faction = require('../Faction.js');
const SlashCommandBase = require('../SlashCommandBase.js');

class RegenFactionEmblemsCommand extends SlashCommandBase {
  static get name() {
    return 'regen_faction_emblems';
  }

  static get description() {
    return 'Regenerate emblems for every faction in the current game.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const factions = Faction.getAll();
    if (!factions.length) {
      await interaction.reply({ content: 'No factions are available for emblem regeneration.', ephemeral: false });
      return;
    }
    if (typeof interaction?.generateFactionImage !== 'function') {
      throw new Error('Faction image generation helper is unavailable in slash-command context.');
    }
    const clientId = typeof interaction.clientId === 'string' && interaction.clientId.trim()
      ? interaction.clientId.trim()
      : null;
    const results = await Promise.all(factions.map(async faction => ({
      faction,
      result: await interaction.generateFactionImage(faction, { force: true, clientId })
    })));
    const queued = [];
    const existing = [];
    const skipped = [];
    for (const { faction, result } of results) {
      if (result?.skipped === true) {
        skipped.push(`${faction.name}${result.reason ? ` (${result.reason})` : ''}`);
      } else if (result?.success === true && result.existingJob === true) {
        existing.push(faction.name);
      } else if (result?.success === true) {
        queued.push(faction.name);
      } else {
        throw new Error(`Faction emblem generation for ${faction.name} returned no queued, existing, or skipped result.`);
      }
    }
    const lines = ['## Faction Emblem Regeneration'];
    for (const [label, names] of [
      ['Queued emblems', queued],
      ['Joined existing emblem jobs', existing],
      ['Skipped emblems', skipped]
    ]) {
      if (names.length) lines.push(`${label} (${names.length}): ${names.join(', ')}`);
    }
    await interaction.reply({ content: lines.join('\n'), ephemeral: false });
  }
}

module.exports = RegenFactionEmblemsCommand;
