const { randomUUID } = require('crypto');
const Player = require('./Player.js');
const Quest = require('./Quest.js');
const { resolveQuestDispositionRewardDelta } = require('./quest_disposition_reward_delta.js');

class QuestConfirmationManager {
    constructor({ timeoutMs = null } = {}) {
        if (timeoutMs !== null && timeoutMs !== undefined
            && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
            throw new Error('QuestConfirmationManager timeoutMs must be a finite, non-negative number.');
        }
        // Kept for configuration compatibility. Offers now remain pending until
        // an explicit accept or decline and therefore never start a timeout.
        this.pending = new Map();
    }

    requestConfirmation({ quest, preview = null, playerId, requestId = null, parentId = null, locationId = null } = {}) {
        const normalizedPlayerId = this.#requiredString(playerId, 'Quest confirmation requires a valid playerId.');
        if (!Player.getById(normalizedPlayerId)) {
            throw new Error(`Quest confirmation player "${normalizedPlayerId}" was not found.`);
        }
        const questCandidate = this.#normalizeQuestCandidate(quest);
        const questPayload = this.#normalizeQuestPayload(preview || questCandidate);
        const confirmationId = randomUUID();
        const record = {
            confirmationId,
            playerId: normalizedPlayerId,
            quest: questCandidate,
            preview: questPayload,
            requestId: this.#optionalString(requestId),
            parentId: this.#optionalString(parentId),
            locationId: this.#optionalString(locationId),
            chatEntryId: null,
            createdAt: new Date().toISOString()
        };
        this.pending.set(confirmationId, record);
        return this.#toPublicRecord(record);
    }

    attachChatEntry(confirmationId, { chatEntryId, parentId = null, locationId = null } = {}) {
        const record = this.#getRequiredPending(confirmationId);
        record.chatEntryId = this.#requiredString(chatEntryId, 'Quest confirmation chatEntryId is required.');
        record.parentId = this.#optionalString(parentId) || record.parentId;
        record.locationId = this.#optionalString(locationId) || record.locationId;
        return this.#toPublicRecord(record);
    }

    hasPending() {
        return this.pending.size > 0;
    }

    getPendingConfirmation(confirmationId) {
        const id = this.#optionalString(confirmationId);
        const record = id ? this.pending.get(id) : null;
        return record ? this.#toPublicRecord(record) : null;
    }

    getPendingConfirmations() {
        return Array.from(this.pending.values())
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .map(record => this.#toPublicRecord(record));
    }

    resolveConfirmation({ confirmationId, clientId, accepted } = {}) {
        const normalizedId = this.#requiredString(confirmationId, 'Quest confirmation response is missing confirmationId.');
        this.#requiredString(clientId, 'Quest confirmation response is missing clientId.');
        if (typeof accepted !== 'boolean') {
            throw new Error('Quest confirmation response must include an accepted boolean.');
        }
        const record = this.#getRequiredPending(normalizedId);
        let acceptedQuest = null;
        if (accepted) {
            const player = Player.getById(record.playerId);
            if (!player || typeof player.addQuest !== 'function') {
                throw new Error(`Quest confirmation player "${record.playerId}" is unavailable.`);
            }
            const existingQuest = typeof player.getQuestByName === 'function'
                ? player.getQuestByName(record.quest.name)
                : null;
            if (existingQuest) {
                throw new Error(`Player already has a quest named "${record.quest.name}".`);
            }
            acceptedQuest = Quest.fromJSON({ ...record.quest, id: null });
            player.addQuest(acceptedQuest);
            record.preview.id = acceptedQuest.id;
        }
        this.pending.delete(normalizedId);
        return {
            ...this.#toPublicRecord(record),
            accepted,
            questId: acceptedQuest?.id || null,
            acceptedQuest
        };
    }

    serializePending() {
        return Array.from(this.pending.values()).map(record => JSON.parse(JSON.stringify({
            confirmationId: record.confirmationId,
            playerId: record.playerId,
            quest: record.quest,
            preview: record.preview,
            requestId: record.requestId,
            parentId: record.parentId,
            locationId: record.locationId,
            chatEntryId: record.chatEntryId,
            createdAt: record.createdAt
        })));
    }

    hydratePending(records) {
        if (records === null || records === undefined) records = [];
        if (!Array.isArray(records)) {
            throw new Error('Saved pending quest confirmations must be an array.');
        }
        const hydrated = new Map();
        for (const raw of records) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                throw new Error('Saved pending quest confirmation entries must be objects.');
            }
            const confirmationId = this.#requiredString(raw.confirmationId, 'Saved quest confirmation is missing confirmationId.');
            if (hydrated.has(confirmationId)) {
                throw new Error(`Duplicate saved quest confirmation id "${confirmationId}".`);
            }
            const playerId = this.#requiredString(raw.playerId, `Saved quest confirmation "${confirmationId}" is missing playerId.`);
            const player = Player.getById(playerId);
            if (!player) {
                throw new Error(`Saved quest confirmation "${confirmationId}" references missing player "${playerId}".`);
            }
            const quest = this.#normalizeQuestCandidate(raw.quest);
            if (typeof player.getQuestByName === 'function' && player.getQuestByName(quest.name)) {
                throw new Error(`Saved quest confirmation "${confirmationId}" duplicates accepted quest "${quest.name}".`);
            }
            const preview = this.#normalizeQuestPayload(raw.preview || quest);
            const createdAt = this.#requiredString(raw.createdAt, `Saved quest confirmation "${confirmationId}" is missing createdAt.`);
            if (Number.isNaN(Date.parse(createdAt))) {
                throw new Error(`Saved quest confirmation "${confirmationId}" has an invalid createdAt timestamp.`);
            }
            hydrated.set(confirmationId, {
                confirmationId,
                playerId,
                quest,
                preview,
                requestId: this.#optionalString(raw.requestId),
                parentId: this.#optionalString(raw.parentId),
                locationId: this.#optionalString(raw.locationId),
                chatEntryId: this.#optionalString(raw.chatEntryId),
                createdAt
            });
        }
        this.pending = hydrated;
        return this.pending.size;
    }

    rejectAll(reason = 'Pending quest confirmations were cancelled.') {
        const rejected = this.pending.size;
        for (const record of this.pending.values()) {
            if (typeof record?.reject === 'function') {
                record.reject(new Error(reason));
            }
        }
        this.pending.clear();
        return rejected;
    }

    rejectAllForClient() {
        // Offers belong to the loaded game rather than a browser connection.
        return 0;
    }

    #getRequiredPending(confirmationId) {
        const record = this.pending.get(confirmationId);
        if (!record) {
            const error = new Error('Quest confirmation request not found or already resolved.');
            error.code = 'QUEST_CONFIRMATION_RESOLVED';
            throw error;
        }
        return record;
    }

    #requiredString(value, message) {
        const normalized = this.#optionalString(value);
        if (!normalized) throw new Error(message);
        return normalized;
    }

    #optionalString(value) {
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    #normalizeQuestCandidate(quest) {
        if (!quest || typeof quest !== 'object' || Array.isArray(quest)) {
            throw new Error('Quest confirmation request is missing quest details.');
        }
        let candidate;
        try {
            candidate = JSON.parse(JSON.stringify(quest));
        } catch (error) {
            throw new Error(`Quest confirmation details are not serializable: ${error.message}`);
        }
        candidate.name = this.#requiredString(candidate.name, 'Quest confirmation quest name is required.');
        candidate.description = typeof candidate.description === 'string' ? candidate.description : '';
        candidate.objectives = Array.isArray(candidate.objectives) ? candidate.objectives : [];
        candidate.rewardItems = Array.isArray(candidate.rewardItems) ? candidate.rewardItems : [];
        candidate.rewardCurrency = Number.isFinite(Number(candidate.rewardCurrency)) ? Number(candidate.rewardCurrency) : 0;
        candidate.rewardXp = Number.isFinite(Number(candidate.rewardXp)) ? Number(candidate.rewardXp) : 0;
        candidate.rewardFactionReputation = candidate.rewardFactionReputation && typeof candidate.rewardFactionReputation === 'object'
            ? candidate.rewardFactionReputation : {};
        candidate.rewardNpcDispositions = Array.isArray(candidate.rewardNpcDispositions) ? candidate.rewardNpcDispositions : [];
        candidate.rewardBenefits = Array.isArray(candidate.rewardBenefits) ? candidate.rewardBenefits : [];
        candidate.rewardNotes = Array.isArray(candidate.rewardNotes) ? candidate.rewardNotes : [];
        return candidate;
    }

    #toPublicRecord(record) {
        return {
            confirmationId: record.confirmationId,
            playerId: record.playerId,
            quest: JSON.parse(JSON.stringify(record.preview)),
            requestId: record.requestId,
            parentId: record.parentId,
            locationId: record.locationId,
            chatEntryId: record.chatEntryId,
            createdAt: record.createdAt
        };
    }

    #normalizeQuestPayload(quest) {
        if (!quest || typeof quest !== 'object') return null;
        const safeString = value => typeof value === 'string' ? value.trim() : '';
        const mapArray = (source, mapper) => Array.isArray(source)
            ? source.map(item => { try { return mapper(item); } catch (_) { return null; } }).filter(Boolean)
            : [];
        const rewardItems = mapArray(quest.rewardItems, item => {
            if (typeof item === 'string') {
                const name = safeString(item);
                return name ? { name, description: '' } : null;
            }
            const name = safeString(item?.name || item?.label);
            if (!name) return null;
            const quantity = Number.isFinite(Number(item.quantity)) ? Math.round(Number(item.quantity)) : 1;
            return { name, description: safeString(item.description), ...(quantity !== 1 ? { quantity } : {}) };
        });
        const objectives = mapArray(quest.objectives, objective => {
            const description = safeString(objective?.description);
            return description ? { description, optional: Boolean(objective.optional) } : null;
        });
        const rewardNpcDispositions = mapArray(quest.rewardNpcDispositions, entry => {
            const npcName = safeString(entry?.npcName || entry?.name || entry?.npcId || entry?.id);
            if (!npcName) return null;
            const dispositionDefinitions = typeof Player.getDispositionDefinitions === 'function' ? Player.getDispositionDefinitions() : null;
            const dispositions = mapArray(entry.dispositions, disposition => {
                const type = safeString(disposition?.type);
                const intensity = Number(disposition?.intensity ?? disposition?.amount ?? disposition?.delta ?? disposition?.value);
                if (!type || !Number.isInteger(intensity) || intensity === 0) return null;
                const delta = resolveQuestDispositionRewardDelta(intensity, dispositionDefinitions);
                return { type, intensity, delta: Number.isFinite(delta) ? delta : null, reason: safeString(disposition.reason) || null };
            });
            return dispositions.length ? { npcName, dispositions } : null;
        });
        const rewardFactionReputation = Array.isArray(quest.rewardFactionReputation)
            ? mapArray(quest.rewardFactionReputation, entry => {
                const name = safeString(entry?.name || entry?.factionName || entry?.factionId);
                const points = Number(entry?.points ?? entry?.delta ?? entry?.amount);
                return name && Number.isFinite(points) && points !== 0 ? { name, points } : null;
            })
            : Object.entries(quest.rewardFactionReputation || {}).map(([name, points]) => ({ name, points: Number(points) }))
                .filter(entry => entry.name && Number.isFinite(entry.points) && entry.points !== 0);
        const rewardBenefits = mapArray(quest.rewardBenefits, entry => {
            const id = safeString(entry?.id);
            const type = safeString(entry?.type);
            const targetId = safeString(entry?.targetId);
            const label = safeString(entry?.label);
            return id && type && targetId && label
                ? { id, type, targetId, label, description: safeString(entry.description) || null, role: safeString(entry.role) || null }
                : null;
        });
        return {
            id: safeString(quest.id),
            name: safeString(quest.name),
            description: safeString(quest.description),
            summary: safeString(quest.summary),
            giver: safeString(quest.giver || quest.giverName),
            rewardCurrency: Number.isFinite(Number(quest.rewardCurrency)) ? Number(quest.rewardCurrency) : 0,
            rewardXp: Number.isFinite(Number(quest.rewardXp)) ? Number(quest.rewardXp) : 0,
            rewardItems,
            rewardFactionReputation,
            rewardNpcDispositions,
            rewardBenefits,
            rewardNotes: mapArray(quest.rewardNotes, entry => safeString(entry) || null),
            objectives
        };
    }
}

module.exports = QuestConfirmationManager;
