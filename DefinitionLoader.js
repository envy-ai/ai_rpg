const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { getEnabledModManifests } = require('./ModDiscovery.js');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function getOverlayModDirectories(baseDir) {
  if (typeof baseDir !== 'string' || !baseDir.trim()) {
    throw new Error('DefinitionLoader requires a non-empty baseDir.');
  }

  return getEnabledModManifests(baseDir)
    .filter(manifest => manifest.hasDefsDir)
    .map(manifest => manifest.name)
    .sort((a, b) => a.localeCompare(b));
}

function mergeDefinitionValue(baseValue, overlayValue, contextLabel) {
  if (baseValue === undefined) {
    return cloneValue(overlayValue);
  }
  if (overlayValue === undefined) {
    return cloneValue(baseValue);
  }

  if (Array.isArray(baseValue)) {
    if (!Array.isArray(overlayValue)) {
      throw new Error(`${contextLabel} must remain an array when merging onto an array definition.`);
    }
    return [
      ...cloneValue(baseValue),
      ...cloneValue(overlayValue)
    ];
  }

  if (isPlainObject(baseValue)) {
    if (!isPlainObject(overlayValue)) {
      throw new Error(`${contextLabel} must remain an object when merging onto an object definition.`);
    }

    const merged = cloneValue(baseValue);
    for (const [key, value] of Object.entries(overlayValue)) {
      const childContext = `${contextLabel}.${key}`;
      merged[key] = Object.prototype.hasOwnProperty.call(merged, key)
        ? mergeDefinitionValue(merged[key], value, childContext)
        : cloneValue(value);
    }
    return merged;
  }

  if (Array.isArray(overlayValue) || isPlainObject(overlayValue)) {
    throw new Error(`${contextLabel} cannot replace a scalar definition with a ${Array.isArray(overlayValue) ? 'list' : 'map'}.`);
  }

  return cloneValue(overlayValue);
}

function readYamlFile(filePath, { label = filePath } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }

  try {
    return yaml.load(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${error.message}`);
  }
}

function listKnownDefinitionFiles(baseDir) {
  if (typeof baseDir !== 'string' || !baseDir.trim()) {
    throw new Error('DefinitionLoader requires a non-empty baseDir.');
  }

  const defsDir = path.join(baseDir, 'defs');
  if (!fs.existsSync(defsDir)) {
    return [];
  }

  return fs.readdirSync(defsDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => name.endsWith('.yaml'))
    .sort((a, b) => a.localeCompare(b));
}

function loadMergedDefinitionFile({ baseDir, filename, allowMissing = false } = {}) {
  if (typeof baseDir !== 'string' || !baseDir.trim()) {
    throw new Error('loadMergedDefinitionFile requires a non-empty baseDir.');
  }
  if (typeof filename !== 'string' || !filename.trim()) {
    throw new Error('loadMergedDefinitionFile requires a non-empty filename.');
  }

  const trimmedFilename = filename.trim();
  const defsDir = path.join(baseDir, 'defs');
  const basePath = path.join(defsDir, trimmedFilename);
  const overlayModNames = getOverlayModDirectories(baseDir);
  const sources = [];
  let mergedValue = undefined;

  if (fs.existsSync(basePath)) {
    mergedValue = readYamlFile(basePath, { label: `defs/${trimmedFilename}` });
    sources.push({
      type: 'base',
      path: basePath,
      label: `defs/${trimmedFilename}`
    });
  }

  for (const modName of overlayModNames) {
    const overlayPath = path.join(baseDir, 'mods', modName, 'defs', trimmedFilename);
    if (!fs.existsSync(overlayPath)) {
      continue;
    }

    const overlayValue = readYamlFile(overlayPath, { label: `mods/${modName}/defs/${trimmedFilename}` });
    mergedValue = mergedValue === undefined
      ? cloneValue(overlayValue)
      : mergeDefinitionValue(mergedValue, overlayValue, `mods/${modName}/defs/${trimmedFilename}`);
    sources.push({
      type: 'mod',
      modName,
      path: overlayPath,
      label: `mods/${modName}/defs/${trimmedFilename}`
    });
  }

  if (mergedValue === undefined) {
    if (allowMissing) {
      return {
        value: undefined,
        sources: []
      };
    }
    throw new Error(`Definition file "${trimmedFilename}" does not exist under defs/ and has no mod overlays.`);
  }

  return {
    value: mergedValue,
    sources
  };
}

function validateDefinitionOverlays({ baseDir } = {}) {
  if (typeof baseDir !== 'string' || !baseDir.trim()) {
    throw new Error('validateDefinitionOverlays requires a non-empty baseDir.');
  }

  const knownDefinitionFiles = new Set(listKnownDefinitionFiles(baseDir));
  const validatedFiles = new Set();

  for (const modName of getOverlayModDirectories(baseDir)) {
    const defsDir = path.join(baseDir, 'mods', modName, 'defs');
    if (!fs.existsSync(defsDir)) {
      continue;
    }

    const entries = fs.readdirSync(defsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.yaml')) {
        continue;
      }
      if (!knownDefinitionFiles.has(entry.name)) {
        throw new Error(`Mod "${modName}" defines unknown defs overlay "${entry.name}".`);
      }
      validatedFiles.add(entry.name);
    }
  }

  for (const filename of validatedFiles) {
    loadMergedDefinitionFile({ baseDir, filename });
  }

  return {
    knownDefinitionFiles: Array.from(knownDefinitionFiles).sort((a, b) => a.localeCompare(b)),
    validatedFiles: Array.from(validatedFiles).sort((a, b) => a.localeCompare(b))
  };
}

module.exports = {
  cloneValue,
  getOverlayModDirectories,
  listKnownDefinitionFiles,
  loadMergedDefinitionFile,
  mergeDefinitionValue,
  validateDefinitionOverlays
};
