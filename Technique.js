'use strict';

const FormulaEvaluator = require('./public/js/formula-evaluator.js');
const TechniqueFormulaVariables = require('./public/js/technique-formula-variables.js');
const IdGenerator = require('./IdGenerator.js');
const { ValidationIssueCollector } = require('./ResponseValidation.js');

const clone = value => JSON.parse(JSON.stringify(value));
const object = (value, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object. Supply its named fields rather than a scalar or list.`);
    return value;
};
const keys = (value, allowed, label) => {
    object(value, label);
    const issues = new ValidationIssueCollector();
    for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.add(new Error(`${label}.${key} is unsupported. Remove or move it; allowed fields here are ${allowed.join(", ")}.`));
    issues.throwIfAny();
};
const text = (value, label) => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
    return value.trim();
};
const number = (value, label, { integer = false, minimum = -Infinity } = {}) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < minimum) {
        throw new TypeError(`${label} must be a finite ${integer ? 'integer' : 'number'} >= ${minimum}. Supply ${integer ? 'a whole number' : 'a numeric value'}${Number.isFinite(minimum) ? ` at least ${minimum}` : ' without NaN or infinity'}.`);
    }
    return value;
};
const list = (value, label) => {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array. Put entries in its list container, with one object per entry.`);
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
        object(value, label);
        const issues = new ValidationIssueCollector();
        issues.capture(() => keys(value, ['kind', 'sourceId', 'reason', 'private', 'worldMinute', 'operationId'], label));
        const normalized = { kind: issues.capture(() => choice(value.kind, ['trainer', 'discovery', 'item', 'story', 'training', 'editor', 'generation', 'milestone', 'use'], `${label}.kind`)), reason: issues.capture(() => text(value.reason, `${label}.reason`)) };
        if (value.sourceId !== undefined) normalized.sourceId = issues.capture(() => text(value.sourceId, `${label}.sourceId`));
        if (value.private !== undefined) issues.capture(() => {
            if (typeof value.private !== 'boolean') throw new TypeError(`${label}.private must be a boolean.`);
            normalized.private = value.private;
        });
        if (value.worldMinute !== undefined) normalized.worldMinute = issues.capture(() => number(value.worldMinute, `${label}.worldMinute`, { minimum: 0 }));
        if (value.operationId !== undefined) normalized.operationId = issues.capture(() => text(value.operationId, `${label}.operationId`));
        issues.throwIfAny();
        return normalized;
    }

    static normalizeRequirements(value = [], label = 'requirements') {
        const issues = new ValidationIssueCollector();
        const result = list(value, label).map((entry, index) => issues.capture(() => {
            const at = `${label}[${index}]`;
            object(entry, at);
            const fields = new ValidationIssueCollector();
            const kind = fields.capture(() => choice(entry.kind, ['level', 'skill', 'attribute', 'discipline', 'technique', 'equippedItem', 'equipmentType', 'evidence', 'ability', 'status', 'class', 'race', 'alive'], `${at}.kind`));
            const relevant = ['kind', 'present', ...(['level', 'skill', 'attribute'].includes(kind) ? ['minimum'] : []), ...(['skill', 'attribute', 'equipmentType', 'ability', 'status', 'class', 'race'].includes(kind) ? ['name'] : []), ...(['discipline', 'technique', 'equippedItem', 'evidence'].includes(kind) ? ['id'] : [])];
            fields.capture(() => keys(entry, kind === undefined ? ['kind', 'id', 'name', 'minimum', 'present'] : relevant, at));
            const result = { kind };
            if (['level', 'skill', 'attribute'].includes(kind)) result.minimum = fields.capture(() => number(entry.minimum, `${at}.minimum`));
            if (['skill', 'attribute', 'equipmentType', 'ability', 'status', 'class', 'race'].includes(kind)) result.name = fields.capture(() => text(entry.name, `${at}.name`));
            if (['discipline', 'technique', 'equippedItem', 'evidence'].includes(kind)) result.id = fields.capture(() => text(entry.id, `${at}.id`));
            if (entry.present !== undefined) fields.capture(() => {
                if (typeof entry.present !== 'boolean') throw new TypeError(`${at}.present must be boolean.`);
                result.present = entry.present;
            });
            fields.throwIfAny();
            return result;
        }));
        issues.throwIfAny();
        return result;
    }

    static normalizeAmount(value, label = 'amount', { signed = false } = {}) {
        if (typeof value === 'number') return number(value, label, { minimum: signed ? -Infinity : 0 });
        keys(value, ['formula', 'bindings'], label);
        const formula = text(value.formula, `${label}.formula`);
        const bindings = value.bindings === undefined ? {} : object(value.bindings, `${label}.bindings`);
        const allowedFunctions = ['abs', 'round', 'floor', 'ceil', 'min', 'max'];
        for (const match of formula.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
            if (!allowedFunctions.includes(match[1])) throw new Error(`${label}: unsupported function ${match[1]}. Rewrite using arithmetic and only ${allowedFunctions.join(", ")}.`);
        }
        let variables;
        try { variables = FormulaEvaluator.collectVariables(formula); }
        catch (cause) { throw new Error(`${label}.formula: ${cause.message} Use numbers, parentheses, + - * / ^ and supported function calls; correct the expression syntax.`, { cause }); }
        const normalizedBindings = {};
        for (const [key, binding] of Object.entries(bindings)) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`${label}: invalid binding ${key}. Use a simple identifier starting with a letter or underscore and containing only letters, digits and underscores.`);
            if (!variables.includes(key)) throw new Error(`${label}: unused binding ${key}. Remove the unused binding or reference it in the formula when intended.`);
            keys(binding, ['kind', 'name'], `${label}.bindings.${key}`);
            const kind = choice(binding.kind, ['level', 'skill', 'attribute'], `${label}.bindings.${key}.kind`);
            normalizedBindings[key] = { kind };
            if (kind !== 'level') normalizedBindings[key].name = text(binding.name, `${label}.bindings.${key}.name`);
        }
        for (const variable of variables) if (!Object.hasOwn(normalizedBindings, variable) && !TechniqueFormulaVariables.isCanonical(variable)) throw new Error(`${label}: unknown formula variable ${variable}. Use an available formulaVariables key: level, skill_<normalized_name>, or attribute_<normalized_name>_modifier; resource names and property access are not variables.`);
        try {
            const compiled = FormulaEvaluator.compile(formula);
            if (!variables.length) number(compiled({}), label, { minimum: signed ? -Infinity : 0 });
        } catch (cause) {
            throw new Error(`${label}.formula: ${cause.message} Correct the expression so it produces a finite${signed ? '' : ' nonnegative'} amount.`, { cause });
        }
        return { formula, ...(value.bindings === undefined ? {} : { bindings: normalizedBindings }) };
    }

    static evaluateAmount(value, actor, label = 'amount', { signed = false } = {}) {
        const normalized = Technique.normalizeAmount(value, label, { signed });
        if (typeof normalized === 'number') return { amount: normalized, inputs: {} };
        const inputs = TechniqueFormulaVariables.resolve(normalized.formula, actor, normalized.bindings, label);
        try {
            const amount = FormulaEvaluator.compile(normalized.formula)(inputs);
            number(amount, label, { minimum: signed ? -Infinity : 0 });
            return { amount, inputs };
        } catch (cause) {
            throw new Error(`${label}.formula: ${cause.message} Correct the formula for the actor's current inputs so it produces a finite${signed ? '' : ' nonnegative'} amount.`, { cause });
        }
    }

    static validateRevisionAmounts(revision, actor, label = 'mechanics') {
        const issues = new ValidationIssueCollector();
        issues.capture(() => require('./TechniqueBalancePolicy.js').validateManagedRevision(revision, actor));
        for (const field of ['costs', 'failureCosts']) for (const [index, cost] of (revision[field] ?? []).entries()) issues.capture(() => Technique.evaluateAmount(cost.amount, actor, `${label}.${field}[${index}].amount`));
        for (const [index, effect] of revision.effects.entries()) {
            const at = `${label}.effects[${index}]`;
            if (effect.amount !== undefined) issues.capture(() => Technique.evaluateAmount(effect.amount, actor, `${at}.amount`));
            for (const field of ['bonus', 'multiplier']) if (effect[field] !== undefined) issues.capture(() => Technique.evaluateAmount(effect[field], actor, `${at}.${field}`));
            if (effect.kind === 'resurrection') issues.capture(() => {
                const resolved = Technique.evaluateAmount(effect.health, actor, `${at}.health`);
                if (resolved.amount <= 0) throw new Error(`${at}.health must resolve to a positive amount. Correct the number or formula for this actor.`);
            });
            if (effect.status) {
                for (const [field, magnitudes] of [['attributes', ['modifier', 'percentModifier']], ['skills', ['modifier', 'percentModifier']], ['needBars', ['delta', 'percentDelta']], ['needBarMaximums', ['percentModifier']]]) for (const [entryIndex, entry] of effect.status[field].entries()) for (const magnitude of magnitudes) if (entry[magnitude] !== undefined) issues.capture(() => Technique.evaluateAmount(entry[magnitude], actor, `${at}.status.${field}[${entryIndex}].${magnitude}`, { signed: true }));
                if (effect.status.maxHealthPercent !== undefined) issues.capture(() => Technique.evaluateAmount(effect.status.maxHealthPercent, actor, `${at}.status.maxHealthPercent`, { signed: true }));
            }
        }
        issues.throwIfAny();
    }

    static normalizeCosts(value = [], label = 'costs') {
        const issues = new ValidationIssueCollector();
        const costs = list(value, label).map((entry, index) => issues.capture(() => {
            const at = `${label}[${index}]`;
            object(entry, at);
            const fields = new ValidationIssueCollector();
            fields.capture(() => keys(entry, ['resource', 'needId', 'direction', 'binding', 'itemId', 'amount', 'perTarget'], at));
            const result = { resource: fields.capture(() => choice(entry.resource, ['health', 'need', 'charge'], `${at}.resource`)) };
            result.amount = fields.capture(() => Technique.normalizeAmount(entry.amount, `${at}.amount`));
            if (entry.perTarget !== undefined) {
                if (typeof entry.perTarget !== 'boolean') fields.add(new TypeError(`${at}.perTarget must be boolean. Use true to multiply this cost by the selected target count, or omit it for a fixed cost.`));
                else result.perTarget = entry.perTarget;
            }
            if (result.resource === 'need') {
                result.needId = fields.capture(() => text(entry.needId, `${at}.needId`));
                if (entry.direction !== undefined) result.direction = fields.capture(() => choice(entry.direction, ['increase', 'decrease'], `${at}.direction`));
            } else if (result.resource === 'charge') {
                result.binding = fields.capture(() => choice(entry.binding, ['grantingItem', 'ownedItem'], `${at}.binding`));
                if (result.binding === 'ownedItem') result.itemId = fields.capture(() => text(entry.itemId, `${at}.itemId`));
                if (result.binding === 'grantingItem' && entry.itemId !== undefined) fields.add(new Error(`${at}.itemId: grantingItem resolves the selected equipment source. Omit itemId, or use binding ownedItem with a concrete owned itemId.`));
                if (entry.needId !== undefined || entry.direction !== undefined) fields.add(new Error(`${at}: charge costs decrease their item pool. Omit needId and direction.`));
            } else if (result.resource === 'health' && (entry.needId !== undefined || entry.direction !== undefined)) fields.add(new Error(`${at}: health costs cannot name a need/direction. Omit needId and direction for health; use resource need with an active needId for a need-pool cost.`));
            if (result.resource !== 'charge' && (entry.binding !== undefined || entry.itemId !== undefined)) fields.add(new Error(`${at}: binding and itemId require resource charge. Omit them for health/need costs.`));
            fields.throwIfAny();
            return result;
        }));
        issues.throwIfAny();
        return costs;
    }

    static normalizeCheck(value = { kind: 'automatic' }, label = 'check') {
        object(value, label);
        const issues = new ValidationIssueCollector();
        const result = { kind: issues.capture(() => choice(value.kind, ['automatic', 'attack', 'skill', 'opposed'], `${label}.kind`)) };
        const relevant = {
            automatic: ['kind', 'description'],
            attack: ['kind', 'skill', 'attribute', 'attackType', 'damageType', 'defense', 'toughnessAttribute', 'damageEffectiveness', 'description'],
            skill: ['kind', 'skill', 'attribute', 'difficulty', 'description'],
            opposed: ['kind', 'skill', 'attribute', 'opposedSkill', 'opposedAttribute', 'description']
        };
        issues.capture(() => keys(value, relevant[result.kind] ?? ['kind', 'skill', 'attribute', 'difficulty', 'opposedSkill', 'opposedAttribute', 'attackType', 'damageType', 'defense', 'toughnessAttribute', 'damageEffectiveness', 'description'], label));
        for (const key of ['skill', 'attribute', 'opposedSkill', 'opposedAttribute', 'attackType', 'damageType', 'defense', 'toughnessAttribute', 'description']) if (value[key] !== undefined && (!result.kind || relevant[result.kind].includes(key))) result[key] = issues.capture(() => text(value[key], `${label}.${key}`));
        if (value.damageEffectiveness !== undefined && (!result.kind || relevant[result.kind].includes('damageEffectiveness'))) result.damageEffectiveness = issues.capture(() => {
            const rating = number(value.damageEffectiveness, `${label}.damageEffectiveness`, { integer: true, minimum: 1 });
            if (rating > 5) throw new Error(`${label}.damageEffectiveness must be an integer from 1 through 5. Omit this legacy field for current-target runtime assessment, or supply a valid saved integer rating.`);
            return rating;
        });
        if (value.difficulty !== undefined && (!result.kind || relevant[result.kind].includes('difficulty'))) result.difficulty = issues.capture(() => choice(value.difficulty, ['Trivial', 'Easy', 'Medium', 'Hard', 'Very Hard', 'Legendary'], `${label}.difficulty`));
        if (['skill', 'opposed', 'attack'].includes(result.kind) && value.skill === undefined) issues.add(new Error(`${label}.skill is required for ${result.kind} checks. Supply the actual acting skill name.`));
        if (result.kind === 'skill' && value.difficulty === undefined) issues.add(new Error(`${label}.difficulty is required for a skill check. Choose Trivial, Easy, Medium, Hard, Very Hard, or Legendary.`));
        if (result.kind === 'opposed' && value.opposedSkill === undefined) issues.add(new Error(`${label}.opposedSkill is required for an opposed check. Name the opposing skill used to resist this action.`));
        issues.throwIfAny();
        return result;
    }

    static normalizeStatus(value, label) {
        object(value, label);
        const issues = new ValidationIssueCollector();
        issues.capture(() => keys(value, ['name', 'description', 'attributes', 'skills', 'needBars', 'needBarMaximums', 'maxHealthPercent', 'techniqueGrants', 'duration'], label));
        const result = {
            name: issues.capture(() => text(value.name, `${label}.name`)),
            description: issues.capture(() => text(value.description, `${label}.description`)),
            duration: issues.capture(() => number(value.duration, `${label}.duration`, { integer: true, minimum: -1 }))
        };
        if (result.duration === 0) issues.add(new Error(`${label}.duration must be positive or -1 for permanent. Supply integer world minutes above zero, or -1 for a permanent status.`));
        for (const [field, identity, magnitudes] of [['attributes', 'attribute', ['modifier', 'percentModifier']], ['skills', 'skill', ['modifier', 'percentModifier']], ['needBars', 'name', ['delta', 'percentDelta']], ['needBarMaximums', 'name', ['percentModifier']]]) {
            const identities = new Set();
            const entries = issues.capture(() => list(value[field] ?? [], `${label}.${field}`));
            if (!entries) continue;
            result[field] = entries.map((entry, index) => issues.capture(() => {
                const at = `${label}.${field}[${index}]`;
                object(entry, at);
                const fields = new ValidationIssueCollector();
                fields.capture(() => keys(entry, [identity, ...magnitudes], at));
                const name = fields.capture(() => text(entry[identity], `${at}.${identity}`));
                if (name !== undefined) {
                    if (identities.has(name.toLowerCase())) fields.add(new Error(`${at}: duplicate modifier ${name}. Combine fixed modifier and percentModifier for this identity in a single entry.`));
                    identities.add(name.toLowerCase());
                }
                if (magnitudes.every(magnitude => entry[magnitude] === undefined)) fields.add(new Error(`${at} needs a modifier. Supply ${magnitudes.join(" or ")} on this entry; fixed and percentage modifiers may coexist.`));
                const normalized = { [identity]: name };
                for (const magnitude of magnitudes) if (entry[magnitude] !== undefined) normalized[magnitude] = fields.capture(() => field === 'needBarMaximums' ? number(entry[magnitude], `${at}.${magnitude}`) : Technique.normalizeAmount(entry[magnitude], `${at}.${magnitude}`, { signed: true }));
                if (field === 'needBars' && normalized.delta === undefined) normalized.delta = 0;
                fields.throwIfAny();
                return normalized;
            }));
        }
        if (value.maxHealthPercent !== undefined) result.maxHealthPercent = issues.capture(() => Technique.normalizeAmount(value.maxHealthPercent, `${label}.maxHealthPercent`, { signed: true }));
        const grantIds = new Set();
        const grants = issues.capture(() => list(value.techniqueGrants ?? [], `${label}.techniqueGrants`));
        if (grants) result.techniqueGrants = grants.map((entry, index) => issues.capture(() => {
            const at = `${label}.techniqueGrants[${index}]`;
            object(entry, at);
            const fields = new ValidationIssueCollector();
            fields.capture(() => keys(entry, ['id', 'techniqueId', 'definitionRevision'], at));
            const normalized = {
                techniqueId: fields.capture(() => text(entry.techniqueId, `${at}.techniqueId`)),
                definitionRevision: fields.capture(() => number(entry.definitionRevision, `${at}.definitionRevision`, { integer: true, minimum: 1 }))
            };
            if (entry.id !== undefined) {
                normalized.id = fields.capture(() => text(entry.id, `${at}.id`));
                if (normalized.id !== undefined) {
                    if (grantIds.has(normalized.id)) fields.add(new Error(`${at}.id: duplicate status technique grant ${normalized.id}. Use distinct grant IDs, or omit optional IDs so the server can assign them.`));
                    grantIds.add(normalized.id);
                }
            }
            fields.throwIfAny();
            return normalized;
        }));
        // Check emptiness only when collection/amount validation succeeded; an
        // invalid supplied modifier is not an absent mechanical change.
        if (['attributes', 'skills', 'needBars', 'needBarMaximums', 'techniqueGrants'].every(field => Array.isArray(result[field]) && result[field].length === 0) && value.maxHealthPercent === undefined) issues.add(new Error(`${label}: status needs a mechanical modifier or technique grant. Supply attributes, skills, needBars, needBarMaximums, maxHealthPercent or techniqueGrants that implement the intended change.`));
        issues.throwIfAny();
        return result;
    }

    static normalizeRevision(value, label = 'mechanics') {
        object(value, label);
        const issues = new ValidationIssueCollector();
        issues.capture(() => keys(value, ['revision', 'acquisitionRequirements', 'useRequirements', 'target', 'check', 'costs', 'failureCosts', 'effects', 'balance'], label));
        const target = value.target ?? { kind: 'self', allowDead: false };
        const normalizedTarget = issues.capture(() => {
            object(target, `${label}.target`);
            const fields = new ValidationIssueCollector();
            fields.capture(() => keys(target, ['kind', 'allowDead'], `${label}.target`));
            if (target.allowDead !== undefined && typeof target.allowDead !== 'boolean') fields.add(new TypeError(`${label}.target.allowDead must be boolean.`));
            const kind = fields.capture(() => choice(target.kind, ['self', 'single', 'area'], `${label}.target.kind`));
            fields.throwIfAny();
            return { kind, allowDead: target.allowDead === true };
        });
        const result = {
            revision: issues.capture(() => number(value.revision, `${label}.revision`, { integer: true, minimum: 1 })),
            acquisitionRequirements: issues.capture(() => Technique.normalizeRequirements(value.acquisitionRequirements ?? [], `${label}.acquisitionRequirements`)),
            useRequirements: issues.capture(() => Technique.normalizeRequirements(value.useRequirements ?? [], `${label}.useRequirements`)),
            target: normalizedTarget,
            check: issues.capture(() => Technique.normalizeCheck(value.check, `${label}.check`)),
            costs: issues.capture(() => Technique.normalizeCosts(value.costs, `${label}.costs`))
        };
        if (value.failureCosts !== undefined) result.failureCosts = issues.capture(() => Technique.normalizeCosts(value.failureCosts, `${label}.failureCosts`));
        const ids = new Set();
        const effects = issues.capture(() => list(value.effects, `${label}.effects`));
        if (effects) result.effects = effects.map((entry, index) => issues.capture(() => {
            const at = `${label}.effects[${index}]`;
            object(entry, at);
            const fields = new ValidationIssueCollector();
            fields.capture(() => keys(entry, ['id', 'kind', 'amount', 'damageMode', 'bonus', 'multiplier', 'status', 'stacking', 'refreshPolicy', 'potency', 'check', 'destinationId', 'summonMode', 'actorId', 'templateId', 'template', 'lifetimeMinutes', 'health'], at));
            const effect = { id: fields.capture(() => text(entry.id, `${at}.id`)), kind: fields.capture(() => choice(entry.kind, ['healing', 'damage', 'buff', 'debuff', 'teleport', 'summon', 'resurrection'], `${at}.kind`)) };
            // Kind selects branch constraints; independent IDs/checks still validate.
            if (effect.kind) fields.capture(() => keys(entry, ['id', 'kind', 'check', ...(['healing', 'damage'].includes(effect.kind) ? (effect.kind === 'damage' && entry.damageMode === 'weapon' ? ['damageMode', 'bonus', 'multiplier'] : ['amount', ...(effect.kind === 'damage' ? ['damageMode'] : [])]) : ['buff', 'debuff'].includes(effect.kind) ? ['status', 'stacking', 'refreshPolicy', 'potency'] : effect.kind === 'teleport' ? ['destinationId'] : effect.kind === 'summon' ? ['summonMode', 'actorId', 'templateId', 'template', 'lifetimeMinutes'] : ['health'])], at));
            if (effect.id !== undefined) {
                if (ids.has(effect.id)) fields.add(new Error(`${at}: duplicate effect ID ${effect.id}. Give each distinct effect its own stable ID, or merge repeated copies of the same effect.`));
                ids.add(effect.id);
            }
            if (entry.check !== undefined) effect.check = fields.capture(() => Technique.normalizeCheck(entry.check, `${at}.check`));
            // An invalid override does not inherit the revision check.
            const check = entry.check === undefined ? result.check : effect.check;
            if (['damage', 'debuff'].includes(effect.kind) && check?.kind === 'automatic') {
                const inherited = entry.check === undefined;
                const checkPath = inherited ? `${label}.check` : `${at}.check`;
                fields.add(new Error(`${at}: ${effect.kind} effect has effective check kind ${check.kind}, ${inherited ? 'inherited from revision.check' : 'from effect.check override'} (${checkPath}.kind). Harmful effects require attack/opposed/skill checks. Correct ${checkPath}.kind and its required fields in ${checkPath}${inherited ? `, or supply a valid per-effect override at ${at}.check` : ''}.`));
            }
            if (['damage', 'healing'].includes(effect.kind)) {
                if (effect.kind === 'damage') effect.damageMode = fields.capture(() => choice(entry.damageMode, ['technique', 'weapon'], `${at}.damageMode`));
                if (effect.kind === 'damage' && effect.damageMode === 'weapon') {
                    effect.bonus = fields.capture(() => Technique.normalizeAmount(entry.bonus, `${at}.bonus`));
                    effect.multiplier = fields.capture(() => Technique.normalizeAmount(entry.multiplier, `${at}.multiplier`));
                    const checkPath = entry.check === undefined ? `${label}.check` : `${at}.check`;
                    if (check?.kind !== 'attack') fields.add(new Error(`${at}: weapon damage requires an effective attack check at ${checkPath}. Select kind attack with an actual skill.`));
                    else {
                        if (!check.toughnessAttribute) fields.add(new Error(`${checkPath}.toughnessAttribute is required for weapon damage. Select an actual target attribute used for toughness; do not infer no defense.`));
                    }
                } else effect.amount = fields.capture(() => Technique.normalizeAmount(entry.amount, `${at}.amount`));
            } else if (effect.kind) {
                if (['buff', 'debuff'].includes(effect.kind)) {
                    effect.status = fields.capture(() => Technique.normalizeStatus(entry.status, `${at}.status`));
                    effect.stacking = fields.capture(() => choice(entry.stacking ?? 'refresh', ['refresh', 'stack'], `${at}.stacking`));
                    effect.refreshPolicy = fields.capture(() => choice(entry.refreshPolicy ?? 'stronger', ['stronger', 'replace', 'reject'], `${at}.refreshPolicy`));
                    if (entry.potency !== undefined) effect.potency = fields.capture(() => number(entry.potency, `${at}.potency`, { minimum: 0 }));
                } else Object.assign(effect, fields.capture(() => require('./TechniqueUtilityEffects.js').normalizeEffect(entry, at)));
            }
            fields.throwIfAny();
            return effect;
        }));
        if (effects?.length === 0) issues.add(new Error(`${label}.effects cannot be empty. Supply supported damage, healing, buff or debuff effects; recipe revisions instead omit effects for engine compilation.`));
        if ((result.effects ?? []).filter(effect => effect?.kind === 'teleport').length > 1) issues.add(new Error(`${label}.effects: one technique revision may contain only one teleport effect. Combine the intended targets under that effect; multiple destinations in one attempt have no defined arrival order.`));
        if (normalizedTarget?.allowDead === true && (!result.effects?.length || result.effects.some(effect => effect?.kind !== 'resurrection'))) issues.add(new Error(`${label}.target.allowDead: true requires every effect to be resurrection. Separate living-target effects into another technique, or set allowDead false.`));
        issues.throwIfAny();
        if (value.balance !== undefined) {
            result.balance = clone(value.balance);
            require('./TechniqueBalancePolicy.js').validateManagedRevision(result, undefined, label);
        }
        return result;
    }

    static normalizeDiscipline(value) {
        object(value, 'discipline');
        const issues = new ValidationIssueCollector();
        issues.capture(() => keys(value, ['id', 'name', 'description', 'accessRequirements', 'publicAccess', 'provenance'], 'discipline'));
        if (value.publicAccess !== undefined && typeof value.publicAccess !== 'boolean') issues.add(new TypeError('discipline.publicAccess must be boolean.'));
        const result = { id: issues.capture(() => text(value.id, 'discipline.id')), name: issues.capture(() => text(value.name, 'discipline.name')), description: issues.capture(() => text(value.description, 'discipline.description')), accessRequirements: issues.capture(() => Technique.normalizeRequirements(value.accessRequirements ?? [], 'discipline.accessRequirements')), publicAccess: value.publicAccess === true };
        if (value.provenance) result.provenance = issues.capture(() => Technique.normalizeProvenance(value.provenance));
        issues.throwIfAny();
        return result;
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
        object(value, 'technique');
        const issues = new ValidationIssueCollector();
        issues.capture(() => keys(value, ['id', 'disciplineId', 'name', 'description', 'shortDescription', 'semanticKey', 'aliases', 'unique', 'provenance', 'revisions'], 'technique'));
        for (const field of ['id', 'disciplineId', 'name', 'description', 'semanticKey']) this[field] = issues.capture(() => text(value[field], `technique.${field}`));
        this.shortDescription = issues.capture(() => Technique.normalizeShortDescription(value.shortDescription));
        this.aliases = issues.capture(() => list(value.aliases ?? [], 'technique.aliases').map(alias => text(alias, 'technique alias')));
        issues.capture(() => {
            if (value.unique !== undefined && typeof value.unique !== 'boolean') throw new TypeError('technique.unique must be boolean.');
        });
        this.unique = value.unique;
        this.provenance = issues.capture(() => Technique.normalizeProvenance(value.provenance));
        const revisions = issues.capture(() => list(value.revisions, 'technique.revisions'));
        if (revisions) this.revisions = revisions.map((revision, index) => issues.capture(() => {
            const normalized = Technique.normalizeRevision(revision, `technique.revisions[${index}]`);
            if (normalized.revision !== index + 1) throw new Error('Technique revisions must be ordered contiguous immutable revision numbers starting at 1. A fresh candidate supplies one revision numbered 1.');
            return normalized;
        }));
        if (revisions?.length === 0) issues.add(new Error('Technique requires at least one revision.'));
        issues.throwIfAny();
        this.semanticKey = this.semanticKey.toLowerCase();
    }

    getRevision(revision = this.revisions.length) {
        const result = this.revisions.find(entry => entry.revision === revision);
        if (!result) throw new Error(`Technique ${this.id} has no revision ${revision}. Select an existing definitionRevision (${this.revisions.map(entry => entry.revision).join(", ")}), or, for an outer attachment techniqueEntry only, omit it to use the latest revision. Nested status techniqueGrants require an explicit definitionRevision.`);
        return clone(result);
    }

    static normalizeShortDescription(value) {
        if (value === undefined || value === null) return '';
        if (typeof value !== 'string') throw new TypeError('technique.shortDescription must be text; omit it or use an empty string when no concise description is available.');
        return value.trim();
    }

    toJSON({ includePresentation = true } = {}) { return clone({ id: this.id, disciplineId: this.disciplineId, name: this.name, description: this.description, ...(includePresentation ? { shortDescription: this.shortDescription, ...(this.unique === undefined ? {} : { unique: this.unique }) } : {}), semanticKey: this.semanticKey, aliases: this.aliases, provenance: this.provenance, revisions: this.revisions }); }
    static fromJSON(value) { return new Technique(value); }
    static create(value) { return new Technique({ ...value, id: value.id ?? IdGenerator.next('technique', value.name) }); }
}

module.exports = Technique;
