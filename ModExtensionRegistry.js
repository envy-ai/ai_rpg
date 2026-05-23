class ModExtensionRegistry {
    #chatTools = new Map();
    #reservedChatToolNames = new Set();
    #xmlEventsByTag = new Map();
    #xmlEventsByKey = new Map();
    #baseContextContributors = [];
    #actorStatusContributors = [];
    #attributeModifierContributors = [];
    #statusEffectContributors = [];
    #inventorySyncContributors = [];
    #settingFields = new Map();
    #settingTabs = new Map();
    #entityFieldsByType = new Map();
    #startupValidators = [];

    static #thingReservedFieldNames = new Set([
        'id',
        'name',
        'description',
        'shortDescription',
        'thingType',
        'imageId',
        'createdAt',
        'lastUpdated',
        'rarity',
        'itemTypeDetail',
        'metadata',
        'statusEffects',
        'slot',
        'attributeBonuses',
        'unscaledAttributeBonuses',
        'causeStatusEffect',
        'causeStatusEffectOnTarget',
        'causeStatusEffectOnEquipper',
        'count',
        'level',
        'relativeLevel',
        'previouslyHarvestedItems',
        'lastHarvested',
        'isVehicle',
        'isCraftingStation',
        'isProcessingStation',
        'isHarvestable',
        'isSalvageable',
        'isContainer',
        'containerContents',
        'containedThingIds',
        'flags'
    ]);

    constructor({ reservedChatToolNames = [] } = {}) {
        if (Array.isArray(reservedChatToolNames)) {
            this.#reservedChatToolNames = new Set(
                reservedChatToolNames
                    .map(name => (typeof name === 'string' ? name.trim() : ''))
                    .filter(Boolean)
            );
        }
    }

    static #normalizeModName(modName) {
        const normalized = typeof modName === 'string' ? modName.trim() : '';
        if (!normalized) {
            throw new Error('Mod extension registration requires modName.');
        }
        return normalized;
    }

    static #normalizeString(value, fieldName) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized) {
            throw new Error(`Mod extension registration requires ${fieldName}.`);
        }
        return normalized;
    }

    static #normalizeIdentifier(value, fieldName) {
        const normalized = ModExtensionRegistry.#normalizeString(value, fieldName);
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(normalized)) {
            throw new Error(`${fieldName} must start with a letter and contain only letters, numbers, underscores, or hyphens.`);
        }
        return normalized;
    }

    static #normalizeFieldName(value, fieldName) {
        const normalized = ModExtensionRegistry.#normalizeString(value, fieldName);
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(normalized)) {
            throw new Error(`${fieldName} must be a valid JavaScript-style property name.`);
        }
        return normalized;
    }

    static #normalizeEntityType(value) {
        return ModExtensionRegistry.#normalizeIdentifier(value, 'entity field entityType').toLowerCase();
    }

    static #normalizeEntityFieldType(value) {
        const normalized = typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'string';
        const allowed = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);
        if (!allowed.has(normalized)) {
            throw new Error(`Entity field type "${normalized}" is not supported.`);
        }
        return normalized;
    }

    static #normalizeXmlEventPromptSchema(promptSchema, { tagName, eventKey }) {
        if (promptSchema === null || promptSchema === undefined || promptSchema === '') {
            return null;
        }
        if (typeof promptSchema === 'string') {
            const xml = promptSchema.trim();
            return xml
                ? {
                    name: tagName,
                    description: '',
                    xml
                }
                : null;
        }
        if (!promptSchema || typeof promptSchema !== 'object' || Array.isArray(promptSchema)) {
            throw new Error(`XML event "${eventKey}" promptSchema must be a string or an object.`);
        }
        const xml = ModExtensionRegistry.#normalizeString(promptSchema.xml, `XML event "${eventKey}" promptSchema.xml`);
        const rawName = typeof promptSchema.name === 'string' ? promptSchema.name.trim() : '';
        return {
            name: rawName || tagName,
            description: typeof promptSchema.description === 'string' ? promptSchema.description.trim() : '',
            xml
        };
    }

    static #normalizeBoolean(value) {
        return value === true;
    }

    clear() {
        this.#chatTools.clear();
        this.#xmlEventsByTag.clear();
        this.#xmlEventsByKey.clear();
        this.#baseContextContributors = [];
        this.#actorStatusContributors = [];
        this.#attributeModifierContributors = [];
        this.#statusEffectContributors = [];
        this.#inventorySyncContributors = [];
        this.#settingFields.clear();
        this.#settingTabs.clear();
        this.#entityFieldsByType.clear();
        this.#startupValidators = [];
    }

    registerChatTool({
        modName,
        definition,
        executor,
        allowedInRegularProse = false,
        allowedInGenericPrompt = false
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
            throw new Error(`Mod "${normalizedModName}" chat tool definition must be an object.`);
        }
        const name = ModExtensionRegistry.#normalizeString(definition.function?.name, 'chat tool function.name');
        if (typeof executor !== 'function') {
            throw new Error(`Mod "${normalizedModName}" chat tool "${name}" requires an executor function.`);
        }
        if (this.#chatTools.has(name)) {
            throw new Error(`Chat tool "${name}" is already registered.`);
        }
        if (this.#reservedChatToolNames.has(name)) {
            throw new Error(`Chat tool "${name}" conflicts with a built-in tool.`);
        }
        this.#chatTools.set(name, {
            modName: normalizedModName,
            definition,
            executor,
            allowedInRegularProse: ModExtensionRegistry.#normalizeBoolean(allowedInRegularProse),
            allowedInGenericPrompt: ModExtensionRegistry.#normalizeBoolean(allowedInGenericPrompt)
        });
    }

    getChatToolRecord(name) {
        const normalized = typeof name === 'string' ? name.trim() : '';
        return normalized ? (this.#chatTools.get(normalized) || null) : null;
    }

    getChatToolDefinitions({ regularProseOnly = false, genericPromptOnly = false } = {}) {
        return Array.from(this.#chatTools.values())
            .filter(record => {
                if (regularProseOnly && !record.allowedInRegularProse) {
                    return false;
                }
                if (genericPromptOnly && !record.allowedInGenericPrompt) {
                    return false;
                }
                return true;
            })
            .map(record => record.definition);
    }

    registerXmlEvent({
        modName,
        tagName,
        eventKey,
        promptSchema = '',
        parser,
        handler
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedTagName = ModExtensionRegistry.#normalizeString(tagName, 'XML event tagName');
        const normalizedEventKey = ModExtensionRegistry.#normalizeString(eventKey, 'XML event eventKey');
        if (typeof parser !== 'function') {
            throw new Error(`Mod "${normalizedModName}" XML event "${normalizedEventKey}" requires a parser function.`);
        }
        if (typeof handler !== 'function') {
            throw new Error(`Mod "${normalizedModName}" XML event "${normalizedEventKey}" requires a handler function.`);
        }
        const normalizedTagLookup = normalizedTagName.toLowerCase();
        if (this.#xmlEventsByTag.has(normalizedTagLookup)) {
            throw new Error(`XML event tag "${normalizedTagName}" is already registered.`);
        }
        if (this.#xmlEventsByKey.has(normalizedEventKey)) {
            throw new Error(`XML event key "${normalizedEventKey}" is already registered.`);
        }
        const record = {
            modName: normalizedModName,
            tagName: normalizedTagName,
            eventKey: normalizedEventKey,
            promptSchema: ModExtensionRegistry.#normalizeXmlEventPromptSchema(promptSchema, {
                tagName: normalizedTagName,
                eventKey: normalizedEventKey
            }),
            parser,
            handler
        };
        this.#xmlEventsByTag.set(normalizedTagLookup, record);
        this.#xmlEventsByKey.set(normalizedEventKey, record);
    }

    getXmlEventByTagName(tagName) {
        const normalizedTagName = typeof tagName === 'string' ? tagName.trim().toLowerCase() : '';
        return normalizedTagName ? (this.#xmlEventsByTag.get(normalizedTagName) || null) : null;
    }

    getXmlEventByKey(eventKey) {
        const normalizedEventKey = typeof eventKey === 'string' ? eventKey.trim() : '';
        return normalizedEventKey ? (this.#xmlEventsByKey.get(normalizedEventKey) || null) : null;
    }

    getXmlEventParsers() {
        const parsers = {};
        for (const [eventKey, record] of this.#xmlEventsByKey.entries()) {
            parsers[eventKey] = record.parser;
        }
        return parsers;
    }

    getXmlEventHandlers() {
        const handlers = {};
        for (const [eventKey, record] of this.#xmlEventsByKey.entries()) {
            handlers[eventKey] = record.handler;
        }
        return handlers;
    }

    getXmlEventPromptSchemas() {
        return Array.from(this.#xmlEventsByKey.values())
            .map(record => record.promptSchema)
            .filter(Boolean);
    }

    #registerContributor(store, kind, { modName, contributor } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        if (typeof contributor !== 'function') {
            throw new Error(`Mod "${normalizedModName}" ${kind} contributor must be a function.`);
        }
        store.push({ modName: normalizedModName, contributor });
    }

    registerBaseContextContributor({ modName, contributor } = {}) {
        this.#registerContributor(this.#baseContextContributors, 'base context', { modName, contributor });
    }

    registerActorStatusContributor({ modName, contributor } = {}) {
        this.#registerContributor(this.#actorStatusContributors, 'actor status', { modName, contributor });
    }

    registerAttributeModifierContributor({ modName, contributor } = {}) {
        this.#registerContributor(this.#attributeModifierContributors, 'attribute modifier', { modName, contributor });
    }

    registerStatusEffectContributor({ modName, contributor } = {}) {
        this.#registerContributor(this.#statusEffectContributors, 'status effect', { modName, contributor });
    }

    registerInventorySyncContributor({ modName, contributor } = {}) {
        this.#registerContributor(this.#inventorySyncContributors, 'inventory sync', { modName, contributor });
    }

    getBaseContextContributors() {
        return [...this.#baseContextContributors];
    }

    getActorStatusContributors() {
        return [...this.#actorStatusContributors];
    }

    getAttributeModifierContributors() {
        return [...this.#attributeModifierContributors];
    }

    getStatusEffectContributors() {
        return [...this.#statusEffectContributors];
    }

    getInventorySyncContributors() {
        return [...this.#inventorySyncContributors];
    }

    collectBaseContextContributions(context) {
        return this.#baseContextContributors.map(record => ({
            modName: record.modName,
            value: record.contributor(context)
        }));
    }

    collectActorStatusContributions(actor, context = {}) {
        return this.#actorStatusContributors
            .map(record => ({
                modName: record.modName,
                value: record.contributor(actor, context)
            }))
            .filter(entry => entry.value !== null && entry.value !== undefined);
    }

    collectAttributeModifierContributions(actor, attributeName, context = {}) {
        return this.#attributeModifierContributors.reduce((total, record) => {
            const value = record.contributor(actor, attributeName, context);
            if (value === null || value === undefined || value === '') {
                return total;
            }
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) {
                throw new Error(`Attribute modifier contributor from mod "${record.modName}" returned a non-finite value.`);
            }
            return total + numeric;
        }, 0);
    }

    collectStatusEffectContributions(actor, context = {}) {
        const effects = [];
        for (const record of this.#statusEffectContributors) {
            const value = record.contributor(actor, context);
            if (value === null || value === undefined) {
                continue;
            }
            if (Array.isArray(value)) {
                effects.push(...value);
                continue;
            }
            effects.push(value);
        }
        return effects;
    }

    syncActorInventory(actor, event = {}) {
        for (const record of this.#inventorySyncContributors) {
            record.contributor(actor, event);
        }
    }

    registerSettingTab({
        modName,
        id,
        label,
        description = '',
        order = 1000
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedId = ModExtensionRegistry.#normalizeIdentifier(id, 'setting tab id');
        if (this.#settingTabs.has(normalizedId)) {
            throw new Error(`Setting tab "${normalizedId}" is already registered.`);
        }
        const numericOrder = Number(order);
        if (!Number.isFinite(numericOrder)) {
            throw new Error(`Setting tab "${normalizedId}" order must be a finite number.`);
        }
        this.#settingTabs.set(normalizedId, {
            modName: normalizedModName,
            id: normalizedId,
            label: typeof label === 'string' && label.trim() ? label.trim() : normalizedId,
            description: typeof description === 'string' ? description.trim() : '',
            order: numericOrder
        });
    }

    registerSettingField({
        modName,
        namespace,
        key,
        label,
        type,
        defaultValue,
        description = '',
        tabId = '',
        normalize
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedNamespace = ModExtensionRegistry.#normalizeString(namespace, 'setting field namespace');
        const normalizedKey = ModExtensionRegistry.#normalizeString(key, 'setting field key');
        const normalizedTabId = typeof tabId === 'string' && tabId.trim()
            ? ModExtensionRegistry.#normalizeIdentifier(tabId, 'setting field tabId')
            : '';
        const id = `${normalizedNamespace}.${normalizedKey}`;
        if (this.#settingFields.has(id)) {
            throw new Error(`Setting field "${id}" is already registered.`);
        }
        if (normalizedTabId && !this.#settingTabs.has(normalizedTabId)) {
            throw new Error(`Setting field "${id}" references unknown setting tab "${normalizedTabId}".`);
        }
        if (normalize !== undefined && typeof normalize !== 'function') {
            throw new Error(`Setting field "${id}" normalize must be a function when provided.`);
        }
        this.#settingFields.set(id, {
            modName: normalizedModName,
            namespace: normalizedNamespace,
            key: normalizedKey,
            label: typeof label === 'string' ? label.trim() : normalizedKey,
            type: typeof type === 'string' && type.trim() ? type.trim() : 'string',
            defaultValue,
            description: typeof description === 'string' ? description.trim() : '',
            tabId: normalizedTabId,
            normalize: normalize || null
        });
    }

    getSettingFields({ includeTabbed = true, tabId = undefined } = {}) {
        const hasTabFilter = tabId !== undefined;
        const normalizedTabFilter = typeof tabId === 'string' ? tabId.trim() : '';
        return Array.from(this.#settingFields.values())
            .filter(field => {
                if (!includeTabbed && field.tabId) {
                    return false;
                }
                if (hasTabFilter) {
                    return field.tabId === normalizedTabFilter;
                }
                return true;
            })
            .map(field => ({ ...field }));
    }

    getSettingField(namespace, key) {
        const normalizedNamespace = typeof namespace === 'string' ? namespace.trim() : '';
        const normalizedKey = typeof key === 'string' ? key.trim() : '';
        if (!normalizedNamespace || !normalizedKey) {
            return null;
        }
        const field = this.#settingFields.get(`${normalizedNamespace}.${normalizedKey}`);
        return field ? { ...field } : null;
    }

    getSettingTabs() {
        return Array.from(this.#settingTabs.values())
            .map(tab => ({
                ...tab,
                fields: this.getSettingFields({ tabId: tab.id })
            }))
            .sort((a, b) => {
                if (a.order !== b.order) {
                    return a.order - b.order;
                }
                return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
            });
    }

    registerEntityField({
        modName,
        entityType,
        fieldName,
        type = 'string',
        defaultValue = undefined,
        description = '',
        exposeToCreateTool = false,
        exposeToUpdateTool = false,
        exposeToGeneratorPrompt = false,
        exposeToXmlParser = false
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedEntityType = ModExtensionRegistry.#normalizeEntityType(entityType);
        const normalizedFieldName = ModExtensionRegistry.#normalizeFieldName(fieldName, 'entity field fieldName');
        if (normalizedEntityType === 'thing' && ModExtensionRegistry.#thingReservedFieldNames.has(normalizedFieldName)) {
            throw new Error(`Entity field "thing.${normalizedFieldName}" conflicts with a built-in Thing field.`);
        }

        if (!this.#entityFieldsByType.has(normalizedEntityType)) {
            this.#entityFieldsByType.set(normalizedEntityType, new Map());
        }
        const fields = this.#entityFieldsByType.get(normalizedEntityType);
        if (fields.has(normalizedFieldName)) {
            throw new Error(`Entity field "${normalizedEntityType}.${normalizedFieldName}" is already registered.`);
        }

        const record = {
            modName: normalizedModName,
            entityType: normalizedEntityType,
            fieldName: normalizedFieldName,
            type: ModExtensionRegistry.#normalizeEntityFieldType(type),
            defaultValue,
            description: typeof description === 'string' ? description.trim() : '',
            exposeToCreateTool: ModExtensionRegistry.#normalizeBoolean(exposeToCreateTool),
            exposeToUpdateTool: ModExtensionRegistry.#normalizeBoolean(exposeToUpdateTool),
            exposeToGeneratorPrompt: ModExtensionRegistry.#normalizeBoolean(exposeToGeneratorPrompt),
            exposeToXmlParser: ModExtensionRegistry.#normalizeBoolean(exposeToXmlParser)
        };
        fields.set(normalizedFieldName, record);
    }

    getEntityField(entityType, fieldName) {
        const normalizedEntityType = typeof entityType === 'string' && entityType.trim()
            ? entityType.trim().toLowerCase()
            : '';
        const normalizedFieldName = typeof fieldName === 'string' ? fieldName.trim() : '';
        if (!normalizedEntityType || !normalizedFieldName) {
            return null;
        }
        const field = this.#entityFieldsByType.get(normalizedEntityType)?.get(normalizedFieldName) || null;
        return field ? { ...field } : null;
    }

    getEntityFields(entityType, {
        exposeToCreateTool = undefined,
        exposeToUpdateTool = undefined,
        exposeToGeneratorPrompt = undefined,
        exposeToXmlParser = undefined
    } = {}) {
        const normalizedEntityType = typeof entityType === 'string' && entityType.trim()
            ? entityType.trim().toLowerCase()
            : '';
        if (!normalizedEntityType) {
            return [];
        }
        return Array.from(this.#entityFieldsByType.get(normalizedEntityType)?.values() || [])
            .filter(field => {
                if (exposeToCreateTool !== undefined && field.exposeToCreateTool !== Boolean(exposeToCreateTool)) {
                    return false;
                }
                if (exposeToUpdateTool !== undefined && field.exposeToUpdateTool !== Boolean(exposeToUpdateTool)) {
                    return false;
                }
                if (exposeToGeneratorPrompt !== undefined && field.exposeToGeneratorPrompt !== Boolean(exposeToGeneratorPrompt)) {
                    return false;
                }
                if (exposeToXmlParser !== undefined && field.exposeToXmlParser !== Boolean(exposeToXmlParser)) {
                    return false;
                }
                return true;
            })
            .map(field => ({ ...field }));
    }

    registerStartupValidator({ modName, validator } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        if (typeof validator !== 'function') {
            throw new Error(`Mod "${normalizedModName}" startup validator must be a function.`);
        }
        this.#startupValidators.push({ modName: normalizedModName, validator });
    }

    runStartupValidators(context = {}) {
        for (const record of this.#startupValidators) {
            try {
                record.validator(context);
            } catch (error) {
                throw new Error(`Startup validator for mod "${record.modName}" failed: ${error.message}`);
            }
        }
    }
}

module.exports = ModExtensionRegistry;
