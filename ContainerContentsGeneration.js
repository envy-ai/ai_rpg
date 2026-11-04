'use strict';

function normalizeExpectedEntry(entry, index) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Container content seed ${index + 1} must be an object.`);
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) {
        throw new Error(`Container content seed ${index + 1} must have a non-empty name.`);
    }
    const count = entry.count === null || entry.count === undefined || entry.count === ''
        ? 1
        : Number(entry.count);
    if (!Number.isInteger(count) || count <= 0) {
        throw new Error(`Container content seed "${name}" must have a positive integer count.`);
    }
    return { name, count };
}

function normalizeGeneratedEntry(entry, index) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Generated container item ${index + 1} must be an object.`);
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) {
        throw new Error(`Generated container item ${index + 1} must have a non-empty name.`);
    }
    const count = Number(entry.count);
    if (!Number.isInteger(count) || count <= 0) {
        throw new Error(`Generated container item "${name}" <count> must be a positive integer. Supply one or more items in this entry, or remove an unneeded extra entry.`);
    }
    return { name, count };
}

function sumCountsByName(entries) {
    const counts = new Map();
    for (const entry of entries) {
        counts.set(entry.name, (counts.get(entry.name) || 0) + entry.count);
    }
    return counts;
}

function validateGeneratedContainerContentsAgainstSeeds(
    generatedItems,
    expectedSeeds,
    { containerName = 'container' } = {}
) {
    if (!Array.isArray(generatedItems)) {
        throw new Error('Generated container contents must be an array.');
    }
    if (!Array.isArray(expectedSeeds)) {
        throw new Error('Expected container content seeds must be an array.');
    }

    const normalizedExpected = expectedSeeds.map(normalizeExpectedEntry);
    const normalizedGenerated = generatedItems.map(normalizeGeneratedEntry);
    if (!normalizedExpected.length) {
        throw new Error(`Container "${containerName}" has no pending content seeds to validate.`);
    }

    const generatedCounts = sumCountsByName(normalizedGenerated);
    for (const [name, minimumCount] of sumCountsByName(normalizedExpected)) {
        const generatedCount = generatedCounts.get(name) || 0;
        if (generatedCount < minimumCount) {
            throw new Error(
                `Generated contents for container "${containerName}" have insufficient <count> for <name> "${name}": `
                + `expected at least ${minimumCount}, received ${generatedCount}. `
                + `Keep this exact name and supply its requested minimum total count across the <item> entries. `
                + 'Additional item names and surplus counts are allowed inside this container.'
            );
        }
    }

    return normalizedGenerated;
}

module.exports = {
    validateGeneratedContainerContentsAgainstSeeds
};
