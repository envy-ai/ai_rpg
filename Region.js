const crypto = require('crypto');
const Utils = require('./Utils.js');

let CachedLocationModule = null;
function getLocationModule() {
  if (!CachedLocationModule) {
    CachedLocationModule = require('./Location.js');
  }
  return CachedLocationModule;
}

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
  #lastVisitedTime = null;  // Decimal hours since last visit by player.
  #randomEvents = [];
  #characterConcepts = [];
  #enemyConcepts = [];
  #secrets = [];
  static #indexById = new Map();
  static #indexByName = new Map();

  static #generateId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(6).toString('hex');
    return `region_${timestamp}_${random}`;
  }

  constructor({ name, description, locations = [], locationIds = [], entranceLocationId = null, parentRegionId = null, id = null, statusEffects = [], averageLevel = null, lastVisitedTime = null, randomEvents = [], characterConcepts = [], enemyConcepts = [], secrets = [] } = {}) {
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
    this.#lastVisitedTime = lastVisitedTime;
    this.#randomEvents = Array.isArray(randomEvents)
      ? randomEvents.filter(event => typeof event === 'string' && event.trim()).map(event => event.trim())
      : [];
    this.#averageLevel = Number.isFinite(averageLevel)
      ? Math.max(1, Math.min(20, Math.round(averageLevel)))
      : null;
    this.#relativeLevel = null; // to be set externally if needed
    this.#characterConcepts = Array.isArray(characterConcepts) ? [...characterConcepts] : [];
    this.#enemyConcepts = Array.isArray(enemyConcepts) ? [...enemyConcepts] : [];
    this.#secrets = Array.isArray(secrets) ? [...secrets] : [];

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
          if (!exit) {
            return null;
          }
          if (typeof exit === 'string') {
            const trimmed = exit.trim();
            return trimmed || null;
          }
          if (typeof exit === 'object') {
            const target = typeof exit.target === 'string'
              ? exit.target.trim()
              : (typeof exit.name === 'string' ? exit.name.trim() : (typeof exit.destination === 'string' ? exit.destination.trim() : ''));
            return target || null;
          }
          return null;
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

  static get indexById() {
    return new Map(Region.#indexById);
  }

  static get indexByName() {
    return new Map(Region.#indexByName);
  }

  static clear() {
    Region.#indexById.clear();
    Region.#indexByName.clear();
  }

  static getIndexById() {
    return new Map(Region.#indexById);
  }

  static getIndexByName() {
    return new Map(Region.#indexByName);
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
      averageLevel: data.averageLevel || null,
      lastVisitedTime: data.lastVisitedTime || null,
      randomEvents: Array.isArray(data.randomEvents) ? data.randomEvents : [],
      characterConcepts: Array.isArray(data.characterConcepts) ? data.characterConcepts : [],
      enemyConcepts: Array.isArray(data.enemyConcepts) ? data.enemyConcepts : [],
      secrets: Array.isArray(data.secrets) ? data.secrets : [],
    });
  }

  static fromXMLSnippet(xmlSnippet) {
    if (!xmlSnippet || typeof xmlSnippet !== 'string') {
      throw new Error('Region XML snippet must be a string');
    }

    const regionMatch = xmlSnippet.match(/<region>[\s\S]*?<\/region>/i);
    const regionXml = regionMatch ? regionMatch[0] : xmlSnippet;

    const xmlDoc = Utils.parseXmlDocument(regionXml, 'text/xml');

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
    const characterConcepts = [];
    const enemyConcepts = [];
    const secrets = [];

    const childElements = Array.from(regionElement.childNodes).filter(node => node.nodeType === 1);
    for (const child of childElements) {
      const tag = child.tagName?.toLowerCase();
      if (!tag) continue;

      if (!regionName && (tag === 'regionname' || tag === 'name')) {
        regionName = child.textContent.trim();
      } else if (!regionDescription && (tag === 'regiondescription' || tag === 'description')) {
        regionDescription = child.textContent.trim();
      } else if (!regionLevel && tag === 'relativelevel') {
        const parsedLevel = Number(child.textContent.trim());
        if (Number.isFinite(parsedLevel)) {
          regionLevel = Math.max(1, Math.min(20, Math.round(parsedLevel)));
        }
      } else if (tag === 'characterconcept' || tag === 'characterconcepts') {
        if (tag === 'characterconcepts') {
          const conceptNodes = Array.from(child.getElementsByTagName('concept'));
          if (conceptNodes.length) {
            conceptNodes.forEach(node => {
              const value = node.textContent?.trim();
              if (value) {
                characterConcepts.push(value);
              }
            });
          } else {
            const value = child.textContent?.trim();
            if (value) {
              characterConcepts.push(value);
            }
          }
        } else {
          const value = child.textContent?.trim();
          if (value) {
            characterConcepts.push(value);
          }
        }
      } else if (tag === 'enemyconcept' || tag === 'enemyconcepts') {
        if (tag === 'enemyconcepts') {
          const conceptNodes = Array.from(child.getElementsByTagName('concept'));
          if (conceptNodes.length) {
            conceptNodes.forEach(node => {
              const value = node.textContent?.trim();
              if (value) {
                enemyConcepts.push(value);
              }
            });
          } else {
            const value = child.textContent?.trim();
            if (value) {
              enemyConcepts.push(value);
            }
          }
        } else {
          const value = child.textContent?.trim();
          if (value) {
            enemyConcepts.push(value);
          }
        }
      } else if (tag === 'secrets') {
        const secretNodes = Array.from(child.getElementsByTagName('secret'));
        if (secretNodes.length) {
          secretNodes.forEach(node => {
            const value = node.textContent?.trim();
            if (value) {
              secrets.push(value);
            }
          });
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

      const childElements = Array.from(node.childNodes).filter(child => child.nodeType === 1);
      const findDirectChild = (tagName) => childElements.find(child => child.tagName && child.tagName.toLowerCase() === tagName);

      const locNameNode = findDirectChild('name');
      const locDescriptionNode = findDirectChild('description');
      const relativeLevelNode = findDirectChild('relativelevel');
      const exitsNode = findDirectChild('exits');
      let relativeLevel = null;

      let locName = locNameNode ? locNameNode.textContent.trim() : null;
      if (!locName && attrName) {
        locName = attrName;
      }
      if (!locName) {
        locName = `Location ${index + 1}`;
      }

      const locDescription = locDescriptionNode ? locDescriptionNode.textContent.trim() : '';

      if (relativeLevelNode) {
        const parsedRelative = Number(relativeLevelNode.textContent.trim());
        if (Number.isFinite(parsedRelative)) {
          relativeLevel = Math.max(-10, Math.min(10, Math.round(parsedRelative)));
        }
      }

      const exitEntries = exitsNode
        ? Array.from(exitsNode.getElementsByTagName('exit')).map(exitNode => {
          const destinationAttr = exitNode.getAttribute('destination');
          const textDest = exitNode.textContent?.trim();
          const namedAttr = exitNode.getAttribute('name')?.trim();
          const targetCandidate = destinationAttr?.trim() || textDest || namedAttr || '';
          const normalized = targetCandidate.trim();
          return normalized || null;
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

    const randomEventsNode = regionElement.getElementsByTagName('randomStoryEvents')?.[0] || null;
    const randomEvents = randomEventsNode
      ? Array.from(randomEventsNode.getElementsByTagName('event'))
        .map(node => (node.textContent || '').trim())
        .filter(Boolean)
      : [];

    return new Region({
      name: regionName,
      description: regionDescription,
      locations: locationBlueprints,
      averageLevel: regionLevel,
      randomEvents,
      characterConcepts,
      enemyConcepts,
      secrets
    });
  }

  get id() {
    return this.#id;
  }

  static get stubRegionCount() {
    return Array.from(Region.#indexById.values()).filter(region => region.isStub).length;
  }

  get randomEvents() {
    return [...this.#randomEvents];
  }

  get isStub() {
    return !Array.isArray(this.#locationIds) || this.#locationIds.length === 0;
  }

  set randomEvents(events) {
    this.#randomEvents = Array.isArray(events) ? [...events] : [];
    this.#lastUpdated = new Date().toISOString();
  }

  addRandomEvent(event) {
    if (typeof event !== 'string') {
      return;
    }
    const trimmed = event.trim();
    if (!trimmed) {
      return;
    }
    this.#randomEvents.push(trimmed);
    this.#lastUpdated = new Date().toISOString();
  }

  removeRandomEvent(event) {
    if (!event) {
      return false;
    }

    let removed = false;
    if (typeof event === 'number' && Number.isInteger(event)) {
      if (event >= 0 && event < this.#randomEvents.length) {
        this.#randomEvents.splice(event, 1);
        removed = true;
      }
    } else if (typeof event === 'string') {
      const trimmed = event.trim();
      const index = this.#randomEvents.findIndex(entry => entry === trimmed);
      if (index !== -1) {
        this.#randomEvents.splice(index, 1);
        removed = true;
      }
    }

    if (removed) {
      this.#lastUpdated = new Date().toISOString();
    }

    return removed;
  }

  get childRegions() {
    const children = [];
    for (const region of Region.#indexById.values()) {
      if (region.parentRegionId === this.#id) {
        children.push(region);
      }
    }
    return children;
  }

  get siblingRegions() {
    if (!this.#parentRegionId) {
      return [];
    }
    const siblings = [];
    for (const region of Region.#indexById.values()) {
      if (region.id !== this.#id && region.parentRegionId === this.#parentRegionId) {
        siblings.push(region);
      }
    }
    return siblings;
  }

  get parentRegion() {
    return this.#parentRegionId ? Region.get(this.#parentRegionId) : null;
  }

  get parentHierarchy() {
    const hierarchy = [];

    let ids = new Set();

    let current = this.parentRegion;
    while (current) {
      hierarchy.unshift(current);
      if (ids.has(current.id)) {
        throw new Error('Circular parentRegion reference detected in Region hierarchy');
      }
      ids.add(current.id);

      if (!current.parentRegionId) {
        break;
      }
      current = current.parentRegion;
    }
    return hierarchy;
  }

  get name() {
    return this.#name;
  }

  set name(value) {
    if (value === undefined || value === null) {
      throw new Error('Region name must be provided');
    }
    if (typeof value !== 'string') {
      throw new Error('Region name must be a string');
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('Region name cannot be empty');
    }
    if (this.#name && Region.#indexByName.has(this.#name.toLowerCase())) {
      Region.#indexByName.delete(this.#name.toLowerCase());
    }
    this.#name = trimmed;
    Region.#indexByName.set(trimmed.toLowerCase(), this);
    this.#lastUpdated = new Date().toISOString();
  }

  get description() {
    return this.#description;
  }

  set description(value) {
    if (value === undefined || value === null) {
      throw new Error('Region description must be provided');
    }
    if (typeof value !== 'string') {
      throw new Error('Region description must be a string');
    }
    const trimmed = value.trim();
    this.#description = trimmed;
    this.#lastUpdated = new Date().toISOString();
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

  get characterConcepts() {
    return [...this.#characterConcepts];
  }

  get secrets() {
    return [...this.#secrets];
  }

  set secrets(secrets) {
    this.#secrets = Array.isArray(secrets) ? [...secrets] : [];
    this.#lastUpdated = new Date().toISOString();
  }

  set characterConcepts(concepts) {
    this.#characterConcepts = Array.isArray(concepts) ? [...concepts] : [];
    this.#lastUpdated = new Date().toISOString();
  }

  get enemyConcepts() {
    return [...this.#enemyConcepts];
  }

  set enemyConcepts(concepts) {
    this.#enemyConcepts = Array.isArray(concepts) ? [...concepts] : [];
    this.#lastUpdated = new Date().toISOString();
  }

  set lastVisitedTime(value) {
    if (value === null || value === undefined) {
      this.#lastVisitedTime = null;
      this.#lastUpdated = new Date().toISOString();
      return;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      throw new Error('Region lastVisitedTime must be a non-negative number or null');
    }
    this.#lastVisitedTime = num;
    this.#lastUpdated = new Date().toISOString();
  }

  get lastVisitedTime() {
    return this.#lastVisitedTime;
  }

  hoursSinceLastVisit(currentTime = null) {
    const lastVisited = this.#lastVisitedTime;
    if (lastVisited === null) {
      return null;
    }
    return Globals.elapsedTime - lastVisited;
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
      averageLevel: this.#averageLevel,
      randomEvents: [...this.#randomEvents],
      characterConcepts: [...this.#characterConcepts],
      enemyConcepts: [...this.#enemyConcepts],
      secrets: [...this.#secrets],
    };
  }

  get averageLevel() {
    return this.#averageLevel;
  }

  setAverageLevel(level) {
    if (level === undefined) {
      return this.#averageLevel;
    }

    if (level === null || level === '') {
      if (this.#averageLevel !== null) {
        this.#averageLevel = null;
        this.#lastUpdated = new Date().toISOString();
      }
      return this.#averageLevel;
    }

    const numericLevel = Number(level);
    if (!Number.isFinite(numericLevel)) {
      throw new Error('Average level must be a finite number');
    }

    const normalized = Math.max(1, Math.min(20, Math.round(numericLevel)));
    if (normalized !== this.#averageLevel) {
      this.#averageLevel = normalized;
      this.#lastUpdated = new Date().toISOString();
    }

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
    const Location = getLocationModule();
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

  get locations() {
    const locations = [];
    const Location = getLocationModule();
    for (const locId of this.#locationIds) {
      const location = Location.get(locId);
      if (location) {
        locations.push(location);
      }
    }
    return locations;
  }

  /**
   * Returns a Set of unique NPC IDs present in all locations of this region.
   * @returns {Set<string>} Set of NPC IDs
   */
  getNPCIds() {
    const npcIds = new Set();
    const Location = getLocationModule();
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
