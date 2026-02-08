const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

class GameIntroCommand extends SlashCommandBase {
  static get name() {
    return 'game_intro';
  }

  static get aliases() {
    return ['intro'];
  }

  static get description() {
    return 'Generate and append a fresh intro narration entry to chat history.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const generateFn = Globals?.generateGameIntro;
    if (typeof generateFn !== 'function') {
      throw new Error('Game intro generation is unavailable.');
    }

    const generatedEntry = await generateFn();
    if (!generatedEntry || typeof generatedEntry !== 'object') {
      throw new Error('Game intro generation did not produce a chat entry.');
    }

    const realtimeHub = Globals?.realtimeHub;
    if (!realtimeHub || typeof realtimeHub.emit !== 'function') {
      throw new Error('Realtime hub is unavailable; cannot refresh chat history.');
    }
    realtimeHub.emit(null, 'chat_history_updated', {});

    await interaction.reply({
      content: 'Generated intro prose and added it to chat history.',
      ephemeral: false
    });
  }
}

module.exports = GameIntroCommand;

