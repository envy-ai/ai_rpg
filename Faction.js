const IdGenerator = require('./IdGenerator.js');
const { normalizeFavorList, cloneFavor } = require('./FactionFavor.js');

class Faction {
  #id;
  #name;
  #tags;
  #goals;
  #description;
  #shortDescription;
  #violenceLevel;
  #homeRegionName;
  #relations;
  #assets;
  #reputationTiers;
  #favors;
  #imageId;
  #imagePrompt;
  #createdAt;
  #lastUpdated;

  static #indexById = new Map();
  static #indexByName = new Map();
  static #validRelations = new Set(['allied', 'neutral', 'hostile', 'rival']);

  static #generateId(name) {
    return IdGenerator.next('faction', name);
  }

  static #normalizeStringList(value) {
    const entries = Array.isArray(value)
      ? value
      : (typeof value === 'string' ? value.split(/\r?\n/) : []);

    return entries
      .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(entry => entry.length > 0);
  }

  static #normalizeOptionalText(value, label) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== 'string') {
      throw new Error(`${label} must be a non-empty string or null.`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`${label} must be a non-empty string or null.`);
    }
    return trimmed;
  }

  static #normalizeViolenceLevel(value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
      throw new Error('Faction violenceLevel must be an integer from 1 to 5.');
    }
    return value;
  }

  static #normalizeRelationEntry(value) {
    if (!value || typeof value !== 'object') {
      throw new Error('Faction relation must be an object with status and notes.');
    }
    const status = typeof value.status === 'string' ? value.status.trim().toLowerCase() : '';
    if (!status) {
      throw new Error('Faction relation status must be a non-empty string.');
    }
    if (!Faction.#validRelations.has(status)) {
      throw new Error(`Invalid faction relation "${value.status}". Expected allied, neutral, hostile, or rival.`);
    }
    const notes = typeof value.notes === 'string' ? value.notes.trim() : '';
    if (!notes) {
      throw new Error('Faction relation notes must be a non-empty string.');
    }
    return { status, notes };
  }

  static #normalizeRelations(relations) {
    if (!relations) {
      return new Map();
    }

    const map = new Map();

    if (relations instanceof Map) {
      for (const [key, value] of relations.entries()) {
        if (typeof key !== 'string' || !key.trim()) {
          throw new Error('Faction relations map keys must be non-empty strings.');
        }
        const normalizedKey = key.trim();
        map.set(normalizedKey, Faction.#normalizeRelationEntry(value));
      }
      return map;
    }

    if (typeof relations !== 'object') {
      throw new Error('Faction relations must be an object or Map.');
    }

    for (const [key, value] of Object.entries(relations)) {
      if (!key || typeof key !== 'string') {
        throw new Error('Faction relations keys must be non-empty strings.');
      }
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        throw new Error('Faction relations keys must be non-empty strings.');
      }
      map.set(normalizedKey, Faction.#normalizeRelationEntry(value));
    }

    return map;
  }

  static #normalizeAssets(assets) {
    if (!assets) {
      return [];
    }
    if (!Array.isArray(assets)) {
      throw new Error('Faction assets must be an array.');
    }

    return assets.map((asset, index) => {
      if (typeof asset === 'string') {
        const trimmed = asset.trim();
        if (!trimmed) {
          throw new Error('Faction asset names must be non-empty strings.');
        }
        return { name: trimmed };
      }
      if (!asset || typeof asset !== 'object') {
        throw new Error(`Faction asset at index ${index} must be an object or string.`);
      }
      return { ...asset };
    });
  }

  static #normalizeReputationTiers(tiers) {
    if (!tiers) {
      return [];
    }
    if (!Array.isArray(tiers)) {
      throw new Error('Faction reputationTiers must be an array.');
    }

    const normalized = tiers.map((tier, index) => {
      if (!tier || typeof tier !== 'object') {
        throw new Error(`Faction reputation tier at index ${index} must be an object.`);
      }
      const threshold = Number(tier.threshold);
      if (!Number.isFinite(threshold)) {
        throw new Error(`Faction reputation tier at index ${index} is missing a numeric threshold.`);
      }
      const label = typeof tier.label === 'string' ? tier.label.trim() : '';
      const perks = Faction.#normalizeStringList(tier.perks);
      const penalties = Faction.#normalizeStringList(tier.penalties);

      return {
        threshold,
        label,
        perks,
        penalties
      };
    });

    normalized.sort((a, b) => a.threshold - b.threshold);
    return normalized;
  }

  static #isReservedName(name) {
    if (typeof name !== 'string') {
      return false;
    }
    return name.trim().toLowerCase() === 'none';
  }

  constructor({
    id = null,
    name,
    tags = [],
    goals = [],
    description = null,
    shortDescription = null,
    violenceLevel = 1,
    homeRegionName = null,
    relations = null,
    assets = [],
    reputationTiers = [],
    favors = [],
    imageId = null,
    imagePrompt = '',
    allowReservedName = false,
    register = true
  } = {}) {
    if (typeof register !== 'boolean' || (!register && (typeof id !== 'string' || !id.trim()))) {
      throw new Error('Detached faction validation requires register:false and an explicit temporary ID.');
    }
    if (!name || typeof name !== 'string') {
      throw new Error('Faction name is required and must be a string.');
    }

    this.#id = id || Faction.#generateId(name);
    if (register) IdGenerator.register('faction', this.#id);
    this.#name = name.trim();
    if (!this.#name) {
      throw new Error('Faction name must be a non-empty string.');
    }
    if (!allowReservedName && Faction.#isReservedName(this.#name)) {
      throw new Error('Faction name "None" is reserved. Choose another name.');
    }

    this.#tags = Faction.#normalizeStringList(tags);
    this.#goals = Faction.#normalizeStringList(goals);
    this.#description = Faction.#normalizeOptionalText(description, 'Faction description');
    this.#shortDescription = Faction.#normalizeOptionalText(shortDescription, 'Faction short description');
    this.#violenceLevel = Faction.#normalizeViolenceLevel(violenceLevel);
    this.#homeRegionName = typeof homeRegionName === 'string' ? homeRegionName.trim() : null;
    this.#relations = Faction.#normalizeRelations(relations);
    this.#assets = Faction.#normalizeAssets(assets);
    this.#reputationTiers = Faction.#normalizeReputationTiers(reputationTiers);
    this.#favors = normalizeFavorList(favors, {
      tiers: this.#reputationTiers,
      factionName: this.#name,
      register
    });
    if (imageId !== null && imageId !== undefined && typeof imageId !== 'string') {
      throw new Error('Faction imageId must be a non-empty string or null.');
    }
    if (typeof imagePrompt !== 'string') {
      throw new Error('Faction imagePrompt must be a string.');
    }
    this.#imageId = typeof imageId === 'string' && imageId.trim() ? imageId.trim() : null;
    this.#imagePrompt = imagePrompt.trim();

    this.#createdAt = new Date().toISOString();
    this.#lastUpdated = this.#createdAt;

    if (register) {
      Faction.#indexById.set(this.#id, this);
      Faction.#indexByName.set(this.#name.toLowerCase(), this);
    }
  }

  get id() { return this.#id; }
  get name() { return this.#name; }
  get tags() { return [...this.#tags]; }
  get goals() { return [...this.#goals]; }
  get description() { return this.#description; }
  get shortDescription() { return this.#shortDescription; }
  get violenceLevel() { return this.#violenceLevel; }
  get homeRegionName() { return this.#homeRegionName; }
  get relations() {
    return new Map(
      Array.from(this.#relations.entries())
        .map(([key, value]) => [key, { ...value }])
    );
  }
  get assets() { return this.#assets.map(asset => ({ ...asset })); }
  get reputationTiers() { return this.#reputationTiers.map(tier => ({ ...tier })); }
  get favors() { return this.#favors.map(cloneFavor); }
  get imageId() { return this.#imageId; }
  get imagePrompt() { return this.#imagePrompt; }
  get createdAt() { return this.#createdAt; }
  get lastUpdated() { return this.#lastUpdated; }

  set name(value) {
    if (!value || typeof value !== 'string') {
      throw new Error('Faction name must be a non-empty string.');
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('Faction name must be a non-empty string.');
    }
    if (Faction.#isReservedName(trimmed)) {
      throw new Error('Faction name "None" is reserved. Choose another name.');
    }
    Faction.#indexByName.delete(this.#name.toLowerCase());
    this.#name = trimmed;
    Faction.#indexByName.set(this.#name.toLowerCase(), this);
    this.#lastUpdated = new Date().toISOString();
  }

  set tags(value) {
    this.#tags = Faction.#normalizeStringList(value);
    this.#lastUpdated = new Date().toISOString();
  }

  set goals(value) {
    this.#goals = Faction.#normalizeStringList(value);
    this.#lastUpdated = new Date().toISOString();
  }

  set description(value) {
    this.#description = Faction.#normalizeOptionalText(value, 'Faction description');
    this.#lastUpdated = new Date().toISOString();
  }

  set shortDescription(value) {
    this.#shortDescription = Faction.#normalizeOptionalText(value, 'Faction short description');
    this.#lastUpdated = new Date().toISOString();
  }

  set violenceLevel(value) {
    this.#violenceLevel = Faction.#normalizeViolenceLevel(value);
    this.#lastUpdated = new Date().toISOString();
  }

  set homeRegionName(value) {
    if (value === null || value === undefined) {
      this.#homeRegionName = null;
      this.#lastUpdated = new Date().toISOString();
      return;
    }
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Faction homeRegionName must be a non-empty string or null.');
    }
    this.#homeRegionName = value.trim();
    this.#lastUpdated = new Date().toISOString();
  }

  set relations(value) {
    this.#relations = Faction.#normalizeRelations(value);
    this.#lastUpdated = new Date().toISOString();
  }

  set assets(value) {
    this.#assets = Faction.#normalizeAssets(value);
    this.#lastUpdated = new Date().toISOString();
  }

  set reputationTiers(value) {
    const tiers = Faction.#normalizeReputationTiers(value);
    // Revalidate existing favors so a tier edit cannot orphan a favor's minThreshold.
    normalizeFavorList(this.#favors, { tiers, factionName: this.#name, register: false });
    this.#reputationTiers = tiers;
    this.#lastUpdated = new Date().toISOString();
  }

  set favors(value) {
    this.#favors = normalizeFavorList(value, {
      tiers: this.#reputationTiers,
      factionName: this.#name
    });
    this.#lastUpdated = new Date().toISOString();
  }

  /** Replaces tiers and favors together so each set is validated against the other. */
  setReputationTiersAndFavors(tiersValue, favorsValue) {
    const tiers = Faction.#normalizeReputationTiers(tiersValue);
    const favors = normalizeFavorList(favorsValue, { tiers, factionName: this.#name });
    this.#reputationTiers = tiers;
    this.#favors = favors;
    this.#lastUpdated = new Date().toISOString();
  }

  getFavor(favorId) {
    if (typeof favorId !== 'string' || !favorId.trim()) {
      return null;
    }
    const favor = this.#favors.find(entry => entry.id === favorId.trim());
    return favor ? cloneFavor(favor) : null;
  }

  setFavor(favorId, updates = {}) {
    const index = this.#favors.findIndex(entry => entry.id === favorId);
    if (index < 0) {
      throw new Error(`Faction "${this.#name}" has no favor "${favorId}".`);
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw new Error('Favor updates must be an object.');
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'id') && updates.id !== favorId) {
      throw new Error('A favor id cannot be changed.');
    }
    const next = this.#favors.map(cloneFavor);
    next[index] = { ...next[index], ...updates, id: favorId };
    if (Object.prototype.hasOwnProperty.call(updates, 'cooldown')) {
      delete next[index].cooldownMinutes;
    }
    this.#favors = normalizeFavorList(next, { tiers: this.#reputationTiers, factionName: this.#name });
    this.#lastUpdated = new Date().toISOString();
    return cloneFavor(this.#favors[index]);
  }

  removeFavor(favorId) {
    const index = this.#favors.findIndex(entry => entry.id === favorId);
    if (index < 0) {
      return false;
    }
    this.#favors.splice(index, 1);
    this.#lastUpdated = new Date().toISOString();
    return true;
  }

  set imageId(value) {
    if (value !== null && value !== undefined && typeof value !== 'string') {
      throw new Error('Faction imageId must be a non-empty string or null.');
    }
    this.#imageId = typeof value === 'string' && value.trim() ? value.trim() : null;
    this.#lastUpdated = new Date().toISOString();
  }

  set imagePrompt(value) {
    if (typeof value !== 'string') {
      throw new Error('Faction imagePrompt must be a string.');
    }
    this.#imagePrompt = value.trim();
    this.#lastUpdated = new Date().toISOString();
  }

  update(updates = {}) {
    Object.entries(updates).forEach(([key, value]) => {
      if (key === 'id' || key === 'createdAt' || key === 'lastUpdated') {
        return;
      }
      if (typeof value === 'undefined') {
        return;
      }
      if (key in this) {
        this[key] = value;
      }
    });
    return this;
  }

  getRelation(factionId) {
    if (typeof factionId !== 'string' || !factionId.trim()) {
      return null;
    }
    const relation = this.#relations.get(factionId.trim());
    return relation ? { ...relation } : null;
  }

  setRelation(factionId, relation) {
    if (typeof factionId !== 'string' || !factionId.trim()) {
      throw new Error('Faction relation requires a non-empty factionId.');
    }
    const normalizedId = factionId.trim();
    const normalizedRelation = Faction.#normalizeRelationEntry(relation);
    this.#relations.set(normalizedId, normalizedRelation);
    this.#lastUpdated = new Date().toISOString();
  }

  removeRelation(factionId) {
    if (typeof factionId !== 'string' || !factionId.trim()) {
      return false;
    }
    const removed = this.#relations.delete(factionId.trim());
    if (removed) {
      this.#lastUpdated = new Date().toISOString();
    }
    return removed;
  }

  resolveReputationTier(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error('resolveReputationTier requires a numeric standing value.');
    }
    if (!this.#reputationTiers.length) {
      return null;
    }
    let resolved = null;
    for (const tier of this.#reputationTiers) {
      if (numeric >= tier.threshold) {
        resolved = tier;
      } else {
        break;
      }
    }
    return resolved ? { ...resolved } : null;
  }

  toJSON() {
    return {
      id: this.#id,
      name: this.#name,
      description: this.#description,
      shortDescription: this.#shortDescription,
      violenceLevel: this.#violenceLevel,
      tags: [...this.#tags],
      goals: [...this.#goals],
      homeRegionName: this.#homeRegionName,
      relations: Object.fromEntries(
        Array.from(this.#relations.entries())
          .map(([key, value]) => [key, { ...value }])
      ),
      assets: this.#assets.map(asset => ({ ...asset })),
      reputationTiers: this.#reputationTiers.map(tier => ({ ...tier })),
      favors: this.#favors.map(cloneFavor),
      imageId: this.#imageId,
      imagePrompt: this.#imagePrompt,
      createdAt: this.#createdAt,
      lastUpdated: this.#lastUpdated
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Faction.fromJSON requires a data object.');
    }
    const faction = new Faction({
      id: data.id,
      name: data.name,
      tags: data.tags,
      goals: data.goals,
      description: data.description ?? null,
      shortDescription: data.shortDescription ?? null,
      violenceLevel: data.violenceLevel ?? 1,
      homeRegionName: data.homeRegionName,
      relations: data.relations,
      assets: data.assets,
      reputationTiers: data.reputationTiers,
      favors: data.favors ?? [],
      imageId: data.imageId ?? null,
      imagePrompt: data.imagePrompt ?? '',
      allowReservedName: true
    });

    if (typeof data.createdAt === 'string') {
      faction.#createdAt = data.createdAt;
    }
    if (typeof data.lastUpdated === 'string') {
      faction.#lastUpdated = data.lastUpdated;
    }

    return faction;
  }

  static create(options) {
    return new Faction(options);
  }

  static getById(id) {
    if (typeof id !== 'string' || !id.trim()) {
      return null;
    }
    return Faction.#indexById.get(id.trim()) || null;
  }

  static getByName(name) {
    if (typeof name !== 'string' || !name.trim()) {
      return null;
    }
    return Faction.#indexByName.get(name.trim().toLowerCase()) || null;
  }

  static getAll() {
    return Array.from(Faction.#indexById.values());
  }

  static findFavor(favorId) {
    if (typeof favorId !== 'string' || !favorId.trim()) {
      return null;
    }
    const normalizedId = favorId.trim();
    for (const faction of Faction.#indexById.values()) {
      const favor = faction.getFavor(normalizedId);
      if (favor) {
        return { faction, favor };
      }
    }
    return null;
  }

  static exists(id) {
    return typeof id === 'string' && Faction.#indexById.has(id.trim());
  }

  static delete(id) {
    const faction = Faction.getById(id);
    if (!faction) {
      return false;
    }
    Faction.#indexById.delete(faction.id);
    Faction.#indexByName.delete(faction.name.toLowerCase());
    return true;
  }

  static clear() {
    Faction.#indexById.clear();
    Faction.#indexByName.clear();
  }

  static get indexById() {
    return new Map(Faction.#indexById);
  }

  static get indexByName() {
    return new Map(Faction.#indexByName);
  }
}

module.exports = Faction;
