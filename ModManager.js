const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const {
    discoverModManifests,
    getEnabledModDirectoryNames
} = require('./ModDiscovery.js');

const PENDING_LOAD_FILENAME = 'pending-load.json';

function normalizeEnabledModNames(value, fieldName = 'enabled mods') {
    if (!Array.isArray(value)) {
        throw new Error(`${fieldName} must be an array of mod names.`);
    }
    const names = value
        .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

function diffEnabledMods({ activeEnabledMods = [], savedEnabledMods = [] } = {}) {
    const active = normalizeEnabledModNames(activeEnabledMods, 'active enabled mods');
    const saved = normalizeEnabledModNames(savedEnabledMods, 'saved enabled mods');
    const activeSet = new Set(active);
    const savedSet = new Set(saved);
    const missingFromActive = saved.filter(name => !activeSet.has(name));
    const extraActive = active.filter(name => !savedSet.has(name));

    return {
        hasMismatch: missingFromActive.length > 0 || extraActive.length > 0,
        activeEnabledMods: active,
        savedEnabledMods: saved,
        missingFromActive,
        extraActive
    };
}

function readRootConfigYaml(baseDir) {
    if (typeof baseDir !== 'string' || !baseDir.trim()) {
        throw new Error('readRootConfigYaml requires a non-empty baseDir.');
    }
    const configPath = path.join(baseDir, 'config.yaml');
    if (!fs.existsSync(configPath)) {
        return {};
    }
    const parsed = yaml.load(fs.readFileSync(configPath, 'utf8'));
    if (parsed === undefined || parsed === null) {
        return {};
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('config.yaml must contain a YAML object.');
    }
    return parsed;
}

function writeRootConfigYaml(baseDir, config) {
    if (typeof baseDir !== 'string' || !baseDir.trim()) {
        throw new Error('writeRootConfigYaml requires a non-empty baseDir.');
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('writeRootConfigYaml requires a config object.');
    }
    fs.writeFileSync(
        path.join(baseDir, 'config.yaml'),
        yaml.dump(config, {
            defaultFlowStyle: false,
            quotingType: '"',
            forceQuotes: false
        }),
        'utf8'
    );
}

function buildModManagerState(baseDir, { runtimeConfig = undefined, activeEnabledMods = null } = {}) {
    if (typeof baseDir !== 'string' || !baseDir.trim()) {
        throw new Error('buildModManagerState requires a non-empty baseDir.');
    }

    const manifests = discoverModManifests(baseDir, { config: runtimeConfig });
    const activeNames = activeEnabledMods === null
        ? getEnabledModDirectoryNames(baseDir)
        : normalizeEnabledModNames(activeEnabledMods, 'active enabled mods');
    const activeSet = new Set(activeNames);

    const mods = manifests.map(manifest => ({
        name: manifest.name,
        dir: manifest.dir,
        hasModJs: Boolean(manifest.hasModJs),
        hasDefsDir: Boolean(manifest.hasDefsDir),
        configPath: manifest.configPath,
        configuredEnabled: Boolean(manifest.enabled),
        activeEnabled: activeSet.has(manifest.name),
        restartRequired: Boolean(manifest.enabled) !== activeSet.has(manifest.name),
        fileConfigEnabled: Object.prototype.hasOwnProperty.call(manifest.config || {}, 'enabled')
            ? manifest.config.enabled
            : null
    }));

    return {
        mods,
        activeEnabledMods: normalizeEnabledModNames(activeNames, 'active enabled mods'),
        configuredEnabledMods: mods
            .filter(mod => mod.configuredEnabled)
            .map(mod => mod.name)
            .sort((a, b) => a.localeCompare(b)),
        restartRequired: mods.some(mod => mod.restartRequired)
    };
}

function updateConfigYamlModEnablement(baseDir, enabledMods) {
    const enabledNames = normalizeEnabledModNames(enabledMods, 'enabled mods');
    const enabledSet = new Set(enabledNames);
    const config = readRootConfigYaml(baseDir);
    const manifests = discoverModManifests(baseDir, { config });
    const validModNames = manifests.map(manifest => manifest.name);
    const validSet = new Set(validModNames);
    const unknown = enabledNames.filter(name => !validSet.has(name));
    if (unknown.length) {
        throw new Error(`Cannot enable unknown mod(s): ${unknown.join(', ')}`);
    }

    const nextMods = config.mods && typeof config.mods === 'object' && !Array.isArray(config.mods)
        ? { ...config.mods }
        : {};
    for (const modName of validModNames) {
        const existing = nextMods[modName] && typeof nextMods[modName] === 'object' && !Array.isArray(nextMods[modName])
            ? { ...nextMods[modName] }
            : {};
        existing.enabled = enabledSet.has(modName);
        nextMods[modName] = existing;
    }
    config.mods = nextMods;
    writeRootConfigYaml(baseDir, config);

    return {
        enabledMods: enabledNames,
        allMods: validModNames.sort((a, b) => a.localeCompare(b)),
        configPath: path.join(baseDir, 'config.yaml')
    };
}

function getPendingLoadPath(baseDir) {
    if (typeof baseDir !== 'string' || !baseDir.trim()) {
        throw new Error('getPendingLoadPath requires a non-empty baseDir.');
    }
    return path.join(baseDir, 'tmp', PENDING_LOAD_FILENAME);
}

function writePendingLoadIntent(baseDir, intent = {}) {
    const saveName = typeof intent.saveName === 'string' ? intent.saveName.trim() : '';
    if (!saveName) {
        throw new Error('Pending load intent requires saveName.');
    }
    const saveType = intent.saveType === 'autosaves' ? 'autosaves' : 'saves';
    const reason = typeof intent.reason === 'string' && intent.reason.trim()
        ? intent.reason.trim()
        : 'pending-load';
    const normalized = {
        saveName,
        saveType,
        reason,
        createdAt: new Date().toISOString()
    };

    const pendingPath = getPendingLoadPath(baseDir);
    fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
    fs.writeFileSync(pendingPath, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
}

function readPendingLoadIntent(baseDir) {
    const pendingPath = getPendingLoadPath(baseDir);
    if (!fs.existsSync(pendingPath)) {
        return null;
    }
    const parsed = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Pending load intent must contain a JSON object.');
    }
    const saveName = typeof parsed.saveName === 'string' ? parsed.saveName.trim() : '';
    if (!saveName) {
        throw new Error('Pending load intent is missing saveName.');
    }
    return {
        saveName,
        saveType: parsed.saveType === 'autosaves' ? 'autosaves' : 'saves',
        reason: typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : 'pending-load',
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : ''
    };
}

function clearPendingLoadIntent(baseDir) {
    const pendingPath = getPendingLoadPath(baseDir);
    if (fs.existsSync(pendingPath)) {
        fs.unlinkSync(pendingPath);
        return true;
    }
    return false;
}

module.exports = {
    buildModManagerState,
    clearPendingLoadIntent,
    diffEnabledMods,
    getPendingLoadPath,
    normalizeEnabledModNames,
    readPendingLoadIntent,
    updateConfigYamlModEnablement,
    writePendingLoadIntent
};
