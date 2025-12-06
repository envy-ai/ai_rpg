const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const Thing = require('./Thing.js');
const Skill = require('./Skill.js');
const StatusEffect = require('./StatusEffect.js');
const SanitizedStringMap = require('./SanitizedStringMap.js');
const { findPackageJSON } = require('module');
const Globals = require('./Globals.js');
const Quest = require('./Quest.js');

let CachedLocationModule = null;
function getLocationModule() {
    if (!CachedLocationModule) {
        CachedLocationModule = require('./Location.js');
    }
    return CachedLocationModule;
}

class Player {
    // Private fields using ES13 syntax
    #definitions;
    #attributes = {};
    #level;
    #health;
    #healthAttribute;
    #name;
    #description;
    #shortDescription;
    #class;
    #race;
    #gender;
    #id;
    #currentLocation;
    #imageId;
    #createdAt;
    #lastUpdated;
    #isNPC;
    #inventory;
    #partyMembers;
    #dispositions;
    #skills;
    #unspentSkillPoints;
    #statusEffects;
    #gearSlots;
    #gearSlotsByType;
    #gearSlotNameIndex;
    #abilities;
    #needBars;
    #experience;
    #currency;
    #personalityType;
    #personalityTraits;
    #personalityNotes;
    #goals = [];
    #isHostile;
    #isDead;
    #corpseCountdown;
    #importantMemories = [];
    #previousLocationId = null; // For tracking location changes. This is the location at the beginning of the turn.
    #lastActionWasTravel = false;
    #consecutiveTravelActions = 0;
    #turnsSincePartyMemoryGeneration = 0;
    #pendingPartyMemoryHistory = [];
    #partyMembershipChangedThisTurn = false;
    #isInPlayerParty = false;
    #partyMembersAddedThisTurn = new Set();
    #partyMembersRemovedThisTurn = new Set();
    #elapsedTime = 0;
    #lastVisitedTime = 0; // Decimal hours since last visit by player.
    #inCombat = false;
    #checkEquipment = false;
    #characterArc = { shortTerm: '', longTerm: '' };
    #quests = [];
    #lastOutcomeSucceeded = null;

    static #indexById = new Map();
    static #indexByName = new SanitizedStringMap();

    static #npcInventoryChangeHandler = null;
    static #levelUpHandler = null;
    static #needBarDefinitions = null;
    static #NEED_BAR_SMALL_FRACTION = 0.1;
    static #NEED_BAR_MEDIUM_FRACTION = 0.175;
    static #NEED_BAR_LARGE_FRACTION = 0.25;
    static #needBarMagnitudeValues;

    static availableSkills = new Map();
    static #gearSlotDefinitions = null;
    static #instances = new Set();
    static #dispositionDefinitions = null;
    static #currentPlayerResolver = null;

    static #experienceThreshold = 100;
    static #experienceRolloverMultiplier = 2 / 3;

    static #normalizeGoalList(source) {
        const goals = [];
        const append = (value) => {
            if (typeof value !== 'string') {
                return;
            }
            const trimmed = value.trim();
            if (!trimmed) {
                return;
            }
            if (!goals.includes(trimmed)) {
                goals.push(trimmed);
            }
        };

        const walk = (value) => {
            if (value === null || value === undefined) {
                return;
            }
            if (typeof value === 'string') {
                append(value);
                return;
            }
            if (Array.isArray(value)) {
                value.forEach(walk);
                return;
            }
            if (typeof value === 'object') {
                for (const entry of Object.values(value)) {
                    walk(entry);
                }
            }
        };

        walk(source);
        return goals;
    }

    static #normalizeCharacterArc(source) {
        const empty = { shortTerm: '', longTerm: '' };
        if (!source) {
            return { ...empty };
        }
        if (typeof source === 'string') {
            const trimmed = source.trim();
            return { shortTerm: trimmed, longTerm: '' };
        }
        if (typeof source !== 'object') {
            return { ...empty };
        }

        const shortTerm = typeof source.shortTerm === 'string' ? source.shortTerm.trim() : '';
        const longTerm = typeof source.longTerm === 'string' ? source.longTerm.trim() : '';

        return { shortTerm, longTerm };
    }

    static #normalizeNeedBarChangeList(source) {
        if (!source) {
            return [];
        }

        const items = [];
        const pushItem = (value) => {
            if (typeof value !== 'string') {
                return;
            }
            const trimmed = value.trim();
            if (trimmed) {
                items.push(trimmed);
            }
        };

        if (Array.isArray(source)) {
            source.forEach(pushItem);
        } else if (typeof source === 'string') {
            source.split(/[,\n;]/).forEach(pushItem);
        } else if (typeof source === 'object' && source !== null) {
            Object.values(source).forEach(pushItem);
        }

        return items;
    }

    static #normalizeNeedMagnitudeKey(value) {
        if (value === null || value === undefined) {
            return null;
        }
        const normalized = String(value).trim().toLowerCase();
        if (!normalized) {
            return null;
        }
        if (['small', 'minor', 'light', 'tiny'].includes(normalized)) {
            return 'small';
        }
        if (['medium', 'moderate', 'average', 'standard', 'normal'].includes(normalized)) {
            return 'medium';
        }
        if (['large', 'major', 'big', 'heavy', 'huge'].includes(normalized)) {
            return 'large';
        }
        if (['all', 'fill', 'full', 'max', 'maximum', 'complete'].includes(normalized)) {
            return 'all';
        }
        return normalized;
    }

    static #normalizeNeedValueMap(source) {
        if (!source || typeof source !== 'object') {
            return null;
        }

        const entries = {};
        for (const [rawKey, rawValue] of Object.entries(source)) {
            if (!rawKey) {
                continue;
            }
            const key = this.#normalizeNeedMagnitudeKey(rawKey);
            if (!key || key === 'all') {
                continue;
            }
            const numeric = Number(rawValue);
            if (!Number.isFinite(numeric) || numeric <= 0) {
                continue;
            }
            entries[key] = Math.round(numeric);
        }

        return Object.keys(entries).length ? Object.freeze(entries) : null;
    }

    static #buildNeedBarDefinition(id, config = {}) {
        if (!id) {
            return null;
        }

        const name = typeof config.name === 'string' ? config.name : id;
        const description = typeof config.description === 'string' ? config.description : '';
        const icon = typeof config.icon === 'string' ? config.icon : '';
        const color = typeof config.color === 'string' ? config.color : '';
        const min = Number.isFinite(Number(config.min)) ? Number(config.min) : 0;
        const max = Number.isFinite(Number(config.max)) ? Number(config.max) : 100;
        const changePerTurn = Number.isFinite(Number(config.change_per_turn)) ? Number(config.change_per_turn) : 0;
        const relativeToLevel = Boolean(config.relative_to_level);
        const playerOnly = Boolean(config.player_only);
        const relatedAttribute = typeof config.related_attribute === 'string' ? config.related_attribute : null;
        const initialValue = Number.isFinite(Number(config.initial)) ? Number(config.initial) : null;

        const effectThresholds = [];
        if (config.effect_thresholds && typeof config.effect_thresholds === 'object') {
            for (const [thresholdKey, thresholdConfig] of Object.entries(config.effect_thresholds)) {
                const threshold = Number(thresholdKey);
                if (!Number.isFinite(threshold)) {
                    continue;
                }
                const thresholdName = typeof thresholdConfig?.name === 'string' ? thresholdConfig.name : '';
                const thresholdEffect = typeof thresholdConfig?.effect === 'string' ? thresholdConfig.effect : '';
                effectThresholds.push({
                    threshold,
                    name: thresholdName,
                    effect: thresholdEffect
                });
            }
        }
        effectThresholds.sort((a, b) => a.threshold - b.threshold);

        return {
            id,
            name,
            description,
            icon,
            color,
            min,
            max,
            changePerTurn,
            relativeToLevel,
            playerOnly,
            relatedAttribute,
            initialValue,
            effectThresholds,
            increases: {
                small: this.#normalizeNeedBarChangeList(config.small_increase),
                large: this.#normalizeNeedBarChangeList(config.large_increase),
                fill: this.#normalizeNeedBarChangeList(config.fill_completely)
            },
            decreases: {
                small: this.#normalizeNeedBarChangeList(config.small_decrease),
                large: this.#normalizeNeedBarChangeList(config.large_decrease)
            }
        };
    }

    static #cloneNeedBarDefinition(definition) {
        if (!definition) {
            return null;
        }

        return {
            ...definition,
            effectThresholds: Array.isArray(definition.effectThresholds)
                ? definition.effectThresholds.map(entry => ({ ...entry }))
                : [],
            increases: {
                small: Array.isArray(definition.increases?.small) ? [...definition.increases.small] : [],
                large: Array.isArray(definition.increases?.large) ? [...definition.increases.large] : [],
                fill: Array.isArray(definition.increases?.fill) ? [...definition.increases.fill] : []
            },
            decreases: {
                small: Array.isArray(definition.decreases?.small) ? [...definition.decreases.small] : [],
                large: Array.isArray(definition.decreases?.large) ? [...definition.decreases.large] : []
            },
            currentThreshold: definition.currentThreshold
                ? { ...definition.currentThreshold }
                : null
        };
    }

    static #formatNeedBarForContext(definition, { includeValue = true } = {}) {
        if (!definition) {
            return null;
        }

        const ensureList = (input) => {
            if (!input) {
                return [];
            }
            if (Array.isArray(input)) {
                return input
                    .map(item => {
                        const asString = typeof item === 'string' ? item : String(item ?? '');
                        return asString.trim();
                    })
                    .filter(Boolean);
            }
            if (typeof input === 'string') {
                return input
                    .split(/[\r\n,;]/)
                    .map(entry => entry.trim())
                    .filter(Boolean);
            }
            if (typeof input === 'object') {
                return Object.values(input)
                    .map(item => {
                        const asString = typeof item === 'string' ? item : String(item ?? '');
                        return asString.trim();
                    })
                    .filter(Boolean);
            }
            return [];
        };

        const effectThresholds = Array.isArray(definition.effectThresholds)
            ? definition.effectThresholds.map(entry => ({
                threshold: Number.isFinite(entry?.threshold) ? Number(entry.threshold) : null,
                name: typeof entry?.name === 'string' ? entry.name : '',
                effect: typeof entry?.effect === 'string' ? entry.effect : ''
            })).filter(entry => entry.threshold !== null || entry.name || entry.effect)
            : [];

        const currentThreshold = includeValue && definition.currentThreshold
            ? {
                threshold: Number.isFinite(definition.currentThreshold.threshold)
                    ? Number(definition.currentThreshold.threshold)
                    : null,
                name: typeof definition.currentThreshold.name === 'string'
                    ? definition.currentThreshold.name
                    : '',
                effect: typeof definition.currentThreshold.effect === 'string'
                    ? definition.currentThreshold.effect
                    : ''
            }
            : null;

        const normalizeNumber = (value) => {
            if (Number.isFinite(value)) {
                return Number(value);
            }
            if (Number.isFinite(Number(value))) {
                return Number(value);
            }
            return null;
        };

        const formatValue = includeValue ? normalizeNumber(definition.value) : null;

        return {
            id: typeof definition.id === 'string' ? definition.id : null,
            name: typeof definition.name === 'string' ? definition.name : (definition.id || 'Unknown'),
            description: typeof definition.description === 'string' ? definition.description : '',
            playerOnly: Boolean(definition.playerOnly),
            relatedAttribute: typeof definition.relatedAttribute === 'string'
                ? definition.relatedAttribute
                : null,
            changePerTurn: Number.isFinite(definition.changePerTurn)
                ? Number(definition.changePerTurn)
                : 0,
            relativeToLevel: Boolean(definition.relativeToLevel),
            min: normalizeNumber(definition.min),
            max: normalizeNumber(definition.max),
            initialValue: normalizeNumber(definition.initialValue),
            value: formatValue,
            currentThreshold,
            effectThresholds,
            increases: {
                small: ensureList(definition.increases?.small),
                large: ensureList(definition.increases?.large),
                fill: ensureList(definition.increases?.fill)
            },
            decreases: {
                small: ensureList(definition.decreases?.small),
                large: ensureList(definition.decreases?.large)
            }
        };
    }

    static #resolveNeedBarThreshold(effectThresholds, value) {
        if (!Array.isArray(effectThresholds) || effectThresholds.length === 0) {
            return null;
        }

        if (!Number.isFinite(value)) {
            return null;
        }

        let resolved = null;
        for (const entry of effectThresholds) {
            if (!entry || !Number.isFinite(entry.threshold)) {
                continue;
            }
            if (value >= entry.threshold && (!resolved || entry.threshold >= resolved.threshold)) {
                resolved = entry;
            }
        }

        return resolved ? { ...resolved } : null;
    }

    static #applyNeedBarValue(bar, candidateValue) {
        if (!bar) {
            return null;
        }

        const min = Number.isFinite(bar.min) ? bar.min : 0;
        const max = Number.isFinite(bar.max) ? bar.max : null;
        let resolvedValue = Number.isFinite(candidateValue) ? candidateValue : bar.value;
        if (!Number.isFinite(resolvedValue)) {
            resolvedValue = Number.isFinite(max) ? max : min;
        }

        if (Number.isFinite(min)) {
            resolvedValue = Math.max(min, resolvedValue);
        }
        if (Number.isFinite(max)) {
            resolvedValue = Math.min(max, resolvedValue);
        }

        bar.value = resolvedValue;
        bar.currentThreshold = this.#resolveNeedBarThreshold(bar.effectThresholds, resolvedValue);
        return resolvedValue;
    }

    static get gearSlotDefinitions() {
        if (!this.#gearSlotDefinitions) {
            this.#gearSlotDefinitions = this.#loadGearSlotDefinitions();
        }
        return this.#gearSlotDefinitions;
    }

    static get dispositionDefinitions() {
        if (!this.#dispositionDefinitions) {
            this.#dispositionDefinitions = this.#loadDispositionDefinitions();
        }
        return this.#dispositionDefinitions;
    }

    static getDispositionDefinitions() {
        return this.dispositionDefinitions;
    }

    static getDispositionDefinition(name) {
        const key = this.#normalizeDispositionType(name);
        const definitions = this.dispositionDefinitions;
        return definitions.types[key] || null;
    }

    static resolveDispositionIntensity(type, value = 0) {
        const key = this.#normalizeDispositionType(type);
        const definitions = this.dispositionDefinitions;
        const dispositionDef = definitions.types[key];
        if (!dispositionDef || !Array.isArray(dispositionDef.thresholds) || dispositionDef.thresholds.length === 0) {
            return 'neutral';
        }

        const thresholds = dispositionDef.thresholds;
        const numericValue = Number(value);
        const resolvedValue = Number.isFinite(numericValue) ? numericValue : 0;
        let intensity = thresholds[0]?.name || 'neutral';
        for (const entry of thresholds) {
            if (resolvedValue >= entry.threshold) {
                intensity = entry.name || intensity;
            }
        }
        return intensity || 'neutral';
    }

    static setCurrentPlayerResolver(resolver) {
        if (resolver && typeof resolver !== 'function') {
            throw new Error('Current player resolver must be a function or null');
        }
        this.#currentPlayerResolver = resolver || null;
    }

    static getCurrentPlayer() {
        return typeof this.#currentPlayerResolver === 'function'
            ? this.#currentPlayerResolver()
            : null;
    }

    static getCurrentPlayerId() {
        const player = this.getCurrentPlayer();
        return player && typeof player.id === 'string' ? player.id : null;
    }

    static getById(playerId) {
        if (typeof playerId !== 'string') {
            return null;
        }
        const trimmed = playerId.trim();
        if (!trimmed) {
            return null;
        }
        for (const player of this.#instances) {
            if (player?.id === trimmed) {
                return player;
            }
        }
        return null;
    }

    static resolvePlayerId(playerLike) {
        if (!playerLike) {
            return null;
        }
        if (typeof playerLike === 'string') {
            const trimmed = playerLike.trim();
            return trimmed || null;
        }
        if (typeof playerLike.id === 'string') {
            return playerLike.id;
        }
        return null;
    }

    static setNpcInventoryChangeHandler(handler) {
        if (handler && typeof handler !== 'function') {
            throw new Error('NPC inventory change handler must be a function');
        }
        this.#npcInventoryChangeHandler = handler || null;
    }

    static setLevelUpHandler(handler) {
        if (handler && typeof handler !== 'function') {
            throw new Error('Level-up handler must be a function');
        }
        this.#levelUpHandler = handler || null;
    }

    static get indexByName() {
        return this.#indexByName;
    }

    static get indexById() {
        return this.#indexById;
    }

    static get needBarDefinitions() {
        if (!this.#needBarDefinitions) {
            try {
                const needBarsPath = path.join(__dirname, 'defs', 'need_bars.yaml');
                const raw = fs.readFileSync(needBarsPath, 'utf8');
                const data = yaml.load(raw) || {};
                const source = typeof data.need_bars === 'object' && data.need_bars !== null ? data.need_bars : {};
                this.#needBarMagnitudeValues = this.#normalizeNeedValueMap(data.need_values);
                const normalized = {};
                for (const [id, config] of Object.entries(source)) {
                    if (!id) {
                        continue;
                    }
                    const trimmedId = id.trim();
                    if (!trimmedId || typeof config !== 'object' || config === null) {
                        continue;
                    }
                    const definition = this.#buildNeedBarDefinition(trimmedId, config);
                    if (!definition) {
                        continue;
                    }
                    normalized[trimmedId] = Object.freeze(this.#cloneNeedBarDefinition(definition));
                }
                this.#needBarDefinitions = normalized;
            } catch (error) {
                console.warn('Failed to load need bar definitions:', error?.message || error);
                this.#needBarDefinitions = {};
                this.#needBarMagnitudeValues = null;
            }
        }
        return this.#needBarDefinitions;
    }

    static get needBars() {
        return this.needBarDefinitions;
    }

    static get needBarMagnitudeValues() {
        if (this.#needBarMagnitudeValues === undefined) {
            this.needBarDefinitions;
            if (this.#needBarMagnitudeValues === undefined) {
                this.#needBarMagnitudeValues = null;
            }
        }
        return this.#needBarMagnitudeValues;
    }

    static getNeedBarDefinitionsForContext() {
        const definitions = this.needBarDefinitions || {};
        const list = [];
        for (const definition of Object.values(definitions)) {
            const cloned = this.#cloneNeedBarDefinition(definition);
            const formatted = this.#formatNeedBarForContext(cloned, { includeValue: false });
            if (formatted) {
                list.push(formatted);
            }
        }
        list.sort((a, b) => a.name.localeCompare(b.name));
        return list;
    }

    static getAll() {
        return Array.from(this.#instances);
    }

    static unregister(target) {
        if (!target) {
            return false;
        }
        if (target instanceof Player) {
            return this.#instances.delete(target);
        }
        if (typeof target === 'string') {
            for (const instance of this.#instances) {
                if (instance?.id === target) {
                    return this.#instances.delete(instance);
                }
            }
        }
        return false;
    }

    static getByName(name) {
        for (const player of this.#instances) {
            if (player.name && player.name.toLowerCase() === name.toLowerCase()) {
                return player;
            }
        }
        return null;
    }

    static getByNames(names) {
        // If names is a set, convert to array
        if (names instanceof Set) {
            names = Array.from(names);
        }

        if (!Array.isArray(names) || names.length === 0) {
            return [];
        }
        const results = [];
        for (const name of names) {
            const player = this.getByName(name);
            if (player) {
                results.push(player);
            }
        }
        return results;
    }

    static getById(id) {
        if (!id) {
            return null;
        }
        for (const player of this.#instances) {
            if (player.id === id) {
                return player;
            }
        }
        return null;
    }

    //Just an alias
    static get(id) {
        return this.getById(id);
    }

    static #notifyNpcInventoryChange(player, payload = {}) {
        if (!player || !player.isNPC || !this.#npcInventoryChangeHandler) {
            return;
        }

        try {
            const result = this.#npcInventoryChangeHandler({
                character: player,
                ...payload
            });
            if (result && typeof result.then === 'function') {
                result.catch(error => {
                    console.warn('NPC inventory change handler failed:', error?.message || error);
                });
            }
        } catch (error) {
            console.warn('NPC inventory change handler errored:', error?.message || error);
        }
    }

    static #normalizeDispositionType(type) {
        if (typeof type !== 'string') {
            return 'default';
        }
        const normalized = type.trim().toLowerCase();
        return normalized || 'default';
    }

    static #sanitizePersonalityValue(value) {
        const collectValues = (input) => {
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
                return input.flatMap(collectValues);
            }

            if (typeof input === 'object') {
                return Object.values(input).flatMap(collectValues);
            }

            return [];
        };

        const parts = collectValues(value);
        if (!parts.length) {
            return null;
        }

        return parts.join(', ');
    }

    static #loadGearSlotDefinitions() {
        try {
            const gearPath = path.join(__dirname, 'defs', 'gear_slots.yaml');
            const raw = fs.readFileSync(gearPath, 'utf8');
            const data = yaml.load(raw) || {};
            const gearSlots = data.gear_slots && typeof data.gear_slots === 'object' ? data.gear_slots : {};

            const byType = new Map();
            const byName = new Map();
            const nameLookup = new Map();

            for (const [typeKey, slotNames] of Object.entries(gearSlots)) {
                if (!typeKey || typeof typeKey !== 'string') {
                    continue;
                }
                const slotType = typeKey.trim().toLowerCase();
                if (!slotType) {
                    continue;
                }

                const normalizedNames = Array.isArray(slotNames)
                    ? slotNames
                    : [slotNames];

                const cleanedNames = normalizedNames
                    .map(name => {
                        if (typeof name !== 'string') {
                            return null;
                        }
                        const trimmed = name.trim();
                        return trimmed || null;
                    })
                    .filter(Boolean);

                if (!cleanedNames.length) {
                    continue;
                }

                byType.set(slotType, cleanedNames);

                for (const slotName of cleanedNames) {
                    const lowerName = slotName.toLowerCase();
                    nameLookup.set(lowerName, slotName);
                    byName.set(slotName, slotType);
                }
            }

            return {
                byType,
                byName,
                nameLookup
            };
        } catch (error) {
            console.error('Error loading gear slot definitions:', error.message);
            return {
                byType: new Map(),
                byName: new Map(),
                nameLookup: new Map()
            };
        }
    }

    static #loadDispositionDefinitions() {
        try {
            const dispositionPath = path.join(__dirname, 'defs', 'dispositions.yaml');
            const raw = fs.readFileSync(dispositionPath, 'utf8');
            const data = yaml.load(raw) || {};

            const rangeSource = typeof data.range === 'object' && data.range !== null ? data.range : {};
            const range = {
                min: Number.isFinite(Number(rangeSource.min)) ? Number(rangeSource.min) : null,
                max: Number.isFinite(Number(rangeSource.max)) ? Number(rangeSource.max) : null,
                typicalStep: Number.isFinite(Number(rangeSource.typical_step)) ? Number(rangeSource.typical_step) : null,
                typicalBigStep: Number.isFinite(Number(rangeSource.typical_big_step)) ? Number(rangeSource.typical_big_step) : null
            };
            const firstImpressionMultiplier = Number.isFinite(Number(data.first_impression_multiplier))
                ? Number(data.first_impression_multiplier)
                : null;

            const dispositionSource = typeof data.dispositions === 'object' && data.dispositions !== null
                ? data.dispositions
                : {};

            const types = {};
            for (const [name, config] of Object.entries(dispositionSource)) {
                if (!name || typeof config !== 'object' || config === null) {
                    continue;
                }

                const label = String(name).trim();
                if (!label) {
                    continue;
                }

                const key = this.#normalizeDispositionType(label);

                const description = typeof config.description === 'string' ? config.description.trim() : '';
                const moveUp = Array.isArray(config.move_up)
                    ? config.move_up.filter(entry => typeof entry === 'string' && entry.trim()).map(entry => entry.trim())
                    : [];
                const moveDown = Array.isArray(config.move_down)
                    ? config.move_down.filter(entry => typeof entry === 'string' && entry.trim()).map(entry => entry.trim())
                    : [];
                const moveWayDown = Array.isArray(config.move_way_down)
                    ? config.move_way_down.filter(entry => typeof entry === 'string' && entry.trim()).map(entry => entry.trim())
                    : [];

                const hostileValueRaw = config.hostile_value;
                const hostileThresholdRaw = config.hostile_threshold;
                const hostileValue = Number.isFinite(Number(hostileValueRaw)) ? Number(hostileValueRaw) : null;
                let hostileThreshold = null;
                if (hostileThresholdRaw === null) {
                    hostileThreshold = null;
                } else if (hostileThresholdRaw !== undefined) {
                    const numericThreshold = Number(hostileThresholdRaw);
                    hostileThreshold = Number.isFinite(numericThreshold) ? numericThreshold : null;
                }

                const thresholdsSource = typeof config.min_thresholds === 'object' && config.min_thresholds !== null
                    ? config.min_thresholds
                    : {};

                const thresholds = Object.entries(thresholdsSource)
                    .map(([rawThreshold, rawLabel]) => {
                        const numericThreshold = Number(rawThreshold);
                        if (!Number.isFinite(numericThreshold)) {
                            return null;
                        }
                        const thresholdLabel = typeof rawLabel === 'string'
                            ? rawLabel.trim()
                            : (rawLabel ? String(rawLabel).trim() : '');
                        if (!thresholdLabel) {
                            return null;
                        }
                        return {
                            threshold: numericThreshold,
                            name: thresholdLabel
                        };
                    })
                    .filter(Boolean)
                    .sort((a, b) => a.threshold - b.threshold);

                types[key] = {
                    key,
                    label,
                    description,
                    moveUp,
                    moveDown,
                    moveWayDown,
                    thresholds,
                    hostileValue,
                    hostileThreshold
                };
            }

            return {
                range,
                types,
                firstImpressionMultiplier
            };
        } catch (error) {
            console.error('Error loading dispositions definitions:', error.message);
            return {
                range: {
                    min: null,
                    max: null,
                    typicalStep: null,
                    typicalBigStep: null
                },
                types: {}
            };
        }
    }

    // Static private method for ID generation
    static #generateUniqueId() {
        return `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    constructor(options = {}) {
        // Load definitions first
        this.#definitions = this.#loadDefinitions();

        // Initialize attributes dynamically from definitions
        this.#initializeAttributes(options.attributes ?? {});

        this.#inventory = new Set();
        this.#initializeInventory(options.inventory);

        this.#healthAttribute = this.#resolveHealthAttribute(options.healthAttribute);

        // Base stats (not attributes)
        this.#level = options.level ?? 1;

        const initialMaxHealth = this.#calculateBaseHealth();
        this.#health = options.health ?? initialMaxHealth;

        // Player identification
        this.#name = options.name ?? "Unnamed Player";
        this.#description = options.description ?? "A mysterious adventurer with an unknown past.";
        this.#shortDescription = options.shortDescription ?? "";
        this.#id = options.id ?? Player.#generateUniqueId();
        this.#class = options.class ?? "person";
        this.#race = options.race ?? "human";
        this.#gender = options.gender ?? "unspecified";
        this.#isDead = options.isDead ?? false;
        this.#inCombat = options.inCombat ?? false;
        this.#characterArc = Player.#normalizeCharacterArc(options.characterArc);
        this.#corpseCountdown = Number.isFinite(options.corpseCountdown) ? options.corpseCountdown : null;

        const seedMemories = Array.isArray(options.importantMemories)
            ? options.importantMemories
                .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean)
            : [];
        this.#importantMemories = seedMemories.slice(0);

        // Location (can be Location ID string or Location object)
        this.#currentLocation = options.location ?? null;

        // Player image ID for generated portrait
        this.#imageId = options.imageId ?? null;
        this.#isNPC = Boolean(options.isNPC);
        this.#isHostile = this.#isNPC && Boolean(options.isHostile);
        this.#elapsedTime = Number.isFinite(options.elapsedTime) && options.elapsedTime > 0
            ? Math.floor(options.elapsedTime)
            : 0;

        const personalityOption = options.personality && typeof options.personality === 'object'
            ? options.personality
            : null;
        this.#personalityType = Player.#sanitizePersonalityValue(options.personalityType ?? personalityOption?.type);
        this.#personalityTraits = Player.#sanitizePersonalityValue(options.personalityTraits ?? personalityOption?.traits);
        this.#personalityNotes = Player.#sanitizePersonalityValue(options.personalityNotes ?? personalityOption?.notes);
        this.#goals = Player.#normalizeGoalList(options.goals ?? personalityOption?.goals ?? []);

        this.#partyMembers = new Set(Array.isArray(options.partyMembers) ? options.partyMembers.filter(id => typeof id === 'string') : []);
        this.#dispositions = this.#initializeDispositions(options.dispositions);
        if (this.#isHostile) {
            this.#applyHostileDispositionsToCurrentPlayer();
        }
        if (this.#partyMembers.size) {
            for (const memberId of this.#partyMembers) {
                const member = Player.getById(memberId);
                if (member && typeof member.setInPlayerParty === 'function') {
                    member.setInPlayerParty(true);
                }
            }
        }
        const turnsSincePartyMemoryGeneration = Number(options.turnsSincePartyMemoryGeneration);
        if (Number.isFinite(turnsSincePartyMemoryGeneration) && turnsSincePartyMemoryGeneration > 0) {
            this.#turnsSincePartyMemoryGeneration = Math.floor(turnsSincePartyMemoryGeneration);
        }

        this.#pendingPartyMemoryHistory = Array.isArray(options.partyMemoryHistorySegments)
            ? options.partyMemoryHistorySegments
                .map(segment => (Array.isArray(segment)
                    ? segment
                        .filter(entry => entry && typeof entry === 'object')
                        .map(entry => ({
                            role: entry.role || null,
                            content: entry.content || '',
                            summary: entry.summary || null,
                            metadata: entry.metadata && typeof entry.metadata === 'object'
                                ? {
                                    npcNames: Array.isArray(entry.metadata.npcNames) ? entry.metadata.npcNames.slice(0) : undefined,
                                    locationId: entry.metadata.locationId || null
                                }
                                : undefined
                        }))
                    : null))
                .filter(Boolean)
            : [];

        this.#partyMembershipChangedThisTurn = Boolean(options.partyMembershipChangedThisTurn);
        this.#isInPlayerParty = Boolean(options.isInPlayerParty);

        const addedThisTurn = Array.isArray(options.partyMembersAddedThisTurn)
            ? options.partyMembersAddedThisTurn.filter(id => typeof id === 'string')
            : [];
        this.#partyMembersAddedThisTurn = new Set(addedThisTurn);

        const removedThisTurn = Array.isArray(options.partyMembersRemovedThisTurn)
            ? options.partyMembersRemovedThisTurn.filter(id => typeof id === 'string')
            : [];
        this.#partyMembersRemovedThisTurn = new Set(removedThisTurn);

        this.#skills = new Map();
        this.#initializeSkills(options.skills);
        this.#abilities = this.#normalizeAbilities(options.abilities);
        this.#initializeGear(options.gear);

        const providedPoints = Number(options.unspentSkillPoints);
        if (Number.isFinite(providedPoints)) {
            this.#unspentSkillPoints = Math.max(0, Math.floor(providedPoints));
        } else {
            this.#unspentSkillPoints = this.#skillPointsPerLevel() * this.#level;
        }

        this.#statusEffects = this.#normalizeStatusEffects(options.statusEffects);

        const initialExperience = Number.isFinite(options.experience)
            ? Math.max(0, Number(options.experience))
            : 0;
        this.#experience = initialExperience;
        const initialCurrency = Number.isFinite(options.currency)
            ? Math.max(0, Math.floor(options.currency))
            : 0;
        this.#currency = initialCurrency;
        this.#processExperienceOverflow();

        this.#initializeNeedBars(options.needBars);

        // Creation timestamp
        this.#createdAt = options.createdAt || new Date().toISOString();
        this.#lastUpdated = options.lastUpdated || this.#createdAt;

        Player.#indexById.set(this.#id, this);
        Player.#indexByName.set(this.#name.toLowerCase(), this);

        Player.#instances.add(this);
    }

    /**
     * Load complete definitions from YAML file (private method)
     */
    #loadDefinitions() {
        try {
            const defsPath = path.join(__dirname, 'defs', 'attributes.yaml');
            const fileContents = fs.readFileSync(defsPath, 'utf8');
            const data = yaml.load(fileContents);
            return data;
        } catch (error) {
            console.error('Error loading attribute definitions:', error.message);
            // Fallback to basic definitions
            return {
                attributes: {
                    strength: { label: 'Strength', default: 10, min: 3, max: 18 },
                    dexterity: { label: 'Dexterity', default: 10, min: 3, max: 18 },
                    constitution: { label: 'Constitution', default: 10, min: 3, max: 18 },
                    intelligence: { label: 'Intelligence', default: 10, min: 3, max: 18 },
                    wisdom: { label: 'Wisdom', default: 10, min: 3, max: 18 },
                    charisma: { label: 'Charisma', default: 10, min: 3, max: 18 }
                },
                system: {
                    modifierFormula: "floor((value - 10) / 2)",
                    validationRules: { enforceMinMax: true }
                }
            };
        }
    }

    /**
     * Initialize attributes dynamically from definitions (private method)
     */
    #initializeAttributes(providedAttributes = {}) {
        for (const [attrName, attrDef] of Object.entries(this.attributeDefinitions)) {
            // Use provided value, or default from definition, or fallback to 10
            this.#attributes[attrName] = providedAttributes[attrName] ?? attrDef.default ?? 10;
        }
    }

    #initializeInventory(items = []) {
        if (!Array.isArray(items)) {
            return;
        }
        for (const entry of items) {
            this.#addInventoryThing(entry, { updateTimestamp: false, suppressNpcEquip: true });
        }
    }

    #initializeGear(gearState = null) {
        const definitions = Player.gearSlotDefinitions;
        this.#gearSlots = new Map();
        this.#gearSlotsByType = new Map();
        this.#gearSlotNameIndex = new Map();

        const normalizedState = gearState instanceof Map
            ? Object.fromEntries(gearState.entries())
            : (gearState && typeof gearState === 'object' ? { ...gearState } : {});

        for (const [slotType, slotNames] of definitions.byType.entries()) {
            const slotsForType = [];
            for (const slotName of slotNames) {
                if (typeof slotName !== 'string') {
                    continue;
                }
                const trimmedName = slotName.trim();
                if (!trimmedName) {
                    continue;
                }

                const lowerKey = trimmedName.toLowerCase();
                this.#gearSlotNameIndex.set(lowerKey, trimmedName);
                slotsForType.push(trimmedName);

                const rawEntry = normalizedState && Object.prototype.hasOwnProperty.call(normalizedState, trimmedName)
                    ? normalizedState[trimmedName]
                    : null;

                const itemId = this.#resolveItemIdFromGearValue(rawEntry);

                this.#gearSlots.set(trimmedName, {
                    slotType,
                    itemId
                });
            }

            if (slotsForType.length > 0) {
                this.#gearSlotsByType.set(slotType, slotsForType);
            }
        }

        this.#syncGearWithInventory();
    }

    #resolveItemIdFromGearValue(value) {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed || null;
        }
        if (typeof value === 'object') {
            if (typeof value.itemId === 'string') {
                const trimmed = value.itemId.trim();
                return trimmed || null;
            }
            if (typeof value.id === 'string') {
                const trimmed = value.id.trim();
                return trimmed || null;
            }
        }
        return null;
    }

    #normalizeSlotType(slotType) {
        if (!slotType || (typeof slotType !== 'string' && typeof slotType !== 'number')) {
            return null;
        }
        const trimmed = String(slotType).trim().toLowerCase();
        return trimmed || null;
    }

    #resolveSlotName(slotName) {
        if (!slotName || typeof slotName !== 'string') {
            return null;
        }
        const trimmed = slotName.trim();
        if (!trimmed) {
            return null;
        }
        if (this.#gearSlots && this.#gearSlots.has(trimmed)) {
            return trimmed;
        }
        // tolowercase breaks map handing here, so we're not doing that.
        const lookup = this.#gearSlotNameIndex?.get(trimmed);
        return lookup || null;
    }

    #syncGearWithInventory() {
        if (!this.#gearSlots || this.#gearSlots.size === 0) {
            return;
        }

        const inventoryIds = new Set();
        if (this.#inventory && this.#inventory.size > 0) {
            for (const item of this.#inventory.values()) {
                if (item && typeof item.id === 'string') {
                    inventoryIds.add(item.id);
                }
            }
        }

        for (const slotData of this.#gearSlots.values()) {
            if (!slotData) {
                continue;
            }
            if (slotData.itemId && !inventoryIds.has(slotData.itemId)) {
                slotData.itemId = null;
            }
        }
    }

    #initializeDispositions(source = {}) {
        if (!source || typeof source !== 'object') {
            return new Map();
        }
        const dispositionMap = new Map();
        for (const [npcId, types] of Object.entries(source)) {
            if (typeof npcId !== 'string' || !types || typeof types !== 'object') {
                continue;
            }
            const typeMap = new Map();
            for (const [type, value] of Object.entries(types)) {
                const normalizedType = Player.#normalizeDispositionType(type);
                const numericValue = Number(value);
                if (!normalizedType || !Number.isFinite(numericValue)) {
                    continue;
                }
                typeMap.set(normalizedType, numericValue);
            }
            if (typeMap.size > 0) {
                dispositionMap.set(npcId, typeMap);
            }
        }
        return dispositionMap;
    }

    #applyHostileDispositionsToCurrentPlayer() {
        if (!this.#isNPC || !this.#isHostile) {
            return;
        }
        const targetPlayerId = Player.getCurrentPlayerId();
        if (!targetPlayerId || targetPlayerId === this.#id) {
            return;
        }
        const definitions = Player.dispositionDefinitions;
        const types = definitions?.types || {};
        for (const def of Object.values(types)) {
            if (!def) {
                continue;
            }
            const targetValue = Number(def.hostileValue);
            if (!Number.isFinite(targetValue)) {
                continue;
            }
            const dispositionKey = def.key || def.label;
            if (!dispositionKey) {
                continue;
            }
            const normalizedKey = Player.#normalizeDispositionType(dispositionKey);
            const existingMap = this.#dispositions.get(targetPlayerId);
            if (existingMap && (existingMap.has(normalizedKey) || existingMap.has(dispositionKey))) {
                continue;
            }
            this.setDisposition(targetPlayerId, dispositionKey, targetValue);
        }
    }

    #initializeSkills(skillValues = {}) {
        const available = Player.availableSkills instanceof Map ? Player.availableSkills : new Map();

        let providedMap;
        if (skillValues instanceof Map) {
            providedMap = new Map(skillValues);
        } else if (Array.isArray(skillValues)) {
            providedMap = new Map(skillValues);
        } else if (skillValues && typeof skillValues === 'object') {
            providedMap = new Map(Object.entries(skillValues));
        } else {
            providedMap = new Map();
        }

        if (available.size > 0) {
            for (const [skillName] of available) {
                const raw = providedMap.has(skillName) ? Number(providedMap.get(skillName)) : 1;
                const value = Number.isFinite(raw) ? raw : 1;
                this.#skills.set(skillName, value);
            }
        } else if (providedMap.size > 0) {
            for (const [skillName, raw] of providedMap.entries()) {
                const value = Number.isFinite(Number(raw)) ? Number(raw) : 1;
                this.#skills.set(skillName, value);
            }
        }
    }

    #skillPointsPerLevel() {
        const availableCount = Player.availableSkills instanceof Map ? Player.availableSkills.size : 0;
        if (!availableCount || availableCount <= 0) {
            return 0;
        }
        return Math.ceil(availableCount / 5);
    }

    #resolveThing(thingLike) {
        if (!thingLike) {
            return null;
        }
        if (thingLike instanceof Thing) {
            return thingLike;
        }
        if (typeof thingLike === 'string') {
            return Thing.getById(thingLike);
        }
        if (typeof thingLike === 'object' && thingLike.id) {
            const existing = Thing.getById(thingLike.id);
            if (existing) {
                return existing;
            }
        }
        return null;
    }

    #addInventoryThing(thingLike, { updateTimestamp = true, suppressNpcEquip = false } = {}) {
        const resolved = this.#resolveThing(thingLike);
        if (!resolved) {
            return false;
        }

        const previousSize = this.#inventory.size;
        resolved.removeFromWorld();
        this.#inventory.add(resolved);

        const added = this.#inventory.size !== previousSize;

        if (added) {
            const metadata = resolved.metadata || {};
            let metadataChanged = false;
            const ownerId = typeof this.#id === 'string' ? this.#id.trim() : null;
            if (ownerId && metadata.ownerId !== ownerId) {
                metadata.ownerId = ownerId;
                metadataChanged = true;
            }
            const cleanupKeys = ['ownerID', 'owner_id', 'inventoryOwnerId'];
            for (const key of cleanupKeys) {
                if (metadata[key] !== undefined) {
                    delete metadata[key];
                    metadataChanged = true;
                }
            }
            if (metadata.owner && typeof metadata.owner === 'object') {
                const ownerObj = metadata.owner;
                const ownerObjId = typeof ownerObj.id === 'string' ? ownerObj.id.trim() : null;
                if (ownerObjId !== ownerId || Object.keys(ownerObj).length !== 1) {
                    delete metadata.owner;
                    metadataChanged = true;
                }
            }
            if (ownerId && metadata.playerId !== ownerId) {
                metadata.playerId = ownerId;
                metadataChanged = true;
            }
            const locationKeys = ['locationId', 'locationID', 'location_id'];
            for (const key of locationKeys) {
                if (metadata[key] !== undefined) {
                    delete metadata[key];
                    metadataChanged = true;
                }
            }
            if (metadataChanged) {
                resolved.metadata = metadata;
            }
        }

        if (updateTimestamp && added) {
            this.#lastUpdated = new Date().toISOString();
        }

        if (added && !suppressNpcEquip) {
            this.#checkEquipment = true;
        }

        return true;
    }

    #removeInventoryThing(thingLike, { updateTimestamp = true, suppressNpcEquip = false } = {}) {
        const resolved = this.#resolveThing(thingLike);
        if (!resolved) {
            return false;
        }

        const removed = this.#inventory.delete(resolved);
        if (removed) {
            this.unequipItemId(resolved.id, { suppressTimestamp: true });

            const metadata = resolved.metadata || {};
            let metadataChanged = false;
            const ownerId = typeof this.#id === 'string' ? this.#id.trim() : null;
            if (ownerId && metadata.ownerId === ownerId) {
                delete metadata.ownerId;
                metadataChanged = true;
            }
            if (ownerId && metadata.playerId === ownerId) {
                delete metadata.playerId;
                metadataChanged = true;
            }
            const cleanupKeys = ['ownerID', 'owner_id', 'inventoryOwnerId'];
            for (const key of cleanupKeys) {
                if (metadata[key] === undefined) {
                    continue;
                }
                const value = typeof metadata[key] === 'string' ? metadata[key].trim() : null;
                if (!ownerId || value === ownerId) {
                    delete metadata[key];
                    metadataChanged = true;
                }
            }
            if (metadata.owner && typeof metadata.owner === 'object') {
                const ownerObjId = typeof metadata.owner.id === 'string' ? metadata.owner.id.trim() : null;
                if (!ownerId || ownerObjId === ownerId) {
                    delete metadata.owner;
                    metadataChanged = true;
                }
            }
            if (metadataChanged) {
                resolved.metadata = metadata;
            }

            if (updateTimestamp) {
                this.#lastUpdated = new Date().toISOString();
            }
            if (!suppressNpcEquip) {
                this.#checkEquipment = true;
            }
        }
        return removed;
    }

    #defaultHealthAttribute() {
        const availableNames = this.getAttributeNames();
        if (!Array.isArray(availableNames) || !availableNames.length) {
            return 'constitution';
        }

        const preferred = ['constitution', 'endurance', 'stamina', 'vitality'];
        for (const target of preferred) {
            const match = availableNames.find(name => typeof name === 'string' && name.toLowerCase() === target);
            if (match) {
                return match;
            }
        }

        return availableNames[0];
    }

    #resolveHealthAttribute(attributeName) {
        const availableNames = this.getAttributeNames();
        if (typeof attributeName === 'string' && attributeName.trim()) {
            const lookup = attributeName.trim().toLowerCase();
            for (const name of availableNames) {
                if (typeof name === 'string' && name.toLowerCase() === lookup) {
                    return name;
                }
            }
        }

        return this.#defaultHealthAttribute();
    }

    /**
     * Calculate base health using the configured health attribute and level (private method)
     */
    #calculateBaseHealth() {
        const attributeName = this.#healthAttribute || this.#defaultHealthAttribute();
        const attributeValue = this.getModifiedAttribute(attributeName);
        const baseAttribute = Number.isFinite(attributeValue)
            ? attributeValue
            : (Number.isFinite(this.#attributes[attributeName]) ? this.#attributes[attributeName] : 10);

        const level = Number.isFinite(this.#level) ? this.#level : 1;
        const computed = Math.floor(Globals.config.baseHealthPerLevel + (baseAttribute / 2) * (level + 1));
        return Math.max(1, computed);
    }

    /**
     * Validate attribute value against definition (private method)
     */
    #validateAttributeValue(attributeName, value) {
        const definition = this.getAttributeDefinition(attributeName);
        if (!definition) {
            throw new Error(`Unknown attribute: ${attributeName}`);
        }

        if (typeof value !== 'number') {
            throw new Error(`Attribute value must be a number, got ${typeof value}`);
        }

        const config = this.systemConfig.validationRules ?? {};
        if (config.enforceMinMax) {
            const min = definition.min ?? 1;
            const max = definition.max ?? 20;

            if (value < min || value > max) {
                throw new Error(`${definition.label} must be between ${min} and ${max}, got ${value}`);
            }
        }

        return true;
    }

    getModifiedAttribute(attributeName) {
        // Return attribute plus values for equipped items
        const baseValue = this.#attributes[attributeName];
        if (baseValue === undefined) {
            return null;
        }

        const equippedItems = this.getInventoryItems().filter(item => item?.isEquipped);
        const equipmentBonus = equippedItems.reduce((total, item) => {
            if (!item) {
                return total;
            }
            if (typeof item.getAttributeBonus === 'function') {
                const itemBonus = item.getAttributeBonus(attributeName);
                return total + (itemBonus ?? 0);
            }
            if (item.attributeBonuses && typeof item.attributeBonuses === 'object') {
                const rawBonus = item.attributeBonuses[attributeName] ?? item.attributeBonuses[attributeName?.toLowerCase?.()];
                const numericBonus = Number(rawBonus);
                if (Number.isFinite(numericBonus)) {
                    return total + numericBonus;
                }
            }
            return total;
        }, 0);

        const normalizeAttributeName = (name) => (typeof name === 'string' ? name.trim().toLowerCase() : '');
        const targetAttr = normalizeAttributeName(attributeName);
        const collectStatusAttributeBonus = (effects) => {
            if (!Array.isArray(effects)) {
                return 0;
            }
            return effects.reduce((sum, effect) => {
                const attrs = Array.isArray(effect?.attributes) ? effect.attributes : [];
                for (const entry of attrs) {
                    const attrName = normalizeAttributeName(entry?.attribute || entry?.name);
                    if (!attrName || attrName !== targetAttr) {
                        continue;
                    }
                    const numeric = Number(entry?.modifier ?? entry?.bonus ?? entry?.value);
                    if (Number.isFinite(numeric)) {
                        sum += numeric;
                    }
                }
                return sum;
            }, 0);
        };

        const statusBonus = collectStatusAttributeBonus(this.#statusEffects);

        const location = this.location;
        const locationEffects = location && typeof location.getStatusEffects === 'function'
            ? location.getStatusEffects()
            : [];
        const locationBonus = collectStatusAttributeBonus(locationEffects);

        const equipperEffectBonus = equippedItems.reduce((sum, item) => {
            const effect = item?.causeStatusEffect;
            if (!effect || !effect.applyToEquipper) {
                return sum;
            }
            const attrs = Array.isArray(effect.attributes) ? effect.attributes : [];
            for (const entry of attrs) {
                const attrName = normalizeAttributeName(entry?.attribute || entry?.name);
                if (!attrName || attrName !== targetAttr) {
                    continue;
                }
                const numeric = Number(entry?.modifier ?? entry?.bonus ?? entry?.value);
                if (Number.isFinite(numeric)) {
                    sum += numeric;
                }
            }
            return sum;
        }, 0);

        return baseValue + equipmentBonus + statusBonus + locationBonus + equipperEffectBonus;
    }

    getAttributeBonus(attributeName) {
        if (this.getModifiedAttribute(attributeName) !== null) {
            return Math.floor(this.getModifiedAttribute(attributeName) / 2);
        }
        return null;
    }

    get location() {
        const Location = getLocationModule();
        return Location.get(this.#currentLocation) || null;
    }

    get previousLocationId() {
        return this.#previousLocationId;
    }

    get previousLocation() {
        const Location = getLocationModule();
        return Location.get(this.#previousLocationId) || null;
    }

    get goals() {
        return this.#goals.slice();
    }

    get characterArc() {
        return { ...this.#characterArc };
    }

    setShortTermCharacterArc(arc) {
        if (typeof arc !== 'string') {
            return false;
        }
        const trimmed = arc.trim();
        if (this.#characterArc.shortTerm === trimmed) {
            return false;
        }
        this.#characterArc.shortTerm = trimmed;
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    setLongTermCharacterArc(arc) {
        if (typeof arc !== 'string') {
            return false;
        }
        const trimmed = arc.trim();
        if (this.#characterArc.longTerm === trimmed) {
            return false;
        }
        this.#characterArc.longTerm = trimmed;
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    addGoal(goal) {
        if (typeof goal !== 'string' || !goal.trim()) {
            return false;
        }
        const trimmed = goal.trim();
        if (this.#goals.includes(trimmed)) {
            return false;
        }
        this.#goals.push(trimmed);
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    addQuest(quest) {
        this.#quests.push(quest);
        this.#lastUpdated = new Date().toISOString();
    }

    removeQuest(questId) {
        const index = this.#quests.findIndex(q => q.id === questId);
        if (index === -1) {
            return false;
        }
        this.#quests.splice(index, 1);
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    getQuestByName(questName) {
        return this.#quests.find(q => q.name === questName) || null;
    }

    getQuestById(questId) {
        return this.#quests.find(q => q.id === questId) || null;
    }

    getCurrentQuests() {
        return this.#quests.filter(q => !q.completed);
    }

    get currentQuests() {
        return this.getCurrentQuests();
    }

    get completedQuests() {
        return this.getCompletedQuests();
    }

    getCompletedQuests() {
        return this.#quests.filter(q => q.completed);
    }

    removeGoal(goal) {
        if (typeof goal !== 'string' || !goal.trim()) {
            return false;
        }
        const trimmed = goal.trim();
        const index = this.#goals.indexOf(trimmed);
        if (index === -1) {
            return false;
        }
        this.#goals.splice(index, 1);
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    updatePreviousLocation() {
        this.#previousLocationId = this.#currentLocation;
        this.#lastUpdated = new Date().toISOString();
    }

    get gender() {
        return this.#gender;
    }

    set gender(value) {
        // Make sure it's a string
        if (typeof value !== 'string') {
            throw new Error('Gender must be a string');
        }
        this.#gender = value.toLowerCase().trim();
    }

    get lastActionWasTravel() {
        return Boolean(this.#lastActionWasTravel);
    }

    set lastOutcomeSucceeded(value) {
        console.log(`✅ Player ${this.#name || this.#id || 'unknown'} lastOutcomeSucceeded set to ${value}`);
        this.#lastOutcomeSucceeded = Boolean(value);
    }

    get lastOutcomeSucceeded() {
        return Boolean(this.#lastOutcomeSucceeded);
    }

    set lastActionWasTravel(value) {
        const normalized = Boolean(value);
        const previous = this.#lastActionWasTravel;
        if (previous !== normalized) {
            const locationLabel = (() => {
                try {
                    return this.location?.name || this.#currentLocation || 'unknown location';
                } catch (_) {
                    return this.#currentLocation || 'unknown location';
                }
            })();
            console.log(`🏃 Player ${this.#name || this.#id || 'unknown'} lastActionWasTravel set to ${normalized ? 'true' : 'false'} (location: ${locationLabel})`);
        }
        this.#lastActionWasTravel = normalized;
        if (normalized) {
            this.#consecutiveTravelActions = previous ? this.#consecutiveTravelActions + 1 : 1;
        } else {
            this.#consecutiveTravelActions = 0;
        }
    }

    get consecutiveTravelActions() {
        return this.#consecutiveTravelActions;
    }

    static updatePreviousLocationsForAll() {
        for (const player of Player.#instances) {
            if (player instanceof Player) {
                player.updatePreviousLocation();
            }
        }
    }

    // Public getters for private fields
    get attributeDefinitions() {
        return this.#definitions.attributes ?? {};
    }

    get systemConfig() {
        return this.#definitions.system ?? {};
    }

    get attributes() {
        return { ...this.#attributes }; // Return copy to prevent mutation
    }

    get level() {
        return this.#level;
    }

    get experience() {
        return this.#experience;
    }

    static setExperienceRolloverMultiplier(value) {
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            throw new Error('Experience rollover multiplier must be a number between 0 and 1');
        }
        Player.#experienceRolloverMultiplier = value;
    }

    static get experienceRolloverMultiplier() {
        return Player.#experienceRolloverMultiplier;
    }

    get isDead() {
        return this.#isDead;
    }

    get isDisabled() {
        return this.#isDead || (this.#health <= 0);
    }

    get inCombat() {
        return this.#inCombat;
    }

    set inCombat(value) {
        this.#inCombat = Boolean(value);
        this.#lastUpdated = new Date().toISOString();
    }

    set isDead(value) {
        const next = Boolean(value);
        const wasDead = this.#isDead;
        if (this.#isDead === next) {
            return;
        }
        this.#isDead = next;
        if (next) {
            this.#health = 0;
            if (!Number.isFinite(this.#corpseCountdown) || this.#corpseCountdown <= 0) {
                this.corpseCountdown = 5; // Set default countdown to 5 turns
            }
            try {
                this.dropAllInventoryItems();
            } catch (error) {
                console.warn(`Failed to drop inventory for deceased actor ${this.#id || this.#name || '<unknown>'}:`, error?.message || error);
                console.trace(error);
            }
        } else {
            this.corpseCountdown = null;
            if (this.#health <= 0 && wasDead) {
                this.#health = 1;
            }
        }
        this.#lastUpdated = new Date().toISOString();
    }

    get health() {
        return this.#health;
    }

    get maxHealth() {
        return this.#calculateBaseHealth();
    }

    get healthAttribute() {
        return this.#healthAttribute;
    }

    get name() {
        return this.#name;
    }

    get description() {
        return this.#description;
    }

    get shortDescription() {
        return this.#shortDescription;
    }

    get class() {
        return this.#class;
    }

    get race() {
        return this.#race;
    }

    get isHostile() {
        return Boolean(this.#isHostile);
    }

    set isHostile(value) {
        const next = Boolean(value) && this.#isNPC;
        if (this.#isHostile === next) {
            return;
        }
        this.#isHostile = next;
        if (next) {
            this.#applyHostileDispositionsToCurrentPlayer();
        }
        this.#lastUpdated = new Date().toISOString();
    }

    get turnsSincePartyMemoryGeneration() {
        return this.#turnsSincePartyMemoryGeneration;
    }

    incrementTurnsSincePartyMemoryGeneration() {
        this.#turnsSincePartyMemoryGeneration += 1;
        this.#lastUpdated = new Date().toISOString();
    }

    resetTurnsSincePartyMemoryGeneration() {
        if (this.#turnsSincePartyMemoryGeneration !== 0) {
            this.#turnsSincePartyMemoryGeneration = 0;
            this.#lastUpdated = new Date().toISOString();
        }
    }

    get importantMemories() {
        return Array.from(this.#importantMemories);
    }

    set importantMemories(memories) {
        if (!Array.isArray(memories)) {
            throw new Error('Important memories must be an array of strings');
        }
        const cleaned = memories
            .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
            .filter(Boolean);
        this.#importantMemories = Array.from(new Set(cleaned)); // Remove duplicates
        this.#lastUpdated = new Date().toISOString();
    }

    addImportantMemory(memory) {
        if (typeof memory !== 'string' || !memory.trim()) {
            return false;
        }

        // Don't add duplicates
        const trimmed = memory.trim();
        if (this.#importantMemories.includes(trimmed)) {
            return false;
        }
        this.#importantMemories.push(trimmed);
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    get corpseCountdown() {
        return this.#corpseCountdown;
    }

    set corpseCountdown(value) {
        if (value === null || value === undefined) {
            if (this.#corpseCountdown !== null) {
                this.#corpseCountdown = null;
                this.#lastUpdated = new Date().toISOString();
            }
            return;
        }
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue < 0) {
            throw new Error('Corpse countdown must be a non-negative number or null');
        }
        const rounded = Math.floor(numericValue);
        if (this.#corpseCountdown !== rounded) {
            this.#corpseCountdown = rounded;
            this.#lastUpdated = new Date().toISOString();
        }
    }

    get personalityType() {
        return this.#personalityType;
    }

    set personalityType(value) {
        this.#personalityType = Player.#sanitizePersonalityValue(value);
        this.#lastUpdated = new Date().toISOString();
    }

    get personalityTraits() {
        return this.#personalityTraits;
    }

    set personalityTraits(value) {
        this.#personalityTraits = Player.#sanitizePersonalityValue(value);
        this.#lastUpdated = new Date().toISOString();
    }

    get personalityNotes() {
        return this.#personalityNotes;
    }

    set personalityNotes(value) {
        this.#personalityNotes = Player.#sanitizePersonalityValue(value);
        this.#lastUpdated = new Date().toISOString();
    }

    set class(newClass) {
        this.#class = newClass.trim();
        this.#lastUpdated = new Date().toISOString();
    }

    set race(newRace) {
        this.#race = newRace.trim();
        this.#lastUpdated = new Date().toISOString();
    }

    set description(newDescription) {
        if (typeof newDescription !== 'string') {
            throw new Error('Description must be a string');
        }
        this.#description = newDescription.trim();
        this.#lastUpdated = new Date().toISOString();
    }

    set shortDescription(newShortDescription) {
        if (typeof newShortDescription !== 'string') {
            throw new Error('Short description must be a string');
        }
        this.#shortDescription = newShortDescription.trim();
        this.#lastUpdated = new Date().toISOString();
    }

    set lastVisitedTime(time) {
        this.#lastVisitedTime = time;
        this.#lastUpdated = new Date().toISOString();
    }

    get lastVisitedTime() {
        return this.#lastVisitedTime;
    }

    setHealthAttribute(attributeName) {
        const oldMaxHealth = this.maxHealth;
        const resolved = this.#resolveHealthAttribute(attributeName);
        if (resolved === this.#healthAttribute) {
            return this.#healthAttribute;
        }

        this.#healthAttribute = resolved;

        if (oldMaxHealth > 0) {
            const healthRatio = this.#health / oldMaxHealth;
            this.#health = Math.max(0, Math.min(newMaxHealth, Math.round(newMaxHealth * healthRatio)));
        } else {
            this.#health = Math.min(this.#health, newMaxHealth);
        }

        this.#lastUpdated = new Date().toISOString();
        return this.#healthAttribute;
    }

    get imageId() {
        return this.#imageId;
    }

    get elapsedTime() {
        // Error out if called for an NPC
        if (this.#isNPC) {
            throw new Error('Elapsed time is not tracked for NPCs');
        }
        return this.#elapsedTime;
    }

    set elapsedTime(value) {
        if (this.#isNPC) {
            throw new Error('Elapsed time cannot be set for NPCs');
        }
        if (!Number.isFinite(value) || value < 0) {
            throw new Error('Elapsed time must be a non-negative number');
        }
        this.#elapsedTime = value;
        this.#lastUpdated = new Date().toISOString();
    }

    set imageId(newImageId) {
        if (newImageId !== null && typeof newImageId !== 'string') {
            throw new Error('Image ID must be a string or null');
        }
        this.#imageId = newImageId;
        this.#lastUpdated = new Date().toISOString();
    }

    get id() {
        return this.#id;
    }

    get currentLocation() {
        return this.#currentLocation;
    }

    get isNPC() {
        return this.#isNPC;
    }

    get inventorySize() {
        return this.#inventory.size;
    }

    getInventoryItems() {
        return Array.from(this.#inventory);
    }

    get partyMembers() {
        return new Set(this.#partyMembers);
    }

    addPartyMember(memberId) {
        // Resolve player objects passed as memberId if type is Player
        if (memberId instanceof Player) {
            memberId = memberId.id;
        }

        if (typeof memberId !== 'string' || !memberId.trim()) {
            return false;
        }
        const trimmed = memberId.trim();
        const before = this.#partyMembers.size;
        this.#partyMembers.add(trimmed);
        if (this.#partyMembers.size !== before) {
            this.#partyMembersAddedThisTurn.add(trimmed);
            this.#partyMembersRemovedThisTurn.delete(trimmed);
            const member = Player.getById(trimmed);
            if (member) {
                if (typeof member.setInPlayerParty === 'function') {
                    member.setInPlayerParty(true);
                }
                if (typeof member.markPartyMembershipChangedThisTurn === 'function') {
                    member.markPartyMembershipChangedThisTurn();
                }

                const existingLocation = member.currentLocationObject || null;
                if (existingLocation) {
                    if (typeof existingLocation.removeNpcId === 'function') {
                        existingLocation.removeNpcId(member.id);
                    } else {
                        throw new Error(`Unable to unregister '${member.name || member.id}' from location '${existingLocation.name || existingLocation.id}': removeNpcId is not available.`);
                    }

                    if (typeof member.setLocation === 'function') {
                        member.setLocation(null);
                    } else {
                        throw new Error(`Unable to clear location for '${member.name || member.id}': setLocation is not available.`);
                    }
                }
            }
            this.#lastUpdated = new Date().toISOString();
            return true;
        }
        return false;
    }

    removePartyMember(memberId) {
        if (memberId instanceof Player) {
            memberId = memberId.id;
        }

        if (typeof memberId !== 'string' || !memberId.trim()) {
            return false;
        }
        const trimmed = memberId.trim();
        const removed = this.#partyMembers.delete(trimmed);
        if (removed) {
            this.#partyMembersRemovedThisTurn.add(trimmed);
            this.#partyMembersAddedThisTurn.delete(trimmed);
            const member = Player.getById(trimmed);
            if (member) {
                if (typeof member.setInPlayerParty === 'function') {
                    member.setInPlayerParty(false);
                }
                if (typeof member.markPartyMembershipChangedThisTurn === 'function') {
                    member.markPartyMembershipChangedThisTurn();
                }

                const playerLocation = this.currentLocationObject || null;
                if (!playerLocation) {
                    throw new Error(`Unable to relocate departing party member '${member.name || member.id}': player location is unknown.`);
                }

                const previousLocation = member.currentLocationObject || null;
                if (previousLocation && typeof previousLocation.removeNpcId === 'function') {
                    previousLocation.removeNpcId(member.id);
                }

                if (typeof member.setLocation === 'function') {
                    member.setLocation(playerLocation);
                } else if (typeof member.setLocationByName === 'function') {
                    member.setLocationByName(playerLocation.name || playerLocation.id);
                } else {
                    throw new Error(`Departing party member '${member.name || member.id}' cannot be relocated: no setLocation method available.`);
                }

                if (typeof playerLocation.addNpcId === 'function') {
                    playerLocation.addNpcId(member.id);
                } else {
                    throw new Error(`Unable to register departing party member '${member.name || member.id}' at the player location: addNpcId is unsupported.`);
                }
            }
            this.#lastUpdated = new Date().toISOString();
        }
        return removed;
    }

    clearPartyMembers() {
        if (this.#partyMembers.size === 0) {
            return;
        }
        const removedIds = Array.from(this.#partyMembers);
        for (const memberId of removedIds) {
            this.#partyMembersRemovedThisTurn.add(memberId);
            this.#partyMembersAddedThisTurn.delete(memberId);
            const member = Player.getById(memberId);
            if (member) {
                if (typeof member.setInPlayerParty === 'function') {
                    member.setInPlayerParty(false);
                }
                if (typeof member.markPartyMembershipChangedThisTurn === 'function') {
                    member.markPartyMembershipChangedThisTurn();
                }
            }
        }
        this.#partyMembers.clear();
        this.#lastUpdated = new Date().toISOString();
    }

    getPartyMembers() {
        return Array.from(this.#partyMembers);
    }

    get turnsSincePartyMemoryGeneration() {
        return this.#turnsSincePartyMemoryGeneration;
    }

    incrementTurnsSincePartyMemoryGeneration() {
        this.#turnsSincePartyMemoryGeneration += 1;
        return this.#turnsSincePartyMemoryGeneration;
    }

    resetTurnsSincePartyMemoryGeneration() {
        this.#turnsSincePartyMemoryGeneration = 0;
        this.#partyMembershipChangedThisTurn = false;
        this.clearPartyMemoryHistory();
    }

    addPartyMemoryHistorySegment(entries = [], limit = null) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }

        const maxSegments = Number.isInteger(limit) && limit > 0 ? limit : null;
        const segment = entries
            .filter(entry => entry && typeof entry === 'object')
            .map(entry => ({
                role: entry.role || null,
                content: entry.content || '',
                summary: entry.summary || null,
                metadata: entry.metadata && typeof entry.metadata === 'object'
                    ? {
                        npcNames: Array.isArray(entry.metadata.npcNames) ? entry.metadata.npcNames.slice(0) : undefined,
                        locationId: entry.metadata.locationId || null
                    }
                    : undefined
            }));

        if (!segment.length) {
            return;
        }

        this.#pendingPartyMemoryHistory.push(segment);
        if (maxSegments !== null) {
            while (this.#pendingPartyMemoryHistory.length > maxSegments) {
                this.#pendingPartyMemoryHistory.shift();
            }
        }
    }

    getPartyMemoryHistorySegments(limit = null) {
        const segments = (!Number.isInteger(limit) || limit <= 0)
            ? this.#pendingPartyMemoryHistory.slice()
            : this.#pendingPartyMemoryHistory.slice(-limit);

        return segments.map(segment => segment.map(entry => ({
            role: entry.role,
            content: entry.content,
            summary: entry.summary,
            metadata: entry.metadata && typeof entry.metadata === 'object'
                ? {
                    npcNames: Array.isArray(entry.metadata.npcNames) ? entry.metadata.npcNames.slice(0) : undefined,
                    locationId: entry.metadata.locationId || null
                }
                : undefined
        })));
    }

    clearPartyMemoryHistory() {
        this.#pendingPartyMemoryHistory = [];
    }

    markPartyMembershipChangedThisTurn() {
        this.#partyMembershipChangedThisTurn = true;
    }

    get partyMembershipChangedThisTurn() {
        return this.#partyMembershipChangedThisTurn;
    }

    setInPlayerParty(value) {
        this.#isInPlayerParty = Boolean(value);
    }

    get isInPlayerParty() {
        return this.#isInPlayerParty;
    }

    getPartyMembersAddedThisTurn() {
        return new Set(this.#partyMembersAddedThisTurn);
    }

    getPartyMembersRemovedThisTurn() {
        return new Set(this.#partyMembersRemovedThisTurn);
    }

    clearPartyMembershipChangeTracking() {
        this.#partyMembersAddedThisTurn.clear();
        this.#partyMembersRemovedThisTurn.clear();
    }

    getDisposition(targetId, type = 'default') {
        const resolvedId = Player.resolvePlayerId(targetId);
        if (!resolvedId) {
            return 0;
        }
        const dispositionType = Player.#normalizeDispositionType(type);
        const typeMap = this.#dispositions.get(resolvedId);
        if (!typeMap) {
            return 0;
        }

        if (typeMap.has(dispositionType)) {
            const storedValue = typeMap.get(dispositionType);
            return storedValue ?? 0;
        }

        const rawType = typeof type === 'string' ? type.trim() : '';
        if (rawType && typeMap.has(rawType)) {
            const storedValue = typeMap.get(rawType);
            return storedValue ?? 0;
        }

        return 0;
    }

    setDisposition(targetId, type = 'default', value = 0) {
        const resolvedId = Player.resolvePlayerId(targetId);
        if (!resolvedId) {
            return this.getDisposition(targetId, type);
        }
        const dispositionType = Player.#normalizeDispositionType(type);
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return this.getDisposition(resolvedId, type);
        }

        let typeMap = this.#dispositions.get(resolvedId);
        if (!typeMap) {
            typeMap = new Map();
            this.#dispositions.set(resolvedId, typeMap);
        }
        typeMap.set(dispositionType, numericValue);

        const rawType = typeof type === 'string' ? type.trim() : '';
        if (rawType && rawType !== dispositionType && typeMap.has(rawType)) {
            typeMap.delete(rawType);
        }

        this.#lastUpdated = new Date().toISOString();
        return numericValue;
    }

    increaseDisposition(targetId, type = 'default', amount = 1) {
        const resolvedId = Player.resolvePlayerId(targetId);
        if (!resolvedId) {
            return 0;
        }
        const current = this.getDisposition(resolvedId, type);
        const increment = Number(amount);
        if (!Number.isFinite(increment)) {
            return current;
        }
        return this.setDisposition(resolvedId, type, current + increment);
    }

    decreaseDisposition(targetId, type = 'default', amount = 1) {
        const resolvedId = Player.resolvePlayerId(targetId);
        if (!resolvedId) {
            return 0;
        }
        const current = this.getDisposition(resolvedId, type);
        const decrement = Number(amount);
        if (!Number.isFinite(decrement)) {
            return current;
        }
        return this.setDisposition(resolvedId, type, current - decrement);
    }

    getDispositionValue(playerId, type = 'default') {
        const resolvedId = Player.resolvePlayerId(playerId);
        if (!resolvedId) {
            return 0;
        }
        return this.getDisposition(resolvedId, type);
    }

    getDispositionTowards(player, type = 'default') {
        return this.getDispositionValue(player, type);
    }

    setDispositionTowards(player, type = 'default', value = 0) {
        const resolvedId = Player.resolvePlayerId(player);
        if (!resolvedId) {
            return this.getDisposition(player, type);
        }
        return this.setDisposition(resolvedId, type, value);
    }

    getDispositionIntensityTowards(player, type = 'default') {
        const value = this.getDispositionTowards(player, type);
        return Player.resolveDispositionIntensity(type, value);
    }

    getDispositionTowardsCurrentPlayer(type = 'default') {
        const currentPlayerId = Player.getCurrentPlayerId();
        if (!currentPlayerId || currentPlayerId === this.#id) {
            return 0;
        }
        return this.getDisposition(currentPlayerId, type);
    }

    setDispositionTowardsCurrentPlayer(type = 'default', value = 0) {
        const currentPlayerId = Player.getCurrentPlayerId();
        if (!currentPlayerId || currentPlayerId === this.#id) {
            return 0;
        }
        return this.setDisposition(currentPlayerId, type, value);
    }

    getDispositionIntensityTowardsCurrentPlayer(type = 'default') {
        const value = this.getDispositionTowardsCurrentPlayer(type);
        return Player.resolveDispositionIntensity(type, value);
    }

    get createdAt() {
        return this.#createdAt;
    }

    get lastUpdated() {
        return this.#lastUpdated;
    }



    dropAllInventoryItems() {
        const items = this.getInventoryItems();
        for (const item of items) {
            item.drop();
        }
    }

    /**
     * Get list of all attribute names
     */
    getAttributeNames() {
        return Object.keys(this.attributeDefinitions);
    }

    /**
     * Get attribute definition by name
     */
    getAttributeDefinition(attributeName) {
        return this.attributeDefinitions[attributeName] ?? null;
    }

    /**
     * Calculate attribute modifier using formula from definitions
     */
    #calculateAttributeModifier(attributeValue) {
        if (!Number.isFinite(attributeValue)) {
            return 0;
        }

        // Use formula from system config, fallback to standard D&D formula
        const formula = this.systemConfig.modifierFormula ?? "floor((value - 10) / 2)";

        // Simple formula evaluation (could be enhanced with a proper expression parser)
        if (formula === "floor((value - 10) / 2)") {
            return Math.floor((attributeValue - 10) / 2);
        }

        // Fallback calculation
        return Math.floor((attributeValue - 10) / 2);
    }

    getAttributeModifier(attributeName, options = {}) {
        if (typeof attributeName !== 'string' || !attributeName) {
            return 0;
        }

        const { useModified = true, value } = options ?? {};
        const normalizedName = attributeName.trim();
        const hasBaseValue = Object.prototype.hasOwnProperty.call(this.#attributes, normalizedName);
        const baseValue = hasBaseValue ? this.#attributes[normalizedName] : undefined;

        if (!hasBaseValue && !Number.isFinite(value) && !useModified) {
            console.warn(`Unknown attribute: ${attributeName}`);
        }

        let resolvedValue;
        if (Number.isFinite(value)) {
            resolvedValue = value;
        } else if (useModified) {
            const modifiedValue = this.getModifiedAttribute(normalizedName);
            resolvedValue = Number.isFinite(modifiedValue) ? modifiedValue : baseValue;
        } else {
            resolvedValue = baseValue;
        }

        if (!Number.isFinite(resolvedValue)) {
            return 0;
        }

        return this.#calculateAttributeModifier(resolvedValue);
    }

    /**
     * Get a formatted object of all attribute modifiers
     */
    getAttributeModifiers(options = {}) {
        const { useModified = true } = options ?? {};
        const modifiers = {};
        for (const attrName of this.getAttributeNames()) {
            modifiers[attrName] = this.getAttributeModifier(attrName, { useModified });
        }
        return modifiers;
    }

    /**
     * Set an attribute value with validation from definitions
     */
    setAttribute(attributeName, value) {
        // Validate using definition
        this.#validateAttributeValue(attributeName, value);

        const oldValue = this.#attributes[attributeName];
        this.#attributes[attributeName] = value;
        this.#lastUpdated = new Date().toISOString();

        // Check if this attribute affects health (specifically constitution)
        const definition = this.getAttributeDefinition(attributeName);
        if (definition?.affects?.includes('health') || attributeName === this.#healthAttribute) {
            if (this.#health > this.maxHealth) {
                this.#health = this.maxHealth;
            }
        }

        return {
            attribute: attributeName,
            oldValue,
            newValue: value,
            modifier: this.getAttributeModifier(attributeName)
        };
    }

    /**
     * Level up the player
     */
    levelUp(count = 1) {
        console.log(`⬆️ DING! Leveling up player ${this.#name || this.#id || 'unknown'} from level ${this.#level} to level ${this.#level + count}`);
        const previousLevel = this.#level;
        this.#level += count;

        this.#health = this.#calculateBaseHealth();
        const pointsPerLevel = this.#skillPointsPerLevel();
        if (pointsPerLevel > 0) {
            this.#unspentSkillPoints += pointsPerLevel;
        }
        this.#lastUpdated = new Date().toISOString();

        if (Player.#levelUpHandler) {
            try {
                const result = Player.#levelUpHandler({
                    character: this,
                    previousLevel,
                    newLevel: this.#level
                });
                if (result && typeof result.then === 'function') {
                    result.catch(error => {
                        console.warn('Level-up handler failed:', error?.message || error);
                    });
                }
            } catch (handlerError) {
                console.warn('Level-up handler errored:', handlerError?.message || handlerError);
            }
        }
    }

    addExperience(amount, raw = false) {
        if (!Number.isFinite(amount)) {
            return this.#experience;
        }

        let award = Number(amount);

        console.log(`⭐ Awarding ${award.toFixed(2)} experience to player ${this.#name || this.#id || 'unknown'} (raw: ${raw ? 'yes' : 'no'})`);
        this.#experience = Math.max(0, this.#experience + award);

        this.#processExperienceOverflow(raw);
        this.#lastUpdated = new Date().toISOString();

        // If this player is not an NPC, iterate through their party and award the same exp to all members.
        if (!this.#isNPC && this.#partyMembers.size) {
            for (const memberId of this.#partyMembers) {
                const member = Player.getById(memberId);
                if (member && member instanceof Player && member.id !== this.id) {
                    member.addExperience(amount);
                }
            }
        }

        return this.#experience;
    }

    addRawExperience(amount) {
        return this.addExperience(amount, true);
    }

    setExperience(value) {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error('Experience must be a non-negative number');
        }

        this.#experience = Number(value);
        this.#processExperienceOverflow();
        this.#lastUpdated = new Date().toISOString();
        return this.#experience;
    }

    /**
     * Modify health (damage or healing)
     */
    modifyHealth(amount, reason = '') {
        const maxHealth = this.maxHealth;
        const oldHealth = this.#health;
        this.#health = Math.max(0, Math.min(maxHealth, this.#health + amount));
        this.#lastUpdated = new Date().toISOString();

        return {
            oldHealth,
            newHealth: this.#health,
            change: this.#health - oldHealth,
            reason
        };
    }

    #normalizeStatusEffects(effects = []) {
        if (!Array.isArray(effects)) {
            return [];
        }

        const normalized = [];
        for (const entry of effects) {
            if (entry instanceof StatusEffect) {
                normalized.push(entry);
                continue;
            }

            if (typeof entry === 'string') {
                const description = entry.trim();
                if (!description) {
                    throw new Error('Status effect description must not be empty');
                }
                normalized.push(new StatusEffect({ description, duration: 1 }));
                continue;
            }

            if (entry && typeof entry === 'object') {
                const descriptionValue = typeof entry.description === 'string'
                    ? entry.description.trim()
                    : (typeof entry.text === 'string' ? entry.text.trim() : (typeof entry.name === 'string' ? entry.name.trim() : ''));

                if (!descriptionValue) {
                    throw new Error('Status effect entry is missing a description');
                }

                const attributes = Array.isArray(entry.attributes) ? entry.attributes : undefined;
                const skills = Array.isArray(entry.skills) ? entry.skills : undefined;
                const duration = entry.duration !== undefined ? entry.duration : null;

                normalized.push(new StatusEffect({
                    name: entry.name,
                    description: descriptionValue,
                    attributes,
                    skills,
                    duration
                }));
                continue;
            }

            throw new Error('Invalid status effect entry');
        }

        normalized.sort((a, b) => {
            const nameA = (a.name || a.description || '').toLowerCase();
            const nameB = (b.name || b.description || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        return normalized.slice(0, 60);
    }

    #normalizeAbilities(abilitiesInput = []) {
        let entries;
        if (Array.isArray(abilitiesInput)) {
            entries = abilitiesInput;
        } else if (abilitiesInput && typeof abilitiesInput === 'object') {
            entries = Object.values(abilitiesInput);
        } else {
            entries = [];
        }

        const normalized = [];
        for (const entry of entries) {
            if (!entry) {
                continue;
            }

            let abilityObj = entry;
            if (typeof entry === 'string') {
                abilityObj = { name: entry };
            }

            if (!abilityObj || typeof abilityObj !== 'object') {
                continue;
            }

            const name = typeof abilityObj.name === 'string' ? abilityObj.name.trim() : '';
            if (!name) {
                continue;
            }

            const description = typeof abilityObj.description === 'string' ? abilityObj.description.trim() : '';

            let type = typeof abilityObj.type === 'string' ? abilityObj.type.trim() : '';
            const lowered = type.toLowerCase();
            if (lowered === 'active' || lowered === 'passive' || lowered === 'triggered') {
                type = lowered.charAt(0).toUpperCase() + lowered.slice(1);
            } else {
                type = 'Passive';
            }

            const parsedLevel = Number.parseInt(abilityObj.level, 10);
            const level = Number.isFinite(parsedLevel) ? Math.max(1, Math.min(20, parsedLevel)) : 1;

            normalized.push({
                name,
                description,
                type,
                level
            });
        }

        return normalized;
    }

    getStatusEffects() {
        const baseEffects = this.#statusEffects.map(effect => effect.toJSON());

        const equippedItems = this.getInventoryItems().filter(item => item?.isEquipped);
        const equippedEffects = [];
        for (const item of equippedItems) {
            if (!item) continue;
            const equipEffect = item.causeStatusEffectOnEquipper
                || (item.causeStatusEffect?.applyToEquipper ? item.causeStatusEffect : null)
                || null;
            if (equipEffect && (equipEffect.description || equipEffect.name)) {
                const effectPayload = {
                    name: equipEffect.name || null,
                    description: equipEffect.description || equipEffect.text || equipEffect.name || '',
                    duration: equipEffect.duration ?? null,
                    attributes: Array.isArray(equipEffect.attributes) ? equipEffect.attributes : [],
                    skills: Array.isArray(equipEffect.skills) ? equipEffect.skills : []
                };
                equippedEffects.push(effectPayload);
            }
        }

        return [...baseEffects, ...equippedEffects];
    }

    setStatusEffects(effects = []) {
        this.#statusEffects = this.#normalizeStatusEffects(effects);
        this.#lastUpdated = new Date().toISOString();
        return this.getStatusEffects();
    }

    addStatusEffect(effectInput, defaultDuration = 1) {
        const effects = Array.isArray(effectInput) ? effectInput : [effectInput];
        const normalized = this.#normalizeStatusEffects(effects.map(entry => {
            if (typeof entry === 'string') {
                return { description: entry, duration: defaultDuration };
            }
            if (entry && typeof entry === 'object' && entry.description && entry.duration === undefined) {
                return { ...entry, duration: defaultDuration };
            }
            return entry;
        }));

        if (!normalized.length) {
            return null;
        }

        let updated = false;
        for (const effect of normalized) {
            const existingIndex = this.#statusEffects.findIndex(existing =>
                existing.description.toLowerCase() === effect.description.toLowerCase()
            );
            if (existingIndex >= 0) {
                this.#statusEffects[existingIndex] = effect;
            } else {
                this.#statusEffects.push(effect);
            }
            updated = true;
        }

        if (updated) {
            this.#lastUpdated = new Date().toISOString();
        }

        return normalized[normalized.length - 1];
    }

    removeStatusEffect(description) {
        if (!description || typeof description !== 'string') {
            return false;
        }

        const before = this.#statusEffects.length;
        const target = description.trim().toLowerCase();
        this.#statusEffects = this.#statusEffects.filter(effect => effect.description.toLowerCase() !== target);

        if (this.#statusEffects.length !== before) {
            this.#lastUpdated = new Date().toISOString();
            return true;
        }
        return false;
    }

    tickStatusEffects() {
        if (!Array.isArray(this.#statusEffects) || this.#statusEffects.length === 0) {
            return;
        }

        const retained = [];
        let changed = false;

        for (const effect of this.#statusEffects) {
            if (!effect) {
                changed = true;
                continue;
            }

            if (!Number.isFinite(effect.duration)) {
                retained.push(effect);
                continue;
            }

            if (effect.duration === 0) {
                changed = true;
                continue;
            }

            retained.push(new StatusEffect({
                ...effect.toJSON(),
                duration: effect.duration - 1
            }));
            changed = true;
        }

        if (changed) {
            this.#statusEffects = retained;
            this.#lastUpdated = new Date().toISOString();
        }
    }

    clearExpiredStatusEffects() {
        const before = this.#statusEffects.length;
        this.#statusEffects = this.#statusEffects.filter(effect => !Number.isFinite(effect.duration) || effect.duration !== 0);
        if (this.#statusEffects.length !== before) {
            this.#lastUpdated = new Date().toISOString();
        }
    }

    getNeedBars(options = {}) {
        const { includePlayerOnly = true } = options;
        if (!this.#needBars || !(this.#needBars instanceof Map)) {
            return [];
        }

        const results = [];
        for (const bar of this.#needBars.values()) {
            if (!includePlayerOnly && bar.playerOnly) {
                continue;
            }
            results.push(Player.#cloneNeedBarDefinition({
                ...bar,
                currentThreshold: bar.currentThreshold ? { ...bar.currentThreshold } : null
            }));
        }
        return results;
    }

    getNeedBarValue(identifier) {
        const bar = this.#resolveNeedBarByIdentifier(identifier);
        if (!bar) {
            return null;
        }
        return Number.isFinite(bar.value) ? bar.value : null;
    }

    setNeedBars(needBars = []) {
        this.#initializeNeedBars(needBars);
        return this.getNeedBars();
    }

    setNeedBarValue(identifier, value, options = {}) {
        if (identifier === undefined || identifier === null) {
            throw new Error('Need bar identifier is required');
        }

        const { allowPlayerOnly = true } = options;
        const bar = this.#resolveNeedBarByIdentifier(String(identifier));
        if (!bar) {
            throw new Error(`Need bar '${identifier}' not found`);
        }

        if (!allowPlayerOnly && bar.playerOnly) {
            throw new Error(`Need bar '${identifier}' is restricted to the player`);
        }

        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            throw new Error('Need bar value must be a finite number');
        }

        const previous = Number.isFinite(bar.value) ? bar.value : null;
        const resolved = Player.#applyNeedBarValue(bar, numericValue);

        if (previous === null || resolved !== previous) {
            this.#lastUpdated = new Date().toISOString();
        }

        return Player.#cloneNeedBarDefinition(bar);
    }

    applyNeedBarTurnChange(multiplier = 1) {
        if (!this.#needBars || !(this.#needBars instanceof Map) || !Number.isFinite(multiplier)) {
            return [];
        }

        const adjustments = [];
        for (const [id, bar] of this.#needBars.entries()) {
            if (!bar) {
                continue;
            }
            const rate = Number.isFinite(bar.changePerTurn) ? bar.changePerTurn : 0;
            if (rate === 0) {
                continue;
            }

            const delta = rate * multiplier;
            const previousValue = bar.value;
            Player.#applyNeedBarValue(bar, previousValue + delta);

            if (bar.value !== previousValue) {
                adjustments.push({
                    id,
                    name: typeof bar.name === 'string' ? bar.name : id,
                    previousValue,
                    newValue: bar.value,
                    delta,
                    min: Number.isFinite(bar.min) ? bar.min : null,
                    max: Number.isFinite(bar.max) ? bar.max : null,
                    changePerTurn: rate,
                    playerOnly: Boolean(bar.playerOnly),
                    currentThreshold: bar.currentThreshold ? { ...bar.currentThreshold } : null
                });
            }
        }

        if (adjustments.length) {
            this.#lastUpdated = new Date().toISOString();
        }

        return adjustments;
    }

    getNeedBarsForContext(options = {}) {
        const includePlayerOnly = options.includePlayerOnly !== undefined
            ? Boolean(options.includePlayerOnly)
            : !this.#isNPC;
        return this.getNeedBars({ includePlayerOnly });
    }

    getNeedBarPromptContext(options = {}) {
        const includePlayerOnly = options.includePlayerOnly !== undefined
            ? Boolean(options.includePlayerOnly)
            : !this.#isNPC;
        const bars = this.getNeedBars({ includePlayerOnly }) || [];
        const formatted = [];
        for (const bar of bars) {
            const snapshot = Player.#cloneNeedBarDefinition(bar);
            const mapped = Player.#formatNeedBarForContext(snapshot, { includeValue: true });
            if (mapped) {
                formatted.push(mapped);
            }
        }
        formatted.sort((a, b) => a.name.localeCompare(b.name));
        return formatted;
    }

    #resolveNeedBarByIdentifier(identifier) {
        if (!this.#needBars || !(this.#needBars instanceof Map)) {
            return null;
        }
        if (typeof identifier !== 'string') {
            return null;
        }

        const trimmed = identifier.trim();
        if (!trimmed) {
            return null;
        }

        if (this.#needBars.has(trimmed)) {
            return this.#needBars.get(trimmed);
        }

        const lowered = trimmed.toLowerCase();
        for (const [id, bar] of this.#needBars.entries()) {
            if (id.toLowerCase() === lowered) {
                return bar;
            }
            if (bar && typeof bar.name === 'string' && bar.name.trim().toLowerCase() === lowered) {
                return bar;
            }
        }

        return null;
    }

    static #resolveNeedBarMagnitudeDelta(bar, magnitude) {
        if (!bar) {
            return 0;
        }

        const magnitudeKey = this.#normalizeNeedMagnitudeKey(magnitude);
        if (!magnitudeKey || magnitudeKey === 'all') {
            return 0;
        }

        const configuredMap = this.needBarMagnitudeValues;
        if (configuredMap && Object.prototype.hasOwnProperty.call(configuredMap, magnitudeKey)) {
            const configuredValue = configuredMap[magnitudeKey];
            if (Number.isFinite(configuredValue) && configuredValue > 0) {
                return Math.max(1, Math.round(configuredValue));
            }
        }

        const range = (Number.isFinite(bar.max) && Number.isFinite(bar.min))
            ? Math.max(1, bar.max - bar.min)
            : 100;

        const resolveAmount = (fraction) => {
            if (!Number.isFinite(fraction) || fraction <= 0) {
                return 0;
            }
            return Math.max(1, Math.round(range * fraction));
        };

        switch (magnitudeKey) {
            case 'small':
                return resolveAmount(this.#NEED_BAR_SMALL_FRACTION);
            case 'medium':
                return resolveAmount(this.#NEED_BAR_MEDIUM_FRACTION);
            case 'large':
                return resolveAmount(this.#NEED_BAR_LARGE_FRACTION);
            default:
                return resolveAmount(this.#NEED_BAR_SMALL_FRACTION);
        }
    }

    applyNeedBarChange(identifier, options = {}) {
        if (!identifier) {
            return null;
        }

        const bar = this.#resolveNeedBarByIdentifier(identifier);
        if (!bar) {
            return null;
        }

        const directionRaw = typeof options.direction === 'string' ? options.direction.trim().toLowerCase() : '';
        let direction = null;
        if (['increase', 'gain', 'raise', 'restore', 'boost', 'refill'].includes(directionRaw)) {
            direction = 'increase';
        } else if (['decrease', 'reduce', 'lower', 'drain', 'drop', 'deplete'].includes(directionRaw)) {
            direction = 'decrease';
        }

        if (!direction) {
            direction = 'increase';
        }

        const magnitude = Player.#normalizeNeedMagnitudeKey(options.magnitude) || 'small';

        const sanitizeReason = (reason) => {
            if (!reason || typeof reason !== 'string') {
                return null;
            }
            const trimmed = reason.trim();
            if (!trimmed || trimmed.toLowerCase() === 'n/a') {
                return null;
            }
            return trimmed;
        };

        const reason = sanitizeReason(options.reason);

        const previousValue = bar.value;
        const previousThreshold = bar.currentThreshold ? { ...bar.currentThreshold } : null;

        let newValue = previousValue;

        if (magnitude === 'all') {
            if (direction === 'increase') {
                if (Number.isFinite(bar.max)) {
                    newValue = bar.max;
                }
            } else if (direction === 'decrease') {
                if (Number.isFinite(bar.min)) {
                    newValue = bar.min;
                }
            }
        } else {
            const deltaAmount = Player.#resolveNeedBarMagnitudeDelta(bar, magnitude);
            if (deltaAmount > 0) {
                const signedDelta = direction === 'decrease' ? -deltaAmount : deltaAmount;
                newValue = previousValue + signedDelta;
            }
        }

        Player.#applyNeedBarValue(bar, newValue);

        const delta = Number.isFinite(previousValue) && Number.isFinite(bar.value)
            ? bar.value - previousValue
            : null;

        if (bar.value !== previousValue) {
            this.#lastUpdated = new Date().toISOString();
        }

        return {
            actorId: this.#id,
            actorName: this.#name || null,
            needBarId: bar.id,
            needBarName: bar.name,
            id: bar.id,
            name: bar.name,
            direction,
            magnitude,
            reason,
            previousValue,
            newValue: bar.value,
            delta,
            min: Number.isFinite(bar.min) ? bar.min : null,
            max: Number.isFinite(bar.max) ? bar.max : null,
            playerOnly: Boolean(bar.playerOnly),
            previousThreshold,
            currentThreshold: bar.currentThreshold ? { ...bar.currentThreshold } : null
        };
    }

    #initializeNeedBars(initialData = null) {
        const definitions = Player.needBarDefinitions || {};
        this.#needBars = new Map();

        const initialLookup = new Map();
        if (Array.isArray(initialData)) {
            for (const entry of initialData) {
                if (!entry || typeof entry !== 'object') {
                    continue;
                }
                const id = typeof entry.id === 'string' ? entry.id.trim() : '';
                if (!id) {
                    continue;
                }
                initialLookup.set(id, entry);
            }
        } else if (initialData && typeof initialData === 'object') {
            for (const [id, value] of Object.entries(initialData)) {
                if (!id) {
                    continue;
                }
                initialLookup.set(id.trim(), value);
            }
        }

        for (const [id, definition] of Object.entries(definitions)) {
            if (!id) {
                continue;
            }

            const normalizedId = id.trim();
            if (!normalizedId) {
                continue;
            }

            const isPlayerOnly = Boolean(definition.playerOnly);
            if (isPlayerOnly && this.#isNPC) {
                continue;
            }

            const barDefinition = Player.#cloneNeedBarDefinition(definition);
            if (!barDefinition) {
                continue;
            }

            let resolved = initialLookup.has(normalizedId) ? initialLookup.get(normalizedId) : undefined;
            let candidateValue = null;
            if (resolved !== undefined && resolved !== null) {
                if (typeof resolved === 'object') {
                    const { value, current, amount } = resolved;
                    const attempt = value ?? current ?? amount;
                    if (Number.isFinite(Number(attempt))) {
                        candidateValue = Number(attempt);
                    }
                } else if (Number.isFinite(Number(resolved))) {
                    candidateValue = Number(resolved);
                }
            }

            if (!Number.isFinite(candidateValue)) {
                if (Number.isFinite(barDefinition.initialValue)) {
                    candidateValue = barDefinition.initialValue;
                } else if (Number.isFinite(barDefinition.max)) {
                    candidateValue = barDefinition.max;
                } else {
                    candidateValue = barDefinition.min;
                }
            }

            Player.#applyNeedBarValue(barDefinition, candidateValue);
            barDefinition.initialValue = Number.isFinite(candidateValue) ? candidateValue : barDefinition.initialValue;

            this.#needBars.set(normalizedId, barDefinition);
        }
    }

    /**
     * Check if player is alive
     */
    isAlive() {
        return !this.#isDead && this.#health > 0;
    }

    updateCorpseCountdown() {
        if (this.isDead && this.#corpseCountdown > 0) {
            this.#corpseCountdown -= 1;
            this.#lastUpdated = new Date().toISOString();
        }
        return this.#corpseCountdown
    }
    /**
     * Set player name
     */
    setName(name) {
        // remove from name index
        Player.#indexByName.delete(this.#name);
        if (!name || typeof name !== 'string') {
            throw new Error('Player name must be a non-empty string');
        }
        this.#name = name.trim();
        Player.#indexByName.set(this.#name, this);
        this.#lastUpdated = new Date().toISOString();
        return this.#name;
    }

    /**
     * Set player description
     */
    setDescription(description) {
        this.#description = description || '';
        this.#lastUpdated = new Date().toISOString();
        return this.#description;
    }

    /**
     * Set player level
     */
    setLevel(level) {
        if (!Number.isInteger(level) || level < 1 || level > 20) {
            throw new Error('Player level must be an integer between 1 and 20');
        }
        const oldLevel = this.#level;
        const oldMaxHealth = this.maxHealth;
        this.#level = level;

        // Recalculate max health based on new level
        const newMaxHealth = this.#calculateBaseHealth();

        // Adjust current health proportionally
        if (oldMaxHealth > 0) {
            const healthRatio = this.#health / oldMaxHealth;
            this.#health = Math.max(0, Math.min(newMaxHealth, Math.round(newMaxHealth * healthRatio)));
        }

        const pointsPerLevel = this.#skillPointsPerLevel();
        if (pointsPerLevel > 0 && oldLevel !== this.#level) {
            const delta = this.#level - oldLevel;
            this.#unspentSkillPoints = Math.max(0, this.#unspentSkillPoints + (pointsPerLevel * delta));
        }

        this.#lastUpdated = new Date().toISOString();
        return {
            oldLevel,
            newLevel: this.#level,
            oldMaxHealth,
            newMaxHealth,
            newHealth: this.#health
        };
    }

    /**
     * Set current health
     */
    setHealth(health) {
        if (!Number.isInteger(health) || health < 0) {
            throw new Error('Health must be a non-negative integer');
        }
        const maxHealth = this.maxHealth;
        this.#health = Math.min(health, maxHealth);
        this.#lastUpdated = new Date().toISOString();
        return this.#health;
    }

    /**
     * Set maximum health
     */
    setMaxHealth(maxHealth) {
        console.warn('setMaxHealth is deprecated: max health is derived from attributes and level.');
        return this.maxHealth;
    }

    setLocationByName(locationName) {
        if (!locationName || typeof locationName !== 'string') {
            throw new Error('Location name must be a non-empty string');
        }

        const Location = getLocationModule();
        if (!Location || typeof Location.findByName !== 'function') {
            throw new Error('Location module is not available or does not support findByName');
        }

        const location = Location.getByName(locationName.trim());
        if (!location) {
            throw new Error(`Location with name '${locationName}' not found`);
        }

        this.setLocation(location);
        return this.#currentLocation;
    }

    /**
    /**
     * Set the player's current location
     * @param {string|Object} location - Location ID (string) or Location object
     */
    setLocation(location) {
        // Load object if given an id
        if (typeof location === 'string') {
            const Location = getLocationModule();
            location = Location.get(location);
        }

        if (location === null || location === undefined) {
            this.#currentLocation = null;
        } else if (typeof location === 'object' && location.id) {
            // Store Location object or just its ID
            this.#currentLocation = location.id || location;
            if (!this.#isNPC) location.visited = true;
        } else {
            throw new Error('Location must be a string ID, Location object with ID, or null');
        }

        this.#lastUpdated = new Date().toISOString();
    }

    /**
     * Move to a new location using an exit direction
     * @param {string} direction - Direction to move (e.g., 'north', 'south')
     * @param {Map|Object} locationMap - Map or object containing location ID -> Location mappings
     * @returns {Object} - Movement result with success status and details
     */
    moveToLocation(direction, locationMap) {
        if (!this.#currentLocation) {
            return {
                success: false,
                error: 'Player is not currently in any location',
                currentLocation: null
            };
        }

        // Get current location object
        let currentLocationObj = null;
        if (locationMap instanceof Map) {
            currentLocationObj = locationMap.get(this.#currentLocation);
        } else if (typeof locationMap === 'object') {
            currentLocationObj = locationMap[this.#currentLocation];
        }

        if (!currentLocationObj) {
            return {
                success: false,
                error: `Current location '${this.#currentLocation}' not found in location map`,
                currentLocation: this.#currentLocation
            };
        }

        // Check if exit exists
        const exit = currentLocationObj.getExit ? currentLocationObj.getExit(direction) : null;
        if (!exit) {
            return {
                success: false,
                error: `No exit found in direction '${direction}' from current location`,
                currentLocation: this.#currentLocation,
                availableDirections: currentLocationObj.getAvailableDirections ? currentLocationObj.getAvailableDirections() : []
            };
        }

        // Move to new location
        const oldLocation = this.#currentLocation;
        this.#currentLocation = exit.destination;
        this.#lastUpdated = new Date().toISOString();

        const newLocationObj = locationMap instanceof Map
            ? locationMap.get(this.#currentLocation)
            : (typeof locationMap === 'object' ? locationMap[this.#currentLocation] : null);
        if (newLocationObj && typeof newLocationObj === 'object' && typeof newLocationObj.visited !== 'undefined') {
            try {
                newLocationObj.visited = true;
            } catch (setError) {
                // Ignore failure to set visited flag; map rendering will fall back to default styling.
            }
        }

        return {
            success: true,
            oldLocation: oldLocation,
            newLocation: this.#currentLocation,
            direction: direction,
            exitDescription: exit.description || 'No description'
        };
    }

    getCurrentLocationName() {
        const Location = getLocationModule();
        return Location.get(this.#currentLocation).name;
    }

    get currentLocationObject() {
        const Location = getLocationModule();
        return Location.get(this.#currentLocation);
    }

    /**
     * Get information about the current location
     * @param {Map|Object} locationMap - Map or object containing location ID -> Location mappings
     * @returns {Object|null} - Location information or null if not in a location
     */
    getCurrentLocationInfo(locationMap) {
        if (!this.#currentLocation) {
            return null;
        }

        let locationObj = null;
        if (locationMap instanceof Map) {
            locationObj = locationMap.get(this.#currentLocation);
        } else if (typeof locationMap === 'object') {
            locationObj = locationMap[this.#currentLocation];
        }

        if (!locationObj) {
            return {
                id: this.#currentLocation,
                error: 'Location not found in map'
            };
        }

        return locationObj.getDetails ? locationObj.getDetails() : locationObj;
    }

    /**
     * Get available exit directions from current location
     * @param {Map|Object} locationMap - Map or object containing location ID -> Location mappings
     * @returns {string[]} - Array of available directions
     */
    getAvailableExits(locationMap) {
        if (!this.#currentLocation) {
            return [];
        }

        let locationObj = null;
        if (locationMap instanceof Map) {
            locationObj = locationMap.get(this.#currentLocation);
        } else if (typeof locationMap === 'object') {
            locationObj = locationMap[this.#currentLocation];
        }

        if (!locationObj || !locationObj.getAvailableDirections) {
            return [];
        }

        return locationObj.getAvailableDirections();
    }

    /**
     * Get a single attribute value
     */
    getAttribute(attributeName) {
        return this.#attributes[attributeName] ?? null;
    }

    /**
     * Get an attribute in LLM-readable text.
     * 
     *  < 3 -> "terribe",
     *  3-5 -> "poor",
     *  6-8 -> "below average",
     *  9-11 -> "average",
     *  12-14 -> "above average",
     *  15-17 -> "excellent",
     *  18+ -> "legendary"
     */
    getAttributeTextValue(attributeName) {
        const value = this.getAttribute(attributeName);
        if (value === null) return 'unknown';
        if (value < 3) return 'terrible';
        if (value <= 5) return 'poor';
        if (value <= 8) return 'below average';
        if (value <= 11) return 'average';
        if (value <= 14) return 'above average';
        if (value <= 17) return 'excellent';
        return 'legendary';
    }


    /**
     * Get all attribute information including definitions
     */
    getAttributeInfo() {
        const info = {};
        for (const [attrName, definition] of Object.entries(this.attributeDefinitions)) {
            const baseValue = this.#attributes[attrName];
            const modifiedValue = this.getModifiedAttribute(attrName);
            const resolvedModifiedValue = Number.isFinite(modifiedValue) ? modifiedValue : baseValue;
            const baseModifier = this.getAttributeModifier(attrName, { useModified: false });
            const modifiedModifier = this.getAttributeModifier(attrName, { useModified: true });

            info[attrName] = {
                ...definition,
                value: baseValue,
                modifier: baseModifier,
                baseValue,
                baseModifier,
                modifiedValue: resolvedModifiedValue,
                modifiedModifier
            };
        }
        return info;
    }

    /**
     * Get player's current status with enhanced attribute information
     */
    getStatus() {
        const baseSnapshot = this.toJSON();
        const inventoryIds = Array.isArray(baseSnapshot.inventory) ? [...baseSnapshot.inventory] : [];
        const partyMemberIds = Array.isArray(baseSnapshot.partyMembers) ? [...baseSnapshot.partyMembers] : [];

        const gearSnapshot = this.getGear();
        const equippedByItemId = new Map();
        if (gearSnapshot && typeof gearSnapshot === 'object') {
            for (const [slotName, slotData] of Object.entries(gearSnapshot)) {
                if (!slotData || !slotData.itemId) {
                    continue;
                }
                equippedByItemId.set(slotData.itemId, {
                    slotName,
                    slotType: slotData.slotType || null
                });
            }
        }

        const inventoryDetails = this.getInventoryItems().map(item => {
            let serialized = null;
            if (item && typeof item.toJSON === 'function') {
                serialized = item.toJSON();
            } else if (item && typeof item === 'object') {
                serialized = { ...item };
            } else {
                serialized = item;
            }

            if (serialized && typeof serialized === 'object' && serialized.id) {
                const equippedInfo = equippedByItemId.get(serialized.id);
                if (equippedInfo) {
                    serialized.isEquipped = true;
                    serialized.equippedSlot = equippedInfo.slotName;
                    if (equippedInfo.slotType) {
                        serialized.equippedSlotType = equippedInfo.slotType;
                    }
                }
            }

            return serialized;
        });

        const status = {
            ...baseSnapshot,
            id: this.#id,
            name: this.#name,
            description: this.#description,
            shortDescription: this.#shortDescription,
            class: this.#class,
            race: this.#race,
            level: this.#level,
            experience: this.#experience,
            health: this.#health,
            maxHealth: this.maxHealth,
            healthAttribute: this.#healthAttribute,
            alive: this.isAlive(),
            isDead: this.#isDead,
            currentLocation: this.#currentLocation,
            imageId: this.#imageId,
            isNPC: this.#isNPC,
            isHostile: this.#isHostile,
            personalityType: this.#personalityType,
            personalityTraits: this.#personalityTraits,
            personalityNotes: this.#personalityNotes,
            attributes: { ...this.#attributes },
            modifiers: this.getAttributeModifiers(),
            attributeInfo: this.getAttributeInfo(),
            attributeDefinitions: this.attributeDefinitions,
            systemConfig: this.systemConfig,
            inventory: inventoryDetails,
            inventoryIds,
            partyMembers: partyMemberIds,
            partyMemberIds,
            dispositions: this.#serializeDispositions(),
            dispositionDefinitions: Player.dispositionDefinitions,
            skills: Object.fromEntries(this.#skills),
            abilities: this.getAbilities(),
            unspentSkillPoints: this.#unspentSkillPoints,
            statusEffects: this.getStatusEffects(),
            gear: this.getGear(),
            gearSlotsByType: this.getGearSlotsByType(),
            gearSlotDefinitions: Player.gearSlotDefinitions,
            currency: this.#currency,
            createdAt: this.#createdAt,
            lastUpdated: this.#lastUpdated,
            needBars: this.getNeedBars(),
            corpseCountdown: this.#corpseCountdown,
            importantMemories: this.importantMemories
        };

        status.quests = this.#quests.map(quest => quest.toJSON());
        status.personality = {
            type: this.#personalityType,
            traits: this.#personalityTraits,
            notes: this.#personalityNotes,
            goals: this.#goals.slice(),
            characterArc: this.characterArc
        };
        status.goals = this.#goals.slice();
        status.characterArc = this.characterArc;

        return status;
    }

    /**
     * Export player data for saving
     */
    toJSON() {
        return {
            id: this.#id,
            name: this.#name,
            description: this.#description,
            shortDescription: this.#shortDescription,
            class: this.#class,
            race: this.#race,
            gender: this.#gender,
            level: this.#level,
            health: this.#health,
            maxHealth: this.maxHealth,
            healthAttribute: this.#healthAttribute,
            currentLocation: this.#currentLocation,
            imageId: this.#imageId,
            attributes: this.#attributes,
            isNPC: this.#isNPC,
            isHostile: this.#isHostile,
            isDead: this.#isDead,
            corpseCountdown: this.#corpseCountdown,
            inventory: Array.from(this.#inventory).map(thing => thing.id),
            partyMembers: Array.from(this.#partyMembers),
            dispositions: this.#serializeDispositions(),
            skills: Object.fromEntries(this.#skills),
            abilities: this.getAbilities(),
            unspentSkillPoints: this.#unspentSkillPoints,
            statusEffects: this.getStatusEffects(),
            gear: this.getGear(),
            gearSlotsByType: this.getGearSlotsByType(),
            currency: this.#currency,
            personality: {
                type: this.#personalityType,
                traits: this.#personalityTraits,
                notes: this.#personalityNotes,
                goals: this.#goals.slice(),
                characterArc: this.characterArc
            },
            personalityType: this.#personalityType,
            personalityTraits: this.#personalityTraits,
            personalityNotes: this.#personalityNotes,
            goals: this.#goals.slice(),
            characterArc: this.characterArc,
            createdAt: this.#createdAt,
            lastUpdated: this.#lastUpdated,
            experience: this.#experience,
            currency: this.#currency,
            needBars: this.getNeedBars(),
            importantMemories: this.importantMemories,
            previousLocationId: this.#previousLocationId,
            lastActionWasTravel: this.#lastActionWasTravel,
            consecutiveTravelActions: this.#consecutiveTravelActions,
            turnsSincePartyMemoryGeneration: this.#turnsSincePartyMemoryGeneration,
            partyMemoryHistorySegments: this.#pendingPartyMemoryHistory,
            partyMembershipChangedThisTurn: this.#partyMembershipChangedThisTurn,
            isInPlayerParty: this.#isInPlayerParty,
            partyMembersAddedThisTurn: Array.from(this.#partyMembersAddedThisTurn),
            partyMembersRemovedThisTurn: Array.from(this.#partyMembersRemovedThisTurn),
            elapsedTime: this.#elapsedTime,
            quests: this.#quests.map(quest => quest.toJSON())
        };
    }

    /**
     * Create player from saved data
     */
    static fromJSON(data) {
        const player = new Player({
            name: data.name,
            level: data.level,
            health: data.health,
            attributes: data.attributes,
            imageId: data.imageId,
            id: data.id,
            description: data.description,
            location: data.currentLocation,
            isNPC: data.isNPC,
            isHostile: data.isHostile,
            shortDescription: data.shortDescription,
            class: data.class,
            race: data.race,
            gender: data.gender,
            personalityType: data.personality?.type ?? data.personalityType,
            personalityTraits: data.personality?.traits ?? data.personalityTraits,
            personalityNotes: data.personality?.notes ?? data.personalityNotes,
            goals: Array.isArray(data.personality?.goals)
                ? data.personality.goals
                : (Array.isArray(data.goals) ? data.goals : []),
            inventory: Array.isArray(data.inventory) ? data.inventory : [],
            partyMembers: Array.isArray(data.partyMembers) ? data.partyMembers : [],
            dispositions: data.dispositions && typeof data.dispositions === 'object' ? data.dispositions : {},
            skills: data.skills && typeof data.skills === 'object' ? data.skills : {},
            abilities: Array.isArray(data.abilities) ? data.abilities : (data.abilities && typeof data.abilities === 'object' ? data.abilities : []),
            unspentSkillPoints: data.unspentSkillPoints,
            statusEffects: Array.isArray(data.statusEffects) ? data.statusEffects : [],
            gear: data.gear && typeof data.gear === 'object' ? data.gear : null,
            healthAttribute: data.healthAttribute,
            experience: data.experience,
            currency: data.currency,
            createdAt: data.createdAt,
            lastUpdated: data.lastUpdated,
            needBars: Array.isArray(data.needBars) || (data.needBars && typeof data.needBars === 'object') ? data.needBars : null,
            isDead: data.isDead,
            corpseCountdown: data.corpseCountdown,
            importantMemories: Array.isArray(data.importantMemories) ? data.importantMemories : [],
            characterArc: Player.#normalizeCharacterArc(
                data.characterArc
                ?? data.personality?.characterArc
            )
        });

        if (Number.isFinite(data.elapsedTime)) {
            player.#elapsedTime = Math.max(0, Math.floor(data.elapsedTime));
        } else {
            player.#elapsedTime = 0;
        }

        player.#createdAt = data.createdAt;
        player.#lastUpdated = data.lastUpdated;
        if (data.previousLocationId) {
            player.#previousLocationId = data.previousLocationId;
        }
        if (typeof data.lastActionWasTravel === 'boolean') {
            player.#lastActionWasTravel = data.lastActionWasTravel;
        }
        const travelCount = Number(data.consecutiveTravelActions);
        if (Number.isFinite(travelCount) && travelCount > 0) {
            player.#consecutiveTravelActions = Math.floor(travelCount);
        }
        const turnsSincePartyMemory = Number(data.turnsSincePartyMemoryGeneration);
        if (Number.isFinite(turnsSincePartyMemory) && turnsSincePartyMemory > 0) {
            player.#turnsSincePartyMemoryGeneration = Math.floor(turnsSincePartyMemory);
        }

        if (Array.isArray(data.partyMemoryHistorySegments)) {
            player.#pendingPartyMemoryHistory = data.partyMemoryHistorySegments
                .map(segment => (Array.isArray(segment)
                    ? segment
                        .filter(entry => entry && typeof entry === 'object')
                        .map(entry => ({
                            role: entry.role || null,
                            content: entry.content || '',
                            summary: entry.summary || null,
                            metadata: entry.metadata && typeof entry.metadata === 'object'
                                ? {
                                    npcNames: Array.isArray(entry.metadata.npcNames) ? entry.metadata.npcNames.slice(0) : undefined,
                                    locationId: entry.metadata.locationId || null
                                }
                                : undefined
                        }))
                    : null))
                .filter(Boolean);
        }

        if (typeof data.partyMembershipChangedThisTurn === 'boolean') {
            player.#partyMembershipChangedThisTurn = data.partyMembershipChangedThisTurn;
        }
        if (typeof data.isInPlayerParty === 'boolean') {
            player.#isInPlayerParty = data.isInPlayerParty;
        }
        if (Array.isArray(data.partyMembersAddedThisTurn)) {
            player.#partyMembersAddedThisTurn = new Set(
                data.partyMembersAddedThisTurn.filter(id => typeof id === 'string')
            );
        }
        if (Array.isArray(data.partyMembersRemovedThisTurn)) {
            player.#partyMembersRemovedThisTurn = new Set(
                data.partyMembersRemovedThisTurn.filter(id => typeof id === 'string')
            );
        }

        if (Array.isArray(data.quests)) {
            player.#quests = data.quests
                .map(entry => {
                    try {
                        return Quest.fromJSON(entry);
                    } catch (error) {
                        console.warn('Failed to deserialize quest:', error?.message || error);
                        return null;
                    }
                })
                .filter(Boolean);
        } else {
            player.#quests = [];
        }

        return player;
    }

    addInventoryItem(thingLike, options = {}) {
        return this.#addInventoryThing(thingLike, options);
    }

    removeInventoryItem(thingLike, options = {}) {
        return this.#removeInventoryThing(thingLike, options);
    }

    hasInventoryItem(thingLike) {
        const resolved = this.#resolveThing(thingLike);
        if (!resolved) {
            return false;
        }
        return this.#inventory.has(resolved);
    }

    clearInventory() {
        if (this.#inventory.size === 0) {
            return;
        }
        this.#inventory.clear();
        this.#syncGearWithInventory();
        this.#lastUpdated = new Date().toISOString();
    }

    setInventory(items = []) {
        this.#inventory.clear();
        if (Array.isArray(items)) {
            for (const entry of items) {
                this.#addInventoryThing(entry, { updateTimestamp: false, suppressNpcEquip: true });
            }
        }
        this.#syncGearWithInventory();
        this.#lastUpdated = new Date().toISOString();
        return this.getInventoryItems();
    }

    getGear() {
        const snapshot = {};
        if (!this.#gearSlots) {
            return snapshot;
        }
        for (const [slotName, slotData] of this.#gearSlots.entries()) {
            if (!slotData) {
                continue;
            }
            snapshot[slotName] = {
                slotType: slotData.slotType,
                itemId: slotData.itemId || null,
                item: slotData.itemId ? this.#resolveThing(slotData.itemId) : null
            };
        }
        return snapshot;
    }

    getGearSlotsByType() {
        const snapshot = {};
        if (!this.#gearSlotsByType) {
            return snapshot;
        }
        for (const [slotType, slotNames] of this.#gearSlotsByType.entries()) {
            snapshot[slotType] = Array.isArray(slotNames) ? [...slotNames] : [];
        }
        return snapshot;
    }

    getEquippedSlotForThing(thingLike) {
        const item = this.#resolveThing(thingLike);
        if (!item || !item.slot) {
            return null;
        }
        const slotType = this.#normalizeSlotType(item.slot);
        if (!slotType || !this.#gearSlotsByType) {
            return null;
        }
        const slotNames = this.#gearSlotsByType.get(slotType);
        if (!slotNames || !slotNames.length) {
            return null;
        }
        for (const slotName of slotNames) {
            const slotData = this.#gearSlots.get(slotName);
            if (slotData?.itemId === item.id) {
                return slotName;
            }
        }
        return null;
    }

    hasEquippedThing(thingLike) {
        return this.getEquippedSlotForThing(thingLike) !== null;
    }

    getEquippedItemIdForType(slotType) {
        const normalizedType = this.#normalizeSlotType(slotType);
        if (!normalizedType || !this.#gearSlotsByType) {
            return null;
        }
        const slotNames = this.#gearSlotsByType.get(normalizedType);
        if (!slotNames || !slotNames.length) {
            return null;
        }
        for (const slotName of slotNames) {
            const slotData = this.#gearSlots.get(slotName);
            if (slotData?.itemId) {
                return slotData.itemId;
            }
        }
        return null;
    }

    equipItem(thingLike, { suppressTimestamp = false } = {}) {
        const item = this.#resolveThing(thingLike);
        if (!item) {
            return false;
        }
        const slotType = this.#normalizeSlotType(item.slot);
        if (!slotType || slotType === 'n/a') {
            return false;
        }
        const slotNames = this.#gearSlotsByType?.get(slotType);
        if (!slotNames || slotNames.length === 0) {
            return false;
        }

        let targetSlot = null;
        for (const candidate of slotNames) {
            const slotData = this.#gearSlots.get(candidate);
            if (slotData && !slotData.itemId) {
                targetSlot = candidate;
                break;
            }
        }
        if (!targetSlot) {
            targetSlot = slotNames[0];
        }

        return this.equipItemInSlot(item, targetSlot, { suppressTimestamp });
    }

    equipItemInSlot(thingLike, slotName, { suppressTimestamp = false } = {}) {
        //console.log(`Equipping item in slot: ${slotName}`);
        const item = this.#resolveThing(thingLike);
        //console.log(`Resolved item:`, item);
        if (!item || !slotName) {
            return `Missing item or slot name: ` + `${!item ? 'item' : ''}${!item && !slotName ? ' and ' : ''}${!slotName ? 'slot name' : ''}`;
        }

        const resolvedSlotName = this.#resolveSlotName(slotName);
        if (!resolvedSlotName) {
            return `Invalid slot name: ${slotName}`;
        }

        const slotData = this.#gearSlots.get(resolvedSlotName);
        if (!slotData) {
            return `Slot not found: ${resolvedSlotName}`;
        }

        const itemSlotType = this.#normalizeSlotType(item.slot);
        if (!itemSlotType || itemSlotType === 'n/a' || itemSlotType !== slotData.slotType) {
            console.log(`Incompatible slot types: item(${itemSlotType}) vs slot(${slotData.slotType})`);
            return `Incompatible item slot type: ${itemSlotType} (expected: ${slotData.slotType})`;
        }

        if (!this.#inventory.has(item)) {
            return `Item not found in inventory: ${item.id}`;
        }

        if (!resolvedSlotName) {
            return `Invalid slot name: ${slotName} (resolved to '${resolvedSlotName}')`;
        }

        slotData.itemId = item.id;
        this.#gearSlots.set(resolvedSlotName, slotData);

        //console.log(`Equipping item ${item.id} in slot ${resolvedSlotName}`);

        //console.log(this.#gearSlots)

        if (!suppressTimestamp) {
            this.#lastUpdated = new Date().toISOString();
        }

        return true;
    }

    unequipItemId(itemId, { suppressTimestamp = false } = {}) {
        if (!itemId || typeof itemId !== 'string') {
            return false;
        }
        const trimmed = itemId.trim();
        if (!trimmed || !this.#gearSlots) {
            return false;
        }

        let changed = false;
        for (const slotData of this.#gearSlots.values()) {
            if (slotData?.itemId === trimmed) {
                slotData.itemId = null;
                changed = true;
            }
        }

        if (changed && !suppressTimestamp) {
            this.#lastUpdated = new Date().toISOString();
        }

        return changed;
    }

    unequipSlot(slotName, { suppressTimestamp = false } = {}) {
        const resolvedSlotName = this.#resolveSlotName(slotName);
        if (!resolvedSlotName) {
            return false;
        }
        const slotData = this.#gearSlots.get(resolvedSlotName);
        if (!slotData || !slotData.itemId) {
            return false;
        }

        slotData.itemId = null;
        this.#gearSlots.set(resolvedSlotName, slotData);

        if (!suppressTimestamp) {
            this.#lastUpdated = new Date().toISOString();
        }

        return true;
    }

    #serializeDispositions() {
        const serialized = {};
        for (const [npcId, typeMap] of this.#dispositions.entries()) {
            if (!typeMap || !(typeMap instanceof Map) || typeMap.size === 0) {
                continue;
            }
            serialized[npcId] = {};
            for (const [type, value] of typeMap.entries()) {
                serialized[npcId][type] = value;
            }
        }
        return serialized;
    }

    getSkills() {
        return new Map(this.#skills);
    }

    getAbilities() {
        return this.#abilities.map(ability => ({ ...ability }));
    }

    getSkillValue(skillName) {
        if (typeof skillName !== 'string') {
            return null;
        }
        return this.#skills.get(skillName.trim()) ?? null;
    }

    getSkillModifiers(skillName, { includeEquipped = true } = {}) {
        if (typeof skillName !== 'string') {
            throw new Error('getSkillModifiers requires a skill name string');
        }
        const normalizedSkill = skillName.trim().toLowerCase();
        if (!normalizedSkill) {
            throw new Error('getSkillModifiers requires a non-empty skill name');
        }

        const results = [];
        const collect = (effect, sourceLabel) => {
            if (!effect) return;
            const skills = Array.isArray(effect.skills) ? effect.skills : [];
            for (const entry of skills) {
                if (!entry || typeof entry.skill !== 'string') {
                    continue;
                }
                const entryName = entry.skill.trim().toLowerCase();
                if (!entryName || entryName !== normalizedSkill) {
                    continue;
                }
                const modifier = Number(entry.modifier);
                if (!Number.isFinite(modifier)) {
                    continue;
                }
                const effectName = effect.name || effect.description || sourceLabel || 'Status Effect';
                results.push({ effectName, modifier });
            }
        };

        for (const effect of this.#statusEffects) {
            collect(effect, 'status');
        }

        const location = this.location;
        if (location && typeof location.getStatusEffects === 'function') {
            const locEffects = location.getStatusEffects();
            if (Array.isArray(locEffects)) {
                locEffects.forEach(locEffect => collect(locEffect, 'location'));
            }
        }

        if (includeEquipped) {
            const equippedItems = this.getInventoryItems().filter(item => item?.isEquipped);
            for (const item of equippedItems) {
                const equipEffect = item?.causeStatusEffect;
                if (!equipEffect || !equipEffect.applyToEquipper) {
                    continue;
                }
                collect(equipEffect, item.name || 'equipped item');
            }
        }

        return results;
    }

    setSkillValue(skillName, value) {
        if (typeof skillName !== 'string') {
            return false;
        }
        const trimmed = skillName.trim();
        if (!trimmed) {
            return false;
        }
        if (Player.availableSkills.size > 0 && !Player.availableSkills.has(trimmed)) {
            return false;
        }
        const numeric = Number(value);
        const resolved = Number.isFinite(numeric) ? numeric : 1;
        this.#skills.set(trimmed, resolved);
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    setAbilities(abilitiesInput = []) {
        this.#abilities = this.#normalizeAbilities(abilitiesInput);
        this.#lastUpdated = new Date().toISOString();
        return this.getAbilities();
    }

    addAbility(abilityInput) {
        const current = this.getAbilities();
        current.push(abilityInput);
        return this.setAbilities(current);
    }

    getCurrency() {
        return this.#currency;
    }

    setCurrency(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            throw new Error('Currency must be a finite number');
        }

        const sanitized = Math.max(0, Math.floor(numeric));
        this.#currency = sanitized;
        this.#lastUpdated = new Date().toISOString();
        return this.#currency;
    }

    adjustCurrency(delta) {
        const numeric = Number(delta);
        if (!Number.isFinite(numeric)) {
            return this.#currency;
        }

        const updated = Math.max(0, Math.floor(this.#currency + numeric));
        this.#currency = updated;
        this.#lastUpdated = new Date().toISOString();
        return this.#currency;
    }

    getUnspentSkillPoints() {
        return this.#unspentSkillPoints;
    }

    setUnspentSkillPoints(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 0) {
            throw new Error('Unspent skill points must be a non-negative number');
        }
        this.#unspentSkillPoints = Math.floor(numeric);
        this.#lastUpdated = new Date().toISOString();
        return this.#unspentSkillPoints;
    }

    adjustUnspentSkillPoints(delta) {
        const numeric = Number(delta);
        if (!Number.isFinite(numeric)) {
            return this.#unspentSkillPoints;
        }
        this.#unspentSkillPoints = Math.max(0, Math.floor(this.#unspentSkillPoints + numeric));
        this.#lastUpdated = new Date().toISOString();
        return this.#unspentSkillPoints;
    }

    increaseSkill(skillName, amount = 1) {
        if (typeof skillName !== 'string') {
            throw new Error('Skill name must be a string');
        }
        const trimmed = skillName.trim();
        if (!trimmed) {
            throw new Error('Skill name cannot be empty');
        }
        if (Player.availableSkills.size > 0 && !Player.availableSkills.has(trimmed)) {
            throw new Error(`Unknown skill: ${trimmed}`);
        }

        const numeric = Number(amount);
        if (!Number.isInteger(numeric) || numeric <= 0) {
            throw new Error('Amount must be a positive integer');
        }

        if (this.#unspentSkillPoints < numeric) {
            throw new Error('Not enough unspent skill points');
        }

        const current = this.#skills.get(trimmed) ?? 0;
        this.#skills.set(trimmed, current + numeric);
        this.#unspentSkillPoints -= numeric;
        this.#lastUpdated = new Date().toISOString();
        return this.#skills.get(trimmed);
    }

    syncSkillsWithAvailable() {
        const available = Player.availableSkills instanceof Map ? Player.availableSkills : new Map();
        let updated = false;

        for (const [skillName] of available) {
            if (!this.#skills.has(skillName)) {
                this.#skills.set(skillName, 1);
                updated = true;
            }
        }

        if (available.size > 0) {
            for (const skillName of Array.from(this.#skills.keys())) {
                if (!available.has(skillName)) {
                    this.#skills.delete(skillName);
                    updated = true;
                }
            }
        }

        if (updated) {
            this.#lastUpdated = new Date().toISOString();
        }
    }

    static setAvailableSkills(skillsInput) {
        const nextMap = new Map();

        const coerceSkill = (name, value) => {
            if (value instanceof Skill) {
                return value;
            }
            if (value && typeof value === 'object') {
                try {
                    return Skill.fromJSON({
                        name: value.name || name,
                        description: value.description || '',
                        attribute: value.attribute || ''
                    });
                } catch (_) {
                    return new Skill({ name: name, description: '', attribute: '' });
                }
            }
            return new Skill({ name: name, description: '', attribute: '' });
        };

        if (skillsInput instanceof Map) {
            for (const [name, value] of skillsInput.entries()) {
                if (typeof name !== 'string') continue;
                const trimmed = name.trim();
                if (!trimmed) continue;
                nextMap.set(trimmed, coerceSkill(trimmed, value));
            }
        } else if (Array.isArray(skillsInput)) {
            for (const value of skillsInput) {
                if (!value) continue;
                const name = typeof value.name === 'string' ? value.name.trim() : '';
                if (!name) continue;
                nextMap.set(name, coerceSkill(name, value));
            }
        } else if (skillsInput && typeof skillsInput === 'object') {
            for (const [name, value] of Object.entries(skillsInput)) {
                if (typeof name !== 'string') continue;
                const trimmed = name.trim();
                if (!trimmed) continue;
                nextMap.set(trimmed, coerceSkill(trimmed, value));
            }
        }

        Player.availableSkills = nextMap;
    }

    static getAvailableSkills() {
        return new Map(Player.availableSkills);
    }

    /**
     * Get available attribute generation methods from definitions
     */
    getGenerationMethods() {
        return this.systemConfig.generationMethods ?? {};
    }

    /**
     * Generate attributes using a specific method
     */
    generateAttributes(method = 'standard', diceModule = null) {
        const methods = this.getGenerationMethods();
        const generationMethod = methods[method];

        if (!generationMethod) {
            throw new Error(`Unknown generation method: ${method}`);
        }

        const attrNames = this.getAttributeNames();
        const newAttributes = {};

        switch (method) {
            case 'standard':
                // Assign standard array values randomly
                const values = [...generationMethod.values];
                for (const attrName of attrNames) {
                    if (values.length === 0) break;
                    const randomIndex = Math.floor(Math.random() * values.length);
                    newAttributes[attrName] = values.splice(randomIndex, 1)[0];
                }
                break;

            case 'rolled':
                // Roll dice for each attribute
                if (!diceModule) {
                    throw new Error('Dice module required for rolled generation');
                }
                for (const attrName of attrNames) {
                    newAttributes[attrName] = diceModule.rollDice(generationMethod.method).total;
                }
                break;

            case 'pointBuy':
                // Start with base values (point buy would need a UI)
                for (const attrName of attrNames) {
                    newAttributes[attrName] = generationMethod.baseValue;
                }
                break;

            default:
                throw new Error(`Generation method '${method}' not implemented`);
        }

        // Apply the generated attributes
        for (const [attrName, value] of Object.entries(newAttributes)) {
            if (this.#attributes.hasOwnProperty(attrName)) {
                this.setAttribute(attrName, value);
            }
        }

        return newAttributes;
    }

    #processExperienceOverflow(raw = false) {
        const threshold = Player.#experienceThreshold;
        const multiplier = Player.#experienceRolloverMultiplier;

        let levels = 0;
        while (this.#experience >= threshold) {
            levels += 1;
            const excess = Math.max(0, this.#experience - threshold);
            if (!raw) {
                this.#experience = excess * multiplier;
            } else {
                this.#experience = excess;
            }
        }
        if (levels > 0) {
            this.levelUp(levels);
        }
        return levels;
    }

    /**
     * Get a summary string of the player
     */
    toString() {
        return this.#name;
    }

    finalizeTurn() {
        //console.log(`Finalizing turn for player ${this.#name} (${this.#id})`);
        // Handle corpse countdown if dead
        if (this.#isDead && this.#corpseCountdown > 0) {
            this.#corpseCountdown -= 1;
        }

        if (this.#checkEquipment) {
            Player.#notifyNpcInventoryChange(this);
        }
        this.#checkEquipment = false;

        // Reset turn-based flags
        this.#lastActionWasTravel = false;
        this.#partyMembershipChangedThisTurn = false;
        this.#partyMembersAddedThisTurn.clear();
        this.#partyMembersRemovedThisTurn.clear();
        this.#lastUpdated = new Date().toISOString();
    }
}

module.exports = Player;
