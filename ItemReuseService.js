const ItemCatalogue = require('./ItemCatalogue.js');
const Thing = require('./Thing.js');
const ItemChargePool = require('./ItemChargePool.js');
const IdGenerator = require('./IdGenerator.js');

const clone = value => JSON.parse(JSON.stringify(value));
const key = value => String(value || '').trim().normalize('NFC').toLowerCase();
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(field => [field, ordered(value[field])])) : value;
const same = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));

/** Per-operation preparation, shared authoring, and explicit post-commit persistence. */
class ItemReuseService {
    constructor({ catalogue = ItemCatalogue, authorFamily, prepareVariant = null, rarityDefinitions = null } = {}) {
        if (typeof authorFamily !== 'function') throw new Error('Item reuse requires an authorFamily callback.');
        this.catalogue = catalogue;
        this.authorFamily = authorFamily;
        this.prepareVariant = prepareVariant;
        this.rarityDefinitions = rarityDefinitions;
        this.inflight = new Map();
    }

    static stripBindings(value) {
        if (Array.isArray(value)) return value.map(ItemReuseService.stripBindings);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
            .filter(([field]) => !['id', 'sourceItemId', 'sourceStatusId', 'sourceId', 'appliedAt', 'createdAt', 'lastUpdated'].includes(field))
            .map(([field, child]) => [field, ItemReuseService.stripBindings(child)]));
        return value;
    }

    static materializeBindings(value) {
        const item = clone(value);
        if (item.chargePool && item.chargePool.amount === undefined) item.chargePool = ItemChargePool.materialize(item.chargePool);
        const freshGrant = grant => ({ ...grant,
            id: IdGenerator.next('techniqueGrant', require('./TechniqueService.js').getDefinition(grant.techniqueId)?.name || item.name) });
        if (item.techniqueGrants?.length) item.techniqueGrants = item.techniqueGrants.map(grant => ({ ...freshGrant(grant), sourceItemId: null }));
        const status = effect => {
            if (!effect || typeof effect !== 'object') return effect;
            const copy = clone(effect);
            if (copy.techniqueGrants?.length) copy.techniqueGrants = copy.techniqueGrants.map(freshGrant);
            return copy;
        };
        for (const field of ['causeStatusEffectOnTarget', 'causeStatusEffectOnEquipper', 'causeStatusEffect']) {
            if (item[field]) item[field] = Array.isArray(item[field]) ? item[field].map(status) : status(item[field]);
        }
        for (const field of ['causeStatusEffects', 'statusEffects']) if (item[field]) item[field] = item[field].map(status);
        return item;
    }

    getRarities() {
        return typeof this.rarityDefinitions === 'function'
            ? this.rarityDefinitions() : (this.rarityDefinitions || Thing.getAllRarityDefinitions());
    }

    normalizeRarity(value) {
        const found = this.getRarities().find(entry => [entry.key, entry.label].some(name => key(name) === key(value)));
        if (!found) throw new Error(`item.rarity "${value}" is unknown; choose ${this.getRarities().map(entry => entry.key).join(', ')}.`);
        return found.key;
    }

    validateFamily(value, requestedName) {
        if (value === null || value?.reusable === false) return null;
        if (!value || typeof value !== 'object') throw new Error('itemFamily requires a standard-item family or reusable=false.');
        if (key(value.name) !== key(requestedName)) throw new Error(`itemFamily.name must be "${requestedName}"; preserve the requested item identity.`);
        const minimumRarity = this.normalizeRarity(value.minimumRarity);
        const maximumRarity = this.normalizeRarity(value.maximumRarity);
        const definitions = this.getRarities();
        const low = definitions.findIndex(entry => entry.key === minimumRarity);
        const high = definitions.findIndex(entry => entry.key === maximumRarity);
        if (low > high) throw new Error('itemFamily.minimumRarity must precede maximumRarity in the configured rarity order.');
        const rarities = definitions.slice(low, high + 1).map(entry => entry.key);
        if (!Array.isArray(value.variants) || value.variants.length !== rarities.length) {
            throw new Error(`itemFamily.variants requires exactly one item for every allowed rarity: ${rarities.join(', ')}.`);
        }
        const variants = value.variants.map((raw, index) => {
            const item = clone(raw);
            for (const field of ['techniqueGrants', 'statusEffects', 'causeStatusEffects', 'causeStatusEffectOnTarget', 'causeStatusEffectOnEquipper', 'causeStatusEffect']) {
                if (item[field]) item[field] = ItemReuseService.stripBindings(item[field]);
            }
            if (key(item.name) !== key(requestedName)) throw new Error(`itemFamily.variants[${index}].name must be "${requestedName}".`);
            item.name = requestedName.trim();
            if ((item.itemOrScenery || item.thingType) !== 'item') throw new Error(`itemFamily.variants[${index}] must be a portable item; scenery cannot be a standard item family.`);
            item.rarity = this.normalizeRarity(item.rarity);
            if (!rarities.includes(item.rarity)) throw new Error(`itemFamily.variants[${index}].rarity must be one of ${rarities.join(', ')}.`);
            if (item.hiddenFromPlayer === true || item.containedThingIds?.length || item.containerContents?.length
                || item.installedModuleIds?.length || item.moduleInstalledOnItemId) {
                throw new Error(`itemFamily.variants[${index}] contains instance state; omit hidden state, contents and installed-module bindings.`);
            }
            for (const field of ['value', 'weight']) {
                if (item[field] === undefined || item[field] === null || (typeof item[field] === 'string' && !item[field].trim())) delete item[field];
                else if ((typeof item[field] !== 'number' && typeof item[field] !== 'string') || !Number.isFinite(Number(item[field]))) {
                    throw new Error(`itemFamily.variants[${index}].${field} must be a finite number or omitted.`);
                } else item[field] = Number(item[field]);
            }
            if (item.statusEffects !== undefined && (!Array.isArray(item.statusEffects) || item.statusEffects.some(effect => !effect || effect.duration !== -1))) {
                throw new Error(`itemFamily.variants[${index}].statusEffects must contain only permanent intrinsic effects (duration -1); omit temporary item buffs.`);
            }
            if (item.chargePool) {
                const pool = ItemChargePool.normalizePool(item.chargePool, { template: item.chargePool.amount === undefined });
                if (pool.initialAmount === undefined) throw new Error(`itemFamily.variants[${index}].chargePool.initialAmount is required; declare charge for fresh copies explicitly.`);
                item.chargePool = ItemChargePool.templateFrom(pool);
            }
            item.count = 1;
            item.itemOrScenery = 'item';
            if (!Array.isArray(item.attributeBonuses)) item.attributeBonuses = [];
            item.unscaledAttributeBonuses = clone(item.attributeBonuses);
            if (this.prepareVariant) this.prepareVariant(ItemReuseService.materializeBindings(item));
            return item;
        });
        if (new Set(variants.map(item => item.rarity)).size !== rarities.length) {
            throw new Error('itemFamily.variants repeats a rarity; return every allowed rarity exactly once.');
        }
        return { name: requestedName.trim(), minimumRarity, maximumRarity, rarities,
            variants: rarities.map(rarity => variants.find(item => item.rarity === rarity)) };
    }

    createSession() {
        const service = this;
        const epoch = this.catalogue.generation;
        if (this.epoch !== epoch) { this.inflight.clear(); this.epoch = epoch; }
        const staged = new Map();
        let committed = false;
        const assertCurrent = () => {
            if (service.catalogue.generation !== epoch) throw new Error('Item generation was cancelled because the game changed; start a new request in the current game.');
            if (committed) throw new Error('Item reuse session is already committed.');
            service.catalogue.validateFamilyCommit([...staged.values()]);
        };
        const lookup = name => {
            const matches = [...service.catalogue.getFamiliesByName(name), ...[...staged.values()].filter(family => key(family.name) === key(name))].filter((family, index, all) => (
                all.findIndex(other => other.id && other.id === family.id || key(other.name) === key(family.name)
                    && same(other.variants, family.variants)) === index
            ));
            if (matches.length > 1) throw new Error(`Item name "${name}" matches multiple standard families; use a distinct exact item name rather than choosing an arbitrary definition.`);
            return matches[0] || null;
        };
        return {
            assertCurrent,
            getPromptFamilies() { return service.catalogue.getFamilies().map(({ id, name, rarities }) => ({ id, name, rarities })); },
            async resolve(request = {}) {
                assertCurrent();
                const name = typeof request.name === 'string' ? request.name.trim() : '';
                if (!name || request.itemOrScenery === 'scenery' || request.seed?.itemOrScenery === 'scenery') return null;
                const seed = request.seed || {};
                if (request.withNestedPrompt != null && typeof request.withNestedPrompt !== 'function') {
                    throw new TypeError('Item reuse withNestedPrompt must be a callback runner.');
                }
                // Free-form overrides may describe a personal or unique modification.
                if (typeof seed.notes === 'string' && seed.notes.trim()) return null;
                let family = lookup(name);
                if (!family) {
                    const canonicalSeed = Object.fromEntries(Object.entries(seed).filter(([field]) => !['count', 'relativeLevel', 'level', 'hiddenFromPlayer', 'discoveryDifficulty', 'rarity', 'reason'].includes(field)));
                    const authorKey = `${epoch}:${key(name)}:${JSON.stringify(ordered(canonicalSeed))}`;
                    const awaitAuthoring = () => {
                        if (!service.inflight.has(authorKey)) {
                            const pending = Promise.resolve().then(() => service.authorFamily({ ...request, name, seed: canonicalSeed }))
                                .then(value => service.validateFamily(value, name));
                            service.inflight.set(authorKey, pending);
                            pending.catch(() => { if (service.inflight.get(authorKey) === pending) service.inflight.delete(authorKey); });
                        }
                        return service.inflight.get(authorKey);
                    };
                    family = request.withNestedPrompt
                        ? await request.withNestedPrompt(awaitAuthoring)
                        : await awaitAuthoring();
                    assertCurrent();
                    if (!family) return null;

                }
                const requestedRarity = request.rarity ?? seed.rarity;
                let rarity;
                if (requestedRarity !== undefined && requestedRarity !== null && String(requestedRarity).trim()) {
                    rarity = service.normalizeRarity(requestedRarity);
                    if (!family.rarities.includes(rarity)) throw new Error(`Item "${name}" cannot have rarity "${rarity}"; choose ${family.rarities.join(', ')} or a different item.`);
                } else {
                    // Use configured prevalence only within the family's allowed range.
                    const choices = service.getRarities().filter(entry => family.rarities.includes(entry.key));
                    const total = choices.reduce((sum, entry) => sum + (Number(entry.prevalence) || 0), 0);
                    if (total <= 0) throw new Error(`Item family "${name}" has no positive configured rarity prevalence.`);
                    let roll = Math.random() * total;
                    rarity = choices[choices.length - 1].key;
                    for (const entry of choices) { roll -= Number(entry.prevalence) || 0; if (roll < 0) { rarity = entry.key; break; } }
                }
                const variant = family.variants.find(item => item.rarity === rarity);
                if (!variant) throw new Error(`Item family "${name}" lacks its saved ${rarity} variant; repair the catalogue before generating copies.`);
                const ignored = new Set(['name', 'rarity', 'count', 'relativeLevel', 'level', 'hiddenFromPlayer', 'discoveryDifficulty', 'itemOrScenery', 'thingType', 'reason']);
                for (const [field, value] of Object.entries(seed)) {
                    if (ignored.has(field) || value === undefined || value === null || value === '') continue;
                    if (['value', 'weight'].includes(field) && Number.isFinite(Number(value)) && Number.isFinite(Number(variant[field]))) {
                        if (Number(value) !== Number(variant[field])) return null;
                    } else if (!same(value, variant[field])) return null;
                }
                if (!family.id) staged.set(key(name), family);
                const item = clone(variant);
                item.name = name;
                item.itemReuseFamilyName = family.name;
                item.count = request.count ?? seed.count ?? 1;
                item.relativeLevel = request.relativeLevel ?? seed.relativeLevel ?? item.relativeLevel ?? 0;
                item.hiddenFromPlayer = seed.hiddenFromPlayer ?? false;
                item.discoveryDifficulty = seed.discoveryDifficulty ?? null;
                item.attributeBonuses = clone(variant.unscaledAttributeBonuses);
                return ItemReuseService.materializeBindings(item);
            },
            commit() {
                assertCurrent();
                service.catalogue.commitFamilies([...staged.values()]);
                committed = true;
            }
        };
    }
}
module.exports = ItemReuseService;
