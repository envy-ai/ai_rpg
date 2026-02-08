const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

function escapeMarkdownCell(value) {
  if (value === null || value === undefined) {
    return '-';
  }
  const text = String(value).trim();
  if (!text) {
    return '-';
  }
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderTable(headers, rows) {
  const headerLine = `| ${headers.map(escapeMarkdownCell).join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const bodyLines = rows.map(row => `| ${row.map(escapeMarkdownCell).join(' | ')} |`);
  return [headerLine, separatorLine, ...bodyLines].join('\n');
}

class CalendarInfoCommand extends SlashCommandBase {
  static get name() {
    return 'calendar_info';
  }

  static get aliases() {
    return ['calendar'];
  }

  static get description() {
    return 'Show all in-game calendar and current world-time details in markdown.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    if (typeof Globals?.getSerializedCalendarDefinition !== 'function') {
      throw new Error('Calendar definition accessor is unavailable.');
    }
    if (typeof Globals?.getWorldTimeContext !== 'function') {
      throw new Error('World time accessor is unavailable.');
    }

    const calendar = Globals.getSerializedCalendarDefinition();
    const worldTime = Globals.getWorldTimeContext();
    if (!calendar || typeof calendar !== 'object') {
      throw new Error('Calendar definition is unavailable.');
    }
    if (!worldTime || typeof worldTime !== 'object') {
      throw new Error('World time context is unavailable.');
    }

    const months = Array.isArray(calendar.months) ? calendar.months : [];
    const weekdays = Array.isArray(calendar.weekdays) ? calendar.weekdays : [];
    const seasons = Array.isArray(calendar.seasons) ? calendar.seasons : [];
    const holidays = Array.isArray(calendar.holidays) ? calendar.holidays : [];

    const monthTable = renderTable(
      ['Month', 'Days', 'Season'],
      months.map(month => [
        month?.name || '-',
        Number.isFinite(Number(month?.lengthDays)) ? Number(month.lengthDays) : '-',
        month?.seasonName || '-'
      ])
    );

    const seasonTable = renderTable(
      ['Season', 'Starts', 'Day Length (minutes)', 'Description'],
      seasons.map(season => [
        season?.name || '-',
        `${season?.startMonth || '-'} ${Number.isFinite(Number(season?.startDay)) ? Number(season.startDay) : ''}`.trim(),
        Number.isFinite(Number(season?.dayLengthMinutes)) ? Number(season.dayLengthMinutes) : '-',
        season?.description || '-'
      ])
    );

    const holidayTable = holidays.length
      ? renderTable(
          ['Date', 'Holiday', 'Description'],
          holidays.map(holiday => [
            `${holiday?.month || '-'} ${Number.isFinite(Number(holiday?.day)) ? Number(holiday.day) : ''}`.trim(),
            holiday?.name || '-',
            holiday?.description || '-'
          ])
        )
      : '_No holidays defined._';

    const weekdayList = weekdays.length
      ? weekdays.map((day, index) => `${index + 1}. ${escapeMarkdownCell(day)}`).join('\n')
      : '_No weekdays defined._';

    const currentHolidayLine = worldTime.holidayName
      ? `- Holiday: **${escapeMarkdownCell(worldTime.holidayName)}**`
      : '- Holiday: None';

    const content = [
      '## Calendar Info',
      '',
      `- Year Name: **${escapeMarkdownCell(calendar.yearName || '-')}**`,
      `- Day Index: **${escapeMarkdownCell(worldTime.dayIndex)}**`,
      `- Time: **${escapeMarkdownCell(worldTime.timeLabel)}** (${escapeMarkdownCell(worldTime.timeHours)}h)`,
      `- Date: **${escapeMarkdownCell(worldTime.dateLabel)}**`,
      `- Segment: **${escapeMarkdownCell(worldTime.segment)}**`,
      `- Season: **${escapeMarkdownCell(worldTime.season)}**`,
      currentHolidayLine,
      '',
      '### Weekdays',
      weekdayList,
      '',
      '### Months',
      monthTable,
      '',
      '### Seasons',
      seasonTable,
      '',
      '### Holidays',
      holidayTable
    ].join('\n');

    await interaction.reply({
      content,
      ephemeral: false
    });
  }
}

module.exports = CalendarInfoCommand;

