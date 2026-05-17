const SlashCommandBase = require('../SlashCommandBase.js');
const LLMClient = require('../LLMClient.js');

function normalizeAction(args = {}, interaction = {}) {
    const rawAction = Object.prototype.hasOwnProperty.call(args, 'action')
        ? args.action
        : interaction.argsText;
    return typeof rawAction === 'string' ? rawAction.trim().toLowerCase() : '';
}

function formatStatValue(value) {
    if (value === null || value === undefined) {
        return 'null';
    }
    // If a number, round to nearest integer for display
    if (typeof value === 'number') {
        return Math.round(value).toString();
    }
    return String(value);
}

function escapeMarkdownTableCell(value) {
    return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function buildPromptStatsTable(rows) {
    const lines = [
        '## Prompt Output Character Stats',
        '',
        '| Prompt | Runs | Average Output Characters | Last Output Characters |',
        '| --- | ---: | ---: | ---: |'
    ];

    for (const row of rows) {
        lines.push(
            `| ${escapeMarkdownTableCell(row.prompt)} `
            + `| ${formatStatValue(row.runs)} `
            + `| ${formatStatValue(row.averageOutputCharacters)} `
            + `| ${formatStatValue(row.lastOutputCharacters)} |`
        );
    }

    return lines.join('\n');
}

class PromptStatsCommand extends SlashCommandBase {
    static get name() {
        return 'promptstats';
    }

    static get description() {
        return 'Show or clear prompt output character averages.';
    }

    static get args() {
        return [
            { name: 'action', type: 'string', required: false }
        ];
    }

    static async execute(interaction, args = {}) {
        const action = normalizeAction(args, interaction);
        if (action && action !== 'clear') {
            throw new Error(`Unknown /promptstats option "${action}". Usage: /promptstats [clear]`);
        }

        if (action === 'clear') {
            const result = LLMClient.clearPromptOutputCharacterStats();
            const promptWord = result.clearedPromptCount === 1 ? 'prompt' : 'prompts';
            await interaction.reply({
                content: `Cleared prompt output character averages for ${result.clearedPromptCount} ${promptWord}.`,
                ephemeral: false
            });
            return;
        }

        const rows = LLMClient.listPromptOutputCharacterStats();
        const content = rows.length
            ? buildPromptStatsTable(rows)
            : 'No prompt output character stats are available.';
        await interaction.reply({
            content,
            ephemeral: false
        });
    }
}

module.exports = PromptStatsCommand;
