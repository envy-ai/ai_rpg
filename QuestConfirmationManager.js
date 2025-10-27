const { randomUUID } = require('crypto');
const Globals = require('./Globals.js');

class QuestConfirmationManager {
    constructor({ timeoutMs = null } = {}) {
        if (timeoutMs === null || timeoutMs === undefined) {
            this.timeoutMs = null;
        } else if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
            throw new Error('QuestConfirmationManager timeoutMs must be a finite, non-negative number.');
        } else if (timeoutMs === 0) {
            this.timeoutMs = null;
        } else {
            this.timeoutMs = timeoutMs;
        }

        this.pending = new Map();
    }

    requestConfirmation({ clientId, quest, requestId = null }) {
        const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : '';
        if (!normalizedClientId) {
            throw new Error('Quest confirmation requires a valid clientId.');
        }

        const questPayload = this.#normalizeQuestPayload(quest);
        if (!questPayload) {
            throw new Error('Quest confirmation request is missing quest details.');
        }

        const confirmationId = randomUUID();

        return new Promise((resolve, reject) => {
            let timeoutHandle = null;

            if (this.timeoutMs) {
                timeoutHandle = setTimeout(() => {
                    this.pending.delete(confirmationId);
                    reject(new Error('Quest confirmation timed out.'));
                }, this.timeoutMs);
            }

            this.pending.set(confirmationId, {
                resolve,
                reject,
                timeout: timeoutHandle,
                clientId: normalizedClientId
            });

            const emitted = Globals.emitToClient(normalizedClientId, 'quest_confirmation_request', {
                confirmationId,
                quest: questPayload
            }, { requestId });

            if (!emitted) {
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
                this.pending.delete(confirmationId);
                reject(new Error('Unable to deliver quest confirmation request to client.'));
            }
        });
    }

    resolveConfirmation({ confirmationId, clientId, accepted }) {
        const normalizedId = typeof confirmationId === 'string' ? confirmationId.trim() : '';
        if (!normalizedId) {
            throw new Error('Quest confirmation response is missing confirmationId.');
        }

        const pending = this.pending.get(normalizedId);
        if (!pending) {
            throw new Error('Quest confirmation request not found or already resolved.');
        }

        const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : '';
        if (!normalizedClientId) {
            throw new Error('Quest confirmation response is missing clientId.');
        }

        if (pending.clientId !== normalizedClientId) {
            throw new Error('Quest confirmation response does not match the original client.');
        }

        this.pending.delete(normalizedId);
        if (pending.timeout) {
            clearTimeout(pending.timeout);
        }
        pending.resolve(Boolean(accepted));
        return { accepted: Boolean(accepted) };
    }

    rejectAllForClient(clientId, reason = 'Client disconnected') {
        const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : '';
        if (!normalizedClientId) {
            return;
        }

        for (const [id, pending] of this.pending.entries()) {
            if (pending.clientId === normalizedClientId) {
                if (pending.timeout) {
                    clearTimeout(pending.timeout);
                }
                pending.reject(new Error(reason));
                this.pending.delete(id);
            }
        }
    }

    #normalizeQuestPayload(quest) {
        if (!quest || typeof quest !== 'object') {
            return null;
        }

        const safeString = (value) => {
            if (typeof value !== 'string') {
                return '';
            }
            const trimmed = value.trim();
            return trimmed.length ? trimmed : '';
        };

        const mapArray = (source, mapper) => {
            if (!Array.isArray(source)) {
                return [];
            }
            return source
                .map(item => {
                    try {
                        return mapper(item);
                    } catch (_) {
                        return null;
                    }
                })
                .filter(Boolean);
        };

        const rewardItems = mapArray(quest.rewardItems, item => {
            if (typeof item === 'string') {
                const normalized = safeString(item);
                return normalized ? { name: normalized } : null;
            }
            if (item && typeof item === 'object') {
                const name = safeString(item.name || item.description || item.label);
                if (!name) {
                    return null;
                }
                const quantity = Number.isFinite(item.quantity) ? item.quantity : null;
                return quantity && quantity !== 1
                    ? { name, quantity: Math.max(1, Math.round(quantity)) }
                    : { name };
            }
            return null;
        });

        const objectives = mapArray(quest.objectives, obj => {
            if (!obj || typeof obj !== 'object') {
                return null;
            }
            const description = safeString(obj.description);
            if (!description) {
                return null;
            }
            return {
                description,
                optional: Boolean(obj.optional)
            };
        });

        const rewardCurrency = Number.isFinite(quest.rewardCurrency) ? quest.rewardCurrency : 0;
        const rewardXp = Number.isFinite(quest.rewardXp) ? quest.rewardXp : 0;

        return {
            id: safeString(quest.id),
            name: safeString(quest.name),
            description: safeString(quest.description),
            summary: safeString(quest.summary),
            giver: safeString(quest.giver),
            rewardCurrency,
            rewardXp,
            rewardItems,
            objectives
        };
    }
}

module.exports = QuestConfirmationManager;
