class ItemModuleSystem {
    constructor({
        namespace = 'modules',
        displayLabel = 'Modules',
        moduleSlotsFieldName = 'moduleSlots',
        moduleTypeFieldName = 'moduleType',
        installedModuleIdsFieldName = 'installedModuleIds',
        moduleInstalledOnItemIdFieldName = 'moduleInstalledOnItemId',
        defaultSlotTypes = [{ id: 'module', label: 'Module', description: 'General-purpose module slot.' }]
    } = {}) {
        this.namespace = ItemModuleSystem.#requiredString(namespace, 'namespace');
        this.displayLabel = ItemModuleSystem.#requiredString(displayLabel, 'displayLabel');
        this.moduleSlotsFieldName = ItemModuleSystem.#requiredString(moduleSlotsFieldName, 'moduleSlotsFieldName');
        this.moduleTypeFieldName = ItemModuleSystem.#requiredString(moduleTypeFieldName, 'moduleTypeFieldName');
        this.installedModuleIdsFieldName = ItemModuleSystem.#requiredString(installedModuleIdsFieldName, 'installedModuleIdsFieldName');
        this.moduleInstalledOnItemIdFieldName = ItemModuleSystem.#requiredString(moduleInstalledOnItemIdFieldName, 'moduleInstalledOnItemIdFieldName');
        this.defaultSlotTypes = this.normalizeSlotTypes(defaultSlotTypes);
    }

    static #requiredString(value, fieldName) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized) {
            throw new Error(`ItemModuleSystem requires ${fieldName}.`);
        }
        return normalized;
    }

    static #clone(value) {
        if (value === undefined) {
            return undefined;
        }
        return JSON.parse(JSON.stringify(value));
    }

    static #isMeaningfulString(value) {
        if (typeof value !== 'string') {
            return false;
        }
        const normalized = value.trim().toLowerCase();
        return Boolean(normalized && normalized !== 'n/a' && normalized !== 'none' && normalized !== 'null');
    }

    static #fieldValue(item, fieldName) {
        if (!item || typeof item !== 'object') {
            return undefined;
        }
        if (typeof item.getExtensionField === 'function') {
            return item.getExtensionField(fieldName);
        }
        return item[fieldName];
    }

    static #setFieldValue(item, fieldName, value) {
        if (!item || typeof item !== 'object') {
            throw new Error(`Cannot set ${fieldName} on a missing item.`);
        }
        if (typeof item.setExtensionField === 'function') {
            item.setExtensionField(fieldName, value);
            return;
        }
        item[fieldName] = value;
    }

    static #normalizeName(value, fieldName) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized) {
            throw new Error(`${fieldName} is required.`);
        }
        return normalized;
    }

    static #normalizeId(value, fieldName) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized) {
            throw new Error(`${fieldName} is required.`);
        }
        return normalized;
    }

    static #thingType(item) {
        return typeof item?.thingType === 'string' ? item.thingType.trim().toLowerCase() : '';
    }

    static #isItem(item) {
        return ItemModuleSystem.#thingType(item) === 'item';
    }

    static #isEquippable(item) {
        return ItemModuleSystem.#isMeaningfulString(item?.slot);
    }

    static #isEquipped(item) {
        return Boolean(item?.isEquipped || item?.equippedSlot);
    }

    static #normalizeSlotTypeId(value, fieldName) {
        const id = typeof value === 'string' ? value.trim() : '';
        if (!id) {
            throw new Error(`${fieldName} is required.`);
        }
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
            throw new Error(`${fieldName} must start with a letter and contain only letters, numbers, underscores, or hyphens.`);
        }
        return id;
    }

    normalizeSlotTypes(value) {
        let raw = value;
        if (raw === null || raw === undefined || raw === '') {
            raw = this?.defaultSlotTypes || [{ id: 'module', label: 'Module', description: 'General-purpose module slot.' }];
        }
        if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (!trimmed) {
                raw = this?.defaultSlotTypes || [{ id: 'module', label: 'Module', description: 'General-purpose module slot.' }];
            } else {
                try {
                    raw = JSON.parse(trimmed);
                } catch (error) {
                    throw new Error(`Module slot types must be valid JSON: ${error.message}`);
                }
            }
        }
        if (!Array.isArray(raw)) {
            throw new Error('Module slot types must be an array.');
        }
        if (raw.length === 0) {
            throw new Error('Module slot types must include at least one slot type.');
        }

        const seen = new Set();
        return raw.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error(`slotTypes[${index}] must be an object.`);
            }
            const id = ItemModuleSystem.#normalizeSlotTypeId(entry.id, `slotTypes[${index}].id`);
            const normalizedLookup = id.toLowerCase();
            if (seen.has(normalizedLookup)) {
                throw new Error(`Module slot types contain duplicate id "${id}".`);
            }
            seen.add(normalizedLookup);
            if (entry.label !== undefined && entry.label !== null && typeof entry.label !== 'string') {
                throw new Error(`slotTypes[${index}].label must be a string when provided.`);
            }
            if (entry.description !== undefined && entry.description !== null && typeof entry.description !== 'string') {
                throw new Error(`slotTypes[${index}].description must be a string when provided.`);
            }
            const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : id;
            const description = typeof entry.description === 'string' ? entry.description.trim() : '';
            return { id, label, description };
        });
    }

    getSlotTypeMap(slotTypes) {
        return new Map(this.normalizeSlotTypes(slotTypes).map(slotType => [slotType.id, slotType]));
    }

    getConfiguredSlotTypeOptionsText(slotTypes) {
        return this.normalizeSlotTypes(slotTypes)
            .map(slotType => {
                const label = slotType.label && slotType.label !== slotType.id
                    ? `${slotType.id} (${slotType.label})`
                    : slotType.id;
                return slotType.description ? `${label}: ${slotType.description}` : label;
            })
            .join('; ');
    }

    getModuleType(item) {
        const raw = ItemModuleSystem.#fieldValue(item, this.moduleTypeFieldName);
        return ItemModuleSystem.#isMeaningfulString(raw) ? raw.trim() : '';
    }

    isModuleItem(item) {
        return Boolean(this.getModuleType(item));
    }

    getModuleSlots(item, { slotTypes = undefined, validate = false } = {}) {
        const raw = ItemModuleSystem.#fieldValue(item, this.moduleSlotsFieldName);
        if (raw === null || raw === undefined || raw === '') {
            return [];
        }
        if (!Array.isArray(raw)) {
            throw new Error(`Item "${item?.name || item?.id || 'unknown'}" ${this.moduleSlotsFieldName} must be an array.`);
        }
        const slotTypeMap = validate ? this.getSlotTypeMap(slotTypes) : null;
        return raw.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error(`Item "${item?.name || item?.id || 'unknown'}" ${this.moduleSlotsFieldName}[${index}] must be an object.`);
            }
            const type = typeof entry.type === 'string' ? entry.type.trim() : '';
            if (!type) {
                throw new Error(`Item "${item?.name || item?.id || 'unknown'}" ${this.moduleSlotsFieldName}[${index}].type is required.`);
            }
            if (slotTypeMap && !slotTypeMap.has(type)) {
                throw new Error(`Item "${item?.name || item?.id || 'unknown'}" has unknown module slot type "${type}".`);
            }
            if (entry.label !== undefined && entry.label !== null && typeof entry.label !== 'string') {
                throw new Error(`Item "${item?.name || item?.id || 'unknown'}" ${this.moduleSlotsFieldName}[${index}].label must be a string when provided.`);
            }
            const configured = slotTypeMap?.get(type) || null;
            const label = typeof entry.label === 'string' && entry.label.trim()
                ? entry.label.trim()
                : (configured?.label || type);
            return { type, label };
        });
    }

    getInstalledModuleIds(baseItem) {
        const raw = ItemModuleSystem.#fieldValue(baseItem, this.installedModuleIdsFieldName);
        if (raw === null || raw === undefined || raw === '') {
            return [];
        }
        if (!Array.isArray(raw)) {
            throw new Error(`Item "${baseItem?.name || baseItem?.id || 'unknown'}" ${this.installedModuleIdsFieldName} must be an array.`);
        }
        const seen = new Set();
        const ids = [];
        raw.forEach((entry, index) => {
            const id = typeof entry === 'string' ? entry.trim() : '';
            if (!id) {
                throw new Error(`Item "${baseItem?.name || baseItem?.id || 'unknown'}" ${this.installedModuleIdsFieldName}[${index}] must be a non-empty string.`);
            }
            if (seen.has(id)) {
                throw new Error(`Item "${baseItem?.name || baseItem?.id || 'unknown'}" lists installed module "${id}" more than once.`);
            }
            seen.add(id);
            ids.push(id);
        });
        return ids;
    }

    setInstalledModuleIds(baseItem, ids) {
        ItemModuleSystem.#setFieldValue(baseItem, this.installedModuleIdsFieldName, ids);
    }

    getModuleInstalledOnItemId(moduleItem) {
        const raw = ItemModuleSystem.#fieldValue(moduleItem, this.moduleInstalledOnItemIdFieldName);
        return ItemModuleSystem.#isMeaningfulString(raw) ? raw.trim() : '';
    }

    setModuleInstalledOnItemId(moduleItem, baseItemId) {
        ItemModuleSystem.#setFieldValue(moduleItem, this.moduleInstalledOnItemIdFieldName, baseItemId || null);
    }

    validateItemModuleFields(item, { slotTypes = undefined } = {}) {
        const normalizedSlotTypes = this.normalizeSlotTypes(slotTypes);
        const slotTypeMap = new Map(normalizedSlotTypes.map(slotType => [slotType.id, slotType]));
        const itemLabel = item?.name || item?.id || 'unknown item';
        const moduleSlots = this.getModuleSlots(item, { slotTypes: normalizedSlotTypes, validate: true });
        const moduleType = this.getModuleType(item);

        if (moduleSlots.length && !ItemModuleSystem.#isItem(item)) {
            throw new Error(`Only item Things may have module slots; "${itemLabel}" is not an item.`);
        }
        if (moduleSlots.length && !ItemModuleSystem.#isEquippable(item)) {
            throw new Error(`Only equippable items may have module slots; "${itemLabel}" has no equipment slot.`);
        }
        if (moduleType) {
            if (!ItemModuleSystem.#isItem(item)) {
                throw new Error(`Only item Things may be modules; "${itemLabel}" is not an item.`);
            }
            if (!slotTypeMap.has(moduleType)) {
                throw new Error(`Item "${itemLabel}" has unknown module type "${moduleType}".`);
            }
            if (moduleSlots.length) {
                throw new Error(`Module item "${itemLabel}" must not have module slots.`);
            }
        }
        return { moduleSlots, moduleType };
    }

    #inventoryItems(actor) {
        if (!actor || typeof actor.getInventoryItems !== 'function') {
            throw new Error(`${this.displayLabel} operations require an actor with inventory items.`);
        }
        const items = actor.getInventoryItems();
        if (!Array.isArray(items)) {
            throw new Error(`${this.displayLabel} actor inventory must be an array.`);
        }
        return items;
    }

    #inventoryMap(actor) {
        const items = this.#inventoryItems(actor);
        return new Map(items.filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
    }

    #assertInventoryContains(actor, item, role) {
        const items = this.#inventoryItems(actor);
        const found = items.find(candidate => candidate === item || (candidate?.id && candidate.id === item?.id));
        if (!found) {
            throw new Error(`${role} "${item?.name || item?.id || 'unknown'}" is not in ${actor.name || 'actor'} inventory.`);
        }
        return found;
    }

    #findInventoryItemByName(actor, itemName, fieldName) {
        const normalizedName = ItemModuleSystem.#normalizeName(itemName, fieldName).toLowerCase();
        const matches = this.#inventoryItems(actor).filter(item => {
            const name = typeof item?.name === 'string' ? item.name.trim().toLowerCase() : '';
            return name === normalizedName;
        });
        if (!matches.length) {
            throw new Error(`No inventory item named "${itemName}" found for ${actor.name || 'actor'}.`);
        }
        if (matches.length > 1) {
            throw new Error(`Ambiguous inventory item "${itemName}" for ${actor.name || 'actor'}.`);
        }
        return matches[0];
    }

    #resolveItem(actor, { item, itemName, itemId, role, nameField }) {
        if (item) {
            return this.#assertInventoryContains(actor, item, role);
        }
        if (itemId) {
            const normalizedId = ItemModuleSystem.#normalizeId(itemId, `${role} id`);
            const found = this.#inventoryItems(actor).find(candidate => candidate?.id === normalizedId);
            if (!found) {
                throw new Error(`${role} "${normalizedId}" is not in ${actor.name || 'actor'} inventory.`);
            }
            return found;
        }
        return this.#findInventoryItemByName(actor, itemName, nameField);
    }

    #resolveBaseAndModule(actor, options = {}, { allowBaseFromModule = false } = {}) {
        const moduleItem = this.#resolveItem(actor, {
            item: options.moduleItem,
            itemName: options.moduleItemName,
            itemId: options.moduleItemId,
            role: 'Module item',
            nameField: 'moduleItemName'
        });
        let baseItem = null;
        if (options.baseItem || options.baseItemName || options.baseItemId) {
            baseItem = this.#resolveItem(actor, {
                item: options.baseItem,
                itemName: options.baseItemName,
                itemId: options.baseItemId,
                role: 'Base item',
                nameField: 'baseItemName'
            });
        } else if (allowBaseFromModule) {
            const baseItemId = this.getModuleInstalledOnItemId(moduleItem);
            if (!baseItemId) {
                throw new Error(`Module item "${moduleItem.name || moduleItem.id}" is not installed on a base item.`);
            }
            baseItem = this.#resolveItem(actor, {
                itemId: baseItemId,
                role: 'Base item',
                nameField: 'baseItemName'
            });
        } else {
            throw new Error('baseItemName or baseItemId is required.');
        }
        return { baseItem, moduleItem };
    }

    #slotForInstall({ actor, baseItem, moduleItem, slotType, slotTypes }) {
        const normalizedSlotTypes = this.normalizeSlotTypes(slotTypes);
        this.validateItemModuleFields(baseItem, { slotTypes: normalizedSlotTypes });
        this.validateItemModuleFields(moduleItem, { slotTypes: normalizedSlotTypes });

        const moduleType = this.getModuleType(moduleItem);
        if (!moduleType) {
            throw new Error(`Item "${moduleItem.name || moduleItem.id || 'unknown'}" is not a module item.`);
        }
        const requestedSlotType = typeof slotType === 'string' ? slotType.trim() : '';
        if (requestedSlotType && requestedSlotType !== moduleType) {
            throw new Error(`Module slot mismatch for "${moduleItem.name || moduleItem.id}": requested "${requestedSlotType}", module type is "${moduleType}".`);
        }

        const inventoryById = this.#inventoryMap(actor);
        const installedIds = this.getInstalledModuleIds(baseItem);
        const usedSlotsByType = new Map();
        for (const installedId of installedIds) {
            const installedModule = inventoryById.get(installedId);
            if (!installedModule) {
                throw new Error(`Base item "${baseItem.name || baseItem.id}" references missing installed module "${installedId}".`);
            }
            const installedType = this.getModuleType(installedModule);
            if (!installedType) {
                throw new Error(`Installed item "${installedModule.name || installedId}" is no longer a module.`);
            }
            usedSlotsByType.set(installedType, (usedSlotsByType.get(installedType) || 0) + 1);
        }

        const slots = this.getModuleSlots(baseItem, { slotTypes: normalizedSlotTypes, validate: true });
        const matchingSlots = slots.filter(slot => slot.type === moduleType);
        if (!matchingSlots.length) {
            throw new Error(`Base item "${baseItem.name || baseItem.id}" has no "${moduleType}" module slot.`);
        }
        const usedCount = usedSlotsByType.get(moduleType) || 0;
        if (usedCount >= matchingSlots.length) {
            throw new Error(`Base item "${baseItem.name || baseItem.id}" has no open "${moduleType}" module slot.`);
        }
        return matchingSlots[usedCount];
    }

    install(options = {}) {
        const actor = options.actor;
        if (!actor) {
            throw new Error('Install module requires an actor.');
        }
        const { baseItem, moduleItem } = this.#resolveBaseAndModule(actor, options);
        if (!baseItem.id || !moduleItem.id) {
            throw new Error('Installing a module requires stable ids on both items.');
        }
        if (baseItem.id === moduleItem.id) {
            throw new Error('An item cannot be installed into itself as a module.');
        }
        if (Number(moduleItem.count || 1) > 1) {
            throw new Error(`Module item "${moduleItem.name || moduleItem.id}" is stacked and cannot be installed.`);
        }
        if (ItemModuleSystem.#isEquipped(moduleItem)) {
            throw new Error(`Module item "${moduleItem.name || moduleItem.id}" is equipped and cannot be installed.`);
        }
        const existingBaseId = this.getModuleInstalledOnItemId(moduleItem);
        if (existingBaseId) {
            throw new Error(`Module item "${moduleItem.name || moduleItem.id}" is already installed on "${existingBaseId}".`);
        }

        const installedIds = this.getInstalledModuleIds(baseItem);
        if (installedIds.includes(moduleItem.id)) {
            throw new Error(`Module item "${moduleItem.name || moduleItem.id}" is already installed on "${baseItem.name || baseItem.id}".`);
        }
        const slot = this.#slotForInstall({
            actor,
            baseItem,
            moduleItem,
            slotType: options.slotType,
            slotTypes: options.slotTypes
        });

        const mutate = () => {
            this.setInstalledModuleIds(baseItem, [...installedIds, moduleItem.id]);
            this.setModuleInstalledOnItemId(moduleItem, baseItem.id);
        };
        if (typeof actor.withHealthRatioPreserved === 'function') {
            actor.withHealthRatioPreserved(mutate);
        } else {
            mutate();
        }

        return {
            actor,
            baseItem,
            moduleItem,
            slot,
            reason: typeof options.reason === 'string' ? options.reason.trim() : ''
        };
    }

    remove(options = {}) {
        const actor = options.actor;
        if (!actor) {
            throw new Error('Remove module requires an actor.');
        }
        const { baseItem, moduleItem } = this.#resolveBaseAndModule(actor, options, { allowBaseFromModule: true });
        const installedIds = this.getInstalledModuleIds(baseItem);
        if (!installedIds.includes(moduleItem.id)) {
            throw new Error(`Module item "${moduleItem.name || moduleItem.id}" is not installed on "${baseItem.name || baseItem.id}".`);
        }
        const linkedBaseId = this.getModuleInstalledOnItemId(moduleItem);
        if (linkedBaseId && linkedBaseId !== baseItem.id) {
            throw new Error(`Module item "${moduleItem.name || moduleItem.id}" is linked to "${linkedBaseId}", not "${baseItem.id}".`);
        }

        const mutate = () => {
            this.setInstalledModuleIds(baseItem, installedIds.filter(id => id !== moduleItem.id));
            this.setModuleInstalledOnItemId(moduleItem, null);
        };
        if (typeof actor.withHealthRatioPreserved === 'function') {
            actor.withHealthRatioPreserved(mutate);
        } else {
            mutate();
        }

        return {
            actor,
            baseItem,
            moduleItem,
            reason: typeof options.reason === 'string' ? options.reason.trim() : ''
        };
    }

    listInstalledModules(actor, baseItem) {
        const inventoryById = this.#inventoryMap(actor);
        return this.getInstalledModuleIds(baseItem)
            .map(moduleId => {
                const moduleItem = inventoryById.get(moduleId);
                if (!moduleItem) {
                    return null;
                }
                const moduleType = this.getModuleType(moduleItem);
                const slot = this.getModuleSlots(baseItem).find(entry => entry.type === moduleType) || { type: moduleType, label: moduleType };
                return { moduleId, moduleItem, baseItem, slot };
            })
            .filter(Boolean);
    }

    syncWithInventory(actor) {
        const inventory = this.#inventoryItems(actor);
        const inventoryIds = new Set(inventory.filter(item => item?.id).map(item => item.id));
        let changed = false;

        for (const item of inventory) {
            if (!item?.id) {
                continue;
            }
            const installedIds = this.getInstalledModuleIds(item);
            if (installedIds.length) {
                const filtered = installedIds.filter(id => inventoryIds.has(id));
                if (filtered.length !== installedIds.length) {
                    this.setInstalledModuleIds(item, filtered);
                    changed = true;
                }
            }

            const baseId = this.getModuleInstalledOnItemId(item);
            if (baseId && !inventoryIds.has(baseId)) {
                this.setModuleInstalledOnItemId(item, null);
                changed = true;
            }
        }
        return changed;
    }

    #itemAttributeBonus(item, attributeName) {
        if (!item) {
            return 0;
        }
        if (typeof item.getAttributeBonus === 'function') {
            const value = Number(item.getAttributeBonus(attributeName));
            return Number.isFinite(value) ? value : 0;
        }
        const normalizedAttribute = typeof attributeName === 'string' ? attributeName.trim().toLowerCase() : '';
        if (!normalizedAttribute) {
            return 0;
        }
        if (Array.isArray(item.attributeBonuses)) {
            return item.attributeBonuses.reduce((total, entry) => {
                const entryAttribute = typeof entry?.attribute === 'string'
                    ? entry.attribute.trim().toLowerCase()
                    : (typeof entry?.name === 'string' ? entry.name.trim().toLowerCase() : '');
                if (entryAttribute !== normalizedAttribute) {
                    return total;
                }
                const value = Number(entry.bonus ?? entry.value ?? entry.modifier);
                return Number.isFinite(value) ? total + value : total;
            }, 0);
        }
        if (item.attributeBonuses && typeof item.attributeBonuses === 'object') {
            const value = Number(item.attributeBonuses[attributeName] ?? item.attributeBonuses[normalizedAttribute]);
            return Number.isFinite(value) ? value : 0;
        }
        return 0;
    }

    #effectForItem(item, target) {
        const direct = target === 'target'
            ? item?.causeStatusEffectOnTarget
            : item?.causeStatusEffectOnEquipper;
        const fallback = item?.causeStatusEffect && item.causeStatusEffect[`applyTo${target === 'target' ? 'Target' : 'Equipper'}`]
            ? item.causeStatusEffect
            : null;
        const effect = direct || fallback || null;
        if (!effect || (!effect.description && !effect.name)) {
            return null;
        }
        return {
            name: effect.name || null,
            description: effect.description || effect.text || effect.name || '',
            duration: effect.duration ?? null,
            attributes: Array.isArray(effect.attributes) ? ItemModuleSystem.#clone(effect.attributes) : [],
            skills: Array.isArray(effect.skills) ? ItemModuleSystem.#clone(effect.skills) : [],
            needBars: Array.isArray(effect.needBars) ? ItemModuleSystem.#clone(effect.needBars) : []
        };
    }

    getEffectiveAttributeBonus(actor, baseItem, attributeName) {
        const baseBonus = this.#itemAttributeBonus(baseItem, attributeName);
        const moduleBonus = this.listInstalledModules(actor, baseItem)
            .reduce((total, entry) => total + this.#itemAttributeBonus(entry.moduleItem, attributeName), 0);
        return baseBonus + moduleBonus;
    }

    getAttributeModifierContributions(actor, attributeName) {
        return this.#inventoryItems(actor)
            .filter(item => item && ItemModuleSystem.#isEquipped(item))
            .reduce((total, baseItem) => {
                const moduleBonus = this.listInstalledModules(actor, baseItem)
                    .reduce((sum, entry) => sum + this.#itemAttributeBonus(entry.moduleItem, attributeName), 0);
                return total + moduleBonus;
            }, 0);
    }

    getStatusEffectContributions(actor) {
        return this.#inventoryItems(actor)
            .filter(item => item && ItemModuleSystem.#isEquipped(item))
            .flatMap(baseItem => this.listInstalledModules(actor, baseItem)
                .map(entry => this.#effectForItem(entry.moduleItem, 'equipper'))
                .filter(Boolean));
    }

    getTargetStatusEffectContributions(actor, baseItem) {
        return this.listInstalledModules(actor, baseItem)
            .map(entry => this.#effectForItem(entry.moduleItem, 'target'))
            .filter(Boolean);
    }

    getActorStatusSection(actor, context = {}) {
        const entries = this.#inventoryItems(actor).flatMap(baseItem => (
            this.listInstalledModules(actor, baseItem).map(entry => ({
                baseItemId: baseItem.id || null,
                baseItemName: baseItem.name || null,
                moduleItemId: entry.moduleItem.id || null,
                moduleItemName: entry.moduleItem.name || null,
                slot: entry.slot?.label || entry.slot?.type || this.getModuleType(entry.moduleItem),
                description: entry.moduleItem.shortDescription || entry.moduleItem.description || ''
            }))
        ));
        if (!entries.length) {
            return null;
        }
        return {
            key: this.namespace,
            label: this.getDisplayLabel(context),
            entries
        };
    }

    getDisplayLabel(context = {}) {
        const setting = context.setting || context.currentSetting || null;
        const configured = setting && typeof setting.getModSetting === 'function'
            ? setting.getModSetting(this.namespace, 'displayLabel', null)
            : setting?.modSettings?.[this.namespace]?.displayLabel;
        return typeof configured === 'string' && configured.trim()
            ? configured.trim()
            : this.displayLabel;
    }

    parseXmlRaw(raw) {
        if (typeof raw !== 'string' || !raw.trim()) {
            throw new Error(`${this.displayLabel} XML event payload is required.`);
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`${this.displayLabel} XML event payload must be an object.`);
        }
        return parsed;
    }
}

module.exports = ItemModuleSystem;
