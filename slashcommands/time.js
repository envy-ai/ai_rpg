const Globals = require('../Globals.js');
const Utils = require('../Utils.js');
const SlashCommandBase = require('../SlashCommandBase.js');

class TimeCommand extends SlashCommandBase {
  static get name() {
    return 'time';
  }

  static get description() {
    return 'Advance or rewind world time by a signed duration such as "9 hours", "-3 hours, 2 minutes", or "+10m".';
  }

  static get args() {
    return [];
  }

  static get usage() {
    return '/time <signed duration>';
  }

  static async execute(interaction) {
    if (Globals.gameLoaded !== true) {
      throw new Error('Cannot use /time when no game is loaded.');
    }
    if (!interaction || typeof interaction.adjustWorldTimeByMinutes !== 'function') {
      throw new Error('World-time adjustment helper is unavailable for slash commands.');
    }

    const rawInput = typeof interaction.argsText === 'string' ? interaction.argsText.trim() : '';
    if (!rawInput) {
      throw new Error('Usage: /time <signed duration>');
    }

    const deltaMinutes = Utils.parseDurationToMinutes(rawInput, {
      fieldName: '/time duration',
      allowSigned: true
    });
    const result = await interaction.adjustWorldTimeByMinutes(deltaMinutes, {
      source: 'slash_command_time'
    });

    const worldTime = result?.worldTime;
    const durationText = Utils.formatMinutesAsNaturalDuration(Math.abs(deltaMinutes));
    const currentTimeLabel = typeof worldTime?.timeLabel === 'string' ? worldTime.timeLabel : null;
    const currentDateLabel = typeof worldTime?.dateLabel === 'string' ? worldTime.dateLabel : null;
    const locationText = [currentTimeLabel, currentDateLabel].filter(Boolean).join(' on ');
    const messageParts = [];

    if (deltaMinutes > 0) {
      messageParts.push(`Advanced time by ${durationText}.`);
    } else if (deltaMinutes < 0) {
      messageParts.push(`Turned back the clock by ${durationText}.`);
      messageParts.push('Warning: rewinding time does not undo prior arrivals, expired effects, offscreen actions, or other already-processed time-based changes.');
    } else {
      messageParts.push('Time did not change.');
    }

    if (locationText) {
      messageParts.push(`Current world time: ${locationText}.`);
    }

    const arrivalCount = Array.isArray(result?.vehicleArrivals) ? result.vehicleArrivals.length : 0;
    if (arrivalCount > 0) {
      messageParts.push(`Processed ${arrivalCount} due vehicle ${arrivalCount === 1 ? 'arrival' : 'arrivals'}.`);
    }

    await interaction.reply({
      content: messageParts.join(' '),
      ephemeral: false
    });
  }
}

module.exports = TimeCommand;
