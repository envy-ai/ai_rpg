const crypto = require('crypto');
const { DOMParser, XMLSerializer } = require('xmldom');
const Player = require('./Player.js');
const Utils = require('./Utils.js');


/**
 * Location class for AI RPG
 * Represents a game location with description and base level stats
 * Uses ES13 syntax with private fields and modern JavaScript features
 */
class Location {
  // Private fields - encapsulated state
  #id;
  #name;
  #description;
  #baseLevel;
  #exits;
  #visited;
  #imageId;
  #createdAt;
  #lastUpdated;
  #isStub;
  #stubMetadata;
  #hasGeneratedStubs;
  #npcIds;
  #statusEffects;
  #thingIds;
  static #indexByID = new Map();
  static #indexByName = new Map();

  // Static private method for generating unique IDs
  static #generateId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(6).toString('hex');
    return `location_${timestamp}_${random}`;
  }

  /**
   * Creates a new Location instance
   * @param {Object} options - Location configuration
   * @param {string} options.description - Description of the location
   * @param {number} [options.baseLevel=1] - Base level for the location (defaults to 1)
   * @param {string} [options.id] - Custom ID (if not provided, one will be generated)
   * @param {string} [options.imageId] - Image ID for generated location scene (defaults to null)
   */
  constructor({ description, baseLevel = 1, id = null, imageId = null, name = null, isStub = false, stubMetadata = null, hasGeneratedStubs = false, statusEffects = [], npcIds = [], thingIds = [] } = {}) {
    const creatingStub = Boolean(isStub);

    if (!creatingStub) {
      if (!description || typeof description !== 'string') {
        throw new Error('Location description is required and must be a string');
      }

      if (typeof baseLevel !== 'number' || baseLevel < 1) {
        throw new Error('Base level must be a positive number');
      }
    }

    // Initialize private fields
    this.#id = id || Location.#generateId();
    this.#description = description && typeof description === 'string' ? description.trim() : null;
    this.#name = name && typeof name === 'string' ? name.trim() : null;
    this.#baseLevel = creatingStub ? (typeof baseLevel === 'number' ? Math.floor(baseLevel) : null) : Math.floor(baseLevel);
    this.#exits = new Map(); // Map of direction -> LocationExit
    this.#imageId = imageId;
    this.#createdAt = new Date();
    this.#lastUpdated = this.#createdAt;
    this.#isStub = creatingStub;
    this.#visited = false;
    this.#stubMetadata = creatingStub && stubMetadata ? { ...stubMetadata } : creatingStub ? {} : null;
    this.#hasGeneratedStubs = Boolean(hasGeneratedStubs);
    this.#npcIds = Array.isArray(npcIds)
      ? [...new Set(npcIds.filter(id => typeof id === 'string'))]
      : [];
    this.#thingIds = Array.isArray(thingIds)
      ? [...new Set(thingIds.filter(id => typeof id === 'string'))]
      : [];
    this.#statusEffects = this.#normalizeStatusEffects(statusEffects);

    // Index by ID and name if provided
    Location.#indexByID.set(this.#id, this);
    if (this.#name) {
      Location.#indexByName.set(this.#name.toLowerCase(), this);
    }
  }

  static fromXMLSnippet(xmlSnippet, options = {}) {
    const {
      existingLocation = null,
      allowRename = true,
      baseLevelFallback = null,
      relativeLevelBase = null
    } = options || {};

    //console.log('🔍 Parsing XML snippet (length:', xmlSnippet.length, 'chars)');

    // Strip any text outside the <location> tags and extract just the location XML
    const locationMatch = xmlSnippet.match(/<location>[\s\S]*?<\/location>/);
    const strippedXML = locationMatch ? locationMatch[0] : xmlSnippet;

    //console.log('Extracted XML:', strippedXML);

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(strippedXML, 'text/xml');

    // Check for parsing errors
    const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
    if (parserError) {
      console.error('XML parsing error:', parserError.textContent);
      throw new Error(`XML parsing error: ${parserError.textContent}`);
    }

    // Convert the whole thing to javascript object
    const locationData = {};
    const locationElem = xmlDoc.getElementsByTagName('location')[0];

    if (!locationElem) {
      console.error('No <location> element found in:', strippedXML);
      throw new Error('Invalid XML snippet: missing <location> root element: ' + strippedXML);
    }

    // Populate locationData with the text content of each child element
    const childNodes = Array.from(locationElem.childNodes);

    for (const child of childNodes) {
      // Only process element nodes (nodeType 1)
      // <description> can contain HTML, so we take the full inner XML
      if (child.nodeType === 1) {
        let value = null;
        if (child.tagName === 'description') {
          value = Utils.innerXML(child).trim();
        } else {
          value = child.textContent.trim();
        }

        // Convert baseLevel to number
        if (child.tagName === 'baseLevel') {
          locationData[child.tagName] = parseInt(value, 10);
        } else if (child.tagName === 'relativeLevel') {
          locationData[child.tagName] = parseInt(value, 10);
        } else {
          locationData[child.tagName] = value;
        }
      }
    }

    //console.log('Successfully parsed location data:', locationData);

    if (existingLocation) {
      if (!locationData.description || typeof locationData.description !== 'string') {
        throw new Error('Stub expansion missing description in AI response');
      }

      let parsedBaseLevel = typeof locationData.baseLevel === 'number' && !Number.isNaN(locationData.baseLevel)
        ? locationData.baseLevel
        : null;

      const parsedRelativeLevel = Number.isFinite(locationData.relativeLevel)
        ? locationData.relativeLevel
        : Number.isFinite(parseInt(locationData.relativeLevel, 10))
          ? parseInt(locationData.relativeLevel, 10)
          : null;

      if (!parsedBaseLevel) {
        if (Number.isFinite(parsedRelativeLevel)) {
          const baseReference = Number.isFinite(relativeLevelBase)
            ? relativeLevelBase
            : (Number.isFinite(existingLocation?.baseLevel) ? existingLocation.baseLevel : Number.isFinite(baseLevelFallback) ? baseLevelFallback : 1);
          parsedBaseLevel = Math.round(baseReference + parsedRelativeLevel);
        } else if (Number.isFinite(existingLocation?.baseLevel)) {
          parsedBaseLevel = existingLocation.baseLevel;
        } else if (Number.isFinite(baseLevelFallback)) {
          parsedBaseLevel = baseLevelFallback;
        }
      }

      parsedBaseLevel = Math.max(1, Math.min(20, Math.round(parsedBaseLevel || 1)));

      if (!parsedBaseLevel) {
        throw new Error('Stub expansion missing valid base level in AI response');
      }

      const promotionData = {
        description: locationData.description,
        baseLevel: parsedBaseLevel
      };

      if (allowRename && locationData.name) {
        promotionData.name = locationData.name;
      }

      if (existingLocation.isStub) {
        existingLocation.promoteFromStub(promotionData);
      } else {
        if (promotionData.name) {
          existingLocation.name = promotionData.name;
        }
        existingLocation.description = promotionData.description;
        existingLocation.baseLevel = promotionData.baseLevel;
      }

      return existingLocation;
    }

    let baseLevel = typeof locationData.baseLevel === 'number' && !Number.isNaN(locationData.baseLevel)
      ? locationData.baseLevel
      : null;

    const parsedRelativeLevel = Number.isFinite(locationData.relativeLevel)
      ? locationData.relativeLevel
      : Number.isFinite(parseInt(locationData.relativeLevel, 10))
        ? parseInt(locationData.relativeLevel, 10)
        : null;

    if (!baseLevel) {
      if (Number.isFinite(parsedRelativeLevel)) {
        const baseReference = Number.isFinite(relativeLevelBase)
          ? relativeLevelBase
          : Number.isFinite(baseLevelFallback)
            ? baseLevelFallback
            : 1;
        baseLevel = baseReference + parsedRelativeLevel;
      } else if (Number.isFinite(baseLevelFallback)) {
        baseLevel = baseLevelFallback;
      } else {
        baseLevel = 1;
      }
    }

    baseLevel = Math.max(1, Math.min(20, Math.round(baseLevel)));

    return new Location({
      description: locationData.description,
      baseLevel,
      name: locationData.name
    });
  }

  static get(locationId) {
    if (!locationId || typeof locationId !== 'string') {
      throw new Error('Location ID must be a non-empty string');
    }
    return Location.#indexByID.get(locationId) || null;
  }

  static findByName(name) {
    if (!name || typeof name !== 'string') {
      throw new Error('Location name must be a non-empty string');
    }
    return Location.#indexByName.get(name.toLowerCase()) || null;
  }

  // Getters for accessing private fields
  get id() {
    return this.#id;
  }

  get name() {
    return this.#name;
  }

  get description() {
    return this.#description;
  }

  get baseLevel() {
    return this.#baseLevel;
  }

  get exits() {
    // Return a copy to prevent external modification
    return new Map(this.#exits);
  }

  get visited() {
    return this.#visited;
  }

  get createdAt() {
    return new Date(this.#createdAt);
  }

  get imageId() {
    return this.#imageId;
  }

  get lastUpdated() {
    return new Date(this.#lastUpdated);
  }

  // Setters for modifying private fields

  set name(newName) {
    if (newName !== null && typeof newName !== 'string') {
      throw new Error('Name must be a string or null');
    }

    if (this.#name) {
      Location.#indexByName.delete(this.#name.toLowerCase());
    }

    this.#name = newName ? newName.trim() : null;

    if (this.#name) {
      Location.#indexByName.set(this.#name.toLowerCase(), this);
    }

    this.#lastUpdated = new Date();
  }

  set description(newDescription) {
    if (!newDescription || typeof newDescription !== 'string') {
      throw new Error('Description must be a non-empty string');
    }
    this.#description = newDescription.trim();
    this.#lastUpdated = new Date();
  }

  set imageId(newImageId) {
    if (newImageId !== null && typeof newImageId !== 'string') {
      throw new Error('Image ID must be a string or null');
    }
    this.#imageId = newImageId;
    this.#lastUpdated = new Date();
  }

  set baseLevel(newLevel) {
    if (typeof newLevel !== 'number' || newLevel < 1) {
      throw new Error('Base level must be a positive number');
    }
    this.#baseLevel = Math.floor(newLevel);
    this.#lastUpdated = new Date();
  }

  set visited(value) {
    this.#visited = Boolean(value);
    this.#lastUpdated = new Date();
  }

  get isStub() {
    return this.#isStub;
  }

  get stubMetadata() {
    return this.#stubMetadata ? { ...this.#stubMetadata } : null;
  }

  set stubMetadata(metadata) {
    this.#stubMetadata = metadata ? { ...metadata } : null;
    this.#lastUpdated = new Date();
  }

  get hasGeneratedStubs() {
    return this.#hasGeneratedStubs;
  }

  set hasGeneratedStubs(value) {
    this.#hasGeneratedStubs = Boolean(value);
  }

  promoteFromStub({ name, description, baseLevel, imageId } = {}) {
    if (!description || typeof description !== 'string') {
      throw new Error('Promoting stub requires a description string');
    }

    if (typeof baseLevel !== 'number' || baseLevel < 1) {
      throw new Error('Promoting stub requires a positive base level');
    }

    if (name && typeof name === 'string' && name.trim() && name.trim() !== this.#name) {
      this.name = name.trim();
    }

    this.description = description;
    this.baseLevel = baseLevel;
    if (imageId !== undefined) {
      this.imageId = imageId;
    }
    this.#isStub = false;
    this.#stubMetadata = null;
    this.#hasGeneratedStubs = false;
  }

  markStubsGenerated() {
    this.#hasGeneratedStubs = true;
    this.#lastUpdated = new Date();
  }

  resetStubGeneration() {
    this.#hasGeneratedStubs = false;
    this.#lastUpdated = new Date();
  }

  /**
   * Add an exit to this location
   * @param {string} direction - Direction of the exit (e.g., 'north', 'south', 'up', 'down')
   * @param {LocationExit} exit - The LocationExit instance
   */
  addExit(direction, exit) {
    if (!direction || typeof direction !== 'string') {
      throw new Error('Direction must be a non-empty string');
    }

    // Check if exit has the required interface (duck typing)
    if (!exit || typeof exit.destination !== 'string') {
      throw new Error('Exit must have a destination property');
    }

    this.#exits.set(direction.toLowerCase().trim(), exit);
    this.#lastUpdated = new Date();
  }

  /**
   * Remove an exit from this location
   * @param {string} direction - Direction of the exit to remove
   * @returns {boolean} - True if exit was removed, false if it didn't exist
   */
  removeExit(direction) {
    if (!direction || typeof direction !== 'string') {
      return false;
    }
    return this.#exits.delete(direction.toLowerCase().trim());
  }

  /**
   * Get an exit in a specific direction
   * @param {string} direction - Direction to check
   * @returns {LocationExit|null} - The exit or null if none exists
   */
  getExit(direction) {
    if (!direction || typeof direction !== 'string') {
      return null;
    }
    return this.#exits.get(direction.toLowerCase().trim()) || null;
  }

  /**
   * Get all available directions from this location
   * @returns {string[]} - Array of direction strings
   */
  getAvailableDirections() {
    return Array.from(this.#exits.keys());
  }

  /**
   * Check if an exit exists in a given direction
   * @param {string} direction - Direction to check
   * @returns {boolean} - True if exit exists
   */
  hasExit(direction) {
    if (!direction || typeof direction !== 'string') {
      return false;
    }
    return this.#exits.has(direction.toLowerCase().trim());
  }

  /**
   * Clear all exits from this location
   */
  clearExits() {
    this.#exits.clear();
    this.#lastUpdated = new Date();
  }

  /**
   * Get a summary of the location
   * @returns {Object} - Location summary object
   */
  getSummary() {
    return {
      id: this.#id,
      name: this.#name,
      description: this.#description,
      baseLevel: this.#baseLevel,
      visited: this.#visited,
      imageId: this.#imageId,
      exitCount: this.#exits.size,
      availableDirections: this.getAvailableDirections(),
      createdAt: this.#createdAt.toISOString(),
      lastUpdated: this.#lastUpdated.toISOString(),
      isStub: this.#isStub,
      hasGeneratedStubs: this.#hasGeneratedStubs,
      stubMetadata: this.#stubMetadata ? { ...this.#stubMetadata } : null,
      npcIds: [...this.#npcIds],
      thingIds: [...this.#thingIds],
      statusEffects: this.getStatusEffects()
    };
  }

  /**
   * Get detailed information about the location
   * @returns {Object} - Detailed location information
   */
  getDetails() {
    const exits = {};
    for (const [direction, exit] of this.#exits) {
      exits[direction] = {
        id: exit.id,
        description: exit.description || 'No description',
        destination: exit.destination,
        bidirectional: exit.bidirectional !== false
      };
    }

    return {
      id: this.#id,
      name: this.#name,
      description: this.#description,
      baseLevel: this.#baseLevel,
      imageId: this.#imageId,
      visited: this.#visited,
      exits: exits,
      createdAt: this.#createdAt.toISOString(),
      lastUpdated: this.#lastUpdated.toISOString(),
      isStub: this.#isStub,
      hasGeneratedStubs: this.#hasGeneratedStubs,
      stubMetadata: this.#stubMetadata ? { ...this.#stubMetadata } : null,
      npcIds: [...this.#npcIds],
      thingIds: [...this.#thingIds]
    };
  }

  /**
   * Get a Set of unique NPC IDs present in this location
   * @returns {Set<string>} - Set of unique NPC IDs
   */
  getNPCIds() {
    return new Set(this.#npcIds);
  }

  getNPCs() {
    const npcs = [];
    for (const npcId of this.#npcIds) {
      const npc = Player.get(npcId);
      if (npc && npc.isNPC) {
        npcs.push(npc);
      } else if (!npc) {
        console.warn(`NPC with ID ${npcId} not found in Player index`);
      }
    }
    return npcs;
  }

  /**
   * Convert location to JSON representation
   * @returns {Object} - JSON-serializable object
   */
  toJSON() {
    return this.getDetails();
  }

  get npcIds() {
    return [...this.#npcIds];
  }

  get thingIds() {
    return [...this.#thingIds];
  }

  addNpcId(id) {
    if (!id || typeof id !== 'string') {
      return;
    }
    if (!this.#npcIds.includes(id)) {
      this.#npcIds.push(id);
      this.#lastUpdated = new Date();
    }
  }

  removeNpcId(id) {
    if (!id || typeof id !== 'string') {
      return false;
    }
    const before = this.#npcIds.length;
    this.#npcIds = this.#npcIds.filter(existing => existing !== id);
    if (this.#npcIds.length !== before) {
      this.#lastUpdated = new Date();
      return true;
    }
    return false;
  }

  setNpcIds(ids = []) {
    if (Array.isArray(ids)) {
      this.#npcIds = [...new Set(ids.filter(id => typeof id === 'string'))];
    } else {
      this.#npcIds = [];
    }
    this.#lastUpdated = new Date();
  }

  clearNpcIds() {
    this.#npcIds = [];
    this.#lastUpdated = new Date();
  }

  addThingId(id) {
    if (!id || typeof id !== 'string') {
      return;
    }
    if (!this.#thingIds.includes(id)) {
      this.#thingIds.push(id);
      this.#lastUpdated = new Date();
    }
  }

  removeThingId(id) {
    if (!id || typeof id !== 'string') {
      return false;
    }
    const before = this.#thingIds.length;
    this.#thingIds = this.#thingIds.filter(existing => existing !== id);
    if (this.#thingIds.length !== before) {
      this.#lastUpdated = new Date();
      return true;
    }
    return false;
  }

  setThingIds(ids = []) {
    if (Array.isArray(ids)) {
      this.#thingIds = [...new Set(ids.filter(id => typeof id === 'string'))];
    } else {
      this.#thingIds = [];
    }
    this.#lastUpdated = new Date();
  }

  clearThingIds() {
    if (this.#thingIds.length > 0) {
      this.#thingIds = [];
      this.#lastUpdated = new Date();
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
    this.#lastUpdated = new Date();
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
      this.#lastUpdated = new Date();
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
      this.#lastUpdated = new Date();
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
      this.#lastUpdated = new Date();
    }
  }

  clearExpiredStatusEffects() {
    const before = this.#statusEffects.length;
    this.#statusEffects = this.#statusEffects.filter(effect => !Number.isFinite(effect.duration) || effect.duration > 0);
    if (this.#statusEffects.length !== before) {
      this.#lastUpdated = new Date();
    }
  }

  /**
   * Create a string representation of the location
   * @returns {string} - String representation
   */
  toString() {
    const exitList = this.getAvailableDirections().join(', ') || 'no exits';
    return `Location(${this.#id}): "${this.#description}" [Level ${this.#baseLevel}, Exits: ${exitList}]`;
  }
}

module.exports = Location;
