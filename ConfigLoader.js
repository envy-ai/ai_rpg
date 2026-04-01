const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function mergeDeep(target, source) {
    if (!source || typeof source !== 'object') {
        return target;
    }
    const output = { ...target };
    for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            output[key] = mergeDeep(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
        } else {
            output[key] = value;
        }
    }
    return output;
}

function readYamlObject(filePath, label, { allowMissing = false } = {}) {
    if (!fs.existsSync(filePath)) {
        if (allowMissing) {
            return {};
        }
        throw new Error(`${label} not found: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml.load(raw);
    if (parsed === undefined || parsed === null) {
        return {};
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${label} must contain a YAML object: ${filePath}`);
    }
    return parsed;
}

function loadMergedConfig(baseDir, configOverridePath = null, { allowMissing = false } = {}) {
    if (typeof baseDir !== 'string' || !baseDir.trim()) {
        throw new Error('loadMergedConfig requires a non-empty baseDir.');
    }

    const defaultConfigPath = path.join(baseDir, 'config.default.yaml');
    const defaultConfig = readYamlObject(defaultConfigPath, 'Default config', { allowMissing });

    const configPath = path.join(baseDir, 'config.yaml');
    const overrideConfig = readYamlObject(configPath, 'Runtime config', { allowMissing });

    let mergedConfig = mergeDeep(defaultConfig, overrideConfig);

    if (configOverridePath) {
        if (!fs.existsSync(configOverridePath)) {
            throw new Error(`Config override file not found: ${configOverridePath}`);
        }

        const parsedOverride = readYamlObject(configOverridePath, 'Config override file');
        mergedConfig = mergeDeep(mergedConfig, parsedOverride);
    }

    return mergedConfig;
}

module.exports = {
    loadMergedConfig,
    mergeDeep
};
