const SanitizedStringSet = require('./SanitizedStringSet.js');
const Utils = require('./Utils.js');
const Thing = require('./Thing.js');

const BASE_TIMEOUT_MS = 120000;
const DEFAULT_STATUS_DURATION = 3;
const MAJOR_STATUS_DURATION = 5;

const EVENT_PROMPT_ORDER = [
    { key: 'new_exit_discovered', prompt: `Did the text reveal, unlock, or block a path, exit, or vehicle to another region? If so, reply in the form [new location or region name] -> [the word "location" or "region"] -> [type of vehicle or "none"] -> [description of the location or region in 1-2 sentences]. In case of more than one, separate them with vertical bars. Otherwise answer N/A. Note that the difference between a location and a region is that a location is a specific place (like a building, room, or landmark) while a region is a broader area (like a neighborhood, district, or zone). Consider whether you're conceptually entering a different region (anything with multiple locations, such as a building, town, biome, planet, etc), or part of the current one (which would be a location). An exit to a region may take the form of a vehicle to that region. If the new location or region is already known to the player, still list it here.  For example, a train to townsville would appear as "Townsville -> region -> train -> A bustling town known for its markets and friendly locals." An adjacent forest would appear as "Whispering Woods -> location -> none -> A dense forest filled with towering trees and the sound of rustling leaves."` },
    { key: 'move_location', prompt: `Did the player travel to or end up in a different location? If so, answer with the exact name; otherwise answer N/A. If you don't know where they ended up, pick an existing location nearby.` },
    { key: 'alter_location', prompt: `Was the current location permanently altered in a significant way (major changes to the location itself, not npcs, items, or scenery)? If so, answer in the format "[new location name] -> [1 sentence description of alteration]". If not (or if the player moved from one location to another, which isn't an alteration), answer N/A.` },
    { key: 'currency', prompt: `Did the player gain or lose currency? If so, how much? Respond with a positive or negative integer. Otherwise, respond N/A. Do not include currency changes in any answers below, as currency is tracked separately from items.` },
    { key: 'item_to_npc', prompt: `Did any inanimate object (e.g., robot, drone, statue, furniture, or machinery) become capable of movement or act as an independent entity? If so, respond in this format: "[exact item or scenery name] -> [new npc/entity name] -> [5-10 word description of what happened]". Separate multiple entries with vertical bars. If none, respond N/A.` },
    { key: 'alter_item', prompt: `Was an item in the scene or any inventory permanently altered in any way (e.g., upgraded, modified, enchanted, broken, etc.)? If so, answer in the format "[exact item name] -> [new item name or same item name] -> [1 sentence description of alteration]". If multiple items were altered, separate multiple entries with vertical bars. If it doesn't make sense for the name to change, use the same name for new item name.` },
    { key: 'consume_item', prompt: `Were any items consumed, either by being used as components in crafting, by being eaten or drunk, or by being destroyed or otherwise removed from the scene or any inventory? If so, list the exact names of those items (capitalized as Proper Nouns) separated by vertical bars. Otherwise, answer N/A.` },
    { key: 'transfer_item', prompt: `Did anyone hand, trade, or give an item to someone else? If so, list "[giver] -> [item] -> [receiver]". If there are multiple entries, separate them with vertical bars. Otherwise, answer N/A.` },
    { key: 'harvest_gather', prompt: `Did anyone harvest or gather from any natural or man-made resources or collections (for instance, a berry bush, a pile of wood, a copper vein, a crate of spare parts, etc)? If so, answer with the full name of the person who did so as seen in the location context ("player" if it was the player) and the exact name of the item(s) they would obtain from harvesting or gathering. If multiple items would be gathered this way, separate with vertical bars. Format like this: "[name] -> [item] | [name] -> [item]", up to three items at a time. Otherwise, answer N/A. For example, if harvesting from a "Raspberry Bush", the item obtained would be "Raspberries", "Ripe Raspberries", or similar.` },
    { key: 'pick_up_item', prompt: `Of any items not listed as consumed or altered, did anyone obtain one or more tangible carryable items or resources (not buildings or furniture) by any method other than harvesting or gathering? If so, list the full name of the person who obtained the item as seen in the location context ("player" if it was the player) and the exact names of those items (capitalized as Proper Nouns) separated by vertical bars. Use the format: "[name] -> [item] | [name] -> [item]". Otherwise, answer N/A. Note that even if an item was crafted with multiple ingredients, it should only be listed once here as a new item.` },
    { key: 'item_appear', prompt: `Did any new inanimate items appear in the scene for the first time, either as newly created items or items that were mentioned as already existing but had not been previously described in the scene context? If so, list the exact names of those items (capitalized as Proper Nouns) separated by vertical bars. Otherwise, answer N/A. Note that even if an item was crafted with multiple ingredients, it should only be listed once here as a new item.` },
    { key: 'drop_item', prompt: `Of any items not listed above, were any items dropped from an entity's inventory onto the scene? If so, list the full name of the person who dropped the item as seen in the location context ("player" if it was the player) and the exact names of those items (capitalized as Proper Nouns) separated by vertical bars. Use the format: "[name] -> [item] | [name] -> [item]". Otherwise, answer N/A.` },
    { key: 'scenery_appear', prompt: `Of anything you did not list above, did any new scenery, furniture, buildings, workstations, containers, or other non-carryable items appear in the scene for the first time, either as newly created items or items that were mentioned as already existing but had not been previously described in the scene context? If so, list the exact names of those items (capitalized as Proper Nouns) separated by vertical bars. Otherwise, answer N/A.` },
    { key: 'harvestable_resource_appear', prompt: `Of anything you did not list above, did any harvestable or gatherable resources (e.g., plants, minerals, or other resource nodes) appear in the scene for the first time, either as newly created items or items that were mentioned as already existing but had not been previously described in the scene context? If so, list the exact names of those items (capitalized as Proper Nouns) separated by vertical bars. Otherwise, answer N/A.` },
    { key: 'alter_npc', prompt: `Were any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) changed permanently in any way, such as being transformed, upgraded, downgraded, enhanced, damaged, healed, modified, or altered? If so, answer in the format "[exact character name] -> [1-2 sentence description of the change]". If multiple characters were altered, separate multiple entries with vertical bars. Note that things like temporary magical polymorphs and being turned to stone (where it's possible that it may be reversed) are better expressed as status effects and should not be mentioned here. If no characters were altered (which will be the case most of the time), answer N/A.` },
    { key: 'status_effect_change', prompt: `Did any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) gain or lose any temporary status effects that you didn't list above as permanent changes? If so, list them in this format: "[entity] -> [10 or fewer word description of effect] -> [gained/lost]". If there are multiple entries, separate them with vertical bars. Otherwise answer N/A.` },
    { key: 'npc_arrival_departure', prompt: `Did any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) leave the scene? If so, list the full names of those entities as seen in the location context (capitalized as Proper Nouns) separated by vertical bars. Use the format: "[name] left -> [exact name of the location they went to]". Otherwise, answer N/A.`, postProcess: entry => ({ ...entry, action: entry?.action || 'left' }) },
    { key: 'npc_arrival_departure', prompt: `Did any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) arrive at this location from elsewhere? If so, list the full names of those entities as seen in the location context (capitalized as Proper Nouns) separated by vertical bars. Use the format: "[name] arrived". Otherwise, answer N/A.`, postProcess: entry => ({ ...entry, action: entry?.action || 'arrived' }) },
    { key: 'npc_first_appearance', prompt: `Did any animate entities (NPCs, animals, monsters, robots, or anything else capable of moving on its own) appear for the first time on the scene, or become visible or known to the player, either as newly created entities or entities that were mentioned as already existing but had not been previously described in the scene context? If so, list the full names of those entities as seen in the location context (capitalized as Proper Nouns) separated by vertical bars. Otherwise, answer N/A.` },
    { key: 'party_change', prompt: `Is any entity (including ones you may have listed above) that is not listed in playerParty currently leading, following, or otherwise willingly accompanying the player? If yes, list "[npc name] -> joined". For anyone who began leading or following (even temporarily), also list them as "[npc name] -> joined". If anyone left the party, list "[npc name] -> left". Separate multiple entries with vertical bars. If no party status occurred, respond with N/A.` },
    { key: 'environmental_status_damage', prompt: `Did any animate entities take environmental damage or damage from an ongoing status effect? Were they healed by the environment or an ongoing status effect? If so, answer in the format "[exact name] -> [damage|healing] -> [low|medium|high] -> [1 sentence describing why damage was taken]". If there are multiple instances of damage, separate multiple entries with vertical bars. Otherwise, answer N/A.` },
    { key: 'heal_recover', prompt: `Did anyone heal or recover health? If so, answer in the format "[character] -> [small|medium|large|all] -> [reason]". If there are multiple characters, separate multiple entries with vertical bars. Otherwise, answer N/A. Health recovery from natural regeneration, food, resting tends to be small or medium, whereas healing from potions, spells, bed rest, or medical treatment tends to be medium or large. Consider the context of the event, the skill of the healer (if applicable), the rarity and properties of any healing items used, etc.` },
    { key: 'needbar_change', prompt: `Does anything that happened in this turn affect any need bars for any characters (NPCs or player)? If so, answer with the following four arguments: "[exact name of character] -> [exact name of need bar] -> [increase or decrease] -> [small|medium|large|all] | ..." for each adjustment, separating multiple adjustments with vertical bars (multiple characters may have multiple need bar changes). Otherwise, answer N/A.` },
    { key: 'attack_damage', prompt: `Did any entity attack any other entity?  If so, answer in the format "[attacker] -> [target]". If there are multiple attackers, separate multiple entries with vertical bars. Otherwise, answer N/A.` },
    { key: 'death_incapacitation', prompt: `Did any entity die or become incapacitated? If so, reply in this format: "[exact name of character/entity] -> ["dead" or "incapacitated"]. If multiple, separate with vertical bars. Otherwise answer N/A.` },
    { key: 'defeated_enemy', prompt: `Did the player defeat an enemy this turn? If so, respond with the exact name of the enemy. If there are multiple enemies, separate multiple names with vertical bars. Otherwise, respond N/A.` },
    { key: 'experience_check', prompt: `Did the player do something (other than defeating an enemy) that would cause them to gain experience points? If so, respond with "[integer from 1-100] -> [reason in one sentence]" (note that experience cannot be gained just because something happened to the player; the player must have taken a specific action that contributes to their growth or development). Otherwise, respond N/A. See that sampleExperiencePointValues section for examples of actions that might grant experience points and how much.` },
];

const EVENT_CHECK_QUESTIONS = EVENT_PROMPT_ORDER.map(def => def.prompt);
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

    static animatedItems = new SanitizedStringSet();
    static alteredItems = new SanitizedStringSet();
    static newItems = new SanitizedStringSet();
    static obtainedItems = new SanitizedStringSet();
    static destroyedItems = new SanitizedStringSet();
    static droppedItems = new SanitizedStringSet();

    static alteredCharacters = new SanitizedStringSet();
    static newCharacters = new SanitizedStringSet();
    static arrivedCharacters = new SanitizedStringSet();
    static departedCharacters = new SanitizedStringSet();
    static defeatedEnemies = new SanitizedStringSet();

    static movedLocations = new SanitizedStringSet();

    static _resetTrackingSets() {
        this.animatedItems.clear();
        this.alteredItems.clear();
        this.newItems.clear();
        this.obtainedItems.clear();
        this.destroyedItems.clear();
        this.droppedItems.clear();

        this.alteredCharacters.clear();
        this.newCharacters.clear();
        this.arrivedCharacters.clear();
        this.departedCharacters.clear();
        this.defeatedEnemies.clear();

        this.movedLocations.clear();
    }

    static _trackItemsFromParsing(parsedEntries = {}) {
        const animated = parsedEntries.item_to_npc;
        if (Array.isArray(animated)) {
            for (const entry of animated) {
                const itemName = entry?.item;
                if (!itemName) {
                    continue;
                }
                this.animatedItems.add(itemName);
                this.destroyedItems.add(itemName);
            }
        }

        const altered = parsedEntries.alter_item;
        if (Array.isArray(altered)) {
            for (const entry of altered) {
                const originalName = entry?.from || entry?.originalName;
                const newName = entry?.to || entry?.newName;

                if (originalName) {
                    this.alteredItems.add(originalName);
                }
                if (newName) {
                    this.alteredItems.add(newName);
                }

                if (!entry?.from && originalName) {
                    entry.from = originalName;
                }
                if (!entry?.to && newName) {
                    entry.to = newName;
                }
                if (!entry?.description && entry?.changeDescription) {
                    entry.description = entry.changeDescription;
                }
            }
        }

        const consumed = parsedEntries.consume_item;
        if (Array.isArray(consumed)) {
            for (const entry of consumed) {
                const itemName = entry?.item;
                if (!itemName) {
                    continue;
                }
                this.destroyedItems.add(itemName);
            }
        }
    }

    static _pruneExcludedItemEntries(parsedEntries = {}) {
        const shouldSkip = itemName => (
            typeof itemName === 'string'
            && (this.animatedItems.has(itemName)
                || this.destroyedItems.has(itemName)
                || this.alteredItems.has(itemName))
        );

        const filterByItem = key => {
            if (!Array.isArray(parsedEntries[key])) {
                return;
            }
            parsedEntries[key] = parsedEntries[key].filter(entry => {
                const name = entry?.item;
                if (!name) {
                    return Boolean(entry);
                }
                return !shouldSkip(name);
            });
        };

        filterByItem('transfer_item');
        filterByItem('harvest_gather');
        filterByItem('pick_up_item');
        filterByItem('drop_item');

        if (Array.isArray(parsedEntries.item_appear)) {
            parsedEntries.item_appear = parsedEntries.item_appear.filter(itemName => !shouldSkip(itemName));
        }
    }

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

        this._resetTrackingSets();

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
            textToCheck,
            eventQuestions: EVENT_CHECK_QUESTIONS
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

        EVENT_PROMPT_ORDER.forEach((definition, position) => {
            const raw = numbered.get(position + 1) || '';
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
        });

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

        this._trackItemsFromParsing(parsedEntries);
        this._pruneExcludedItemEntries(parsedEntries);

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

        /* Keeping this here for reference in case we want to backtrack. */
        /*
        const executionOrder = [
            'new_exit_discovered',
            'alter_location',
            'currency',
            'item_to_npc',
            'consume_item',
            'alter_item',
            'transfer_item',
            'item_appear',
            'harvest_gather',
            'pick_up_item',
            'drop_item',
            'scenery_appear',
            'harvestable_resource_appear',
            'alter_npc',
            'status_effect_change',
            'npc_arrival_departure',
            'party_change',
            'environmental_status_damage',
            'heal_recover',
            'needbar_change',
            'attack_damage',
            'death_incapacitation',
            'defeated_enemy',
            'experience_check',
            'move_location'
        ];
        */

        // Get executionOrder from EVENT_PROMPT_ORDER to ensure consistency
        const executionOrder = EVENT_PROMPT_ORDER.map(def => def.key);

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
            consume_item: raw => splitPipeList(raw).map(entry => {
                if (typeof entry !== 'string' || !entry.trim()) {
                    return null;
                }
                const arrowParts = splitArrowParts(entry, 2);
                if (arrowParts.length === 2) {
                    const [user, item] = arrowParts;
                    if (user && item) {
                        return {
                            user: user.trim(),
                            item: item.trim()
                        };
                    }
                }
                return { item: entry.trim() };
            }).filter(Boolean),
            alter_item: raw => splitPipeList(raw).map(entry => {
                const parts = splitArrowParts(entry, 3);
                if (!parts.length) {
                    return null;
                }

                const originalName = parts[0] ? parts[0].trim() : '';
                const newNameInput = parts.length > 1 ? parts[1].trim() : '';
                const description = parts.length > 2 ? parts[2].trim() : '';

                if (!originalName && !newNameInput) {
                    return null;
                }

                const normalized = {
                    originalName: originalName || null,
                    newName: newNameInput || null,
                    changeDescription: description || null
                };

                if (!normalized.newName && normalized.originalName) {
                    normalized.newName = normalized.originalName;
                }

                normalized.from = normalized.originalName;
                normalized.to = normalized.newName;
                normalized.description = normalized.changeDescription;

                return normalized;
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
            consume_item: list => {
                const entries = flattenAndFilter(list);
                const normalized = [];
                for (const entry of entries) {
                    if (!entry) {
                        continue;
                    }
                    if (typeof entry === 'string') {
                        const itemName = entry.trim();
                        if (itemName) {
                            normalized.push({ item: itemName });
                        }
                        continue;
                    }
                    if (typeof entry === 'object') {
                        const itemName = entry.item ? String(entry.item).trim() : '';
                        if (!itemName) {
                            continue;
                        }
                        const userName = entry.user ? String(entry.user).trim() : '';
                        normalized.push(userName ? { user: userName, item: itemName } : { item: itemName });
                    }
                }
                return normalized;
            }
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
                    this.movedLocations.add(normalizedName);
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
                    if (entry.name) {
                        this.movedLocations.add(entry.name);
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
                    if (itemName) {
                        this.animatedItems.add(itemName);
                        this.destroyedItems.add(itemName);
                    }
                    if (npcName) {
                        this.newCharacters.add(npcName);
                        this.arrivedCharacters.add(npcName);
                    }
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

                for (const entry of items) {
                    const itemName = typeof entry === 'string'
                        ? entry.trim()
                        : (entry && entry.item ? String(entry.item).trim() : '');
                    if (!itemName) {
                        continue;
                    }
                    const item = findThingByName(itemName);
                    if (!item) {
                        console.debug(`[consume_item] Unable to locate item "${itemName}" for consumption.`);
                        continue;
                    }
                    this._removeItemFromInventories(item);
                    this._detachThingFromWorld(item);
                    this.destroyedItems.add(itemName);
                }
            },
            alter_item: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }

                const { findThingByName, alterThingByPrompt } = this._deps;
                if (typeof findThingByName !== 'function') {
                    throw new Error('alter_item handler requires findThingByName dependency.');
                }

                if (typeof alterThingByPrompt !== 'function') {
                    // fall back to simple rename/status effect handling if prompt helper missing
                    for (const entry of entries) {
                        if (!entry) {
                            continue;
                        }
                        const originalName = entry.originalName || entry.from || null;
                        const newName = entry.newName || entry.to || null;
                        const changeDescription = entry.changeDescription || entry.description || null;

                        const lookupCandidates = [originalName, newName].filter(candidate => typeof candidate === 'string' && candidate.trim());
                        let thing = null;
                        for (const candidate of lookupCandidates) {
                            thing = findThingByName(candidate);
                            if (thing) {
                                break;
                            }
                        }
                        if (!thing) {
                            continue;
                        }
                        if (changeDescription && typeof thing.addStatusEffect === 'function') {
                            thing.addStatusEffect(makeStatusEffect(changeDescription, null));
                        }
                        if (originalName && newName && newName !== originalName && typeof thing.rename === 'function') {
                            thing.rename(newName);
                        }
                        if (originalName) {
                            this.alteredItems.add(originalName);
                        }
                        if (newName) {
                            this.alteredItems.add(newName);
                        }
                        entry.originalName = originalName || null;
                        entry.newName = newName || null;
                        entry.changeDescription = changeDescription || null;
                        entry.description = changeDescription || entry.description || null;
                        entry.from = entry.originalName;
                        entry.to = entry.newName;
                    }
                    return;
                }

                const tasks = [];

                for (const entry of entries) {
                    if (!entry) {
                        continue;
                    }

                    const originalName = entry.originalName || entry.from || null;
                    const targetName = entry.newName || entry.to || null;
                    const changeDescription = entry.changeDescription || entry.description || null;

                    const lookupCandidates = [originalName, targetName]
                        .filter(candidate => typeof candidate === 'string' && candidate.trim());

                    let thing = null;
                    for (const candidate of lookupCandidates) {
                        thing = findThingByName(candidate);
                        if (thing) {
                            break;
                        }
                    }

                    if (!thing) {
                        thing = this._createPlaceholderThingForAlter(entry, context);
                    }

                    if (!thing) {
                        continue;
                    }

                    tasks.push((async () => {
                        const outcome = await alterThingByPrompt({
                            thing,
                            changeDescription,
                            newName: targetName,
                            location: context.location || null,
                            owner: context.player || this.currentPlayer || null
                        });

                        if (outcome?.originalName) {
                            this.alteredItems.add(outcome.originalName);
                        }
                        if (outcome?.newName) {
                            this.alteredItems.add(outcome.newName);
                        }

                        entry.originalName = outcome?.originalName || originalName || null;
                        entry.newName = outcome?.newName || targetName || null;
                        entry.changeDescription = outcome?.changeDescription || changeDescription || null;
                        entry.description = entry.changeDescription;
                        entry.from = entry.originalName;
                        entry.to = entry.newName;
                    })());
                }

                if (tasks.length) {
                    await Promise.all(tasks);
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
                    if (entry.item) {
                        this.obtainedItems.add(entry.item);
                    }
                }
            },
            harvest_gather: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findActorByName, generateItemsByNames } = this._deps;
                if (typeof generateItemsByNames !== 'function') {
                    throw new Error('harvest_gather handler requires generateItemsByNames dependency.');
                }

                const generationTasks = [];
                for (const entry of entries) {
                    const actor = entry.harvester ? findActorByName?.(entry.harvester) : null;
                    if (actor && typeof actor.addInventoryItem === 'function' && entry.item) {
                        generationTasks.push(
                            generateItemsByNames({ itemNames: [entry.item], owner: actor }).catch(error => {
                                console.warn('Failed to generate harvested item:', error.message);
                                return [];
                            })
                        );
                    }
                    if (entry.item) {
                        this.obtainedItems.add(entry.item);
                    }
                }

                if (generationTasks.length) {
                    await Promise.all(generationTasks);
                }
            },
            pick_up_item: async function (entries = [], context = {}) {
                if (!Array.isArray(entries) || !entries.length) {
                    return;
                }
                const { findThingByName, findActorByName } = this._deps;
                for (const entry of entries) {
                    let thing = findThingByName?.(entry.item);
                    const actor = findActorByName?.(entry.name);
                    if (!thing) {
                        await this._ensureItemsExist([entry.item], context.location, {
                            allowObtained: true,
                            recordNewItems: false
                        });
                        thing = findThingByName?.(entry.item);
                    }
                    if (!thing || !actor || typeof actor.addInventoryItem !== 'function') {
                        continue;
                    }
                    this._detachThingFromKnownLocation(thing);
                    actor.addInventoryItem(thing);
                    thing.metadata = { ...(thing.metadata || {}), ownerId: actor.id };
                    if (entry.item) {
                        this.obtainedItems.add(entry.item);
                    }
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
                    if (entry.item) {
                        this.droppedItems.add(entry.item);
                    }
                }
            },
            item_appear: async function (items = [], context = {}) {
                if (!Array.isArray(items) || !items.length) {
                    return;
                }

                await this._ensureItemsExist(items, context.location);
            },
            scenery_appear: async function (items = [], context = {}) {
                if (!Array.isArray(items) || !items.length) {
                    return;
                }

                try {
                    await this._generateItemsIntoWorld(items, context.location, { treatAsScenery: true });
                } catch (error) {
                    console.warn('Failed to generate scenery items:', error.message);
                }

                for (const item of items) {
                    if (typeof item === 'string' && item.trim()) {
                        this.newItems.add(item);
                    }
                }
            },
            harvestable_resource_appear: async function (items = [], context = {}) {
                if (!Array.isArray(items) || !items.length) {
                    return;
                }

                try {
                    await this._generateItemsIntoWorld(items, context.location, { treatAsResource: true });
                } catch (error) {
                    console.warn('Failed to generate harvestable resources:', error.message);
                }

                for (const item of items) {
                    if (typeof item === 'string' && item.trim()) {
                        this.newItems.add(item);
                    }
                }
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
                    if (entry.name) {
                        this.alteredCharacters.add(entry.name);
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
                        this.arrivedCharacters.add(name);
                        if (entry.firstAppearance) {
                            this.newCharacters.add(name);
                        }
                    }
                    const npc = findActorByName?.(name);
                    if (!npc) {
                        continue;
                    }
                    if (entry.action === 'left' && typeof npc.setLocation === 'function') {
                        npc.setLocation(null);
                        this.departedCharacters.add(name);
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
                    if (entry.entity) {
                        this.alteredCharacters.add(entry.entity);
                    }
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
                    if (entry.character) {
                        this.alteredCharacters.add(entry.character);
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
                    if (name) {
                        this.defeatedEnemies.add(name);
                    }
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
                        this.movedLocations.add(destination.name || destinationName);
                    }
                } catch (error) {
                    console.warn('Failed to move player location:', error.message);
                }
            }
        };
    }

    static _generateItemsIntoWorld(names = [], location = null, options = {}) {
        if (!Array.isArray(names) || !names.length) {
            return Promise.resolve([]);
        }

        const { generateItemsByNames } = this._deps;
        if (typeof generateItemsByNames !== 'function') {
            return Promise.reject(new Error('generateItemsByNames dependency is not configured.'));
        }

        const locationCandidate = this.resolveLocationCandidate(location) || location;
        return generateItemsByNames({ itemNames: names, location: locationCandidate, options });
    }

    static async _ensureItemsExist(rawNames = [], location = null, { allowObtained = false, recordNewItems = true } = {}) {
        if (!Array.isArray(rawNames) || !rawNames.length) {
            return [];
        }

        const names = [];
        for (const raw of rawNames) {
            if (typeof raw !== 'string') {
                continue;
            }
            const trimmed = raw.trim();
            if (!trimmed) {
                continue;
            }
            if (!allowObtained && this.obtainedItems.has(trimmed)) {
                continue;
            }
            names.push(trimmed);
        }

        if (!names.length) {
            return [];
        }

        try {
            await this._generateItemsIntoWorld(names, location);
        } catch (error) {
            console.warn('Failed to generate items:', error.message);
            return [];
        }

        if (recordNewItems) {
            for (const name of names) {
                this.newItems.add(name);
            }
        }

        return names;
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

    static _createPlaceholderThingForAlter(entry = {}, context = {}) {
        const { things } = this._deps;

        const candidateName = (typeof entry.newName === 'string' && entry.newName.trim())
            ? entry.newName.trim()
            : (typeof entry.originalName === 'string' && entry.originalName.trim() ? entry.originalName.trim() : null);

        if (!candidateName) {
            return null;
        }

        const description = entry.changeDescription && entry.changeDescription.trim()
            ? entry.changeDescription.trim()
            : `An item named ${candidateName}.`;

        const ownerCandidate = context.player && typeof context.player.addInventoryItem === 'function'
            ? context.player
            : null;

        let locationCandidate = context.location || null;
        if (!locationCandidate && ownerCandidate?.currentLocation) {
            locationCandidate = ownerCandidate.currentLocation;
        }

        const metadata = {};
        if (ownerCandidate && typeof ownerCandidate.id === 'string') {
            metadata.ownerId = ownerCandidate.id;
        } else {
            const resolvedLocation = this.resolveLocationCandidate(locationCandidate) || this.resolveLocationCandidate(this.currentPlayer?.currentLocation);
            if (resolvedLocation) {
                metadata.locationId = resolvedLocation.id;
                metadata.locationName = resolvedLocation.name || resolvedLocation.id;
            }
        }

        const thing = new Thing({
            name: candidateName,
            description,
            thingType: 'item',
            rarity: Thing.getDefaultRarityLabel(),
            metadata
        });

        if (things instanceof Map) {
            things.set(thing.id, thing);
        }

        if (metadata.ownerId && ownerCandidate) {
            try {
                ownerCandidate.addInventoryItem?.(thing);
            } catch (error) {
                console.warn(`Failed to add placeholder item ${candidateName} to owner:`, error.message);
            }
        } else if (metadata.locationId) {
            this.addThingToLocation(thing, metadata.locationId);
        }

        return thing;
    }
}

module.exports = Events;
