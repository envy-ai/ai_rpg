'use strict';

const crypto = require('node:crypto');
const Variables = require('./public/js/technique-formula-variables.js');
const Evaluator = require('./public/js/formula-evaluator.js');
const { ValidationIssueCollector } = require('./ResponseValidation.js');
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function keys(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}.${key} is unsupported. Remove or move it; allowed fields here are ${allowed.join(", ")}.`);
}
function text(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string.`); return value.trim(); }
function numeric(value, label, minimum = 0, positive = false) { if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || (positive && value === 0)) throw new Error(`${label} must be finite and ${positive ? 'positive' : `>= ${minimum}`}.`); return value; }
const DEFAULT_POLICY = {
    version: 1,
    healing: { standard: { referenceSource: 'baseWeaponDamage', referenceMultiplier: 2, levelCoefficient: 3, skillCoefficient: 1, attributeCoefficient: 0.5 } },
    damage: { standard: { referenceSource: 'baseWeaponDamage', referenceMultiplier: 2, levelCoefficient: 3, skillCoefficient: 1, attributeCoefficient: 0.5 } },
    resourceProfiles: { mana: { needId: 'mana', direction: 'decrease', referenceCapacity: 1000, baseCost: 100, denominatorConstant: 1, skillEfficiency: 0.05, levelEfficiency: 0.02 } },
    improvementSteps: { efficiency: { kind: 'efficiency', multiplier: 0.9 }, power: { kind: 'power', amount: 2 } },
    status: { standard: { fixedMagnitude: 1, percentMagnitude: 5, durationMinutes: 3 } },
    statusImprovementSteps: { statusPower: { kind: 'statusPower', fixedAmount: 1, percentAmount: 5 } }
};
function validatePolicy(raw) {
    keys(raw, ['version', 'healing', 'damage', 'resourceProfiles', 'improvementSteps', 'status', 'statusImprovementSteps', 'referenceBaseWeaponDamage'], 'techniques.balance');
    if (raw.version !== 1) throw new Error('techniques.balance.version must be 1.');
    keys(raw.healing, ['standard'], 'techniques.balance.healing');
    const heal = raw.healing.standard;
    keys(heal, ['referenceSource', 'referenceMultiplier', 'levelCoefficient', 'skillCoefficient', 'attributeCoefficient'], 'techniques.balance.healing.standard');
    if (heal.referenceSource !== 'baseWeaponDamage') throw new Error('healing.standard.referenceSource must be baseWeaponDamage.');
    for (const key of ['referenceMultiplier', 'levelCoefficient', 'skillCoefficient', 'attributeCoefficient']) numeric(heal[key], `healing.standard.${key}`);
    if (raw.damage !== undefined) {
        keys(raw.damage, ['standard'], 'techniques.balance.damage');
        const damage = raw.damage.standard;
        keys(damage, ['referenceSource', 'referenceMultiplier', 'levelCoefficient', 'skillCoefficient', 'attributeCoefficient'], 'techniques.balance.damage.standard');
        if (damage.referenceSource !== 'baseWeaponDamage') throw new Error('damage.standard.referenceSource must be baseWeaponDamage.');
        for (const key of ['referenceMultiplier', 'levelCoefficient', 'skillCoefficient', 'attributeCoefficient']) numeric(damage[key], `damage.standard.${key}`);
    }
    keys(raw.resourceProfiles, Object.keys(raw.resourceProfiles ?? {}), 'techniques.balance.resourceProfiles');
    for (const [id, profile] of Object.entries(raw.resourceProfiles)) {
        text(id, 'resource profile ID');
        keys(profile, ['needId', 'direction', 'referenceCapacity', 'baseCost', 'denominatorConstant', 'skillEfficiency', 'levelEfficiency'], `resourceProfiles.${id}`);
        text(profile.needId, `resourceProfiles.${id}.needId`);
        if (!['decrease', 'increase'].includes(profile.direction)) throw new Error(`resourceProfiles.${id}.direction must be decrease or increase.`);
        for (const field of ['referenceCapacity', 'baseCost', 'denominatorConstant']) numeric(profile[field], `resourceProfiles.${id}.${field}`, 0, true);
        for (const field of ['skillEfficiency', 'levelEfficiency']) numeric(profile[field], `resourceProfiles.${id}.${field}`);
    }
    keys(raw.improvementSteps, Object.keys(raw.improvementSteps ?? {}), 'techniques.balance.improvementSteps');
    for (const [id, step] of Object.entries(raw.improvementSteps)) {
        text(id, 'improvement step ID');
        keys(step, step.kind === 'efficiency' ? ['kind', 'multiplier'] : ['kind', 'amount'], `improvementSteps.${id}`);
        if (step.kind === 'efficiency') {
            numeric(step.multiplier, `improvementSteps.${id}.multiplier`, 0, true);
            if (step.multiplier >= 1) throw new Error(`improvementSteps.${id}.multiplier must be < 1.`);
        } else if (step.kind === 'power') numeric(step.amount, `improvementSteps.${id}.amount`, 0, true);
        else throw new Error(`improvementSteps.${id}.kind is unsupported.`);
    }
    if (raw.status !== undefined) {
        keys(raw.status, ['standard'], 'techniques.balance.status');
        keys(raw.status.standard, ['fixedMagnitude', 'percentMagnitude', 'durationMinutes'], 'techniques.balance.status.standard');
        for (const field of ['fixedMagnitude', 'percentMagnitude']) numeric(raw.status.standard[field], `status.standard.${field}`, 0, true);
        const duration = numeric(raw.status.standard.durationMinutes, 'status.standard.durationMinutes', 0, true);
        if (!Number.isInteger(duration)) throw new Error('status.standard.durationMinutes must be an integer number of world minutes.');
    }
    if (raw.statusImprovementSteps !== undefined) {
        if (!raw.statusImprovementSteps || typeof raw.statusImprovementSteps !== 'object' || Array.isArray(raw.statusImprovementSteps)) throw new Error('techniques.balance.statusImprovementSteps must be an object.');
        keys(raw.statusImprovementSteps, Object.keys(raw.statusImprovementSteps), 'techniques.balance.statusImprovementSteps');
        for (const [id, step] of Object.entries(raw.statusImprovementSteps)) {
            text(id, 'status improvement step ID');
            keys(step, ['kind', 'fixedAmount', 'percentAmount'], `statusImprovementSteps.${id}`);
            if (step.kind !== 'statusPower') throw new Error(`statusImprovementSteps.${id}.kind must be statusPower.`);
            numeric(step.fixedAmount, `statusImprovementSteps.${id}.fixedAmount`, 0, true);
            numeric(step.percentAmount, `statusImprovementSteps.${id}.percentAmount`, 0, true);
            if (Object.hasOwn(raw.improvementSteps, id)) throw new Error(`statusImprovementSteps.${id} conflicts with an improvementSteps ID. Use a distinct step ID.`);
        }
    }
    if (raw.referenceBaseWeaponDamage !== undefined) numeric(raw.referenceBaseWeaponDamage, 'referenceBaseWeaponDamage');
    return clone(raw);
}
function resolvePolicy(config = require('./Globals.js').config ?? {}) {
    const raw = config.techniques?.balance === undefined ? DEFAULT_POLICY : config.techniques.balance;
    if (Object.hasOwn(raw, 'referenceBaseWeaponDamage')) throw new Error('techniques.balance.referenceBaseWeaponDamage is derived from baseWeaponDamage and cannot be configured directly.');
    const policy = validatePolicy(raw);
    policy.damage ??= clone(DEFAULT_POLICY.damage);
    policy.status ??= clone(DEFAULT_POLICY.status);
    policy.statusImprovementSteps ??= clone(DEFAULT_POLICY.statusImprovementSteps);
    policy.referenceBaseWeaponDamage = numeric(config.baseWeaponDamage === undefined ? 5 : config.baseWeaponDamage, 'baseWeaponDamage');
    return policy;
}
function validateRecipeProposal(proposal) {
    if (Array.isArray(proposal?.components)) return validateComponentsProposal(proposal, true);
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) keys(proposal, [], 'recipe');
    const issues = new ValidationIssueCollector();
    issues.capture(() => keys(proposal, ['recipeId', 'skillName', 'attributeName', 'resourceProfileId', 'effectId'], 'recipe'));
    if (!['standard-healing', 'standard-damage'].includes(proposal.recipeId)) issues.add(new Error(`recipe.recipeId ${proposal.recipeId} is unsupported. Use standard-healing or standard-damage (or semantic kind healing/damage in an authoring proposal).`));
    for (const key of ['skillName', 'attributeName', 'resourceProfileId']) issues.capture(() => text(proposal[key], `recipe.${key}`));
    if (proposal.effectId !== undefined) issues.capture(() => text(proposal.effectId, 'recipe.effectId'));
    issues.throwIfAny();
    return clone(proposal);
}
function validateAuthoringRecipeProposal(proposal) {
    if (Array.isArray(proposal?.components) || ['buff', 'debuff', 'standard-buff', 'standard-debuff'].includes(proposal?.kind) || ['standard-buff', 'standard-debuff'].includes(proposal?.recipeId)) return validateComponentsProposal(proposal, false);
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) keys(proposal, [], 'recipe');
    const issues = new ValidationIssueCollector();
    issues.capture(() => keys(proposal, ['kind', 'recipeId', 'skillName', 'attributeName', 'resourceProfileId', 'effectId'], 'recipe'));
    const idKind = { 'standard-healing': 'healing', 'standard-damage': 'damage' }[proposal.recipeId];
    if (proposal.recipeId !== undefined && !idKind) issues.add(new Error(`recipe.recipeId ${proposal.recipeId} is unsupported. Use standard-healing or standard-damage (or semantic kind healing/damage in an authoring proposal).`));
    const kind = proposal.kind ?? idKind;
    if (!['healing', 'damage'].includes(kind)) issues.add(new Error('recipe.kind must be healing or damage. Supply one of these kinds, or its matching recipeId standard-healing/standard-damage.'));
    else if (idKind && kind !== idKind) issues.add(new Error('recipe.kind conflicts with recipe.recipeId. Match healing with standard-healing or damage with standard-damage, or omit recipeId for semantic authoring.'));
    for (const field of ['skillName', 'attributeName', 'resourceProfileId', 'effectId']) if (proposal[field] !== undefined) issues.capture(() => text(proposal[field], `recipe.${field}`));
    issues.throwIfAny();
    return { ...clone(proposal), kind };
}
function resolveAuthoringRecipeProposal(proposal, { actor, policy = resolvePolicy() }) {
    if (Array.isArray(proposal?.components) || ['buff', 'debuff', 'standard-buff', 'standard-debuff'].includes(proposal?.kind) || ['standard-buff', 'standard-debuff'].includes(proposal?.recipeId)) return resolveComponentsProposal(proposal, { actor, policy });
    const issues = new ValidationIssueCollector();
    const normalized = issues.capture(() => validateAuthoringRecipeProposal(proposal));
    // A malformed object has no readable selectors. Invalid fields in an object
    // do not prevent independent actor selections from being checked.
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) issues.throwIfAny();
    const context = getAuthoringContext({ actor, policy });
    const select = (field, options) => {
        if (proposal[field] !== undefined) {
            // The structural validator already reports invalid text values.
            if (typeof proposal[field] !== 'string' || !proposal[field].trim()) return undefined;
            const value = proposal[field].trim();
            if (field === 'resourceProfileId') {
                const profile = policy.resourceProfiles[value];
                if (!profile) throw new Error(`recipe.resourceProfileId ${value} is unsupported. Select an applicable profile from balanceAuthoring.resourceProfiles; configured IDs are ${Object.keys(policy.resourceProfiles).join(', ') || 'none'}.`);
                bindResource(profile, actor, value);
            } else {
                const kind = field === 'skillName' ? 'skill' : 'attribute';
                if (options.filter(option => option.toLowerCase() === value.toLowerCase()).length !== 1) throw new Error(`recipe.${kind}Name: actor has no unambiguous actual ${kind} ${value}. Select an actual unambiguous ${kind}: ${options.join(', ') || 'none available'}.`);
            }
            return value;
        }
        if (options.length === 1) return options[0];
        throw new Error(`recipe.${field} requires a selection: ${options.length ? 'multiple eligible choices' : 'no eligible choices'} for ${actor.name}. ${options.length ? `Choose one actual eligible value: ${options.join(', ')}.` : 'This actor cannot use this recipe with the offered facts/resources; do not invent a selector or pool.'}`);
    };
    const result = {
        skillName: issues.capture(() => select('skillName', context.skills.map(row => row.name))),
        attributeName: issues.capture(() => select('attributeName', context.attributes.map(row => row.name))),
        resourceProfileId: issues.capture(() => select('resourceProfileId', context.resourceProfiles.map(row => row.resourceProfileId))),
    };
    issues.throwIfAny();
    return { ...result, recipeId: `standard-${normalized.kind}`, effectId: normalized.effectId ?? (normalized.kind === 'healing' ? 'restore' : 'strike') };
}
function bindResource(profile, actor, id) {
    const bar = actor.getNeedBars({ scope: 'active' }).find(entry => entry.id === profile.needId);
    if (!bar) throw new Error(`Resource profile ${id}: need ${profile.needId} is missing or inactive for ${actor.name}. Choose an applicable offered resource profile; do not invent or activate a pool.`);
    if (bar.paymentDirection && bar.paymentDirection !== profile.direction) throw new Error(`Resource profile ${id}: need ${profile.needId} payment direction conflicts with ${profile.direction}. Choose an offered profile matching the pool payment direction; do not change the pool.`);
    numeric(bar.min, `${profile.needId}.min`, -Infinity); numeric(bar.max, `${profile.needId}.max`, -Infinity);
    if (bar.max - bar.min !== profile.referenceCapacity) throw new Error(`Resource profile ${id}: need ${profile.needId} capacity ${bar.max - bar.min} conflicts with required ${profile.referenceCapacity}. Choose an offered profile compatible with this capacity; do not resize the pool.`);
    return bar;
}
function actorSelections(actor, selections) {
    const facts = Variables.catalog(actor);
    const find = (kind, name) => {
        const rows = facts.filter(row => row.kind === kind && row.name.toLowerCase() === name.toLowerCase());
        if (rows.length !== 1) throw new Error(`recipe.${kind}Name: actor has no unambiguous actual ${kind} ${name}. Select an actual unambiguous ${kind}: ${facts.filter(row => row.kind === kind).map(row => row.name).join(", ") || "none available"}.`);
        return rows[0];
    };
    const issues = new ValidationIssueCollector();
    const skill = issues.capture(() => find('skill', selections.skillName)), attribute = issues.capture(() => find('attribute', selections.attributeName));
    issues.capture(() => numeric(actor.level, 'recipe actor level'));
    if (skill) issues.capture(() => numeric(skill.value, 'recipe skill rank'));
    issues.throwIfAny();
    return { skill, attribute };
}
function snapshotFor(policy, profileId, kind = 'healing') {
    validatePolicy(policy);
    const profile = policy.resourceProfiles[profileId];
    if (!profile) throw new Error(`recipe.resourceProfileId ${profileId} is unsupported. Select an applicable profile from balanceAuthoring.resourceProfiles; configured IDs are ${Object.keys(policy.resourceProfiles).join(", ") || "none"}.`);
    return { version: policy.version, [kind]: clone(kind === 'healing' ? policy.healing.standard : (policy.damage ?? DEFAULT_POLICY.damage).standard), referenceBaseWeaponDamage: numeric(policy.referenceBaseWeaponDamage, 'referenceBaseWeaponDamage'), resourceProfile: clone(profile), improvementSteps: clone(policy.improvementSteps) };
}
function parametersFor(snapshot, appliedImprovementIds) {
    let baseCost = snapshot.resourceProfile.baseCost, bonus = 0;
    const bonusField = snapshot.damage ? 'damageBonus' : 'healingBonus';
    for (const id of appliedImprovementIds) {
        const step = snapshot.improvementSteps[id];
        if (!step) throw new Error(`balance.parameters.appliedImprovementIds: unknown step ${id}.`);
        if (step.kind === 'efficiency') baseCost *= step.multiplier;
        else bonus += step.amount;
    }
    numeric(baseCost, 'balance.parameters.baseCost', 0, true); numeric(bonus, `balance.parameters.${bonusField}`);
    return { baseCost, [bonusField]: bonus, appliedImprovementIds: [...appliedImprovementIds] };
}
function compiledAmounts(balance) {
    const { snapshot } = balance.policy, { selections, parameters } = balance;
    const kind = balance.recipeId === 'standard-damage' ? 'damage' : 'healing';
    const coefficients = snapshot[kind], profile = snapshot.resourceProfile;
    const skill = Variables.keyFor({ kind: 'skill', name: selections.skillName });
    const attribute = Variables.keyFor({ kind: 'attribute', name: selections.attributeName });
    const constant = coefficients.referenceMultiplier * snapshot.referenceBaseWeaponDamage + parameters[kind === 'healing' ? 'healingBonus' : 'damageBonus'];
    return {
        costs: [{ resource: 'need', needId: selections.needId, direction: profile.direction, amount: { formula: `ceil(${parameters.baseCost} / (${profile.denominatorConstant} + ${profile.skillEfficiency} * ${skill} + ${profile.levelEfficiency} * level))` } }],
        effects: [{ id: selections.effectId, kind, ...(kind === 'damage' ? { damageMode: 'technique' } : {}), amount: { formula: `round(${constant} + ${coefficients.levelCoefficient} * level + ${coefficients.skillCoefficient} * ${skill} + ${coefficients.attributeCoefficient} * ${attribute})` } }]
    };
}
function compileRecipe({ proposal, actor, policy = resolvePolicy(), revision = {} }, kind) {
    validateRecipeProposal(proposal);
    if (proposal.recipeId !== `standard-${kind}`) throw new Error(`Expected standard-${kind} recipe.`);
    const issues = new ValidationIssueCollector();
    if (kind === 'damage' && (!revision.target || !revision.check)) issues.add(new Error('standard-damage requires explicit target and nonautomatic check choices. Supply target.kind self/single and check.kind attack, skill or opposed with its required fields.'));
    const selected = issues.capture(() => actorSelections(actor, proposal));
    const snapshot = issues.capture(() => snapshotFor(policy, proposal.resourceProfileId, kind));
    if (snapshot) issues.capture(() => bindResource(snapshot.resourceProfile, actor, proposal.resourceProfileId));
    issues.throwIfAny();
    const balance = {
        schemaVersion: 1, recipeId: `standard-${kind}`,
        policy: { version: snapshot.version, digest: digest(snapshot), snapshot },
        selections: { skillName: selected.skill.name, attributeName: selected.attribute.name, resourceProfileId: proposal.resourceProfileId, needId: snapshot.resourceProfile.needId, effectId: proposal.effectId ?? (kind === 'healing' ? 'restore' : 'strike') },
        parameters: parametersFor(snapshot, [])
    };
    const result = { revision: 1, acquisitionRequirements: [], useRequirements: [], target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' }, ...clone(revision), ...compiledAmounts(balance), balance };
    delete result.recipe;
    validateManagedRevision(result, actor);
    return result;
}
function compileHealingRecipe(options) { return compileRecipe(options, 'healing'); }
function compileDamageRecipe(options) { return compileRecipe(options, 'damage'); }
function validateManagedRevision(revision, actor) {
    if (revision.balance === undefined) return true;
    if (revision.balance?.schemaVersion === 2) return validateComponentsRevision(revision, actor);
    const balance = revision.balance;
    keys(balance, ['schemaVersion', 'recipeId', 'policy', 'selections', 'parameters'], 'balance');
    if (balance.schemaVersion !== 1 || !['standard-healing', 'standard-damage'].includes(balance.recipeId)) throw new Error('Unsupported balance schemaVersion/recipeId. For a new automatic technique, propose recipe kind healing/damage without copied balance metadata.');
    keys(balance.policy, ['version', 'digest', 'snapshot'], 'balance.policy');
    const snapshot = balance.policy.snapshot;
    const kind = balance.recipeId === 'standard-damage' ? 'damage' : 'healing';
    keys(snapshot, ['version', kind, 'referenceBaseWeaponDamage', 'resourceProfile', 'improvementSteps'], 'balance.policy.snapshot');
    numeric(snapshot.referenceBaseWeaponDamage, 'balance.policy.snapshot.referenceBaseWeaponDamage');
    validatePolicy({ version: snapshot.version, healing: { standard: snapshot.healing ?? DEFAULT_POLICY.healing.standard }, ...(kind === 'damage' ? { damage: { standard: snapshot.damage } } : {}), resourceProfiles: { selected: snapshot.resourceProfile }, improvementSteps: snapshot.improvementSteps, referenceBaseWeaponDamage: snapshot.referenceBaseWeaponDamage });
    if (balance.policy.version !== snapshot.version || balance.policy.digest !== digest(snapshot)) throw new Error('balance.policy.digest does not match the saved policy snapshot. For a new automatic technique, omit balance and propose recipe selectors for engine compilation.');
    keys(balance.selections, ['skillName', 'attributeName', 'resourceProfileId', 'needId', 'effectId'], 'balance.selections');
    for (const field of ['skillName', 'attributeName', 'resourceProfileId', 'needId', 'effectId']) text(balance.selections[field], `balance.selections.${field}`);
    if (balance.selections.needId !== snapshot.resourceProfile.needId) throw new Error('balance.selections.needId conflicts with saved resource profile. Retain the profile need ID; for new authoring omit balance and use recipe selectors.');
    keys(balance.parameters, ['baseCost', kind === 'healing' ? 'healingBonus' : 'damageBonus', 'appliedImprovementIds'], 'balance.parameters');
    if (!Array.isArray(balance.parameters.appliedImprovementIds) || balance.parameters.appliedImprovementIds.some(id => typeof id !== 'string')) throw new Error('balance.parameters.appliedImprovementIds must be an array of step IDs.');
    if (!same(parametersFor(snapshot, balance.parameters.appliedImprovementIds), balance.parameters)) throw new Error('balance.parameters differ from their configured improvement steps. Do not hand-edit managed amounts; new authoring uses recipe selectors without balance metadata.');
    if (revision.target?.allowDead === true) throw new Error(`Managed ${kind} target.allowDead is unsupported. Omit it or set false; these recipes do not support resurrection.`);
    if (!['self', 'single'].includes(revision.target?.kind)) throw new Error(`Managed ${kind} target.kind supports only self or single. Choose self or single for this recipe; area healing is unsupported, while deliberate custom nonhealing mechanics may use area.`);
    if (revision.failureCosts !== undefined) throw new Error(`Managed ${kind} failureCosts must be omitted; explicit failure vectors are unsupported. Remove failureCosts to use the recipe failure cost policy.`);
    if (kind === 'damage' && require('./Technique.js').normalizeCheck(revision.check).kind === 'automatic') throw new Error('standard-damage requires a nonautomatic revision.check. Use attack, skill or opposed with its required fields; standard damage does not use automatic checks.');
    const compiled = compiledAmounts(balance);
    if (!same(revision.costs, compiled.costs)) throw new Error(`Managed ${kind} costs differ from the canonical saved recipe. For new authoring omit costs, effects and balance and supply recipe selectors so the engine compiles them.`);
    if (!same(revision.effects, compiled.effects)) throw new Error(`Managed ${kind} effects differ from the canonical saved recipe; additional or altered effects are unsupported. For new authoring omit costs, effects and balance and supply recipe selectors.`);
    if (actor) {
        const selected = actorSelections(actor, balance.selections);
        const denominator = snapshot.resourceProfile.denominatorConstant + snapshot.resourceProfile.skillEfficiency * selected.skill.value + snapshot.resourceProfile.levelEfficiency * actor.level;
        numeric(denominator, 'Managed resource denominator', 0, true);
        bindResource(snapshot.resourceProfile, actor, balance.selections.resourceProfileId);
        for (const [label, amount] of [['cost', compiled.costs[0].amount], [kind, compiled.effects[0].amount]]) {
            const value = Evaluator.compile(amount.formula)(Variables.resolve(amount.formula, actor));
            numeric(value, `Managed ${label} amount`);
        }
    }
    return true;
}

const COMPONENT_KINDS = ['healing', 'damage', 'buff', 'debuff'];
const COMPONENT_FIELDS = ['kind', 'skillName', 'attributeName', 'resourceProfileId', 'effectId', 'statusStatKind', 'statusStatName', 'statusModifierKind', 'statusName', 'statusDescription'];
const componentKind = component => component.kind ?? ({ 'standard-healing': 'healing', 'standard-damage': 'damage', 'standard-buff': 'buff', 'standard-debuff': 'debuff' }[component.recipeId]);
function validateComponentsProposal(proposal, canonical = false) {
    keys(proposal, Array.isArray(proposal?.components) ? ['components', 'recipeId'] : [...COMPONENT_FIELDS, 'recipeId'], 'recipe');
    if (canonical && proposal.recipeId !== 'standard-components') throw new Error('recipe.recipeId must be standard-components for a compiled component recipe.');
    if (proposal.recipeId !== undefined && proposal.recipeId !== 'standard-components' && !(!Array.isArray(proposal.components) && proposal.recipeId === `standard-${componentKind(proposal)}`)) throw new Error('recipe.recipeId must match standard-components or the selected single kind.');
    const entries = Array.isArray(proposal.components) ? proposal.components : [proposal];
    if (!entries.length) throw new Error('recipe.components must contain at least one component. Supply healing, damage, buff or debuff choices.');
    const issues = new ValidationIssueCollector();
    entries.forEach((component, index) => issues.capture(() => {
        const at = `recipe.components[${index}]`;
        keys(component, COMPONENT_FIELDS.concat(Array.isArray(proposal.components) ? [] : ['recipeId']), at);
        const kind = componentKind(component);
        if (!COMPONENT_KINDS.includes(kind)) throw new Error(`${at}.kind must be healing, damage, buff or debuff.`);
        for (const field of ['skillName', 'resourceProfileId', 'effectId']) if (canonical || component[field] !== undefined) text(component[field], `${at}.${field}`);
        if (['healing', 'damage'].includes(kind)) {
            if (canonical || component.attributeName !== undefined) text(component.attributeName, `${at}.attributeName`);
            for (const field of ['statusStatKind', 'statusStatName', 'statusModifierKind', 'statusName', 'statusDescription']) if (component[field] !== undefined) throw new Error(`${at}.${field} belongs only to a buff/debuff component. Remove it.`);
        } else {
            if (component.attributeName !== undefined) throw new Error(`${at}.attributeName is not used by status potency. Remove it and select statusStatName for the affected stat.`);
            for (const field of ['statusStatKind', 'statusStatName', 'statusModifierKind', 'statusName', 'statusDescription']) if (canonical || component[field] !== undefined) text(component[field], `${at}.${field}`);
            if (component.statusStatKind !== undefined && !['skill', 'attribute'].includes(component.statusStatKind)) throw new Error(`${at}.statusStatKind must be skill or attribute.`);
            if (component.statusModifierKind !== undefined && !['fixed', 'percent'].includes(component.statusModifierKind)) throw new Error(`${at}.statusModifierKind must be fixed or percent.`);
            for (const field of ['statusModifierKind', 'statusName', 'statusDescription']) if (component[field] === undefined) throw new Error(`${at}.${field} is required for a status recipe. Choose fixed or percent and give the status a name and description.`);
        }
    }));
    issues.throwIfAny();
    return clone(proposal);
}
function resolveComponentsProposal(proposal, { actor, policy = resolvePolicy() }) {
    validateComponentsProposal(proposal);
    const context = getAuthoringContext({ actor, policy });
    const entries = Array.isArray(proposal.components) ? proposal.components : [proposal];
    const select = (value, options, path) => {
        if (value !== undefined) {
            const matches = options.filter(option => option.toLowerCase() === value.toLowerCase());
            if (matches.length !== 1) throw new Error(`${path}: ${value} is not an unambiguous actual actor selection. Choose ${options.join(', ') || 'none available'}.`);
            return matches[0];
        }
        if (options.length === 1) return options[0];
        throw new Error(`${path} requires a selection: ${options.length ? `choose one of ${options.join(', ')}` : 'no eligible actor choice exists'}.`);
    };
    const issues = new ValidationIssueCollector(), ids = new Set();
    const components = entries.map((entry, index) => issues.capture(() => {
        const at = `recipe.components[${index}]`;
        const kind = componentKind(entry);
        if (entry.resourceProfileId !== undefined) {
            const configured = policy.resourceProfiles[entry.resourceProfileId];
            if (!configured) throw new Error(`${at}.resourceProfileId ${entry.resourceProfileId} is not configured. Choose an applicable profile: ${context.resourceProfiles.map(row => row.resourceProfileId).join(', ') || 'none available'}.`);
            bindResource(configured, actor, entry.resourceProfileId);
        }
        const profileId = select(entry.resourceProfileId, context.resourceProfiles.map(row => row.resourceProfileId), `${at}.resourceProfileId`);
        const skillName = select(entry.skillName, context.skills.map(row => row.name), `${at}.skillName`);
        const effectId = entry.effectId ?? (entries.length === 1 ? ({ healing: 'restore', damage: 'strike', buff: 'buff', debuff: 'debuff' }[kind]) : `${kind}_${index + 1}`);
        if (ids.has(effectId)) throw new Error(`${at}.effectId ${effectId} duplicates another component. Supply distinct stable effect IDs.`);
        ids.add(effectId);
        const resolved = { kind, skillName, resourceProfileId: profileId, effectId };
        if (['healing', 'damage'].includes(kind)) resolved.attributeName = select(entry.attributeName, context.attributes.map(row => row.name), `${at}.attributeName`);
        else {
            const kinds = ['skill', 'attribute'].filter(kind => context[`${kind}s`].length);
            resolved.statusStatKind = select(entry.statusStatKind, kinds, `${at}.statusStatKind`);
            resolved.statusStatName = select(entry.statusStatName, context[`${resolved.statusStatKind}s`].map(row => row.name), `${at}.statusStatName`);
            resolved.statusModifierKind = entry.statusModifierKind;
            resolved.statusName = entry.statusName.trim();
            resolved.statusDescription = entry.statusDescription.trim();
        }
        return resolved;
    }));
    issues.throwIfAny();
    return { recipeId: 'standard-components', components };
}
function snapshotForComponents(policy, components) {
    validatePolicy(policy);
    return {
        version: policy.version,
        referenceBaseWeaponDamage: numeric(policy.referenceBaseWeaponDamage, 'referenceBaseWeaponDamage'),
        components: components.map((component, index) => {
            const profile = policy.resourceProfiles[component.resourceProfileId];
            if (!profile) throw new Error(`recipe.components[${index}].resourceProfileId ${component.resourceProfileId} is not configured.`);
            return { kind: component.kind, ...(component.kind === 'healing' || component.kind === 'damage' ? { coefficients: clone((policy[component.kind] ?? DEFAULT_POLICY[component.kind]).standard) } : { status: clone((policy.status ?? DEFAULT_POLICY.status).standard) }), resourceProfile: clone(profile) };
        }),
        improvementSteps: clone(policy.improvementSteps),
        statusImprovementSteps: clone(policy.statusImprovementSteps ?? DEFAULT_POLICY.statusImprovementSteps)
    };
}
function parametersForComponents(snapshot, selections, appliedSteps) {
    const baseCosts = snapshot.components.map(component => component.resourceProfile.baseCost);
    const bonuses = snapshot.components.map(() => 0);
    const normalizedSteps = [];
    for (const [index, applied] of appliedSteps.entries()) {
        keys(applied, ['stepId', 'effectId'], `balance.parameters.appliedSteps[${index}]`);
        const stepId = text(applied.stepId, `balance.parameters.appliedSteps[${index}].stepId`);
        const step = snapshot.improvementSteps[stepId] ?? snapshot.statusImprovementSteps[stepId];
        if (!step) throw new Error(`balance.parameters.appliedSteps[${index}].stepId ${stepId} is not in the saved recipe policy.`);
        const candidates = selections.components.map((selection, i) => ({ selection, i })).filter(({ selection }) => step.kind === 'efficiency' || (step.kind === 'power' ? ['healing', 'damage'].includes(selection.kind) : ['buff', 'debuff'].includes(selection.kind)));
        let target;
        if (applied.effectId !== undefined) target = candidates.find(row => row.selection.effectId === applied.effectId);
        else if (candidates.length === 1) target = candidates[0];
        if (!target) throw new Error(`balance.parameters.appliedSteps[${index}].effectId must select one compatible effect: ${candidates.map(row => row.selection.effectId).join(', ') || 'none'}.`);
        if (step.kind === 'efficiency') baseCosts[target.i] *= step.multiplier;
        else if (step.kind === 'power') bonuses[target.i] += step.amount;
        else bonuses[target.i] += target.selection.statusModifierKind === 'fixed' ? step.fixedAmount : step.percentAmount;
        normalizedSteps.push({ stepId, effectId: target.selection.effectId });
    }
    for (const [index, baseCost] of baseCosts.entries()) numeric(baseCost, `balance.parameters.baseCosts[${index}]`, 0, true);
    for (const [index, bonus] of bonuses.entries()) numeric(bonus, `balance.parameters.bonuses[${index}]`);
    return { baseCosts, bonuses, appliedSteps: normalizedSteps };
}
function compiledComponents(balance) {
    const { snapshot } = balance.policy, { components } = balance.selections, { baseCosts, bonuses } = balance.parameters;
    const costs = [], effects = [];
    components.forEach((selection, index) => {
        const component = snapshot.components[index], profile = component.resourceProfile;
        const skill = Variables.keyFor({ kind: 'skill', name: selection.skillName });
        costs.push({ resource: 'need', needId: selection.needId, direction: profile.direction, amount: { formula: `ceil(${baseCosts[index]} / (${profile.denominatorConstant} + ${profile.skillEfficiency} * ${skill} + ${profile.levelEfficiency} * level))` }, perTarget: true });
        if (['healing', 'damage'].includes(selection.kind)) {
            const coefficient = component.coefficients, attribute = Variables.keyFor({ kind: 'attribute', name: selection.attributeName });
            const constant = coefficient.referenceMultiplier * snapshot.referenceBaseWeaponDamage + bonuses[index];
            effects.push({ id: selection.effectId, kind: selection.kind, ...(selection.kind === 'damage' ? { damageMode: 'technique' } : {}), amount: { formula: `round(${constant} + ${coefficient.levelCoefficient} * level + ${coefficient.skillCoefficient} * ${skill} + ${coefficient.attributeCoefficient} * ${attribute})` } });
        } else {
            const sign = selection.kind === 'buff' ? 1 : -1;
            const baseline = selection.statusModifierKind === 'fixed' ? component.status.fixedMagnitude : component.status.percentMagnitude;
            const magnitude = sign * (baseline + bonuses[index]);
            const entry = { [selection.statusStatKind]: selection.statusStatName, [selection.statusModifierKind === 'fixed' ? 'modifier' : 'percentModifier']: magnitude };
            const status = { name: selection.statusName, description: selection.statusDescription, duration: component.status.durationMinutes, attributes: selection.statusStatKind === 'attribute' ? [entry] : [], skills: selection.statusStatKind === 'skill' ? [entry] : [], needBars: [], techniqueGrants: [] };
            effects.push({ id: selection.effectId, kind: selection.kind, status, stacking: 'refresh', refreshPolicy: 'stronger' });
        }
    });
    return { costs, effects };
}
function compileComponentsRecipe({ proposal, actor, policy = resolvePolicy(), revision = {} }) {
    const resolved = resolveComponentsProposal(proposal, { actor, policy });
    if (resolved.components.some(component => ['damage', 'debuff'].includes(component.kind)) && (!revision.check || revision.check.kind === 'automatic')) throw new Error('recipe components with damage or debuff require a nonautomatic revision.check with the required attack, skill or opposed fields.');
    const snapshot = snapshotForComponents(policy, resolved.components);
    resolved.components.forEach((component, index) => bindResource(snapshot.components[index].resourceProfile, actor, component.resourceProfileId));
    const selections = { components: resolved.components.map((component, index) => ({ ...component, needId: snapshot.components[index].resourceProfile.needId })) };
    const balance = { schemaVersion: 2, recipeId: 'standard-components', policy: { version: snapshot.version, digest: digest(snapshot), snapshot }, selections, parameters: parametersForComponents(snapshot, selections, []) };
    const result = { revision: 1, acquisitionRequirements: [], useRequirements: [], target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' }, ...clone(revision), ...compiledComponents(balance), balance };
    delete result.recipe;
    validateComponentsRevision(result, actor);
    return result;
}
function validateComponentsRevision(revision, actor) {
    const balance = revision.balance;
    keys(balance, ['schemaVersion', 'recipeId', 'policy', 'selections', 'parameters'], 'balance');
    if (balance.schemaVersion !== 2 || balance.recipeId !== 'standard-components') throw new Error('balance.schemaVersion/recipeId must be 2/standard-components.');
    keys(balance.policy, ['version', 'digest', 'snapshot'], 'balance.policy');
    const snapshot = balance.policy.snapshot;
    keys(snapshot, ['version', 'referenceBaseWeaponDamage', 'components', 'improvementSteps', 'statusImprovementSteps'], 'balance.policy.snapshot');
    if (snapshot.statusImprovementSteps === undefined) throw new Error('balance.policy.snapshot.statusImprovementSteps is required for a version 2 recipe. Retain the saved status improvement rules.');
    numeric(snapshot.referenceBaseWeaponDamage, 'balance.policy.snapshot.referenceBaseWeaponDamage');
    if (!Array.isArray(snapshot.components) || !snapshot.components.length) throw new Error('balance.policy.snapshot.components must contain at least one component.');
    snapshot.components.forEach((component, index) => {
        keys(component, ['kind', 'coefficients', 'status', 'resourceProfile'], `balance.policy.snapshot.components[${index}]`);
        if (!COMPONENT_KINDS.includes(component.kind)) throw new Error(`balance.policy.snapshot.components[${index}].kind is unsupported.`);
        if (['healing', 'damage'].includes(component.kind)) {
            if (component.status !== undefined) throw new Error(`balance.policy.snapshot.components[${index}].status belongs only to status recipes.`);
            const expected = { version: snapshot.version, healing: { standard: component.kind === 'healing' ? component.coefficients : DEFAULT_POLICY.healing.standard }, damage: { standard: component.kind === 'damage' ? component.coefficients : DEFAULT_POLICY.damage.standard }, resourceProfiles: { selected: component.resourceProfile }, improvementSteps: snapshot.improvementSteps, statusImprovementSteps: snapshot.statusImprovementSteps };
            validatePolicy(expected);
        } else {
            if (component.coefficients !== undefined) throw new Error(`balance.policy.snapshot.components[${index}].coefficients belongs only to healing/damage recipes.`);
            validatePolicy({ version: snapshot.version, healing: DEFAULT_POLICY.healing, damage: DEFAULT_POLICY.damage, status: { standard: component.status }, resourceProfiles: { selected: component.resourceProfile }, improvementSteps: snapshot.improvementSteps, statusImprovementSteps: snapshot.statusImprovementSteps });
        }
    });
    if (balance.policy.version !== snapshot.version || balance.policy.digest !== digest(snapshot)) throw new Error('balance.policy.digest does not match saved component policy snapshot.');
    keys(balance.selections, ['components'], 'balance.selections');
    if (!Array.isArray(balance.selections.components) || balance.selections.components.length !== snapshot.components.length) throw new Error('balance.selections.components must match the snapshot component count.');
    const ids = new Set();
    balance.selections.components.forEach((selection, index) => {
        keys(selection, [...COMPONENT_FIELDS, 'needId'], `balance.selections.components[${index}]`);
        if (selection.kind !== snapshot.components[index].kind) throw new Error(`balance.selections.components[${index}].kind conflicts with snapshot.`);
        validateComponentsProposal({ recipeId: 'standard-components', components: [Object.fromEntries(Object.entries(selection).filter(([key]) => key !== 'needId'))] }, true);
        text(selection.needId, `balance.selections.components[${index}].needId`);
        if (selection.needId !== snapshot.components[index].resourceProfile.needId) throw new Error(`balance.selections.components[${index}].needId conflicts with saved profile.`);
        if (ids.has(selection.effectId)) throw new Error(`balance.selections.components[${index}].effectId duplicates ${selection.effectId}.`);
        ids.add(selection.effectId);
    });
    keys(balance.parameters, ['baseCosts', 'bonuses', 'appliedSteps'], 'balance.parameters');
    if (!Array.isArray(balance.parameters.appliedSteps)) throw new Error('balance.parameters.appliedSteps must be an array.');
    if (!same(parametersForComponents(snapshot, balance.selections, balance.parameters.appliedSteps), balance.parameters)) throw new Error('balance.parameters differ from saved configured component improvement steps.');
    if (!['self', 'single', 'area'].includes(revision.target?.kind) || revision.target.allowDead === true) throw new Error('Managed component target.kind must be self, single or area with allowDead false.');
    if (revision.failureCosts !== undefined) throw new Error('Managed component failureCosts must be omitted; misses pay the same full cost.');
    if (balance.selections.components.some(component => ['damage', 'debuff'].includes(component.kind)) && require('./Technique.js').normalizeCheck(revision.check).kind === 'automatic') throw new Error('Managed damage/debuff components require a nonautomatic revision.check.');
    const compiled = compiledComponents(balance);
    if (!same(revision.costs, compiled.costs)) throw new Error('Managed component costs differ from saved canonical recipe, including perTarget pricing.');
    if (!same(revision.effects, compiled.effects)) throw new Error('Managed component effects differ from saved canonical recipe.');
    if (actor) {
        balance.selections.components.forEach((selection, index) => {
            const facts = Variables.catalog(actor);
            const skill = facts.filter(row => row.kind === 'skill' && row.name.toLowerCase() === selection.skillName.toLowerCase());
            if (skill.length !== 1) throw new Error(`balance.selections.components[${index}].skillName is not an unambiguous actor skill.`);
            numeric(actor.level, 'recipe actor level'); numeric(skill[0].value, `balance.selections.components[${index}].skill rank`);
            if (['healing', 'damage'].includes(selection.kind)) actorSelections(actor, selection);
            else if (facts.filter(row => row.kind === selection.statusStatKind && row.name.toLowerCase() === selection.statusStatName.toLowerCase()).length !== 1) throw new Error(`balance.selections.components[${index}].statusStatName is not an unambiguous actor fact.`);
            const profile = snapshot.components[index].resourceProfile;
            numeric(profile.denominatorConstant + profile.skillEfficiency * skill[0].value + profile.levelEfficiency * actor.level, `Managed component ${index} resource denominator`, 0, true);
            bindResource(profile, actor, selection.resourceProfileId);
            const value = Evaluator.compile(compiled.costs[index].amount.formula)(Variables.resolve(compiled.costs[index].amount.formula, actor));
            numeric(value, `Managed component ${index} cost`);
            if (compiled.effects[index].amount) numeric(Evaluator.compile(compiled.effects[index].amount.formula)(Variables.resolve(compiled.effects[index].amount.formula, actor)), `Managed component ${index} amount`);
        });
    }
    return true;
}
function materializeRevision(raw, { actor, origin = 'automatic', config, policy } = {}) {
    if (!['automatic', 'editor'].includes(origin)) throw new Error(`Unsupported technique authoring origin ${origin}.`);
    if (raw.recipe !== undefined) {
        if (raw.balance !== undefined || raw.costs !== undefined || raw.effects !== undefined || raw.failureCosts !== undefined) throw new Error('recipe proposals must omit numeric costs/effects, balance and failureCosts. Remove these fields; the engine supplies canonical mechanics from the recipe selectors.');
        const selectedPolicy = policy ?? resolvePolicy(config);
        if (Array.isArray(raw.recipe?.components) || ['buff', 'debuff'].includes(raw.recipe?.kind) || ['standard-buff', 'standard-debuff', 'standard-components'].includes(raw.recipe?.recipeId) || raw.target?.kind === 'area') return compileComponentsRecipe({ proposal: raw.recipe, actor, policy: selectedPolicy, revision: raw });
        const proposal = resolveAuthoringRecipeProposal(raw.recipe, { actor, policy: selectedPolicy });
        const kind = proposal.recipeId === 'standard-damage' ? 'damage' : 'healing';
        return compileRecipe({ proposal, actor, policy: selectedPolicy, revision: raw }, kind);
    }
    const result = clone(raw);
    if (result.balance !== undefined) {
        validateManagedRevision(result, actor);
        if (origin === 'automatic') {
            const selectedPolicy = policy ?? resolvePolicy(config);
            const current = result.balance.schemaVersion === 2 ? snapshotForComponents(selectedPolicy, result.balance.selections.components) : snapshotFor(selectedPolicy, result.balance.selections.resourceProfileId, result.balance.recipeId === 'standard-damage' ? 'damage' : 'healing');
            const applied = result.balance.schemaVersion === 2 ? result.balance.parameters.appliedSteps : result.balance.parameters.appliedImprovementIds;
            if (!same(current, result.balance.policy.snapshot) || applied.length) throw new Error('Automatic new managed techniques must use the current policy and unimproved recipe parameters. Propose recipe selectors without copied balance metadata or pre-applied improvements.');
        }
    }
    else if (origin !== 'editor' && result.effects?.some(effect => effect.kind === 'healing')) throw new Error('Automatic healing requires a managed recipe. Use recipe kind healing or recipe.components with applicable selectors and omit costs, failureCosts, effects and balance.');
    return result;
}
function materializeDefinition(raw, options) {
    const result = raw?.toJSON ? raw.toJSON() : clone(raw);
    if ((options?.origin ?? 'automatic') === 'automatic' && result.provenance?.kind === 'editor') throw new Error('Automatic technique authoring cannot claim editor provenance.');
    if (!Array.isArray(result.revisions)) throw new Error('technique.revisions must be an array.');
    result.revisions = result.revisions.map(revision => materializeRevision(revision, options));
    return result;
}
function compilePersonalImprovement({ learned, proposal, actor }) {
    keys(proposal, ['stepId', 'effectId', 'reason'], 'improvement');
    const id = text(proposal.stepId, 'improvement.stepId');
    if (proposal.reason !== undefined) text(proposal.reason, 'improvement.reason');
    const previous = learned.mechanics ?? learned;
    validateManagedRevision(previous, actor);
    if (!previous.balance) throw new Error('A configured improvement requires an existing managed recipe revision.');
    const result = clone(previous);
    result.revision += 1;
    if (result.balance.schemaVersion === 2) {
        result.balance.parameters = parametersForComponents(result.balance.policy.snapshot, result.balance.selections, [...result.balance.parameters.appliedSteps, { stepId: id, ...(proposal.effectId !== undefined ? { effectId: text(proposal.effectId, 'improvement.effectId') } : {}) }]);
        Object.assign(result, compiledComponents(result.balance));
        validateComponentsRevision(result, actor);
        return result;
    }
    if (proposal.effectId !== undefined) throw new Error('improvement.effectId applies only to a component recipe. Omit it for a legacy managed technique.');
    result.balance.parameters = parametersFor(result.balance.policy.snapshot, [...result.balance.parameters.appliedImprovementIds, id]);
    Object.assign(result, compiledAmounts(result.balance));
    validateManagedRevision(result, actor);
    return result;
}
function getAuthoringContext({ actor, policy = resolvePolicy() }) {
    const facts = Variables.catalog(actor);
    const resourceProfiles = [];
    for (const [id, profile] of Object.entries(policy.resourceProfiles)) {
        // Availability is a projection; a selected unavailable profile still fails explicitly in compilation.
        const bar = actor.getNeedBars({ scope: 'active' }).find(entry => entry.id === profile.needId);
        if (!bar || (bar.paymentDirection && bar.paymentDirection !== profile.direction) || bar.max - bar.min !== profile.referenceCapacity) continue;
        resourceProfiles.push({ resourceProfileId: id, needId: profile.needId, direction: profile.direction, capacity: profile.referenceCapacity, baseCost: profile.baseCost });
    }
    const available = resourceProfiles.length && facts.some(row => row.kind === 'skill');
    return { policyVersion: policy.version, policyDigest: digest(policy), recipes: [{ kind: 'healing', recipeId: 'standard-healing', targetKinds: ['self', 'single', 'area'] }, { kind: 'damage', recipeId: 'standard-damage', targetKinds: ['self', 'single', 'area'], customAlternative: true }, { kind: 'buff', recipeId: 'standard-components', targetKinds: ['self', 'single', 'area'], customAlternative: true }, { kind: 'debuff', recipeId: 'standard-components', targetKinds: ['self', 'single', 'area'], customAlternative: true }], mixedRecipeId: 'standard-components', componentCost: 'sum each selected component cost per actual target', availableRecipeKinds: available ? [...(facts.some(row => row.kind === 'attribute') ? ['healing', 'damage'] : []), 'buff', 'debuff'] : [], skills: facts.filter(row => row.kind === 'skill'), attributes: facts.filter(row => row.kind === 'attribute'), resourceProfiles, status: clone(policy.status ?? DEFAULT_POLICY.status), improvementSteps: Object.entries(policy.improvementSteps).map(([stepId, step]) => ({ stepId, ...clone(step) })).concat(Object.entries(policy.statusImprovementSteps ?? DEFAULT_POLICY.statusImprovementSteps).map(([stepId, step]) => ({ stepId, ...clone(step) }))) };
}
module.exports = { DEFAULT_POLICY, resolvePolicy, validatePolicy, compileHealingRecipe, compileDamageRecipe, compileComponentsRecipe, validateAuthoringRecipeProposal, resolveAuthoringRecipeProposal, compilePersonalImprovement, validateManagedRevision, validateRecipeProposal, materializeRevision, materializeDefinition, getAuthoringContext, digest };
