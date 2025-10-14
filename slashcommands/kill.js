const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

class KillCommand extends SlashCommandBase {
  static get name() {
    return 'kill';
  }

  static get description() {
    return 'Immediately kill an NPC by name.';
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
      throw new Error(`Unable to kill NPC "${characterName}".`);
    }

    npc.isDead = true;
    npc.setHealth(0);

    return interaction.reply({ content: `${npc.name} has been killed.`, ephemeral: false });
  }
}

module.exports = KillCommand;
