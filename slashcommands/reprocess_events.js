const SlashCommandBase = require('../SlashCommandBase.js');

class ReprocessEventsCommand extends SlashCommandBase {
    static get name() { return 'reprocess_events'; }
    static get description() { return 'Reprocess events from the most recent stored gameplay turn without regenerating its prose.'; }
    static get args() { return []; }

    static async execute(interaction) {
        if (interaction.argsText?.trim()) throw new Error('/reprocess_events takes no arguments.');
        if (typeof interaction.reprocessLatestEvents !== 'function') {
            throw new Error('Event reprocessing is unavailable in this command context.');
        }
        const result = await interaction.reprocessLatestEvents();
        const messages = result.processedPasses
            ? [`Reprocessed ${result.processedPasses} event pass${result.processedPasses === 1 ? '' : 'es'} from the latest gameplay turn.`]
            : ['The latest gameplay turn has no pending event passes; its recorded events are already complete.'];
        if (result.warnings?.length) messages.push(...result.warnings);
        interaction.requestClientRefresh?.({ locationRefreshRequested: true, relationshipGraphRefreshRequested: true });
        await interaction.reply({ content: messages.join('\n\n'), ephemeral: false });
    }
}

module.exports = ReprocessEventsCommand;
