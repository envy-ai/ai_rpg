const { loadMergedDefinitionFile } = require('./DefinitionLoader.js');

function loadBannedTropes({ baseDir } = {}) {
    const { value } = loadMergedDefinitionFile({
        baseDir,
        filename: 'banned_tropes.yaml'
    });
    const rawBannedTropes = value?.banned_tropes;
    if (!Array.isArray(rawBannedTropes)) {
        throw new Error('banned_tropes.yaml banned_tropes must be an array.');
    }

    return rawBannedTropes.map((entry, index) => {
        if (typeof entry !== 'string') {
            throw new Error(`banned_tropes.yaml banned_tropes entry at index ${index} must be a string.`);
        }
        const trope = entry.trim();
        if (!trope) {
            throw new Error(`banned_tropes.yaml banned_tropes entry at index ${index} must not be empty.`);
        }
        return trope;
    });
}

module.exports = {
    loadBannedTropes
};
