const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { count } = require('console');

/**
 * Thing class for AI RPG
 * Represents items and scenery objects in the game world
 * Uses ES13 syntax with private fields and modern JavaScript features
 */
class Thing {
  // Private fields - encapsulated state
  #id;
  #name;
  #description;
  #thingType;
  #imageId;
  #createdAt;
  #lastUpdated;
  #rarity;
  #itemTypeDetail;
  #metadata;
  #statusEffects;
  #slot;
  #attributeBonuses;
  #causeStatusEffect;
  #level;
  #relativeLevel;

  // Static indexing maps
  static #indexByID = new Map();
  static #indexByName = new Map();

  // Rarity definitions loaded from defs/rarities.yaml
  static #rarityDefinitions = new Map();
  static #defaultRarityKey = null;

  // Valid thing types
  static #validTypes = ['scenery', 'item'];

  static #normalizeRarityKey(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim().toLowerCase();
  }

  static #titleCase(value) {
    if (!value) {
      return '';
    }
    return String(value)
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  static #getDefaultRarityDefinition() {
    if (this.#defaultRarityKey && this.#rarityDefinitions.has(this.#defaultRarityKey)) {
      return this.#rarityDefinitions.get(this.#defaultRarityKey);
    }
    const firstEntry = this.#rarityDefinitions.values().next();
    return firstEntry && !firstEntry.done ? firstEntry.value : null;
  }

  static #cloneRarityDefinition(definition) {
    if (!definition) {
      return null;
    }
    return {
      key: definition.key,
      label: definition.label,
      color: definition.color,
      damageMultiplier: definition.damageMultiplier,
      valueMultiplier: definition.valueMultiplier,
      attributeMultiplier: definition.attributeMultiplier,
      prevalence: definition.prevalence,
      description: definition.description,
      order: definition.order
    };
  }

  static loadRarityDefinitions({ forceReload = false } = {}) {
    if (!forceReload && this.#rarityDefinitions.size > 0) {
      return this.getAllRarityDefinitions();
    }

    const raritiesPath = path.join(__dirname, 'defs', 'rarities.yaml');
    const parsedEntries = [];

    try {
      const yamlContent = fs.readFileSync(raritiesPath, 'utf8');
      const parsedYaml = yaml.load(yamlContent) || {};
      const entries = parsedYaml && typeof parsedYaml === 'object' ? parsedYaml.rarities : null;
      if (entries && typeof entries === 'object') {
        let order = 0;
        for (const [rawKey, rawDefinition] of Object.entries(entries)) {
          if (!rawKey || !rawDefinition || typeof rawDefinition !== 'object') {
            continue;
          }

          const key = this.#normalizeRarityKey(rawKey);
          if (!key) {
            continue;
          }

          const labelSource = typeof rawDefinition.label === 'string' && rawDefinition.label.trim()
            ? rawDefinition.label.trim()
            : rawKey;

          const safeNumber = (value, fallback) => {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : fallback;
          };

          parsedEntries.push({
            key,
            label: this.#titleCase(labelSource),
            color: typeof rawDefinition.color === 'string' && rawDefinition.color.trim() ? rawDefinition.color.trim() : null,
            damageMultiplier: safeNumber(rawDefinition.damage_multiplier, 1),
            valueMultiplier: safeNumber(rawDefinition.value_multiplier, 1),
            attributeMultiplier: safeNumber(rawDefinition.attribute_multiplier, 1),
            prevalence: safeNumber(rawDefinition.prevalence, 0),
            description: typeof rawDefinition.description === 'string' ? rawDefinition.description.trim() : '',
            order: order++
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to load rarity definitions from ${raritiesPath}: ${error.message}`);
    }

    this.#rarityDefinitions.clear();

    if (parsedEntries.length === 0) {
      // Minimal fallback to keep game functional if file is missing or invalid
      const fallback = {
        key: 'common',
        label: 'Common',
        color: null,
        damageMultiplier: 1,
        valueMultiplier: 1,
        attributeMultiplier: 1,
        prevalence: 0,
        description: '',
        order: 0
      };
      this.#rarityDefinitions.set(fallback.key, fallback);
      this.#defaultRarityKey = fallback.key;
      return [this.#cloneRarityDefinition(fallback)];
    }

    parsedEntries.forEach(entry => {
      this.#rarityDefinitions.set(entry.key, entry);
    });

    this.#defaultRarityKey = this.#rarityDefinitions.has('common') ? 'common' : parsedEntries[0].key;

    return this.getAllRarityDefinitions();
  }

  static getAllRarityDefinitions() {
    if (this.#rarityDefinitions.size === 0) {
      this.loadRarityDefinitions({ forceReload: false });
    }
    return Array.from(this.#rarityDefinitions.values())
      .sort((a, b) => a.order - b.order)
      .map(entry => this.#cloneRarityDefinition(entry));
  }

  static generateRandomRarityDefinition() {
    const definitions = this.getAllRarityDefinitions();
    if (!definitions.length) {
      return null;
    }

    const weighted = [];
    let totalWeight = 0;
    for (const entry of definitions) {
      const prevalence = Number(entry?.prevalence);
      const weight = Number.isFinite(prevalence) && prevalence > 0 ? prevalence : 0;
      totalWeight += weight;
      weighted.push({ entry, weight });
    }

    if (totalWeight <= 0) {
      const fallback = definitions[0];
      return fallback ? { ...fallback } : null;
    }

    let roll = Math.random() * totalWeight;
    for (const { entry, weight } of weighted) {
      if (weight <= 0) {
        continue;
      }
      if (roll < weight) {
        return { ...entry };
      }
      roll -= weight;
    }

    const last = weighted[weighted.length - 1]?.entry;
    return last ? { ...last } : { ...definitions[0] };
  }

  static getRarityDefinition(rarity, { fallbackToDefault = false } = {}) {
    if (this.#rarityDefinitions.size === 0) {
      this.loadRarityDefinitions({ forceReload: false });
    }
    const normalized = this.#normalizeRarityKey(rarity);
    if (normalized && this.#rarityDefinitions.has(normalized)) {
      return this.#cloneRarityDefinition(this.#rarityDefinitions.get(normalized));
    }
    if (!fallbackToDefault) {
      return null;
    }
    return this.#cloneRarityDefinition(this.#getDefaultRarityDefinition());
  }

  static getDefaultRarityKey() {
    if (this.#rarityDefinitions.size === 0) {
      this.loadRarityDefinitions({ forceReload: false });
    }
    if (this.#defaultRarityKey) {
      return this.#defaultRarityKey;
    }
    const fallback = this.#getDefaultRarityDefinition();
    return fallback ? fallback.key : 'common';
  }

  static getDefaultRarityLabel() {
    const definition = this.getRarityDefinition(this.getDefaultRarityKey(), { fallbackToDefault: true });
    return definition?.label || 'Common';
  }

  static getRarityDamageMultiplier(rarity) {
    const definition = this.getRarityDefinition(rarity, { fallbackToDefault: true });
    return Number.isFinite(definition?.damageMultiplier) ? definition.damageMultiplier : 1;
  }

  static getRarityValueMultiplier(rarity) {
    const definition = this.getRarityDefinition(rarity, { fallbackToDefault: true });
    return Number.isFinite(definition?.valueMultiplier) ? definition.valueMultiplier : 1;
  }

  static getRarityAttributeMultiplier(rarity) {
    const definition = this.getRarityDefinition(rarity, { fallbackToDefault: true });
    return Number.isFinite(definition?.attributeMultiplier) ? definition.attributeMultiplier : 1;
  }

  static getRarityColor(rarity) {
    const definition = this.getRarityDefinition(rarity, { fallbackToDefault: false });
    return definition?.color || null;
  }

  static normalizeRarityKey(value) {
    return this.#normalizeRarityKey(value);
  }

  static get allThingNames() {
    return Array.from(Thing.#indexByName.keys());
  }

  static thingNameExists(name) {
    if (!name || typeof name !== 'string') {
      return false;
    }

    return Thing.#indexByName.has(name.toLowerCase());
  }

  // Static private method for generating unique IDs
  static #generateId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(6).toString('hex');
    return `thing_${timestamp}_${random}`;
  }

  /**
   * Creates a new Thing instance
   * @param {Object} options - Thing configuration
   * @param {string} options.name - Name of the thing
   * @param {string} options.description - Description of the thing
   * @param {string} options.thingType - Type of thing ('scenery' or 'item')
   * @param {string} [options.id] - Custom ID (if not provided, one will be generated)
   * @param {string} [options.imageId] - Image ID for generated thing visual (defaults to null)
   */
  constructor({
    name,
    description,
    thingType,
    id = null,
    imageId = null,
    rarity = null,
    itemTypeDetail = null,
    metadata = null,
    statusEffects = [],
    slot = null,
    attributeBonuses = null,
    causeStatusEffect = null,
    level = null,
    relativeLevel = null
  } = {}) {
    // Validate required parameters
    if (!name || typeof name !== 'string') {
      throw new Error('Thing name is required and must be a string');
    }

    if (!description || typeof description !== 'string') {
      throw new Error('Thing description is required and must be a string');
    }

    if (!thingType || typeof thingType !== 'string') {
      throw new Error('Thing type is required and must be a string');
    }

    if (!Thing.#validTypes.includes(thingType)) {
      throw new Error(`Thing type must be one of: ${Thing.#validTypes.join(', ')}`);
    }

    // Initialize private fields
    this.#id = id || Thing.#generateId();
    this.#name = name.trim();
    this.#description = description.trim();
    this.#thingType = thingType.toLowerCase();
    this.#imageId = imageId;
    this.#rarity = typeof rarity === 'string' ? rarity.trim() : null;
    this.#itemTypeDetail = typeof itemTypeDetail === 'string' ? itemTypeDetail.trim() : null;
    this.#metadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};
    this.#createdAt = new Date().toISOString();
    this.#lastUpdated = this.#createdAt;
    this.#statusEffects = this.#normalizeStatusEffects(statusEffects);
    this.#slot = null;
    this.#attributeBonuses = [];
    this.#causeStatusEffect = null;
    this.#level = Number.isFinite(level) ? Math.max(1, Math.min(20, Math.round(level))) : null;
    this.#relativeLevel = Number.isFinite(relativeLevel) ? Math.max(-20, Math.min(20, Math.round(relativeLevel))) : null;

    this.#applyMetadataFieldsFromMetadata();

    if (slot !== null && slot !== undefined) {
      this.slot = slot;
    }
    if (attributeBonuses !== null && attributeBonuses !== undefined) {
      this.attributeBonuses = attributeBonuses;
    }
    if (causeStatusEffect !== null && causeStatusEffect !== undefined) {
      this.causeStatusEffect = causeStatusEffect;
    }
    if (Number.isFinite(level)) {
      this.level = level;
    }
    if (Number.isFinite(relativeLevel)) {
      this.relativeLevel = relativeLevel;
    }
    this.#syncFieldsToMetadata();

    // Add to static indexes
    Thing.#indexByID.set(this.#id, this);
    Thing.#indexByName.set(this.#name.toLowerCase(), this);
  }

  // Getter methods
  get id() {
    return this.#id;
  }

  get name() {
    return this.#name;
  }

  get description() {
    return this.#description;
  }

  get thingType() {
    return this.#thingType;
  }

  get imageId() {
    return this.#imageId;
  }

  get createdAt() {
    return this.#createdAt;
  }

  get lastUpdated() {
    return this.#lastUpdated;
  }

  get equippedBy() {
    // This field is not tracked in the Thing class itself
    const Player = require('./Player.js');
    return Player.getAll().filter(player => player.hasEquippedThing(this.#id))[0] || null;
  }

  get isEquipped() {
    return this.equippedBy !== null;
  }

  get equippedSlot() {
    const player = this.equippedBy;
    return player ? player.getEquippedSlotForThing(this.#id) : null;
  }

  get rarity() {
    return this.#rarity;
  }

  set rarity(newRarity) {
    this.#rarity = typeof newRarity === 'string' ? newRarity.trim() : null;
    this.#lastUpdated = new Date().toISOString();
  }

  get itemTypeDetail() {
    return this.#itemTypeDetail;
  }

  set itemTypeDetail(newTypeDetail) {
    this.#itemTypeDetail = typeof newTypeDetail === 'string' ? newTypeDetail.trim() : null;
    this.#lastUpdated = new Date().toISOString();
  }

  get metadata() {
    return { ...this.#metadata };
  }

  set metadata(newMetadata) {
    this.#metadata = newMetadata && typeof newMetadata === 'object' ? { ...newMetadata } : {};
    this.#applyMetadataFieldsFromMetadata();
    this.#lastUpdated = new Date().toISOString();
  }

  get slot() {
    return this.#slot;
  }

  set slot(value) {
    const sanitized = this.#sanitizeSlot(value);
    if (sanitized !== this.#slot) {
      this.#slot = sanitized;
      this.#syncFieldsToMetadata();
      this.#lastUpdated = new Date().toISOString();
    }
  }

  get attributeBonuses() {
    return this.#attributeBonuses.map(bonus => ({ ...bonus }));
  }

  set attributeBonuses(bonuses) {
    const normalized = this.#normalizeAttributeBonuses(bonuses);
    this.#attributeBonuses = normalized;
    this.#syncFieldsToMetadata();
    this.#lastUpdated = new Date().toISOString();
  }

  getAttributeBonus(attributeName) {
    if (typeof attributeName !== 'string') {
      return 0;
    }
    const normalized = attributeName.trim().toLowerCase();
    if (!normalized) {
      return 0;
    }
    if (!Array.isArray(this.#attributeBonuses) || this.#attributeBonuses.length === 0) {
      return 0;
    }

    let total = 0;
    for (const entry of this.#attributeBonuses) {
      if (!entry || typeof entry.attribute !== 'string') {
        continue;
      }
      if (entry.attribute.trim().toLowerCase() !== normalized) {
        continue;
      }
      const numeric = Number(entry.bonus);
      if (Number.isFinite(numeric)) {
        total += numeric;
      }
    }
    return total;
  }

  get causeStatusEffect() {
    return this.#causeStatusEffect ? { ...this.#causeStatusEffect } : null;
  }

  set causeStatusEffect(effect) {
    this.#causeStatusEffect = this.#normalizeCauseStatusEffect(effect);
    this.#syncFieldsToMetadata();
    this.#lastUpdated = new Date().toISOString();
  }

  get level() {
    return this.#level;
  }

  set level(value) {
    if (Number.isFinite(value)) {
      const clamped = Math.max(1, Math.min(20, Math.round(value)));
      if (clamped !== this.#level) {
        this.#level = clamped;
        this.#syncFieldsToMetadata();
        this.#lastUpdated = new Date().toISOString();
      }
    } else if (this.#level !== null) {
      this.#level = null;
      this.#syncFieldsToMetadata();
      this.#lastUpdated = new Date().toISOString();
    }
  }

  get relativeLevel() {
    return this.#relativeLevel;
  }

  set relativeLevel(value) {
    if (Number.isFinite(value)) {
      const clamped = Math.max(-20, Math.min(20, Math.round(value)));
      if (clamped !== this.#relativeLevel) {
        this.#relativeLevel = clamped;
        this.#syncFieldsToMetadata();
        this.#lastUpdated = new Date().toISOString();
      }
    } else if (this.#relativeLevel !== null) {
      this.#relativeLevel = null;
      this.#syncFieldsToMetadata();
      this.#lastUpdated = new Date().toISOString();
    }
  }

  // Setter methods with validation
  set name(newName) {
    if (!newName || typeof newName !== 'string') {
      throw new Error('Thing name must be a non-empty string');
    }

    // Remove from name index with old name
    Thing.#indexByName.delete(this.#name.toLowerCase());

    this.#name = newName.trim();
    this.#lastUpdated = new Date().toISOString();

    // Add to name index with new name
    Thing.#indexByName.set(this.#name.toLowerCase(), this);
  }

  set description(newDescription) {
    if (!newDescription || typeof newDescription !== 'string') {
      throw new Error('Thing description must be a non-empty string');
    }

    this.#description = newDescription.trim();
    this.#lastUpdated = new Date().toISOString();
  }

  set thingType(newThingType) {
    if (!newThingType || typeof newThingType !== 'string') {
      throw new Error('Thing type must be a non-empty string');
    }

    if (!Thing.#validTypes.includes(newThingType.toLowerCase())) {
      throw new Error(`Thing type must be one of: ${Thing.#validTypes.join(', ')}`);
    }

    this.#thingType = newThingType.toLowerCase();
    this.#lastUpdated = new Date().toISOString();
  }

  set imageId(newImageId) {
    this.#imageId = newImageId;
    this.#lastUpdated = new Date().toISOString();
  }

  // Static methods for managing thing instances
  static getAll() {
    return Array.from(Thing.#indexByID.values());
  }

  static getById(id) {
    return Thing.#indexByID.get(id) || null;
  }

  static getByName(name) {
    return Thing.#indexByName.get(name.toLowerCase()) || null;
  }

  static getByType(thingType) {
    return Thing.getAll().filter(thing => thing.thingType === thingType.toLowerCase());
  }

  static getAllScenery() {
    return Thing.getByType('scenery');
  }

  static getAllItems() {
    return Thing.getByType('item');
  }

  static clear() {
    Thing.#indexByID.clear();
    Thing.#indexByName.clear();
  }

  static get validTypes() {
    return [...Thing.#validTypes];
  }

  // Instance methods
  delete() {
    Thing.#indexByID.delete(this.#id);
    Thing.#indexByName.delete(this.#name.toLowerCase());
  }

  // Serialization methods
  toJSON() {
    return {
      id: this.#id,
      name: this.#name,
      description: this.#description,
      thingType: this.#thingType,
      imageId: this.#imageId,
      createdAt: this.#createdAt,
      lastUpdated: this.#lastUpdated,
      rarity: this.#rarity,
      itemTypeDetail: this.#itemTypeDetail,
      slot: this.#slot || undefined,
      attributeBonuses: this.#attributeBonuses.length ? this.attributeBonuses : undefined,
      causeStatusEffect: this.#causeStatusEffect ? { ...this.#causeStatusEffect } : undefined,
      level: this.#level || undefined,
      relativeLevel: this.#relativeLevel || undefined,
      metadata: this.#metadata && Object.keys(this.#metadata).length ? { ...this.#metadata } : undefined,
      statusEffects: this.getStatusEffects()
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid data provided to Thing.fromJSON');
    }

    const thing = new Thing({
      id: data.id,
      name: data.name,
      description: data.description,
      thingType: data.thingType,
      imageId: data.imageId,
      rarity: data.rarity,
      itemTypeDetail: data.itemTypeDetail,
      metadata: data.metadata,
      statusEffects: Array.isArray(data.statusEffects) ? data.statusEffects : [],
      slot: data.slot ?? (data.metadata?.slot ?? null),
      attributeBonuses: data.attributeBonuses ?? data.metadata?.attributeBonuses ?? null,
      causeStatusEffect: data.causeStatusEffect ?? data.metadata?.causeStatusEffect ?? null,
      level: data.level ?? data.metadata?.level ?? null,
      relativeLevel: data.relativeLevel ?? data.metadata?.relativeLevel ?? null
    });

    if (data.createdAt && typeof data.createdAt === 'string') {
      thing.#createdAt = data.createdAt;
    }
    if (data.lastUpdated && typeof data.lastUpdated === 'string') {
      thing.#lastUpdated = data.lastUpdated;
    }

    return thing;
  }

  #sanitizeSlot(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const text = String(value).trim();
    if (!text || text.toLowerCase() === 'n/a') {
      return null;
    }
    return text;
  }

  #normalizeAttributeBonuses(rawBonuses) {
    if (!rawBonuses) {
      return [];
    }
    const entries = Array.isArray(rawBonuses) ? rawBonuses : [rawBonuses];
    const bonuses = [];
    for (const entry of entries) {
      if (!entry) continue;
      let attribute = null;
      let bonusValue = null;
      if (typeof entry === 'string') {
        attribute = entry.trim();
      } else if (typeof entry === 'object') {
        attribute = typeof entry.attribute === 'string' ? entry.attribute.trim() : null;
        const bonusRaw = 'bonus' in entry ? entry.bonus : entry.value;
        const parsedBonus = Number(bonusRaw);
        if (Number.isFinite(parsedBonus)) {
          bonusValue = Math.max(-20, Math.min(20, parsedBonus));
        }
      }

      if (!attribute) {
        continue;
      }

      if (!Number.isFinite(bonusValue)) {
        const parsed = Number(entry?.bonus ?? entry?.value);
        if (Number.isFinite(parsed)) {
          bonusValue = Math.max(-20, Math.min(20, parsed));
        }
      }

      bonuses.push({
        attribute,
        bonus: Number.isFinite(bonusValue) ? bonusValue : 0
      });
    }
    return bonuses;
  }

  #normalizeCauseStatusEffect(effect) {
    if (!effect || typeof effect !== 'object') {
      return null;
    }

    const name = typeof effect.name === 'string' ? effect.name.trim() : null;
    const description = typeof effect.description === 'string' ? effect.description.trim() : null;
    const duration = effect.duration !== undefined && effect.duration !== null
      ? String(effect.duration).trim()
      : null;

    if (!name && !description) {
      return null;
    }

    const normalized = {};
    if (name) normalized.name = name;
    if (description) normalized.description = description;
    if (duration && duration.toLowerCase() !== 'n/a') {
      normalized.duration = duration;
    }

    return Object.keys(normalized).length ? normalized : null;
  }

  #applyMetadataFieldsFromMetadata() {
    const meta = this.#metadata;

    this.#slot = this.#sanitizeSlot(meta.slot);

    const bonuses = this.#normalizeAttributeBonuses(meta.attributeBonuses);
    this.#attributeBonuses = bonuses;

    const effect = this.#normalizeCauseStatusEffect(meta.causeStatusEffect);
    this.#causeStatusEffect = effect;

    if (Number.isFinite(meta.level)) {
      this.#level = Math.max(1, Math.min(20, Math.round(meta.level)));
    } else if (this.#level === undefined) {
      this.#level = null;
    }

    if (Number.isFinite(meta.relativeLevel)) {
      this.#relativeLevel = Math.max(-20, Math.min(20, Math.round(meta.relativeLevel)));
    } else if (this.#relativeLevel === undefined) {
      this.#relativeLevel = null;
    }

    this.#syncFieldsToMetadata();
  }

  #syncFieldsToMetadata() {
    if (this.#slot) {
      this.#metadata.slot = this.#slot;
    } else {
      delete this.#metadata.slot;
    }

    if (this.#attributeBonuses && this.#attributeBonuses.length) {
      this.#metadata.attributeBonuses = this.#attributeBonuses.map(bonus => ({ ...bonus }));
    } else {
      delete this.#metadata.attributeBonuses;
    }

    if (this.#causeStatusEffect) {
      this.#metadata.causeStatusEffect = { ...this.#causeStatusEffect };
    } else {
      delete this.#metadata.causeStatusEffect;
    }

    if (Number.isFinite(this.#level)) {
      this.#metadata.level = this.#level;
    } else {
      delete this.#metadata.level;
    }

    if (Number.isFinite(this.#relativeLevel)) {
      this.#metadata.relativeLevel = this.#relativeLevel;
    } else {
      delete this.#metadata.relativeLevel;
    }
  }

  #normalizeStatusEffects(effects = []) {
    if (!Array.isArray(effects)) {
      return [];
    }

    const normalized = [];
    for (const entry of effects) {
      if (!entry) continue;

      if (typeof entry === 'string') {
        const description = entry.trim();
        if (!description) continue;
        normalized.push({ description, duration: 1 });
        continue;
      }

      if (typeof entry === 'object') {
        const descriptionValue = typeof entry.description === 'string'
          ? entry.description.trim()
          : (typeof entry.text === 'string' ? entry.text.trim() : (typeof entry.name === 'string' ? entry.name.trim() : ''));
        if (!descriptionValue) continue;
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

  whoseInventory() {
    const Player = require('./Player.js');
    return Player.getAll().filter(player => player.hasInventoryItem(this.#id));
  }

  static whoseInventoryById(thingId) {
    const thing = Thing.getById(thingId);
    if (!thing) {
      return [];
    }
    return thing.whoseInventory();
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
      const existingIndex = this.#statusEffects.findIndex(existing => existing.description.toLowerCase() === effect.description.toLowerCase());
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
    if (!this.#statusEffects.length) {
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
      retained.push({ description: effect.description, duration: effect.duration - 1 });
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

  // Remove this thing from all locations and inventories
  removeFromWorld() {
    const Player = require('./Player.js');
    const Location = require('./Location.js');

    for (const player of Player.getAll()) {
      if (player.hasEquippedThing(this.#id)) {
        player.unequipItemId(this.#id);
      }
      if (player.hasInventoryItem(this.#id)) {
        player.removeInventoryItem(this.#id);
      }
    }

    for (const location of Location.getAll()) {
      const thingIds = Array.isArray(location.thingIds) ? location.thingIds : (typeof location.thingIds === 'function' ? location.thingIds() : []);
      if (Array.isArray(thingIds) && thingIds.includes(this.#id) && typeof location.removeThingId === 'function') {
        location.removeThingId(this.#id);
      }
    }
  }

  static removeFromWorldById(thingId) {
    const thing = Thing.getById(thingId);
    if (thing) {
      thing.removeFromWorld();
    }
  }

  // Remove from all inventories and place in the current location
  drop() {
    console.log(`Dropping thing ${this.#name} (${this.#id}) from world`);
    // set locationId to the current location
    const equippedPlayer = this.equippedBy;
    if (equippedPlayer) {
      equippedPlayer.unequipItemId(this.#id);
    }

    const owners = this.whoseInventory();
    if (owners.length > 1) {
      console.warn(`Thing ${this.#name} (${this.#id}) is in multiple inventories (${owners.length}). Removing from all.`);
      console.trace();
    }

    if (count(owners) === 0) {
      console.warn(`Thing ${this.#name} (${this.#id}) is not in any inventory. Cannot determine location to drop into.`);
      console.trace();
      return;
    } else {
      for (const player of owners) {
        player.removeInventoryItem(this.#id);
      }
    }

    let locationId = owners[0].currentLocation;
    console.log("Current Location", owners[0].currentLocation);
    if (!locationId) {
      throw new Error(`Player ${owners[0].name} (${owners[0].id}) does not have a valid locationId`);
    }

    const Location = require('./Location.js');
    const location = Location.get(locationId);
    location.addThingId(this.#id);
  }

  static dropById(thingId) {
    const thing = Thing.getById(thingId);
    if (thing) {
      thing.drop();
    }
  }

  putInLocation(locationId) {
    const Location = require('./Location.js');
    const location = Location.get(locationId);
    if (!location) {
      throw new Error(`Location with ID ${locationId} does not exist`);
    }

    // location.addThingId calls removeFromWorld internally
    location.addThingId(this.#id);
  }

  static putInLocationById(thingId, locationId) {
    const thing = Thing.getById(thingId);
    if (thing) {
      thing.putInLocation(locationId);
    }
  }

  putInInventory(playerId) {
    const Player = require('./Player.js');
    const player = Player.getById(playerId);
    if (!player) {
      throw new Error(`Player with ID ${playerId} does not exist`);
    }

    // player.addToInventory calls removeFromWorld internally
    player.addToInventory(this.#id);
  }

  static putInInventoryById(thingId, playerId) {
    const thing = Thing.getById(thingId);
    if (thing) {
      thing.putInInventory(playerId);
    }
  }

  // Helper method to check if thing is a specific type
  isType(type) {
    return this.#thingType === type.toLowerCase();
  }

  isScenery() {
    return this.isType('scenery');
  }

  isItem() {
    return this.isType('item');
  }

  // String representation
  toString() {
    return `Thing(${this.#name}: ${this.#thingType})`;
  }
}

try {
  Thing.loadRarityDefinitions();
} catch (error) {
  console.warn(`Failed to initialize rarity definitions: ${error.message}`);
}

module.exports = Thing;
