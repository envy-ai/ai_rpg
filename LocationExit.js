const crypto = require('crypto');

/**
 * LocationExit class for AI RPG
 * Represents an exit connection between locations
 * Uses ES13 syntax with private fields and modern JavaScript features
 */
class LocationExit {
  // Private fields - encapsulated state
  #id;
  #description;
  #destination;
  #bidirectional;
  #createdAt;

  // Static private method for generating unique IDs
  static #generateId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(6).toString('hex');
    return `exit_${timestamp}_${random}`;
  }

  /**
   * Creates a new LocationExit instance
   * @param {Object} options - Exit configuration
   * @param {string} options.description - Description of the exit
   * @param {string} options.destination - ID or reference to the destination location
   * @param {boolean} [options.bidirectional=true] - Whether the exit works both ways (defaults to true)
   * @param {string} [options.id] - Custom ID (if not provided, one will be generated)
   */
  constructor({ description, destination, bidirectional = true, id = null } = {}) {
    // Validate required parameters
    if (!description || typeof description !== 'string') {
      throw new Error('Exit description is required and must be a string');
    }

    if (!destination || typeof destination !== 'string') {
      throw new Error('Exit destination is required and must be a string');
    }

    if (typeof bidirectional !== 'boolean') {
      throw new Error('Bidirectional flag must be a boolean');
    }

    // Initialize private fields
    this.#id = id || LocationExit.#generateId();
    this.#description = description.trim();
    this.#destination = destination.trim();
    this.#bidirectional = bidirectional;
    this.#createdAt = new Date();
  }

  // Getters for accessing private fields
  get id() {
    return this.#id;
  }

  get description() {
    return this.#description;
  }

  get destination() {
    return this.#destination;
  }

  get bidirectional() {
    return this.#bidirectional;
  }

  get createdAt() {
    return new Date(this.#createdAt);
  }

  // Setters for modifying private fields
  set description(newDescription) {
    if (!newDescription || typeof newDescription !== 'string') {
      throw new Error('Description must be a non-empty string');
    }
    this.#description = newDescription.trim();
  }

  set destination(newDestination) {
    if (!newDestination || typeof newDestination !== 'string') {
      throw new Error('Destination must be a non-empty string');
    }
    this.#destination = newDestination.trim();
  }

  set bidirectional(isBidirectional) {
    if (typeof isBidirectional !== 'boolean') {
      throw new Error('Bidirectional flag must be a boolean');
    }
    this.#bidirectional = isBidirectional;
  }

  /**
   * Check if this exit allows travel in the opposite direction
   * @returns {boolean} - True if the exit is bidirectional
   */
  isReversible() {
    return this.#bidirectional;
  }

  /**
   * Create a reverse exit for bidirectional connections
   * @param {string} reverseDescription - Description for the reverse exit
   * @returns {LocationExit|null} - Reverse exit if bidirectional, null otherwise
   */
  createReverse(reverseDescription) {
    if (!this.#bidirectional) {
      return null;
    }

    if (!reverseDescription || typeof reverseDescription !== 'string') {
      throw new Error('Reverse description is required and must be a string');
    }

    // The reverse exit points back to where this exit came from
    // We don't know the source location ID, so this method would need to be called
    // with proper context or the source location ID should be stored
    return new LocationExit({
      description: reverseDescription.trim(),
      destination: 'source_location_id', // This would need to be provided by the caller
      bidirectional: true
    });
  }

  /**
   * Update the exit's properties
   * @param {Object} updates - Properties to update
   * @param {string} [updates.description] - New description
   * @param {string} [updates.destination] - New destination
   * @param {boolean} [updates.bidirectional] - New bidirectional flag
   */
  update({ description, destination, bidirectional } = {}) {
    if (description !== undefined) {
      this.description = description;
    }
    if (destination !== undefined) {
      this.destination = destination;
    }
    if (bidirectional !== undefined) {
      this.bidirectional = bidirectional;
    }
  }

  /**
   * Get a summary of the exit
   * @returns {Object} - Exit summary object
   */
  getSummary() {
    return {
      id: this.#id,
      description: this.#description,
      destination: this.#destination,
      bidirectional: this.#bidirectional,
      createdAt: this.#createdAt.toISOString()
    };
  }

  /**
   * Get detailed information about the exit
   * @returns {Object} - Detailed exit information
   */
  getDetails() {
    return {
      id: this.#id,
      description: this.#description,
      destination: this.#destination,
      bidirectional: this.#bidirectional,
      type: this.#bidirectional ? 'two-way' : 'one-way',
      createdAt: this.#createdAt.toISOString()
    };
  }

  /**
   * Convert exit to JSON representation
   * @returns {Object} - JSON-serializable object
   */
  toJSON() {
    return this.getDetails();
  }

  /**
   * Create a string representation of the exit
   * @returns {string} - String representation
   */
  toString() {
    const direction = this.#bidirectional ? '↔' : '→';
    return `LocationExit(${this.#id}): "${this.#description}" ${direction} ${this.#destination}`;
  }

  /**
   * Static method to create a pair of bidirectional exits
   * @param {Object} options - Configuration for the exit pair
   * @param {string} options.location1Id - ID of the first location
   * @param {string} options.location2Id - ID of the second location
   * @param {string} options.description1to2 - Description from location 1 to 2
   * @param {string} options.description2to1 - Description from location 2 to 1
   * @returns {Object} - Object with exit1to2 and exit2to1 properties
   */
  static createBidirectionalPair({ location1Id, location2Id, description1to2, description2to1 }) {
    if (!location1Id || !location2Id || !description1to2 || !description2to1) {
      throw new Error('All parameters are required for creating bidirectional exit pair');
    }

    const exit1to2 = new LocationExit({
      description: description1to2,
      destination: location2Id,
      bidirectional: true
    });

    const exit2to1 = new LocationExit({
      description: description2to1,
      destination: location1Id,
      bidirectional: true
    });

    return {
      exit1to2,
      exit2to1
    };
  }

  /**
   * Static method to create a one-way exit
   * @param {Object} options - Configuration for the one-way exit
   * @param {string} options.description - Description of the exit
   * @param {string} options.destination - Destination location ID
   * @returns {LocationExit} - One-way exit instance
   */
  static createOneWay({ description, destination }) {
    return new LocationExit({
      description,
      destination,
      bidirectional: false
    });
  }
}

module.exports = LocationExit;