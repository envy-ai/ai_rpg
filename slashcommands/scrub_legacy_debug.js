const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');

const STANDALONE_DIAGNOSTIC_TYPES = new Set([
    'check-results',
    'tool-call-debug'
]);

function normalizeEntryType(entry) {
    return typeof entry?.type === 'string' ? entry.type.trim().toLowerCase() : '';
}

function isLegacyDebugLine(line) {
    if (typeof line !== 'string') {
        return false;
    }
    const trimmed = line.trim();
    return /^Checks:\s+\d+\s+checks?\b/i.test(trimmed)
        || /^Tool call debug:\s+\d+\s+calls?\b/i.test(trimmed);
}

function isLegacyDebugBlockStart(text) {
    if (typeof text !== 'string') {
        return false;
    }
    const trimmed = text.trim();
    return /^Checks for\b/i.test(trimmed)
        || /^Tool calls for\b/i.test(trimmed);
}

function isLegacyDebugOnlyText(text) {
    if (typeof text !== 'string') {
        return false;
    }
    if (isLegacyDebugBlockStart(text)) {
        return true;
    }
    const lines = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    return lines.length > 0 && lines.every(isLegacyDebugLine);
}

function isStandaloneLegacyDebugEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }
    if (STANDALONE_DIAGNOSTIC_TYPES.has(normalizeEntryType(entry))) {
        return true;
    }
    if (entry?.metadata?.debugToolCalls === true || entry?.metadata?.checkResults === true) {
        return true;
    }
    if (Array.isArray(entry.toolCalls) || Array.isArray(entry.checkResults)) {
        return true;
    }
    return isLegacyDebugOnlyText(entry.content) || isLegacyDebugOnlyText(entry.summary);
}

function scrubLegacyDebugLines(text) {
    if (typeof text !== 'string') {
        return { text, removedLines: 0, changed: false };
    }
    const lines = text.split(/\r?\n/);
    const kept = [];
    let removedLines = 0;
    for (const line of lines) {
        if (isLegacyDebugLine(line)) {
            removedLines += 1;
            continue;
        }
        kept.push(line);
    }
    const scrubbed = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return {
        text: scrubbed,
        removedLines,
        changed: scrubbed !== text
    };
}

function analyzeChatHistory(chatHistory) {
    if (!Array.isArray(chatHistory)) {
        throw new Error('Chat history is unavailable in the current command context.');
    }

    const removedEntries = [];
    const modifiedEntries = [];
    let removedEmbeddedLines = 0;

    for (let index = 0; index < chatHistory.length; index += 1) {
        const entry = chatHistory[index];
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        if (isStandaloneLegacyDebugEntry(entry)) {
            removedEntries.push({
                index,
                id: typeof entry.id === 'string' ? entry.id : null
            });
            continue;
        }

        const contentResult = scrubLegacyDebugLines(entry.content);
        const summaryResult = scrubLegacyDebugLines(entry.summary);
        if (!contentResult.changed && !summaryResult.changed) {
            continue;
        }

        removedEmbeddedLines += contentResult.removedLines + summaryResult.removedLines;
        modifiedEntries.push({
            entry,
            id: typeof entry.id === 'string' ? entry.id : null,
            content: contentResult.changed ? contentResult.text : entry.content,
            summary: summaryResult.changed ? summaryResult.text : entry.summary
        });
    }

    return {
        removedEntries,
        modifiedEntries,
        removedEmbeddedLines
    };
}

function scrubScene(scene) {
    const summaryResult = scrubLegacyDebugLines(scene.summary);
    const details = Array.isArray(scene.details) ? scene.details : [];
    const quotes = Array.isArray(scene.quotes) ? scene.quotes : [];
    let removedLines = summaryResult.removedLines;

    const nextDetails = [];
    let detailsChanged = false;
    for (const detail of details) {
        const result = scrubLegacyDebugLines(detail);
        removedLines += result.removedLines;
        if (result.changed) {
            detailsChanged = true;
        }
        if (typeof result.text === 'string' && result.text.trim()) {
            nextDetails.push(result.text);
        } else if (typeof detail === 'string' && detail.trim()) {
            detailsChanged = true;
        }
    }

    const nextQuotes = [];
    let quotesChanged = false;
    for (const quote of quotes) {
        if (!quote || typeof quote !== 'object') {
            quotesChanged = true;
            continue;
        }
        const result = scrubLegacyDebugLines(quote.text);
        removedLines += result.removedLines;
        if (result.changed) {
            quotesChanged = true;
        }
        if (typeof result.text === 'string' && result.text.trim()) {
            nextQuotes.push({
                character: quote.character,
                text: result.text
            });
        } else {
            quotesChanged = true;
        }
    }

    const changed = summaryResult.changed || detailsChanged || quotesChanged;
    return {
        changed,
        invalid: changed && !summaryResult.text,
        removedLines,
        updates: {
            summary: summaryResult.text,
            details: nextDetails,
            quotes: nextQuotes
        }
    };
}

function analyzeSceneSummaries(sceneSummaries) {
    if (!sceneSummaries || typeof sceneSummaries.getScenesInOrder !== 'function') {
        throw new Error('Scene summaries are unavailable.');
    }

    const scenes = sceneSummaries.getScenesInOrder();
    const modifiedScenes = [];
    const invalidScenes = [];
    let removedLines = 0;

    scenes.forEach((scene, index) => {
        const result = scrubScene(scene);
        if (!result.changed) {
            return;
        }
        if (result.invalid) {
            invalidScenes.push(index + 1);
            return;
        }
        removedLines += result.removedLines;
        modifiedScenes.push({
            displayIndex: index + 1,
            updates: result.updates
        });
    });

    return {
        modifiedScenes,
        invalidScenes,
        removedLines
    };
}

function plural(count, singular, pluralForm = `${singular}s`) {
    return count === 1 ? singular : pluralForm;
}

function formatReport({ dryRun = false, chatPlan, scenePlan }) {
    const removedChatEntries = chatPlan.removedEntries.length;
    const scrubbedChatEntries = chatPlan.modifiedEntries.length;
    const scrubbedSceneSummaries = scenePlan.modifiedScenes.length;
    const prefix = dryRun ? 'Dry run: ' : '';
    const verb = dryRun ? 'would remove' : 'Removed';
    const scrubVerb = dryRun ? 'scrub' : 'scrubbed';

    return [
        `${prefix}${verb} ${removedChatEntries} standalone diagnostic chat ${plural(removedChatEntries, 'entry', 'entries')}, ${scrubVerb} ${scrubbedChatEntries} chat ${plural(scrubbedChatEntries, 'entry', 'entries')}, and ${scrubVerb} ${scrubbedSceneSummaries} scene ${plural(scrubbedSceneSummaries, 'summary', 'summaries')}.`,
        `Removed embedded debug lines: ${chatPlan.removedEmbeddedLines + scenePlan.removedLines}.`
    ].join('\n');
}

function hasChanges(chatPlan, scenePlan) {
    return chatPlan.removedEntries.length > 0
        || chatPlan.modifiedEntries.length > 0
        || scenePlan.modifiedScenes.length > 0;
}

class ScrubLegacyDebugCommand extends SlashCommandBase {
    static get name() {
        return 'scrub_legacy_debug';
    }

    static get aliases() {
        return ['scrub_debug_history', 'scrub_debug'];
    }

    static get description() {
        return 'Remove old check/tool debug pollution from chat history and stored scene summaries.';
    }

    static get args() {
        return [
            { name: 'dry_run', type: 'boolean', required: false }
        ];
    }

    static async execute(interaction, args = {}) {
        const dryRun = args.dry_run === true;
        const chatHistory = typeof interaction?.getChatHistory === 'function'
            ? interaction.getChatHistory()
            : interaction?.chatHistory;
        const sceneSummaries = Globals.getSceneSummaries();

        const chatPlan = analyzeChatHistory(chatHistory);
        const scenePlan = analyzeSceneSummaries(sceneSummaries);

        if (scenePlan.invalidScenes.length > 0) {
            await interaction.reply({
                content: `Cannot scrub scene ${scenePlan.invalidScenes.join(', ')} because removing debug text would leave an empty summary. Rerun or edit those scene summaries first.`,
                ephemeral: true
            });
            return;
        }

        if (!hasChanges(chatPlan, scenePlan)) {
            await interaction.reply({
                content: 'No legacy debug pollution found in chat history or stored scene summaries.',
                ephemeral: false
            });
            return;
        }

        if (dryRun) {
            await interaction.reply({
                content: formatReport({ dryRun: true, chatPlan, scenePlan }),
                ephemeral: false
            });
            return;
        }

        for (const modified of chatPlan.modifiedEntries) {
            if (typeof modified.content === 'string') {
                modified.entry.content = modified.content;
            }
            if (typeof modified.summary === 'string') {
                modified.entry.summary = modified.summary;
            }
            modified.entry.lastEditedAt = new Date().toISOString();
        }

        for (let i = chatPlan.removedEntries.length - 1; i >= 0; i -= 1) {
            chatHistory.splice(chatPlan.removedEntries[i].index, 1);
        }

        for (const sceneUpdate of scenePlan.modifiedScenes) {
            sceneSummaries.updateSceneAtDisplayIndex(sceneUpdate.displayIndex, sceneUpdate.updates);
        }

        const performGameSave = interaction?.performGameSave;
        if (typeof performGameSave !== 'function') {
            throw new Error('performGameSave is unavailable; cannot persist legacy debug scrub.');
        }
        await performGameSave();

        const removedEntryIds = chatPlan.removedEntries
            .map(entry => entry.id)
            .filter(Boolean);
        const modifiedEntryIds = chatPlan.modifiedEntries
            .map(entry => entry.id)
            .filter(Boolean);
        if (removedEntryIds.length || modifiedEntryIds.length) {
            const realtimeHub = Globals?.realtimeHub;
            if (!realtimeHub || typeof realtimeHub.emit !== 'function') {
                throw new Error('Realtime hub is unavailable; cannot refresh chat history.');
            }
            realtimeHub.emit(null, 'chat_history_updated', {
                removedEntryIds,
                modifiedEntryIds,
                removedEntries: removedEntryIds.length,
                modifiedEntries: modifiedEntryIds.length
            });
        }

        await interaction.reply({
            content: `${formatReport({ chatPlan, scenePlan })}\nChanges have been saved.`,
            ephemeral: false
        });
    }
}

module.exports = ScrubLegacyDebugCommand;
