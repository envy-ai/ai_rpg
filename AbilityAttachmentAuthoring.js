'use strict';

const LLMClient = require('./LLMClient.js');
const TechniqueService = require('./TechniqueService.js');
const Utils = require('./Utils.js');
const { extractTinyBrainXmlResponse } = require('./TinyBrainXmlResponse.js');
const {
    parseAutomaticTechniqueCandidate
} = require('./TechniquePrompt.js');
const { runPromptWithParseRetries, resolveConfiguredPromptMaxAttempts } = require('./PromptRetryPolicy.js');
const { wrapTaskInBaseContext } = require('./BaseContextTaskPrompt.js');
const { compactTechniquePromptContext } = require('./TechniquePromptContext.js');
const { renderTechniqueCatalogueOutline, parseCatalogueTechniqueSelections, renderSelectedCatalogueTechniqueDetails } = require('./TechniqueSelectionContext.js');
const { ValidationIssueCollector, withValidationContext } = require('./ResponseValidation.js');
const path = require('path');
const nunjucks = require('nunjucks');
const { TinyBrainPromptExtension } = require('./TinyBrainPromptRunner.js');
const { configureTinyBrainPromptContext, isTinyBrainPromptEnabled, runTinyBrainPromptProgram } = require('./TinyBrainPromptFamilies.js');

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

function parseAbilityAttachmentDraft(response, { actor, abilityId, pendingAbility = null, selectedTechniqueIds = null, selectedTechniqueRevisions = null }) {
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
    const selected = selectedTechniqueIds === null ? null : new Set(selectedTechniqueIds);
    const assertSelected = (id, path) => {
        if (selected && !selected.has(id)) throw new Error(`${path} references existing technique ${id}, which was not selected for lookup. Select that ID in the catalogue lookup before reusing it, or remove the grant if it is unrelated to this ability. Available selected IDs: ${[...selected].join(', ') || 'none'}. Do not invent a new identity or change equivalent mechanics to bypass this check.`);
    };
    const validateReference = (entry, path) => {
        if (!entry.techniqueId) throw new Error(`${path}.techniqueId is required.`);
        const definition = TechniqueService.getDefinition(entry.techniqueId);
        if (!definition) throw new Error(`${path}.techniqueId references unknown technique ${entry.techniqueId}. Choose an existing selected catalogue ID.`);
        assertSelected(entry.techniqueId, `${path}.techniqueId`);
        if (selected) {
            const revision = selectedTechniqueRevisions?.[entry.techniqueId] ?? definition.revisions.at(-1).revision;
            if (entry.definitionRevision !== undefined && entry.definitionRevision !== revision) {
                throw new Error(`${path}.definitionRevision ${entry.definitionRevision} differs from lookup revision ${revision} for ${entry.techniqueId}. Omit definitionRevision so the server uses the selected mechanics, or use ${revision}. Older revision pins remain available through reviewed manual drafts.`);
            }
            entry.definitionRevision = revision;
        }
        return entry;
    };
    const issues = new ValidationIssueCollector();
    for (const [index, effect] of statusEffects.entries()) {
        if (issues.full) break;
        const fields = new ValidationIssueCollector();
        const entryPaths = (effect.disciplines || []).flatMap((group, groupIndex) => (group.techniques || []).map((entry, entryIndex) => `statusEffects[${index}].disciplines[${groupIndex}].techniques[${entryIndex}]`));
        const references = (effect.techniques || []).map((entry, entryIndex) => fields.capture(() => {
            return validateReference(entry, `statusEffects[${index}].techniques[${entryIndex}]`);
        })).filter(Boolean);
        delete effect.techniques;
        if (effect.disciplines !== undefined) {
            effect.techniqueEntries = fields.capture(() => flattenTechniqueDisciplineGroups(effect.disciplines, { disciplines: stagedDisciplines, path: `statusEffects[${index}].disciplines` }));
            delete effect.disciplines;
        }
        if (references.length) {
            effect.techniqueEntries = [...references, ...(effect.techniqueEntries || [])];
            entryPaths.unshift(...references.map((entry, entryIndex) => `statusEffects[${index}].techniques[${entryIndex}]`));
        }
        if (effect.duration !== -1) fields.add(new Error(`statusEffects[${index}].duration must be -1 for an owned ability. Outer statuses are permanent owner traits or technique containers; put temporary activated changes in a granted technique effect.status.`));
        if (effect.needBars?.length) fields.add(new Error(`statusEffects[${index}].needBars is unsupported for an ability attachment. Remove outer need deltas; supported activated need changes belong in a granted technique effect.status.needBars.`));
        for (const [entryIndex, entry] of (effect.techniqueEntries || []).entries()) {
            if (fields.full) break;
            const path = entryPaths[entryIndex];
            if (entry.techniqueId) fields.capture(() => validateReference(entry, path));
            if (!entry.candidate) continue;
            for (const [revisionIndex, revision] of (entry.candidate.revisions || []).entries()) {
                for (const [effectIndex, nested] of (revision.effects || []).entries()) {
                    for (const [grantIndex, grant] of (nested.status?.techniqueGrants || []).entries()) {
                        fields.capture(() => validateReference(grant, `${path}.candidate.revisions[${revisionIndex}].effects[${effectIndex}].status.techniqueGrants[${grantIndex}]`));
                    }
                }
            }
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
    const preview = TechniqueService.previewAbilityAttachmentBatch({ actor, entries: [{ abilityId, statusEffects }], pendingAbility });
    for (const [index, effect] of preview.resolvedEntries[0].statusEffects.entries()) {
        for (const [grantIndex, grant] of (effect.techniqueGrants || []).entries()) {
            if (TechniqueService.getDefinition(grant.techniqueId)) {
                validateReference(grant, `statusEffects[${index}].techniqueGrants[${grantIndex}]`);
                if (selected && statusEffects[index].techniqueEntries?.[grantIndex]?.candidate) {
                    // Semantic reuse resolved this candidate to known mechanics.
                    // Keep that selected revision pinned through later previews.
                    statusEffects[index].techniqueEntries[grantIndex] = {
                        techniqueId: grant.techniqueId, definitionRevision: grant.definitionRevision
                    };
                }
            }
        }
    }
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
The response contains exactly one <abilityAttachments> root and an optional <statusEffects> list with zero or more <statusEffect> children. Omit the list or use an empty <statusEffects/> only when no supported mechanics can honestly represent the ability. Each statusEffect has name, description, duration -1, and optional attributes, skills, needBarMaximums, maxHealthPercent, techniques and disciplines. Attachment attribute and skill modifier values, needBarMaximums percentages and maxHealthPercent are finite numbers. needBarMaximums contains needBarMaximum children with a configured need name and signed percentModifier, changing base capacity while preserving exact fill percentage. Both fixed modifier and percentModifier may coexist. Do not author attachment needBars or techniqueGrants. Never author attachment status id/appliedAt or techniqueEntry id/provenance.
Choose the mechanical location by who receives the effect and when. An outer ability status is continuously active on its owner and represents an explicitly permanent, unconditional trait with attribute, skill or health modifiers. That trait may be a benefit or a drawback. An activated action, including a temporary self buff, is a technique granted by an outer permanent status. A status containing only existing technique references or new candidate disciplines is a complete grant container. In the technique revision, target kind self, single or area identifies the recipient. Direct harm is a damage effect. A buff or debuff applied on successful use is an effect with a nested status on that recipient; its duration is an integer number of world minutes or -1 for a permanent effect. Combine outer modifiers and a technique when the ability explicitly has both ongoing and activated components. Represent the supported components that follow from the ability description; use <statusEffects/> when there are none.
Passive-only attachment example (replace all example text, identities and values with actual supported mechanics; omit irrelevant fields):
<abilityAttachments><statusEffects><statusEffect><name>PASSIVE_STATUS_NAME</name><description>EXPLICIT_ONGOING_TRAIT</description><duration>-1</duration><attributes><attribute><attribute>ACTUAL_RELEVANT_ATTRIBUTE</attribute><modifier>1</modifier><percentModifier>20</percentModifier></attribute></attributes><skills><skill><skill>ACTUAL_RELEVANT_SKILL</skill><modifier>1</modifier><percentModifier>10</percentModifier></skill></skills><maxHealthPercent>10</maxHealthPercent></statusEffect></statusEffects></abilityAttachments>
Activated-only attachment example (the outer status grants a technique and has no numeric modifiers):
<abilityAttachments><statusEffects><statusEffect><name>TECHNIQUE_GRANT_STATUS_NAME</name><description>EXPLICIT_ABILITY_TO_USE_TECHNIQUE</description><duration>-1</duration><techniques><technique><techniqueId>SELECTED_EXISTING_TECHNIQUE_ID</techniqueId></technique></techniques></statusEffect></statusEffects></abilityAttachments>
${getTechniqueXmlInstructions({ attachmentReferences: true })}`;
}

function buildAbilityFactsPrompt(ability) {
    const mechanicalAbility = Object.fromEntries(['id', 'name', 'description', 'shortDescription', 'type', 'level']
        .filter(field => ability[field] !== undefined).map(field => [field, ability[field]]));
    return `Ability to author:\n${JSON.stringify(mechanicalAbility)}`;
}

function buildAbilityAttachmentPrompt({ actor, ability, setting = {}, pendingAbility = false, selectedTechniqueIds = [] }) {
    const facts = actorFacts(actor);
    const definitions = TechniqueService.getDefinitions();
    const disciplines = TechniqueService.getDisciplines();
    const catalogueOutline = renderTechniqueCatalogueOutline({ definitions, disciplines });
    const techniqueContext = compactTechniquePromptContext(TechniqueService.getPromptContext([actor]).map(context => ({
        ...context, techniques: []
    })));
    // Existing attachments are output being replaced, not evidence that this
    // ability's description grants every old reference again.
    const systemPrompt = `Author executable, setting-grounded mechanics for exactly one ${pendingAbility ? 'offered, unselected' : 'already-owned'} RPG ability. The ability itself is the source of permanent status effects if selected. Each status may grant one or more techniques while that status remains active. Use the existing status-effect and technique systems only. An outer ability status always affects its owner; a technique's effects affect its selected target only after use. Follow the mechanical placement guide below and select mechanics that follow directly from the ability's description. Direct percentage changes to maximum health use maxHealthPercent on a status. Attribute and skill entries may include signed fixed modifier and/or signed percentModifier; 20 means +20%. An ability status must have duration -1. Use exact existing attribute, skill, resource, discipline and technique identities from context; do not invent an actor fact. Reuse an equivalent selected catalogue technique before proposing a new one. The target ability description determines the supported capabilities; other repertoire/catalogue entries and old attachment grants do not establish benefits of this ability. Lookup selection requests information only. Grant a selected existing technique only when its actual mechanics follow directly from this ability. No user action is cast, no cost is paid, and no time advances. No prose outside XML.\n${getAttachmentXmlInstructions()}`;
    const stableContextPrompt = `Actor facts:\n${JSON.stringify(facts)}\nSetting:\n${JSON.stringify(setting)}\nExisting disciplines:\n${JSON.stringify(disciplines)}\nActor technique authoring context:\n${JSON.stringify(techniqueContext)}`;
    const abilityFactsPrompt = buildAbilityFactsPrompt(ability);
    const selectedDetailsPrompt = renderSelectedCatalogueTechniqueDetails(selectedTechniqueIds, { definitions });
    const selectedTechniqueRevisions = Object.fromEntries(selectedTechniqueIds.map(id => [id, definitions.find(definition => definition.id === id).revisions.at(-1).revision]));
    const abilityTaskPrompt = `${abilityFactsPrompt}\nSelected existing lookup IDs: ${selectedTechniqueIds.join(', ') || 'none'}. These are available references, not a requested grant list. Return the complete <abilityAttachments> XML for this one ability, with nested <statusEffects>/<statusEffect>. Put existing references directly in that status's <techniques><technique><techniqueId>SELECTED_ID</techniqueId></technique></techniques>; the server supplies the canonical discipline and latest revision. New candidates use <disciplines>/<discipline>/<techniques>/<technique>/<candidate> and choose their enclosing parent. Use XML children all the way through requirements, costs, effects and formulas. Fixed and percentage modifiers may coexist. Do not include needBars or techniqueGrants on ability statuses. No JSON inside response elements.`;
    return { systemPrompt, generationPrompt: `${stableContextPrompt}\n${selectedDetailsPrompt}\n${abilityTaskPrompt}`, stableContextPrompt, selectedDetailsPrompt, selectedTechniqueRevisions, abilityTaskPrompt, abilityFactsPrompt, catalogueOutline };
}

async function generateAbilityAttachmentDraft(options) {
    if (isTinyBrainPromptEnabled(options.config || {}, LABEL)) {
        const [entry] = await generateAbilityAttachmentDraftBatch({ ...options,
            abilities: [{ abilityId: options.abilityId, pendingAbility: options.pendingAbility || null }] });
        return { draft: entry.draft, expected: entry.expected };
    }
    return await LLMClient.withPromptQueueReservation(queueReservation => (
        LLMClient.withPromptQueueReservationNested(queueReservation, () => generateAbilityAttachmentDraftOwned({ ...options, queueReservation }))
    ));
}

async function generateAbilityAttachmentDraftOwned({ actor, abilityId, pendingAbility = null, config = {}, setting = {}, clientId = null, queueReservation }) {
    const ability = pendingAbility || requireOwnedAbility(actor, abilityId);
    if (pendingAbility && pendingAbility.id !== abilityId) throw new Error('Pending attachment ability ID does not match the requested ID.');
    const expected = TechniqueService.getAbilityAttachmentExpected(actor, [abilityId], { pendingAbility });
    const aiConfig = LLMClient.resolveEffectiveAiConfiguration(LABEL, config).aiConfig;
    const definitions = TechniqueService.getDefinitions();
    let selectedTechniqueIds = [];
    if (definitions.length) {
        const initial = buildAbilityAttachmentPrompt({ actor, ability, setting, pendingAbility: Boolean(pendingAbility) });
        const selectionInstructions = 'Choose existing RPG technique details needed to author this one ability. Use only its described capabilities and actual actor facts. The catalogue outline is a lookup index; selecting an ID requests its authoritative mechanics and does not grant it. Select only plausible equivalent existing techniques or references needed by the ability. Return only child-element XML: <techniqueSelections><techniqueId>EXACT_LISTED_ID</techniqueId></techniqueSelections>. Return <techniqueSelections/> when no existing detail is needed. Do not repeat actor identities, disciplines, names or mechanics.';
        const selectionWrapped = await wrapTaskInBaseContext({ systemPrompt: selectionInstructions,
            taskPrompt: `${initial.stableContextPrompt}\nExisting technique catalogue outline:\n${initial.catalogueOutline}\n${initial.abilityFactsPrompt}` });
        const selectionSystem = selectionWrapped.systemPrompt;
        const selectionPrompt = selectionWrapped.generationPrompt;
        let selectionMessages = [{ role: 'system', content: selectionSystem }, { role: 'user', content: selectionPrompt }];
        const selection = await runPromptWithParseRetries({
            metadataLabel: LABEL, stage: 'catalogue_selection', messages: selectionMessages,
            maxAttempts: resolveConfiguredPromptMaxAttempts(aiConfig),
            complete: async ({ messages: current }) => {
                selectionMessages = current;
                try {
                    return await LLMClient.chatCompletion({ messages: current, metadataLabel: LABEL,
                        metadata: { clientId, phase: 'catalogue_selection' }, queueReservation,
                        validateXML: false, expectedXmlRootTag: 'techniqueSelections', throwOnError: true, allowToolCalls: false,
                        additionalPayload: { tools: [], tool_choice: 'none' } });
                } catch (cause) {
                    await LLMClient.logPrompt({ prefix: 'ability_attachments_selection', metadataLabel: LABEL,
                        systemPrompt: selectionSystem, generationPrompt: selectionPrompt, response: '',
                        sections: [{ title: 'Transport failure', content: cause.stack || cause.message },
                            { title: 'Complete attempt conversation', content: JSON.stringify(current) }] });
                    throw cause;
                }
            },
            parse: response => parseCatalogueTechniqueSelections(response, { definitions }).value,
            buildRetryInstruction: error => `${error.message}\nReturn one corrected techniqueSelections XML document containing only exact listed techniqueId children, or an empty root.`,
            onAttempt: ({ response, error, accepted, attempt }) => LLMClient.logPrompt({
                prefix: 'ability_attachments_selection', metadataLabel: LABEL,
                systemPrompt: selectionSystem, generationPrompt: selectionPrompt, response,
                sections: [{ title: 'Selection validation', content: `${attempt}: ${accepted ? 'accepted' : error.message}` },
                    { title: 'Complete attempt conversation', content: JSON.stringify(selectionMessages) }] })
        });
        selectedTechniqueIds = selection.value;
    }
    const built = buildAbilityAttachmentPrompt({ actor, ability, setting, pendingAbility: Boolean(pendingAbility), selectedTechniqueIds });
    const { selectedDetailsPrompt, selectedTechniqueRevisions, abilityTaskPrompt } = built;
    // The stable actor/catalogue context follows the shared base context so the cached prefix is reused.
    const wrapped = await wrapTaskInBaseContext({ systemPrompt: built.systemPrompt, taskPrompt: built.stableContextPrompt });
    const systemPrompt = wrapped.systemPrompt;
    const generationPrompt = `${wrapped.generationPrompt}\n${selectedDetailsPrompt}\n${abilityTaskPrompt}`;
    const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: wrapped.generationPrompt },
        { role: 'user', content: selectedDetailsPrompt }, { role: 'user', content: abilityTaskPrompt }];
    let attemptMessages = messages;
    const result = await runPromptWithParseRetries({
        metadataLabel: LABEL,
        messages,
        maxAttempts: resolveConfiguredPromptMaxAttempts(aiConfig),
        complete: async ({ messages: current }) => {
            attemptMessages = current;
            try {
                return await LLMClient.chatCompletion({
                    messages: current, metadataLabel: LABEL, metadata: { clientId, phase: 'authoring' }, queueReservation,
                    validateXML: false, xmlSchema: 'ability-attachments-selected.schema.xml', throwOnError: true, allowToolCalls: false,
                    additionalPayload: { tools: [], tool_choice: 'none' }
                });
            } catch (cause) {
                await LLMClient.logPrompt({ prefix: LABEL, metadataLabel: LABEL, systemPrompt, generationPrompt,
                    response: '', sections: [{ title: 'Transport failure', content: cause.stack || cause.message },
                        { title: 'Complete attempt conversation', content: JSON.stringify(current) }] });
                throw cause;
            }
        },
        parse: response => parseAbilityAttachmentDraft(response, { actor, abilityId, pendingAbility, selectedTechniqueIds, selectedTechniqueRevisions }),
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

async function generateAbilityAttachmentDraftBatch({ actor, abilities, config = {}, setting = {}, clientId = null }) {
    if (!Array.isArray(abilities)) throw new TypeError('Ability attachment draft batch requires an abilities array.');
    if (!abilities.length) return [];
    const seen = new Set();
    const requests = abilities.map((request, index) => {
        const abilityId = request?.abilityId;
        if (typeof abilityId !== 'string' || !abilityId.trim() || seen.has(abilityId)) {
            throw new Error(`abilities[${index}].abilityId must be a distinct nonempty ability ID.`);
        }
        seen.add(abilityId);
        const pendingAbility = request.pendingAbility || null;
        if (pendingAbility && pendingAbility.id !== abilityId) throw new Error(`abilities[${index}].pendingAbility.id must match abilityId.`);
        return { abilityId, pendingAbility, ability: pendingAbility || requireOwnedAbility(actor, abilityId) };
    });
    const pending = Boolean(requests[0].pendingAbility);
    if (requests.some(request => Boolean(request.pendingAbility) !== pending)) {
        throw new Error('An ability attachment batch must contain either owned abilities or independent pending options. Submit those groups separately.');
    }
    if (!isTinyBrainPromptEnabled(config, LABEL)) {
        const results = [];
        for (const request of requests) {
            const result = await generateAbilityAttachmentDraft({ actor, abilityId: request.abilityId,
                pendingAbility: request.pendingAbility, config, setting, clientId });
            results.push({ abilityId: request.abilityId, ...result });
        }
        return results;
    }
    return await LLMClient.withPromptQueueReservation(queueReservation => (
        LLMClient.withPromptQueueReservationNested(queueReservation, () => generateTinyBrainAbilityAttachmentBatch({
            actor, requests, pending, config, setting, clientId
        }))
    ));
}

async function generateTinyBrainAbilityAttachmentBatch({ actor, requests, pending, config, setting, clientId }) {
    const aiConfig = LLMClient.resolveEffectiveAiConfiguration(LABEL, config).aiConfig;
    const expected = pending ? null : TechniqueService.getAbilityAttachmentExpected(actor, requests.map(request => request.abilityId));
    const baselines = requests.map(request => TechniqueService.getAbilityAttachmentExpected(actor, [request.abilityId], { pendingAbility: request.pendingAbility }));
    const definitions = TechniqueService.getDefinitions();
    const initial = buildAbilityAttachmentPrompt({ actor, ability: requests[0].ability, setting, pendingAbility: pending });
    const selections = new Map();
    const accepted = new Map();
    const promptEnv = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, 'prompts')), { autoescape: false });
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    const templateContext = {
        abilityAttachmentRequests: requests.map((request, index) => ({ index, name: request.ability.name,
            facts: buildAbilityFactsPrompt(request.ability) })),
        abilityAttachmentHasCatalogue: definitions.length > 0,
        abilityAttachmentAuthoringContext: index => {
            const selected = selections.get(index);
            if (!selected && definitions.length) return '';
            return `${selected?.details || ''}\nSelected existing lookup IDs for this ability: ${selected?.ids.join(', ') || 'none'}. These are available references, not a grant list. Return only this ability's complete <abilityAttachments> XML. Existing references use exact selected IDs; new candidates use the documented discipline/candidate XML. Do not echo the known actor or ability ID.`;
        }
    };
    const tinyBrain = configureTinyBrainPromptContext(templateContext, LABEL);
    const batchInstructions = `${initial.systemPrompt}\nThis is one sequential batch. Each checkpoint concerns exactly the current ability. Previously accepted attachments, selected mechanics, and grants are history for other abilities, never evidence that the current ability grants those benefits. Pending options are mutually exclusive and independent. No attachment has been installed; do not repeat earlier answers. IDs of the actor and current ability are server-owned and must not be echoed.`;
    const wrapped = await wrapTaskInBaseContext({ systemPrompt: batchInstructions,
        taskPrompt: `${initial.stableContextPrompt}\nExisting technique catalogue outline (shared once for the entire batch):\n${initial.catalogueOutline}` });
    const systemPrompt = wrapped.systemPrompt;
    const generationPrompt = wrapped.generationPrompt;
    const initialRenderedTemplate = generationPrompt + '\n' + tinyBrain.renderState.programStartMarker
        + promptEnv.render(tinyBrain.programTemplateName, templateContext);
    await runTinyBrainPromptProgram({
        initialRenderedTemplate, templateContext, tinyBrain,
        runnerOptions: {
            promptEnv,
            parseXMLTemplate: rendered => ({ systemPrompt, generationPrompt: rendered }),
            metadataLabel: LABEL, logPrefix: 'ability_attachments_tinybrain', toolDefinitions: [],
            retryAttempts: resolveConfiguredPromptMaxAttempts(aiConfig) - 1,
            parserOutputContracts: {
                ability_attachment_selection: { xmlOutput: true, expectedXmlRootTag: 'techniqueSelections' },
                ability_attachment_draft: { xmlOutput: true, expectedXmlRootTag: 'abilityAttachments' }
            },
            complete: async ({ messages, queueReservation, checkpoint }) => {
                const authoring = checkpoint.parserName === 'ability_attachment_draft';
                const aiResponse = await LLMClient.chatCompletion({ messages, queueReservation,
                    ...(authoring ? { xmlSchema: 'ability-attachments-selected.schema.xml' } : {}),
                    metadataLabel: LABEL, metadata: { clientId, phase: authoring ? 'authoring' : 'catalogue_selection' },
                    validateXML: false, throwOnError: true, allowToolCalls: false,
                    additionalPayload: { tools: [], tool_choice: 'none' } });
                return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
            },
            parsers: {
                ability_attachment_selection: (response, index) => {
                    if (!requests[index]) throw new Error(`Unknown ability attachment selection index ${index}.`);
                    const ids = parseCatalogueTechniqueSelections(response, { definitions }).value;
                    // Snapshot the mechanics/pins actually supplied at lookup acceptance.
                    const currentDefinitions = TechniqueService.getDefinitions();
                    const details = renderSelectedCatalogueTechniqueDetails(ids, { definitions: currentDefinitions });
                    const revisions = Object.fromEntries(ids.map(id => {
                        const definition = currentDefinitions.find(entry => entry.id === id);
                        if (!definition) throw new Error(`Selected technique ${id} is no longer in the catalogue. Select a current catalogue ID or omit it.`);
                        return [id, definition.revisions.at(-1).revision];
                    }));
                    selections.set(index, { ids, details, revisions });
                    return { value: ids };
                },
                ability_attachment_draft: (response, index) => {
                    const request = requests[index];
                    if (!request) throw new Error(`Unknown ability attachment authoring index ${index}.`);
                    const selected = selections.get(index) || (!definitions.length ? { ids: [], revisions: {} } : null);
                    if (!selected) throw new Error('The current ability requires a successful catalogue lookup before authoring.');
                    const draft = parseAbilityAttachmentDraft(response, { actor, abilityId: request.abilityId,
                        pendingAbility: request.pendingAbility, selectedTechniqueIds: selected.ids, selectedTechniqueRevisions: selected.revisions });
                    const entries = pending ? [{ abilityId: request.abilityId, statusEffects: draft.statusEffects }]
                        : [...accepted.values()].map(entry => ({ abilityId: entry.abilityId, statusEffects: entry.draft.statusEffects }))
                            .concat({ abilityId: request.abilityId, statusEffects: draft.statusEffects });
                    const preview = TechniqueService.previewAbilityAttachmentBatch({ actor, entries,
                        expected: pending ? baselines[index] : { ...expected, abilities: expected.abilities.slice(0, index + 1) },
                        pendingAbility: request.pendingAbility });
                    accepted.set(index, { abilityId: request.abilityId,
                        draft: pending ? { statusEffects: preview.entries[0].statusEffects } : draft,
                        expected: baselines[index] });
                    return { value: true };
                }
            },
            resultBuilders: {
                ability_attachments_result: () => {
                    if (accepted.size !== requests.length) throw new Error('Ability attachment batch ended before every requested ability was authored.');
                    return '<abilityAttachmentsPrepared/>';
                }
            }
        }
    });
    // The final detached check covers changes during the last checkpoint's await.
    if (!pending) TechniqueService.previewAbilityAttachmentBatch({ actor, expected,
        entries: [...accepted.values()].map(entry => ({ abilityId: entry.abilityId, statusEffects: entry.draft.statusEffects })) });
    else for (const [index, entry] of accepted) TechniqueService.previewAbilityAttachmentBatch({ actor,
        entries: [{ abilityId: entry.abilityId, statusEffects: entry.draft.statusEffects }], expected: entry.expected,
        pendingAbility: requests[index].pendingAbility });
    return requests.map((request, index) => accepted.get(index));
}

async function authorNewAbilityAttachments({ actor, abilityIds, draftsByAbilityId = null, config = {}, setting = {}, clientId = null }) {
    if (!Array.isArray(abilityIds) || new Set(abilityIds).size !== abilityIds.length) {
        throw new TypeError('New ability attachment authoring requires distinct ability IDs.');
    }
    if (!abilityIds.length) return [];
    for (const abilityId of abilityIds) requireOwnedAbility(actor, abilityId);
    const expected = TechniqueService.getAbilityAttachmentExpected(actor, abilityIds);
    const entries = [];
    const generated = !draftsByAbilityId && isTinyBrainPromptEnabled(config, LABEL)
        ? new Map((await generateAbilityAttachmentDraftBatch({ actor, abilities: abilityIds.map(abilityId => ({ abilityId })),
            config, setting, clientId })).map(entry => [entry.abilityId, entry]))
        : null;
    for (const abilityId of abilityIds) {
        const { draft } = draftsByAbilityId
            ? { draft: draftsByAbilityId[abilityId] }
            : (generated ? generated.get(abilityId) : await generateAbilityAttachmentDraft({ actor, abilityId, config, setting, clientId }));
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
    generateAbilityAttachmentDraftBatch,
    parseAbilityAttachmentDraft,
    requireOwnedAbility
};
