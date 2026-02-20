const crypto = require('crypto');
const Utils = require('./Utils.js');
const StatusEffect = require('./StatusEffect.js');

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
  #shortDescription;
  #locationBlueprints;
  #locationIds;
  #entranceLocationId;
  #parentRegionId;
  #createdAt;
  #lastUpdated;
  #statusEffects;
  #averageLevel;
  #relativeLevel;
  #numImportantNPCs;
  #controllingFactionId;
  #weather;
  #weatherState;
  #lastVisitedTime = null;  // Minutes since last visit by player.
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

  constructor({ name, description, shortDescription = null, locations = [], locationIds = [], entranceLocationId = null, parentRegionId = null, id = null, statusEffects = [], averageLevel = null, lastVisitedTime = null, randomEvents = [], characterConcepts = [], enemyConcepts = [], secrets = [], numImportantNPCs = null, controllingFactionId = null, weather = null, weatherState = null } = {}) {
    if (!name || typeof name !== 'string') {
      throw new Error('Region name is required and must be a string');
    }

    if (!description || typeof description !== 'string') {
      throw new Error('Region description is required and must be a string');
    }

    if (shortDescription !== null && shortDescription !== undefined && typeof shortDescription !== 'string') {
      throw new Error('Region shortDescription must be a string or null');
    }

    if (controllingFactionId !== null && controllingFactionId !== undefined && typeof controllingFactionId !== 'string') {
      throw new Error('Region controllingFactionId must be a string or null');
    }

    this.#id = id || Region.#generateId();
    this.#name = name.trim();
    this.#description = description.trim();
    const normalizedShortDescription = typeof shortDescription === 'string' ? shortDescription.trim() : null;
    this.#shortDescription = normalizedShortDescription || null;
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
    this.#controllingFactionId = typeof controllingFactionId === 'string' && controllingFactionId.trim()
      ? controllingFactionId.trim()
      : null;
    this.#createdAt = new Date().toISOString();
    this.#lastUpdated = this.#createdAt;
    this.#statusEffects = this.#normalizeStatusEffects(statusEffects);
    this.#lastVisitedTime = lastVisitedTime;
    this.#randomEvents = Array.isArray(randomEvents)
      ? randomEvents.filter(event => typeof event === 'string' && event.trim()).map(event => event.trim())
      : [];
    this.#averageLevel = Number.isFinite(averageLevel)
      ? Math.max(1, Math.round(averageLevel))
      : null;
    this.#relativeLevel = null; // to be set externally if needed
    this.#numImportantNPCs = Region.#normalizeImportantNpcCount(numImportantNPCs);
    this.#characterConcepts = Array.isArray(characterConcepts) ? [...characterConcepts] : [];
    this.#enemyConcepts = Array.isArray(enemyConcepts) ? [...enemyConcepts] : [];
    this.#secrets = Array.isArray(secrets) ? [...secrets] : [];
    this.#weather = Region.#normalizeWeatherDefinition(weather);
    this.#weatherState = Region.#normalizeWeatherState(weatherState);

    Region.#indexById.set(this.#id, this);
    Region.#indexByName.set(this.#name.toLowerCase(), this);
  }

  static #normalizeBoolean(value, fieldName) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const lowered = value.trim().toLowerCase();
      if (!lowered) {
        return null;
      }
      if (['true', '1', 'yes'].includes(lowered)) {
        return true;
      }
      if (['false', '0', 'no'].includes(lowered)) {
        return false;
      }
    }
    throw new Error(`${fieldName} must be a boolean.`);
  }

  static #normalizeDurationRange(range, fieldName) {
    if (!range || typeof range !== 'object' || Array.isArray(range)) {
      throw new Error(`${fieldName} must be an object with minMinutes and maxMinutes.`);
    }
    const hasMinutes = Object.prototype.hasOwnProperty.call(range, 'minMinutes')
      || Object.prototype.hasOwnProperty.call(range, 'maxMinutes');
    const minMinutesSource = hasMinutes ? range.minMinutes : (Number(range.minHours) * 60);
    const maxMinutesSource = hasMinutes ? range.maxMinutes : (Number(range.maxHours) * 60);
    const minMinutes = Number(minMinutesSource);
    const maxMinutes = Number(maxMinutesSource);
    if (!Number.isFinite(minMinutes) || !Number.isFinite(maxMinutes)) {
      throw new Error(`${fieldName} must contain finite minMinutes and maxMinutes.`);
    }
    if (minMinutes <= 0 || maxMinutes <= 0) {
      throw new Error(`${fieldName} minMinutes and maxMinutes must be greater than zero.`);
    }
    if (maxMinutes < minMinutes) {
      throw new Error(`${fieldName} maxMinutes must be greater than or equal to minMinutes.`);
    }
    return {
      minMinutes: Math.round(minMinutes),
      maxMinutes: Math.round(maxMinutes)
    };
  }

  static #parseDurationRangeText(rawDurationRange, fieldName) {
    const text = typeof rawDurationRange === 'string' ? rawDurationRange.trim() : '';
    if (!text) {
      throw new Error(`${fieldName} is required.`);
    }
    const [minTextRaw, maxTextRaw, ...extra] = text.split('-');
    if (extra.length > 0) {
      throw new Error(`${fieldName} has too many range separators: "${rawDurationRange}".`);
    }
    const minText = (minTextRaw || '').trim();
    const maxText = (maxTextRaw || '').trim();
    const minMinutes = Utils.parseDurationToMinutes(minText, { fieldName: `${fieldName}.min` });
    const maxMinutes = Utils.parseDurationToMinutes(maxText || minText, { fieldName: `${fieldName}.max` });
    return Region.#normalizeDurationRange({ minMinutes, maxMinutes }, fieldName);
  }

  static #normalizeWeatherDefinition(weather = null) {
    if (weather === null || weather === undefined) {
      return {
        hasDynamicWeather: false,
        seasonWeather: []
      };
    }
    if (typeof weather !== 'object' || Array.isArray(weather)) {
      throw new Error('Region weather must be an object.');
    }

    const hasDynamicWeather = Region.#normalizeBoolean(weather.hasDynamicWeather, 'weather.hasDynamicWeather');
    const seasonWeatherSource = weather.seasonWeather;
    let seasonWeatherList = [];
    if (seasonWeatherSource !== null && seasonWeatherSource !== undefined) {
      if (!Array.isArray(seasonWeatherSource)) {
        throw new Error('weather.seasonWeather must be an array.');
      }
      seasonWeatherList = seasonWeatherSource;
    }

    const seasonWeather = [];
    for (let index = 0; index < seasonWeatherList.length; index += 1) {
      const seasonEntry = seasonWeatherList[index];
      if (!seasonEntry || typeof seasonEntry !== 'object' || Array.isArray(seasonEntry)) {
        throw new Error(`weather.seasonWeather[${index}] must be an object.`);
      }
      const seasonName = typeof seasonEntry.seasonName === 'string' ? seasonEntry.seasonName.trim() : '';
      if (!seasonName) {
        throw new Error(`weather.seasonWeather[${index}] is missing seasonName.`);
      }

      const weatherTypesSource = seasonEntry.weatherTypes;
      if (!Array.isArray(weatherTypesSource) || weatherTypesSource.length === 0) {
        throw new Error(`weather.seasonWeather[${index}] must include at least one weatherTypes entry.`);
      }

      const weatherTypes = [];
      for (let typeIndex = 0; typeIndex < weatherTypesSource.length; typeIndex += 1) {
        const typeEntry = weatherTypesSource[typeIndex];
        if (!typeEntry || typeof typeEntry !== 'object' || Array.isArray(typeEntry)) {
          throw new Error(`weather.seasonWeather[${index}].weatherTypes[${typeIndex}] must be an object.`);
        }
        const name = typeof typeEntry.name === 'string' ? typeEntry.name.trim() : '';
        const description = typeof typeEntry.description === 'string' ? typeEntry.description.trim() : '';
        const relativeFrequency = Number(typeEntry.relativeFrequency);
        if (!name) {
          throw new Error(`weather.seasonWeather[${index}].weatherTypes[${typeIndex}] is missing name.`);
        }
        if (!description) {
          throw new Error(`weather.seasonWeather[${index}].weatherTypes[${typeIndex}] is missing description.`);
        }
        if (!Number.isFinite(relativeFrequency) || relativeFrequency <= 0) {
          throw new Error(`weather.seasonWeather[${index}].weatherTypes[${typeIndex}] has invalid relativeFrequency.`);
        }

        const durationField = `weather.seasonWeather[${index}].weatherTypes[${typeIndex}].durationRange`;
        let durationRange = null;
        if (typeof typeEntry.durationRange === 'string') {
          try {
            durationRange = Region.#parseDurationRangeText(typeEntry.durationRange, durationField);
          } catch (error) {
            console.warn(`Skipping ${durationField}:`, error?.message || error);
            continue;
          }
        } else if (typeEntry.durationRange && typeof typeEntry.durationRange === 'object') {
          durationRange = Region.#normalizeDurationRange(typeEntry.durationRange, durationField);
        } else {
          throw new Error(`weather.seasonWeather[${index}].weatherTypes[${typeIndex}] is missing durationRange.`);
        }

        weatherTypes.push({
          name,
          description,
          relativeFrequency,
          durationRange
        });
      }

      if (!weatherTypes.length) {
        console.warn(`Skipping weather.seasonWeather[${index}] because it has no valid weatherTypes entries.`);
        continue;
      }

      seasonWeather.push({
        seasonName,
        weatherTypes
      });
    }

    if (Boolean(hasDynamicWeather) && seasonWeather.length === 0) {
      throw new Error('weather.hasDynamicWeather is true but no seasonWeather entries were provided.');
    }

    return {
      hasDynamicWeather: Boolean(hasDynamicWeather),
      seasonWeather
    };
  }

  static #normalizeWeatherState(weatherState = null) {
    if (weatherState === null || weatherState === undefined) {
      return null;
    }
    if (typeof weatherState !== 'object' || Array.isArray(weatherState)) {
      throw new Error('Region weatherState must be an object or null.');
    }
    const seasonName = typeof weatherState.seasonName === 'string' ? weatherState.seasonName.trim() : '';
    const name = typeof weatherState.name === 'string' ? weatherState.name.trim() : '';
    const description = typeof weatherState.description === 'string' ? weatherState.description.trim() : '';
    const hasMinuteFields = Object.prototype.hasOwnProperty.call(weatherState, 'nextChangeMinutes')
      || Object.prototype.hasOwnProperty.call(weatherState, 'durationMinutes');
    const nextChangeMinutesRaw = hasMinuteFields
      ? weatherState.nextChangeMinutes
      : (Number(weatherState.nextChangeHours) * 60);
    const durationMinutesRaw = hasMinuteFields
      ? weatherState.durationMinutes
      : (Number(weatherState.durationHours) * 60);
    const nextChangeMinutes = Number(nextChangeMinutesRaw);
    const durationMinutes = Number(durationMinutesRaw);
    if (!seasonName || !name || !description) {
      throw new Error('Region weatherState must include seasonName, name, and description.');
    }
    if (!Number.isFinite(nextChangeMinutes) || nextChangeMinutes < 0) {
      throw new Error('Region weatherState.nextChangeMinutes must be a non-negative number.');
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      throw new Error('Region weatherState.durationMinutes must be greater than zero.');
    }

    return {
      seasonName,
      name,
      description,
      nextChangeMinutes: Math.round(nextChangeMinutes),
      durationMinutes: Math.round(durationMinutes)
    };
  }

  static #normalizeBlueprint(blueprint = {}) {
    const name = typeof blueprint.name === 'string' ? blueprint.name.trim() : null;
    if (!name) {
      throw new Error('Region location blueprint requires a name');
    }
    const description = typeof blueprint.description === 'string'
      ? blueprint.description.trim()
      : '';
    const shortDescription = typeof blueprint.shortDescription === 'string'
      ? blueprint.shortDescription.trim()
      : null;
    const controllingFaction = typeof blueprint.controllingFaction === 'string'
      ? blueprint.controllingFaction.trim()
      : null;
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

    const normalizeCount = (value) => {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return null;
      }
      return Math.max(0, Math.min(20, Math.round(numeric)));
    };

    const numNpcs = normalizeCount(blueprint.numNpcs);
    const numHostiles = normalizeCount(blueprint.numHostiles);
    const hasWeather = Region.#normalizeBoolean(blueprint.hasWeather, 'location blueprint hasWeather');

    return {
      name,
      description,
      shortDescription,
      exits,
      aliases,
      relativeLevel,
      numNpcs,
      numHostiles,
      controllingFaction,
      hasWeather
    };
  }

  static #normalizeImportantNpcCount(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return Math.max(0, Math.min(20, Math.round(numeric)));
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
      shortDescription: data.shortDescription ?? null,
      locations: data.locationBlueprints || [],
      locationIds: data.locationIds || [],
      entranceLocationId: data.entranceLocationId || null,
      parentRegionId: data.parentRegionId || null,
      controllingFactionId: data.controllingFactionId || null,
      statusEffects: Array.isArray(data.statusEffects) ? data.statusEffects : [],
      averageLevel: data.averageLevel || null,
      lastVisitedTime: Number.isFinite(Number(data.lastVisitedTime)) ? Number(data.lastVisitedTime) : null,
      randomEvents: Array.isArray(data.randomEvents) ? data.randomEvents : [],
      characterConcepts: Array.isArray(data.characterConcepts) ? data.characterConcepts : [],
      enemyConcepts: Array.isArray(data.enemyConcepts) ? data.enemyConcepts : [],
      secrets: Array.isArray(data.secrets) ? data.secrets : [],
      numImportantNPCs: data.numImportantNPCs ?? null,
      weather: data.weather ?? null,
      weatherState: data.weatherState ?? null
    });
  }

  static parseWeatherDefinitionFromXmlSnippet(xmlSnippet) {
    if (!xmlSnippet || typeof xmlSnippet !== 'string') {
      throw new Error('Region weather XML snippet must be a string.');
    }

    const regionMatch = xmlSnippet.match(/<region>[\s\S]*?<\/region>/i);
    const regionXml = regionMatch ? regionMatch[0] : xmlSnippet;
    const xmlDoc = Utils.parseXmlDocument(regionXml, 'text/xml');
    const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
    if (parserError) {
      throw new Error(`Region weather XML parsing error: ${parserError.textContent}`);
    }

    const regionElement = xmlDoc.getElementsByTagName('region')[0];
    if (!regionElement) {
      throw new Error('Region weather XML missing <region> root element.');
    }

    const weatherElement = Array.from(regionElement.childNodes || []).find(node =>
      node
      && node.nodeType === 1
      && node.tagName
      && node.tagName.toLowerCase() === 'weather'
    ) || null;
    if (!weatherElement) {
      return {
        hasDynamicWeather: false,
        seasonWeather: []
      };
    }

    const getDirectChild = (parent, tagName) => {
      if (!parent) {
        return null;
      }
      const lowered = tagName.toLowerCase();
      return Array.from(parent.childNodes || []).find(node =>
        node
        && node.nodeType === 1
        && node.tagName
        && node.tagName.toLowerCase() === lowered
      ) || null;
    };

    const getDirectChildren = (parent, tagName) => {
      if (!parent) {
        return [];
      }
      const lowered = tagName.toLowerCase();
      return Array.from(parent.childNodes || []).filter(node =>
        node
        && node.nodeType === 1
        && node.tagName
        && node.tagName.toLowerCase() === lowered
      );
    };

    const getText = (node, tagName) => {
      const child = getDirectChild(node, tagName);
      if (!child || typeof child.textContent !== 'string') {
        return '';
      }
      return child.textContent.trim();
    };

    const hasDynamicWeatherText = getText(weatherElement, 'hasDynamicWeather');
    const hasDynamicWeather = Region.#normalizeBoolean(hasDynamicWeatherText || false, 'weather.hasDynamicWeather');

    const seasonWeather = [];
    const seasonNodes = getDirectChildren(weatherElement, 'seasonWeather');
    for (let seasonIndex = 0; seasonIndex < seasonNodes.length; seasonIndex += 1) {
      const seasonNode = seasonNodes[seasonIndex];
      const seasonName = getText(seasonNode, 'seasonName');
      if (!seasonName) {
        throw new Error(`weather.seasonWeather[${seasonIndex}] is missing <seasonName>.`);
      }

      const weatherTypes = [];
      const weatherTypeNodes = getDirectChildren(seasonNode, 'weatherType');
      for (let typeIndex = 0; typeIndex < weatherTypeNodes.length; typeIndex += 1) {
        const typeNode = weatherTypeNodes[typeIndex];
        const name = getText(typeNode, 'name');
        const description = getText(typeNode, 'description');
        const relativeFrequencyText = getText(typeNode, 'relativeFrequency');
        const durationRangeText = getText(typeNode, 'durationRange');
        if (!name) {
          throw new Error(`weather.seasonWeather[${seasonIndex}].weatherType[${typeIndex}] is missing <name>.`);
        }
        if (!description) {
          throw new Error(`weather.seasonWeather[${seasonIndex}].weatherType[${typeIndex}] is missing <description>.`);
        }
        if (!relativeFrequencyText) {
          throw new Error(`weather.seasonWeather[${seasonIndex}].weatherType[${typeIndex}] is missing <relativeFrequency>.`);
        }
        if (!durationRangeText) {
          throw new Error(`weather.seasonWeather[${seasonIndex}].weatherType[${typeIndex}] is missing <durationRange>.`);
        }

        const durationField = `weather.seasonWeather[${seasonIndex}].weatherType[${typeIndex}].durationRange`;
        let durationRange = null;
        try {
          durationRange = Region.#parseDurationRangeText(durationRangeText, durationField);
        } catch (error) {
          console.warn(`Skipping ${durationField}:`, error?.message || error);
          continue;
        }

        weatherTypes.push({
          name,
          description,
          relativeFrequency: Number(relativeFrequencyText),
          durationRange
        });
      }

      if (!weatherTypes.length) {
        console.warn(`Skipping weather.seasonWeather[${seasonIndex}] because it has no valid weatherType entries.`);
        continue;
      }

      seasonWeather.push({
        seasonName,
        weatherTypes
      });
    }

    return Region.#normalizeWeatherDefinition({
      hasDynamicWeather,
      seasonWeather
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
    let regionShortDescription = null;
    let regionLevel = null;
    let numImportantNPCs = null;
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
      } else if (!regionShortDescription && tag === 'shortdescription') {
        const value = child.textContent?.trim();
        if (value) {
          regionShortDescription = value;
        }
      } else if (!regionLevel && tag === 'relativelevel') {
        const parsedLevel = Number(child.textContent.trim());
        if (Number.isFinite(parsedLevel)) {
          regionLevel = Math.max(1, Math.round(parsedLevel));
        }
      } else if (tag === 'numimportantnpcs') {
        numImportantNPCs = Region.#normalizeImportantNpcCount(child.textContent.trim());
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

    if (!regionShortDescription) {
      const nameForLog = regionName || 'unknown';
      console.warn(`[Region.fromXMLSnippet] Missing <shortDescription> for region "${nameForLog}".`);
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
      const locShortDescriptionNode = findDirectChild('shortdescription');
      const relativeLevelNode = findDirectChild('relativelevel');
      const numNpcsNode = findDirectChild('numnpcs');
      const numHostilesNode = findDirectChild('numhostiles');
      const hasWeatherNode = findDirectChild('hasweather');
      const exitsNode = findDirectChild('exits');
      const controllingFactionNode = findDirectChild('controllingfaction');
      let relativeLevel = null;
      let numNpcs = null;
      let numHostiles = null;
      let hasWeather = null;

      let locName = locNameNode ? locNameNode.textContent.trim() : null;
      if (!locName && attrName) {
        locName = attrName;
      }
      if (!locName) {
        locName = `Location ${index + 1}`;
      }

      const locDescription = locDescriptionNode ? locDescriptionNode.textContent.trim() : '';
      const locShortDescription = locShortDescriptionNode ? locShortDescriptionNode.textContent.trim() : '';
      const controllingFaction = controllingFactionNode ? controllingFactionNode.textContent.trim() : null;
      if (!locShortDescription) {
        console.warn(`[Region.fromXMLSnippet] Missing <shortDescription> for location "${locName}".`);
      }

      if (relativeLevelNode) {
        const parsedRelative = Number(relativeLevelNode.textContent.trim());
        if (Number.isFinite(parsedRelative)) {
          relativeLevel = Math.max(-10, Math.min(10, Math.round(parsedRelative)));
        }
      }

      if (numNpcsNode) {
        const parsedNumNpcs = Number(numNpcsNode.textContent.trim());
        if (Number.isFinite(parsedNumNpcs)) {
          numNpcs = Math.max(0, Math.min(20, Math.round(parsedNumNpcs)));
        }
      }

      if (numHostilesNode) {
        const parsedNumHostiles = Number(numHostilesNode.textContent.trim());
        if (Number.isFinite(parsedNumHostiles)) {
          numHostiles = Math.max(0, Math.min(20, Math.round(parsedNumHostiles)));
        }
      }

      if (hasWeatherNode) {
        hasWeather = Region.#normalizeBoolean(hasWeatherNode.textContent?.trim(), `location "${locName}" hasWeather`);
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
        shortDescription: locShortDescription,
        exits: exitEntries,
        aliases,
        relativeLevel,
        numNpcs,
        numHostiles,
        controllingFaction,
        hasWeather
      });
    });

    const randomEventsNode = regionElement.getElementsByTagName('randomStoryEvents')?.[0] || null;
    const randomEvents = randomEventsNode
      ? Array.from(randomEventsNode.getElementsByTagName('event'))
        .map(node => (node.textContent || '').trim())
        .filter(Boolean)
      : [];
    const regionWeather = Region.parseWeatherDefinitionFromXmlSnippet(regionXml);

    return new Region({
      name: regionName,
      description: regionDescription,
      shortDescription: regionShortDescription,
      locations: locationBlueprints,
      averageLevel: regionLevel,
      randomEvents,
      characterConcepts,
      enemyConcepts,
      secrets,
      numImportantNPCs,
      weather: regionWeather
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

  get shortDescription() {
    return this.#shortDescription;
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

  set shortDescription(value) {
    if (value === null || value === undefined) {
      this.#shortDescription = null;
      this.#lastUpdated = new Date().toISOString();
      return;
    }
    if (typeof value !== 'string') {
      throw new Error('Region shortDescription must be a string or null');
    }
    const trimmed = value.trim();
    this.#shortDescription = trimmed || null;
    this.#lastUpdated = new Date().toISOString();
  }

  get locationBlueprints() {
    return this.#locationBlueprints.map(bp => ({ ...bp }));
  }

  get locationIds() {
    return [...this.#locationIds];
  }

  get numImportantNPCs() {
    return this.#numImportantNPCs;
  }

  set numImportantNPCs(value) {
    this.#numImportantNPCs = Region.#normalizeImportantNpcCount(value);
    this.#lastUpdated = new Date().toISOString();
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

  get controllingFactionId() {
    return this.#controllingFactionId;
  }

  set controllingFactionId(value) {
    if (value === null || value === undefined || value === '') {
      if (this.#controllingFactionId !== null) {
        this.#controllingFactionId = null;
        this.#lastUpdated = new Date().toISOString();
      }
      return;
    }
    if (typeof value !== 'string') {
      throw new Error('Region controllingFactionId must be a string or null.');
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('Region controllingFactionId must be a non-empty string or null.');
    }
    this.#controllingFactionId = trimmed;
    this.#lastUpdated = new Date().toISOString();
  }

  get weather() {
    return JSON.parse(JSON.stringify(this.#weather));
  }

  set weather(value) {
    this.#weather = Region.#normalizeWeatherDefinition(value);
    this.#weatherState = null;
    this.#lastUpdated = new Date().toISOString();
  }

  get weatherState() {
    if (!this.#weatherState) {
      return null;
    }
    return { ...this.#weatherState };
  }

  set weatherState(value) {
    this.#weatherState = Region.#normalizeWeatherState(value);
    this.#lastUpdated = new Date().toISOString();
  }

  #pickWeatherTypeForSeason(seasonEntry) {
    if (!seasonEntry || !Array.isArray(seasonEntry.weatherTypes) || !seasonEntry.weatherTypes.length) {
      throw new Error('Cannot choose weather type for an empty season weather definition.');
    }
    const totalWeight = seasonEntry.weatherTypes.reduce((sum, entry) => sum + Number(entry.relativeFrequency), 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      throw new Error(`Region "${this.#name}" season "${seasonEntry.seasonName}" has invalid weather frequencies.`);
    }
    const roll = Math.random() * totalWeight;
    let cursor = 0;
    for (const weatherType of seasonEntry.weatherTypes) {
      cursor += Number(weatherType.relativeFrequency);
      if (roll <= cursor) {
        return weatherType;
      }
    }
    return seasonEntry.weatherTypes[seasonEntry.weatherTypes.length - 1];
  }

  resolveCurrentWeather({ seasonName = null, totalMinutes = null, totalHours = null } = {}) {
    const hasTotalMinutes = totalMinutes !== null && totalMinutes !== undefined;
    const normalizedTotalMinutes = hasTotalMinutes
      ? Number(totalMinutes)
      : Number(totalHours) * 60;
    if (!Number.isFinite(normalizedTotalMinutes) || normalizedTotalMinutes < 0) {
      throw new Error('Region.resolveCurrentWeather requires a non-negative totalMinutes value.');
    }

    const weatherConfig = this.#weather;
    if (!weatherConfig || weatherConfig.hasDynamicWeather !== true) {
      return {
        name: 'No active weather',
        description: 'Conditions are sheltered from weather effects.',
        seasonName: seasonName || null,
        dynamic: false
      };
    }

    const normalizedSeasonName = typeof seasonName === 'string' ? seasonName.trim().toLowerCase() : '';
    const seasonEntry = weatherConfig.seasonWeather.find(entry =>
      typeof entry?.seasonName === 'string' && entry.seasonName.trim().toLowerCase() === normalizedSeasonName
    ) || weatherConfig.seasonWeather[0] || null;

    if (!seasonEntry || !Array.isArray(seasonEntry.weatherTypes) || !seasonEntry.weatherTypes.length) {
      return {
        name: 'No active weather',
        description: 'Conditions are steady with no notable weather changes.',
        seasonName: seasonName || null,
        dynamic: false
      };
    }

    const currentState = this.#weatherState;
    const stateMatchesSeason = currentState
      && typeof currentState.seasonName === 'string'
      && currentState.seasonName.trim().toLowerCase() === seasonEntry.seasonName.trim().toLowerCase();
    const stateStillValid = stateMatchesSeason
      && Number.isFinite(currentState.nextChangeMinutes)
      && normalizedTotalMinutes < Number(currentState.nextChangeMinutes);

    if (!stateStillValid) {
      const weatherType = this.#pickWeatherTypeForSeason(seasonEntry);
      const duration = weatherType.durationRange.minMinutes === weatherType.durationRange.maxMinutes
        ? weatherType.durationRange.minMinutes
        : weatherType.durationRange.minMinutes
          + (Math.random() * (weatherType.durationRange.maxMinutes - weatherType.durationRange.minMinutes));
      this.#weatherState = Region.#normalizeWeatherState({
        seasonName: seasonEntry.seasonName,
        name: weatherType.name,
        description: weatherType.description,
        durationMinutes: duration,
        nextChangeMinutes: normalizedTotalMinutes + duration
      });
      this.#lastUpdated = new Date().toISOString();
    }

    return {
      name: this.#weatherState.name,
      description: this.#weatherState.description,
      seasonName: this.#weatherState.seasonName,
      dynamic: true
    };
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
      shortDescription: this.#shortDescription,
      locationBlueprints: this.locationBlueprints,
      locationIds: this.locationIds,
      entranceLocationId: this.#entranceLocationId,
      parentRegionId: this.#parentRegionId,
      controllingFactionId: this.#controllingFactionId,
      createdAt: this.#createdAt,
      lastUpdated: this.#lastUpdated,
      statusEffects: this.getStatusEffects(),
      averageLevel: this.#averageLevel,
      numImportantNPCs: this.#numImportantNPCs,
      randomEvents: [...this.#randomEvents],
      characterConcepts: [...this.#characterConcepts],
      enemyConcepts: [...this.#enemyConcepts],
      secrets: [...this.#secrets],
      weather: this.weather,
      weatherState: this.weatherState
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

    const normalized = Math.max(1, Math.round(numericLevel));
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
        let duration = null;
        if (rawDuration === null || rawDuration === undefined || rawDuration === '') {
          duration = null;
        } else {
          duration = StatusEffect.normalizeDuration(rawDuration);
        }

        const normalizedEntry = {
          description: descriptionValue,
          duration
        };
        if (Object.prototype.hasOwnProperty.call(entry, 'appliedAt')) {
          normalizedEntry.appliedAt = entry.appliedAt;
        }
        normalized.push(normalizedEntry);
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

  tickStatusEffects(elapsedMinutes = 1) {
    if (!this.#statusEffects.length) {
      return;
    }
    const normalizedMinutes = Number(elapsedMinutes);
    if (!Number.isFinite(normalizedMinutes) || normalizedMinutes <= 0) {
      return;
    }
    const roundedMinutes = Math.max(1, Math.round(normalizedMinutes));
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
      if (effect.duration < 0) {
        retained.push({ ...effect });
        continue;
      }
      if (effect.duration === 0) {
        retained.push({ ...effect });
        continue;
      }
      const remainingMinutes = Math.max(0, Math.round(effect.duration));
      const nextRemainingMinutes = Math.max(0, remainingMinutes - roundedMinutes);
      retained.push({ ...effect, duration: nextRemainingMinutes });
      changed = true;
    }
    if (changed) {
      this.#statusEffects = retained;
      this.#lastUpdated = new Date().toISOString();
    }
  }

  clearExpiredStatusEffects() {
    const before = this.#statusEffects.length;
    this.#statusEffects = this.#statusEffects.filter(effect => !Number.isFinite(effect.duration) || effect.duration !== 0);
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
