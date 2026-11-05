const IdGenerator = require('./IdGenerator.js');
const ThingFieldRegistry = require('./ThingFieldRegistry.js');
const ItemChargePool = require('./ItemChargePool.js');

const clone = value => JSON.parse(JSON.stringify(value));
const ordered = value => Array.isArray(value) ? value.map(ordered)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const transientFields = new Set(['count', 'containedThingIds', 'containerContents',
  'hiddenFromPlayer', 'discoveryDifficulty', 'imageId', 'imagePrompt', 'installedModuleIds', 'moduleInstalledOnItemId']);
// Older Thing metadata can contain display-formatted numbers. Canonicalize only
// unambiguous thousands grouping in the archive; never mutate the live metadata
// or guess a value from units, prose, or malformed separators.
const archiveNumericValue = value => {
  if (typeof value !== 'string' || !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(value.trim())) return value;
  const numeric = Number(value.trim().replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : value;
};
const scrubBindings = value => Array.isArray(value) ? value.map(scrubBindings)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['id', 'sourceItemId', 'sourceStatusId', 'sourceId', 'appliedAt', 'createdAt', 'lastUpdated'].includes(key))
    .map(([key, child]) => [key, scrubBindings(child)])) : value;

/** Durable item definitions. Live bindings are transient and never saved. */
class ItemCatalogue {
  static #definitions = new Map();
  static #byBlueprint = new Map();
  static #bindings = new Map();
  static #retained = new Set();
  static #families = new Map();
  static #generation = 0;
  static get generation() { return this.#generation; }

  static blueprintFrom(thing, { normalizeGroupedNumbers = true } = {}) {
    const data = typeof thing?.toJSON === 'function' ? thing.toJSON() : thing;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Item catalogue requires an item record.');
    if (data.thingType !== 'item') return null;
    if (typeof data.name !== 'string' || !data.name.trim() || typeof data.description !== 'string' || !data.description.trim()) {
      throw new Error('Item catalogue blueprint requires non-empty name and description.');
    }
    const blueprint = {};
    for (const field of new ThingFieldRegistry().getFields()) {
      const key = field.fieldName;
      if (transientFields.has(key) || key === 'statusEffects') continue;
      const value = field.storage === 'metadata' ? data.metadata?.[key] : data[key];
      if (value !== undefined) blueprint[key] = clone(normalizeGroupedNumbers && ['value', 'weight'].includes(key) ? archiveNumericValue(value) : value);
    }
    if (blueprint.chargePool) blueprint.chargePool = ItemChargePool.templateFrom(blueprint.chargePool);
    const permanentStatuses = (data.statusEffects || []).filter(effect => effect?.duration === -1);
    if (permanentStatuses.length) blueprint.statusEffects = scrubBindings(permanentStatuses);
    // The complete role-bearing effect list is canonical; singular mirrors are redundant.
    if (Array.isArray(data.causeStatusEffects)) blueprint.causeStatusEffects = scrubBindings(data.causeStatusEffects);
    for (const key of ['causeStatusEffectOnTarget', 'causeStatusEffectOnEquipper', 'techniqueGrants']) {
      if (blueprint[key]) blueprint[key] = scrubBindings(blueprint[key]);
    }
    if (data.metadata?.unscaledAttributeBonuses !== undefined && blueprint.unscaledAttributeBonuses === undefined) {
      blueprint.unscaledAttributeBonuses = clone(data.metadata.unscaledAttributeBonuses);
    }
    return ordered(blueprint);
  }

  static validateThing(thing) {
    const blueprint = this.blueprintFrom(thing);
    if (blueprint) this.validateState({ version: 1, definitions: [{ id: 'itemdef_candidate', reusable: false, blueprint }] });
    return blueprint;
  }

  static #key(blueprint) { return JSON.stringify(ordered(blueprint)); }
  static #prune(id) {
    if (this.#retained.has(id) || [...this.#bindings.values()].includes(id)) return;
    const entry = this.#definitions.get(id);
    if (entry) this.#byBlueprint.delete(this.#key(entry.blueprint));
    this.#definitions.delete(id);
  }

  static remember(thing, { retain = false } = {}) {
    const blueprint = this.validateThing(thing);
    if (!blueprint) return null;
    const key = this.#key(blueprint);
    let id = this.#byBlueprint.get(key);
    if (!id) {
      id = IdGenerator.next('itemDefinition', blueprint.name);
      this.#definitions.set(id, { id, reusable: false, blueprint });
      this.#byBlueprint.set(key, id);
    }
    if (thing.id) {
      const previous = this.#bindings.get(thing.id);
      this.#bindings.set(thing.id, id);
      if (previous && previous !== id) this.#prune(previous);
    }
    if (retain) this.#retained.add(id);
    return this.getById(id);
  }

  static forget(thing) {
    const id = this.#bindings.get(thing.id);
    this.#bindings.delete(thing.id);
    if (id) this.#prune(id);
  }
  static capture(things) {
    const entries = things instanceof Map ? things.values() : things;
    for (const thing of entries) this.remember(thing, { retain: true });
  }
  static getById(id) { const entry = this.#definitions.get(id); return entry ? clone(entry) : null; }
  static getByName(name) {
    if (typeof name !== 'string') throw new Error('Item catalogue lookup name must be text.');
    return this.getAll().filter(entry => entry.blueprint.name.trim().toLowerCase() === name.trim().toLowerCase());
  }
  static getAll() { return [...this.#definitions.values()].map(clone); }
  static getFamilies() { return [...this.#families.values()].map(clone); }
  static getFamiliesByName(name) {
    const normalized = String(name || '').trim().normalize('NFC').toLowerCase();
    return this.getFamilies().filter(family => family.name.trim().normalize('NFC').toLowerCase() === normalized);
  }
  static validateFamilyData(family, { requireId = true } = {}) {
    const fail = message => { throw new Error(`itemCatalogue.families: ${message}`); };
    if (!family || typeof family !== 'object' || Array.isArray(family)) fail('each family must be an object.');
    if (requireId && (typeof family.id !== 'string' || !family.id.startsWith('itemfamily_'))) fail('preserve a valid itemfamily ID.');
    if (typeof family.name !== 'string' || !family.name.trim()) fail('name is required.');
    if (!Array.isArray(family.rarities) || !family.rarities.length
        || family.rarities.some(rarity => typeof rarity !== 'string' || !rarity.trim())
        || new Set(family.rarities).size !== family.rarities.length) fail('rarities must contain distinct non-empty rarity keys.');
    const configuredRarities = require('./Thing.js').getAllRarityDefinitions().map(entry => entry.key);
    const minimumIndex = configuredRarities.indexOf(family.minimumRarity);
    const maximumIndex = configuredRarities.indexOf(family.maximumRarity);
    if (minimumIndex < 0 || maximumIndex < minimumIndex
        || this.#key(configuredRarities.slice(minimumIndex, maximumIndex + 1)) !== this.#key(family.rarities)) {
      fail('rarities must include every configured tier from minimumRarity through maximumRarity; choose existing ordered rarity keys and supply every intermediate variant.');
    }
    if (family.minimumRarity !== family.rarities[0] || family.maximumRarity !== family.rarities[family.rarities.length - 1]) fail('minimumRarity and maximumRarity must match the ends of the saved rarity range.');
    if (!Array.isArray(family.variants) || family.variants.length !== family.rarities.length) fail('variants must contain exactly one item for every saved rarity.');
    const seen = new Set();
    for (const variant of family.variants) {
      if (!variant || variant.name !== family.name || variant.itemOrScenery !== 'item'
          || typeof variant.description !== 'string' || !variant.description.trim()
          || !family.rarities.includes(variant.rarity) || seen.has(variant.rarity)) fail('each variant must preserve family name, item kind, description and one distinct allowed rarity.');
      if (variant.statusEffects !== undefined && (!Array.isArray(variant.statusEffects) || variant.statusEffects.some(effect => !effect || effect.duration !== -1))) fail('variant.statusEffects must contain only permanent intrinsic item effects (duration -1); omit temporary instance buffs.');
      if (!Array.isArray(variant.unscaledAttributeBonuses) || variant.unscaledAttributeBonuses.some(bonus => (
        !bonus || typeof bonus.attribute !== 'string' || !bonus.attribute.trim() || !Number.isFinite(bonus.bonus)
      ))) fail('variants require their original finite unscaled attribute bonuses.');
      if (variant.id || variant.sourceItemId || variant.containedThingIds?.length || variant.containerContents?.length
          || variant.installedModuleIds?.length || variant.moduleInstalledOnItemId || variant.hiddenFromPlayer === true) fail('variant templates must not contain live instance bindings, hidden state or container contents.');
      if (variant.chargePool) ItemChargePool.normalizePool(variant.chargePool, { template: true });
      const blueprint = this.blueprintFrom({ ...variant, thingType: 'item', itemTypeDetail: variant.type,
        level: 1, relativeLevel: variant.relativeLevel ?? 0,
        metadata: { value: variant.value, weight: variant.weight, properties: variant.properties } }, { normalizeGroupedNumbers: false });
      this.validateState({ version: 1, definitions: [{ id: 'itemdef_family_candidate', reusable: false, blueprint }] });
      for (const field of ['statusEffects', 'techniqueGrants', 'causeStatusEffects', 'causeStatusEffectOnTarget', 'causeStatusEffectOnEquipper', 'causeStatusEffect']) {
        if (variant[field] && this.#key(variant[field]) !== this.#key(scrubBindings(variant[field]))) fail(`variant.${field} contains live source bindings; save structural mechanics only.`);
      }
      seen.add(variant.rarity);
    }
  }
  static validateFamilyCommit(families) {
    if (!Array.isArray(families)) throw new Error('Item family commit requires an array.');
    const accepted = [];
    for (const family of families) {
      this.validateFamilyData(family, { requireId: false });
      const matches = [...this.getFamiliesByName(family.name), ...accepted.filter(other => other.name.toLowerCase() === family.name.toLowerCase())];
      const equal = matches.find(existing => this.#key(existing.variants) === this.#key(family.variants)
        && this.#key(existing.rarities) === this.#key(family.rarities));
      if (equal) continue;
      if (matches.length) throw new Error(`Item family "${family.name}" already has a different saved definition; use a distinct item name instead of replacing canonical mechanics.`);
      accepted.push(family);
    }
    return accepted;
  }
  static commitFamilies(families) {
    const prepared = this.validateFamilyCommit(families).map(family => ({ ...clone(family), id: IdGenerator.next('itemFamily', family.name) }));
    for (const family of prepared) this.#families.set(family.id, family);
    return prepared.map(clone);
  }
  static toJSON() { return { version: 2, definitions: this.getAll(), families: this.getFamilies() }; }
  static validateState(payload) {
    if (payload === undefined) return;
    if (!payload || ![1, 2].includes(payload.version) || !Array.isArray(payload.definitions)) throw new Error('itemCatalogue must contain supported version 1 or 2 and a definitions array.');
    if (payload.version === 2 && !Array.isArray(payload.families)) throw new Error('itemCatalogue version 2 requires a families array.');
    const familyIds = new Set();
    for (const family of payload.families || []) {
      this.validateFamilyData(family);
      if (familyIds.has(family.id)) throw new Error('itemCatalogue.families contains duplicate IDs.');
      familyIds.add(family.id);
    }
    const ids = new Set(); const keys = new Set();
    for (const entry of payload.definitions) {
      if (!entry || typeof entry.id !== 'string' || !entry.id.startsWith('itemdef_') || ids.has(entry.id)
          || typeof entry.reusable !== 'boolean' || !entry.blueprint || entry.blueprint.thingType !== 'item'
          || typeof entry.blueprint.name !== 'string' || !entry.blueprint.name.trim()
          || typeof entry.blueprint.description !== 'string' || !entry.blueprint.description.trim()) {
        throw new Error('itemCatalogue.definitions requires unique itemdef IDs, a reusable boolean, and named item blueprints with descriptions.');
      }
      for (const field of ThingFieldRegistry.BUILTIN_FIELDS) {
        const value = entry.blueprint[field.fieldName];
        if (value === undefined || value === null) continue;
        const valid = field.type === 'array' ? Array.isArray(value)
          : field.type === 'object' ? typeof value === 'object' && !Array.isArray(value)
            : field.type === 'integer' ? Number.isInteger(value)
              : field.type === 'number' ? ((typeof value === 'number' || typeof value === 'string') && value !== '' && Number.isFinite(Number(value)))
                : typeof value === field.type;
        if (!valid) throw new Error(`itemCatalogue blueprint.${field.fieldName} must be ${field.type}; restore canonical item definition data.`);
      }
      for (const field of ['attributeBonuses', 'unscaledAttributeBonuses']) {
        if (entry.blueprint[field] !== undefined && (!Array.isArray(entry.blueprint[field]) || entry.blueprint[field].some(bonus => (
          !bonus || typeof bonus.attribute !== 'string' || !bonus.attribute.trim() || !Number.isFinite(bonus.bonus)
        )))) throw new Error(`itemCatalogue blueprint.${field} requires named attributes with finite numeric bonuses.`);
      }
      for (const field of ['causeStatusEffects', 'statusEffects', 'techniqueGrants']) {
        if (entry.blueprint[field] !== undefined && (!Array.isArray(entry.blueprint[field])
            || entry.blueprint[field].some(value => !value || typeof value !== 'object' || Array.isArray(value)))) {
          throw new Error(`itemCatalogue blueprint.${field} requires an array of structural records.`);
        }
      }
      if (entry.blueprint.chargePool) ItemChargePool.normalizePool(entry.blueprint.chargePool, { template: true });
      ItemChargePool.normalizeAmmoType(entry.blueprint.ammoType);
      for (const field of ['level', 'relativeLevel']) {
        if (entry.blueprint[field] !== undefined && (!Number.isFinite(entry.blueprint[field]) || !Number.isInteger(entry.blueprint[field])
            || (field === 'level' && entry.blueprint[field] < 1))) {
          throw new Error(`itemCatalogue blueprint.${field} must be ${field === 'level' ? 'a positive' : 'an'} integer; restore the recorded item level.`);
        }
      }
      for (const field of ['statusEffects', 'techniqueGrants', 'causeStatusEffects', 'causeStatusEffectOnTarget', 'causeStatusEffectOnEquipper']) {
        if (entry.blueprint[field] !== undefined && this.#key(entry.blueprint[field]) !== this.#key(scrubBindings(entry.blueprint[field]))) {
          throw new Error(`itemCatalogue blueprint.${field} contains live instance bindings; retain only structural definition data.`);
        }
      }
      if (entry.blueprint.statusEffects !== undefined && (!Array.isArray(entry.blueprint.statusEffects)
          || entry.blueprint.statusEffects.some(effect => effect?.duration !== -1))) {
        throw new Error('itemCatalogue blueprint.statusEffects must contain only permanent intrinsic effects (duration -1).');
      }
      for (const key of [...transientFields, 'id', 'createdAt', 'lastUpdated', 'metadata']) {
        if (Object.prototype.hasOwnProperty.call(entry.blueprint, key)) throw new Error(`itemCatalogue blueprint.${key} is instance state; remove it from the definition.`);
      }
      const key = this.#key(entry.blueprint);
      if (keys.has(key)) throw new Error('itemCatalogue contains duplicate canonical blueprints; preserve one definition per blueprint.');
      ids.add(entry.id); keys.add(key);
    }
  }
  static hydrate(payload) {
    this.validateState(payload);
    this.clear();
    for (const family of payload?.families || []) {
      this.#families.set(family.id, clone(family));
      IdGenerator.register('itemFamily', family.id);
    }
    for (const entry of payload?.definitions || []) {
      const copy = clone(entry);
      this.#definitions.set(copy.id, copy);
      this.#byBlueprint.set(this.#key(copy.blueprint), copy.id);
      this.#retained.add(copy.id);
      IdGenerator.register('itemDefinition', copy.id);
    }
  }
  static clear() {
    this.#definitions.clear(); this.#byBlueprint.clear(); this.#bindings.clear(); this.#retained.clear(); this.#families.clear(); this.#generation += 1;
  }
}
module.exports = ItemCatalogue;
