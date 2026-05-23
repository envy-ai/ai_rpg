const FormulaEvaluator = require('../public/js/formula-evaluator.js');

class ActorActivatableSystem {
    constructor({
        namespace,
        displayLabel,
        resourceNeedBarId,
        usageBaseCosts,
        costFormula,
        recordLabel = 'spell'
    } = {}) {
        this.namespace = ActorActivatableSystem.#requiredString(namespace, 'namespace');
        this.displayLabel = ActorActivatableSystem.#requiredString(displayLabel || namespace, 'displayLabel');
        this.resourceNeedBarId = ActorActivatableSystem.#requiredString(resourceNeedBarId, 'resourceNeedBarId');
        this.usageBaseCosts = ActorActivatableSystem.#normalizeUsageBaseCosts(usageBaseCosts);
        this.costFormula = ActorActivatableSystem.#requiredString(costFormula, 'costFormula');
        this.recordLabel = ActorActivatableSystem.#requiredString(recordLabel, 'recordLabel');
        this.#compiledCostFormulaByExpression.set(this.costFormula, FormulaEvaluator.compile(this.costFormula));
    }

    #compiledCostFormulaByExpression = new Map();

    static #requiredString(value, fieldName) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized) {
            throw new Error(`ActorActivatableSystem requires ${fieldName}.`);
        }
        return normalized;
    }

    static #clone(value) {
        return JSON.parse(JSON.stringify(value || {}));
    }

    static #normalizeUsageBaseCosts(source = {}) {
        const normalized = {};
        for (const usage of ['low', 'medium', 'high']) {
            const value = Number(source?.[usage]);
            if (!Number.isFinite(value) || value <= 0) {
                throw new Error(`usageBaseCosts.${usage} must be a positive finite number.`);
            }
            normalized[usage] = value;
        }
        return normalized;
    }

    static #usageRank(manaUsage) {
        switch (String(manaUsage || '').trim().toLowerCase()) {
            case 'low':
                return 1;
            case 'medium':
                return 2;
            case 'high':
                return 3;
            default:
                throw new Error(`Unsupported mana usage "${manaUsage}".`);
        }
    }

    #getState(actor) {
        if (!actor || typeof actor.getModState !== 'function') {
            throw new Error(`${this.displayLabel} actor does not support mod state.`);
        }
        const state = actor.getModState(this.namespace);
        const records = Array.isArray(state.records) ? state.records.map(record => ActorActivatableSystem.#clone(record)) : [];
        return {
            ...state,
            records
        };
    }

    #setState(actor, state, options = {}) {
        actor.setModState(this.namespace, state, options);
    }

    #normalizeRecord(record) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            throw new Error(`${this.recordLabel} record must be an object.`);
        }
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        if (!name) {
            throw new Error(`${this.recordLabel} record name is required.`);
        }
        const description = typeof record.description === 'string' ? record.description.trim() : '';
        if (!description) {
            throw new Error(`${this.recordLabel} record description is required.`);
        }
        const level = Number(record.level);
        if (!Number.isFinite(level) || level <= 0) {
            throw new Error(`${this.recordLabel} record level must be a positive finite number.`);
        }
        const manaUsage = String(record.manaUsage || '').trim().toLowerCase();
        ActorActivatableSystem.#usageRank(manaUsage);
        const effectSummary = typeof record.effectSummary === 'string' ? record.effectSummary.trim() : '';
        if (!effectSummary) {
            throw new Error(`${this.recordLabel} record effectSummary is required.`);
        }
        const id = typeof record.id === 'string' && record.id.trim()
            ? record.id.trim()
            : `${this.namespace}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        return {
            id,
            name,
            description,
            level,
            manaUsage,
            effectSummary
        };
    }

    learn({ actor, record } = {}) {
        const normalizedRecord = this.#normalizeRecord(record);
        const state = this.#getState(actor);
        const targetName = normalizedRecord.name.toLowerCase();
        if (state.records.some(existing => String(existing.name || '').trim().toLowerCase() === targetName)) {
            throw new Error(`${actor.name || 'actor'} already knows ${this.recordLabel} "${normalizedRecord.name}".`);
        }
        state.records.push(normalizedRecord);
        this.#setState(actor, state);
        return {
            actor,
            record: normalizedRecord
        };
    }

    list(actor) {
        return this.#getState(actor).records;
    }

    find(actor, name) {
        const normalizedName = typeof name === 'string' ? name.trim().toLowerCase() : '';
        if (!normalizedName) {
            throw new Error(`${this.recordLabel} name is required.`);
        }
        const matches = this.list(actor).filter(record => String(record.name || '').trim().toLowerCase() === normalizedName);
        if (matches.length === 0) {
            throw new Error(`Unknown ${this.recordLabel} "${name}".`);
        }
        if (matches.length > 1) {
            throw new Error(`Ambiguous ${this.recordLabel} "${name}".`);
        }
        return matches[0];
    }

    #getConfiguredValue(context, key, defaultValue) {
        const setting = context?.setting || context?.currentSetting || null;
        if (setting && typeof setting.getModSetting === 'function') {
            return setting.getModSetting(this.namespace, key, defaultValue);
        }
        const modSettings = setting?.modSettings?.[this.namespace];
        if (modSettings && Object.prototype.hasOwnProperty.call(modSettings, key)) {
            return modSettings[key];
        }
        return defaultValue;
    }

    #getUsageBaseCosts(context = {}) {
        const configured = this.#getConfiguredValue(context, 'manaUsageBaseCosts', this.usageBaseCosts);
        return ActorActivatableSystem.#normalizeUsageBaseCosts(configured);
    }

    #getCostFormula(context = {}) {
        return ActorActivatableSystem.#requiredString(
            this.#getConfiguredValue(context, 'manaCostFormula', this.costFormula),
            'manaCostFormula'
        );
    }

    getResourceNeedBarId(context = {}) {
        return ActorActivatableSystem.#requiredString(
            this.#getConfiguredValue(context, 'manaNeedBarId', this.resourceNeedBarId),
            'manaNeedBarId'
        );
    }

    #compileCostFormula(expression) {
        if (!this.#compiledCostFormulaByExpression.has(expression)) {
            this.#compiledCostFormulaByExpression.set(expression, FormulaEvaluator.compile(expression));
        }
        return this.#compiledCostFormulaByExpression.get(expression);
    }

    getCost(record, context = {}) {
        const normalizedRecord = this.#normalizeRecord(record);
        const usageRank = ActorActivatableSystem.#usageRank(normalizedRecord.manaUsage);
        const usageBaseCosts = this.#getUsageBaseCosts(context);
        const baseCost = usageBaseCosts[normalizedRecord.manaUsage];
        const cost = this.#compileCostFormula(this.#getCostFormula(context))({
            level: normalizedRecord.level,
            usageRank,
            manaUsage: usageRank,
            baseCost
        });
        if (!Number.isFinite(cost) || cost <= 0) {
            throw new Error(`${this.recordLabel} mana cost must be a positive finite number.`);
        }
        return cost;
    }

    activate({ actor, name, recordName, reason, context = {} } = {}) {
        const record = this.find(actor, name || recordName);
        if (typeof actor.getNeedBarValue !== 'function' || typeof actor.setNeedBarValue !== 'function') {
            throw new Error(`${actor.name || 'actor'} does not expose need bar helpers.`);
        }
        const resourceNeedBarId = this.getResourceNeedBarId(context);
        const currentValue = Number(actor.getNeedBarValue(resourceNeedBarId));
        if (!Number.isFinite(currentValue)) {
            throw new Error(`${actor.name || 'actor'} does not have a finite ${resourceNeedBarId} value.`);
        }
        const cost = this.getCost(record, context);
        if (currentValue < cost) {
            throw new Error(`${actor.name || 'actor'} does not have enough ${resourceNeedBarId} to activate "${record.name}".`);
        }
        actor.setNeedBarValue(resourceNeedBarId, currentValue - cost, { allowPlayerOnly: false });
        return {
            actor,
            record,
            cost,
            resourceNeedBarId,
            reason: typeof reason === 'string' ? reason.trim() : ''
        };
    }

    getActorStatusSection(actor, context = {}) {
        const records = this.list(actor);
        if (!records.length) {
            return null;
        }
        return {
            key: this.namespace,
            label: this.getDisplayLabel(context),
            entries: records.map(record => ({
                id: record.id,
                name: record.name,
                description: record.description,
                level: record.level,
                manaUsage: record.manaUsage,
                effectSummary: record.effectSummary,
                cost: this.getCost(record, context)
            }))
        };
    }

    getDisplayLabel(context = {}) {
        const setting = context.setting || context.currentSetting || null;
        const configured = setting && typeof setting.getModSetting === 'function'
            ? setting.getModSetting(this.namespace, 'displayLabel', null)
            : setting?.modSettings?.[this.namespace]?.displayLabel;
        return typeof configured === 'string' && configured.trim()
            ? configured.trim()
            : this.displayLabel;
    }

    parseXmlRaw(raw) {
        if (typeof raw !== 'string' || !raw.trim()) {
            throw new Error(`${this.displayLabel} XML event payload is required.`);
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`${this.displayLabel} XML event payload must be an object.`);
        }
        return parsed;
    }
}

module.exports = ActorActivatableSystem;
