const Globals = require('./Globals.js');

const cloneJsonish = (value) => {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
};

const BUILTIN_FIELDS = Object.freeze([
    { fieldName: 'name', type: 'string', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'description', type: 'string', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'shortDescription', type: 'string', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'thingType', aliases: ['itemOrScenery'], type: 'string', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'itemTypeDetail', aliases: ['type'], type: 'string', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'rarity', type: 'string', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'slot', type: 'string', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'count', type: 'integer', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'level', type: 'integer', exposeToCreateTool: false, exposeToUpdateTool: true },
    { fieldName: 'relativeLevel', type: 'integer', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'value', type: 'number', storage: 'metadata', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'weight', type: 'number', storage: 'metadata', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'properties', type: 'string', storage: 'metadata', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'isVehicle', type: 'boolean', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'isCraftingStation', type: 'boolean', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'isProcessingStation', type: 'boolean', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'isHarvestable', type: 'boolean', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'isSalvageable', type: 'boolean', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'isContainer', type: 'boolean', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'requiresCheckToOpen', type: 'boolean', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'containerContents', type: 'array', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'containedThingIds', type: 'array', exposeToCreateTool: false, exposeToUpdateTool: false },
    { fieldName: 'attributeBonuses', type: 'array', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'unscaledAttributeBonuses', type: 'array', exposeToCreateTool: false, exposeToUpdateTool: true },
    { fieldName: 'causeStatusEffectOnTarget', type: 'object', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'causeStatusEffectOnEquipper', type: 'object', exposeToCreateTool: true, exposeToUpdateTool: true },
    { fieldName: 'statusEffects', type: 'array', exposeToCreateTool: false, exposeToUpdateTool: true },
    { fieldName: 'imageId', type: 'string', exposeToCreateTool: false, exposeToUpdateTool: false },
    { fieldName: 'imagePrompt', type: 'string', exposeToCreateTool: false, exposeToUpdateTool: false }
]);

class ThingFieldRegistry {
    constructor({ getModExtensionRegistry = null } = {}) {
        this.getModExtensionRegistry = typeof getModExtensionRegistry === 'function'
            ? getModExtensionRegistry
            : () => Globals.modExtensionRegistry || null;
    }

    getFields(filter = {}) {
        const registry = this.getModExtensionRegistry();
        const extensionFields = registry && typeof registry.getEntityFields === 'function'
            ? registry.getEntityFields('thing')
            : [];
        const fields = [
            ...BUILTIN_FIELDS.map(field => ({ ...field, aliases: [...(field.aliases || [])], builtIn: true })),
            ...extensionFields.map(field => ({ ...field, aliases: [], builtIn: false, storage: 'extension' }))
        ];
        return fields.filter(field => Object.entries(filter).every(([key, expected]) => (
            expected === undefined || field[key] === expected
        )));
    }

    getFieldMap(filter = {}) {
        const map = new Map();
        for (const field of this.getFields(filter)) {
            map.set(field.fieldName, field);
            for (const alias of field.aliases || []) {
                map.set(alias, field);
            }
        }
        return map;
    }

    normalizePatch(patch, { allowUnknown = false, filter = {} } = {}) {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new TypeError('Thing field patch must be an object.');
        }
        const fieldMap = this.getFieldMap(filter);
        const normalized = {};
        for (const [inputName, value] of Object.entries(patch)) {
            const field = fieldMap.get(inputName);
            if (!field) {
                if (allowUnknown) continue;
                throw new Error(`Unknown or unavailable Thing field "${inputName}".`);
            }
            if (Object.prototype.hasOwnProperty.call(normalized, field.fieldName)) {
                throw new Error(`Thing field "${field.fieldName}" was supplied more than once through aliases.`);
            }
            normalized[field.fieldName] = cloneJsonish(value);
        }
        return normalized;
    }

    applyPatchToData(sourceData, patch, { filter = {}, allowUnknown = false } = {}) {
        const data = cloneJsonish(sourceData || {});
        const normalizedPatch = this.normalizePatch(patch, { filter, allowUnknown });
        const fieldMap = this.getFieldMap();
        data.metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
            ? { ...data.metadata }
            : {};

        for (const [fieldName, value] of Object.entries(normalizedPatch)) {
            const field = fieldMap.get(fieldName);
            if (field.storage === 'metadata') {
                if (value === null || value === undefined || value === '') {
                    delete data.metadata[fieldName];
                } else {
                    data.metadata[fieldName] = cloneJsonish(value);
                }
                continue;
            }
            data[fieldName] = cloneJsonish(value);
            if (fieldName === 'causeStatusEffectOnTarget' || fieldName === 'causeStatusEffectOnEquipper') {
                delete data.causeStatusEffects;
                delete data.causeStatusEffect;
                if (data.metadata) {
                    delete data.metadata.causeStatusEffects;
                    delete data.metadata.causeStatusEffect;
                    data.metadata[fieldName] = cloneJsonish(value);
                }
            }
        }

        for (const field of this.getFields({ builtIn: false })) {
            if (
                field.clearThingSlotWhenPresent === true
                && Object.prototype.hasOwnProperty.call(normalizedPatch, field.fieldName)
                && ThingFieldRegistry.hasMeaningfulValue(normalizedPatch[field.fieldName])
            ) {
                data.slot = null;
                delete data.metadata.slot;
            }
        }
        return { data, normalizedPatch };
    }

    static hasMeaningfulValue(value) {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            return Boolean(normalized && !['n/a', 'none', 'null'].includes(normalized));
        }
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object') return Object.keys(value).length > 0;
        return true;
    }
}

ThingFieldRegistry.BUILTIN_FIELDS = BUILTIN_FIELDS;

module.exports = ThingFieldRegistry;
