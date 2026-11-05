'use strict';

const Technique = require('./Technique.js');
const BalancePolicy = require('./TechniqueBalancePolicy.js');
const ChargePool = require('./ItemChargePool.js');
const TechniqueFormulaVariables = require('./public/js/technique-formula-variables.js');
const IdGenerator = require('./IdGenerator.js');
const { ValidationIssueCollector, withValidationContext } = require('./ResponseValidation.js');
const { randomUUID, createHash } = require('crypto');
const clone = Technique.clone;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const actorList = actors => actors instanceof Map ? [...actors.values()] : Array.from(actors ?? []);
const worldMinute = () => require('./Globals.js').getTotalWorldMinutes();
const getActor = id => require('./Player.js').getById(id);
const locationId = actor => actor.isInPlayerParty ? require('./Globals.js').currentPlayer?.location?.id : actor.location?.id;
const assertFiniteJson = (value, label) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${label} contains a nonfinite number.`);
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error(`${label} must contain serializable JSON data.`);
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) assertFiniteJson(child, `${label}.${key}`);
};

/** Saved-world catalogue, acquisition and exact-once execution boundary. */
class TechniqueService {
    static #disciplines = new Map();
    static #definitions = new Map();
    static #icons = new Map();
    static #disciplineIcons = new Map();
    static #receipts = new Map();
    static #pending = new Map();
    static #prepared = new WeakMap();
    static #preparedLearning = new WeakMap();
    static #epoch = 0;
    static #disciplineEditWorldId = randomUUID();
    static #receiptObserver = null;
    static #undeliveredReceipts = new Set();

    // Presentation is delivered after the authoritative transaction. Hydration
    // and operation replays deliberately do not announce historical learning.
    static setReceiptObserver(observer) {
        if (observer !== null && typeof observer !== 'function') throw new TypeError('Technique receipt observer must be a function or null.');
        this.#receiptObserver = observer;
    }

    static #publishReceipt(receipt) {
        if (!this.#receiptObserver) return clone(receipt);
        this.#undeliveredReceipts.add(receipt.operationId);
        try {
            this.#receiptObserver(clone(receipt));
            this.#undeliveredReceipts.delete(receipt.operationId);
        }
        catch (cause) {
            const error = new Error(`Technique operation ${receipt.operationId} committed, but its gameplay notification failed: ${cause.message}`, { cause });
            error.committedOperationId = receipt.operationId;
            throw error;
        }
        return clone(receipt);
    }

    /** Explicitly repair a known delivery failure without executing mechanics. */
    static retryReceiptNotification(operationId) {
        Technique.text(operationId, 'notification operationId');
        const receipt = this.#receipts.get(operationId);
        if (!receipt) throw new Error(`Cannot retry notification for unknown technique operation ${operationId}.`);
        if (receipt.kind === 'initialization') {
            let retried = false;
            for (const pendingId of [...this.#undeliveredReceipts]) {
                if (pendingId.startsWith(`${operationId}:learn:`)) retried = this.retryReceiptNotification(pendingId) || retried;
            }
            return retried;
        }
        if (!this.#undeliveredReceipts.has(operationId)) return false;
        if (!this.#receiptObserver) {
            const error = new Error(`Technique operation ${operationId} committed, but its failed notification cannot be retried without an observer.`);
            error.committedOperationId = operationId;
            throw error;
        }
        this.#publishReceipt(receipt);
        return true;
    }

    static #displaySnapshot(actor, definition, targets, effects) {
        return {
            actorName: actor.name, techniqueName: definition.name, techniqueDescription: definition.description,
            locationId: locationId(actor) ?? null,
            ...(targets ? { targets: targets.map(target => ({ id: target.id, name: target.name })) } : {}),
            ...(effects ? { effects: effects.map(effect => ({
                effectId: effect.id, kind: effect.kind,
                ...(effect.calculation ? { calculation: { ...clone(effect.calculation), authored: clone(effect.amount) } } : {}),
                ...(effect.status ? { status: clone(effect.status), calculations: clone(effect.calculations) } : {})
            })) } : {})
        };
    }

    static reset() {
        this.#disciplines = new Map();
        this.#definitions = new Map();
        this.#icons = new Map();
        this.#disciplineIcons = new Map();
        this.#receipts = new Map();
        this.#undeliveredReceipts = new Set();
        this.#pending = new Map();
        this.#prepared = new WeakMap();
        this.#preparedLearning = new WeakMap();
        this.#epoch += 1;
        this.#disciplineEditWorldId = randomUUID();
    }

    static #normalizeState(value) {
        Technique.assertKeys(value, ['version', 'disciplines', 'definitions', 'receipts', 'icons', 'disciplineIcons'], 'technique state');
        if (value.version !== 1) throw new Error('Unsupported technique state version.');
        for (const field of ['disciplines', 'definitions', 'receipts']) if (!Array.isArray(value[field])) throw new TypeError(`Technique state ${field} must be an array.`);
        const disciplines = new Map();
        for (const raw of value.disciplines) {
            const discipline = Technique.normalizeDiscipline(raw);
            if (disciplines.has(discipline.id)) throw new Error(`Duplicate discipline ${discipline.id}.`);
            disciplines.set(discipline.id, discipline);
        }
        const definitions = new Map();
        const semanticKeys = new Set();
        for (const raw of value.definitions) {
            const definition = new Technique(raw);
            if (definitions.has(definition.id)) throw new Error(`Duplicate technique ${definition.id}.`);
            if (!disciplines.has(definition.disciplineId)) throw new Error(`Unknown discipline ${definition.disciplineId} in ${definition.id}. ${this.availableDisciplineIds(disciplines)}`);
            const identity = `${definition.disciplineId}:${definition.semanticKey}`;
            if (!definition.unique && semanticKeys.has(identity)) throw new Error(`Duplicate common technique semantic identity ${identity}.`);
            if (!definition.unique) semanticKeys.add(identity);
            definitions.set(definition.id, definition);
        }
        for (const discipline of disciplines.values()) this.#validateRequirementReferences(discipline.accessRequirements, disciplines, definitions);
        for (const definition of definitions.values()) for (const revision of definition.revisions) {
            this.#validateRequirementReferences([...revision.acquisitionRequirements, ...revision.useRequirements], disciplines, definitions);
            for (const effect of revision.effects) for (const grant of effect.status?.techniqueGrants ?? []) {
                const granted = definitions.get(grant.techniqueId);
                if (!granted) throw new Error(`Technique status references missing grant ${grant.techniqueId}. For an authored nested grant, select an existing catalogue techniqueId and definitionRevision; an invalid grant in an existing catalogue definition requires catalogue repair.`);
                granted.getRevision(grant.definitionRevision);
            }
        }
        const receipts = new Map();
        for (const raw of value.receipts) {
            const receipt = this.#normalizeReceipt(raw, definitions);
            if (receipt.kind === 'discipline' && !disciplines.has(receipt.techniqueId)) throw new Error(`Receipt references missing discipline ${receipt.techniqueId}. ${this.availableDisciplineIds(disciplines)}`);
            if (receipts.has(receipt.operationId)) throw new Error(`Duplicate technique receipt ${receipt.operationId}.`);
            receipts.set(receipt.operationId, receipt);
        }
        const icons = new Map();
        if (value.icons !== undefined) {
            if (!value.icons || typeof value.icons !== 'object' || Array.isArray(value.icons)) throw new TypeError('Technique icons must be an object.');
            for (const [id, icon] of Object.entries(value.icons)) {
                if (!definitions.has(id)) throw new Error(`Icon references missing technique ${id}.`);
                icons.set(id, this.#normalizeIcon(icon));
            }
        }
        const disciplineIcons = new Map();
        if (value.disciplineIcons !== undefined) {
            if (!value.disciplineIcons || typeof value.disciplineIcons !== 'object' || Array.isArray(value.disciplineIcons)) throw new TypeError('Discipline icons must be an object.');
            for (const [id, icon] of Object.entries(value.disciplineIcons)) {
                if (!disciplines.has(id)) throw new Error(`Icon references missing discipline ${id}. ${this.availableDisciplineIds(disciplines)}`);
                disciplineIcons.set(id, this.#normalizeIcon(icon, 'Discipline icon'));
            }
        }
        return { disciplines, definitions, receipts, icons, disciplineIcons };
    }

    static #validateRequirementReferences(requirements, disciplines, definitions) {
        for (const requirement of requirements) {
            if (requirement.kind === 'discipline' && !disciplines.has(requirement.id)) throw new Error(`Missing prerequisite discipline ${requirement.id}. Use an existing catalogue discipline ID for this prerequisite; do not invent a reference. ${this.availableDisciplineIds(disciplines)}`);
            if (requirement.kind === 'technique' && !definitions.has(requirement.id)) throw new Error(`Missing prerequisite technique ${requirement.id}. Use an existing catalogue technique ID for this prerequisite; do not invent a reference.`);
        }
    }

    static #normalizeReceipt(value, definitions = this.#definitions) {
        assertFiniteJson(value, 'technique receipt');
        Technique.assertKeys(value, ['operationId', 'kind', 'actorId', 'techniqueId', 'turnId', 'worldMinute', 'committed', 'source', 'success', 'costOutcome', 'costs', 'checks', 'effects', 'techniqueChanges', 'evidenceIds', 'request', 'display'], 'technique receipt');
        const receipt = clone(value);
        for (const field of ['operationId', 'actorId', 'techniqueId']) Technique.text(receipt[field], `receipt.${field}`);
        if (!['use', 'learn', 'improve', 'evidence', 'discipline', 'initialization'].includes(receipt.kind)) throw new Error('Unknown technique receipt kind.');
        if (receipt.committed !== true) throw new Error('Only committed technique receipts may be persisted.');
        Technique.number(receipt.worldMinute, 'receipt.worldMinute', { minimum: 0 });
        if (!['discipline', 'initialization'].includes(receipt.kind) && !definitions.has(receipt.techniqueId)) throw new Error(`Receipt references unknown technique ${receipt.techniqueId}.`);
        if (!receipt.request || receipt.request.kind !== receipt.kind || receipt.request.actorId !== receipt.actorId || typeof receipt.request.techniqueId !== 'string') throw new Error('Technique receipt requires its coherent original request.');
        if (receipt.display !== undefined) {
            Technique.assertKeys(receipt.display, ['actorName', 'techniqueName', 'techniqueDescription', 'locationId', 'targets', 'effects'], 'receipt.display');
            Technique.text(receipt.display.actorName, 'receipt.display.actorName');
            Technique.text(receipt.display.techniqueName, 'receipt.display.techniqueName');
            if (receipt.display.techniqueDescription !== undefined) Technique.text(receipt.display.techniqueDescription, 'receipt.display.techniqueDescription');
            if (receipt.display.locationId !== null) Technique.text(receipt.display.locationId, 'receipt.display.locationId');
            if (receipt.display.targets !== undefined) {
                if (!Array.isArray(receipt.display.targets)) throw new Error('Receipt display targets must be an array.');
                for (const target of receipt.display.targets) {
                    Technique.assertKeys(target, ['id', 'name'], 'receipt.display.target');
                    Technique.text(target.id, 'receipt.display.target.id');
                    Technique.text(target.name, 'receipt.display.target.name');
                }
            }
            if (receipt.display.effects !== undefined) {
                if (!Array.isArray(receipt.display.effects)) throw new Error('Receipt display effects must be an array.');
                for (const effect of receipt.display.effects) {
                    Technique.assertKeys(effect, ['effectId', 'kind', 'calculation', 'status', 'calculations'], 'receipt.display.effect');
                    Technique.text(effect.effectId, 'receipt.display.effect.effectId');
                    if (['damage', 'healing'].includes(effect.kind)) this.#validateCalculation(effect.calculation, 'receipt.display.effect.calculation', true);
                    else if (['buff', 'debuff'].includes(effect.kind)) {
                        new (require('./StatusEffect.js'))({ ...effect.status, register: false });
                        if (!Array.isArray(effect.calculations)) throw new Error('Receipt display status requires calculations.');
                        for (const calculation of effect.calculations) this.#validateCalculation(calculation, 'receipt.display.effect.calculation', true, true);
                    } else throw new Error('Invalid receipt display effect kind.');
                }
            }
        }
        if (receipt.kind === 'initialization') {
            Technique.assertKeys(receipt, ['operationId', 'kind', 'actorId', 'techniqueId', 'worldMinute', 'committed', 'request'], 'initialization receipt');
            Technique.assertKeys(receipt.request, ['kind', 'actorId', 'techniqueId', 'techniqueIds'], 'initialization request');
            if (receipt.techniqueId !== 'starting-techniques' || receipt.request.techniqueId !== receipt.techniqueId || !Array.isArray(receipt.request.techniqueIds) || new Set(receipt.request.techniqueIds).size !== receipt.request.techniqueIds.length) throw new Error('Invalid initial technique receipt.');
            for (const id of receipt.request.techniqueIds) if (!definitions.has(id)) throw new Error(`Initial technique receipt references missing technique ${id}.`);
        }
        if (receipt.kind === 'use') {
            Technique.text(receipt.turnId, 'receipt.turnId');
            if (typeof receipt.success !== 'boolean' || !['normal', 'failure'].includes(receipt.costOutcome)) throw new Error('Invalid receipt attempt outcome.');
            for (const field of ['costs', 'checks', 'effects', 'techniqueChanges']) if (!Array.isArray(receipt[field])) throw new Error(`receipt.${field} must be an array.`);
            Technique.assertKeys(receipt.source, ['sourceId', 'sourceKind', 'itemId', 'statusId', 'abilityId', 'definitionRevision', 'personalRevision'], 'receipt.source');
            Technique.text(receipt.source.sourceId, 'receipt.source.sourceId');
            if (!['learned', 'equipment', 'status'].includes(receipt.source.sourceKind)) throw new Error('Invalid receipt source.');
            Technique.number(receipt.source.definitionRevision, 'receipt.source.definitionRevision', { integer: true, minimum: 1 });
            if (receipt.source.sourceKind === 'learned') {
                Technique.number(receipt.source.personalRevision, 'receipt.source.personalRevision', { integer: true, minimum: 1 });
                if (receipt.source.itemId !== undefined || receipt.source.statusId !== undefined || receipt.source.abilityId !== undefined) throw new Error('Learned receipt cannot have an external source.');
            } else if (receipt.source.sourceKind === 'equipment') {
                Technique.text(receipt.source.itemId, 'receipt.source.itemId');
                if (receipt.source.personalRevision !== undefined) throw new Error('Equipment receipt cannot have a personal revision.');
                if (receipt.source.statusId !== undefined || receipt.source.abilityId !== undefined) throw new Error('Equipment receipt cannot have a status source.');
            } else {
                Technique.text(receipt.source.statusId, 'receipt.source.statusId');
                if (receipt.source.abilityId !== undefined) Technique.text(receipt.source.abilityId, 'receipt.source.abilityId');
                if (receipt.source.itemId !== undefined || receipt.source.personalRevision !== undefined) throw new Error('Status receipt cannot have item or personal revision.');
            }
            definitions.get(receipt.techniqueId).getRevision(receipt.source.definitionRevision);
            Technique.assertKeys(receipt.request, ['kind', 'actorId', 'techniqueId', 'turnId', 'sourceId', 'targetIds', 'intent', 'expectedDefinitionRevision', 'expectedPersonalRevision'], 'receipt.request');
            if (receipt.request.turnId !== receipt.turnId) throw new Error('Technique receipt turn does not match its original request.');
            if (receipt.request.sourceId !== null && (typeof receipt.request.sourceId !== 'string' || !receipt.request.sourceId)) throw new Error('Invalid original receipt source ID.');
            if (receipt.request.targetIds !== null && (!Array.isArray(receipt.request.targetIds) || !receipt.request.targetIds.length || receipt.request.targetIds.some(id => typeof id !== 'string' || !id) || new Set(receipt.request.targetIds).size !== receipt.request.targetIds.length)) throw new Error('Invalid original receipt target IDs.');
            if (receipt.request.intent !== undefined) Technique.text(receipt.request.intent, 'receipt.request.intent');
            for (const field of ['expectedDefinitionRevision', 'expectedPersonalRevision']) if (receipt.request[field] !== undefined) Technique.number(receipt.request[field], `receipt.request.${field}`, { integer: true, minimum: 1 });
            const costKeys = new Set();
            for (const cost of receipt.costs) {
                Technique.assertKeys(cost, ['key', 'resource', 'needId', 'itemId', 'mode', 'unit', 'direction', 'value', 'min', 'max', 'amount', 'calculations', 'nextValue', 'previousValue', 'newValue', 'delta'], 'receipt.cost');
                if (!['health', 'need', 'charge'].includes(cost.resource) || !['increase', 'decrease'].includes(cost.direction)) throw new Error('Invalid receipt resource cost.');
                if (cost.resource === 'health' && (cost.key !== 'health' || cost.direction !== 'decrease' || cost.needId !== undefined)) throw new Error('Invalid receipt health resource.');
                if (cost.resource === 'need' && cost.key !== `need:${Technique.text(cost.needId, 'receipt.cost.needId')}`) throw new Error('Invalid receipt need identity.');
                if (cost.resource === 'charge') {
                    if (cost.key !== `charge:${Technique.text(cost.itemId, 'receipt.cost.itemId')}` || cost.direction !== 'decrease' || cost.min !== 0 || !['discrete', 'continuous'].includes(cost.mode)) throw new Error('Invalid receipt charge identity or bounds.');
                    Technique.text(cost.unit, 'receipt.cost.unit');
                    if (cost.needId !== undefined) throw new Error('receipt.cost.needId is invalid for charge. Use itemId for the exact charged item.');
                    ChargePool.normalizePool({ mode: cost.mode, unit: cost.unit, capacity: cost.max, amount: cost.value });
                    ChargePool.normalizePool({ mode: cost.mode, unit: cost.unit, capacity: cost.max, amount: cost.newValue });
                    ChargePool.validatePayment(cost, cost.amount, 'receipt.cost');
                } else if (['itemId', 'mode', 'unit'].some(key => cost[key] !== undefined)) throw new Error('Only charge receipt costs may contain itemId, mode or unit.');
                if (costKeys.has(cost.key)) throw new Error('Receipt contains duplicate unnormalized resource costs.');
                costKeys.add(cost.key);
                for (const field of ['value', 'min', 'max', 'amount', 'nextValue', 'previousValue', 'newValue', 'delta']) Technique.number(cost[field], `receipt.cost.${field}`);
                const difference = cost.resource === 'charge' ? ChargePool.subtract(cost.newValue, cost.previousValue) : cost.newValue - cost.previousValue;
                const nextValue = cost.resource === 'charge' ? ChargePool.subtract(cost.previousValue, cost.amount) : cost.previousValue + (cost.direction === 'decrease' ? -cost.amount : cost.amount);
                if (cost.amount < 0 || cost.value !== cost.previousValue || cost.nextValue !== cost.newValue || difference !== cost.delta || cost.newValue !== nextValue || cost.newValue < cost.min || cost.newValue > cost.max) throw new Error('Receipt cost values do not describe an exact debit.');
                if (!Array.isArray(cost.calculations) || !cost.calculations.length) throw new Error('Receipt cost requires its calculations.');
                let amount = 0;
                for (const calculation of cost.calculations) {
                    this.#validateCalculation(calculation, 'receipt.cost.calculation', true);
                    amount = cost.resource === 'charge' ? ChargePool.add(amount, calculation.amount) : amount + calculation.amount;
                }
                if (amount !== cost.amount) throw new Error('Receipt combined resource cost differs from its calculations.');
            }
            for (const checked of receipt.checks) {
                Technique.assertKeys(checked, ['targetId', 'check', 'outcome'], 'receipt.check');
                Technique.text(checked.targetId, 'receipt.check.targetId');
                Technique.normalizeCheck(checked.check, 'receipt.check.check');
                if (!checked.outcome || typeof checked.outcome.success !== 'boolean') throw new Error('Receipt check requires an authoritative boolean outcome.');
            }
            const mutations = new Set();
            for (const effect of receipt.effects) {
                Technique.assertKeys(effect, ['targetId', 'effectId', 'kind', 'success', 'mutationId', 'amount', 'calculation', 'previousHealth', 'newHealth', 'delta', 'damageMode', 'status', 'calculations'], 'receipt.effect');
                Technique.text(effect.effectId, 'receipt.effect.effectId');
                Technique.text(effect.targetId, 'receipt.effect.targetId');
                if (!['healing', 'damage', 'buff', 'debuff'].includes(effect.kind) || typeof effect.success !== 'boolean') throw new Error('Invalid receipt effect.');
                if (effect.mutationId !== `${receipt.operationId}:effect:${effect.targetId}:${effect.effectId}` || mutations.has(effect.mutationId)) throw new Error('Invalid or duplicate receipt effect mutation ID.');
                mutations.add(effect.mutationId);
                if (!effect.success && Object.keys(effect).some(key => !['targetId', 'effectId', 'kind', 'success', 'mutationId'].includes(key))) throw new Error('Failed receipt effects cannot contain applied mutations.');
                if (effect.success && ['healing', 'damage'].includes(effect.kind)) {
                    for (const field of ['amount', 'previousHealth', 'newHealth', 'delta']) Technique.number(effect[field], `receipt.effect.${field}`);
                    if (effect.amount < 0 || effect.previousHealth < 0 || effect.newHealth < 0 || effect.newHealth - effect.previousHealth !== effect.delta || (effect.kind === 'damage' ? effect.delta > 0 || effect.damageMode !== 'technique' : effect.delta < 0)) throw new Error('Invalid receipt health mutation.');
                    this.#validateCalculation(effect.calculation, 'receipt.effect.calculation');
                    if (effect.calculation.amount !== effect.amount) throw new Error('Receipt health amount differs from its calculation.');
                } else if (effect.success) {
                    const status = new (require('./StatusEffect.js'))({ ...effect.status, register: false });
                    if (!status.techniqueProvenance || status.techniqueProvenance.techniqueId !== receipt.techniqueId || status.techniqueProvenance.effectId !== effect.effectId) throw new Error('Receipt status provenance mismatch.');
                    if (!Array.isArray(effect.calculations)) throw new Error('Receipt status requires resolved calculations.');
                    for (const calculation of effect.calculations) this.#validateCalculation(calculation, 'receipt.effect.statusCalculation', true, true);
                }
            }
            if (!receipt.effects.length || receipt.success !== receipt.effects.some(effect => effect.success) || receipt.costOutcome !== (receipt.success ? 'normal' : 'failure')) throw new Error('Receipt attempt outcome does not match its effects.');
            if (receipt.request.targetIds && receipt.effects.some(effect => !receipt.request.targetIds.includes(effect.targetId))) throw new Error('Receipt applied an effect to an unrequested target.');
            if (receipt.request.targetIds === null && receipt.effects.some(effect => effect.targetId !== receipt.actorId)) throw new Error('Implicit self-target receipt contains another target.');
            for (const effect of receipt.effects) if (!receipt.checks.some(check => check.targetId === effect.targetId && check.outcome.success === effect.success)) throw new Error('Receipt effect has no matching check outcome.');
        }
        if (receipt.techniqueChanges !== undefined) {
            if (!Array.isArray(receipt.techniqueChanges)) throw new Error('Receipt techniqueChanges must be an array.');
            for (const change of receipt.techniqueChanges) {
                Technique.assertKeys(change, ['kind', 'actorId', 'techniqueId', 'definitionRevision', 'personalRevision', 'provenance'], 'receipt.techniqueChange');
                if (!['learned', 'improved'].includes(change.kind) || change.actorId !== receipt.actorId || change.techniqueId !== receipt.techniqueId) throw new Error('Invalid receipt technique change identity.');
                Technique.number(change.personalRevision, 'receipt.techniqueChange.personalRevision', { integer: true, minimum: 1 });
                if (change.definitionRevision !== undefined) definitions.get(receipt.techniqueId).getRevision(Technique.number(change.definitionRevision, 'receipt.techniqueChange.definitionRevision', { integer: true, minimum: 1 }));
                if (change.provenance !== undefined) Technique.normalizeProvenance(change.provenance);
            }
        }
        if (receipt.kind === 'improve') {
            Technique.normalizeRevision(receipt.request.mechanics);
            Technique.normalizeProvenance(receipt.request.provenance);
            if (receipt.request.improvement !== undefined) {
                Technique.assertKeys(receipt.request.improvement, ['stepId', 'reason'], 'receipt.request.improvement');
                Technique.text(receipt.request.improvement.stepId, 'receipt.request.improvement.stepId');
                if (receipt.request.improvement.reason !== undefined) Technique.text(receipt.request.improvement.reason, 'receipt.request.improvement.reason');
            }
            if (receipt.request.rebalance !== undefined) {
                if (receipt.request.improvement !== undefined) throw new Error('A receipt cannot combine improvement and rebalance requests.');
                const request = receipt.request.rebalance;
                Technique.assertKeys(request, ['expectedDefinitionRevision', 'expectedPersonalRevision', 'expectedPolicyDigest', 'recipe'], 'receipt.request.rebalance');
                for (const key of ['expectedDefinitionRevision', 'expectedPersonalRevision']) Technique.number(request[key], `receipt.request.rebalance.${key}`, { integer: true, minimum: 1 });
                Technique.text(request.expectedPolicyDigest, 'receipt.request.rebalance.expectedPolicyDigest');
                BalancePolicy.validateRecipeProposal(request.recipe);
            }
        }
        if (['improve', 'evidence'].includes(receipt.kind)) {
            if (!Array.isArray(receipt.evidenceIds) || receipt.evidenceIds.some(id => typeof id !== 'string' || !id) || new Set(receipt.evidenceIds).size !== receipt.evidenceIds.length) throw new Error('Invalid receipt evidence IDs.');
        }
        return receipt;
    }

    static #validateCalculation(calculation, label, authored = false, status = false) {
        Technique.assertKeys(calculation, ['amount', 'inputs', 'authored', ...(status ? ['field', 'identity', 'magnitude'] : [])], label);
        Technique.number(calculation.amount, `${label}.amount`);
        if (!calculation.inputs || typeof calculation.inputs !== 'object' || Array.isArray(calculation.inputs)) throw new Error(`${label}.inputs must be an object.`);
        for (const [key, value] of Object.entries(calculation.inputs)) Technique.number(value, `${label}.inputs.${key}`);
        if (authored || calculation.authored !== undefined) Technique.normalizeAmount(calculation.authored, `${label}.authored`, { signed: status });
        if (status && (!['attributes', 'skills', 'needBars', 'maxHealthPercent'].includes(calculation.field) || typeof calculation.identity !== 'string' || !calculation.identity)) throw new Error(`${label} status binding is invalid.`);
        if (status && calculation.magnitude !== undefined && !['modifier', 'percentModifier', 'delta', 'maxHealthPercent'].includes(calculation.magnitude)) throw new Error(`${label} status magnitude is invalid.`);
    }

    static validateState(value, { actors = [], things = [] } = {}) {
        const state = value === undefined ? { disciplines: new Map(), definitions: new Map(), receipts: new Map() } : this.#normalizeState(value);
        this.#validateReferences(state, actors, things);
        return true;
    }

    static hydrate(value) {
        const state = value === undefined ? { disciplines: new Map(), definitions: new Map(), receipts: new Map() } : this.#normalizeState(value);
        this.reset();
        this.#disciplines = state.disciplines;
        this.#definitions = state.definitions;
        this.#receipts = state.receipts;
        this.#icons = state.icons ?? new Map();
        this.#disciplineIcons = state.disciplineIcons ?? new Map();
        for (const id of this.#disciplines.keys()) IdGenerator.register('discipline', id);
        for (const id of this.#definitions.keys()) IdGenerator.register('technique', id);
    }

    static toJSON({ includePresentation = true } = {}) {
        return { version: 1, disciplines: clone([...this.#disciplines.values()]), definitions: [...this.#definitions.values()].map(value => value.toJSON()), receipts: clone([...this.#receipts.values()]), ...(includePresentation ? { icons: clone(Object.fromEntries(this.#icons)), disciplineIcons: clone(Object.fromEntries(this.#disciplineIcons)) } : {}) };
    }

    static #normalizeIcon(value, label = 'Technique icon') {
        Technique.assertKeys(value, ['imageId', 'imagePrompt'], label);
        if (value.imageId !== undefined && value.imageId !== null && (typeof value.imageId !== 'string' || !value.imageId.trim())) throw new TypeError(`${label} imageId must be null or a nonempty string.`);
        if (value.imagePrompt !== undefined && typeof value.imagePrompt !== 'string') throw new TypeError(`${label} imagePrompt must be a string.`);
        return { imageId: value.imageId?.trim() || null, imagePrompt: value.imagePrompt?.trim() || '' };
    }

    static getRuntimeEpoch() { return this.#epoch; }

    static getIcon(id) {
        this.#requireDefinition(id);
        return clone(this.#icons.get(id) ?? { imageId: null, imagePrompt: '' });
    }

    static setIcon(id, updates) {
        this.#requireDefinition(id);
        Technique.assertKeys(updates, ['imageId', 'imagePrompt'], 'technique icon updates');
        const value = this.#normalizeIcon({ ...this.getIcon(id), ...updates });
        this.#icons.set(id, value);
        return clone(value);
    }

    static getDiscipline(id) {
        const value = this.#disciplines.get(id);
        return value ? clone(value) : null;
    }

    static getDisciplineIcon(id) {
        if (!this.#disciplines.has(id)) throw new Error(`Unknown discipline ${id}. ${this.availableDisciplineIds()}`);
        return clone(this.#disciplineIcons.get(id) ?? { imageId: null, imagePrompt: '' });
    }

    static setDisciplineIcon(id, updates) {
        Technique.assertKeys(updates, ['imageId', 'imagePrompt'], 'discipline icon updates');
        const value = this.#normalizeIcon({ ...this.getDisciplineIcon(id), ...updates }, 'Discipline icon');
        this.#disciplineIcons.set(id, value);
        return clone(value);
    }

    static #validateReferences(state, actors, things) {
        const actorEntries = actorList(actors);
        const items = actorList(things);
        const grantIds = new Set();
        const requireDefinition = (id, revision) => {
            const definition = state.definitions.get(id);
            if (!definition) throw new Error(`Missing referenced technique ${id}.`);
            definition.getRevision(revision);
            return definition;
        };
        for (const actor of actorEntries) {
            for (const access of Technique.normalizeDisciplineAccess(actor.disciplineAccess)) {
                if (!state.disciplines.has(access.disciplineId)) throw new Error(`${actor.id}: missing discipline ${access.disciplineId}. ${this.availableDisciplineIds(state.disciplines)}`);
            }
            for (const entry of Technique.normalizeLearned(actor.techniques)) {
                requireDefinition(entry.techniqueId, entry.definitionRevision);
                for (const revision of [entry.mechanics, ...entry.revisionHistory]) this.#validateRequirementReferences([...revision.acquisitionRequirements, ...revision.useRequirements], state.disciplines, state.definitions);
                for (const evidence of entry.evidence) if (evidence.usedBy) {
                    const receipt = state.receipts.get(evidence.usedBy);
                    if (!receipt || receipt.kind !== 'improve' || receipt.actorId !== actor.id || receipt.techniqueId !== entry.techniqueId || !receipt.evidenceIds.includes(evidence.id)) throw new Error(`Evidence ${evidence.id}: missing matching personal improvement receipt.`);
                }
            }
            const ownedAbilities = typeof actor.getAbilities === 'function' ? actor.getAbilities() : actor.abilities ?? [];
            if (!Array.isArray(ownedAbilities)) throw new Error(`${actor.id}: abilities must be an array.`);
            const statuses = typeof actor.getStatusEffects === 'function'
                ? actor.getStatusEffects()
                : [...(actor.statusEffects ?? []), ...ownedAbilities.flatMap(ability => ability.statusEffects ?? [])];
            const statusSourceIds = new Set();
            for (const status of statuses) {
                if (status.duration === 0) continue;
                for (const grant of Technique.normalizeStatusGrants(status.techniqueGrants ?? [], status.id)) {
                    requireDefinition(grant.techniqueId, grant.definitionRevision);
                    const sourceId = `status:${actor.id}:${grant.id}`;
                    if (statusSourceIds.has(sourceId)) throw new Error(`Duplicate active status technique source ${sourceId}.`);
                    statusSourceIds.add(sourceId);
                }
            }
            for (const effect of statuses) if (effect.techniqueProvenance) {
                const provenance = require('./StatusEffect.js').normalizeTechniqueProvenance(effect.techniqueProvenance);
                requireDefinition(provenance.techniqueId, provenance.definitionRevision);
                const receipt = state.receipts.get(provenance.operationId);
                if (!receipt || receipt.kind !== 'use' || !receipt.effects.some(entry => entry.targetId === actor.id && entry.effectId === provenance.effectId && entry.success)) throw new Error(`Status ${effect.id}: missing matching committed technique effect receipt.`);
                if (receipt.techniqueId !== provenance.techniqueId || receipt.actorId !== provenance.actorId || !same(receipt.source, this.#sourceIdentity(provenance))) throw new Error(`Status ${effect.id}: technique provenance does not match its receipt source.`);
            }
        }
        for (const thing of items) {
            for (const grant of Technique.normalizeGrants(thing.techniqueGrants, thing.id)) {
                requireDefinition(grant.techniqueId, grant.definitionRevision);
                if (grantIds.has(grant.id)) throw new Error(`Duplicate world technique grant ${grant.id}.`);
                grantIds.add(grant.id);
            }
            const raw = typeof thing.toJSON === 'function' ? thing.toJSON() : thing;
            const statusTemplates = [
                ...(raw.statusEffects ?? []), raw.causeStatusEffectOnTarget, raw.causeStatusEffectOnEquipper,
                ...((raw.causeStatusEffects ?? []).map(entry => entry?.effect ?? entry))
            ].filter(Boolean);
            for (const status of statusTemplates) for (const grant of Technique.normalizeStatusGrants(status.techniqueGrants ?? [], status.id)) requireDefinition(grant.techniqueId, grant.definitionRevision);
        }
        // Receipts are immutable historical facts. Nonpersistent NPCs may have
        // been removed after death; only active owner/status/item references
        // above require a current live entity.
    }

    static validateReferences({ actors = require('./Player.js').getAll(), things = require('./Thing.js').getAll() } = {}) {
        this.#validateReferences({ disciplines: this.#disciplines, definitions: this.#definitions, receipts: this.#receipts }, actors, things);
        return true;
    }

    static getDisciplines() { return clone([...this.#disciplines.values()]); }

    /** Advisory editor baseline; the runtime identity is deliberately not persisted. */
    static getDisciplineEditContext(actor) {
        this.#assertActor(actor);
        return {
            worldId: this.#disciplineEditWorldId,
            disciplines: this.getDisciplines().map(({ id, name, description }) => ({ id, name, description })),
            disciplineAccess: actor.disciplineAccess
        };
    }

    /** Shared presentation and one actor's explicit access commit together. */
    static editDisciplines({ actor, edits, accessIds, accessReason, expected }) {
        this.#assertActor(actor);
        Technique.assertKeys(expected, ['worldId', 'disciplines', 'disciplineAccess'], 'discipline editor baseline');
        if (expected.worldId !== this.#disciplineEditWorldId) throw new Error('The technique world changed. Reopen Edit discipline before saving.');
        if (!Array.isArray(expected.disciplines)) throw new TypeError('The discipline editor baseline requires disciplines.');
        const baseline = new Map();
        for (const entry of expected.disciplines) {
            Technique.assertKeys(entry, ['id', 'name', 'description'], 'discipline editor baseline entry');
            const id = Technique.text(entry.id, 'baseline discipline.id');
            const value = { id, name: Technique.text(entry.name, 'baseline discipline.name'), description: Technique.text(entry.description, 'baseline discipline.description') };
            if (baseline.has(id)) throw new Error(`Duplicate baseline discipline ${id}.`);
            baseline.set(id, value);
        }
        const previousAccess = actor.disciplineAccess;
        const expectedAccess = Technique.normalizeDisciplineAccess(expected.disciplineAccess);
        const byId = values => [...values].sort((left, right) => left.disciplineId.localeCompare(right.disciplineId));
        if (!same(byId(expectedAccess), byId(previousAccess))) throw new Error('This character’s discipline access changed. Reopen Edit discipline before saving.');
        if (!Array.isArray(edits)) throw new TypeError('Discipline edits must be an array.');
        if (!Array.isArray(accessIds)) throw new TypeError('Discipline accessIds must be an array.');
        if (accessReason !== undefined && typeof accessReason !== 'string') throw new TypeError('Discipline accessReason must be a string.');
        const disciplines = new Map(this.#disciplines);
        const editedIds = new Set();
        for (const edit of edits) {
            Technique.assertKeys(edit, ['id', 'name', 'description'], 'discipline edit');
            const id = Technique.text(edit.id, 'discipline edit.id');
            if (editedIds.has(id)) throw new Error(`Duplicate discipline edit ${id}.`);
            editedIds.add(id);
            const previous = this.#disciplines.get(id);
            if (!previous) throw new Error(`Unknown discipline ${id}. ${this.availableDisciplineIds()}`);
            if (!same(baseline.get(id), { id, name: previous.name, description: previous.description })) throw new Error(`Discipline ${id} changed. Reopen Edit discipline before saving.`);
            disciplines.set(id, Technique.normalizeDiscipline({ ...previous, name: edit.name, description: edit.description }));
        }
        const requestedIds = new Set();
        const access = Technique.normalizeDisciplineAccess(accessIds.map(value => {
            const disciplineId = Technique.text(value, 'discipline access ID');
            if (requestedIds.has(disciplineId)) throw new Error(`Duplicate discipline access ${disciplineId}.`);
            requestedIds.add(disciplineId);
            if (!disciplines.has(disciplineId)) throw new Error(`Unknown discipline ${disciplineId}. ${this.availableDisciplineIds(disciplines)}`);
            const previous = previousAccess.find(entry => entry.disciplineId === disciplineId);
            if (previous) return previous;
            const reason = Technique.text(accessReason, 'Reason / source of newly granted access');
            return { disciplineId, provenance: { kind: 'editor', reason } };
        }));
        const disciplinesChanged = [...editedIds].some(id => !same(this.#disciplines.get(id), disciplines.get(id)));
        const accessChanged = !same(byId(previousAccess), byId(access));
        try {
            if (accessChanged) actor.disciplineAccess = access;
            if (disciplinesChanged) this.#disciplines = disciplines;
        } catch (cause) {
            try {
                if (!same(actor.disciplineAccess, previousAccess)) actor.disciplineAccess = previousAccess;
            } catch (rollbackError) {
                throw new AggregateError([cause, rollbackError], 'Discipline editing failed and access rollback was incomplete. Do not retry; inspect the character state.');
            }
            throw cause;
        }
        return { disciplinesChanged, accessChanged };
    }
    static getDefinition(id) { const value = this.#definitions.get(id); return value ? value.toJSON() : null; }
    static getDefinitions() { return [...this.#definitions.values()].map(value => value.toJSON()); }
    static getReceipt(operationId) { const value = this.#receipts.get(operationId); return value ? clone(value) : null; }
    static getReceiptsForTurn(turnId) { return clone([...this.#receipts.values()].filter(receipt => receipt.kind === 'use' && receipt.turnId === turnId)); }

    static availableDisciplineIds(disciplines = this.#disciplines) {
        const values = disciplines instanceof Map ? [...disciplines.keys()] : disciplines.map(value => value.id);
        return `Available discipline IDs: ${values.join(', ') || 'none'}.`;
    }

    /** Resolve new proposals without changing saved identities or canonical rules. */
    static resolveDiscipline(raw, { disciplines = this.#disciplines } = {}) {
        const catalogue = disciplines instanceof Map ? disciplines : new Map(disciplines.map(value => [value.id, value]));
        Technique.assertKeys(raw, ['id', 'name', 'description', 'accessRequirements', 'publicAccess', 'provenance'], 'discipline');
        // An ID-bearing reviewed draft may outlive a catalogue rename.
        if (raw.id !== undefined && catalogue.has(raw.id)) {
            Technique.normalizeDiscipline(raw);
            return clone(catalogue.get(raw.id));
        }
        const normalizedName = IdGenerator.normalizeName(Technique.text(raw.name, 'discipline.name'));
        const matches = [...catalogue.values()].filter(value => /[\p{L}\p{N}]/u.test(value.name) && IdGenerator.normalizeName(value.name) === normalizedName);
        if (matches.length > 1) throw new Error(`discipline.name "${raw.name}" matches multiple existing discipline IDs: ${matches.map(value => value.id).join(', ')}. Resolve the catalogue ambiguity before proposing this discipline; existing IDs and references are preserved.`);
        if (matches.length) {
            const existing = matches[0];
            Technique.normalizeDiscipline({ ...raw, id: raw.id ?? existing.id });
            if (raw.id !== undefined && raw.id !== existing.id) throw new Error(`discipline.id ${raw.id} conflicts with canonical discipline ${existing.id} for title "${raw.name}". Reuse the canonical discipline ID without a new candidateDiscipline; existing draft identities cannot be rewritten.`);
            return clone(existing);
        }
        const id = raw.id ?? IdGenerator.nextNamed('discipline', raw.name);
        if (catalogue.has(id)) throw new Error(`discipline.name "${raw.name}" derives occupied ID ${id}, which belongs to "${catalogue.get(id).name}". Reuse the existing canonical discipline if appropriate, or choose a distinct title; its saved ID and references cannot be overwritten.`);
        const value = Technique.normalizeDiscipline({ ...raw, id });
        IdGenerator.register('discipline', value.id);
        return value;
    }

    static #resolveCandidateDiscipline(candidate, proposal, disciplines = this.#disciplines) {
        if (!proposal) return { candidate, candidateDiscipline: null };
        const candidateDiscipline = this.resolveDiscipline(proposal, { disciplines });
        if (candidate && candidate.disciplineId !== undefined && candidate.disciplineId !== candidateDiscipline.id) throw new Error('Candidate discipline identity does not match candidate technique. Reuse its canonical disciplineId without candidateDiscipline, or omit disciplineId for a new sibling discipline.');
        return { candidate: candidate ? { ...candidate, disciplineId: candidateDiscipline.id } : candidate, candidateDiscipline };
    }

    static addDiscipline(raw) {
        const value = this.resolveDiscipline(raw);
        if (this.#disciplines.has(value.id)) return clone(this.#disciplines.get(value.id));
        this.#disciplines.set(value.id, value);
        IdGenerator.register('discipline', value.id);
        return clone(value);
    }

    static addDefinition(raw, { actor, origin = 'automatic', config } = {}) {
        const value = new Technique(BalancePolicy.materializeDefinition(raw, { actor, origin, config }));
        if (this.#definitions.has(value.id)) throw new Error(`Technique ${value.id} already exists.`);
        if (!this.#disciplines.has(value.disciplineId)) throw new Error(`Unknown discipline ${value.disciplineId}. ${this.availableDisciplineIds()}`);
        const definitions = new Map([...this.#definitions, [value.id, value]]);
        for (const revision of value.revisions) {
            this.#validateRequirementReferences([...revision.acquisitionRequirements, ...revision.useRequirements], this.#disciplines, definitions);
            for (const effect of revision.effects) for (const grant of effect.status?.techniqueGrants ?? []) {
                const granted = definitions.get(grant.techniqueId);
                if (!granted) throw new Error(`Technique status references missing grant ${grant.techniqueId}. For an authored nested grant, select an existing catalogue techniqueId and definitionRevision; an invalid grant in an existing catalogue definition requires catalogue repair.`);
                granted.getRevision(grant.definitionRevision);
            }
        }
        if (!value.unique && this.#findEquivalent(value)) throw new Error(`Common technique ${value.semanticKey} already exists.`);
        this.#definitions.set(value.id, value);
        IdGenerator.register('technique', value.id);
        return value.toJSON();
    }

    static #attachmentAbilitySnapshot(ability) {
        const { imageId, imagePrompt, ...mechanics } = ability;
        return mechanics;
    }

    static getAbilityAttachmentExpected(actor, abilityIds, { pendingAbility = null } = {}) {
        this.#assertActor(actor);
        if (!Array.isArray(abilityIds) || !abilityIds.length || new Set(abilityIds).size !== abilityIds.length) throw new Error('Attachment expectation requires distinct ability IDs.');
        const abilities = actor.getAbilities();
        if (pendingAbility) {
            if (abilityIds.length !== 1 || pendingAbility.id !== abilityIds[0] || abilities.some(entry => entry.id === pendingAbility.id)) {
                throw new Error('Pending attachment preview requires one distinct, unowned ability.');
            }
            abilities.push(clone(pendingAbility));
        }
        return {
            worldId: this.#epoch,
            actorId: actor.id,
            abilities: abilityIds.map(id => {
                const ability = abilities.find(entry => entry.id === Technique.text(id, 'abilityId'));
                if (!ability) throw new Error(`Ability ${id} is no longer owned by ${actor.name}.`);
                return this.#attachmentAbilitySnapshot(ability);
            })
        };
    }

    static #prepareAbilityAttachmentBatch({ actor, entries, expected, origin = 'automatic', pendingAbility = null }) {
        this.#assertActor(actor);
        if (!['automatic', 'editor'].includes(origin)) throw new Error('Unknown ability attachment authoring origin.');
        if (!Array.isArray(entries) || !entries.length) throw new Error('Ability attachment batch requires entries.');
        const ids = entries.map(entry => Technique.text(entry?.abilityId, 'attachment abilityId'));
        if (new Set(ids).size !== ids.length) throw new Error('Ability attachment batch contains duplicate abilities.');
        const baseline = this.getAbilityAttachmentExpected(actor, ids, { pendingAbility });
        if (expected !== undefined && !same(expected, baseline)) throw new Error('Ability attachments changed after generation; review a fresh draft.');
        // Reserve supplied draft identities before assigning any new compact IDs in this batch.
        for (const entry of entries) for (const status of (Array.isArray(entry?.statusEffects) ? entry.statusEffects : [])) {
            IdGenerator.register('status', status?.id);
            for (const grant of (Array.isArray(status?.techniqueGrants) ? status.techniqueGrants : [])) IdGenerator.register('techniqueGrant', grant?.id);
            for (const option of (Array.isArray(status?.techniqueEntries) ? status.techniqueEntries : [])) {
                IdGenerator.register('techniqueGrant', option?.id);
                IdGenerator.register('discipline', option?.candidateDiscipline?.id);
                IdGenerator.register('technique', option?.candidate?.id);
            }
        }
        const disciplines = new Map(this.#disciplines);
        const definitions = new Map(this.#definitions);
        const draftEntries = [];
        const resolvedEntries = [];
        const issues = new ValidationIssueCollector();
        const currentAbilities = actor.getAbilities();
        if (pendingAbility) currentAbilities.push(clone(pendingAbility));
        for (const [entryIndex, entry] of entries.entries()) {
            if (issues.full) break;
            issues.capture(() => {
            Technique.assertKeys(entry, ['abilityId', 'statusEffects'], `attachment entries[${entryIndex}]`);
            const ability = currentAbilities.find(value => value.id === entry.abilityId);
            if (!ability) throw new Error(`Ability ${entry.abilityId} is no longer owned by ${actor.name}.`);
            if (!Array.isArray(entry.statusEffects)) throw new TypeError(`Ability ${entry.abilityId} statusEffects must be an array.`);
            const draftStatuses = [];
            const resolvedStatuses = [];
            for (const [statusIndex, raw] of entry.statusEffects.entries()) {
                if (issues.full) break;
                const priorDisciplines = new Map(disciplines), priorDefinitions = new Map(definitions);
                try {
                    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`Ability ${entry.abilityId} status ${statusIndex} must be an object.`);
                    const statusIssues = new ValidationIssueCollector();
                    const { techniqueEntries, ...statusFields } = raw;
                    if (statusFields.techniqueGrants !== undefined && techniqueEntries !== undefined) throw new Error('Status cannot combine techniqueGrants with techniqueEntries. Use techniqueEntries for an authored draft, or techniqueGrants for resolved references; keep one representation.');
                    const statusId = statusFields.id ?? IdGenerator.next('status', (typeof statusFields.name === 'string' && statusFields.name.trim()) || statusFields.description);
                    const status = new (require('./StatusEffect.js'))({ ...statusFields, id: statusId, duration: statusFields.duration ?? -1, register: false });
                    if (status.duration !== -1) statusIssues.add(new Error(`Ability status ${statusId} must be permanent. Set duration to -1; temporary activated changes belong in a granted technique effect.status.`));
                    if (status.needBars.length) statusIssues.add(new Error(`Ability status ${statusId} cannot contain per-minute need bars. Remove outer needBars; supported activated need changes belong in a granted technique effect.status.needBars.`));
                    for (const [index, modifier] of status.attributes.entries()) if (!actor.getAttributeNames().some(name => name.toLowerCase() === modifier.attribute.toLowerCase())) statusIssues.add(new Error(`attributes[${index}]: Ability status ${statusId} has unknown attribute ${modifier.attribute}. Select an actual owner attribute: ${actor.getAttributeNames().join(", ")}.`));
                    for (const [index, modifier] of status.skills.entries()) if (![...actor.getSkills().keys()].some(name => name.toLowerCase() === modifier.skill.toLowerCase())) statusIssues.add(new Error(`skills[${index}]: Ability status ${statusId} has unknown skill ${modifier.skill}. Select an actual owner skill: ${[...actor.getSkills().keys()].join(", ") || "none available"}.`));
                    const canonicalEntries = [];
                    const grants = statusFields.techniqueGrants === undefined ? [] : statusIssues.capture(() => Technique.normalizeStatusGrants(statusFields.techniqueGrants, statusId));
                    if (techniqueEntries !== undefined) {
                        if (!Array.isArray(techniqueEntries)) statusIssues.add(new TypeError(`Ability status ${statusId} techniqueEntries must be an array.`));
                        for (const [grantIndex, rawOption] of (Array.isArray(techniqueEntries) ? techniqueEntries : []).entries()) {
                            if (statusIssues.full) break;
                            try {
                                Technique.assertKeys(rawOption, ['id', 'techniqueId', 'definitionRevision', 'candidate', 'candidateDiscipline', 'provenance'], `ability status ${statusId} techniqueEntries[${grantIndex}]`);
                                const option = clone(rawOption);
                                let proposedDiscipline = null;
                                if (option.candidateDiscipline) {
                                    proposedDiscipline = this.resolveDiscipline(option.candidateDiscipline, { disciplines });
                                    option.candidateDiscipline = clone(proposedDiscipline);
                                    const existingDiscipline = disciplines.get(proposedDiscipline.id);
                                    if (existingDiscipline && !same(existingDiscipline, proposedDiscipline)) throw new Error(`Cannot overwrite discipline ${proposedDiscipline.id}. Reuse its existing catalogue ID without candidateDiscipline, or propose a distinct new discipline without a supplied ID.`);
                                }
                                if (option.candidate) {
                                    option.candidate.id ??= IdGenerator.next('technique', option.candidate.name);
                                    if (proposedDiscipline && option.candidate.disciplineId !== undefined && option.candidate.disciplineId !== proposedDiscipline.id) throw new Error('Technique candidate and proposed discipline IDs disagree. Reuse an existing candidate.disciplineId without candidateDiscipline, or omit disciplineId when proposing its sibling candidateDiscipline.');
                                    option.candidate.disciplineId ??= proposedDiscipline?.id;
                                    option.candidate.provenance ??= { kind: 'generation', reason: `Attached to ${ability.name}` };
                                    // Pending drafts persist the actual choices resolved during this preview.
                                    const recipes = new ValidationIssueCollector();
                                    for (const [revisionIndex, revision] of (option.candidate.revisions || []).entries()) if (revision.recipe) recipes.capture(() => {
                                        try { revision.recipe = BalancePolicy.resolveAuthoringRecipeProposal(revision.recipe, { actor }); }
                                        catch (cause) { throw withValidationContext(cause, `candidate.revisions[${revisionIndex}]`); }
                                    });
                                    recipes.throwIfAny();
                                }
                                let definition = definitions.get(option.techniqueId ?? option.candidate?.id);
                                if (definition && option.candidate && !same(definition.toJSON(), new Technique(BalancePolicy.materializeDefinition(option.candidate, { actor, origin })).toJSON())) throw new Error(`Attachment candidate cannot overwrite technique ${definition.id}. Reference it using techniqueId without candidate, or propose a distinct new candidate without a supplied ID.`);
                                if (!definition && option.candidate) {
                                    const candidate = new Technique(BalancePolicy.materializeDefinition(option.candidate, { actor, origin }));
                                    definition = [...definitions.values()].find(value => !value.unique && !candidate.unique && value.disciplineId === candidate.disciplineId && value.semanticKey === candidate.semanticKey) ?? candidate;
                                }
                                if (!definition) throw new Error(`Unknown attached technique ${option.techniqueId ?? option.candidate?.id}. Use an existing catalogue techniqueId, or provide a complete new candidate instead of the reference.`);
                                if (!disciplines.has(definition.disciplineId) && proposedDiscipline?.id !== definition.disciplineId) throw new Error(`Missing discipline ${definition.disciplineId} for attached technique. ${this.availableDisciplineIds(disciplines)} A new candidate needs an existing catalogue disciplineId or sibling candidateDiscipline; an existing definition with a missing discipline needs catalogue repair.`);
                                option.techniqueId = definition.id;
                                const revision = definition.getRevision(option.definitionRevision);
                                option.definitionRevision = revision.revision;
                                const checks = new ValidationIssueCollector();
                                checks.capture(() => Technique.validateRevisionAmounts(revision, actor, `ability ${ability.name} technique ${definition.name}`));
                                checks.capture(() => this.#costs(actor, revision.costs, 'ability technique costs', { requireAffordable: false }));
                                checks.capture(() => this.#costs(actor, revision.failureCosts ?? [], 'ability technique failure costs', { requireAffordable: false }));
                                const candidateDisciplines = new Map(disciplines), candidateDefinitions = new Map(definitions);
                                if (proposedDiscipline) candidateDisciplines.set(proposedDiscipline.id, proposedDiscipline);
                                candidateDefinitions.set(definition.id, definition);
                                checks.capture(() => this.#validateRequirementReferences([...revision.acquisitionRequirements, ...revision.useRequirements], candidateDisciplines, candidateDefinitions));
                                checks.throwIfAny();
                                const grant = { id: option.id ?? `status_grant:${statusId}:${grantIndex}`, sourceStatusId: statusId, techniqueId: definition.id, definitionRevision: revision.revision, ...(option.provenance ? { provenance: Technique.normalizeProvenance(option.provenance) } : {}) };
                                option.id = grant.id;
                                grants.push(grant);
                                canonicalEntries.push(option);
                                if (proposedDiscipline) disciplines.set(proposedDiscipline.id, proposedDiscipline);
                                if (!definitions.has(definition.id)) definitions.set(definition.id, definition);
                            } catch (cause) {
                                statusIssues.add(withValidationContext(cause, `techniqueEntries[${grantIndex}]`));
                            }
                        }
                    }
                    statusIssues.throwIfAny();
                    status.update({ techniqueGrants: grants });
                    for (const grant of status.techniqueGrants) {
                        const granted = definitions.get(grant.techniqueId);
                        if (!granted) throw new Error(`Ability status ${statusId} references missing technique ${grant.techniqueId}. Choose an existing catalogue techniqueId and valid definitionRevision for this grant.`);
                        granted.getRevision(grant.definitionRevision);
                    }
                    resolvedStatuses.push(status.toJSON());
                    draftStatuses.push({ ...statusFields, id: statusId, duration: -1, ...(techniqueEntries === undefined ? { techniqueGrants: grants } : { techniqueEntries: canonicalEntries }) });
                } catch (cause) {
                    // Failed statuses must not make invalid definitions available
                    // to subsequent independent sibling validation.
                    disciplines.clear(); for (const [id, value] of priorDisciplines) disciplines.set(id, value);
                    definitions.clear(); for (const [id, value] of priorDefinitions) definitions.set(id, value);
                    issues.add(withValidationContext(cause, `attachment entries[${entryIndex}].statusEffects[${statusIndex}]`));
                }
            }
            resolvedEntries.push({ abilityId: ability.id, statusEffects: resolvedStatuses });
            draftEntries.push({ abilityId: ability.id, statusEffects: draftStatuses });
            });
        }
        issues.throwIfAny();
        for (const discipline of disciplines.values()) this.#validateRequirementReferences(discipline.accessRequirements, disciplines, definitions);
        for (const definition of definitions.values()) for (const revision of definition.revisions) {
            this.#validateRequirementReferences([...revision.acquisitionRequirements, ...revision.useRequirements], disciplines, definitions);
            for (const effect of revision.effects) for (const grant of effect.status?.techniqueGrants ?? []) {
                const granted = definitions.get(grant.techniqueId);
                if (!granted) throw new Error(`Technique status references missing grant ${grant.techniqueId}. For an authored nested grant, select an existing catalogue techniqueId and definitionRevision; an invalid grant in an existing catalogue definition requires catalogue repair.`);
                granted.getRevision(grant.definitionRevision);
            }
        }
        const prospectiveAbilities = currentAbilities.map(ability => {
            const update = resolvedEntries.find(entry => entry.abilityId === ability.id);
            return update ? { ...ability, statusEffects: update.statusEffects } : ability;
        });
        try { actor.previewMaxHealthForAbilities(prospectiveAbilities); }
        catch (cause) {
            throw new Error(`Prospective ability validation: ${cause.message} If maximum health is invalid, review the authored health-attribute and maxHealthPercent modifiers; the combined result must be finite and positive.`, { cause });
        }
        const prospectiveStatuses = [...actor.getIntrinsicStatusEffects(), ...prospectiveAbilities.flatMap(ability => ability.statusEffects ?? [])];
        const sourceIds = new Set();
        for (const status of prospectiveStatuses) for (const grant of status.techniqueGrants ?? []) {
            const sourceId = `status:${actor.id}:${grant.id}`;
            if (sourceIds.has(sourceId)) throw new Error(`Duplicate status technique source ${sourceId}. Give distinct grants distinct IDs; do not reuse a grant identity across statuses.`);
            sourceIds.add(sourceId);
        }
        return { actor, baseline, draftEntries, resolvedEntries, disciplines, definitions };
    }

    static previewAbilityAttachmentBatch(options) {
        const plan = this.#prepareAbilityAttachmentBatch(options);
        return {
            entries: clone(plan.draftEntries), resolvedEntries: clone(plan.resolvedEntries),
            newDisciplines: [...plan.disciplines.values()].filter(value => !this.#disciplines.has(value.id)).map(clone),
            newDefinitions: [...plan.definitions.values()].filter(value => !this.#definitions.has(value.id)).map(value => value.toJSON()),
            expected: clone(plan.baseline)
        };
    }

    static applyAbilityAttachmentBatch(options) {
        if (options?.pendingAbility) throw new Error('Pending ability attachments cannot be applied before selection.');
        const plan = this.#prepareAbilityAttachmentBatch(options);
        const beforeAbilities = plan.actor.getAbilities();
        const beforeHealth = plan.actor.health;
        const beforeDisciplines = this.#disciplines;
        const beforeDefinitions = this.#definitions;
        try {
            this.#disciplines = plan.disciplines;
            this.#definitions = plan.definitions;
            const replacement = beforeAbilities.map(ability => {
                const update = plan.resolvedEntries.find(entry => entry.abilityId === ability.id);
                return update ? { ...ability, statusEffects: update.statusEffects } : ability;
            });
            plan.actor.setAbilities(replacement);
            this.validateReferences();
            for (const id of this.#disciplines.keys()) if (!beforeDisciplines.has(id)) IdGenerator.register('discipline', id);
            for (const id of this.#definitions.keys()) if (!beforeDefinitions.has(id)) IdGenerator.register('technique', id);
            return { entries: clone(plan.resolvedEntries), newDisciplines: [...this.#disciplines.keys()].filter(id => !beforeDisciplines.has(id)), newDefinitions: [...this.#definitions.keys()].filter(id => !beforeDefinitions.has(id)) };
        } catch (cause) {
            this.#disciplines = beforeDisciplines;
            this.#definitions = beforeDefinitions;
            try { plan.actor.setAbilities(beforeAbilities); plan.actor.setHealth(beforeHealth); }
            catch (rollback) { throw new AggregateError([cause, rollback], 'Ability attachment rollback failed; do not retry.', { cause }); }
            throw cause;
        }
    }

    static reviseDefinition(id, mechanics, { actor, origin = 'automatic', config, convertToCustom = false } = {}) {
        const definition = this.#requireDefinition(id);
        if (definition.getRevision().balance && !mechanics.balance && !mechanics.recipe && !(origin === 'editor' && convertToCustom)) throw new Error('Managed catalogue edits must retain balance or explicitly convert to custom.');
        const revision = Technique.normalizeRevision(BalancePolicy.materializeRevision(mechanics, { actor, origin, config }));
        if (revision.revision !== definition.revisions.length + 1) throw new Error('A catalogue edit must append the next numbered revision.');
        this.#validateRequirementReferences([...revision.acquisitionRequirements, ...revision.useRequirements], this.#disciplines, this.#definitions);
        for (const effect of revision.effects) for (const grant of effect.status?.techniqueGrants ?? []) this.#requireDefinition(grant.techniqueId).getRevision(grant.definitionRevision);
        const replacement = new Technique({ ...definition.toJSON(), revisions: [...definition.revisions, revision] });
        this.#definitions.set(id, replacement);
        return replacement.toJSON();
    }

    static #requireDefinition(id) {
        const definition = this.#definitions.get(id);
        if (!definition) throw new Error(`Unknown technique ${id}.`);
        return definition;
    }

    static validateStatusGrants(effects) {
        if (!Array.isArray(effects)) throw new TypeError('Status grant validation requires an array.');
        const ids = new Set();
        for (const effect of effects) for (const grant of Technique.normalizeStatusGrants(effect.techniqueGrants ?? [], effect.id)) {
            if (ids.has(grant.id)) throw new Error(`Duplicate active status technique grant ${grant.id}.`);
            ids.add(grant.id);
            this.#requireDefinition(grant.techniqueId).getRevision(grant.definitionRevision);
        }
        return true;
    }

    static #findEquivalent(candidate) {
        return [...this.#definitions.values()].find(value => !value.unique && !candidate.unique && value.disciplineId === candidate.disciplineId && value.semanticKey === candidate.semanticKey);
    }

    static findMatches(intent, { actor = null } = {}) {
        const normalized = Technique.text(intent, 'technique intent').toLowerCase();
        const visible = actor ? new Set(this.getAvailable(actor, { includeBlocked: true }).map(entry => entry.techniqueId)) : null;
        return [...this.#definitions.values()].filter(value => (!visible || visible.has(value.id)) && [value.semanticKey, value.name, ...value.aliases].some(term => term.toLowerCase() === normalized)).map(value => value.toJSON());
    }

    static #assertActor(actor) {
        if (!actor || typeof actor.id !== 'string' || typeof actor.setTechniques !== 'function') throw new TypeError('Technique actor must be an authoritative Player.');
        if (getActor(actor.id) !== actor) throw new Error(`Technique actor ${actor.id} is not registered in this world.`);
    }

    static #assertEligible(actor) {
        this.#assertActor(actor);
        if (actor.isDead || actor.isDisabled || actor.health <= 0) throw new Error(`${actor.name} cannot start a technique while dead or disabled.`);
    }

    /** Actor-state rejection cannot be corrected by reauthoring technique mechanics. */
    static assertCanStart(actor) {
        this.#assertEligible(actor);
    }

    static #requirementErrors(actor, requirements, { evidence = [], visitedDisciplines = new Set() } = {}) {
        const errors = [];
        for (const requirement of requirements) {
            let passes;
            switch (requirement.kind) {
                case 'level': passes = actor.level >= requirement.minimum; break;
                case 'skill': {
                    const name = [...actor.getSkills().keys()].find(name => name.toLowerCase() === requirement.name.toLowerCase());
                    if (!name) throw new Error(`Unknown prerequisite skill ${requirement.name}.`);
                    passes = actor.getSkillValue(name) >= requirement.minimum;
                    break;
                }
                case 'attribute': {
                    const name = actor.getAttributeNames().find(name => name.toLowerCase() === requirement.name.toLowerCase());
                    if (!name) throw new Error(`Unknown prerequisite attribute ${requirement.name}.`);
                    passes = actor.getAttributeModifier(name) >= requirement.minimum;
                    break;
                }
                case 'discipline': {
                    if (visitedDisciplines.has(requirement.id)) throw new Error(`Cyclic technique discipline access ${requirement.id}.`);
                    const discipline = this.#disciplines.get(requirement.id);
                    if (!discipline) throw new Error(`Missing prerequisite discipline ${requirement.id}. Use an existing catalogue discipline ID for this prerequisite; do not invent a reference. ${this.availableDisciplineIds()}`);
                    const visited = new Set([...visitedDisciplines, requirement.id]);
                    passes = this.#disciplineErrors(actor, discipline, visited).length === 0;
                    break;
                }
                case 'technique': passes = actor.techniques.some(entry => entry.techniqueId === requirement.id); break;
                case 'equippedItem': passes = actor.hasEquippedThing(requirement.id); break;
                case 'equipmentType': passes = Object.values(actor.getGear()).some(slot => slot.itemId && [slot.slotType, slot.item?.itemTypeDetail, slot.item?.slot].some(type => typeof type === 'string' && type.toLowerCase() === requirement.name.toLowerCase())); break;
                case 'evidence': passes = [...evidence, ...actor.techniques.flatMap(entry => entry.evidence)].some(entry => entry.id === requirement.id); break;
                case 'ability': passes = actor.getAbilities().some(entry => entry.name.toLowerCase() === requirement.name.toLowerCase()); break;
                case 'class': case 'race': passes = typeof actor[requirement.kind] === 'string' && actor[requirement.kind].toLowerCase() === requirement.name.toLowerCase(); break;
                case 'status': passes = actor.getStatusEffects().some(entry => [entry.name, entry.description].some(name => typeof name === 'string' && name.toLowerCase() === requirement.name.toLowerCase())); break;
                case 'alive': passes = !actor.isDead && actor.health > 0; break;
                default: throw new Error(`Unsupported prerequisite ${requirement.kind}.`);
            }
            if (requirement.present === false) passes = !passes;
            if (!passes) errors.push(`Requires ${requirement.kind} ${requirement.name ?? requirement.id ?? ''}${requirement.minimum !== undefined ? ` >= ${requirement.minimum}` : ''}${requirement.present === false ? ' absent' : ''}.`);
        }
        return errors;
    }

    static #disciplineErrors(actor, discipline, visited = new Set([discipline.id])) {
        const access = actor.disciplineAccess.some(entry => entry.disciplineId === discipline.id);
        if (discipline.publicAccess || access) return [];
        if (!discipline.accessRequirements.length) return [`No established access to ${discipline.name}.`];
        // Baseline initialized skills are not evidence of discipline access.
        if (discipline.accessRequirements.every(entry => entry.kind === 'skill' && entry.minimum <= 1)) return [`${discipline.name} access cannot be established by baseline initialized skills.`];
        return this.#requirementErrors(actor, discipline.accessRequirements, { visitedDisciplines: visited });
    }

    static #sourceIdentity(source) {
        return { sourceId: source.sourceId, sourceKind: source.sourceKind, ...(source.itemId ? { itemId: source.itemId } : {}), ...(source.statusId ? { statusId: source.statusId } : {}), ...(source.abilityId ? { abilityId: source.abilityId } : {}), definitionRevision: source.definitionRevision, ...(source.personalRevision ? { personalRevision: source.personalRevision } : {}) };
    }

    static #sources(actor, techniqueId) {
        const definition = this.#requireDefinition(techniqueId);
        const sources = [];
        const learned = actor.techniques.find(entry => entry.techniqueId === techniqueId);
        if (learned) sources.push({ sourceId: `learned:${techniqueId}`, sourceKind: 'learned', definitionRevision: learned.definitionRevision, personalRevision: learned.personalRevision, mechanics: clone(learned.mechanics) });
        const seen = new Set();
        for (const slot of Object.values(actor.getGear())) {
            if (!slot.itemId || seen.has(slot.itemId)) continue;
            seen.add(slot.itemId);
            const item = slot.item;
            if (!item) throw new Error(`Equipped technique source item ${slot.itemId} is missing.`);
            for (const grant of item.techniqueGrants ?? []) if (grant.techniqueId === techniqueId && !grant.teaches) {
                if (grant.sourceItemId !== slot.itemId) throw new Error(`Grant ${grant.id} has an invalid source item.`);
                sources.push({ sourceId: grant.id, sourceKind: 'equipment', itemId: slot.itemId, itemName: item.name, definitionRevision: grant.definitionRevision, mechanics: definition.getRevision(grant.definitionRevision) });
            }
        }
        const abilityByStatus = new Map(actor.getAbilities().flatMap(ability => (ability.statusEffects ?? []).map(status => [status.id, ability])));
        for (const status of actor.getStatusEffects()) {
            if (status.duration === 0) continue;
            for (const grant of status.techniqueGrants ?? []) {
                if (grant.techniqueId !== techniqueId) continue;
                if (grant.sourceStatusId !== status.id) throw new Error(`Status grant ${grant.id} has an invalid source status.`);
                const ability = abilityByStatus.get(status.id);
                sources.push({ sourceId: `status:${actor.id}:${grant.id}`, sourceKind: 'status', statusId: status.id, statusName: status.name || status.description, ...(ability ? { abilityId: ability.id, abilityName: ability.name } : {}), definitionRevision: grant.definitionRevision, mechanics: definition.getRevision(grant.definitionRevision) });
            }
        }
        return sources;
    }

    static #chooseSource(sources, sourceId) {
        if (sourceId !== undefined && sourceId !== null && sourceId !== '') {
            const chosen = sources.find(source => source.sourceId === sourceId);
            if (!chosen) throw new Error(`Selected technique source ${sourceId} is no longer available.`);
            return chosen;
        }
        const learned = sources.find(source => source.sourceKind === 'learned');
        if (learned) return learned;
        if (!sources.length) throw new Error('Actor has not learned this technique and has no active grant.');
        if (sources.length === 1) return sources[0];
        if (sources.some(source => [...source.mechanics.costs, ...(source.mechanics.failureCosts ?? [])].some(cost => cost.resource === 'charge' && cost.binding === 'grantingItem'))) throw new Error('Multiple equipment sources bind charge costs to different exact items. Choose an explicit sourceId; an empty source never substitutes another item.');
        const mechanicalKey = mechanics => ({ ...mechanics, revision: 0 });
        if (!sources.every(source => same(mechanicalKey(source.mechanics), mechanicalKey(sources[0].mechanics)))) throw new Error('Active grants have different mechanics; choose an explicit source.');
        return [...sources].sort((a, b) => a.sourceId.localeCompare(b.sourceId))[0];
    }

    static resolveSource(actor, techniqueId, sourceId) {
        this.#assertActor(actor);
        return clone(this.#chooseSource(this.#sources(actor, techniqueId), sourceId));
    }

    static #resolveResource(actor, cost, source) {
        if (cost.resource === 'health') return { key: 'health', resource: 'health', direction: 'decrease', value: actor.health, min: 0, max: actor.maxHealth };
        if (cost.resource === 'charge') {
            const itemId = cost.binding === 'grantingItem' ? source?.sourceKind === 'equipment' && source.itemId : cost.itemId;
            if (!itemId) throw new Error('Charge cost binding grantingItem requires an equipped item technique source. Select that exact equipment source, or author binding ownedItem with a concrete owned itemId.');
            const item = require('./ItemChargeService.js').assertOwned(actor, itemId);
            const pool = item.chargePool;
            if (!pool) throw new Error(`Charge cost item ${itemId} has no chargePool. Select an owned item with a configured pool.`);
            return { key: `charge:${itemId}`, resource: 'charge', itemId, mode: pool.mode, unit: pool.unit, direction: 'decrease', value: pool.amount, min: 0, max: pool.capacity };
        }
        const bars = actor.getNeedBars({ scope: 'active' });
        const bar = bars.find(entry => entry.id === cost.needId);
        if (!bar) throw new Error(`Need resource ${cost.needId} is missing or inactive for ${actor.name}. Select an actual active needId: ${bars.map(entry => entry.id).join(", ") || "none available"}; do not invent a pool.`);
        const direction = cost.direction ?? bar.paymentDirection;
        if (!['increase', 'decrease'].includes(direction)) throw new Error(`Need resource ${bar.id} requires an explicit payment direction. Set direction to increase or decrease according to how this active pool is paid.`);
        if (cost.direction && bar.paymentDirection && cost.direction !== bar.paymentDirection) throw new Error(`Need resource ${bar.id} payment direction conflicts with its configuration. Use direction ${bar.paymentDirection}, or omit direction to use that configured value.`);
        for (const key of ['value', 'min', 'max']) Technique.number(bar[key], `${bar.id}.${key}`);
        return { key: `need:${bar.id}`, resource: 'need', needId: bar.id, direction, value: bar.value, min: bar.min, max: bar.max };
    }

    static #costs(actor, raw, label, { requireAffordable = true, source } = {}) {
        const byResource = new Map();
        for (const [index, cost] of raw.entries()) {
            // Authoring validates the amount before a particular equipment
            // grant exists. Runtime source checks always resolve its exact item.
            if (!source && !requireAffordable && cost.resource === 'charge' && cost.binding === 'grantingItem') {
                Technique.evaluateAmount(cost.amount, actor, `${label}[${index}].amount`);
                continue;
            }
            let resource;
            try { resource = this.#resolveResource(actor, cost, source); }
            catch (cause) { throw withValidationContext(cause, `${label}[${index}]`); }
            const evaluated = Technique.evaluateAmount(cost.amount, actor, `${label}[${index}].amount`);
            if (resource.resource === 'charge') ChargePool.validatePayment(resource, evaluated.amount, `${label}[${index}]`);
            let result = byResource.get(resource.key);
            if (result && result.direction !== resource.direction) throw new Error(`Conflicting cost directions for ${resource.key}. Use one consistent payment direction across costs for the same resource.`);
            if (!result) { result = { ...resource, amount: 0, calculations: [] }; byResource.set(resource.key, result); }
            result.amount = resource.resource === 'charge' ? ChargePool.add(result.amount, evaluated.amount) : result.amount + evaluated.amount;
            if (!Number.isFinite(result.amount)) throw new Error(`Nonfinite combined cost ${resource.key}. Reduce or correct the authored amounts/formulas so their sum is finite.`);
            result.calculations.push({ authored: clone(cost.amount), ...evaluated });
        }
        const costs = [...byResource.values()];
        for (const cost of costs) {
            cost.nextValue = cost.resource === 'charge' ? ChargePool.subtract(cost.value, cost.amount) : cost.value + (cost.direction === 'decrease' ? -cost.amount : cost.amount);
            if (requireAffordable && (!Number.isFinite(cost.nextValue) || cost.nextValue < cost.min || cost.nextValue > cost.max)) throw new Error(`Insufficient ${cost.key} for ${label}: requires ${cost.amount}, current ${cost.value}.`);
        }
        return costs;
    }

    static #sourceBlockers(actor, definition, source) {
        const errors = [];
        if (actor.isDead || actor.isDisabled || actor.health <= 0) errors.push('Actor is dead or disabled.');
        errors.push(...this.#requirementErrors(actor, source.mechanics.useRequirements));
        // Equipped grants themselves establish discipline access for their pinned use.
        if (source.sourceKind === 'learned') {
            // Acquired knowledge remains permanent; ongoing discipline gates are explicit use requirements.
        }
        try { BalancePolicy.validateManagedRevision(source.mechanics, actor); } catch (error) { errors.push(error.message); }
        let costs = [], failureCosts = [];
        try { costs = this.#costs(actor, source.mechanics.costs, 'normal costs', { requireAffordable: false, source }); } catch (error) { errors.push(error.message); }
        try { failureCosts = this.#costs(actor, source.mechanics.failureCosts ?? source.mechanics.costs, 'failure costs', { requireAffordable: false, source }); } catch (error) { errors.push(error.message); }
        for (const [label, vector] of [['normal', costs], ['failure', failureCosts]]) for (const cost of vector) if (!Number.isFinite(cost.nextValue) || cost.nextValue < cost.min || cost.nextValue > cost.max) errors.push(`Insufficient ${cost.key} for ${label} costs: requires ${cost.amount}, current ${cost.value}.`);
        return { ...clone(source), costs, failureCosts, available: errors.length === 0, blockers: errors };
    }

    static getAvailable(actor, { includeBlocked = true } = {}) {
        this.#assertActor(actor);
        const identities = new Set(actor.techniques.map(entry => entry.techniqueId));
        for (const slot of Object.values(actor.getGear())) for (const grant of slot.item?.techniqueGrants ?? []) if (!grant.teaches) identities.add(grant.techniqueId);
        for (const status of actor.getStatusEffects()) if (status.duration !== 0) for (const grant of status.techniqueGrants ?? []) identities.add(grant.techniqueId);
        return [...identities].map(techniqueId => {
            const definition = this.#requireDefinition(techniqueId);
            const discipline = this.#disciplines.get(definition.disciplineId);
            const sources = this.#sources(actor, techniqueId).map(source => this.#sourceBlockers(actor, definition, source));
            const savedBalance = sources.find(source => source.sourceKind === 'learned')?.mechanics.balance;
            const balanceImprovements = savedBalance ? { policyDigest: savedBalance.policy.digest, steps: Object.entries(savedBalance.policy.snapshot.improvementSteps).map(([stepId, step]) => ({ stepId, ...clone(step) })), appliedImprovementIds: [...savedBalance.parameters.appliedImprovementIds] } : null;
            let selectedSourceId = null;
            let blockers = [];
            try { selectedSourceId = this.#chooseSource(sources).sourceId; blockers = sources.find(source => source.sourceId === selectedSourceId).blockers; } catch (error) { blockers = [error.message]; }
            return { techniqueId, ...this.getIcon(techniqueId), name: definition.name, description: definition.description, disciplineId: definition.disciplineId, disciplineName: discipline.name, learned: sources.some(source => source.sourceKind === 'learned'), ...(balanceImprovements ? { balanceImprovements } : {}), sources, selectedSourceId, available: selectedSourceId !== null && blockers.length === 0, blockers };
        }).filter(entry => includeBlocked || entry.available);
    }

    static getEffectiveDisciplineAccess(actor) {
        this.#assertActor(actor);
        const accessible = new Map(this.getDisciplines()
            .filter(discipline => !this.#disciplineErrors(actor, discipline).length)
            .map(({ id, name, description }) => [id, { id, name, description }]));
        for (const technique of this.getAvailable(actor, { includeBlocked: true })) {
            for (const source of technique.sources) {
                if (source.sourceKind !== 'status' || !source.abilityId || accessible.has(technique.disciplineId)) continue;
                accessible.set(technique.disciplineId, {
                    id: technique.disciplineId, name: technique.disciplineName,
                    description: this.#disciplines.get(technique.disciplineId).description,
                    sourceKind: 'ability_status', sourceId: source.sourceId,
                    statusId: source.statusId, abilityId: source.abilityId,
                    abilityName: source.abilityName
                });
            }
        }
        return [...accessible.values()];
    }

    static getPromptContext(actors) {
        return actorList(actors).filter(Boolean).map(actor => ({ actorId: actor.id, actorName: actor.name, chargeItems: actor.getInventoryItems().filter(item => item.chargePool && !item.hiddenFromPlayer).map(item => ({ itemId: item.id, name: item.name, chargePool: item.chargePool, equipped: actor.hasEquippedThing(item.id) })), formulaVariables: TechniqueFormulaVariables.catalog(actor), balanceAuthoring: BalancePolicy.getAuthoringContext({ actor }), disciplineAccess: this.getEffectiveDisciplineAccess(actor), techniques: this.getAvailable(actor, { includeBlocked: true }) }));
    }

    static getCompactPromptContext(actors) {
        return require('./TechniquePromptContext.js').compactTechniquePromptContext(this.getPromptContext(actors));
    }

    static #assertAcquisition(actor, definition, revision, provenance, discipline = this.#disciplines.get(definition.disciplineId), catalogs = {}, { startingAcquisition = false } = {}) {
        this.#assertEligible(actor);
        if (!discipline) throw new Error(`Unknown discipline ${definition.disciplineId}. ${this.availableDisciplineIds(catalogs.disciplines ?? this.#disciplines)}`);
        const errors = [
            ...(startingAcquisition ? [] : [
                ...this.#disciplineErrors(actor, discipline),
                ...this.#requirementErrors(actor, revision.acquisitionRequirements)
            ])
        ];
        if (errors.length) throw new Error(`Cannot learn ${definition.name}: ${errors.join(' ')}`);
        if (definition.unique && [...require('./Player.js').getAll()].some(other => other.id !== actor.id && other.techniques.some(entry => entry.techniqueId === definition.id))) throw new Error(`Unique technique ${definition.name} is already learned by another actor.`);
        const definitions = new Map([...(catalogs.definitions ?? this.#definitions), [definition.id, definition]]);
        const disciplines = new Map([...(catalogs.disciplines ?? this.#disciplines), [discipline.id, discipline]]);
        this.#validateRequirementReferences([...revision.acquisitionRequirements, ...revision.useRequirements], disciplines, definitions);
        Technique.validateRevisionAmounts(revision, actor, 'acquisition mechanics');
        if (provenance.kind === 'trainer') {
            const trainer = getActor(provenance.sourceId);
            if (!trainer || trainer.isDead || trainer.isDisabled || !trainer.techniques.some(entry => entry.techniqueId === definition.id && entry.definitionRevision === revision.revision)) throw new Error('Trainer must be a living available character who knows the pinned technique revision.');
            if (locationId(trainer) !== locationId(actor)) throw new Error('Trainer is not in the actor location.');
        }
        if (provenance.kind === 'item') {
            const item = actor.getInventoryItems().find(entry => entry.id === provenance.sourceId);
            if (!item || !item.techniqueGrants.some(grant => grant.techniqueId === definition.id && grant.definitionRevision === revision.revision && grant.teaches)) throw new Error('Teaching source must be an owned item with a matching teaching grant.');
        }
    }

    static #learnedEntry(actor, definition, revision, provenance) {
        return { techniqueId: definition.id, definitionRevision: revision.revision, personalRevision: 1, mechanics: { ...clone(revision), revision: 1 }, provenance: clone(provenance), acquiredAt: worldMinute(), evidence: [], revisionHistory: [] };
    }

    static #checkOperation(operationId, request) {
        Technique.text(operationId, 'operationId');
        const receipt = this.#receipts.get(operationId);
        if (!receipt) return null;
        if (receipt.request && !same(receipt.request, request)) throw new Error(`Technique operation ${operationId} was already committed with different intent.`);
        this.retryReceiptNotification(operationId);
        return clone(receipt);
    }

    static learn({ operationId, actor, techniqueId, definitionRevision, provenance, candidate, candidateDiscipline, origin = 'automatic' }) {
        this.#assertActor(actor);
        techniqueId ??= candidate?.id;
        const request = { kind: 'learn', actorId: actor.id, techniqueId, ...(definitionRevision !== undefined ? { definitionRevision } : {}) };
        const replay = this.#checkOperation(operationId, request);
        if (replay) return replay;
        ({ candidate, candidateDiscipline } = this.#resolveCandidateDiscipline(candidate, candidateDiscipline));
        const known = this.#definitions.get(techniqueId) ?? (candidate && [...this.#definitions.values()].find(value => !value.unique && !candidate.unique && value.disciplineId === candidate.disciplineId && value.semanticKey === candidate.semanticKey));
        const staged = candidate && !known ? new Technique(BalancePolicy.materializeDefinition(candidate, { actor, origin })) : null;
        const definition = known ?? (staged && (this.#findEquivalent(staged) ?? staged));
        if (!definition) throw new Error(`Unknown technique ${techniqueId}.`);
        const stagedDiscipline = candidateDiscipline;
        if (stagedDiscipline && stagedDiscipline.id !== definition.disciplineId) throw new Error('Candidate discipline does not match the teaching candidate.');
        const discipline = this.#disciplines.get(definition.disciplineId) ?? stagedDiscipline;
        if (!discipline) throw new Error(`Unknown discipline ${definition.disciplineId}. ${this.availableDisciplineIds()}`);
        if (stagedDiscipline && this.#disciplines.has(stagedDiscipline.id) && !same(stagedDiscipline, discipline)) throw new Error('Teaching cannot overwrite an existing discipline.');
        const revision = definition.getRevision(definitionRevision);
        const source = Technique.normalizeProvenance(provenance);
        this.#assertAcquisition(actor, definition, revision, source, discipline);
        const existing = actor.techniques.find(entry => entry.techniqueId === definition.id);
        const entry = existing ?? this.#learnedEntry(actor, definition, revision, source);
        const receipt = { operationId, kind: 'learn', actorId: actor.id, techniqueId: definition.id, worldMinute: worldMinute(), committed: true, request, display: this.#displaySnapshot(actor, definition), techniqueChanges: existing ? [] : [{ kind: 'learned', actorId: actor.id, techniqueId: definition.id, definitionRevision: entry.definitionRevision, personalRevision: entry.personalRevision }] };
        if (!existing) {
            const previous = actor.techniques;
            try { actor.setTechniques([...previous, entry]); } catch (cause) {
                try { actor.setTechniques(previous); } catch (rollback) { throw new AggregateError([cause, rollback], 'Technique learning rollback failed; do not retry.', { cause }); }
                throw cause;
            }
        }
        // All validation and the sole potentially throwing actor write complete
        // before installing the staged world records and immutable receipt.
        if (!this.#disciplines.has(discipline.id)) { this.#disciplines.set(discipline.id, discipline); IdGenerator.register('discipline', discipline.id); }
        if (!this.#definitions.has(definition.id)) { this.#definitions.set(definition.id, definition); IdGenerator.register('technique', definition.id); }
        this.#receipts.set(operationId, receipt);
        return this.#publishReceipt(receipt);
    }

    /** Validate a whole creation response without installing any catalogue or actor state. */
    static prepareLearningBatch(groups, { origin = 'automatic' } = {}) {
        if (!Array.isArray(groups)) throw new TypeError('Initial technique groups must be an array.');
        const disciplines = new Map(this.#disciplines);
        const definitions = new Map(this.#definitions);
        const receipts = new Map(this.#receipts);
        const updates = [];
        const owners = new Set();
        const uniqueOwners = new Map(require('./Player.js').getAll().flatMap(actor => actor.techniques.map(entry => [entry.techniqueId, actor.id])));
        for (const { actor, operationId, techniques } of groups) {
            this.#assertActor(actor);
            Technique.text(operationId, 'initial technique operationId');
            if (owners.has(actor.id)) throw new Error(`Duplicate initial technique actor ${actor.id}.`);
            owners.add(actor.id);
            if (receipts.has(operationId)) throw new Error(`Initial technique operation ${operationId} is already complete.`);
            if (!Array.isArray(techniques)) throw new TypeError('Initial techniques must be an array.');
            const entries = actor.techniques;
            const access = actor.disciplineAccess;
            const ids = new Set();
            for (const options of techniques) {
                const { candidate: rawCandidate, candidateDiscipline: proposed } = this.#resolveCandidateDiscipline(options.candidate, options.candidateDiscipline, disciplines);
                const known = definitions.get(options.techniqueId ?? rawCandidate?.id) ?? (rawCandidate && [...definitions.values()].find(value => !value.unique && !rawCandidate.unique && value.disciplineId === rawCandidate.disciplineId && value.semanticKey === rawCandidate.semanticKey));
                const candidate = rawCandidate && !known ? new Technique(BalancePolicy.materializeDefinition(rawCandidate, { actor, origin })) : null;
                const requestedId = options.techniqueId ?? candidate?.id;
                let definition = known ?? definitions.get(requestedId);
                if (definition && candidate && !same(definition.toJSON(), candidate.toJSON())) throw new Error('Initial generation cannot overwrite a catalogue definition.');
                if (!definition && candidate) definition = [...definitions.values()].find(value => !value.unique && !candidate.unique && value.disciplineId === candidate.disciplineId && value.semanticKey === candidate.semanticKey) ?? candidate;
                if (!definition) throw new Error(`Unknown initial technique ${requestedId}.`);
                const discipline = disciplines.get(definition.disciplineId) ?? proposed;
                if (!discipline || discipline.id !== definition.disciplineId) throw new Error(`Missing initial discipline ${definition.disciplineId}. ${this.availableDisciplineIds(disciplines)}`);
                if (proposed && !same(proposed, discipline)) throw new Error('Initial generation cannot overwrite a discipline.');
                if (ids.has(definition.id)) throw new Error(`Duplicate initial technique ${definition.id} for ${actor.name}.`);
                ids.add(definition.id);
                const revision = definition.getRevision(options.definitionRevision);
                const provenance = Technique.normalizeProvenance(options.provenance);
                this.#assertAcquisition(actor, definition, revision, provenance, discipline,
                    { definitions, disciplines }, { startingAcquisition: true });
                if (!access.some(item => item.disciplineId === discipline.id)) {
                    access.push({
                        disciplineId: discipline.id,
                        provenance: Technique.normalizeProvenance({
                            kind: 'generation', sourceId: definition.id,
                            reason: `Starting technique ${definition.name} establishes ${discipline.name} discipline access.`,
                            operationId: `${operationId}:discipline:${discipline.id}`
                        })
                    });
                }
                if (definition.unique && uniqueOwners.has(definition.id) && uniqueOwners.get(definition.id) !== actor.id) throw new Error(`Unique technique ${definition.name} cannot be shared between generated characters.`);
                if (definition.unique) uniqueOwners.set(definition.id, actor.id);
                // Validate resource identities/directions without requiring the actor to pay or cast.
                this.#costs(actor, revision.costs, 'initial costs', { requireAffordable: false });
                this.#costs(actor, revision.failureCosts ?? [], 'initial failure costs', { requireAffordable: false });
                for (const effect of revision.effects) {
                    const check = effect.check ?? revision.check;
                    for (const key of ['skill', 'opposedSkill']) if (check[key] && ![...actor.getSkills().keys()].some(name => name.toLowerCase() === check[key].toLowerCase())) throw new Error(`Unknown initial technique check skill ${check[key]}.`);
                    for (const key of ['attribute', 'opposedAttribute']) if (check[key] && !actor.getAttributeNames().some(name => name.toLowerCase() === check[key].toLowerCase())) throw new Error(`Unknown initial technique check attribute ${check[key]}.`);
                    this.#validateEffectReferences(actor, this.#effect(actor, effect, { techniqueId: definition.id, sourceId: `learned:${definition.id}`, sourceKind: 'learned', definitionRevision: revision.revision, personalRevision: 1 }, operationId));
                }
                disciplines.set(discipline.id, discipline);
                definitions.set(definition.id, definition);
                const existing = entries.find(entry => entry.techniqueId === definition.id);
                const entry = existing ?? this.#learnedEntry(actor, definition, revision, provenance);
                if (!existing) entries.push(entry);
                const learnId = `${operationId}:learn:${definition.id}`;
                if (receipts.has(learnId)) throw new Error(`Initial learning operation ${learnId} is already committed without completion.`);
                receipts.set(learnId, { operationId: learnId, kind: 'learn', actorId: actor.id, techniqueId: definition.id, worldMinute: worldMinute(), committed: true, display: this.#displaySnapshot(actor, definition), request: { kind: 'learn', actorId: actor.id, techniqueId: definition.id }, techniqueChanges: existing ? [] : [{ kind: 'learned', actorId: actor.id, techniqueId: definition.id, definitionRevision: entry.definitionRevision, personalRevision: entry.personalRevision }] });
            }
            const request = { kind: 'initialization', actorId: actor.id, techniqueId: 'starting-techniques', techniqueIds: [...ids] };
            receipts.set(operationId, { operationId, kind: 'initialization', actorId: actor.id, techniqueId: 'starting-techniques', worldMinute: worldMinute(), committed: true, request });
            updates.push({ actor, entries, access, operationId });
        }
        for (const discipline of disciplines.values()) this.#validateRequirementReferences(discipline.accessRequirements, disciplines, definitions);
        const prepared = { actorIds: updates.map(update => update.actor.id) };
        const signature = actor => ({ ...this.#actorMechanics(actor), class: actor.class, race: actor.race, abilities: actor.getAbilities().map(({ imageId, imagePrompt, ...ability }) => ability), access: actor.disciplineAccess, techniques: actor.techniques });
        this.#preparedLearning.set(prepared, { epoch: this.#epoch, policyDigest: BalancePolicy.digest(BalancePolicy.resolvePolicy()), catalog: this.toJSON({ includePresentation: false }), disciplines, definitions, receipts, updates, signatures: updates.map(update => clone(signature(update.actor))), signature });
        return prepared;
    }

    static commitLearningBatch(prepared) {
        const plan = this.#preparedLearning.get(prepared);
        if (!plan) throw new Error('Initial learning requires an authentic prepared batch.');
        const replay = plan.updates.map(update => this.getReceipt(update.operationId));
        if (replay.length && replay.every((receipt, index) => receipt && same(receipt, plan.receipts.get(plan.updates[index].operationId)))) {
            for (const receipt of replay) this.retryReceiptNotification(receipt.operationId);
            return replay;
        }
        if (plan.policyDigest !== BalancePolicy.digest(BalancePolicy.resolvePolicy())) throw new Error('Technique balance policy changed during initial preparation.');
        if (plan.epoch !== this.#epoch || !same(plan.catalog, this.toJSON({ includePresentation: false })) || plan.updates.some((update, index) => getActor(update.actor.id) !== update.actor || !same(plan.signatures[index], plan.signature(update.actor)))) throw new Error('Character or technique world changed during initial technique preparation.');
        const snapshots = plan.updates.map(update => ({ actor: update.actor, entries: update.actor.techniques, access: update.actor.disciplineAccess }));
        try {
            for (const update of plan.updates) {
                update.actor.setDisciplineAccess(update.access);
                update.actor.setTechniques(update.entries);
            }
        } catch (cause) {
            const failures = [];
            for (const snapshot of snapshots) {
                try { snapshot.actor.setTechniques(snapshot.entries); } catch (error) { failures.push(error); }
                try { snapshot.actor.setDisciplineAccess(snapshot.access); } catch (error) { failures.push(error); }
            }
            if (failures.length) throw new AggregateError([cause, ...failures], 'Initial technique rollback failed; do not retry.', { cause });
            throw cause;
        }
        const newLearningReceipts = [...plan.receipts.values()].filter(receipt => receipt.kind === 'learn' && !this.#receipts.has(receipt.operationId));
        this.#disciplines = plan.disciplines;
        this.#definitions = plan.definitions;
        this.#receipts = plan.receipts;
        for (const id of this.#disciplines.keys()) IdGenerator.register('discipline', id);
        for (const id of this.#definitions.keys()) IdGenerator.register('technique', id);
        if (this.#receiptObserver) for (const receipt of newLearningReceipts) this.#undeliveredReceipts.add(receipt.operationId);
        for (const receipt of newLearningReceipts) this.#publishReceipt(receipt);
        return plan.updates.map(update => this.getReceipt(update.operationId));
    }

    static grantDiscipline({ operationId, actor, disciplineId, provenance }) {
        this.#assertEligible(actor);
        if (!this.#disciplines.has(disciplineId)) throw new Error(`Unknown discipline ${disciplineId}. ${this.availableDisciplineIds()}`);
        const request = { kind: 'discipline', actorId: actor.id, techniqueId: disciplineId };
        const replay = this.#checkOperation(operationId, request);
        if (replay) return replay;
        const normalized = Technique.normalizeProvenance(provenance);
        if (!actor.disciplineAccess.some(entry => entry.disciplineId === disciplineId)) actor.setDisciplineAccess([...actor.disciplineAccess, { disciplineId, provenance: normalized }]);
        const receipt = { operationId, kind: 'discipline', actorId: actor.id, techniqueId: disciplineId, committed: true, worldMinute: worldMinute(), request };
        this.#receipts.set(operationId, receipt);
        return clone(receipt);
    }

    static recordEvidence({ operationId, actor, techniqueId, evidence }) {
        this.#assertActor(actor);
        const normalized = Technique.normalizeEvidence([evidence])[0];
        const request = { kind: 'evidence', actorId: actor.id, techniqueId, evidence: normalized };
        const replay = this.#checkOperation(operationId, request);
        if (replay) return replay;
        const entries = actor.techniques;
        const entry = entries.find(value => value.techniqueId === techniqueId);
        if (!entry) throw new Error('Cannot record evidence for an unlearned technique.');
        if (entry.evidence.some(value => value.id === normalized.id)) throw new Error(`Evidence ${normalized.id} already exists.`);
        entry.evidence.push(normalized);
        actor.setTechniques(entries);
        const receipt = { operationId, kind: 'evidence', actorId: actor.id, techniqueId, committed: true, worldMinute: worldMinute(), request, evidenceIds: [normalized.id] };
        this.#receipts.set(operationId, receipt);
        return clone(receipt);
    }

    static improve({ operationId, actor, techniqueId, mechanics, improvement, evidenceIds = [], provenance, origin = 'automatic', convertToCustom = false }) {
        this.#assertActor(actor);
        const source = Technique.normalizeProvenance(provenance);
        if (!Array.isArray(evidenceIds) || new Set(evidenceIds).size !== evidenceIds.length) throw new Error('Improvement evidence IDs must be a distinct array.');
        const prior = this.#receipts.get(operationId);
        if (prior) {
            const requested = { kind: 'improve', actorId: actor.id, techniqueId, mechanics: improvement ? prior.request.mechanics : Technique.normalizeRevision(mechanics), evidenceIds: [...evidenceIds], provenance: source, ...(improvement ? { improvement: clone(improvement) } : {}) };
            return this.#checkOperation(operationId, requested);
        }
        const snapshots = actor.techniques;
        const entries = clone(snapshots);
        const entry = entries.find(value => value.techniqueId === techniqueId);
        if (!entry) throw new Error('Personal revisions require a learned technique.');
        if (improvement && mechanics !== undefined) throw new Error('An improvement proposal must omit mechanics.');
        if (origin !== 'editor' && entry.mechanics.balance && !improvement) throw new Error('Automatic managed improvements require an improvement.stepId, not arbitrary mechanics.');
        if (entry.mechanics.balance && !improvement && !mechanics?.balance && !(origin === 'editor' && convertToCustom)) throw new Error('Managed personal edits must preserve balance or explicitly convert to custom.');
        const revision = Technique.normalizeRevision(improvement ? BalancePolicy.compilePersonalImprovement({ learned: entry, proposal: improvement, actor }) : BalancePolicy.materializeRevision(mechanics, { actor, origin }));
        if (revision.revision !== entry.personalRevision + 1) throw new Error('Personal edit must use the next revision number.');
        this.#validateRequirementReferences([...revision.acquisitionRequirements, ...revision.useRequirements], this.#disciplines, this.#definitions);
        Technique.validateRevisionAmounts(revision, actor);
        this.#costs(actor, revision.costs, 'improvement costs', { requireAffordable: false });
        this.#costs(actor, revision.failureCosts ?? [], 'improvement failure costs', { requireAffordable: false });
        if (origin !== 'editor' && !evidenceIds.length) throw new Error('An improvement needs meaningful unused evidence.');
        for (const id of evidenceIds) {
            const evidence = entry.evidence.find(value => value.id === id);
            if (!evidence || evidence.usedBy) throw new Error(`Improvement evidence ${id} is missing or already used.`);
        }
        for (const id of evidenceIds) entry.evidence.find(value => value.id === id).usedBy = operationId;
        entry.revisionHistory.push(clone(entry.mechanics));
        entry.personalRevision = revision.revision;
        entry.mechanics = revision;
        const request = { kind: 'improve', actorId: actor.id, techniqueId, mechanics: revision, evidenceIds: [...evidenceIds], provenance: source, ...(improvement ? { improvement: clone(improvement) } : {}) };
        const receipt = { operationId, kind: 'improve', actorId: actor.id, techniqueId, committed: true, worldMinute: worldMinute(), request, evidenceIds: [...evidenceIds], techniqueChanges: [{ kind: 'improved', actorId: actor.id, techniqueId, personalRevision: entry.personalRevision, provenance: source }] };
        this.#normalizeReceipt(receipt);
        try { actor.setTechniques(entries); } catch (cause) {
            try { actor.setTechniques(snapshots); } catch (rollback) { throw new AggregateError([cause, rollback], 'Personal improvement rollback failed; do not retry.', { cause }); }
            throw cause;
        }
        this.#receipts.set(operationId, receipt);
        return clone(receipt);
    }

    /** A reviewed repair appends exactly one catalogue and one owner revision. */
    static rebalance({ operationId, actor, techniqueId, expectedDefinitionRevision, expectedPersonalRevision, expectedPolicyDigest, recipe, provenance }) {
        this.#assertActor(actor);
        const source = Technique.normalizeProvenance(provenance);
        if (source.kind !== 'editor') throw new Error('Reviewed rebalance requires editor provenance.');
        const requested = { expectedDefinitionRevision, expectedPersonalRevision, expectedPolicyDigest, recipe: clone(recipe) };
        const prior = this.#receipts.get(operationId);
        if (prior) {
            if (prior.kind !== 'improve' || prior.actorId !== actor.id || prior.techniqueId !== techniqueId || !same(prior.request.rebalance, requested) || !same(prior.request.provenance, source)) throw new Error('Rebalance operation was committed with different intent.');
            return clone(prior);
        }
        Technique.text(operationId, 'operationId');
        const definition = this.#requireDefinition(techniqueId);
        const before = actor.techniques;
        const entries = clone(before), entry = entries.find(value => value.techniqueId === techniqueId);
        if (!entry || entry.personalRevision !== expectedPersonalRevision || definition.revisions.length !== expectedDefinitionRevision) throw new Error('Reviewed rebalance revisions are stale.');
        const policy = BalancePolicy.resolvePolicy();
        if (BalancePolicy.digest(policy) !== expectedPolicyDigest) throw new Error('Reviewed rebalance policy digest is stale.');
        const compile = (old, revision) => {
            const { costs, effects, balance, failureCosts, ...retained } = old;
            return Technique.normalizeRevision(BalancePolicy.materializeRevision({ ...retained, revision, recipe }, { actor, origin: 'editor', policy }));
        };
        const base = compile(definition.getRevision(), expectedDefinitionRevision + 1);
        const personal = compile(entry.mechanics, expectedPersonalRevision + 1);
        Technique.validateRevisionAmounts(base, actor); Technique.validateRevisionAmounts(personal, actor);
        for (const revision of [base, personal]) this.#validateRequirementReferences([...revision.acquisitionRequirements, ...revision.useRequirements], this.#disciplines, this.#definitions);
        const replacement = new Technique({ ...definition.toJSON(), revisions: [...definition.revisions, base] });
        entry.revisionHistory.push(clone(entry.mechanics)); entry.mechanics = personal; entry.personalRevision = personal.revision; entry.definitionRevision = base.revision;
        const request = { kind: 'improve', actorId: actor.id, techniqueId, mechanics: personal, evidenceIds: [], provenance: source, rebalance: requested };
        const receipt = { operationId, kind: 'improve', actorId: actor.id, techniqueId, committed: true, worldMinute: worldMinute(), request, evidenceIds: [], techniqueChanges: [{ kind: 'improved', actorId: actor.id, techniqueId, definitionRevision: base.revision, personalRevision: personal.revision, provenance: source }] };
        this.#normalizeReceipt(receipt, new Map([...this.#definitions, [techniqueId, replacement]]));
        try { actor.setTechniques(entries); } catch (cause) {
            try { actor.setTechniques(before); } catch (rollback) { throw new AggregateError([cause, rollback], 'Reviewed rebalance rollback failed; do not retry.', { cause }); }
            throw cause;
        }
        this.#definitions.set(techniqueId, replacement); this.#receipts.set(operationId, receipt);
        return clone(receipt);
    }

    static #targets(actor, mechanics, ids) {
        const targetIds = ids === undefined && mechanics.target.kind === 'self' ? [actor.id] : ids;
        if (!Array.isArray(targetIds) || !targetIds.length || targetIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(targetIds).size !== targetIds.length) throw new Error('Technique targetIds must be a nonempty array of distinct character IDs.');
        if (mechanics.target.kind !== 'area' && targetIds.length !== 1) throw new Error('Technique requires exactly one target.');
        if (mechanics.target.kind === 'self' && targetIds[0] !== actor.id) throw new Error('Self technique must target its actor.');
        return targetIds.map(id => {
            const target = getActor(id);
            if (!target) throw new Error(`Unknown technique target ${id}.`);
            if (target.isDead) throw new Error(`Technique cannot target dead actor ${target.name}.`);
            if (target !== actor && locationId(target) !== locationId(actor)) throw new Error(`Technique target ${target.name} is not in the actor location.`);
            return target;
        });
    }

    static #effect(actor, effect, source, operationId) {
        if (['healing', 'damage'].includes(effect.kind)) return { ...clone(effect), calculation: Technique.evaluateAmount(effect.amount, actor, `effect ${effect.id} amount`) };
        const status = clone(effect.status);
        const calculations = [];
        for (const [field, magnitudes] of [['attributes', ['modifier', 'percentModifier']], ['skills', ['modifier', 'percentModifier']], ['needBars', ['delta']]]) for (const entry of status[field]) for (const magnitude of magnitudes) if (entry[magnitude] !== undefined) {
            const calculation = Technique.evaluateAmount(entry[magnitude], actor, `${effect.id}.${field}.${magnitude}`, { signed: true });
            calculations.push({ field, identity: entry.attribute ?? entry.skill ?? entry.name, magnitude, authored: clone(entry[magnitude]), ...calculation });
            entry[magnitude] = calculation.amount;
        }
        if (status.maxHealthPercent !== undefined) {
            const calculation = Technique.evaluateAmount(status.maxHealthPercent, actor, `${effect.id}.maxHealthPercent`, { signed: true });
            calculations.push({ field: 'maxHealthPercent', identity: 'maxHealth', magnitude: 'maxHealthPercent', authored: clone(status.maxHealthPercent), ...calculation });
            status.maxHealthPercent = calculation.amount;
        }
        status.id = `technique_status:${operationId}:${effect.id}`;
        status.techniqueGrants = (status.techniqueGrants ?? []).map((grant, index) => ({
            ...grant, id: `status_grant:${status.id}:${grant.id ?? index}`, sourceStatusId: status.id
        }));
        status.appliedAt = worldMinute();
        status.techniqueProvenance = { techniqueId: source.techniqueId, effectId: effect.id, actorId: actor.id, operationId, ...this.#sourceIdentity(source), stacking: effect.stacking, refreshPolicy: effect.refreshPolicy, authoredDuration: status.duration, ...(effect.potency !== undefined ? { potency: effect.potency } : {}) };
        // Constructor validates resolved status mechanics before any roll.
        new (require('./StatusEffect.js'))({ ...status, register: false });
        return { ...clone(effect), status, calculations };
    }

    static #validateEffectReferences(target, effect) {
        if (!effect.status) return;
        for (const grant of effect.status.techniqueGrants ?? []) this.#requireDefinition(grant.techniqueId).getRevision(grant.definitionRevision);
        for (const entry of effect.status.attributes) if (!target.getAttributeNames().some(name => name.toLowerCase() === entry.attribute.toLowerCase())) throw new Error(`Target ${target.name} has no attribute ${entry.attribute}.`);
        const skillNames = [...target.getSkills().keys()];
        for (const entry of effect.status.skills) if (!skillNames.some(name => name.toLowerCase() === entry.skill.toLowerCase())) throw new Error(`Target ${target.name} has no skill ${entry.skill}.`);
        for (const entry of effect.status.needBars) if (entry.name.toLowerCase() !== 'health' && !target.getNeedBars({ scope: 'active' }).some(bar => [bar.id, bar.name].some(name => name.toLowerCase() === entry.name.toLowerCase()))) throw new Error(`Target ${target.name} has no active need ${entry.name}.`);
        target.validateTechniqueStatusEffect(effect.status);
    }

    static #request(options) {
        return { kind: 'use', actorId: options.actor.id, techniqueId: options.techniqueId ?? options.candidate?.id, turnId: options.turnId, sourceId: options.sourceId ?? null, targetIds: options.targetIds ?? null, ...(options.intent !== undefined ? { intent: Technique.text(options.intent, 'technique intent') } : {}), ...(options.expectedDefinitionRevision !== undefined ? { expectedDefinitionRevision: options.expectedDefinitionRevision } : {}), ...(options.expectedPersonalRevision !== undefined ? { expectedPersonalRevision: options.expectedPersonalRevision } : {}) };
    }

    static #preflight(options) {
        const { actor, operationId } = options;
        this.#assertEligible(actor);
        Technique.text(operationId, 'operationId');
        Technique.text(options.turnId, 'turnId');
        const { candidate: rawCandidate, candidateDiscipline: resolvedDiscipline } = this.#resolveCandidateDiscipline(options.candidate, options.candidateDiscipline);
        const known = this.#definitions.get(options.techniqueId ?? rawCandidate?.id) ?? (rawCandidate && [...this.#definitions.values()].find(value => !value.unique && !rawCandidate.unique && value.disciplineId === rawCandidate.disciplineId && value.semanticKey === rawCandidate.semanticKey));
        let candidate = rawCandidate && !known ? new Technique(BalancePolicy.materializeDefinition(rawCandidate, { actor, origin: options.origin ?? 'automatic' })) : null;
        let candidateDiscipline = resolvedDiscipline;
        let definition = known ?? this.#definitions.get(options.techniqueId ?? candidate?.id);
        if (!definition && candidate) definition = this.#findEquivalent(candidate) ?? candidate;
        if (!definition) throw new Error(`Unknown technique ${options.techniqueId}.`);
        if (candidateDiscipline && candidateDiscipline.id !== definition.disciplineId) throw new Error('Candidate discipline identity does not match candidate technique.');
        const discipline = this.#disciplines.get(definition.disciplineId) ?? candidateDiscipline;
        if (!discipline) throw new Error(`Unknown discipline ${definition.disciplineId}. ${this.availableDisciplineIds()}`);
        if (candidateDiscipline && this.#disciplines.has(candidateDiscipline.id) && !same(candidateDiscipline, this.#disciplines.get(candidateDiscipline.id))) throw new Error('Candidate cannot overwrite an existing discipline.');
        let source;
        let learned = null;
        if (options.acquisition && !actor.techniques.some(entry => entry.techniqueId === definition.id)) {
            const provenance = Technique.normalizeProvenance(options.acquisition.provenance);
            const revision = definition.getRevision(options.acquisition.definitionRevision);
            this.#assertAcquisition(actor, definition, revision, provenance, discipline);
            learned = this.#learnedEntry(actor, definition, revision, provenance);
            source = { techniqueId: definition.id, sourceId: `learned:${definition.id}`, sourceKind: 'learned', definitionRevision: revision.revision, personalRevision: 1, mechanics: learned.mechanics };
            if (options.sourceId && options.sourceId !== source.sourceId) throw new Error('Discovery must use its newly learned source.');
        } else {
            if (!this.#definitions.has(definition.id)) throw new Error('A novel technique requires acquisition provenance.');
            source = { ...this.#chooseSource(this.#sources(actor, definition.id), options.sourceId), techniqueId: definition.id };
        }
        if (options.expectedDefinitionRevision !== undefined && options.expectedDefinitionRevision !== source.definitionRevision) throw new Error('Selected technique definition revision changed.');
        if (options.expectedPersonalRevision !== undefined && options.expectedPersonalRevision !== source.personalRevision) throw new Error('Selected personal technique revision changed.');
        const errors = this.#requirementErrors(actor, source.mechanics.useRequirements);
        if (errors.length) throw new Error(errors.join(' '));
        BalancePolicy.validateManagedRevision(source.mechanics, actor);
        const costs = this.#costs(actor, source.mechanics.costs, 'normal costs', { source });
        const failureCosts = this.#costs(actor, source.mechanics.failureCosts ?? source.mechanics.costs, 'failure costs', { source });
        const targets = this.#targets(actor, source.mechanics, options.targetIds);
        const effects = source.mechanics.effects.map(effect => this.#effect(actor, effect, source, operationId));
        for (const target of targets) for (const effect of effects) this.#validateEffectReferences(target, effect);
        // Keep staged world changes isolated until synchronous commit.
        candidate = this.#definitions.has(definition.id) ? null : definition;
        candidateDiscipline = this.#disciplines.has(discipline.id) ? null : discipline;
        return { actor, definition, source, learned, candidate, candidateDiscipline, costs, failureCosts, targets, effects, ...(candidate ? { authoringPolicyDigest: BalancePolicy.digest(BalancePolicy.resolvePolicy()) } : {}) };
    }

    static preview(options) {
        const prepared = this.#preflight({ ...options, operationId: options.operationId ?? 'preview', turnId: options.turnId ?? 'preview' });
        return { techniqueId: prepared.definition.id, source: this.#sourceIdentity(prepared.source), mechanics: clone(prepared.source.mechanics), costs: clone(prepared.costs), failureCosts: clone(prepared.failureCosts), effects: clone(prepared.effects), targetIds: prepared.targets.map(target => target.id) };
    }

    static async prepare(options) {
        this.#assertActor(options.actor);
        const request = this.#request(options);
        const replay = this.#checkOperation(options.operationId, request);
        if (replay) return { receipt: replay };
        const preflight = this.#preflight(options);
        const epoch = this.#epoch;
        const signature = clone(this.#preparationSignature(preflight));
        const checks = [];
        const planned = [];
        const areaAttackRolls = new Map();
        for (const target of preflight.targets) {
            const checkCache = new Map();
            for (const effect of preflight.effects) {
                const check = effect.check ?? preflight.source.mechanics.check;
                const key = JSON.stringify(check);
                let outcome = checkCache.get(key);
                if (!outcome) {
                    if (check.kind === 'automatic') outcome = { success: true, automatic: true };
                    else {
                        if (typeof options.prepareCheck !== 'function') throw new Error(`Technique ${preflight.definition.id} needs an authoritative prepareCheck resolver.`);
                        let sharedAttackRoll;
                        if (preflight.source.mechanics.target.kind === 'area' && check.kind === 'attack') {
                            if (!areaAttackRolls.has(key)) areaAttackRolls.set(key, { die: null });
                            sharedAttackRoll = areaAttackRolls.get(key);
                        }
                        outcome = await options.prepareCheck({ actor: options.actor, target, check: clone(check), technique: preflight.definition.toJSON(), source: this.#sourceIdentity(preflight.source), effect: clone(effect), ...(sharedAttackRoll ? { sharedAttackRoll } : {}) });
                        if (!outcome || typeof outcome.success !== 'boolean') throw new Error('Technique check resolver must return a boolean success.');
                        assertFiniteJson(outcome, 'technique prepared check');
                        // Check receipt must be plain serializable finite JSON data.
                        outcome = clone(outcome);
                    }
                    checkCache.set(key, outcome);
                    checks.push({ targetId: target.id, check: clone(check), outcome });
                }
                planned.push({ targetId: target.id, effectId: effect.id, kind: effect.kind, success: outcome.success });
            }
        }
        const fresh = this.#preflight(options);
        if (epoch !== this.#epoch) throw new Error('Technique world changed during preparation.');
        if (!same(signature, this.#preparationSignature(fresh))) throw new Error('Technique source, mechanics, targets or resources changed during preparation.');
        const prepared = { operationId: options.operationId, turnId: options.turnId, actorId: options.actor.id, techniqueId: preflight.definition.id, source: this.#sourceIdentity(preflight.source), checks, effects: planned, success: planned.some(effect => effect.success) };
        this.#prepared.set(prepared, { options, request, epoch, preflight, signature, outcome: clone(prepared) });
        return prepared;
    }

    static #preparationSignature(preflight) {
        const chargeItems = [...new Set([...preflight.costs, ...preflight.failureCosts].filter(cost => cost.resource === 'charge').map(cost => cost.itemId))].map(itemId => ({ itemId, pool: require('./ItemChargeService.js').assertOwned(preflight.actor, itemId).chargePool, equipped: preflight.actor.hasEquippedThing(itemId) }));
        return { chargeItems, authoringPolicyDigest: preflight.authoringPolicyDigest ?? null, source: preflight.source, actor: this.#actorMechanics(preflight.actor), learned: preflight.learned, candidate: preflight.candidate?.toJSON(), candidateDiscipline: preflight.candidateDiscipline, costs: preflight.costs, failureCosts: preflight.failureCosts, effects: preflight.effects, targets: preflight.targets.map(target => this.#actorMechanics(target)) };
    }

    static #actorMechanics(actor) {
        return { id: actor.id, locationId: locationId(actor) ?? null, level: actor.level, isDead: actor.isDead, isDisabled: actor.isDisabled, health: actor.health, maxHealth: actor.maxHealth, needs: actor.getNeedBars({ scope: 'active' }), attributes: Object.fromEntries(actor.getAttributeNames().map(name => [name, actor.getAttributeModifier(name)])), skills: Object.fromEntries(actor.getSkills()), statuses: actor.getStatusEffects(), abilities: actor.getAbilities().map(({ imageId, imagePrompt, ...ability }) => ability), gear: Object.values(actor.getGear()).map(slot => ({ itemId: slot.itemId, slotType: slot.slotType, ...(slot.item ? { attributeBonuses: slot.item.attributeBonuses, causeStatusEffects: slot.item.toJSON().causeStatusEffects, techniqueGrants: slot.item.techniqueGrants } : {}) })) };
    }

    static commit(prepared) {
        if (prepared?.receipt) {
            const receipt = this.#receipts.get(prepared.receipt.operationId);
            if (!receipt || !same(receipt, prepared.receipt)) throw new Error('Technique receipt replay does not match a committed operation.');
            this.retryReceiptNotification(receipt.operationId);
            return clone(receipt);
        }
        const state = this.#prepared.get(prepared);
        if (!state) throw new Error('Technique commit requires an authentic prepared action.');
        if (!same(state.outcome, prepared)) throw new Error('Prepared technique outcome was modified before commit.');
        const replay = this.#checkOperation(prepared.operationId, state.request);
        if (replay) return replay;
        if (state.epoch !== this.#epoch) throw new Error('Technique world changed before commit.');
        const fresh = this.#preflight(state.options);
        if (!same(state.signature, this.#preparationSignature(fresh))) throw new Error('Technique preparation is stale; the exact source, resources or targets changed.');
        const actor = fresh.actor;
        const affected = [...new Set([actor, ...fresh.targets])];
        const snapshots = affected.map(target => ({ target, health: target.health, needBars: target.getNeedBars({ scope: 'stored' }), statuses: target.getIntrinsicStatusEffects(), techniques: target.techniques }));
        const costs = prepared.success ? fresh.costs : fresh.failureCosts;
        const itemSnapshots = costs.filter(cost => cost.resource === 'charge').map(cost => {
            const item = require('./ItemChargeService.js').assertOwned(actor, cost.itemId);
            return { item, pool: item.chargePool };
        });
        const receipt = { operationId: prepared.operationId, kind: 'use', actorId: actor.id, techniqueId: fresh.definition.id, turnId: prepared.turnId, worldMinute: worldMinute(), committed: true, display: this.#displaySnapshot(actor, fresh.definition, fresh.targets, fresh.effects), source: this.#sourceIdentity(fresh.source), success: prepared.success, costOutcome: prepared.success ? 'normal' : 'failure', costs: [], checks: clone(prepared.checks), effects: [], techniqueChanges: [], request: state.request };
        try {
            if (fresh.candidateDiscipline) this.#disciplines.set(fresh.candidateDiscipline.id, fresh.candidateDiscipline);
            if (fresh.candidate) this.#definitions.set(fresh.candidate.id, fresh.candidate);
            if (fresh.learned) {
                actor.setTechniques([...actor.techniques, fresh.learned]);
                receipt.techniqueChanges.push({ kind: 'learned', actorId: actor.id, techniqueId: fresh.definition.id, definitionRevision: fresh.learned.definitionRevision, personalRevision: 1 });
            }
            for (const cost of costs) {
                if (cost.resource === 'health') actor.setHealth(cost.nextValue);
                else if (cost.resource === 'charge') {
                    const item = itemSnapshots.find(snapshot => snapshot.item.id === cost.itemId).item;
                    item.chargePool = { ...item.chargePool, amount: cost.nextValue };
                }
                else actor.setNeedBarValue(cost.needId, cost.nextValue);
                const actual = cost.resource === 'health' ? actor.health : cost.resource === 'charge' ? itemSnapshots.find(snapshot => snapshot.item.id === cost.itemId).item.chargePool.amount : actor.getNeedBarValue(cost.needId);
                if (actual !== cost.nextValue) throw new Error(`Technique ${cost.key} exact debit was not applied.`);
                receipt.costs.push({ ...clone(cost), previousValue: cost.value, newValue: actual, delta: cost.resource === 'charge' ? ChargePool.subtract(actual, cost.value) : actual - cost.value });
            }
            for (const planned of prepared.effects) {
                const effect = fresh.effects.find(value => value.id === planned.effectId);
                const target = fresh.targets.find(value => value.id === planned.targetId);
                const result = { ...planned, mutationId: `${prepared.operationId}:effect:${planned.targetId}:${planned.effectId}` };
                if (planned.success && ['healing', 'damage'].includes(effect.kind)) {
                    const before = target.health;
                    const signedAmount = effect.kind === 'damage' ? -effect.calculation.amount : effect.calculation.amount;
                    target.modifyHealth(signedAmount, `Technique ${fresh.definition.name}`);
                    Object.assign(result, { amount: effect.calculation.amount, calculation: { ...clone(effect.calculation), authored: clone(effect.amount) }, previousHealth: before, newHealth: target.health, delta: target.health - before, damageMode: effect.kind === 'damage' ? 'technique' : undefined });
                } else if (planned.success) {
                    const status = target.upsertTechniqueStatusEffect(effect.status);
                    Object.assign(result, { status: status.toJSON ? status.toJSON() : clone(status), calculations: clone(effect.calculations) });
                }
                receipt.effects.push(result);
            }
            this.#normalizeReceipt(receipt);
            this.#receipts.set(prepared.operationId, receipt);
            if (fresh.candidate) IdGenerator.register('technique', fresh.candidate.id);
            if (fresh.candidateDiscipline) IdGenerator.register('discipline', fresh.candidateDiscipline.id);
            this.#prepared.delete(prepared);
        } catch (error) {
            const rollbackErrors = [];
            for (const snapshot of itemSnapshots) {
                try { snapshot.item.chargePool = snapshot.pool; } catch (rollbackError) { rollbackErrors.push(rollbackError); }
            }
            for (const snapshot of snapshots) {
                try {
                    snapshot.target.setStatusEffects(snapshot.statuses);
                    snapshot.target.setNeedBars(snapshot.needBars);
                    snapshot.target.setTechniques(snapshot.techniques);
                    snapshot.target.setHealth(snapshot.health);
                } catch (rollbackError) { rollbackErrors.push(rollbackError); }
            }
            if (fresh.candidate) this.#definitions.delete(fresh.candidate.id);
            if (fresh.candidateDiscipline) this.#disciplines.delete(fresh.candidateDiscipline.id);
            if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Technique commit failed and rollback was incomplete; do not retry this action.');
            throw error;
        }
        return this.#publishReceipt(receipt);
    }

    static async execute(options) {
        this.#assertActor(options.actor);
        const request = this.#request(options);
        const replay = this.#checkOperation(options.operationId, request);
        if (replay) return replay;
        const pending = this.#pending.get(options.operationId);
        if (pending) {
            if (!same(pending.request, request)) throw new Error(`Technique operation ${options.operationId} is already preparing a different intent.`);
            return pending.promise.then(clone);
        }
        const promise = (async () => this.commit(await this.prepare(options)))();
        this.#pending.set(options.operationId, { request, promise });
        try { return await promise; } finally { if (this.#pending.get(options.operationId)?.promise === promise) this.#pending.delete(options.operationId); }
    }
}

module.exports = TechniqueService;
