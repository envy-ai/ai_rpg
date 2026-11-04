'use strict';

const SlashCommandBase = require('../SlashCommandBase.js');

class MigrateIdsCommand extends SlashCommandBase {
    static get name() { return 'migrate_ids'; }
    static get aliases() { return ['migrate_domain_ids']; }
    static get description() { return 'Migrate current game IDs to names and reload connected browsers, preserving a backup.'; }
    static get args() { return []; }

    static async execute(interaction) {
        if (typeof interaction?.argsText === 'string' && interaction.argsText.trim()) throw new Error('/migrate_ids accepts no arguments. Run /migrate_ids to migrate the current loaded game.');
        if (typeof interaction?.migrateDomainIds !== 'function') throw new Error('Current-game ID migration is unavailable in this command context.');
        const { counts, backupPath } = await interaction.migrateDomainIds();
        const totals = Object.entries(counts).map(([kind, count]) => `${kind}: ${count}`).join(', ') || 'all IDs already use the current name format';
        await interaction.reply({
            content: `Current game IDs migrated (${totals}). Pre-migration backup: ${backupPath}. Save the game to persist the migrated IDs. Connected browsers are reloading.`,
            ephemeral: false,
            action: { type: 'reload_page', delayMs: 500 }
        });
    }
}

module.exports = MigrateIdsCommand;
