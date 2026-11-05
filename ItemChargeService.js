'use strict';
const Pool = require('./ItemChargePool.js');
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, JSON.parse(canonical(value[key]))])) : value);

/** Checked mutations of one exact owned item, with durable operation replay. */
class ItemChargeService {
    static #operations = new Map();
    static #epoch = 0;
    static get epoch() { return this.#epoch; }
    static normalizePool = Pool.normalizePool;
    static normalizeAmmoType = Pool.normalizeAmmoType;
    static add = Pool.add;
    static subtract = Pool.subtract;
    static clear() { this.#operations.clear(); this.#epoch += 1; }
    static assertOwned(actor, itemId) {
        if (!actor?.id || typeof actor.hasInventoryItem !== 'function') throw new Error('Item charge operation requires an actor with an inventory.');
        if (typeof itemId !== 'string' || !itemId.trim()) throw new Error('itemId is required.');
        const item = require('./Thing.js').getById(itemId);
        if (!item) throw new Error(`itemId "${itemId}" no longer exists; select an existing owned item.`);
        // Installed modules normally remain in raw inventory. If a mod keeps
        // one outside it, require both the exact parent and native child link.
        let owned = actor.hasInventoryItem(item.id);
        if (!owned && item.moduleInstalledOnItemId) {
            const parent = require('./Thing.js').getById(item.moduleInstalledOnItemId);
            owned = Boolean(parent && actor.hasInventoryItem(parent.id) && parent.installedModuleIds?.includes(item.id));
        }
        if (!owned) throw new Error(`itemId "${itemId}" is not owned by actor "${actor.id}"; select an item in that actor's inventory or an installed module on it.`);
        if (item.hiddenFromPlayer === true) throw new Error(`itemId "${itemId}" is hidden and cannot be used.`);
        return item;
    }
    static getOperationRecord(operationId) { const record = this.#operations.get(operationId); return record ? clone(record) : null; }
    static getOperation(operationId, request) {
        if (typeof operationId !== 'string' || !operationId.trim()) throw new Error('operationId is required for an item charge operation.');
        const record = this.#operations.get(operationId);
        if (!record) return null;
        if (canonical(record.request) !== canonical(request)) throw new Error(`operationId "${operationId}" already belongs to a different request; use a new operation ID.`);
        return clone(record.result);
    }
    static recordOperation({ operationId, request, result }) {
        const previous = this.getOperation(operationId, request);
        if (previous !== null) return previous;
        if (result === undefined || result === null) throw new Error('Item charge operation result is required.');
        const record = clone({ operationId, request, result });
        this.validateState({ version: 1, operations: [record] });
        this.#operations.set(operationId, record);
        return clone(result);
    }
    static snapshot() { return this.toJSON(); }
    static restoreSnapshot(snapshot) { this.validateState(snapshot); this.#operations = new Map(snapshot.operations.map(record => [record.operationId, clone(record)])); }
    static preflightSpend({ actor, itemId, amount, operationId = null }) {
        const item = this.assertOwned(actor, itemId);
        const before = item.chargePool;
        if (!before) throw new Error(`itemId "${itemId}" has no chargePool; select an item with a charge resource.`);
        Pool.validatePayment(before, amount, `itemId ${itemId} charge payment`);
        if (amount > before.amount) throw new Error(`itemId "${itemId}" has insufficient ${before.unit}: requires ${amount}, available ${before.amount}; reload or select a different eligible item explicitly.`);
        const after = Pool.normalizePool({ ...before, amount: Pool.subtract(before.amount, amount) });
        return { actor, actorId: actor.id, item, itemId, amount, before, after, epoch: this.#epoch, operationId };
    }
    static assertCurrent(plan) {
        if (!plan || plan.epoch !== this.#epoch) throw new Error('Item charge operation is stale because the world changed; start a new action.');
        const item = this.assertOwned(plan.actor, plan.itemId);
        if (item !== plan.item || canonical(item.chargePool) !== canonical(plan.before)) throw new Error(`itemId "${plan.itemId}" changed after preparation; prepare the action again.`);
        return item;
    }
    static commitSpend(plan) {
        const request = { kind: 'spend', actorId: plan.actorId, itemId: plan.itemId, amount: plan.amount };
        if (plan.operationId) { const previous = this.getOperation(plan.operationId, request); if (previous) return previous; }
        const item = this.assertCurrent(plan);
        try {
            item.chargePool = plan.after;
            const result = { operationId: plan.operationId, ...request, before: plan.before.amount, after: plan.after.amount, unit: plan.before.unit };
            return plan.operationId ? this.recordOperation({ operationId: plan.operationId, request, result }) : result;
        } catch (error) { item.chargePool = plan.before; throw error; }
    }
    static spend(options) {
        if (options.operationId) {
            const previous = this.getOperation(options.operationId, { kind: 'spend', actorId: options.actor?.id, itemId: options.itemId, amount: options.amount });
            if (previous) return previous;
        }
        return this.commitSpend(this.preflightSpend(options));
    }
    static getReloadOptions({ actor, itemId }) {
        const item = this.assertOwned(actor, itemId), pool = item.chargePool;
        if (!pool || pool.mode !== 'discrete' || !pool.ammoType) throw new Error(`itemId "${itemId}" is not reloadable; a discrete chargePool with ammoType is required.`);
        const capacityAvailable = Pool.subtract(pool.capacity, pool.amount);
        return { actorId: actor.id, itemId, chargePool: pool, capacityAvailable,
            sources: actor.getInventoryItems().filter(source => source.id !== itemId && source.ammoType === pool.ammoType && !source.chargePool && !source.isContainer && !source.isEquipped && !source.moduleInstalledOnItemId && !source.installedModuleIds?.length && source.hiddenFromPlayer !== true && source.count > 0)
                .map(source => ({ id: source.id, name: source.name, count: source.count, ammoType: source.ammoType, amount: Math.min(source.count, capacityAvailable) })) };
    }
    static reload({ actor, itemId, ammoItemId, amount, operationId }) {
        const request = { kind: 'reload', actorId: actor?.id, itemId, ammoItemId, ...(amount === undefined ? {} : { amount }) };
        const previous = this.getOperation(operationId, request);
        if (previous) return previous;
        const target = this.assertOwned(actor, itemId), source = this.assertOwned(actor, ammoItemId);
        const before = target.chargePool;
        if (target.id === source.id || !before || before.mode !== 'discrete' || !before.ammoType || source.chargePool || source.ammoType !== before.ammoType || source.isContainer || source.isEquipped || source.moduleInstalledOnItemId || source.installedModuleIds?.length) throw new Error('reload.ammoItemId must identify loose ammunition with exactly the target chargePool.ammoType; select compatible ammunition explicitly.');
        if (!actor.hasInventoryItem(source.id)) throw new Error('reload.ammoItemId must be loose ammunition in the actor inventory; remove it from its container or module first.');
        const available = Pool.subtract(before.capacity, before.amount);
        const quantity = amount === undefined ? Math.min(available, source.count) : amount;
        Pool.validatePayment(before, quantity, 'reload');
        if (quantity <= 0) throw new Error('reload.amount must be positive; the target is full or the ammunition source is empty.');
        if (quantity > available) throw new Error(`reload.amount exceeds remaining capacity ${available}; choose a positive integer no greater than capacity.`);
        if (quantity > source.count) throw new Error(`reload.amount exceeds ammunition count ${source.count}; choose a positive integer no greater than this source stack.`);
        const after = Pool.normalizePool({ ...before, amount: Pool.add(before.amount, quantity) });
        const oldCount = source.count;
        const sourceMetadata = source.metadata;
        const restoreSourceRegistration = source.captureDeletionRollback();
        try {
            target.chargePool = after;
            // Keep the exact depleted source alive until recording succeeds.
            source.count = oldCount - quantity;
            const result = { operationId, ...request, amount: quantity, before: before.amount, after: after.amount, remainingAmmo: source.count, unit: before.unit };
            this.recordOperation({ operationId, request, result });
            if (source.count === 0) source.delete();
            return result;
        } catch (error) {
            const failures = [];
            try { target.chargePool = before; } catch (cause) { failures.push(cause); }
            try { source.count = oldCount; source.metadata = sourceMetadata; restoreSourceRegistration(); } catch (cause) { failures.push(cause); }
            try {
                if (!actor.hasInventoryItem(source.id)) {
                    const added = actor.addInventoryItem(source, { mergeStacks: false, suppressNpcEquip: true });
                    if (!added) throw new Error(`Failed to restore ammunition ${source.id} to actor ${actor.id}.`);
                }
            } catch (cause) { failures.push(cause); }
            this.#operations.delete(operationId);
            if (failures.length) throw new AggregateError([error, ...failures], `Reload failed and rollback was incomplete: ${error.message}`, { cause: error });
            throw error;
        }
    }
    static adjust({ actor, itemId, amount, operationId }) {
        const request = { kind: 'adjust', actorId: actor?.id, itemId, amount };
        const previous = this.getOperation(operationId, request); if (previous) return previous;
        const item = this.assertOwned(actor, itemId), before = item.chargePool;
        if (!before) throw new Error(`itemId "${itemId}" has no chargePool.`);
        const after = Pool.normalizePool({ ...before, amount });
        try { item.chargePool = after; return this.recordOperation({ operationId, request, result: { operationId, ...request, before: before.amount, after: amount, unit: before.unit } }); }
        catch (error) { item.chargePool = before; throw error; }
    }
    static toJSON() { return { version: 1, operations: [...this.#operations.values()].map(clone) }; }
    static serialize() { return this.toJSON(); }
    static validateState(state, { actors = null, things = null } = {}) {
        if (state === undefined) state = { version: 1, operations: [] };
        if (!state || state.version !== 1 || !Array.isArray(state.operations)) throw new Error('itemCharges must contain version 1 and an operations array; restore a valid saved ledger.');
        const ids = new Set();
        for (const record of state.operations) {
            if (!record || typeof record.operationId !== 'string' || !record.operationId.trim() || ids.has(record.operationId) || !record.request || typeof record.request !== 'object' || Array.isArray(record.request) || record.result === undefined || record.result === null) throw new Error('itemCharges.operations contains an invalid or duplicate operation; preserve distinct operationId, request and result records.');
            const path = `itemCharges.operations.${record.operationId}`;
            if (typeof record.request.actorId !== 'string' || !record.request.actorId.trim() || typeof record.request.itemId !== 'string' || !record.request.itemId.trim()) throw new Error(`${path}.request requires nonblank actorId and itemId.`);
            if (!['spend', 'reload', 'adjust', 'ordinaryAttack', 'ordinaryAreaAttack'].includes(record.request.kind)) throw new Error(`${path}.request.kind must be spend, reload, adjust, ordinaryAttack or ordinaryAreaAttack.`);
            if (!record.result || typeof record.result !== 'object' || Array.isArray(record.result)) throw new Error(`${path}.result must be the complete committed operation result object.`);
            const payment = ['ordinaryAttack', 'ordinaryAreaAttack'].includes(record.request.kind) ? record.result.chargePayment : record.result;
            if (!payment || payment.operationId !== record.operationId || payment.itemId !== record.request.itemId) throw new Error(`${path}.result charge payment must preserve the operationId and exact selected itemId.`);
            for (const field of ['amount', 'before', 'after']) if (typeof payment[field] !== 'number' || !Number.isFinite(payment[field]) || payment[field] < 0) throw new Error(`${path}.result.${field} must be a finite nonnegative numeric amount.`);
            if (record.request.kind === 'reload' && (typeof record.request.ammoItemId !== 'string' || !record.request.ammoItemId.trim() || !Number.isSafeInteger(payment.amount) || payment.amount <= 0 || !Number.isSafeInteger(payment.remainingAmmo) || payment.remainingAmmo < 0)) throw new Error(`${path}.result requires an exact ammoItemId, positive integer loaded amount and nonnegative integer remainingAmmo.`);
            // Historical item/ammo IDs may refer to intentionally destroyed records.
            // Historical actors can also be removed from the world after an action.
            ids.add(record.operationId);
        }
        if (things) for (const item of things) {
            Pool.normalizePool(item.chargePool, { count: item.count ?? item.metadata?.count ?? 1, path: `things.${item.id}.chargePool` });
            Pool.normalizeAmmoType(item.ammoType, `things.${item.id}.ammoType`);
        }
    }
    static hydrate(state) { this.validateState(state); this.clear(); for (const record of state?.operations || []) this.#operations.set(record.operationId, clone(record)); }
    static restore(state) { this.hydrate(state); }
}
module.exports = ItemChargeService;
