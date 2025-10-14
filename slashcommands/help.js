const SlashCommandBase = require('../SlashCommandBase.js');

class HelpCommand extends SlashCommandBase {
  static get name() {
    return 'help';
  }

  static get description() {
    return 'List available slash commands and their usage.';
  }

  static get args() {
    return [];
  }

  static execute(interaction) {
    const commands = SlashCommandBase.listCommands();
    const lines = commands.map(command => {
      const description = command.description ? ` - ${command.description}` : '';
      return `/${command.name}${description}\n  Usage: ${command.usage}`;
    });

    const content = lines.length
      ? `Available slash commands:\n${lines.join('\n')}`
      : 'No slash commands are currently available.';

    return interaction.reply({ content, ephemeral: false });
  }
}

module.exports = HelpCommand;
