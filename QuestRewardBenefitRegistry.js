function requireTrimmedString(value, fieldName) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Quest reward benefit ${fieldName} must be a non-empty string.`);
    }
    return value.trim();
}

function optionalTrimmedString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

class QuestRewardBenefitRegistry {
    constructor() {
        this.handlers = new Map();
    }

    register(type, handler) {
        const normalizedType = requireTrimmedString(type, 'type');
        if (!handler || typeof handler !== 'object') {
            throw new Error(`Quest reward benefit handler "${normalizedType}" must be an object.`);
        }
        for (const methodName of ['normalize', 'validate', 'isSatisfied', 'apply', 'summarize']) {
            if (typeof handler[methodName] !== 'function') {
                throw new Error(`Quest reward benefit handler "${normalizedType}" is missing ${methodName}().`);
            }
        }
        if (this.handlers.has(normalizedType)) {
            throw new Error(`Quest reward benefit handler "${normalizedType}" is already registered.`);
        }
        this.handlers.set(normalizedType, Object.freeze({ ...handler }));
        return this;
    }

    get(type) {
        const normalizedType = typeof type === 'string' ? type.trim() : '';
        const handler = normalizedType ? this.handlers.get(normalizedType) : null;
        if (!handler) {
            throw new Error(`Unsupported quest reward benefit type "${normalizedType || String(type)}".`);
        }
        return handler;
    }

    normalize(entry, context = {}) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error('Quest reward benefits must be objects.');
        }
        const type = requireTrimmedString(entry.type, 'type');
        const id = requireTrimmedString(entry.id, 'id');
        const normalized = this.get(type).normalize({ ...entry, id, type }, context);
        if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
            throw new Error(`Quest reward benefit handler "${type}" returned an invalid normalized value.`);
        }
        return { ...normalized, id, type };
    }

    normalizeAll(entries, context = {}) {
        if (entries === null || entries === undefined || entries === '') {
            return [];
        }
        if (!Array.isArray(entries)) {
            throw new Error('rewardBenefits must be an array.');
        }
        const seenIds = new Set();
        return entries.map((entry) => {
            const normalized = this.normalize(entry, context);
            if (seenIds.has(normalized.id)) {
                throw new Error(`Duplicate quest reward benefit id "${normalized.id}".`);
            }
            seenIds.add(normalized.id);
            return normalized;
        });
    }

    validate(entry, context = {}) {
        const normalized = this.normalize(entry, context);
        this.get(normalized.type).validate(normalized, context);
        return normalized;
    }

    validateAll(entries, context = {}) {
        return this.normalizeAll(entries, context).map(entry => this.validate(entry, context));
    }

    isSatisfied(entry, context = {}) {
        const normalized = this.validate(entry, context);
        return Boolean(this.get(normalized.type).isSatisfied(normalized, context));
    }

    summarize(entry, result = {}, context = {}) {
        const normalized = this.normalize(entry, context);
        return this.get(normalized.type).summarize(normalized, result, context);
    }

    apply(entry, context = {}) {
        const normalized = this.validate(entry, context);
        const handler = this.get(normalized.type);
        if (handler.isSatisfied(normalized, context)) {
            return {
                entry: normalized,
                alreadySatisfied: true,
                result: null,
                summary: handler.summarize(normalized, { alreadySatisfied: true }, context)
            };
        }
        const result = handler.apply(normalized, context);
        if (!handler.isSatisfied(normalized, context)) {
            throw new Error(`Quest reward benefit "${normalized.id}" did not reach its required state.`);
        }
        return {
            entry: normalized,
            alreadySatisfied: false,
            result,
            summary: handler.summarize(normalized, result, context)
        };
    }
}

function resolveActorById(targetId, context) {
    if (typeof context?.findActorById === 'function') {
        const resolved = context.findActorById(targetId);
        if (resolved) {
            return resolved;
        }
    }
    const Player = require('./Player.js');
    return typeof Player.getById === 'function' ? Player.getById(targetId) : null;
}

const partyMemberHandler = {
    normalize(entry) {
        return {
            id: entry.id,
            type: 'party-member',
            targetId: requireTrimmedString(entry.targetId, 'targetId'),
            label: requireTrimmedString(entry.label, 'label'),
            description: optionalTrimmedString(entry.description),
            role: optionalTrimmedString(entry.role)
        };
    },

    validate(entry, context) {
        const player = context?.player || null;
        if (!player || typeof player.getPartyMembers !== 'function' || typeof player.addPartyMember !== 'function') {
            throw new Error(`Quest reward benefit "${entry.id}" requires a party-owning player.`);
        }
        const target = resolveActorById(entry.targetId, context);
        if (!target) {
            throw new Error(`Quest reward benefit "${entry.id}" references missing NPC "${entry.targetId}".`);
        }
        if (target === player || target.id === player.id || target.isNPC !== true) {
            throw new Error(`Quest reward benefit "${entry.id}" target "${entry.targetId}" is not an eligible NPC.`);
        }
        if (target.isDead === true) {
            throw new Error(`Quest reward benefit "${entry.id}" cannot recruit dead NPC "${target.name || entry.targetId}".`);
        }
        return target;
    },

    isSatisfied(entry, context) {
        const partyMemberIds = context.player.getPartyMembers();
        return Array.isArray(partyMemberIds) && partyMemberIds.includes(entry.targetId);
    },

    apply(entry, context) {
        const target = this.validate(entry, context);
        const added = context.player.addPartyMember(target.id);
        if (!added && !context.player.getPartyMembers().includes(target.id)) {
            throw new Error(`Quest reward benefit "${entry.id}" could not add "${target.name || target.id}" to the party.`);
        }
        return {
            targetId: target.id,
            targetName: target.name || entry.label,
            added: Boolean(added)
        };
    },

    summarize(entry, result, context) {
        const target = resolveActorById(entry.targetId, context);
        return {
            id: entry.id,
            type: entry.type,
            label: entry.label,
            description: entry.description,
            targetId: entry.targetId,
            targetName: target?.name || result?.targetName || entry.label,
            alreadySatisfied: Boolean(result?.alreadySatisfied),
            rewardLine: `${target?.name || entry.label} joins the party`,
            refresh: {
                party: true,
                actorIds: [entry.targetId]
            }
        };
    }
};

const questRewardBenefitRegistry = new QuestRewardBenefitRegistry();
questRewardBenefitRegistry.register('party-member', partyMemberHandler);

module.exports = {
    QuestRewardBenefitRegistry,
    questRewardBenefitRegistry
};
