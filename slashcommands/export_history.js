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

function formatTextHistory(entries, playerName) {
  const lines = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const content = typeof entry.content === 'string' ? entry.content.trim() : '';
    const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
    const text = content || summary;
    if (!text) {
      continue;
    }
    const timestamp = typeof entry.timestamp === 'string' && entry.timestamp.trim()
      ? entry.timestamp.trim()
      : '';
    const role = resolveRoleLabel(entry.role, playerName);
    const headerParts = [];
    if (timestamp) {
      headerParts.push(`[${timestamp}]`);
    }
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

function formatHtmlHistory(entries, playerName) {
  const blocks = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const content = typeof entry.content === 'string' ? entry.content.trim() : '';
    const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
    const text = content || summary;
    if (!text) {
      continue;
    }
    const timestamp = typeof entry.timestamp === 'string' && entry.timestamp.trim()
      ? entry.timestamp.trim()
      : '';
    const role = resolveRoleLabel(entry.role, playerName);
    const metaParts = [];
    if (timestamp) {
      metaParts.push(`<span class="timestamp">${escapeHtml(timestamp)}</span>`);
    }
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
      { name: 'filename', type: 'string', required: false }
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

    const requiresPlayerName = chatHistory.some(entry => {
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
    let payload;
    try {
      payload = format === 'html'
        ? formatHtmlHistory(chatHistory, playerName)
        : formatTextHistory(chatHistory, playerName);
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
