'use strict';

const LLMClient = require('./LLMClient.js');
const TechniqueService = require('./TechniqueService.js');
const Utils = require('./Utils.js');
const { extractTinyBrainXmlResponse } = require('./TinyBrainXmlResponse.js');
const {
    parseAutomaticTechniqueCandidate
} = require('./TechniquePrompt.js');
const { runPromptWithParseRetries, resolveConfiguredPromptMaxAttempts } = require('./PromptRetryPolicy.js');
const { compactTechniqueCatalogue } = require('./TechniquePromptContext.js');
const { ValidationIssueCollector, withValidationContext } = require('./ResponseValidation.js');

const LABEL = 'ability_attachments';
const { parseTechniqueXmlValue, attachmentSchema, flattenTechniqueDisciplineGroups, getTechniqueXmlInstructions } = require('./TechniqueXml.js');

function requireOwnedAbility(actor, abilityId) {
    if (!actor || typeof actor.getAbilities !== 'function' || typeof actor.id !== 'string') {
        throw new TypeError('Ability attachment authoring requires an actor with abilities.');
    }
    if (typeof abilityId !== 'string' || !abilityId.trim()) throw new TypeError('Ability attachment authoring requires an ability ID.');
    const ability = actor.getAbilities().find(entry => entry.id === abilityId);
    if (!ability) throw new Error(`Actor ${actor.id} does not own ability ${abilityId}.`);
    return ability;
}

function parseAbilityAttachmentDraft(response, { actor, abilityId, pendingAbility = null }) {
    const xml = extractTinyBrainXmlResponse(response, 'abilityAttachments');
    let document;
    try { document = Utils.parseXmlDocumentStrict(xml, 'text/xml'); }
    catch (cause) {
        throw new Error(`Ability attachment XML: ${cause.message} Correct the XML markup, matching tags and escaping text ampersands/less-than signs.`, { cause });
    }
    const root = document.documentElement;
    if (root?.tagName !== 'abilityAttachments' || root.attributes.length) {
        throw new Error('Ability attachment response requires a plain <abilityAttachments> root. Wrap statusEffects in that root and use child elements instead of attributes.');
    }
    const { statusEffects = [] } = parseTechniqueXmlValue(root, attachmentSchema, 'abilityAttachments');
    const stagedDisciplines = TechniqueService.getDisciplines();
    const issues = new ValidationIssueCollector();
    for (const [index, effect] of statusEffects.entries()) {
        if (issues.full) break;
        const fields = new ValidationIssueCollector();
        const entryPaths = (effect.disciplines || []).flatMap((group, groupIndex) => (group.techniques || []).map((entry, entryIndex) => `statusEffects[${index}].disciplines[${groupIndex}].techniques[${entryIndex}]`));
        if (effect.disciplines !== undefined) {
            effect.techniqueEntries = fields.capture(() => flattenTechniqueDisciplineGroups(effect.disciplines, { disciplines: stagedDisciplines, path: `statusEffects[${index}].disciplines` }));
            delete effect.disciplines;
        }
        if (effect.duration !== -1) fields.add(new Error(`statusEffects[${index}].duration must be -1 for an owned ability. Outer statuses are permanent owner traits or technique containers; put temporary activated changes in a granted technique effect.status.`));
        if (effect.needBars?.length) fields.add(new Error(`statusEffects[${index}].needBars is unsupported for an ability attachment. Remove outer need deltas; supported activated need changes belong in a granted technique effect.status.needBars.`));
        for (const [entryIndex, entry] of (effect.techniqueEntries || []).entries()) {
            if (fields.full) break;
            if (!entry.candidate) continue;
            const path = entryPaths[entryIndex];
            fields.capture(() => {
                if (entry.candidate.revisions?.length !== 1) throw new Error(`${path}.candidate requires only revision 1. Provide one fresh revision; omit its revision number or use 1.`);
                try {
                    parseAutomaticTechniqueCandidate({
                        ...entry.candidate, id: 'preview_ability_technique',
                        disciplineId: entry.candidate.disciplineId || entry.candidateDiscipline?.id,
                        provenance: { kind: 'generation', reason: 'Preview ability attachment' }
                    });
                } catch (cause) {
                    throw withValidationContext(cause, `${path}.candidate`);
                }
            });
        }
        issues.capture(() => fields.throwIfAny());
    }
    issues.throwIfAny();
    // This is a detached preflight. It must not install catalogue definitions or actor state.
    TechniqueService.previewAbilityAttachmentBatch({ actor, entries: [{ abilityId, statusEffects }], pendingAbility });
    return { statusEffects };
}

function actorFacts(actor) {
    const abilities = actor.getAbilities().map(entry => ({
        id: entry.id, name: entry.name, description: entry.description,
        type: entry.type, level: entry.level
    }));
    return {
        id: actor.id, name: actor.name, description: actor.description,
        class: actor.class, race: actor.race, level: actor.level,
        health: actor.health, maxHealth: actor.maxHealth,
        attributes: Object.fromEntries(actor.getAttributeNames().map(name => [name, actor.getAttributeModifier(name)])),
        skills: Object.fromEntries(actor.getSkills()),
        abilities,
        needBars: actor.getNeedBars({ scope: 'active' }).map(bar => ({
            id: bar.id, name: bar.name, description: bar.description,
            value: bar.value, min: bar.min, max: bar.max, paymentDirection: bar.paymentDirection
        }))
    };
}

function getAttachmentXmlInstructions() {
    return `Return only XML using child elements, no attributes and no embedded JSON. Escape & and < in text as &amp; and &lt;. Each object field occurs at most once. Numbers are finite decimal or scientific-notation text, never quoted values, units, NaN, Infinity or null. Booleans are exactly true or false. Optional fields may be omitted; an empty list is a self-closing container. Never put [] or {} in an element.
The response contains exactly one <abilityAttachments> root and an optional <statusEffects> list with zero or more <statusEffect> children. Omit the list or use an empty <statusEffects/> only when no supported mechanics can honestly represent the ability. Each statusEffect has name, description, duration -1, and optional attributes, skills, maxHealthPercent and disciplines. Attachment attribute and skill modifier values and maxHealthPercent are numbers. Both fixed modifier and percentModifier may coexist. Do not author attachment needBars or techniqueGrants. Never author attachment status id/appliedAt or techniqueEntry id/provenance.
Choose the mechanical location by who receives the effect and when. An outer ability status is continuously active on its owner and represents an explicitly permanent, unconditional trait with attribute, skill or health modifiers. That trait may be a benefit or a drawback. An activated action, including a temporary self buff, is a technique granted by an outer permanent status. A status containing only disciplines is a complete grant container. In the technique revision, target kind self, single or area identifies the recipient. Direct harm is a damage effect. A buff or debuff applied on successful use is an effect with a nested status on that recipient; its duration is an integer number of world minutes or -1 for a permanent effect. Combine outer modifiers and a technique when the ability explicitly has both ongoing and activated components. Represent the supported components that follow from the ability description; use <statusEffects/> when there are none.
Passive-only attachment example (replace all example text, identities and values with actual supported mechanics; omit irrelevant fields):
<abilityAttachments><statusEffects><statusEffect><name>PASSIVE_STATUS_NAME</name><description>EXPLICIT_ONGOING_TRAIT</description><duration>-1</duration><attributes><attribute><attribute>ACTUAL_RELEVANT_ATTRIBUTE</attribute><modifier>1</modifier><percentModifier>20</percentModifier></attribute></attributes><skills><skill><skill>ACTUAL_RELEVANT_SKILL</skill><modifier>1</modifier><percentModifier>10</percentModifier></skill></skills><maxHealthPercent>10</maxHealthPercent></statusEffect></statusEffects></abilityAttachments>
Activated-only attachment example (the outer status grants a technique and has no numeric modifiers):
<abilityAttachments><statusEffects><statusEffect><name>TECHNIQUE_GRANT_STATUS_NAME</name><description>EXPLICIT_ABILITY_TO_USE_TECHNIQUE</description><duration>-1</duration><disciplines><discipline><disciplineId>EXISTING_DISCIPLINE_ID</disciplineId><techniques><technique><techniqueId>EXISTING_TECHNIQUE_ID</techniqueId><definitionRevision>1</definitionRevision></technique></techniques></discipline></disciplines></statusEffect></statusEffects></abilityAttachments>
${getTechniqueXmlInstructions()}`;
}

function buildAbilityAttachmentPrompt({ actor, ability, setting = {}, pendingAbility = false }) {
    const facts = actorFacts(actor);
    const catalogue = compactTechniqueCatalogue(TechniqueService.getDefinitions());
    const disciplines = TechniqueService.getDisciplines();
    const techniqueContext = TechniqueService.getCompactPromptContext([actor]);
    const mechanicalAbility = { ...ability };
    delete mechanicalAbility.imageId;
    delete mechanicalAbility.imagePrompt;
    const systemPrompt = `Author executable, setting-grounded mechanics for exactly one ${pendingAbility ? 'offered, unselected' : 'already-owned'} RPG ability. The ability itself is the source of permanent status effects if selected. Each status may grant one or more techniques while that status remains active. Use the existing status-effect and technique systems only. An outer ability status always affects its owner; a technique's effects affect its selected target only after use. Follow the mechanical placement guide below and select mechanics that follow directly from the ability's description. Direct percentage changes to maximum health use maxHealthPercent on a status. Attribute and skill entries may include signed fixed modifier and/or signed percentModifier; 20 means +20%. An ability status must have duration -1. Use exact existing attribute, skill, resource, discipline and technique identities from context; do not invent an actor fact. Reuse an equivalent existing catalogue technique before proposing a new one. No user action is cast, no cost is paid, and no time advances. No prose outside XML.\n${getAttachmentXmlInstructions()}`;
    const stableContextPrompt = `Actor facts:\n${JSON.stringify(facts)}\nSetting:\n${JSON.stringify(setting)}\nExisting disciplines:\n${JSON.stringify(disciplines)}\nExisting technique catalogue:\n${JSON.stringify(catalogue)}\nActor technique authoring context:\n${JSON.stringify(techniqueContext)}`;
    const abilityTaskPrompt = `Ability to author:\n${JSON.stringify(mechanicalAbility)}\nReturn the complete <abilityAttachments> XML for this one ability, with nested <statusEffects>, <statusEffect> and optional <disciplines>/<discipline>/<techniques>/<technique> children. Use XML children all the way through candidates, disciplines, requirements, costs, effects and formulas. Fixed and percentage modifiers may coexist. Do not include needBars or techniqueGrants on ability statuses. No JSON inside response elements.`;
    return { systemPrompt, generationPrompt: `${stableContextPrompt}\n${abilityTaskPrompt}`, stableContextPrompt, abilityTaskPrompt };
}

async function generateAbilityAttachmentDraft({ actor, abilityId, pendingAbility = null, config = {}, setting = {}, clientId = null }) {
    const ability = pendingAbility || requireOwnedAbility(actor, abilityId);
    if (pendingAbility && pendingAbility.id !== abilityId) throw new Error('Pending attachment ability ID does not match the requested ID.');
    const expected = TechniqueService.getAbilityAttachmentExpected(actor, [abilityId], { pendingAbility });
    const { systemPrompt, generationPrompt, stableContextPrompt, abilityTaskPrompt } = buildAbilityAttachmentPrompt({ actor, ability, setting, pendingAbility: Boolean(pendingAbility) });
    const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: stableContextPrompt }, { role: 'user', content: abilityTaskPrompt }];
    let attemptMessages = messages;
    const aiConfig = LLMClient.resolveEffectiveAiConfiguration(LABEL, config).aiConfig;
    const result = await runPromptWithParseRetries({
        metadataLabel: LABEL,
        messages,
        maxAttempts: resolveConfiguredPromptMaxAttempts(aiConfig),
        complete: async ({ messages: current }) => {
            attemptMessages = current;
            try {
                return await LLMClient.chatCompletion({
                    messages: current, metadataLabel: LABEL, metadata: { clientId },
                    validateXML: false, xmlSchema: 'ability-attachments.schema.xml', throwOnError: true, allowToolCalls: false,
                    additionalPayload: { tools: [], tool_choice: 'none' }
                });
            } catch (cause) {
                await LLMClient.logPrompt({ prefix: LABEL, metadataLabel: LABEL, systemPrompt, generationPrompt,
                    response: '', sections: [{ title: 'Transport failure', content: cause.stack || cause.message },
                        { title: 'Complete attempt conversation', content: JSON.stringify(current) }] });
                throw cause;
            }
        },
        parse: response => parseAbilityAttachmentDraft(response, { actor, abilityId, pendingAbility }),
        buildRetryInstruction: error => `Ability attachment validation failed: ${error.message}\nReturn a corrected complete <abilityAttachments> response. No catalogue or actor changes were applied.`,
        onAttempt: ({ response, error, accepted, attempt }) => LLMClient.logPrompt({
            prefix: LABEL, metadataLabel: LABEL, systemPrompt, generationPrompt, response,
            sections: [{ title: 'Validation', content: `${attempt}: ${accepted ? 'accepted' : error.message}` },
                { title: 'Complete attempt conversation', content: JSON.stringify(attemptMessages) }]
        })
    });
    // Reject a draft if the actor or world changed while the model was running.
    const preview = TechniqueService.previewAbilityAttachmentBatch({ actor,
        entries: [{ abilityId, statusEffects: result.value.statusEffects }], expected, pendingAbility });
    return { draft: pendingAbility ? { statusEffects: preview.entries[0].statusEffects } : result.value, expected };
}

async function authorNewAbilityAttachments({ actor, abilityIds, draftsByAbilityId = null, config = {}, setting = {}, clientId = null }) {
    if (!Array.isArray(abilityIds) || new Set(abilityIds).size !== abilityIds.length) {
        throw new TypeError('New ability attachment authoring requires distinct ability IDs.');
    }
    if (!abilityIds.length) return [];
    for (const abilityId of abilityIds) requireOwnedAbility(actor, abilityId);
    const expected = TechniqueService.getAbilityAttachmentExpected(actor, abilityIds);
    const entries = [];
    for (const abilityId of abilityIds) {
        const { draft } = draftsByAbilityId
            ? { draft: draftsByAbilityId[abilityId] }
            : await generateAbilityAttachmentDraft({ actor, abilityId, config, setting, clientId });
        if (!draft || !Array.isArray(draft.statusEffects)) throw new Error(`Missing prepared attachment draft for ability ${abilityId}.`);
        entries.push({ abilityId, statusEffects: draft.statusEffects });
    }
    const preview = TechniqueService.previewAbilityAttachmentBatch({ actor, entries, expected });
    TechniqueService.applyAbilityAttachmentBatch({ actor, entries: preview.entries, expected });
    return [...abilityIds];
}

module.exports = {
    authorNewAbilityAttachments,
    buildAbilityAttachmentPrompt,
    generateAbilityAttachmentDraft,
    parseAbilityAttachmentDraft,
    requireOwnedAbility
};
