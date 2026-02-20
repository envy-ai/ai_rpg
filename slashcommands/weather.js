const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
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

function formatMinutes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }
  const rounded = Math.round(numeric);
  if (rounded < 60) {
    return `${rounded}m`;
  }
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function formatDurationRange(range) {
  if (!range || typeof range !== 'object') {
    return '-';
  }
  const minMinutes = Number(range.minMinutes ?? (Number(range.minHours) * 60));
  const maxMinutes = Number(range.maxMinutes ?? (Number(range.maxHours) * 60));
  if (!Number.isFinite(minMinutes) || !Number.isFinite(maxMinutes)) {
    return '-';
  }
  if (minMinutes === maxMinutes) {
    return formatMinutes(minMinutes);
  }
  return `${formatMinutes(minMinutes)}-${formatMinutes(maxMinutes)}`;
}

function resolveCurrentRegion() {
  if (Globals.region && typeof Globals.region === 'object') {
    return Globals.region;
  }

  const player = Globals.currentPlayer;
  if (!player) {
    return null;
  }

  if (player.location && typeof player.location === 'object') {
    if (player.location.region && typeof player.location.region === 'object') {
      return player.location.region;
    }
    if (typeof player.location.regionId === 'string' && player.location.regionId.trim()) {
      return Region.get(player.location.regionId.trim()) || null;
    }
  }

  const locationId = typeof player.currentLocation === 'string' ? player.currentLocation.trim() : '';
  if (!locationId) {
    return null;
  }
  const location = Location.get(locationId);
  if (!location) {
    return null;
  }
  if (location.region && typeof location.region === 'object') {
    return location.region;
  }
  if (typeof location.regionId === 'string' && location.regionId.trim()) {
    return Region.get(location.regionId.trim()) || null;
  }
  return null;
}

class WeatherCommand extends SlashCommandBase {
  static get name() {
    return 'weather';
  }

  static get description() {
    return 'Show seasonal weather details for the current region in markdown.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const region = resolveCurrentRegion();
    if (!region) {
      throw new Error('Current region is unavailable; cannot display weather details.');
    }

    const regionName = typeof region.name === 'string' && region.name.trim()
      ? region.name.trim()
      : (typeof region.id === 'string' && region.id.trim() ? region.id.trim() : 'Unknown Region');

    const weather = region.weather;
    if (!weather || typeof weather !== 'object') {
      throw new Error(`Region "${regionName}" has no readable weather configuration.`);
    }

    const seasonWeather = Array.isArray(weather.seasonWeather) ? weather.seasonWeather : [];
    const worldTime = typeof Globals.getWorldTimeContext === 'function'
      ? Globals.getWorldTimeContext()
      : null;
    const currentSeason = typeof worldTime?.season === 'string' && worldTime.season.trim()
      ? worldTime.season.trim()
      : null;
    const currentWeather = typeof worldTime?.weatherName === 'string' && worldTime.weatherName.trim()
      ? worldTime.weatherName.trim()
      : null;

    const lines = [
      `## Weather: ${escapeMarkdownCell(regionName)}`,
      '',
      `- Dynamic weather: **${weather.hasDynamicWeather ? 'Yes' : 'No'}**`,
      currentSeason ? `- Current season: **${escapeMarkdownCell(currentSeason)}**` : null,
      currentWeather ? `- Current weather: **${escapeMarkdownCell(currentWeather)}**` : null,
      ''
    ].filter(Boolean);

    if (!seasonWeather.length) {
      lines.push('_No season-specific weather details are defined for this region._');
    } else {
      for (const seasonEntry of seasonWeather) {
        if (!seasonEntry || typeof seasonEntry !== 'object') {
          continue;
        }
        const seasonName = typeof seasonEntry.seasonName === 'string' && seasonEntry.seasonName.trim()
          ? seasonEntry.seasonName.trim()
          : 'Unknown Season';
        const weatherTypes = Array.isArray(seasonEntry.weatherTypes) ? seasonEntry.weatherTypes : [];

        lines.push(`### ${escapeMarkdownCell(seasonName)}`);
        if (!weatherTypes.length) {
          lines.push('_No weather types defined for this season._');
          lines.push('');
          continue;
        }

        const table = renderTable(
          ['Weather Type', 'Description', 'Relative Frequency', 'Typical Duration'],
          weatherTypes.map(entry => [
            entry?.name || '-',
            entry?.description || '-',
            Number.isFinite(Number(entry?.relativeFrequency)) ? Number(entry.relativeFrequency) : '-',
            formatDurationRange(entry?.durationRange)
          ])
        );
        lines.push(table);
        lines.push('');
      }
    }

    await interaction.reply({
      content: lines.join('\n').trim(),
      ephemeral: false
    });
  }
}

module.exports = WeatherCommand;
