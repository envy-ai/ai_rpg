const BASE_TIMEOUT_MS = 120000;
const DEFAULT_STATUS_DURATION = 3;
const MAJOR_STATUS_DURATION = 5;

const EVENT_PROMPT_ORDER = [
    { index: 1, key: 'new_exit_discovered' },
    { index: 2, key: 'alter_location' },
    { index: 3, key: 'currency' },
    { index: 4, key: 'item_to_npc' },
    { index: 5, key: 'consume_item' },
    { index: 6, key: 'alter_item' },
    { index: 7, key: 'transfer_item' },
    { index: 8, key: 'harvest_gather' },
    { index: 9, key: 'pick_up_item' },
    { index: 10, key: 'drop_item' },
    { index: 11, key: 'item_appear' },
    { index: 12, key: 'scenery_appear' },
    { index: 13, key: 'harvestable_resource_appear' },
    { index: 14, key: 'alter_npc' },
    { index: 15, key: 'status_effect_change' },
    { index: 16, key: 'npc_arrival_departure', postProcess: entry => ({ ...entry, action: entry?.action || 'left' }) },
    { index: 17, key: 'npc_arrival_departure', postProcess: entry => ({ ...entry, action: entry?.action || 'arrived' }) },
    { index: 18, key: 'npc_first_appearance' },
    { index: 19, key: 'party_change' },
    { index: 20, key: 'environmental_status_damage' },
    { index: 21, key: 'heal_recover' },
    { index: 22, key: 'needbar_change' },
    { index: 23, key: 'attack_damage' },
    { index: 24, key: 'death_incapacitation' },
    { index: 25, key: 'defeated_enemy' },
    { index: 26, key: 'experience_check' },
    { index: 27, key: 'move_location' }
];

const NO_EVENT_TOKENS = new Set(['n/a', 'na', 'none', 'nothing']);

function isBlank(value) {
    return !value || (typeof value === 'string' && !value.trim());
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function splitPipeList(raw) {
    if (isBlank(raw)) {
        return [];
    }
    return raw
        .split('|')
        .map(part => part.trim())
        .filter(part => part.length > 0 && !NO_EVENT_TOKENS.has(part.toLowerCase()));
}

function splitArrowParts(raw, expectedParts) {
    if (isBlank(raw)) {
        return [];
    }
    const parts = raw
        .split('->')
        .map(part => part.trim())
        .filter(Boolean);

    if (!expectedParts || parts.length < expectedParts) {
        return parts;
    }

    if (expectedParts === 2) {
        return [parts[0], parts.slice(1).join(' -> ')];
    }

    if (expectedParts === 3) {
        return [parts[0], parts[1], parts.slice(2).join(' -> ')];
    }

    if (expectedParts === 4) {
        return [parts[0], parts[1], parts[2], parts.slice(3).join(' -> ')];
    }

    return parts;
}

function extractInteger(raw) {
    if (typeof raw !== 'string') {
        return null;
    }
    const match = raw.match(/(-?\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

function ensureArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (value === null || value === undefined) {
        return [];
    }
    return [value];
}

function flattenAndFilter(list) {
    const result = [];
    for (const entry of list) {
        if (Array.isArray(entry)) {
            result.push(...entry);
        } else if (entry !== null && entry !== undefined) {
            result.push(entry);
        }
    }
    return result;
}

function makeStatusEffect(description, duration = null) {
    return { description, duration };
}

class Events {
    static DEFAULT_STATUS_DURATION = DEFAULT_STATUS_DURATION;
    static MAJOR_STATUS_DURATION = MAJOR_STATUS_DURATION;
    static _deps = {};
    static _parsers = {};
    static _aggregators = {};
    static _handlers = {};
    static _baseTimeout = BASE_TIMEOUT_MS;

    static initialize(deps = {}) {
        if (!deps) {
            throw new Error('Events.initialize requires a dependency object.');
        }

        this._deps = { ...deps };
        this._baseTimeout = Number.isFinite(deps.baseTimeoutMilliseconds) && deps.baseTimeoutMilliseconds > 0
            ? deps.baseTimeoutMilliseconds
            : BASE_TIMEOUT_MS;

        this.DEFAULT_STATUS_DURATION = deps.defaultStatusDuration ?? DEFAULT_STATUS_DURATION;
        this.MAJOR_STATUS_DURATION = deps.majorStatusDuration ?? MAJOR_STATUS_DURATION;

        this._parsers = this._buildParsers();
        this._aggregators = this._buildAggregators();
        this._handlers = this._buildHandlers();
    }

    static async runEventChecks({ textToCheck, stream = null, allowEnvironmentalEffects = true, isNpcTurn = false } = {}) {
        if (isBlank(textToCheck)) {
            return null;
        }

        const promptEnv = this._deps.promptEnv;
        const parseXMLTemplate = this._deps.parseXMLTemplate;
        const axios = this._deps.axios;
        const prepareBasePromptContext = this._deps.prepareBasePromptContext;
        const Location = this._deps.Location;
        const findRegionByLocationId = this._deps.findRegionByLocationId;

        if (typeof promptEnv?.render !== 'function') {
            throw new Error('promptEnv.render dependency is not configured.');
        }
        if (typeof parseXMLTemplate !== 'function') {
            throw new Error('parseXMLTemplate dependency is not configured.');
        }
        if (typeof axios?.post !== 'function') {
            throw new Error('axios dependency is not configured.');
        }
        if (typeof prepareBasePromptContext !== 'function') {
            throw new Error('prepareBasePromptContext dependency is not configured.');
        }

        const config = this.config || {};
        const endpoint = config?.ai?.endpoint;
        const apiKey = config?.ai?.apiKey;
        const model = config?.ai?.model;

        if (!endpoint || !apiKey || !model) {
            console.warn('AI configuration missing; skipping event analysis.');
            return null;
        }

        const currentPlayer = this.currentPlayer;
        let location = null;
        if (currentPlayer?.currentLocation && Location && typeof Location.get === 'function') {
            try {
                location = Location.get(currentPlayer.currentLocation) || null;
            } catch (_) {
                location = null;
            }
        }

        let region = null;
        if (location && typeof findRegionByLocationId === 'function') {
            try {
                region = findRegionByLocationId(location.id);
            } catch (_) {
                region = null;
            }
        }

        const baseContext = await prepareBasePromptContext({ locationOverride: location });
        const rendered = promptEnv.render('base-context.xml.njk', {
            ...baseContext,
            promptType: 'event-checks',
            textToCheck
        });

        const parsedTemplate = parseXMLTemplate(rendered);
        if (!parsedTemplate?.systemPrompt || !parsedTemplate?.generationPrompt) {
            throw new Error('Event check template did not produce prompts.');
        }

        const chatEndpoint = endpoint.endsWith('/') ? `${endpoint}chat/completions` : `${endpoint}/chat/completions`;
        const messages = [
            { role: 'system', content: parsedTemplate.systemPrompt },
            { role: 'user', content: parsedTemplate.generationPrompt }
        ];

        const requestData = {
            model,
            messages,
            max_tokens: parsedTemplate.maxTokens || 600,
            temperature: 0
        };

        const response = await axios.post(chatEndpoint, requestData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: this._baseTimeout
        });

        const responseText = response.data?.choices?.[0]?.message?.content || '';

        this.logEventCheck({
            systemPrompt: parsedTemplate.systemPrompt,
            generationPrompt: parsedTemplate.generationPrompt,
            responseText
        });

        if (isBlank(responseText)) {
            return null;
        }

        const cleaned = this.cleanEventResponseText(responseText);
        const html = this.escapeHtml(cleaned).replace(/\n/g, '<br>');

        const structured = this._parseEventPromptResponse(responseText);
        if (!allowEnvironmentalEffects) {
            if (Array.isArray(structured.parsed.environmental_status_damage)) {
                structured.parsed.environmental_status_damage = [];
            }
            if (Object.prototype.hasOwnProperty.call(structured.rawEntries, 'environmental_status_damage')) {
                structured.rawEntries.environmental_status_damage = '';
            }
        }

        let experienceAwards = [];
        let currencyChanges = [];
        let environmentalDamageEvents = [];
        let needBarChanges = [];

        try {
            const outcomeContext = await this.applyEventOutcomes(structured, {
                player: currentPlayer,
                location,
                region,
                experienceAwards: [],
                currencyChanges: [],
                environmentalDamageEvents: [],
                needBarChanges: [],
                allowEnvironmentalEffects: Boolean(allowEnvironmentalEffects),
                isNpcTurn: Boolean(isNpcTurn),
                stream
            });

            if (Array.isArray(outcomeContext?.experienceAwards) && outcomeContext.experienceAwards.length) {
                experienceAwards = outcomeContext.experienceAwards;
            }
            if (Array.isArray(outcomeContext?.currencyChanges) && outcomeContext.currencyChanges.length) {
                currencyChanges = outcomeContext.currencyChanges;
            }
            if (Array.isArray(outcomeContext?.environmentalDamageEvents) && outcomeContext.environmentalDamageEvents.length) {
                environmentalDamageEvents = outcomeContext.environmentalDamageEvents;
            }
            if (Array.isArray(outcomeContext?.needBarChanges) && outcomeContext.needBarChanges.length) {
                needBarChanges = outcomeContext.needBarChanges;
            }
        } catch (error) {
            console.warn('Failed to apply event outcomes:', error.message);
        }

        return {
            raw: cleaned,
            html,
            structured,
            experienceAwards,
            currencyChanges,
            environmentalDamageEvents,
            needBarChanges
        };
    }

    static _parseEventPromptResponse(responseText) {
        const numbered = this._extractNumberedResponses(responseText);
        const rawGroups = new Map();
        const parsedGroups = new Map();

        for (const definition of EVENT_PROMPT_ORDER) {
            const raw = numbered.get(definition.index) || '';
            if (!rawGroups.has(definition.key)) {
                rawGroups.set(definition.key, []);
                parsedGroups.set(definition.key, []);
            }

            rawGroups.get(definition.key).push(raw);
            const parser = this._parsers[definition.key];
            const parsed = parser ? parser(raw) : raw;
            const value = typeof definition.postProcess === 'function'
                ? ensureArray(parsed).map(entry => definition.postProcess(entry))
                : parsed;
            parsedGroups.get(definition.key).push(value);
        }

        const rawEntries = {};
        const parsedEntries = {};

        for (const [key, segments] of rawGroups.entries()) {
            const compactRaw = segments
                .map(segment => (typeof segment === 'string' ? segment.trim() : ''))
                .filter(segment => segment.length > 0 && !NO_EVENT_TOKENS.has(segment.toLowerCase()))
                .join(' | ');
            rawEntries[key] = compactRaw;

            const aggregator = this._aggregators[key] || (items => flattenAndFilter(items));
            const combined = aggregator(parsedGroups.get(key) || []);
            parsedEntries[key] = combined;
        }

        const firstAppearance = parsedEntries.npc_first_appearance || [];
        if (firstAppearance.length) {
            const arrivals = firstAppearance
                .map(name => normalizeString(name))
                .filter(name => name.length > 0)
                .map(name => ({ name, action: 'arrived', destination: null, firstAppearance: true }));

            if (!Array.isArray(parsedEntries.npc_arrival_departure)) {
                parsedEntries.npc_arrival_departure = [];
            }
            parsedEntries.npc_arrival_departure.push(...arrivals);
        }

        return { rawEntries, parsed: parsedEntries };
    }

    static _extractNumberedResponses(responseText) {
        const cleaned = this.cleanEventResponseText(responseText);
        const lines = cleaned.split(/\n/);
        const entries = new Map();
        let currentIndex = null;
        let buffer = [];

        const flush = () => {
            if (currentIndex === null) {
                buffer = [];
                return;
            }
            const combined = buffer.join(' ').trim();
            entries.set(currentIndex, combined);
            currentIndex = null;
            buffer = [];
        };

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) {
                continue;
            }
            const match = line.match(/^(\d+)\.\s*(.*)$/);
            if (match) {
                flush();
                currentIndex = parseInt(match[1], 10);
                buffer.push(match[2]);
            } else if (currentIndex !== null) {
                buffer.push(line);
            }
        }
        flush();
        return entries;
    }

    static async applyEventOutcomes(parsedEvents, context = {}) {
        if (!parsedEvents || !parsedEvents.parsed) {
            return context;
        }

        const config = this.config || {};
        const omitNpcGeneration = Boolean(config?.omit_npc_generation);
        const omitItemGeneration = Boolean(config?.omit_item_generation);

        const suppressedNpc = omitNpcGeneration ? new Set(['npc_arrival_departure', 'alter_npc']) : null;
        const suppressedItems = omitItemGeneration ? new Set(['item_appear', 'scenery_appear', 'harvestable_resource_appear', 'alter_item']) : null;

        const executionOrder = [
            'new_exit_discovered',
            'move_location',
            'alter_location',
            'item_appear',
            'scenery_appear',
            'harvestable_resource_appear',
            'harvest_gather',
            'pick_up_item',
            'transfer_item',
            'drop_item',
            'consume_item',
            'alter_item',
            'currency',
            'item_to_npc',
            'alter_npc',
            'npc_arrival_departure',
            'party_change',
            'status_effect_change',
            'heal_recover',
            'needbar_change',
            'environmental_status_damage',
            'attack_damage',
            'death_incapacitation',
            'defeated_enemy',
            'experience_check'
        ];

        const parsedMap = parsedEvents.parsed;
        const seen = new Set();
        const orderedKeys = [];

        executionOrder.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(parsedMap, key)) {
                orderedKeys.push(key);
                seen.add(key);
            }
        });

        Object.keys(parsedMap).forEach(key => {
            if (!seen.has(key)) {
                orderedKeys.push(key);
            }
        });

        for (const key of orderedKeys) {
            if (suppressedNpc?.has(key) || suppressedItems?.has(key)) {
                continue;
            }
            const handler = this._handlers[key];
            if (typeof handler !== 'function') {
                continue;
            }
            const entries = parsedMap[key];
            try {
                await handler.call(this, entries, context, parsedEvents.rawEntries[key]);
            } catch (error) {
                console.warn(`Failed to apply ${key} events:`, error.message);
            }
        }

        return context;
    }

    static _buildParsers() {
        return {
            new_exit_discovered: raw => splitPipeList(raw).map(entry => {
                const [name, kind, vehicle, description] = splitArrowParts(entry, 4);
                const normalizedKind = (kind || '').toLowerCase();
                if (!name || !description || (normalizedKind !== 'location' && normalizedKind !== 'region')) {
                    return null;
                }
                const vehicleType = normalizeString(vehicle);
                return {
                    name: name.trim(),
                    kind: normalizedKind,
                    vehicleType: vehicleType && vehicleType.toLowerCase() !== 'none' ? vehicleType : null,
                    description: description.trim()
                };
            }).filter(Boolean),
            alter_location: raw => splitPipeList(raw).map(entry => {
                const [name, description] = splitArrowParts(entry, 2);
                if (!name || !description) {
                    return null;
                }
                return { name: name.trim(), description: description.trim() };
            }).filter(Boolean),
            currency: raw => {
                const amount = extractInteger(raw);
                return Number.isFinite(amount) ? amount : null;
            },
            item_to_npc: raw => splitPipeList(raw).map(entry => {
                const [item, npc, description] = splitArrowParts(entry, 3);
                if (!npc) {
                    return null;
                }
                return {
                    item: item ? item.trim() : null,
                    npc: npc.trim(),
                    description: description ? description.trim() : null
                };
            }).filter(Boolean),
            consume_item: raw => splitPipeList(raw).map(name => name.trim()).filter(Boolean),
            alter_item: raw => splitPipeList(raw).map(entry => {
                const [from, to, description] = splitArrowParts(entry, 3);
                if (!from && !to) {
                    return null;
                }
                return {
                    from: from ? from.trim() : null,
                    to: to ? to.trim() : null,
                    description: description ? description.trim() : null
                };
            }).filter(Boolean),
            transfer_item: raw => splitPipeList(raw).map(entry => {
                const [giver, item, receiver] = splitArrowParts(entry, 3);
                if (!item) {
                    return null;
                }
                return {
                    giver: giver ? giver.trim() : null,
                    item: item.trim(),
                    receiver: receiver ? receiver.trim() : null
                };
            }).filter(Boolean),
            harvest_gather: raw => splitPipeList(raw).map(entry => {
                const [name, item] = splitArrowParts(entry, 2);
                if (!name || !item) {
                    return null;
                }
                return { harvester: name.trim(), item: item.trim() };
            }).filter(Boolean),
            pick_up_item: raw => splitPipeList(raw).map(entry => {
                const [name, item] = splitArrowParts(entry, 2);
                if (!name || !item) {
                    return null;
                }
                return { name: name.trim(), item: item.trim() };
            }).filter(Boolean),
            drop_item: raw => splitPipeList(raw).map(entry => {
                const [name, item] = splitArrowParts(entry, 2);
                if (!name || !item) {
                    return null;
                }
                return { name: name.trim(), item: item.trim() };
            }).filter(Boolean),
            item_appear: raw => splitPipeList(raw).map(entry => entry.trim()).filter(Boolean),
            scenery_appear: raw => splitPipeList(raw).map(entry => entry.trim()).filter(Boolean),
            harvestable_resource_appear: raw => splitPipeList(raw).map(entry => entry.trim()).filter(Boolean),
            alter_npc: raw => splitPipeList(raw).map(entry => {
                const [name, description] = splitArrowParts(entry, 2);
                if (!name) {
                    return null;
                }
                return { name: name.trim(), description: description ? description.trim() : null };
            }).filter(Boolean),
            status_effect_change: raw => splitPipeList(raw).map(entry => {
                const [entity, detail, action] = splitArrowParts(entry, 3);
                if (!entity || !detail || !action) {
                    return null;
                }
                return {
                    entity: entity.trim(),
                    detail: detail.trim(),
                    action: action.trim().toLowerCase()
                };
            }).filter(Boolean),
            npc_arrival_departure: raw => splitPipeList(raw).map(entry => {
                const parts = splitArrowParts(entry, 3);
                if (!parts.length) {
                    return null;
                }
                if (parts.length === 1) {
                    const match = parts[0].match(/^(.*)\s+(arrived|left)$/i);
                    if (!match) {
                        return null;
                    }
                    return { name: match[1].trim(), action: match[2].toLowerCase(), destination: null };
                }
                const [name, action, destination] = parts;
                if (!name || !action) {
                    return null;
                }
                return {
                    name: name.trim(),
                    action: action.trim().toLowerCase(),
                    destination: destination ? destination.trim() : null
                };
            }).filter(Boolean),
            npc_first_appearance: raw => splitPipeList(raw).map(entry => entry.trim()).filter(Boolean),
            party_change: raw => splitPipeList(raw).map(entry => {
                const [name, action] = splitArrowParts(entry, 2);
                if (!name || !action) {
                    return null;
                }
                return { name: name.trim(), action: action.trim().toLowerCase() };
            }).filter(Boolean),
            environmental_status_damage: raw => splitPipeList(raw).map(entry => {
                const parts = splitArrowParts(entry, 4);
                if (!parts.length) {
                    return null;
                }
                if (parts.length === 4) {
                    const [name, effect, severity, reason] = parts;
                    return {
                        name: name.trim(),
                        effect: (effect || 'damage').trim().toLowerCase(),
                        severity: (severity || 'medium').trim().toLowerCase(),
                        reason: reason ? reason.trim() : ''
                    };
                }
                const [name, severity, reason] = parts;
                if (!name) {
                    return null;
                }
                return {
                    name: name.trim(),
                    effect: 'damage',
                    severity: (severity || 'medium').trim().toLowerCase(),
                    reason: reason ? reason.trim() : ''
                };
            }).filter(Boolean),
            heal_recover: raw => splitPipeList(raw).map(entry => {
                const parts = splitArrowParts(entry, 3);
                if (!parts.length) {
                    return null;
                }
                if (parts.length >= 3) {
                    return {
                        character: parts[0].trim(),
                        magnitude: parts[1].trim().toLowerCase(),
                        reason: parts[2] ? parts[2].trim() : null
                    };
                }
                const [healer, recipient, effect] = parts;
                return {
                    healer: healer ? healer.trim() : null,
                    recipient: recipient ? recipient.trim() : null,
                    effect: effect ? effect.trim() : null
                };
            }).filter(Boolean),
            needbar_change: raw => splitPipeList(raw).map(entry => {
                const [name, bar, direction, magnitude, reason] = splitArrowParts(entry, 5);
                if (!name || !bar || !direction) {
                    return null;
                }
                return {
                    character: name.trim(),
                    bar: bar.trim(),
                    direction: direction.trim().toLowerCase(),
                    magnitude: (magnitude || 'small').trim().toLowerCase(),
                    reason: reason ? reason.trim() : null
                };
            }).filter(Boolean),
            attack_damage: raw => splitPipeList(raw).map(entry => {
                const [attacker, target] = splitArrowParts(entry, 2);
                if (!attacker || !target) {
                    return null;
                }
                return { attacker: attacker.trim(), target: target.trim() };
            }).filter(Boolean),
            death_incapacitation: raw => splitPipeList(raw).map(entry => {
                const [name, status] = splitArrowParts(entry, 2);
                if (!name) {
                    return null;
                }
                return {
                    name: name.trim(),
                    status: status ? status.trim().toLowerCase() : 'dead'
                };
            }).filter(Boolean),
            defeated_enemy: raw => splitPipeList(raw).map(entry => entry.trim()).filter(Boolean),
            experience_check: raw => splitPipeList(raw).map(entry => {
                const [amount, reason] = splitArrowParts(entry, 2);
                const value = extractInteger(amount);
                if (!Number.isFinite(value)) {
                    return null;
                }
                return { amount: value, reason: reason ? reason.trim() : '' };
            }).filter(Boolean),
            move_location: raw => splitPipeList(raw).map(entry => entry.trim()).filter(Boolean)
        };
    }

    static _buildAggregators() {
        return {
            currency: list => {
                const numbers = flattenAndFilter(list).map(Number).filter(Number.isFinite);
                if (!numbers.length) {
                    return 0;
                }
                return numbers.reduce((total, value) => total + value, 0);
            },
            consume_item: list => flattenAndFilter(list).map(name => name.trim()).filter(Boolean)
        };
    }

    static _buildHandlers() {
        return {
            new_exit_discovered: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { Location, findRegionByLocationId } = this._deps;
                if (!Location || typeof Location.get !== 'function') {
                    return;
                }
                const location = context.location;
                if (!location) {
                    return;
                }
                for (const entry of entries) {
                    const normalizedName = entry.name;
                    if (!normalizedName) {
                        continue;
                    }
                    if (typeof location.addExit === 'function') {
                        const payload = {
                            name: normalizedName,
                            description: entry.description,
                            isVehicle: Boolean(entry.vehicleType),
                            vehicleType: entry.vehicleType || null,
                            kind: entry.kind
                        };
                        try {
                            location.addExit(payload);
                        } catch (error) {
                            console.warn('Failed to add exit:', error.message);
                        }
                    }
                    if (entry.kind === 'region' && typeof findRegionByLocationId === 'function') {
                        try {
                            findRegionByLocationId(location.id, { ensureRegion: normalizedName });
                        } catch (_) {
                            // ignore inability to ensure region
                        }
                    }
                }
            },
            alter_location: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const location = context.location;
                if (!location) {
                    return;
                }
                for (const entry of entries) {
                    if (!entry?.description) {
                        continue;
                    }
                    if (typeof location.addStatusEffect === 'function') {
                        location.addStatusEffect(makeStatusEffect(entry.description, null));
                    }
                }
            },
            currency: function (delta, context = {}) {
                if (!delta) {
                    return;
                }
                const player = context.player || this.currentPlayer;
                if (!player || typeof player.adjustCurrency !== 'function') {
                    return;
                }
                if (!Array.isArray(context.currencyChanges)) {
                    context.currencyChanges = [];
                }
                const before = typeof player.getCurrency === 'function' ? player.getCurrency() : Number(player.currency) || 0;
                player.adjustCurrency(delta);
                const after = typeof player.getCurrency === 'function' ? player.getCurrency() : Number(player.currency) || 0;
                context.currencyChanges.push({ amount: delta, before, after });
            },
            item_to_npc: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findThingByName, ensureNpcByName, Location, findRegionByLocationId } = this._deps;
                if (typeof ensureNpcByName !== 'function' || typeof findThingByName !== 'function') {
                    throw new Error('item_to_npc handler requires ensureNpcByName and findThingByName dependencies.');
                }

                const resolveLocation = candidate => {
                    if (!candidate || !Location || typeof Location.get !== 'function') {
                        return null;
                    }
                    try {
                        return Location.get(candidate) || null;
                    } catch (_) {
                        return null;
                    }
                };

                const player = context.player || this.currentPlayer;
                for (const entry of entries) {
                    const itemName = normalizeString(entry.item);
                    const npcName = normalizeString(entry.npc);
                    if (!npcName) {
                        continue;
                    }
                    const item = itemName ? findThingByName(itemName) : null;
                    if (!item) {
                        throw new Error(`item_to_npc could not find item "${itemName || '<unknown>'}"`);
                    }

                    let location = context.location || null;
                    if (!location && item.metadata?.locationId) {
                        location = resolveLocation(item.metadata.locationId);
                    }
                    if (!location && player?.currentLocation) {
                        location = resolveLocation(player.currentLocation);
                    }
                    if (!location) {
                        throw new Error(`item_to_npc could not resolve location for "${npcName}" transformation.`);
                    }

                    const transformationContext = { ...context, location };
                    if (!transformationContext.region && typeof findRegionByLocationId === 'function') {
                        try {
                            transformationContext.region = findRegionByLocationId(location.id) || null;
                        } catch (_) {
                            transformationContext.region = null;
                        }
                    }

                    this._detachThingFromWorld(item);
                    const npc = await ensureNpcByName(npcName, transformationContext);
                    if (!npc) {
                        throw new Error(`item_to_npc failed to create NPC "${npcName}"`);
                    }
                }
            },
            consume_item: function (items = [], context = {}) {
                if (!Array.isArray(items) || !items.length) {
                    return;
                }
                const { findThingByName } = this._deps;
                if (typeof findThingByName !== 'function') {
                    throw new Error('consume_item handler requires findThingByName dependency.');
                }

                for (const name of items) {
                    const item = findThingByName(name);
                    if (!item) {
                        continue;
                    }
                    this._removeItemFromInventories(item);
                    this._detachThingFromWorld(item);
                }
            },
            alter_item: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findThingByName } = this._deps;
                if (typeof findThingByName !== 'function') {
                    throw new Error('alter_item handler requires findThingByName dependency.');
                }
                for (const entry of entries) {
                    const targetName = entry.to || entry.from;
                    if (!targetName) {
                        continue;
                    }
                    const thing = findThingByName(targetName);
                    if (!thing) {
                        continue;
                    }
                    if (entry.description && typeof thing.addStatusEffect === 'function') {
                        thing.addStatusEffect(makeStatusEffect(entry.description, null));
                    }
                    if (entry.to && entry.from && entry.to !== entry.from && typeof thing.rename === 'function') {
                        thing.rename(entry.to);
                    }
                }
            },
            transfer_item: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findThingByName, findActorByName } = this._deps;
                if (typeof findThingByName !== 'function' || typeof findActorByName !== 'function') {
                    throw new Error('transfer_item handler requires findThingByName and findActorByName dependencies.');
                }

                for (const entry of entries) {
                    const thing = findThingByName(entry.item);
                    if (!thing) {
                        continue;
                    }
                    const giver = entry.giver ? findActorByName(entry.giver) : null;
                    const receiver = entry.receiver ? findActorByName(entry.receiver) : null;

                    if (giver && typeof giver.removeInventoryItem === 'function') {
                        giver.removeInventoryItem(thing);
                    }
                    if (receiver && typeof receiver.addInventoryItem === 'function') {
                        receiver.addInventoryItem(thing);
                        thing.metadata = { ...(thing.metadata || {}), ownerId: receiver.id };
                    } else {
                        this._detachThingFromWorld(thing);
                    }
                }
            },
            harvest_gather: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName, generateItemsByNames } = this._deps;
                if (typeof generateItemsByNames !== 'function') {
                    throw new Error('harvest_gather handler requires generateItemsByNames dependency.');
                }
                for (const entry of entries) {
                    const actor = entry.harvester ? findActorByName?.(entry.harvester) : null;
                    if (actor && typeof actor.addInventoryItem === 'function') {
                        generateItemsByNames({ itemNames: [entry.item], owner: actor }).catch(error => {
                            console.warn('Failed to generate harvested item:', error.message);
                        });
                    }
                }
            },
            pick_up_item: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findThingByName, findActorByName } = this._deps;
                for (const entry of entries) {
                    const thing = findThingByName?.(entry.item);
                    const actor = findActorByName?.(entry.name);
                    if (!thing || !actor || typeof actor.addInventoryItem !== 'function') {
                        continue;
                    }
                    this._detachThingFromKnownLocation(thing);
                    actor.addInventoryItem(thing);
                    thing.metadata = { ...(thing.metadata || {}), ownerId: actor.id };
                }
            },
            drop_item: function (entries = [], context = {}) {
                const location = context.location;
                if (!location || !Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findThingByName, findActorByName } = this._deps;
                for (const entry of entries) {
                    const thing = findThingByName?.(entry.item);
                    const actor = findActorByName?.(entry.name);
                    if (!thing) {
                        continue;
                    }
                    if (actor && typeof actor.removeInventoryItem === 'function') {
                        actor.removeInventoryItem(thing);
                    }
                    this.addThingToLocation(thing, location);
                }
            },
            item_appear: function (items = [], context = {}) {
                this._generateItemsIntoWorld(items, context.location);
            },
            scenery_appear: function (items = [], context = {}) {
                this._generateItemsIntoWorld(items, context.location, { treatAsScenery: true });
            },
            harvestable_resource_appear: function (items = [], context = {}) {
                this._generateItemsIntoWorld(items, context.location, { treatAsResource: true });
            },
            alter_npc: function (entries = [], context = {}) {
                const { findActorByName } = this._deps;
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                for (const entry of entries) {
                    const npc = findActorByName?.(entry.name);
                    if (!npc) {
                        continue;
                    }
                    if (entry.description && typeof npc.addStatusEffect === 'function') {
                        npc.addStatusEffect(makeStatusEffect(entry.description, null));
                    }
                }
            },
            npc_arrival_departure: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName, ensureNpcByName } = this._deps;
                for (const entry of entries) {
                    const name = normalizeString(entry.name);
                    if (!name) {
                        continue;
                    }
                    if (entry.action === 'arrived') {
                        if (typeof ensureNpcByName === 'function') {
                            ensureNpcByName(name, context).catch(error => {
                                console.warn('Failed to ensure NPC arrival:', error.message);
                            });
                        }
                    }
                    const npc = findActorByName?.(name);
                    if (!npc) {
                        continue;
                    }
                    if (entry.action === 'left' && typeof npc.setLocation === 'function') {
                        npc.setLocation(null);
                    }
                    if (entry.destination && typeof npc.setDestination === 'function') {
                        npc.setDestination(entry.destination);
                    }
                }
            },
            party_change: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const player = context.player || this.currentPlayer;
                const { findActorByName } = this._deps;
                if (!player || typeof player.addAlly !== 'function' || typeof player.removeAlly !== 'function') {
                    return;
                }
                for (const entry of entries) {
                    const npc = findActorByName?.(entry.name);
                    if (!npc) {
                        continue;
                    }
                    if (entry.action === 'joined') {
                        player.addAlly(npc);
                    } else if (entry.action === 'left') {
                        player.removeAlly(npc.id);
                    }
                }
            },
            status_effect_change: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName } = this._deps;
                for (const entry of entries) {
                    const entity = findActorByName?.(entry.entity);
                    if (!entity) {
                        continue;
                    }
                    if (entry.action === 'gained' && typeof entity.addStatusEffect === 'function') {
                        entity.addStatusEffect(makeStatusEffect(entry.detail, this.DEFAULT_STATUS_DURATION));
                    } else if (entry.action === 'lost' && typeof entity.removeStatusEffect === 'function') {
                        entity.removeStatusEffect(entry.detail);
                    }
                }
            },
            heal_recover: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName } = this._deps;
                for (const entry of entries) {
                    const targetName = entry.character || entry.recipient;
                    const magnitude = entry.magnitude || entry.effect || 'small';
                    const actor = targetName ? findActorByName?.(targetName) : null;
                    if (!actor || typeof actor.modifyHealth !== 'function') {
                        continue;
                    }
                    const amount = this._estimateHealingAmount(magnitude, actor);
                    actor.modifyHealth(amount, entry.reason || entry.effect || 'Recovered');
                }
            },
            needbar_change: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName } = this._deps;
                if (!Array.isArray(context.needBarChanges)) {
                    context.needBarChanges = [];
                }
                for (const entry of entries) {
                    const actor = findActorByName?.(entry.character);
                    if (!actor || typeof actor.adjustNeedBar !== 'function') {
                        continue;
                    }
                    const change = actor.adjustNeedBar(entry.bar, entry.direction, entry.magnitude);
                    if (change) {
                        context.needBarChanges.push(change);
                    }
                }
            },
            environmental_status_damage: function (entries = [], context = {}) {
                if (context.allowEnvironmentalEffects === false || !Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName } = this._deps;
                if (!Array.isArray(context.environmentalDamageEvents)) {
                    context.environmentalDamageEvents = [];
                }
                for (const entry of entries) {
                    const actor = findActorByName?.(entry.name);
                    if (!actor || typeof actor.modifyHealth !== 'function') {
                        continue;
                    }
                    const effect = entry.effect || 'damage';
                    const severity = entry.severity || 'medium';
                    const amount = this._severityToDamage(severity, context);
                    const delta = effect === 'healing' ? amount : -amount;
                    const result = actor.modifyHealth(delta, entry.reason || 'Environmental effect');
                    context.environmentalDamageEvents.push({
                        name: entry.name,
                        type: effect === 'healing' ? 'healing' : 'damage',
                        severity,
                        reason: entry.reason || '',
                        amount: result?.change ?? Math.abs(delta)
                    });
                }
            },
            attack_damage: function (entries = []) {
                const { findActorByName } = this._deps;
                for (const entry of entries) {
                    const victim = findActorByName?.(entry.target);
                    if (!victim || typeof victim.modifyHealth !== 'function') {
                        continue;
                    }
                    victim.modifyHealth(-5, entry.attacker ? `Attacked by ${entry.attacker}` : 'Attacked');
                }
            },
            death_incapacitation: function (entries = []) {
                const { findActorByName } = this._deps;
                for (const entry of entries) {
                    const actor = findActorByName?.(entry.name);
                    if (!actor || typeof actor.modifyHealth !== 'function') {
                        continue;
                    }
                    if (entry.status === 'dead') {
                        actor.modifyHealth(-Infinity, 'Killed');
                        if (typeof actor.addStatusEffect === 'function') {
                            actor.addStatusEffect(makeStatusEffect('Deceased', null));
                        }
                    } else {
                        actor.modifyHealth(-Math.abs(actor.health || 0), 'Incapacitated');
                        if (typeof actor.addStatusEffect === 'function') {
                            actor.addStatusEffect(makeStatusEffect('Incapacitated', null));
                        }
                    }
                }
            },
            defeated_enemy: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const player = context.player || this.currentPlayer;
                if (!player || typeof player.addExperience !== 'function') {
                    return;
                }
                const { findActorByName } = this._deps;
                const awards = [];
                for (const name of entries) {
                    const enemy = findActorByName?.(name);
                    const level = Number(enemy?.level) || Number(context.location?.baseLevel) || 1;
                    const xp = Math.max(25, Math.round(level * 50));
                    awards.push({ amount: xp, reason: `Defeated ${name}` });
                    player.addExperience(xp);
                }
                if (!Array.isArray(context.experienceAwards)) {
                    context.experienceAwards = [];
                }
                context.experienceAwards.push(...awards);
            },
            experience_check: function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const player = context.player || this.currentPlayer;
                if (!player || typeof player.addExperience !== 'function') {
                    return;
                }
                if (!Array.isArray(context.experienceAwards)) {
                    context.experienceAwards = [];
                }
                for (const entry of entries) {
                    player.addExperience(entry.amount);
                    context.experienceAwards.push({ amount: entry.amount, reason: entry.reason || 'Accomplishment' });
                }
            },
            move_location: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const player = context.player || this.currentPlayer;
                const { Location } = this._deps;
                if (!player || typeof player.setLocation !== 'function' || !Location || typeof Location.get !== 'function') {
                    return;
                }
                const destinationName = entries[entries.length - 1];
                if (!destinationName) {
                    return;
                }
                try {
                    const destination = Location.get(destinationName);
                    if (destination) {
                        player.setLocation(destination.id);
                        context.location = destination;
                    }
                } catch (error) {
                    console.warn('Failed to move player location:', error.message);
                }
            }
        };
    }

    static _generateItemsIntoWorld(names = [], location = null, options = {}) {
        if (!Array.isArray(names) || !names.length) {
            return;
        }
        const { generateItemsByNames } = this._deps;
        if (typeof generateItemsByNames !== 'function') {
            console.warn('generateItemsByNames dependency missing; cannot spawn items.');
            return;
        }
        const locationCandidate = this.resolveLocationCandidate(location) || location;
        generateItemsByNames({ itemNames: names, location: locationCandidate, options }).catch(error => {
            console.warn('Failed to generate items:', error.message);
        });
    }

    static _removeItemFromInventories(thing) {
        const { findActorById } = this._deps;
        const metadata = thing.metadata || {};
        if (metadata.ownerId && typeof findActorById === 'function') {
            const owner = findActorById(metadata.ownerId);
            if (owner && typeof owner.removeInventoryItem === 'function') {
                owner.removeInventoryItem(thing);
            }
        }
    }

    static _detachThingFromKnownLocation(thing) {
        const metadata = thing.metadata || {};
        if (!metadata.locationId) {
            return;
        }
        this.removeThingFromLocation(thing, metadata.locationId);
        delete metadata.locationId;
        thing.metadata = metadata;
    }

    static _detachThingFromWorld(thing) {
        this._removeItemFromInventories(thing);
        this._detachThingFromKnownLocation(thing);
        if (typeof thing.delete === 'function') {
            thing.delete();
        }
        const things = this.things;
        if (things instanceof Map) {
            things.delete(thing.id);
        } else if (Array.isArray(things)) {
            const index = things.findIndex(candidate => candidate?.id === thing.id);
            if (index >= 0) {
                things.splice(index, 1);
            }
        } else if (things && typeof things === 'object' && thing.id) {
            delete things[thing.id];
        }
    }

    static _estimateHealingAmount(magnitude, actor) {
        const max = Number(actor.maxHealth) || 10;
        switch ((magnitude || '').toLowerCase()) {
            case 'all':
                return Math.max(1, max);
            case 'large':
                return Math.max(1, Math.round(max * 0.75));
            case 'medium':
                return Math.max(1, Math.round(max * 0.5));
            default:
                return Math.max(1, Math.round(max * 0.25));
        }
    }

    static _severityToDamage(severity, context = {}) {
        const base = Number(context.location?.baseLevel) || Number(context.player?.level) || 1;
        const medium = Math.max(1, Math.round(8 + base * 2));
        if (severity === 'high') {
            return Math.round(medium * 1.75);
        }
        if (severity === 'low') {
            return Math.max(1, Math.round(medium * 0.25));
        }
        return medium;
    }

    static resolveLocationCandidate(candidate) {
        if (!candidate) {
            return null;
        }
        const { Location } = this._deps;
        if (typeof candidate === 'string' && Location && typeof Location.get === 'function') {
            try {
                return Location.get(candidate) || null;
            } catch (_) {
                return null;
            }
        }
        if (typeof candidate === 'object' && typeof candidate.id === 'string') {
            return candidate;
        }
        return null;
    }

    static addThingToLocation(thing, candidate) {
        if (!thing) {
            return;
        }
        const location = this.resolveLocationCandidate(candidate);
        if (!location || typeof location.addThingId !== 'function') {
            return;
        }
        location.addThingId(thing.id);
        const metadata = thing.metadata || {};
        metadata.locationId = location.id;
        delete metadata.ownerId;
        thing.metadata = metadata;
    }

    static removeThingFromLocation(thing, candidate) {
        if (!thing) {
            return;
        }
        const location = this.resolveLocationCandidate(candidate);
        if (!location || typeof location.removeThingId !== 'function') {
            return;
        }
        location.removeThingId(thing.id);
    }

    static cleanEventResponseText(text) {
        if (typeof text !== 'string') {
            return '';
        }
        return text.replace(/\*/g, '').trim();
    }

    static escapeHtml(text) {
        if (typeof text !== 'string') {
            return '';
        }
        return text.replace(/[&<>'"]/g, char => {
            switch (char) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case '\'': return '&#39;';
                default: return char;
            }
        });
    }

    static logEventCheck({ systemPrompt, generationPrompt, responseText }) {
        const { fs, path, baseDir } = this._deps;
        if (!fs || !path || !baseDir) {
            return;
        }
        try {
            const logDir = path.join(baseDir, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logPath = path.join(logDir, `event_checks_${timestamp}.log`);
            const contents = [
                '=== EVENT CHECK SYSTEM PROMPT ===',
                systemPrompt || '(none)',
                '',
                '=== EVENT CHECK GENERATION PROMPT ===',
                generationPrompt || '(none)',
                '',
                '=== EVENT CHECK RESPONSE ===',
                responseText || '(no response)',
                ''
            ].join('\n');
            fs.writeFileSync(logPath, contents, 'utf8');
        } catch (error) {
            console.warn('Failed to log event check:', error.message);
        }
    }

    static get config() {
        const { getConfig, config } = this._deps;
        if (typeof getConfig === 'function') {
            return getConfig();
        }
        return config || {};
    }

    static get currentPlayer() {
        const { getCurrentPlayer, currentPlayer } = this._deps;
        if (typeof getCurrentPlayer === 'function') {
            return getCurrentPlayer();
        }
        return currentPlayer || null;
    }

    static get players() {
        return this._deps.players;
    }

    static get things() {
        return this._deps.things;
    }
}

module.exports = Events;
