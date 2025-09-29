const crypto = require('crypto');
const { DOMParser } = require('xmldom');
const Location = require('./Location.js');
const Utils = require('./Utils.js');

class Region {
  #id;
  #name;
  #description;
  #locationBlueprints;
  #locationIds;
  #entranceLocationId;
  #parentRegionId;
  #createdAt;
  #lastUpdated;
  #statusEffects;
  #averageLevel;
  #relativeLevel;

  static #indexById = new Map();
  static #indexByName = new Map();

  static #generateId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(6).toString('hex');
    return `region_${timestamp}_${random}`;
  }

  constructor({ name, description, locations = [], locationIds = [], entranceLocationId = null, parentRegionId = null, id = null, statusEffects = [], averageLevel = null } = {}) {
    if (!name || typeof name !== 'string') {
      throw new Error('Region name is required and must be a string');
    }

    if (!description || typeof description !== 'string') {
      throw new Error('Region description is required and must be a string');
    }

    this.#id = id || Region.#generateId();
    this.#name = name.trim();
    this.#description = description.trim();
    this.#locationBlueprints = Array.isArray(locations)
      ? locations.map(bp => Region.#normalizeBlueprint(bp))
      : [];
    this.#locationIds = Array.isArray(locationIds) ? [...locationIds] : [];
    this.#entranceLocationId = entranceLocationId && typeof entranceLocationId === 'string'
      ? entranceLocationId
      : null;
    this.#parentRegionId = parentRegionId && typeof parentRegionId === 'string'
      ? parentRegionId
      : null;
    this.#createdAt = new Date().toISOString();
    this.#lastUpdated = this.#createdAt;
    this.#statusEffects = this.#normalizeStatusEffects(statusEffects);
    this.#averageLevel = Number.isFinite(averageLevel)
      ? Math.max(1, Math.min(20, Math.round(averageLevel)))
      : null;
    this.#relativeLevel = null; // to be set externally if needed

    Region.#indexById.set(this.#id, this);
    Region.#indexByName.set(this.#name.toLowerCase(), this);
  }

  static #normalizeBlueprint(blueprint = {}) {
    const name = typeof blueprint.name === 'string' ? blueprint.name.trim() : null;
    if (!name) {
      throw new Error('Region location blueprint requires a name');
    }
    const description = typeof blueprint.description === 'string'
      ? blueprint.description.trim()
      : '';
    const exits = Array.isArray(blueprint.exits)
      ? blueprint.exits
        .map(exit => {
          if (!exit) return null;
          if (typeof exit === 'string') {
            return { target: exit.trim(), direction: null };
          }
          const target = typeof exit.target === 'string' ? exit.target.trim() : '';
          const direction = typeof exit.direction === 'string' ? exit.direction.trim().toLowerCase() : null;
          if (!target) return null;
          return { target, direction };
        })
        .filter(Boolean)
      : [];

    const aliases = Array.isArray(blueprint.aliases)
      ? blueprint.aliases.map(alias => typeof alias === 'string' ? alias.trim() : '').filter(Boolean)
      : [];

    const relativeLevelRaw = blueprint.relativeLevel;
    let relativeLevel = null;
    if (relativeLevelRaw !== undefined && relativeLevelRaw !== null && relativeLevelRaw !== '') {
      const parsedRelative = Number(relativeLevelRaw);
      if (Number.isFinite(parsedRelative)) {
        relativeLevel = Math.max(-10, Math.min(10, Math.round(parsedRelative)));
      }
    }

    return {
      name,
      description,
      exits,
      aliases,
      relativeLevel
    };
  }

  static get(id) {
    return Region.#indexById.get(id) || null;
  }

  static getByName(name) {
    if (!name || typeof name !== 'string') {
      return null;
    }
    return Region.#indexByName.get(name.toLowerCase()) || null;
  }

  static getAll() {
    return Array.from(Region.#indexById.values());
  }

  static clear() {
    Region.#indexById.clear();
    Region.#indexByName.clear();
  }

  static fromJSON(data = {}) {
    return new Region({
      id: data.id,
      name: data.name,
      description: data.description,
      locations: data.locationBlueprints || [],
      locationIds: data.locationIds || [],
      entranceLocationId: data.entranceLocationId || null,
      parentRegionId: data.parentRegionId || null,
      statusEffects: Array.isArray(data.statusEffects) ? data.statusEffects : [],
      averageLevel: data.averageLevel || null
    });
  }

  static fromXMLSnippet(xmlSnippet) {
    if (!xmlSnippet || typeof xmlSnippet !== 'string') {
      throw new Error('Region XML snippet must be a string');
    }

    const regionMatch = xmlSnippet.match(/<region>[\s\S]*?<\/region>/i);
    const regionXml = regionMatch ? regionMatch[0] : xmlSnippet;

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(regionXml, 'text/xml');

    const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
    if (parserError) {
      throw new Error(`Region XML parsing error: ${parserError.textContent}`);
    }

    const regionElement = xmlDoc.getElementsByTagName('region')[0];
    if (!regionElement) {
      throw new Error('Region XML missing <region> root element');
    }

    let regionName = null;
    let regionDescription = null;
    let regionLevel = null;

    const childElements = Array.from(regionElement.childNodes).filter(node => node.nodeType === 1);
    for (const child of childElements) {
      const tag = child.tagName?.toLowerCase();
      if (!tag) continue;

      if (!regionName && (tag === 'regionname' || tag === 'name')) {
        regionName = child.textContent.trim();
      } else if (!regionDescription && (tag === 'regiondescription' || tag === 'description')) {
        regionDescription = child.textContent.trim();
      } else if (!regionLevel && tag === 'relativeLevel') {
        const parsedLevel = Number(child.textContent.trim());
        if (Number.isFinite(parsedLevel)) {
          regionLevel = Math.max(1, Math.min(20, Math.round(parsedLevel)));
        }
      }
    }

    if (!regionName) {
      throw new Error('Region XML missing <regionName>');
    }

    if (!regionDescription) {
      throw new Error('Region XML missing <regionDescription>');
    }

    const blueprintElements = Array.from(regionElement.getElementsByTagName('location'));
    const locationBlueprints = blueprintElements.map((node, index) => {
      const attrId = node.getAttribute('id')?.trim();
      const attrName = node.getAttribute('name')?.trim();

      const locNameNode = node.getElementsByTagName('name')[0];
      const locDescriptionNode = node.getElementsByTagName('description')[0];
      const exitsNode = node.getElementsByTagName('exits')[0];
      let relativeLevel = null;

      let locName = locNameNode ? locNameNode.textContent.trim() : null;
      if (!locName && attrName) {
        locName = attrName;
      }
      if (!locName) {
        locName = `Location ${index + 1}`;
      }

      const locDescription = locDescriptionNode ? locDescriptionNode.textContent.trim() : '';
      if (exitsNode) {
        const relativeNode = exitsNode.getElementsByTagName('relativeLevel')[0];
        if (relativeNode) {
          const parsedRelative = Number(relativeNode.textContent.trim());
          if (Number.isFinite(parsedRelative)) {
            relativeLevel = Math.max(-10, Math.min(10, Math.round(parsedRelative)));
          }
        }
      }

      const exitEntries = exitsNode
        ? Array.from(exitsNode.getElementsByTagName('exit')).map(exitNode => {
          const destinationAttr = exitNode.getAttribute('destination');
          const directionAttr = exitNode.getAttribute('direction');
          const textDest = exitNode.textContent?.trim();
          const targetCandidate = destinationAttr?.trim() || textDest || exitNode.getAttribute('name')?.trim() || '';
          if (!targetCandidate) {
            return null;
          }
          return {
            target: targetCandidate,
            direction: directionAttr ? directionAttr.trim().toLowerCase() : null
          };
        }).filter(Boolean)
        : [];

      const aliases = [];
      if (attrId) aliases.push(attrId);
      if (attrName) aliases.push(attrName);

      return Region.#normalizeBlueprint({
        name: locName,
        description: locDescription,
        exits: exitEntries,
        aliases,
        relativeLevel
      });
    });

    return new Region({
      name: regionName,
      description: regionDescription,
      locations: locationBlueprints,
      averageLevel: regionLevel
    });
  }

  get id() {
    return this.#id;
  }

  get name() {
    return this.#name;
  }

  get description() {
    return this.#description;
  }

  get locationBlueprints() {
    return this.#locationBlueprints.map(bp => ({ ...bp }));
  }

  get locationIds() {
    return [...this.#locationIds];
  }

  get relativeLevel() {
    return this.#relativeLevel;
  }

  set relativeLevel(level) {
    if (Number.isFinite(level)) {
      this.#relativeLevel = Math.round(level);
      this.#lastUpdated = new Date().toISOString();
    }
  }

  set locationIds(ids) {
    this.#locationIds = Array.isArray(ids) ? [...ids] : [];
    this.#lastUpdated = new Date().toISOString();
  }

  addLocationId(id) {
    if (!id || typeof id !== 'string') {
      return;
    }
    if (!this.#locationIds.includes(id)) {
      this.#locationIds.push(id);
      this.#lastUpdated = new Date().toISOString();
    }
  }

  get entranceLocationId() {
    return this.#entranceLocationId;
  }

  set entranceLocationId(id) {
    this.#entranceLocationId = typeof id === 'string' ? id : null;
    this.#lastUpdated = new Date().toISOString();
  }

  get parentRegionId() {
    return this.#parentRegionId;
  }

  set parentRegionId(regionId) {
    if (regionId !== null && typeof regionId !== 'string') {
      return;
    }
    this.#parentRegionId = regionId ? regionId.trim() || null : null;
    this.#lastUpdated = new Date().toISOString();
  }

  addLocation(locationId) {
    if (!locationId || typeof locationId !== 'string') {
      return;
    }
    if (!this.#locationIds.includes(locationId)) {
      this.#locationIds.push(locationId);
      this.#lastUpdated = new Date().toISOString();
    }
  }

  toJSON() {
    return {
      id: this.#id,
      name: this.#name,
      description: this.#description,
      locationBlueprints: this.locationBlueprints,
      locationIds: this.locationIds,
      entranceLocationId: this.#entranceLocationId,
      parentRegionId: this.#parentRegionId,
      createdAt: this.#createdAt,
      lastUpdated: this.#lastUpdated,
      statusEffects: this.getStatusEffects(),
      averageLevel: this.#averageLevel
    };
  }

  get averageLevel() {
    return this.#averageLevel;
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

  getNPCs() {
    const npcs = [];
    for (const locId of this.#locationIds) {
      const location = Location.get(locId);
      if (location && Array.isArray(location.npcIds)) {
        for (const npcId of location.npcIds) {
          const npc = Player.get(npcId);
          if (npc) {
            npcs.push(npc);
          }
        }
      }
    }
    return npcs;
  }

  /**
   * Returns a Set of unique NPC IDs present in all locations of this region.
   * @returns {Set<string>} Set of NPC IDs
   */
  getNPCIds() {
    const npcIds = new Set();
    for (const locId of this.#locationIds) {
      const location = Location.get(locId);
      if (location && Array.isArray(location.npcIds)) {
        for (const npcId of location.npcIds) {
          npcIds.add(npcId);
        }
      }
    }
    return npcIds;
  }
}

module.exports = Region;
