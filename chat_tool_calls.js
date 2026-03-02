const path = require('path');
const nunjucks = require('nunjucks');

const CHAT_TOOL_MAX_ROUNDS = 8;
const MORE_INFO_MAX_MATCHES = 50;
const CHAT_TOOL_DEFINITIONS = Object.freeze([
    {
        type: 'function',
        function: {
            name: 'moreInfo',
            description: 'Return full XML for NPCs, things, locations, and regions whose names contain the given query substring.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Case-insensitive substring to match against entity names. Example: "Bob".'
                    },
                    type: {
                        type: 'string',
                        enum: ['character', 'thing', 'location', 'region'],
                        description: 'Optional info category filter. Omit to search all categories.'
                    }
                },
                required: ['name'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getHistory',
            description: 'Return all prose chat entries whose content contains every provided case-insensitive query substring.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'array',
                        items: { type: 'string' },
                        minItems: 1,
                        description: 'All case-insensitive substrings that must match the same prose history entry. Example: ["Rodrigo", "bridge"].'
                    },
                    startIndex: {
                        type: 'integer',
                        minimum: 1,
                        description: 'Optional 1-based index into the matched result list. Omit to start at 1.'
                    },
                    count: {
                        type: 'integer',
                        minimum: 1,
                        description: 'Optional number of matched items to return. Omit to return all remaining matches.'
                    }
                },
                required: ['query'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'teleportCharacterToLocation',
            description: 'Teleport a character (player or NPC) to a location. When names are ambiguous, the tool returns disambiguation candidates.',
            parameters: {
                type: 'object',
                properties: {
                    character: {
                        type: 'string',
                        description: 'Character ID or name.'
                    },
                    location: {
                        type: 'string',
                        description: 'Destination location ID or name.'
                    },
                    region: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate location matching.'
                    }
                },
                required: ['character', 'location'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'teleportThingToLocation',
            description: 'Teleport a thing to a location. Removes the thing from prior owner inventory/location first.',
            parameters: {
                type: 'object',
                properties: {
                    thing: {
                        type: 'string',
                        description: 'Thing ID or name.'
                    },
                    location: {
                        type: 'string',
                        description: 'Destination location ID or name.'
                    },
                    region: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate location matching.'
                    }
                },
                required: ['thing', 'location'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'moveThingFromLocationToCharacterInventory',
            description: 'Move a thing from a specific location into a character inventory. Fails if the thing is not at that location.',
            parameters: {
                type: 'object',
                properties: {
                    thing: {
                        type: 'string',
                        description: 'Thing ID or name.'
                    },
                    fromLocation: {
                        type: 'string',
                        description: 'Source location ID or name where the thing must currently exist.'
                    },
                    character: {
                        type: 'string',
                        description: 'Target character ID or name.'
                    },
                    region: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate location matching.'
                    }
                },
                required: ['thing', 'fromLocation', 'character'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'createRegionStub',
            description: 'Create a new region-entry stub reachable from an origin location. Use createExit for the canonical location/region creation flow.',
            parameters: {
                type: 'object',
                properties: {
                    regionName: {
                        type: 'string',
                        description: 'Name for the new region stub.'
                    },
                    originLocation: {
                        type: 'string',
                        description: 'Optional origin location ID or name. Defaults to the current player location.'
                    },
                    originRegion: {
                        type: 'string',
                        description: 'Optional region disambiguator for origin location matching.'
                    },
                    description: {
                        type: 'string',
                        description: 'Optional stub description and exit label.'
                    },
                    parentRegion: {
                        type: 'string',
                        description: 'Optional parent region ID or name.'
                    },
                    vehicleType: {
                        type: 'string',
                        description: 'Optional vehicle type for this exit path.'
                    },
                    relativeLevel: {
                        type: 'integer',
                        description: 'Optional relative level hint for generation.'
                    }
                },
                required: ['regionName'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'createExit',
            description: 'Create an exit from one location to another location or region. This is the canonical way to create new location and region stubs: if the destination does not exist, this tool creates the missing stub and connects it.',
            parameters: {
                type: 'object',
                properties: {
                    fromLocation: {
                        type: 'string',
                        description: 'Origin location ID or name.'
                    },
                    fromRegion: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate origin location matching.'
                    },
                    toLocation: {
                        type: 'string',
                        description: 'Destination location ID or name. If missing and toRegion is provided, a region exit is created.'
                    },
                    toRegion: {
                        type: 'string',
                        description: 'Destination region ID or name. If not found, a region-entry stub is created.'
                    },
                    description: {
                        type: 'string',
                        description: 'Optional exit description.'
                    },
                    vehicleType: {
                        type: 'string',
                        description: 'Optional vehicle type; sets isVehicle=true.'
                    },
                    relativeLevel: {
                        type: 'integer',
                        description: 'Optional relative level hint for created stubs.'
                    }
                },
                required: ['fromLocation'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'listLocationEntities',
            description: 'List characters and/or things at a location. Includes the player and player party members when the player is present at that location.',
            parameters: {
                type: 'object',
                properties: {
                    location: {
                        type: 'string',
                        description: 'Location ID or name.'
                    },
                    region: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate location matching.'
                    },
                    entityType: {
                        type: 'string',
                        enum: ['characters', 'things', 'both'],
                        description: 'Optional filter. Defaults to both.'
                    }
                },
                required: ['location'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'createThing',
            description: 'Create a thing at a location using thing-generator-single. Returns the final created name (which may differ from requested name after name validation).',
            parameters: {
                type: 'object',
                properties: {
                    shortDescription: {
                        type: 'string',
                        description: 'Required short description seed for generation.'
                    },
                    itemOrScenery: {
                        type: 'string',
                        enum: ['item', 'scenery'],
                        description: 'Required thing type.'
                    },
                    location: {
                        type: 'string',
                        description: 'Optional location ID or name. Defaults to current player location.'
                    },
                    region: {
                        type: 'string',
                        description: 'Optional region ID or name used to disambiguate location matching.'
                    },
                    name: {
                        type: 'string',
                        description: 'Optional preferred thing name.'
                    },
                    description: {
                        type: 'string',
                        description: 'Optional long description seed.'
                    },
                    notes: {
                        type: 'string',
                        description: 'Optional additional generator notes.'
                    },
                    type: {
                        type: 'string',
                        description: 'Optional item/scenery type detail.'
                    },
                    slot: {
                        type: 'string',
                        description: 'Optional equipment slot or N/A.'
                    },
                    rarity: {
                        type: 'string',
                        description: 'Optional rarity label.'
                    },
                    value: {
                        type: 'number',
                        description: 'Optional value field.'
                    },
                    weight: {
                        type: 'number',
                        description: 'Optional weight field.'
                    },
                    relativeLevel: {
                        type: 'integer',
                        description: 'Optional relative level hint.'
                    },
                    isVehicle: {
                        type: 'boolean'
                    },
                    isCraftingStation: {
                        type: 'boolean'
                    },
                    isProcessingStation: {
                        type: 'boolean'
                    },
                    isHarvestable: {
                        type: 'boolean'
                    },
                    isSalvageable: {
                        type: 'boolean'
                    },
                    attributeBonuses: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                attribute: { type: 'string' },
                                bonus: { type: 'number' }
                            },
                            required: ['attribute', 'bonus'],
                            additionalProperties: false
                        }
                    },
                    causeStatusEffectOnTarget: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            description: { type: 'string' },
                            duration: { type: 'string' }
                        },
                        additionalProperties: false
                    },
                    causeStatusEffectOnEquipper: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            description: { type: 'string' },
                            duration: { type: 'string' }
                        },
                        additionalProperties: false
                    },
                    properties: {
                        type: 'string',
                        description: 'Optional freeform properties text.'
                    }
                },
                required: ['shortDescription', 'itemOrScenery'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'locateNpcs',
            description: 'Locate NPCs by full name or alias. Returns all matching NPCs with full name, location, and region.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'NPC name or alias to search for.'
                    }
                },
                required: ['query'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'locateThings',
            description: 'Locate things by name. Returns all matching things with location and, when in inventory, owner name plus owner location.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Thing name to search for.'
                    }
                },
                required: ['query'],
                additionalProperties: false
            }
        }
    }
]);

const ensureFunction = (value, name) => {
    if (typeof value !== 'function') {
        throw new Error(`Chat tool runtime requires ${name} function.`);
    }
};

const ensureModel = (value, name) => {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new Error(`Chat tool runtime requires ${name} model.`);
    }
};

class ToolVisibleError extends Error {
    constructor(message, { code = 'tool_error', candidates = [], details = null } = {}) {
        super(message);
        this.name = 'ToolVisibleError';
        this.code = typeof code === 'string' && code.trim() ? code.trim() : 'tool_error';
        this.candidates = Array.isArray(candidates) ? candidates : [];
        this.details = details && typeof details === 'object' ? details : null;
    }
}

const xmlEscapeText = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const xmlEscapeAttribute = (value) => xmlEscapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const xmlIndent = (level) => '  '.repeat(Math.max(0, level));

const buildXmlAttributeText = (attributes = null) => {
    const attrs = [];
    if (attributes && typeof attributes === 'object') {
        for (const [key, raw] of Object.entries(attributes)) {
            if (raw === null || raw === undefined) {
                continue;
            }
            attrs.push(`${key}="${xmlEscapeAttribute(raw)}"`);
        }
    }
    return attrs.length ? ` ${attrs.join(' ')}` : '';
};

const renderXmlNode = (tagName, value, level = 0, attributes = null) => {
    const attrText = buildXmlAttributeText(attributes);
    const tag = typeof tagName === 'string' && tagName.trim() ? tagName.trim() : 'node';

    if (value === null || value === undefined) {
        return [`${xmlIndent(level)}<${tag}${attrText}/>`];
    }

    const valueType = typeof value;
    if (valueType !== 'object') {
        return [`${xmlIndent(level)}<${tag}${attrText}>${xmlEscapeText(value)}</${tag}>`];
    }

    const lines = [`${xmlIndent(level)}<${tag}${attrText}>`];
    if (Array.isArray(value)) {
        for (const item of value) {
            lines.push(...renderXmlNode('item', item, level + 1));
        }
    } else {
        for (const [key, entry] of Object.entries(value)) {
            lines.push(...renderXmlNode('field', entry, level + 1, { name: key }));
        }
    }
    lines.push(`${xmlIndent(level)}</${tag}>`);
    return lines;
};

const normalizeToolCallsForExecution = (toolCalls = [], { sourceLabel = 'tool response' } = {}) => {
    if (!Array.isArray(toolCalls)) {
        throw new Error(`Expected tool call list in ${sourceLabel}.`);
    }
    const normalized = [];
    for (let i = 0; i < toolCalls.length; i += 1) {
        const rawCall = toolCalls[i];
        if (!rawCall || typeof rawCall !== 'object') {
            continue;
        }
        const id = typeof rawCall.id === 'string' ? rawCall.id.trim() : '';
        if (!id) {
            throw new Error(`Malformed tool call in ${sourceLabel}: missing call id.`);
        }
        const fn = rawCall.function;
        const functionName = typeof fn?.name === 'string' ? fn.name.trim() : '';
        if (!functionName) {
            throw new Error(`Malformed tool call "${id}" in ${sourceLabel}: missing function.name.`);
        }
        const argumentsText = typeof fn?.arguments === 'string' ? fn.arguments : '';
        const trimmedArguments = argumentsText.trim();
        if (!trimmedArguments) {
            throw new Error(`Malformed tool call "${functionName}" in ${sourceLabel}: function.arguments is empty.`);
        }
        let argumentsObject = null;
        try {
            argumentsObject = JSON.parse(trimmedArguments);
        } catch (error) {
            throw new Error(`Malformed tool call "${functionName}" in ${sourceLabel}: function.arguments is not valid JSON (${error.message}).`);
        }
        normalized.push({
            id,
            type: typeof rawCall.type === 'string' ? rawCall.type : 'function',
            functionName,
            argumentsText,
            argumentsObject
        });
    }
    return normalized;
};

const toSearchableValues = (input) => {
    if (input === null || input === undefined) {
        return [];
    }
    if (typeof input === 'string') {
        const trimmed = input.trim();
        return trimmed ? [trimmed] : [];
    }
    if (typeof input === 'number' || typeof input === 'boolean') {
        return [String(input)];
    }
    if (Array.isArray(input)) {
        return input.flatMap(toSearchableValues);
    }
    if (typeof input === 'object') {
        return Object.values(input).flatMap(toSearchableValues);
    }
    return [];
};

const normalizeHistoryQueries = (query) => {
    if (typeof query === 'string') {
        const trimmed = query.trim();
        if (!trimmed) {
            throw new Error('getHistory requires a non-empty "query" string or array of non-empty strings.');
        }
        return [trimmed];
    }

    if (!Array.isArray(query) || !query.length) {
        throw new Error('getHistory requires a non-empty "query" string or array of non-empty strings.');
    }

    const normalized = [];
    for (let i = 0; i < query.length; i += 1) {
        const entry = query[i];
        if (typeof entry !== 'string') {
            throw new Error(`getHistory query array entry at index ${i} must be a string.`);
        }
        const trimmed = entry.trim();
        if (!trimmed) {
            throw new Error(`getHistory query array entry at index ${i} must be non-empty.`);
        }
        normalized.push(trimmed);
    }
    return normalized;
};

const normalizeOptionalPositiveInteger = (value, name) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 1) {
        throw new Error(`getHistory "${name}" must be an integer >= 1 when provided.`);
    }
    return numeric;
};

const normalizeMoreInfoType = (value) => {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== 'string') {
        throw new Error('moreInfo "type" must be a string when provided.');
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    if (normalized !== 'character'
        && normalized !== 'thing'
        && normalized !== 'location'
        && normalized !== 'region') {
        throw new Error('moreInfo "type" must be one of: character, thing, location, region.');
    }
    return normalized;
};

const toTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');

const toDisplayLevel = (rawValues = [], fallback = 1) => {
    for (const rawValue of rawValues) {
        const numeric = Number(rawValue);
        if (Number.isFinite(numeric) && numeric > 0) {
            return Math.max(1, Math.round(numeric));
        }
    }
    return fallback;
};

const normalizeStatusEffectsForDisplay = (effects) => {
    if (!Array.isArray(effects)) {
        return [];
    }
    return effects
        .map(effect => {
            const description = toTrimmedString(effect?.description || effect?.name || effect?.text);
            if (!description) {
                return null;
            }
            const durationValue = effect?.duration;
            const duration = durationValue === null || durationValue === undefined
                ? 'unknown'
                : String(durationValue);
            return { description, duration };
        })
        .filter(Boolean);
};

const normalizeMoreInfoMarkdown = (input) => {
    if (typeof input !== 'string') {
        return '';
    }
    const rawLines = input
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line.replace(/[ \t]+$/g, ''));

    const collapsed = [];
    let previousWasBlank = false;
    for (const line of rawLines) {
        const isBlank = line.trim() === '';
        if (isBlank) {
            if (previousWasBlank) {
                continue;
            }
            collapsed.push('');
            previousWasBlank = true;
            continue;
        }
        collapsed.push(line);
        previousWasBlank = false;
    }

    while (collapsed.length && collapsed[0].trim() === '') {
        collapsed.shift();
    }
    while (collapsed.length && collapsed[collapsed.length - 1].trim() === '') {
        collapsed.pop();
    }
    return collapsed.join('\n');
};

const createChatToolRuntime = ({
    getConfig,
    getChatHistory,
    isAssistantProseLikeEntry,
    serializeNpcForClient,
    buildLocationResponse,
    getCurrentPlayer,
    createLocationFromEvent,
    createRegionStubFromEvent,
    generateItemsByNames,
    ensureExitConnection,
    findRegionByLocationId,
    LLMClient,
    Player,
    Thing,
    Location,
    Region,
    getGameLocations,
    getFactions,
    getRegionsMap,
    getPendingRegionStubs
} = {}) => {
    ensureFunction(getConfig, 'getConfig');
    ensureFunction(getChatHistory, 'getChatHistory');
    ensureFunction(isAssistantProseLikeEntry, 'isAssistantProseLikeEntry');
    ensureFunction(serializeNpcForClient, 'serializeNpcForClient');
    ensureFunction(buildLocationResponse, 'buildLocationResponse');
    ensureFunction(getCurrentPlayer, 'getCurrentPlayer');
    ensureFunction(createLocationFromEvent, 'createLocationFromEvent');
    ensureFunction(createRegionStubFromEvent, 'createRegionStubFromEvent');
    ensureFunction(generateItemsByNames, 'generateItemsByNames');
    ensureFunction(ensureExitConnection, 'ensureExitConnection');
    ensureFunction(findRegionByLocationId, 'findRegionByLocationId');
    ensureFunction(getGameLocations, 'getGameLocations');
    ensureFunction(getFactions, 'getFactions');
    ensureFunction(getRegionsMap, 'getRegionsMap');
    ensureFunction(getPendingRegionStubs, 'getPendingRegionStubs');
    ensureModel(LLMClient, 'LLMClient');
    ensureModel(Player, 'Player');
    ensureModel(Thing, 'Thing');
    ensureModel(Location, 'Location');
    ensureModel(Region, 'Region');

    const moreInfoTemplateEnv = (() => {
        if (typeof nunjucks.Environment !== 'function' || typeof nunjucks.FileSystemLoader !== 'function') {
            throw new Error('Nunjucks is unavailable for moreInfo display templates.');
        }
        const templatesPath = path.join(__dirname, 'templates');
        return new nunjucks.Environment(
            new nunjucks.FileSystemLoader(templatesPath, { noCache: true }),
            {
                autoescape: false,
                throwOnUndefined: false,
                trimBlocks: true,
                lstripBlocks: true
            }
        );
    })();

    const renderMoreInfoTemplate = (templateName, context = {}) => {
        if (typeof templateName !== 'string' || !templateName.trim()) {
            throw new Error('moreInfo template name must be a non-empty string.');
        }
        let rendered = '';
        try {
            rendered = moreInfoTemplateEnv.render(templateName.trim(), context);
        } catch (error) {
            throw new Error(`Failed to render moreInfo template "${templateName}": ${error.message}`);
        }
        const trimmed = typeof rendered === 'string' ? rendered.trim() : '';
        if (!trimmed) {
            throw new Error(`moreInfo template "${templateName}" rendered empty output.`);
        }
        return trimmed;
    };

    const renderTemplatedXmlNode = ({
        tagName,
        templateName,
        context,
        level = 0,
        attributes = null
    } = {}) => {
        const tag = typeof tagName === 'string' && tagName.trim() ? tagName.trim() : 'entry';
        const attrText = buildXmlAttributeText(attributes);
        const rendered = renderMoreInfoTemplate(templateName, context);
        const markdown = normalizeMoreInfoMarkdown(rendered);
        if (!markdown) {
            throw new Error(`moreInfo template "${templateName}" rendered no markdown content.`);
        }
        const lines = [`${xmlIndent(level)}<${tag}${attrText}>`];
        lines.push(`${xmlIndent(level + 1)}<markdown>${xmlEscapeText(markdown)}</markdown>`);
        lines.push(`${xmlIndent(level)}</${tag}>`);
        return lines;
    };

    const npcAliasesForMatching = (npc) => {
        if (!npc) {
            return [];
        }
        if (typeof npc.getAliases === 'function') {
            return toSearchableValues(npc.getAliases());
        }
        if (npc.aliases instanceof Set) {
            return toSearchableValues(Array.from(npc.aliases));
        }
        return toSearchableValues(npc.aliases);
    };

    const buildThingDisplayModel = (thingLike) => {
        const rawThing = thingLike && typeof thingLike === 'object' ? thingLike : {};
        const metadata = rawThing.metadata && typeof rawThing.metadata === 'object'
            ? rawThing.metadata
            : {};
        const description = toTrimmedString(rawThing.description);
        const shortDescription = toTrimmedString(rawThing.shortDescription)
            || toTrimmedString(metadata.shortDescription);
        const summary = shortDescription || description;
        const rarity = toTrimmedString(rawThing.rarity) || 'common';
        const level = toDisplayLevel(
            [rawThing.level, rawThing.relativeLevel, metadata.relativeLevel, metadata.level],
            1
        );

        const attributeBonusesRaw = Array.isArray(rawThing.attributeBonuses)
            ? rawThing.attributeBonuses
            : [];
        const attributeBonuses = attributeBonusesRaw
            .map(entry => {
                if (!entry || typeof entry !== 'object') {
                    return null;
                }
                const attribute = toTrimmedString(entry.attribute || entry.name);
                if (!attribute) {
                    return null;
                }
                const bonusNumber = Number(entry.bonus ?? entry.value ?? 0);
                return {
                    attribute,
                    bonus: Number.isFinite(bonusNumber) ? bonusNumber : 0
                };
            })
            .filter(Boolean);

        return {
            id: toTrimmedString(rawThing.id) || null,
            name: toTrimmedString(rawThing.name) || 'Unknown',
            thingType: toTrimmedString(rawThing.thingType) || 'item',
            description,
            summary,
            rarity,
            level,
            itemTypeDetail: toTrimmedString(rawThing.itemTypeDetail),
            slot: toTrimmedString(rawThing.slot),
            isVehicle: Boolean(rawThing.isVehicle ?? metadata.isVehicle),
            isCraftingStation: Boolean(rawThing.isCraftingStation ?? metadata.isCraftingStation),
            isProcessingStation: Boolean(rawThing.isProcessingStation ?? metadata.isProcessingStation),
            isHarvestable: Boolean(rawThing.isHarvestable ?? metadata.isHarvestable),
            isSalvageable: Boolean(rawThing.isSalvageable ?? metadata.isSalvageable),
            attributeBonuses,
            statusEffects: normalizeStatusEffectsForDisplay(rawThing.statusEffects),
            causeStatusEffectOnTarget: rawThing.causeStatusEffectOnTarget && typeof rawThing.causeStatusEffectOnTarget === 'object'
                ? rawThing.causeStatusEffectOnTarget
                : null,
            causeStatusEffectOnEquipper: rawThing.causeStatusEffectOnEquipper && typeof rawThing.causeStatusEffectOnEquipper === 'object'
                ? rawThing.causeStatusEffectOnEquipper
                : null
        };
    };

    const buildPlayerDisplayModel = (playerRecord) => {
        const snapshot = playerRecord && typeof playerRecord === 'object' ? playerRecord : {};
        const skillSource = snapshot.skills && typeof snapshot.skills === 'object'
            ? snapshot.skills
            : {};
        const skills = Object.entries(skillSource)
            .map(([name, value]) => ({ name: toTrimmedString(name), value: Number(value) }))
            .filter(entry => entry.name && Number.isFinite(entry.value) && entry.value > 1)
            .sort((a, b) => {
                if (b.value !== a.value) {
                    return b.value - a.value;
                }
                return a.name.localeCompare(b.name);
            });

        const abilities = Array.isArray(snapshot.abilities)
            ? snapshot.abilities
                .map(ability => {
                    const name = toTrimmedString(ability?.name);
                    if (!name) {
                        return null;
                    }
                    return {
                        name,
                        level: toDisplayLevel([ability?.level], 1),
                        summary: toTrimmedString(ability?.shortDescription) || toTrimmedString(ability?.description)
                    };
                })
                .filter(Boolean)
            : [];

        const inventory = Array.isArray(snapshot.inventory)
            ? snapshot.inventory
                .map(item => {
                    const thing = buildThingDisplayModel(item);
                    const equippedSlot = toTrimmedString(item?.equippedSlot);
                    if (equippedSlot) {
                        thing.equippedSlot = equippedSlot;
                    }
                    return thing;
                })
                .filter(Boolean)
            : [];

        const aliases = Array.isArray(snapshot.aliases)
            ? Array.from(new Set(snapshot.aliases.map(alias => toTrimmedString(alias)).filter(Boolean)))
            : [];

        const gameLocations = getGameLocations();
        const factions = getFactions();
        const locationId = toTrimmedString(snapshot.locationId);
        const locationName = locationId && gameLocations instanceof Map && gameLocations.has(locationId)
            ? toTrimmedString(gameLocations.get(locationId)?.name) || locationId
            : (locationId || 'Unknown');
        const factionId = toTrimmedString(snapshot.factionId);
        const factionName = factionId && factions instanceof Map && factions.has(factionId)
            ? toTrimmedString(factions.get(factionId)?.name) || factionId
            : factionId;

        return {
            id: toTrimmedString(snapshot.id) || null,
            name: toTrimmedString(snapshot.name) || 'Unknown',
            description: toTrimmedString(snapshot.shortDescription) || toTrimmedString(snapshot.description),
            class: toTrimmedString(snapshot.class) || 'Unknown',
            race: toTrimmedString(snapshot.race) || 'Unknown',
            level: toDisplayLevel([snapshot.level], 1),
            locationName,
            isNPC: Boolean(snapshot.isNPC),
            isHostile: Boolean(snapshot.isHostile),
            isDead: Boolean(snapshot.isDead),
            aliases,
            factionName: factionName || null,
            resistances: toTrimmedString(snapshot.resistances),
            vulnerabilities: toTrimmedString(snapshot.vulnerabilities),
            currency: Number.isFinite(Number(snapshot.currency)) ? Number(snapshot.currency) : null,
            experience: Number.isFinite(Number(snapshot.experience)) ? Number(snapshot.experience) : null,
            skills,
            abilities,
            inventory,
            statusEffects: normalizeStatusEffectsForDisplay(snapshot.statusEffects)
        };
    };

    const buildLocationDisplayModel = (locationData) => {
        const snapshot = locationData && typeof locationData === 'object' ? locationData : {};
        const exits = Object.entries(snapshot.exits || {})
            .map(([direction, exit]) => {
                if (!exit || typeof exit !== 'object') {
                    return null;
                }
                return {
                    direction,
                    name: toTrimmedString(exit.name) || direction,
                    destinationName: toTrimmedString(exit.destinationName) || toTrimmedString(exit.destination),
                    destinationRegionName: toTrimmedString(exit.destinationRegionName),
                    isVehicle: Boolean(exit.isVehicle),
                    vehicleType: toTrimmedString(exit.vehicleType)
                };
            })
            .filter(Boolean);

        const npcs = Array.isArray(snapshot.npcs)
            ? snapshot.npcs
                .map(npc => ({
                    name: toTrimmedString(npc?.name) || 'Unknown',
                    class: toTrimmedString(npc?.class) || 'Unknown',
                    race: toTrimmedString(npc?.race) || 'Unknown',
                    level: toDisplayLevel([npc?.level], 1),
                    summary: toTrimmedString(npc?.shortDescription) || toTrimmedString(npc?.description)
                }))
                .filter(Boolean)
            : [];

        const thingModels = Array.isArray(snapshot.things)
            ? snapshot.things.map(buildThingDisplayModel).filter(Boolean)
            : [];
        const items = thingModels.filter(entry => entry.thingType !== 'scenery');
        const scenery = thingModels.filter(entry => entry.thingType === 'scenery');

        const factions = getFactions();
        const controllingFactionId = toTrimmedString(snapshot.controllingFactionId);
        const controllingFactionName = controllingFactionId && factions instanceof Map && factions.has(controllingFactionId)
            ? toTrimmedString(factions.get(controllingFactionId)?.name) || controllingFactionId
            : controllingFactionId;

        return {
            id: toTrimmedString(snapshot.id) || null,
            name: toTrimmedString(snapshot.name) || 'Unknown',
            description: toTrimmedString(snapshot.description),
            shortDescription: toTrimmedString(snapshot.shortDescription),
            regionName: toTrimmedString(snapshot.regionName),
            baseLevel: toDisplayLevel([snapshot.baseLevel], 1),
            isStub: Boolean(snapshot.isStub),
            controllingFactionName: controllingFactionName || null,
            exits,
            npcs,
            items,
            scenery,
            statusEffects: normalizeStatusEffectsForDisplay(snapshot.statusEffects)
        };
    };

    const buildRegionDisplayModel = (regionRecord) => {
        const regionData = typeof regionRecord?.toJSON === 'function'
            ? regionRecord.toJSON()
            : (regionRecord && typeof regionRecord === 'object' ? regionRecord : {});
        const regionId = toTrimmedString(regionData.id);

        const gameLocations = getGameLocations();
        const regions = getRegionsMap();
        const pendingRegionStubs = getPendingRegionStubs();
        const factions = getFactions();

        const locationIds = Array.isArray(regionData.locationIds)
            ? regionData.locationIds
            : [];
        const locationNames = locationIds
            .map(locationId => {
                const trimmedId = toTrimmedString(locationId);
                if (!trimmedId) {
                    return null;
                }
                if (gameLocations instanceof Map && gameLocations.has(trimmedId)) {
                    return toTrimmedString(gameLocations.get(trimmedId)?.name) || trimmedId;
                }
                return trimmedId;
            })
            .filter(Boolean);

        const connectedRegionNames = new Set();
        for (const locationId of locationIds) {
            const trimmedId = toTrimmedString(locationId);
            if (!trimmedId || !(gameLocations instanceof Map) || !gameLocations.has(trimmedId)) {
                continue;
            }
            const location = gameLocations.get(trimmedId);
            const exitMap = location?.exits instanceof Map ? location.exits : null;
            if (!exitMap) {
                continue;
            }
            for (const exit of exitMap.values()) {
                const destinationId = toTrimmedString(exit?.destination);
                if (!destinationId || !(gameLocations instanceof Map) || !gameLocations.has(destinationId)) {
                    continue;
                }
                const destinationLocation = gameLocations.get(destinationId);
                const destinationRegionId = toTrimmedString(destinationLocation?.regionId)
                    || toTrimmedString(destinationLocation?.stubMetadata?.regionId)
                    || toTrimmedString(destinationLocation?.stubMetadata?.targetRegionId);
                if (!destinationRegionId || destinationRegionId === regionId) {
                    continue;
                }
                const connectedRegionName = (regions instanceof Map && regions.has(destinationRegionId))
                    ? (toTrimmedString(regions.get(destinationRegionId)?.name) || destinationRegionId)
                    : (toTrimmedString(pendingRegionStubs?.get(destinationRegionId)?.name)
                        || toTrimmedString(destinationLocation?.stubMetadata?.regionName)
                        || toTrimmedString(destinationLocation?.stubMetadata?.targetRegionName)
                        || destinationRegionId);
                if (connectedRegionName) {
                    connectedRegionNames.add(connectedRegionName);
                }
            }
        }

        const parentRegionId = toTrimmedString(regionData.parentRegionId);
        const parentRegionName = parentRegionId && regions instanceof Map && regions.has(parentRegionId)
            ? toTrimmedString(regions.get(parentRegionId)?.name) || parentRegionId
            : parentRegionId;
        const controllingFactionId = toTrimmedString(regionData.controllingFactionId);
        const controllingFactionName = controllingFactionId && factions instanceof Map && factions.has(controllingFactionId)
            ? toTrimmedString(factions.get(controllingFactionId)?.name) || controllingFactionId
            : controllingFactionId;
        const weatherName = toTrimmedString(regionData.weatherState?.name);
        const weatherDescription = toTrimmedString(regionData.weatherState?.description);

        return {
            id: regionId || null,
            name: toTrimmedString(regionData.name) || 'Unknown',
            description: toTrimmedString(regionData.description),
            shortDescription: toTrimmedString(regionData.shortDescription),
            parentRegionName: parentRegionName || null,
            controllingFactionName: controllingFactionName || null,
            averageLevel: Number.isFinite(Number(regionData.averageLevel))
                ? Number(regionData.averageLevel)
                : null,
            locationNames,
            connectedRegionNames: Array.from(connectedRegionNames).sort((a, b) => a.localeCompare(b)),
            secrets: Array.isArray(regionData.secrets)
                ? regionData.secrets.map(secret => toTrimmedString(secret)).filter(Boolean)
                : [],
            weatherName: weatherName || null,
            weatherDescription: weatherDescription || null,
            statusEffects: normalizeStatusEffectsForDisplay(regionData.statusEffects)
        };
    };

    const locationRegionId = (location) => {
        const directRegionId = toTrimmedString(location?.regionId)
            || toTrimmedString(location?.stubMetadata?.regionId)
            || toTrimmedString(location?.stubMetadata?.targetRegionId);
        if (directRegionId) {
            return directRegionId;
        }
        const resolved = location?.id ? findRegionByLocationId(location.id) : null;
        return toTrimmedString(resolved?.id) || null;
    };

    const locationRegionName = (location) => {
        const regionId = locationRegionId(location);
        if (!regionId) {
            return null;
        }
        const regions = getRegionsMap();
        const pendingRegionStubs = getPendingRegionStubs();
        if (regions instanceof Map && regions.has(regionId)) {
            return toTrimmedString(regions.get(regionId)?.name) || regionId;
        }
        if (pendingRegionStubs instanceof Map && pendingRegionStubs.has(regionId)) {
            return toTrimmedString(pendingRegionStubs.get(regionId)?.name) || regionId;
        }
        return regionId;
    };

    const normalizeRequiredString = (value, { functionName, fieldName } = {}) => {
        const trimmed = toTrimmedString(value);
        if (!trimmed) {
            throw new ToolVisibleError(
                `${functionName} requires a non-empty "${fieldName}" string.`,
                { code: 'invalid_arguments' }
            );
        }
        return trimmed;
    };

    const normalizeOptionalString = (value) => {
        const trimmed = toTrimmedString(value);
        return trimmed || null;
    };

    const normalizeOptionalInteger = (value, { functionName, fieldName } = {}) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be an integer when provided.`,
                { code: 'invalid_arguments' }
            );
        }
        return numeric;
    };

    const normalizeOptionalNumber = (value, { functionName, fieldName } = {}) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            throw new ToolVisibleError(
                `${functionName} "${fieldName}" must be a finite number when provided.`,
                { code: 'invalid_arguments' }
            );
        }
        return numeric;
    };

    const normalizeOptionalBoolean = (value, { functionName, fieldName } = {}) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true') {
                return true;
            }
            if (normalized === 'false') {
                return false;
            }
        }
        throw new ToolVisibleError(
            `${functionName} "${fieldName}" must be a boolean when provided.`,
            { code: 'invalid_arguments' }
        );
    };

    const normalizeEntityTypeFilter = (value) => {
        if (value === null || value === undefined || value === '') {
            return 'both';
        }
        if (typeof value !== 'string') {
            throw new ToolVisibleError(
                'listLocationEntities "entityType" must be "characters", "things", or "both".',
                { code: 'invalid_arguments' }
            );
        }
        const normalized = value.trim().toLowerCase();
        if (normalized === 'characters' || normalized === 'things' || normalized === 'both') {
            return normalized;
        }
        throw new ToolVisibleError(
            'listLocationEntities "entityType" must be "characters", "things", or "both".',
            { code: 'invalid_arguments' }
        );
    };

    const getAllCharacters = () => {
        const allCharacters = typeof Player?.getAll === 'function' ? Player.getAll() : [];
        return Array.isArray(allCharacters) ? allCharacters.filter(Boolean) : [];
    };

    const getAllThings = () => {
        const allThings = typeof Thing?.getAll === 'function' ? Thing.getAll() : [];
        return Array.isArray(allThings) ? allThings.filter(Boolean) : [];
    };

    const getAllLocations = () => {
        const locationMap = getGameLocations();
        if (locationMap instanceof Map) {
            return Array.from(locationMap.values()).filter(Boolean);
        }
        const allLocations = typeof Location?.getAll === 'function' ? Location.getAll() : [];
        return Array.isArray(allLocations) ? allLocations.filter(Boolean) : [];
    };

    const getLocationByIdLoose = (locationId) => {
        const id = toTrimmedString(locationId);
        if (!id) {
            return null;
        }
        const gameLocations = getGameLocations();
        if (gameLocations instanceof Map && gameLocations.has(id)) {
            return gameLocations.get(id);
        }
        if (typeof Location?.get === 'function') {
            try {
                return Location.get(id) || null;
            } catch (_) {
                return null;
            }
        }
        return null;
    };

    const describeLocationSummary = (locationId) => {
        const location = getLocationByIdLoose(locationId);
        if (!location) {
            return {
                locationId: locationId || null,
                locationName: locationId || null,
                regionId: null,
                regionName: null
            };
        }
        return {
            locationId: location.id || null,
            locationName: toTrimmedString(location.name) || location.id || null,
            regionId: locationRegionId(location),
            regionName: locationRegionName(location)
        };
    };

    const describeCharacterCandidate = (character) => {
        const summary = describeLocationSummary(character?.currentLocation || character?.locationId || null);
        return {
            id: toTrimmedString(character?.id) || null,
            name: toTrimmedString(character?.name) || null,
            locationId: summary.locationId,
            locationName: summary.locationName,
            regionId: summary.regionId,
            regionName: summary.regionName
        };
    };

    const describeThingCandidate = (thing) => {
        const metadata = thing?.metadata && typeof thing.metadata === 'object' ? thing.metadata : {};
        const ownerId = toTrimmedString(metadata.ownerId || metadata.owner || metadata.ownerID) || null;
        const owner = ownerId
            ? getAllCharacters().find(candidate => toTrimmedString(candidate?.id) === ownerId) || null
            : null;
        const locationId = toTrimmedString(metadata.locationId || metadata.locationID) || null;
        const locationSummary = describeLocationSummary(locationId);
        return {
            id: toTrimmedString(thing?.id) || null,
            name: toTrimmedString(thing?.name) || null,
            locationId: locationSummary.locationId,
            locationName: locationSummary.locationName,
            ownerId,
            ownerName: toTrimmedString(owner?.name) || null
        };
    };

    const buildToolVisibleErrorResult = (functionName, error) => {
        const safeFunctionName = toTrimmedString(functionName) || 'unknownTool';
        const code = toTrimmedString(error?.code) || 'tool_error';
        const message = toTrimmedString(error?.message) || 'Tool call failed.';
        const candidates = Array.isArray(error?.candidates) ? error.candidates : [];
        const lines = [
            '<toolError>',
            `  <function>${xmlEscapeText(safeFunctionName)}</function>`,
            `  <code>${xmlEscapeText(code)}</code>`,
            `  <message>${xmlEscapeText(message)}</message>`,
            `  <candidates count="${candidates.length}">`
        ];
        for (const candidate of candidates) {
            lines.push(...renderXmlNode('candidate', candidate, 2));
        }
        lines.push('  </candidates>');
        lines.push('</toolError>');
        return {
            content: lines.join('\n'),
            metadata: {
                error: true,
                functionName: safeFunctionName,
                code,
                message,
                candidates
            }
        };
    };

    const candidateSort = (a, b) => {
        const leftName = toTrimmedString(a?.name).toLowerCase();
        const rightName = toTrimmedString(b?.name).toLowerCase();
        if (leftName !== rightName) {
            return leftName.localeCompare(rightName);
        }
        const leftId = toTrimmedString(a?.id).toLowerCase();
        const rightId = toTrimmedString(b?.id).toLowerCase();
        return leftId.localeCompare(rightId);
    };

    const resolveRegionReference = (rawQuery, {
        fieldName = 'region',
        allowPending = true,
        allowMissing = false
    } = {}) => {
        const query = toTrimmedString(rawQuery);
        if (!query) {
            if (allowMissing) {
                return null;
            }
            throw new ToolVisibleError(`A non-empty "${fieldName}" is required.`, {
                code: 'invalid_arguments'
            });
        }

        const regions = getRegionsMap();
        const pendingRegionStubs = getPendingRegionStubs();
        const lowerQuery = query.toLowerCase();
        const allCandidates = [];

        if (regions instanceof Map) {
            for (const region of regions.values()) {
                if (!region) {
                    continue;
                }
                const id = toTrimmedString(region.id);
                if (!id) {
                    continue;
                }
                allCandidates.push({
                    kind: 'region',
                    id,
                    name: toTrimmedString(region.name) || id,
                    record: region
                });
            }
        }

        if (allowPending && pendingRegionStubs instanceof Map) {
            for (const pending of pendingRegionStubs.values()) {
                if (!pending) {
                    continue;
                }
                const id = toTrimmedString(pending.id);
                if (!id) {
                    continue;
                }
                allCandidates.push({
                    kind: 'pending_region_stub',
                    id,
                    name: toTrimmedString(pending.name) || id,
                    record: pending
                });
            }
        }

        const idMatch = allCandidates.find(candidate => candidate.id === query) || null;
        if (idMatch) {
            return idMatch;
        }

        const exactNameMatches = allCandidates.filter(candidate => candidate.name.toLowerCase() === lowerQuery);
        const includesMatches = allCandidates.filter(candidate => candidate.name.toLowerCase().includes(lowerQuery));
        const matches = exactNameMatches.length ? exactNameMatches : includesMatches;

        if (!matches.length) {
            if (allowMissing) {
                return null;
            }
            throw new ToolVisibleError(
                `No ${fieldName} matches "${query}".`,
                { code: 'region_not_found' }
            );
        }

        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple ${fieldName} matches found for "${query}".`,
                {
                    code: 'ambiguous_region',
                    candidates: matches
                        .map(match => ({
                            id: match.id,
                            name: match.name,
                            kind: match.kind
                        }))
                        .sort(candidateSort)
                }
            );
        }

        return matches[0];
    };

    const resolveLocationReference = (rawQuery, {
        fieldName = 'location',
        regionQuery = null,
        allowMissing = false
    } = {}) => {
        const query = toTrimmedString(rawQuery);
        if (!query) {
            if (allowMissing) {
                return null;
            }
            throw new ToolVisibleError(`A non-empty "${fieldName}" is required.`, {
                code: 'invalid_arguments'
            });
        }

        const regionFilter = regionQuery
            ? resolveRegionReference(regionQuery, { fieldName: 'region', allowPending: true, allowMissing: false })
            : null;
        const regionFilterId = regionFilter?.id || null;

        const allLocations = getAllLocations();
        const idMatchedLocation = getLocationByIdLoose(query);
        if (idMatchedLocation) {
            const locationRegion = locationRegionId(idMatchedLocation);
            if (regionFilterId && locationRegion !== regionFilterId) {
                throw new ToolVisibleError(
                    `Location "${query}" is not in region "${regionFilter.name}".`,
                    { code: 'location_region_mismatch' }
                );
            }
            return idMatchedLocation;
        }

        const lowerQuery = query.toLowerCase();
        const exactNameMatches = allLocations.filter(location => (
            toTrimmedString(location?.name).toLowerCase() === lowerQuery
        ));
        const includesMatches = allLocations.filter(location => (
            toTrimmedString(location?.name).toLowerCase().includes(lowerQuery)
        ));
        let matches = exactNameMatches.length ? exactNameMatches : includesMatches;

        if (regionFilterId) {
            matches = matches.filter(location => locationRegionId(location) === regionFilterId);
        }

        if (!matches.length) {
            if (allowMissing) {
                return null;
            }
            throw new ToolVisibleError(
                `No ${fieldName} matches "${query}".`,
                { code: 'location_not_found' }
            );
        }

        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple ${fieldName} matches found for "${query}".`,
                {
                    code: 'ambiguous_location',
                    candidates: matches
                        .map(location => ({
                            id: toTrimmedString(location?.id) || null,
                            name: toTrimmedString(location?.name) || null,
                            regionId: locationRegionId(location),
                            regionName: locationRegionName(location)
                        }))
                        .sort(candidateSort)
                }
            );
        }

        return matches[0];
    };

    const resolveCharacterReference = (rawQuery, { fieldName = 'character' } = {}) => {
        const query = toTrimmedString(rawQuery);
        if (!query) {
            throw new ToolVisibleError(`A non-empty "${fieldName}" is required.`, {
                code: 'invalid_arguments'
            });
        }

        const allCharacters = getAllCharacters();
        const idMatch = allCharacters.find(character => toTrimmedString(character?.id) === query) || null;
        if (idMatch) {
            return idMatch;
        }

        const lowerQuery = query.toLowerCase();
        const exactNameMatches = allCharacters.filter(character => (
            toTrimmedString(character?.name).toLowerCase() === lowerQuery
        ));
        const includesMatches = allCharacters.filter(character => (
            toTrimmedString(character?.name).toLowerCase().includes(lowerQuery)
        ));
        const matches = exactNameMatches.length ? exactNameMatches : includesMatches;

        if (!matches.length) {
            throw new ToolVisibleError(
                `No ${fieldName} matches "${query}".`,
                { code: 'character_not_found' }
            );
        }

        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple ${fieldName} matches found for "${query}".`,
                {
                    code: 'ambiguous_character',
                    candidates: matches
                        .map(describeCharacterCandidate)
                        .sort(candidateSort)
                }
            );
        }

        return matches[0];
    };

    const resolveThingReference = (rawQuery, { fieldName = 'thing' } = {}) => {
        const query = toTrimmedString(rawQuery);
        if (!query) {
            throw new ToolVisibleError(`A non-empty "${fieldName}" is required.`, {
                code: 'invalid_arguments'
            });
        }

        const allThings = getAllThings();
        const idMatch = allThings.find(thing => toTrimmedString(thing?.id) === query) || null;
        if (idMatch) {
            return idMatch;
        }

        const lowerQuery = query.toLowerCase();
        const exactNameMatches = allThings.filter(thing => (
            toTrimmedString(thing?.name).toLowerCase() === lowerQuery
        ));
        const includesMatches = allThings.filter(thing => (
            toTrimmedString(thing?.name).toLowerCase().includes(lowerQuery)
        ));
        const matches = exactNameMatches.length ? exactNameMatches : includesMatches;

        if (!matches.length) {
            throw new ToolVisibleError(
                `No ${fieldName} matches "${query}".`,
                { code: 'thing_not_found' }
            );
        }

        if (matches.length > 1) {
            throw new ToolVisibleError(
                `Multiple ${fieldName} matches found for "${query}".`,
                {
                    code: 'ambiguous_thing',
                    candidates: matches
                        .map(describeThingCandidate)
                        .sort(candidateSort)
                }
            );
        }

        return matches[0];
    };

    const ensureLocationNpcMethod = (location, methodName) => {
        if (!location || typeof location[methodName] !== 'function') {
            throw new Error(`Location "${location?.id || 'unknown'}" is missing required method "${methodName}".`);
        }
    };

    const ensureLocationThingMethod = (location, methodName) => {
        if (!location || typeof location[methodName] !== 'function') {
            throw new Error(`Location "${location?.id || 'unknown'}" is missing required method "${methodName}".`);
        }
    };

    const updateThingLocationMetadata = (thing, { locationId = null, ownerId = null } = {}) => {
        const existingMetadata = thing?.metadata && typeof thing.metadata === 'object'
            ? thing.metadata
            : {};
        const nextMetadata = { ...existingMetadata };
        if (locationId) {
            nextMetadata.locationId = locationId;
            delete nextMetadata.locationID;
        } else {
            delete nextMetadata.locationId;
            delete nextMetadata.locationID;
        }
        if (ownerId) {
            nextMetadata.ownerId = ownerId;
            delete nextMetadata.owner;
            delete nextMetadata.ownerID;
        } else {
            delete nextMetadata.ownerId;
            delete nextMetadata.owner;
            delete nextMetadata.ownerID;
        }
        thing.metadata = nextMetadata;
    };

    const executeTeleportCharacterToLocationTool = ({
        character,
        location,
        region = null
    } = {}) => {
        const functionName = 'teleportCharacterToLocation';
        const characterQuery = normalizeRequiredString(character, { functionName, fieldName: 'character' });
        const locationQuery = normalizeRequiredString(location, { functionName, fieldName: 'location' });
        const regionQuery = normalizeOptionalString(region);

        const targetCharacter = resolveCharacterReference(characterQuery, { fieldName: 'character' });
        const destinationLocation = resolveLocationReference(locationQuery, {
            fieldName: 'location',
            regionQuery
        });

        const originLocation = getLocationByIdLoose(targetCharacter.currentLocation || null);
        const isNpc = Boolean(targetCharacter.isNPC);
        if (originLocation && destinationLocation.id && originLocation.id === destinationLocation.id) {
            const lines = [
                '<teleportCharacterToLocationResult>',
                '  <status>unchanged</status>',
                ...renderXmlNode('character', {
                    id: targetCharacter.id || null,
                    name: targetCharacter.name || null,
                    isNPC: isNpc
                }, 1),
                ...renderXmlNode('location', {
                    id: destinationLocation.id || null,
                    name: destinationLocation.name || null,
                    regionId: locationRegionId(destinationLocation),
                    regionName: locationRegionName(destinationLocation)
                }, 1),
                '</teleportCharacterToLocationResult>'
            ];
            return {
                content: lines.join('\n'),
                metadata: {
                    status: 'unchanged',
                    characterId: targetCharacter.id || null,
                    locationId: destinationLocation.id || null
                }
            };
        }

        if (isNpc && originLocation) {
            ensureLocationNpcMethod(originLocation, 'removeNpcId');
            originLocation.removeNpcId(targetCharacter.id);
        }
        if (isNpc) {
            ensureLocationNpcMethod(destinationLocation, 'addNpcId');
            destinationLocation.addNpcId(targetCharacter.id);
        }

        targetCharacter.setLocation(destinationLocation.id);
        const gameLocations = getGameLocations();
        if (gameLocations instanceof Map) {
            if (originLocation?.id) {
                gameLocations.set(originLocation.id, originLocation);
            }
            gameLocations.set(destinationLocation.id, destinationLocation);
        }

        const lines = [
            '<teleportCharacterToLocationResult>',
            '  <status>success</status>',
            ...renderXmlNode('character', {
                id: targetCharacter.id || null,
                name: targetCharacter.name || null,
                isNPC: isNpc
            }, 1),
            ...renderXmlNode('fromLocation', {
                id: originLocation?.id || null,
                name: toTrimmedString(originLocation?.name) || null,
                regionId: locationRegionId(originLocation),
                regionName: locationRegionName(originLocation)
            }, 1),
            ...renderXmlNode('toLocation', {
                id: destinationLocation.id || null,
                name: toTrimmedString(destinationLocation.name) || null,
                regionId: locationRegionId(destinationLocation),
                regionName: locationRegionName(destinationLocation)
            }, 1),
            '</teleportCharacterToLocationResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                characterId: targetCharacter.id || null,
                originLocationId: originLocation?.id || null,
                destinationLocationId: destinationLocation.id || null
            }
        };
    };

    const executeTeleportThingToLocationTool = ({
        thing,
        location,
        region = null
    } = {}) => {
        const functionName = 'teleportThingToLocation';
        const thingQuery = normalizeRequiredString(thing, { functionName, fieldName: 'thing' });
        const locationQuery = normalizeRequiredString(location, { functionName, fieldName: 'location' });
        const regionQuery = normalizeOptionalString(region);

        const targetThing = resolveThingReference(thingQuery, { fieldName: 'thing' });
        const destinationLocation = resolveLocationReference(locationQuery, {
            fieldName: 'location',
            regionQuery
        });

        const allCharacters = getAllCharacters();
        const removedOwnerIds = [];
        for (const actor of allCharacters) {
            if (!actor || typeof actor.removeInventoryItem !== 'function') {
                continue;
            }
            const removed = actor.removeInventoryItem(targetThing.id, {
                suppressNpcEquip: Boolean(actor.isNPC)
            });
            if (removed && actor.id) {
                removedOwnerIds.push(actor.id);
                if (typeof actor.unequipItemId === 'function') {
                    actor.unequipItemId(targetThing.id, { suppressTimestamp: true });
                }
            }
        }

        const existingMetadata = targetThing.metadata && typeof targetThing.metadata === 'object'
            ? targetThing.metadata
            : {};
        const previousLocationId = toTrimmedString(existingMetadata.locationId || existingMetadata.locationID) || null;
        const previousLocationsById = new Map();
        if (previousLocationId) {
            const metadataLocation = getLocationByIdLoose(previousLocationId);
            if (metadataLocation?.id) {
                previousLocationsById.set(metadataLocation.id, metadataLocation);
            }
        }
        for (const candidateLocation of getAllLocations()) {
            if (!candidateLocation?.id || candidateLocation.id === destinationLocation.id) {
                continue;
            }
            if (Array.isArray(candidateLocation.thingIds) && candidateLocation.thingIds.includes(targetThing.id)) {
                previousLocationsById.set(candidateLocation.id, candidateLocation);
            }
        }
        for (const previousLocation of previousLocationsById.values()) {
            ensureLocationThingMethod(previousLocation, 'removeThingId');
            previousLocation.removeThingId(targetThing.id);
        }

        ensureLocationThingMethod(destinationLocation, 'addThingId');
        destinationLocation.addThingId(targetThing.id);
        updateThingLocationMetadata(targetThing, { locationId: destinationLocation.id, ownerId: null });

        const gameLocations = getGameLocations();
        if (gameLocations instanceof Map) {
            for (const previousLocation of previousLocationsById.values()) {
                if (previousLocation?.id) {
                    gameLocations.set(previousLocation.id, previousLocation);
                }
            }
            gameLocations.set(destinationLocation.id, destinationLocation);
        }

        const previousLocations = Array.from(previousLocationsById.values());
        const primaryPreviousLocation = previousLocations.length ? previousLocations[0] : null;

        const lines = [
            '<teleportThingToLocationResult>',
            '  <status>success</status>',
            ...renderXmlNode('thing', {
                id: targetThing.id || null,
                name: targetThing.name || null,
                thingType: targetThing.thingType || null
            }, 1),
            ...renderXmlNode('fromLocation', {
                id: primaryPreviousLocation?.id || null,
                name: toTrimmedString(primaryPreviousLocation?.name) || null
            }, 1),
            ...renderXmlNode('fromLocationIds', previousLocations.map(locationRecord => locationRecord.id), 1),
            ...renderXmlNode('toLocation', {
                id: destinationLocation.id || null,
                name: destinationLocation.name || null,
                regionId: locationRegionId(destinationLocation),
                regionName: locationRegionName(destinationLocation)
            }, 1),
            ...renderXmlNode('removedOwnerIds', removedOwnerIds, 1),
            '</teleportThingToLocationResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                thingId: targetThing.id || null,
                previousLocationId: primaryPreviousLocation?.id || null,
                previousLocationIds: previousLocations.map(locationRecord => locationRecord.id),
                destinationLocationId: destinationLocation.id || null,
                removedOwnerIds
            }
        };
    };

    const executeMoveThingFromLocationToCharacterInventoryTool = ({
        thing,
        fromLocation,
        character,
        region = null
    } = {}) => {
        const functionName = 'moveThingFromLocationToCharacterInventory';
        const thingQuery = normalizeRequiredString(thing, { functionName, fieldName: 'thing' });
        const sourceLocationQuery = normalizeRequiredString(fromLocation, { functionName, fieldName: 'fromLocation' });
        const characterQuery = normalizeRequiredString(character, { functionName, fieldName: 'character' });
        const regionQuery = normalizeOptionalString(region);

        const targetThing = resolveThingReference(thingQuery, { fieldName: 'thing' });
        const sourceLocation = resolveLocationReference(sourceLocationQuery, {
            fieldName: 'fromLocation',
            regionQuery
        });
        const targetCharacter = resolveCharacterReference(characterQuery, { fieldName: 'character' });

        if (targetThing.thingType && targetThing.thingType !== 'item') {
            throw new ToolVisibleError(
                `Thing "${targetThing.name || targetThing.id}" is "${targetThing.thingType}" and cannot be moved into inventory.`,
                { code: 'thing_not_inventory_item' }
            );
        }

        if (typeof targetCharacter.addInventoryItem !== 'function' || typeof targetCharacter.hasInventoryItem !== 'function') {
            throw new Error(`Character "${targetCharacter.id || targetCharacter.name || 'unknown'}" cannot hold inventory items.`);
        }

        const metadata = targetThing.metadata && typeof targetThing.metadata === 'object'
            ? targetThing.metadata
            : {};
        const metadataLocationId = toTrimmedString(metadata.locationId || metadata.locationID) || null;
        const locationContainsThing = Array.isArray(sourceLocation.thingIds) && sourceLocation.thingIds.includes(targetThing.id);
        if (!locationContainsThing && metadataLocationId !== sourceLocation.id) {
            throw new ToolVisibleError(
                `Thing "${targetThing.name || targetThing.id}" is not currently at location "${sourceLocation.name || sourceLocation.id}".`,
                { code: 'thing_not_at_location' }
            );
        }

        const previousOwnerId = toTrimmedString(metadata.ownerId || metadata.owner || metadata.ownerID) || null;
        if (previousOwnerId && previousOwnerId !== targetCharacter.id) {
            const previousOwner = getAllCharacters().find(actor => toTrimmedString(actor?.id) === previousOwnerId) || null;
            if (previousOwner && typeof previousOwner.removeInventoryItem === 'function') {
                previousOwner.removeInventoryItem(targetThing.id, { suppressNpcEquip: Boolean(previousOwner.isNPC) });
            }
        }

        ensureLocationThingMethod(sourceLocation, 'removeThingId');
        sourceLocation.removeThingId(targetThing.id);
        targetCharacter.addInventoryItem(targetThing, { suppressNpcEquip: Boolean(targetCharacter.isNPC) });

        if (!targetCharacter.hasInventoryItem(targetThing.id)) {
            throw new Error(`Failed to add thing "${targetThing.id}" to character inventory.`);
        }

        updateThingLocationMetadata(targetThing, { locationId: null, ownerId: targetCharacter.id });
        const gameLocations = getGameLocations();
        if (gameLocations instanceof Map) {
            gameLocations.set(sourceLocation.id, sourceLocation);
        }

        const lines = [
            '<moveThingFromLocationToCharacterInventoryResult>',
            '  <status>success</status>',
            ...renderXmlNode('thing', {
                id: targetThing.id || null,
                name: targetThing.name || null
            }, 1),
            ...renderXmlNode('fromLocation', {
                id: sourceLocation.id || null,
                name: sourceLocation.name || null
            }, 1),
            ...renderXmlNode('character', {
                id: targetCharacter.id || null,
                name: targetCharacter.name || null
            }, 1),
            '</moveThingFromLocationToCharacterInventoryResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                thingId: targetThing.id || null,
                sourceLocationId: sourceLocation.id || null,
                characterId: targetCharacter.id || null
            }
        };
    };

    const resolveOriginLocationForCreation = ({ originLocation = null, originRegion = null, functionName }) => {
        const originLocationQuery = normalizeOptionalString(originLocation);
        const originRegionQuery = normalizeOptionalString(originRegion);
        if (originLocationQuery) {
            return resolveLocationReference(originLocationQuery, {
                fieldName: 'originLocation',
                regionQuery: originRegionQuery
            });
        }
        const currentPlayer = getCurrentPlayer();
        if (!currentPlayer) {
            throw new ToolVisibleError(
                `${functionName} requires "originLocation" when there is no current player.`,
                { code: 'missing_origin_location' }
            );
        }
        const playerLocationId = toTrimmedString(currentPlayer.currentLocation || currentPlayer.locationId);
        if (!playerLocationId) {
            throw new ToolVisibleError(
                `${functionName} could not determine origin location from the current player.`,
                { code: 'missing_origin_location' }
            );
        }
        const resolved = getLocationByIdLoose(playerLocationId);
        if (!resolved) {
            throw new ToolVisibleError(
                `${functionName} could not find current player location "${playerLocationId}".`,
                { code: 'missing_origin_location' }
            );
        }
        return resolved;
    };

    const executeCreateRegionStubTool = async ({
        regionName,
        originLocation = null,
        originRegion = null,
        description = null,
        parentRegion = null,
        vehicleType = null,
        relativeLevel = null
    } = {}) => {
        const functionName = 'createRegionStub';
        const targetRegionName = normalizeRequiredString(regionName, { functionName, fieldName: 'regionName' });
        const originLocationRecord = resolveOriginLocationForCreation({
            originLocation,
            originRegion,
            functionName
        });
        const parentRegionQuery = normalizeOptionalString(parentRegion);
        const descriptionText = normalizeOptionalString(description);
        const vehicleTypeText = normalizeOptionalString(vehicleType);
        const relativeLevelValue = normalizeOptionalInteger(relativeLevel, {
            functionName,
            fieldName: 'relativeLevel'
        });

        const resolvedParentRegion = parentRegionQuery
            ? resolveRegionReference(parentRegionQuery, {
                fieldName: 'parentRegion',
                allowPending: true,
                allowMissing: false
            })
            : null;

        const pendingBefore = getPendingRegionStubs();
        const pendingRegionIdsBefore = pendingBefore instanceof Map
            ? new Set(Array.from(pendingBefore.keys()))
            : new Set();

        const regionEntryStub = await createRegionStubFromEvent({
            name: targetRegionName,
            originLocation: originLocationRecord,
            description: descriptionText,
            parentRegionId: resolvedParentRegion?.id || null,
            vehicleType: vehicleTypeText || null,
            isVehicle: Boolean(vehicleTypeText),
            relativeLevel: relativeLevelValue
        });

        if (!regionEntryStub) {
            throw new ToolVisibleError(
                `Unable to create region stub "${targetRegionName}".`,
                { code: 'region_stub_create_failed' }
            );
        }

        const stubMetadata = regionEntryStub.stubMetadata || {};
        const resolvedRegionId = toTrimmedString(stubMetadata.targetRegionId)
            || toTrimmedString(stubMetadata.regionId)
            || null;
        const regions = getRegionsMap();
        const pendingRegionStubs = getPendingRegionStubs();
        const resolvedRegionName = (resolvedRegionId && regions instanceof Map && regions.has(resolvedRegionId))
            ? (toTrimmedString(regions.get(resolvedRegionId)?.name) || resolvedRegionId)
            : ((resolvedRegionId && pendingRegionStubs instanceof Map && pendingRegionStubs.has(resolvedRegionId))
                ? (toTrimmedString(pendingRegionStubs.get(resolvedRegionId)?.name) || resolvedRegionId)
                : targetRegionName);
        const createdRegionStub = Boolean(
            resolvedRegionId
            && pendingRegionStubs instanceof Map
            && pendingRegionStubs.has(resolvedRegionId)
            && !pendingRegionIdsBefore.has(resolvedRegionId)
        );

        const lines = [
            '<createRegionStubResult>',
            '  <status>success</status>',
            ...renderXmlNode('originLocation', {
                id: originLocationRecord.id || null,
                name: originLocationRecord.name || null
            }, 1),
            ...renderXmlNode('region', {
                id: resolvedRegionId,
                name: resolvedRegionName,
                createdRegionStub
            }, 1),
            ...renderXmlNode('entryStubLocation', {
                id: regionEntryStub.id || null,
                name: regionEntryStub.name || null
            }, 1),
            '</createRegionStubResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                originLocationId: originLocationRecord.id || null,
                regionId: resolvedRegionId,
                regionName: resolvedRegionName,
                createdRegionStub,
                entryStubLocationId: regionEntryStub.id || null
            }
        };
    };

    const resolveRegionEntranceLocation = (regionId) => {
        const regions = getRegionsMap();
        const pendingRegionStubs = getPendingRegionStubs();
        if (regions instanceof Map && regions.has(regionId)) {
            const region = regions.get(regionId);
            const entranceLocationId = toTrimmedString(region?.entranceLocationId)
                || (Array.isArray(region?.locationIds) ? toTrimmedString(region.locationIds[0]) : '');
            if (!entranceLocationId) {
                return null;
            }
            return getLocationByIdLoose(entranceLocationId);
        }
        if (pendingRegionStubs instanceof Map && pendingRegionStubs.has(regionId)) {
            const pending = pendingRegionStubs.get(regionId);
            const entranceStubId = toTrimmedString(pending?.entranceStubId);
            if (!entranceStubId) {
                return null;
            }
            return getLocationByIdLoose(entranceStubId);
        }
        return null;
    };

    const executeCreateExitTool = async ({
        fromLocation,
        fromRegion = null,
        toLocation = null,
        toRegion = null,
        description = null,
        vehicleType = null,
        relativeLevel = null
    } = {}) => {
        const functionName = 'createExit';
        const fromLocationQuery = normalizeRequiredString(fromLocation, { functionName, fieldName: 'fromLocation' });
        const fromRegionQuery = normalizeOptionalString(fromRegion);
        const toLocationQuery = normalizeOptionalString(toLocation);
        const toRegionQuery = normalizeOptionalString(toRegion);
        const descriptionText = normalizeOptionalString(description);
        const vehicleTypeText = normalizeOptionalString(vehicleType);
        const relativeLevelValue = normalizeOptionalInteger(relativeLevel, {
            functionName,
            fieldName: 'relativeLevel'
        });

        if (!toLocationQuery && !toRegionQuery) {
            throw new ToolVisibleError(
                'createExit requires either "toLocation" or "toRegion".',
                { code: 'invalid_arguments' }
            );
        }
        if (toLocationQuery && toRegionQuery) {
            throw new ToolVisibleError(
                'createExit accepts either "toLocation" or "toRegion", not both in one call.',
                { code: 'invalid_arguments' }
            );
        }

        const originLocation = resolveLocationReference(fromLocationQuery, {
            fieldName: 'fromLocation',
            regionQuery: fromRegionQuery
        });
        const originRegionId = locationRegionId(originLocation);

        let destinationLocation = null;
        let destinationRegionId = null;
        let destinationKind = null;
        let createdLocationStub = false;
        let createdRegionStub = false;

        if (toRegionQuery) {
            const resolvedRegion = resolveRegionReference(toRegionQuery, {
                fieldName: 'toRegion',
                allowPending: true,
                allowMissing: true
            });
            if (resolvedRegion) {
                destinationRegionId = resolvedRegion.id;
                destinationLocation = resolveRegionEntranceLocation(destinationRegionId);
                if (!destinationLocation) {
                    throw new ToolVisibleError(
                        `Region "${resolvedRegion.name}" has no reachable entrance location.`,
                        { code: 'region_missing_entrance' }
                    );
                }
                ensureExitConnection(originLocation, destinationLocation, {
                    description: descriptionText || `${destinationLocation.name || destinationLocation.id}`,
                    bidirectional: true,
                    destinationRegion: destinationRegionId,
                    isVehicle: Boolean(vehicleTypeText),
                    vehicleType: vehicleTypeText || null
                });
            } else {
                const pendingBefore = getPendingRegionStubs();
                const pendingIdsBefore = pendingBefore instanceof Map
                    ? new Set(Array.from(pendingBefore.keys()))
                    : new Set();
                destinationLocation = await createRegionStubFromEvent({
                    name: toRegionQuery,
                    originLocation,
                    description: descriptionText,
                    vehicleType: vehicleTypeText || null,
                    isVehicle: Boolean(vehicleTypeText),
                    relativeLevel: relativeLevelValue
                });
                if (!destinationLocation) {
                    throw new ToolVisibleError(
                        `Failed to create destination region stub "${toRegionQuery}".`,
                        { code: 'region_stub_create_failed' }
                    );
                }
                const metadata = destinationLocation.stubMetadata || {};
                destinationRegionId = toTrimmedString(metadata.targetRegionId)
                    || toTrimmedString(metadata.regionId)
                    || null;
                const pendingAfter = getPendingRegionStubs();
                createdRegionStub = Boolean(
                    destinationRegionId
                    && pendingAfter instanceof Map
                    && pendingAfter.has(destinationRegionId)
                    && !pendingIdsBefore.has(destinationRegionId)
                );
            }
            destinationKind = 'region';
        } else {
            destinationLocation = resolveLocationReference(toLocationQuery, {
                fieldName: 'toLocation',
                allowMissing: true
            });
            if (!destinationLocation) {
                destinationLocation = await createLocationFromEvent({
                    name: toLocationQuery,
                    originLocation,
                    descriptionHint: descriptionText || toLocationQuery,
                    directionHint: null,
                    expandStub: false,
                    targetRegionId: null,
                    vehicleType: vehicleTypeText || null,
                    isVehicle: Boolean(vehicleTypeText),
                    relativeLevel: relativeLevelValue
                });
                if (!destinationLocation) {
                    throw new ToolVisibleError(
                        `Failed to create destination location stub "${toLocationQuery}".`,
                        { code: 'location_stub_create_failed' }
                    );
                }
                createdLocationStub = Boolean(destinationLocation.isStub);
            } else {
                const destinationLocationRegionId = locationRegionId(destinationLocation);
                const destinationRegionForExit = destinationLocationRegionId && destinationLocationRegionId !== originRegionId
                    ? destinationLocationRegionId
                    : null;
                ensureExitConnection(originLocation, destinationLocation, {
                    description: descriptionText || `${destinationLocation.name || destinationLocation.id}`,
                    bidirectional: true,
                    destinationRegion: destinationRegionForExit,
                    isVehicle: Boolean(vehicleTypeText),
                    vehicleType: vehicleTypeText || null
                });
            }
            destinationKind = 'location';
            destinationRegionId = locationRegionId(destinationLocation);
        }

        const lines = [
            '<createExitResult>',
            '  <status>success</status>',
            ...renderXmlNode('originLocation', {
                id: originLocation.id || null,
                name: originLocation.name || null,
                regionId: locationRegionId(originLocation),
                regionName: locationRegionName(originLocation)
            }, 1),
            ...renderXmlNode('destination', {
                kind: destinationKind,
                locationId: destinationLocation?.id || null,
                locationName: destinationLocation?.name || null,
                regionId: destinationRegionId || null,
                regionName: locationRegionName(destinationLocation),
                createdLocationStub,
                createdRegionStub
            }, 1),
            '</createExitResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                originLocationId: originLocation.id || null,
                destinationKind,
                destinationLocationId: destinationLocation?.id || null,
                destinationRegionId: destinationRegionId || null,
                createdLocationStub,
                createdRegionStub
            }
        };
    };

    const executeListLocationEntitiesTool = ({
        location,
        region = null,
        entityType = 'both'
    } = {}) => {
        const functionName = 'listLocationEntities';
        const locationQuery = normalizeRequiredString(location, { functionName, fieldName: 'location' });
        const regionQuery = normalizeOptionalString(region);
        const entityFilter = normalizeEntityTypeFilter(entityType);

        const targetLocation = resolveLocationReference(locationQuery, {
            fieldName: 'location',
            regionQuery
        });

        const includeCharacters = entityFilter === 'both' || entityFilter === 'characters';
        const includeThings = entityFilter === 'both' || entityFilter === 'things';

        const characterRows = [];
        if (includeCharacters) {
            const seenCharacterIds = new Set();
            const allCharacters = getAllCharacters();
            const currentPlayer = getCurrentPlayer();

            const addCharacter = (character, { inPlayerParty = false } = {}) => {
                if (!character || !character.id || seenCharacterIds.has(character.id)) {
                    return;
                }
                seenCharacterIds.add(character.id);
                const summary = describeLocationSummary(character.currentLocation || character.locationId || null);
                characterRows.push({
                    id: character.id,
                    name: character.name || character.id,
                    isNPC: Boolean(character.isNPC),
                    inPlayerParty: Boolean(inPlayerParty),
                    locationId: summary.locationId,
                    locationName: summary.locationName
                });
            };

            for (const character of allCharacters) {
                if (!character?.isNPC) {
                    continue;
                }
                const locationId = toTrimmedString(character.currentLocation || character.locationId);
                if (locationId && locationId === targetLocation.id) {
                    addCharacter(character, { inPlayerParty: false });
                }
            }

            const playerAtLocation = Boolean(currentPlayer && toTrimmedString(currentPlayer.currentLocation) === targetLocation.id);
            if (playerAtLocation && currentPlayer) {
                addCharacter(currentPlayer, { inPlayerParty: false });
                if (typeof currentPlayer.getPartyMembers === 'function') {
                    const partyMembers = currentPlayer.getPartyMembers();
                    const membersArray = Array.isArray(partyMembers)
                        ? partyMembers
                        : (partyMembers instanceof Set ? Array.from(partyMembers) : []);
                    for (const partyEntry of membersArray) {
                        if (!partyEntry) {
                            continue;
                        }
                        const partyMember = typeof partyEntry === 'string'
                            ? (allCharacters.find(character => character?.id === partyEntry) || null)
                            : partyEntry;
                        if (partyMember) {
                            addCharacter(partyMember, { inPlayerParty: true });
                        }
                    }
                }
            }

            characterRows.sort(candidateSort);
        }

        const thingRows = [];
        if (includeThings) {
            const allThings = getAllThings();
            const seenThingIds = new Set();
            if (Array.isArray(targetLocation.thingIds)) {
                for (const thingId of targetLocation.thingIds) {
                    const normalizedThingId = toTrimmedString(thingId);
                    if (!normalizedThingId) {
                        continue;
                    }
                    seenThingIds.add(normalizedThingId);
                }
            }

            for (const thingRecord of allThings) {
                const metadata = thingRecord?.metadata && typeof thingRecord.metadata === 'object'
                    ? thingRecord.metadata
                    : {};
                const thingLocationId = toTrimmedString(metadata.locationId || metadata.locationID);
                if (thingLocationId && thingLocationId === targetLocation.id) {
                    seenThingIds.add(toTrimmedString(thingRecord.id));
                }
            }

            for (const thingId of seenThingIds) {
                const thingRecord = allThings.find(entry => toTrimmedString(entry?.id) === thingId) || null;
                thingRows.push({
                    id: thingId,
                    name: toTrimmedString(thingRecord?.name) || thingId,
                    thingType: toTrimmedString(thingRecord?.thingType) || null
                });
            }
            thingRows.sort(candidateSort);
        }

        const lines = [
            '<listLocationEntitiesResult>',
            ...renderXmlNode('location', {
                id: targetLocation.id || null,
                name: targetLocation.name || null,
                regionId: locationRegionId(targetLocation),
                regionName: locationRegionName(targetLocation)
            }, 1),
            `  <characters count="${characterRows.length}">`
        ];
        for (const row of characterRows) {
            lines.push(...renderXmlNode('character', row, 2));
        }
        lines.push('  </characters>');
        lines.push(`  <things count="${thingRows.length}">`);
        for (const row of thingRows) {
            lines.push(...renderXmlNode('thing', row, 2));
        }
        lines.push('  </things>');
        lines.push('</listLocationEntitiesResult>');

        return {
            content: lines.join('\n'),
            metadata: {
                locationId: targetLocation.id || null,
                entityType: entityFilter,
                characterCount: characterRows.length,
                thingCount: thingRows.length
            }
        };
    };

    const executeCreateThingTool = async ({
        shortDescription,
        itemOrScenery,
        location = null,
        region = null,
        name = null,
        description = null,
        notes = null,
        type = null,
        slot = null,
        rarity = null,
        value = null,
        weight = null,
        relativeLevel = null,
        isVehicle = null,
        isCraftingStation = null,
        isProcessingStation = null,
        isHarvestable = null,
        isSalvageable = null,
        attributeBonuses = null,
        causeStatusEffectOnTarget = null,
        causeStatusEffectOnEquipper = null,
        properties = null
    } = {}) => {
        const functionName = 'createThing';
        const shortDescriptionValue = normalizeRequiredString(shortDescription, {
            functionName,
            fieldName: 'shortDescription'
        });
        const itemOrSceneryValue = normalizeRequiredString(itemOrScenery, {
            functionName,
            fieldName: 'itemOrScenery'
        }).toLowerCase();
        if (itemOrSceneryValue !== 'item' && itemOrSceneryValue !== 'scenery') {
            throw new ToolVisibleError(
                'createThing "itemOrScenery" must be either "item" or "scenery".',
                { code: 'invalid_arguments' }
            );
        }

        const locationQuery = normalizeOptionalString(location);
        const regionQuery = normalizeOptionalString(region);
        let targetLocation = null;
        if (locationQuery) {
            targetLocation = resolveLocationReference(locationQuery, {
                fieldName: 'location',
                regionQuery
            });
        } else {
            const currentPlayer = getCurrentPlayer();
            if (!currentPlayer || !toTrimmedString(currentPlayer.currentLocation)) {
                throw new ToolVisibleError(
                    'createThing requires "location" when no current player location is available.',
                    { code: 'missing_location' }
                );
            }
            targetLocation = getLocationByIdLoose(currentPlayer.currentLocation);
            if (!targetLocation) {
                throw new ToolVisibleError(
                    `createThing could not find current player location "${currentPlayer.currentLocation}".`,
                    { code: 'missing_location' }
                );
            }
        }

        const normalizeEffect = (rawValue, fieldName) => {
            if (rawValue === null || rawValue === undefined || rawValue === '') {
                return null;
            }
            if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
                throw new ToolVisibleError(
                    `createThing "${fieldName}" must be an object when provided.`,
                    { code: 'invalid_arguments' }
                );
            }
            const effectName = normalizeOptionalString(rawValue.name);
            const effectDescription = normalizeOptionalString(rawValue.description);
            const effectDuration = normalizeOptionalString(rawValue.duration);
            if (!effectName && !effectDescription && !effectDuration) {
                return null;
            }
            return {
                name: effectName || '',
                description: effectDescription || '',
                duration: effectDuration || ''
            };
        };

        const seed = {
            shortDescription: shortDescriptionValue,
            itemOrScenery: itemOrSceneryValue
        };

        const requestedName = normalizeOptionalString(name);
        if (requestedName) seed.name = requestedName;
        const descriptionValue = normalizeOptionalString(description);
        if (descriptionValue) seed.description = descriptionValue;
        const notesValue = normalizeOptionalString(notes);
        if (notesValue) seed.notes = notesValue;
        const typeValue = normalizeOptionalString(type);
        if (typeValue) seed.type = typeValue;
        const slotValue = normalizeOptionalString(slot);
        if (slotValue) seed.slot = slotValue;
        const rarityValue = normalizeOptionalString(rarity);
        if (rarityValue) seed.rarity = rarityValue;

        const valueNumber = normalizeOptionalNumber(value, { functionName, fieldName: 'value' });
        if (valueNumber !== null) seed.value = valueNumber;
        const weightNumber = normalizeOptionalNumber(weight, { functionName, fieldName: 'weight' });
        if (weightNumber !== null) seed.weight = weightNumber;
        const relativeLevelInteger = normalizeOptionalInteger(relativeLevel, { functionName, fieldName: 'relativeLevel' });
        if (relativeLevelInteger !== null) seed.relativeLevel = relativeLevelInteger;

        const isVehicleValue = normalizeOptionalBoolean(isVehicle, { functionName, fieldName: 'isVehicle' });
        if (isVehicleValue !== null) seed.isVehicle = isVehicleValue;
        const isCraftingStationValue = normalizeOptionalBoolean(isCraftingStation, { functionName, fieldName: 'isCraftingStation' });
        if (isCraftingStationValue !== null) seed.isCraftingStation = isCraftingStationValue;
        const isProcessingStationValue = normalizeOptionalBoolean(isProcessingStation, { functionName, fieldName: 'isProcessingStation' });
        if (isProcessingStationValue !== null) seed.isProcessingStation = isProcessingStationValue;
        const isHarvestableValue = normalizeOptionalBoolean(isHarvestable, { functionName, fieldName: 'isHarvestable' });
        if (isHarvestableValue !== null) seed.isHarvestable = isHarvestableValue;
        const isSalvageableValue = normalizeOptionalBoolean(isSalvageable, { functionName, fieldName: 'isSalvageable' });
        if (isSalvageableValue !== null) seed.isSalvageable = isSalvageableValue;

        if (attributeBonuses !== null && attributeBonuses !== undefined) {
            if (!Array.isArray(attributeBonuses)) {
                throw new ToolVisibleError(
                    'createThing "attributeBonuses" must be an array when provided.',
                    { code: 'invalid_arguments' }
                );
            }
            seed.attributeBonuses = attributeBonuses.map((entry, index) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                    throw new ToolVisibleError(
                        `createThing "attributeBonuses[${index}]" must be an object.`,
                        { code: 'invalid_arguments' }
                    );
                }
                const attributeName = normalizeRequiredString(entry.attribute, {
                    functionName,
                    fieldName: `attributeBonuses[${index}].attribute`
                });
                const bonusValue = normalizeOptionalNumber(entry.bonus, {
                    functionName,
                    fieldName: `attributeBonuses[${index}].bonus`
                });
                if (bonusValue === null) {
                    throw new ToolVisibleError(
                        `createThing "attributeBonuses[${index}].bonus" is required.`,
                        { code: 'invalid_arguments' }
                    );
                }
                return { attribute: attributeName, bonus: bonusValue };
            });
        }

        const effectOnTarget = normalizeEffect(causeStatusEffectOnTarget, 'causeStatusEffectOnTarget');
        if (effectOnTarget) seed.causeStatusEffectOnTarget = effectOnTarget;
        const effectOnEquipper = normalizeEffect(causeStatusEffectOnEquipper, 'causeStatusEffectOnEquipper');
        if (effectOnEquipper) seed.causeStatusEffectOnEquipper = effectOnEquipper;
        const propertiesValue = normalizeOptionalString(properties);
        if (propertiesValue) seed.properties = propertiesValue;

        const targetRegion = findRegionByLocationId(targetLocation.id) || null;
        const generated = await generateItemsByNames({
            itemNames: [],
            location: targetLocation,
            owner: null,
            region: targetRegion,
            seeds: [seed],
            options: itemOrSceneryValue === 'scenery' ? { treatAsScenery: true } : {}
        });

        if (!Array.isArray(generated) || !generated.length) {
            throw new ToolVisibleError(
                'Thing generation did not return a created thing.',
                { code: 'thing_generation_failed' }
            );
        }

        const createdThing = generated[0];
        const finalName = normalizeOptionalString(createdThing?.name);
        if (!finalName) {
            throw new ToolVisibleError(
                'Thing generation completed but final name is missing.',
                { code: 'thing_generation_failed' }
            );
        }

        const lines = [
            '<createThingResult>',
            '  <status>success</status>',
            ...renderXmlNode('thing', {
                id: createdThing?.id || null,
                requestedName: requestedName || null,
                finalName,
                thingType: createdThing?.thingType || null,
                locationId: targetLocation.id || null,
                locationName: targetLocation.name || null,
                regionId: locationRegionId(targetLocation),
                regionName: locationRegionName(targetLocation)
            }, 1),
            '</createThingResult>'
        ];

        return {
            content: lines.join('\n'),
            metadata: {
                status: 'success',
                thingId: createdThing?.id || null,
                requestedName: requestedName || null,
                finalName,
                thingType: createdThing?.thingType || null,
                locationId: targetLocation.id || null
            }
        };
    };

    const findThingContainerLocation = (thingId) => {
        const normalizedThingId = toTrimmedString(thingId);
        if (!normalizedThingId) {
            return null;
        }
        for (const location of getAllLocations()) {
            if (!location || !Array.isArray(location.thingIds)) {
                continue;
            }
            if (location.thingIds.includes(normalizedThingId)) {
                return location;
            }
        }
        return null;
    };

    const buildLocateThingEntry = (thing) => {
        const metadata = thing?.metadata && typeof thing.metadata === 'object'
            ? thing.metadata
            : {};
        const ownerId = toTrimmedString(metadata.ownerId || metadata.owner || metadata.ownerID) || null;
        const owner = ownerId
            ? getAllCharacters().find(candidate => toTrimmedString(candidate?.id) === ownerId) || null
            : null;

        let locationSummary = null;
        if (owner) {
            const ownerLocationId = toTrimmedString(owner.currentLocation || owner.locationId) || null;
            locationSummary = describeLocationSummary(ownerLocationId);
        }

        if (!locationSummary) {
            const metadataLocationId = toTrimmedString(metadata.locationId || metadata.locationID) || null;
            if (metadataLocationId) {
                locationSummary = describeLocationSummary(metadataLocationId);
            }
        }

        if (!locationSummary) {
            const indexedLocation = findThingContainerLocation(thing?.id);
            if (indexedLocation) {
                locationSummary = describeLocationSummary(indexedLocation.id);
            }
        }

        return {
            id: toTrimmedString(thing?.id) || null,
            name: toTrimmedString(thing?.name) || null,
            thingType: toTrimmedString(thing?.thingType) || null,
            ownerId: ownerId || null,
            ownerName: toTrimmedString(owner?.name) || null,
            inInventory: Boolean(ownerId),
            locationId: locationSummary?.locationId || null,
            locationName: locationSummary?.locationName || null,
            regionId: locationSummary?.regionId || null,
            regionName: locationSummary?.regionName || null
        };
    };

    const executeLocateNpcsTool = ({
        query
    } = {}) => {
        const functionName = 'locateNpcs';
        const normalizedQuery = normalizeRequiredString(query, {
            functionName,
            fieldName: 'query'
        });
        const queryLower = normalizedQuery.toLowerCase();

        const allNpcs = getAllCharacters().filter(character => character?.isNPC === true);
        const isExactNpcMatch = (npc) => {
            const name = toTrimmedString(npc?.name).toLowerCase();
            if (name && name === queryLower) {
                return true;
            }
            const aliases = npcAliasesForMatching(npc).map(alias => toTrimmedString(alias).toLowerCase()).filter(Boolean);
            return aliases.includes(queryLower);
        };
        const isLooseNpcMatch = (npc) => {
            const name = toTrimmedString(npc?.name).toLowerCase();
            if (name && name.includes(queryLower)) {
                return true;
            }
            const aliases = npcAliasesForMatching(npc).map(alias => toTrimmedString(alias).toLowerCase()).filter(Boolean);
            return aliases.some(alias => alias.includes(queryLower));
        };

        const exactMatches = allNpcs.filter(isExactNpcMatch);
        const looseMatches = allNpcs.filter(isLooseNpcMatch);
        const matches = exactMatches.length ? exactMatches : looseMatches;

        const entries = matches
            .map(npc => {
                const summary = describeLocationSummary(npc.currentLocation || npc.locationId || null);
                return {
                    id: toTrimmedString(npc.id) || null,
                    name: toTrimmedString(npc.name) || null,
                    locationId: summary.locationId || null,
                    locationName: summary.locationName || null,
                    regionId: summary.regionId || null,
                    regionName: summary.regionName || null
                };
            })
            .sort(candidateSort);

        const lines = [
            '<locateNpcsResult>',
            `  <query>${xmlEscapeText(normalizedQuery)}</query>`,
            `  <count>${entries.length}</count>`,
            `  <npcs count="${entries.length}">`
        ];
        for (const entry of entries) {
            lines.push(...renderXmlNode('npc', entry, 2));
        }
        lines.push('  </npcs>');
        lines.push('</locateNpcsResult>');

        return {
            content: lines.join('\n'),
            metadata: {
                query: normalizedQuery,
                count: entries.length,
                npcIds: entries.map(entry => entry.id).filter(Boolean)
            }
        };
    };

    const executeLocateThingsTool = ({
        query
    } = {}) => {
        const functionName = 'locateThings';
        const normalizedQuery = normalizeRequiredString(query, {
            functionName,
            fieldName: 'query'
        });
        const queryLower = normalizedQuery.toLowerCase();

        const allThings = getAllThings();
        const exactMatches = allThings.filter(thing => {
            const thingId = toTrimmedString(thing?.id);
            const thingName = toTrimmedString(thing?.name).toLowerCase();
            return (thingId && thingId === normalizedQuery) || (thingName && thingName === queryLower);
        });
        const looseMatches = allThings.filter(thing => {
            const thingName = toTrimmedString(thing?.name).toLowerCase();
            return Boolean(thingName && thingName.includes(queryLower));
        });
        const matches = exactMatches.length ? exactMatches : looseMatches;

        const entries = matches
            .map(buildLocateThingEntry)
            .sort(candidateSort);

        const lines = [
            '<locateThingsResult>',
            `  <query>${xmlEscapeText(normalizedQuery)}</query>`,
            `  <count>${entries.length}</count>`,
            `  <things count="${entries.length}">`
        ];
        for (const entry of entries) {
            lines.push(...renderXmlNode('thing', entry, 2));
        }
        lines.push('  </things>');
        lines.push('</locateThingsResult>');

        return {
            content: lines.join('\n'),
            metadata: {
                query: normalizedQuery,
                count: entries.length,
                thingIds: entries.map(entry => entry.id).filter(Boolean)
            }
        };
    };

    const executeMoreInfoTool = ({ name, type = null }) => {
        if (typeof name !== 'string' || !name.trim()) {
            throw new Error('moreInfo requires a non-empty "name" string.');
        }
        const query = name.trim();
        const requestedType = normalizeMoreInfoType(type);
        const includeCharacters = requestedType === null || requestedType === 'character';
        const includeThings = requestedType === null || requestedType === 'thing';
        const includeLocations = requestedType === null || requestedType === 'location';
        const includeRegions = requestedType === null || requestedType === 'region';
        const queryLower = query.toLowerCase();
        const nameIncludesQuery = (candidate) => (
            typeof candidate === 'string' && candidate.toLowerCase().includes(queryLower)
        );

        const allActors = includeCharacters && typeof Player?.getAll === 'function' ? Player.getAll() : [];
        const allThings = includeThings && typeof Thing?.getAll === 'function' ? Thing.getAll() : [];
        const allLocations = includeLocations && typeof Location?.getAll === 'function' ? Location.getAll() : [];
        const allRegions = includeRegions && typeof Region?.getAll === 'function' ? Region.getAll() : [];

        const matchedNpcs = Array.isArray(allActors)
            ? allActors.filter(actor => {
                if (!actor || actor.isNPC !== true) {
                    return false;
                }
                if (nameIncludesQuery(actor.name)) {
                    return true;
                }
                const aliases = npcAliasesForMatching(actor);
                return aliases.some(alias => nameIncludesQuery(alias));
            })
            : [];

        const matchedThings = Array.isArray(allThings)
            ? allThings.filter(thing => thing && nameIncludesQuery(thing.name))
            : [];

        const matchedLocations = Array.isArray(allLocations)
            ? allLocations.filter(location => location && nameIncludesQuery(location.name))
            : [];

        const matchedRegions = Array.isArray(allRegions)
            ? allRegions.filter(region => region && nameIncludesQuery(region.name))
            : [];

        const totalMatches = matchedNpcs.length
            + matchedThings.length
            + matchedLocations.length
            + matchedRegions.length;

        if (totalMatches > MORE_INFO_MAX_MATCHES) {
            throw new Error(`moreInfo("${query}") matched ${totalMatches} entities, exceeding the limit of ${MORE_INFO_MAX_MATCHES}. Provide a narrower query.`);
        }

        const lines = [
            '<moreInfoResults>',
            `  <query>${xmlEscapeText(query)}</query>`,
            `  <type>${xmlEscapeText(requestedType || 'any')}</type>`,
            `  <totalMatches>${totalMatches}</totalMatches>`,
            `  <npcs count="${matchedNpcs.length}">`
        ];

        for (const npc of matchedNpcs) {
            const snapshot = serializeNpcForClient(npc) || npc.toJSON?.() || {};
            const playerDisplay = buildPlayerDisplayModel(snapshot);
            lines.push(...renderTemplatedXmlNode({
                tagName: 'npc',
                templateName: 'player.njk',
                context: { player: playerDisplay },
                level: 2,
                attributes: { id: npc.id || '', name: npc.name || '' }
            }));
        }
        lines.push('  </npcs>');
        lines.push(`  <things count="${matchedThings.length}">`);
        for (const thing of matchedThings) {
            const snapshot = typeof thing.toJSON === 'function' ? thing.toJSON() : thing;
            const thingDisplay = buildThingDisplayModel(snapshot);
            lines.push(...renderTemplatedXmlNode({
                tagName: 'thing',
                templateName: 'thing.njk',
                context: { thing: thingDisplay },
                level: 2,
                attributes: { id: thing.id || '', name: thing.name || '' }
            }));
        }
        lines.push('  </things>');
        lines.push(`  <locations count="${matchedLocations.length}">`);
        for (const locationEntry of matchedLocations) {
            const snapshot = buildLocationResponse(locationEntry) || (typeof locationEntry.toJSON === 'function' ? locationEntry.toJSON() : locationEntry);
            const locationDisplay = buildLocationDisplayModel(snapshot);
            lines.push(...renderTemplatedXmlNode({
                tagName: 'location',
                templateName: 'location.njk',
                context: { location: locationDisplay },
                level: 2,
                attributes: { id: locationEntry.id || '', name: locationEntry.name || '' }
            }));
        }
        lines.push('  </locations>');
        lines.push(`  <regions count="${matchedRegions.length}">`);
        for (const regionEntry of matchedRegions) {
            const regionDisplay = buildRegionDisplayModel(regionEntry);
            lines.push(...renderTemplatedXmlNode({
                tagName: 'region',
                templateName: 'region.njk',
                context: { region: regionDisplay },
                level: 2,
                attributes: { id: regionEntry.id || '', name: regionEntry.name || '' }
            }));
        }
        lines.push('  </regions>');
        lines.push('</moreInfoResults>');

        return {
            content: lines.join('\n'),
            metadata: {
                query,
                type: requestedType || null,
                totalMatches,
                counts: {
                    npcs: matchedNpcs.length,
                    things: matchedThings.length,
                    locations: matchedLocations.length,
                    regions: matchedRegions.length
                }
            }
        };
    };

    const collectHistoryMatches = ({
        query,
        startIndex = null,
        count = null,
        includeFullContent = true
    } = {}) => {
        const queries = normalizeHistoryQueries(query);
        const normalizedStartIndex = normalizeOptionalPositiveInteger(startIndex, 'startIndex');
        const normalizedCount = normalizeOptionalPositiveInteger(count, 'count');
        const chatHistory = getChatHistory();
        if (!Array.isArray(chatHistory)) {
            throw new Error('Chat history is unavailable for getHistory.');
        }

        const queryLower = queries.map(entry => entry.toLowerCase());
        const matches = [];

        for (let index = 0; index < chatHistory.length; index += 1) {
            const entry = chatHistory[index];
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            if (!isAssistantProseLikeEntry(entry)) {
                continue;
            }
            const content = typeof entry.content === 'string' ? entry.content : '';
            if (!content.trim()) {
                continue;
            }
            const contentLower = content.toLowerCase();
            if (!queryLower.every(term => contentLower.includes(term))) {
                continue;
            }

            const match = {
                index,
                id: typeof entry.id === 'string' ? entry.id : null,
                type: typeof entry.type === 'string' ? entry.type : null,
                role: typeof entry.role === 'string' ? entry.role : null,
                timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null,
                locationId: typeof entry.locationId === 'string' ? entry.locationId : null
            };

            if (includeFullContent) {
                match.content = content;
            } else {
                const trimmedContent = content.trim();
                match.preview = trimmedContent.length > 220
                    ? `${trimmedContent.slice(0, 220)}...`
                    : trimmedContent;
            }

            matches.push(match);
        }

        const effectiveStartIndex = normalizedStartIndex === null ? 1 : normalizedStartIndex;
        const startOffset = effectiveStartIndex - 1;
        const slicedMatches = normalizedCount === null
            ? matches.slice(startOffset)
            : matches.slice(startOffset, startOffset + normalizedCount);

        return {
            query: queries.length === 1 ? queries[0] : null,
            queries,
            totalMatches: matches.length,
            startIndex: effectiveStartIndex,
            count: normalizedCount,
            returnedCount: slicedMatches.length,
            entries: slicedMatches
        };
    };

    const executeGetHistoryTool = ({ query, startIndex = null, count = null }) => {
        const historyResult = collectHistoryMatches({
            query,
            startIndex,
            count,
            includeFullContent: true
        });
        const lines = [
            '<historyResults>',
            `  <queries count="${historyResult.queries.length}">`,
            ...historyResult.queries.map(entry => `    <query>${xmlEscapeText(entry)}</query>`),
            '  </queries>',
            `  <startIndex>${historyResult.startIndex}</startIndex>`
        ];
        if (historyResult.count !== null) {
            lines.push(`  <count>${historyResult.count}</count>`);
        }
        lines.push(
            `  <returnedCount>${historyResult.returnedCount}</returnedCount>`,
            `  <totalMatches>${historyResult.totalMatches}</totalMatches>`,
            `  <entries count="${historyResult.entries.length}">`
        );

        for (const entry of historyResult.entries) {
            const serializedEntry = {
                id: entry.id,
                type: entry.type,
                role: entry.role,
                timestamp: entry.timestamp,
                locationId: entry.locationId,
                content: entry.content
            };
            lines.push(...renderXmlNode('entry', serializedEntry, 2, { index: entry.index }));
        }

        lines.push('  </entries>');
        lines.push('</historyResults>');

        return {
            content: lines.join('\n'),
            metadata: {
                query: historyResult.query,
                queries: historyResult.queries,
                startIndex: historyResult.startIndex,
                count: historyResult.count,
                returnedCount: historyResult.returnedCount,
                totalMatches: historyResult.totalMatches,
                entryIndexes: historyResult.entries.map(entry => entry.index)
            }
        };
    };

    const TOOL_FUNCTIONS_WITH_VISIBLE_ERRORS = new Set([
        'teleportCharacterToLocation',
        'teleportThingToLocation',
        'moveThingFromLocationToCharacterInventory',
        'createRegionStub',
        'createExit',
        'listLocationEntities',
        'createThing',
        'locateNpcs',
        'locateThings'
    ]);

    const executeChatToolCall = async (toolCall) => {
        if (!toolCall || typeof toolCall !== 'object') {
            throw new Error('Tool execution requires a tool call object.');
        }
        try {
            if (toolCall.functionName === 'moreInfo') {
                return executeMoreInfoTool(toolCall.argumentsObject || {});
            }
            if (toolCall.functionName === 'getHistory') {
                return executeGetHistoryTool(toolCall.argumentsObject || {});
            }
            if (toolCall.functionName === 'teleportCharacterToLocation') {
                return executeTeleportCharacterToLocationTool(toolCall.argumentsObject || {});
            }
            if (toolCall.functionName === 'teleportThingToLocation') {
                return executeTeleportThingToLocationTool(toolCall.argumentsObject || {});
            }
            if (toolCall.functionName === 'moveThingFromLocationToCharacterInventory') {
                return executeMoveThingFromLocationToCharacterInventoryTool(toolCall.argumentsObject || {});
            }
            if (toolCall.functionName === 'createRegionStub') {
                return executeCreateRegionStubTool(toolCall.argumentsObject || {});
            }
            if (toolCall.functionName === 'createExit') {
                return executeCreateExitTool(toolCall.argumentsObject || {});
            }
            if (toolCall.functionName === 'listLocationEntities') {
                return executeListLocationEntitiesTool(toolCall.argumentsObject || {});
            }
            if (toolCall.functionName === 'createThing') {
                return executeCreateThingTool(toolCall.argumentsObject || {});
            }
            if (toolCall.functionName === 'locateNpcs') {
                return executeLocateNpcsTool(toolCall.argumentsObject || {});
            }
            if (toolCall.functionName === 'locateThings') {
                return executeLocateThingsTool(toolCall.argumentsObject || {});
            }
        } catch (error) {
            if (error instanceof ToolVisibleError) {
                return buildToolVisibleErrorResult(toolCall.functionName, error);
            }
            if (TOOL_FUNCTIONS_WITH_VISIBLE_ERRORS.has(toolCall.functionName)) {
                const visibleError = new ToolVisibleError(
                    error?.message || `Tool "${toolCall.functionName}" failed.`,
                    { code: 'tool_execution_error' }
                );
                return buildToolVisibleErrorResult(toolCall.functionName, visibleError);
            }
            throw error;
        }
        throw new Error(`Unsupported tool call function "${toolCall.functionName}".`);
    };

    const runChatCompletionWithToolLoop = async ({
        requestOptions,
        streamEmitter = null,
        metadataLabel = 'chat'
    }) => {
        if (!requestOptions || typeof requestOptions !== 'object') {
            throw new Error('runChatCompletionWithToolLoop requires requestOptions.');
        }
        if (!Array.isArray(requestOptions.messages) || !requestOptions.messages.length) {
            throw new Error('runChatCompletionWithToolLoop requires non-empty requestOptions.messages.');
        }

        const config = getConfig();
        const configuredMaxRounds = Number(config?.ai?.max_tool_rounds);
        const maxRounds = Number.isInteger(configuredMaxRounds) && configuredMaxRounds > 0
            ? configuredMaxRounds
            : CHAT_TOOL_MAX_ROUNDS;
        const originalOnResponse = typeof requestOptions.onResponse === 'function'
            ? requestOptions.onResponse
            : null;
        const messages = requestOptions.messages.map(message => (
            message && typeof message === 'object'
                ? JSON.parse(JSON.stringify(message))
                : message
        ));

        let aiResponse = '';
        let lastResponse = null;
        let rounds = 0;
        let completed = false;
        let toolLoopActivated = false;
        const toolInvocations = [];

        while (!completed) {
            rounds += 1;
            if (rounds > maxRounds) {
                throw new Error(`Tool-call loop exceeded max rounds (${maxRounds}) for ${metadataLabel}.`);
            }

            let roundResponse = null;
            const roundOptions = {
                ...requestOptions,
                messages,
                onResponse: (response) => {
                    roundResponse = response;
                    if (originalOnResponse) {
                        originalOnResponse(response);
                    }
                }
            };

            aiResponse = await LLMClient.chatCompletion(roundOptions);
            lastResponse = roundResponse;

            const assistantMessage = roundResponse?.data?.choices?.[0]?.message || null;
            const rawToolCalls = Array.isArray(assistantMessage?.tool_calls)
                ? assistantMessage.tool_calls
                : [];
            const toolCalls = normalizeToolCallsForExecution(rawToolCalls, {
                sourceLabel: `${metadataLabel} round ${rounds}`
            });

            if (toolLoopActivated || toolCalls.length) {
                const roundLabel = `${metadataLabel}_tool_loop_round`;
                LLMClient.logPrompt({
                    prefix: roundLabel,
                    metadataLabel: roundLabel,
                    systemPrompt: '',
                    generationPrompt: LLMClient.formatMessagesForErrorLog(messages),
                    response: aiResponse || ''
                });
            }

            if (!toolCalls.length) {
                completed = true;
                continue;
            }
            toolLoopActivated = true;

            if (streamEmitter?.isEnabled) {
                streamEmitter.status('player_action:tool_calls', {
                    round: rounds,
                    toolCallCount: toolCalls.length,
                    message: `Running ${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}...`
                });
            }

            messages.push({
                role: 'assistant',
                content: typeof assistantMessage?.content === 'string' ? assistantMessage.content : (aiResponse || ''),
                tool_calls: toolCalls.map(call => ({
                    id: call.id,
                    type: 'function',
                    function: {
                        name: call.functionName,
                        arguments: call.argumentsText
                    }
                }))
            });

            for (const toolCall of toolCalls) {
                const toolResult = await executeChatToolCall(toolCall);
                if (!toolResult || typeof toolResult.content !== 'string' || !toolResult.content.trim()) {
                    throw new Error(`Tool "${toolCall.functionName}" returned empty content.`);
                }
                toolInvocations.push({
                    id: toolCall.id,
                    name: toolCall.functionName,
                    metadata: toolResult.metadata || null
                });
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    name: toolCall.functionName,
                    content: toolResult.content
                });
            }
        }

        return {
            aiResponse,
            response: lastResponse,
            rounds,
            toolInvocations
        };
    };

    return {
        CHAT_TOOL_DEFINITIONS,
        collectHistoryMatches,
        runChatCompletionWithToolLoop
    };
};

module.exports = {
    CHAT_TOOL_DEFINITIONS,
    createChatToolRuntime
};
