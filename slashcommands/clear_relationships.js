const Player = require('../Player.js');
const SlashCommandBase = require('../SlashCommandBase.js');

function getRelationshipSnapshot(character) {
  if (!character || typeof character.getRelationships !== 'function') {
    throw new Error('Encountered a character without getRelationships(); cannot clear relationships safely.');
  }
  const relationships = character.getRelationships();
  if (!relationships || typeof relationships !== 'object' || Array.isArray(relationships)) {
    throw new Error(`Character "${character.name || character.id || 'unknown'}" returned an invalid relationships map.`);
  }
  return relationships;
}

class ClearRelationshipsCommand extends SlashCommandBase {
  static get name() {
    return 'clear_relationships';
  }

  static get description() {
    return 'Clear all currently stored character relationship edges.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    if (!Player || typeof Player.getAll !== 'function') {
      throw new Error('Player registry is unavailable; cannot clear relationships.');
    }

    const characters = Player.getAll();
    if (!Array.isArray(characters)) {
      throw new Error('Player.getAll() must return an array before relationships can be cleared.');
    }

    const charactersToClear = [];
    let relationshipCount = 0;
    for (const character of characters) {
      const relationships = getRelationshipSnapshot(character);
      const count = Object.keys(relationships).length;
      if (count === 0) {
        continue;
      }
      if (typeof character.setRelationships !== 'function') {
        throw new Error(`Character "${character.name || character.id || 'unknown'}" cannot clear relationships.`);
      }
      charactersToClear.push(character);
      relationshipCount += count;
    }

    if (relationshipCount === 0) {
      await interaction.reply({
        content: 'No current relationships are recorded.',
        ephemeral: false
      });
      return;
    }

    if (typeof interaction?.performGameSave !== 'function') {
      throw new Error('performGameSave is unavailable; cannot persist relationship clearing.');
    }

    for (const character of charactersToClear) {
      character.setRelationships({});
    }

    await interaction.performGameSave();

    if (typeof interaction?.requestClientRefresh === 'function') {
      interaction.requestClientRefresh({ relationshipGraphRefreshRequested: true });
    }

    const relationshipLabel = relationshipCount === 1 ? 'relationship edge' : 'relationship edges';
    const characterLabel = charactersToClear.length === 1 ? 'character' : 'characters';
    await interaction.reply({
      content: `Cleared ${relationshipCount} ${relationshipLabel} across ${charactersToClear.length} ${characterLabel}.`,
      ephemeral: false
    });
  }
}

module.exports = ClearRelationshipsCommand;
