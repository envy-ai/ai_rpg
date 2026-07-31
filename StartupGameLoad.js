const fs = require('fs');
const path = require('path');

function resolveCliStartupGamePath(argv = process.argv, { cwd = process.cwd() } = {}) {
    if (!Array.isArray(argv)) {
        throw new Error('Command line arguments must be an array.');
    }
    if (typeof cwd !== 'string' || !cwd.trim()) {
        throw new Error('Startup game path resolution requires a non-empty working directory.');
    }

    const args = argv.slice(2);
    let resolvedPath = null;

    const setResolvedPath = (rawPath) => {
        if (resolvedPath !== null) {
            throw new Error('Command line option --load-game may only be provided once.');
        }
        if (typeof rawPath !== 'string' || !rawPath.trim()) {
            throw new Error('Command line option --load-game requires a non-empty save directory path.');
        }

        const trimmedPath = rawPath.trim();
        resolvedPath = path.isAbsolute(trimmedPath)
            ? path.normalize(trimmedPath)
            : path.resolve(cwd, trimmedPath);
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--load-game') {
            const value = args[index + 1];
            if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
                throw new Error('Command line option --load-game requires a save directory path argument.');
            }
            setResolvedPath(value);
            index += 1;
            continue;
        }

        if (typeof arg === 'string' && arg.startsWith('--load-game=')) {
            setResolvedPath(arg.slice('--load-game='.length));
        }
    }

    return resolvedPath;
}

function resolveStartupGameLoadTarget(saveDirectory, { fsImpl = fs } = {}) {
    if (typeof saveDirectory !== 'string' || !saveDirectory.trim()) {
        throw new Error('Startup game loading requires a non-empty save directory path.');
    }
    if (!fsImpl || typeof fsImpl.existsSync !== 'function' || typeof fsImpl.statSync !== 'function') {
        throw new Error('Startup game loading requires filesystem existsSync and statSync functions.');
    }

    const saveDir = path.resolve(saveDirectory.trim());
    if (!fsImpl.existsSync(saveDir)) {
        const error = new Error(`Startup game save directory does not exist: ${saveDir}`);
        error.code = 'STARTUP_SAVE_NOT_FOUND';
        throw error;
    }

    let stats;
    try {
        stats = fsImpl.statSync(saveDir);
    } catch (statError) {
        const error = new Error(`Failed to inspect startup game save directory ${saveDir}: ${statError.message}`);
        error.code = 'STARTUP_SAVE_STAT_FAILED';
        throw error;
    }
    if (!stats.isDirectory()) {
        const error = new Error(`Startup game path must point to a save directory: ${saveDir}`);
        error.code = 'STARTUP_SAVE_NOT_DIRECTORY';
        throw error;
    }

    const saveName = path.basename(saveDir);
    const saveRoot = path.dirname(saveDir);
    if (!saveName || saveDir === saveRoot) {
        const error = new Error(`Startup game path cannot be a filesystem root: ${saveDir}`);
        error.code = 'STARTUP_SAVE_INVALID_PATH';
        throw error;
    }

    return {
        saveDir,
        saveName,
        saveRoot
    };
}

async function loadStartupGameFromPath({
    saveDirectory,
    performGameLoad,
    logger = console
} = {}) {
    if (typeof performGameLoad !== 'function') {
        throw new Error('Startup game loading requires performGameLoad.');
    }
    if (!logger || typeof logger.log !== 'function') {
        throw new Error('Startup game loading requires a logger with a log function.');
    }

    const target = resolveStartupGameLoadTarget(saveDirectory);
    logger.log(`💾 Loading startup game from: ${target.saveDir}`);
    const result = await performGameLoad(target.saveName, {
        saveRoot: target.saveRoot
    });
    logger.log(`✅ Startup game loaded: ${result?.saveName || target.saveName}`);
    return {
        ...target,
        result
    };
}

module.exports = {
    loadStartupGameFromPath,
    resolveCliStartupGamePath,
    resolveStartupGameLoadTarget
};
