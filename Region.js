const crypto = require('crypto');
const { DOMParser } = require('xmldom');

class Region {
  #id;
  #name;
  #description;
  #locationBlueprints;
  #locationIds;
  #entranceLocationId;
  #createdAt;
  #lastUpdated;

  static #indexById = new Map();
  static #indexByName = new Map();

  static #generateId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(6).toString('hex');
    return `region_${timestamp}_${random}`;
  }

  constructor({ name, description, locations = [], locationIds = [], entranceLocationId = null, id = null } = {}) {
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
    this.#createdAt = new Date().toISOString();
    this.#lastUpdated = this.#createdAt;

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
            if (!exit) return null;
            if (typeof exit === 'string') {
              return { target: exit.trim(), direction: null };
            }
            const target = typeof exit.target === 'string' ? exit.target.trim() : '';
            const direction = typeof exit.direction === 'string' ? exit.direction.trim().toLowerCase() : null;
            if (!target) return null;
            return { target, direction };
          })
          .filter(Boolean)
      : [];

    const aliases = Array.isArray(blueprint.aliases)
      ? blueprint.aliases.map(alias => typeof alias === 'string' ? alias.trim() : '').filter(Boolean)
      : [];

    return {
      name,
      description,
      exits,
      aliases
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

  static clear() {
    Region.#indexById.clear();
    Region.#indexByName.clear();
  }

  static fromJSON(data = {}) {
    return new Region({
      id: data.id,
      name: data.name,
      description: data.description,
      locations: data.locationBlueprints || [],
      locationIds: data.locationIds || [],
      entranceLocationId: data.entranceLocationId || null
    });
  }

  static fromXMLSnippet(xmlSnippet) {
    if (!xmlSnippet || typeof xmlSnippet !== 'string') {
      throw new Error('Region XML snippet must be a string');
    }

    const regionMatch = xmlSnippet.match(/<region>[\s\S]*?<\/region>/i);
    const regionXml = regionMatch ? regionMatch[0] : xmlSnippet;

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(regionXml, 'text/xml');

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

    const childElements = Array.from(regionElement.childNodes).filter(node => node.nodeType === 1);
    for (const child of childElements) {
      const tag = child.tagName?.toLowerCase();
      if (!tag) continue;

      if (!regionName && (tag === 'regionname' || tag === 'name')) {
        regionName = child.textContent.trim();
      } else if (!regionDescription && (tag === 'regiondescription' || tag === 'description')) {
        regionDescription = child.textContent.trim();
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

      const locNameNode = node.getElementsByTagName('name')[0];
      const locDescriptionNode = node.getElementsByTagName('description')[0];
      const exitsNode = node.getElementsByTagName('exits')[0];

      let locName = locNameNode ? locNameNode.textContent.trim() : null;
      if (!locName && attrName) {
        locName = attrName;
      }
      if (!locName) {
        locName = `Location ${index + 1}`;
      }

      const locDescription = locDescriptionNode ? locDescriptionNode.textContent.trim() : '';
      const exitEntries = exitsNode
        ? Array.from(exitsNode.getElementsByTagName('exit')).map(exitNode => {
            const destinationAttr = exitNode.getAttribute('destination');
            const directionAttr = exitNode.getAttribute('direction');
            const textDest = exitNode.textContent?.trim();
            const targetCandidate = destinationAttr?.trim() || textDest || exitNode.getAttribute('name')?.trim() || '';
            if (!targetCandidate) {
              return null;
            }
            return {
              target: targetCandidate,
              direction: directionAttr ? directionAttr.trim().toLowerCase() : null
            };
          }).filter(Boolean)
        : [];

      const aliases = [];
      if (attrId) aliases.push(attrId);
      if (attrName) aliases.push(attrName);

      return Region.#normalizeBlueprint({
        name: locName,
        description: locDescription,
        exits: exitEntries,
        aliases
      });
    });

    return new Region({
      name: regionName,
      description: regionDescription,
      locations: locationBlueprints
    });
  }

  get id() {
    return this.#id;
  }

  get name() {
    return this.#name;
  }

  get description() {
    return this.#description;
  }

  get locationBlueprints() {
    return this.#locationBlueprints.map(bp => ({ ...bp }));
  }

  get locationIds() {
    return [...this.#locationIds];
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

  toJSON() {
    return {
      id: this.#id,
      name: this.#name,
      description: this.#description,
      locationBlueprints: this.locationBlueprints,
      locationIds: this.locationIds,
      entranceLocationId: this.#entranceLocationId,
      createdAt: this.#createdAt,
      lastUpdated: this.#lastUpdated
    };
  }
}

module.exports = Region;
