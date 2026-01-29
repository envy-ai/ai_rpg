const fs = require('fs');
const path = require('path');
const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');

const SUPPORTED_FORMATS = new Set(['text', 'txt', 'html']);

function normalizeFormat(rawFormat) {
  const normalized = typeof rawFormat === 'string' ? rawFormat.trim().toLowerCase() : '';
  if (!normalized) {
    return 'text';
  }
  if (!SUPPORTED_FORMATS.has(normalized)) {
    throw new Error(`Unsupported format "${rawFormat}". Use "text" or "html".`);
  }
  return normalized === 'txt' ? 'text' : normalized;
}

function sanitizeFilename(rawName) {
  if (typeof rawName !== 'string') {
    return null;
  }
  const trimmed = rawName.trim();
  if (!trimmed) {
    return null;
  }
  const sanitized = trimmed.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  return sanitized || null;
}

function ensureExtension(filename, extension) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(`.${extension}`)) {
    return filename;
  }
  const lastDot = filename.lastIndexOf('.');
  if (lastDot !== -1) {
    const existingExt = filename.slice(lastDot + 1).toLowerCase();
    if (existingExt && existingExt !== extension) {
      throw new Error(`Filename extension ".${existingExt}" does not match the "${extension}" format.`);
    }
  }
  return `${filename}.${extension}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveRoleLabel(rawRole, playerName) {
  if (!rawRole || typeof rawRole !== 'string') {
    return '';
  }
  const normalized = rawRole.trim();
  if (!normalized) {
    return '';
  }
  const lower = normalized.toLowerCase();
  if (lower === 'user') {
    if (!playerName) {
      throw new Error('Player name is required to format user entries.');
    }
    return playerName;
  }
  if (lower === 'assistant') {
    return 'Storyteller';
  }
  return normalized;
}

function resolvePlayerName() {
  const player = Globals?.currentPlayer;
  if (!player || typeof player.name !== 'string') {
    return null;
  }
  const trimmed = player.name.trim();
  return trimmed || null;
}

function resolveEntryRecordId(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Chat history entry is invalid.');
  }
  const rawId = entry.id;
  if (typeof rawId !== 'string') {
    throw new Error('Chat history entry is missing a record ID.');
  }
  const trimmed = rawId.trim();
  if (!trimmed) {
    throw new Error('Chat history entry has an empty record ID.');
  }
  return trimmed;
}

const OMIT_ENTRY_MARKERS = [
  '🛠️ Crafting Results',
  '📋 Events',
  '🗒️ Quest',
  '✅ Quest',
  '✨ Additional',
  '♻️ Salvage'
];

function containsOmittedMarker(text) {
  if (typeof text !== 'string') {
    return false;
  }
  return OMIT_ENTRY_MARKERS.some(marker => text.includes(marker));
}

function resolveSummaryHeader(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const rawTitle = typeof entry.summaryTitle === 'string' ? entry.summaryTitle.trim() : '';
  if (rawTitle) {
    return rawTitle;
  }
  const rawContent = typeof entry.content === 'string' ? entry.content.trim() : '';
  if (!rawContent) {
    return null;
  }
  const firstLine = rawContent.split('\n')[0]?.trim();
  return firstLine || null;
}

function shouldExcludeSummaryEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const rawType = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '';
  if (rawType === 'status-summary') {
    return true;
  }
  if (rawType !== 'event-summary') {
    return false;
  }
  const header = resolveSummaryHeader(entry);
  if (!header) {
    return false;
  }
  const normalizedHeader = header.toLowerCase();
  return normalizedHeader.startsWith('📋 events')
    || normalizedHeader.startsWith('🌾 harvest results');
}

function isSystemEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const rawRole = typeof entry.role === 'string' ? entry.role.trim().toLowerCase() : '';
  return rawRole === 'system';
}

function stripLineMarker(line) {
  if (typeof line !== 'string') {
    return '';
  }
  return line.replace(/^(!{1,2}|#)\s*/, '');
}

function isSceneIllustrationLine(line) {
  if (typeof line !== 'string') {
    return false;
  }
  return /^\s*!\[Scene Illustration\]\([^)]*\)\s*$/.test(line);
}

function normalizeEntryText(text) {
  if (typeof text !== 'string') {
    return '';
  }
  const lines = text.split('\n');
  const cleanedLines = [];
  for (const line of lines) {
    if (isSceneIllustrationLine(line)) {
      continue;
    }
    cleanedLines.push(stripLineMarker(line));
  }
  const joined = cleanedLines.join('\n');
  return joined.replace(/\n+/g, '\n\n').trim();
}

function formatTextHistory(entries, playerName, options = {}) {
  const lines = [];
  let outputIndex = 0;
  const useIndex = options.useIndex === true;
  for (const entry of entries) {
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
    outputIndex += 1;
    const recordLabel = useIndex ? String(outputIndex) : resolveEntryRecordId(entry);
    const role = resolveRoleLabel(entry.role, playerName);
    const headerParts = [];
    headerParts.push(`[${recordLabel}]`);
    if (role) {
      headerParts.push(`[${role}]`);
    }
    if (headerParts.length) {
      lines.push(`${headerParts.join(' ')} ${text}`);
    } else {
      lines.push(text);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

function formatHtmlHistory(entries, playerName, options = {}) {
  const blocks = [];
  let outputIndex = 0;
  const useIndex = options.useIndex === true;
  for (const entry of entries) {
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
    outputIndex += 1;
    const recordLabel = useIndex ? String(outputIndex) : resolveEntryRecordId(entry);
    const role = resolveRoleLabel(entry.role, playerName);
    const metaParts = [];
    metaParts.push(`<span class="record-id">${escapeHtml(recordLabel)}</span>`);
    if (role) {
      metaParts.push(`<span class="role">${escapeHtml(role)}</span>`);
    }
    blocks.push(
      `<article class="entry">` +
      `<div class="meta">${metaParts.join(' ')}</div>` +
      `<div class="content">${escapeHtml(text).replace(/\n/g, '<br>')}</div>` +
      `</article>`
    );
  }

  const body = blocks.join('\n') || '<p>No chat history entries found.</p>';
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <title>Story History Export</title>',
    '  <style>',
    '    body { font-family: "Georgia", "Times New Roman", serif; margin: 24px; color: #1f1f1f; }',
    '    .entry { margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid #d0d0d0; }',
    '    .meta { font-size: 0.9em; color: #555; margin-bottom: 6px; }',
    '    .meta span { margin-right: 10px; }',
    '    .content { white-space: normal; line-height: 1.5; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <h1>Story History</h1>',
    `  ${body}`,
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

class ExportHistoryCommand extends SlashCommandBase {
  static get name() {
    return 'export_history';
  }

  static get description() {
    return 'Export the full story history to a text or HTML file.';
  }

  static get args() {
    return [
      { name: 'format', type: 'string', required: false, default: 'text' },
      { name: 'filename', type: 'string', required: false },
      { name: 'excludeSummaries', type: 'boolean', required: false, default: true },
      { name: 'useIndex', type: 'boolean', required: false, default: true }
    ];
  }

  static async execute(interaction, args = {}) {
    let format;
    try {
      format = normalizeFormat(args.format);
    } catch (error) {
      await interaction.reply({
        content: error.message,
        ephemeral: true
      });
      return;
    }

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
        content: 'No chat history available to export.',
        ephemeral: true
      });
      return;
    }

    const excludeSummaries = typeof args.excludeSummaries === 'boolean' ? args.excludeSummaries : true;
    const exportEntries = chatHistory.filter(entry => {
      if (isSystemEntry(entry)) {
        return false;
      }
      const content = typeof entry?.content === 'string' ? entry.content : '';
      const summary = typeof entry?.summary === 'string' ? entry.summary : '';
      if (containsOmittedMarker(content) || containsOmittedMarker(summary)) {
        return false;
      }
      if (excludeSummaries && shouldExcludeSummaryEntry(entry)) {
        return false;
      }
      return true;
    });

    if (exportEntries.length === 0) {
      await interaction.reply({
        content: 'No chat history entries available to export after filtering.',
        ephemeral: true
      });
      return;
    }

    const requiresPlayerName = exportEntries.some(entry => {
      if (!entry || typeof entry.role !== 'string') {
        return false;
      }
      return entry.role.trim().toLowerCase() === 'user';
    });
    const playerName = resolvePlayerName();
    if (requiresPlayerName && !playerName) {
      await interaction.reply({
        content: 'Unable to resolve the current player name for user entries. Load a game or set a player before exporting.',
        ephemeral: true
      });
      return;
    }

    const extension = format === 'html' ? 'html' : 'txt';
    const baseName = sanitizeFilename(args.filename);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let filename = baseName || `story_history_${timestamp}`;

    try {
      filename = ensureExtension(filename, extension);
    } catch (error) {
      await interaction.reply({
        content: error.message,
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

    const outputPath = path.join(exportDir, filename);
    const useIndex = typeof args.useIndex === 'boolean' ? args.useIndex : true;
    let payload;
    try {
      payload = format === 'html'
        ? formatHtmlHistory(exportEntries, playerName, { useIndex })
        : formatTextHistory(exportEntries, playerName, { useIndex });
    } catch (error) {
      await interaction.reply({
        content: `Failed to format chat history: ${error.message}`,
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

    await interaction.reply({
      content: `Exported ${chatHistory.length} entries to ${outputPath}.`,
      ephemeral: false
    });
  }
}

module.exports = ExportHistoryCommand;
