'use strict';

const FormulaVariables = require('./public/js/technique-formula-variables.js');

const clone = value => JSON.parse(JSON.stringify(value));
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, clone(value[key])]));

function compactMechanics(mechanics) {
    return pick(mechanics, ['revision', 'acquisitionRequirements', 'useRequirements', 'target', 'check', 'costs', 'failureCosts', 'effects']);
}

function compactTechnique(technique) {
    return {
        ...pick(technique, ['techniqueId', 'name', 'description', 'disciplineId', 'disciplineName', 'learned', 'balanceImprovements', 'selectedSourceId', 'available', 'blockers']),
        sources: technique.sources.map(source => ({
            ...pick(source, ['sourceId', 'sourceKind', 'itemId', 'itemName', 'statusId', 'statusName', 'abilityId', 'abilityName', 'definitionRevision', 'personalRevision', 'costs', 'failureCosts', 'requiresWeaponSelection', 'available', 'blockers']),
            mechanics: compactMechanics(source.mechanics)
        }))
    };
}

/** Prompt-only projection. Persisted mechanics and client/editor DTOs stay complete. */
function compactTechniquePromptContext(contexts) {
    if (!Array.isArray(contexts)) throw new TypeError('Technique prompt contexts must be an array.');
    const balancePolicies = {};
    const formulaVariableSchema = new Map();
    const utilityDestinations = new Map();
    const summonTemplates = new Map();
    const actors = contexts.map(context => {
        for (const [name, values, catalog] of [
            ['destinations', context.utilityContext?.destinations || [], utilityDestinations],
            ['summonTemplates', context.utilityContext?.summonTemplates || [], summonTemplates]
        ]) for (const value of values) {
            if (!value?.id) throw new Error(`Technique utility ${name} requires canonical IDs.`);
            if (catalog.has(value.id) && JSON.stringify(catalog.get(value.id)) !== JSON.stringify(value)) throw new Error(`Technique utility ${name} has conflicting facts for ${value.id}.`);
            catalog.set(value.id, clone(value));
        }
        const authoring = context.balanceAuthoring;
        const policy = pick(authoring, ['policyVersion', 'recipes', 'improvementSteps']);
        const digest = authoring.policyDigest;
        if (typeof digest !== 'string' || !digest) throw new Error('Technique authoring policy requires its digest.');
        if (Object.hasOwn(balancePolicies, digest) && JSON.stringify(balancePolicies[digest]) !== JSON.stringify(policy)) {
            throw new Error(`Technique authoring policy ${digest} has conflicting prompt definitions.`);
        }
        balancePolicies[digest] = policy;
        const seenVariables = new Set();
        const formulaVariables = Object.fromEntries(context.formulaVariables.map(variable => {
            const definition = pick(variable, ['key', 'kind', 'name']);
            if (!FormulaVariables.isCanonical(variable.key) || FormulaVariables.keyFor(definition) !== variable.key) {
                throw new Error(`Technique formula variable ${variable.key} has an inconsistent canonical definition.`);
            }
            if (seenVariables.has(variable.key)) {
                throw new Error(`Technique formula variable ${variable.key} is duplicated for ${context.actorName}.`);
            }
            if (typeof variable.value !== 'number' || !Number.isFinite(variable.value)) {
                throw new Error(`Technique formula variable ${variable.key} for ${context.actorName} requires a finite value.`);
            }
            seenVariables.add(variable.key);
            if (formulaVariableSchema.has(variable.key)
                && JSON.stringify(formulaVariableSchema.get(variable.key)) !== JSON.stringify(definition)) {
                throw new Error(`Technique formula variable ${variable.key} has conflicting definitions across actors.`);
            }
            formulaVariableSchema.set(variable.key, definition);
            return [variable.key, variable.value];
        }));
        return {
            actorId: context.actorId,
            actorName: context.actorName,
            chargeItems: clone(context.chargeItems || []),
            weaponItems: clone(context.weaponItems || []),
            utilityContext: {
                summonActors: clone(context.utilityContext?.summonActors || []),
                deadTargets: clone(context.utilityContext?.deadTargets || [])
            },
            formulaVariables,
            balanceAuthoring: {
                policyDigest: digest,
                resourceProfiles: clone(authoring.resourceProfiles)
            },
            disciplineAccess: clone(context.disciplineAccess),
            techniques: context.techniques.map(compactTechnique)
        };
    });
    return { balancePolicies, formulaVariableSchema: [...formulaVariableSchema.values()], utilityCatalog: { destinations: [...utilityDestinations.values()], summonTemplates: [...summonTemplates.values()] }, actors };
}

function compactTechniqueActorFacts(actor, { includeFormulaFacts = true } = {}) {
    if (typeof includeFormulaFacts !== 'boolean') throw new TypeError('includeFormulaFacts must be a boolean.');
    return {
        ...pick(actor, ['id', 'name', 'class', 'race', 'description', 'health', 'maxHealth', 'isDead', 'isDisabled']),
        ...(includeFormulaFacts ? pick(actor, ['level', 'skills', 'attributes']) : {}),
        abilities: actor.abilities.map(ability => ({
            ...pick(ability, ['id', 'name', 'description', 'type', 'level']),
            ...(Array.isArray(ability.statusEffects) ? { statusEffects: ability.statusEffects.map(effect =>
                pick(effect, ['id', 'name', 'description', 'duration', 'attributes', 'skills', 'maxHealthPercent', 'techniqueGrants'])) } : {})
        })),
        ...(Array.isArray(actor.statusEffects) ? { statusEffects: actor.statusEffects.map(effect =>
            pick(effect, ['id', 'name', 'description', 'duration', 'attributes', 'skills', 'maxHealthPercent', 'techniqueGrants'])) } : {}),
        needBars: actor.needBars.map(bar => pick(bar, ['id', 'name', 'value', 'min', 'max', 'paymentDirection']))
    };
}

function compactTechniqueCatalogue(definitions) {
    return definitions.map(definition => {
        const revision = definition.revisions.at(-1);
        if (!revision) throw new Error(`Technique catalogue definition ${definition.id} has no revision.`);
        return {
            ...pick(definition, ['id', 'disciplineId', 'name', 'description', 'semanticKey', 'aliases', 'unique']),
            revisions: [compactMechanics(revision)]
        };
    });
}

module.exports = { compactTechniquePromptContext, compactTechniqueActorFacts, compactTechniqueCatalogue };
