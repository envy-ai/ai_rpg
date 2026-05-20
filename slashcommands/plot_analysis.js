const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');

function formatListValue(value) {
    return typeof value === 'string' && value.trim()
        ? value.trim()
        : null;
}

function buildPlotAnalysisMarkdown(plotAnalysis) {
    if (!plotAnalysis || typeof plotAnalysis !== 'object') {
        return 'No plot analysis is available yet.';
    }

    const lines = ['## Plot Analysis'];
    const updatedAt = formatListValue(plotAnalysis.updatedAt);
    if (updatedAt) {
        lines.push('', `Updated: ${updatedAt}`);
    }

    const plotThreads = Array.isArray(plotAnalysis.plotThreads)
        ? plotAnalysis.plotThreads
        : [];
    lines.push('', '### Active Plot Threads');
    if (plotThreads.length) {
        for (const thread of plotThreads) {
            const description = formatListValue(thread?.description);
            if (!description) {
                continue;
            }
            const prefix = thread.isCurrentFocus === true ? '- **[current]** ' : '- ';
            lines.push(`${prefix}${description}`);
        }
    } else {
        lines.push('- No plot threads were parsed from the latest output.');
    }

    const complications = Array.isArray(plotAnalysis.currentPlotComplications)
        ? plotAnalysis.currentPlotComplications
        : [];
    lines.push('', '### Current Plot Complications');
    if (complications.length) {
        complications.forEach((complication, index) => {
            const description = formatListValue(complication?.description);
            if (description) {
                lines.push(`${index + 1}. ${description}`);
            }
        });
    } else {
        lines.push('No current plot complications were parsed from the latest output.');
    }

    const parseError = formatListValue(plotAnalysis.parseError);
    if (parseError) {
        lines.push('', '### Parse Error', parseError);
    }

    const raw = formatListValue(plotAnalysis.raw);
    if (raw && (!plotThreads.length || !complications.length || parseError)) {
        lines.push('', '### Raw Output', '```text', raw, '```');
    }

    return lines.join('\n');
}

class PlotAnalysisCommand extends SlashCommandBase {
    static get name() {
        return 'plot_analysis';
    }

    static get description() {
        return 'Show the latest background plot analysis.';
    }

    static get args() {
        return [];
    }

    static async execute(interaction) {
        if (!Globals || typeof Globals.getPlotAnalysis !== 'function') {
            throw new Error('Plot analysis state is unavailable.');
        }

        await interaction.reply({
            content: buildPlotAnalysisMarkdown(Globals.getPlotAnalysis()),
            ephemeral: false
        });
    }
}

module.exports = PlotAnalysisCommand;
module.exports.buildPlotAnalysisMarkdown = buildPlotAnalysisMarkdown;
