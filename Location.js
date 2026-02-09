const crypto = require('crypto');
const Player = require('./Player.js');
const Utils = require('./Utils.js');
const StatusEffect = require('./StatusEffect.js');
const Region = require('./Region.js');
const Globals = require('./Globals.js');


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
  #shortDescription;
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
  #generationHints;
  #randomEvents;
  #regionId;
  #controllingFactionId;
  #lastVisitedTime = null; // Decimal hour timestamp of last visit by player
  #characterConcepts = [];
  #enemyConcepts = [];

  static #indexById = new Map();
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
  constructor({ description, shortDescription = null, baseLevel = 1, id = null, imageId = null, name = null, isStub = false, stubMetadata = null, hasGeneratedStubs = false, statusEffects = [], npcIds = [], thingIds = [], generationHints = null, randomEvents = [], regionId = null, controllingFactionId = null, checkRegionId = true, lastVisitedTime = null, characterConcepts = [], enemyConcepts = [] } = {}) {
    const creatingStub = Boolean(isStub);

    if (!creatingStub) {
      if (!description || typeof description !== 'string') {
        throw new Error('Location description is required and must be a string');
      }

      if (typeof baseLevel !== 'number' || baseLevel < 1) {
        throw new Error('Base level must be a positive number');
      }
    }

    if (!regionId || typeof regionId !== 'string') {
      throw new Error('Location initialized without regionId');
    }

    if (controllingFactionId !== null && controllingFactionId !== undefined && typeof controllingFactionId !== 'string') {
      throw new Error('Location controllingFactionId must be a string or null');
    }

    if (shortDescription !== null && shortDescription !== undefined && typeof shortDescription !== 'string') {
      throw new Error('Location shortDescription must be a string or null');
    }

    // Verify region exists
    if (checkRegionId) {
      const region = Region.get(regionId);
      if (!region) {
        console.trace();
        throw new Error('Location initialized with invalid regionId: ' + regionId);
      }
    }

    // Initialize private fields
    this.#id = id || Location.#generateId();
    this.#description = description && typeof description === 'string' ? description.trim() : null;
    const normalizedShortDescription = typeof shortDescription === 'string' ? shortDescription.trim() : null;
    let resolvedStubMetadata = creatingStub && stubMetadata ? { ...stubMetadata } : creatingStub ? {} : null;
    let resolvedShortDescription = normalizedShortDescription;
    if (creatingStub && !resolvedShortDescription) {
      const stubShort = typeof resolvedStubMetadata?.stubShortDescription === 'string'
        ? resolvedStubMetadata.stubShortDescription.trim()
        : '';
      const legacyShort = typeof resolvedStubMetadata?.shortDescription === 'string'
        ? resolvedStubMetadata.shortDescription.trim()
        : '';
      resolvedShortDescription = stubShort || legacyShort || null;
    }
    if (creatingStub && resolvedShortDescription) {
      if (!resolvedStubMetadata) {
        resolvedStubMetadata = {};
      }
      if (!resolvedStubMetadata.stubShortDescription || !String(resolvedStubMetadata.stubShortDescription).trim()) {
        resolvedStubMetadata.stubShortDescription = resolvedShortDescription;
      }
      if (!resolvedStubMetadata.shortDescription || !String(resolvedStubMetadata.shortDescription).trim()) {
        resolvedStubMetadata.shortDescription = resolvedShortDescription;
      }
    }
    this.#shortDescription = resolvedShortDescription || null;
    this.#name = name && typeof name === 'string' ? name.trim() : null;
    this.#baseLevel = creatingStub ? (typeof baseLevel === 'number' ? Math.floor(baseLevel) : null) : Math.floor(baseLevel);
    this.#exits = new Map(); // Map of direction -> LocationExit
    this.#imageId = imageId;
    this.#createdAt = new Date();
    this.#lastUpdated = this.#createdAt;
    this.#isStub = creatingStub;
    this.#regionId = regionId;
    this.#controllingFactionId = typeof controllingFactionId === 'string' && controllingFactionId.trim()
      ? controllingFactionId.trim()
      : null;
    this.#visited = false;
    this.#stubMetadata = resolvedStubMetadata;
    this.#hasGeneratedStubs = Boolean(hasGeneratedStubs);
    this.#npcIds = Array.isArray(npcIds)
      ? [...new Set(npcIds.filter(id => typeof id === 'string'))]
      : [];
    this.#thingIds = Array.isArray(thingIds)
      ? [...new Set(thingIds.filter(id => typeof id === 'string'))]
      : [];
    this.#statusEffects = this.#normalizeStatusEffects(statusEffects);
    this.#generationHints = Location.#normalizeGenerationHints(generationHints);
    this.#randomEvents = Location.#normalizeRandomEvents(randomEvents);
    this.#lastVisitedTime = Number.isFinite(lastVisitedTime) ? lastVisitedTime : null;
    this.#characterConcepts = Array.isArray(characterConcepts) ? [...characterConcepts] : [];
    this.#enemyConcepts = Array.isArray(enemyConcepts) ? [...enemyConcepts] : [];

    // Index by ID and name if provided
    Location.#indexById.set(this.#id, this);
    if (this.#name) {
      Location.#indexByName.set(this.#name.toLowerCase(), this);
    }

    if (checkRegionId) {
      this.region.addLocation(this.#id);
    }
  }

  static fromXMLSnippet(xmlSnippet, options = {}) {
    const {
      existingLocation = null,
      allowRename = true,
      baseLevelFallback = null,
      relativeLevelBase = null,
      regionId = null
    } = options || {};

    //console.log('🔍 Parsing XML snippet (length:', xmlSnippet.length, 'chars)');

    // Strip any text outside the <location> tags and extract just the location XML
    const locationMatch = xmlSnippet.match(/<location>[\s\S]*?<\/location>/);
    const strippedXML = locationMatch ? locationMatch[0] : xmlSnippet;

    //console.log('Extracted XML:', strippedXML);

    const xmlDoc = Utils.parseXmlDocument(strippedXML, 'text/xml');

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
    const parseBooleanText = (rawValue, fieldName) => {
      const lowered = String(rawValue || '').trim().toLowerCase();
      if (!lowered) {
        return null;
      }
      if (['true', '1', 'yes'].includes(lowered)) {
        return true;
      }
      if (['false', '0', 'no'].includes(lowered)) {
        return false;
      }
      throw new Error(`Invalid boolean value for ${fieldName}: "${rawValue}"`);
    };

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

        // Convert numeric fields to numbers
        if (child.tagName === 'relativeLevel') {
          locationData[child.tagName] = parseInt(value, 0);
        } else if (child.tagName === 'numItems' || child.tagName === 'numScenery' || child.tagName === 'numNpcs' || child.tagName === 'numHostiles') {
          locationData[child.tagName] = parseInt(value, 0);
        } else if (child.tagName === 'hasWeather') {
          locationData[child.tagName] = parseBooleanText(value, 'location.hasWeather');
        } else {
          locationData[child.tagName] = value;
        }
      }
    }

    //console.log('Successfully parsed location data:', locationData);

    const randomEventsNode = locationElem.getElementsByTagName('randomStoryEvents')?.[0] || null;
    const extractedRandomEvents = randomEventsNode
      ? Array.from(randomEventsNode.getElementsByTagName('event'))
        .map(node => (node.textContent || '').trim())
        .filter(Boolean)
      : [];
    const randomEvents = Location.#normalizeRandomEvents(extractedRandomEvents);
    const randomEventsProvided = Boolean(randomEventsNode);

    const stubMetadata = existingLocation?.stubMetadata || {};
    const rawStubDescription = typeof stubMetadata.stubDescription === 'string' && stubMetadata.stubDescription.trim()
      ? stubMetadata.stubDescription.trim()
      : null;
    const stubDescription = rawStubDescription
      || (typeof stubMetadata.blueprintDescription === 'string' && stubMetadata.blueprintDescription.trim()
        ? stubMetadata.blueprintDescription.trim()
        : null)
      || (typeof stubMetadata.shortDescription === 'string' && stubMetadata.shortDescription.trim()
        ? stubMetadata.shortDescription.trim()
        : null)
      || (typeof existingLocation?.description === 'string' && existingLocation.description.trim()
        ? existingLocation.description.trim()
        : null)
      || (typeof existingLocation?.shortDescription === 'string' && existingLocation.shortDescription.trim()
        ? existingLocation.shortDescription.trim()
        : null);
    const stubShortDescription = (() => {
      if (typeof stubMetadata.stubShortDescription === 'string' && stubMetadata.stubShortDescription.trim()) {
        return stubMetadata.stubShortDescription.trim();
      }
      if (rawStubDescription) {
        const candidate = typeof stubMetadata.shortDescription === 'string' ? stubMetadata.shortDescription.trim() : '';
        if (candidate) {
          return candidate;
        }
        const fallback = typeof existingLocation?.shortDescription === 'string' ? existingLocation.shortDescription.trim() : '';
        if (fallback) {
          return fallback;
        }
      }
      return null;
    })();
    const stubRelativeLevel = Number.isFinite(stubMetadata.relativeLevel) ? stubMetadata.relativeLevel : null;
    const stubBaseLevel = Number.isFinite(existingLocation?.baseLevel)
      ? existingLocation.baseLevel
      : (Number.isFinite(stubMetadata.computedBaseLevel) ? stubMetadata.computedBaseLevel : null);
    const stubNumNpcs = existingLocation?.generationHints?.numNpcs ?? stubMetadata.numNpcs ?? null;
    const stubNumHostiles = existingLocation?.generationHints?.numHostiles ?? stubMetadata.numHostiles ?? null;

    const normalizeAuthoritativeText = (value) => {
      if (typeof value !== 'string') {
        return '';
      }
      return value.replace(/\s+/g, ' ').trim();
    };

    const enforceAuthoritativeText = (fieldLabel, stubValue) => {
      if (!stubValue) {
        return;
      }
      const aiValue = typeof locationData[fieldLabel] === 'string'
        ? locationData[fieldLabel].trim()
        : '';
      const normalizedAi = normalizeAuthoritativeText(aiValue);
      const normalizedStub = normalizeAuthoritativeText(stubValue);
      if (aiValue && normalizedAi !== normalizedStub) {
        if (normalizedAi.startsWith(normalizedStub)) {
          console.warn(`Stub expansion expanded ${fieldLabel}; accepting AI text.`);
          locationData[fieldLabel] = aiValue;
          return;
        }
        console.warn(`Stub expansion returned ${fieldLabel} "${aiValue}" but stub requires "${stubValue}". Using stub value.`);
      }
      locationData[fieldLabel] = stubValue;
    };

    const enforceAuthoritativeNumber = (fieldLabel, stubValue) => {
      if (!Number.isFinite(stubValue)) {
        return;
      }
      const aiValue = Number.isFinite(locationData[fieldLabel]) ? locationData[fieldLabel] : null;
      if (Number.isFinite(aiValue) && aiValue !== stubValue) {
        console.warn(`Stub expansion returned ${fieldLabel} ${aiValue} but stub requires ${stubValue}. Using stub value.`);
      }
      locationData[fieldLabel] = stubValue;
    };

    if (existingLocation) {
      enforceAuthoritativeText('shortDescription', stubShortDescription);
      enforceAuthoritativeText('description', stubDescription);
      enforceAuthoritativeNumber('relativeLevel', stubRelativeLevel);
      enforceAuthoritativeNumber('baseLevel', stubBaseLevel);
      enforceAuthoritativeNumber('numNpcs', stubNumNpcs);
      enforceAuthoritativeNumber('numHostiles', stubNumHostiles);
    }

    const parsedShortDescription = typeof locationData.shortDescription === 'string'
      ? locationData.shortDescription.trim()
      : '';
    const hasShortDescription = Boolean(parsedShortDescription);
    if (!hasShortDescription) {
      const locationName = locationData.name
        || existingLocation?.name
        || existingLocation?.id
        || 'unknown';
      console.warn(`[Location.fromXMLSnippet] Missing <shortDescription> for location "${locationName}".`);
    }

    if (existingLocation) {
      if (!locationData.description || typeof locationData.description !== 'string') {
        console.log('Stub expansion missing description in AI response');
        const fallbackDescription = existingLocation.description
          || existingLocation.stubMetadata?.shortDescription
          || existingLocation.name
          || 'No description available.';
        locationData.description = fallbackDescription;
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

      parsedBaseLevel = Math.max(1, Math.round(parsedBaseLevel || 1));

      if (!parsedBaseLevel) {
        throw new Error('Stub expansion missing valid base level in AI response');
      }

      const existingHints = existingLocation?.generationHints || {};
      const stubHints = existingLocation?.stubMetadata || {};
      const resolveHint = (...values) => {
        for (const value of values) {
          if (value === null || value === undefined || value === '') {
            continue;
          }
          const numeric = Number(value);
          if (Number.isFinite(numeric)) {
            return numeric;
          }
        }
        return null;
      };
      const resolveHintPreserveExisting = (parsedValue, existingValue, stubValue) => {
        const preserved = resolveHint(existingValue, stubValue);
        if (preserved !== null) {
          return preserved;
        }
        return resolveHint(parsedValue);
      };
      const resolveBooleanHint = (...values) => {
        for (const value of values) {
          if (typeof value === 'boolean') {
            return value;
          }
          if (typeof value === 'string') {
            const lowered = value.trim().toLowerCase();
            if (['true', '1', 'yes'].includes(lowered)) {
              return true;
            }
            if (['false', '0', 'no'].includes(lowered)) {
              return false;
            }
          }
        }
        return null;
      };

      const promotionData = {
        description: locationData.description,
        shortDescription: hasShortDescription ? parsedShortDescription : undefined,
        baseLevel: parsedBaseLevel,
        generationHints: {
          numItems: resolveHint(locationData.numItems, existingHints.numItems, stubHints.numItems),
          numScenery: resolveHint(locationData.numScenery, existingHints.numScenery, stubHints.numScenery),
          numNpcs: resolveHintPreserveExisting(locationData.numNpcs, existingHints.numNpcs, stubHints.numNpcs),
          numHostiles: resolveHintPreserveExisting(locationData.numHostiles, existingHints.numHostiles, stubHints.numHostiles),
          hasWeather: resolveBooleanHint(locationData.hasWeather, existingHints.hasWeather, stubHints.hasWeather, stubHints.locationHasWeather)
        },
        randomEvents: randomEventsProvided ? randomEvents : undefined,
        npcIds: existingLocation.npcIds,
        thingIds: existingLocation.thingIds
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
        if (hasShortDescription) {
          existingLocation.shortDescription = parsedShortDescription;
        }
        existingLocation.baseLevel = promotionData.baseLevel;
      }

      if (randomEventsProvided) {
        existingLocation.randomEvents = randomEvents;
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

    baseLevel = Math.max(1, Math.round(baseLevel));

    return new Location({
      description: locationData.description,
      shortDescription: hasShortDescription ? parsedShortDescription : null,
      baseLevel,
      name: locationData.name,
      regionId: regionId,
      generationHints: {
        numItems: locationData.numItems,
        numScenery: locationData.numScenery,
        numNpcs: locationData.numNpcs,
        numHostiles: locationData.numHostiles,
        hasWeather: typeof locationData.hasWeather === 'boolean' ? locationData.hasWeather : null
      },
      randomEvents
    });
  }

  get regionId() {
    return this.#regionId;
  }

  set regionId(newRegionId) {
    if (!newRegionId || typeof newRegionId !== 'string') {
      throw new Error('Region ID must be a non-empty string');
    }
    const region = Region.get(newRegionId);
    if (!region) {
      throw new Error('Invalid region ID: ' + newRegionId);
    }
    this.#regionId = newRegionId;
    this.#lastUpdated = new Date();
  }

  get region() {
    return Region.get(this.#regionId) || null;
  }

  get controllingFactionId() {
    return this.#controllingFactionId;
  }

  set controllingFactionId(value) {
    if (value === null || value === undefined || value === '') {
      if (this.#controllingFactionId !== null) {
        this.#controllingFactionId = null;
        this.#lastUpdated = new Date();
      }
      return;
    }
    if (typeof value !== 'string') {
      throw new Error('Location controllingFactionId must be a string or null.');
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('Location controllingFactionId must be a non-empty string or null.');
    }
    this.#controllingFactionId = trimmed;
    this.#lastUpdated = new Date();
  }

  static get(locationId) {
    if (!locationId || typeof locationId !== 'string') {
      return null;
    }
    return Location.#indexById.get(locationId) || null;
  }

  // Alias for consistency
  static getById(id) {
    return Location.get(id);
  }

  // Alias for consistency
  static getByName(name) {
    return Location.findByName(name);
  }

  static get indexById() {
    return new Map(Location.#indexById);
  }

  static get indexByName() {
    return new Map(Location.#indexByName);
  }

  static getAll() {
    return Array.from(Location.#indexById.values());
  }

  /**
   * Remove a location from internal id/name indices.
   * Useful when deleting stubs so stale lookups do not linger.
   */
  static removeFromIndex(locationOrId) {
    if (!locationOrId) {
      return;
    }
    const id = typeof locationOrId === 'string' ? locationOrId : locationOrId.id;
    if (id) {
      Location.#indexById.delete(id);
    }
    const name = typeof locationOrId === 'object' ? locationOrId.name : null;
    if (name && typeof name === 'string') {
      Location.#indexByName.delete(name.toLowerCase());
    }
  }

  static findByName(name) {
    if (!name || typeof name !== 'string') {
      return null;
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

  set lastVisitedTime(value) {
    if (value === null || value === undefined) {
      this.#lastVisitedTime = null;
      this.#lastUpdated = new Date().toISOString();
      return;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      throw new Error('Location lastVisitedTime must be a non-negative number or null');
    }
    this.#lastVisitedTime = num;
    this.region.lastVisitedTime = num;
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

  get description() {
    return this.#description;
  }

  get shortDescription() {
    return this.#shortDescription;
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
    this.#description = newDescription.trim();
    this.#lastUpdated = new Date();
  }

  set shortDescription(newShortDescription) {
    if (newShortDescription === null || newShortDescription === undefined) {
      this.#shortDescription = null;
      this.#lastUpdated = new Date();
      return;
    }
    if (typeof newShortDescription !== 'string') {
      throw new Error('Location shortDescription must be a string or null');
    }
    const trimmed = newShortDescription.trim();
    this.#shortDescription = trimmed || null;
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

  promoteFromStub({ name, description, shortDescription, baseLevel, imageId, generationHints, randomEvents, npcIds, thingIds } = {}) {
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
    if (typeof shortDescription === 'string' && shortDescription.trim()) {
      this.shortDescription = shortDescription.trim();
    }
    this.baseLevel = baseLevel;
    if (imageId !== undefined) {
      this.imageId = imageId;
    }
    if (generationHints !== undefined) {
      this.generationHints = generationHints;
    }
    if (randomEvents !== undefined) {
      this.randomEvents = randomEvents;
    }
    this.#isStub = false;
    this.#stubMetadata = null;
    this.#hasGeneratedStubs = false;
    this.setNpcIds(npcIds);
    this.setThingIds(thingIds);
  }

  get generationHints() {
    if (!this.#generationHints) {
      return {
        numItems: null,
        numScenery: null,
        numNpcs: null,
        numHostiles: null,
        hasWeather: null
      };
    }
    return { ...this.#generationHints };
  }

  set generationHints(hints) {
    this.#generationHints = Location.#normalizeGenerationHints(hints);
    this.#lastUpdated = new Date();
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
      shortDescription: this.#shortDescription,
      baseLevel: this.#baseLevel,
      visited: this.#visited,
      imageId: this.#imageId,
      regionId: this.#regionId,
      controllingFactionId: this.#controllingFactionId,
      exitCount: this.#exits.size,
      availableDirections: this.getAvailableDirections(),
      createdAt: this.#createdAt.toISOString(),
      lastUpdated: this.#lastUpdated.toISOString(),
      isStub: this.#isStub,
      hasGeneratedStubs: this.#hasGeneratedStubs,
      stubMetadata: this.#stubMetadata ? { ...this.#stubMetadata } : null,
      npcIds: [...this.#npcIds],
      thingIds: [...this.#thingIds],
      statusEffects: this.getStatusEffects(),
      randomEvents: this.randomEvents,
      characterConcepts: this.characterConcepts,
      enemyConcepts: this.enemyConcepts
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
        destinationRegion: Globals.locationById(exit.destination)?.region?.id,
        bidirectional: exit.bidirectional !== false,
        isVehicle: Boolean(exit.isVehicle),
        name: exit.name,
        relativeName: exit.relativeName,
        vehicleType: typeof exit.vehicleType === 'string' ? exit.vehicleType : null,
        exitObject: exit.toJSON()
      };
    }

    return {
      id: this.#id,
      name: this.#name,
      description: this.#description,
      shortDescription: this.#shortDescription,
      baseLevel: this.#baseLevel,
      imageId: this.#imageId,
      visited: this.#visited,
      exits: exits,
      regionId: this.#regionId,
      controllingFactionId: this.#controllingFactionId,
      createdAt: this.#createdAt.toISOString(),
      lastUpdated: this.#lastUpdated.toISOString(),
      isStub: this.#isStub,
      hasGeneratedStubs: this.#hasGeneratedStubs,
      stubMetadata: this.#stubMetadata ? { ...this.#stubMetadata } : null,
      npcIds: [...this.#npcIds],
      thingIds: [...this.#thingIds],
      randomEvents: this.randomEvents,
      statusEffects: this.getStatusEffects(),
      characterConcepts: this.characterConcepts,
      enemyConcepts: this.enemyConcepts
    };
  }

  get randomEvents() {
    return [...this.#randomEvents];
  }

  set randomEvents(events) {
    this.#randomEvents = Location.#normalizeRandomEvents(events);
    this.#lastUpdated = new Date();
  }

  addRandomEvent(event) {
    if (typeof event !== 'string') {
      return false;
    }
    const trimmed = event.trim();
    if (!trimmed) {
      return false;
    }
    this.#randomEvents.push(trimmed);
    this.#lastUpdated = new Date();
    return true;
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
      this.#lastUpdated = new Date();
    }

    return removed;
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

  getNPCNames() {
    const names = [];
    let npcs = this.getNPCs();
    npcs = npcs.filter(npc => npc && npc.name);
    for (const npc of npcs) {
      names.push(npc.name);
    }
    return names;
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

  get npcs() {
    return this.getNPCs();
  }

  get thingIds() {
    return [...this.#thingIds];
  }

  get things() {
    const Thing = require('./Thing.js');
    const things = [];
    for (const thingId of this.#thingIds) {
      const thing = Thing.getById(thingId);
      if (thing) {
        things.push(thing);
      } else {
        console.warn(`Thing with ID ${thingId} not found in Thing index`);
      }
    }
    return things;
  }

  // Get things, then filter by type
  get items() {
    return this.things.filter(thing => thing.thingType === 'item');
  }

  get scenery() {
    return this.things.filter(thing => thing.thingType === 'scenery');
  }

  get characterConcepts() {
    return [...this.#characterConcepts];
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

    const Thing = require('./Thing.js');
    Thing.removeFromWorldById(id);
    this.#thingIds.push(id);
    this.#lastUpdated = new Date();

    const thing = Thing.getById(id);
    if (thing) {
      const metadata = thing.metadata || {};
      let metadataChanged = false;
      const locationId = this.#id;
      const existingLocationId = typeof metadata.locationId === 'string' ? metadata.locationId.trim() : null;
      if (locationId && existingLocationId !== locationId) {
        metadata.locationId = locationId;
        metadataChanged = true;
      }
      const cleanupKeys = ['locationID', 'location_id'];
      for (const key of cleanupKeys) {
        if (metadata[key] !== undefined) {
          delete metadata[key];
          metadataChanged = true;
        }
      }
      const ownerKeys = ['ownerId', 'ownerID', 'owner_id', 'playerId', 'inventoryOwnerId'];
      for (const key of ownerKeys) {
        if (metadata[key] !== undefined) {
          delete metadata[key];
          metadataChanged = true;
        }
      }
      if (metadata.owner !== undefined) {
        delete metadata.owner;
        metadataChanged = true;
      }
      if (metadataChanged) {
        thing.metadata = metadata;
      }
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
      const Thing = require('./Thing.js');
      const thing = Thing.getById(id);
      if (thing) {
        const metadata = thing.metadata || {};
        let metadataChanged = false;
        const locationId = this.#id;
        const currentLocationId = typeof metadata.locationId === 'string' ? metadata.locationId.trim() : null;
        if (currentLocationId && currentLocationId === locationId) {
          delete metadata.locationId;
          metadataChanged = true;
        }
        const cleanupKeys = ['locationID', 'location_id'];
        for (const key of cleanupKeys) {
          const value = typeof metadata[key] === 'string' ? metadata[key].trim() : null;
          if (value && value === locationId) {
            delete metadata[key];
            metadataChanged = true;
          }
        }
        if (metadataChanged) {
          thing.metadata = metadata;
        }
      }
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

      if (entry instanceof StatusEffect) {
        normalized.push(entry);
        continue;
      }

      if (typeof entry === 'string') {
        const description = entry.trim();
        if (!description) continue;
        normalized.push(new StatusEffect({ description, duration: 1 }));
        continue;
      }

      if (typeof entry === 'object') {
        const descriptionValue = typeof entry.description === 'string'
          ? entry.description.trim()
          : (typeof entry.text === 'string' ? entry.text.trim() : (typeof entry.name === 'string' ? entry.name.trim() : ''));
        if (!descriptionValue) continue;
        const attributes = Array.isArray(entry.attributes) ? entry.attributes : undefined;
        const skills = Array.isArray(entry.skills) ? entry.skills : undefined;
        const duration = entry.duration !== undefined ? entry.duration : null;
        const name = typeof entry.name === 'string' ? entry.name : undefined;
        normalized.push(new StatusEffect({
          name,
          description: descriptionValue,
          attributes,
          skills,
          duration
        }));
      }
    }

    normalized.sort((a, b) => {
      const nameA = (a.name || a.description || '').toLowerCase();
      const nameB = (b.name || b.description || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    return normalized.slice(0, 60);
  }

  static #normalizeRandomEvents(events = []) {
    if (!Array.isArray(events)) {
      return [];
    }

    return events
      .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(entry => entry.length > 0);
  }

  static #normalizeGenerationHints(hints = null) {
    const clampCount = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return 0;
      }
      return Math.max(0, Math.min(20, Math.round(numeric)));
    };

    if (!hints || typeof hints !== 'object') {
      return {
        numItems: null,
        numScenery: null,
        numNpcs: null,
        numHostiles: null,
        hasWeather: null
      };
    }

    const normalize = (value) => {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return null;
      }
      return Math.max(0, Math.min(20, Math.round(numeric)));
    };

    const normalizeBoolean = (value) => {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase();
        if (['true', '1', 'yes'].includes(lowered)) {
          return true;
        }
        if (['false', '0', 'no'].includes(lowered)) {
          return false;
        }
      }
      throw new Error('Location generationHints.hasWeather must be a boolean when provided.');
    };

    return {
      numItems: normalize(hints.numItems),
      numScenery: normalize(hints.numScenery),
      numNpcs: normalize(hints.numNpcs),
      numHostiles: normalize(hints.numHostiles),
      hasWeather: normalizeBoolean(hints.hasWeather)
    };
  }

  getStatusEffects() {
    return this.#statusEffects.map(effect => effect.toJSON());
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
        retained.push(effect);
        continue;
      }
      if (effect.duration < 0) {
        retained.push(effect);
        continue;
      }
      if (effect.duration === 0) {
        retained.push(effect);
        continue;
      }
      retained.push(new StatusEffect({
        ...effect.toJSON(),
        duration: effect.duration - 1
      }));
      changed = true;
    }
    if (changed) {
      this.#statusEffects = retained;
      this.#lastUpdated = new Date();
    }
  }

  clearExpiredStatusEffects() {
    const before = this.#statusEffects.length;
    this.#statusEffects = this.#statusEffects.filter(effect => !Number.isFinite(effect.duration) || effect.duration !== 0);
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
