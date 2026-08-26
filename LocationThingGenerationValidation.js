function requireNonNegativeInteger(value, label) {
    if (!Number.isInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative integer.`);
    }
    return value;
}

function normalizeRarity(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must have a non-empty rarity.`);
    }
    return value.trim().toLowerCase();
}

function normalizeExpectedRarityCounts(rawCounts, label) {
    if (!rawCounts || typeof rawCounts !== 'object' || Array.isArray(rawCounts)) {
        throw new TypeError(`${label} rarity counts must be an object.`);
    }
    const counts = new Map();
    for (const [rawRarity, rawCount] of Object.entries(rawCounts)) {
        const rarity = normalizeRarity(rawRarity, `${label} rarity key`);
        const count = requireNonNegativeInteger(rawCount, `${label} rarity count for "${rawRarity}"`);
        if (count > 0) {
            counts.set(rarity, count);
        }
    }
    return counts;
}

function sumCounts(counts) {
    return Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
}

function formatCounts(counts) {
    if (!counts.size) {
        return '(none)';
    }
    return Array.from(counts.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([rarity, count]) => `${rarity} x ${count}`)
        .join(', ');
}

function assertMinimumRarityCounts(actual, expected, label) {
    const missingRequiredRarity = Array.from(expected.entries()).find(([rarity, count]) => (
        (actual.get(rarity) || 0) < count
    ));
    if (missingRequiredRarity) {
        throw new Error(
            `Location things generation ${label} rarity minimum not met: `
            + `requires at least ${formatCounts(expected)}; received ${formatCounts(actual)}.`
        );
    }
}

function validateGeneratedLocationThingBatch(parsedItems, {
    itemCount,
    sceneryCount,
    rarityList
} = {}) {
    if (!Array.isArray(parsedItems)) {
        throw new TypeError('Location things generation parsed batch must be an array.');
    }
    const expectedItemCount = requireNonNegativeInteger(itemCount, 'Location item count');
    const expectedSceneryCount = requireNonNegativeInteger(sceneryCount, 'Location scenery count');
    if (!rarityList || typeof rarityList !== 'object' || Array.isArray(rarityList)) {
        throw new TypeError('Location things generation rarityList must be an object.');
    }

    const expectedRarities = {
        item: normalizeExpectedRarityCounts(rarityList.items || {}, 'Location item'),
        scenery: normalizeExpectedRarityCounts(rarityList.scenery || {}, 'Location scenery')
    };
    if (sumCounts(expectedRarities.item) !== expectedItemCount) {
        throw new Error(
            `Location item rarity counts total ${sumCounts(expectedRarities.item)}, `
            + `but itemCount is ${expectedItemCount}.`
        );
    }
    if (sumCounts(expectedRarities.scenery) !== expectedSceneryCount) {
        throw new Error(
            `Location scenery rarity counts total ${sumCounts(expectedRarities.scenery)}, `
            + `but sceneryCount is ${expectedSceneryCount}.`
        );
    }

    const actualItems = { item: [], scenery: [] };
    for (const [index, entry] of parsedItems.entries()) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new TypeError(`Location things generation entry ${index + 1} must be an object.`);
        }
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        if (!name) {
            throw new Error(`Location things generation entry ${index + 1} must have a non-empty name.`);
        }
        const description = typeof entry.description === 'string' ? entry.description.trim() : '';
        if (!description) {
            throw new Error(`Location thing "${name}" must have a non-empty description.`);
        }
        const kind = typeof entry.itemOrScenery === 'string'
            ? entry.itemOrScenery.trim().toLowerCase()
            : (typeof entry.thingType === 'string' ? entry.thingType.trim().toLowerCase() : '');
        if (kind !== 'item' && kind !== 'scenery') {
            throw new Error(
                `Location things generation entry ${index + 1} has invalid item/scenery kind "${kind || '(blank)'}".`
            );
        }
        actualItems[kind].push(entry);
    }

    if (actualItems.item.length < expectedItemCount) {
        throw new Error(
            `Location things generation expected at least ${expectedItemCount} item entries, `
            + `but received ${actualItems.item.length}.`
        );
    }
    if (actualItems.scenery.length < expectedSceneryCount) {
        throw new Error(
            `Location things generation expected at least ${expectedSceneryCount} scenery entries, `
            + `but received ${actualItems.scenery.length}.`
        );
    }

    for (const kind of ['item', 'scenery']) {
        const actualRarities = new Map();
        for (const entry of actualItems[kind]) {
            const rarity = normalizeRarity(
                entry.rarity,
                `Location ${kind} "${entry.name || 'unnamed'}"`
            );
            actualRarities.set(rarity, (actualRarities.get(rarity) || 0) + 1);
        }
        assertMinimumRarityCounts(actualRarities, expectedRarities[kind], kind);
    }

    return parsedItems;
}

module.exports = {
    validateGeneratedLocationThingBatch
};
