'use strict';

const FormulaEvaluator = require('./public/js/formula-evaluator.js');
const TechniqueFormulaVariables = require('./public/js/technique-formula-variables.js');
const IdGenerator = require('./IdGenerator.js');

const clone = value => JSON.parse(JSON.stringify(value));
const object = (value, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
    return value;
};
const keys = (value, allowed, label) => {
    object(value, label);
    for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}.${key} is unsupported.`);
};
const text = (value, label) => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
    return value.trim();
};
const number = (value, label, { integer = false, minimum = -Infinity } = {}) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < minimum) {
        throw new TypeError(`${label} must be a finite ${integer ? 'integer' : 'number'} >= ${minimum}.`);
    }
    return value;
};
const list = (value, label) => {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
    return value;
};
const choice = (value, allowed, label) => {
    if (!allowed.includes(value)) throw new Error(`${label} must be one of ${allowed.join(', ')}.`);
    return value;
};

/** Saved mechanical definitions only. No model input is evaluated as code. */
class Technique {
    static clone = clone;
    static assertKeys = keys;
    static text = text;
    static number = number;

    static normalizeProvenance(value, label = 'provenance') {
        keys(value, ['kind', 'sourceId', 'reason', 'private', 'worldMinute', 'operationId'], label);
        const normalized = { kind: choice(value.kind, ['trainer', 'discovery', 'item', 'story', 'training', 'editor', 'generation', 'milestone', 'use'], `${label}.kind`), reason: text(value.reason, `${label}.reason`) };
        if (value.sourceId !== undefined) normalized.sourceId = text(value.sourceId, `${label}.sourceId`);
        if (value.private !== undefined) {
            if (typeof value.private !== 'boolean') throw new TypeError(`${label}.private must be a boolean.`);
            normalized.private = value.private;
        }
        if (value.worldMinute !== undefined) normalized.worldMinute = number(value.worldMinute, `${label}.worldMinute`, { minimum: 0 });
        if (value.operationId !== undefined) normalized.operationId = text(value.operationId, `${label}.operationId`);
        return normalized;
    }

    static normalizeRequirements(value = [], label = 'requirements') {
        return list(value, label).map((entry, index) => {
            const at = `${label}[${index}]`;
            keys(entry, ['kind', 'id', 'name', 'minimum', 'present'], at);
            const kind = choice(entry.kind, ['level', 'skill', 'attribute', 'discipline', 'technique', 'equippedItem', 'equipmentType', 'evidence', 'ability', 'status', 'class', 'race', 'alive'], `${at}.kind`);
            const relevant = ['kind', 'present', ...(['level', 'skill', 'attribute'].includes(kind) ? ['minimum'] : []), ...(['skill', 'attribute', 'equipmentType', 'ability', 'status', 'class', 'race'].includes(kind) ? ['name'] : []), ...(['discipline', 'technique', 'equippedItem', 'evidence'].includes(kind) ? ['id'] : [])];
            keys(entry, relevant, at);
            const result = { kind };
            if (['level', 'skill', 'attribute'].includes(kind)) result.minimum = number(entry.minimum, `${at}.minimum`);
            if (['skill', 'attribute', 'equipmentType', 'ability', 'status', 'class', 'race'].includes(kind)) result.name = text(entry.name, `${at}.name`);
            if (['discipline', 'technique', 'equippedItem', 'evidence'].includes(kind)) result.id = text(entry.id, `${at}.id`);
            if (entry.present !== undefined) {
                if (typeof entry.present !== 'boolean') throw new TypeError(`${at}.present must be boolean.`);
                result.present = entry.present;
            }
            return result;
        });
    }

    static normalizeAmount(value, label = 'amount', { signed = false } = {}) {
        if (typeof value === 'number') return number(value, label, { minimum: signed ? -Infinity : 0 });
        keys(value, ['formula', 'bindings'], label);
        const formula = text(value.formula, `${label}.formula`);
        const bindings = value.bindings === undefined ? {} : object(value.bindings, `${label}.bindings`);
        const allowedFunctions = ['abs', 'round', 'floor', 'ceil', 'min', 'max'];
        for (const match of formula.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
            if (!allowedFunctions.includes(match[1])) throw new Error(`${label}: unsupported function ${match[1]}.`);
        }
        const variables = FormulaEvaluator.collectVariables(formula);
        const normalizedBindings = {};
        for (const [key, binding] of Object.entries(bindings)) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`${label}: invalid binding ${key}.`);
            if (!variables.includes(key)) throw new Error(`${label}: unused binding ${key}.`);
            keys(binding, ['kind', 'name'], `${label}.bindings.${key}`);
            const kind = choice(binding.kind, ['level', 'skill', 'attribute'], `${label}.bindings.${key}.kind`);
            normalizedBindings[key] = { kind };
            if (kind !== 'level') normalizedBindings[key].name = text(binding.name, `${label}.bindings.${key}.name`);
        }
        for (const variable of variables) if (!Object.hasOwn(normalizedBindings, variable) && !TechniqueFormulaVariables.isCanonical(variable)) throw new Error(`${label}: unknown formula variable ${variable}. Use an available variable for this character.`);
        FormulaEvaluator.compile(formula);
        if (!variables.length) {
            const evaluated = FormulaEvaluator.compile(formula)({});
            number(evaluated, label, { minimum: signed ? -Infinity : 0 });
        }
        return { formula, ...(value.bindings === undefined ? {} : { bindings: normalizedBindings }) };
    }

    static evaluateAmount(value, actor, label = 'amount', { signed = false } = {}) {
        const normalized = Technique.normalizeAmount(value, label, { signed });
        if (typeof normalized === 'number') return { amount: normalized, inputs: {} };
        const inputs = TechniqueFormulaVariables.resolve(normalized.formula, actor, normalized.bindings, label);
        const amount = FormulaEvaluator.compile(normalized.formula)(inputs);
        number(amount, label, { minimum: signed ? -Infinity : 0 });
        return { amount, inputs };
    }

    static validateRevisionAmounts(revision, actor, label = 'mechanics') {
        require('./TechniqueBalancePolicy.js').validateManagedRevision(revision, actor);
        for (const field of ['costs', 'failureCosts']) for (const [index, cost] of (revision[field] ?? []).entries()) Technique.evaluateAmount(cost.amount, actor, `${label}.${field}[${index}].amount`);
        for (const [index, effect] of revision.effects.entries()) {
            const at = `${label}.effects[${index}]`;
            if (effect.amount !== undefined) Technique.evaluateAmount(effect.amount, actor, `${at}.amount`);
            if (effect.status) {
                for (const [field, magnitudes] of [['attributes', ['modifier', 'percentModifier']], ['skills', ['modifier', 'percentModifier']], ['needBars', ['delta']]]) for (const [entryIndex, entry] of effect.status[field].entries()) for (const magnitude of magnitudes) if (entry[magnitude] !== undefined) Technique.evaluateAmount(entry[magnitude], actor, `${at}.status.${field}[${entryIndex}].${magnitude}`, { signed: true });
                if (effect.status.maxHealthPercent !== undefined) Technique.evaluateAmount(effect.status.maxHealthPercent, actor, `${at}.status.maxHealthPercent`, { signed: true });
            }
        }
    }

    static normalizeCosts(value = [], label = 'costs') {
        return list(value, label).map((entry, index) => {
            const at = `${label}[${index}]`;
            keys(entry, ['resource', 'needId', 'direction', 'amount'], at);
            const result = { resource: choice(entry.resource, ['health', 'need'], `${at}.resource`), amount: Technique.normalizeAmount(entry.amount, `${at}.amount`) };
            if (result.resource === 'need') {
                result.needId = text(entry.needId, `${at}.needId`);
                if (entry.direction !== undefined) result.direction = choice(entry.direction, ['increase', 'decrease'], `${at}.direction`);
            } else if (entry.needId !== undefined || entry.direction !== undefined) throw new Error(`${at}: health costs cannot name a need/direction.`);
            return result;
        });
    }

    static normalizeCheck(value = { kind: 'automatic' }, label = 'check') {
        keys(value, ['kind', 'skill', 'attribute', 'difficulty', 'opposedSkill', 'opposedAttribute', 'attackType', 'damageType', 'defense', 'description'], label);
        const result = { kind: choice(value.kind, ['automatic', 'attack', 'skill', 'opposed'], `${label}.kind`) };
        const relevant = {
            automatic: ['kind', 'description'],
            attack: ['kind', 'skill', 'attribute', 'attackType', 'damageType', 'defense', 'description'],
            skill: ['kind', 'skill', 'attribute', 'difficulty', 'description'],
            opposed: ['kind', 'skill', 'attribute', 'opposedSkill', 'opposedAttribute', 'description']
        };
        keys(value, relevant[result.kind], label);
        for (const key of ['skill', 'attribute', 'opposedSkill', 'opposedAttribute', 'attackType', 'damageType', 'defense', 'description']) if (value[key] !== undefined) result[key] = text(value[key], `${label}.${key}`);
        if (value.difficulty !== undefined) result.difficulty = choice(value.difficulty, ['Trivial', 'Easy', 'Medium', 'Hard', 'Very Hard', 'Legendary'], `${label}.difficulty`);
        if (['skill', 'opposed', 'attack'].includes(result.kind) && !result.skill) throw new Error(`${label}.skill is required.`);
        if (result.kind === 'skill' && result.difficulty === undefined) throw new Error(`${label}.difficulty is required.`);
        if (result.kind === 'opposed' && !result.opposedSkill) throw new Error(`${label}.opposedSkill is required.`);
        return result;
    }

    static normalizeStatus(value, label) {
        keys(value, ['name', 'description', 'attributes', 'skills', 'needBars', 'maxHealthPercent', 'techniqueGrants', 'duration'], label);
        const result = { name: text(value.name, `${label}.name`), description: text(value.description, `${label}.description`), duration: number(value.duration, `${label}.duration`, { integer: true, minimum: -1 }) };
        if (result.duration === 0) throw new Error(`${label}.duration must be positive or -1 for permanent.`);
        for (const [field, identity, magnitudes] of [['attributes', 'attribute', ['modifier', 'percentModifier']], ['skills', 'skill', ['modifier', 'percentModifier']], ['needBars', 'name', ['delta']]]) {
            const identities = new Set();
            result[field] = list(value[field] ?? [], `${label}.${field}`).map((entry, index) => {
                keys(entry, [identity, ...magnitudes], `${label}.${field}[${index}]`);
                const name = text(entry[identity], `${label}.${field}[${index}].${identity}`);
                if (identities.has(name.toLowerCase())) throw new Error(`${label}.${field}: duplicate modifier ${name}.`);
                identities.add(name.toLowerCase());
                if (magnitudes.every(magnitude => entry[magnitude] === undefined)) throw new Error(`${label}.${field}[${index}] needs a modifier.`);
                return { [identity]: name, ...Object.fromEntries(magnitudes.filter(magnitude => entry[magnitude] !== undefined).map(magnitude => [magnitude, Technique.normalizeAmount(entry[magnitude], `${label}.${field}[${index}].${magnitude}`, { signed: true })])) };
            });
        }
        if (value.maxHealthPercent !== undefined) result.maxHealthPercent = Technique.normalizeAmount(value.maxHealthPercent, `${label}.maxHealthPercent`, { signed: true });
        const grantIds = new Set();
        result.techniqueGrants = list(value.techniqueGrants ?? [], `${label}.techniqueGrants`).map((entry, index) => {
            const at = `${label}.techniqueGrants[${index}]`;
            keys(entry, ['id', 'techniqueId', 'definitionRevision'], at);
            if (entry.id !== undefined) {
                const id = text(entry.id, `${at}.id`);
                if (grantIds.has(id)) throw new Error(`${label}: duplicate status technique grant ${id}.`);
                grantIds.add(id);
            }
            return { ...(entry.id === undefined ? {} : { id: entry.id }), techniqueId: text(entry.techniqueId, `${at}.techniqueId`), definitionRevision: number(entry.definitionRevision, `${at}.definitionRevision`, { integer: true, minimum: 1 }) };
        });
        if (!result.attributes.length && !result.skills.length && !result.needBars.length && result.maxHealthPercent === undefined && !result.techniqueGrants.length) throw new Error(`${label}: status needs a mechanical modifier or technique grant.`);
        return result;
    }

    static normalizeRevision(value, label = 'mechanics') {
        keys(value, ['revision', 'acquisitionRequirements', 'useRequirements', 'target', 'check', 'costs', 'failureCosts', 'effects', 'balance'], label);
        const target = value.target ?? { kind: 'self', allowDead: false };
        keys(target, ['kind', 'allowDead'], `${label}.target`);
        if (target.allowDead !== undefined && typeof target.allowDead !== 'boolean') throw new TypeError(`${label}.target.allowDead must be boolean.`);
        if (target.allowDead === true) throw new Error(`${label}: dead targets are unsupported by initial technique effects.`);
        const result = {
            revision: number(value.revision, `${label}.revision`, { integer: true, minimum: 1 }),
            acquisitionRequirements: Technique.normalizeRequirements(value.acquisitionRequirements ?? [], `${label}.acquisitionRequirements`),
            useRequirements: Technique.normalizeRequirements(value.useRequirements ?? [], `${label}.useRequirements`),
            target: { kind: choice(target.kind, ['self', 'single', 'area'], `${label}.target.kind`), allowDead: false },
            check: Technique.normalizeCheck(value.check, `${label}.check`),
            costs: Technique.normalizeCosts(value.costs, `${label}.costs`),
            effects: []
        };
        if (value.failureCosts !== undefined) result.failureCosts = Technique.normalizeCosts(value.failureCosts, `${label}.failureCosts`);
        const ids = new Set();
        result.effects = list(value.effects, `${label}.effects`).map((entry, index) => {
            const at = `${label}.effects[${index}]`;
            keys(entry, ['id', 'kind', 'amount', 'damageMode', 'status', 'stacking', 'refreshPolicy', 'potency', 'check'], at);
            const effect = { id: text(entry.id, `${at}.id`), kind: choice(entry.kind, ['healing', 'damage', 'buff', 'debuff'], `${at}.kind`) };
            keys(entry, ['id', 'kind', 'check', ...(['healing', 'damage'].includes(effect.kind) ? ['amount', ...(effect.kind === 'damage' ? ['damageMode'] : [])] : ['status', 'stacking', 'refreshPolicy', 'potency'])], at);
            if (ids.has(effect.id)) throw new Error(`${at}: duplicate effect ID ${effect.id}.`);
            ids.add(effect.id);
            if (entry.check !== undefined) effect.check = Technique.normalizeCheck(entry.check, `${at}.check`);
            const check = effect.check ?? result.check;
            if (['damage', 'debuff'].includes(effect.kind) && check.kind === 'automatic') throw new Error(`${at}: harmful effects require attack/opposed/skill checks.`);
            if (['damage', 'healing'].includes(effect.kind)) {
                effect.amount = Technique.normalizeAmount(entry.amount, `${at}.amount`);
                if (effect.kind === 'damage') effect.damageMode = choice(entry.damageMode, ['technique'], `${at}.damageMode`);
                if (entry.status !== undefined) throw new Error(`${at}: damage/healing cannot contain a status.`);
            } else {
                effect.status = Technique.normalizeStatus(entry.status, `${at}.status`);
                effect.stacking = choice(entry.stacking ?? 'refresh', ['refresh', 'stack'], `${at}.stacking`);
                effect.refreshPolicy = choice(entry.refreshPolicy ?? 'stronger', ['stronger', 'replace', 'reject'], `${at}.refreshPolicy`);
                if (entry.potency !== undefined) effect.potency = number(entry.potency, `${at}.potency`, { minimum: 0 });
                if (entry.amount !== undefined || entry.damageMode !== undefined) throw new Error(`${at}: status effects use status modifiers.`);
            }
            return effect;
        });
        if (!result.effects.length) throw new Error(`${label}.effects cannot be empty.`);
        if (value.balance !== undefined) {
            result.balance = clone(value.balance);
            require('./TechniqueBalancePolicy.js').validateManagedRevision(result);
        }
        return result;
    }

    static normalizeDiscipline(value) {
        keys(value, ['id', 'name', 'description', 'accessRequirements', 'publicAccess', 'provenance'], 'discipline');
        if (value.publicAccess !== undefined && typeof value.publicAccess !== 'boolean') throw new TypeError('discipline.publicAccess must be boolean.');
        return { id: text(value.id, 'discipline.id'), name: text(value.name, 'discipline.name'), description: text(value.description, 'discipline.description'), accessRequirements: Technique.normalizeRequirements(value.accessRequirements ?? []), publicAccess: value.publicAccess === true, ...(value.provenance ? { provenance: Technique.normalizeProvenance(value.provenance) } : {}) };
    }

    static normalizeDisciplineAccess(value = []) {
        const ids = new Set();
        return list(value, 'disciplineAccess').map(entry => {
            keys(entry, ['disciplineId', 'provenance'], 'disciplineAccess entry');
            const disciplineId = text(entry.disciplineId, 'disciplineAccess.disciplineId');
            if (ids.has(disciplineId)) throw new Error(`Duplicate discipline access ${disciplineId}.`);
            ids.add(disciplineId);
            return { disciplineId, provenance: Technique.normalizeProvenance(entry.provenance) };
        });
    }

    static normalizeEvidence(value = []) {
        const ids = new Set();
        return list(value, 'evidence').map(entry => {
            keys(entry, ['id', 'kind', 'description', 'worldMinute', 'usedBy'], 'evidence entry');
            const id = text(entry.id, 'evidence.id');
            if (ids.has(id)) throw new Error(`Duplicate evidence ${id}.`);
            ids.add(id);
            return { id, kind: text(entry.kind, 'evidence.kind'), description: text(entry.description, 'evidence.description'), worldMinute: number(entry.worldMinute, 'evidence.worldMinute', { minimum: 0 }), ...(entry.usedBy !== undefined ? { usedBy: text(entry.usedBy, 'evidence.usedBy') } : {}) };
        });
    }

    static normalizeLearned(value = []) {
        const ids = new Set();
        return list(value, 'techniques').map(entry => {
            keys(entry, ['techniqueId', 'definitionRevision', 'personalRevision', 'mechanics', 'provenance', 'acquiredAt', 'evidence', 'revisionHistory'], 'learned technique');
            const techniqueId = text(entry.techniqueId, 'learned.techniqueId');
            if (ids.has(techniqueId)) throw new Error(`Duplicate learned technique ${techniqueId}.`);
            ids.add(techniqueId);
            const personalRevision = number(entry.personalRevision, 'learned.personalRevision', { integer: true, minimum: 1 });
            const mechanics = Technique.normalizeRevision(entry.mechanics);
            if (mechanics.revision !== personalRevision) throw new Error('Learned personal revision must equal mechanics.revision.');
            const revisionHistory = list(entry.revisionHistory ?? [], 'learned.revisionHistory').map(revision => Technique.normalizeRevision(revision));
            const revisions = new Set([personalRevision]);
            for (const revision of revisionHistory) {
                if (revision.revision >= personalRevision || revisions.has(revision.revision)) throw new Error('Invalid learned revision history.');
                revisions.add(revision.revision);
            }
            return { techniqueId, definitionRevision: number(entry.definitionRevision, 'learned.definitionRevision', { integer: true, minimum: 1 }), personalRevision, mechanics, provenance: Technique.normalizeProvenance(entry.provenance), acquiredAt: number(entry.acquiredAt, 'learned.acquiredAt', { minimum: 0 }), evidence: Technique.normalizeEvidence(entry.evidence ?? []), revisionHistory };
        });
    }

    static normalizeGrants(value = [], sourceItemId = null, { allowUnbound = false } = {}) {
        const ids = new Set();
        return list(value, 'techniqueGrants').map(entry => {
            keys(entry, ['id', 'sourceItemId', 'techniqueId', 'definitionRevision', 'teaches', 'provenance'], 'technique grant');
            const id = text(entry.id, 'grant.id');
            if (ids.has(id)) throw new Error(`Duplicate technique grant ${id}.`);
            ids.add(id);
            const source = allowUnbound && !sourceItemId && (entry.sourceItemId === undefined || entry.sourceItemId === null)
                ? null
                : text(entry.sourceItemId ?? sourceItemId, 'grant.sourceItemId');
            if (sourceItemId && source !== sourceItemId) throw new Error(`Technique grant ${id} belongs to another item.`);
            if (entry.teaches !== undefined && typeof entry.teaches !== 'boolean') throw new TypeError('grant.teaches must be boolean.');
            return { id, sourceItemId: source, techniqueId: text(entry.techniqueId, 'grant.techniqueId'), definitionRevision: number(entry.definitionRevision, 'grant.definitionRevision', { integer: true, minimum: 1 }), teaches: entry.teaches === true, provenance: Technique.normalizeProvenance(entry.provenance) };
        });
    }

    static normalizeStatusGrants(value = [], sourceStatusId) {
        const entries = list(value, 'status techniqueGrants');
        if (!entries.length) return [];
        const statusId = text(sourceStatusId, 'status grant sourceStatusId');
        const ids = new Set();
        return entries.map((entry, index) => {
            keys(entry, ['id', 'sourceStatusId', 'techniqueId', 'definitionRevision', 'provenance'], `status techniqueGrants[${index}]`);
            const id = entry.id === undefined ? `status_grant:${statusId}:${index}` : text(entry.id, 'status grant.id');
            if (ids.has(id)) throw new Error(`Duplicate status technique grant ${id}.`);
            ids.add(id);
            if (entry.sourceStatusId !== undefined && entry.sourceStatusId !== statusId) throw new Error(`Status technique grant ${id} belongs to another status.`);
            return {
                id, sourceStatusId: statusId,
                techniqueId: text(entry.techniqueId, 'status grant.techniqueId'),
                definitionRevision: number(entry.definitionRevision, 'status grant.definitionRevision', { integer: true, minimum: 1 }),
                ...(entry.provenance === undefined ? {} : { provenance: Technique.normalizeProvenance(entry.provenance) })
            };
        });
    }

    constructor(value) {
        keys(value, ['id', 'disciplineId', 'name', 'description', 'semanticKey', 'aliases', 'unique', 'provenance', 'revisions'], 'technique');
        this.id = text(value.id, 'technique.id');
        this.disciplineId = text(value.disciplineId, 'technique.disciplineId');
        this.name = text(value.name, 'technique.name');
        this.description = text(value.description, 'technique.description');
        this.semanticKey = text(value.semanticKey, 'technique.semanticKey').toLowerCase();
        this.aliases = list(value.aliases ?? [], 'technique.aliases').map(alias => text(alias, 'technique alias'));
        if (value.unique !== undefined && typeof value.unique !== 'boolean') throw new TypeError('technique.unique must be boolean.');
        this.unique = value.unique === true;
        this.provenance = Technique.normalizeProvenance(value.provenance);
        this.revisions = list(value.revisions, 'technique.revisions').map((revision, index) => {
            const normalized = Technique.normalizeRevision(revision, `technique.revisions[${index}]`);
            if (normalized.revision !== index + 1) throw new Error('Technique revisions must be ordered contiguous immutable revision numbers starting at 1.');
            return normalized;
        });
        if (!this.revisions.length) throw new Error('Technique requires at least one revision.');
    }

    getRevision(revision = this.revisions.length) {
        const result = this.revisions.find(entry => entry.revision === revision);
        if (!result) throw new Error(`Technique ${this.id} has no revision ${revision}.`);
        return clone(result);
    }

    toJSON() { return clone({ id: this.id, disciplineId: this.disciplineId, name: this.name, description: this.description, semanticKey: this.semanticKey, aliases: this.aliases, unique: this.unique, provenance: this.provenance, revisions: this.revisions }); }
    static fromJSON(value) { return new Technique(value); }
    static create(value) { return new Technique({ ...value, id: value.id ?? IdGenerator.next('technique') }); }
}

module.exports = Technique;
