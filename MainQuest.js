'use strict';

const IdGenerator = require('./IdGenerator.js');

const STATUSES = Object.freeze(['active', 'completed', 'abandoned']);
const STAGE_STATUSES = Object.freeze(['pending', 'active', 'completed', 'skipped']);
const OFFER_STATES = Object.freeze(['pending', 'declined', 'started']);
const ROLE_BINDING_TYPES = Object.freeze(['npc', 'faction']);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function requireText(value, label) {
    const normalized = text(value);
    if (!normalized) {
        throw new Error(`${label} must be a non-empty string.`);
    }
    return normalized;
}

function optionalText(value, label) {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
    return value.trim();
}

function textList(value, label) {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`${label} must be an array of strings.`);
    return value.map((entry, index) => requireText(entry, `${label}[${index}]`));
}

function nonNegativeInteger(value, label, fallback = 0) {
    if (value === null || value === undefined) return fallback;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new Error(`${label} must be a whole number of 0 or more.`);
    }
    return number;
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeBinding(value, label) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be null or { type, id, name }.`);
    }
    const type = text(value.type);
    if (!ROLE_BINDING_TYPES.includes(type)) {
        throw new Error(`${label}.type "${value.type}" is invalid. Use one of: ${ROLE_BINDING_TYPES.join(', ')}.`);
    }
    return { type, id: requireText(value.id, `${label}.id`), name: optionalText(value.name, `${label}.name`) };
}

function normalizeRole(raw, index) {
    const label = `Main quest role ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object.`);
    const key = requireText(raw.key, `${label}.key`);
    return {
        key,
        description: requireText(raw.description, `Main quest role "${key}".description`),
        boundTo: normalizeBinding(raw.boundTo, `Main quest role "${key}".boundTo`),
        history: Array.isArray(raw.history) ? clone(raw.history) : []
    };
}

function normalizeStageDetail(raw, label) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be null or an object.`);
    return {
        objective: requireText(raw.objective, `${label}.objective`),
        hiddenDirection: requireText(raw.hiddenDirection, `${label}.hiddenDirection`),
        hooks: textList(raw.hooks, `${label}.hooks`)
    };
}

function normalizeStage(raw, index) {
    const label = `Main quest stage ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object.`);
    const status = text(raw.status) || 'pending';
    if (!STAGE_STATUSES.includes(status)) {
        throw new Error(`${label}.status "${raw.status}" is invalid. Use one of: ${STAGE_STATUSES.join(', ')}.`);
    }
    return {
        id: text(raw.id) || `stage_${index + 1}`,
        title: requireText(raw.title, `${label}.title`),
        outline: requireText(raw.outline, `${label}.outline`),
        exitCondition: requireText(raw.exitCondition, `${label}.exitCondition`),
        detail: normalizeStageDetail(raw.detail, `${label}.detail`),
        questId: text(raw.questId) || null,
        status,
        outcome: optionalText(raw.outcome, `${label}.outcome`)
    };
}

function normalizeEnding(raw, index) {
    const label = `Main quest ending ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object.`);
    return {
        id: text(raw.id) || `ending_${index + 1}`,
        description: requireText(raw.description, `${label}.description`)
    };
}

function normalizePressure(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const ids = (value, label) => {
        if (value === null || value === undefined) return [];
        if (!Array.isArray(value)) throw new Error(`Main quest pressure.${label} must be an array of ids.`);
        return value.map((entry, index) => requireText(entry, `Main quest pressure.${label}[${index}]`));
    };
    return {
        playerFacingText: optionalText(source.playerFacingText, 'Main quest pressure.playerFacingText'),
        trackerIds: ids(source.trackerIds, 'trackerIds'),
        scheduledEventIds: ids(source.scheduledEventIds, 'scheduledEventIds')
    };
}

class MainQuest {
    static #instances = new Map();
    static #offer = { state: 'pending', followUpOf: null };

    constructor(options = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new Error('MainQuest requires an options object.');
        }
        const title = requireText(options.title, 'Main quest title');
        const status = text(options.status) || 'active';
        if (!STATUSES.includes(status)) {
            throw new Error(`Main quest status "${options.status}" is invalid. Use one of: ${STATUSES.join(', ')}.`);
        }
        if (!Array.isArray(options.stages) || !options.stages.length) {
            throw new Error(`Main quest "${title}" needs at least one stage.`);
        }
        const stages = options.stages.map(normalizeStage);
        const stageIds = new Set();
        for (const stage of stages) {
            if (stageIds.has(stage.id)) throw new Error(`Main quest "${title}" has duplicate stage id "${stage.id}".`);
            stageIds.add(stage.id);
        }
        const currentStageIndex = nonNegativeInteger(options.currentStageIndex, 'Main quest currentStageIndex');
        if (currentStageIndex >= stages.length) {
            throw new Error(`Main quest "${title}" currentStageIndex ${currentStageIndex} is past its ${stages.length} stages.`);
        }
        const endings = Array.isArray(options.endings) ? options.endings.map(normalizeEnding) : [];
        if (!endings.length) throw new Error(`Main quest "${title}" needs at least one possible ending.`);
        const antagonist = options.antagonist && typeof options.antagonist === 'object' ? options.antagonist : {};

        const id = text(options.id) || IdGenerator.next('mainQuest', title);
        if (status === 'active') {
            const active = MainQuest.getActive();
            if (active && active.id !== id) {
                throw new Error(`Main quest "${active.title}" is already active. Complete or abandon it before starting another.`);
            }
        }

        this.id = id;
        this.title = title;
        this.playerGoal = optionalText(options.playerGoal, 'Main quest playerGoal') || null;
        this.premise = requireText(options.premise, 'Main quest premise');
        this.hiddenTruth = requireText(options.hiddenTruth, 'Main quest hiddenTruth');
        this.antagonist = {
            description: requireText(antagonist.description, 'Main quest antagonist.description'),
            factionId: text(antagonist.factionId) || null,
            npcId: text(antagonist.npcId) || null
        };
        this.roles = Array.isArray(options.roles) ? options.roles.map(normalizeRole) : [];
        this.stages = stages;
        this.currentStageIndex = currentStageIndex;
        this.lockedFacts = textList(options.lockedFacts, 'Main quest lockedFacts');
        this.endings = endings;
        this.reachedEnding = options.reachedEnding
            ? {
                endingId: text(options.reachedEnding.endingId) || null,
                description: requireText(options.reachedEnding.description, 'Main quest reachedEnding.description')
            }
            : null;
        this.pressure = normalizePressure(options.pressure);
        this.status = status;
        this.mode = text(options.mode) || 'new';
        this.previousMainQuestId = text(options.previousMainQuestId) || null;
        this.turnsSinceProgress = nonNegativeInteger(options.turnsSinceProgress, 'Main quest turnsSinceProgress');
        this.outcomeLog = Array.isArray(options.outcomeLog) ? clone(options.outcomeLog) : [];
        this.createdAt = text(options.createdAt) || new Date().toISOString();
        this.updatedAt = text(options.updatedAt) || this.createdAt;
        this.completedAt = text(options.completedAt) || null;

        IdGenerator.register('mainQuest', id);
        MainQuest.#instances.set(id, this);
    }

    get currentStage() {
        return this.stages[this.currentStageIndex] || null;
    }

    get nextStage() {
        return this.stages[this.currentStageIndex + 1] || null;
    }

    touch() {
        this.updatedAt = new Date().toISOString();
    }

    setStageDetail(stageId, detail) {
        const stage = this.stages.find(entry => entry.id === stageId);
        if (!stage) throw new Error(`Main quest "${this.title}" has no stage "${stageId}".`);
        stage.detail = normalizeStageDetail(detail, `Main quest stage "${stageId}".detail`);
        this.touch();
    }

    /** Replaces pending (not yet started) stages after the current one, keeping completed history. */
    replanFutureStages(stages) {
        const kept = this.stages.slice(0, this.currentStageIndex + 1);
        const replanned = stages.map((stage, offset) => normalizeStage({
            ...stage,
            id: `stage_${kept.length + offset + 1}`,
            status: 'pending',
            questId: null
        }, kept.length + offset));
        this.stages = [...kept, ...replanned];
        this.touch();
    }

    replaceEndings(endings) {
        const normalized = endings.map(normalizeEnding);
        if (!normalized.length) throw new Error(`Main quest "${this.title}" needs at least one possible ending.`);
        this.endings = normalized;
        this.touch();
    }

    addLockedFacts(facts) {
        for (const fact of textList(facts, 'Main quest lockedFacts')) {
            if (!this.lockedFacts.some(existing => existing.toLowerCase() === fact.toLowerCase())) {
                this.lockedFacts.push(fact);
            }
        }
        this.touch();
    }

    bindRole(key, boundTo, reason = '') {
        const role = this.roles.find(entry => entry.key === key);
        if (!role) {
            throw new Error(`Main quest "${this.title}" has no role "${key}". Roles: ${this.roles.map(entry => entry.key).join(', ') || 'none'}.`);
        }
        const binding = normalizeBinding(boundTo, `Main quest role "${key}".boundTo`);
        role.history.push({ from: role.boundTo, to: binding, reason: text(reason), at: new Date().toISOString() });
        role.boundTo = binding;
        this.touch();
    }

    recordOutcome(stageId, summary, worldMinute) {
        this.outcomeLog.push({ stageId, summary: requireText(summary, 'Main quest outcome summary'), worldMinute: nonNegativeInteger(worldMinute, 'worldMinute') });
        this.touch();
    }

    toJSON() {
        return clone({
            id: this.id,
            title: this.title,
            playerGoal: this.playerGoal,
            premise: this.premise,
            hiddenTruth: this.hiddenTruth,
            antagonist: this.antagonist,
            roles: this.roles,
            stages: this.stages,
            currentStageIndex: this.currentStageIndex,
            lockedFacts: this.lockedFacts,
            endings: this.endings,
            reachedEnding: this.reachedEnding,
            pressure: this.pressure,
            status: this.status,
            mode: this.mode,
            previousMainQuestId: this.previousMainQuestId,
            turnsSinceProgress: this.turnsSinceProgress,
            outcomeLog: this.outcomeLog,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            completedAt: this.completedAt
        });
    }

    /** What the player may see: no hidden truth, future stages, endings or stage count. */
    toPlayerView() {
        const stage = this.currentStage;
        return {
            id: this.id,
            title: this.title,
            premise: this.premise,
            playerGoal: this.playerGoal,
            status: this.status,
            currentStage: this.status === 'active' && stage
                ? { id: stage.id, title: stage.title, objective: stage.detail?.objective || stage.title, questId: stage.questId }
                : null,
            completedStages: this.stages
                .filter(entry => entry.status === 'completed' || entry.status === 'skipped')
                .map(entry => ({ id: entry.id, title: entry.title, outcome: entry.outcome })),
            pressure: this.status === 'active' ? this.pressure.playerFacingText : '',
            reachedEnding: this.reachedEnding ? this.reachedEnding.description : null,
            previousMainQuestId: this.previousMainQuestId,
            createdAt: this.createdAt,
            completedAt: this.completedAt
        };
    }

    static get statuses() { return [...STATUSES]; }
    static get offerStates() { return [...OFFER_STATES]; }

    static getById(id) {
        return MainQuest.#instances.get(text(id)) || null;
    }

    static getAll() {
        return Array.from(MainQuest.#instances.values());
    }

    static removeById(id) {
        return MainQuest.#instances.delete(text(id));
    }

    static getActive() {
        return MainQuest.getAll().find(entry => entry.status === 'active') || null;
    }

    static findByQuestId(questId) {
        const id = text(questId);
        if (!id) return null;
        for (const mainQuest of MainQuest.#instances.values()) {
            const stage = mainQuest.stages.find(entry => entry.questId === id);
            if (stage) return { mainQuest, stage };
        }
        return null;
    }

    static getOffer() {
        return { ...MainQuest.#offer };
    }

    static setOffer({ state, followUpOf = null } = {}) {
        if (!OFFER_STATES.includes(state)) {
            throw new Error(`Main quest offer state "${state}" is invalid. Use one of: ${OFFER_STATES.join(', ')}.`);
        }
        const followUp = text(followUpOf) || null;
        if (followUp && !MainQuest.getById(followUp)) {
            throw new Error(`Main quest offer followUpOf "${followUp}" does not match a saved main quest.`);
        }
        MainQuest.#offer = { state, followUpOf: followUp };
    }

    /** New game: no main quests, and the start popup is due. */
    static reset() {
        MainQuest.#instances.clear();
        MainQuest.#offer = { state: 'pending', followUpOf: null };
    }

    static clear() {
        MainQuest.reset();
    }

    static serializeAll() {
        return {
            offer: MainQuest.getOffer(),
            mainQuests: Object.fromEntries(MainQuest.getAll().map(entry => [entry.id, entry.toJSON()]))
        };
    }

    /** Older saves have no payload: the popup is due once, as for a new game. */
    static loadAll(payload = null) {
        MainQuest.reset();
        if (payload === null || payload === undefined) {
            return;
        }
        if (typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('mainQuests.json must be an object with offer and mainQuests.');
        }
        const records = payload.mainQuests ?? {};
        if (!records || typeof records !== 'object' || Array.isArray(records)) {
            throw new Error('mainQuests.json mainQuests must be an object map keyed by main quest id.');
        }
        const ordered = Object.entries(records).sort(([, left], [, right]) =>
            (left?.status === 'active' ? 1 : 0) - (right?.status === 'active' ? 1 : 0));
        for (const [id, record] of ordered) {
            if (!record || typeof record !== 'object' || Array.isArray(record)) {
                throw new Error(`mainQuests.json entry "${id}" must be an object.`);
            }
            new MainQuest({ ...record, id: text(record.id) || id });
        }
        const offer = payload.offer ?? { state: 'pending', followUpOf: null };
        MainQuest.setOffer(offer);
    }
}

module.exports = MainQuest;
