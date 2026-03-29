class VehicleInfo {
  #terrainTypes;
  #icon;
  #currentDestination;
  #pendingDestination;
  #destinations;
  #ETA;
  #departureTime;
  #vehicleExitId;

  constructor({
    terrainTypes,
    icon = null,
    currentDestination = null,
    pendingDestination = null,
    destinations = [],
    ETA = null,
    departureTime = null,
    vehicleExitId = null
  } = {}) {
    this.terrainTypes = terrainTypes;
    this.icon = icon;
    this.destinations = destinations;
    this.currentDestination = currentDestination;
    this.pendingDestination = pendingDestination;
    this.ETA = ETA;
    this.departureTime = departureTime;
    this.vehicleExitId = vehicleExitId;
    this.#validateCrossFieldState();
  }

  static get PENDING_REGION_ROUTE_PREFIX() {
    return 'pending-region:';
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

  static #normalizeRouteComparisonText(value) {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  static buildPendingRegionPendingDestination(regionName) {
    const normalizedRegionName = VehicleInfo.#normalizeOptionalText(regionName, 'pending region route regionName');
    if (!normalizedRegionName) {
      throw new Error('VehicleInfo pending region route entries must include a region name');
    }
    return {
      rawText: `${normalizedRegionName}|`,
      regionName: normalizedRegionName,
      locationName: null,
      regionId: null,
      locationId: null
    };
  }

  static buildPendingRegionRouteEntry(regionName) {
    const pendingDestination = VehicleInfo.buildPendingRegionPendingDestination(regionName);
    return `${VehicleInfo.PENDING_REGION_ROUTE_PREFIX}${pendingDestination.regionName}`;
  }

  static parsePendingRegionRouteEntry(value) {
    const entry = typeof value === 'string' ? value.trim() : '';
    if (!entry || !entry.startsWith(VehicleInfo.PENDING_REGION_ROUTE_PREFIX)) {
      return null;
    }

    const regionName = entry.slice(VehicleInfo.PENDING_REGION_ROUTE_PREFIX.length).trim();
    if (!regionName) {
      throw new Error('VehicleInfo pending region route entries must include a region name');
    }

    const pendingDestination = VehicleInfo.buildPendingRegionPendingDestination(regionName);
    return {
      entry: VehicleInfo.buildPendingRegionRouteEntry(regionName),
      regionName: pendingDestination.regionName,
      comparisonName: VehicleInfo.#normalizeRouteComparisonText(pendingDestination.regionName),
      pendingDestination
    };
  }

  static #normalizeDestinationList(value) {
    if (value === null || value === undefined) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new Error('VehicleInfo destinations must be an array of route entry strings');
    }
    const normalized = [];
    for (const [index, entry] of value.entries()) {
      if (typeof entry !== 'string') {
        throw new Error(`VehicleInfo destinations[${index}] must be a string route entry`);
      }
      const trimmed = entry.trim();
      if (!trimmed) {
        throw new Error(`VehicleInfo destinations[${index}] cannot be empty`);
      }
      const pendingRegionRoute = VehicleInfo.parsePendingRegionRouteEntry(trimmed);
      normalized.push(pendingRegionRoute ? pendingRegionRoute.entry : trimmed);
    }
    return [...new Set(normalized)];
  }

  static #normalizePendingDestination(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('VehicleInfo pendingDestination must be an object or null');
    }

    const rawText = VehicleInfo.#normalizeOptionalText(value.rawText, 'pendingDestination.rawText');
    const regionName = VehicleInfo.#normalizeOptionalText(value.regionName, 'pendingDestination.regionName');
    const locationName = VehicleInfo.#normalizeOptionalText(value.locationName, 'pendingDestination.locationName');
    const regionId = VehicleInfo.#normalizeOptionalText(value.regionId, 'pendingDestination.regionId');
    const locationId = VehicleInfo.#normalizeOptionalText(value.locationId, 'pendingDestination.locationId');

    if (!rawText && !regionName && !locationName && !regionId && !locationId) {
      throw new Error('VehicleInfo pendingDestination must include at least one destination reference');
    }

    return {
      rawText,
      regionName,
      locationName,
      regionId,
      locationId
    };
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

  static #resolveRegionNameForLocationId(locationId) {
    const normalizedLocationId = VehicleInfo.#normalizeOptionalText(locationId, 'route target locationId');
    if (!normalizedLocationId) {
      return null;
    }

    const Location = require('./Location.js');
    const locationRecord = typeof Location.getById === 'function'
      ? Location.getById(normalizedLocationId)
      : null;
    const regionName = typeof locationRecord?.region?.name === 'string'
      ? locationRecord.region.name.trim()
      : '';
    return regionName || null;
  }

  static #resolveRegionNameForPendingDestination(pendingDestination) {
    const normalizedPendingDestination = VehicleInfo.#normalizePendingDestination(pendingDestination);
    if (!normalizedPendingDestination) {
      return null;
    }

    const explicitRegionName = VehicleInfo.#normalizeOptionalText(
      normalizedPendingDestination.regionName,
      'pendingDestination.regionName'
    );
    if (explicitRegionName) {
      return explicitRegionName;
    }

    const locationRegionName = VehicleInfo.#resolveRegionNameForLocationId(normalizedPendingDestination.locationId);
    if (locationRegionName) {
      return locationRegionName;
    }

    const regionId = VehicleInfo.#normalizeOptionalText(normalizedPendingDestination.regionId, 'pendingDestination.regionId');
    if (!regionId) {
      return null;
    }

    const Region = require('./Region.js');
    const regionRecord = typeof Region.get === 'function'
      ? Region.get(regionId)
      : null;
    const regionName = typeof regionRecord?.name === 'string'
      ? regionRecord.name.trim()
      : '';
    return regionName || null;
  }

  static destinationsContainRouteTarget(destinations, {
    locationId = null,
    regionName = null
  } = {}) {
    const normalizedDestinations = VehicleInfo.#normalizeDestinationList(destinations);
    if (!normalizedDestinations.length) {
      return false;
    }

    const normalizedLocationId = VehicleInfo.#normalizeOptionalText(locationId, 'route target locationId');
    if (normalizedLocationId && normalizedDestinations.includes(normalizedLocationId)) {
      return true;
    }

    const regionComparisonName = VehicleInfo.#normalizeRouteComparisonText(regionName);
    if (!regionComparisonName) {
      return false;
    }

    return normalizedDestinations.some(entry => {
      const pendingRegionRoute = VehicleInfo.parsePendingRegionRouteEntry(entry);
      return pendingRegionRoute?.comparisonName === regionComparisonName;
    });
  }

  static destinationsContainCurrentDestination(destinations, currentDestination = null) {
    const normalizedCurrentDestination = VehicleInfo.#normalizeOptionalText(currentDestination, 'currentDestination');
    if (!normalizedCurrentDestination) {
      return false;
    }

    return VehicleInfo.destinationsContainRouteTarget(destinations, {
      locationId: normalizedCurrentDestination,
      regionName: VehicleInfo.#resolveRegionNameForLocationId(normalizedCurrentDestination)
    });
  }

  static destinationsContainPendingDestination(destinations, pendingDestination = null) {
    const normalizedPendingDestination = VehicleInfo.#normalizePendingDestination(pendingDestination);
    if (!normalizedPendingDestination) {
      return false;
    }

    return VehicleInfo.destinationsContainRouteTarget(destinations, {
      locationId: normalizedPendingDestination.locationId,
      regionName: VehicleInfo.#resolveRegionNameForPendingDestination(normalizedPendingDestination)
    });
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
    const hasResolvedDestination = this.#currentDestination != null;
    const hasPendingDestination = this.#pendingDestination != null;

    if (!hasResolvedDestination && !hasPendingDestination && this.#ETA != null) {
      throw new Error('VehicleInfo ETA cannot be set when both currentDestination and pendingDestination are null');
    }
    if (!hasResolvedDestination && !hasPendingDestination && this.#departureTime != null) {
      throw new Error('VehicleInfo departureTime cannot be set when both currentDestination and pendingDestination are null');
    }
    if (hasResolvedDestination && hasPendingDestination) {
      throw new Error('VehicleInfo currentDestination and pendingDestination cannot both be set');
    }
    if (this.#ETA != null && this.#departureTime != null && this.#departureTime > this.#ETA) {
      throw new Error('VehicleInfo departureTime cannot be after ETA');
    }
    if (this.#currentDestination != null
      && this.#destinations.length > 0
      && !VehicleInfo.destinationsContainCurrentDestination(this.#destinations, this.#currentDestination)) {
      throw new Error('VehicleInfo currentDestination must be one of destinations when destinations is non-empty');
    }
    if (this.#pendingDestination != null
      && this.#destinations.length > 0
      && !VehicleInfo.destinationsContainPendingDestination(this.#destinations, this.#pendingDestination)) {
      throw new Error('VehicleInfo pendingDestination must resolve to one of destinations when destinations is non-empty');
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

  get pendingDestination() {
    if (!this.#pendingDestination) {
      return null;
    }
    return { ...this.#pendingDestination };
  }

  set pendingDestination(value) {
    this.#pendingDestination = VehicleInfo.#normalizePendingDestination(value);
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
      pendingDestination: this.#pendingDestination ? { ...this.#pendingDestination } : null,
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
      pendingDestination: data.pendingDestination ?? null,
      destinations: data.destinations ?? [],
      ETA: eta ?? null,
      departureTime: departureTime ?? null,
      vehicleExitId: vehicleExitId ?? null
    });
  }
}

module.exports = VehicleInfo;
