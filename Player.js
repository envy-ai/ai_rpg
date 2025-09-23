const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const Location = require('./Location.js');
const Thing = require('./Thing.js');
const Skill = require('./Skill.js');

class Player {
    // Private fields using ES13 syntax
    #definitions;
    #attributes = {};
    #level;
    #health;
    #maxHealth;
    #name;
    #description;
    #shortDescription;
    #class;
    #race;
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
    static #npcInventoryChangeHandler = null;

    static availableSkills = new Map();
    static #gearSlotDefinitions = null;

    static get gearSlotDefinitions() {
        if (!this.#gearSlotDefinitions) {
            this.#gearSlotDefinitions = this.#loadGearSlotDefinitions();
        }
        return this.#gearSlotDefinitions;
    }

    static setNpcInventoryChangeHandler(handler) {
        if (handler && typeof handler !== 'function') {
            throw new Error('NPC inventory change handler must be a function');
        }
        this.#npcInventoryChangeHandler = handler || null;
    }

    static #notifyNpcInventoryChange(player, payload) {
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

    // Static private method for ID generation
    static #generateUniqueId() {
        return `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    constructor(options = {}) {
        // Load definitions first
        this.#definitions = this.#loadDefinitions();

        // Initialize attributes dynamically from definitions
        this.#initializeAttributes(options.attributes ?? {});

        // Base stats (not attributes)
        this.#level = options.level ?? 1;
        this.#health = options.health ?? this.#calculateBaseHealth();
        this.#maxHealth = this.#health;

        // Player identification
        this.#name = options.name ?? "Unnamed Player";
        this.#description = options.description ?? "A mysterious adventurer with an unknown past.";
        this.#shortDescription = options.shortDescription ?? "";
        this.#id = options.id ?? Player.#generateUniqueId();
        this.#class = options.class ?? "person";
        this.#race = options.race ?? "human";

        // Location (can be Location ID string or Location object)
        this.#currentLocation = options.location ?? null;

        // Player image ID for generated portrait
        this.#imageId = options.imageId ?? null;
        this.#isNPC = Boolean(options.isNPC);

        this.#inventory = new Set();
        this.#initializeInventory(options.inventory);

        this.#partyMembers = new Set(Array.isArray(options.partyMembers) ? options.partyMembers.filter(id => typeof id === 'string') : []);
        this.#dispositions = this.#initializeDispositions(options.dispositions);
        this.#skills = new Map();
        this.#initializeSkills(options.skills);
        this.#initializeGear(options.gear);

        const providedPoints = Number(options.unspentSkillPoints);
        if (Number.isFinite(providedPoints)) {
            this.#unspentSkillPoints = Math.max(0, Math.floor(providedPoints));
        } else {
            this.#unspentSkillPoints = this.#skillPointsPerLevel() * this.#level;
        }

        this.#statusEffects = this.#normalizeStatusEffects(options.statusEffects);

        // Creation timestamp
        this.#createdAt = new Date().toISOString();
        this.#lastUpdated = this.#createdAt;
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
                if (typeof type === 'string' && Number.isFinite(value)) {
                    typeMap.set(type, Number(value));
                }
            }
            if (typeMap.size > 0) {
                dispositionMap.set(npcId, typeMap);
            }
        }
        return dispositionMap;
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
        this.#inventory.add(resolved);

        const added = this.#inventory.size !== previousSize;

        if (updateTimestamp && added) {
            this.#lastUpdated = new Date().toISOString();
        }

        if (added && !suppressNpcEquip) {
            Player.#notifyNpcInventoryChange(this, { changeType: 'add', item: resolved });
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
            if (updateTimestamp) {
                this.#lastUpdated = new Date().toISOString();
            }
            if (!suppressNpcEquip) {
                Player.#notifyNpcInventoryChange(this, { changeType: 'remove', item: resolved });
            }
        }
        return removed;
    }

    /**
     * Calculate base health based on constitution and level (private method)
     */
    #calculateBaseHealth() {
        const constitutionModifier = this.getAttributeModifier('constitution');
        return 10 + constitutionModifier + (this.#level - 1) * (6 + constitutionModifier);
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

    /**
     * Recalculate max health and adjust current health proportionally (private method)
     */
    #recalculateHealth() {
        const oldMaxHealth = this.#maxHealth;
        this.#maxHealth = this.#calculateBaseHealth();

        if (oldMaxHealth > 0) {
            // Maintain health ratio
            const healthRatio = this.#health / oldMaxHealth;
            this.#health = Math.ceil(this.#maxHealth * healthRatio);
        } else {
            this.#health = this.#maxHealth;
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

    get health() {
        return this.#health;
    }

    get maxHealth() {
        return this.#maxHealth;
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

    get imageId() {
        return this.#imageId;
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
        if (typeof memberId !== 'string' || !memberId.trim()) {
            return false;
        }
        const trimmed = memberId.trim();
        const before = this.#partyMembers.size;
        this.#partyMembers.add(trimmed);
        if (this.#partyMembers.size !== before) {
            this.#lastUpdated = new Date().toISOString();
            return true;
        }
        return false;
    }

    removePartyMember(memberId) {
        if (typeof memberId !== 'string' || !memberId.trim()) {
            return false;
        }
        const removed = this.#partyMembers.delete(memberId.trim());
        if (removed) {
            this.#lastUpdated = new Date().toISOString();
        }
        return removed;
    }

    clearPartyMembers() {
        if (this.#partyMembers.size === 0) {
            return;
        }
        this.#partyMembers.clear();
        this.#lastUpdated = new Date().toISOString();
    }

    getPartyMembers() {
        return Array.from(this.#partyMembers);
    }

    getDisposition(targetId, type = 'default') {
        if (typeof targetId !== 'string' || !targetId.trim()) {
            return 0;
        }
        const npcKey = targetId.trim();
        const dispositionType = typeof type === 'string' && type.trim() ? type.trim() : 'default';
        const typeMap = this.#dispositions.get(npcKey);
        if (!typeMap) {
            return 0;
        }
        return typeMap.get(dispositionType) ?? 0;
    }

    setDisposition(targetId, type = 'default', value = 0) {
        if (typeof targetId !== 'string' || !targetId.trim()) {
            return this.getDisposition(targetId, type);
        }
        const npcKey = targetId.trim();
        const dispositionType = typeof type === 'string' && type.trim() ? type.trim() : 'default';
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return this.getDisposition(targetId, type);
        }

        let typeMap = this.#dispositions.get(npcKey);
        if (!typeMap) {
            typeMap = new Map();
            this.#dispositions.set(npcKey, typeMap);
        }
        typeMap.set(dispositionType, numericValue);
        this.#lastUpdated = new Date().toISOString();
        return numericValue;
    }

    increaseDisposition(targetId, type = 'default', amount = 1) {
        const current = this.getDisposition(targetId, type);
        const increment = Number(amount);
        if (!Number.isFinite(increment)) {
            return current;
        }
        return this.setDisposition(targetId, type, current + increment);
    }

    decreaseDisposition(targetId, type = 'default', amount = 1) {
        const current = this.getDisposition(targetId, type);
        const decrement = Number(amount);
        if (!Number.isFinite(decrement)) {
            return current;
        }
        return this.setDisposition(targetId, type, current - decrement);
    }

    get createdAt() {
        return this.#createdAt;
    }

    get lastUpdated() {
        return this.#lastUpdated;
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
    getAttributeModifier(attributeName) {
        const attributeValue = this.#attributes[attributeName];
        if (attributeValue === undefined) {
            console.warn(`Unknown attribute: ${attributeName}`);
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

    /**
     * Get a formatted object of all attribute modifiers
     */
    getAttributeModifiers() {
        const modifiers = {};
        for (const attrName of this.getAttributeNames()) {
            modifiers[attrName] = this.getAttributeModifier(attrName);
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
        if (definition?.affects?.includes('health')) {
            this.#recalculateHealth();
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
    levelUp() {
        this.#level += 1;
        const oldMaxHealth = this.#maxHealth;
        this.#maxHealth = this.#calculateBaseHealth();

        // Add the health increase to current health
        this.#health += (this.#maxHealth - oldMaxHealth);
        const pointsPerLevel = this.#skillPointsPerLevel();
        if (pointsPerLevel > 0) {
            this.#unspentSkillPoints += pointsPerLevel;
        }
        this.#lastUpdated = new Date().toISOString();
    }

    /**
     * Modify health (damage or healing)
     */
    modifyHealth(amount, reason = '') {
        const oldHealth = this.#health;
        this.#health = Math.max(0, Math.min(this.#maxHealth, this.#health + amount));
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
            if (!entry) {
                continue;
            }

            if (typeof entry === 'string') {
                const description = entry.trim();
                if (!description) {
                    continue;
                }
                normalized.push({ description, duration: 1 });
                continue;
            }

            if (typeof entry === 'object') {
                const descriptionValue = typeof entry.description === 'string'
                    ? entry.description.trim()
                    : (typeof entry.text === 'string' ? entry.text.trim() : (typeof entry.name === 'string' ? entry.name.trim() : ''));

                if (!descriptionValue) {
                    continue;
                }

                const rawDuration = entry.duration;
                const duration = Number.isFinite(Number(rawDuration)) ? Math.floor(Number(rawDuration)) : (rawDuration === null ? null : 1);

                normalized.push({
                    description: descriptionValue,
                    duration: duration === null ? null : Math.max(0, duration)
                });
            }
        }

        return normalized;
    }

    getStatusEffects() {
        return this.#statusEffects.map(effect => ({ ...effect }));
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
                retained.push({ ...effect });
                continue;
            }

            if (effect.duration <= 0) {
                changed = true;
                continue;
            }

            retained.push({
                description: effect.description,
                duration: effect.duration - 1
            });
            changed = true;
        }

        if (changed) {
            this.#statusEffects = retained;
            this.#lastUpdated = new Date().toISOString();
        }
    }

    clearExpiredStatusEffects() {
        const before = this.#statusEffects.length;
        this.#statusEffects = this.#statusEffects.filter(effect => !Number.isFinite(effect.duration) || effect.duration > 0);
        if (this.#statusEffects.length !== before) {
            this.#lastUpdated = new Date().toISOString();
        }
    }

    /**
     * Check if player is alive
     */
    isAlive() {
        return this.#health > 0;
    }

    /**
     * Set player name
     */
    setName(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Player name must be a non-empty string');
        }
        this.#name = name.trim();
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
        this.#level = level;

        // Recalculate max health based on new level
        const oldMaxHealth = this.#maxHealth;
        this.#maxHealth = this.#calculateBaseHealth();

        // Adjust current health proportionally
        if (oldMaxHealth > 0) {
            const healthRatio = this.#health / oldMaxHealth;
            this.#health = Math.round(this.#maxHealth * healthRatio);
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
            newMaxHealth: this.#maxHealth,
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
        this.#health = Math.min(health, this.#maxHealth);
        this.#lastUpdated = new Date().toISOString();
        return this.#health;
    }

    /**
     * Set maximum health
     */
    setMaxHealth(maxHealth) {
        if (!Number.isInteger(maxHealth) || maxHealth < 1) {
            throw new Error('Maximum health must be a positive integer');
        }
        this.#maxHealth = maxHealth;
        // Ensure current health doesn't exceed new max
        this.#health = Math.min(this.#health, this.#maxHealth);
        this.#lastUpdated = new Date().toISOString();
        return this.#maxHealth;
    }

    /**
    /**
     * Set the player's current location
     * @param {string|Object} location - Location ID (string) or Location object
     */
    setLocation(location) {
        // Load object if given an id
        if (typeof location === 'string') {
            location = Location.get(location);
        }

        if (location === null || location === undefined) {
            this.#currentLocation = null;
        } else if (typeof location === 'object' && location.id) {
            // Store Location object or just its ID
            this.#currentLocation = location.id || location;
            location.visited = true;
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
            info[attrName] = {
                ...definition,
                value: this.#attributes[attrName],
                modifier: this.getAttributeModifier(attrName)
            };
        }
        return info;
    }

    /**
     * Get player's current status with enhanced attribute information
     */
    getStatus() {
        return {
            id: this.#id,
            name: this.#name,
            description: this.#description,
            level: this.#level,
            health: this.#health,
            maxHealth: this.#maxHealth,
            alive: this.isAlive(),
            currentLocation: this.#currentLocation,
            imageId: this.#imageId,
            isNPC: this.#isNPC,
            attributes: { ...this.#attributes },
            modifiers: this.getAttributeModifiers(),
            attributeInfo: this.getAttributeInfo(),
            inventory: this.getInventoryItems().map(thing => thing.toJSON()),
            partyMembers: this.getPartyMembers(),
            dispositions: this.#serializeDispositions(),
            skills: Object.fromEntries(this.#skills),
            unspentSkillPoints: this.#unspentSkillPoints,
            statusEffects: this.getStatusEffects(),
            gear: this.getGear(),
            gearSlotsByType: this.getGearSlotsByType()
        };
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
            level: this.#level,
            health: this.#health,
            maxHealth: this.#maxHealth,
            currentLocation: this.#currentLocation,
            imageId: this.#imageId,
            attributes: this.#attributes,
            isNPC: this.#isNPC,
            inventory: Array.from(this.#inventory).map(thing => thing.id),
            partyMembers: Array.from(this.#partyMembers),
            dispositions: this.#serializeDispositions(),
            skills: Object.fromEntries(this.#skills),
            unspentSkillPoints: this.#unspentSkillPoints,
            statusEffects: this.getStatusEffects(),
            gear: this.getGear(),
            gearSlotsByType: this.getGearSlotsByType(),
            createdAt: this.#createdAt,
            lastUpdated: this.#lastUpdated
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
            shortDescription: data.shortDescription,
            class: data.class,
            race: data.race,
            inventory: Array.isArray(data.inventory) ? data.inventory : [],
            partyMembers: Array.isArray(data.partyMembers) ? data.partyMembers : [],
            dispositions: data.dispositions && typeof data.dispositions === 'object' ? data.dispositions : {},
            skills: data.skills && typeof data.skills === 'object' ? data.skills : {},
            unspentSkillPoints: data.unspentSkillPoints,
            statusEffects: Array.isArray(data.statusEffects) ? data.statusEffects : [],
            gear: data.gear && typeof data.gear === 'object' ? data.gear : null
        });
        player.#maxHealth = data.maxHealth;
        player.#createdAt = data.createdAt;
        player.#lastUpdated = data.lastUpdated;
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
                itemId: slotData.itemId || null
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
        console.log(`Equipping item in slot: ${slotName}`);
        const item = this.#resolveThing(thingLike);
        console.log(`Resolved item:`, item);
        if (!item || !slotName) {
            return `Missing item or slot name: ` + `${!item ? 'item' : ''}${!item && !slotName ? ' and ' : ''}${!slotName ? 'slot name' : ''}`;
        }
        console.log(1);
        const resolvedSlotName = this.#resolveSlotName(slotName);
        if (!resolvedSlotName) {
            return `Invalid slot name: ${slotName}`;
        }
        console.log(2);
        const slotData = this.#gearSlots.get(resolvedSlotName);
        if (!slotData) {
            return `Slot not found: ${resolvedSlotName}`;
        }
        console.log(3);
        const itemSlotType = this.#normalizeSlotType(item.slot);
        if (!itemSlotType || itemSlotType === 'n/a' || itemSlotType !== slotData.slotType) {
            console.log(`Incompatible slot types: item(${itemSlotType}) vs slot(${slotData.slotType})`);
            //print trace
            console.trace();
            return `Incompatible item slot type: ${itemSlotType} (expected: ${slotData.slotType})`;
        }
        console.log(4);
        if (!this.#inventory.has(item)) {
            return `Item not found in inventory: ${item.id}`;
        }
        console.log(5);
        if (!resolvedSlotName) {
            return `Invalid slot name: ${slotName} (resolved to '${resolvedSlotName}')`;
        }
        console.log(6);
        slotData.itemId = item.id;
        this.#gearSlots.set(resolvedSlotName, slotData);

        console.log(`Equipping item ${item.id} in slot ${resolvedSlotName}`);

        console.log(this.#gearSlots)

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

    getSkillValue(skillName) {
        if (typeof skillName !== 'string') {
            return null;
        }
        return this.#skills.get(skillName.trim()) ?? null;
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

    /**
     * Get a summary string of the player
     */
    toString() {
        const statusEmoji = this.isAlive() ? '🟢' : '💀';

        // Build attribute string using abbreviations if available
        const attrs = this.getAttributeNames()
            .map(name => {
                const def = this.getAttributeDefinition(name);
                const abbrev = def.abbreviation ?? name.charAt(0).toUpperCase();
                return `${abbrev}:${this.#attributes[name]}`;
            })
            .join(' ');

        return `${statusEmoji} ${this.#name} (Lvl ${this.#level}) HP:${this.#health}/${this.#maxHealth} [${attrs}]`;
    }
}

module.exports = Player;
