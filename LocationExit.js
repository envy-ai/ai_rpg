const crypto = require('crypto');
const Globals = require('./Globals.js');

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
  #destinationRegion;
  #bidirectional;
  #isVehicle;
  #vehicleType;
  #imageId;
  #createdAt;
  #lastUpdated;

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
   * @param {string|null} [options.destinationRegion=null] - Region ID the exit leads to if it crosses regions
   * @param {boolean} [options.bidirectional=true] - Whether the exit works both ways (defaults to true)
   * @param {string} [options.id] - Custom ID (if not provided, one will be generated)
   * @param {string} [options.imageId] - Image ID for generated exit passage scene (defaults to null)
   */
  constructor({ description = '', destination, destinationRegion = null, bidirectional = true, id = null, imageId = null, isVehicle = false, vehicleType = null } = {}) {
    // Validate required parameters
    if (description !== undefined && typeof description !== 'string') {
      throw new Error('Exit description must be a string when provided');
    }

    if (!destination || typeof destination !== 'string') {
      console.log('Invalid destination provided to LocationExit:', destination);
      console.trace();
      throw new Error('Exit destination is required and must be a string');
    }

    if (typeof bidirectional !== 'boolean') {
      throw new Error('Bidirectional flag must be a boolean');
    }

    if (typeof isVehicle !== 'boolean') {
      throw new Error('isVehicle must be a boolean');
    }

    if (vehicleType !== null && typeof vehicleType !== 'string') {
      throw new Error('vehicleType must be a string or null');
    }

    // Initialize private fields
    this.#id = id || LocationExit.#generateId();
    this.#description = typeof description === 'string' ? description.trim() : '';
    this.#destination = destination.trim();
    this.#destinationRegion = destinationRegion && typeof destinationRegion === 'string' ? destinationRegion.trim() : null;
    this.#bidirectional = bidirectional;
    this.#imageId = imageId;
    this.#isVehicle = isVehicle;
    this.#vehicleType = vehicleType && typeof vehicleType === 'string' ? vehicleType.trim() || null : null;
    if (this.#vehicleType && !this.#isVehicle) {
      this.#isVehicle = true;
    }
    this.#createdAt = new Date();
    this.#lastUpdated = this.#createdAt;
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

  get destinationRegion() {
    const Location = require('./Location');
    const location = Location.get(this.#destination);
    if (location && location.regionId) {
      return location.regionId;
    }
    if (this.#destinationRegion) {
      return this.#destinationRegion;
    }
    const destinationName = location?.name || 'unknown';
    let originName = 'unknown';
    let originId = null;
    try {
      const locations = typeof Location.getAll === 'function'
        ? Location.getAll()
        : Array.from(Location.indexById.values());
      for (const loc of locations) {
        if (!loc || typeof loc.getAvailableDirections !== 'function' || typeof loc.getExit !== 'function') {
          continue;
        }
        const directions = loc.getAvailableDirections();
        for (const dir of directions) {
          const exit = loc.getExit(dir);
          if (!exit) {
            continue;
          }
          if (exit === this || exit.destination === this.#destination) {
            originName = loc.name || 'unknown';
            originId = loc.id || null;
            break;
          }
        }
        if (originId) {
          break;
        }
      }
    } catch (error) {
      console.warn(`Warning: Failed to resolve origin location for exit ${this.#id}: ${error.message}`);
    }
    const originLabel = originId ? `${originName} (${originId})` : originName;
    console.warn(`Warning: Unable to determine region for destination location ID ${this.#destination} (${destinationName}); origin: ${originLabel}`);
    console.trace();
    try {
      const locations = typeof Location.getAll === 'function'
        ? Location.getAll()
        : Array.from(Location.indexById.values());
      const removed = [];
      for (const loc of locations) {
        if (!loc || typeof loc.getAvailableDirections !== 'function' || typeof loc.getExit !== 'function' || typeof loc.removeExit !== 'function') {
          continue;
        }
        const directions = loc.getAvailableDirections();
        for (const direction of directions) {
          const exit = loc.getExit(direction);
          if (!exit || exit.destination !== this.#destination) {
            continue;
          }
          loc.removeExit(direction);
          removed.push({
            locationId: loc.id || null,
            locationName: loc.name || 'unknown',
            direction,
            exitId: exit.id || null
          });
        }
      }
      if (removed.length) {
        console.warn(`Removed ${removed.length} exit(s) pointing to missing destination ${this.#destination}.`, removed);
      }
    } catch (error) {
      console.warn(`Warning: Failed to remove invalid exits for destination ${this.#destination}: ${error.message}`);
    }
    return null;
  }

  /**
   * Attempt to resolve any pending region stub that this exit points to.
   * Uses the same matching heuristics as the server when wiring exits:
   *   1. Direct pending region id match (destinationRegion / stub id)
   *   2. Entrance stub id match
   *   3. Name-based matching against targetRegionName / originalName values
   * @returns {object|null} Pending stub record if one is found, otherwise null.
   */
  get associatedRegionStub() {
    try {
      // Lazy-load server state to avoid circular dependency issues at module load time.
      const serverExports = require('./server');
      const pendingRegionStubs = serverExports?.pendingRegionStubs;
      const gameLocations = serverExports?.gameLocations;

      if (!(pendingRegionStubs instanceof Map) || pendingRegionStubs.size === 0) {
        return null;
      }

      const directRegionId = this.#destinationRegion;
      if (directRegionId && pendingRegionStubs.has(directRegionId)) {
        return pendingRegionStubs.get(directRegionId);
      }

      const destinationLocation = (gameLocations && typeof gameLocations.get === 'function')
        ? gameLocations.get(this.#destination)
        : null;

      if (destinationLocation) {
        const entry = Array.from(pendingRegionStubs.values()).find(stub => stub?.entranceStubId === destinationLocation.id);
        if (entry) {
          return entry;
        }
      }

      const normalize = value => (typeof value === 'string' ? value.trim().toLowerCase() : null);

      const candidateNames = new Set();
      if (destinationLocation) {
        const meta = destinationLocation.stubMetadata || {};
        const locationNames = [meta.targetRegionName, meta.originalName, destinationLocation.name, meta.regionName];
        locationNames.map(normalize).filter(Boolean).forEach(name => candidateNames.add(name));
      }

      if (candidateNames.size === 0) {
        return null;
      }

      for (const stub of pendingRegionStubs.values()) {
        if (!stub) {
          continue;
        }

        const stubNames = [
          stub.originalName,
          stub.name,
          stub.targetRegionName,
          stub.targetRegionDescription,
          stub.description
        ].map(normalize).filter(Boolean);

        if (stubNames.some(name => candidateNames.has(name))) {
          return stub;
        }
      }

      return null;
    } catch (error) {
      console.warn(`Failed to resolve associated region stub for exit ${this.#id}:`, error.message);
      return null;
    }
  }

  /**
   * Resolve the region object this exit ultimately leads to. Falls back to the
   * pending region stub definition if the destination region has not been
   * generated yet.
   * @returns {object|null} Region instance when available, otherwise the
   *          pending stub record, or null if neither can be resolved.
   */
  get region() {
    try {
      const Location = require('./Location');
      const Region = require('./Region');

      const destinationLocation = Location.get(this.#destination);
      if (destinationLocation) {
        const region = destinationLocation.region
          || (destinationLocation.regionId ? Region.get(destinationLocation.regionId) : null);
        if (region) {
          return region;
        }
      }

      if (this.#destinationRegion) {
        const region = Region.get(this.#destinationRegion) || null;
        if (region) {
          return region;
        }
      }

      return this.associatedRegionStub || null;
    } catch (error) {
      console.warn(`Failed to resolve region for exit ${this.#id}:`, error.message);
      return null;
    }
  }

  /**
   * Resolve the destination location object for this exit. Attempts to locate a
   * fully instantiated Location first, and falls back to any pending stub
   * definition when necessary.
   * @returns {object|null} Location instance when available, otherwise a pending
   *          stub record (if one can be inferred), or null.
   */
  get location() {
    try {
      const Location = require('./Location');
      let destinationLocation = Location.get(this.#destination);
      if (destinationLocation) {
        return destinationLocation;
      }

      const serverExports = require('./server');
      const gameLocations = serverExports?.gameLocations;

      if (gameLocations && typeof gameLocations.get === 'function') {
        destinationLocation = gameLocations.get(this.#destination);
        if (destinationLocation) {
          return destinationLocation;
        }
      }

      const stub = this.associatedRegionStub;
      if (stub) {
        const candidateIds = [
          stub.entranceStubId,
          stub.entranceLocationId,
          stub.targetLocationId,
          stub.exitLocationId
        ].filter(id => typeof id === 'string' && id.trim());

        for (const candidateId of candidateIds) {
          const locationViaId = Location.get(candidateId)
            || (gameLocations && typeof gameLocations.get === 'function' ? gameLocations.get(candidateId) : null);
          if (locationViaId) {
            return locationViaId;
          }
        }

        if (gameLocations && typeof gameLocations.values === 'function') {
          const normalize = value => (typeof value === 'string' ? value.trim().toLowerCase() : null);
          const candidateNames = new Set([
            normalize(stub.originalName),
            normalize(stub.name),
            normalize(stub.targetRegionName),
            normalize(stub.description)
          ].filter(Boolean));

          if (candidateNames.size) {
            for (const locationCandidate of gameLocations.values()) {
              if (!locationCandidate) {
                continue;
              }
              const meta = locationCandidate.stubMetadata || {};
              const locationNames = [
                locationCandidate.name,
                meta.targetRegionName,
                meta.originalName,
                meta.regionName,
                meta.shortDescription
              ].map(normalize).filter(Boolean);
              if (locationNames.some(name => candidateNames.has(name))) {
                return locationCandidate;
              }
            }
          }
        }

        return stub;
      }

      return null;
    } catch (error) {
      console.warn(`Failed to resolve destination location for exit ${this.#id}:`, error.message);
      return null;
    }
  }

  /**
   * Resolve a human-readable name for this exit's destination. Prefers region
   * names when the exit leads to another region stub or fully realized region,
   * otherwise falls back to the destination location's name.
   * @returns {string|null}
   */
  get name() {
    const pickName = (entity) => {
      if (!entity || typeof entity !== 'object') {
        return null;
      }
      const candidates = [
        entity.name,
        entity.originalName,
        entity.targetRegionName,
        entity.description,
        entity.shortDescription,
        entity.stubMetadata?.targetRegionName,
        entity.stubMetadata?.shortDescription
      ];
      for (const value of candidates) {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed) {
            return trimmed;
          }
        }
      }
      return null;
    };

    try {
      const region = this.region;
      const regionName = pickName(region);
      if (regionName) {
        return regionName;
      }

      const location = this.location;
      const locationName = pickName(location);
      if (locationName) {
        return locationName;
      }

      if (typeof this.#description === 'string' && this.#description.trim()) {
        return this.#description.trim();
      }

      if (typeof this.#destination === 'string' && this.#destination.trim()) {
        return this.#destination.trim();
      }

      return null;
    } catch (error) {
      console.warn(`Failed to resolve destination name for exit ${this.#id}:`, error.message);
      return typeof this.#description === 'string' && this.#description.trim()
        ? this.#description.trim()
        : (this.#destination || null);
    }
  }

  get relativeName() {
    const name = this.name;
    if (!name) {
      return null;
    }

    const currentLocation = Globals.location;
    if (!currentLocation) {
      return name;
    }

    const currentRegion = currentLocation.region;
    const destinationRegion = this.region;

    if (destinationRegion && currentRegion && destinationRegion.id !== currentRegion.id) {
      return `${name} (in ${destinationRegion.name || 'another region'})`;
    }

    return name;
  }

  get bidirectional() {
    return this.#bidirectional;
  }

  get isVehicle() {
    return this.#isVehicle;
  }

  get vehicleType() {
    return this.#vehicleType;
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
  set description(newDescription) {
    if (newDescription !== undefined && newDescription !== null && typeof newDescription !== 'string') {
      throw new Error('Description must be a string');
    }
    this.#description = typeof newDescription === 'string' ? newDescription.trim() : '';
    this.#lastUpdated = new Date();
  }

  set destination(newDestination) {
    if (!newDestination || typeof newDestination !== 'string') {
      throw new Error('Destination must be a non-empty string');
    }
    this.#destination = newDestination.trim();
    this.#lastUpdated = new Date();
  }

  set destinationRegion(regionId) {
    /*
    if (regionId !== null && typeof regionId !== 'string') {
      throw new Error('Destination region must be a string or null');
    }
    this.#destinationRegion = regionId ? regionId.trim() || null : null;
    this.#lastUpdated = new Date();
    */
    // Destination region is now derived from the destination location, so this setter does nothing
    console.warn('Warning: destinationRegion is now derived from the destination location and cannot be set directly.');
    console.trace();
  }

  set bidirectional(isBidirectional) {
    if (typeof isBidirectional !== 'boolean') {
      throw new Error('Bidirectional flag must be a boolean');
    }
    this.#bidirectional = isBidirectional;
    this.#lastUpdated = new Date();
  }

  set imageId(newImageId) {
    if (newImageId !== null && typeof newImageId !== 'string') {
      throw new Error('Image ID must be a string or null');
    }
    this.#imageId = newImageId;
    this.#lastUpdated = new Date();
  }

  set isVehicle(flag) {
    if (typeof flag !== 'boolean') {
      throw new Error('isVehicle must be a boolean');
    }
    this.#isVehicle = flag;
    if (!flag) {
      this.#vehicleType = null;
    }
    this.#lastUpdated = new Date();
  }

  set vehicleType(type) {
    if (type !== null && typeof type !== 'string') {
      throw new Error('vehicleType must be a string or null');
    }
    const trimmed = typeof type === 'string' ? type.trim() : null;
    this.#vehicleType = trimmed || null;
    if (this.#vehicleType) {
      this.#isVehicle = true;
    }
    this.#lastUpdated = new Date();
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
   * @param {string|null} [updates.destinationRegion] - Region ID the exit leads to (for inter-region exits)
   * @param {boolean} [updates.bidirectional] - New bidirectional flag
   */
  update({ description, destination, destinationRegion, bidirectional, isVehicle, vehicleType } = {}) {
    if (description !== undefined) {
      this.description = description;
    }
    if (destination !== undefined) {
      this.destination = destination;
    }
    if (bidirectional !== undefined) {
      this.bidirectional = bidirectional;
    }
    if (isVehicle !== undefined) {
      this.isVehicle = isVehicle;
    }
    if (vehicleType !== undefined) {
      this.vehicleType = vehicleType;
    }
  }

  /**
   * Get a summary of the exit
   * @returns {Object} - Exit summary object
   */
  getSummary() {
    return this.getDetails();
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
      destinationRegion: this.#destinationRegion,
      name: this.name,
      bidirectional: this.#bidirectional,
      imageId: this.#imageId,
      isVehicle: this.#isVehicle,
      vehicleType: this.#vehicleType,
      type: this.#bidirectional ? 'two-way' : 'one-way',
      createdAt: this.#createdAt.toISOString(),
      lastUpdated: this.#lastUpdated.toISOString()
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
    const vehicleInfo = this.#isVehicle ? ` via ${this.#vehicleType || 'vehicle'}` : '';
    return `LocationExit(${this.#id}): "${this.#description}"${vehicleInfo} ${direction} ${this.#destination}`;
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
