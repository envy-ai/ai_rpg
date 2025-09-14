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
  constructor({ name, description, thingType, id = null, imageId = null } = {}) {
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
    this.#createdAt = new Date().toISOString();
    this.#lastUpdated = this.#createdAt;

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
      lastUpdated: this.#lastUpdated
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid data provided to Thing.fromJSON');
    }

    return new Thing({
      id: data.id,
      name: data.name,
      description: data.description,
      thingType: data.thingType,
      imageId: data.imageId
    });
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