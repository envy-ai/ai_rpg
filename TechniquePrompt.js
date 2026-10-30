'use strict';

const Technique = require('./Technique.js');
const TechniqueService = require('./TechniqueService.js');
const Utils = require('./Utils.js');
const LLMClient = require('./LLMClient.js');
const { extractTinyBrainXmlResponse } = require('./TinyBrainXmlResponse.js');
const { runPromptWithParseRetries, resolveConfiguredPromptMaxAttempts } = require('./PromptRetryPolicy.js');

const children = node => Array.from(node.childNodes || []).filter(child => child.nodeType === 1);
const content = node => Array.from(node.childNodes || []).filter(child => child.nodeType === 3 || child.nodeType === 4).map(child => child.nodeValue || '').join('').trim();
function field(node, name, required = false) {
    const fields = children(node).filter(child => child.tagName === name);
    if (fields.length > 1 || (required && fields.length !== 1)) throw new Error(`<${node.tagName}> requires ${required ? 'exactly' : 'at most'} one <${name}>.`);
    return fields[0] || null;
}
function scalar(node, name, required = false) {
    const selected = field(node, name, required);
    if (!selected) return undefined;
    if (children(selected).length || !content(selected)) throw new Error(`<${name}> requires nonempty text.`);
    return content(selected);
}
function assertNoAuthoringPlaceholders(value, path) {
    if (typeof value === 'string') {
        const match = value.match(/\b(?:DISCIPLINE_NAME|DISCIPLINE_DESCRIPTION|TECHNIQUE_NAME|TECHNIQUE_DESCRIPTION|TECHNIQUE_SEMANTIC_KEY|QUALIFYING_FACTS_DESCRIPTION|EXAMPLE_TECHNIQUE_ID|EXAMPLE_DISCIPLINE_ID|ACTUAL_RELEVANT_SKILL|ACTUAL_RELEVANT_ATTRIBUTE|EXACT_APPLICABLE_PROFILE_ID)\b/i);
        if (match) throw new Error(`${path} contains unresolved example placeholder ${match[0]}. Replace it with a meaningful setting-grounded name or the actual qualifying fact; reuse an appropriate existing discipline by ID.`);
    } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) assertNoAuthoringPlaceholders(child, `${path}.${key}`);
    }
}

function parseAutomaticTechniqueDiscipline(raw) {
    assertNoAuthoringPlaceholders(raw, 'candidateDiscipline');
    return Technique.normalizeDiscipline(raw);
}

/** Recipe proposals stay raw until an authoritative actor is available to compile them. */
function parseAutomaticTechniqueCandidate(raw) {
    Technique.assertKeys(raw, ['id', 'disciplineId', 'name', 'description', 'semanticKey', 'aliases', 'unique', 'provenance', 'revisions'], 'candidate');
    assertNoAuthoringPlaceholders(raw, 'candidate');
    if (raw.provenance?.kind === 'editor') throw new Error('Automatic technique candidates cannot claim editor provenance.');
    if (!Array.isArray(raw.revisions) || !raw.revisions.length) throw new Error('candidate.revisions requires a nonempty array.');
    if (!raw.revisions.some(revision => revision?.recipe !== undefined)) return new Technique(raw).toJSON();
    if (raw.revisions.length !== 1 || raw.revisions[0].revision !== 1) throw new Error('A new recipe candidate requires only revision 1.');
    const revision = raw.revisions[0];
    Technique.assertKeys(revision, ['revision', 'acquisitionRequirements', 'useRequirements', 'target', 'check', 'recipe'], 'candidate.revisions[0]');
    require('./TechniqueBalancePolicy.js').validateRecipeProposal(revision.recipe);
    Technique.normalizeRequirements(revision.acquisitionRequirements);
    Technique.normalizeRequirements(revision.useRequirements);
    Technique.normalizeCheck(revision.check);
    Technique.assertKeys(revision.target, ['kind', 'allowDead'], 'candidate.revisions[0].target');
    if (!['self', 'single'].includes(revision.target.kind) || revision.target.allowDead !== false) throw new Error('standard-healing target requires self or single and allowDead false.');
    for (const name of ['id', 'disciplineId', 'name', 'description', 'semanticKey']) Technique.text(raw[name], `candidate.${name}`);
    if (raw.aliases !== undefined && (!Array.isArray(raw.aliases) || raw.aliases.some(alias => typeof alias !== 'string' || !alias.trim()))) throw new Error('candidate.aliases requires nonempty strings.');
    if (raw.unique !== undefined && typeof raw.unique !== 'boolean') throw new Error('candidate.unique must be boolean.');
    Technique.normalizeProvenance(raw.provenance);
    return raw;
}

function parseTechniqueOperation(node, { includeKind = false, onIdentifiedTechnique = null } = {}) {
    const allowed = new Set(['actor', 'intent', 'techniqueId', 'sourceId', 'targets', 'candidate', 'candidateDiscipline', 'discoveryIntent', 'operationId', 'newAttempt', ...(includeKind ? ['kind'] : [])]);
    const visit = current => {
        if (current.attributes?.length) throw new Error(`<${current.tagName}> cannot have attributes; use child elements.`);
        children(current).forEach(visit);
    };
    visit(node);
    if (content(node)) throw new Error(`<${node.tagName}> cannot contain text outside child fields.`);
    for (const child of children(node)) if (!allowed.has(child.tagName)) throw new Error(`<${node.tagName}> contains unsupported <${child.tagName}>.`);
    const kind = includeKind ? scalar(node, 'kind', true) : 'use';
    if (!['none', 'use', 'discover'].includes(kind)) throw new Error('<kind> must be none, use, or discover.');
    if (kind === 'none') {
        if (children(node).some(child => child.tagName !== 'kind')) throw new Error('A none technique intent cannot contain operation fields.');
        return null;
    }
    const actor = scalar(node, 'actor', true);
    const intent = scalar(node, 'intent', true);
    const techniqueId = scalar(node, 'techniqueId', kind !== 'discover');
    if (techniqueId && onIdentifiedTechnique) onIdentifiedTechnique(techniqueId);
    const sourceId = scalar(node, 'sourceId');
    const operationId = scalar(node, 'operationId');
    const newAttemptText = scalar(node, 'newAttempt');
    if (operationId && newAttemptText !== undefined) throw new Error('operationId and newAttempt are mutually exclusive.');
    if (newAttemptText !== undefined && newAttemptText !== 'true') throw new Error('<newAttempt> must contain true when declaring a deliberate new attempt.');
    const targets = field(node, 'targets', true);
    if (content(targets) || children(targets).some(child => child.tagName !== 'targetId' || children(child).length || !content(child))) throw new Error('<targets> requires text-only <targetId> children.');
    const targetIds = children(targets).map(content);
    if (!targetIds.length || new Set(targetIds).size !== targetIds.length) throw new Error('Technique targets must contain one or more distinct actor IDs.');
    let candidate;
    let candidateDiscipline;
    const candidateText = scalar(node, 'candidate');
    const disciplineText = scalar(node, 'candidateDiscipline');
    if (candidateText) {
        const raw = JSON.parse(candidateText);
        if (!techniqueId && typeof raw?.id === 'string' && raw.id.trim() && onIdentifiedTechnique) onIdentifiedTechnique(raw.id);
        candidate = parseAutomaticTechniqueCandidate(raw);
    }
    if (disciplineText) candidateDiscipline = parseAutomaticTechniqueDiscipline(JSON.parse(disciplineText));
    if (kind === 'discover' && !candidate && !techniqueId) throw new Error('Discovery requires a known catalogue techniqueId or a complete validated candidate.');
    const discoveryIntent = scalar(node, 'discoveryIntent');
    if (candidate && techniqueId && candidate.id !== techniqueId) throw new Error('candidate.id must match techniqueId.');
    if (operationId && (candidate || candidateDiscipline || discoveryIntent || kind === 'discover')) throw new Error('A committed operation reference cannot contain discovery or candidate mechanics.');
    if (candidateDiscipline && !candidate) throw new Error('candidateDiscipline requires candidate.');
    return { actor, intent, ...(operationId ? { operationId } : {}), ...(newAttemptText ? { newAttempt: true } : {}), techniqueId: techniqueId || candidate.id, ...(sourceId ? { sourceId } : {}), targetIds, ...(kind === 'discover' || discoveryIntent ? { acquisition: { provenance: { kind: 'discovery', reason: discoveryIntent || intent } } } : {}), ...(candidate ? { candidate } : {}), ...(candidateDiscipline ? { candidateDiscipline } : {}) };
}
function parseTechniqueIntent(response, options = {}) {
    const xml = extractTinyBrainXmlResponse(response, 'techniqueIntent');
    const document = Utils.parseXmlDocumentStrict(xml, 'text/xml');
    if (document.documentElement?.tagName !== 'techniqueIntent') throw new Error('Expected <techniqueIntent>.');
    return parseTechniqueOperation(document.documentElement, { ...options, includeKind: true });
}
function receiptInvocation(receipt, intent = '') {
    TechniqueService.retryReceiptNotification(receipt.operationId);
    return { id: receipt.operationId, name: 'useTechnique', intent, argumentsObject: { actorId: receipt.actorId, techniqueId: receipt.techniqueId, sourceId: receipt.source?.sourceId, targetIds: receipt.request?.targetIds }, content: `Authoritative committed technique receipt:\n${JSON.stringify(receipt)}`, metadata: { kind: 'technique', techniqueReceipt: receipt, locationRefreshRequested: true } };
}

/** Resolve a model-selected reference; execution IDs for new attempts remain server-owned. */
function resolveTechniqueAttemptIdentity({ actor, techniqueId, sourceId, targetIds, operationId, newAttempt, turnId }) {
    if (operationId !== undefined && newAttempt !== undefined) throw new Error('operationId and newAttempt are mutually exclusive.');
    if (newAttempt !== undefined && typeof newAttempt !== 'boolean') throw new Error('newAttempt must be boolean.');
    const targetKey = ids => JSON.stringify([...ids].sort());
    const matches = receipt => receipt?.kind === 'use' && receipt.committed === true && receipt.turnId === turnId && receipt.actorId === actor.id && receipt.techniqueId === techniqueId && (sourceId === undefined || receipt.source?.sourceId === sourceId) && targetKey(receipt.request?.targetIds || receipt.effects.map(effect => effect.targetId).filter((id, index, all) => all.indexOf(id) === index)) === targetKey(targetIds);
    if (operationId !== undefined) {
        const receipt = TechniqueService.getReceipt(Technique.text(operationId, 'operationId reference'));
        if (!matches(receipt)) throw new Error('Technique operationId must reference a committed use in this turn with the same actor, technique, source and targets.');
        return receipt;
    }
    const prior = TechniqueService.getReceiptsForTurn(turnId).filter(matches);
    if (prior.length && newAttempt !== true) throw new Error(`A matching technique attempt is already committed. Reference operationId ${prior.map(receipt => receipt.operationId).join(', ')} or set newAttempt true with an explicit intent for a deliberate new attempt.`);
    return null;
}

function collectCommittedTechniqueReceipts(invocations) {
    const receipts = new Map();
    for (const invocation of invocations) {
        const receipt = invocation?.metadata?.techniqueReceipt;
        if (receipt?.committed === true) receipts.set(receipt.operationId, receipt);
    }
    return [...receipts.values()];
}

function getTechniqueCreationInstructions({ includeIntentEnvelope = false, serverAssignedIds = false } = {}) {
    const candidate = JSON.stringify({
        ...(serverAssignedIds ? {} : { id: 'EXAMPLE_TECHNIQUE_ID', disciplineId: 'EXAMPLE_DISCIPLINE_ID' }),
        name: 'TECHNIQUE_NAME', description: 'TECHNIQUE_DESCRIPTION', semanticKey: 'TECHNIQUE_SEMANTIC_KEY',
        aliases: [], unique: false, provenance: { kind: 'discovery', reason: 'QUALIFYING_FACTS_DESCRIPTION' },
        revisions: [{
            revision: 1,
            acquisitionRequirements: [],
            useRequirements: [],
            target: { kind: 'self', allowDead: false }, check: { kind: 'automatic' },
            recipe: { recipeId: 'standard-healing', skillName: 'ACTUAL_RELEVANT_SKILL', attributeName: 'ACTUAL_RELEVANT_ATTRIBUTE', resourceProfileId: 'EXACT_APPLICABLE_PROFILE_ID', effectId: 'restore' }
        }]
    });
    const nonhealingCandidate = JSON.stringify({
        ...(serverAssignedIds ? {} : { id: 'EXAMPLE_TECHNIQUE_ID', disciplineId: 'EXAMPLE_DISCIPLINE_ID' }),
        name: 'TECHNIQUE_NAME', description: 'TECHNIQUE_DESCRIPTION', semanticKey: 'TECHNIQUE_SEMANTIC_KEY',
        aliases: [], unique: false, provenance: { kind: 'discovery', reason: 'QUALIFYING_FACTS_DESCRIPTION' },
        revisions: [{ revision: 1, acquisitionRequirements: [], useRequirements: [],
            target: { kind: 'single', allowDead: false },
            check: { kind: 'skill', skill: 'ACTUAL_RELEVANT_SKILL', difficulty: 'Medium' },
            costs: [], effects: [{ id: 'strike', kind: 'damage', amount: { formula: 'level' }, damageMode: 'technique' }]
        }]
    });
    const discipline = JSON.stringify({
        ...(serverAssignedIds ? {} : { id: 'EXAMPLE_DISCIPLINE_ID' }), name: 'DISCIPLINE_NAME', description: 'DISCIPLINE_DESCRIPTION',
        accessRequirements: [], publicAccess: false
    });
    return `${serverAssignedIds ? 'For a novel qualified first attempt supply' : 'For a novel qualified first attempt use kind discover and'} <candidate>XML-escaped JSON definition</candidate>, plus <candidateDiscipline>XML-escaped JSON discipline</candidateDiscipline> only if a new discipline is needed. ${serverAssignedIds ? 'The engine assigns new identities; omit candidate.id, candidateDiscipline.id and candidate.disciplineId for a new discipline. Reuse existing disciplineId or catalogue techniqueId only when referencing saved identities.' : 'Use reservedNewIds for new identities; reuse existing IDs for catalogue matches.'} Caller-specific initial-authoring instructions may instead assign IDs/provenance in the engine and use their own outer XML envelope. JSON must use double-quoted keys/strings, balanced braces/brackets, no optional markers, unions, comments or trailing commas. XML-escape ampersands and less-than signs inside JSON text.
A discipline is a named tradition, practice, or field that groups related techniques. Reuse an existing discipline when appropriate, referencing its ID and omitting candidateDiscipline. Otherwise choose a concise, meaningful name grounded in the setting and the character's established training. When an existing skill already names that practice, prefer its name: healing and lightning spells supported by Spellcasting can both belong to Spellcasting. Other categories include Martial Arts and Psionics when justified by the world. Do not name a discipline after one technique, its immediate effect, or generic qualification language such as "Established Practice". Its description explains what the discipline encompasses. Technique names describe the particular move within that category.
The following complete examples illustrate structure only. Replace every placeholder name, description, semantic key, identity, skill, requirement, resource, amount and mechanic with the actor's actual qualifying facts and requested action. Unresolved example placeholders are rejected with correction feedback. Example empty requirement arrays do not establish unrestricted access: supply justified requirements based on actual training, abilities, class/race or other established qualifications. There is no default minimum skill rank of 2; numerical values in requirement shape examples below are illustrative, not suggested thresholds. Do not invent qualifications or set requirements merely to the actor's current rank.
Complete ordinary healing recipe candidate JSON: ${candidate}
Complete nonhealing custom candidate JSON (replace its unpriced mundane example with the actual appropriate mechanics): ${nonhealingCandidate}
Complete candidateDiscipline JSON: ${discipline}
${includeIntentEnvelope ? `Every first-use operation requires outer XML targets containing the intended targets' exact actor IDs. A self technique uses only the acting actor's exact ID. Complete novel self-target discovery envelope (replace example IDs with reservedNewIds and exact acting actor facts): <techniqueIntent><kind>discover</kind><actor>EXACT_ACTOR_NAME</actor><intent>Attempt the practiced restorative technique on myself.</intent><techniqueId>EXAMPLE_TECHNIQUE_ID</techniqueId><targets><targetId>EXACT_ACTOR_ID</targetId></targets><candidate>${candidate}</candidate><candidateDiscipline>${discipline}</candidateDiscipline></techniqueIntent>\n` : ''}Requirement arrays acquisitionRequirements, useRequirements and discipline.accessRequirements contain objects, never strings such as "Spellcasting >= 1". Use [] when no requirement is justified. Supported complete entry shapes are {"kind":"skill","name":"actual skill name","minimum":2}, {"kind":"attribute","name":"actual attribute name","minimum":1}, {"kind":"level","minimum":2}, {"kind":"ability","name":"actual ability name"}, {"kind":"status","name":"actual status name"}, {"kind":"class","name":"exact actual class"}, {"kind":"race","name":"exact actual race"}, {"kind":"equipmentType","name":"actual equipment type"}, {"kind":"discipline","id":"existing discipline ID"}, {"kind":"technique","id":"existing technique ID"}, {"kind":"equippedItem","id":"actual equipped item ID"}, {"kind":"evidence","id":"actual evidence ID"}, and {"kind":"alive"}. An optional boolean present can negate a requirement. Numeric minimum is required only for level, skill and attribute; attribute minimum compares the modifier. Never invent references or a mandatory level gate.
New candidates contain only revision 1. A new ordinary healing revision has acquisitionRequirements, useRequirements, target, check and recipe; omit costs, failureCosts, effects and balance entirely. recipe contains exactly recipeId "standard-healing", skillName, attributeName, resourceProfileId and effectId. Select an actual relevant skill/attribute available to the actor and an applicable resource profile from its balanceAuthoring context. The engine supplies canonical healing, resource costs and saved policy metadata; never invent numeric healing/costs or repeat known level, ranks, modifiers or calculated values. Only self or single-target ordinary healing is supported by this recipe. Area healing, healing mixed with damage/statuses, additional effects/resources and free failure costs require a supported recipe and must be rejected when unavailable. Do not rename healing or label it freeform to bypass this rule. Do not claim editor provenance. For a nonhealing revision, use acquisitionRequirements, useRequirements, target, check, costs, optional failureCosts and nonempty effects. target.kind is self, single or area; allowDead must be false. Check examples: {"kind":"automatic"}, {"kind":"skill","skill":"actual skill","difficulty":"Medium"}, {"kind":"opposed","skill":"actual skill","opposedSkill":"actual opposing skill"}, {"kind":"attack","skill":"actual attack skill","defense":"actual defense"}. Nonautomatic checks may include an actual attribute; opposed checks may include opposedAttribute; attack checks may include attackType and damageType. Every check may include description. Skill difficulty is Trivial, Easy, Medium, Hard, Very Hard or Legendary. Only fields relevant to the chosen check kind are allowed.
Cost entries use {"resource":"health","amount":1} or {"resource":"need","needId":"exact active pool ID","direction":"decrease","amount":1}; need payment direction can also be increase when that actual pool requires it. Health costs omit needId and direction. Omitted failureCosts uses the normal costs; [] means no failure cost. Costs and amounts must be concrete, plausible and proportionate; never guess or create a resource pool.
New healing uses the recipe proposal above. Nonhealing damage example: {"id":"strike","kind":"damage","amount":{"formula":"max(1, level)"},"damageMode":"technique"}. Buff example: {"id":"focus","kind":"buff","status":{"name":"Focus","description":"A temporary practiced focus.","duration":5,"attributes":[],"skills":[{"skill":"actual skill","modifier":1}],"needBars":[]},"stacking":"refresh","refreshPolicy":"stronger","potency":1}. Debuffs use the same status structure with kind debuff. Status modifiers can instead use {"attribute":"actual attribute","modifier":1} in attributes or {"name":"actual active need name","delta":1} in needBars; at least one mechanical modifier is required. Duration is positive integer minutes or -1 for permanent. stacking is refresh or stack; refreshPolicy is stronger, replace or reject; potency is an optional nonnegative number. An effect may override the revision check with its own check object. Damage and debuffs require a nonautomatic check; healing and buffs can be automatic when appropriate. Do not add damageMode to healing/status effects or amount to status effects.
Amount fields accept a number or {"formula":"max(1, level)"}; status modifiers may also be negative. For nonhealing mechanics, formula variables are bound automatically: use only exact keys available in the acting character's formulaVariables (level, skill_<normalized_name>, attribute_<normalized_name>_modifier). Compact contexts provide a key-to-value map per actor and one shared formulaVariableSchema with kind and actual source name; derive that actor's eligible skill/attribute names only from schema keys present in its map. Standalone catalogue rows supply the equivalent facts. Attribute variables are modifiers, not raw scores. Return formula objects without bindings; never repeat known variable values or mappings. A resource name such as mana is not a formula variable. Allowed arithmetic functions are abs, round, floor, ceil, min, max; property access and other functions are unsupported.
Discipline access requirements must identify actual qualifying facts; baseline initialized skills alone do not qualify. publicAccess true is reserved for genuinely universal practiced mundane actions. Different names do not justify unique:true. No arbitrary progression currency, unsupported utility effects or resurrection. Preserve the actor's agency and requested action.`;
}

/** One preparation boundary shared by standard actions and TinyBrain actions. */
async function prepareTechniqueIntent({ actor, actionText, turnId, operationId, explicitUse = null, baseContext, prepareCheck, resolveActor, assertTarget, validatePreview = null, config, clientId = null }) {
    if (!actor || typeof resolveActor !== 'function' || typeof assertTarget !== 'function') throw new Error('Technique intent requires actor and actor/target validators.');
    let identifiedTechnique = null;
    let actorStateError = null;
    const validateOperation = operation => {
        actorStateError = null;
        if (!operation) {
            if (identifiedTechnique) throw new Error(`The intended technique ${identifiedTechnique} was rejected during preparation; it cannot be converted into prose-only mechanics. Correct its references or report the rejection.`);
            return null;
        }
        if (identifiedTechnique && identifiedTechnique !== operation.techniqueId) throw new Error(`The intended technique ${identifiedTechnique} cannot be replaced after rejected preparation.`);
        identifiedTechnique = operation.techniqueId;
        const actingActor = resolveActor(operation.actor);
        if (actingActor.id !== actor.id) throw new Error('Technique intent must use the requested acting character.');
        const reference = resolveTechniqueAttemptIdentity({ ...operation, actor, turnId });
        if (reference) return { receipt: reference, intent: operation.intent };
        try {
            TechniqueService.assertCanStart(actor);
        } catch (error) {
            actorStateError = error;
            throw error;
        }
        operation.targetIds.forEach(id => assertTarget(id, actor));
        const options = { ...operation, intent: actionText, actor, turnId, operationId, prepareCheck, ...(operation.acquisition ? { acquisition: operation.acquisition } : operation.candidate ? { acquisition: { provenance: { kind: 'discovery', reason: operation.intent } } } : {}) };
        const preview = TechniqueService.preview(options);
        if (validatePreview) validatePreview(preview, actor);
        return { options, intent: operation.intent };
    };
    if (explicitUse) {
        Technique.assertKeys(explicitUse, ['actorId', 'techniqueId', 'sourceId', 'definitionRevision', 'personalRevision', 'targetIds'], 'techniqueUse');
        if (explicitUse.actorId !== actor.id) throw new Error('The selected technique actor is not controlled by this turn.');
        Technique.text(explicitUse.sourceId, 'techniqueUse.sourceId');
        const replay = TechniqueService.getReceipt(operationId);
        if (replay) {
            if (replay.actorId !== actor.id || replay.techniqueId !== explicitUse.techniqueId || replay.source?.sourceId !== explicitUse.sourceId || JSON.stringify(replay.request?.targetIds) !== JSON.stringify(explicitUse.targetIds)) throw new Error('The retried technique operation differs from its committed receipt.');
            return receiptInvocation(replay, actionText);
        }
        const source = TechniqueService.resolveSource(actor, explicitUse.techniqueId, explicitUse.sourceId);
        for (const key of ['definitionRevision', 'personalRevision']) if (explicitUse[key] !== undefined && explicitUse[key] !== source[key]) throw new Error(`The selected technique ${key} changed; refresh and select it again.`);
        const pending = validateOperation({ ...explicitUse, expectedDefinitionRevision: explicitUse.definitionRevision, expectedPersonalRevision: explicitUse.personalRevision, actor: actor.name, intent: actionText });
        return receiptInvocation(pending.receipt || TechniqueService.commit(await TechniqueService.prepare(pending.options)), pending.intent);
    }
    const previous = TechniqueService.getReceipt(operationId);
    if (previous) {
        if (previous.actorId !== actor.id || (previous.request?.intent !== undefined && previous.request.intent !== actionText)) throw new Error('Retried technique intent differs from its committed operation.');
        return receiptInvocation(previous, actionText);
    }
    const facts = TechniqueService.getPromptContext([actor]);
    const systemPrompt = `Identify whether the acting character is attempting an executable technique: a concrete practiced spell, maneuver, or other discipline action. Ordinary speech, basic movement, passive equipment, and ordinary weapon attacks are not techniques. A reasonable first technique can be discovered from existing meaningful skills, abilities, training, equipment or story facts; baseline initialized skills alone do not qualify. Never invent qualification. Reuse a semantically equivalent known catalogue definition, regardless of wording. Generate new mechanics only when qualified and no equivalent exists. Do not narrate outcomes, roll, charge costs or mutate state. An attempted technique remains a technique when the actor is dead or disabled; authoritative execution will report that blocker. Do not substitute none or ordinary prose to bypass it. For a relevant public catalogue definition the actor has not learned, use kind discover with that exact techniqueId and no candidate or repeated mechanics; it will be learned only with the accepted first attempt. Return strictly valid XML using child elements only and no attributes.\nReturn <techniqueIntent><kind>none</kind></techniqueIntent> when there is no technique. For a known available technique use <techniqueIntent><kind>use</kind><actor>exact acting name</actor><intent>practical attempt</intent><techniqueId>canonical ID</techniqueId><sourceId>exact selected source when needed</sourceId><targets><targetId>exact actor ID</targetId></targets></techniqueIntent>. To discover an existing catalogue self technique use <techniqueIntent><kind>discover</kind><actor>exact acting name</actor><intent>practical self attempt</intent><techniqueId>existing catalogue ID</techniqueId><targets><targetId>exact acting actor ID</targetId></targets></techniqueIntent>. Every use and discover requires actor, intent and targets, including self actions; use exactly the acting actor ID as the sole self target. Target IDs come from authoritative facts. Do not repeat known mechanics in use intents.\n${getTechniqueCreationInstructions({ includeIntentEnvelope: true })}`;
    const publicContext = {
        actor: { id: actor.id, name: actor.name, class: actor.class, race: actor.race, level: actor.level, description: actor.description, health: actor.health, isDead: actor.isDead, isDisabled: actor.isDisabled, skills: Object.fromEntries(actor.getSkills()), attributes: Object.fromEntries(actor.getAttributeNames().map(name => [name, actor.getAttributeModifier(name)])), abilities: actor.getAbilities(), needBars: actor.getNeedBars({ scope: 'active' }) },
        location: baseContext.currentLocation ? { id: baseContext.currentLocation.id, name: baseContext.currentLocation.name, description: baseContext.currentLocation.description } : null,
        characters: require('./Player.js').getAll().filter(character => (character.isInPlayerParty ? require('./Globals.js').currentPlayer?.currentLocation : character.currentLocation) === (actor.isInPlayerParty ? require('./Globals.js').currentPlayer?.currentLocation : actor.currentLocation)).map(character => ({ id: character.id, name: character.name, description: character.shortDescription || character.description })),
        setting: { genre: baseContext.setting?.genre, description: baseContext.setting?.description },
        techniqueContext: facts,
        catalog: TechniqueService.getDefinitions().filter(definition => !definition.provenance?.private && facts.some(context => context.disciplineAccess.some(discipline => discipline.id === definition.disciplineId)))
    };
    const reserved = { techniqueId: require('./IdGenerator.js').next('technique'), disciplineId: require('./IdGenerator.js').next('discipline') };
    const generationPrompt = JSON.stringify({ actorId: actor.id, actorName: actor.name, actionText, reservedNewIds: reserved, facts: publicContext });
    const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: generationPrompt }];
    let loggedMessages = messages;
    const result = await runPromptWithParseRetries({
        metadataLabel: 'technique_intent',
        messages,
        maxAttempts: resolveConfiguredPromptMaxAttempts(config?.ai),
        complete: async ({ messages: attemptMessages }) => {
            loggedMessages = attemptMessages;
            try {
                return await LLMClient.chatCompletion({ messages: attemptMessages, metadataLabel: 'technique_intent', metadata: { clientId }, validateXML: false, throwOnError: true, allowToolCalls: false, additionalPayload: { tools: [], tool_choice: 'none' } });
            } catch (cause) {
                await LLMClient.logPrompt({ prefix: 'technique', metadataLabel: 'technique_intent', systemPrompt, generationPrompt, response: '', sections: [{ title: 'Transport failure', content: cause.stack || cause.message }, { title: 'Complete attempt conversation', content: JSON.stringify(attemptMessages) }] });
                throw cause;
            }
        },
        parse: response => {
            actorStateError = null;
            return validateOperation(parseTechniqueIntent(response, { onIdentifiedTechnique: techniqueId => {
                if (identifiedTechnique && identifiedTechnique !== techniqueId) throw new Error(`The intended technique ${identifiedTechnique} cannot be replaced after rejected preparation.`);
                identifiedTechnique = techniqueId;
            } }));
        },
        buildRetryInstruction: error => `Technique preparation failed: ${error.message}\nCorrect the field or reference. Return one complete <techniqueIntent>. Invalid preparation has applied no changes. Do not replace an unaffordable intended technique with different invented mechanics; use none only when the action is not a technique.`,
        onAttempt: async ({ response, error, accepted, attempt }) => {
            await LLMClient.logPrompt({ prefix: 'technique', metadataLabel: 'technique_intent', systemPrompt, generationPrompt, response, sections: [{ title: 'Validation', content: `${attempt}: ${accepted ? 'accepted' : error.message}` }, { title: 'Complete attempt conversation', content: JSON.stringify(loggedMessages) }] });
            // The model cannot repair authoritative actor state. Preserve the original
            // rejection after logging instead of entering another correction attempt.
            if (error && error === actorStateError) throw error;
        }
    });
    if (!result.value) return null;
    return receiptInvocation(result.value.receipt || TechniqueService.commit(await TechniqueService.prepare(result.value.options)), result.value.intent);
}

module.exports = { parseAutomaticTechniqueCandidate, parseAutomaticTechniqueDiscipline, parseTechniqueOperation, parseTechniqueIntent, prepareTechniqueIntent, receiptInvocation, getTechniqueCreationInstructions, resolveTechniqueAttemptIdentity, collectCommittedTechniqueReceipts };
