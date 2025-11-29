const Globals = require('../Globals.js');
const Location = require('../Location.js');
const SlashCommandBase = require('../SlashCommandBase.js');

function stripQuotes(value) {
  if (typeof value !== 'string') {
    return value;
  }
  let trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  const first = trimmed.charAt(0);
  const last = trimmed.charAt(trimmed.length - 1);
  if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

class TeleportCommand extends SlashCommandBase {
  static get name() {
    return 'teleport';
  }

  static get description() {
    return 'Teleport yourself to a location by ID or quoted name.';
  }

  static get args() {
    return [
      { name: 'destination', type: 'string', required: true }
    ];
  }

  static execute(interaction, args = {}) {
    const invokingPlayerId = interaction?.user?.id;
    if (!invokingPlayerId) {
      throw new Error('Cannot teleport: invoking user ID is missing.');
    }

    const player = Globals.playersById.get(invokingPlayerId);
    if (!player) {
      throw new Error('Cannot teleport: no active character found for this user.');
    }

    const rawDestination = typeof args.destination === 'string' ? args.destination.trim() : '';
    if (!rawDestination) {
      throw new Error('Destination is required. Provide a location ID or quote the location name.');
    }

    const normalizedDestination = stripQuotes(rawDestination);

    let destination = null;
    try {
      destination = Location.get(normalizedDestination);
    } catch (_) {
      destination = null;
    }

    if (!destination) {
      try {
        destination = Location.getByName(normalizedDestination);
      } catch (_) {
        destination = null;
      }
    }

    if (!destination) {
      throw new Error(`Location '${normalizedDestination}' not found.`);
    }

    if (player.currentLocation === destination.id) {
      return interaction.reply({
        content: `You are already at ${destination.name || destination.id}.`,
        ephemeral: false
      });
    }

    player.setLocation(destination);

    return interaction.reply({
      content: `Teleported to ${destination.name || destination.id} (${destination.id}).`,
      ephemeral: false
    });
  }
}

module.exports = TeleportCommand;
