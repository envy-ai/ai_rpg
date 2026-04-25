const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');
const {
    countSceneSummaryIndexEntries
} = require('../scene_summary_index.js');

function formatEntryRange(startIndex, endIndex, { capitalize = false } = {}) {
    const start = Number(startIndex);
    const end = Number(endIndex);
    if (!Number.isInteger(start) || start <= 0) {
        throw new Error('Scene summary start index is invalid.');
    }
    if (!Number.isInteger(end) || end < start) {
        throw new Error('Scene summary end index is invalid.');
    }
    const singular = capitalize ? 'Entry' : 'entry';
    const plural = capitalize ? 'Entries' : 'entries';
    return start === end ? `${singular} ${start}` : `${plural} ${start}-${end}`;
}

function normalizeSummaryLine(summary) {
    if (typeof summary !== 'string') {
        return '';
    }
    return summary.replace(/\s+/g, ' ').trim();
}

function countSceneSummaryEligibleEntries(chatHistory) {
    return countSceneSummaryIndexEntries(chatHistory);
}

function computeCoverageGaps(scenes, totalEntries) {
    const total = Number(totalEntries);
    if (!Number.isInteger(total) || total <= 0) {
        return [];
    }

    const intervals = scenes
        .map(scene => ({
            start: Number(scene?.startIndex),
            end: Number(scene?.endIndex)
        }))
        .filter(interval => (
            Number.isInteger(interval.start)
            && Number.isInteger(interval.end)
            && interval.start > 0
            && interval.end >= interval.start
        ))
        .map(interval => ({
            start: Math.max(1, interval.start),
            end: Math.min(total, interval.end)
        }))
        .filter(interval => interval.end >= interval.start)
        .sort((a, b) => a.start - b.start);

    const gaps = [];
    let cursor = 1;
    for (const interval of intervals) {
        if (interval.end < cursor) {
            continue;
        }
        if (interval.start > cursor) {
            gaps.push({ start: cursor, end: interval.start - 1 });
        }
        cursor = Math.max(cursor, interval.end + 1);
        if (cursor > total) {
            break;
        }
    }
    if (cursor <= total) {
        gaps.push({ start: cursor, end: total });
    }
    return gaps;
}

function formatCoverageLine(scenes, chatHistory) {
    const totalEntries = countSceneSummaryEligibleEntries(chatHistory);
    if (totalEntries === 0) {
        return 'Coverage gaps: no scene-summary-eligible entries.';
    }
    const gaps = computeCoverageGaps(scenes, totalEntries);
    if (gaps.length === 0) {
        return 'Coverage gaps: none.';
    }
    return `Coverage gaps: ${gaps.map(gap => formatEntryRange(gap.start, gap.end)).join(', ')}.`;
}

class SceneSummariesCommand extends SlashCommandBase {
    static get name() {
        return 'scene_summaries';
    }

    static get aliases() {
        return ['summary_ranges'];
    }

    static get description() {
        return 'List stored scene summaries and the entry ranges they cover.';
    }

    static get args() {
        return [];
    }

    static async execute(interaction) {
        const sceneSummaries = Globals.getSceneSummaries();
        if (!sceneSummaries || typeof sceneSummaries.getScenesInOrder !== 'function') {
            throw new Error('Scene summaries are unavailable.');
        }

        const chatHistory = typeof interaction?.getChatHistory === 'function'
            ? interaction.getChatHistory()
            : interaction?.chatHistory;
        if (!Array.isArray(chatHistory)) {
            throw new Error('Chat history is unavailable for scene summary coverage.');
        }

        const scenes = sceneSummaries.getScenesInOrder();
        const lines = ['## Scene Summaries'];

        if (!Array.isArray(scenes) || scenes.length === 0) {
            lines.push('');
            lines.push('No scene summaries are stored.');
        } else {
            lines.push('');
            lines.push(`Stored summaries: ${scenes.length}`);
            lines.push('');
            scenes.forEach((scene, index) => {
                const rangeLabel = formatEntryRange(scene.startIndex, scene.endIndex, { capitalize: true });
                const summary = normalizeSummaryLine(scene.summary);
                lines.push(`${index + 1}. ${rangeLabel}: ${summary}`);
            });
        }

        lines.push('');
        lines.push(formatCoverageLine(scenes, chatHistory));

        await interaction.reply({
            content: lines.join('\n'),
            ephemeral: false
        });
    }
}

module.exports = SceneSummariesCommand;
