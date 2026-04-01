const fs = require('fs');
const path = require('path');
const { loadMergedConfig } = require('./ConfigLoader.js');

const IGNORED_MOD_DIRECTORY_NAMES = new Set(['node_modules']);
const frozenEnabledModManifestsByBaseDir = new Map();

function cloneValue(value) {
    if (value === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value));
}

function assertBaseDir(baseDir, functionName) {
    if (typeof baseDir !== 'string' || !baseDir.trim()) {
        throw new Error(`${functionName} requires a non-empty baseDir.`);
    }
}

function isValidModDirectoryEntry(entry, modsDir) {
    if (!entry?.isDirectory?.()) {
        return false;
    }
    if (entry.name.startsWith('.') || IGNORED_MOD_DIRECTORY_NAMES.has(entry.name)) {
        return false;
    }

    const modDir = path.join(modsDir, entry.name);
    const modJsPath = path.join(modDir, 'mod.js');
    const defsDir = path.join(modDir, 'defs');
    const hasDefsDir = fs.existsSync(defsDir) && fs.statSync(defsDir).isDirectory();
    return fs.existsSync(modJsPath) || hasDefsDir;
}

function readModConfigFile(modDir, modName) {
    const configPath = path.join(modDir, 'config.json');
    if (!fs.existsSync(configPath)) {
        return {
            configPath,
            config: {}
        };
    }

    let raw;
    try {
        raw = fs.readFileSync(configPath, 'utf8');
    } catch (error) {
        throw new Error(`Failed to read mods/${modName}/config.json: ${error.message}`);
    }

    let config;
    try {
        config = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Failed to parse mods/${modName}/config.json: ${error.message}`);
    }

    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error(`mods/${modName}/config.json must contain a JSON object.`);
    }

    if (Object.prototype.hasOwnProperty.call(config, 'enabled') && typeof config.enabled !== 'boolean') {
        throw new Error(`mods/${modName}/config.json field "enabled" must be a boolean when provided.`);
    }

    return {
        configPath,
        config
    };
}

function resolveConfigEnabledFlag(baseDir, modName, runtimeConfig) {
    const sourceConfig = runtimeConfig ?? loadMergedConfig(baseDir, null, { allowMissing: true });
    if (sourceConfig === undefined || sourceConfig === null) {
        return undefined;
    }
    if (typeof sourceConfig !== 'object' || Array.isArray(sourceConfig)) {
        throw new Error('Merged config must be an object when resolving mod enablement.');
    }

    const modsConfig = sourceConfig.mods;
    if (modsConfig === undefined) {
        return undefined;
    }
    if (!modsConfig || typeof modsConfig !== 'object' || Array.isArray(modsConfig)) {
        throw new Error('Config field "mods" must be an object when provided.');
    }

    const modConfig = modsConfig[modName];
    if (modConfig === undefined) {
        return undefined;
    }
    if (!modConfig || typeof modConfig !== 'object' || Array.isArray(modConfig)) {
        throw new Error(`Config field "mods.${modName}" must be an object when provided.`);
    }
    if (!Object.prototype.hasOwnProperty.call(modConfig, 'enabled')) {
        return undefined;
    }
    if (typeof modConfig.enabled !== 'boolean') {
        throw new Error(`Config field "mods.${modName}.enabled" must be a boolean when provided.`);
    }
    return modConfig.enabled;
}

function discoverModManifests(baseDir, { config = undefined } = {}) {
    assertBaseDir(baseDir, 'discoverModManifests');

    const modsDir = path.join(baseDir, 'mods');
    if (!fs.existsSync(modsDir)) {
        return [];
    }

    const manifests = [];
    const entries = fs.readdirSync(modsDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!isValidModDirectoryEntry(entry, modsDir)) {
            continue;
        }

        const modDir = path.join(modsDir, entry.name);
        const modJsPath = path.join(modDir, 'mod.js');
        const defsDir = path.join(modDir, 'defs');
        const hasDefsDir = fs.existsSync(defsDir) && fs.statSync(defsDir).isDirectory();
        const { configPath, config: fileConfig } = readModConfigFile(modDir, entry.name);
        const enabledFromGlobalConfig = resolveConfigEnabledFlag(baseDir, entry.name, config);

        manifests.push({
            name: entry.name,
            dir: modDir,
            configPath,
            config: fileConfig,
            enabled: enabledFromGlobalConfig ?? (fileConfig.enabled !== false),
            hasModJs: fs.existsSync(modJsPath),
            hasDefsDir
        });
    }

    manifests.sort((a, b) => a.name.localeCompare(b.name));
    return manifests;
}

function getEnabledModManifests(baseDir, { useFrozen = true, config = undefined } = {}) {
    assertBaseDir(baseDir, 'getEnabledModManifests');

    if (useFrozen && frozenEnabledModManifestsByBaseDir.has(baseDir)) {
        return cloneValue(frozenEnabledModManifestsByBaseDir.get(baseDir));
    }

    return discoverModManifests(baseDir, { config })
        .filter(manifest => manifest.enabled)
        .map(cloneValue);
}

function freezeEnabledModManifests(baseDir, { config = undefined } = {}) {
    assertBaseDir(baseDir, 'freezeEnabledModManifests');

    if (!frozenEnabledModManifestsByBaseDir.has(baseDir)) {
        frozenEnabledModManifestsByBaseDir.set(baseDir, getEnabledModManifests(baseDir, { useFrozen: false, config }));
    }

    return cloneValue(frozenEnabledModManifestsByBaseDir.get(baseDir));
}

function clearFrozenEnabledModManifests(baseDir = null) {
    if (baseDir === null || baseDir === undefined) {
        frozenEnabledModManifestsByBaseDir.clear();
        return;
    }

    assertBaseDir(baseDir, 'clearFrozenEnabledModManifests');
    frozenEnabledModManifestsByBaseDir.delete(baseDir);
}

function diffFrozenEnabledModDirectoryNames(baseDir, { config = undefined } = {}) {
    assertBaseDir(baseDir, 'diffFrozenEnabledModDirectoryNames');

    if (!frozenEnabledModManifestsByBaseDir.has(baseDir)) {
        return {
            current: getEnabledModDirectoryNames(baseDir, { useFrozen: false, config }),
            frozen: [],
            added: [],
            removed: [],
            changed: false
        };
    }

    const frozen = freezeEnabledModManifests(baseDir).map(manifest => manifest.name);
    const current = getEnabledModDirectoryNames(baseDir, { useFrozen: false, config });
    const frozenSet = new Set(frozen);
    const currentSet = new Set(current);

    const added = current.filter(name => !frozenSet.has(name));
    const removed = frozen.filter(name => !currentSet.has(name));

    return {
        current,
        frozen,
        added,
        removed,
        changed: added.length > 0 || removed.length > 0
    };
}

function getEnabledModDirectoryNames(baseDir, options) {
    return getEnabledModManifests(baseDir, options).map(manifest => manifest.name);
}

module.exports = {
    clearFrozenEnabledModManifests,
    discoverModManifests,
    diffFrozenEnabledModDirectoryNames,
    freezeEnabledModManifests,
    getEnabledModDirectoryNames,
    getEnabledModManifests
};
