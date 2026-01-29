const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Utils = require('./Utils.js');
const Globals = require('./Globals.js');
const { count } = require('console');
const SanitizedStringMap = require('./SanitizedStringMap.js');
const SanitizedStringSet = require('./SanitizedStringSet.js');
const StatusEffect = require('./StatusEffect.js');

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
  #causeStatusEffect; // array of normalized cause status effect entries
  #enableStatusEffectEnrichment = true;
  #level;
  #relativeLevel;
  #flags = new SanitizedStringSet();
  #isEnrichingStatusEffects = false;
  #shortDescription;
  static #booleanFlagMap = Object.freeze({
    isVehicle: 'vehicle',
    isCraftingStation: 'crafting_station',
    isProcessingStation: 'processing_station',
    isHarvestable: 'harvestable',
    isSalvageable: 'salvageable'
  });
  static get booleanFlagMap() {
    return this.#booleanFlagMap;
  }
  static get booleanFlagKeys() {
    return Object.keys(this.#booleanFlagMap);
  }

  // Static indexing maps
  static #indexByID = new Map();
  static #indexByName = new SanitizedStringMap();

  // Rarity definitions loaded from defs/rarities.yaml
  static #rarityDefinitions = new Map();
  static #defaultRarityKey = null;

  // Valid thing types
  static #validTypes = ['scenery', 'item'];

  static #getLocationIdForThing(thing) {
    if (!thing) {
      return null;
    }
    const meta = thing.#metadata && typeof thing.#metadata === 'object' ? thing.#metadata : {};
    const candidates = [
      meta.locationId,
      meta.locationID,
      meta.location?.id,
      meta.location?.locationId,
      meta.location?.locationID
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }

    return null;
  }

  static #getPlayerIdForThing(thing) {
    if (!thing) {
      return null;
    }
    const meta = thing.#metadata && typeof thing.#metadata === 'object' ? thing.#metadata : {};
    const candidates = [
      meta.ownerId,
      meta.ownerID,
      meta.owner_id,
      meta.owner?.id,
      meta.owner?.ownerId,
      meta.playerId,
      meta.inventoryOwnerId
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }

    return null;
  }

  static #normalizeBooleanFlag(value) {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) {
        return null;
      }
      if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y' || normalized === 'on') {
        return true;
      }
      if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'n' || normalized === 'off') {
        return false;
      }
    }
    return Boolean(value);
  }

  static #normalizeNameIndexEntry(entry, name, index) {
    if (!entry) {
      throw new Error(`Invalid entry in Thing name index for "${name}" at position ${index}: entry is falsy`);
    }

    if (Array.isArray(entry)) {
      throw new Error(`Legacy entry detected in Thing name index for "${name}" at position ${index}`);
    }

    if (typeof entry !== 'object') {
      throw new Error(`Invalid entry in Thing name index for "${name}" at position ${index}: expected object`);
    }

    const { item } = entry;
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid Thing reference in name index for "${name}" at position ${index}`);
    }

    const normalizeId = (value, field) => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value !== 'string') {
        throw new Error(`Invalid ${field} in Thing name index for "${name}" at position ${index}: expected string`);
      }
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    };

    const normalizedLocationId = normalizeId(entry.locationId, 'locationId');
    const normalizedPlayerId = normalizeId(entry.playerId, 'playerId');

    return {
      ...entry,
      locationId: normalizedLocationId,
      playerId: normalizedPlayerId,
      item
    };
  }

  static #getNameBucket(name) {
    if (!name || typeof name !== 'string') {
      return null;
    }
    let bucket;
    try {
      bucket = Thing.#indexByName.get(name);
    } catch (_) {
      return null;
    }
    if (bucket === undefined) {
      return null;
    }
    if (!Array.isArray(bucket)) {
      throw new Error(`Thing name index for "${name}" is corrupted: expected array bucket`);
    }

    for (let index = bucket.length - 1; index >= 0; index -= 1) {
      const normalized = Thing.#normalizeNameIndexEntry(bucket[index], name, index);
      bucket[index] = normalized;
    }

    return bucket;
  }

  static #removeThingFromNameIndex(thing, nameOverride = null) {
    if (!thing) {
      return;
    }
    const key = typeof nameOverride === 'string' && nameOverride ? nameOverride : thing.#name;
    if (!key) {
      return;
    }
    const bucket = Thing.#getNameBucket(key);
    if (!bucket || !bucket.length) {
      return;
    }
    let removed = false;
    for (let index = bucket.length - 1; index >= 0; index -= 1) {
      const entry = bucket[index];
      if (entry && typeof entry === 'object' && entry.item === thing) {
        bucket.splice(index, 1);
        removed = true;
      }
    }
    if (removed && bucket.length === 0) {
      Thing.#indexByName.delete(key);
    }
  }

  static #addThingToNameIndex(thing) {
    if (!thing || !thing.#name) {
      return;
    }
    const key = thing.#name;
    const entry = {
      locationId: Thing.#getLocationIdForThing(thing),
      playerId: Thing.#getPlayerIdForThing(thing),
      item: thing
    };
    const bucket = Thing.#getNameBucket(key);
    if (bucket) {
      // Avoid duplicate references to the same thing
      if (!bucket.some(existing => existing && typeof existing === 'object' && existing.item === thing)) {
        bucket.push(entry);
      }
    } else {
      Thing.#indexByName.set(key, [entry]);
    }
  }

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
      attributeBonus: definition.attributeBonus,
      prevalence: definition.prevalence,
      description: definition.description,
      order: definition.order
    };
  }

  static getMaxAttributeBonus(rarity, level) {
    const effectiveLevel = Number.isFinite(level) && level > 0 ? level : 1;
    const rarityMultiplier = Thing.getRarityAttributeMultiplier(rarity);
    const rarityBonus = Thing.getRarityAttributeBonus(rarity);
    const effectiveMultiplier = Number.isFinite(rarityMultiplier) && rarityMultiplier > 0 ? rarityMultiplier : 1;
    const factor = 0.5 * effectiveMultiplier;
    const scaled = (4 + effectiveLevel) * factor + rarityBonus;
    const rounded = Utils.roundAwayFromZero(scaled);

    return rounded;
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
            attributeBonus: safeNumber(rawDefinition.attribute_bonus, 0),
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
        attributeBonus: 0,
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

  static getRarityAttributeBonus(rarity) {
    const definition = this.getRarityDefinition(rarity, { fallbackToDefault: true });
    return Number.isFinite(definition?.attributeBonus) ? definition.attributeBonus : 0;
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

    const bucket = Thing.#getNameBucket(name);
    return Array.isArray(bucket) && bucket.length > 0;
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
    shortDescription = null,
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
    relativeLevel = null,
    isVehicle = null,
    isCraftingStation = null,
    isProcessingStation = null,
    isHarvestable = null,
    isSalvageable = null,
    flags = new SanitizedStringSet(),
    enrichStatusEffects = true
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

    if (shortDescription !== null && shortDescription !== undefined && typeof shortDescription !== 'string') {
      throw new Error('Thing shortDescription must be a string or null');
    }

    // Initialize private fields
    this.#id = id || Thing.#generateId();
    this.#name = Utils.capitalizeProperNoun(name.trim());
    this.#description = description.trim();
    this.#thingType = thingType.toLowerCase();
    this.#imageId = imageId;
    this.#rarity = typeof rarity === 'string' ? rarity.trim() : null;
    this.#itemTypeDetail = typeof itemTypeDetail === 'string' ? itemTypeDetail.trim() : null;
    this.#metadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};
    const normalizedShortDescription = typeof shortDescription === 'string' ? shortDescription.trim() : null;
    const metadataShortDescription = normalizedShortDescription === null && typeof this.#metadata.shortDescription === 'string'
      ? this.#metadata.shortDescription.trim()
      : null;
    this.#shortDescription = normalizedShortDescription ?? metadataShortDescription ?? '';
    this.#createdAt = new Date().toISOString();
    this.#lastUpdated = this.#createdAt;
    this.#statusEffects = this.#normalizeStatusEffects(statusEffects);
    this.#slot = null;
    this.#attributeBonuses = [];
    this.#causeStatusEffect = [];
    this.#enableStatusEffectEnrichment = enrichStatusEffects !== false;
    this.#level = Number.isFinite(level) ? Math.max(1, Math.round(level)) : null;
    this.#relativeLevel = Number.isFinite(relativeLevel) ? Math.max(-20, Math.min(20, Math.round(relativeLevel))) : null;
    this.#flags = flags instanceof SanitizedStringSet ? flags : new SanitizedStringSet(flags);
    this.isVehicle = isVehicle;
    this.isCraftingStation = isCraftingStation;
    this.isProcessingStation = isProcessingStation;
    this.isHarvestable = isHarvestable;
    this.isSalvageable = isSalvageable;

    this.#applyMetadataFieldsFromMetadata();

    if (slot !== null && slot !== undefined) {
      this.slot = slot;
    }
    if (attributeBonuses !== null && attributeBonuses !== undefined) {
      this.attributeBonuses = attributeBonuses;
    }
    if (causeStatusEffect !== null && causeStatusEffect !== undefined) {
      this.#ingestCauseStatusEffects(causeStatusEffect);
    }
    if (Number.isFinite(level)) {
      this.level = level;
    }
    if (Number.isFinite(relativeLevel)) {
      this.relativeLevel = relativeLevel;
    }
    this.#syncFieldsToMetadata();
    this.#triggerStatusEffectEnrichment();

    // Add to static indexes
    Thing.#indexByID.set(this.#id, this);
    Thing.#addThingToNameIndex(this);
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

  get shortDescription() {
    return this.#shortDescription;
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

  get isVehicle() {
    return this.#flags.has(Thing.#booleanFlagMap.isVehicle);
  }
  set isVehicle(value) {
    const normalized = Thing.#normalizeBooleanFlag(value);
    const enabled = normalized === null ? false : normalized;
    this.#setBooleanFlag(Thing.#booleanFlagMap.isVehicle, enabled, 'isVehicle');
  }

  get isCraftingStation() {
    return this.#flags.has(Thing.#booleanFlagMap.isCraftingStation);
  }
  set isCraftingStation(value) {
    const normalized = Thing.#normalizeBooleanFlag(value);
    const enabled = normalized === null ? false : normalized;
    this.#setBooleanFlag(Thing.#booleanFlagMap.isCraftingStation, enabled, 'isCraftingStation');
  }

  get isProcessingStation() {
    return this.#flags.has(Thing.#booleanFlagMap.isProcessingStation);
  }
  set isProcessingStation(value) {
    const normalized = Thing.#normalizeBooleanFlag(value);
    const enabled = normalized === null ? false : normalized;
    this.#setBooleanFlag(Thing.#booleanFlagMap.isProcessingStation, enabled, 'isProcessingStation');
  }

  get isHarvestable() {
    return this.#flags.has(Thing.#booleanFlagMap.isHarvestable);
  }
  set isHarvestable(value) {
    const normalized = Thing.#normalizeBooleanFlag(value);
    const enabled = normalized === null ? false : normalized;
    this.#setBooleanFlag(Thing.#booleanFlagMap.isHarvestable, enabled, 'isHarvestable');
  }

  get isSalvageable() {
    return this.#flags.has(Thing.#booleanFlagMap.isSalvageable);
  }
  set isSalvageable(value) {
    const normalized = Thing.#normalizeBooleanFlag(value);
    const enabled = normalized === null ? false : normalized;
    this.#setBooleanFlag(Thing.#booleanFlagMap.isSalvageable, enabled, 'isSalvageable');
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

  #setBooleanFlag(flagName, enabled, metadataKey) {
    this.setFlag(flagName, enabled);
    if (metadataKey) {
      if (enabled) {
        this.#metadata[metadataKey] = true;
      } else {
        delete this.#metadata[metadataKey];
      }
    }
  }

  get metadata() {
    return { ...this.#metadata };
  }

  set metadata(newMetadata) {
    Thing.#removeThingFromNameIndex(this, this.#name);
    this.#metadata = newMetadata && typeof newMetadata === 'object' ? { ...newMetadata } : {};
    this.#applyMetadataFieldsFromMetadata();
    this.#lastUpdated = new Date().toISOString();
    Thing.#addThingToNameIndex(this);
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

  hasFlag(flag) {
    if (typeof flag !== 'string') {
      throw new TypeError('Flag name must be a string.');
    }
    const trimmed = flag.trim();
    if (!trimmed) {
      throw new Error('Flag name cannot be empty.');
    }
    return this.#flags.has(trimmed);
  }

  setFlag(flag, enabled = true) {
    if (typeof flag !== 'string') {
      throw new TypeError('Flag name must be a string.');
    }
    const trimmed = flag.trim();
    if (!trimmed) {
      throw new Error('Flag name cannot be empty.');
    }
    if (typeof enabled !== 'boolean') {
      throw new TypeError('Flag value must be a boolean.');
    }

    if (enabled) {
      this.#flags.add(trimmed);
    } else {
      this.#flags.delete(trimmed);
    }

    this.#lastUpdated = new Date().toISOString();
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
    if (!Array.isArray(this.#causeStatusEffect) || !this.#causeStatusEffect.length) {
      return null;
    }
    if (this.#causeStatusEffect.length === 1) {
      const entry = this.#causeStatusEffect[0];
      return {
        ...entry.effect.toJSON(),
        applyToTarget: Boolean(entry.applyToTarget),
        applyToEquipper: Boolean(entry.applyToEquipper)
      };
    }
    const first = this.#causeStatusEffect[0];
    const baseKey = (first.effect.description || first.effect.name || '').toLowerCase();
    const allSame = this.#causeStatusEffect.every(e => (e.effect.description || e.effect.name || '').toLowerCase() === baseKey);
    if (!allSame) {
      return null;
    }
    const combined = {
      ...first.effect.toJSON(),
      applyToTarget: false,
      applyToEquipper: false
    };
    this.#causeStatusEffect.forEach(entry => {
      if (entry.applyToTarget) combined.applyToTarget = true;
      if (entry.applyToEquipper) combined.applyToEquipper = true;
    });
    return combined;
  }

  set causeStatusEffect(effect) {
    this.#causeStatusEffect = [];
    if (Array.isArray(effect)) {
      effect.forEach(entry => {
        const applyToTarget = Boolean(entry?.applyToTarget);
        const applyToEquipper = Boolean(entry?.applyToEquipper);
        const normalized = this.#normalizeCauseStatusEffectEntry(entry, { applyToTarget, applyToEquipper });
        this.#upsertCauseStatusEffectEntry(normalized);
      });
    } else if (effect) {
      const applyToTarget = Boolean(effect.applyToTarget);
      const applyToEquipper = Boolean(effect.applyToEquipper);
      const normalized = this.#normalizeCauseStatusEffectEntry(effect, { applyToTarget, applyToEquipper });
      this.#upsertCauseStatusEffectEntry(normalized);
    }
    this.#syncFieldsToMetadata();
    this.#lastUpdated = new Date().toISOString();
    this.#triggerStatusEffectEnrichment();
  }

  get level() {
    return this.#level;
  }

  set level(value) {
    if (Number.isFinite(value)) {
      const clamped = Math.max(1, Math.round(value));
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

  get causeStatusEffectOnTarget() {
    const entry = this.#getCauseStatusEffectEntry('target');
    return entry ? entry.effect.toJSON() : null;
  }

  get causeStatusEffectOnEquipper() {
    const entry = this.#getCauseStatusEffectEntry('equipper');
    return entry ? entry.effect.toJSON() : null;
  }

  setCauseStatusEffects({ target = null, equipper = null, legacy = null } = {}) {
    this.#causeStatusEffect = [];
    const targetEntry = this.#normalizeCauseStatusEffectEntry(target, { applyToTarget: true });
    const equipperEntry = this.#normalizeCauseStatusEffectEntry(equipper, { applyToEquipper: true });
    const legacyEntry = this.#normalizeCauseStatusEffectEntry(legacy, {
      applyToTarget: Boolean(legacy?.applyToTarget),
      applyToEquipper: Boolean(legacy?.applyToEquipper)
    });
    this.#upsertCauseStatusEffectEntry(targetEntry);
    this.#upsertCauseStatusEffectEntry(equipperEntry);
    this.#upsertCauseStatusEffectEntry(legacyEntry);
    this.#syncFieldsToMetadata();
    this.#lastUpdated = new Date().toISOString();
  }

  #triggerStatusEffectEnrichment() {
    if (!this.#enableStatusEffectEnrichment) {
      return;
    }
    if (this.#isEnrichingStatusEffects) {
      return;
    }
    this.#isEnrichingStatusEffects = true;
    this.#enrichStatusEffectsUsingGlobals()
      .catch(error => {
        console.warn('Failed to enrich status effects for thing:', error?.message || error);
      })
      .finally(() => {
        this.#isEnrichingStatusEffects = false;
      });
  }

  async #enrichStatusEffectsUsingGlobals() {
    let promptEnv = null;
    let parseXMLTemplate = null;
    let prepareBasePromptContext = null;
    try {
      promptEnv = typeof Globals.getPromptEnv === 'function' ? Globals.getPromptEnv() : null;
    } catch (error) {
      return;
    }
    try {
      parseXMLTemplate = typeof Globals.parseXMLTemplate === 'function' ? Globals.parseXMLTemplate : null;
    } catch (_) {
      return;
    }
    try {
      prepareBasePromptContext = typeof Globals.getBasePromptContext === 'function' ? Globals.getBasePromptContext : null;
    } catch (_) {
      return;
    }

    if (!promptEnv || typeof promptEnv.render !== 'function' || typeof parseXMLTemplate !== 'function' || typeof prepareBasePromptContext !== 'function') {
      return;
    }

    const seeds = [];
    const seen = new Set();
    const itemLevel = Number.isFinite(this.#level) ? this.#level : null;

    const addSeed = (effect) => {
      if (!effect) return;
      const description = effect.description || effect.name;
      if (!description) return;
      const key = description.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      seeds.push({ name: effect.name || null, description, level: itemLevel });
    };

    addSeed(this.causeStatusEffectOnTarget);
    addSeed(this.causeStatusEffectOnEquipper);
    const combinedCause = this.causeStatusEffect;
    if (combinedCause) addSeed(combinedCause);
    if (Array.isArray(this.#statusEffects)) {
      this.#statusEffects.forEach(addSeed);
    }

    if (!seeds.length) {
      return;
    }

    const generatedMap = await StatusEffect.generateFromDescriptions(seeds, {
      promptEnv,
      parseXMLTemplate,
      prepareBasePromptContext
    });
    if (!(generatedMap instanceof Map)) {
      return;
    }

    const applyGenerated = (effect) => {
      if (!effect) return effect;
      const key = effect.description || effect.name;
      if (!key) return effect;
      const generated = generatedMap.get(key);
      if (!generated) return effect;
      const attributes = Array.isArray(generated.attributes) && generated.attributes.length
        ? generated.attributes
        : (Array.isArray(effect.attributes) ? effect.attributes : []);
      const skills = Array.isArray(generated.skills) && generated.skills.length
        ? generated.skills
        : (Array.isArray(effect.skills) ? effect.skills : []);
      const needBars = Array.isArray(generated.needBars) && generated.needBars.length
        ? generated.needBars
        : (Array.isArray(effect.needBars) ? effect.needBars : []);
      return {
        name: generated.name || effect.name || null,
        description: generated.description || effect.description || null,
        duration: effect.duration ?? generated.duration ?? null,
        attributes,
        skills,
        needBars
      };
    };

    const updatedCauseEntries = [];
    const targetEffect = applyGenerated(this.causeStatusEffectOnTarget);
    if (targetEffect) {
      updatedCauseEntries.push({ ...targetEffect, applyToTarget: true });
    }
    const equipperEffect = applyGenerated(this.causeStatusEffectOnEquipper);
    if (equipperEffect) {
      updatedCauseEntries.push({ ...equipperEffect, applyToEquipper: true });
    }
    if (updatedCauseEntries.length) {
      this.causeStatusEffect = updatedCauseEntries;
    }

    if (Array.isArray(this.#statusEffects) && this.#statusEffects.length) {
      const updated = this.#statusEffects.map(applyGenerated);
      this.setStatusEffects(updated);
    }
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
    Thing.#removeThingFromNameIndex(this, this.#name);

    this.#name = Utils.capitalizeProperNoun(newName.trim());
    this.#lastUpdated = new Date().toISOString();

    // Add to name index with new name
    Thing.#addThingToNameIndex(this);
  }

  set description(newDescription) {
    if (!newDescription || typeof newDescription !== 'string') {
      throw new Error('Thing description must be a non-empty string');
    }

    this.#description = newDescription.trim();
    this.#lastUpdated = new Date().toISOString();
  }

  set shortDescription(newShortDescription) {
    if (newShortDescription === null || newShortDescription === undefined) {
      this.#shortDescription = '';
      this.#lastUpdated = new Date().toISOString();
      return;
    }
    if (typeof newShortDescription !== 'string') {
      throw new Error('Thing shortDescription must be a string or null');
    }
    this.#shortDescription = newShortDescription.trim();
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
    const bucket = Thing.#getNameBucket(name);
    if (!bucket || bucket.length === 0) {
      return null;
    }

    if (bucket.length === 1) {
      return bucket[0]?.item || null;
    }

    const currentLocation = Globals?.location || null;
    const currentLocationId = currentLocation && typeof currentLocation.id === 'string'
      ? currentLocation.id
      : null;

    if (currentLocationId) {
      const inCurrentLocation = bucket.find(entry => entry.locationId === currentLocationId);
      if (inCurrentLocation?.item) {
        return inCurrentLocation.item;
      }
    }

    if (currentLocationId) {
      let PlayerModule = null;
      try {
        PlayerModule = require('./Player.js');
      } catch (_) {
        PlayerModule = null;
      }

      if (PlayerModule && typeof PlayerModule.getById === 'function') {
        for (const entry of bucket) {
          if (!entry?.playerId || !entry.item) {
            continue;
          }
          let owner = null;
          try {
            owner = PlayerModule.getById(entry.playerId);
          } catch (_) {
            owner = null;
          }
          if (!owner) {
            continue;
          }
          const ownerLocationId = typeof owner.currentLocation === 'string'
            ? owner.currentLocation.trim()
            : null;
          if (ownerLocationId && ownerLocationId === currentLocationId) {
            return entry.item;
          }
        }
      }
    }

    const currentRegion = Globals?.region || null;
    const currentRegionId = currentRegion && typeof currentRegion.id === 'string'
      ? currentRegion.id
      : null;

    if (currentRegionId) {
      let LocationModule = null;
      try {
        LocationModule = require('./Location.js');
      } catch (_) {
        LocationModule = null;
      }

      if (LocationModule && typeof LocationModule.get === 'function') {
        for (const entry of bucket) {
          const { locationId, item } = entry || {};
          if (!locationId || !item) {
            continue;
          }
          let location = null;
          try {
            location = LocationModule.get(locationId);
          } catch (_) {
            location = null;
          }
          if (!location) {
            continue;
          }
          const locationRegionId = location.regionId
            || (location.stubMetadata && location.stubMetadata.regionId)
            || null;
          if (locationRegionId === currentRegionId) {
            return item;
          }
        }
      }
    }

    const nullLocationEntry = bucket.find(entry => entry && entry.locationId === null && entry.item);
    if (nullLocationEntry?.item) {
      return nullLocationEntry.item;
    }

    return bucket[0]?.item || null;
  }

  static getAllByName(name) {
    const bucket = Thing.#getNameBucket(name);
    if (!bucket || !bucket.length) {
      return [];
    }
    return bucket
      .map(entry => (entry && typeof entry === 'object' ? entry.item : null))
      .filter(Boolean);
  }

  static getByNameAndLocation(name, location) {
    if (!name || typeof name !== 'string' || !location) {
      return null;
    }
    const bucket = Thing.#getNameBucket(name);
    if (!bucket || !bucket.length) {
      return null;
    }

    const findInBucket = (candidateId) => {
      if (!candidateId || typeof candidateId !== 'string') {
        return null;
      }
      const normalized = candidateId.trim();
      if (!normalized) {
        return null;
      }
      const target = bucket.find(entry => entry && entry.locationId === normalized);
      return target?.item || null;
    };

    if (typeof location === 'object' && location !== null) {
      const candidateId = typeof location.id === 'string' ? location.id.trim() : null;
      return findInBucket(candidateId);
    }

    if (typeof location === 'string') {
      const trimmed = location.trim();
      if (!trimmed) {
        return null;
      }

      const direct = findInBucket(trimmed);
      if (direct) {
        return direct;
      }

      try {
        const Location = require('./Location.js');
        const locationObj = typeof Location.getByName === 'function'
          ? Location.getByName(trimmed)
          : null;
        if (locationObj && typeof locationObj.id === 'string') {
          return findInBucket(locationObj.id);
        }
      } catch (_) {
        // Ignore lookup failures
      }
    }
    return null;
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
    this.removeFromWorld();
    Thing.#indexByID.delete(this.#id);
    Thing.#removeThingFromNameIndex(this, this.#name);
  }

  // Serialization methods
  toJSON() {
    const normalizeBoolean = value => (value === null || value === undefined ? undefined : Boolean(value));
    return {
      id: this.#id,
      name: this.#name,
      description: this.#description,
      shortDescription: this.#shortDescription || undefined,
      thingType: this.#thingType,
      imageId: this.#imageId,
      createdAt: this.#createdAt,
      lastUpdated: this.#lastUpdated,
      rarity: this.#rarity,
      itemTypeDetail: this.#itemTypeDetail,
      slot: this.#slot || undefined,
      attributeBonuses: this.#attributeBonuses.length ? this.attributeBonuses : undefined,
      causeStatusEffectOnTarget: (() => {
        const entry = this.#getCauseStatusEffectEntry('target');
        return entry ? entry.effect.toJSON() : undefined;
      })(),
      causeStatusEffectOnEquipper: (() => {
        const entry = this.#getCauseStatusEffectEntry('equipper');
        return entry ? entry.effect.toJSON() : undefined;
      })(),
      causeStatusEffect: this.causeStatusEffect,
      level: this.#level || undefined,
      relativeLevel: this.#relativeLevel || undefined,
      isVehicle: normalizeBoolean(this.isVehicle),
      isCraftingStation: normalizeBoolean(this.isCraftingStation),
      isProcessingStation: normalizeBoolean(this.isProcessingStation),
      isHarvestable: normalizeBoolean(this.isHarvestable),
      isSalvageable: normalizeBoolean(this.isSalvageable),
      flags: this.#flags && this.#flags.size ? Array.from(this.#flags) : undefined,
      metadata: this.#metadata && Object.keys(this.#metadata).length ? { ...this.#metadata } : undefined,
      statusEffects: this.getStatusEffects()
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid data provided to Thing.fromJSON');
    }

    const booleanFlagKeys = ['isVehicle', 'isCraftingStation', 'isProcessingStation', 'isHarvestable', 'isSalvageable'];
    const booleanFlagOptions = {};
    for (const key of booleanFlagKeys) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        booleanFlagOptions[key] = data[key];
      } else if (data.metadata && Object.prototype.hasOwnProperty.call(data.metadata, key)) {
        booleanFlagOptions[key] = data.metadata[key];
      }
    }

    const thing = new Thing({
      id: data.id,
      name: data.name,
      description: data.description,
      shortDescription: data.shortDescription ?? data.metadata?.shortDescription ?? null,
      thingType: data.thingType,
      imageId: data.imageId,
      rarity: data.rarity,
      itemTypeDetail: data.itemTypeDetail,
      metadata: data.metadata,
      statusEffects: Array.isArray(data.statusEffects) ? data.statusEffects : [],
      slot: data.slot ?? (data.metadata?.slot ?? null),
      attributeBonuses: data.attributeBonuses ?? data.metadata?.attributeBonuses ?? null,
      causeStatusEffect: (function resolveCauseStatusEffect() {
        const target = data.causeStatusEffectOnTarget ?? data.metadata?.causeStatusEffectOnTarget;
        const equipper = data.causeStatusEffectOnEquipper ?? data.metadata?.causeStatusEffectOnEquipper;
        const legacy = data.causeStatusEffect ?? data.metadata?.causeStatusEffect ?? null;
        const entries = [];
        if (target) {
          entries.push({ ...target, applyToTarget: true });
        }
        if (equipper) {
          entries.push({ ...equipper, applyToEquipper: true });
        }
        if (legacy && !entries.length) {
          entries.push(legacy);
        }
        return entries.length ? entries : null;
      }()),
      level: data.level ?? data.metadata?.level ?? null,
      relativeLevel: data.relativeLevel ?? data.metadata?.relativeLevel ?? null,
      flags: Array.isArray(data.flags) ? data.flags : (Array.isArray(data.metadata?.flags) ? data.metadata.flags : []),
      ...booleanFlagOptions,
      enrichStatusEffects: false
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
          bonusValue = parsedBonus;
        }
      }

      if (!attribute) {
        continue;
      }

      if (!Number.isFinite(bonusValue)) {
        const parsed = Number(entry?.bonus ?? entry?.value);
        if (Number.isFinite(parsed)) {
          bonusValue = parsed;
        }
      }

      bonuses.push({
        attribute,
        bonus: Number.isFinite(bonusValue) ? bonusValue : 0
      });
    }
    return bonuses;
  }

  #normalizeCauseStatusEffectEntry(effect, { applyToTarget = false, applyToEquipper = false } = {}) {
    if (!effect || typeof effect !== 'object') {
      return null;
    }

    const name = typeof effect.name === 'string' ? effect.name.trim() : null;
    const descriptionRaw = typeof effect.description === 'string' ? effect.description.trim() : null;
    const description = descriptionRaw || name;
    if (!description) {
      return null;
    }

    const attributes = Array.isArray(effect.attributes) ? effect.attributes : undefined;
    const skills = Array.isArray(effect.skills) ? effect.skills : undefined;
    const needBars = Array.isArray(effect.needBars) ? effect.needBars : undefined;
    const duration = effect.duration !== undefined ? effect.duration : null;

    const statusEffect = new StatusEffect({
      name,
      description,
      attributes,
      skills,
      needBars,
      duration
    });

    const entry = {
      effect: statusEffect,
      applyToTarget: Boolean(applyToTarget),
      applyToEquipper: Boolean(applyToEquipper)
    };

    if (!entry.applyToTarget && !entry.applyToEquipper) {
      entry.applyToTarget = true;
    }
    return entry;
  }

  #upsertCauseStatusEffectEntry(entry) {
    if (!entry || !entry.effect) {
      return;
    }
    if (!Array.isArray(this.#causeStatusEffect)) {
      this.#causeStatusEffect = [];
    }
    const key = (entry.effect.description || entry.effect.name || '').trim().toLowerCase();
    const existingIndex = this.#causeStatusEffect.findIndex(e =>
      (e?.effect?.description || e?.effect?.name || '').trim().toLowerCase() === key
    );
    if (existingIndex >= 0) {
      const existing = this.#causeStatusEffect[existingIndex];
      this.#causeStatusEffect[existingIndex] = {
        effect: entry.effect,
        applyToTarget: Boolean(existing.applyToTarget || entry.applyToTarget),
        applyToEquipper: Boolean(existing.applyToEquipper || entry.applyToEquipper)
      };
    } else {
      this.#causeStatusEffect.push(entry);
    }
  }

  #getCauseStatusEffectEntry(targetType = null) {
    if (!Array.isArray(this.#causeStatusEffect) || !this.#causeStatusEffect.length) {
      return null;
    }
    if (!targetType) {
      return this.#causeStatusEffect[0] || null;
    }
    if (targetType === 'target') {
      return this.#causeStatusEffect.find(entry => entry.applyToTarget) || null;
    }
    if (targetType === 'equipper') {
      return this.#causeStatusEffect.find(entry => entry.applyToEquipper) || null;
    }
    return null;
  }

  #ingestCauseStatusEffects(effects) {
    if (!effects) {
      return;
    }
    if (Array.isArray(effects)) {
      effects.forEach(entry => {
        const applyToTarget = Boolean(entry?.applyToTarget);
        const applyToEquipper = Boolean(entry?.applyToEquipper);
        const normalized = this.#normalizeCauseStatusEffectEntry(entry, { applyToTarget, applyToEquipper });
        this.#upsertCauseStatusEffectEntry(normalized);
      });
      return;
    }
    const applyToTarget = Boolean(effects.applyToTarget);
    const applyToEquipper = Boolean(effects.applyToEquipper);
    const normalized = this.#normalizeCauseStatusEffectEntry(effects, { applyToTarget, applyToEquipper });
    this.#upsertCauseStatusEffectEntry(normalized);
  }

  #applyMetadataFieldsFromMetadata() {
    const meta = this.#metadata;

    this.#slot = this.#sanitizeSlot(meta.slot);
    if (typeof meta.shortDescription === 'string') {
      this.#shortDescription = meta.shortDescription.trim();
    }

    const bonuses = this.#normalizeAttributeBonuses(meta.attributeBonuses);
    this.#attributeBonuses = bonuses;

    this.#causeStatusEffect = [];
    const effectTarget = this.#normalizeCauseStatusEffectEntry(meta.causeStatusEffectOnTarget, { applyToTarget: true });
    const effectEquipper = this.#normalizeCauseStatusEffectEntry(meta.causeStatusEffectOnEquipper, { applyToEquipper: true });
    const legacyEffect = this.#normalizeCauseStatusEffectEntry(meta.causeStatusEffect, {
      applyToTarget: Boolean(meta?.causeStatusEffect?.applyToTarget),
      applyToEquipper: Boolean(meta?.causeStatusEffect?.applyToEquipper)
    });
    this.#upsertCauseStatusEffectEntry(effectTarget);
    this.#upsertCauseStatusEffectEntry(effectEquipper);
    this.#upsertCauseStatusEffectEntry(legacyEffect);

    const metadataFlags = Array.isArray(meta.flags) ? meta.flags : [];
    if (metadataFlags.length) {
      const mergedFlags = new SanitizedStringSet();
      for (const existing of this.#flags) {
        mergedFlags.add(existing);
      }
      for (const entry of metadataFlags) {
        mergedFlags.add(entry);
      }
      this.#flags = mergedFlags;
    }

    if (Number.isFinite(meta.level)) {
      this.#level = Math.max(1, Math.round(meta.level));
    } else if (this.#level === undefined) {
      this.#level = null;
    }

    if (Number.isFinite(meta.relativeLevel)) {
      this.#relativeLevel = Math.max(-20, Math.min(20, Math.round(meta.relativeLevel)));
    } else if (this.#relativeLevel === undefined) {
      this.#relativeLevel = null;
    }

    if (meta.isVehicle !== undefined) {
      this.isVehicle = Thing.#normalizeBooleanFlag(meta.isVehicle);
    }
    if (meta.isCraftingStation !== undefined) {
      this.isCraftingStation = Thing.#normalizeBooleanFlag(meta.isCraftingStation);
    }
    if (meta.isProcessingStation !== undefined) {
      this.isProcessingStation = Thing.#normalizeBooleanFlag(meta.isProcessingStation);
    }
    if (meta.isHarvestable !== undefined) {
      this.isHarvestable = meta.isHarvestable;
    }
    if (meta.isSalvageable !== undefined) {
      this.isSalvageable = meta.isSalvageable;
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

    const targetEntry = this.#getCauseStatusEffectEntry('target');
    const equipperEntry = this.#getCauseStatusEffectEntry('equipper');
    if (targetEntry) {
      this.#metadata.causeStatusEffectOnTarget = targetEntry.effect.toJSON();
    } else {
      delete this.#metadata.causeStatusEffectOnTarget;
    }
    if (equipperEntry) {
      this.#metadata.causeStatusEffectOnEquipper = equipperEntry.effect.toJSON();
    } else {
      delete this.#metadata.causeStatusEffectOnEquipper;
    }
    delete this.#metadata.causeStatusEffect;

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

    // Boolean flags: persist when true, default to false when absent.
    this.isVehicle = this.isVehicle;
    this.isCraftingStation = this.isCraftingStation;
    this.isProcessingStation = this.isProcessingStation;
    this.isHarvestable = this.isHarvestable;
    this.isSalvageable = this.isSalvageable;
  }

  #normalizeStatusEffects(effects = []) {
    if (!Array.isArray(effects)) {
      return [];
    }

    const normalized = [];
    for (const entry of effects) {
      if (!entry) continue;

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

      if (typeof entry === 'object') {
        const descriptionValue = typeof entry.description === 'string'
          ? entry.description.trim()
          : (typeof entry.text === 'string' ? entry.text.trim() : (typeof entry.name === 'string' ? entry.name.trim() : ''));
        if (!descriptionValue) {
          throw new Error('Status effect entry is missing a description');
        }
        const attributes = Array.isArray(entry.attributes) ? entry.attributes : undefined;
        const skills = Array.isArray(entry.skills) ? entry.skills : undefined;
        const duration = entry.duration !== undefined ? entry.duration : null;
        const name = typeof entry.name === 'string' ? entry.name : undefined;

        normalized.push(new StatusEffect({
          name,
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
    return this.#statusEffects.map(effect => effect.toJSON());
  }

  setStatusEffects(effects = []) {
    this.#statusEffects = this.#normalizeStatusEffects(effects);
    this.#lastUpdated = new Date().toISOString();
    this.#triggerStatusEffectEnrichment();
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
      this.#triggerStatusEffectEnrichment();
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
  drop(locationIdOverride = null) {
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
      if (!locationIdOverride) {
        console.warn(`Thing ${this.#name} (${this.#id}) is not in any inventory. Cannot determine location to drop into.`);
        console.trace();
        return;
      }
    } else {
      for (const player of owners) {
        player.removeInventoryItem(this.#id);
      }
    }

    let locationId = locationIdOverride;
    if (!locationId) {
      try {
        locationId = owners[0].location.id;
      } catch (error) {
        console.error(`Failed to get location ID for player ${owners[0].name} (${owners[0].id}): ${error.message}`);
        console.trace();
      }
      console.log("Current Location", owners[0].location);
    }
    if (!locationId) {
      throw new Error(`Unable to resolve location to drop ${this.#name} (${this.#id})`);
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

  static getAllByLocationId(locationId) {
    const Location = require('./Location.js');
    const location = Location.get(locationId);
    if (!location) {
      console.warn(`Location with ID ${locationId} does not exist`);
      console.trace();
      return [];
    }

    const thingIds = Array.isArray(location.thingIds) ? location.thingIds : (typeof location.thingIds === 'function' ? location.thingIds() : []);
    const things = [];
    for (const thingId of thingIds) {
      const thing = Thing.getById(thingId);
      if (thing) {
        things.push(thing);
      }
    }
    return things;
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
