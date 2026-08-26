const SPECIAL_REGEX_REPLACE_SCOPES = new Set([
    'story',
    'memories',
    'npcs',
    'locations',
    'items'
]);

const NPC_REGEX_REPLACE_FIELDS = Object.freeze([
    'description',
    'shortDescription',
    'personalityType',
    'personalityTraits',
    'personalityNotes',
    'aiNotes',
    'resistances',
    'vulnerabilities'
]);

const LOCATION_REGEX_REPLACE_FIELDS = Object.freeze([
    'description',
    'shortDescription'
]);

const ITEM_REGEX_REPLACE_FIELDS = Object.freeze([
    'description',
    'shortDescription'
]);

function compileRegex(pattern, flags = 'g') {
    if (typeof pattern !== 'string' || !pattern.trim()) {
        throw new Error('Pattern is required.');
    }
    if (typeof flags !== 'string') {
        throw new Error('Regex flags must be a string.');
    }
    const normalizedFlags = flags.trim() || 'g';
    const validFlags = new Set(['g', 'i', 'm', 's', 'u', 'y']);
    const invalidFlags = [...normalizedFlags].filter(flag => !validFlags.has(flag));
    if (invalidFlags.length > 0) {
        throw new Error(
            `Invalid regex flags: ${invalidFlags.join(', ')}. Valid flags are: ${[...validFlags].join(', ')}`
        );
    }
    try {
        return new RegExp(pattern.trim(), normalizedFlags);
    } catch (error) {
        throw new Error(`Invalid regex pattern: ${error.message}`);
    }
}

function replaceTextValue(value, regex, replacement) {
    const replacementRegex = new RegExp(regex.source, regex.flags);
    const countRegex = new RegExp(regex.source, regex.flags);
    const updatedValue = value.replace(replacementRegex, replacement);
    if (updatedValue === value) {
        return { updatedValue: value, replacements: 0 };
    }
    return {
        updatedValue,
        replacements: (value.match(countRegex) || []).length
    };
}

function requireArray(value, label) {
    if (!Array.isArray(value)) {
        throw new Error(`${label} must be an array.`);
    }
    return value;
}

function resolveEntityId(entity) {
    return typeof entity?.id === 'string' && entity.id.trim() ? entity.id.trim() : null;
}

function applyRegexReplace({
    pattern,
    replacement,
    flags = 'g',
    scope = '',
    chatHistory = [],
    players = [],
    locations = [],
    things = []
} = {}) {
    if (replacement !== null && typeof replacement !== 'string') {
        throw new Error('Replacement must be a string or null.');
    }
    const regex = compileRegex(pattern, flags);
    const normalizedReplacement = replacement === null ? '' : replacement;
    const normalizedScope = typeof scope === 'string' ? scope.trim() : '';
    if (scope !== null && scope !== undefined && typeof scope !== 'string') {
        throw new Error('Scope must be a string.');
    }

    requireArray(chatHistory, 'chatHistory');
    requireArray(players, 'players');
    requireArray(locations, 'locations');
    requireArray(things, 'things');

    const includeAllScopes = !normalizedScope;
    const includeStory = includeAllScopes
        || normalizedScope === 'story'
        || !SPECIAL_REGEX_REPLACE_SCOPES.has(normalizedScope);
    const includeMemories = includeAllScopes || normalizedScope === 'memories';
    const includeNpcs = includeAllScopes || normalizedScope === 'npcs';
    const includeLocations = includeAllScopes || normalizedScope === 'locations';
    const includeItems = includeAllScopes || normalizedScope === 'items';

    const pendingMutations = [];
    const modifiedChatEntryIds = [];
    const modifiedMemoryOwnerIds = new Set();
    const modifiedNpcIds = new Set();
    const modifiedLocationIds = new Set();
    const modifiedItemIds = new Set();
    let eligibleTextValues = 0;
    let totalReplacements = 0;
    let modifiedChatEntries = 0;
    let modifiedMemories = 0;
    let modifiedNpcFields = 0;
    let modifiedLocationFields = 0;
    let modifiedItemFields = 0;

    const queueStringMutation = ({ value, apply, category, ownerId = null, field = null }) => {
        if (typeof value !== 'string') {
            return null;
        }
        eligibleTextValues += 1;
        const result = replaceTextValue(value, regex, normalizedReplacement);
        if (result.replacements === 0) {
            return null;
        }
        totalReplacements += result.replacements;
        pendingMutations.push(() => apply(result.updatedValue));
        if (category === 'npc') {
            modifiedNpcFields += 1;
            if (ownerId) modifiedNpcIds.add(ownerId);
        } else if (category === 'location') {
            modifiedLocationFields += 1;
            if (ownerId) modifiedLocationIds.add(ownerId);
        } else if (category === 'item') {
            if (field === 'description' && !result.updatedValue.trim()) {
                throw new Error(`Regex replacement would erase the required description for item ${ownerId || '(unknown id)'}.`);
            }
            modifiedItemFields += 1;
            if (ownerId) modifiedItemIds.add(ownerId);
        }
        return result;
    };

    if (includeStory) {
        for (const entry of chatHistory) {
            if (!entry || typeof entry.content !== 'string') {
                continue;
            }
            if (
                normalizedScope
                && normalizedScope !== 'story'
                && entry.type !== normalizedScope
            ) {
                continue;
            }
            const result = queueStringMutation({
                value: entry.content,
                apply: updatedValue => {
                    entry.content = updatedValue;
                    entry.lastEditedAt = new Date().toISOString();
                },
                category: 'chat'
            });
            if (result) {
                modifiedChatEntries += 1;
                if (entry.id) modifiedChatEntryIds.push(entry.id);
            }
        }
    }

    if (includeMemories) {
        for (const player of players) {
            const memories = player?.importantMemories;
            if (!Array.isArray(memories)) {
                continue;
            }
            const updatedMemories = memories.slice();
            let ownerChanged = false;
            for (let index = 0; index < memories.length; index += 1) {
                if (typeof memories[index] !== 'string') {
                    continue;
                }
                eligibleTextValues += 1;
                const result = replaceTextValue(memories[index], regex, normalizedReplacement);
                if (result.replacements === 0) {
                    continue;
                }
                updatedMemories[index] = result.updatedValue;
                totalReplacements += result.replacements;
                modifiedMemories += 1;
                ownerChanged = true;
            }
            if (ownerChanged) {
                const ownerId = resolveEntityId(player);
                if (ownerId) modifiedMemoryOwnerIds.add(ownerId);
                pendingMutations.push(() => {
                    player.importantMemories = updatedMemories;
                });
            }
        }
    }

    if (includeNpcs) {
        for (const player of players) {
            if (!player || player.isNPC !== true) {
                continue;
            }
            const ownerId = resolveEntityId(player);
            for (const field of NPC_REGEX_REPLACE_FIELDS) {
                queueStringMutation({
                    value: player[field],
                    apply: updatedValue => {
                        player[field] = updatedValue;
                    },
                    category: 'npc',
                    ownerId,
                    field
                });
            }
        }
    }

    if (includeLocations) {
        for (const location of locations) {
            if (!location) {
                continue;
            }
            const ownerId = resolveEntityId(location);
            for (const field of LOCATION_REGEX_REPLACE_FIELDS) {
                queueStringMutation({
                    value: location[field],
                    apply: updatedValue => {
                        location[field] = updatedValue;
                    },
                    category: 'location',
                    ownerId,
                    field
                });
            }
        }
    }

    if (includeItems) {
        for (const thing of things) {
            if (!thing) {
                continue;
            }
            const ownerId = resolveEntityId(thing);
            for (const field of ITEM_REGEX_REPLACE_FIELDS) {
                queueStringMutation({
                    value: thing[field],
                    apply: updatedValue => {
                        thing[field] = updatedValue;
                    },
                    category: 'item',
                    ownerId,
                    field
                });
            }
        }
    }

    for (const applyMutation of pendingMutations) {
        applyMutation();
    }

    return {
        scope: normalizedScope || null,
        totalReplacements,
        eligibleTextValues,
        modifiedTextValues: modifiedChatEntries
            + modifiedMemories
            + modifiedNpcFields
            + modifiedLocationFields
            + modifiedItemFields,
        modifiedChatEntries,
        modifiedChatEntryIds,
        modifiedMemories,
        modifiedMemoryOwners: modifiedMemoryOwnerIds.size,
        modifiedMemoryOwnerIds: [...modifiedMemoryOwnerIds],
        modifiedNpcFields,
        modifiedNpcs: modifiedNpcIds.size,
        modifiedNpcIds: [...modifiedNpcIds],
        modifiedLocationFields,
        modifiedLocations: modifiedLocationIds.size,
        modifiedLocationIds: [...modifiedLocationIds],
        modifiedItemFields,
        modifiedItems: modifiedItemIds.size,
        modifiedItemIds: [...modifiedItemIds]
    };
}

module.exports = {
    ITEM_REGEX_REPLACE_FIELDS,
    LOCATION_REGEX_REPLACE_FIELDS,
    NPC_REGEX_REPLACE_FIELDS,
    SPECIAL_REGEX_REPLACE_SCOPES,
    applyRegexReplace,
    compileRegex
};
