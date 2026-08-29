const { randomUUID } = require('crypto');
const Globals = require('./Globals.js');
const Player = require('./Player.js');
const { resolveQuestDispositionRewardDelta } = require('./quest_disposition_reward_delta.js');

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

    rejectAll(reason = 'Quest confirmations cancelled') {
        let rejected = 0;
        for (const [id, pending] of Array.from(this.pending.entries())) {
            if (pending.timeout) {
                clearTimeout(pending.timeout);
            }
            pending.reject(new Error(reason));
            this.pending.delete(id);
            rejected += 1;
        }
        return rejected;
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
                return normalized ? { name: normalized, description: '' } : null;
            }
            if (item && typeof item === 'object') {
                const name = safeString(item.name || item.label);
                if (!name) {
                    return null;
                }
                const description = safeString(item.description);
                const quantity = Number.isFinite(item.quantity) ? item.quantity : null;
                return quantity && quantity !== 1
                    ? { name, description, quantity: Math.max(1, Math.round(quantity)) }
                    : { name, description };
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
        const rewardNpcDispositions = mapArray(quest.rewardNpcDispositions, entry => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            const npcName = safeString(entry.npcName || entry.name || entry.npcId || entry.id);
            if (!npcName) {
                return null;
            }
            const dispositionDefinitions = typeof Player.getDispositionDefinitions === 'function'
                ? Player.getDispositionDefinitions()
                : null;
            const dispositions = mapArray(entry.dispositions, disposition => {
                if (!disposition || typeof disposition !== 'object') {
                    return null;
                }
                const type = safeString(disposition.type);
                const intensity = Number(disposition.intensity ?? disposition.amount ?? disposition.delta ?? disposition.value);
                if (!type || !Number.isFinite(intensity) || !Number.isInteger(intensity) || intensity === 0) {
                    return null;
                }
                const reason = safeString(disposition.reason);
                // Preview the actual disposition change (intensity scaled by the
                // configured typical step), matching what completion will apply and
                // what the quest list already shows, so the accept dialog is not raw.
                const resolvedDelta = resolveQuestDispositionRewardDelta(intensity, dispositionDefinitions);
                return {
                    type,
                    intensity,
                    delta: Number.isFinite(resolvedDelta) ? resolvedDelta : null,
                    reason: reason || null
                };
            });
            if (!dispositions.length) {
                return null;
            }
            return {
                npcName,
                dispositions
            };
        });
        const rewardBenefits = mapArray(quest.rewardBenefits, entry => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            const id = safeString(entry.id);
            const type = safeString(entry.type);
            const targetId = safeString(entry.targetId);
            const label = safeString(entry.label);
            if (!id || !type || !targetId || !label) {
                return null;
            }
            return {
                id,
                type,
                targetId,
                label,
                description: safeString(entry.description) || null,
                role: safeString(entry.role) || null
            };
        });
        const rewardNotes = mapArray(quest.rewardNotes, entry => {
            const note = safeString(entry);
            return note || null;
        });

        return {
            id: safeString(quest.id),
            name: safeString(quest.name),
            description: safeString(quest.description),
            summary: safeString(quest.summary),
            giver: safeString(quest.giver),
            rewardCurrency,
            rewardXp,
            rewardItems,
            rewardNpcDispositions,
            rewardBenefits,
            rewardNotes,
            objectives
        };
    }
}

module.exports = QuestConfirmationManager;
