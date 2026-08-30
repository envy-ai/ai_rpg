class ModExtensionRegistry {
    #chatTools = new Map();
    #reservedChatToolNames = new Set();
    #xmlEventsByTag = new Map();
    #xmlEventsByKey = new Map();
    #baseContextContributors = [];
    #actorStatusContributors = [];
    #attributeModifierContributors = [];
    #statusEffectContributors = [];
    #thingTargetStatusEffectContributors = [];
    #thingPromptContributors = [];
    #inventorySyncContributors = [];
    #sceneSummarizeContributors = [];
    #settingFields = new Map();
    #settingTabs = new Map();
    #entityFieldsByType = new Map();
    #entityValidatorsByType = new Map();
    #thingImageBadges = new Map();
    #thingContextActions = new Map();
    #playerActionPromptSteps = new Map();
    #generationPromptInstructions = new Map();
    #startupValidators = [];

    static #thingReservedFieldNames = new Set([
        'id',
        'name',
        'description',
        'shortDescription',
        'thingType',
        'imageId',
        'imagePrompt',
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
        'requiresCheckToOpen',
        'containerContents',
        'containedThingIds',
        'flags'
    ]);

    static #thingReservedXmlPromptTags = new Set([
        'name',
        'count',
        'description',
        'shortDescription',
        'itemOrScenery',
        'type',
        'slot',
        'rarity',
        'value',
        'weight',
        'relativeLevel',
        'isVehicle',
        'isCraftingStation',
        'isProcessingStation',
        'isHarvestable',
        'isSalvageable',
        'isContainer',
        'requiresCheckToOpen',
        'containerContents',
        'containedItem',
        'attributeBonuses',
        'attributeBonus',
        'attribute',
        'bonus',
        'causeStatusEffectOnTarget',
        'causeStatusEffectOnEquipper',
        'statusEffect',
        'properties'
    ]);

    static #playerReservedFieldNames = new Set([
        'id',
        'name',
        'aliases',
        'description',
        'shortDescription',
        'imageId',
        'imagePrompt',
        'class',
        'race',
        'gender',
        'isNPC',
        'attributes',
        'level',
        'experience',
        'health',
        'maxHealth',
        'healthAttribute',
        'inventory',
        'barterInventory',
        'willingToTrade',
        'tradeRefusalExpiresAt',
        'barterStockUpdatedAt',
        'barterProfile',
        'skills',
        'abilities',
        'declinedAbilities',
        'statusEffects',
        'needBars',
        'needBarApplicability',
        'dispositions',
        'relationships',
        'personality',
        'personalityType',
        'personalityTraits',
        'personalityNotes',
        'aiNotes',
        'resistances',
        'vulnerabilities',
        'hiddenFromPlayer',
        'isHiddenFromPlayer',
        'factionId',
        'factionStandings',
        'thingListViewPreferences',
        'modState',
        'partyMembers',
        'goals',
        'characterArc',
        'currentQuests',
        'completedQuests',
        'importantMemories',
        'currentLocation',
        'location',
        'previousLocationId',
        'last_seen_time',
        'last_seen_location',
        'was_in_player_location_previous_round',
        'isDead',
        'persistWhenDead',
        'corpseCountdown'
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

    static #normalizeXmlPromptTagName(value, fieldName) {
        const normalized = ModExtensionRegistry.#normalizeString(value, fieldName);
        if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(normalized)) {
            throw new Error(`${fieldName} must start with a letter or underscore and contain only letters, numbers, underscores, hyphens, or periods.`);
        }
        return normalized;
    }

    static #normalizeEntityFieldXmlPrompt({
        entityType,
        fieldName,
        exposeToGeneratorPrompt,
        exposeToXmlParser,
        xmlPrompt,
        xmlPromptPlaceholderProvider
    }) {
        if (!exposeToGeneratorPrompt && !exposeToXmlParser) {
            if (xmlPrompt !== undefined && xmlPrompt !== null && xmlPrompt !== '') {
                throw new Error(`Entity field "${entityType}.${fieldName}" xmlPrompt requires exposeToGeneratorPrompt or exposeToXmlParser.`);
            }
            if (xmlPromptPlaceholderProvider !== undefined && xmlPromptPlaceholderProvider !== null) {
                throw new Error(`Entity field "${entityType}.${fieldName}" xmlPromptPlaceholderProvider requires exposeToGeneratorPrompt or exposeToXmlParser.`);
            }
            return null;
        }
        if (
            xmlPromptPlaceholderProvider !== undefined
            && xmlPromptPlaceholderProvider !== null
            && typeof xmlPromptPlaceholderProvider !== 'function'
        ) {
            throw new Error(`Entity field "${entityType}.${fieldName}" xmlPromptPlaceholderProvider must be a function when provided.`);
        }

        const rawPrompt = xmlPrompt === undefined ? null : xmlPrompt;
        let rawTagName = fieldName;
        let rawPlaceholder = '';
        let rawCollection = null;

        if (typeof rawPrompt === 'string') {
            rawPlaceholder = rawPrompt.trim();
        } else if (rawPrompt && typeof rawPrompt === 'object' && !Array.isArray(rawPrompt)) {
            if (typeof rawPrompt.tagName === 'string' && rawPrompt.tagName.trim()) {
                rawTagName = rawPrompt.tagName.trim();
            }
            if (typeof rawPrompt.placeholder === 'string') {
                rawPlaceholder = rawPrompt.placeholder.trim();
            }
            if (rawPrompt.collection !== undefined && rawPrompt.collection !== null) {
                rawCollection = rawPrompt.collection;
            }
        } else if (rawPrompt !== null && rawPrompt !== undefined && rawPrompt !== '') {
            throw new Error(`Entity field "${entityType}.${fieldName}" xmlPrompt must be a string or object.`);
        }

        if (exposeToGeneratorPrompt && !rawPlaceholder && typeof xmlPromptPlaceholderProvider !== 'function') {
            throw new Error(`Entity field "${entityType}.${fieldName}" exposeToGeneratorPrompt requires xmlPrompt.placeholder.`);
        }

        const tagName = ModExtensionRegistry.#normalizeXmlPromptTagName(
            rawTagName,
            `entity field "${entityType}.${fieldName}" xmlPrompt.tagName`
        );
        if (
            entityType === 'thing'
            && ModExtensionRegistry.#thingReservedXmlPromptTags.has(tagName)
        ) {
            throw new Error(`Entity field "thing.${fieldName}" xmlPrompt tag "${tagName}" conflicts with a built-in item XML tag.`);
        }

        let collection = null;
        if (rawCollection !== null) {
            if (!rawCollection || typeof rawCollection !== 'object' || Array.isArray(rawCollection)) {
                throw new Error(`Entity field "${entityType}.${fieldName}" xmlPrompt.collection must be an object.`);
            }
            const itemTagName = ModExtensionRegistry.#normalizeXmlPromptTagName(
                rawCollection.itemTagName,
                `entity field "${entityType}.${fieldName}" xmlPrompt.collection.itemTagName`
            );
            if (!Array.isArray(rawCollection.fields) || !rawCollection.fields.length) {
                throw new Error(`Entity field "${entityType}.${fieldName}" xmlPrompt.collection.fields must be a non-empty array.`);
            }
            const seenFieldNames = new Set();
            const seenTagNames = new Set();
            const fields = rawCollection.fields.map((child, index) => {
                if (!child || typeof child !== 'object' || Array.isArray(child)) {
                    throw new Error(`Entity field "${entityType}.${fieldName}" xmlPrompt.collection.fields[${index}] must be an object.`);
                }
                const childFieldName = ModExtensionRegistry.#normalizeFieldName(
                    child.fieldName,
                    `entity field "${entityType}.${fieldName}" xmlPrompt.collection.fields[${index}].fieldName`
                );
                const childTagName = ModExtensionRegistry.#normalizeXmlPromptTagName(
                    child.tagName || child.fieldName,
                    `entity field "${entityType}.${fieldName}" xmlPrompt.collection.fields[${index}].tagName`
                );
                if (seenFieldNames.has(childFieldName) || seenTagNames.has(childTagName)) {
                    throw new Error(`Entity field "${entityType}.${fieldName}" xmlPrompt.collection contains a duplicate child field or tag.`);
                }
                seenFieldNames.add(childFieldName);
                seenTagNames.add(childTagName);
                return {
                    fieldName: childFieldName,
                    tagName: childTagName,
                    type: ModExtensionRegistry.#normalizeEntityFieldType(child.type || 'string'),
                    required: child.required === true
                };
            });
            collection = { itemTagName, fields };
        }

        return {
            tagName,
            placeholder: rawPlaceholder,
            placeholderProvider: xmlPromptPlaceholderProvider || null,
            ...(collection ? { collection } : {})
        };
    }

    static #normalizeEntityFieldEdit({
        entityType,
        fieldName,
        fieldType,
        exposeToEditModal,
        edit
    }) {
        if (!exposeToEditModal) {
            if (edit !== undefined && edit !== null && edit !== '') {
                throw new Error(`Entity field "${entityType}.${fieldName}" edit metadata requires exposeToEditModal.`);
            }
            return null;
        }
        if (edit !== undefined && edit !== null && (typeof edit !== 'object' || Array.isArray(edit))) {
            throw new Error(`Entity field "${entityType}.${fieldName}" edit metadata must be an object.`);
        }
        const raw = edit && typeof edit === 'object' ? edit : {};
        const defaultInputType = (() => {
            if (fieldType === 'boolean') return 'checkbox';
            if (fieldType === 'number' || fieldType === 'integer') return 'number';
            if (fieldType === 'array' || fieldType === 'object') return 'textarea';
            return 'text';
        })();
        const inputType = typeof raw.inputType === 'string' && raw.inputType.trim()
            ? raw.inputType.trim().toLowerCase()
            : defaultInputType;
        const allowedInputTypes = new Set(['text', 'textarea', 'number', 'checkbox']);
        if (!allowedInputTypes.has(inputType)) {
            throw new Error(`Entity field "${entityType}.${fieldName}" edit.inputType "${inputType}" is not supported.`);
        }
        const numericOrder = raw.order === undefined || raw.order === null || raw.order === ''
            ? 1000
            : Number(raw.order);
        if (!Number.isFinite(numericOrder)) {
            throw new Error(`Entity field "${entityType}.${fieldName}" edit.order must be a finite number.`);
        }
        return {
            label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : fieldName,
            placeholder: typeof raw.placeholder === 'string' ? raw.placeholder.trim() : '',
            description: typeof raw.description === 'string' ? raw.description.trim() : '',
            inputType,
            order: numericOrder
        };
    }

    static #resolveDynamicEntityFieldText(provider, fallback, context, field, label, providerResults = null) {
        if (typeof provider !== 'function') {
            return fallback;
        }
        let value;
        if (providerResults?.has(provider)) {
            value = providerResults.get(provider);
        } else {
            value = provider(context || {}, field);
            providerResults?.set(provider, value);
        }
        if (value === null || value === undefined) {
            return fallback;
        }
        if (typeof value !== 'string') {
            throw new Error(`${label} provider for entity field "${field.entityType}.${field.fieldName}" must return a string.`);
        }
        return value.trim();
    }

    static #cloneEntityField(field, { descriptionContext = {} } = {}) {
        if (!field) {
            return null;
        }
        const providerResults = new Map();
        const cloned = {
            ...field,
            edit: field.edit ? { ...field.edit } : null,
            xmlPrompt: field.xmlPrompt ? {
                ...field.xmlPrompt,
                ...(field.xmlPrompt.collection ? { collection: {
                    ...field.xmlPrompt.collection,
                    fields: field.xmlPrompt.collection.fields.map(child => ({ ...child }))
                } } : {})
            } : null,
            toolSchema: field.toolSchema ? ModExtensionRegistry.#cloneJsonish(field.toolSchema) : null
        };
        cloned.description = ModExtensionRegistry.#resolveDynamicEntityFieldText(
            field.descriptionProvider,
            field.description,
            descriptionContext,
            field,
            'description',
            providerResults
        );
        if (cloned.xmlPrompt) {
            cloned.xmlPrompt.placeholder = ModExtensionRegistry.#resolveDynamicEntityFieldText(
                field.xmlPrompt?.placeholderProvider,
                field.xmlPrompt.placeholder,
                descriptionContext,
                field,
                'xmlPrompt.placeholder',
                providerResults
            );
            delete cloned.xmlPrompt.placeholderProvider;
        }
        delete cloned.descriptionProvider;
        return cloned;
    }

    static #normalizeAssetUrlForMod(value, modName, fieldName) {
        const normalized = ModExtensionRegistry.#normalizeString(value, fieldName);
        const requiredPrefix = `/mods/${modName}/assets/`;
        if (!normalized.startsWith(requiredPrefix)) {
            throw new Error(`${fieldName} for mod "${modName}" must use a mod asset URL starting with "${requiredPrefix}".`);
        }
        if (normalized.includes('..')) {
            throw new Error(`${fieldName} for mod "${modName}" cannot contain "..".`);
        }
        return normalized;
    }

    static #normalizeThingImageBadgePosition(value) {
        const normalized = typeof value === 'string' && value.trim()
            ? value.trim().toLowerCase()
            : 'bottom-left';
        const allowed = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
        if (!allowed.has(normalized)) {
            throw new Error(`Thing image badge position "${normalized}" is not supported.`);
        }
        return normalized;
    }

    static #normalizeThingImageBadgeRenderMode(value) {
        const normalized = typeof value === 'string' && value.trim()
            ? value.trim().toLowerCase()
            : 'auto';
        const allowed = new Set(['auto', 'mask', 'image']);
        if (!allowed.has(normalized)) {
            throw new Error(`Thing image badge renderMode "${normalized}" is not supported.`);
        }
        return normalized;
    }

    static #cloneThingImageBadge(badge) {
        return badge
            ? {
                ...badge,
                assetPathSetting: badge.assetPathSetting ? { ...badge.assetPathSetting } : null,
                labelSetting: badge.labelSetting ? { ...badge.labelSetting } : null
            }
            : null;
    }

    static #normalizeThingContextActionContexts(contexts, fullId) {
        if (contexts === undefined || contexts === null || contexts === '') {
            return [];
        }
        const rawEntries = Array.isArray(contexts) ? contexts : [contexts];
        const normalized = [];
        const seen = new Set();
        for (const entry of rawEntries) {
            const context = typeof entry === 'string' ? entry.trim() : '';
            if (!context) {
                throw new Error(`Thing context action "${fullId}" contexts must contain non-empty strings.`);
            }
            if (!seen.has(context)) {
                seen.add(context);
                normalized.push(context);
            }
        }
        return normalized;
    }

    static #cloneThingContextAction(action, { includeHandler = false } = {}) {
        if (!action) {
            return null;
        }
        const cloned = {
            modName: action.modName,
            id: action.id,
            fullId: action.fullId,
            label: action.label,
            fieldName: action.fieldName,
            fieldValue: action.fieldValue,
            contexts: [...action.contexts],
            order: action.order
        };
        if (includeHandler) {
            cloned.handler = action.handler;
        }
        return cloned;
    }

    static #cloneJsonish(value) {
        if (value === undefined || value === null) {
            return value;
        }
        return JSON.parse(JSON.stringify(value));
    }

    static #normalizeSettingFieldOptions(options, fieldId) {
        if (options === undefined || options === null) {
            return [];
        }
        if (!Array.isArray(options)) {
            throw new Error(`Setting field "${fieldId}" options must be an array.`);
        }
        return options.map((option, index) => {
            if (!option || typeof option !== 'object' || Array.isArray(option)) {
                throw new Error(`Setting field "${fieldId}" option ${index + 1} must be an object.`);
            }
            const value = ModExtensionRegistry.#normalizeString(option.value, `Setting field "${fieldId}" option ${index + 1} value`);
            const normalized = {
                value,
                label: typeof option.label === 'string' && option.label.trim() ? option.label.trim() : value
            };
            if (typeof option.description === 'string' && option.description.trim()) {
                normalized.description = option.description.trim();
            }
            if (option.settings !== undefined) {
                if (!option.settings || typeof option.settings !== 'object' || Array.isArray(option.settings)) {
                    throw new Error(`Setting field "${fieldId}" option "${value}" settings must be an object.`);
                }
                normalized.settings = ModExtensionRegistry.#cloneJsonish(option.settings);
            }
            if (typeof option.confirmMessage === 'string' && option.confirmMessage.trim()) {
                normalized.confirmMessage = option.confirmMessage.trim();
            }
            return normalized;
        });
    }

    static #normalizeSettingReference(reference, fieldName) {
        if (reference === undefined || reference === null || reference === '') {
            return null;
        }
        if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
            throw new Error(`${fieldName} must be an object.`);
        }
        return {
            namespace: ModExtensionRegistry.#normalizeString(reference.namespace, `${fieldName}.namespace`),
            key: ModExtensionRegistry.#normalizeString(reference.key, `${fieldName}.key`),
            defaultValue: typeof reference.defaultValue === 'string' ? reference.defaultValue.trim() : ''
        };
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

    static #stepNumberSuffixFromIndex(index) {
        const letters = 'abcdefghijklmnopqrstuvwxyz';
        let value = Number(index);
        if (!Number.isInteger(value) || value < 0) {
            throw new Error('Prompt step index must be a non-negative integer.');
        }
        let result = '';
        do {
            result = letters[value % letters.length] + result;
            value = Math.floor(value / letters.length) - 1;
        } while (value >= 0);
        return result;
    }

    static #stepNumberIndexFromSuffix(suffix) {
        const normalized = ModExtensionRegistry.#normalizeString(suffix, 'prompt step start suffix').toLowerCase();
        if (!/^[a-z]+$/.test(normalized)) {
            throw new Error('prompt step start suffix must contain only letters.');
        }
        let index = 0;
        for (const char of normalized) {
            index = (index * 26) + (char.charCodeAt(0) - 96);
        }
        return index - 1;
    }

    static #normalizePlayerActionPromptStep(value) {
        const numeric = Number(value);
        if (!Number.isInteger(numeric) || ![1, 3].includes(numeric)) {
            throw new Error('Player-action prompt step must be either 1 or 3.');
        }
        return numeric;
    }

    static #normalizeGenerationType(value, fieldName = 'generationType') {
        const normalized = ModExtensionRegistry.#normalizeString(value, fieldName).toLowerCase();
        const allowed = new Set(['item', 'location', 'region']);
        if (!allowed.has(normalized)) {
            throw new Error(`${fieldName} must be one of: item, location, region.`);
        }
        return normalized;
    }

    static #normalizeGenerationTypes({ generationType, generationTypes } = {}) {
        const rawEntries = generationTypes === undefined || generationTypes === null || generationTypes === ''
            ? [generationType]
            : (Array.isArray(generationTypes) ? generationTypes : [generationTypes]);
        if (!rawEntries.length) {
            throw new Error('Generation prompt instruction requires generationType or generationTypes.');
        }
        const seen = new Set();
        const normalized = [];
        rawEntries.forEach((entry, index) => {
            const generation = ModExtensionRegistry.#normalizeGenerationType(
                entry,
                `generationTypes[${index}]`
            );
            if (!seen.has(generation)) {
                seen.add(generation);
                normalized.push(generation);
            }
        });
        return normalized;
    }

    static #parsePlayerActionPromptStartStep(startStep, expectedStep = null) {
        const normalized = ModExtensionRegistry.#normalizeString(
            startStep,
            'player-action prompt start step'
        ).toLowerCase();
        const match = normalized.match(/^([13])([a-z]+)$/);
        if (!match) {
            throw new Error('Player-action prompt start step must use a stage prefix followed by letters, such as "3m".');
        }
        const step = Number(match[1]);
        if (expectedStep !== null && step !== expectedStep) {
            throw new Error(
                `Player-action prompt start step "${normalized}" must begin with stage ${expectedStep}.`
            );
        }
        return { step, prefix: match[1], startSuffix: match[2] };
    }

    static #normalizeBoolean(value) {
        return value === true;
    }

    static #normalizeEntityFieldToolSchema({ entityType, fieldName, toolSchema }) {
        if (toolSchema === undefined || toolSchema === null || toolSchema === '') {
            return null;
        }
        if (!toolSchema || typeof toolSchema !== 'object' || Array.isArray(toolSchema)) {
            throw new Error(`Entity field "${entityType}.${fieldName}" toolSchema must be an object.`);
        }
        return ModExtensionRegistry.#cloneJsonish(toolSchema);
    }

    clear() {
        this.#chatTools.clear();
        this.#xmlEventsByTag.clear();
        this.#xmlEventsByKey.clear();
        this.#baseContextContributors = [];
        this.#actorStatusContributors = [];
        this.#attributeModifierContributors = [];
        this.#statusEffectContributors = [];
        this.#thingTargetStatusEffectContributors = [];
        this.#thingPromptContributors = [];
        this.#inventorySyncContributors = [];
        this.#sceneSummarizeContributors = [];
        this.#settingFields.clear();
        this.#settingTabs.clear();
        this.#entityFieldsByType.clear();
        this.#entityValidatorsByType.clear();
        this.#thingImageBadges.clear();
        this.#thingContextActions.clear();
        this.#playerActionPromptSteps.clear();
        this.#generationPromptInstructions.clear();
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
        const normalizedTagLookup = normalizedTagName.replace(/_/g, '').toLowerCase();
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
        const normalizedTagName = typeof tagName === 'string'
            ? tagName.trim().replace(/_/g, '').toLowerCase()
            : '';
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

    registerThingTargetStatusEffectContributor({ modName, contributor } = {}) {
        this.#registerContributor(this.#thingTargetStatusEffectContributors, 'Thing target status effect', { modName, contributor });
    }

    registerThingPromptContributor({ modName, contributor } = {}) {
        this.#registerContributor(this.#thingPromptContributors, 'Thing prompt', { modName, contributor });
    }

    registerInventorySyncContributor({ modName, contributor } = {}) {
        this.#registerContributor(this.#inventorySyncContributors, 'inventory sync', { modName, contributor });
    }

    registerSceneSummarizeContributor({ modName, contributor } = {}) {
        this.#registerContributor(this.#sceneSummarizeContributors, 'scene summarize', { modName, contributor });
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

    getThingTargetStatusEffectContributors() {
        return [...this.#thingTargetStatusEffectContributors];
    }

    getThingPromptContributors() {
        return [...this.#thingPromptContributors];
    }

    getInventorySyncContributors() {
        return [...this.#inventorySyncContributors];
    }

    getSceneSummarizeContributors() {
        return [...this.#sceneSummarizeContributors];
    }

    registerPlayerActionPromptStep({
        modName,
        id,
        step,
        text,
        tinyBrainText = null,
        order = null
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedId = ModExtensionRegistry.#normalizeIdentifier(id, 'player-action prompt step id');
        const normalizedStep = ModExtensionRegistry.#normalizePlayerActionPromptStep(step);
        const normalizedText = ModExtensionRegistry.#normalizeString(text, `player-action prompt step "${normalizedId}" text`);
        const normalizedTinyBrainText = tinyBrainText === null || tinyBrainText === undefined || tinyBrainText === ''
            ? normalizedText
            : ModExtensionRegistry.#normalizeString(
                tinyBrainText,
                `player-action prompt step "${normalizedId}" tinyBrainText`
            );
        const fullId = `${normalizedModName}:${normalizedId}`;
        if (this.#playerActionPromptSteps.has(fullId)) {
            throw new Error(`Player-action prompt step "${fullId}" is already registered.`);
        }
        const sequence = this.#playerActionPromptSteps.size + 1;
        const numericOrder = order === null || order === undefined || order === ''
            ? sequence
            : Number(order);
        if (!Number.isFinite(numericOrder)) {
            throw new Error(`Player-action prompt step "${fullId}" order must be a finite number.`);
        }
        this.#playerActionPromptSteps.set(fullId, {
            modName: normalizedModName,
            id: normalizedId,
            fullId,
            step: normalizedStep,
            text: normalizedText,
            tinyBrainText: normalizedTinyBrainText,
            order: numericOrder,
            sequence
        });
    }

    getPlayerActionPromptSteps({ step = null, startStep = null, startSteps = null } = {}) {
        const hasSingleStep = step !== null && step !== undefined && step !== '';
        const hasSingleStartStep = startStep !== null && startStep !== undefined && startStep !== '';
        if ((hasSingleStep || hasSingleStartStep) && startSteps !== null && startSteps !== undefined) {
            throw new Error('Player-action prompt numbering accepts either step/startStep or startSteps, not both.');
        }
        const numberingByStep = new Map();
        if (hasSingleStep || hasSingleStartStep) {
            const requestedStep = hasSingleStep
                ? ModExtensionRegistry.#normalizePlayerActionPromptStep(step)
                : null;
            const numbering = ModExtensionRegistry.#parsePlayerActionPromptStartStep(
                startStep,
                requestedStep
            );
            numberingByStep.set(
                numbering.step,
                numbering
            );
        } else {
            if (!startSteps || typeof startSteps !== 'object' || Array.isArray(startSteps)) {
                throw new Error('Player-action prompt numbering requires step/startStep or a startSteps object.');
            }
            for (const [rawStep, configuredStartStep] of Object.entries(startSteps)) {
                const requestedStep = ModExtensionRegistry.#normalizePlayerActionPromptStep(rawStep);
                numberingByStep.set(
                    requestedStep,
                    ModExtensionRegistry.#parsePlayerActionPromptStartStep(configuredStartStep, requestedStep)
                );
            }
            if (!numberingByStep.size) {
                throw new Error('Player-action prompt startSteps must define at least one stage.');
            }
        }
        const nextIndexByStep = new Map();
        return Array.from(this.#playerActionPromptSteps.values())
            .filter(record => numberingByStep.has(record.step))
            .sort((a, b) => (a.step - b.step) || (a.order - b.order) || (a.sequence - b.sequence) || a.fullId.localeCompare(b.fullId))
            .map((record) => {
                const numbering = numberingByStep.get(record.step);
                const startIndex = ModExtensionRegistry.#stepNumberIndexFromSuffix(numbering.startSuffix);
                const stepIndex = nextIndexByStep.get(record.step) || 0;
                nextIndexByStep.set(record.step, stepIndex + 1);
                const number = `${numbering.prefix}${ModExtensionRegistry.#stepNumberSuffixFromIndex(startIndex + stepIndex)}`;
                return {
                    modName: record.modName,
                    id: record.id,
                    fullId: record.fullId,
                    step: record.step,
                    number,
                    text: record.text,
                    tinyBrainText: record.tinyBrainText,
                    order: record.order
                };
            });
    }

    registerGenerationPromptInstruction({
        modName,
        id,
        generationType = undefined,
        generationTypes = undefined,
        text = '',
        textProvider = undefined,
        order = null
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedId = ModExtensionRegistry.#normalizeIdentifier(id, 'generation prompt instruction id');
        const fullId = `${normalizedModName}:${normalizedId}`;
        if (this.#generationPromptInstructions.has(fullId)) {
            throw new Error(`Generation prompt instruction "${fullId}" is already registered.`);
        }
        const normalizedGenerationTypes = ModExtensionRegistry.#normalizeGenerationTypes({
            generationType,
            generationTypes
        });
        const normalizedText = typeof text === 'string' ? text.trim() : '';
        if (textProvider !== undefined && textProvider !== null && typeof textProvider !== 'function') {
            throw new Error(`Generation prompt instruction "${fullId}" textProvider must be a function when provided.`);
        }
        if (!normalizedText && typeof textProvider !== 'function') {
            throw new Error(`Generation prompt instruction "${fullId}" requires text or textProvider.`);
        }
        const sequence = this.#generationPromptInstructions.size + 1;
        const numericOrder = order === null || order === undefined || order === ''
            ? sequence
            : Number(order);
        if (!Number.isFinite(numericOrder)) {
            throw new Error(`Generation prompt instruction "${fullId}" order must be a finite number.`);
        }
        this.#generationPromptInstructions.set(fullId, {
            modName: normalizedModName,
            id: normalizedId,
            fullId,
            generationTypes: normalizedGenerationTypes,
            text: normalizedText,
            textProvider: textProvider || null,
            order: numericOrder,
            sequence
        });
    }

    collectGenerationPromptInstructions(generationType, context = {}) {
        const normalizedGenerationType = ModExtensionRegistry.#normalizeGenerationType(generationType);
        return Array.from(this.#generationPromptInstructions.values())
            .filter(record => record.generationTypes.includes(normalizedGenerationType))
            .sort((a, b) => (a.order - b.order) || (a.sequence - b.sequence) || a.fullId.localeCompare(b.fullId))
            .map((record) => {
                const rawText = record.textProvider
                    ? record.textProvider({
                        ...(context || {}),
                        generationType: normalizedGenerationType
                    })
                    : record.text;
                if (rawText === null || rawText === undefined) {
                    return null;
                }
                if (typeof rawText !== 'string') {
                    throw new Error(`Generation prompt instruction "${record.fullId}" textProvider must return a string.`);
                }
                const instructionText = rawText.trim();
                if (!instructionText) {
                    return null;
                }
                return {
                    modName: record.modName,
                    id: record.id,
                    fullId: record.fullId,
                    generationTypes: [...record.generationTypes],
                    text: instructionText,
                    order: record.order
                };
            })
            .filter(Boolean);
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

    collectThingTargetStatusEffectContributions(actor, thing, context = {}) {
        const effects = [];
        for (const record of this.#thingTargetStatusEffectContributors) {
            const value = record.contributor(actor, thing, context);
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

    collectSceneSummarizeContributions(context = {}) {
        const contributions = [];
        for (const record of this.#sceneSummarizeContributors) {
            const value = record.contributor(context);
            if (value === null || value === undefined) {
                continue;
            }
            if (typeof value !== 'string') {
                throw new Error(`Scene summarize contributor from mod "${record.modName}" must return a string or null.`);
            }
            const text = value.trim();
            if (text) {
                contributions.push({ modName: record.modName, text });
            }
        }
        return contributions;
    }

    // Collect per-Thing prompt fragments contributed by mods. Each contributor
    // receives the resolved Thing and a context and returns an XML string to embed
    // inside that Thing's full prompt representation (or null/empty to contribute
    // nothing). Used to append mod-owned detail (e.g. installed modules) to items
    // rendered in full in base context.
    collectThingPromptContributions(thing, context = {}) {
        const fragments = [];
        for (const record of this.#thingPromptContributors) {
            const value = record.contributor(thing, context);
            if (value === null || value === undefined) {
                continue;
            }
            if (typeof value !== 'string') {
                throw new Error(`Thing prompt contributor from mod "${record.modName}" must return a string or null.`);
            }
            const trimmed = value.trim();
            if (trimmed) {
                fragments.push(trimmed);
            }
        }
        return fragments;
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
        options = [],
        persist = true,
        action = '',
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
            options: ModExtensionRegistry.#normalizeSettingFieldOptions(options, id),
            persist: persist !== false,
            action: typeof action === 'string' ? action.trim() : '',
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
            .map(field => ({
                ...field,
                options: ModExtensionRegistry.#cloneJsonish(field.options || [])
            }));
    }

    getSettingField(namespace, key) {
        const normalizedNamespace = typeof namespace === 'string' ? namespace.trim() : '';
        const normalizedKey = typeof key === 'string' ? key.trim() : '';
        if (!normalizedNamespace || !normalizedKey) {
            return null;
        }
        const field = this.#settingFields.get(`${normalizedNamespace}.${normalizedKey}`);
        return field ? {
            ...field,
            options: ModExtensionRegistry.#cloneJsonish(field.options || [])
        } : null;
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
        exposeToXmlParser = false,
        exposeToEditModal = false,
        clearThingSlotWhenPresent = false,
        edit = undefined,
        xmlPrompt = undefined,
        toolSchema = undefined,
        validateValue = undefined,
        descriptionProvider = undefined,
        xmlPromptPlaceholderProvider = undefined
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedEntityType = ModExtensionRegistry.#normalizeEntityType(entityType);
        const normalizedFieldName = ModExtensionRegistry.#normalizeFieldName(fieldName, 'entity field fieldName');
        if (normalizedEntityType === 'thing' && ModExtensionRegistry.#thingReservedFieldNames.has(normalizedFieldName)) {
            throw new Error(`Entity field "thing.${normalizedFieldName}" conflicts with a built-in Thing field.`);
        }
        if (normalizedEntityType === 'player' && ModExtensionRegistry.#playerReservedFieldNames.has(normalizedFieldName)) {
            throw new Error(`Entity field "player.${normalizedFieldName}" conflicts with a built-in Player field.`);
        }

        if (!this.#entityFieldsByType.has(normalizedEntityType)) {
            this.#entityFieldsByType.set(normalizedEntityType, new Map());
        }
        const fields = this.#entityFieldsByType.get(normalizedEntityType);
        if (fields.has(normalizedFieldName)) {
            throw new Error(`Entity field "${normalizedEntityType}.${normalizedFieldName}" is already registered.`);
        }

        const normalizedExposeToGeneratorPrompt = ModExtensionRegistry.#normalizeBoolean(exposeToGeneratorPrompt);
        const normalizedExposeToXmlParser = ModExtensionRegistry.#normalizeBoolean(exposeToXmlParser);
        const normalizedExposeToEditModal = ModExtensionRegistry.#normalizeBoolean(exposeToEditModal);
        const normalizedClearThingSlotWhenPresent = ModExtensionRegistry.#normalizeBoolean(clearThingSlotWhenPresent);
        if (normalizedClearThingSlotWhenPresent && normalizedEntityType !== 'thing') {
            throw new Error(`Entity field "${normalizedEntityType}.${normalizedFieldName}" clearThingSlotWhenPresent is only valid for Thing fields.`);
        }
        const normalizedType = ModExtensionRegistry.#normalizeEntityFieldType(type);
        if (descriptionProvider !== undefined && descriptionProvider !== null && typeof descriptionProvider !== 'function') {
            throw new Error(`Entity field "${normalizedEntityType}.${normalizedFieldName}" descriptionProvider must be a function when provided.`);
        }
        if (validateValue !== undefined && validateValue !== null && typeof validateValue !== 'function') {
            throw new Error(`Entity field "${normalizedEntityType}.${normalizedFieldName}" validateValue must be a function when provided.`);
        }

        const record = {
            modName: normalizedModName,
            entityType: normalizedEntityType,
            fieldName: normalizedFieldName,
            type: normalizedType,
            defaultValue,
            description: typeof description === 'string' ? description.trim() : '',
            descriptionProvider: descriptionProvider || null,
            validateValue: validateValue || null,
            exposeToCreateTool: ModExtensionRegistry.#normalizeBoolean(exposeToCreateTool),
            exposeToUpdateTool: ModExtensionRegistry.#normalizeBoolean(exposeToUpdateTool),
            exposeToGeneratorPrompt: normalizedExposeToGeneratorPrompt,
            exposeToXmlParser: normalizedExposeToXmlParser,
            exposeToEditModal: normalizedExposeToEditModal,
            clearThingSlotWhenPresent: normalizedClearThingSlotWhenPresent,
            edit: ModExtensionRegistry.#normalizeEntityFieldEdit({
                entityType: normalizedEntityType,
                fieldName: normalizedFieldName,
                fieldType: normalizedType,
                exposeToEditModal: normalizedExposeToEditModal,
                edit
            }),
            xmlPrompt: ModExtensionRegistry.#normalizeEntityFieldXmlPrompt({
                entityType: normalizedEntityType,
                fieldName: normalizedFieldName,
                exposeToGeneratorPrompt: normalizedExposeToGeneratorPrompt,
                exposeToXmlParser: normalizedExposeToXmlParser,
                xmlPrompt,
                xmlPromptPlaceholderProvider
            }),
            toolSchema: ModExtensionRegistry.#normalizeEntityFieldToolSchema({
                entityType: normalizedEntityType,
                fieldName: normalizedFieldName,
                toolSchema
            })
        };
        fields.set(normalizedFieldName, record);
    }

    registerEntityValidator({ modName, entityType, name, validator } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedEntityType = ModExtensionRegistry.#normalizeEntityType(entityType);
        const normalizedName = ModExtensionRegistry.#normalizeIdentifier(
            name || `${normalizedModName}-${normalizedEntityType}-validator`,
            'entity validator name'
        );
        if (typeof validator !== 'function') {
            throw new Error(`Entity validator "${normalizedName}" must be a function.`);
        }
        if (!this.#entityValidatorsByType.has(normalizedEntityType)) {
            this.#entityValidatorsByType.set(normalizedEntityType, new Map());
        }
        const validators = this.#entityValidatorsByType.get(normalizedEntityType);
        if (validators.has(normalizedName)) {
            throw new Error(`Entity validator "${normalizedEntityType}.${normalizedName}" is already registered.`);
        }
        validators.set(normalizedName, {
            modName: normalizedModName,
            entityType: normalizedEntityType,
            name: normalizedName,
            validator
        });
    }

    getEntityValidators(entityType) {
        const normalizedEntityType = typeof entityType === 'string' ? entityType.trim().toLowerCase() : '';
        if (!normalizedEntityType) {
            return [];
        }
        return Array.from(this.#entityValidatorsByType.get(normalizedEntityType)?.values() || [])
            .map(record => ({ ...record }));
    }

    validateEntity(entityType, entity, context = {}) {
        for (const record of this.getEntityValidators(entityType)) {
            try {
                record.validator(entity, context);
            } catch (error) {
                throw new Error(
                    `Entity validator "${record.name}" from mod "${record.modName}" rejected `
                    + `${entityType} "${entity?.name || entity?.id || 'unknown'}": ${error?.message || error}`,
                    { cause: error }
                );
            }
        }
        return entity;
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
        return ModExtensionRegistry.#cloneEntityField(field);
    }

    getEntityFields(entityType, {
        exposeToCreateTool = undefined,
        exposeToUpdateTool = undefined,
        exposeToGeneratorPrompt = undefined,
        exposeToXmlParser = undefined,
        exposeToEditModal = undefined,
        descriptionContext = {}
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
                if (exposeToEditModal !== undefined && field.exposeToEditModal !== Boolean(exposeToEditModal)) {
                    return false;
                }
                return true;
            })
            .map(field => ModExtensionRegistry.#cloneEntityField(field, { descriptionContext }));
    }

    registerThingImageBadge({
        modName,
        id,
        fieldName,
        fieldValue = undefined,
        label = '',
        iconUrl = '',
        imageUrl = '',
        renderMode = 'auto',
        position = 'bottom-left',
        order = 1000,
        assetPathSetting = null,
        labelSetting = null
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedId = ModExtensionRegistry.#normalizeIdentifier(id, 'Thing image badge id');
        const fullId = `${normalizedModName}:${normalizedId}`;
        if (this.#thingImageBadges.has(fullId)) {
            throw new Error(`Thing image badge "${fullId}" is already registered.`);
        }
        const normalizedFieldName = ModExtensionRegistry.#normalizeFieldName(fieldName, `Thing image badge "${fullId}" fieldName`);
        const rawIconUrl = typeof iconUrl === 'string' ? iconUrl.trim() : '';
        const rawImageUrl = typeof imageUrl === 'string' ? imageUrl.trim() : '';
        if (Boolean(rawIconUrl) === Boolean(rawImageUrl)) {
            throw new Error(`Thing image badge "${fullId}" requires exactly one of iconUrl or imageUrl.`);
        }
        const numericOrder = Number(order);
        if (!Number.isFinite(numericOrder)) {
            throw new Error(`Thing image badge "${fullId}" order must be a finite number.`);
        }

        const record = {
            modName: normalizedModName,
            id: normalizedId,
            fullId,
            fieldName: normalizedFieldName,
            fieldValue,
            label: typeof label === 'string' && label.trim() ? label.trim() : normalizedId,
            iconUrl: rawIconUrl
                ? ModExtensionRegistry.#normalizeAssetUrlForMod(rawIconUrl, normalizedModName, `Thing image badge "${fullId}" iconUrl`)
                : '',
            imageUrl: rawImageUrl
                ? ModExtensionRegistry.#normalizeAssetUrlForMod(rawImageUrl, normalizedModName, `Thing image badge "${fullId}" imageUrl`)
                : '',
            renderMode: ModExtensionRegistry.#normalizeThingImageBadgeRenderMode(renderMode),
            position: ModExtensionRegistry.#normalizeThingImageBadgePosition(position),
            order: numericOrder,
            assetPathSetting: ModExtensionRegistry.#normalizeSettingReference(
                assetPathSetting,
                `Thing image badge "${fullId}" assetPathSetting`
            ),
            labelSetting: ModExtensionRegistry.#normalizeSettingReference(
                labelSetting,
                `Thing image badge "${fullId}" labelSetting`
            )
        };
        this.#thingImageBadges.set(fullId, record);
    }

    getThingImageBadges() {
        return Array.from(this.#thingImageBadges.values())
            .map(badge => ModExtensionRegistry.#cloneThingImageBadge(badge))
            .sort((a, b) => {
                if (a.order !== b.order) {
                    return a.order - b.order;
                }
                return a.fullId.localeCompare(b.fullId);
            });
    }

    registerThingContextAction({
        modName,
        id,
        label = '',
        fieldName = '',
        fieldValue = undefined,
        contexts = [],
        order = 1000,
        handler
    } = {}) {
        const normalizedModName = ModExtensionRegistry.#normalizeModName(modName);
        const normalizedId = ModExtensionRegistry.#normalizeIdentifier(id, 'Thing context action id');
        const fullId = `${normalizedModName}:${normalizedId}`;
        if (this.#thingContextActions.has(fullId)) {
            throw new Error(`Thing context action "${fullId}" is already registered.`);
        }
        if (typeof handler !== 'function') {
            throw new Error(`Thing context action "${fullId}" requires a handler function.`);
        }
        const normalizedFieldName = typeof fieldName === 'string' && fieldName.trim()
            ? ModExtensionRegistry.#normalizeFieldName(fieldName, `Thing context action "${fullId}" fieldName`)
            : '';
        const numericOrder = Number(order);
        if (!Number.isFinite(numericOrder)) {
            throw new Error(`Thing context action "${fullId}" order must be a finite number.`);
        }
        this.#thingContextActions.set(fullId, {
            modName: normalizedModName,
            id: normalizedId,
            fullId,
            label: typeof label === 'string' && label.trim() ? label.trim() : normalizedId,
            fieldName: normalizedFieldName,
            fieldValue,
            contexts: ModExtensionRegistry.#normalizeThingContextActionContexts(contexts, fullId),
            order: numericOrder,
            handler
        });
    }

    getThingContextActions() {
        return Array.from(this.#thingContextActions.values())
            .map(action => ModExtensionRegistry.#cloneThingContextAction(action))
            .sort((a, b) => {
                if (a.order !== b.order) {
                    return a.order - b.order;
                }
                return a.fullId.localeCompare(b.fullId);
            });
    }

    getThingContextActionRecord(actionId) {
        const normalized = typeof actionId === 'string' ? actionId.trim() : '';
        if (!normalized) {
            return null;
        }
        return ModExtensionRegistry.#cloneThingContextAction(
            this.#thingContextActions.get(normalized) || null,
            { includeHandler: true }
        );
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
