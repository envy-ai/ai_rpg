const Thing = require('./Thing.js');
const Skill = require('./Skill.js');
const StatusEffect = require('./StatusEffect.js');
const StatusEffectList = require('./status_effect_list.js');
const NeedBarStatusEffects = require('./NeedBarStatusEffects.js');
const SanitizedStringMap = require('./SanitizedStringMap.js');
const { findPackageJSON } = require('module');
const Globals = require('./Globals.js');
const Quest = require('./Quest.js');
const Utils = require('./Utils.js');
const VehicleInfo = require('./VehicleInfo.js');
const FormulaEvaluator = require('./public/js/formula-evaluator.js');
const { resolvePointPoolFormulas } = require('./utils/point-pool-formulas.js');
const { loadMergedDefinitionFile } = require('./DefinitionLoader.js');
const IdGenerator = require('./IdGenerator.js');
const Technique = require('./Technique.js');
const { createExtensionFieldAccess } = require('./extension_field_access.js');
const { filterPromptHistoryEntries } = require('./base_context_history.js');

const playerExtensionFields = createExtensionFieldAccess({ entityType: 'player', label: 'Player' });

const ATTRIBUTE_POOL_BASELINE_VALUE = 10;
const SKILL_POOL_BASELINE_VALUE = 1;
const RELATIONSHIP_LABEL_MAX_WORDS = 6;
const RELATIONSHIP_LABEL_MAX_WORDS_TEXT = 'six';

let CachedLocationModule = null;
function clonePartyMemoryHistoryEntry(entry) {
    // Preserve exclusion provenance when hydrating old buffers. Prompt reads
    // filter diagnostics without removing the underlying persisted records.
    const cloned = JSON.parse(JSON.stringify(entry));
    return {
        ...cloned,
        role: cloned.role || null,
        content: cloned.content || '',
        summary: cloned.summary || null,
        metadata: cloned.metadata && typeof cloned.metadata === 'object'
            ? {
                ...cloned.metadata,
                npcNames: Array.isArray(cloned.metadata.npcNames) ? cloned.metadata.npcNames.slice() : undefined,
                locationId: cloned.metadata.locationId || null
            }
            : undefined
    };
}

function getLocationModule() {
    if (!CachedLocationModule) {
        CachedLocationModule = require('./Location.js');
    }
    return CachedLocationModule;
}

class Player {
    // Private fields using ES13 syntax
    #definitions;
    #attributes = {};
    #level;
    #health;
    #healthAttribute;
    #name;
    #aliases;
    #description;
    #shortDescription;
    #class;
    #race;
    #gender;
    #id;
    #currentLocation;
    #imageId;
    #imagePrompt;
    #createdAt;
    #lastUpdated;
    #isNPC;
    #inventory;
    #partyMembers;
    #dispositions;
    #skills;
    #unspentSkillPoints;
    #unspentAttributePoints;
    #statusEffects;
    #gearSlots;
    #gearSlotsByType;
    #gearSlotNameIndex;
    #abilities;
    #techniques = [];
    #disciplineAccess = [];
    #declinedAbilities = [];
    #pendingAbilityOptionsByLevel = new Map();
    #pendingAbilityAttachmentDraftsByLevel = new Map();
    #needBars;
    #needBarApplicability = new Map();
    #needBarRatesAppliedAt = null;
    #healthRegenAppliedAt = null;
    #derivedNeedRatesAppliedAt = null;
    #derivedNeedEffects = [];
    #derivedNeedSignature = null;
    #excludeNeedBarStatusEffects = false;
    #needMutationDepth = 0;
    #needMutationMaxHealth = null;
    #settlingNeedTime = false;
    #pendingNeedBarFinalization = null;
    static #needWorldMutationDepth = 0;
    #experience;
    #currency;
    #barterInventory;
    #willingToTrade = true;
    #tradeRefusalExpiresAt = null;
    #barterStockUpdatedAt = null;
    #barterProfile = null;
    #personalityType;
    #personalityTraits;
    #personalityNotes;
    #aiNotes;
    #disposition = null;
    #hostileArrivalProvenance = null;
    #playerGuidance = '';
    #resistances;
    #vulnerabilities;
    #goals = [];
    #isHostile;
    #isDead;
    #persistWhenDead;
    #corpseCountdown;
    #importantMemories = [];
    #previousLocationId = null; // For tracking location changes. This is the location at the beginning of the turn.
    #lastSeenTime = null;
    #lastSeenLocation = null;
    #wasInPlayerLocationPreviousRound = false;
    #hiddenFromPlayer = false;
    #lastActionWasTravel = false;
    #consecutiveTravelActions = 0;
    #turnsSincePartyMemoryGeneration = 0;
    #pendingPartyMemoryHistory = [];
    #partyMembershipChangedThisTurn = false;
    #wasEverInPlayerParty = false;
    #partyMembersAddedThisTurn = new Set();
    #partyMembersRemovedThisTurn = new Set();
    #elapsedTime = 0;
    #lastVisitedTime = 0; // Minutes since last visit by player.
    #inCombat = false;
    #checkEquipment = false;
    #characterArc = { shortTerm: '', longTerm: '' };
    #quests = [];
    #lastOutcomeSucceeded = null;
    #factionId = null;
    #factionStandings = new Map();
    #favorUsage = new Map();
    #relationships = new Map();
    #thingListViewPreferences = {};
    #modState = {};
    #extensionFields = {};

    static #indexById = new Map();
    static #indexByName = new SanitizedStringMap();

    static #npcInventoryChangeHandler = null;
    static #levelUpHandler = null;
    static #needBarDefinitions = null;
    static #NEED_BAR_SMALL_FRACTION = 0.1;
    static #NEED_BAR_MEDIUM_FRACTION = 0.175;
    static #NEED_BAR_LARGE_FRACTION = 0.25;
    static #needBarMagnitudeValues;
    static #thingListViewPanelKeys = new Set([
        'npcInventory',
        'npcBarterInventory',
        'barterPlayerInventory',
        'barterMerchantInventory',
        'craftingInventory',
        'locationScenery',
        'locationItems',
        'containerPlayerInventory',
        'containerContents'
    ]);
    static #thingListViewModes = new Set([
        'classic',
        'table',
        'grid',
        'small-grid'
    ]);

    static availableSkills = new Map();
    static #gearSlotDefinitions = null;
    static #instances = new Set();
    static #dispositionDefinitions = null;
    static #currentPlayerResolver = null;
    static #pointPoolFormulaRuntime = null;

    static normalizePlayerGuidance(value) {
        if (value === undefined || value === null) {
            return '';
        }
        if (typeof value !== 'string') {
            throw new TypeError('Player guidance must be a string.');
        }
        return value.replace(/\r\n?/g, '\n').trim();
    }

    static normalizeNpcDisposition(value) {
        if (value === undefined || value === null) {
            return null;
        }
        if (typeof value !== 'string') {
            throw new TypeError('NPC disposition must be a string.');
        }
        const normalized = value.replace(/\r\n?/g, '\n').trim();
        if (!normalized) {
            return null;
        }
        return normalized;
    }

    static #experienceThreshold = 100;
    static #experienceRolloverMultiplier = 2 / 3;

    static #normalizeHealthValue(value, fieldName = 'Health') {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue < 0) {
            throw new Error(`${fieldName} must be a non-negative finite number`);
        }
        return numericValue;
    }

    static #getHealthRegenPercentPerMinute() {
        const rawValue = Globals.config?.healthRegenPercentPerMinute ?? 0;
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue) || numericValue < 0) {
            throw new Error('healthRegenPercentPerMinute must be a non-negative finite number.');
        }
        return numericValue;
    }

    static #normalizeOptionalNonNegativeInteger(value, fieldName) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const numericValue = Number(value);
        if (!Number.isInteger(numericValue) || numericValue < 0) {
            throw new Error(`${fieldName} must be a non-negative integer when provided.`);
        }
        return numericValue;
    }

    static #normalizeBarterProfile(value) {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('barterProfile must be an object when provided.');
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            throw new Error(`barterProfile must be JSON-serializable: ${error.message}`);
        }
    }

    static #cloneJsonObject(value, fieldName) {
        if (value === null || value === undefined) {
            return {};
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`${fieldName} must be an object.`);
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            throw new Error(`${fieldName} must be JSON-serializable: ${error.message}`);
        }
    }

    static #normalizeModState(value) {
        const normalized = Player.#cloneJsonObject(value || {}, 'modState');
        for (const [namespace, namespaceState] of Object.entries(normalized)) {
            if (!namespace || typeof namespace !== 'string') {
                throw new Error('modState namespaces must be non-empty strings.');
            }
            if (namespaceState === null || typeof namespaceState !== 'object' || Array.isArray(namespaceState)) {
                throw new Error(`modState.${namespace} must be an object.`);
            }
        }
        return normalized;
    }

    static #rebuildIndexes() {
        this.#indexById = new Map();
        this.#indexByName = new SanitizedStringMap();

        for (const player of this.#instances) {
            if (!player) {
                continue;
            }

            const playerId = typeof player.id === 'string' ? player.id.trim() : '';
            if (playerId) {
                this.#indexById.set(playerId, player);
            }

            const playerName = typeof player.name === 'string' ? player.name.trim() : '';
            if (playerName) {
                this.#indexByName.set(playerName, player);
            }
        }
    }

    static #normalizeGoalList(source) {
        const goals = [];
        const append = (value) => {
            if (typeof value !== 'string') {
                return;
            }
            const trimmed = value.trim();
            if (!trimmed) {
                return;
            }
            if (!goals.includes(trimmed)) {
                goals.push(trimmed);
            }
        };

        const walk = (value) => {
            if (value === null || value === undefined) {
                return;
            }
            if (typeof value === 'string') {
                append(value);
                return;
            }
            if (Array.isArray(value)) {
                value.forEach(walk);
                return;
            }
            if (typeof value === 'object') {
                for (const entry of Object.values(value)) {
                    walk(entry);
                }
            }
        };

        walk(source);
        return goals;
    }

    static #normalizeCharacterArc(source) {
        const empty = { shortTerm: '', longTerm: '' };
        if (!source) {
            return { ...empty };
        }
        if (typeof source === 'string') {
            const trimmed = source.trim();
            return { shortTerm: trimmed, longTerm: '' };
        }
        if (typeof source !== 'object') {
            return { ...empty };
        }

        const shortTerm = typeof source.shortTerm === 'string' ? source.shortTerm.trim() : '';
        const longTerm = typeof source.longTerm === 'string' ? source.longTerm.trim() : '';

        return { shortTerm, longTerm };
    }

    static #normalizeNeedBarChangeList(source) {
        if (!source) {
            return [];
        }

        const items = [];
        const pushItem = (value) => {
            if (typeof value !== 'string') {
                return;
            }
            const trimmed = value.trim();
            if (trimmed) {
                items.push(trimmed);
            }
        };

        if (Array.isArray(source)) {
            source.forEach(pushItem);
        } else if (typeof source === 'string') {
            source.split(/[,\n;]/).forEach(pushItem);
        } else if (typeof source === 'object' && source !== null) {
            Object.values(source).forEach(pushItem);
        }

        return items;
    }

    static #normalizeThingListViewPanelKey(value) {
        if (typeof value !== 'string') {
            return '';
        }
        const trimmed = value.trim();
        return this.#thingListViewPanelKeys.has(trimmed) ? trimmed : '';
    }

    static #normalizeThingListViewMode(value) {
        if (typeof value !== 'string') {
            return '';
        }
        const normalized = value.trim().toLowerCase();
        return this.#thingListViewModes.has(normalized) ? normalized : '';
    }

    static #partyMemberListIncludes(source, actorId) {
        const targetId = typeof actorId === 'string' ? actorId.trim() : '';
        if (!targetId || source === null || source === undefined) {
            return false;
        }

        if (Array.isArray(source) || source instanceof Set) {
            for (const rawId of source) {
                const memberId = typeof rawId === 'string' ? rawId.trim() : '';
                if (memberId === targetId) {
                    return true;
                }
            }
            return false;
        }

        if (typeof source !== 'string' && typeof source[Symbol.iterator] === 'function') {
            for (const rawId of source) {
                const memberId = typeof rawId === 'string' ? rawId.trim() : '';
                if (memberId === targetId) {
                    return true;
                }
            }
            return false;
        }

        throw new Error('Current player getPartyMembers() must return an array, Set, or iterable of actor ids.');
    }

    static #normalizeThingListViewPreferences(source, { onInvalid = 'ignore', context = 'thingListViewPreferences' } = {}) {
        if (source === null || source === undefined) {
            return {};
        }
        if (typeof source !== 'object' || Array.isArray(source)) {
            if (onInvalid === 'throw') {
                throw new Error(`${context} must be an object map of panel keys to view modes.`);
            }
            return {};
        }

        const entries = source instanceof Map ? Array.from(source.entries()) : Object.entries(source);
        const normalized = {};
        for (const [rawPanelKey, rawViewMode] of entries) {
            const panelKey = this.#normalizeThingListViewPanelKey(rawPanelKey);
            if (!panelKey) {
                if (onInvalid === 'throw') {
                    throw new Error(`Unsupported thing-list view panel key '${rawPanelKey}'.`);
                }
                continue;
            }
            const viewMode = this.#normalizeThingListViewMode(rawViewMode);
            if (!viewMode) {
                if (onInvalid === 'throw') {
                    throw new Error(`Unsupported thing-list view mode '${rawViewMode}' for panel '${panelKey}'.`);
                }
                continue;
            }
            normalized[panelKey] = viewMode;
        }
        return normalized;
    }

    static #normalizeLastSeenTime(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) {
            throw new Error('last_seen_time must be a non-negative integer minute timestamp or null.');
        }
        return numeric;
    }

    static #normalizeLastSeenLocation(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        if (typeof value !== 'string') {
            throw new Error('last_seen_location must be a string location id or null.');
        }
        const trimmed = value.trim();
        return trimmed || null;
    }

    static #normalizeNeedMagnitudeKey(value) {
        if (value === null || value === undefined) {
            return null;
        }
        const normalized = String(value).trim().toLowerCase();
        if (!normalized) {
            return null;
        }
        if (['small', 'minor', 'light', 'tiny'].includes(normalized)) {
            return 'small';
        }
        if (['medium', 'moderate', 'average', 'standard', 'normal'].includes(normalized)) {
            return 'medium';
        }
        if (['large', 'major', 'big', 'heavy', 'huge'].includes(normalized)) {
            return 'large';
        }
        if (['all', 'fill', 'full', 'max', 'maximum', 'complete', 'empty'].includes(normalized)) {
            return 'all';
        }
        return normalized;
    }

    static #normalizeNeedValueMap(source, { context = 'need_values' } = {}) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            return null;
        }

        const normalizeDirectionEntries = (directionSource, directionContext) => {
            if (!directionSource || typeof directionSource !== 'object' || Array.isArray(directionSource)) {
                if (directionSource === null || directionSource === undefined) {
                    return null;
                }
                throw new Error(`${directionContext} must be an object of need magnitude values.`);
            }

            const entries = {};
            for (const [rawKey, rawValue] of Object.entries(directionSource)) {
                if (!rawKey) {
                    continue;
                }
                const key = this.#normalizeNeedMagnitudeKey(rawKey);
                if (!key || key === 'all') {
                    continue;
                }
                const numeric = Number(rawValue);
                if (!Number.isFinite(numeric) || numeric <= 0) {
                    continue;
                }
                entries[key] = numeric;
            }

            return Object.keys(entries).length ? Object.freeze(entries) : null;
        };

        let sawDirectionalKey = false;
        for (const rawKey of Object.keys(source)) {
            if (!rawKey) {
                continue;
            }
            const normalizedKey = String(rawKey).trim().toLowerCase();
            if (normalizedKey === 'increase' || normalizedKey === 'decrease') {
                sawDirectionalKey = true;
                continue;
            }

            const magnitudeKey = this.#normalizeNeedMagnitudeKey(rawKey);
            if (magnitudeKey && magnitudeKey !== 'all') {
                throw new Error(
                    `${context} must use nested increase/decrease maps; flat magnitude key "${rawKey}" is no longer supported.`
                );
            }
        }

        if (!sawDirectionalKey) {
            return null;
        }

        const increase = normalizeDirectionEntries(source.increase, `${context}.increase`);
        const decrease = normalizeDirectionEntries(source.decrease, `${context}.decrease`);

        if (!increase && !decrease) {
            return null;
        }

        return Object.freeze({
            increase,
            decrease
        });
    }

    static #normalizeNeedBarAudienceConfig(config = {}) {
        const hasExplicitAudience = Object.prototype.hasOwnProperty.call(config, 'player')
            || Object.prototype.hasOwnProperty.call(config, 'party')
            || Object.prototype.hasOwnProperty.call(config, 'non_party')
            || Object.prototype.hasOwnProperty.call(config, 'nonParty');

        if (hasExplicitAudience) {
            return {
                player: Boolean(config.player),
                party: Boolean(config.party),
                nonParty: Boolean(config.non_party ?? config.nonParty)
            };
        }

        const legacyPlayerOnly = Boolean(config.player_only ?? config.playerOnly);
        if (legacyPlayerOnly) {
            return {
                player: true,
                party: false,
                nonParty: false
            };
        }

        return {
            player: true,
            party: true,
            nonParty: true
        };
    }

    static #parseNeedBarApplicabilityValue(rawValue) {
        let candidate = rawValue;
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            if (Object.prototype.hasOwnProperty.call(candidate, 'applicable')) {
                candidate = candidate.applicable;
            } else if (Object.prototype.hasOwnProperty.call(candidate, 'isApplicable')) {
                candidate = candidate.isApplicable;
            } else if (Object.prototype.hasOwnProperty.call(candidate, 'value')) {
                candidate = candidate.value;
            }
        }

        if (typeof candidate === 'boolean') {
            return candidate;
        }
        if (typeof candidate === 'number') {
            if (candidate === 1) {
                return true;
            }
            if (candidate === 0) {
                return false;
            }
            return null;
        }
        if (typeof candidate !== 'string') {
            return null;
        }

        const normalized = candidate.trim().toLowerCase();
        if (!normalized) {
            return null;
        }
        if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
            return true;
        }
        if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
            return false;
        }

        return null;
    }

    static #normalizeNeedBarApplicability(source) {
        const applicability = new Map();
        const assign = (rawId, rawValue) => {
            if (typeof rawId !== 'string') {
                return;
            }
            const normalizedId = rawId.trim();
            if (!normalizedId) {
                return;
            }
            const parsedValue = this.#parseNeedBarApplicabilityValue(rawValue);
            if (parsedValue === null) {
                return;
            }
            applicability.set(normalizedId, parsedValue);
        };

        if (!source) {
            return applicability;
        }

        if (source instanceof Map) {
            for (const [id, value] of source.entries()) {
                assign(id, value);
            }
            return applicability;
        }

        if (Array.isArray(source)) {
            for (const entry of source) {
                if (!entry || typeof entry !== 'object') {
                    continue;
                }
                assign(
                    entry.id ?? entry.identifier ?? entry.name,
                    entry.applicable ?? entry.isApplicable ?? entry.value
                );
            }
            return applicability;
        }

        if (typeof source === 'object') {
            for (const [id, value] of Object.entries(source)) {
                assign(id, value);
            }
        }

        return applicability;
    }

    static #isNeedBarPlayerOnlyAudience(source = {}) {
        return Boolean(source.player) && !Boolean(source.party) && !Boolean(source.nonParty);
    }

    static #resolveNeedBarAudienceForActor(actor) {
        const isNPC = Boolean(actor?.isNPC);
        if (!isNPC) {
            return {
                player: true,
                party: false,
                nonParty: false
            };
        }

        const isInPlayerParty = Boolean(actor?.isInPlayerParty);
        const wasEverInPlayerParty = Boolean(actor?.wasEverInPlayerParty);
        return {
            player: false,
            party: isInPlayerParty || wasEverInPlayerParty,
            nonParty: !isInPlayerParty
        };
    }

    static #needBarIsActiveForActor(bar, actor) {
        if (!bar || !actor) {
            return false;
        }

        const audience = this.#resolveNeedBarAudienceForActor(actor);
        return (audience.player && bar.player)
            || (audience.party && bar.party)
            || (audience.nonParty && bar.nonParty);
    }

    static #needBarCanBeStoredForActor(bar, actor) {
        if (!bar || !actor) {
            return false;
        }

        if (actor.isNPC) {
            return Boolean(bar.party) || Boolean(bar.nonParty);
        }

        return Boolean(bar.player);
    }

    static #buildLegacyNeedBarLoadState({ needBars = null, needBarApplicability = null, isNPC = false } = {}) {
        const actor = { isNPC: Boolean(isNPC) };
        const resolvedApplicability = this.#normalizeNeedBarApplicability(needBarApplicability);
        const initialLookup = new Map();

        const setInitialLookup = (rawId, rawValue) => {
            if (typeof rawId !== 'string') {
                return;
            }
            const normalizedId = rawId.trim();
            if (!normalizedId) {
                return;
            }
            initialLookup.set(normalizedId, rawValue);
        };

        if (Array.isArray(needBars)) {
            for (const entry of needBars) {
                if (!entry || typeof entry !== 'object') {
                    continue;
                }
                setInitialLookup(entry.id, entry);
            }
        } else if (needBars && typeof needBars === 'object') {
            for (const [id, value] of Object.entries(needBars)) {
                setInitialLookup(id, value);
            }
        }

        const resolvedNeedBars = [];
        const definitions = this.needBarDefinitions || {};
        for (const [id, definition] of Object.entries(definitions)) {
            const normalizedId = typeof id === 'string' ? id.trim() : '';
            if (!normalizedId) {
                continue;
            }
            if (!this.#needBarCanBeStoredForActor(definition, actor)) {
                continue;
            }

            if (!resolvedApplicability.has(normalizedId)) {
                resolvedApplicability.set(normalizedId, true);
            }
            if (resolvedApplicability.get(normalizedId) === false) {
                continue;
            }

            const existing = initialLookup.get(normalizedId);
            if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
                const existingValue = existing.value ?? existing.current ?? existing.amount;
                if (Number.isFinite(Number(existingValue))) {
                    resolvedNeedBars.push({
                        ...existing,
                        id: normalizedId
                    });
                    continue;
                }
            } else if (Number.isFinite(Number(existing))) {
                resolvedNeedBars.push({
                    id: normalizedId,
                    value: Number(existing)
                });
                continue;
            }

            resolvedNeedBars.push({
                id: normalizedId,
                value: 100
            });
        }

        return {
            needBars: resolvedNeedBars,
            needBarApplicability: Object.fromEntries(resolvedApplicability)
        };
    }

    static #normalizeAliasSet(source, fullName = '') {
        const aliases = new Set();
        const nameToExclude = typeof fullName === 'string' ? fullName.trim().toLowerCase() : '';

        const addAlias = (value) => {
            if (typeof value !== 'string') {
                return;
            }
            const trimmed = value.trim();
            if (!trimmed) {
                return;
            }
            if (nameToExclude && trimmed.toLowerCase() === nameToExclude) {
                return;
            }
            aliases.add(trimmed);
        };

        if (source instanceof Set) {
            for (const alias of source.values()) {
                addAlias(alias);
            }
            return aliases;
        }

        if (Array.isArray(source)) {
            source.forEach(addAlias);
            return aliases;
        }

        if (typeof source === 'string') {
            addAlias(source);
            return aliases;
        }

        if (source && typeof source === 'object') {
            Object.values(source).forEach(addAlias);
        }

        return aliases;
    }

    static #normalizeFactionId(value) {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value !== 'string') {
            throw new Error('Faction id must be a string or null.');
        }
        const trimmed = value.trim();
        return trimmed || null;
    }

    static #normalizeFavorUsage(source) {
        const map = new Map();
        if (source === null || source === undefined) {
            return map;
        }
        if (typeof source !== 'object' || Array.isArray(source)) {
            throw new Error('Player favorUsage must be an object map of favorId -> { lastUsedWorldMinute }.');
        }
        const entries = source instanceof Map ? Array.from(source.entries()) : Object.entries(source);
        for (const [key, value] of entries) {
            const favorId = typeof key === 'string' ? key.trim() : '';
            if (!favorId) {
                throw new Error('Player favorUsage keys must be non-empty favor ids.');
            }
            const minute = Number(value?.lastUsedWorldMinute);
            if (!Number.isSafeInteger(minute) || minute < 0) {
                throw new Error(`Player favorUsage["${favorId}"].lastUsedWorldMinute must be a non-negative whole number.`);
            }
            map.set(favorId, { lastUsedWorldMinute: minute });
        }
        return map;
    }

    static #normalizeFactionStandings(source) {
        const map = new Map();
        if (source === null || source === undefined) {
            return map;
        }
        const addEntry = (key, value) => {
            if (typeof key !== 'string') {
                throw new Error('Faction standings keys must be strings.');
            }
            const trimmedKey = key.trim();
            if (!trimmedKey) {
                throw new Error('Faction standings keys must be non-empty strings.');
            }
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue)) {
                throw new Error(`Faction standing for "${trimmedKey}" must be a finite number.`);
            }
            map.set(trimmedKey, numericValue);
        };

        if (source instanceof Map) {
            for (const [key, value] of source.entries()) {
                addEntry(key, value);
            }
            return map;
        }
        if (typeof source !== 'object') {
            throw new Error('Faction standings must be a Map or object.');
        }
        for (const [key, value] of Object.entries(source)) {
            addEntry(key, value);
        }
        return map;
    }

    static #normalizeRelationshipLabel(value, targetId) {
        if (typeof value !== 'string') {
            throw new Error(`Relationship label for "${targetId}" must be a string.`);
        }
        const normalized = value.trim().replace(/\s+/g, ' ');
        if (!normalized) {
            throw new Error(`Relationship label for "${targetId}" must be a non-empty string.`);
        }
        if (normalized.split(/\s+/).length > RELATIONSHIP_LABEL_MAX_WORDS) {
            throw new Error(`Relationship label for "${targetId}" must be ${RELATIONSHIP_LABEL_MAX_WORDS_TEXT} words or fewer.`);
        }
        return normalized;
    }

    static #normalizeRelationships(source, { ownerId = null } = {}) {
        const map = new Map();
        if (source === null || source === undefined) {
            return map;
        }
        const normalizedOwnerId = typeof ownerId === 'string' ? ownerId.trim() : '';
        const addEntry = (key, value) => {
            if (typeof key !== 'string') {
                throw new Error('Relationship target ids must be strings.');
            }
            const targetId = key.trim();
            if (!targetId) {
                throw new Error('Relationship target ids must be non-empty strings.');
            }
            if (normalizedOwnerId && targetId === normalizedOwnerId) {
                throw new Error('Relationships cannot target the owning character.');
            }
            map.set(targetId, Player.#normalizeRelationshipLabel(value, targetId));
        };

        if (source instanceof Map) {
            for (const [key, value] of source.entries()) {
                addEntry(key, value);
            }
            return map;
        }
        if (typeof source !== 'object' || Array.isArray(source)) {
            throw new Error('Relationships must be a Map or object.');
        }
        for (const [key, value] of Object.entries(source)) {
            addEntry(key, value);
        }
        return map;
    }

    static #buildNeedBarDefinition(id, config = {}) {
        if (!id) {
            return null;
        }

        if (config.hide_increase_to_max !== undefined
            && typeof config.hide_increase_to_max !== 'boolean') {
            throw new Error(`need_bars.${id}.hide_increase_to_max must be a boolean when provided.`);
        }

        const name = typeof config.name === 'string' ? config.name : id;
        const description = typeof config.description === 'string' ? config.description : '';
        const whileYouWereAwayPromptNotes = typeof config.while_you_were_away_prompt_notes === 'string'
            ? config.while_you_were_away_prompt_notes
            : (typeof config.whileYouWereAwayPromptNotes === 'string' ? config.whileYouWereAwayPromptNotes : '');
        const icon = typeof config.icon === 'string' ? config.icon : '';
        const color = typeof config.color === 'string' ? config.color : '';
        const min = Number.isFinite(Number(config.min)) ? Number(config.min) : 0;
        const max = Number.isFinite(Number(config.max)) ? Number(config.max) : 100;
        const rawChangePerMinute = config.change_per_minute ?? config.change_per_turn;
        const changePerMinute = Number.isFinite(Number(rawChangePerMinute)) ? Number(rawChangePerMinute) : 0;
        if (!(max > min)) throw new Error(`need_bars.${id}.max must exceed min; supply a positive authored capacity.`);
        const paymentDirection = config.technique_payment_direction ?? null;
        if (paymentDirection !== null && !['increase', 'decrease'].includes(paymentDirection)) {
            throw new Error(`need_bars.${id}.technique_payment_direction must be increase or decrease.`);
        }
        const relativeToLevel = Boolean(config.relative_to_level);
        const audience = this.#normalizeNeedBarAudienceConfig(config);
        const relatedAttribute = typeof config.related_attribute === 'string' ? config.related_attribute : null;
        const initialValue = Number.isFinite(Number(config.initial)) ? Number(config.initial) : null;
        const magnitudeValues = this.#normalizeNeedValueMap(config.need_values, {
            context: `need_bars.${id}.need_values`
        });

        const effectThresholds = [];
        if (config.effect_thresholds && typeof config.effect_thresholds === 'object') {
            for (const [thresholdKey, thresholdConfig] of Object.entries(config.effect_thresholds)) {
                const threshold = Number(thresholdKey);
                if (!Number.isFinite(threshold)) {
                    throw new Error(`need_bars.${id}.effect_thresholds.${thresholdKey} must use a finite numeric lower-bound threshold.`);
                }
                const thresholdName = typeof thresholdConfig?.name === 'string' ? thresholdConfig.name : '';
                const thresholdEffect = typeof thresholdConfig?.effect === 'string' ? thresholdConfig.effect : '';
                const thresholdSentence = typeof thresholdConfig?.sentence === 'string' ? thresholdConfig.sentence : '';
                effectThresholds.push({
                    threshold,
                    name: thresholdName,
                    effect: thresholdEffect,
                    sentence: thresholdSentence,
                    statusEffects: NeedBarStatusEffects.compile(thresholdConfig?.status_effects, { path: `need_bars.${id}.effect_thresholds.${thresholdKey}.status_effects` })
                });
            }
        }
        effectThresholds.sort((a, b) => a.threshold - b.threshold);

        return {
            id,
            name,
            description,
            whileYouWereAwayPromptNotes,
            icon,
            color,
            min,
            max,
            baseMin: min,
            baseMax: max,
            baseCapacity: max - min,
            changePerMinute,
            paymentDirection,
            relativeToLevel,
            hideIncreaseToMax: config.hide_increase_to_max === true,
            player: audience.player,
            party: audience.party,
            nonParty: audience.nonParty,
            relatedAttribute,
            initialValue,
            magnitudeValues,
            effectThresholds,
            increases: {
                small: this.#normalizeNeedBarChangeList(config.small_increase),
                medium: this.#normalizeNeedBarChangeList(config.medium_increase),
                large: this.#normalizeNeedBarChangeList(config.large_increase),
                fill: this.#normalizeNeedBarChangeList(config.fill_completely)
            },
            decreases: {
                small: this.#normalizeNeedBarChangeList(config.small_decrease),
                medium: this.#normalizeNeedBarChangeList(config.medium_decrease),
                large: this.#normalizeNeedBarChangeList(config.large_decrease),
                empty: this.#normalizeNeedBarChangeList(
                    config.empty_completely ?? config.drain_completely
                )
            }
        };
    }

    static #cloneNeedBarDefinition(definition) {
        if (!definition) {
            return null;
        }

        return {
            ...definition,
            magnitudeValues: definition.magnitudeValues && typeof definition.magnitudeValues === 'object'
                ? {
                    increase: definition.magnitudeValues.increase && typeof definition.magnitudeValues.increase === 'object'
                        ? { ...definition.magnitudeValues.increase }
                        : null,
                    decrease: definition.magnitudeValues.decrease && typeof definition.magnitudeValues.decrease === 'object'
                        ? { ...definition.magnitudeValues.decrease }
                        : null
                }
                : null,
            effectThresholds: Array.isArray(definition.effectThresholds)
                ? definition.effectThresholds.map(entry => structuredClone(entry))
                : [],
            increases: {
                small: Array.isArray(definition.increases?.small) ? [...definition.increases.small] : [],
                medium: Array.isArray(definition.increases?.medium) ? [...definition.increases.medium] : [],
                large: Array.isArray(definition.increases?.large) ? [...definition.increases.large] : [],
                fill: Array.isArray(definition.increases?.fill) ? [...definition.increases.fill] : []
            },
            decreases: {
                small: Array.isArray(definition.decreases?.small) ? [...definition.decreases.small] : [],
                medium: Array.isArray(definition.decreases?.medium) ? [...definition.decreases.medium] : [],
                large: Array.isArray(definition.decreases?.large) ? [...definition.decreases.large] : [],
                empty: Array.isArray(definition.decreases?.empty) ? [...definition.decreases.empty] : []
            },
            currentThreshold: definition.currentThreshold
                ? structuredClone(definition.currentThreshold)
                : null
        };
    }

    static #loadNeedBarDefinitionState({ cacheResult = false, onError = 'throw' } = {}) {
        if (!['warn', 'throw'].includes(onError)) {
            throw new Error(`Unsupported need-bar definition error mode "${onError}".`);
        }

        try {
            const { value } = loadMergedDefinitionFile({
                baseDir: Globals.baseDir || __dirname,
                filename: 'need_bars.yaml'
            });
            const data = value || {};
            const source = typeof data.need_bars === 'object' && data.need_bars !== null ? data.need_bars : {};
            const magnitudeValues = this.#normalizeNeedValueMap(data.need_values, {
                context: 'need_values'
            });
            const normalized = {};
            for (const [id, config] of Object.entries(source)) {
                if (!id) {
                    continue;
                }
                const trimmedId = id.trim();
                if (!trimmedId || typeof config !== 'object' || config === null) {
                    continue;
                }
                const definition = this.#buildNeedBarDefinition(trimmedId, config);
                if (!definition) {
                    continue;
                }
                normalized[trimmedId] = NeedBarStatusEffects.deepFreeze(this.#cloneNeedBarDefinition(definition));
            }

            const { value: attributeData } = loadMergedDefinitionFile({ baseDir: Globals.baseDir || __dirname, filename: 'attributes.yaml' });
            const worldSkills = Player.availableSkills.size ? Player.availableSkills : Globals.skills;
            NeedBarStatusEffects.validateReferences(normalized, { attributes: attributeData?.attributes, skills: worldSkills && (worldSkills instanceof Map ? worldSkills.size : Object.keys(worldSkills).length) ? worldSkills : undefined });
            if (cacheResult) {
                this.#needBarDefinitions = normalized;
                this.#needBarMagnitudeValues = magnitudeValues;
            }

            return {
                definitions: normalized,
                magnitudeValues
            };
        } catch (error) {
            if (cacheResult) {
                this.#needBarDefinitions = {};
                this.#needBarMagnitudeValues = null;
            }
            if (onError === 'warn') {
                console.warn('Failed to load need bar definitions:', error?.message || error);
                return {
                    definitions: {},
                    magnitudeValues: null
                };
            }
            throw error;
        }
    }

    static validateNeedBarPromptSentences({ onError = 'throw' } = {}) {
        if (!['warn', 'throw'].includes(onError)) {
            throw new Error(`Unsupported need-bar prompt sentence validation mode "${onError}".`);
        }

        try {
            const { definitions } = this.#loadNeedBarDefinitionState({
                cacheResult: false,
                onError: 'throw'
            });
            const issues = [];

            for (const definition of Object.values(definitions || {})) {
                if (!definition || !Array.isArray(definition.effectThresholds)) {
                    continue;
                }
                for (const threshold of definition.effectThresholds) {
                    if (!threshold || !Number.isFinite(threshold.threshold)) {
                        continue;
                    }
                    const sentence = typeof threshold.sentence === 'string' ? threshold.sentence.trim() : '';
                    if (sentence) {
                        continue;
                    }
                    const needBarLabel = typeof definition.name === 'string' && definition.name.trim()
                        ? definition.name.trim()
                        : (definition.id || 'unknown');
                    issues.push(`Need bar "${needBarLabel}" is missing a prompt sentence for threshold ${threshold.threshold}.`);
                }
            }

            if (issues.length > 0) {
                const message = `Need-bar prompt sentence validation failed:\n- ${issues.join('\n- ')}`;
                if (onError === 'warn') {
                    console.warn(message);
                } else {
                    throw new Error(message);
                }
            }

            return issues;
        } catch (error) {
            if (onError === 'warn') {
                const message = error?.message || String(error);
                console.warn(`Need-bar prompt sentence validation warning: ${message}`);
                return [message];
            }
            throw error;
        }
    }

    static #formatNeedBarForContext(definition, { includeValue = true } = {}) {
        if (!definition) {
            return null;
        }

        const ensureList = (input) => {
            if (!input) {
                return [];
            }
            if (Array.isArray(input)) {
                return input
                    .map(item => {
                        const asString = typeof item === 'string' ? item : String(item ?? '');
                        return asString.trim();
                    })
                    .filter(Boolean);
            }
            if (typeof input === 'string') {
                return input
                    .split(/[\r\n,;]/)
                    .map(entry => entry.trim())
                    .filter(Boolean);
            }
            if (typeof input === 'object') {
                return Object.values(input)
                    .map(item => {
                        const asString = typeof item === 'string' ? item : String(item ?? '');
                        return asString.trim();
                    })
                    .filter(Boolean);
            }
            return [];
        };

        const effectThresholds = Array.isArray(definition.effectThresholds)
            ? definition.effectThresholds.map(entry => ({
                threshold: Number.isFinite(entry?.threshold) ? Number(entry.threshold) : null,
                name: typeof entry?.name === 'string' ? entry.name : '',
                effect: typeof entry?.effect === 'string' ? entry.effect : '',
                sentence: typeof entry?.sentence === 'string' ? entry.sentence : '',
                statusEffects: structuredClone(entry?.statusEffects || [])
            })).filter(entry => entry.threshold !== null || entry.name || entry.effect || entry.sentence)
            : [];

        const currentThreshold = includeValue && definition.currentThreshold
            ? {
                threshold: Number.isFinite(definition.currentThreshold.threshold)
                    ? Number(definition.currentThreshold.threshold)
                    : null,
                name: typeof definition.currentThreshold.name === 'string'
                    ? definition.currentThreshold.name
                    : '',
                effect: typeof definition.currentThreshold.effect === 'string'
                    ? definition.currentThreshold.effect
                    : '',
                sentence: typeof definition.currentThreshold.sentence === 'string'
                    ? definition.currentThreshold.sentence
                    : ''
            }
            : null;

        const normalizeNumber = (value) => {
            if (Number.isFinite(value)) {
                return Number(value);
            }
            if (Number.isFinite(Number(value))) {
                return Number(value);
            }
            return null;
        };

        const formatValue = includeValue ? normalizeNumber(definition.value) : null;

        return {
            id: typeof definition.id === 'string' ? definition.id : null,
            name: typeof definition.name === 'string' ? definition.name : (definition.id || 'Unknown'),
            description: typeof definition.description === 'string' ? definition.description : '',
            while_you_were_away_prompt_notes: typeof definition.whileYouWereAwayPromptNotes === 'string'
                ? definition.whileYouWereAwayPromptNotes
                : '',
            icon: typeof definition.icon === 'string' ? definition.icon : '',
            color: typeof definition.color === 'string' ? definition.color : '',
            player: Boolean(definition.player),
            party: Boolean(definition.party),
            nonParty: Boolean(definition.nonParty),
            relatedAttribute: typeof definition.relatedAttribute === 'string'
                ? definition.relatedAttribute
                : null,
            changePerMinute: Number.isFinite(definition.changePerMinute)
                ? Number(definition.changePerMinute)
                : 0,
            paymentDirection: definition.paymentDirection ?? null,
            relativeToLevel: Boolean(definition.relativeToLevel),
            min: normalizeNumber(definition.min),
            max: normalizeNumber(definition.max),
            baseMin: normalizeNumber(definition.baseMin),
            baseMax: normalizeNumber(definition.baseMax),
            baseCapacity: normalizeNumber(definition.baseCapacity),
            initialValue: normalizeNumber(definition.initialValue),
            value: formatValue,
            currentThreshold,
            effectThresholds,
            increases: {
                small: ensureList(definition.increases?.small),
                medium: ensureList(definition.increases?.medium),
                large: ensureList(definition.increases?.large),
                fill: ensureList(definition.increases?.fill)
            },
            decreases: {
                small: ensureList(definition.decreases?.small),
                medium: ensureList(definition.decreases?.medium),
                large: ensureList(definition.decreases?.large),
                empty: ensureList(definition.decreases?.empty)
            }
        };
    }

    static #resolveNeedBarThreshold(effectThresholds, value) {
        if (!Array.isArray(effectThresholds) || effectThresholds.length === 0) {
            return null;
        }

        if (!Number.isFinite(value)) {
            return null;
        }

        let resolved = null;
        for (const entry of effectThresholds) {
            if (!entry || !Number.isFinite(entry.threshold)) {
                continue;
            }
            if (value >= entry.threshold && (!resolved || entry.threshold >= resolved.threshold)) {
                resolved = entry;
            }
        }

        return resolved ? { ...resolved } : null;
    }

    static #applyNeedBarValue(bar, candidateValue) {
        if (!bar) {
            return null;
        }

        const min = Number.isFinite(bar.min) ? bar.min : 0;
        const max = Number.isFinite(bar.max) ? bar.max : null;
        let resolvedValue = Number.isFinite(candidateValue) ? candidateValue : bar.value;
        if (!Number.isFinite(resolvedValue)) {
            resolvedValue = Number.isFinite(max) ? max : min;
        }

        if (Number.isFinite(min)) {
            resolvedValue = Math.max(min, resolvedValue);
        }
        if (Number.isFinite(max)) {
            resolvedValue = Math.min(max, resolvedValue);
        }

        bar.value = resolvedValue;
        const baseMin = bar.baseMin ?? min;
        const baseCapacity = bar.baseCapacity ?? (max - min);
        const authoredValue = baseMin + ((resolvedValue - min) / (max - min)) * baseCapacity;
        bar.currentThreshold = this.#resolveNeedBarThreshold(bar.effectThresholds, authoredValue);
        return resolvedValue;
    }

    static get gearSlotDefinitions() {
        if (!this.#gearSlotDefinitions) {
            this.#gearSlotDefinitions = this.#loadGearSlotDefinitions();
        }
        return this.#gearSlotDefinitions;
    }

    static get dispositionDefinitions() {
        if (!this.#dispositionDefinitions) {
            this.#dispositionDefinitions = this.#loadDispositionDefinitions();
        }
        return this.#dispositionDefinitions;
    }

    static getDispositionDefinitions() {
        return this.dispositionDefinitions;
    }

    static getDispositionDefinition(name) {
        const key = this.#normalizeDispositionType(name);
        const definitions = this.dispositionDefinitions;
        return definitions.types[key] || null;
    }

    static resolveDispositionIntensity(type, value = 0) {
        const key = this.#normalizeDispositionType(type);
        const definitions = this.dispositionDefinitions;
        const dispositionDef = definitions.types[key];
        if (!dispositionDef || !Array.isArray(dispositionDef.thresholds) || dispositionDef.thresholds.length === 0) {
            return 'neutral';
        }

        const thresholds = dispositionDef.thresholds;
        const numericValue = Number(value);
        const resolvedValue = Number.isFinite(numericValue) ? numericValue : 0;
        let intensity = thresholds[0]?.name || 'neutral';
        for (const entry of thresholds) {
            if (resolvedValue >= entry.threshold) {
                intensity = entry.name || intensity;
            }
        }
        return intensity || 'neutral';
    }

    static setCurrentPlayerResolver(resolver) {
        if (resolver && typeof resolver !== 'function') {
            throw new Error('Current player resolver must be a function or null');
        }
        this.#currentPlayerResolver = resolver || null;
    }

    static getCurrentPlayer() {
        return typeof this.#currentPlayerResolver === 'function'
            ? this.#currentPlayerResolver()
            : null;
    }

    static getCurrentPlayerId() {
        const player = this.getCurrentPlayer();
        return player && typeof player.id === 'string' ? player.id : null;
    }

    static resolvePlayerId(playerLike) {
        if (!playerLike) {
            return null;
        }
        if (typeof playerLike === 'string') {
            const trimmed = playerLike.trim();
            return trimmed || null;
        }
        if (typeof playerLike.id === 'string') {
            return playerLike.id;
        }
        return null;
    }

    static setNpcInventoryChangeHandler(handler) {
        if (handler && typeof handler !== 'function') {
            throw new Error('NPC inventory change handler must be a function');
        }
        this.#npcInventoryChangeHandler = handler || null;
    }

    static setLevelUpHandler(handler) {
        if (handler && typeof handler !== 'function') {
            throw new Error('Level-up handler must be a function');
        }
        this.#levelUpHandler = handler || null;
    }

    static get indexByName() {
        return this.#indexByName;
    }

    static get indexById() {
        return this.#indexById;
    }

    static get needBarDefinitions() {
        if (!this.#needBarDefinitions) {
            this.#loadNeedBarDefinitionState({ cacheResult: true, onError: 'throw' });
        }
        return this.#needBarDefinitions;
    }

    static get needBars() {
        return this.needBarDefinitions;
    }

    static get needBarMagnitudeValues() {
        if (this.#needBarMagnitudeValues === undefined) {
            this.needBarDefinitions;
            if (this.#needBarMagnitudeValues === undefined) {
                this.#needBarMagnitudeValues = null;
            }
        }
        return this.#needBarMagnitudeValues;
    }

    static getNeedBarDefinitionsForContext() {
        const definitions = this.needBarDefinitions || {};
        const list = [];
        for (const definition of Object.values(definitions)) {
            const cloned = this.#cloneNeedBarDefinition(definition);
            const formatted = this.#formatNeedBarForContext(cloned, { includeValue: false });
            if (formatted) {
                list.push(formatted);
            }
        }
        list.sort((a, b) => a.name.localeCompare(b.name));
        return list;
    }

    static getAll() {
        return Array.from(this.#instances);
    }

    static removeNpcFromAllLocations(npcId) {
        if (typeof npcId !== 'string' || !npcId.trim()) {
            return 0;
        }

        const trimmedNpcId = npcId.trim();
        const Location = getLocationModule();
        if (!Location || typeof Location.getAll !== 'function') {
            throw new Error('Location module is not available or does not support getAll().');
        }

        const locations = Location.getAll();
        if (!Array.isArray(locations)) {
            throw new Error('Location.getAll() must return an array.');
        }

        let removedFromCount = 0;
        for (const location of locations) {
            if (!location) {
                continue;
            }
            if (typeof location.removeNpcId !== 'function') {
                throw new Error(
                    `Unable to unregister '${trimmedNpcId}' from location '${location.name || location.id || 'unknown'}': removeNpcId is not available.`
                );
            }
            if (location.removeNpcId(trimmedNpcId)) {
                removedFromCount += 1;
            }
        }

        return removedFromCount;
    }

    static unregister(target) {
        if (!target) {
            return false;
        }

        const instancesToRemove = new Set();

        if (target instanceof Player) {
            instancesToRemove.add(target);
        }

        const targetId = (typeof target === 'string'
            ? target.trim()
            : (typeof target?.id === 'string' ? target.id.trim() : ''));
        if (targetId) {
            for (const instance of this.#instances) {
                if (instance?.id === targetId) {
                    instancesToRemove.add(instance);
                }
            }
        }

        if (!instancesToRemove.size) {
            return false;
        }

        let removed = false;
        for (const instance of instancesToRemove) {
            if (this.#instances.delete(instance)) {
                removed = true;
            }
        }

        if (!removed) {
            return false;
        }

        if (targetId) require('./TechniqueUtilityEffects.js').cancelLeaseForActor(targetId);
        this.#rebuildIndexes();
        return true;
    }

    static clearRuntimeRegistries() {
        this.#instances.clear();
        this.#indexById = new Map();
        this.#indexByName = new SanitizedStringMap();
    }

    static reloadDefinitionCaches({ refreshInstances = true, beforeInstall = undefined } = {}) {
        if (beforeInstall !== undefined && typeof beforeInstall !== 'function') throw new TypeError('reloadDefinitionCaches.beforeInstall must be a synchronous function.');
        // Validate detached content before replacing caches or touching actors.
        const staged = this.#loadNeedBarDefinitionState({ cacheResult: false, onError: 'throw' });
        const previous = { needBars: this.#needBarDefinitions, magnitudes: this.#needBarMagnitudeValues, gear: this.#gearSlotDefinitions, dispositions: this.#dispositionDefinitions, pools: this.#pointPoolFormulaRuntime };
        const install = () => {
            if (beforeInstall) {
                const result = beforeInstall();
                if (result && typeof result.then === 'function') throw new TypeError('reloadDefinitionCaches.beforeInstall must be synchronous.');
            }
            this.#needBarDefinitions = staged.definitions;
            this.#needBarMagnitudeValues = staged.magnitudeValues;
            this.#gearSlotDefinitions = null;
            this.#dispositionDefinitions = null;
            this.#pointPoolFormulaRuntime = null;
            if (refreshInstances) for (const instance of this.#instances) {
                const bars = instance.getNeedBars({ scope: 'stored' });
                const applicability = instance.getNeedBarApplicability();
                instance.#definitions = instance.#loadDefinitions();
                instance.#initializeNeedBars(bars, applicability);
            }
        };
        try { return refreshInstances ? this.withNeedBarWorldMutation(install) : install(); }
        catch (error) {
            this.#needBarDefinitions = previous.needBars; this.#needBarMagnitudeValues = previous.magnitudes;
            this.#gearSlotDefinitions = previous.gear; this.#dispositionDefinitions = previous.dispositions;
            this.#pointPoolFormulaRuntime = previous.pools;
            throw error;
        }
    }

    static getByName(name) {
        for (const player of this.#instances) {
            if (player.name && player.name.toLowerCase() === name.toLowerCase()) {
                return player;
            }
        }
        return null;
    }

    static getByNames(names) {
        // If names is a set, convert to array
        if (names instanceof Set) {
            names = Array.from(names);
        }

        if (!Array.isArray(names) || names.length === 0) {
            return [];
        }
        const results = [];
        for (const name of names) {
            const player = this.getByName(name);
            if (player) {
                results.push(player);
            }
        }
        return results;
    }

    static getById(id) {
        if (typeof id !== 'string') {
            return null;
        }
        const trimmed = id.trim();
        if (!trimmed) {
            return null;
        }

        const indexed = this.#indexById.get(trimmed);
        if (indexed) {
            return indexed;
        }

        for (const player of this.#instances) {
            if (player?.id === trimmed) {
                this.#indexById.set(trimmed, player);
                return player;
            }
        }
        return null;
    }

    //Just an alias
    static get(id) {
        return this.getById(id);
    }

    /**
     * Apply time-based need bar deltas for all players.
     * This includes both baseline per-minute need-bar drift and per-minute
     * status-effect need-bar deltas. Returns an array of adjustment records applied.
     */
    #needsNeedBarBoundary() {
        return this.#needBars instanceof Map && !this.#needMutationDepth && !this.#settlingNeedTime && !this.#pendingNeedBarFinalization;
    }

    #flushNeedMutationHealth() {
        if (!this.#needMutationDepth || !Number.isFinite(this.#needMutationMaxHealth)) return;
        this.#reconcileNeedBarCapacities();
        const nextMaximum = this.maxHealth;
        if (nextMaximum !== this.#needMutationMaxHealth) this.#health = this.#health / this.#needMutationMaxHealth * nextMaximum;
        this.#needMutationMaxHealth = nextMaximum;
    }

    #getNeedBarStatusEffects() {
        if (this.#excludeNeedBarStatusEffects || !(this.#needBars instanceof Map)) return [];
        const active = [...this.#needBars.values()].filter(bar => Player.#needBarIsActiveForActor(bar, this));
        const signature = active.map(bar => `${bar.id}:${bar.currentThreshold?.threshold ?? ''}`).join('|');
        if (signature !== this.#derivedNeedSignature) {
            const names = new Set(active.flatMap(bar => [bar.id.toLowerCase(), bar.name.toLowerCase()]));
            this.#derivedNeedEffects = active.flatMap(bar => NeedBarStatusEffects.project(this.#id, bar, bar.currentThreshold, names));
            this.#derivedNeedSignature = signature;
        }
        return this.#derivedNeedEffects;
    }

    #reconcileNeedBarCapacities() {
        if (!(this.#needBars instanceof Map)) return;
        this.#derivedNeedSignature = null;
        const active = [...this.#needBars.values()].filter(bar => Player.#needBarIsActiveForActor(bar, this));
        const statuses = [...this.getStatusEffects(), ...(this.location?.getStatusEffects?.() ?? [])];
        const changes = [];
        for (const bar of this.#needBars.values()) {
            const percentage = active.includes(bar) ? statuses.reduce((sum, effect) => sum + (effect.needBarMaximums || []).reduce((part, entry) => [bar.id, bar.name].some(name => name.toLowerCase() === entry.name.toLowerCase()) ? part + entry.percentModifier : part, 0), 0) : 0;
            const nextMin = bar.baseMin;
            const nextMax = nextMin + bar.baseCapacity * (1 + percentage / 100);
            if (!Number.isFinite(nextMax) || nextMax <= nextMin) throw new Error(`needBars.${bar.id}.max is invalid after modifiers (${percentage}%): maximum must exceed minimum. Reduce the combined capacity modifiers so the resulting capacity is finite and positive.`);
            if (!Number.isFinite(bar.min) || !Number.isFinite(bar.max) || bar.max <= bar.min) {
                const error = new Error(`needBars.${bar.id} has no usable previous min/max; restore its saved reference bounds before changing capacity.`);
                error.code = 'NEED_BAR_STATE_INVALID'; throw error;
            }
            const ratio = (bar.value - bar.min) / (bar.max - bar.min);
            changes.push({ bar, min: nextMin, max: nextMax, value: bar.min === nextMin && bar.max === nextMax ? bar.value : nextMin + ratio * (nextMax - nextMin) });
        }
        for (const { bar, min, max, value } of changes) {
            bar.min = min; bar.max = max;
            Player.#applyNeedBarValue(bar, value);
        }
        this.#derivedNeedSignature = null;
    }

    #captureNeedBarState() {
        return {
            bars: this.#needBars instanceof Map ? new Map([...this.#needBars].map(([id, bar]) => [id, structuredClone(bar)])) : this.#needBars,
            applicability: new Map(this.#needBarApplicability), health: this.#health,
            statusInstances: [...this.#statusEffects], statuses: this.#statusEffects.map(effect => effect.toJSON()), abilities: structuredClone(this.#abilities),
            attributes: { ...this.#attributes }, level: this.#level, healthAttribute: this.#healthAttribute,
            modState: structuredClone(this.#modState), inventory: new Set(this.#inventory),
            equipped: [...this.#inventory].map(item => [item, item.isEquipped]),
            gearSlots: new Map([...this.#gearSlots].map(([key, value]) => [key, { ...value }])),
            partyMembers: new Set(this.#partyMembers), wasEver: this.#wasEverInPlayerParty,
            added: new Set(this.#partyMembersAddedThisTurn), removed: new Set(this.#partyMembersRemovedThisTurn),
            location: this.#currentLocation, definitions: this.#definitions,
            needClock: this.#needBarRatesAppliedAt, healthClock: this.#healthRegenAppliedAt,
            derivedClock: this.#derivedNeedRatesAppliedAt, updated: this.#lastUpdated,
            pending: this.#pendingNeedBarFinalization && { ...this.#pendingNeedBarFinalization }
        };
    }

    #restoreNeedBarState(state) {
        this.#needBars = state.bars; this.#needBarApplicability = state.applicability;
        this.#health = state.health;
        this.#statusEffects = state.statuses.map((effect, index) => Object.assign(state.statusInstances[index], new StatusEffect({ ...effect, register: false })));
        this.#abilities = state.abilities; this.#attributes = state.attributes; this.#level = state.level;
        this.#healthAttribute = state.healthAttribute; this.#modState = state.modState;
        this.#inventory = state.inventory; this.#gearSlots = state.gearSlots;
        for (const [item, equipped] of state.equipped) if (item.isEquipped !== equipped) item.isEquipped = equipped;
        this.#partyMembers = state.partyMembers; this.#wasEverInPlayerParty = state.wasEver;
        this.#partyMembersAddedThisTurn = state.added; this.#partyMembersRemovedThisTurn = state.removed;
        this.#currentLocation = state.location; this.#definitions = state.definitions;
        this.#needBarRatesAppliedAt = state.needClock; this.#healthRegenAppliedAt = state.healthClock;
        this.#derivedNeedRatesAppliedAt = state.derivedClock; this.#lastUpdated = state.updated;
        this.#pendingNeedBarFinalization = state.pending; this.#derivedNeedSignature = null;
    }

    /** Settle old rates, perform one logical mutation, then reconcile capacities once. */
    withNeedBarMutation(mutator, { settle = true, preserveHealth = true } = {}) {
        if (typeof mutator !== 'function') throw new TypeError('withNeedBarMutation requires a mutator function.');
        if (this.#needMutationDepth || this.#settlingNeedTime || this.#pendingNeedBarFinalization) return mutator();
        const snapshot = this.#captureNeedBarState();
        try {
            if (settle) this.settleNeedBarTime();
            const previousMaxHealth = this.maxHealth;
            this.#needMutationDepth++;
            this.#needMutationMaxHealth = previousMaxHealth;
            const result = mutator();
            if (result && typeof result.then === 'function') throw new TypeError('withNeedBarMutation mutator must be synchronous; use withNeedBarWorldMutation for asynchronous world operations.');
            this.#reconcileNeedBarCapacities();
            const nextMaxHealth = this.maxHealth;
            if (preserveHealth && this.#needMutationMaxHealth !== nextMaxHealth) this.#health = this.#health / this.#needMutationMaxHealth * nextMaxHealth;
            return result;
        } catch (error) {
            this.#restoreNeedBarState(snapshot);
            throw error;
        } finally { this.#needMutationDepth = 0; this.#needMutationMaxHealth = null; }
    }

    /** Rare world/source changes settle and reconcile every actor atomically. */
    static withNeedBarWorldMutation(mutator, { settle = true } = {}) {
        if (typeof mutator !== 'function') throw new TypeError('withNeedBarWorldMutation requires a mutator function.');
        if (this.#needWorldMutationDepth) return mutator();
        const actors = [...this.#instances].filter(actor => !actor.#pendingNeedBarFinalization);
        if (!actors.length) return mutator();
        const states = actors.map(actor => [actor, actor.#captureNeedBarState()]);
        let entered = false;
        const cleanup = () => {
            if (!entered) return;
            entered = false; this.#needWorldMutationDepth--;
            for (const actor of actors) { actor.#needMutationDepth--; actor.#needMutationMaxHealth = null; }
        };
        const restore = error => { for (const [actor, state] of states) actor.#restoreNeedBarState(state); throw error; };
        const finish = result => {
            for (const actor of actors) {
                actor.#reconcileNeedBarCapacities();
                const previousMaximum = actor.#needMutationMaxHealth;
                const nextMaximum = actor.maxHealth;
                if (previousMaximum !== nextMaximum) actor.#health = actor.#health / previousMaximum * nextMaximum;
            }
            return result;
        };
        try {
            if (settle) for (const actor of actors) actor.settleNeedBarTime();
            for (const actor of actors) { actor.#needMutationMaxHealth = actor.maxHealth; actor.#needMutationDepth++; }
            this.#needWorldMutationDepth++; entered = true;
            const result = mutator();
            if (result && typeof result.then === 'function') return Promise.resolve(result).then(finish).catch(restore).finally(cleanup);
            const finalized = finish(result);
            cleanup(); return finalized;
        } catch (error) {
            cleanup(); return restore(error);
        }
    }

    #finalizeNeedBarState() {
        if (!this.#pendingNeedBarFinalization) return;
        const previous = this.#pendingNeedBarFinalization;
        this.#reconcileNeedBarCapacities();
        const nextMaximum = this.maxHealth;
        let referenceMaximum = previous.maxHealth;
        if (!Number.isFinite(referenceMaximum) || referenceMaximum <= 0) {
            if (!previous.legacyNoReference) {
                const error = new Error(`Player ${this.#id}.maxHealth is missing or invalid; restore the saved reference maximum before loading need-level health modifiers.`);
                error.code = 'NEED_BAR_STATE_INVALID'; throw error;
            }
            // This saved format predates derived need effects. Reuse the native
            // formula with those new contributions excluded, retaining all saved
            // intrinsic, gear, ability, mod and location inputs.
            this.#excludeNeedBarStatusEffects = true;
            try { referenceMaximum = this.maxHealth; }
            finally { this.#excludeNeedBarStatusEffects = false; }
        }
        if (previous.health < 0 || previous.health > referenceMaximum || !Number.isFinite(previous.health)) {
            const error = new Error(`Player ${this.#id}.health is outside its saved maxHealth reference; restore valid saved Health/maxHealth values.`);
            error.code = 'NEED_BAR_STATE_INVALID'; throw error;
        }
        this.#health = referenceMaximum === nextMaximum ? previous.health : previous.health / referenceMaximum * nextMaximum;
        this.#pendingNeedBarFinalization = null;
    }

    static finalizeNeedBarStateAfterWorldRestore() {
        NeedBarStatusEffects.validateReferences(this.needBarDefinitions, { skills: this.availableSkills });
        const actors = [...this.#instances].filter(actor => actor.#pendingNeedBarFinalization);
        const states = actors.map(actor => [actor, actor.#captureNeedBarState()]);
        try { for (const actor of actors) actor.#finalizeNeedBarState(); }
        catch (error) { for (const [actor, state] of states) actor.#restoreNeedBarState(state); throw error; }
    }

    /** Absolute percentages are resulting states, never percentage-scaled deltas. */
    setNeedBarPercentages(entries) {
        if (!Array.isArray(entries)) throw new TypeError('Need percentages must be an array of {id, percentage}.');
        return this.withNeedBarMutation(() => {
            const requested = entries.map((entry, index) => {
                const bar = this.#resolveNeedBarByIdentifier(entry?.id);
                if (!bar || !Player.#needBarIsActiveForActor(bar, this)) throw new Error(`needBarPercentages[${index}].id must identify an active need bar.`);
                const percentage = StatusEffect.optionalNumber(entry.percentage, `needBarPercentages[${index}].percentage`);
                if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw new Error(`needBarPercentages[${index}].percentage must be between 0 and 100.`);
                return { bar, ratio: percentage / 100 };
            });
            for (const { bar, ratio } of requested) Player.#applyNeedBarValue(bar, bar.min + ratio * (bar.max - bar.min));
            this.#lastUpdated = new Date().toISOString();
            return requested.map(({ bar }) => bar.id);
        });
    }

    /** Net-per-minute reference semantics, batching only constant bands/rates. */
    settleNeedBarTime({ worldMinutes = Globals.getTotalWorldMinutes() } = {}) {
        if (this.#settlingNeedTime || this.#pendingNeedBarFinalization) return [];
        if (!Number.isFinite(worldMinutes) || worldMinutes < 0) throw new Error('Need time worldMinutes must be a non-negative finite number.');
        const target = Math.floor(worldMinutes);
        if (this.#needBarRatesAppliedAt === target && this.#healthRegenAppliedAt === target && this.#derivedNeedRatesAppliedAt === target
            && this.#statusEffects.every(effect => effect.duration !== 0 && effect.appliedAt === target)) return [];
        const snapshot = this.#captureNeedBarState();
        const state = { ...snapshot };
        this.#settlingNeedTime = true;
        try {
            for (const field of ['needClock', 'healthClock', 'derivedClock']) {
                if (!Number.isFinite(state[field]) || state[field] > target) state[field] = target;
                else state[field] = Math.ceil(state[field]);
            }
            const clocks = new Map(this.#statusEffects.map(effect => [effect, Number.isFinite(effect.appliedAt) && effect.appliedAt <= target ? Math.ceil(effect.appliedAt) : target]));
            let cursor = Math.min(target, state.needClock, state.healthClock, state.derivedClock, ...clocks.values());
            const before = new Map([...this.#needBars].map(([id, bar]) => [id, { value: bar.value, min: bar.min, max: bar.max, threshold: bar.currentThreshold?.threshold }]));
            const beforeHealth = this.#health;
            const regenPercent = Player.#getHealthRegenPercentPerMinute();
            while (cursor < target) {
                const maxHealth = this.maxHealth;
                const activeBars = [...this.#needBars.values()].filter(bar => Player.#needBarIsActiveForActor(bar, this));
                const rates = new Map(activeBars.map(bar => [bar, cursor >= state.needClock ? bar.changePerMinute : 0]));
                let healthRate = cursor >= state.healthClock && !this.isDead ? maxHealth * regenPercent / 100 : 0;
                let span = target - cursor;
                const intrinsicIds = new Set(this.#statusEffects.map(effect => effect.id));
                const statuses = [...this.getStatusEffects(), ...(this.location?.getStatusEffects?.() ?? [])];
                const effectById = new Map(this.#statusEffects.map(effect => [effect.id, effect]));
                for (const clock of [state.needClock, state.healthClock, state.derivedClock, ...clocks.values()]) if (clock > cursor) span = Math.min(span, clock - cursor);
                for (const status of statuses) {
                    const intrinsic = intrinsicIds.has(status.id) ? effectById.get(status.id) : null;
                    if (intrinsic && (intrinsic.duration === 0 || cursor < clocks.get(intrinsic))) continue;
                    if (!intrinsic && cursor < state.derivedClock) continue;
                    if (intrinsic && intrinsic.duration > 0) span = Math.min(span, intrinsic.duration);
                    for (const entry of status.needBars || []) {
                        if (entry.name.toLowerCase() === 'health') healthRate += entry.delta + maxHealth * (entry.percentDelta || 0) / 100;
                        else {
                            const bar = activeBars.find(candidate => [candidate.id, candidate.name].some(name => name.toLowerCase() === entry.name.toLowerCase()));
                            if (bar) rates.set(bar, rates.get(bar) + entry.delta + bar.baseCapacity * (entry.percentDelta || 0) / 100);
                        }
                    }
                }
                if (!Number.isFinite(healthRate)) throw new Error(`Player ${this.#id} ongoing Health rate is non-finite after combining delta/percentDelta and regeneration; reduce the overflowing rates or maximum-Health modifiers.`);
                for (const [bar, rate] of rates) {
                    if (!Number.isFinite(rate)) throw new Error(`Player ${this.#id} needBars.${bar.id} ongoing rate is non-finite; reduce the overflowing fixed/percentage rates or authored base capacity.`);
                    if (!rate) continue;
                    const authoredValue = bar.baseMin + (bar.value - bar.min) / (bar.max - bar.min) * bar.baseCapacity;
                    const authoredRate = rate / (bar.max - bar.min) * bar.baseCapacity;
                    const boundaries = [...bar.effectThresholds.map(entry => entry.threshold), bar.baseMin, bar.baseMax];
                    for (const boundary of boundaries) {
                        let steps;
                        if (authoredRate > 0 && boundary > authoredValue) steps = Math.ceil((boundary - authoredValue) / authoredRate);
                        else if (authoredRate < 0 && boundary <= authoredValue && boundary > bar.baseMin) steps = Math.floor((authoredValue - boundary) / -authoredRate) + 1;
                        if (Number.isFinite(steps) && steps > 0) span = Math.min(span, steps);
                    }
                }
                if (!(span >= 1)) throw new Error(`Need time for ${this.#id} has a non-positive processing span at minute ${cursor}.`);
                // Bounds apply once to the net Health change, before capacity changes.
                const candidateHealth = this.#health + healthRate * span;
                if (!Number.isFinite(candidateHealth)) throw new Error(`Player ${this.#id} ongoing Health value overflowed over ${span} minutes; reduce the combined fixed/percentage rates or maximum-Health modifiers.`);
                const candidates = [...rates].map(([bar, rate]) => {
                    const value = bar.value + rate * span;
                    if (!Number.isFinite(value)) throw new Error(`Player ${this.#id} needBars.${bar.id}.value overflowed over ${span} minutes; reduce its fixed/percentage rates or authored base capacity.`);
                    return { bar, value };
                });
                this.#health = Math.max(0, Math.min(maxHealth, candidateHealth));
                for (const { bar, value } of candidates) Player.#applyNeedBarValue(bar, value);
                for (const effect of this.#statusEffects) if (cursor >= clocks.get(effect)) {
                    if (effect.duration > 0) effect.duration -= span;
                    effect.appliedAt = cursor + span;
                }
                this.#statusEffects = this.#statusEffects.filter(effect => effect.duration !== 0);
                this.#derivedNeedSignature = null;
                this.#reconcileNeedBarCapacities();
                const nextMaxHealth = this.maxHealth;
                if (nextMaxHealth !== maxHealth) this.#health = this.#health / maxHealth * nextMaxHealth;
                cursor += span;
            }
            this.#needBarRatesAppliedAt = target;
            this.#healthRegenAppliedAt = target;
            this.#derivedNeedRatesAppliedAt = target;
            for (const effect of this.#statusEffects) effect.appliedAt = target;
            const adjustments = [];
            if (this.#health !== beforeHealth) adjustments.push({ playerId: this.id, playerName: this.name, bar: 'Health', needBarName: 'Health', previousValue: beforeHealth, newValue: this.#health, delta: this.#health - beforeHealth, source: 'ongoing', ticksApplied: target - Math.min(state.healthClock, state.derivedClock) });
            for (const [id, bar] of this.#needBars) {
                const previous = before.get(id);
                if (previous.value !== bar.value || previous.max !== bar.max || previous.threshold !== bar.currentThreshold?.threshold) adjustments.push({ playerId: this.id, playerName: this.name, bar: bar.name, needBarId: id, previousValue: previous.value, newValue: bar.value, delta: bar.value - previous.value, min: bar.min, max: bar.max, currentThreshold: bar.currentThreshold ? structuredClone(bar.currentThreshold) : null, source: 'ongoing', ticksApplied: target - state.needClock });
            }
            if (cursor > Math.min(state.needClock, state.healthClock, state.derivedClock)) this.#lastUpdated = new Date().toISOString();
            return adjustments;
        } catch (error) { this.#restoreNeedBarState(snapshot); throw error; }
        finally { this.#settlingNeedTime = false; }
    }

    static applyStatusEffectNeedBarsToAll() {
        const actors = [...this.#instances];
        const states = actors.map(actor => [actor, actor.#captureNeedBarState()]);
        try { return actors.flatMap(actor => actor.settleNeedBarTime()); }
        catch (error) { for (const [actor, state] of states) actor.#restoreNeedBarState(state); throw error; }
    }

    static #notifyNpcInventoryChange(player, payload = {}) {
        if (!player || !player.isNPC || !this.#npcInventoryChangeHandler) {
            return;
        }

        try {
            const result = this.#npcInventoryChangeHandler({
                character: player,
                ...payload
            });
            if (result && typeof result.then === 'function') {
                result.catch(error => {
                    console.warn('NPC inventory change handler failed:', error?.message || error);
                });
            }
        } catch (error) {
            console.warn('NPC inventory change handler errored:', error?.message || error);
        }
    }

    static #normalizeDispositionType(type) {
        if (typeof type !== 'string') {
            return 'default';
        }
        const normalized = type.trim().toLowerCase();
        return normalized || 'default';
    }

    static #sanitizePersonalityValue(value) {
        const collectValues = (input) => {
            if (input === null || input === undefined) {
                return [];
            }

            if (typeof input === 'string') {
                const trimmed = input.trim();
                return trimmed ? [trimmed] : [];
            }

            if (typeof input === 'number' || typeof input === 'boolean') {
                return [String(input)];
            }

            if (Array.isArray(input)) {
                return input.flatMap(collectValues);
            }

            if (typeof input === 'object') {
                return Object.values(input).flatMap(collectValues);
            }

            return [];
        };

        const parts = collectValues(value);
        if (!parts.length) {
            return null;
        }

        return parts.join(', ');
    }

    static #loadGearSlotDefinitions() {
        try {
            const { value } = loadMergedDefinitionFile({
                baseDir: Globals.baseDir || __dirname,
                filename: 'gear_slots.yaml'
            });
            const data = value || {};
            const gearSlots = data.gear_slots && typeof data.gear_slots === 'object' ? data.gear_slots : {};

            const byType = new Map();
            const byName = new Map();
            const nameLookup = new Map();

            for (const [typeKey, slotNames] of Object.entries(gearSlots)) {
                if (!typeKey || typeof typeKey !== 'string') {
                    continue;
                }
                const slotType = typeKey.trim().toLowerCase();
                if (!slotType) {
                    continue;
                }

                const normalizedNames = Array.isArray(slotNames)
                    ? slotNames
                    : [slotNames];

                const cleanedNames = normalizedNames
                    .map(name => {
                        if (typeof name !== 'string') {
                            return null;
                        }
                        const trimmed = name.trim();
                        return trimmed || null;
                    })
                    .filter(Boolean);

                if (!cleanedNames.length) {
                    continue;
                }

                byType.set(slotType, cleanedNames);

                for (const slotName of cleanedNames) {
                    const lowerName = slotName.toLowerCase();
                    nameLookup.set(lowerName, slotName);
                    byName.set(slotName, slotType);
                }
            }

            return {
                byType,
                byName,
                nameLookup
            };
        } catch (error) {
            console.error('Error loading gear slot definitions:', error.message);
            return {
                byType: new Map(),
                byName: new Map(),
                nameLookup: new Map()
            };
        }
    }

    static #resolveDispositionFirstImpressionMultiplier() {
        const dispositionsConfig = Globals.config?.dispositions;
        if (dispositionsConfig === undefined || dispositionsConfig === null) {
            return null;
        }
        if (typeof dispositionsConfig !== 'object' || Array.isArray(dispositionsConfig)) {
            throw new Error('dispositions config must be an object when provided.');
        }

        const rawValue = dispositionsConfig.first_impression_multiplier;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return null;
        }
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue)) {
            throw new Error('dispositions.first_impression_multiplier must be a finite number when provided.');
        }
        return numericValue;
    }

    static #loadDispositionDefinitions() {
        const firstImpressionMultiplier = this.#resolveDispositionFirstImpressionMultiplier();
        try {
            const { value } = loadMergedDefinitionFile({
                baseDir: Globals.baseDir || __dirname,
                filename: 'dispositions.yaml'
            });
            const data = value || {};

            const rangeSource = typeof data.range === 'object' && data.range !== null ? data.range : {};
            const range = {
                min: Number.isFinite(Number(rangeSource.min)) ? Number(rangeSource.min) : null,
                max: Number.isFinite(Number(rangeSource.max)) ? Number(rangeSource.max) : null,
                typicalStep: Number.isFinite(Number(rangeSource.typical_step)) ? Number(rangeSource.typical_step) : null,
                typicalBigStep: Number.isFinite(Number(rangeSource.typical_big_step)) ? Number(rangeSource.typical_big_step) : null
            };

            const dispositionSource = typeof data.dispositions === 'object' && data.dispositions !== null
                ? data.dispositions
                : {};

            const types = {};
            for (const [name, config] of Object.entries(dispositionSource)) {
                if (!name || typeof config !== 'object' || config === null) {
                    continue;
                }

                const label = String(name).trim();
                if (!label) {
                    continue;
                }

                const key = this.#normalizeDispositionType(label);

                const description = typeof config.description === 'string' ? config.description.trim() : '';
                const icon = typeof config.icon === 'string' && config.icon.trim() ? config.icon.trim() : '';
                const moveUp = Array.isArray(config.move_up)
                    ? config.move_up.filter(entry => typeof entry === 'string' && entry.trim()).map(entry => entry.trim())
                    : [];
                const moveDown = Array.isArray(config.move_down)
                    ? config.move_down.filter(entry => typeof entry === 'string' && entry.trim()).map(entry => entry.trim())
                    : [];
                const moveWayDown = Array.isArray(config.move_way_down)
                    ? config.move_way_down.filter(entry => typeof entry === 'string' && entry.trim()).map(entry => entry.trim())
                    : [];

                const hostileValueRaw = config.hostile_value;
                const hostileThresholdRaw = config.hostile_threshold;
                const hostileValue = Number.isFinite(Number(hostileValueRaw)) ? Number(hostileValueRaw) : null;
                let hostileThreshold = null;
                if (hostileThresholdRaw === null) {
                    hostileThreshold = null;
                } else if (hostileThresholdRaw !== undefined) {
                    const numericThreshold = Number(hostileThresholdRaw);
                    hostileThreshold = Number.isFinite(numericThreshold) ? numericThreshold : null;
                }

                const thresholdsSource = typeof config.min_thresholds === 'object' && config.min_thresholds !== null
                    ? config.min_thresholds
                    : {};

                const thresholds = Object.entries(thresholdsSource)
                    .map(([rawThreshold, rawLabel]) => {
                        const numericThreshold = Number(rawThreshold);
                        if (!Number.isFinite(numericThreshold)) {
                            return null;
                        }
                        const thresholdLabel = typeof rawLabel === 'string'
                            ? rawLabel.trim()
                            : (rawLabel ? String(rawLabel).trim() : '');
                        if (!thresholdLabel) {
                            return null;
                        }
                        return {
                            threshold: numericThreshold,
                            name: thresholdLabel
                        };
                    })
                    .filter(Boolean)
                    .sort((a, b) => a.threshold - b.threshold);

                types[key] = {
                    key,
                    label,
                    description,
                    icon,
                    moveUp,
                    moveDown,
                    moveWayDown,
                    thresholds,
                    hostileValue,
                    hostileThreshold
                };
            }

            return {
                range,
                types,
                firstImpressionMultiplier
            };
        } catch (error) {
            console.error('Error loading dispositions definitions:', error.message);
            return {
                range: {
                    min: null,
                    max: null,
                    typicalStep: null,
                    typicalBigStep: null
                },
                types: {}
            };
        }
    }

    // Static private method for ID generation
    static #generateUniqueId(name) {
        return IdGenerator.next('character', name);
    }

    constructor(options = {}) {
        if (options.deferNeedBarFinalization === true) this.#pendingNeedBarFinalization = { maxHealth: options.savedMaxHealth, health: options.health, legacyNoReference: options.legacyNeedBarState === true && options.savedMaxHealth === undefined };
        // Load definitions first
        this.#definitions = this.#loadDefinitions();

        // Initialize attributes dynamically from definitions
        this.#initializeAttributes(options.attributes ?? {});

        this.#inventory = new Set();
        this.#initializeInventory(options.inventory);

        this.#healthAttribute = this.#resolveHealthAttribute(options.healthAttribute);

        // Base stats (not attributes)
        this.#level = options.level ?? 1;

        const initialMaxHealth = this.#calculateBaseHealth();
        this.#health = options.health !== undefined && options.health !== null
            ? Player.#normalizeHealthValue(options.health)
            : initialMaxHealth;

        // Player identification
        this.#name = options.name ?? "Unnamed Player";
        this.#aliases = Player.#normalizeAliasSet(options.aliases, this.#name);
        this.#description = options.description ?? "A mysterious adventurer with an unknown past.";
        this.#shortDescription = options.shortDescription ?? "";
        this.#id = options.id ?? Player.#generateUniqueId(this.#name);
        IdGenerator.register('character', this.#id);
        this.#class = options.class ?? "person";
        this.#race = options.race ?? "human";
        this.#gender = options.gender ?? "unspecified";
        this.#isDead = options.isDead ?? false;
        this.#persistWhenDead = Boolean(options.persistWhenDead);
        this.#inCombat = options.inCombat ?? false;
        this.#characterArc = Player.#normalizeCharacterArc(options.characterArc);
        this.#corpseCountdown = Number.isFinite(options.corpseCountdown) ? options.corpseCountdown : null;
        if (this.#isDead) {
            if (this.#persistWhenDead) {
                this.#corpseCountdown = null;
            } else if (!Number.isFinite(this.#corpseCountdown) || this.#corpseCountdown < 0) {
                this.#corpseCountdown = 5;
            }
        }

        const seedMemories = Array.isArray(options.importantMemories)
            ? options.importantMemories
                .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean)
            : [];
        this.#importantMemories = seedMemories.slice(0);

        // Location (can be Location ID string or Location object)
        this.#currentLocation = options.location ?? null;
        this.#lastSeenTime = Player.#normalizeLastSeenTime(options.last_seen_time ?? options.lastSeenTime);
        this.#lastSeenLocation = Player.#normalizeLastSeenLocation(options.last_seen_location ?? options.lastSeenLocation);
        this.#wasInPlayerLocationPreviousRound = Boolean(
            options.was_in_player_location_previous_round
            ?? options.wasInPlayerLocationPreviousRound
        );

        // Player image ID for generated portrait
        this.#imageId = options.imageId ?? null;
        if (options.imagePrompt !== undefined && options.imagePrompt !== null && typeof options.imagePrompt !== 'string') {
            throw new Error('Image prompt must be a string');
        }
        this.#imagePrompt = typeof options.imagePrompt === 'string' ? options.imagePrompt.trim() : '';
        this.#isNPC = Boolean(options.isNPC);
        this.#hiddenFromPlayer = this.#isNPC && !this.#isDead && Boolean(options.hiddenFromPlayer);
        this.#isHostile = this.#isNPC && Boolean(options.isHostile);
        this.#barterInventory = new Set();
        this.#willingToTrade = this.#isNPC ? options.willingToTrade !== false : true;
        this.#tradeRefusalExpiresAt = Player.#normalizeOptionalNonNegativeInteger(
            options.tradeRefusalExpiresAt,
            'tradeRefusalExpiresAt'
        );
        this.#barterStockUpdatedAt = Player.#normalizeOptionalNonNegativeInteger(
            options.barterStockUpdatedAt,
            'barterStockUpdatedAt'
        );
        this.#barterProfile = Player.#normalizeBarterProfile(options.barterProfile);
        this.#initializeBarterInventory(options.barterInventory);
        this.#factionId = Player.#normalizeFactionId(options.factionId);
        this.#factionStandings = Player.#normalizeFactionStandings(options.factionStandings);
        this.#favorUsage = Player.#normalizeFavorUsage(options.favorUsage);
        this.#relationships = Player.#normalizeRelationships(options.relationships, { ownerId: this.#id });
        this.#elapsedTime = Number.isFinite(options.elapsedTime) && options.elapsedTime > 0
            ? Math.round(options.elapsedTime)
            : 0;
        this.#needBarRatesAppliedAt = Number.isFinite(options.needBarRatesAppliedAt) && options.needBarRatesAppliedAt >= 0
            ? Math.floor(options.needBarRatesAppliedAt)
            : null;
        this.#derivedNeedRatesAppliedAt = Number.isFinite(options.derivedNeedRatesAppliedAt) && options.derivedNeedRatesAppliedAt >= 0 ? options.derivedNeedRatesAppliedAt : null;
        this.#healthRegenAppliedAt = Number.isFinite(options.healthRegenAppliedAt) && options.healthRegenAppliedAt >= 0
            ? Math.floor(options.healthRegenAppliedAt)
            : null;

        const personalityOption = options.personality && typeof options.personality === 'object'
            ? options.personality
            : null;
        this.#personalityType = Player.#sanitizePersonalityValue(options.personalityType ?? personalityOption?.type);
        this.#personalityTraits = Player.#sanitizePersonalityValue(options.personalityTraits ?? personalityOption?.traits);
        this.#personalityNotes = Player.#sanitizePersonalityValue(options.personalityNotes ?? personalityOption?.notes);
        this.#aiNotes = Player.#sanitizePersonalityValue(options.aiNotes ?? personalityOption?.aiNotes);
        this.#disposition = Player.normalizeNpcDisposition(options.disposition);
        this.#hostileArrivalProvenance = Player.#normalizeHostileArrivalProvenance(options.hostileArrivalProvenance);
        this.#playerGuidance = Player.normalizePlayerGuidance(options.playerGuidance);
        this.#resistances = typeof options.resistances === 'string'
            ? options.resistances
            : (typeof options.resistance === 'string' ? options.resistance : '');
        this.#vulnerabilities = typeof options.vulnerabilities === 'string'
            ? options.vulnerabilities
            : (typeof options.vulnerability === 'string' ? options.vulnerability : '');
        this.#goals = Player.#normalizeGoalList(options.goals ?? personalityOption?.goals ?? []);

        this.#partyMembers = new Set(Array.isArray(options.partyMembers) ? options.partyMembers.filter(id => typeof id === 'string') : []);
        this.#dispositions = this.#initializeDispositions(options.dispositions);
        if (this.#isHostile) {
            this.#applyHostileDispositionsToCurrentPlayer();
        }
        if (this.#partyMembers.size) {
            for (const memberId of this.#partyMembers) {
                const member = Player.getById(memberId);
                if (member) {
                    member.wasEverInPlayerParty = true;
                }
            }
        }
        const turnsSincePartyMemoryGeneration = Number(options.turnsSincePartyMemoryGeneration);
        if (Number.isFinite(turnsSincePartyMemoryGeneration) && turnsSincePartyMemoryGeneration > 0) {
            this.#turnsSincePartyMemoryGeneration = Math.floor(turnsSincePartyMemoryGeneration);
        }

        this.#pendingPartyMemoryHistory = Array.isArray(options.partyMemoryHistorySegments)
            ? options.partyMemoryHistorySegments
                .map(segment => (Array.isArray(segment)
                    ? segment
                        .filter(entry => entry && typeof entry === 'object')
                        .map(clonePartyMemoryHistoryEntry)
                    : null))
                .filter(Boolean)
            : [];

        this.#partyMembershipChangedThisTurn = Boolean(options.partyMembershipChangedThisTurn);
        this.#wasEverInPlayerParty = Boolean(options.wasEverInPlayerParty);

        const addedThisTurn = Array.isArray(options.partyMembersAddedThisTurn)
            ? options.partyMembersAddedThisTurn.filter(id => typeof id === 'string')
            : [];
        this.#partyMembersAddedThisTurn = new Set(addedThisTurn);

        const removedThisTurn = Array.isArray(options.partyMembersRemovedThisTurn)
            ? options.partyMembersRemovedThisTurn.filter(id => typeof id === 'string')
            : [];
        this.#partyMembersRemovedThisTurn = new Set(removedThisTurn);

        Player.registerAbilityIdentities(options);
        this.#skills = new Map();
        this.#initializeSkills(options.skills);
        this.#abilities = this.#normalizeAbilities(options.abilities);
        this.#techniques = Technique.normalizeLearned(options.techniques);
        this.#disciplineAccess = Technique.normalizeDisciplineAccess(options.disciplineAccess);
        this.#declinedAbilities = this.#normalizeAbilities(options.declinedAbilities);
        this.#pendingAbilityOptionsByLevel = this.#normalizePendingAbilityOptionsByLevel(options.pendingAbilityOptionsByLevel);
        this.#pendingAbilityAttachmentDraftsByLevel = this.#normalizePendingAbilityAttachmentDraftsByLevel(options.pendingAbilityAttachmentDraftsByLevel);
        this.#initializeGear(options.gear);

        const providedPoints = Number(options.unspentSkillPoints);
        if (Number.isFinite(providedPoints)) {
            this.#unspentSkillPoints = Math.max(0, Math.floor(providedPoints));
        } else {
            this.#unspentSkillPoints = this.#skillPointsPerLevel() * this.#level;
        }

        const providedAttributePoints = Number(options.unspentAttributePoints);
        if (Number.isFinite(providedAttributePoints)) {
            this.#unspentAttributePoints = Math.floor(providedAttributePoints);
        } else {
            this.#unspentAttributePoints = 0;
        }

        this.#statusEffects = this.#normalizeStatusEffects(options.statusEffects);

        const initialExperience = Number.isFinite(options.experience)
            ? Math.max(0, Number(options.experience))
            : 0;
        this.#experience = initialExperience;
        const initialCurrency = Number.isFinite(options.currency)
            ? Math.max(0, Math.floor(options.currency))
            : 0;
        this.#currency = initialCurrency;
        this.#processExperienceOverflow();

        this.#needBarApplicability = Player.#normalizeNeedBarApplicability(options.needBarApplicability);
        this.#initializeNeedBars(options.needBars, this.#needBarApplicability);
        this.#thingListViewPreferences = Player.#normalizeThingListViewPreferences(options.thingListViewPreferences);
        this.#modState = Player.#normalizeModState(options.modState);
        this.#installExtensionFieldAccessors();
        this.#applyExtensionFieldInputs(playerExtensionFields.extractInputs(options));
        this.#syncModStateWithInventory({ action: 'initialize' });

        this.#pendingNeedBarFinalization = options.deferNeedBarFinalization === true
            ? { maxHealth: options.savedMaxHealth, health: this.#health, legacyNoReference: options.legacyNeedBarState === true && options.savedMaxHealth === undefined }
            : null;
        if (!this.#pendingNeedBarFinalization) this.#reconcileNeedBarCapacities();
        if (options.health === undefined || options.health === null) this.#health = this.maxHealth;
        else if (!this.#pendingNeedBarFinalization && Number.isFinite(options.savedMaxHealth)) {
            this.#health = (this.#health / options.savedMaxHealth) * this.maxHealth;
        }

        // Creation timestamp
        this.#createdAt = options.createdAt || new Date().toISOString();
        this.#lastUpdated = options.lastUpdated || this.#createdAt;

        Player.#indexById.set(this.#id, this);
        Player.#indexByName.set(this.#name, this);

        Player.#instances.add(this);
    }

    /**
     * Load complete definitions from YAML file (private method)
     */
    #loadDefinitions() {
        try {
            const { value } = loadMergedDefinitionFile({
                baseDir: Globals.baseDir || __dirname,
                filename: 'attributes.yaml'
            });
            return value || {};
        } catch (error) {
            console.error('Error loading attribute definitions:', error.message);
            // Fallback to basic definitions
            return {
                attributes: {
                    strength: { label: 'Strength', default: 10, min: 3, max: 18 },
                    dexterity: { label: 'Dexterity', default: 10, min: 3, max: 18 },
                    constitution: { label: 'Constitution', default: 10, min: 3, max: 18 },
                    intelligence: { label: 'Intelligence', default: 10, min: 3, max: 18 },
                    wisdom: { label: 'Wisdom', default: 10, min: 3, max: 18 },
                    charisma: { label: 'Charisma', default: 10, min: 3, max: 18 }
                },
                system: {
                    modifierFormula: "floor((value - 10) / 2)",
                    validationRules: { enforceMinMax: true }
                }
            };
        }
    }

    /**
     * Initialize attributes dynamically from definitions (private method)
     */
    #initializeAttributes(providedAttributes = {}) {
        for (const [attrName, attrDef] of Object.entries(this.attributeDefinitions)) {
            // Use provided value, or default from definition, or fallback to 10
            this.#attributes[attrName] = providedAttributes[attrName] ?? attrDef.default ?? 10;
        }
    }

    #initializeInventory(items = []) {
        if (!Array.isArray(items)) {
            return;
        }
        for (const entry of items) {
            this.#addInventoryThing(entry, { updateTimestamp: false, suppressNpcEquip: true, mergeStacks: false });
        }
    }

    #initializeBarterInventory(items = []) {
        if (!Array.isArray(items)) {
            return;
        }
        for (const entry of items) {
            this.#addBarterInventoryThing(entry, { updateTimestamp: false });
        }
    }

    #initializeGear(gearState = null) {
        const definitions = Player.gearSlotDefinitions;
        this.#gearSlots = new Map();
        this.#gearSlotsByType = new Map();
        this.#gearSlotNameIndex = new Map();

        const normalizedState = gearState instanceof Map
            ? Object.fromEntries(gearState.entries())
            : (gearState && typeof gearState === 'object' ? { ...gearState } : {});

        for (const [slotType, slotNames] of definitions.byType.entries()) {
            const slotsForType = [];
            for (const slotName of slotNames) {
                if (typeof slotName !== 'string') {
                    continue;
                }
                const trimmedName = slotName.trim();
                if (!trimmedName) {
                    continue;
                }

                const lowerKey = trimmedName.toLowerCase();
                this.#gearSlotNameIndex.set(lowerKey, trimmedName);
                slotsForType.push(trimmedName);

                const rawEntry = normalizedState && Object.prototype.hasOwnProperty.call(normalizedState, trimmedName)
                    ? normalizedState[trimmedName]
                    : null;

                const itemId = this.#resolveItemIdFromGearValue(rawEntry);

                this.#gearSlots.set(trimmedName, {
                    slotType,
                    itemId
                });
            }

            if (slotsForType.length > 0) {
                this.#gearSlotsByType.set(slotType, slotsForType);
            }
        }

        this.#syncGearWithInventory();
    }

    #resolveItemIdFromGearValue(value) {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed || null;
        }
        if (typeof value === 'object') {
            if (typeof value.itemId === 'string') {
                const trimmed = value.itemId.trim();
                return trimmed || null;
            }
            if (typeof value.id === 'string') {
                const trimmed = value.id.trim();
                return trimmed || null;
            }
        }
        return null;
    }

    #normalizeSlotType(slotType) {
        if (!slotType || (typeof slotType !== 'string' && typeof slotType !== 'number')) {
            return null;
        }
        const trimmed = String(slotType).trim().toLowerCase();
        return trimmed || null;
    }

    #resolveSlotName(slotName) {
        if (!slotName || typeof slotName !== 'string') {
            return null;
        }
        const trimmed = slotName.trim();
        if (!trimmed) {
            return null;
        }
        if (this.#gearSlots && this.#gearSlots.has(trimmed)) {
            return trimmed;
        }
        // tolowercase breaks map handing here, so we're not doing that.
        const lookup = this.#gearSlotNameIndex?.get(trimmed);
        return lookup || null;
    }

    #syncGearWithInventory() {
        if (!this.#gearSlots || this.#gearSlots.size === 0) {
            return;
        }

        const inventoryIds = new Set();
        if (this.#inventory && this.#inventory.size > 0) {
            for (const item of this.#inventory.values()) {
                if (item && typeof item.id === 'string') {
                    inventoryIds.add(item.id);
                }
            }
        }

        for (const slotData of this.#gearSlots.values()) {
            if (!slotData) {
                continue;
            }
            if (slotData.itemId && !inventoryIds.has(slotData.itemId)) {
                slotData.itemId = null;
            }
        }
    }

    #syncModStateWithInventory(event = {}) {
        const registry = Globals.modExtensionRegistry;
        if (!registry || typeof registry.syncActorInventory !== 'function') {
            return;
        }
        registry.syncActorInventory(this, event);
    }

    #initializeDispositions(source = {}) {
        if (!source || typeof source !== 'object') {
            return new Map();
        }
        const dispositionMap = new Map();
        for (const [npcId, types] of Object.entries(source)) {
            if (typeof npcId !== 'string' || !types || typeof types !== 'object') {
                continue;
            }
            const typeMap = new Map();
            for (const [type, value] of Object.entries(types)) {
                const normalizedType = Player.#normalizeDispositionType(type);
                const numericValue = Number(value);
                if (!normalizedType || !Number.isFinite(numericValue)) {
                    continue;
                }
                typeMap.set(normalizedType, numericValue);
            }
            if (typeMap.size > 0) {
                dispositionMap.set(npcId, typeMap);
            }
        }
        return dispositionMap;
    }

    #applyHostileDispositionsToCurrentPlayer() {
        if (!this.#isNPC || !this.#isHostile) {
            return;
        }
        const targetPlayerId = Player.getCurrentPlayerId();
        if (!targetPlayerId || targetPlayerId === this.#id) {
            return;
        }
        const definitions = Player.dispositionDefinitions;
        const types = definitions?.types || {};
        for (const def of Object.values(types)) {
            if (!def) {
                continue;
            }
            const targetValue = Number(def.hostileValue);
            if (!Number.isFinite(targetValue)) {
                continue;
            }
            const dispositionKey = def.key || def.label;
            if (!dispositionKey) {
                continue;
            }
            const normalizedKey = Player.#normalizeDispositionType(dispositionKey);
            const existingMap = this.#dispositions.get(targetPlayerId);
            if (existingMap && (existingMap.has(normalizedKey) || existingMap.has(dispositionKey))) {
                continue;
            }
            this.setDisposition(targetPlayerId, dispositionKey, targetValue);
        }
    }

    #initializeSkills(skillValues = {}) {
        const available = Player.availableSkills instanceof Map ? Player.availableSkills : new Map();

        let providedMap;
        if (skillValues instanceof Map) {
            providedMap = new Map(skillValues);
        } else if (Array.isArray(skillValues)) {
            providedMap = new Map(skillValues);
        } else if (skillValues && typeof skillValues === 'object') {
            providedMap = new Map(Object.entries(skillValues));
        } else {
            providedMap = new Map();
        }

        if (available.size > 0) {
            for (const [skillName] of available) {
                const raw = providedMap.has(skillName) ? Number(providedMap.get(skillName)) : 1;
                const value = Number.isFinite(raw) ? raw : 1;
                this.#skills.set(skillName, value);
            }
        } else if (providedMap.size > 0) {
            for (const [skillName, raw] of providedMap.entries()) {
                const value = Number.isFinite(Number(raw)) ? Number(raw) : 1;
                this.#skills.set(skillName, value);
            }
        }
    }

    #skillPointsPerLevel() {
        const availableCount = Player.availableSkills instanceof Map ? Player.availableSkills.size : 0;
        if (!availableCount || availableCount <= 0) {
            return 0;
        }
        return Math.ceil(availableCount / 5);
    }

    static #getPointPoolFormulaRuntime() {
        const config = Globals && Globals.config && typeof Globals.config === 'object' ? Globals.config : null;
        if (!config) {
            throw new Error('Globals.config must be initialized before evaluating point pool formulas.');
        }
        if (!FormulaEvaluator || typeof FormulaEvaluator.compile !== 'function') {
            throw new Error('FormulaEvaluator.compile is required to evaluate point pool formulas.');
        }
        if (typeof FormulaEvaluator.normalizeVariableKey !== 'function') {
            throw new Error('FormulaEvaluator.normalizeVariableKey is required to evaluate point pool formulas.');
        }

        const formulas = resolvePointPoolFormulas(config);
        const cacheKey = JSON.stringify(formulas);
        if (!Player.#pointPoolFormulaRuntime || Player.#pointPoolFormulaRuntime.cacheKey !== cacheKey) {
            Player.#pointPoolFormulaRuntime = {
                cacheKey,
                normalizeVariableKey: FormulaEvaluator.normalizeVariableKey,
                attributePoolEvaluator: FormulaEvaluator.compile(formulas.attribute),
                skillPoolEvaluator: FormulaEvaluator.compile(formulas.skill),
                maxAttributeEvaluator: FormulaEvaluator.compile(formulas.maxAttribute),
                maxSkillEvaluator: FormulaEvaluator.compile(formulas.maxSkill)
            };
        }
        return Player.#pointPoolFormulaRuntime;
    }

    #buildPointPoolVariables(levelOverride = null) {
        const runtime = Player.#getPointPoolFormulaRuntime();
        const levelValue = Number.isFinite(levelOverride) ? Number(levelOverride) : Number(this.#level);
        if (!Number.isFinite(levelValue)) {
            throw new Error('Character level must be a finite number for point pool evaluation.');
        }

        const attributeNames = [];
        const seenAttributeNames = new Set();
        const addAttributeName = (rawName) => {
            if (typeof rawName !== 'string') {
                return;
            }
            const trimmed = rawName.trim();
            if (!trimmed) {
                return;
            }
            const key = trimmed.toLowerCase();
            if (seenAttributeNames.has(key)) {
                return;
            }
            seenAttributeNames.add(key);
            attributeNames.push(trimmed);
        };
        for (const name of this.getAttributeNames()) {
            addAttributeName(name);
        }
        for (const name of Object.keys(this.#attributes || {})) {
            addAttributeName(name);
        }

        const attributeValues = {};
        const attributeModifiedValues = {};
        const seenAttributeKeys = new Set();
        for (const attrName of attributeNames) {
            const definition = this.getAttributeDefinition(attrName);
            const fallbackValue = Number.isFinite(definition?.default)
                ? Number(definition.default)
                : ATTRIBUTE_POOL_BASELINE_VALUE;
            const rawValue = this.getAttribute(attrName);
            const value = Number.isFinite(rawValue) ? Number(rawValue) : fallbackValue;
            const normalizedKey = runtime.normalizeVariableKey(attrName);
            if (seenAttributeKeys.has(normalizedKey)) {
                throw new Error(`Duplicate attribute variable key '${normalizedKey}'.`);
            }
            seenAttributeKeys.add(normalizedKey);
            attributeValues[normalizedKey] = {
                value,
                bonus: Math.floor((value - ATTRIBUTE_POOL_BASELINE_VALUE) / 2)
            };
            attributeModifiedValues[normalizedKey] = {
                value,
                bonus: Math.floor((value - ATTRIBUTE_POOL_BASELINE_VALUE) / 2)
            };
        }

        const skillNames = [];
        const seenSkillNames = new Set();
        const addSkillName = (rawName) => {
            if (typeof rawName !== 'string') {
                return;
            }
            const trimmed = rawName.trim();
            if (!trimmed) {
                return;
            }
            const key = trimmed.toLowerCase();
            if (seenSkillNames.has(key)) {
                return;
            }
            seenSkillNames.add(key);
            skillNames.push(trimmed);
        };
        if (Player.availableSkills instanceof Map && Player.availableSkills.size > 0) {
            for (const name of Player.availableSkills.keys()) {
                addSkillName(name);
            }
        }
        if (this.#skills instanceof Map && this.#skills.size > 0) {
            for (const name of this.#skills.keys()) {
                addSkillName(name);
            }
        }

        const skillValues = {};
        const seenSkillKeys = new Set();
        for (const skillName of skillNames) {
            const rawValue = this.getSkillValue(skillName);
            const value = Number.isFinite(rawValue) ? Number(rawValue) : SKILL_POOL_BASELINE_VALUE;
            const normalizedKey = runtime.normalizeVariableKey(skillName);
            if (seenSkillKeys.has(normalizedKey)) {
                throw new Error(`Duplicate skill variable key '${normalizedKey}'.`);
            }
            seenSkillKeys.add(normalizedKey);
            skillValues[normalizedKey] = value;
        }

        return {
            level: levelValue,
            number_of_attributes: Object.keys(attributeValues).length,
            number_of_skills: Object.keys(skillValues).length,
            attribute: attributeValues,
            attribute_modified: attributeModifiedValues,
            skill: skillValues
        };
    }

    #evaluatePointPoolState(levelOverride = null) {
        const runtime = Player.#getPointPoolFormulaRuntime();
        const variables = this.#buildPointPoolVariables(levelOverride);
        const attributePool = runtime.attributePoolEvaluator(variables);
        const skillPool = runtime.skillPoolEvaluator(variables);
        const maxAttribute = runtime.maxAttributeEvaluator(variables);
        const maxSkill = runtime.maxSkillEvaluator(variables);

        if (!Number.isFinite(attributePool)) {
            throw new Error('Attribute point pool formula must evaluate to a finite number.');
        }
        if (!Number.isFinite(skillPool)) {
            throw new Error('Skill point pool formula must evaluate to a finite number.');
        }
        if (!Number.isFinite(maxAttribute)) {
            throw new Error('Max attribute formula must evaluate to a finite number.');
        }
        if (!Number.isFinite(maxSkill)) {
            throw new Error('Max skill formula must evaluate to a finite number.');
        }

        let attributeRemaining = attributePool;
        for (const entry of Object.values(variables.attribute || {})) {
            const value = Number(entry?.value);
            if (!Number.isFinite(value)) {
                continue;
            }
            attributeRemaining += ATTRIBUTE_POOL_BASELINE_VALUE - value;
        }

        let skillSpent = 0;
        for (const value of Object.values(variables.skill || {})) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) {
                continue;
            }
            skillSpent += Math.max(0, numeric - SKILL_POOL_BASELINE_VALUE);
        }
        const skillRemaining = skillPool - skillSpent;

        return {
            attributeRemaining,
            skillRemaining
        };
    }

    #resolveThing(thingLike) {
        if (!thingLike) {
            return null;
        }
        if (thingLike instanceof Thing) {
            return thingLike;
        }
        if (typeof thingLike === 'string') {
            return Thing.getById(thingLike);
        }
        if (typeof thingLike === 'object' && thingLike.id) {
            const existing = Thing.getById(thingLike.id);
            if (existing) {
                return existing;
            }
        }
        return null;
    }

    #addInventoryThing(thingLike, { updateTimestamp = true, suppressNpcEquip = false, mergeStacks = true } = {}) {
        const resolved = this.#resolveThing(thingLike);
        if (!resolved) {
            return false;
        }

        const previousSize = this.#inventory.size;
        resolved.removeFromWorld();
        if (mergeStacks) {
            const mergedTarget = Thing.mergeIntoExistingStack(resolved, Array.from(this.#inventory));
            if (mergedTarget) {
                if (updateTimestamp) {
                    this.#lastUpdated = new Date().toISOString();
                }
                return true;
            }
        }

        this.#inventory.add(resolved);

        const added = this.#inventory.size !== previousSize;

        if (added) {
            const metadata = resolved.metadata || {};
            let metadataChanged = false;
            const ownerId = typeof this.#id === 'string' ? this.#id.trim() : null;
            if (ownerId && metadata.ownerId !== ownerId) {
                metadata.ownerId = ownerId;
                metadataChanged = true;
            }
            const cleanupKeys = ['ownerID', 'owner_id', 'inventoryOwnerId', 'barterOwnerId'];
            for (const key of cleanupKeys) {
                if (metadata[key] !== undefined) {
                    delete metadata[key];
                    metadataChanged = true;
                }
            }
            const containerKeys = ['containerId', 'containerID', 'container_id'];
            for (const key of containerKeys) {
                if (metadata[key] !== undefined) {
                    delete metadata[key];
                    metadataChanged = true;
                }
            }
            if (metadata.owner && typeof metadata.owner === 'object') {
                const ownerObj = metadata.owner;
                const ownerObjId = typeof ownerObj.id === 'string' ? ownerObj.id.trim() : null;
                if (ownerObjId !== ownerId || Object.keys(ownerObj).length !== 1) {
                    delete metadata.owner;
                    metadataChanged = true;
                }
            }
            if (ownerId && metadata.playerId !== ownerId) {
                metadata.playerId = ownerId;
                metadataChanged = true;
            }
            const locationKeys = ['locationId', 'locationID', 'location_id'];
            for (const key of locationKeys) {
                if (metadata[key] !== undefined) {
                    delete metadata[key];
                    metadataChanged = true;
                }
            }
            if (metadataChanged) {
                resolved.metadata = metadata;
            }
        }

        if (updateTimestamp && added) {
            this.#lastUpdated = new Date().toISOString();
        }

        if (added && !suppressNpcEquip) {
            this.#checkEquipment = true;
        }

        return true;
    }

    #removeInventoryThing(thingLike, { updateTimestamp = true, suppressNpcEquip = false } = {}) {
        const resolved = this.#resolveThing(thingLike);
        if (!resolved) {
            return false;
        }

        const removed = this.#inventory.delete(resolved);
        if (removed) {
            this.unequipItemId(resolved.id, { suppressTimestamp: true });
            this.#syncModStateWithInventory({
                action: 'remove',
                item: resolved,
                itemId: resolved.id
            });

            const metadata = resolved.metadata || {};
            let metadataChanged = false;
            const ownerId = typeof this.#id === 'string' ? this.#id.trim() : null;
            if (ownerId && metadata.ownerId === ownerId) {
                delete metadata.ownerId;
                metadataChanged = true;
            }
            if (ownerId && metadata.playerId === ownerId) {
                delete metadata.playerId;
                metadataChanged = true;
            }
            const cleanupKeys = ['ownerID', 'owner_id', 'inventoryOwnerId'];
            for (const key of cleanupKeys) {
                if (metadata[key] === undefined) {
                    continue;
                }
                const value = typeof metadata[key] === 'string' ? metadata[key].trim() : null;
                if (!ownerId || value === ownerId) {
                    delete metadata[key];
                    metadataChanged = true;
                }
            }
            if (metadata.owner && typeof metadata.owner === 'object') {
                const ownerObjId = typeof metadata.owner.id === 'string' ? metadata.owner.id.trim() : null;
                if (!ownerId || ownerObjId === ownerId) {
                    delete metadata.owner;
                    metadataChanged = true;
                }
            }
            if (metadataChanged) {
                resolved.metadata = metadata;
            }

            if (updateTimestamp) {
                this.#lastUpdated = new Date().toISOString();
            }
            if (!suppressNpcEquip) {
                this.#checkEquipment = true;
            }
        }
        return removed;
    }

    #addBarterInventoryThing(thingLike, { updateTimestamp = true } = {}) {
        const resolved = this.#resolveThing(thingLike);
        if (!resolved) {
            return false;
        }

        const previousSize = this.#barterInventory.size;
        resolved.removeFromWorld();
        this.#barterInventory.add(resolved);

        const added = this.#barterInventory.size !== previousSize;
        if (added) {
            const metadata = resolved.metadata || {};
            const ownerId = typeof this.#id === 'string' ? this.#id.trim() : null;
            let metadataChanged = false;
            if (ownerId && metadata.barterOwnerId !== ownerId) {
                metadata.barterOwnerId = ownerId;
                metadataChanged = true;
            }
            const cleanupKeys = [
                'owner',
                'ownerId',
                'ownerID',
                'owner_id',
                'playerId',
                'inventoryOwnerId',
                'locationId',
                'locationID',
                'location_id',
                'containerId',
                'containerID',
                'container_id'
            ];
            for (const key of cleanupKeys) {
                if (metadata[key] !== undefined) {
                    delete metadata[key];
                    metadataChanged = true;
                }
            }
            if (metadataChanged) {
                resolved.metadata = metadata;
            }
        }

        if (updateTimestamp && added) {
            this.#lastUpdated = new Date().toISOString();
        }

        return added;
    }

    #removeBarterInventoryThing(thingLike, { updateTimestamp = true } = {}) {
        const resolved = this.#resolveThing(thingLike);
        if (!resolved) {
            return false;
        }

        const removed = this.#barterInventory.delete(resolved);
        if (removed) {
            const metadata = resolved.metadata || {};
            const ownerId = typeof this.#id === 'string' ? this.#id.trim() : null;
            if (ownerId && metadata.barterOwnerId === ownerId) {
                delete metadata.barterOwnerId;
                resolved.metadata = metadata;
            }
            if (updateTimestamp) {
                this.#lastUpdated = new Date().toISOString();
            }
        }
        return removed;
    }

    #defaultHealthAttribute() {
        const availableNames = this.getAttributeNames();
        if (!Array.isArray(availableNames) || !availableNames.length) {
            return 'constitution';
        }

        const preferred = ['constitution', 'endurance', 'stamina', 'vitality'];
        for (const target of preferred) {
            const match = availableNames.find(name => typeof name === 'string' && name.toLowerCase() === target);
            if (match) {
                return match;
            }
        }

        return availableNames[0];
    }

    #resolveHealthAttribute(attributeName) {
        const availableNames = this.getAttributeNames();
        if (typeof attributeName === 'string' && attributeName.trim()) {
            const lookup = attributeName.trim().toLowerCase();
            for (const name of availableNames) {
                if (typeof name === 'string' && name.toLowerCase() === lookup) {
                    return name;
                }
            }
        }

        return this.#defaultHealthAttribute();
    }

    /**
     * Calculate base health using the configured health attribute and level (private method)
     */
    #calculateBaseHealth() {
        const attributeName = this.#healthAttribute || this.#defaultHealthAttribute();
        const attributeValue = this.getModifiedAttribute(attributeName);
        const baseAttribute = Number.isFinite(attributeValue)
            ? attributeValue
            : (Number.isFinite(this.#attributes[attributeName]) ? this.#attributes[attributeName] : 10);

        const level = Number.isFinite(this.#level) ? this.#level : 1;
        const computed = Math.floor(Globals.config.baseHealthPerLevel + (baseAttribute / 2) * (level + 1));
        const baseHealth = Math.max(1, computed);
        const activeEffects = [...this.getStatusEffects(), ...(this.location?.getStatusEffects?.() ?? [])];
        const percent = activeEffects.reduce((sum, effect) => sum + (effect.maxHealthPercent ?? 0), 0);
        const result = baseHealth * (1 + percent / 100);
        if (!Number.isFinite(result) || result <= 0) throw new Error(`Invalid maximum health for ${this.#name || 'character'}: ${result}.`);
        return result;
    }

    /**
     * Validate attribute value against definition (private method)
     */
    #validateAttributeValue(attributeName, value) {
        const definition = this.getAttributeDefinition(attributeName);
        if (!definition) {
            throw new Error(`Unknown attribute: ${attributeName}`);
        }

        if (typeof value !== 'number') {
            throw new Error(`Attribute value must be a number, got ${typeof value}`);
        }

        const config = this.systemConfig.validationRules ?? {};
        if (config.enforceMinMax) {
            const min = definition.min ?? 1;
            const max = definition.max ?? 20;

            if (value < min || value > max) {
                throw new Error(`${definition.label} must be between ${min} and ${max}, got ${value}`);
            }
        }

        return true;
    }

    getModifiedAttribute(attributeName) {
        // Return attribute plus values for equipped items
        const baseValue = this.#attributes[attributeName];
        if (baseValue === undefined) {
            return null;
        }

        const equippedItems = this.getInventoryItems().filter(item => item?.isEquipped);
        const equipmentBonus = equippedItems.reduce((total, item) => {
            if (!item) {
                return total;
            }
            if (typeof item.getAttributeBonus === 'function') {
                const itemBonus = item.getAttributeBonus(attributeName);
                return total + (itemBonus ?? 0);
            }
            if (item.attributeBonuses && typeof item.attributeBonuses === 'object') {
                const rawBonus = item.attributeBonuses[attributeName] ?? item.attributeBonuses[attributeName?.toLowerCase?.()];
                const numericBonus = Number(rawBonus);
                if (Number.isFinite(numericBonus)) {
                    return total + numericBonus;
                }
            }
            return total;
        }, 0);

        const normalizeAttributeName = (name) => (typeof name === 'string' ? name.trim().toLowerCase() : '');
        const targetAttr = normalizeAttributeName(attributeName);
        const collectStatusAttributeBonus = (effects) => {
            if (!Array.isArray(effects)) {
                return 0;
            }
            return effects.reduce((sum, effect) => {
                const attrs = Array.isArray(effect?.attributes) ? effect.attributes : [];
                for (const entry of attrs) {
                    const attrName = normalizeAttributeName(entry?.attribute || entry?.name);
                    if (!attrName || attrName !== targetAttr) {
                        continue;
                    }
                    const numeric = Number(entry?.modifier ?? entry?.bonus ?? entry?.value);
                    if (Number.isFinite(numeric)) {
                        sum += numeric;
                    }
                }
                return sum;
            }, 0);
        };

        const activeStatuses = this.getStatusEffects();
        const statusBonus = collectStatusAttributeBonus(activeStatuses);

        const location = this.location;
        const locationEffects = location && typeof location.getStatusEffects === 'function'
            ? location.getStatusEffects()
            : [];
        const locationBonus = collectStatusAttributeBonus(locationEffects);

        const modBonus = Globals.modExtensionRegistry
            && typeof Globals.modExtensionRegistry.collectAttributeModifierContributions === 'function'
            ? Globals.modExtensionRegistry.collectAttributeModifierContributions(this, attributeName)
            : 0;

        const flatTotal = baseValue + equipmentBonus + statusBonus + locationBonus + modBonus;
        const percentageEffects = [...activeStatuses, ...locationEffects];
        const percent = percentageEffects.reduce((sum, effect) => sum + (effect.attributes ?? []).reduce((effectSum, entry) => (
            normalizeAttributeName(entry?.attribute) === targetAttr ? effectSum + (entry.percentModifier ?? 0) : effectSum
        ), 0), 0);
        const result = flatTotal * (1 + percent / 100);
        if (!Number.isFinite(result)) throw new Error(`Invalid modified attribute ${attributeName} for ${this.#name || 'character'}.`);
        return result;
    }

    getAttributeBonus(attributeName) {
        if (this.getModifiedAttribute(attributeName) !== null) {
            return Math.floor(this.getModifiedAttribute(attributeName) / 2);
        }
        return null;
    }

    get location() {
        const Location = getLocationModule();
        return Location.get(this.#currentLocation) || null;
    }

    get currentVehicle() {
        const Location = getLocationModule();
        const Region = require('./Region.js');
        const currentLocation = Location.get(this.#currentLocation) || null;
        if (!currentLocation) {
            return null;
        }

        const currentRegion = currentLocation.region || null;
        const regionVehicleInfo = currentRegion?.isVehicle === true
            ? currentRegion.vehicleInfo
            : null;
        const locationVehicleInfo = currentLocation?.isVehicle === true
            ? currentLocation.vehicleInfo
            : null;
        const activeVehicleInfo = regionVehicleInfo || locationVehicleInfo || null;
        if (!activeVehicleInfo || typeof activeVehicleInfo !== 'object' || Array.isArray(activeVehicleInfo)) {
            return null;
        }

        const normalizedVehicleInfo = new VehicleInfo(activeVehicleInfo);

        const resolveLocationNameById = (locationId) => {
            if (typeof locationId !== 'string') {
                return null;
            }
            const trimmedId = locationId.trim();
            if (!trimmedId) {
                return null;
            }

            const resolvedLocation = Location.get(trimmedId) || null;
            if (!resolvedLocation) {
                return trimmedId;
            }

            const resolvedName = typeof resolvedLocation.name === 'string'
                ? resolvedLocation.name.trim()
                : '';
            return resolvedName || trimmedId;
        };

        const resolveRegionNameById = (regionId) => {
            if (typeof regionId !== 'string') {
                return null;
            }
            const trimmedId = regionId.trim();
            if (!trimmedId) {
                return null;
            }

            const resolvedRegion = typeof Region.get === 'function'
                ? Region.get(trimmedId) || null
                : null;
            if (!resolvedRegion) {
                return trimmedId;
            }

            const resolvedName = typeof resolvedRegion.name === 'string'
                ? resolvedRegion.name.trim()
                : '';
            return resolvedName || trimmedId;
        };

        const normalizedPendingDestination = normalizedVehicleInfo.pendingDestination;
        const pendingDestination = normalizedPendingDestination
            ? {
                ...normalizedPendingDestination
            }
            : null;
        const resolvePendingDestinationLabel = (pendingDestinationInfo) => {
            if (!pendingDestinationInfo || typeof pendingDestinationInfo !== 'object') {
                return '';
            }

            const locationName = typeof pendingDestinationInfo.locationName === 'string'
                ? pendingDestinationInfo.locationName.trim()
                : '';
            if (locationName) {
                return locationName;
            }

            const regionName = typeof pendingDestinationInfo.regionName === 'string'
                ? pendingDestinationInfo.regionName.trim()
                : '';
            if (regionName) {
                return regionName;
            }

            const resolvedLocationName = resolveLocationNameById(pendingDestinationInfo.locationId);
            if (resolvedLocationName) {
                return resolvedLocationName;
            }

            const resolvedRegionName = resolveRegionNameById(pendingDestinationInfo.regionId);
            if (resolvedRegionName) {
                return resolvedRegionName;
            }

            const rawText = typeof pendingDestinationInfo.rawText === 'string'
                ? pendingDestinationInfo.rawText.trim()
                : '';
            return rawText;
        };

        const resolveVehicleLocationLabel = (vehicleInfo) => {
            const vehicleExitId = typeof vehicleInfo?.vehicleExitId === 'string'
                ? vehicleInfo.vehicleExitId.trim()
                : '';
            if (!vehicleExitId) {
                return null;
            }

            const allLocations = typeof Location.getAll === 'function'
                ? Location.getAll()
                : [];
            for (const sourceLocation of allLocations) {
                if (!sourceLocation
                    || typeof sourceLocation.getAvailableDirections !== 'function'
                    || typeof sourceLocation.getExit !== 'function') {
                    continue;
                }

                const directions = sourceLocation.getAvailableDirections();
                for (const direction of directions) {
                    const exit = sourceLocation.getExit(direction);
                    if (!exit || exit.id !== vehicleExitId) {
                        continue;
                    }

                    const outsideLocation = exit.location || null;
                    const outsideLocationName = typeof outsideLocation?.name === 'string'
                        ? outsideLocation.name.trim()
                        : '';
                    const outsideRegionName = typeof outsideLocation?.region?.name === 'string'
                        ? outsideLocation.region.name.trim()
                        : '';
                    if (!outsideRegionName || !outsideLocationName) {
                        return null;
                    }
                    return `${outsideRegionName}:${outsideLocationName}`;
                }
            }

            return null;
        };

        const destinationId = typeof activeVehicleInfo.currentDestination === 'string'
            ? activeVehicleInfo.currentDestination.trim()
            : '';
        const destinationResolved = Boolean(destinationId);
        const destination = destinationResolved
            ? (resolveLocationNameById(destinationId) || '')
            : resolvePendingDestinationLabel(pendingDestination);
        const allowedDestinations = normalizedVehicleInfo.destinations.map((routeEntry, index) => {
            const pendingRegionRoute = VehicleInfo.parsePendingRegionRouteEntry(routeEntry);
            if (pendingRegionRoute) {
                return {
                    kind: 'region',
                    routeEntry: pendingRegionRoute.entry,
                    locationId: null,
                    locationName: null,
                    regionId: null,
                    regionName: pendingRegionRoute.regionName
                };
            }

            const routeLocation = Location.get(routeEntry) || null;
            if (!routeLocation) {
                throw new Error(
                    `Current vehicle route destination ${index + 1} references missing location id "${routeEntry}".`
                );
            }
            const routeLocationName = typeof routeLocation.name === 'string'
                ? routeLocation.name.trim()
                : '';
            if (!routeLocationName) {
                throw new Error(`Current vehicle route destination "${routeEntry}" is missing a location name.`);
            }
            const routeRegion = routeLocation.region
                || (typeof routeLocation.regionId === 'string' && routeLocation.regionId.trim()
                    ? Region.get(routeLocation.regionId.trim())
                    : null);
            const routeRegionName = typeof routeRegion?.name === 'string'
                ? routeRegion.name.trim()
                : '';
            return {
                kind: 'location',
                routeEntry,
                locationId: routeEntry,
                locationName: routeLocationName,
                regionId: typeof routeRegion?.id === 'string' && routeRegion.id.trim()
                    ? routeRegion.id.trim()
                    : null,
                regionName: routeRegionName || null
            };
        });

        const etaMinutes = normalizedVehicleInfo.ETA;
        const elapsedMinutes = Number(Globals.elapsedTime);
        const hasEtaMinutes = typeof etaMinutes === 'number'
            && Number.isFinite(etaMinutes)
            && Number.isInteger(etaMinutes);
        const hasElapsedMinutes = Number.isFinite(elapsedMinutes) && Number.isInteger(elapsedMinutes);
        const rawTimeToDestination = hasEtaMinutes && hasElapsedMinutes
            ? etaMinutes - elapsedMinutes
            : null;
        const isUnderway = normalizedVehicleInfo.isUnderway;
        const hasArrived = normalizedVehicleInfo.hasArrived;
        const isArriving = normalizedVehicleInfo.isArriving;
        const timeToDestination = rawTimeToDestination === null
            ? null
            : Utils.formatMinutesAsDuration(rawTimeToDestination, { includeAgo: true });
        const vehicleInfo = {
            ...activeVehicleInfo
        };
        if (Array.isArray(activeVehicleInfo.destinations)) {
            vehicleInfo.destinations = [...activeVehicleInfo.destinations];
        }
        vehicleInfo.pendingDestination = pendingDestination ? { ...pendingDestination } : null;
        vehicleInfo.isUnderway = isUnderway;
        vehicleInfo.hasArrived = hasArrived;
        vehicleInfo.isArriving = isArriving;
        vehicleInfo.destinationResolved = destinationResolved;

        return {
            vehicleKind: regionVehicleInfo ? 'region' : 'location',
            name: regionVehicleInfo
                ? (typeof currentRegion?.name === 'string' ? currentRegion.name.trim() : '')
                : (typeof currentLocation?.name === 'string' ? currentLocation.name.trim() : ''),
            description: regionVehicleInfo
                ? (typeof currentRegion?.description === 'string' ? currentRegion.description.trim() : '')
                : (typeof currentLocation?.description === 'string' ? currentLocation.description.trim() : ''),
            location: resolveVehicleLocationLabel(activeVehicleInfo) || '',
            vehicleInfo,
            allowedDestinations,
            destination,
            destinationResolved,
            pendingDestination: pendingDestination ? { ...pendingDestination } : null,
            minutesToDestination: rawTimeToDestination,
            isUnderway,
            hasArrived,
            isArriving,
            timeToDestination
        };
    }

    get previousLocationId() {
        return this.#previousLocationId;
    }

    get previousLocation() {
        const Location = getLocationModule();
        return Location.get(this.#previousLocationId) || null;
    }

    get goals() {
        return this.#goals.slice();
    }

    get characterArc() {
        return { ...this.#characterArc };
    }

    setShortTermCharacterArc(arc) {
        if (typeof arc !== 'string') {
            return false;
        }
        const trimmed = arc.trim();
        if (this.#characterArc.shortTerm === trimmed) {
            return false;
        }
        this.#characterArc.shortTerm = trimmed;
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    setLongTermCharacterArc(arc) {
        if (typeof arc !== 'string') {
            return false;
        }
        const trimmed = arc.trim();
        if (this.#characterArc.longTerm === trimmed) {
            return false;
        }
        this.#characterArc.longTerm = trimmed;
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    addGoal(goal) {
        if (typeof goal !== 'string' || !goal.trim()) {
            return false;
        }
        const trimmed = goal.trim();
        if (this.#goals.includes(trimmed)) {
            return false;
        }
        this.#goals.push(trimmed);
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    addQuest(quest) {
        this.#quests.push(quest);
        this.#lastUpdated = new Date().toISOString();
    }

    removeQuest(questId) {
        const index = this.#quests.findIndex(q => q.id === questId);
        if (index === -1) {
            return false;
        }
        this.#quests.splice(index, 1);
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

  getQuestByName(questName) {
    return this.#quests.find(q => q.name === questName) || null;
  }

  getQuestByIndex(index) {
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.#quests.length) {
      return null;
    }
    return this.#quests[idx] || null;
  }

    getQuestById(questId) {
        return this.#quests.find(q => q.id === questId) || null;
    }

    getCurrentQuests() {
        return this.#quests.filter(q => !q.completed);
    }

    get currentQuests() {
        return this.getCurrentQuests();
    }

    get completedQuests() {
        return this.getCompletedQuests();
    }

    getCompletedQuests() {
        return this.#quests.filter(q => q.completed);
    }

    removeGoal(goal) {
        if (typeof goal !== 'string' || !goal.trim()) {
            return false;
        }
        const trimmed = goal.trim();
        const index = this.#goals.indexOf(trimmed);
        if (index === -1) {
            return false;
        }
        this.#goals.splice(index, 1);
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    updatePreviousLocation() {
        this.#previousLocationId = this.#currentLocation;
        this.#lastUpdated = new Date().toISOString();
    }

    get last_seen_time() {
        return this.#lastSeenTime;
    }

    get lastSeenTime() {
        return this.#lastSeenTime;
    }

    set last_seen_time(value) {
        this.#lastSeenTime = Player.#normalizeLastSeenTime(value);
        this.#lastUpdated = new Date().toISOString();
    }

    set lastSeenTime(value) {
        this.last_seen_time = value;
    }

    get last_seen_location() {
        return this.#lastSeenLocation;
    }

    get lastSeenLocation() {
        return this.#lastSeenLocation;
    }

    set last_seen_location(value) {
        this.#lastSeenLocation = Player.#normalizeLastSeenLocation(value);
        this.#lastUpdated = new Date().toISOString();
    }

    set lastSeenLocation(value) {
        this.last_seen_location = value;
    }

    get was_in_player_location_previous_round() {
        return this.#wasInPlayerLocationPreviousRound;
    }

    get wasInPlayerLocationPreviousRound() {
        return this.#wasInPlayerLocationPreviousRound;
    }

    set was_in_player_location_previous_round(value) {
        this.#wasInPlayerLocationPreviousRound = Boolean(value);
        this.#lastUpdated = new Date().toISOString();
    }

    set wasInPlayerLocationPreviousRound(value) {
        this.was_in_player_location_previous_round = value;
    }

    get hiddenFromPlayer() {
        return Boolean(this.#hiddenFromPlayer);
    }

    set hiddenFromPlayer(value) {
        const next = Boolean(value) && this.#isNPC && !this.#isDead;
        if (this.#hiddenFromPlayer === next) {
            return;
        }
        this.#hiddenFromPlayer = next;
        this.#lastUpdated = new Date().toISOString();
    }

    get isHiddenFromPlayer() {
        return this.hiddenFromPlayer;
    }

    recordLastSeenByPlayer({ time, locationId, wasInPlayerLocationPreviousRound = true } = {}) {
        const normalizedTime = Player.#normalizeLastSeenTime(time);
        if (normalizedTime === null) {
            throw new Error('recordLastSeenByPlayer requires a last_seen_time value.');
        }
        const normalizedLocation = Player.#normalizeLastSeenLocation(locationId);
        if (!normalizedLocation) {
            throw new Error('recordLastSeenByPlayer requires a last_seen_location value.');
        }
        const normalizedPreviousRound = Boolean(wasInPlayerLocationPreviousRound);
        const changed = this.#lastSeenTime !== normalizedTime
            || this.#lastSeenLocation !== normalizedLocation
            || this.#wasInPlayerLocationPreviousRound !== normalizedPreviousRound;
        this.#lastSeenTime = normalizedTime;
        this.#lastSeenLocation = normalizedLocation;
        this.#wasInPlayerLocationPreviousRound = normalizedPreviousRound;
        if (changed) {
            this.#lastUpdated = new Date().toISOString();
        }
        return changed;
    }

    get gender() {
        return this.#gender;
    }

    set gender(value) {
        // Make sure it's a string
        if (typeof value !== 'string') {
            throw new Error('Gender must be a string');
        }
        this.#gender = value.toLowerCase().trim();
    }

    get lastActionWasTravel() {
        return Boolean(this.#lastActionWasTravel);
    }

    set lastOutcomeSucceeded(value) {
        console.log(`✅ Player ${this.#name || this.#id || 'unknown'} lastOutcomeSucceeded set to ${value}`);
        this.#lastOutcomeSucceeded = Boolean(value);
    }

    get lastOutcomeSucceeded() {
        return Boolean(this.#lastOutcomeSucceeded);
    }

    set lastActionWasTravel(value) {
        const normalized = Boolean(value);
        const previous = this.#lastActionWasTravel;
        if (previous !== normalized) {
            const locationLabel = (() => {
                try {
                    return this.location?.name || this.#currentLocation || 'unknown location';
                } catch (_) {
                    return this.#currentLocation || 'unknown location';
                }
            })();
            console.log(`🏃 Player ${this.#name || this.#id || 'unknown'} lastActionWasTravel set to ${normalized ? 'true' : 'false'} (location: ${locationLabel})`);
        }
        this.#lastActionWasTravel = normalized;
        if (normalized) {
            this.#consecutiveTravelActions = previous ? this.#consecutiveTravelActions + 1 : 1;
        } else {
            this.#consecutiveTravelActions = 0;
        }
    }

    get consecutiveTravelActions() {
        return this.#consecutiveTravelActions;
    }

    static updatePreviousLocationsForAll() {
        for (const player of Player.#instances) {
            if (player instanceof Player) {
                player.updatePreviousLocation();
            }
        }
    }

    static getNpcIdsSharingPlayerLocation({ player = Globals.currentPlayer, locationId = null } = {}) {
        if (!(player instanceof Player)) {
            return [];
        }

        const playerLocationId = Player.#normalizeLastSeenLocation(locationId ?? player.currentLocation);
        if (!playerLocationId) {
            return [];
        }

        const partyMemberIds = typeof player.getPartyMembers === 'function'
            ? player.getPartyMembers()
            : [];
        const partyMemberIdSet = new Set(
            (Array.isArray(partyMemberIds) ? partyMemberIds : [])
                .map(id => (typeof id === 'string' ? id.trim() : ''))
                .filter(Boolean)
        );

        const sharingIds = [];
        for (const npc of Player.#instances) {
            if (!(npc instanceof Player) || !npc.isNPC || npc.id === player.id) {
                continue;
            }

            const npcLocationId = Player.#normalizeLastSeenLocation(npc.currentLocation);
            const sharesPlayerLocation = partyMemberIdSet.has(npc.id)
                || (npcLocationId !== null && npcLocationId === playerLocationId);

            if (sharesPlayerLocation) {
                sharingIds.push(npc.id);
            }
        }

        return sharingIds;
    }

    static recordNpcSightingsForCurrentPlayer({
        player = Globals.currentPlayer,
        worldTimeMinutes = null,
        locationId = null,
        previouslySharedNpcIds = null
    } = {}) {
        if (!(player instanceof Player)) {
            return [];
        }

        const playerLocationId = Player.#normalizeLastSeenLocation(locationId ?? player.currentLocation);
        if (!playerLocationId) {
            return [];
        }

        const timestamp = Player.#normalizeLastSeenTime(
            worldTimeMinutes ?? (typeof Globals.getTotalWorldMinutes === 'function'
                ? Globals.getTotalWorldMinutes()
                : null)
        );
        if (timestamp === null) {
            throw new Error('Unable to record NPC sightings without a valid world-time minute timestamp.');
        }

        const previousSharedNpcIdSet = previouslySharedNpcIds == null
            ? null
            : new Set(
                (Array.isArray(previouslySharedNpcIds) ? previouslySharedNpcIds : Array.from(previouslySharedNpcIds))
                    .map(id => (typeof id === 'string' ? id.trim() : ''))
                    .filter(Boolean)
            );

        const currentSharedNpcIds = new Set(Player.getNpcIdsSharingPlayerLocation({ player, locationId: playerLocationId }));
        const updated = [];
        for (const npc of Player.#instances) {
            if (!(npc instanceof Player) || !npc.isNPC || npc.id === player.id) {
                continue;
            }

            const sharesPlayerLocation = currentSharedNpcIds.has(npc.id);
            const sharedAtTurnStart = previousSharedNpcIdSet
                ? previousSharedNpcIdSet.has(npc.id)
                : sharesPlayerLocation;
            const sharedContinuouslyFromPreviousRound = sharesPlayerLocation && sharedAtTurnStart;

            if (npc.#wasInPlayerLocationPreviousRound !== sharedContinuouslyFromPreviousRound) {
                npc.#wasInPlayerLocationPreviousRound = sharedContinuouslyFromPreviousRound;
                npc.#lastUpdated = new Date().toISOString();
            }

            if (!sharesPlayerLocation) {
                continue;
            }
            if (npc.hiddenFromPlayer && !npc.isDead) {
                continue;
            }

            npc.recordLastSeenByPlayer({
                time: timestamp,
                locationId: playerLocationId,
                wasInPlayerLocationPreviousRound: sharedContinuouslyFromPreviousRound
            });
            updated.push(npc);
        }

        return updated;
    }

    // Public getters for private fields
    get attributeDefinitions() {
        return this.#definitions.attributes ?? {};
    }

    get systemConfig() {
        return this.#definitions.system ?? {};
    }

    get attributes() {
        return { ...this.#attributes }; // Return copy to prevent mutation
    }

    get level() {
        return this.#level;
    }

    get experience() {
        return this.#experience;
    }

    static setExperienceRolloverMultiplier(value) {
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            throw new Error('Experience rollover multiplier must be a number between 0 and 1');
        }
        Player.#experienceRolloverMultiplier = value;
    }

    static get experienceRolloverMultiplier() {
        return Player.#experienceRolloverMultiplier;
    }

    get isDead() {
        return this.#isDead;
    }

    get isDisabled() {
        return this.#isDead || (this.#health <= 0) || this.#hasStatusEffect('Incapacitated');
    }

    get inCombat() {
        return this.#inCombat;
    }

    set inCombat(value) {
        this.#inCombat = Boolean(value);
        this.#lastUpdated = new Date().toISOString();
    }

    set isDead(value) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => { this.isDead = value; });
        const next = Boolean(value);
        const wasDead = this.#isDead;
        if (this.#isDead === next) {
            return;
        }
        this.#isDead = next;
        if (next) {
            this.#hiddenFromPlayer = false;
            if (this.isInPlayerParty) {
                this.#persistWhenDead = true;
            }
            this.#health = 0;
            if (this.#persistWhenDead) {
                this.#corpseCountdown = null;
            } else if (!Number.isFinite(this.#corpseCountdown) || this.#corpseCountdown <= 0) {
                this.corpseCountdown = 5; // Set default countdown to 5 turns
            }
            try {
                this.dropAllInventoryItems();
            } catch (error) {
                console.warn(`Failed to drop inventory for deceased actor ${this.#id || this.#name || '<unknown>'}:`, error?.message || error);
                console.trace(error);
            }
        } else {
            this.corpseCountdown = null;
            if (this.#health <= 0 && wasDead) {
                this.#health = 1;
            }
        }
        this.#lastUpdated = new Date().toISOString();
    }

    get health() {
        return this.#health;
    }

    get maxHealth() {
        return this.#calculateBaseHealth();
    }

    get healthAttribute() {
        return this.#healthAttribute;
    }

    get name() {
        return this.#name;
    }

    get aliases() {
        return new Set(this.#aliases);
    }

    getAliases() {
        return Array.from(this.#aliases);
    }

    setAliases(aliases) {
        this.#aliases = Player.#normalizeAliasSet(aliases, this.#name);
        this.#lastUpdated = new Date().toISOString();
        return this.getAliases();
    }

    addAlias(alias) {
        const normalized = Player.#normalizeAliasSet([alias], this.#name);
        if (!normalized.size) {
            return false;
        }
        const value = normalized.values().next().value;
        if (!value || this.#aliases.has(value)) {
            return false;
        }
        this.#aliases.add(value);
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    removeAlias(alias) {
        if (typeof alias !== 'string') {
            return false;
        }
        const trimmed = alias.trim();
        if (!trimmed) {
            return false;
        }
        const removed = this.#aliases.delete(trimmed);
        if (removed) {
            this.#lastUpdated = new Date().toISOString();
        }
        return removed;
    }

    get description() {
        return this.#description;
    }

    get shortDescription() {
        return this.#shortDescription;
    }

    get class() {
        return this.#class;
    }

    get race() {
        return this.#race;
    }

    get factionId() {
        return this.#factionId;
    }

    set factionId(value) {
        this.#factionId = Player.#normalizeFactionId(value);
        this.#lastUpdated = new Date().toISOString();
    }

    getFactionStandings() {
        return Object.fromEntries(this.#factionStandings);
    }

    get relationships() {
        return this.getRelationships();
    }

    getRelationships() {
        return Object.fromEntries(this.#relationships);
    }

    setRelationships(relationships) {
        this.#relationships = Player.#normalizeRelationships(relationships, { ownerId: this.#id });
        this.#lastUpdated = new Date().toISOString();
        return this.getRelationships();
    }

    getRelationship(targetId) {
        const resolvedId = Player.resolvePlayerId(targetId);
        if (!resolvedId) {
            return null;
        }
        return this.#relationships.get(resolvedId) ?? null;
    }

    setRelationship(targetId, label) {
        const resolvedId = Player.resolvePlayerId(targetId);
        if (!resolvedId) {
            throw new Error('Relationship target id is required.');
        }
        if (resolvedId === this.#id) {
            throw new Error('Relationships cannot target the owning character.');
        }
        const normalizedLabel = Player.#normalizeRelationshipLabel(label, resolvedId);
        this.#relationships.set(resolvedId, normalizedLabel);
        this.#lastUpdated = new Date().toISOString();
        return normalizedLabel;
    }

    removeRelationship(targetId) {
        const resolvedId = Player.resolvePlayerId(targetId);
        if (!resolvedId) {
            return false;
        }
        const removed = this.#relationships.delete(resolvedId);
        if (removed) {
            this.#lastUpdated = new Date().toISOString();
        }
        return removed;
    }

    get thingListViewPreferences() {
        return this.getThingListViewPreferences();
    }

    getThingListViewPreferences() {
        return { ...this.#thingListViewPreferences };
    }

    setThingListViewPreferences(preferences = {}) {
        this.#thingListViewPreferences = Player.#normalizeThingListViewPreferences(preferences, {
            onInvalid: 'throw',
            context: 'thingListViewPreferences'
        });
        this.#lastUpdated = new Date().toISOString();
        return this.getThingListViewPreferences();
    }

    setThingListViewPreference(panelKey, viewMode) {
        const normalizedPanelKey = Player.#normalizeThingListViewPanelKey(panelKey);
        if (!normalizedPanelKey) {
            throw new Error(`Unsupported thing-list view panel key '${panelKey}'.`);
        }
        const normalizedViewMode = Player.#normalizeThingListViewMode(viewMode);
        if (!normalizedViewMode) {
            throw new Error(`Unsupported thing-list view mode '${viewMode}'.`);
        }
        this.#thingListViewPreferences = {
            ...this.#thingListViewPreferences,
            [normalizedPanelKey]: normalizedViewMode
        };
        this.#lastUpdated = new Date().toISOString();
        return normalizedViewMode;
    }

    get modState() {
        return Player.#cloneJsonObject(this.#modState, 'modState');
    }

    set modState(value) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => { this.modState = value; });
        this.#modState = Player.#normalizeModState(value);
        this.#lastUpdated = new Date().toISOString();
    }

    getModState(namespace) {
        const normalizedNamespace = typeof namespace === 'string' ? namespace.trim() : '';
        if (!normalizedNamespace) {
            throw new Error('Mod state namespace is required.');
        }
        const state = this.#modState[normalizedNamespace];
        return state ? Player.#cloneJsonObject(state, `modState.${normalizedNamespace}`) : {};
    }

    setModState(namespace, value, { suppressTimestamp = false } = {}) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.setModState(namespace, value, { suppressTimestamp }));
        const normalizedNamespace = typeof namespace === 'string' ? namespace.trim() : '';
        if (!normalizedNamespace) {
            throw new Error('Mod state namespace is required.');
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`modState.${normalizedNamespace} must be an object.`);
        }
        this.#modState = {
            ...this.#modState,
            [normalizedNamespace]: Player.#cloneJsonObject(value, `modState.${normalizedNamespace}`)
        };
        if (!suppressTimestamp) {
            this.#lastUpdated = new Date().toISOString();
        }
        return this.getModState(normalizedNamespace);
    }

    updateModState(namespace, updater, options = {}) {
        if (typeof updater !== 'function') {
            throw new Error('updateModState requires an updater function.');
        }
        const current = this.getModState(namespace);
        const result = updater(current);
        const nextState = result === undefined ? current : result;
        return this.setModState(namespace, nextState, options);
    }

    getExtensionField(fieldName) {
        return playerExtensionFields.getField(this.#extensionFields, fieldName);
    }

    setExtensionField(fieldName, value) {
        const field = playerExtensionFields.getRequiredField(fieldName);
        this.#setExtensionFieldValue(field, value, { updateTimestamp: true });
    }

    getExtensionFields({ includeDefaults = false } = {}) {
        return playerExtensionFields.getFields(this.#extensionFields, { includeDefaults });
    }

    #installExtensionFieldAccessors() {
        playerExtensionFields.installAccessors(this);
    }

    #setExtensionFieldValue(field, value, { updateTimestamp = false } = {}) {
        playerExtensionFields.setFieldValue(this, this.#extensionFields, field, value);
        if (updateTimestamp) {
            this.#lastUpdated = new Date().toISOString();
        }
    }

    #applyExtensionFieldInputs(inputs = {}) {
        playerExtensionFields.applyInputs(this, this.#extensionFields, inputs);
    }

    withHealthRatioPreserved(mutator, { suppressTimestamp = false } = {}) {
        return this.withNeedBarMutation(mutator);
    }

    setFactionStandings(standings) {
        this.#factionStandings = Player.#normalizeFactionStandings(standings);
        this.#lastUpdated = new Date().toISOString();
    }

    getFactionStanding(factionId) {
        if (typeof factionId !== 'string') {
            return null;
        }
        const trimmed = factionId.trim();
        if (!trimmed) {
            return null;
        }
        const value = this.#factionStandings.get(trimmed);
        return Number.isFinite(value) ? value : null;
    }

    setFactionStanding(factionId, value) {
        if (typeof factionId !== 'string') {
            throw new Error('Faction standing requires a string factionId.');
        }
        const trimmed = factionId.trim();
        if (!trimmed) {
            throw new Error('Faction standing requires a non-empty factionId.');
        }
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            throw new Error('Faction standing value must be a finite number.');
        }
        this.#factionStandings.set(trimmed, numericValue);
        this.#lastUpdated = new Date().toISOString();
    }

    getFavorUsageMap() {
        return Object.fromEntries(Array.from(this.#favorUsage.entries()).map(([id, usage]) => [id, { ...usage }]));
    }

    getFavorUsage(favorId) {
        if (typeof favorId !== 'string' || !favorId.trim()) {
            return null;
        }
        const usage = this.#favorUsage.get(favorId.trim());
        return usage ? { ...usage } : null;
    }

    recordFavorUse(favorId, worldMinute) {
        if (typeof favorId !== 'string' || !favorId.trim()) {
            throw new Error('recordFavorUse requires a non-empty favor id.');
        }
        const minute = Number(worldMinute);
        if (!Number.isSafeInteger(minute) || minute < 0) {
            throw new Error('recordFavorUse requires a non-negative whole world minute.');
        }
        this.#favorUsage.set(favorId.trim(), { lastUsedWorldMinute: minute });
        this.#lastUpdated = new Date().toISOString();
    }

    removeFavorUsage(favorId) {
        if (typeof favorId !== 'string' || !favorId.trim()) {
            return false;
        }
        const removed = this.#favorUsage.delete(favorId.trim());
        if (removed) {
            this.#lastUpdated = new Date().toISOString();
        }
        return removed;
    }

    removeFactionStanding(factionId) {
        if (typeof factionId !== 'string') {
            return false;
        }
        const trimmed = factionId.trim();
        if (!trimmed) {
            return false;
        }
        const removed = this.#factionStandings.delete(trimmed);
        if (removed) {
            this.#lastUpdated = new Date().toISOString();
        }
        return removed;
    }

    get isHostile() {
        return Boolean(this.#isHostile);
    }

    set isHostile(value) {
        const next = Boolean(value) && this.#isNPC;
        if (this.#isHostile === next) {
            return;
        }
        this.#isHostile = next;
        if (next) {
            this.#applyHostileDispositionsToCurrentPlayer();
        }
        this.#lastUpdated = new Date().toISOString();
    }

    get turnsSincePartyMemoryGeneration() {
        return this.#turnsSincePartyMemoryGeneration;
    }

    incrementTurnsSincePartyMemoryGeneration() {
        this.#turnsSincePartyMemoryGeneration += 1;
        this.#lastUpdated = new Date().toISOString();
    }

    resetTurnsSincePartyMemoryGeneration() {
        if (this.#turnsSincePartyMemoryGeneration !== 0) {
            this.#turnsSincePartyMemoryGeneration = 0;
            this.#lastUpdated = new Date().toISOString();
        }
    }

    get importantMemories() {
        return Array.from(this.#importantMemories);
    }

    set importantMemories(memories) {
        if (!Array.isArray(memories)) {
            throw new Error('Important memories must be an array of strings');
        }
        const cleaned = memories
            .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
            .filter(Boolean);
        this.#importantMemories = Array.from(new Set(cleaned)); // Remove duplicates
        this.#lastUpdated = new Date().toISOString();
    }

    addImportantMemory(memory) {
        if (typeof memory !== 'string' || !memory.trim()) {
            return false;
        }

        // Don't add duplicates
        const trimmed = memory.trim();
        if (this.#importantMemories.includes(trimmed)) {
            return false;
        }
        this.#importantMemories.push(trimmed);
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    get corpseCountdown() {
        return this.#corpseCountdown;
    }

    set corpseCountdown(value) {
        if (value === null || value === undefined) {
            if (this.#corpseCountdown !== null) {
                this.#corpseCountdown = null;
                this.#lastUpdated = new Date().toISOString();
            }
            return;
        }
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue < 0) {
            throw new Error('Corpse countdown must be a non-negative number or null');
        }
        const rounded = Math.floor(numericValue);
        if (this.#corpseCountdown !== rounded) {
            this.#corpseCountdown = rounded;
            this.#lastUpdated = new Date().toISOString();
        }
    }

    get persistWhenDead() {
        return Boolean(this.#persistWhenDead);
    }

    set persistWhenDead(value) {
        const next = Boolean(value);
        if (this.#persistWhenDead === next) {
            return;
        }
        this.#persistWhenDead = next;
        if (next) {
            this.#corpseCountdown = null;
        } else if (this.#isDead && (!Number.isFinite(this.#corpseCountdown) || this.#corpseCountdown < 0)) {
            this.#corpseCountdown = 5;
        }
        this.#lastUpdated = new Date().toISOString();
    }

    get personalityType() {
        return this.#personalityType;
    }

    set personalityType(value) {
        this.#personalityType = Player.#sanitizePersonalityValue(value);
        this.#lastUpdated = new Date().toISOString();
    }

    get personalityTraits() {
        return this.#personalityTraits;
    }

    set personalityTraits(value) {
        this.#personalityTraits = Player.#sanitizePersonalityValue(value);
        this.#lastUpdated = new Date().toISOString();
    }

    get personalityNotes() {
        return this.#personalityNotes;
    }

    set personalityNotes(value) {
        this.#personalityNotes = Player.#sanitizePersonalityValue(value);
        this.#lastUpdated = new Date().toISOString();
    }

    get aiNotes() {
        return this.#aiNotes;
    }

    set aiNotes(value) {
        this.#aiNotes = Player.#sanitizePersonalityValue(value);
        this.#lastUpdated = new Date().toISOString();
    }

    get disposition() {
        return this.#disposition;
    }

    static #normalizeHostileArrivalProvenance(value) {
        if (value === null || value === undefined) return null;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError('hostileArrivalProvenance must be an object or null.');
        }
        const arrivalId = typeof value.arrivalId === 'string' ? value.arrivalId.trim() : '';
        const pendingAttemptId = typeof value.pendingAttemptId === 'string' ? value.pendingAttemptId.trim() : '';
        const source = typeof value.source === 'string' ? value.source.trim().toLowerCase() : '';
        if (!arrivalId || !pendingAttemptId || !['wild', 'faction'].includes(source)) {
            throw new Error('hostileArrivalProvenance requires arrivalId, pendingAttemptId, and a wild or faction source.');
        }
        return Object.freeze({ arrivalId, pendingAttemptId, source });
    }

    get hostileArrivalProvenance() {
        return this.#hostileArrivalProvenance ? { ...this.#hostileArrivalProvenance } : null;
    }

    set hostileArrivalProvenance(value) {
        this.#hostileArrivalProvenance = Player.#normalizeHostileArrivalProvenance(value);
        this.#lastUpdated = new Date().toISOString();
    }

    set disposition(value) {
        this.#disposition = Player.normalizeNpcDisposition(value);
        this.#lastUpdated = new Date().toISOString();
    }

    get playerGuidance() {
        return this.#playerGuidance;
    }

    set playerGuidance(value) {
        this.setPlayerGuidance(value);
    }

    getPlayerGuidance() {
        return this.#playerGuidance;
    }

    setPlayerGuidance(value) {
        this.#playerGuidance = Player.normalizePlayerGuidance(value);
        this.#lastUpdated = new Date().toISOString();
        return this.#playerGuidance;
    }

    get resistances() {
        return this.#resistances;
    }

    set resistances(value) {
        this.#resistances = typeof value === 'string' ? value : '';
        this.#lastUpdated = new Date().toISOString();
    }

    get vulnerabilities() {
        return this.#vulnerabilities;
    }

    set vulnerabilities(value) {
        this.#vulnerabilities = typeof value === 'string' ? value : '';
        this.#lastUpdated = new Date().toISOString();
    }

    set class(newClass) {
        this.#class = newClass.trim();
        this.#lastUpdated = new Date().toISOString();
    }

    set race(newRace) {
        this.#race = newRace.trim();
        this.#lastUpdated = new Date().toISOString();
    }

    set description(newDescription) {
        if (typeof newDescription !== 'string') {
            throw new Error('Description must be a string');
        }
        this.#description = newDescription.trim();
        this.#lastUpdated = new Date().toISOString();
    }

    set shortDescription(newShortDescription) {
        if (typeof newShortDescription !== 'string') {
            throw new Error('Short description must be a string');
        }
        this.#shortDescription = newShortDescription.trim();
        this.#lastUpdated = new Date().toISOString();
    }

    set lastVisitedTime(time) {
        this.#lastVisitedTime = time;
        this.#lastUpdated = new Date().toISOString();
    }

    get lastVisitedTime() {
        return this.#lastVisitedTime;
    }

    setHealthAttribute(attributeName) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.setHealthAttribute(attributeName));
        const oldMaxHealth = this.maxHealth;
        const resolved = this.#resolveHealthAttribute(attributeName);
        if (resolved === this.#healthAttribute) {
            return this.#healthAttribute;
        }

        this.#healthAttribute = resolved;
        const newMaxHealth = this.maxHealth;

        if (!this.#needMutationDepth && !this.#pendingNeedBarFinalization && oldMaxHealth > 0) {
            const healthRatio = this.#health / oldMaxHealth;
            this.#health = Math.max(0, Math.min(newMaxHealth, newMaxHealth * healthRatio));
        } else if (!this.#needMutationDepth && !this.#pendingNeedBarFinalization) {
            this.#health = Math.min(this.#health, newMaxHealth);
        }

        this.#lastUpdated = new Date().toISOString();
        return this.#healthAttribute;
    }

    get imageId() {
        return this.#imageId;
    }

    get imagePrompt() {
        return this.#imagePrompt;
    }

    get elapsedTime() {
        // Error out if called for an NPC
        if (this.#isNPC) {
            throw new Error('Elapsed time is not tracked for NPCs');
        }
        return this.#elapsedTime;
    }

    set elapsedTime(value) {
        if (this.#isNPC) {
            throw new Error('Elapsed time cannot be set for NPCs');
        }
        if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
            throw new Error('Elapsed time must be a non-negative integer minute value');
        }
        this.#elapsedTime = value;
        this.#lastUpdated = new Date().toISOString();
    }

    set imageId(newImageId) {
        if (newImageId !== null && typeof newImageId !== 'string') {
            throw new Error('Image ID must be a string or null');
        }
        this.#imageId = newImageId;
        this.#lastUpdated = new Date().toISOString();
    }

    set imagePrompt(newImagePrompt) {
        if (typeof newImagePrompt !== 'string') {
            throw new Error('Image prompt must be a string');
        }
        this.#imagePrompt = newImagePrompt.trim();
        this.#lastUpdated = new Date().toISOString();
    }

    get id() {
        return this.#id;
    }

    get currentLocation() {
        return this.#currentLocation;
    }

    get isNPC() {
        return this.#isNPC;
    }

    get inventorySize() {
        return this.#inventory.size;
    }

    getInventoryItems() {
        return Array.from(this.#inventory);
    }

    get barterInventorySize() {
        return this.#barterInventory.size;
    }

    getBarterInventoryItems() {
        return Array.from(this.#barterInventory);
    }

    addBarterInventoryItem(thingLike, options = {}) {
        return this.#addBarterInventoryThing(thingLike, options);
    }

    removeBarterInventoryItem(thingLike, options = {}) {
        return this.#removeBarterInventoryThing(thingLike, options);
    }

    hasBarterInventoryItem(thingLike) {
        const resolved = this.#resolveThing(thingLike);
        if (!resolved) {
            return false;
        }
        return this.#barterInventory.has(resolved);
    }

    clearBarterInventory() {
        if (this.#barterInventory.size === 0) {
            return;
        }
        for (const item of Array.from(this.#barterInventory)) {
            this.#removeBarterInventoryThing(item, { updateTimestamp: false });
        }
        this.#lastUpdated = new Date().toISOString();
    }

    setBarterInventory(items = []) {
        if (!Array.isArray(items)) {
            throw new Error('barterInventory must be an array.');
        }
        this.clearBarterInventory();
        for (const entry of items) {
            this.#addBarterInventoryThing(entry, { updateTimestamp: false });
        }
        this.#lastUpdated = new Date().toISOString();
        return this.getBarterInventoryItems();
    }

    get willingToTrade() {
        this.refreshTradeWillingness();
        return this.#isNPC ? this.#willingToTrade : true;
    }

    set willingToTrade(value) {
        this.setWillingToTrade(value);
    }

    get tradeRefusalExpiresAt() {
        this.refreshTradeWillingness();
        return this.#tradeRefusalExpiresAt;
    }

    get barterStockUpdatedAt() {
        return this.#barterStockUpdatedAt;
    }

    set barterStockUpdatedAt(value) {
        this.#barterStockUpdatedAt = Player.#normalizeOptionalNonNegativeInteger(value, 'barterStockUpdatedAt');
        this.#lastUpdated = new Date().toISOString();
    }

    get barterProfile() {
        return this.#barterProfile ? JSON.parse(JSON.stringify(this.#barterProfile)) : null;
    }

    set barterProfile(value) {
        this.#barterProfile = Player.#normalizeBarterProfile(value);
        this.#lastUpdated = new Date().toISOString();
    }

    setWillingToTrade(value, { refusalExpiresAt = null } = {}) {
        this.#willingToTrade = Boolean(value);
        this.#tradeRefusalExpiresAt = this.#willingToTrade
            ? null
            : Player.#normalizeOptionalNonNegativeInteger(refusalExpiresAt, 'tradeRefusalExpiresAt');
        this.#lastUpdated = new Date().toISOString();
        return this.#willingToTrade;
    }

    refreshTradeWillingness(currentWorldMinutes = null) {
        if (this.#willingToTrade || this.#tradeRefusalExpiresAt === null) {
            return this.#willingToTrade;
        }
        const minutes = Number.isInteger(currentWorldMinutes)
            ? currentWorldMinutes
            : (typeof Globals.getTotalWorldMinutes === 'function'
                ? Globals.getTotalWorldMinutes()
                : null);
        if (Number.isInteger(minutes) && minutes >= this.#tradeRefusalExpiresAt) {
            this.#willingToTrade = true;
            this.#tradeRefusalExpiresAt = null;
            this.#lastUpdated = new Date().toISOString();
        }
        return this.#willingToTrade;
    }

    get partyMembers() {
        return new Set(this.#partyMembers);
    }

    addPartyMember(memberId) {
        if (this.#needsNeedBarBoundary()) return Player.withNeedBarWorldMutation(() => this.addPartyMember(memberId));
        // Resolve player objects passed as memberId if type is Player
        if (memberId instanceof Player) {
            memberId = memberId.id;
        }

        if (typeof memberId !== 'string' || !memberId.trim()) {
            return false;
        }
        const trimmed = memberId.trim();
        const before = this.#partyMembers.size;
        this.#partyMembers.add(trimmed);
        if (this.#partyMembers.size !== before) {
            this.#partyMembersAddedThisTurn.add(trimmed);
            this.#partyMembersRemovedThisTurn.delete(trimmed);
            const member = Player.getById(trimmed);
            if (member) {
                member.persistWhenDead = true;
                member.wasEverInPlayerParty = true;
                if (typeof member.markPartyMembershipChangedThisTurn === 'function') {
                    member.markPartyMembershipChangedThisTurn();
                }

                const existingLocationId = member.currentLocation || null;
                Player.removeNpcFromAllLocations(member.id);

                if (typeof member.setLocation === 'function') {
                    member.setLocation(null);
                } else if (existingLocationId) {
                    throw new Error(`Unable to clear location for '${member.name || member.id}': setLocation is not available.`);
                }
            }
            this.#lastUpdated = new Date().toISOString();
            return true;
        }
        return false;
    }

    removePartyMember(memberId) {
        if (this.#needsNeedBarBoundary()) return Player.withNeedBarWorldMutation(() => this.removePartyMember(memberId));
        if (memberId instanceof Player) {
            memberId = memberId.id;
        }

        if (typeof memberId !== 'string' || !memberId.trim()) {
            return false;
        }
        const trimmed = memberId.trim();
        const removed = this.#partyMembers.delete(trimmed);
        if (removed) {
            this.#partyMembersRemovedThisTurn.add(trimmed);
            this.#partyMembersAddedThisTurn.delete(trimmed);
            const member = Player.getById(trimmed);
            if (member) {
                member.persistWhenDead = true;
                if (typeof member.markPartyMembershipChangedThisTurn === 'function') {
                    member.markPartyMembershipChangedThisTurn();
                }

                const playerLocation = this.currentLocationObject || null;
                if (!playerLocation) {
                    throw new Error(`Unable to relocate departing party member '${member.name || member.id}': player location is unknown.`);
                }

                const previousLocation = member.currentLocationObject || null;
                if (previousLocation && typeof previousLocation.removeNpcId === 'function') {
                    previousLocation.removeNpcId(member.id);
                }

                if (typeof member.setLocation === 'function') {
                    member.setLocation(playerLocation);
                } else if (typeof member.setLocationByName === 'function') {
                    member.setLocationByName(playerLocation.name || playerLocation.id);
                } else {
                    throw new Error(`Departing party member '${member.name || member.id}' cannot be relocated: no setLocation method available.`);
                }

                if (typeof playerLocation.addNpcId === 'function') {
                    playerLocation.addNpcId(member.id);
                } else {
                    throw new Error(`Unable to register departing party member '${member.name || member.id}' at the player location: addNpcId is unsupported.`);
                }
            }
            this.#lastUpdated = new Date().toISOString();
        }
        return removed;
    }

    clearPartyMembers() {
        if (this.#needsNeedBarBoundary()) return Player.withNeedBarWorldMutation(() => this.clearPartyMembers());
        if (this.#partyMembers.size === 0) {
            return;
        }
        const removedIds = Array.from(this.#partyMembers);
        for (const memberId of removedIds) {
            this.#partyMembersRemovedThisTurn.add(memberId);
            this.#partyMembersAddedThisTurn.delete(memberId);
            const member = Player.getById(memberId);
            if (member) {
                member.persistWhenDead = true;
                if (typeof member.markPartyMembershipChangedThisTurn === 'function') {
                    member.markPartyMembershipChangedThisTurn();
                }
            }
        }
        this.#partyMembers.clear();
        this.#lastUpdated = new Date().toISOString();
    }

    getPartyMembers() {
        return Array.from(this.#partyMembers);
    }

    get turnsSincePartyMemoryGeneration() {
        return this.#turnsSincePartyMemoryGeneration;
    }

    incrementTurnsSincePartyMemoryGeneration() {
        this.#turnsSincePartyMemoryGeneration += 1;
        return this.#turnsSincePartyMemoryGeneration;
    }

    resetTurnsSincePartyMemoryGeneration() {
        this.#turnsSincePartyMemoryGeneration = 0;
        this.#partyMembershipChangedThisTurn = false;
        this.clearPartyMemoryHistory();
    }

    addPartyMemoryHistorySegment(entries = [], limit = null) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }

        const maxSegments = Number.isInteger(limit) && limit > 0 ? limit : null;
        const segment = filterPromptHistoryEntries(entries).map(clonePartyMemoryHistoryEntry);

        if (!segment.length) {
            return;
        }

        this.#pendingPartyMemoryHistory.push(segment);
        if (maxSegments !== null) {
            const eligibleSegmentIndexes = this.#pendingPartyMemoryHistory
                .map((entries, index) => filterPromptHistoryEntries(entries).length ? index : null)
                .filter(index => index !== null);
            const excessSegments = eligibleSegmentIndexes.length - maxSegments;
            for (let index = excessSegments - 1; index >= 0; index -= 1) {
                this.#pendingPartyMemoryHistory.splice(eligibleSegmentIndexes[index], 1);
            }
        }
    }

    getPartyMemoryHistorySegments(limit = null) {
        const promptSegments = this.#pendingPartyMemoryHistory
            .map(filterPromptHistoryEntries)
            .filter(segment => segment.length > 0);
        const segments = (!Number.isInteger(limit) || limit <= 0)
            ? promptSegments
            : promptSegments.slice(-limit);
        return segments.map(segment => segment.map(clonePartyMemoryHistoryEntry));
    }

    clearPartyMemoryHistory() {
        this.#pendingPartyMemoryHistory = [];
    }

    markPartyMembershipChangedThisTurn() {
        this.#partyMembershipChangedThisTurn = true;
    }

    get partyMembershipChangedThisTurn() {
        return this.#partyMembershipChangedThisTurn;
    }

    setInPlayerParty(value) {
        throw new Error('isInPlayerParty is derived from the current player partyMembers list; use addPartyMember() or removePartyMember() on the party owner.');
    }

    set isInPlayerParty(value) {
        this.setInPlayerParty(value);
    }

    get isInPlayerParty() {
        if (!this.#isNPC || !this.#id) {
            return false;
        }

        const currentPlayer = Player.getCurrentPlayer();
        if (!currentPlayer || currentPlayer === this || currentPlayer.id === this.#id) {
            return false;
        }
        if (typeof currentPlayer.getPartyMembers !== 'function') {
            return false;
        }

        return Player.#partyMemberListIncludes(currentPlayer.getPartyMembers(), this.#id);
    }

    get wasEverInPlayerParty() {
        return this.#wasEverInPlayerParty;
    }

    set wasEverInPlayerParty(value) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => { this.wasEverInPlayerParty = value; });
        const nextValue = Boolean(value);
        if (this.#wasEverInPlayerParty === nextValue) {
            return;
        }
        this.#wasEverInPlayerParty = nextValue;
        this.#lastUpdated = new Date().toISOString();
    }

    getPartyMembersAddedThisTurn() {
        return new Set(this.#partyMembersAddedThisTurn);
    }

    getPartyMembersRemovedThisTurn() {
        return new Set(this.#partyMembersRemovedThisTurn);
    }

    clearPartyMembershipChangeTracking() {
        this.#partyMembersAddedThisTurn.clear();
        this.#partyMembersRemovedThisTurn.clear();
    }

    getDisposition(targetId, type = 'default') {
        const resolvedId = Player.resolvePlayerId(targetId);
        if (!resolvedId) {
            return 0;
        }
        const dispositionType = Player.#normalizeDispositionType(type);
        const typeMap = this.#dispositions.get(resolvedId);
        if (!typeMap) {
            return 0;
        }

        if (typeMap.has(dispositionType)) {
            const storedValue = typeMap.get(dispositionType);
            return storedValue ?? 0;
        }

        const rawType = typeof type === 'string' ? type.trim() : '';
        if (rawType && typeMap.has(rawType)) {
            const storedValue = typeMap.get(rawType);
            return storedValue ?? 0;
        }

        return 0;
    }

    setDisposition(targetId, type = 'default', value = 0) {
        const resolvedId = Player.resolvePlayerId(targetId);
        if (!resolvedId) {
            return this.getDisposition(targetId, type);
        }
        const dispositionType = Player.#normalizeDispositionType(type);
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return this.getDisposition(resolvedId, type);
        }

        let typeMap = this.#dispositions.get(resolvedId);
        if (!typeMap) {
            typeMap = new Map();
            this.#dispositions.set(resolvedId, typeMap);
        }
        typeMap.set(dispositionType, numericValue);

        const rawType = typeof type === 'string' ? type.trim() : '';
        if (rawType && rawType !== dispositionType && typeMap.has(rawType)) {
            typeMap.delete(rawType);
        }

        this.#lastUpdated = new Date().toISOString();
        return numericValue;
    }

    increaseDisposition(targetId, type = 'default', amount = 1) {
        const resolvedId = Player.resolvePlayerId(targetId);
        if (!resolvedId) {
            return 0;
        }
        const current = this.getDisposition(resolvedId, type);
        const increment = Number(amount);
        if (!Number.isFinite(increment)) {
            return current;
        }
        return this.setDisposition(resolvedId, type, current + increment);
    }

    decreaseDisposition(targetId, type = 'default', amount = 1) {
        const resolvedId = Player.resolvePlayerId(targetId);
        if (!resolvedId) {
            return 0;
        }
        const current = this.getDisposition(resolvedId, type);
        const decrement = Number(amount);
        if (!Number.isFinite(decrement)) {
            return current;
        }
        return this.setDisposition(resolvedId, type, current - decrement);
    }

    getDispositionValue(playerId, type = 'default') {
        const resolvedId = Player.resolvePlayerId(playerId);
        if (!resolvedId) {
            return 0;
        }
        return this.getDisposition(resolvedId, type);
    }

    getDispositionTowards(player, type = 'default') {
        return this.getDispositionValue(player, type);
    }

    setDispositionTowards(player, type = 'default', value = 0) {
        const resolvedId = Player.resolvePlayerId(player);
        if (!resolvedId) {
            return this.getDisposition(player, type);
        }
        return this.setDisposition(resolvedId, type, value);
    }

    getDispositionIntensityTowards(player, type = 'default') {
        const value = this.getDispositionTowards(player, type);
        return Player.resolveDispositionIntensity(type, value);
    }

    getDispositionTowardsCurrentPlayer(type = 'default') {
        const currentPlayerId = Player.getCurrentPlayerId();
        if (!currentPlayerId || currentPlayerId === this.#id) {
            return 0;
        }
        return this.getDisposition(currentPlayerId, type);
    }

    setDispositionTowardsCurrentPlayer(type = 'default', value = 0) {
        const currentPlayerId = Player.getCurrentPlayerId();
        if (!currentPlayerId || currentPlayerId === this.#id) {
            return 0;
        }
        return this.setDisposition(currentPlayerId, type, value);
    }

    getDispositionIntensityTowardsCurrentPlayer(type = 'default') {
        const value = this.getDispositionTowardsCurrentPlayer(type);
        return Player.resolveDispositionIntensity(type, value);
    }

    get createdAt() {
        return this.#createdAt;
    }

    get lastUpdated() {
        return this.#lastUpdated;
    }



    dropAllInventoryItems() {
        const items = this.getInventoryItems();
        for (const item of items) {
            item.drop();
        }
    }

    /**
     * Get list of all attribute names
     */
    getAttributeNames() {
        return Object.keys(this.attributeDefinitions);
    }

    /**
     * Get attribute definition by name
     */
    getAttributeDefinition(attributeName) {
        return this.attributeDefinitions[attributeName] ?? null;
    }

    /**
     * Calculate attribute modifier using formula from definitions
     */
    #calculateAttributeModifier(attributeValue) {
        if (!Number.isFinite(attributeValue)) {
            return 0;
        }

        // Use formula from system config, fallback to standard D&D formula
        const formula = this.systemConfig.modifierFormula ?? "floor((value - 10) / 2)";

        // Simple formula evaluation (could be enhanced with a proper expression parser)
        if (formula === "floor((value - 10) / 2)") {
            return Math.floor((attributeValue - 10) / 2);
        }

        // Fallback calculation
        return Math.floor((attributeValue - 10) / 2);
    }

    getAttributeModifier(attributeName, options = {}) {
        if (typeof attributeName !== 'string' || !attributeName) {
            return 0;
        }

        const { useModified = true, value } = options ?? {};
        const normalizedName = attributeName.trim();
        const hasBaseValue = Object.prototype.hasOwnProperty.call(this.#attributes, normalizedName);
        const baseValue = hasBaseValue ? this.#attributes[normalizedName] : undefined;

        if (!hasBaseValue && !Number.isFinite(value) && !useModified) {
            console.warn(`Unknown attribute: ${attributeName}`);
        }

        let resolvedValue;
        if (Number.isFinite(value)) {
            resolvedValue = value;
        } else if (useModified) {
            const modifiedValue = this.getModifiedAttribute(normalizedName);
            resolvedValue = Number.isFinite(modifiedValue) ? modifiedValue : baseValue;
        } else {
            resolvedValue = baseValue;
        }

        if (!Number.isFinite(resolvedValue)) {
            return 0;
        }

        return this.#calculateAttributeModifier(resolvedValue);
    }

    /**
     * Get a formatted object of all attribute modifiers
     */
    getAttributeModifiers(options = {}) {
        const { useModified = true } = options ?? {};
        const modifiers = {};
        for (const attrName of this.getAttributeNames()) {
            modifiers[attrName] = this.getAttributeModifier(attrName, { useModified });
        }
        return modifiers;
    }

    /**
     * Set an attribute value with validation from definitions
     */
    setAttribute(attributeName, value) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.setAttribute(attributeName, value));
        // Validate using definition
        this.#validateAttributeValue(attributeName, value);

        const maxHealthBefore = this.maxHealth;
        const oldValue = this.#attributes[attributeName];
        this.#attributes[attributeName] = value;
        this.#lastUpdated = new Date().toISOString();

        // Keep current health aligned with max-health changes from attribute edits.
        const definition = this.getAttributeDefinition(attributeName);
        if (!this.#needMutationDepth && !this.#pendingNeedBarFinalization && (definition?.affects?.includes('health') || attributeName === this.#healthAttribute)) {
            const maxHealthAfter = this.maxHealth;
            const maxHealthDelta = maxHealthAfter - maxHealthBefore;

            if (maxHealthDelta > 0) {
                this.#health = Math.min(maxHealthAfter, this.#health + maxHealthDelta);
            } else if (this.#health > maxHealthAfter) {
                this.#health = maxHealthAfter;
            }
        }

        return {
            attribute: attributeName,
            oldValue,
            newValue: value,
            modifier: this.getAttributeModifier(attributeName)
        };
    }

    #reconcileHealthAfterStatusEffectChange({ previousMaxHealth, suppressTimestamp = false } = {}) {
        if (this.#needMutationDepth || this.#pendingNeedBarFinalization) return;
        if (!Number.isFinite(previousMaxHealth) || previousMaxHealth <= 0) {
            throw new Error('Cannot reconcile health after status effect change: previous max health is invalid.');
        }

        const nextMaxHealth = Number(this.maxHealth);
        if (!Number.isFinite(nextMaxHealth) || nextMaxHealth <= 0) {
            throw new Error('Cannot reconcile health after status effect change: new max health is invalid.');
        }

        let nextHealth = this.#health;
        const maxHealthDelta = nextMaxHealth - previousMaxHealth;
        if (maxHealthDelta > 0) {
            nextHealth = Math.min(nextMaxHealth, this.#health + maxHealthDelta);
        } else if (this.#health > nextMaxHealth) {
            nextHealth = nextMaxHealth;
        }

        if (nextHealth === this.#health) {
            return;
        }

        if (suppressTimestamp) {
            this.#health = nextHealth;
            return;
        }

        this.setHealth(nextHealth);
    }

    /**
     * Level up the player
     */
    levelUp(count = 1) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.levelUp(count));
        console.log(`⬆️ DING! Leveling up player ${this.#name || this.#id || 'unknown'} from level ${this.#level} to level ${this.#level + count}`);
        const previousLevel = this.#level;
        this.#level += count;

        this.#flushNeedMutationHealth();
        this.#health = this.#calculateBaseHealth();
        this.#lastUpdated = new Date().toISOString();

        if (Player.#levelUpHandler) {
            try {
                const result = Player.#levelUpHandler({
                    character: this,
                    previousLevel,
                    newLevel: this.#level
                });
                if (result && typeof result.then === 'function') {
                    result.catch(error => {
                        console.warn('Level-up handler failed:', error?.message || error);
                    });
                }
            } catch (handlerError) {
                console.warn('Level-up handler errored:', handlerError?.message || handlerError);
            }
        }
    }

    previewExperienceAward(amount, raw = false) {
        if (!Number.isFinite(amount)) {
            throw new Error('Experience award amount must be a finite number.');
        }
        return raw ? Number(amount) : this.#scaleExperienceAwardForLevel(Number(amount));
    }

    addExperience(amount, raw = false) {
        if (!Number.isFinite(amount)) {
            return this.#experience;
        }

        const baseAward = Number(amount);
        const sourceLevel = this.#level;
        const appliedAward = this.previewExperienceAward(baseAward, raw);

        console.log(`⭐ Awarding ${appliedAward.toFixed(2)} experience to player ${this.#name || this.#id || 'unknown'} (base: ${baseAward.toFixed(2)}, raw: ${raw ? 'yes' : 'no'})`);
        this.#experience = Math.max(0, this.#experience + appliedAward);

        this.#processExperienceOverflow(raw);
        this.#lastUpdated = new Date().toISOString();

        // If this player is not an NPC, iterate through their party and scale awards by each recipient's level.
        if (!this.#isNPC && this.#partyMembers.size) {
            if (!Number.isFinite(sourceLevel) || sourceLevel <= 0) {
                throw new Error(`Cannot distribute party experience from ${this.#name || this.#id || 'unknown'}: source level is invalid (${sourceLevel}).`);
            }
            for (const memberId of this.#partyMembers) {
                const member = Player.getById(memberId);
                if (member && member instanceof Player && member.id !== this.id) {
                    const memberLevel = Number(member.level);
                    if (!Number.isFinite(memberLevel) || memberLevel <= 0) {
                        throw new Error(`Cannot distribute party experience to ${member?.name || member?.id || memberId}: member level is invalid (${memberLevel}).`);
                    }
                    const scaledAward = raw
                        ? baseAward
                        : (baseAward * sourceLevel) / memberLevel;
                    member.addExperience(scaledAward, raw);
                }
            }
        }

        return this.#experience;
    }

    addRawExperience(amount) {
        return this.addExperience(amount, true);
    }

    setExperience(value) {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error('Experience must be a non-negative number');
        }

        this.#experience = Number(value);
        this.#processExperienceOverflow();
        this.#lastUpdated = new Date().toISOString();
        return this.#experience;
    }

    /**
     * Modify health (damage or healing)
     */
    modifyHealth(amount, reason = '') {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.modifyHealth(amount, reason));
        this.#flushNeedMutationHealth();
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount)) {
            throw new Error('Health modification amount must be a finite number');
        }
        const maxHealth = this.maxHealth;
        const oldHealth = this.#health;
        this.#health = Math.max(0, Math.min(maxHealth, this.#health + numericAmount));
        this.#lastUpdated = new Date().toISOString();

        return {
            oldHealth,
            newHealth: this.#health,
            change: this.#health - oldHealth,
            reason
        };
    }

    #statusEffectDefaultAppliedAt() {
        const worldMinutes = Globals.getTotalWorldMinutes();
        if (!Number.isFinite(worldMinutes) || worldMinutes < 0) throw new Error('Status effect application requires valid canonical world minutes.');
        return worldMinutes;
    }

    #normalizeStatusEffects(effects = []) {
        return StatusEffectList.normalizeStatusEffectInstances(effects, {
            throwOnInvalid: true,
            skipFalsy: false,
            includeNeedBars: true,
            defaultAppliedAt: this.#statusEffectDefaultAppliedAt(),
            fixInstanceAppliedAt: true
        });
    }

    static registerAbilityIdentities(options = {}) {
        const values = source => source instanceof Map ? source.values() : Object.values(source);
        const reserveStatusIds = statuses => {
            if (!Array.isArray(statuses)) return;
            for (const status of statuses) {
                if (!status || typeof status !== 'object') continue;
                IdGenerator.register('status', status.id);
                for (const grant of (Array.isArray(status.techniqueGrants) ? status.techniqueGrants : [])) IdGenerator.register('techniqueGrant', grant?.id);
                for (const entry of (Array.isArray(status.techniqueEntries) ? status.techniqueEntries : [])) {
                    IdGenerator.register('techniqueGrant', entry?.id);
                    IdGenerator.register('technique', entry?.candidate?.id);
                    IdGenerator.register('discipline', entry?.candidateDiscipline?.id);
                }
            }
        };
        const reserveAbilities = values => {
            const entries = Array.isArray(values) ? values : (values && typeof values === 'object' ? [...(values instanceof Map ? values.values() : Object.values(values))] : []);
            for (const ability of entries) {
                if (!ability || typeof ability !== 'object') continue;
                IdGenerator.register('ability', ability.id);
                reserveStatusIds(ability.statusEffects);
            }
        };
        reserveAbilities(options.abilities);
        reserveAbilities(options.declinedAbilities);
        if (options.pendingAbilityOptionsByLevel && typeof options.pendingAbilityOptionsByLevel === 'object') {
            for (const abilities of values(options.pendingAbilityOptionsByLevel)) reserveAbilities(abilities);
        }
        reserveStatusIds(options.statusEffects);
        if (options.pendingAbilityAttachmentDraftsByLevel && typeof options.pendingAbilityAttachmentDraftsByLevel === 'object') {
            for (const drafts of values(options.pendingAbilityAttachmentDraftsByLevel)) {
                if (!Array.isArray(drafts)) continue;
                for (const entry of drafts) reserveStatusIds(entry?.draft?.statusEffects);
            }
        }
    }

    #normalizeAbilities(abilitiesInput = []) {
        let entries;
        if (Array.isArray(abilitiesInput)) {
            entries = abilitiesInput;
        } else if (abilitiesInput && typeof abilitiesInput === 'object') {
            entries = Object.values(abilitiesInput);
        } else {
            entries = [];
        }

        Player.registerAbilityIdentities({ abilities: entries });

        const normalized = [];
        for (const entry of entries) {
            if (!entry) {
                continue;
            }

            let abilityObj = entry;
            if (typeof entry === 'string') {
                abilityObj = { name: entry };
            }

            if (!abilityObj || typeof abilityObj !== 'object') {
                continue;
            }

            const name = typeof abilityObj.name === 'string' ? abilityObj.name.trim() : '';
            if (!name) {
                continue;
            }

            const description = typeof abilityObj.description === 'string' ? abilityObj.description.trim() : '';
            const shortDescription = typeof abilityObj.shortDescription === 'string' ? abilityObj.shortDescription.trim() : '';

            let type = typeof abilityObj.type === 'string' ? abilityObj.type.trim() : '';
            const lowered = type.toLowerCase();
            if (lowered === 'active' || lowered === 'passive' || lowered === 'triggered') {
                type = lowered.charAt(0).toUpperCase() + lowered.slice(1);
            } else {
                type = 'Passive';
            }

            const parsedLevel = Number.parseInt(abilityObj.level, 10);
            const level = Number.isFinite(parsedLevel) ? Math.max(1, parsedLevel) : 1;

            const id = abilityObj.id === undefined ? IdGenerator.nextUniqueNamed('ability', name) : abilityObj.id;
            if (typeof id !== 'string' || !id.trim() || id.includes(':')) throw new Error('Ability id must be a nonempty string without a colon.');
            IdGenerator.register('ability', id);
            if (normalized.some(ability => ability.id === id.trim())) throw new Error(`Duplicate ability id ${id}.`);
            if (abilityObj.imageId !== undefined && abilityObj.imageId !== null && (typeof abilityObj.imageId !== 'string' || !abilityObj.imageId.trim())) throw new TypeError('Ability imageId must be null or a nonempty string.');
            if (abilityObj.imagePrompt !== undefined && typeof abilityObj.imagePrompt !== 'string') throw new TypeError('Ability imagePrompt must be a string.');
            const statusEffects = this.#normalizeAbilityStatusEffects(abilityObj.statusEffects ?? [], id.trim());
            normalized.push({
                id: id.trim(), name, description, shortDescription, type, level,
                imageId: abilityObj.imageId?.trim() || null,
                imagePrompt: abilityObj.imagePrompt?.trim() || '',
                statusEffects
            });
        }

        const statusIds = new Set();
        for (const ability of normalized) for (const effect of ability.statusEffects) {
            if (statusIds.has(effect.id)) throw new Error(`Duplicate ability status id ${effect.id}.`);
            statusIds.add(effect.id);
        }
        return normalized;
    }

    #normalizeAbilityStatusEffects(effects, abilityId) {
        if (!Array.isArray(effects)) throw new TypeError(`Ability ${abilityId} statusEffects must be an array.`);
        for (const entry of effects) if (entry && typeof entry === 'object') IdGenerator.register('status', entry.id);
        const ids = new Set();
        return effects.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`Ability ${abilityId} statusEffects[${index}] must be an object.`);
            for (const key of Object.keys(entry)) if (!['id', 'name', 'description', 'attributes', 'skills', 'needBars', 'needBarMaximums', 'maxHealthPercent', 'techniqueGrants', 'duration', 'appliedAt'].includes(key)) throw new Error(`Ability ${abilityId} statusEffects[${index}].${key} is unsupported.`);
            if (entry.needBars !== undefined && (!Array.isArray(entry.needBars) || entry.needBars.length)) throw new Error(`Ability ${abilityId} statusEffects[${index}] cannot contain per-minute need bars.`);
            const id = entry.id ?? IdGenerator.next('status', typeof entry.name === 'string' && entry.name.trim() ? entry.name : entry.description);
            IdGenerator.register('status', id);
            if (ids.has(id)) throw new Error(`Ability ${abilityId} has duplicate status ${id}.`);
            ids.add(id);
            const effect = new StatusEffect({ ...entry, id, duration: entry.duration ?? -1, register: false });
            if (effect.duration !== -1) throw new Error(`Ability ${abilityId} status ${effect.id} must be permanent.`);
            return effect.toJSON();
        });
    }

    #getAbilityStatusEffects() {
        return (this.#abilities ?? []).flatMap(ability => ability.statusEffects ?? []).map(effect => structuredClone(effect));
    }

    #normalizePendingAbilityOptionsByLevel(source = null) {
        if (source === null || source === undefined) {
            return new Map();
        }
        if (typeof source !== 'object') {
            throw new Error('Pending ability options must be an object or Map.');
        }

        const normalized = new Map();
        const entries = source instanceof Map
            ? Array.from(source.entries())
            : Object.entries(source);

        for (const [rawLevel, rawAbilities] of entries) {
            const parsedLevel = Number.parseInt(String(rawLevel), 10);
            if (!Number.isInteger(parsedLevel) || parsedLevel <= 0) {
                throw new Error(`Pending ability options include invalid level key "${rawLevel}".`);
            }

            const normalizedAbilities = this.#normalizeAbilities(rawAbilities);
            if (!normalizedAbilities.length) {
                continue;
            }
            normalized.set(parsedLevel, normalizedAbilities);
        }

        return normalized;
    }

    static #migrateSavedPendingTechniqueCandidates(source) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
        const migrated = structuredClone(source);
        const groups = migrated instanceof Map ? migrated.values() : Object.values(migrated);
        for (const drafts of groups) for (const entry of (Array.isArray(drafts) ? drafts : [])) {
            for (const status of (Array.isArray(entry?.draft?.statusEffects) ? entry.draft.statusEffects : [])) {
                for (const option of (Array.isArray(status?.techniqueEntries) ? status.techniqueEntries : [])) {
                    if (option?.candidate && Object.hasOwn(option.candidate, 'unique')) delete option.candidate.unique;
                }
            }
        }
        return migrated;
    }

    #normalizePendingAbilityAttachmentDraftsByLevel(source = null) {
        if (source === null || source === undefined) return new Map();
        if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('Pending ability attachment drafts must be an object or Map.');
        const normalized = new Map();
        for (const [rawLevel, entries] of (source instanceof Map ? source.entries() : Object.entries(source))) {
            const level = Number(rawLevel);
            if (!Number.isInteger(level) || level <= 0 || !Array.isArray(entries)) throw new Error(`Invalid pending ability attachment drafts for level ${rawLevel}.`);
            const optionIds = new Set((this.#pendingAbilityOptionsByLevel.get(level) || []).map(option => option.id));
            const seen = new Set();
            const drafts = entries.map(entry => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.abilityId !== 'string'
                    || !optionIds.has(entry.abilityId) || seen.has(entry.abilityId)
                    || !entry.draft || typeof entry.draft !== 'object' || Array.isArray(entry.draft)
                    || !Array.isArray(entry.draft.statusEffects)) {
                    throw new Error(`Invalid pending ability attachment draft for level ${level}.`);
                }
                seen.add(entry.abilityId);
                return structuredClone({ abilityId: entry.abilityId, draft: entry.draft });
            });
            if (drafts.length) normalized.set(level, drafts);
        }
        return normalized;
    }

    get isNpc() {
        throw new Error('Use isNPC property instead of isNpc');
    }

    getStatusEffects() {
        const baseEffects = this.#getIntrinsicStatusEffects();

        // if (!this.#isNPC) {
        //     console.log('Getting status effects, base effects:', baseEffects);
        // }

        const equippedItems = this.getInventoryItems().filter(item => item?.isEquipped);
        const equippedEffects = [];
        for (const item of equippedItems) {
            if (!item) continue;
            // Apply every equip status effect the item carries, not just the first.
            const equipperEffects = Array.isArray(item.causeStatusEffectsOnEquipper) && item.causeStatusEffectsOnEquipper.length
                ? item.causeStatusEffectsOnEquipper
                : (item.causeStatusEffectOnEquipper
                    ? [item.causeStatusEffectOnEquipper]
                    : (item.causeStatusEffect?.applyToEquipper ? [item.causeStatusEffect] : []));
            for (const [effectIndex, equipEffect] of equipperEffects.entries()) {
                if (equipEffect && (equipEffect.description || equipEffect.name)) {
                    const statusId = `equipped_status:${item.id}:${equipEffect.id ?? effectIndex}`;
                    equippedEffects.push({
                        id: statusId,
                        name: equipEffect.name || null,
                        description: equipEffect.description || equipEffect.text || equipEffect.name || '',
                        duration: equipEffect.duration ?? null,
                        attributes: Array.isArray(equipEffect.attributes) ? equipEffect.attributes : [],
                        skills: Array.isArray(equipEffect.skills) ? equipEffect.skills : [],
                        needBars: Array.isArray(equipEffect.needBars) ? equipEffect.needBars : [],
                        needBarMaximums: Array.isArray(equipEffect.needBarMaximums) ? equipEffect.needBarMaximums : [],
                        maxHealthPercent: equipEffect.maxHealthPercent ?? 0,
                        techniqueGrants: (equipEffect.techniqueGrants ?? []).map(grant => ({
                            ...grant, id: `equipped_grant:${item.id}:${grant.id}`,
                            sourceStatusId: statusId
                        }))
                    });
                }
            }
        }

        const modEffects = Globals.modExtensionRegistry
            && typeof Globals.modExtensionRegistry.collectStatusEffectContributions === 'function'
            ? Globals.modExtensionRegistry.collectStatusEffectContributions(this)
            : [];

        return [...baseEffects, ...this.#getAbilityStatusEffects(), ...equippedEffects, ...modEffects, ...this.#getNeedBarStatusEffects()];
    }

    /**
     * Return only the player's intrinsic (non-gear) status effects.
     */
    getIntrinsicStatusEffects() {
        return this.#getIntrinsicStatusEffects();
    }

    #hasStatusEffect(nameOrDescription) {
        if (typeof nameOrDescription !== 'string' || !nameOrDescription.trim()) {
            return false;
        }
        const target = nameOrDescription.trim().toLowerCase();
        return this.getStatusEffects().some(effect => {
            const name = typeof effect?.name === 'string' ? effect.name.trim().toLowerCase() : '';
            const description = typeof effect?.description === 'string' ? effect.description.trim().toLowerCase() : '';
            return name === target || description === target;
        });
    }

    /**
     * Return only the player's intrinsic status effects (excludes dynamic gear effects).
     */
    #getIntrinsicStatusEffects() {
        return (this.#statusEffects ?? [])
            .map(effect => (typeof effect?.toJSON === 'function' ? effect.toJSON() : null))
            .filter(Boolean);
    }

    setStatusEffects(effects = []) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.setStatusEffects(effects));
        const previousMaxHealth = this.maxHealth;
        const previousEffects = this.#statusEffects;
        const previousHealth = this.#health;
        const normalized = this.#normalizeStatusEffects(effects);
        require('./TechniqueService.js').validateStatusGrants([...normalized, ...this.#getAbilityStatusEffects()]);
        try {
            this.#statusEffects = normalized;
            this.#reconcileHealthAfterStatusEffectChange({ previousMaxHealth, suppressTimestamp: true });
        } catch (error) {
            this.#statusEffects = previousEffects;
            this.#health = previousHealth;
            throw error;
        }
        this.#lastUpdated = new Date().toISOString();
        return this.getStatusEffects();
    }

    addStatusEffect(effectInput, defaultDuration = 1) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.addStatusEffect(effectInput, defaultDuration));
        const normalized = this.#normalizeStatusEffects(
            StatusEffectList.prepareStatusEffectInputs(effectInput, defaultDuration)
        );
        require('./TechniqueService.js').validateStatusGrants(normalized);
        if (normalized.some(effect => effect.techniqueProvenance)) throw new Error('Technique statuses must be applied through the authoritative technique service.');

        if (!normalized.length) {
            return null;
        }

        const previousMaxHealth = this.maxHealth;
        const previousEffects = [...this.#statusEffects];
        const previousHealth = this.#health;
        const updated = StatusEffectList.upsertStatusEffects(this.#statusEffects, normalized);

        if (updated) {
            try {
                require('./TechniqueService.js').validateStatusGrants([...this.#statusEffects, ...this.#getAbilityStatusEffects()]);
                this.#reconcileHealthAfterStatusEffectChange({ previousMaxHealth, suppressTimestamp: true });
            } catch (error) {
                this.#statusEffects = previousEffects;
                this.#health = previousHealth;
                throw error;
            }
            this.#lastUpdated = new Date().toISOString();
        }

        return normalized[normalized.length - 1];
    }

    /** Validate without mutation so an incompatible variant never consumes resources. */
    validateTechniqueStatusEffect(input) {
        const incoming = input instanceof StatusEffect ? input : new StatusEffect({ ...input, register: false });
        if (!incoming.techniqueProvenance) throw new Error('Technique status requires provenance.');
        const identity = StatusEffectList.techniqueStatusIdentity(incoming);
        const existing = this.#statusEffects.find(effect => StatusEffectList.techniqueStatusIdentity(effect) === identity);
        const stacking = incoming.techniqueProvenance.stacking === 'stack';
        if ((!existing || stacking) && this.#statusEffects.length >= 60) throw new Error('Character status effect storage is full.');
        const elapsed = existing && Number.isFinite(existing.appliedAt) ? Math.floor(incoming.appliedAt - existing.appliedAt) : 0;
        const active = existing && (existing.duration === -1 || existing.duration > elapsed) ? existing : null;
        const selected = stacking ? incoming : StatusEffectList.chooseTechniqueRefresh(active, incoming, { actor: this });
        const previous = this.#captureNeedBarState();
        try {
            this.#statusEffects = existing && !stacking ? this.#statusEffects.map(effect => effect === existing ? selected : effect) : [...this.#statusEffects, selected];
            require('./TechniqueService.js').validateStatusGrants([...this.#statusEffects, ...this.#getAbilityStatusEffects()]);
            this.#reconcileNeedBarCapacities();
            void this.maxHealth;
        } finally { this.#restoreNeedBarState(previous); }
        return selected;
    }

    /** Settle the collided effect's elapsed ticks, then refresh its saved identity. */
    upsertTechniqueStatusEffect(input) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.upsertTechniqueStatusEffect(input));
        const incoming = input instanceof StatusEffect ? input : new StatusEffect(input);
        this.validateTechniqueStatusEffect(incoming);
        const identity = StatusEffectList.techniqueStatusIdentity(incoming);
        const index = incoming.techniqueProvenance.stacking === 'stack' ? -1 : this.#statusEffects.findIndex(effect => StatusEffectList.techniqueStatusIdentity(effect) === identity);
        const previousMaxHealth = this.maxHealth;
        let existing = index >= 0 ? this.#statusEffects[index] : null;
        const selected = StatusEffectList.chooseTechniqueRefresh(existing, incoming, { actor: this });
        if (index >= 0) this.#statusEffects[index] = selected;
        else this.#statusEffects.push(selected);
        this.#reconcileHealthAfterStatusEffectChange({ previousMaxHealth, suppressTimestamp: true });
        this.#lastUpdated = new Date().toISOString();
        return selected;
    }

    removeStatusEffect(description) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.removeStatusEffect(description));
        if (!description || typeof description !== 'string') {
            return false;
        }

        const previousMaxHealth = this.maxHealth;
        const { removed, effects } = StatusEffectList.removeStatusEffectFromList(this.#statusEffects, description, { matchName: true });

        if (removed) {
            this.#statusEffects = effects;
            this.#reconcileHealthAfterStatusEffectChange({
                previousMaxHealth,
                suppressTimestamp: true
            });
            this.#lastUpdated = new Date().toISOString();
            return true;
        }
        return false;
    }

    tickStatusEffects(elapsedMinutes = 1) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.tickStatusEffects(elapsedMinutes));
        const retained = StatusEffectList.tickStatusEffectList(this.#statusEffects, elapsedMinutes, {
            copyRetained: effect => effect,
            tickEffect: StatusEffectList.tickStatusEffectInstance
        });
        if (retained) {
            this.#statusEffects = retained;
            this.#lastUpdated = new Date().toISOString();
        }
    }

    clearExpiredStatusEffects() {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.clearExpiredStatusEffects());
        const previousMaxHealth = this.maxHealth;
        const filtered = StatusEffectList.clearExpiredStatusEffects(this.#statusEffects);
        if (filtered) {
            this.#statusEffects = filtered;
            this.#reconcileHealthAfterStatusEffectChange({
                previousMaxHealth,
                suppressTimestamp: true
            });
            this.#lastUpdated = new Date().toISOString();
        }
    }

    getNeedBars(options = {}) {
        let scope = typeof options.scope === 'string' ? options.scope.trim().toLowerCase() : '';
        if (!scope) {
            if (options.includePlayerOnly !== undefined) {
                scope = options.includePlayerOnly ? 'stored' : 'active';
            } else {
                scope = 'active';
            }
        }

        if (!['active', 'stored'].includes(scope)) {
            throw new Error(`Unsupported need bar scope "${scope}".`);
        }
        if (!this.#needBars || !(this.#needBars instanceof Map)) {
            return [];
        }

        const results = [];
        for (const bar of this.#needBars.values()) {
            if (scope === 'active' && !Player.#needBarIsActiveForActor(bar, this)) {
                continue;
            }
            results.push(Player.#cloneNeedBarDefinition({
                ...bar,
                currentThreshold: bar.currentThreshold ? { ...bar.currentThreshold } : null
            }));
        }
        return results;
    }

    getNeedBarApplicability() {
        const result = {};
        if (!(this.#needBarApplicability instanceof Map)) {
            return result;
        }

        for (const [id, applicable] of this.#needBarApplicability.entries()) {
            if (typeof id !== 'string' || !id.trim()) {
                continue;
            }
            result[id] = Boolean(applicable);
        }

        return result;
    }

    setNeedBarApplicability(applicability = {}) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.setNeedBarApplicability(applicability));
        const existingNeedBars = this.getNeedBars({ scope: 'stored' });
        const existingNeedBarLookup = new Map();
        for (const entry of existingNeedBars) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            const normalizedId = typeof entry.id === 'string' ? entry.id.trim() : '';
            if (!normalizedId) {
                continue;
            }
            existingNeedBarLookup.set(normalizedId, Player.#cloneNeedBarDefinition(entry));
        }

        const normalizedUpdates = Player.#normalizeNeedBarApplicability(applicability);
        const previousApplicability = this.getNeedBarApplicability();
        const nextApplicability = new Map();
        const nextNeedBars = [];
        const definitions = Player.needBarDefinitions || {};

        for (const [id, definition] of Object.entries(definitions)) {
            const normalizedId = typeof id === 'string' ? id.trim() : '';
            if (!normalizedId) {
                continue;
            }
            if (!Player.#needBarCanBeStoredForActor(definition, this)) {
                continue;
            }

            const nextApplicable = normalizedUpdates.has(normalizedId)
                ? normalizedUpdates.get(normalizedId)
                : (this.#needBarApplicability.has(normalizedId) ? this.#needBarApplicability.get(normalizedId) : true);
            nextApplicability.set(normalizedId, nextApplicable !== false);
            if (nextApplicable === false) {
                continue;
            }

            const existingBar = existingNeedBarLookup.get(normalizedId);
            if (existingBar) {
                nextNeedBars.push(existingBar);
                continue;
            }

            nextNeedBars.push({
                id: normalizedId,
                value: 100
            });
        }

        const previousSerialized = JSON.stringify({
            needBars: existingNeedBars
                .map(entry => ({
                    id: entry?.id || null,
                    value: Number.isFinite(Number(entry?.value)) ? Number(entry.value) : null
                }))
                .sort((a, b) => String(a.id || '').localeCompare(String(b.id || ''))),
            applicability: previousApplicability
        });
        const nextApplicabilityObject = Object.fromEntries(nextApplicability);
        const nextSerialized = JSON.stringify({
            needBars: nextNeedBars
                .map(entry => ({
                    id: entry?.id || null,
                    value: Number.isFinite(Number(entry?.value)) ? Number(entry.value) : null
                }))
                .sort((a, b) => String(a.id || '').localeCompare(String(b.id || ''))),
            applicability: nextApplicabilityObject
        });

        this.#initializeNeedBars(nextNeedBars, nextApplicability);
        if (previousSerialized !== nextSerialized) {
            this.#lastUpdated = new Date().toISOString();
        }

        return this.getNeedBarApplicability();
    }

    getNeedBarValue(identifier) {
        const bar = this.#resolveNeedBarByIdentifier(identifier);
        if (!bar) {
            return null;
        }
        return Number.isFinite(bar.value) ? bar.value : null;
    }

    setNeedBars(needBars = []) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.setNeedBars(needBars));
        const current = new Map(this.getNeedBars({ scope: 'stored' }).map(bar => [bar.id, bar]));
        const retainBounds = (id, value) => {
            const existing = current.get(id);
            if (!existing) return value;
            const input = value && typeof value === 'object' ? value : { value };
            return input.percentage !== undefined || input.min !== undefined || input.max !== undefined
                ? input : { min: existing.min, max: existing.max, initialValue: existing.initialValue, ...input };
        };
        const inputs = Array.isArray(needBars)
            ? needBars.map(entry => entry && typeof entry === 'object' ? { ...retainBounds(entry.id, entry), id: entry.id } : entry)
            : needBars && typeof needBars === 'object' ? Object.fromEntries(Object.entries(needBars).map(([id, value]) => [id, retainBounds(id, value)])) : needBars;
        this.#initializeNeedBars(inputs, this.#needBarApplicability);
        return this.getNeedBars({ scope: 'active' });
    }

    setNeedBarValue(identifier, value, options = {}) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.setNeedBarValue(identifier, value, options));
        if (identifier === undefined || identifier === null) {
            throw new Error('Need bar identifier is required');
        }

        const allowInactive = Boolean(options.allowInactive);
        const allowPlayerOnly = options.allowPlayerOnly !== undefined
            ? Boolean(options.allowPlayerOnly)
            : true;
        const bar = this.#resolveNeedBarByIdentifier(String(identifier));
        if (!bar) {
            throw new Error(`Need bar '${identifier}' not found`);
        }

        if (!allowInactive && !Player.#needBarIsActiveForActor(bar, this)) {
            throw new Error(`Need bar '${identifier}' is not active for ${this.#name || this.#id || 'this actor'}.`);
        }

        if (!allowPlayerOnly && this.#isNPC && Player.#isNeedBarPlayerOnlyAudience(bar)) {
            throw new Error(`Need bar '${identifier}' is restricted to the player`);
        }

        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            throw new Error('Need bar value must be a finite number');
        }

        const previous = Number.isFinite(bar.value) ? bar.value : null;
        const resolved = Player.#applyNeedBarValue(bar, numericValue);

        if (previous === null || resolved !== previous) {
            this.#lastUpdated = new Date().toISOString();
        }

        return Player.#cloneNeedBarDefinition(bar);
    }

    getNeedBarsForContext(options = {}) {
        return this.getNeedBars({ scope: 'active' });
    }

    getNeedBarPromptContext(options = {}) {
        const bars = this.getNeedBars({ scope: 'active' }) || [];
        const formatted = [];
        for (const bar of bars) {
            const snapshot = Player.#cloneNeedBarDefinition(bar);
            const mapped = Player.#formatNeedBarForContext(snapshot, { includeValue: true });
            if (mapped) {
                formatted.push(mapped);
            }
        }
        formatted.sort((a, b) => a.name.localeCompare(b.name));
        return formatted;
    }

    getNeedSentencePromptContext({ actorName = null, onMissingSentence = 'warn' } = {}) {
        if (!['warn', 'throw', 'omit'].includes(onMissingSentence)) {
            throw new Error(`Unsupported need sentence handling mode "${onMissingSentence}".`);
        }

        const resolvedActorName = typeof actorName === 'string' && actorName.trim()
            ? actorName.trim()
            : (typeof this.#name === 'string' && this.#name.trim()
                ? this.#name.trim()
                : (typeof this.#id === 'string' && this.#id.trim() ? this.#id.trim() : 'This character'));
        const bars = this.getNeedBars({ scope: 'active' }) || [];
        const sentences = [];

        for (const bar of bars) {
            const sentenceTemplate = typeof bar?.currentThreshold?.sentence === 'string'
                ? bar.currentThreshold.sentence.trim()
                : '';
            if (!sentenceTemplate) {
                const barLabel = typeof bar?.name === 'string' && bar.name.trim()
                    ? bar.name.trim()
                    : (typeof bar?.id === 'string' && bar.id.trim() ? bar.id.trim() : 'unknown');
                const message = `Need bar "${barLabel}" is missing a current-threshold prompt sentence for "${resolvedActorName}".`;
                if (onMissingSentence === 'throw') {
                    throw new Error(message);
                }
                if (onMissingSentence === 'warn') {
                    console.warn(message);
                }
                continue;
            }

            sentences.push(sentenceTemplate.split('%CHARACTER%').join(resolvedActorName));
        }

        return sentences;
    }

    #resolveNeedBarByIdentifier(identifier) {
        if (!this.#needBars || !(this.#needBars instanceof Map)) {
            return null;
        }
        if (typeof identifier !== 'string') {
            return null;
        }

        const trimmed = identifier.trim();
        if (!trimmed) {
            return null;
        }

        if (this.#needBars.has(trimmed)) {
            return this.#needBars.get(trimmed);
        }

        const lowered = trimmed.toLowerCase();
        for (const [id, bar] of this.#needBars.entries()) {
            if (id.toLowerCase() === lowered) {
                return bar;
            }
            if (bar && typeof bar.name === 'string' && bar.name.trim().toLowerCase() === lowered) {
                return bar;
            }
        }

        return null;
    }

    static #resolveNeedBarMagnitudeDelta(bar, magnitude, direction = 'increase') {
        if (!bar) {
            return 0;
        }

        const magnitudeKey = this.#normalizeNeedMagnitudeKey(magnitude);
        if (!magnitudeKey || magnitudeKey === 'all') {
            return 0;
        }

        const directionKey = direction === 'decrease' ? 'decrease' : 'increase';

        const configuredMap = (bar.magnitudeValues && typeof bar.magnitudeValues === 'object')
            ? bar.magnitudeValues
            : this.needBarMagnitudeValues;
        const configuredDirectionMap = configuredMap?.[directionKey];
        if (
            configuredDirectionMap
            && Object.prototype.hasOwnProperty.call(configuredDirectionMap, magnitudeKey)
        ) {
            const configuredValue = configuredDirectionMap[magnitudeKey];
            if (Number.isFinite(configuredValue) && configuredValue > 0) {
                return configuredValue;
            }
        }

        const globalConfiguredMap = this.needBarMagnitudeValues;
        const globalDirectionMap = globalConfiguredMap?.[directionKey];
        if (
            configuredMap !== globalConfiguredMap
            && globalDirectionMap
            && Object.prototype.hasOwnProperty.call(globalDirectionMap, magnitudeKey)
        ) {
            const globalConfiguredValue = globalDirectionMap[magnitudeKey];
            if (Number.isFinite(globalConfiguredValue) && globalConfiguredValue > 0) {
                return globalConfiguredValue;
            }
        }

        const range = bar.baseCapacity ?? (bar.baseMax - bar.baseMin);
        if (!Number.isFinite(range) || range <= 0) throw new Error(`Need bar ${bar.id} has no valid authored base capacity.`);

        const resolveAmount = (fraction) => {
            if (!Number.isFinite(fraction) || fraction <= 0) {
                return 0;
            }
            return range * fraction;
        };

        switch (magnitudeKey) {
            case 'small':
                return resolveAmount(this.#NEED_BAR_SMALL_FRACTION);
            case 'medium':
                return resolveAmount(this.#NEED_BAR_MEDIUM_FRACTION);
            case 'large':
                return resolveAmount(this.#NEED_BAR_LARGE_FRACTION);
            default:
                return resolveAmount(this.#NEED_BAR_SMALL_FRACTION);
        }
    }

    applyNeedBarChange(identifier, options = {}) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.applyNeedBarChange(identifier, options));
        if (!identifier) {
            return null;
        }

        const bar = this.#resolveNeedBarByIdentifier(identifier);
        if (!bar) {
            return null;
        }
        if (!Player.#needBarIsActiveForActor(bar, this)) {
            return null;
        }

        const directionRaw = typeof options.direction === 'string' ? options.direction.trim().toLowerCase() : '';
        let direction = null;
        if (['increase', 'gain', 'raise', 'restore', 'boost', 'refill'].includes(directionRaw)) {
            direction = 'increase';
        } else if (['decrease', 'reduce', 'lower', 'drain', 'drop', 'deplete'].includes(directionRaw)) {
            direction = 'decrease';
        }

        if (!direction) {
            direction = 'increase';
        }

        const magnitude = Player.#normalizeNeedMagnitudeKey(options.magnitude) || 'small';

        const sanitizeReason = (reason) => {
            if (!reason || typeof reason !== 'string') {
                return null;
            }
            const trimmed = reason.trim();
            if (!trimmed || trimmed.toLowerCase() === 'n/a') {
                return null;
            }
            return trimmed;
        };

        const reason = sanitizeReason(options.reason);

        const previousValue = bar.value;
        const previousThreshold = bar.currentThreshold ? { ...bar.currentThreshold } : null;

        let newValue = previousValue;

        if (magnitude === 'all') {
            if (direction === 'increase') {
                if (Number.isFinite(bar.max)) {
                    newValue = bar.max;
                }
            } else if (direction === 'decrease') {
                if (Number.isFinite(bar.min)) {
                    newValue = bar.min;
                }
            }
        } else {
            const deltaAmount = Player.#resolveNeedBarMagnitudeDelta(bar, magnitude, direction);
            if (deltaAmount > 0) {
                const signedDelta = direction === 'decrease' ? -deltaAmount : deltaAmount;
                newValue = previousValue + signedDelta;
            }
        }

        Player.#applyNeedBarValue(bar, newValue);

        const delta = Number.isFinite(previousValue) && Number.isFinite(bar.value)
            ? bar.value - previousValue
            : null;

        if (bar.value !== previousValue) {
            this.#lastUpdated = new Date().toISOString();
        }

        return {
            actorId: this.#id,
            actorName: this.#name || null,
            needBarId: bar.id,
            needBarName: bar.name,
            needBarIcon: typeof bar.icon === 'string' && bar.icon.trim() ? bar.icon.trim() : null,
            needBarColor: typeof bar.color === 'string' && bar.color.trim() ? bar.color.trim() : null,
            id: bar.id,
            name: bar.name,
            direction,
            magnitude,
            reason,
            previousValue,
            newValue: bar.value,
            delta,
            min: Number.isFinite(bar.min) ? bar.min : null,
            max: Number.isFinite(bar.max) ? bar.max : null,
            player: Boolean(bar.player),
            party: Boolean(bar.party),
            nonParty: Boolean(bar.nonParty),
            hideFromHistory: Boolean(
                bar.hideIncreaseToMax
                && direction === 'increase'
                && magnitude === 'all'
            ),
            previousThreshold,
            currentThreshold: bar.currentThreshold ? { ...bar.currentThreshold } : null
        };
    }

    static prepareNeedBarState({ needBars: initialData = null, needBarApplicability: applicabilityData = null, isNPC = false } = {}) {
        const definitions = Player.needBarDefinitions || {};
        const needBars = new Map();
        const needBarApplicability = Player.#normalizeNeedBarApplicability(applicabilityData);

        const initialLookup = new Map();
        if (Array.isArray(initialData)) {
            for (const entry of initialData) {
                if (!entry || typeof entry !== 'object') {
                    continue;
                }
                const id = typeof entry.id === 'string' ? entry.id.trim() : '';
                if (!id) {
                    continue;
                }
                initialLookup.set(id, entry);
            }
        } else if (initialData && typeof initialData === 'object') {
            for (const [id, value] of Object.entries(initialData)) {
                if (!id) {
                    continue;
                }
                initialLookup.set(id.trim(), value);
            }
        }

        for (const [id, definition] of Object.entries(definitions)) {
            if (!id) {
                continue;
            }

            const normalizedId = id.trim();
            if (!normalizedId) {
                continue;
            }

            const canBeStored = Player.#needBarCanBeStoredForActor(definition, { isNPC: Boolean(isNPC) });
            if (canBeStored && !needBarApplicability.has(normalizedId)) {
                needBarApplicability.set(normalizedId, true);
            }

            if (needBarApplicability.get(normalizedId) === false) {
                continue;
            }

            if (!canBeStored) {
                continue;
            }

            const barDefinition = Player.#cloneNeedBarDefinition(definition);
            if (!barDefinition) {
                continue;
            }

            let resolved = initialLookup.has(normalizedId) ? initialLookup.get(normalizedId) : undefined;
            let candidateValue = null;
            let candidateInitialValue = null;
            if (resolved !== undefined && resolved !== null) {
                if (typeof resolved === 'object') {
                    const { value, current, amount } = resolved;
                    if (resolved.percentage !== undefined) {
                        const percentage = StatusEffect.optionalNumber(resolved.percentage, `needBars.${normalizedId}.percentage`);
                        if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw new Error(`needBars.${normalizedId}.percentage must be between 0 and 100.`);
                        candidateValue = barDefinition.min + barDefinition.baseCapacity * percentage / 100;
                    } else if (resolved.min !== undefined || resolved.max !== undefined) {
                        const previousMin = StatusEffect.optionalNumber(resolved.min, `needBars.${normalizedId}.min`);
                        const previousMax = StatusEffect.optionalNumber(resolved.max, `needBars.${normalizedId}.max`);
                        if (!Number.isFinite(previousMin) || !Number.isFinite(previousMax) || previousMax <= previousMin) {
                            const error = new Error(`needBars.${normalizedId} saved min/max must define a positive previous capacity; restore the saved reference bounds before loading.`);
                            error.code = 'NEED_BAR_STATE_INVALID'; throw error;
                        }
                        barDefinition.min = previousMin;
                        barDefinition.max = previousMax;
                    }
                    const attempt = resolved.percentage !== undefined ? candidateValue : value ?? current ?? amount;
                    if (Number.isFinite(Number(attempt))) {
                        candidateValue = Number(attempt);
                    }
                    const savedInitialValue = StatusEffect.optionalNumber(resolved.initialValue, `needBars.${normalizedId}.initialValue`);
                    if (savedInitialValue !== undefined) candidateInitialValue = savedInitialValue;
                } else if (Number.isFinite(Number(resolved))) {
                    candidateValue = Number(resolved);
                }
            }

            if (!Number.isFinite(candidateValue)) {
                if (Number.isFinite(barDefinition.initialValue)) {
                    candidateValue = barDefinition.initialValue;
                } else if (Number.isFinite(barDefinition.max)) {
                    candidateValue = barDefinition.max;
                } else {
                    candidateValue = barDefinition.min;
                }
            }

            if (resolved && typeof resolved === 'object' && resolved.percentage === undefined
                && (resolved.min !== undefined || resolved.max !== undefined)
                && (candidateValue < barDefinition.min || candidateValue > barDefinition.max)) {
                const error = new Error(`needBars.${normalizedId}.value is outside its saved min/max reference; restore a value within those bounds before loading.`);
                error.code = 'NEED_BAR_STATE_INVALID'; throw error;
            }
            Player.#applyNeedBarValue(barDefinition, candidateValue);
            barDefinition.initialValue = Number.isFinite(candidateInitialValue)
                ? candidateInitialValue
                : (Number.isFinite(candidateValue) ? candidateValue : barDefinition.initialValue);

            needBars.set(normalizedId, barDefinition);
        }
        return { needBars, needBarApplicability };
    }

    #initializeNeedBars(initialData = null, applicabilityData = null) {
        const prepared = Player.prepareNeedBarState({
            needBars: initialData, needBarApplicability: applicabilityData, isNPC: this.isNPC
        });
        this.#needBars = prepared.needBars;
        this.#needBarApplicability = prepared.needBarApplicability;
        this.#derivedNeedSignature = null;
    }

    /**
     * Check if player is alive
     */
    isAlive() {
        return !this.#isDead && this.#health > 0;
    }

    updateCorpseCountdown() {
        if (this.isDead && !this.#persistWhenDead && this.#corpseCountdown > 0) {
            this.#corpseCountdown -= 1;
            this.#lastUpdated = new Date().toISOString();
        }
        return this.#corpseCountdown
    }
    /**
     * Set player name
     */
    setName(name) {
        // remove from name index
        Player.#indexByName.delete(this.#name);
        if (!name || typeof name !== 'string') {
            throw new Error('Player name must be a non-empty string');
        }
        this.#name = name.trim();
        this.#aliases = Player.#normalizeAliasSet(this.#aliases, this.#name);
        Player.#indexByName.set(this.#name, this);
        this.#lastUpdated = new Date().toISOString();
        return this.#name;
    }

    /**
     * Set player description
     */
    setDescription(description) {
        this.#description = description || '';
        this.#lastUpdated = new Date().toISOString();
        return this.#description;
    }

    /**
     * Set player level
     */
    setLevel(level) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.setLevel(level));
        if (!Number.isInteger(level) || level < 1 || level > 20) {
            throw new Error('Player level must be an integer between 1 and 20');
        }
        const oldLevel = this.#level;
        const oldMaxHealth = this.maxHealth;
        this.#level = level;

        // Recalculate max health based on new level
        const newMaxHealth = this.#calculateBaseHealth();

        // Adjust current health proportionally
        if (!this.#needMutationDepth && !this.#pendingNeedBarFinalization && oldMaxHealth > 0) {
            const healthRatio = this.#health / oldMaxHealth;
            this.#health = Math.max(0, Math.min(newMaxHealth, newMaxHealth * healthRatio));
        }

        this.#lastUpdated = new Date().toISOString();
        return {
            oldLevel,
            newLevel: this.#level,
            oldMaxHealth,
            newMaxHealth,
            newHealth: this.#health
        };
    }

    /**
     * Set current health
     */
    setHealth(health) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.setHealth(health));
        this.#flushNeedMutationHealth();
        const numericHealth = Player.#normalizeHealthValue(health);
        const maxHealth = this.maxHealth;
        this.#health = Math.min(numericHealth, maxHealth);
        this.#lastUpdated = new Date().toISOString();
        return this.#health;
    }

    /**
     * Set maximum health
     */
    setMaxHealth(maxHealth) {
        console.warn('setMaxHealth is deprecated: max health is derived from attributes and level.');
        return this.maxHealth;
    }

    setLocationByName(locationName) {
        if (!locationName || typeof locationName !== 'string') {
            throw new Error('Location name must be a non-empty string');
        }

        const Location = getLocationModule();
        if (!Location || typeof Location.findByName !== 'function') {
            throw new Error('Location module is not available or does not support findByName');
        }

        const location = Location.getByName(locationName.trim());
        if (!location) {
            throw new Error(`Location with name '${locationName}' not found`);
        }

        this.setLocation(location);
        return this.#currentLocation;
    }

    /**
    /**
     * Set the player's current location
     * @param {string|Object} location - Location ID (string) or Location object
     */
    setLocation(location) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.setLocation(location));
        // Load object if given an id
        if (typeof location === 'string') {
            const requestedLocationId = location;
            const Location = getLocationModule();
            location = Location.get(location);
            if (!location) {
                // Leave state unchanged so callers can detect failed movement by comparing
                // currentLocation after setLocation(...) and logging this stack trace.
                const actorLabel = this.#name || this.#id || 'unknown-player';
                console.warn(`[Player.setLocation] Failed to resolve location ID "${requestedLocationId}" for "${actorLabel}". Leaving current location unchanged.`);
                console.trace('[Player.setLocation] Unresolved location stack trace');
                return;
            }
        }

        if (location === null || location === undefined) {
            this.#currentLocation = null;
        } else if (typeof location === 'object' && location.id) {
            // Store Location object or just its ID
            if (
                !this.#isNPC
                && this.#currentLocation !== location.id
                && typeof Globals.recordPlayerArrivalVisitState === 'function'
            ) {
                Globals.recordPlayerArrivalVisitState(location);
            }
            this.#currentLocation = location.id || location;
            if (!this.#isNPC) {
                if (typeof location.markVisited === 'function') {
                    location.markVisited();
                } else {
                    location.visited = true;
                }
            }
        } else {
            throw new Error('Location must be a string ID, Location object with ID, or null');
        }

        this.#lastUpdated = new Date().toISOString();
    }

    /**
     * Move to a new location using an exit direction
     * @param {string} direction - Direction to move (e.g., 'north', 'south')
     * @param {Map|Object} locationMap - Map or object containing location ID -> Location mappings
     * @returns {Object} - Movement result with success status and details
     */
    moveToLocation(direction, locationMap) {
        if (!this.#currentLocation) {
            return {
                success: false,
                error: 'Player is not currently in any location',
                currentLocation: null
            };
        }

        // Get current location object
        let currentLocationObj = null;
        if (locationMap instanceof Map) {
            currentLocationObj = locationMap.get(this.#currentLocation);
        } else if (typeof locationMap === 'object') {
            currentLocationObj = locationMap[this.#currentLocation];
        }

        if (!currentLocationObj) {
            return {
                success: false,
                error: `Current location '${this.#currentLocation}' not found in location map`,
                currentLocation: this.#currentLocation
            };
        }

        // Check if exit exists
        const exit = currentLocationObj.getExit ? currentLocationObj.getExit(direction) : null;
        if (!exit) {
            return {
                success: false,
                error: `No exit found in direction '${direction}' from current location`,
                currentLocation: this.#currentLocation,
                availableDirections: currentLocationObj.getAvailableDirections ? currentLocationObj.getAvailableDirections() : []
            };
        }

        // Move to new location
        const oldLocation = this.#currentLocation;
        this.#currentLocation = exit.destination;
        this.#lastUpdated = new Date().toISOString();

        const newLocationObj = locationMap instanceof Map
            ? locationMap.get(this.#currentLocation)
            : (typeof locationMap === 'object' ? locationMap[this.#currentLocation] : null);
        if (newLocationObj && typeof newLocationObj === 'object' && typeof newLocationObj.visited !== 'undefined') {
            try {
                newLocationObj.visited = true;
            } catch (setError) {
                // Ignore failure to set visited flag; map rendering will fall back to default styling.
            }
        }

        return {
            success: true,
            oldLocation: oldLocation,
            newLocation: this.#currentLocation,
            direction: direction,
            exitDescription: exit.description || 'No description'
        };
    }

    getCurrentLocationName() {
        const Location = getLocationModule();
        return Location.get(this.#currentLocation).name;
    }

    get currentLocationObject() {
        const Location = getLocationModule();
        return Location.get(this.#currentLocation);
    }

    /**
     * Get information about the current location
     * @param {Map|Object} locationMap - Map or object containing location ID -> Location mappings
     * @returns {Object|null} - Location information or null if not in a location
     */
    getCurrentLocationInfo(locationMap) {
        if (!this.#currentLocation) {
            return null;
        }

        let locationObj = null;
        if (locationMap instanceof Map) {
            locationObj = locationMap.get(this.#currentLocation);
        } else if (typeof locationMap === 'object') {
            locationObj = locationMap[this.#currentLocation];
        }

        if (!locationObj) {
            return {
                id: this.#currentLocation,
                error: 'Location not found in map'
            };
        }

        return locationObj.getDetails ? locationObj.getDetails() : locationObj;
    }

    /**
     * Get available exit directions from current location
     * @param {Map|Object} locationMap - Map or object containing location ID -> Location mappings
     * @returns {string[]} - Array of available directions
     */
    getAvailableExits(locationMap) {
        if (!this.#currentLocation) {
            return [];
        }

        let locationObj = null;
        if (locationMap instanceof Map) {
            locationObj = locationMap.get(this.#currentLocation);
        } else if (typeof locationMap === 'object') {
            locationObj = locationMap[this.#currentLocation];
        }

        if (!locationObj || !locationObj.getAvailableDirections) {
            return [];
        }

        return locationObj.getAvailableDirections();
    }

    /**
     * Get a single attribute value
     */
    getAttribute(attributeName) {
        return this.#attributes[attributeName] ?? null;
    }

    /**
     * Get an attribute in LLM-readable text.
     * 
     *  < 3 -> "terribe",
     *  3-5 -> "poor",
     *  6-8 -> "below average",
     *  9-11 -> "average",
     *  12-14 -> "above average",
     *  15-17 -> "excellent",
     *  18+ -> "legendary"
     */
    getAttributeTextValue(attributeName) {
        const value = this.getAttribute(attributeName);
        if (value === null) return 'unknown';
        if (value < 3) return 'terrible';
        if (value <= 5) return 'poor';
        if (value <= 8) return 'below average';
        if (value <= 11) return 'average';
        if (value <= 14) return 'above average';
        if (value <= 17) return 'excellent';
        return 'legendary';
    }


    /**
     * Get all attribute information including definitions
     */
    getAttributeInfo() {
        const info = {};
        for (const [attrName, definition] of Object.entries(this.attributeDefinitions)) {
            const baseValue = this.#attributes[attrName];
            const modifiedValue = this.getModifiedAttribute(attrName);
            const resolvedModifiedValue = Number.isFinite(modifiedValue) ? modifiedValue : baseValue;
            const baseModifier = this.getAttributeModifier(attrName, { useModified: false });
            const modifiedModifier = this.getAttributeModifier(attrName, { useModified: true });

            info[attrName] = {
                ...definition,
                value: baseValue,
                modifier: baseModifier,
                baseValue,
                baseModifier,
                modifiedValue: resolvedModifiedValue,
                modifiedModifier
            };
        }
        return info;
    }

    /**
     * Get player's current status with enhanced attribute information
     */
    getStatus() {
        const baseSnapshot = this.toJSON();
        const inventoryIds = Array.isArray(baseSnapshot.inventory) ? [...baseSnapshot.inventory] : [];
        const partyMemberIds = Array.isArray(baseSnapshot.partyMembers) ? [...baseSnapshot.partyMembers] : [];

        const gearSnapshot = this.getGear();
        const equippedByItemId = new Map();
        if (gearSnapshot && typeof gearSnapshot === 'object') {
            for (const [slotName, slotData] of Object.entries(gearSnapshot)) {
                if (!slotData || !slotData.itemId) {
                    continue;
                }
                equippedByItemId.set(slotData.itemId, {
                    slotName,
                    slotType: slotData.slotType || null
                });
            }
        }

        const inventoryDetails = this.getInventoryItems().map(item => {
            let serialized = null;
            if (item && typeof item.toJSON === 'function') {
                serialized = item.toJSON();
            } else if (item && typeof item === 'object') {
                serialized = { ...item };
            } else {
                serialized = item;
            }

            if (serialized && typeof serialized === 'object' && serialized.id) {
                const equippedInfo = equippedByItemId.get(serialized.id);
                if (equippedInfo) {
                    serialized.isEquipped = true;
                    serialized.equippedSlot = equippedInfo.slotName;
                    if (equippedInfo.slotType) {
                        serialized.equippedSlotType = equippedInfo.slotType;
                    }
                }
            }

            return serialized;
        });
        const barterInventoryDetails = this.getBarterInventoryItems().map(item => (
            item && typeof item.toJSON === 'function'
                ? item.toJSON()
                : (item && typeof item === 'object' ? { ...item } : item)
        ));

        const status = {
            ...baseSnapshot,
            id: this.#id,
            name: this.#name,
            description: this.#description,
            shortDescription: this.#shortDescription,
            class: this.#class,
            race: this.#race,
            level: this.#level,
            experience: this.#experience,
            health: this.#health,
            maxHealth: this.maxHealth,
            healthAttribute: this.#healthAttribute,
            alive: this.isAlive(),
            isDead: this.#isDead,
            persistWhenDead: this.#persistWhenDead,
            currentLocation: this.#currentLocation,
            last_seen_time: this.#lastSeenTime,
            last_seen_location: this.#lastSeenLocation,
            was_in_player_location_previous_round: this.#wasInPlayerLocationPreviousRound,
            imageId: this.#imageId,
            imagePrompt: this.#imagePrompt,
            isNPC: this.#isNPC,
            isInPlayerParty: this.isInPlayerParty,
            hiddenFromPlayer: this.#hiddenFromPlayer,
            isHostile: this.#isHostile,
            personalityType: this.#personalityType,
            personalityTraits: this.#personalityTraits,
            personalityNotes: this.#personalityNotes,
            aiNotes: this.#aiNotes,
            disposition: this.#disposition,
            hostileArrivalProvenance: this.hostileArrivalProvenance,
            playerGuidance: this.#playerGuidance,
            resistances: this.#resistances,
            vulnerabilities: this.#vulnerabilities,
            aliases: this.getAliases(),
            attributes: { ...this.#attributes },
            modifiers: this.getAttributeModifiers(),
            attributeInfo: this.getAttributeInfo(),
            attributeDefinitions: this.attributeDefinitions,
            systemConfig: this.systemConfig,
            inventory: inventoryDetails,
            inventoryIds,
            barterInventory: barterInventoryDetails,
            barterInventoryIds: Array.isArray(baseSnapshot.barterInventory) ? [...baseSnapshot.barterInventory] : [],
            willingToTrade: this.willingToTrade,
            tradeRefusalExpiresAt: this.#tradeRefusalExpiresAt,
            barterStockUpdatedAt: this.#barterStockUpdatedAt,
            barterProfile: this.barterProfile,
            partyMembers: partyMemberIds,
            partyMemberIds,
            dispositions: this.#serializeDispositions(),
            dispositionDefinitions: Player.dispositionDefinitions,
            skills: Object.fromEntries(this.#skills),
            abilities: this.getAbilities(),
            techniques: this.techniques,
            disciplineAccess: this.disciplineAccess,
            declinedAbilities: this.getDeclinedAbilities(),
            unspentSkillPoints: this.getUnspentSkillPoints(),
            unspentAttributePoints: this.getUnspentAttributePoints(),
            statusEffects: this.getStatusEffects(),
            gear: this.getGear(),
            gearSlotsByType: this.getGearSlotsByType(),
            gearSlotDefinitions: Player.gearSlotDefinitions,
            currency: this.#currency,
            createdAt: this.#createdAt,
            lastUpdated: this.#lastUpdated,
            needBars: this.getNeedBars({ scope: 'active' }),
            corpseCountdown: this.#corpseCountdown,
            importantMemories: this.importantMemories,
            factionId: this.#factionId,
            factionStandings: this.getFactionStandings(),
            relationships: this.getRelationships()
        };
        status.pendingAbilityOptionsByLevel = this.getPendingAbilityOptionsByLevel();
        status.pendingAbilityAttachmentDraftsByLevel = this.getPendingAbilityAttachmentDraftsByLevel();

        status.quests = this.#quests.map(quest => quest.toJSON());
        status.personality = {
            type: this.#personalityType,
            traits: this.#personalityTraits,
            notes: this.#personalityNotes,
            aiNotes: this.#aiNotes,
            goals: this.#goals.slice(),
            characterArc: this.characterArc
        };
        status.goals = this.#goals.slice();
        status.characterArc = this.characterArc;

        return status;
    }

    /**
     * Export player data for saving
     */
    toJSON() {
        return {
            ...this.getExtensionFields(),
            id: this.#id,
            name: this.#name,
            description: this.#description,
            shortDescription: this.#shortDescription,
            class: this.#class,
            race: this.#race,
            aliases: this.getAliases(),
            gender: this.#gender,
            level: this.#level,
            health: this.#health,
            maxHealth: this.maxHealth,
            healthAttribute: this.#healthAttribute,
            currentLocation: this.#currentLocation,
            last_seen_time: this.#lastSeenTime,
            last_seen_location: this.#lastSeenLocation,
            was_in_player_location_previous_round: this.#wasInPlayerLocationPreviousRound,
            imageId: this.#imageId,
            imagePrompt: this.#imagePrompt,
            attributes: this.#attributes,
            isNPC: this.#isNPC,
            hiddenFromPlayer: this.#hiddenFromPlayer,
            isHostile: this.#isHostile,
            isDead: this.#isDead,
            inCombat: this.#inCombat,
            persistWhenDead: this.#persistWhenDead,
            factionId: this.#factionId,
            corpseCountdown: this.#corpseCountdown,
            inventory: Array.from(this.#inventory).map(thing => thing.id),
            barterInventory: Array.from(this.#barterInventory).map(thing => thing.id),
            willingToTrade: this.#willingToTrade,
            tradeRefusalExpiresAt: this.#tradeRefusalExpiresAt,
            barterStockUpdatedAt: this.#barterStockUpdatedAt,
            barterProfile: this.barterProfile,
            partyMembers: Array.from(this.#partyMembers),
            dispositions: this.#serializeDispositions(),
            skills: Object.fromEntries(this.#skills),
            abilities: this.getAbilities(),
            techniques: this.techniques,
            disciplineAccess: this.disciplineAccess,
            declinedAbilities: this.getDeclinedAbilities(),
            unspentSkillPoints: this.getUnspentSkillPoints(),
            unspentAttributePoints: this.getUnspentAttributePoints(),
            statusEffects: this.#getIntrinsicStatusEffects(),
            gear: this.getGear(),
            gearSlotsByType: this.getGearSlotsByType(),
            currency: this.#currency,
            personality: {
                type: this.#personalityType,
                traits: this.#personalityTraits,
                notes: this.#personalityNotes,
                aiNotes: this.#aiNotes,
                goals: this.#goals.slice(),
                characterArc: this.characterArc
            },
            personalityType: this.#personalityType,
            personalityTraits: this.#personalityTraits,
            personalityNotes: this.#personalityNotes,
            aiNotes: this.#aiNotes,
            disposition: this.#disposition,
            playerGuidance: this.#playerGuidance,
            resistances: this.#resistances,
            vulnerabilities: this.#vulnerabilities,
            goals: this.#goals.slice(),
            characterArc: this.characterArc,
            createdAt: this.#createdAt,
            lastUpdated: this.#lastUpdated,
            experience: this.#experience,
            currency: this.#currency,
            needBars: this.getNeedBars({ scope: 'stored' }),
            needBarApplicability: this.getNeedBarApplicability(),
            needBarRatesAppliedAt: this.#needBarRatesAppliedAt,
            healthRegenAppliedAt: this.#healthRegenAppliedAt,
            derivedNeedRatesAppliedAt: this.#derivedNeedRatesAppliedAt,
            thingListViewPreferences: this.getThingListViewPreferences(),
            modState: this.modState,
            factionStandings: this.getFactionStandings(),
            favorUsage: this.getFavorUsageMap(),
            relationships: this.getRelationships(),
            importantMemories: this.importantMemories,
            previousLocationId: this.#previousLocationId,
            lastActionWasTravel: this.#lastActionWasTravel,
            consecutiveTravelActions: this.#consecutiveTravelActions,
            turnsSincePartyMemoryGeneration: this.#turnsSincePartyMemoryGeneration,
            partyMemoryHistorySegments: this.#pendingPartyMemoryHistory,
            partyMembershipChangedThisTurn: this.#partyMembershipChangedThisTurn,
            wasEverInPlayerParty: this.#wasEverInPlayerParty,
            partyMembersAddedThisTurn: Array.from(this.#partyMembersAddedThisTurn),
            partyMembersRemovedThisTurn: Array.from(this.#partyMembersRemovedThisTurn),
            elapsedTime: this.#elapsedTime,
            pendingAbilityOptionsByLevel: this.getPendingAbilityOptionsByLevel(),
            pendingAbilityAttachmentDraftsByLevel: this.getPendingAbilityAttachmentDraftsByLevel(),
            quests: this.#quests.map(quest => quest.toJSON())
        };
    }

    /**
     * Create player from saved data
     */
    static fromJSON(data, { deferNeedBarFinalization = false } = {}) {
        const savedNeedEntries = Array.isArray(data.needBars) ? data.needBars
            : Object.entries(data.needBars || {}).map(([id, value]) => value && typeof value === 'object' ? { ...value, id } : { id, value });
        const legacyNeedBarState = !Object.prototype.hasOwnProperty.call(data, 'derivedNeedRatesAppliedAt')
            && !savedNeedEntries.some(bar => bar && typeof bar === 'object' && ['baseMin', 'baseMax', 'baseCapacity'].some(key => Object.prototype.hasOwnProperty.call(bar, key)));
        if (!legacyNeedBarState) for (const bar of savedNeedEntries) {
            if (!bar || !Player.needBarDefinitions[bar.id]) continue;
            let min, max, value;
            try {
                min = StatusEffect.optionalNumber(bar.min, `needBars.${bar.id}.min`);
                max = StatusEffect.optionalNumber(bar.max, `needBars.${bar.id}.max`);
                value = StatusEffect.optionalNumber(bar.value, `needBars.${bar.id}.value`);
                StatusEffect.optionalNumber(bar.initialValue, `needBars.${bar.id}.initialValue`);
            } catch (error) { error.code = 'NEED_BAR_STATE_INVALID'; throw error; }
            if (!Number.isFinite(value)) {
                const error = new Error(`needBars.${bar.id}.value is required; restore its finite saved current value before loading.`);
                error.code = 'NEED_BAR_STATE_INVALID'; throw error;
            }
            if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
                const error = new Error(`needBars.${bar.id} is missing usable saved min/max reference bounds; restore both bounds before loading modified capacity.`);
                error.code = 'NEED_BAR_STATE_INVALID'; throw error;
            }
        }
        const legacyNeedBarLoadState = Player.#buildLegacyNeedBarLoadState({
            needBars: Array.isArray(data.needBars) || (data.needBars && typeof data.needBars === 'object') ? data.needBars : null,
            needBarApplicability: data.needBarApplicability && typeof data.needBarApplicability === 'object'
                ? data.needBarApplicability
                : null,
            isNPC: data.isNPC
        });
        const player = new Player({
            ...playerExtensionFields.extractInputs(data),
            name: data.name,
            level: data.level,
            health: data.health,
            savedMaxHealth: data.maxHealth,
            legacyNeedBarState,
            deferNeedBarFinalization: true,
            attributes: data.attributes,
            imageId: data.imageId,
            imagePrompt: data.imagePrompt,
            id: data.id,
            description: data.description,
            location: data.currentLocation,
            last_seen_time: data.last_seen_time ?? data.lastSeenTime,
            last_seen_location: data.last_seen_location ?? data.lastSeenLocation,
            was_in_player_location_previous_round: data.was_in_player_location_previous_round
                ?? data.wasInPlayerLocationPreviousRound,
            isNPC: data.isNPC,
            hiddenFromPlayer: data.hiddenFromPlayer,
            isHostile: data.isHostile,
            shortDescription: data.shortDescription,
            class: data.class,
            race: data.race,
            gender: data.gender,
            factionId: data.factionId,
            factionStandings: data.factionStandings,
            favorUsage: data.favorUsage,
            relationships: data.relationships,
            personalityType: data.personality?.type ?? data.personalityType,
            personalityTraits: data.personality?.traits ?? data.personalityTraits,
            personalityNotes: data.personality?.notes ?? data.personalityNotes,
            aiNotes: data.aiNotes ?? data.personality?.aiNotes,
            disposition: data.disposition,
            hostileArrivalProvenance: data.hostileArrivalProvenance,
            playerGuidance: data.playerGuidance,
            resistances: typeof data.resistances === 'string'
                ? data.resistances
                : (typeof data.resistance === 'string' ? data.resistance : ''),
            vulnerabilities: typeof data.vulnerabilities === 'string'
                ? data.vulnerabilities
                : (typeof data.vulnerability === 'string' ? data.vulnerability : ''),
            aliases: Array.isArray(data.aliases) ? data.aliases : [],
            goals: Array.isArray(data.personality?.goals)
                ? data.personality.goals
                : (Array.isArray(data.goals) ? data.goals : []),
            inventory: Array.isArray(data.inventory) ? data.inventory : [],
            barterInventory: Array.isArray(data.barterInventory) ? data.barterInventory : [],
            willingToTrade: data.willingToTrade,
            tradeRefusalExpiresAt: data.tradeRefusalExpiresAt,
            barterStockUpdatedAt: data.barterStockUpdatedAt,
            barterProfile: data.barterProfile,
            partyMembers: Array.isArray(data.partyMembers) ? data.partyMembers : [],
            dispositions: data.dispositions && typeof data.dispositions === 'object' ? data.dispositions : {},
            skills: data.skills && typeof data.skills === 'object' ? data.skills : {},
            techniques: data.techniques,
            disciplineAccess: data.disciplineAccess,
            abilities: Array.isArray(data.abilities) ? data.abilities : (data.abilities && typeof data.abilities === 'object' ? data.abilities : []),
            declinedAbilities: Array.isArray(data.declinedAbilities)
                ? data.declinedAbilities
                : (data.declinedAbilities && typeof data.declinedAbilities === 'object' ? data.declinedAbilities : []),
            unspentSkillPoints: data.unspentSkillPoints,
            unspentAttributePoints: data.unspentAttributePoints,
            statusEffects: Array.isArray(data.statusEffects) ? data.statusEffects : [],
            gear: data.gear && typeof data.gear === 'object' ? data.gear : null,
            healthAttribute: data.healthAttribute,
            experience: data.experience,
            currency: data.currency,
            createdAt: data.createdAt,
            lastUpdated: data.lastUpdated,
            needBars: legacyNeedBarLoadState.needBars,
            needBarApplicability: legacyNeedBarLoadState.needBarApplicability,
            needBarRatesAppliedAt: data.needBarRatesAppliedAt,
            healthRegenAppliedAt: data.healthRegenAppliedAt,
            derivedNeedRatesAppliedAt: data.derivedNeedRatesAppliedAt,
            thingListViewPreferences: data.thingListViewPreferences && typeof data.thingListViewPreferences === 'object'
                ? data.thingListViewPreferences
                : {},
            modState: data.modState && typeof data.modState === 'object' && !Array.isArray(data.modState)
                ? data.modState
                : {},
            isDead: data.isDead,
            inCombat: data.inCombat,
            persistWhenDead: data.persistWhenDead === true,
            corpseCountdown: data.corpseCountdown,
            importantMemories: Array.isArray(data.importantMemories) ? data.importantMemories : [],
            pendingAbilityOptionsByLevel: data.pendingAbilityOptionsByLevel,
            pendingAbilityAttachmentDraftsByLevel: Player.#migrateSavedPendingTechniqueCandidates(data.pendingAbilityAttachmentDraftsByLevel),
            characterArc: Player.#normalizeCharacterArc(
                data.characterArc
                ?? data.personality?.characterArc
            )
        });

        if (Number.isFinite(data.elapsedTime)) {
            player.#elapsedTime = Math.max(0, Math.round(data.elapsedTime));
        } else {
            player.#elapsedTime = 0;
        }

        player.#createdAt = data.createdAt;
        player.#lastUpdated = data.lastUpdated;
        if (data.previousLocationId) {
            player.#previousLocationId = data.previousLocationId;
        }
        if (typeof data.lastActionWasTravel === 'boolean') {
            player.#lastActionWasTravel = data.lastActionWasTravel;
        }
        const travelCount = Number(data.consecutiveTravelActions);
        if (Number.isFinite(travelCount) && travelCount > 0) {
            player.#consecutiveTravelActions = Math.floor(travelCount);
        }
        const turnsSincePartyMemory = Number(data.turnsSincePartyMemoryGeneration);
        if (Number.isFinite(turnsSincePartyMemory) && turnsSincePartyMemory > 0) {
            player.#turnsSincePartyMemoryGeneration = Math.floor(turnsSincePartyMemory);
        }

        if (Array.isArray(data.partyMemoryHistorySegments)) {
            player.#pendingPartyMemoryHistory = data.partyMemoryHistorySegments
                .map(segment => (Array.isArray(segment)
                    ? segment
                        .filter(entry => entry && typeof entry === 'object')
                        .map(clonePartyMemoryHistoryEntry)
                    : null))
                .filter(Boolean);
        }

        if (typeof data.partyMembershipChangedThisTurn === 'boolean') {
            player.#partyMembershipChangedThisTurn = data.partyMembershipChangedThisTurn;
        }
        if (typeof data.wasEverInPlayerParty === 'boolean') {
            player.#wasEverInPlayerParty = data.wasEverInPlayerParty;
        } else {
            player.#wasEverInPlayerParty = false;
        }
        if (Array.isArray(data.partyMembersAddedThisTurn)) {
            player.#partyMembersAddedThisTurn = new Set(
                data.partyMembersAddedThisTurn.filter(id => typeof id === 'string')
            );
        }
        if (Array.isArray(data.partyMembersRemovedThisTurn)) {
            player.#partyMembersRemovedThisTurn = new Set(
                data.partyMembersRemovedThisTurn.filter(id => typeof id === 'string')
            );
        }

        if (Array.isArray(data.quests)) {
            player.#quests = data.quests
                .map(entry => {
                    try {
                        return Quest.fromJSON(entry);
                    } catch (error) {
                        console.warn('Failed to deserialize quest:', error?.message || error);
                        return null;
                    }
                })
                .filter(Boolean);
        } else {
            player.#quests = [];
        }

        if (!deferNeedBarFinalization) {
            try { player.#finalizeNeedBarState(); }
            catch (error) { Player.unregister(player); throw error; }
        }
        return player;
    }

    addInventoryItem(thingLike, options = {}) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.addInventoryItem(thingLike, options));
        return this.#addInventoryThing(thingLike, options);
    }

    removeInventoryItem(thingLike, options = {}) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.removeInventoryItem(thingLike, options));
        return this.#removeInventoryThing(thingLike, options);
    }

    hasInventoryItem(thingLike) {
        const resolved = this.#resolveThing(thingLike);
        if (!resolved) {
            return false;
        }
        return this.#inventory.has(resolved);
    }

    clearInventory() {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.clearInventory());
        if (this.#inventory.size === 0) {
            return;
        }
        this.#inventory.clear();
        this.#syncGearWithInventory();
        this.#syncModStateWithInventory({ action: 'clear' });
        this.#lastUpdated = new Date().toISOString();
    }

    setInventory(items = []) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.setInventory(items));
        this.#inventory.clear();
        if (Array.isArray(items)) {
            for (const entry of items) {
                this.#addInventoryThing(entry, { updateTimestamp: false, suppressNpcEquip: true, mergeStacks: false });
            }
        }
        this.#syncGearWithInventory();
        this.#syncModStateWithInventory({ action: 'set' });
        this.#lastUpdated = new Date().toISOString();
        return this.getInventoryItems();
    }

    getGear() {
        const snapshot = {};
        if (!this.#gearSlots) {
            return snapshot;
        }
        for (const [slotName, slotData] of this.#gearSlots.entries()) {
            if (!slotData) {
                continue;
            }
            snapshot[slotName] = {
                slotType: slotData.slotType,
                itemId: slotData.itemId || null,
                item: slotData.itemId ? this.#resolveThing(slotData.itemId) : null
            };
        }
        return snapshot;
    }

    getGearSlotsByType() {
        const snapshot = {};
        if (!this.#gearSlotsByType) {
            return snapshot;
        }
        for (const [slotType, slotNames] of this.#gearSlotsByType.entries()) {
            snapshot[slotType] = Array.isArray(slotNames) ? [...slotNames] : [];
        }
        return snapshot;
    }

    getEquippedSlotForThing(thingLike) {
        const item = this.#resolveThing(thingLike);
        if (!item || !item.slot) {
            return null;
        }
        const slotType = this.#normalizeSlotType(item.slot);
        if (!slotType || !this.#gearSlotsByType) {
            return null;
        }
        const slotNames = this.#gearSlotsByType.get(slotType);
        if (!slotNames || !slotNames.length) {
            return null;
        }
        for (const slotName of slotNames) {
            const slotData = this.#gearSlots.get(slotName);
            if (slotData?.itemId === item.id) {
                return slotName;
            }
        }
        return null;
    }

    hasEquippedThing(thingLike) {
        return this.getEquippedSlotForThing(thingLike) !== null;
    }

    getEquippedItemIdForType(slotType) {
        const normalizedType = this.#normalizeSlotType(slotType);
        if (!normalizedType || !this.#gearSlotsByType) {
            return null;
        }
        const slotNames = this.#gearSlotsByType.get(normalizedType);
        if (!slotNames || !slotNames.length) {
            return null;
        }
        for (const slotName of slotNames) {
            const slotData = this.#gearSlots.get(slotName);
            if (slotData?.itemId) {
                return slotData.itemId;
            }
        }
        return null;
    }

    #preserveHealthRatioAfterGearChange({ previousHealth, previousMaxHealth, suppressTimestamp = false } = {}) {
        if (this.#needMutationDepth || this.#pendingNeedBarFinalization) return;
        if (!Number.isFinite(previousHealth) || previousHealth < 0) {
            throw new Error('Cannot preserve health ratio: current health is invalid.');
        }
        if (!Number.isFinite(previousMaxHealth) || previousMaxHealth <= 0) {
            throw new Error('Cannot preserve health ratio: current max health is invalid.');
        }
        const nextMaxHealth = Number(this.maxHealth);
        if (!Number.isFinite(nextMaxHealth) || nextMaxHealth <= 0) {
            throw new Error('Cannot preserve health ratio: new max health is invalid.');
        }

        const ratio = previousHealth / previousMaxHealth;
        const nextHealthRaw = ratio * nextMaxHealth;
        const nextHealth = Math.max(0, Math.min(nextMaxHealth, nextHealthRaw));

        if (!Number.isFinite(nextHealth)) {
            throw new Error('Cannot preserve health ratio: computed health is invalid.');
        }

        if (suppressTimestamp) {
            this.#health = nextHealth;
            return;
        }
        this.setHealth(nextHealth);
    }

    equipItem(thingLike, { suppressTimestamp = false } = {}) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.equipItem(thingLike, { suppressTimestamp }));
        const item = this.#resolveThing(thingLike);
        if (!item) {
            return false;
        }
        const slotType = this.#normalizeSlotType(item.slot);
        if (!slotType || slotType === 'n/a') {
            return false;
        }
        const slotNames = this.#gearSlotsByType?.get(slotType);
        if (!slotNames || slotNames.length === 0) {
            return false;
        }

        let targetSlot = null;
        for (const candidate of slotNames) {
            const slotData = this.#gearSlots.get(candidate);
            if (slotData && !slotData.itemId) {
                targetSlot = candidate;
                break;
            }
        }
        if (!targetSlot) {
            targetSlot = slotNames[0];
        }

        return this.equipItemInSlot(item, targetSlot, { suppressTimestamp });
    }

    equipItemInSlot(thingLike, slotName, { suppressTimestamp = false } = {}) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.equipItemInSlot(thingLike, slotName, { suppressTimestamp }));
        //console.log(`Equipping item in slot: ${slotName}`);
        const item = this.#resolveThing(thingLike);
        //console.log(`Resolved item:`, item);
        if (!item || !slotName) {
            return `Missing item or slot name: ` + `${!item ? 'item' : ''}${!item && !slotName ? ' and ' : ''}${!slotName ? 'slot name' : ''}`;
        }

        const resolvedSlotName = this.#resolveSlotName(slotName);
        if (!resolvedSlotName) {
            return `Invalid slot name: ${slotName}`;
        }

        const slotData = this.#gearSlots.get(resolvedSlotName);
        if (!slotData) {
            return `Slot not found: ${resolvedSlotName}`;
        }

        const itemSlotType = this.#normalizeSlotType(item.slot);
        if (!itemSlotType || itemSlotType === 'n/a' || itemSlotType !== slotData.slotType) {
            console.log(`Incompatible slot types: item(${itemSlotType}) vs slot(${slotData.slotType})`);
            return `Incompatible item slot type: ${itemSlotType} (expected: ${slotData.slotType})`;
        }

        if (!this.#inventory.has(item)) {
            return `Item not found in inventory: ${item.id}`;
        }

        if (!resolvedSlotName) {
            return `Invalid slot name: ${slotName} (resolved to '${resolvedSlotName}')`;
        }

        const previousHealth = this.#health;
        const previousMaxHealth = this.maxHealth;

        slotData.itemId = item.id;
        this.#gearSlots.set(resolvedSlotName, slotData);

        //console.log(`Equipping item ${item.id} in slot ${resolvedSlotName}`);

        //console.log(this.#gearSlots)

        this.#preserveHealthRatioAfterGearChange({
            previousHealth,
            previousMaxHealth,
            suppressTimestamp
        });

        if (!suppressTimestamp) {
            this.#lastUpdated = new Date().toISOString();
        }

        return true;
    }

    unequipItemId(itemId, { suppressTimestamp = false } = {}) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.unequipItemId(itemId, { suppressTimestamp }));
        if (!itemId || typeof itemId !== 'string') {
            return false;
        }
        const trimmed = itemId.trim();
        if (!trimmed || !this.#gearSlots) {
            return false;
        }

        const previousHealth = this.#health;
        const previousMaxHealth = this.maxHealth;

        let changed = false;
        for (const slotData of this.#gearSlots.values()) {
            if (slotData?.itemId === trimmed) {
                slotData.itemId = null;
                changed = true;
            }
        }

        if (changed) {
            this.#preserveHealthRatioAfterGearChange({
                previousHealth,
                previousMaxHealth,
                suppressTimestamp
            });
        }

        if (changed && !suppressTimestamp) {
            this.#lastUpdated = new Date().toISOString();
        }

        return changed;
    }

    unequipSlot(slotName, { suppressTimestamp = false } = {}) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.unequipSlot(slotName, { suppressTimestamp }));
        const resolvedSlotName = this.#resolveSlotName(slotName);
        if (!resolvedSlotName) {
            return false;
        }
        const slotData = this.#gearSlots.get(resolvedSlotName);
        if (!slotData || !slotData.itemId) {
            return false;
        }

        const previousHealth = this.#health;
        const previousMaxHealth = this.maxHealth;

        slotData.itemId = null;
        this.#gearSlots.set(resolvedSlotName, slotData);

        this.#preserveHealthRatioAfterGearChange({
            previousHealth,
            previousMaxHealth,
            suppressTimestamp
        });

        if (!suppressTimestamp) {
            this.#lastUpdated = new Date().toISOString();
        }

        return true;
    }

    #serializeDispositions() {
        const serialized = {};
        for (const [npcId, typeMap] of this.#dispositions.entries()) {
            if (!typeMap || !(typeMap instanceof Map) || typeMap.size === 0) {
                continue;
            }
            serialized[npcId] = {};
            for (const [type, value] of typeMap.entries()) {
                serialized[npcId][type] = value;
            }
        }
        return serialized;
    }

    getSkills() {
        return new Map(this.#skills);
    }

    getAbilities() {
        return this.#abilities.map(ability => structuredClone(ability));
    }

    previewMaxHealthForAbilities(abilities) {
        const normalized = this.#normalizeAbilities(abilities);
        const previous = this.#abilities;
        try {
            this.#abilities = normalized;
            return this.maxHealth;
        } finally {
            this.#abilities = previous;
        }
    }

    #abilityRecords() {
        return [...this.#abilities, ...this.#declinedAbilities, ...Array.from(this.#pendingAbilityOptionsByLevel.values()).flat()];
    }

    getAbilityById(id) {
        const ability = this.#abilityRecords().find(entry => entry.id === id);
        return ability ? structuredClone(ability) : null;
    }

    updateAbilityImage(id, updates) {
        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new TypeError('Ability image updates must be an object.');
        for (const key of Object.keys(updates)) if (!['imageId', 'imagePrompt'].includes(key)) throw new Error(`Unsupported ability image field ${key}.`);
        if (updates.imageId !== undefined && updates.imageId !== null && (typeof updates.imageId !== 'string' || !updates.imageId.trim())) throw new TypeError('Ability imageId must be null or a nonempty string.');
        if (updates.imagePrompt !== undefined && typeof updates.imagePrompt !== 'string') throw new TypeError('Ability imagePrompt must be a string.');
        const records = this.#abilityRecords().filter(entry => entry.id === id);
        if (!records.length) throw new Error(`Ability ${id} no longer exists on ${this.id}.`);
        for (const ability of records) {
            if (updates.imageId !== undefined) ability.imageId = updates.imageId === null ? null : updates.imageId.trim();
            if (updates.imagePrompt !== undefined) ability.imagePrompt = updates.imagePrompt.trim();
        }
        this.#lastUpdated = new Date().toISOString();
        return this.getAbilityById(id);
    }

    get techniques() { return Technique.clone(this.#techniques); }
    set techniques(value) { this.setTechniques(value); }
    get disciplineAccess() { return Technique.clone(this.#disciplineAccess); }
    set disciplineAccess(value) { this.setDisciplineAccess(value); }
    getTechniques() { return this.techniques; }
    setTechniques(value) {
        this.#techniques = Technique.normalizeLearned(value);
        this.#lastUpdated = new Date().toISOString();
        return this.techniques;
    }
    setDisciplineAccess(value) {
        this.#disciplineAccess = Technique.normalizeDisciplineAccess(value);
        this.#lastUpdated = new Date().toISOString();
        return this.disciplineAccess;
    }

    getDeclinedAbilities() {
        return this.#declinedAbilities.map(ability => structuredClone(ability));
    }

    getDeclinedAbilityNames() {
        return this.#declinedAbilities
            .map(ability => (typeof ability?.name === 'string' ? ability.name.trim() : ''))
            .filter(Boolean);
    }

    setDeclinedAbilities(abilitiesInput = []) {
        const normalizedAbilities = this.#normalizeAbilities(abilitiesInput);
        const seen = new Set();
        this.#declinedAbilities = [];
        for (const ability of normalizedAbilities) {
            const key = typeof ability?.name === 'string' ? ability.name.trim().toLowerCase() : '';
            if (!key || seen.has(key)) {
                continue;
            }
            seen.add(key);
            this.#declinedAbilities.push({ ...ability });
        }
        this.#lastUpdated = new Date().toISOString();
        return this.getDeclinedAbilities();
    }

    addDeclinedAbility(abilityInput) {
        const [normalizedAbility] = this.#normalizeAbilities([abilityInput]);
        const key = typeof normalizedAbility?.name === 'string'
            ? normalizedAbility.name.trim().toLowerCase()
            : '';
        if (!key) {
            return false;
        }
        const exists = this.#declinedAbilities.some(ability => (
            typeof ability?.name === 'string' && ability.name.trim().toLowerCase() === key
        ));
        if (exists) {
            return false;
        }
        this.#declinedAbilities.push({ ...normalizedAbility });
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    addDeclinedAbilities(abilitiesInput = []) {
        const entries = Array.isArray(abilitiesInput) ? abilitiesInput : [abilitiesInput];
        let addedCount = 0;
        for (const entry of entries) {
            if (this.addDeclinedAbility(entry)) {
                addedCount += 1;
            }
        }
        return addedCount;
    }

    clearDeclinedAbilities() {
        if (!this.#declinedAbilities.length) {
            return;
        }
        this.#declinedAbilities = [];
        this.#lastUpdated = new Date().toISOString();
    }

    getPendingAbilityOptionsByLevel() {
        const snapshot = {};
        for (const [level, abilities] of this.#pendingAbilityOptionsByLevel.entries()) {
            snapshot[level] = Array.isArray(abilities)
                ? abilities.map(ability => structuredClone(ability))
                : [];
        }
        return snapshot;
    }

    getPendingAbilityAttachmentDraftsByLevel() {
        return Object.fromEntries([...this.#pendingAbilityAttachmentDraftsByLevel.entries()]
            .map(([level, drafts]) => [level, structuredClone(drafts)]));
    }

    getPendingAbilityAttachmentDraftsForLevel(level) {
        const parsedLevel = Number(level);
        if (!Number.isInteger(parsedLevel) || parsedLevel <= 0) throw new Error(`Invalid pending ability draft level ${level}.`);
        return structuredClone(this.#pendingAbilityAttachmentDraftsByLevel.get(parsedLevel) || []);
    }

    setPendingAbilityAttachmentDraftsForLevel(level, drafts) {
        const parsedLevel = Number(level);
        if (!Number.isInteger(parsedLevel) || parsedLevel <= 0) throw new Error(`Invalid pending ability draft level ${level}.`);
        const normalized = this.#normalizePendingAbilityAttachmentDraftsByLevel({ [parsedLevel]: drafts });
        Player.registerAbilityIdentities({ pendingAbilityAttachmentDraftsByLevel: normalized });
        if (normalized.has(parsedLevel)) this.#pendingAbilityAttachmentDraftsByLevel.set(parsedLevel, normalized.get(parsedLevel));
        else this.#pendingAbilityAttachmentDraftsByLevel.delete(parsedLevel);
        this.#lastUpdated = new Date().toISOString();
        return this.getPendingAbilityAttachmentDraftsForLevel(parsedLevel);
    }

    getPendingAbilityOptionsForLevel(level) {
        const parsedLevel = Number.parseInt(level, 10);
        if (!Number.isInteger(parsedLevel) || parsedLevel <= 0) {
            throw new Error(`Pending ability level must be a positive integer. Received: ${level}`);
        }
        const abilities = this.#pendingAbilityOptionsByLevel.get(parsedLevel);
        if (!Array.isArray(abilities)) {
            return [];
        }
        return abilities.map(ability => structuredClone(ability));
    }

    setPendingAbilityOptionsForLevel(level, abilitiesInput = []) {
        const parsedLevel = Number.parseInt(level, 10);
        if (!Number.isInteger(parsedLevel) || parsedLevel <= 0) {
            throw new Error(`Pending ability level must be a positive integer. Received: ${level}`);
        }
        const normalizedAbilities = this.#normalizeAbilities(abilitiesInput);
        this.#pendingAbilityAttachmentDraftsByLevel.delete(parsedLevel);
        if (!normalizedAbilities.length) {
            this.#pendingAbilityOptionsByLevel.delete(parsedLevel);
        } else {
            this.#pendingAbilityOptionsByLevel.set(parsedLevel, normalizedAbilities);
        }
        this.#lastUpdated = new Date().toISOString();
        return this.getPendingAbilityOptionsForLevel(parsedLevel);
    }

    clearPendingAbilityOptionsForLevel(level) {
        const parsedLevel = Number.parseInt(level, 10);
        if (!Number.isInteger(parsedLevel) || parsedLevel <= 0) {
            throw new Error(`Pending ability level must be a positive integer. Received: ${level}`);
        }
        const removed = this.#pendingAbilityOptionsByLevel.delete(parsedLevel);
        this.#pendingAbilityAttachmentDraftsByLevel.delete(parsedLevel);
        if (removed) {
            this.#lastUpdated = new Date().toISOString();
        }
        return removed;
    }

    clearPendingAbilityOptions() {
        if (this.#pendingAbilityOptionsByLevel.size === 0 && this.#pendingAbilityAttachmentDraftsByLevel.size === 0) {
            return;
        }
        this.#pendingAbilityOptionsByLevel.clear();
        this.#pendingAbilityAttachmentDraftsByLevel.clear();
        this.#lastUpdated = new Date().toISOString();
    }

    getSkillValue(skillName) {
        if (typeof skillName !== 'string') {
            return null;
        }
        return this.#skills.get(skillName.trim()) ?? null;
    }

    getSkillModifiers(skillName, { includeEquipped = true } = {}) {
        if (typeof skillName !== 'string') {
            throw new Error('getSkillModifiers requires a skill name string');
        }
        const normalizedSkill = skillName.trim().toLowerCase();
        if (!normalizedSkill) {
            throw new Error('getSkillModifiers requires a non-empty skill name');
        }

        const results = [];
        const collect = (effect, sourceLabel) => {
            if (!effect) return;
            const skills = Array.isArray(effect.skills) ? effect.skills : [];
            for (const entry of skills) {
                if (!entry || typeof entry.skill !== 'string') {
                    continue;
                }
                const entryName = entry.skill.trim().toLowerCase();
                if (!entryName || entryName !== normalizedSkill) {
                    continue;
                }
                const modifier = Number(entry.modifier);
                if (!Number.isFinite(modifier)) {
                    continue;
                }
                const effectName = effect.name || effect.description || sourceLabel || 'Status Effect';
                results.push({ effectName, modifier });
            }
        };

        const activeStatuses = includeEquipped ? this.getStatusEffects() : [...(this.#statusEffects ?? []), ...this.#getAbilityStatusEffects(), ...this.#getNeedBarStatusEffects()];
        for (const effect of activeStatuses) collect(effect, 'status');

        const location = this.location;
        if (location && typeof location.getStatusEffects === 'function') {
            const locEffects = location.getStatusEffects();
            if (Array.isArray(locEffects)) {
                locEffects.forEach(locEffect => collect(locEffect, 'location'));
            }
        }

        const activeEffects = [
            ...activeStatuses,
            ...(Array.isArray(this.location?.getStatusEffects?.()) ? this.location.getStatusEffects() : [])
        ];
        const baseSkill = [...this.#skills.entries()].find(([name]) => name.toLowerCase() === normalizedSkill)?.[1] ?? 0;
        const flatTotal = baseSkill + results.reduce((sum, entry) => sum + entry.modifier, 0);
        for (const effect of activeEffects) for (const entry of effect.skills ?? []) {
            if (entry.skill.toLowerCase() !== normalizedSkill || entry.percentModifier === undefined) continue;
            results.push({ effectName: effect.name || effect.description || 'Status Effect', modifier: flatTotal * entry.percentModifier / 100, percentModifier: entry.percentModifier });
        }

        return results;
    }

    setSkillValue(skillName, value) {
        if (typeof skillName !== 'string') {
            return false;
        }
        const trimmed = skillName.trim();
        if (!trimmed) {
            return false;
        }
        if (Player.availableSkills.size > 0 && !Player.availableSkills.has(trimmed)) {
            return false;
        }
        const numeric = Number(value);
        const resolved = Number.isFinite(numeric) ? numeric : 1;
        this.#skills.set(trimmed, resolved);
        this.#lastUpdated = new Date().toISOString();
        return true;
    }

    setAbilities(abilitiesInput = []) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.setAbilities(abilitiesInput));
        const previousMaxHealth = this.maxHealth;
        const previousAbilities = this.#abilities;
        const previousHealth = this.#health;
        const existing = this.#abilityRecords();
        const inputs = Array.isArray(abilitiesInput) ? abilitiesInput : Object.values(abilitiesInput || {});
        const normalized = this.#normalizeAbilities(inputs.map(input => {
            const value = typeof input === 'string' ? { name: input } : input;
            if (!value || typeof value !== 'object') return value;
            const matches = existing.filter(ability => value.id ? ability.id === value.id : ability.name.toLowerCase() === String(value.name || '').trim().toLowerCase());
            const identities = new Set(matches.map(ability => ability.id));
            if (identities.size > 1 && !value.id) throw new Error(`Ability '${value.name}' has ambiguous identity; provide its id.`);
            const previous = matches[0];
            return previous ? { id: previous.id, imageId: previous.imageId, imagePrompt: previous.imagePrompt, ...value, statusEffects: value.statusEffects === undefined ? previous.statusEffects : value.statusEffects } : value;
        }));
        require('./TechniqueService.js').validateStatusGrants([...this.#statusEffects, ...normalized.flatMap(ability => ability.statusEffects ?? [])]);
        try {
            this.#abilities = normalized;
            this.#reconcileHealthAfterStatusEffectChange({ previousMaxHealth, suppressTimestamp: true });
        } catch (error) {
            this.#abilities = previousAbilities;
            this.#health = previousHealth;
            throw error;
        }
        this.#lastUpdated = new Date().toISOString();
        return this.getAbilities();
    }

    addAbility(abilityInput) {
        const current = this.getAbilities();
        current.push(abilityInput);
        return this.setAbilities(current);
    }

    getCurrency() {
        return this.#currency;
    }

    setCurrency(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            throw new Error('Currency must be a finite number');
        }

        const sanitized = Math.max(0, Math.floor(numeric));
        this.#currency = sanitized;
        this.#lastUpdated = new Date().toISOString();
        return this.#currency;
    }

    adjustCurrency(delta) {
        const numeric = Number(delta);
        if (!Number.isFinite(numeric)) {
            return this.#currency;
        }

        const updated = Math.max(0, Math.floor(this.#currency + numeric));
        this.#currency = updated;
        this.#lastUpdated = new Date().toISOString();
        return this.#currency;
    }

    getUnspentSkillPoints() {
        const state = this.#evaluatePointPoolState(this.#level);
        const remaining = Number(state?.skillRemaining);
        if (!Number.isFinite(remaining)) {
            throw new Error('Skill point remaining value must be finite.');
        }
        return Math.floor(remaining);
    }

    getUnspentAttributePoints() {
        const state = this.#evaluatePointPoolState(this.#level);
        const remaining = Number(state?.attributeRemaining);
        if (!Number.isFinite(remaining)) {
            throw new Error('Attribute point remaining value must be finite.');
        }
        return Math.floor(remaining);
    }

    setUnspentSkillPoints(value) {
        throw new Error('Unspent skill points are formula-derived and cannot be set directly.');
    }

    setUnspentAttributePoints(value) {
        throw new Error('Unspent attribute points are formula-derived and cannot be set directly.');
    }

    adjustUnspentSkillPoints(delta) {
        throw new Error('Unspent skill points are formula-derived and cannot be adjusted directly.');
    }

    adjustUnspentAttributePoints(delta) {
        throw new Error('Unspent attribute points are formula-derived and cannot be adjusted directly.');
    }

    increaseSkill(skillName, amount = 1) {
        if (typeof skillName !== 'string') {
            throw new Error('Skill name must be a string');
        }
        const trimmed = skillName.trim();
        if (!trimmed) {
            throw new Error('Skill name cannot be empty');
        }
        if (Player.availableSkills.size > 0 && !Player.availableSkills.has(trimmed)) {
            throw new Error(`Unknown skill: ${trimmed}`);
        }

        const numeric = Number(amount);
        if (!Number.isInteger(numeric) || numeric <= 0) {
            throw new Error('Amount must be a positive integer');
        }

        if (this.getUnspentSkillPoints() < numeric) {
            throw new Error('Not enough unspent skill points');
        }

        const current = this.#skills.get(trimmed) ?? 0;
        this.#skills.set(trimmed, current + numeric);
        this.#lastUpdated = new Date().toISOString();
        return this.#skills.get(trimmed);
    }

    syncSkillsWithAvailable() {
        const available = Player.availableSkills instanceof Map ? Player.availableSkills : new Map();
        let updated = false;

        for (const [skillName] of available) {
            if (!this.#skills.has(skillName)) {
                this.#skills.set(skillName, 1);
                updated = true;
            }
        }

        if (available.size > 0) {
            for (const skillName of Array.from(this.#skills.keys())) {
                if (!available.has(skillName)) {
                    this.#skills.delete(skillName);
                    updated = true;
                }
            }
        }

        if (updated) {
            this.#lastUpdated = new Date().toISOString();
        }
    }

    static setAvailableSkills(skillsInput) {
        const nextMap = new Map();

        const coerceSkill = (name, value) => {
            if (value instanceof Skill) {
                return value;
            }
            if (value && typeof value === 'object') {
                try {
                    return Skill.fromJSON({
                        name: value.name || name,
                        description: value.description || '',
                        attribute: value.attribute || ''
                    });
                } catch (_) {
                    return new Skill({ name: name, description: '', attribute: '' });
                }
            }
            return new Skill({ name: name, description: '', attribute: '' });
        };

        if (skillsInput instanceof Map) {
            for (const [name, value] of skillsInput.entries()) {
                if (typeof name !== 'string') continue;
                const trimmed = name.trim();
                if (!trimmed) continue;
                nextMap.set(trimmed, coerceSkill(trimmed, value));
            }
        } else if (Array.isArray(skillsInput)) {
            for (const value of skillsInput) {
                if (!value) continue;
                const name = typeof value.name === 'string' ? value.name.trim() : '';
                if (!name) continue;
                nextMap.set(name, coerceSkill(name, value));
            }
        } else if (skillsInput && typeof skillsInput === 'object') {
            for (const [name, value] of Object.entries(skillsInput)) {
                if (typeof name !== 'string') continue;
                const trimmed = name.trim();
                if (!trimmed) continue;
                nextMap.set(trimmed, coerceSkill(trimmed, value));
            }
        }

        if (this.#needBarDefinitions && nextMap.size) NeedBarStatusEffects.validateReferences(this.#needBarDefinitions, { skills: nextMap });
        Player.availableSkills = nextMap;
    }

    static getAvailableSkills() {
        return new Map(Player.availableSkills);
    }

    /**
     * Get available attribute generation methods from definitions
     */
    getGenerationMethods() {
        return this.systemConfig.generationMethods ?? {};
    }

    /**
     * Generate attributes using a specific method
     */
    generateAttributes(method = 'standard', diceModule = null) {
        if (this.#needsNeedBarBoundary()) return this.withNeedBarMutation(() => this.generateAttributes(method, diceModule));
        const methods = this.getGenerationMethods();
        const generationMethod = methods[method];

        if (!generationMethod) {
            throw new Error(`Unknown generation method: ${method}`);
        }

        const attrNames = this.getAttributeNames();
        const newAttributes = {};

        switch (method) {
            case 'standard':
                // Assign standard array values randomly
                const values = [...generationMethod.values];
                for (const attrName of attrNames) {
                    if (values.length === 0) break;
                    const randomIndex = Math.floor(Math.random() * values.length);
                    newAttributes[attrName] = values.splice(randomIndex, 1)[0];
                }
                break;

            case 'rolled':
                // Roll dice for each attribute
                if (!diceModule) {
                    throw new Error('Dice module required for rolled generation');
                }
                for (const attrName of attrNames) {
                    newAttributes[attrName] = diceModule.rollDice(generationMethod.method).total;
                }
                break;

            case 'pointBuy':
                // Start with base values (point buy would need a UI)
                for (const attrName of attrNames) {
                    newAttributes[attrName] = generationMethod.baseValue;
                }
                break;

            default:
                throw new Error(`Generation method '${method}' not implemented`);
        }

        // Apply the generated attributes
        for (const [attrName, value] of Object.entries(newAttributes)) {
            if (this.#attributes.hasOwnProperty(attrName)) {
                this.setAttribute(attrName, value);
            }
        }

        return newAttributes;
    }

    #processExperienceOverflow(raw = false) {
        const threshold = Player.#experienceThreshold;
        const multiplier = Player.#experienceRolloverMultiplier;

        let levels = 0;
        while (this.#experience >= threshold) {
            levels += 1;
            const excess = Math.max(0, this.#experience - threshold);
            if (!raw) {
                this.#experience = excess * multiplier;
            } else {
                this.#experience = excess;
            }
        }
        if (levels > 0) {
            this.levelUp(levels);
        }
        return levels;
    }

    #scaleExperienceAwardForLevel(amount) {
        if (!Number.isFinite(amount) || amount <= 0) {
            return amount;
        }

        const currentLevel = Number(this.#level);
        if (!Number.isFinite(currentLevel) || currentLevel <= 1) {
            return amount;
        }

        return amount / (currentLevel / 2);
    }

    /**
     * Get a summary string of the player
     */
    toString() {
        return this.#name;
    }

    finalizeTurn() {
        //console.log(`Finalizing turn for player ${this.#name} (${this.#id})`);
        // Handle corpse countdown if dead
        if (this.#isDead && !this.#persistWhenDead && this.#corpseCountdown > 0) {
            this.#corpseCountdown -= 1;
        }

        if (this.#checkEquipment) {
            Player.#notifyNpcInventoryChange(this);
        }
        this.#checkEquipment = false;

        // Reset turn-based flags
        this.#lastActionWasTravel = false;
        this.#partyMembershipChangedThisTurn = false;
        this.#partyMembersAddedThisTurn.clear();
        this.#partyMembersRemovedThisTurn.clear();
        this.#lastUpdated = new Date().toISOString();
    }
}

module.exports = Player;
