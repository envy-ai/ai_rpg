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
    improvementSteps: { efficiency: { kind: 'efficiency', multiplier: 0.9 }, power: { kind: 'power', amount: 2 } }
};
function validatePolicy(raw) {
    keys(raw, ['version', 'healing', 'damage', 'resourceProfiles', 'improvementSteps', 'referenceBaseWeaponDamage'], 'techniques.balance');
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
    if (raw.referenceBaseWeaponDamage !== undefined) numeric(raw.referenceBaseWeaponDamage, 'referenceBaseWeaponDamage');
    return clone(raw);
}
function resolvePolicy(config = require('./Globals.js').config ?? {}) {
    const raw = config.techniques?.balance === undefined ? DEFAULT_POLICY : config.techniques.balance;
    if (Object.hasOwn(raw, 'referenceBaseWeaponDamage')) throw new Error('techniques.balance.referenceBaseWeaponDamage is derived from baseWeaponDamage and cannot be configured directly.');
    const policy = validatePolicy(raw);
    policy.damage ??= clone(DEFAULT_POLICY.damage);
    policy.referenceBaseWeaponDamage = numeric(config.baseWeaponDamage === undefined ? 5 : config.baseWeaponDamage, 'baseWeaponDamage');
    return policy;
}
function validateRecipeProposal(proposal) {
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
function materializeRevision(raw, { actor, origin = 'automatic', config, policy } = {}) {
    if (!['automatic', 'editor'].includes(origin)) throw new Error(`Unsupported technique authoring origin ${origin}.`);
    if (raw.recipe !== undefined) {
        if (raw.balance !== undefined || raw.costs !== undefined || raw.effects !== undefined || raw.failureCosts !== undefined) throw new Error('recipe proposals must omit numeric costs/effects, balance and failureCosts. Remove these fields; the engine supplies canonical mechanics from the recipe selectors.');
        const selectedPolicy = policy ?? resolvePolicy(config);
        const proposal = resolveAuthoringRecipeProposal(raw.recipe, { actor, policy: selectedPolicy });
        const kind = proposal.recipeId === 'standard-damage' ? 'damage' : 'healing';
        return compileRecipe({ proposal, actor, policy: selectedPolicy, revision: raw }, kind);
    }
    const result = clone(raw);
    if (result.balance !== undefined) {
        validateManagedRevision(result, actor);
        if (origin === 'automatic') {
            const current = snapshotFor(policy ?? resolvePolicy(config), result.balance.selections.resourceProfileId, result.balance.recipeId === 'standard-damage' ? 'damage' : 'healing');
            if (!same(current, result.balance.policy.snapshot) || result.balance.parameters.appliedImprovementIds.length) throw new Error('Automatic new managed techniques must use the current policy and unimproved recipe parameters. Propose recipe selectors without copied balance metadata or pre-applied improvements.');
        }
    }
    else if (origin !== 'editor' && result.effects?.some(effect => effect.kind === 'healing')) throw new Error('Automatic healing requires recipe: standard-healing; unmanaged numeric healing is unsupported. Use recipe kind healing with applicable selectors and omit costs, failureCosts, effects and balance; area/mixed healing has no supported recipe.');
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
    if (!previous.balance) throw new Error('A configured improvement requires an existing managed recipe revision.');
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
    return { policyVersion: policy.version, policyDigest: digest(policy), recipes: [{ kind: 'healing', recipeId: 'standard-healing', targetKinds: ['self', 'single'] }, { kind: 'damage', recipeId: 'standard-damage', targetKinds: ['self', 'single'], customAlternative: true }], availableRecipeKinds: resourceProfiles.length && facts.some(row => row.kind === 'skill') && facts.some(row => row.kind === 'attribute') ? ['healing', 'damage'] : [], skills: facts.filter(row => row.kind === 'skill'), attributes: facts.filter(row => row.kind === 'attribute'), resourceProfiles, improvementSteps: Object.entries(policy.improvementSteps).map(([stepId, step]) => ({ stepId, ...clone(step) })) };
}
module.exports = { DEFAULT_POLICY, resolvePolicy, validatePolicy, compileHealingRecipe, compileDamageRecipe, validateAuthoringRecipeProposal, resolveAuthoringRecipeProposal, compilePersonalImprovement, validateManagedRevision, validateRecipeProposal, materializeRevision, materializeDefinition, getAuthoringContext, digest };
