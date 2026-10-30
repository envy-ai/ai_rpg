'use strict';

const crypto = require('node:crypto');
const Variables = require('./public/js/technique-formula-variables.js');
const Evaluator = require('./public/js/formula-evaluator.js');
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function keys(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}.${key} is unsupported.`);
}
function text(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string.`); return value.trim(); }
function numeric(value, label, minimum = 0, positive = false) { if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || (positive && value === 0)) throw new Error(`${label} must be finite and ${positive ? 'positive' : `>= ${minimum}`}.`); return value; }
const DEFAULT_POLICY = {
    version: 1,
    healing: { standard: { referenceSource: 'baseWeaponDamage', referenceMultiplier: 2, levelCoefficient: 3, skillCoefficient: 1, attributeCoefficient: 0.5 } },
    resourceProfiles: { mana: { needId: 'mana', direction: 'decrease', referenceCapacity: 1000, baseCost: 100, denominatorConstant: 1, skillEfficiency: 0.05, levelEfficiency: 0.02 } },
    improvementSteps: { efficiency: { kind: 'efficiency', multiplier: 0.9 }, power: { kind: 'power', amount: 2 } }
};
function validatePolicy(raw) {
    keys(raw, ['version', 'healing', 'resourceProfiles', 'improvementSteps', 'referenceBaseWeaponDamage'], 'techniques.balance');
    if (raw.version !== 1) throw new Error('techniques.balance.version must be 1.');
    keys(raw.healing, ['standard'], 'techniques.balance.healing');
    const heal = raw.healing.standard;
    keys(heal, ['referenceSource', 'referenceMultiplier', 'levelCoefficient', 'skillCoefficient', 'attributeCoefficient'], 'techniques.balance.healing.standard');
    if (heal.referenceSource !== 'baseWeaponDamage') throw new Error('healing.standard.referenceSource must be baseWeaponDamage.');
    for (const key of ['referenceMultiplier', 'levelCoefficient', 'skillCoefficient', 'attributeCoefficient']) numeric(heal[key], `healing.standard.${key}`);
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
    if (raw.referenceBaseWeaponDamage !== undefined) numeric(raw.referenceBaseWeaponDamage, 'referenceBaseWeaponDamage');
    return clone(raw);
}
function resolvePolicy(config = require('./Globals.js').config ?? {}) {
    const raw = config.techniques?.balance === undefined ? DEFAULT_POLICY : config.techniques.balance;
    if (Object.hasOwn(raw, 'referenceBaseWeaponDamage')) throw new Error('techniques.balance.referenceBaseWeaponDamage is derived from baseWeaponDamage and cannot be configured directly.');
    const policy = validatePolicy(raw);
    policy.referenceBaseWeaponDamage = numeric(config.baseWeaponDamage === undefined ? 5 : config.baseWeaponDamage, 'baseWeaponDamage');
    return policy;
}
function validateRecipeProposal(proposal) {
    keys(proposal, ['recipeId', 'skillName', 'attributeName', 'resourceProfileId', 'effectId'], 'recipe');
    if (proposal.recipeId !== 'standard-healing') throw new Error(`recipe.recipeId ${proposal.recipeId} is unsupported.`);
    for (const key of ['skillName', 'attributeName', 'resourceProfileId']) text(proposal[key], `recipe.${key}`);
    if (proposal.effectId !== undefined) text(proposal.effectId, 'recipe.effectId');
    return clone(proposal);
}
function bindResource(profile, actor, id) {
    const bar = actor.getNeedBars({ scope: 'active' }).find(entry => entry.id === profile.needId);
    if (!bar) throw new Error(`Resource profile ${id}: need ${profile.needId} is missing or inactive for ${actor.name}.`);
    if (bar.paymentDirection && bar.paymentDirection !== profile.direction) throw new Error(`Resource profile ${id}: need ${profile.needId} payment direction conflicts with ${profile.direction}.`);
    numeric(bar.min, `${profile.needId}.min`, -Infinity); numeric(bar.max, `${profile.needId}.max`, -Infinity);
    if (bar.max - bar.min !== profile.referenceCapacity) throw new Error(`Resource profile ${id}: need ${profile.needId} capacity ${bar.max - bar.min} conflicts with required ${profile.referenceCapacity}.`);
    return bar;
}
function actorSelections(actor, selections) {
    const facts = Variables.catalog(actor);
    const find = (kind, name) => {
        const rows = facts.filter(row => row.kind === kind && row.name.toLowerCase() === name.toLowerCase());
        if (rows.length !== 1) throw new Error(`recipe.${kind}Name: actor has no unambiguous actual ${kind} ${name}.`);
        return rows[0];
    };
    const skill = find('skill', selections.skillName), attribute = find('attribute', selections.attributeName);
    numeric(actor.level, 'recipe actor level'); numeric(skill.value, 'recipe skill rank');
    return { skill, attribute };
}
function snapshotFor(policy, profileId) {
    validatePolicy(policy);
    const profile = policy.resourceProfiles[profileId];
    if (!profile) throw new Error(`recipe.resourceProfileId ${profileId} is unsupported.`);
    return { version: policy.version, healing: clone(policy.healing.standard), referenceBaseWeaponDamage: numeric(policy.referenceBaseWeaponDamage, 'referenceBaseWeaponDamage'), resourceProfile: clone(profile), improvementSteps: clone(policy.improvementSteps) };
}
function parametersFor(snapshot, appliedImprovementIds) {
    let baseCost = snapshot.resourceProfile.baseCost, healingBonus = 0;
    for (const id of appliedImprovementIds) {
        const step = snapshot.improvementSteps[id];
        if (!step) throw new Error(`balance.parameters.appliedImprovementIds: unknown step ${id}.`);
        if (step.kind === 'efficiency') baseCost *= step.multiplier;
        else healingBonus += step.amount;
    }
    numeric(baseCost, 'balance.parameters.baseCost', 0, true); numeric(healingBonus, 'balance.parameters.healingBonus');
    return { baseCost, healingBonus, appliedImprovementIds: [...appliedImprovementIds] };
}
function compiledAmounts(balance) {
    const { snapshot } = balance.policy, { selections, parameters } = balance;
    const heal = snapshot.healing, profile = snapshot.resourceProfile;
    const skill = Variables.keyFor({ kind: 'skill', name: selections.skillName });
    const attribute = Variables.keyFor({ kind: 'attribute', name: selections.attributeName });
    const constant = heal.referenceMultiplier * snapshot.referenceBaseWeaponDamage + parameters.healingBonus;
    return {
        costs: [{ resource: 'need', needId: selections.needId, direction: profile.direction, amount: { formula: `ceil(${parameters.baseCost} / (${profile.denominatorConstant} + ${profile.skillEfficiency} * ${skill} + ${profile.levelEfficiency} * level))` } }],
        effects: [{ id: selections.effectId, kind: 'healing', amount: { formula: `round(${constant} + ${heal.levelCoefficient} * level + ${heal.skillCoefficient} * ${skill} + ${heal.attributeCoefficient} * ${attribute})` } }]
    };
}
function compileHealingRecipe({ proposal, actor, policy = resolvePolicy(), revision = {} }) {
    validateRecipeProposal(proposal);
    const selected = actorSelections(actor, proposal);
    const snapshot = snapshotFor(policy, proposal.resourceProfileId);
    bindResource(snapshot.resourceProfile, actor, proposal.resourceProfileId);
    const balance = {
        schemaVersion: 1, recipeId: 'standard-healing',
        policy: { version: snapshot.version, digest: digest(snapshot), snapshot },
        selections: { skillName: selected.skill.name, attributeName: selected.attribute.name, resourceProfileId: proposal.resourceProfileId, needId: snapshot.resourceProfile.needId, effectId: proposal.effectId ?? 'restore' },
        parameters: parametersFor(snapshot, [])
    };
    const result = { revision: 1, acquisitionRequirements: [], useRequirements: [], target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' }, ...clone(revision), ...compiledAmounts(balance), balance };
    delete result.recipe;
    validateManagedRevision(result, actor);
    return result;
}
function validateManagedRevision(revision, actor) {
    if (revision.balance === undefined) return true;
    const balance = revision.balance;
    keys(balance, ['schemaVersion', 'recipeId', 'policy', 'selections', 'parameters'], 'balance');
    if (balance.schemaVersion !== 1 || balance.recipeId !== 'standard-healing') throw new Error('Unsupported balance schemaVersion/recipeId.');
    keys(balance.policy, ['version', 'digest', 'snapshot'], 'balance.policy');
    const snapshot = balance.policy.snapshot;
    keys(snapshot, ['version', 'healing', 'referenceBaseWeaponDamage', 'resourceProfile', 'improvementSteps'], 'balance.policy.snapshot');
    numeric(snapshot.referenceBaseWeaponDamage, 'balance.policy.snapshot.referenceBaseWeaponDamage');
    validatePolicy({ version: snapshot.version, healing: { standard: snapshot.healing }, resourceProfiles: { selected: snapshot.resourceProfile }, improvementSteps: snapshot.improvementSteps, referenceBaseWeaponDamage: snapshot.referenceBaseWeaponDamage });
    if (balance.policy.version !== snapshot.version || balance.policy.digest !== digest(snapshot)) throw new Error('balance.policy.digest does not match the saved policy snapshot.');
    keys(balance.selections, ['skillName', 'attributeName', 'resourceProfileId', 'needId', 'effectId'], 'balance.selections');
    for (const field of ['skillName', 'attributeName', 'resourceProfileId', 'needId', 'effectId']) text(balance.selections[field], `balance.selections.${field}`);
    if (balance.selections.needId !== snapshot.resourceProfile.needId) throw new Error('balance.selections.needId conflicts with saved resource profile.');
    keys(balance.parameters, ['baseCost', 'healingBonus', 'appliedImprovementIds'], 'balance.parameters');
    if (!Array.isArray(balance.parameters.appliedImprovementIds) || balance.parameters.appliedImprovementIds.some(id => typeof id !== 'string')) throw new Error('balance.parameters.appliedImprovementIds must be an array of step IDs.');
    if (!same(parametersFor(snapshot, balance.parameters.appliedImprovementIds), balance.parameters)) throw new Error('balance.parameters differ from their configured improvement steps.');
    if (revision.target?.allowDead === true) throw new Error('Managed healing target.allowDead is unsupported.');
    if (!['self', 'single'].includes(revision.target?.kind)) throw new Error('Managed healing target.kind supports only self or single.');
    if (revision.failureCosts !== undefined) throw new Error('Managed healing failureCosts must be omitted; explicit failure vectors are unsupported.');
    const compiled = compiledAmounts(balance);
    if (!same(revision.costs, compiled.costs)) throw new Error('Managed healing costs differ from the canonical saved recipe.');
    if (!same(revision.effects, compiled.effects)) throw new Error('Managed healing effects differ from the canonical saved recipe; additional or altered effects are unsupported.');
    if (actor) {
        const selected = actorSelections(actor, balance.selections);
        const denominator = snapshot.resourceProfile.denominatorConstant + snapshot.resourceProfile.skillEfficiency * selected.skill.value + snapshot.resourceProfile.levelEfficiency * actor.level;
        numeric(denominator, 'Managed resource denominator', 0, true);
        bindResource(snapshot.resourceProfile, actor, balance.selections.resourceProfileId);
        for (const [label, amount] of [['cost', compiled.costs[0].amount], ['healing', compiled.effects[0].amount]]) {
            const value = Evaluator.compile(amount.formula)(Variables.resolve(amount.formula, actor));
            numeric(value, `Managed ${label} amount`);
        }
    }
    return true;
}
function materializeRevision(raw, { actor, origin = 'automatic', config, policy } = {}) {
    if (!['automatic', 'editor'].includes(origin)) throw new Error(`Unsupported technique authoring origin ${origin}.`);
    if (raw.recipe !== undefined) {
        if (raw.balance !== undefined || raw.costs !== undefined || raw.effects !== undefined || raw.failureCosts !== undefined) throw new Error('recipe proposals must omit numeric costs/effects, balance and failureCosts.');
        return compileHealingRecipe({ proposal: raw.recipe, actor, policy: policy ?? resolvePolicy(config), revision: raw });
    }
    const result = clone(raw);
    if (result.balance !== undefined) {
        validateManagedRevision(result, actor);
        if (origin === 'automatic') {
            const current = snapshotFor(policy ?? resolvePolicy(config), result.balance.selections.resourceProfileId);
            if (!same(current, result.balance.policy.snapshot) || result.balance.parameters.appliedImprovementIds.length) throw new Error('Automatic new healing must use the current policy and unimproved recipe parameters.');
        }
    }
    else if (origin !== 'editor' && result.effects?.some(effect => effect.kind === 'healing')) throw new Error('Automatic healing requires recipe: standard-healing; unmanaged numeric healing is unsupported.');
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
    keys(proposal, ['stepId', 'reason'], 'improvement');
    const id = text(proposal.stepId, 'improvement.stepId');
    if (proposal.reason !== undefined) text(proposal.reason, 'improvement.reason');
    const previous = learned.mechanics ?? learned;
    validateManagedRevision(previous, actor);
    if (!previous.balance) throw new Error('A configured improvement requires an existing managed healing revision.');
    const result = clone(previous);
    result.revision += 1;
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
    return { policyVersion: policy.version, policyDigest: digest(policy), recipes: [{ recipeId: 'standard-healing', targetKinds: ['self', 'single'] }], skills: facts.filter(row => row.kind === 'skill'), attributes: facts.filter(row => row.kind === 'attribute'), resourceProfiles, improvementSteps: Object.entries(policy.improvementSteps).map(([stepId, step]) => ({ stepId, ...clone(step) })) };
}
module.exports = { DEFAULT_POLICY, resolvePolicy, validatePolicy, compileHealingRecipe, compilePersonalImprovement, validateManagedRevision, validateRecipeProposal, materializeRevision, materializeDefinition, getAuthoringContext, digest };
