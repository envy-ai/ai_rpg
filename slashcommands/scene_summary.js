const fs = require('fs');
const path = require('path');
const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');
const {
    filterChatHistoryEntries,
    normalizeEntryText
} = require('../chat_history_utils.js');

function parseIndexRange(rawRange) {
    if (typeof rawRange !== 'string') {
        throw new Error('Range must be a string like "5-25".');
    }
    const trimmed = rawRange.trim();
    if (!trimmed) {
        throw new Error('Range is required.');
    }
    if (trimmed.toLowerCase() === 'all') {
        return { start: 'all', end: 'all' };
    }
    const singleMatch = trimmed.match(/^(\d+)$/);
    if (singleMatch) {
        const value = Number.parseInt(singleMatch[1], 10);
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error('Range value must be a positive integer.');
        }
        return { start: value, end: value };
    }
    const rangeMatch = trimmed.match(/^(\d+)\s*(?:-|\.\.)\s*(\d+)$/);
    if (!rangeMatch) {
        throw new Error('Range must be formatted like "5-25".');
    }
    const start = Number.parseInt(rangeMatch[1], 10);
    const end = Number.parseInt(rangeMatch[2], 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) {
        throw new Error('Range values must be positive integers.');
    }
    if (end < start) {
        throw new Error('Range end must be greater than or equal to start.');
    }
    return { start, end };
}

function formatSceneSummaryText(summaryResult) {
    const lines = [];
    const range = summaryResult?.summarizedRange || summaryResult?.range || {};
    const scenes = Array.isArray(summaryResult?.scenes) ? summaryResult.scenes : [];
    const timestamp = new Date().toISOString();

    lines.push(`Scene summary for entries ${range.start}-${range.end}`);
    lines.push(`Generated: ${timestamp}`);
    lines.push('');

    scenes.forEach((scene, index) => {
        const startIndex = scene.startIndex;
        const entryId = scene.startEntryId ? `, id ${scene.startEntryId}` : '';
        lines.push(`Scene ${index + 1} (starts at entry ${startIndex}${entryId})`);
        lines.push(scene.summary || '');
        if (Array.isArray(scene.quotes) && scene.quotes.length) {
            lines.push('Quotes:');
            for (const quote of scene.quotes) {
                lines.push(`- ${quote.character}: "${quote.text}"`);
            }
        }
        lines.push('');
    });

    return lines.join('\n').trimEnd() + '\n';
}

function countUnsummarizedEntries(chatHistory) {
    const filteredEntries = filterChatHistoryEntries(chatHistory, { excludeSummaries: true });
    let totalEntries = 0;
    for (const entry of filteredEntries) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const content = typeof entry.content === 'string' ? entry.content.trim() : '';
        const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
        const rawText = content || summary;
        const text = normalizeEntryText(rawText);
        if (!text) {
            continue;
        }
        totalEntries += 1;
    }

    if (totalEntries === 0) {
        return { total: 0, summarized: 0, unsummarized: 0 };
    }

    const sceneSummaries = Globals.getSceneSummaries();
    const scenes = typeof sceneSummaries?.getScenesInOrder === 'function'
        ? sceneSummaries.getScenesInOrder()
        : [];
    if (!Array.isArray(scenes) || scenes.length === 0) {
        return { total: totalEntries, summarized: 0, unsummarized: totalEntries };
    }

    const intervals = scenes
        .map(scene => ({
            start: Number(scene?.startIndex),
            end: Number(scene?.endIndex)
        }))
        .filter(interval => Number.isInteger(interval.start) && Number.isInteger(interval.end))
        .map(interval => ({
            start: Math.max(1, interval.start),
            end: Math.min(totalEntries, interval.end)
        }))
        .filter(interval => interval.end >= interval.start)
        .sort((a, b) => a.start - b.start);

    let summarized = 0;
    let cursor = 1;
    for (const interval of intervals) {
        if (interval.end < cursor) {
            continue;
        }
        const start = Math.max(cursor, interval.start);
        const end = Math.min(interval.end, totalEntries);
        if (end >= start) {
            summarized += end - start + 1;
            cursor = end + 1;
        }
        if (cursor > totalEntries) {
            break;
        }
    }

    const unsummarized = Math.max(0, totalEntries - summarized);
    return { total: totalEntries, summarized, unsummarized };
}

class SceneSummaryCommand extends SlashCommandBase {
    static get name() {
        return 'summarize';
    }

    static get aliases() {
        return ['scene_summary'];
    }

    static get description() {
        return 'Summarize a range of log entries into scenes and export to a text file.';
    }

    static get args() {
        return [
            { name: 'range', type: 'string', required: true },
            { name: 'redo', type: 'boolean', required: false }
        ];
    }

    static get usage() {
        return [
            '/summarize <range> [redo]',
            'range: "check" (count unsummarized), "all", "N", or "N-M"',
            'redo: true/false to re-summarize and extend the range slightly'
        ].join('\n');
    }

    static async execute(interaction, args = {}) {
        const rawRange = typeof args.range === 'string' ? args.range.trim() : '';
        const normalizedRange = rawRange.toLowerCase();

        const chatHistory = typeof interaction?.getChatHistory === 'function'
            ? interaction.getChatHistory()
            : interaction?.chatHistory;
        if (!Array.isArray(chatHistory)) {
            await interaction.reply({
                content: 'Chat history is unavailable in the current command context.',
                ephemeral: true
            });
            return;
        }
        if (chatHistory.length === 0) {
            await interaction.reply({
                content: 'No chat history available to summarize.',
                ephemeral: true
            });
            return;
        }

        if (normalizedRange === 'check') {
            const counts = countUnsummarizedEntries(chatHistory);
            await interaction.reply({
                content: counts.total === 0
                    ? 'No chat history entries are available for scene summaries.'
                    : `Unsummarized entries: ${counts.unsummarized} of ${counts.total}.`,
                ephemeral: false
            });
            return;
        }

        let range;
        try {
            range = parseIndexRange(rawRange);
        } catch (error) {
            await interaction.reply({
                content: error.message,
                ephemeral: true
            });
            return;
        }

        const summarizeFn = Globals.summarizeScenesForHistoryRange;
        if (typeof summarizeFn !== 'function') {
            throw new Error('Scene summarization is unavailable on this server.');
        }

        let summaryResult;
        try {
            summaryResult = await summarizeFn({
                chatHistory,
                startIndex: range.start,
                endIndex: range.end,
                redo: Boolean(args.redo)
            });
        } catch (error) {
            await interaction.reply({
                content: `Scene summary failed: ${error.message}`,
                ephemeral: true
            });
            return;
        }

        if (!summaryResult || !Array.isArray(summaryResult.scenes) || summaryResult.scenes.length === 0) {
            await interaction.reply({
                content: 'Scene summary returned no scenes.',
                ephemeral: true
            });
            return;
        }

        const exportDir = path.join(process.cwd(), 'exports');
        try {
            fs.mkdirSync(exportDir, { recursive: true });
        } catch (error) {
            await interaction.reply({
                content: `Failed to create export directory: ${error.message}`,
                ephemeral: true
            });
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `summary-${timestamp}.txt`;
        const outputPath = path.join(exportDir, filename);

        let payload;
        try {
            payload = formatSceneSummaryText(summaryResult);
        } catch (error) {
            await interaction.reply({
                content: `Failed to format scene summary: ${error.message}`,
                ephemeral: true
            });
            return;
        }

        try {
            fs.writeFileSync(outputPath, payload, 'utf8');
        } catch (error) {
            await interaction.reply({
                content: `Failed to write export file: ${error.message}`,
                ephemeral: true
            });
            return;
        }

        try {
            console.log(payload);
        } catch (error) {
            console.warn('Failed to write scene summary to CLI:', error.message);
        }

        await interaction.reply({
            content: `Exported scene summary to ${outputPath}.`,
            ephemeral: false
        });
    }
}

module.exports = SceneSummaryCommand;
