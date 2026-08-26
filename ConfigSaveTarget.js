const path = require('path');

function resolveConfigSaveTarget(baseDir, {
    cliConfigOverridePath = null,
    sessionConfigOverridePath = null
} = {}) {
    if (typeof baseDir !== 'string' || !baseDir.trim()) {
        throw new TypeError('resolveConfigSaveTarget requires a non-empty baseDir.');
    }

    const selectedPath = sessionConfigOverridePath || cliConfigOverridePath;
    if (selectedPath !== null && selectedPath !== undefined) {
        if (typeof selectedPath !== 'string' || !selectedPath.trim()) {
            throw new TypeError('Config override save target must be a non-empty path.');
        }
        return path.isAbsolute(selectedPath)
            ? path.normalize(selectedPath)
            : path.resolve(baseDir, selectedPath);
    }

    return path.join(path.resolve(baseDir), 'config.yaml');
}

function formatConfigSaveTarget(baseDir, configPath) {
    if (typeof baseDir !== 'string' || !baseDir.trim()) {
        throw new TypeError('formatConfigSaveTarget requires a non-empty baseDir.');
    }
    if (typeof configPath !== 'string' || !configPath.trim()) {
        throw new TypeError('formatConfigSaveTarget requires a non-empty configPath.');
    }

    const resolvedBaseDir = path.resolve(baseDir);
    const resolvedConfigPath = path.resolve(configPath);
    const relativePath = path.relative(resolvedBaseDir, resolvedConfigPath);
    if (relativePath && !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath)) {
        return relativePath;
    }
    return resolvedConfigPath;
}

module.exports = {
    resolveConfigSaveTarget,
    formatConfigSaveTarget
};
