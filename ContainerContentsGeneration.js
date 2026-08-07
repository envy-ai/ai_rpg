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
        throw new Error(`Generated container item "${name}" must have a positive integer count.`);
    }
    return { name, count };
}

function buildEntryMultiset(entries) {
    const multiset = new Map();
    for (const entry of entries) {
        const key = JSON.stringify([entry.name, entry.count]);
        multiset.set(key, (multiset.get(key) || 0) + 1);
    }
    return multiset;
}

function multisetsMatch(left, right) {
    if (left.size !== right.size) {
        return false;
    }
    for (const [key, count] of left) {
        if (right.get(key) !== count) {
            return false;
        }
    }
    return true;
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

    if (!multisetsMatch(
        buildEntryMultiset(normalizedExpected),
        buildEntryMultiset(normalizedGenerated)
    )) {
        throw new Error(
            `Generated contents for container "${containerName}" did not preserve the exact pending names and counts. `
            + `Expected ${JSON.stringify(normalizedExpected)}; received ${JSON.stringify(normalizedGenerated)}.`
        );
    }

    return normalizedGenerated;
}

module.exports = {
    validateGeneratedContainerContentsAgainstSeeds
};
