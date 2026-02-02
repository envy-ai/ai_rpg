const crypto = require('crypto');

class Faction {
  #id;
  #name;
  #tags;
  #goals;
  #homeRegionName;
  #relations;
  #assets;
  #reputationTiers;
  #createdAt;
  #lastUpdated;

  static #indexById = new Map();
  static #indexByName = new Map();
  static #validRelations = new Set(['allied', 'neutral', 'hostile', 'rival']);

  static #generateId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(6).toString('hex');
    return `faction_${timestamp}_${random}`;
  }

  static #normalizeStringList(value) {
    const entries = Array.isArray(value)
      ? value
      : (typeof value === 'string' ? value.split(/\r?\n/) : []);

    return entries
      .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(entry => entry.length > 0);
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

  constructor({
    id = null,
    name,
    tags = [],
    goals = [],
    homeRegionName = null,
    relations = null,
    assets = [],
    reputationTiers = []
  } = {}) {
    if (!name || typeof name !== 'string') {
      throw new Error('Faction name is required and must be a string.');
    }

    this.#id = id || Faction.#generateId();
    this.#name = name.trim();
    if (!this.#name) {
      throw new Error('Faction name must be a non-empty string.');
    }

    this.#tags = Faction.#normalizeStringList(tags);
    this.#goals = Faction.#normalizeStringList(goals);
    this.#homeRegionName = typeof homeRegionName === 'string' ? homeRegionName.trim() : null;
    this.#relations = Faction.#normalizeRelations(relations);
    this.#assets = Faction.#normalizeAssets(assets);
    this.#reputationTiers = Faction.#normalizeReputationTiers(reputationTiers);

    this.#createdAt = new Date().toISOString();
    this.#lastUpdated = this.#createdAt;

    Faction.#indexById.set(this.#id, this);
    Faction.#indexByName.set(this.#name.toLowerCase(), this);
  }

  get id() { return this.#id; }
  get name() { return this.#name; }
  get tags() { return [...this.#tags]; }
  get goals() { return [...this.#goals]; }
  get homeRegionName() { return this.#homeRegionName; }
  get relations() {
    return new Map(
      Array.from(this.#relations.entries())
        .map(([key, value]) => [key, { ...value }])
    );
  }
  get assets() { return this.#assets.map(asset => ({ ...asset })); }
  get reputationTiers() { return this.#reputationTiers.map(tier => ({ ...tier })); }
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
    this.#reputationTiers = Faction.#normalizeReputationTiers(value);
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
      tags: [...this.#tags],
      goals: [...this.#goals],
      homeRegionName: this.#homeRegionName,
      relations: Object.fromEntries(
        Array.from(this.#relations.entries())
          .map(([key, value]) => [key, { ...value }])
      ),
      assets: this.#assets.map(asset => ({ ...asset })),
      reputationTiers: this.#reputationTiers.map(tier => ({ ...tier })),
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
      homeRegionName: data.homeRegionName,
      relations: data.relations,
      assets: data.assets,
      reputationTiers: data.reputationTiers
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
