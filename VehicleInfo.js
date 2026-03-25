class VehicleInfo {
  #terrainTypes;
  #icon;
  #currentDestination;
  #destinations;
  #ETA;
  #departureTime;
  #vehicleExitId;

  constructor({ terrainTypes, icon = null, currentDestination = null, destinations = [], ETA = null, departureTime = null, vehicleExitId = null } = {}) {
    this.terrainTypes = terrainTypes;
    this.icon = icon;
    this.destinations = destinations;
    this.currentDestination = currentDestination;
    this.ETA = ETA;
    this.departureTime = departureTime;
    this.vehicleExitId = vehicleExitId;
    this.#validateCrossFieldState();
  }

  static #normalizeTerrainTypes(value) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== 'string') {
      throw new Error('VehicleInfo terrainTypes must be a string or null');
    }
    const trimmed = value.trim();
    return trimmed || null;
  }

  static #normalizeOptionalText(value, fieldName) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== 'string') {
      throw new Error(`VehicleInfo ${fieldName} must be a string or null`);
    }
    const trimmed = value.trim();
    return trimmed || null;
  }

  static #normalizeDestinationList(value) {
    if (value === null || value === undefined) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new Error('VehicleInfo destinations must be an array of location IDs');
    }
    const normalized = [];
    for (const [index, entry] of value.entries()) {
      if (typeof entry !== 'string') {
        throw new Error(`VehicleInfo destinations[${index}] must be a string location ID`);
      }
      const trimmed = entry.trim();
      if (!trimmed) {
        throw new Error(`VehicleInfo destinations[${index}] cannot be empty`);
      }
      normalized.push(trimmed);
    }
    return [...new Set(normalized)];
  }

  static #normalizeEta(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error('VehicleInfo ETA must be a non-negative integer minute value or null');
    }
    return value;
  }

  static #normalizeDepartureTime(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error('VehicleInfo departureTime must be a non-negative integer minute value or null');
    }
    return value;
  }

  static #getElapsedTime() {
    const Globals = require('./Globals.js');
    const elapsedTime = Number.isFinite(Globals?.elapsedTime) ? Globals.elapsedTime : null;
    return Number.isInteger(elapsedTime) && elapsedTime >= 0 ? elapsedTime : null;
  }

  #hasStartedTrip() {
    if (typeof this.#ETA !== 'number' || typeof this.#departureTime !== 'number') {
      return false;
    }

    const elapsedTime = VehicleInfo.#getElapsedTime();
    if (typeof elapsedTime !== 'number') {
      return true;
    }

    return this.#departureTime <= elapsedTime;
  }

  #validateCrossFieldState() {
    if (this.#currentDestination == null && this.#ETA != null) {
      throw new Error('VehicleInfo ETA cannot be set when currentDestination is null');
    }
    if (this.#currentDestination == null && this.#departureTime != null) {
      throw new Error('VehicleInfo departureTime cannot be set when currentDestination is null');
    }
    if (this.#ETA != null && this.#departureTime != null && this.#departureTime > this.#ETA) {
      throw new Error('VehicleInfo departureTime cannot be after ETA');
    }
    if (this.#currentDestination != null && this.#destinations.length > 0 && !this.#destinations.includes(this.#currentDestination)) {
      throw new Error('VehicleInfo currentDestination must be one of destinations when destinations is non-empty');
    }
  }

  get terrainTypes() {
    return this.#terrainTypes;
  }

  set terrainTypes(value) {
    this.#terrainTypes = VehicleInfo.#normalizeTerrainTypes(value);
    this.#validateCrossFieldState();
  }

  get currentDestination() {
    return this.#currentDestination;
  }

  set currentDestination(value) {
    this.#currentDestination = VehicleInfo.#normalizeOptionalText(value, 'currentDestination');
    this.#validateCrossFieldState();
  }

  get destinations() {
    return [...this.#destinations];
  }

  set destinations(value) {
    this.#destinations = VehicleInfo.#normalizeDestinationList(value);
    this.#validateCrossFieldState();
  }

  get ETA() {
    return this.#ETA;
  }

  set ETA(value) {
    this.#ETA = VehicleInfo.#normalizeEta(value);
    this.#validateCrossFieldState();
  }

  get isUnderway() {
    if (!this.#hasStartedTrip()) {
      return false;
    }

    const elapsedTime = VehicleInfo.#getElapsedTime();
    if (typeof elapsedTime !== 'number') {
      return this.#ETA > this.#departureTime;
    }

    return this.#ETA > elapsedTime;
  }

  get hasArrived() {
    if (!this.#hasStartedTrip()) {
      return false;
    }

    const elapsedTime = VehicleInfo.#getElapsedTime();
    if (typeof elapsedTime !== 'number') {
      return false;
    }

    return elapsedTime >= this.#ETA;
  }

  get isArriving() {
    if (!this.hasArrived) {
      return false;
    }

    return this.#departureTime < this.#ETA;
  }

  get departureTime() {
    return this.#departureTime;
  }

  set departureTime(value) {
    this.#departureTime = VehicleInfo.#normalizeDepartureTime(value);
    this.#validateCrossFieldState();
  }

  get timeTraveled() {
    if (typeof this.#departureTime !== 'number') {
      return 0;
    }
    const elapsedTime = VehicleInfo.#getElapsedTime() ?? 0;
    return Math.max(0, elapsedTime - this.#departureTime);
  }

  get tripCompleteFraction() {
    if (typeof this.#departureTime !== 'number' || typeof this.#ETA !== 'number') {
      return 0;
    }
    const totalTripMinutes = this.#ETA - this.#departureTime;
    if (totalTripMinutes <= 0) {
      return 1;
    }
    const rawFraction = this.timeTraveled / totalTripMinutes;
    return Math.min(1, Math.max(0, rawFraction));
  }

  get vehicleExitId() {
    return this.#vehicleExitId;
  }

  set vehicleExitId(value) {
    this.#vehicleExitId = VehicleInfo.#normalizeOptionalText(value, 'vehicleExitId');
    this.#validateCrossFieldState();
  }

  get location() {
    if (!this.#vehicleExitId) {
      return null;
    }

    const Location = require('./Location.js');
    const locations = typeof Location.getAll === 'function' ? Location.getAll() : [];

    for (const sourceLocation of locations) {
      if (!sourceLocation
        || typeof sourceLocation.getAvailableDirections !== 'function'
        || typeof sourceLocation.getExit !== 'function') {
        continue;
      }

      const directions = sourceLocation.getAvailableDirections();
      for (const direction of directions) {
        const exit = sourceLocation.getExit(direction);
        if (!exit || exit.id !== this.#vehicleExitId) {
          continue;
        }
        const resolvedLocation = exit.location;
        if (!resolvedLocation) {
          throw new Error(`VehicleInfo vehicleExitId "${this.#vehicleExitId}" resolved to an exit with no destination location.`);
        }
        return resolvedLocation;
      }
    }

    throw new Error(`VehicleInfo vehicleExitId "${this.#vehicleExitId}" could not be resolved to an existing exit.`);
  }

  get icon() {
    return this.#icon;
  }

  set icon(value) {
    this.#icon = VehicleInfo.#normalizeOptionalText(value, 'icon');
    this.#validateCrossFieldState();
  }

  toJSON() {
    return {
      terrainTypes: this.#terrainTypes,
      icon: this.#icon,
      currentDestination: this.#currentDestination,
      destinations: [...this.#destinations],
      ETA: this.#ETA,
      departureTime: this.#departureTime,
      vehicleExitId: this.#vehicleExitId
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('VehicleInfo.fromJSON requires an object');
    }
    if (Object.prototype.hasOwnProperty.call(data, 'destination') || Object.prototype.hasOwnProperty.call(data, 'destinationType')) {
      throw new Error('Legacy VehicleInfo fields "destination"/"destinationType" are no longer supported');
    }

    const eta = Object.prototype.hasOwnProperty.call(data, 'ETA')
      ? data.ETA
      : data.eta;
    const departureTime = Object.prototype.hasOwnProperty.call(data, 'departureTime')
      ? data.departureTime
      : data.departure_time;
    const vehicleExitId = Object.prototype.hasOwnProperty.call(data, 'vehicleExitId')
      ? data.vehicleExitId
      : data.vehicleExitID;

    return new VehicleInfo({
      terrainTypes: data.terrainTypes,
      icon: data.icon ?? null,
      currentDestination: data.currentDestination ?? null,
      destinations: data.destinations ?? [],
      ETA: eta ?? null,
      departureTime: departureTime ?? null,
      vehicleExitId: vehicleExitId ?? null
    });
  }
}

module.exports = VehicleInfo;
