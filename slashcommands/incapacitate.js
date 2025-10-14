const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

class IncapacitateCommand extends SlashCommandBase {
  static get name() {
    return 'incapacitate';
  }

  static get description() {
    return 'Drop an NPC to zero health without killing them.';
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
      throw new Error(`Unable to incapacitate NPC "${characterName}".`);
    }

    npc.isDead = false;
    npc.setHealth(0);

    return interaction.reply({ content: `${npc.name} is incapacitated.`, ephemeral: false });
  }
}

module.exports = IncapacitateCommand;
