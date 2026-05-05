const { loadMergedDefinitionFile } = require('./DefinitionLoader.js');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function escapeMarkdownTableCell(value) {
  return normalizeWhitespace(value).replace(/\|/g, '\\|');
}

function formatLevelNumber(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Tonal scale level "${value}" is not numeric.`);
  }
  return Number.isInteger(numberValue) ? String(numberValue) : String(numberValue);
}

function normalizeUnifiedTonalScaleSelections(value) {
  if (value === null || value === undefined || value === '') {
    return {};
  }

  let source = value;
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed) {
      return {};
    }
    try {
      source = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`unifiedTonalScale must be valid JSON when passed as a string: ${error.message}`);
    }
  }

  if (!isPlainObject(source)) {
    throw new Error('unifiedTonalScale must be an object keyed by tonal axis.');
  }

  const normalized = {};
  for (const [rawAxisKey, rawEntry] of Object.entries(source)) {
    const axisKey = typeof rawAxisKey === 'string' ? rawAxisKey.trim() : '';
    if (!axisKey) {
      throw new Error('unifiedTonalScale contains an empty axis key.');
    }
    if (rawEntry === null || rawEntry === undefined || rawEntry === '') {
      continue;
    }
    if (!isPlainObject(rawEntry)) {
      throw new Error(`unifiedTonalScale.${axisKey} must be an object with level and optional comment.`);
    }

    const rawLevel = rawEntry.level;
    const hasLevel = rawLevel !== null && rawLevel !== undefined && String(rawLevel).trim() !== '';
    const comment = typeof rawEntry.comment === 'string'
      ? rawEntry.comment.replace(/\r\n/g, '\n').trim()
      : '';

    if (!hasLevel) {
      if (comment) {
        throw new Error(`unifiedTonalScale.${axisKey}.comment requires a selected level.`);
      }
      continue;
    }

    const level = Number(rawLevel);
    if (!Number.isFinite(level)) {
      throw new Error(`unifiedTonalScale.${axisKey}.level must be numeric.`);
    }

    normalized[axisKey] = { level };
    if (comment) {
      normalized[axisKey].comment = comment;
    }
  }

  return normalized;
}

function loadUnifiedTonalScaleDefinition({ baseDir } = {}) {
  if (typeof baseDir !== 'string' || !baseDir.trim()) {
    throw new Error('loadUnifiedTonalScaleDefinition requires a non-empty baseDir.');
  }
  const { value } = loadMergedDefinitionFile({
    baseDir,
    filename: 'unified_tonal_scale.yaml'
  });
  return validateUnifiedTonalScaleDefinition(value);
}

function validateUnifiedTonalScaleDefinition(definition) {
  if (!isPlainObject(definition)) {
    throw new Error('unified_tonal_scale.yaml must contain an object.');
  }
  const axes = definition.axes;
  if (!isPlainObject(axes)) {
    throw new Error('unified_tonal_scale.yaml must contain an axes object.');
  }

  const normalizedAxes = {};
  for (const [rawKey, rawAxis] of Object.entries(axes)) {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!key) {
      throw new Error('unified_tonal_scale.yaml axes contains an empty key.');
    }
    if (!isPlainObject(rawAxis)) {
      throw new Error(`unified_tonal_scale.yaml axes.${key} must be an object.`);
    }
    const title = typeof rawAxis.title === 'string' ? rawAxis.title.trim() : '';
    const abbreviation = typeof rawAxis.abbreviation === 'string' ? rawAxis.abbreviation.trim() : '';
    const framing = typeof rawAxis.framing === 'string' ? rawAxis.framing.trim() : '';
    if (!title || !abbreviation || !framing) {
      throw new Error(`unified_tonal_scale.yaml axes.${key} requires title, abbreviation, and framing.`);
    }
    if (!Array.isArray(rawAxis.levels) || rawAxis.levels.length === 0) {
      throw new Error(`unified_tonal_scale.yaml axes.${key}.levels must be a non-empty list.`);
    }

    const levels = rawAxis.levels.map((rawLevel, index) => {
      if (!isPlainObject(rawLevel)) {
        throw new Error(`unified_tonal_scale.yaml axes.${key}.levels[${index}] must be an object.`);
      }
      const level = Number(rawLevel.level);
      const name = typeof rawLevel.name === 'string' ? rawLevel.name.trim() : '';
      const description = typeof rawLevel.description === 'string' ? rawLevel.description.trim() : '';
      if (!Number.isFinite(level) || !name || !description) {
        throw new Error(`unified_tonal_scale.yaml axes.${key}.levels[${index}] requires numeric level, name, and description.`);
      }
      return { level, name, description };
    });

    normalizedAxes[key] = {
      key,
      title,
      abbreviation,
      framing,
      levels
    };
  }

  return {
    ...definition,
    axes: normalizedAxes
  };
}

function buildUnifiedTonalScalePrompt({ definition, selections }) {
  const normalizedDefinition = validateUnifiedTonalScaleDefinition(definition);
  const normalizedSelections = normalizeUnifiedTonalScaleSelections(selections);
  const selectedKeys = Object.keys(normalizedSelections);
  if (selectedKeys.length === 0) {
    return '';
  }

  const axes = Object.entries(normalizedDefinition.axes);
  const axisKeySet = new Set(axes.map(([key]) => key));
  const unknownKeys = selectedKeys.filter(key => !axisKeySet.has(key));
  if (unknownKeys.length) {
    throw new Error(`unifiedTonalScale contains unknown axis key(s): ${unknownKeys.join(', ')}.`);
  }

  const missingKeys = axes
    .map(([key, axis]) => ({ key, title: axis.title }))
    .filter(({ key }) => !normalizedSelections[key])
    .map(({ title }) => title);
  if (missingKeys.length) {
    throw new Error(`unifiedTonalScale must select every axis before prompt rendering; missing: ${missingKeys.join(', ')}.`);
  }

  const notationFormat = axes.map(([, axis]) => `${axis.abbreviation}#`).join('-');
  const notationDescription = axes.map(([, axis]) => axis.title).join('-');
  const storyNotationParts = [];
  const selectedRows = [];

  const lines = [
    '## Unified Tonal Scale',
    '',
    `**Notation: ${notationFormat}** (${notationDescription})`,
    ''
  ];

  for (const [, axis] of axes) {
    lines.push('---', '', `### ${axis.title} (${axis.framing})`, '', '| Level | Name | Description |', '|-------|------|-------------|');
    for (const level of axis.levels) {
      lines.push(`| ${formatLevelNumber(level.level)} | ${escapeMarkdownTableCell(level.name)} | ${escapeMarkdownTableCell(level.description)} |`);
    }
    lines.push('');
  }

  for (const [key, axis] of axes) {
    const selection = normalizedSelections[key];
    const selectedLevel = axis.levels.find(level => Number(level.level) === Number(selection.level));
    if (!selectedLevel) {
      throw new Error(`unifiedTonalScale.${key}.level "${selection.level}" is not defined in unified_tonal_scale.yaml.`);
    }

    storyNotationParts.push(`${axis.abbreviation}${formatLevelNumber(selection.level)}`);
    const meaningParts = [selectedLevel.description];
    if (selection.comment) {
      meaningParts.push(selection.comment);
    }
    selectedRows.push({
      axis: axis.title,
      level: `${formatLevelNumber(selection.level)} (${selectedLevel.name})`,
      meaning: meaningParts.join(' ')
    });
  }

  lines.push(`### THIS STORY: ${storyNotationParts.join('-')}`, '', '| Axis | Level | What It Means |', '|------|-------|---------------|');
  for (const row of selectedRows) {
    lines.push(`| **${escapeMarkdownTableCell(row.axis)}** | ${escapeMarkdownTableCell(row.level)} | ${escapeMarkdownTableCell(row.meaning)} |`);
  }
  lines.push('', 'If the story begins to stray from these tonal guidelines, adjust the narrative to realign with the intended mood and style.');

  return lines.join('\n');
}

function buildUnifiedTonalScalePromptForSetting(settingSnapshot, { baseDir } = {}) {
  const selections = normalizeUnifiedTonalScaleSelections(settingSnapshot?.unifiedTonalScale);
  if (!Object.keys(selections).length) {
    return '';
  }
  const definition = loadUnifiedTonalScaleDefinition({ baseDir });
  return buildUnifiedTonalScalePrompt({ definition, selections });
}

module.exports = {
  buildUnifiedTonalScalePrompt,
  buildUnifiedTonalScalePromptForSetting,
  loadUnifiedTonalScaleDefinition,
  normalizeUnifiedTonalScaleSelections,
  validateUnifiedTonalScaleDefinition
};
