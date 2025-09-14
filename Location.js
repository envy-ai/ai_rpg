const crypto = require('crypto');
const { DOMParser } = require('xmldom');

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
  #imageId;
  #createdAt;
  #lastUpdated;
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
  constructor({ description, baseLevel = 1, id = null, imageId = null, name = null } = {}) {
    // Validate required parameters
    if (!description || typeof description !== 'string') {
      throw new Error('Location description is required and must be a string');
    }

    if (typeof baseLevel !== 'number' || baseLevel < 1) {
      throw new Error('Base level must be a positive number');
    }

    // Initialize private fields
    this.#id = id || Location.#generateId();
    this.#description = description.trim();
    this.#name = name ? name.trim() : null;
    this.#baseLevel = Math.floor(baseLevel); // Ensure integer
    this.#exits = new Map(); // Map of direction -> LocationExit
    this.#imageId = imageId;
    this.#createdAt = new Date();
    this.#lastUpdated = this.#createdAt;

    // Index by ID and name if provided
    Location.#indexByID.set(this.#id, this);
    if (this.#name) {
      Location.#indexByName.set(this.#name.toLowerCase(), this);
    }
  }

  static fromXMLSnippet(xmlSnippet) {
    console.log('🔍 Parsing XML snippet (length:', xmlSnippet.length, 'chars)');

    // Strip any text outside the <location> tags and extract just the location XML
    const locationMatch = xmlSnippet.match(/<location>[\s\S]*?<\/location>/);
    const strippedXML = locationMatch ? locationMatch[0] : xmlSnippet;

    console.log('Extracted XML:', strippedXML);

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
      if (child.nodeType === 1) {
        const value = child.textContent.trim();

        // Convert baseLevel to number
        if (child.tagName === 'baseLevel') {
          locationData[child.tagName] = parseInt(value, 10);
        } else {
          locationData[child.tagName] = value;
        }
      }
    }

    console.log('Successfully parsed location data:', locationData);

    return new Location({
      description: locationData.description,
      baseLevel: locationData.baseLevel,
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

    Location.#indexByName.delete(this.#name.toLowerCase());
    this.#name = newName;
    Location.#indexByName.set(this.#name.toLowerCase(), this);
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
      imageId: this.#imageId,
      exitCount: this.#exits.size,
      availableDirections: this.getAvailableDirections(),
      createdAt: this.#createdAt.toISOString(),
      lastUpdated: this.#lastUpdated.toISOString()
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
      exits: exits,
      createdAt: this.#createdAt.toISOString(),
      lastUpdated: this.#lastUpdated.toISOString()
    };
  }

  /**
   * Convert location to JSON representation
   * @returns {Object} - JSON-serializable object
   */
  toJSON() {
    return this.getDetails();
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
