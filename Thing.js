const crypto = require('crypto');

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

  // Valid thing types
  static #validTypes = ['scenery', 'item'];

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

module.exports = Thing;
