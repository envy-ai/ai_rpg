'use strict';

const SlashCommandBase = require('../SlashCommandBase.js');

class RepairStatusEffectsCommand extends SlashCommandBase {
    static get name() { return 'repair_status_effects'; }
    static get description() { return 'Review and repair incomplete character-owned status effects without duplicating ability effects.'; }
    static get args() { return []; }
    static async execute(interaction) {
        if (typeof interaction.repairStatusEffects !== 'function') throw new Error('Status-effect repair is unavailable in this command context.');
        const result = await interaction.repairStatusEffects();
        if (!result?.storedEntries?.length) throw new Error('Status-effect repair did not store its result summary.');
        interaction.requestClientRefresh({ locationRefreshRequested: true });
        await interaction.reply({ content: '' });
    }
}

module.exports = RepairStatusEffectsCommand;
