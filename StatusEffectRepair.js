'use strict';

const Utils = require('./Utils.js');
const StatusEffect = require('./StatusEffect.js');
const TechniqueService = require('./TechniqueService.js');
const Player = require('./Player.js');
const { isDeepStrictEqual: equal } = require('node:util');
const { parseStatusEffectXml, renderStatusEffectXml } = require('./StatusEffectXml.js');
const { extractTinyBrainXmlResponse } = require('./TinyBrainXmlResponse.js');
const { parseTechniqueXmlValue } = require('./TechniqueXml.js');
const { writeTechniqueXmlValue } = require('./TechniqueXml.js');
const { XMLSerializer } = require('@xmldom/xmldom');
const { statusEffectXmlSchema } = require('./StatusEffectXml.js');
const clone = value => structuredClone(value);
const emptyMechanics = effect => ['attributes', 'skills', 'needBars', 'techniqueGrants', 'needBarMaximums'].every(key => (effect[key] === undefined || (Array.isArray(effect[key]) && !effect[key].length)))
    && (effect.maxHealthPercent === undefined || effect.maxHealthPercent === 0);
const children = node => Array.from(node?.childNodes || []).filter(child => child.nodeType === 1);

function renderActorContext(actor) {
    const document = Utils.parseXmlDocumentStrict('<repairActor/>', 'text/xml');
    const optionalText = { optionalEmptyLeaf: 'text' };
    const schema = { id: 'text', name: 'text', level: 'number', description: optionalText, class: optionalText, race: optionalText,
        attributes: { tag: 'attribute', item: { name: 'text', value: 'number', modifier: 'number' } },
        skills: { tag: 'skill', item: { name: 'text', value: 'number' } },
        abilities: { tag: 'ability', item: { id: 'text', name: 'text', description: optionalText, type: optionalText, level: 'number' } } };
    const value = { id: actor.id, name: actor.name, level: actor.level,
        ...(actor.description ? { description: actor.description } : {}), ...(actor.class ? { class: actor.class } : {}), ...(actor.race ? { race: actor.race } : {}),
        attributes: actor.getAttributeNames().map(name => ({ name, value: actor.attributes[name], modifier: actor.getAttributeBonus(name) })),
        skills: [...actor.getSkills()].map(([name, rank]) => ({ name, value: rank })),
        abilities: actor.getAbilities().map(ability => ({ id: ability.id, name: ability.name, ...(ability.description ? { description: ability.description } : {}), type: ability.type, level: ability.level })) };
    writeTechniqueXmlValue(document.documentElement, value, schema);
    return new XMLSerializer().serializeToString(document.documentElement);
}

function collectCandidates(actors) {
    if (!Array.isArray(actors)) throw new TypeError('Status-effect repair requires a character array.');
    const candidates = [];
    for (const actor of actors) {
        const intrinsic = clone(actor.toJSON().statusEffects || []);
        const abilities = clone(actor.getAbilities());
        const baseline = { intrinsic, abilities, health: actor.health };
        const abilityEffects = abilities.flatMap(ability => (ability.statusEffects || []).map(effect => ({ ability, effect })));
        const byOwner = new Map();
        const add = (effect, ability = null) => {
            const ownerKey = `${ability?.id || 'intrinsic'}:${effect.id}`;
            if (byOwner.has(ownerKey)) return byOwner.get(ownerKey);
            if (!effect.id) throw new Error(`Status-effect repair requires a stable status ID on ${actor.name}; restore the character's saved identity before repairing it.`);
            const candidate = { key: `status_repair_${candidates.length + 1}`, actor, actorId: actor.id, actorName: actor.name,
                abilityId: ability?.id || null, abilityName: ability?.name || null, statusId: effect.id,
                existingEffect: clone(effect), effect: clone(effect), baseline, duplicates: [] };
            byOwner.set(ownerKey, candidate);
            candidates.push(candidate);
            return candidate;
        };
        for (const { ability, effect } of abilityEffects) {
            if (!effect.name?.trim() || !effect.description?.trim() || emptyMechanics(effect)) add(effect, ability);
        }
        for (const effect of intrinsic) {
            const matches = !effect.name?.trim() && effect.duration === -1 && !effect.techniqueProvenance && emptyMechanics(effect)
                ? abilityEffects.filter(owner => owner.effect.duration === effect.duration
                    && owner.effect.description?.trim() === effect.description?.trim()) : [];
            if (matches.length === 1) {
                add(matches[0].effect, matches[0].ability).duplicates.push(effect.id);
            } else if (!effect.name?.trim() || !effect.description?.trim() || emptyMechanics(effect)) add(effect);
        }
    }
    return candidates;
}

function validateRepair(candidate, node) {
    const path = `statusEffectRepairs.${candidate.key}`;
    const effect = parseStatusEffectXml(node, { existing: candidate.existingEffect, actor: candidate.actor, path, requireComplete: true });
    const existing = candidate.existingEffect;
    for (const key of ['name', 'description', 'duration', 'maxHealthPercent']) {
        if (key === 'maxHealthPercent' && existing[key] === 0 && emptyMechanics(existing)) continue;
        if (existing[key] !== undefined && existing[key] !== null && existing[key] !== '' && !equal(existing[key], effect[key])) {
            throw new Error(`${path}.${key} already has a valid value. Preserve it exactly; repair only missing fields or missing mechanics.`);
        }
    }
    for (const key of ['attributes', 'skills', 'needBars', 'techniqueGrants', 'needBarMaximums']) {
        if (existing[key]?.length && !equal(existing[key], effect[key])) {
            throw new Error(`${path}.${key} contains existing mechanics or grant identities. Preserve the complete list, including explicit zero modifiers and revision pins.`);
        }
    }
    if (candidate.abilityId && (effect.duration !== -1 || effect.needBars.length)) {
        throw new Error(`${path} belongs to an ability: duration must be -1 and needBars must be empty. Keep temporary or per-minute effects on their actual intrinsic owner instead.`);
    }
    return { candidate, effect };
}

function parseRepairResponse(response, candidates) {
    const single = candidates.length === 1 && /<effect\b/i.test(response) && !/<statusEffectRepairs\b/i.test(response);
    const rootName = single ? 'effect' : 'statusEffectRepairs';
    const document = Utils.parseXmlDocumentStrict(extractTinyBrainXmlResponse(response, rootName), 'text/xml');
    if (single) return [validateRepair(candidates[0], document.documentElement)];
    parseTechniqueXmlValue(document.documentElement, { tag: 'repair', item: { key: 'text', effect: statusEffectXmlSchema } }, 'statusEffectRepairs');
    const expected = new Map(candidates.map(candidate => [candidate.key, candidate]));
    const prepared = [];
    const seen = new Set();
    for (const node of children(document.documentElement)) {
        if (node.tagName !== 'repair') throw new Error('statusEffectRepairs requires repair children, each with key and effect.');
        const fields = children(node);
        if (fields.length !== 2 || fields.filter(field => field.tagName === 'key').length !== 1 || fields.filter(field => field.tagName === 'effect').length !== 1) throw new Error('statusEffectRepairs.repair requires exactly one key and one effect; remove other fields.');
        const key = fields.find(field => field.tagName === 'key').textContent.trim();
        if (!expected.has(key) || seen.has(key)) throw new Error(`statusEffectRepairs key "${key}" is unknown or repeated. Return each requested key exactly once.`);
        seen.add(key);
        prepared.push(validateRepair(expected.get(key), fields.find(field => field.tagName === 'effect')));
    }
    if (prepared.length !== candidates.length) throw new Error(`statusEffectRepairs omitted requested effects: ${candidates.filter(candidate => !seen.has(candidate.key)).map(candidate => candidate.key).join(', ')}.`);
    return prepared;
}

function applyRepairs(prepared) {
    const owners = new Map();
    for (const { candidate, effect } of prepared) {
        if (!owners.has(candidate.actorId)) owners.set(candidate.actorId, { actor: candidate.actor, baseline: candidate.baseline,
            intrinsic: clone(candidate.baseline.intrinsic), abilities: clone(candidate.baseline.abilities) });
        const owner = owners.get(candidate.actorId);
        const list = candidate.abilityId ? owner.abilities.find(ability => ability.id === candidate.abilityId)?.statusEffects : owner.intrinsic;
        const index = list?.findIndex(entry => entry.id === candidate.statusId);
        if (index === undefined || index < 0) throw new Error(`Status-effect repair target ${candidate.statusId} no longer exists on ${candidate.actorName}.`);
        list[index] = clone(effect);
        owner.intrinsic = owner.intrinsic.filter(entry => !candidate.duplicates.includes(entry.id));
    }
    for (const owner of owners.values()) {
        if (!Player.getAll().includes(owner.actor) || !equal(owner.actor.toJSON().statusEffects, owner.baseline.intrinsic)
            || !equal(owner.actor.getAbilities(), owner.baseline.abilities) || owner.actor.health !== owner.baseline.health) throw new Error(`Status effects, abilities or health changed for ${owner.actor.name} while repair was processing. Run the command again against the current state.`);
        TechniqueService.validateStatusGrants([...owner.intrinsic, ...owner.abilities.flatMap(ability => ability.statusEffects || [])]);
        for (const effect of owner.intrinsic) new StatusEffect({ ...effect, register: false });
        for (const ability of owner.abilities) for (const effect of ability.statusEffects || []) {
            const normalized = new StatusEffect({ ...effect, register: false });
            if (normalized.duration !== -1 || normalized.needBars.length) throw new Error(`Ability ${ability.id} status ${effect.id} must be permanent and cannot have needBars.`);
        }
    }
    const touched = [];
    try {
        for (const owner of owners.values()) {
            if (equal(owner.baseline.abilities, owner.abilities) && equal(owner.baseline.intrinsic, owner.intrinsic)) continue;
            touched.push(owner);
            owner.actor.withHealthRatioPreserved(() => {
                if (!equal(owner.baseline.abilities, owner.abilities)) owner.actor.setAbilities(owner.abilities);
                if (!equal(owner.baseline.intrinsic, owner.intrinsic)) owner.actor.setStatusEffects(owner.intrinsic);
            });
        }
    } catch (error) {
        const failures = [];
        for (const owner of touched.reverse()) {
            for (const restore of [() => owner.actor.setAbilities(owner.baseline.abilities), () => owner.actor.setStatusEffects(owner.baseline.intrinsic), () => owner.actor.setHealth(owner.baseline.health)]) {
                try { restore(); } catch (cause) { failures.push(cause); }
            }
        }
        if (failures.length) throw new AggregateError([error, ...failures], `Status-effect repair failed and rollback was incomplete: ${error.message}`, { cause: error });
        throw error;
    }
    const repaired = prepared.filter(entry => !equal(entry.candidate.existingEffect, entry.effect)).length;
    return { inspected: prepared.length, repaired, unchanged: prepared.length - repaired,
        duplicatesRemoved: prepared.reduce((sum, entry) => sum + entry.candidate.duplicates.length, 0), characters: owners.size };
}

async function run({ actors = Player.getAll(), promptEnv, parseXMLTemplate, prepareBasePromptContext, config, clientId = null } = {}) {
    const Globals = require('./Globals.js');
    const LLMClient = require('./LLMClient.js');
    const { configureTinyBrainPromptContext, isTinyBrainPromptEnabled, runTinyBrainPromptProgram } = require('./TinyBrainPromptFamilies.js');
    const { resolveConfiguredPromptMaxAttempts } = require('./PromptRetryPolicy.js');
    if (Globals.gameLoaded !== true) throw new Error('Status-effect repair requires a loaded game.');
    if (!promptEnv || typeof parseXMLTemplate !== 'function' || typeof prepareBasePromptContext !== 'function') throw new Error('Status-effect repair prompt dependencies are unavailable.');
    const candidates = collectCandidates(actors);
    if (!candidates.length) return { inspected: 0, repaired: 0, unchanged: 0, duplicatesRemoved: 0, characters: 0 };
    const base = await prepareBasePromptContext({ locationOverride: Globals.location });
    const context = { ...base, promptType: 'status-effect-repair', statusRepairCandidates: candidates.map(candidate => ({
        key: candidate.key, actorName: candidate.actorName, actorId: candidate.actorId,
        abilityName: candidate.abilityName, abilityId: candidate.abilityId,
        effectXml: renderStatusEffectXml(candidate.existingEffect),
        duplicateIds: candidate.duplicates, ownerKind: candidate.abilityId ? 'ability' : 'intrinsic'
    })), statusRepairActors: [...new Map(candidates.map(candidate => [candidate.actorId, candidate.actor])).values()]
        .map(actor => ({ actorId: actor.id, xml: renderActorContext(actor) })) };
    const prepared = [];
    if (isTinyBrainPromptEnabled(config, 'status_effect_repair')) {
        const tinyBrain = configureTinyBrainPromptContext(context, 'status_effect_repair');
        const accepted = new Map();
        await runTinyBrainPromptProgram({ initialRenderedTemplate: promptEnv.render('base-context.xml.njk', context), templateContext: context, tinyBrain,
            runnerOptions: {
                promptEnv, parseXMLTemplate, metadataLabel: 'status_effect_repair', logPrefix: 'status_effect_repair_tinybrain',
                retryAttempts: resolveConfiguredPromptMaxAttempts(config?.ai) - 1,
                toolDefinitions: [], parserOutputContracts: { status_effect_repair: { xmlOutput: true, expectedXmlRootTag: 'effect' } },
                complete: async ({ messages, queueReservation }) => {
                    const aiResponse = await LLMClient.chatCompletion({ messages, queueReservation, metadataLabel: 'status_effect_repair', metadata: { clientId },
                        validateXML: false, throwOnError: true, allowToolCalls: false, additionalPayload: { tools: [], tool_choice: 'none' } });
                    return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
                },
                parsers: { status_effect_repair: (response, index) => {
                    const candidate = candidates[index];
                    if (!candidate) throw new Error(`Unknown status-effect repair checkpoint ${index}.`);
                    const result = parseRepairResponse(response, [candidate]);
                    accepted.set(index, result[0]);
                    return { value: true };
                } },
                resultBuilders: { status_effect_repairs_prepared: () => {
                    if (accepted.size !== candidates.length) throw new Error('Status-effect repair ended before every candidate was reviewed.');
                    return '<statusEffectsPrepared/>';
                } }
            } });
        for (let index = 0; index < candidates.length; index++) prepared.push(accepted.get(index));
    } else {
        for (let offset = 0; offset < candidates.length; offset += 10) {
            const batch = candidates.slice(offset, offset + 10);
            const batchOwners = new Set(batch.map(candidate => candidate.actorId));
            const batchContext = { ...context, statusRepairCandidates: context.statusRepairCandidates.slice(offset, offset + 10),
                statusRepairActors: context.statusRepairActors.filter(owner => batchOwners.has(owner.actorId)) };
            const template = parseXMLTemplate(promptEnv.render('base-context.xml.njk', batchContext));
            if (!template?.systemPrompt || !template?.generationPrompt) throw new Error('Status-effect repair template did not produce system and generation prompts.');
            let validated = null;
            const response = await LLMClient.chatCompletion({ messages: [{ role: 'system', content: template.systemPrompt }, { role: 'user', content: template.generationPrompt }],
                metadataLabel: 'status_effect_repair', metadata: { clientId }, expectedXmlRootTag: 'statusEffectRepairs', validateXMLStrict: true,
                responseValidationRetryFeedback: true, throwOnError: true, allowToolCalls: false, additionalPayload: { tools: [], tool_choice: 'none' },
                responseValidator: output => {
                    LLMClient.logPrompt({ prefix: 'status_effect_repair', metadataLabel: 'status_effect_repair', systemPrompt: template.systemPrompt, generationPrompt: template.generationPrompt, response: output });
                    validated = parseRepairResponse(output, batch);
                } });
            if (!validated) throw new Error(`Status-effect repair completion was not validated (${response?.length || 0} characters).`);
            prepared.push(...validated);
        }
    }
    if (Globals.gameLoaded !== true) throw new Error('The game was unloaded while status-effect repair was processing; no repairs were applied.');
    return applyRepairs(prepared);
}

module.exports = { collectCandidates, parseRepairResponse, applyRepairs, renderStatusEffectXml, run };
