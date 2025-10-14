const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

class HealCommand extends SlashCommandBase {
  static get name() {
    return 'heal';
  }

  static get aliases() {
    return ['resurrect'];
  }

  static get description() {
    return 'Restore an NPC to full health and clear the dead flag.';
  }

  static get args() {
    return [
      { name: 'character', type: 'string', required: true }
    ];
  }

  static execute(interaction, args = {}) {
    const characterName = args.character;
    if (typeof characterName !== 'string' || !characterName.trim()) {
      throw new Error('Argument "character" must be a non-empty string.');
    }

    const normalizedName = characterName.trim();
    const npc = Globals.playersByName.get(normalizedName);
    if (!npc || !npc.isNPC) {
      throw new Error(`Unable to heal NPC "${characterName}".`);
    }

    npc.isDead = false;
    npc.setHealth(npc.maxHealth);

    return interaction.reply({ content: `${npc.name} has been fully restored.`, ephemeral: false });
  }
}

module.exports = HealCommand;
