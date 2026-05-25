const Globals = require('../Globals.js');
const ScheduledEvent = require('../ScheduledEvent.js');
const SlashCommandBase = require('../SlashCommandBase.js');
const Utils = require('../Utils.js');

function escapeInlineMarkdown(value) {
  if (value === null || value === undefined) {
    return '-';
  }
  const text = String(value).trim();
  if (!text) {
    return '-';
  }
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

function formatCode(value) {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return text ? `\`${text.replace(/`/g, '\\`')}\`` : '-';
}

function absoluteMinuteToWorldTime(totalMinutes) {
  const numeric = Number(totalMinutes);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error('Scheduled event target world minute must be a non-negative integer.');
  }
  const timeConfig = Globals.getTimeConfig();
  const cycleLengthMinutes = timeConfig.cycleLengthMinutes;
  const dayIndex = Math.floor(numeric / cycleLengthMinutes);
  const timeMinutes = numeric - (dayIndex * cycleLengthMinutes);
  return { dayIndex, timeMinutes };
}

function formatWorldMinute(totalMinutes) {
  Globals.ensureWorldTimeInitialized();
  const worldTime = absoluteMinuteToWorldTime(totalMinutes);
  const dateLabel = Globals.formatDate(worldTime, { skipEnsure: true });
  const timeLabel = Globals.formatTime(worldTime, { skipEnsure: true });
  return [dateLabel, timeLabel].filter(Boolean).join(', ');
}

function formatRelativeTime(targetWorldMinute) {
  const currentWorldMinute = Globals.getTotalWorldMinutes();
  const delta = targetWorldMinute - currentWorldMinute;
  if (delta === 0) {
    return 'now';
  }
  const duration = Utils.formatMinutesAsNaturalDuration(Math.abs(delta));
  return delta > 0 ? duration : `overdue by ${duration}`;
}

function formatEntityLine(label, name, id) {
  return `   - ${label}: ${escapeInlineMarkdown(name)} (${formatCode(id)})`;
}

function formatEventText(eventText) {
  const normalized = typeof eventText === 'string'
    ? eventText.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    : '';
  if (!normalized) {
    return ['   - Event:', '     -'];
  }
  return [
    '   - Event:',
    ...normalized.split('\n').map(line => `     ${line.trim() || ''}`)
  ];
}

function buildScheduledEventsMarkdown(events) {
  if (!Array.isArray(events)) {
    throw new Error('Scheduled event list must be an array.');
  }
  if (events.length === 0) {
    return 'No pending scheduled events.';
  }

  const lines = [
    '## Scheduled Events',
    ''
  ];

  events.forEach((event, index) => {
    lines.push(`${index + 1}. ${formatCode(event.id)}`);
    lines.push(`   - Due: **${escapeInlineMarkdown(formatWorldMinute(event.targetWorldMinute))}**`);
    lines.push(`   - In: **${escapeInlineMarkdown(formatRelativeTime(event.targetWorldMinute))}**`);
    lines.push(formatEntityLine('Region', event.regionName, event.regionId));
    lines.push(formatEntityLine('Location', event.locationName, event.locationId));
    lines.push(...formatEventText(event.event));
    if (index < events.length - 1) {
      lines.push('');
    }
  });

  return lines.join('\n');
}

class ScheduledCommand extends SlashCommandBase {
  static get name() {
    return 'scheduled';
  }

  static get description() {
    return 'List pending scheduled events in readable markdown.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    if (!ScheduledEvent || typeof ScheduledEvent.getPending !== 'function') {
      throw new Error('ScheduledEvent pending-event accessor is unavailable.');
    }
    const pendingEvents = ScheduledEvent.getPending();
    await interaction.reply({
      content: buildScheduledEventsMarkdown(pendingEvents),
      ephemeral: false
    });
  }
}

module.exports = ScheduledCommand;
