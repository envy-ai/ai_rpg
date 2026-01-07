const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');

let savedConfig = null;

class RpCommand extends SlashCommandBase {
  static get name() {
    return 'rp';
  }

  static get aliases() {
    return [];
  }

  static get description() {
    return 'Toggle RP mode: disable/restore event checks, plausibility checks, random events, and NPC turns.';
  }

  static get args() {
    return [];
  }

  static ensureSection(config, key) {
    const section = config[key];
    if (section === undefined || section === null) {
      throw new Error(`Config section '${key}' is missing; cannot toggle RP mode.`);
    }
    if (typeof section !== 'object') {
      throw new Error(`Config section '${key}' must be an object.`);
    }
    if (!Object.prototype.hasOwnProperty.call(section, 'enabled')) {
      throw new Error(`Config section '${key}' is missing an 'enabled' flag.`);
    }
    return section;
  }

  static async execute(interaction) {
    const config = Globals.config;
    if (!config || typeof config !== 'object') {
      throw new Error('Global configuration is unavailable; cannot toggle RP mode.');
    }

    const eventChecks = this.ensureSection(config, 'event_checks');
    const plausibilityChecks = this.ensureSection(config, 'plausibility_checks');
    const randomEvents = this.ensureSection(config, 'random_event_frequency');
    const npcTurns = this.ensureSection(config, 'npc_turns');

    const restoring = savedConfig !== null;

    if (restoring) {
      eventChecks.enabled = savedConfig.eventChecksEnabled;
      plausibilityChecks.enabled = savedConfig.plausibilityChecksEnabled;
      randomEvents.enabled = savedConfig.randomEventsEnabled;
      npcTurns.enabled = savedConfig.npcTurnsEnabled;
      savedConfig = null;

      return interaction.reply({
        content: 'RP mode disabled. Restored event checks, plausibility checks, random events, and NPC turns to their previous settings.',
        ephemeral: false
      });
    }

    savedConfig = {
      eventChecksEnabled: Boolean(eventChecks.enabled),
      plausibilityChecksEnabled: Boolean(plausibilityChecks.enabled),
      randomEventsEnabled: Boolean(randomEvents.enabled),
      npcTurnsEnabled: Boolean(npcTurns.enabled)
    };

    eventChecks.enabled = false;
    plausibilityChecks.enabled = false;
    randomEvents.enabled = false;
    npcTurns.enabled = false;

    return interaction.reply({
      content: 'RP mode enabled. Event checks, plausibility checks, random events, and NPC turns are now disabled. Run /rp again to restore previous values.',
      ephemeral: false
    });
  }
}

module.exports = RpCommand;
