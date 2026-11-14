'use strict';

const Technique = require('./Technique.js');
const TechniqueService = require('./TechniqueService.js');
const Utils = require('./Utils.js');
const LLMClient = require('./LLMClient.js');
const { parseTechniqueDisciplineGroupXml, getTechniqueXmlInstructions } = require('./TechniqueXml.js');
const { extractTinyBrainXmlResponse } = require('./TinyBrainXmlResponse.js');
const { runPromptWithParseRetries, resolveConfiguredPromptMaxAttempts } = require('./PromptRetryPolicy.js');
const { projectTechniqueReceiptReport } = require('./TechniqueReport.js');
const { ValidationIssueCollector } = require('./ResponseValidation.js');
const { buildTechniqueCatalogueOutlineGroups, xmlValue } = require('./TechniqueSelectionContext.js');

const children = node => Array.from(node?.childNodes || []).filter(child => child.nodeType === 1);
const content = node => Array.from(node?.childNodes || []).filter(child => child.nodeType === 3 || child.nodeType === 4).map(child => child.nodeValue || '').join('').trim();
function field(node, name, required = false) {
    const fields = children(node).filter(child => child.tagName === name);
    if (fields.length > 1 || (required && fields.length !== 1)) throw new Error(`<${node.tagName}> requires ${required ? 'exactly' : 'at most'} one <${name}>.`);
    return fields[0] || null;
}
function scalar(node, name, required = false) {
    const selected = field(node, name, required);
    if (!selected) return undefined;
    const value = content(selected);
    if (children(selected).length || (required && !value)) throw new Error(`<${name}> requires nonempty text.`);
    return value || undefined;
}
function assertNoAuthoringPlaceholders(value, path) {
    const issues = new ValidationIssueCollector();
    const visit = (value, path) => {
    if (typeof value === 'string') {
        const match = value.match(/\b(?:DISCIPLINE_NAME|DISCIPLINE_DESCRIPTION|TECHNIQUE_NAME|TECHNIQUE_DESCRIPTION|TECHNIQUE_SEMANTIC_KEY|QUALIFYING_FACTS_DESCRIPTION|EXAMPLE_TECHNIQUE_ID|EXAMPLE_DISCIPLINE_ID|ACTUAL_RELEVANT_SKILL|ACTUAL_RELEVANT_ATTRIBUTE|EXACT_APPLICABLE_PROFILE_ID)\b/i);
        if (match) issues.add(new Error(`${path} contains unresolved example placeholder ${match[0]}. Replace it with a meaningful setting-grounded name or the actual qualifying fact; reuse an appropriate existing discipline by ID.`));
    } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            if (issues.full) break;
            visit(child, `${path}.${key}`);
        }
    }
    };
    visit(value, path);
    issues.throwIfAny();
}

function parseAutomaticTechniqueDiscipline(raw, { resolve = false, disciplines } = {}) {
    assertNoAuthoringPlaceholders(raw, 'candidateDiscipline');
    return resolve ? TechniqueService.resolveDiscipline(raw, { disciplines }) : Technique.normalizeDiscipline(raw);
}

function reserveTechniqueDisciplineIdentity(name, reservation) {
    assertNoAuthoringPlaceholders(name, 'discipline.name');
    const generator = require('./IdGenerator.js');
    const nameKey = generator.normalizeName(name);
    if (reservation.disciplineNameKey && reservation.disciplineNameKey !== nameKey) throw new Error('A recognized new discipline cannot change its title identity during correction. Correct the original parent or reference its canonical ID.');
    reservation.disciplineNameKey ??= nameKey;
    const existing = TechniqueService.getDisciplines().filter(value => generator.normalizeName(value.name) === nameKey);
    if (existing.length > 1) throw new Error(`Discipline title ${name} matches multiple canonical IDs: ${existing.map(value => value.id).join(', ')}. Reference one existing ID.`);
    reservation.disciplineId ??= existing[0]?.id ?? generator.nextNamed('discipline', name);
}
function reserveAutomaticTechniqueDiscipline(raw, reservation) {
    assertNoAuthoringPlaceholders(raw, 'discipline');
    reserveTechniqueDisciplineIdentity(raw.name, reservation);
    if (raw.id !== undefined && raw.id !== reservation.disciplineId) throw new Error('Omit new discipline IDs; the engine assigns identity.');
    return TechniqueService.resolveDiscipline({ ...raw, id: reservation.disciplineId });
}

/** Recipe proposals stay raw until an authoritative actor is available to compile them. */
function parseAutomaticTechniqueCandidate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) Technique.assertKeys(raw, [], 'candidate');
    const issues = new ValidationIssueCollector();
    issues.capture(() => assertNoAuthoringPlaceholders(raw, 'candidate'));
    if (Object.hasOwn(raw, 'unique')) issues.add(new Error('candidate.unique is no longer an authoring field. Remove unique; an exact technique ID can be learned by multiple actors.'));
    if (raw.revisions?.length === 1 && raw.revisions[0] && raw.revisions[0].revision === undefined) raw = { ...raw, revisions: [{ ...raw.revisions[0], revision: 1 }] };
    if (raw.provenance?.kind === 'editor') issues.add(new Error('Automatic technique candidates cannot claim editor provenance.'));
    if (!Array.isArray(raw.revisions) || !raw.revisions.some(revision => revision?.recipe !== undefined)) {
        const normalized = issues.capture(() => {
            const candidate = new Technique(raw).toJSON();
            delete candidate.unique;
            return candidate;
        });
        issues.throwIfAny();
        return normalized;
    }
    issues.capture(() => Technique.assertKeys(raw, ['id', 'disciplineId', 'name', 'description', 'shortDescription', 'semanticKey', 'aliases', 'unique', 'provenance', 'revisions'], 'candidate'));
    issues.capture(() => Technique.normalizeShortDescription(raw.shortDescription));
    if (raw.revisions.length !== 1 || raw.revisions[0]?.revision !== 1) issues.add(new Error('A new recipe candidate requires only revision 1. Supply one revision numbered 1, or omit its number.'));
    const revision = raw.revisions[0];
    if (!revision || typeof revision !== 'object' || Array.isArray(revision)) {
        issues.capture(() => Technique.normalizeRevision(revision, 'candidate.revisions[0]'));
        for (const name of ['id', 'disciplineId', 'name', 'description', 'semanticKey']) issues.capture(() => Technique.text(raw[name], `candidate.${name}`));
        issues.throwIfAny();
    }
    if (['costs', 'effects', 'failureCosts', 'balance'].some(field => Object.hasOwn(revision, field))) {
        issues.add(new Error('candidate.revisions[0]: recipe proposals must omit costs, effects, failureCosts and balance. Remove these fields; the engine compiles canonical mechanics from recipe selectors.'));
    }
    // The incompatible recipe fields above are already one rule error; do not
    // report each of them again as an unsupported key.
    issues.capture(() => Technique.assertKeys(revision, ['revision', 'acquisitionRequirements', 'useRequirements', 'target', 'check', 'recipe', 'costs', 'effects', 'failureCosts', 'balance'], 'candidate.revisions[0]'));
    issues.capture(() => require('./TechniqueBalancePolicy.js').validateAuthoringRecipeProposal(revision.recipe));
    issues.capture(() => Technique.normalizeRequirements(revision.acquisitionRequirements, 'candidate.revisions[0].acquisitionRequirements'));
    issues.capture(() => Technique.normalizeRequirements(revision.useRequirements, 'candidate.revisions[0].useRequirements'));
    issues.capture(() => Technique.normalizeCheck(revision.check, 'candidate.revisions[0].check'));
    issues.capture(() => {
        Technique.assertKeys(revision.target, ['kind', 'allowDead'], 'candidate.revisions[0].target');
        if (!['self', 'single', 'area'].includes(revision.target.kind) || (revision.target.allowDead !== undefined && revision.target.allowDead !== false)) throw new Error('candidate.revisions[0].target: standard recipe target requires self, single or area with allowDead omitted or false. Choose a living-target kind; resurrection requires an explicit utility effect.');
    });
    for (const name of ['id', 'disciplineId', 'name', 'description', 'semanticKey']) issues.capture(() => Technique.text(raw[name], `candidate.${name}`));
    issues.capture(() => {
        if (raw.aliases !== undefined && (!Array.isArray(raw.aliases) || raw.aliases.some(alias => typeof alias !== 'string' || !alias.trim()))) throw new Error('candidate.aliases requires nonempty strings.');
    });
    issues.capture(() => Technique.normalizeProvenance(raw.provenance));
    issues.throwIfAny();
    return raw;
}

function parseTechniqueOperation(node, { includeKind = false, onIdentifiedTechnique = null, candidateDefaults = null } = {}) {
    const allowed = new Set(['actor', 'intent', 'techniqueId', 'sourceId', 'weaponItemId', 'utilitySelections', 'targets', 'discipline', 'discoveryIntent', 'operationId', 'newAttempt', ...(includeKind ? ['kind'] : [])]);
    const authoredParent = children(node).find(child => child.tagName === 'discipline');
    const authoredChild = children(children(authoredParent || {}).find(child => child.tagName === 'techniques') || {}).find(child => child.tagName === 'technique');
    const childReference = authoredChild && !children(authoredChild).some(child => child.tagName === 'candidate') ? scalar(authoredChild, 'techniqueId') : undefined;
    if (childReference && onIdentifiedTechnique) onIdentifiedTechnique(childReference);
    if (authoredParent && !childReference) {
        candidateDefaults ??= {};
        // Reserve only from an actual readable candidate title. Malformed native
        // XML or a missing title must not establish a fabricated technique lock.
        const candidates = children(authoredChild || {}).filter(child => child.tagName === 'candidate');
        if (!candidateDefaults.techniqueId && candidates.length === 1) {
            const name = scalar(candidates[0], 'name');
            if (name) {
                assertNoAuthoringPlaceholders(name, 'candidate.name');
                candidateDefaults.techniqueId = require('./IdGenerator.js').next('technique', name);
            }
        }
        if (candidateDefaults.techniqueId) {
            if (onIdentifiedTechnique) onIdentifiedTechnique(candidateDefaults.techniqueId);
            const titleNodes = children(authoredParent).filter(child => child.tagName === 'name');
            if (titleNodes.length === 1 && !children(titleNodes[0]).length && content(titleNodes[0])) reserveTechniqueDisciplineIdentity(content(titleNodes[0]), candidateDefaults);
        }
    }
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
    let techniqueId = scalar(node, 'techniqueId', kind !== 'discover' && !authoredParent);
    if (techniqueId && onIdentifiedTechnique) onIdentifiedTechnique(techniqueId);
    const sourceId = scalar(node, 'sourceId');
    const weaponItemId = scalar(node, 'weaponItemId');
    const utilitySelectionsNode = field(node, 'utilitySelections');
    const utilitySelections = {};
    if (utilitySelectionsNode) {
        if (content(utilitySelectionsNode) || children(utilitySelectionsNode).some(child => child.tagName !== 'selection')) throw new Error('<utilitySelections> requires <selection> children only.');
        for (const selectionNode of children(utilitySelectionsNode)) {
            if (content(selectionNode) || children(selectionNode).some(child => !['effectId', 'destinationId', 'actorId', 'templateId'].includes(child.tagName))) throw new Error('<selection> allows only effectId and the selected destinationId, actorId or templateId.');
            const effectId = scalar(selectionNode, 'effectId', true);
            if (Object.hasOwn(utilitySelections, effectId)) throw new Error(`utilitySelections.${effectId}: duplicate selection. Supply one selection per effect ID.`);
            const selection = {};
            for (const fieldName of ['destinationId', 'actorId', 'templateId']) {
                const value = scalar(selectionNode, fieldName);
                if (value !== undefined) selection[fieldName] = value;
            }
            if (Object.keys(selection).length !== 1) throw new Error(`utilitySelections.${effectId}: select exactly one destinationId, actorId or templateId for this effect.`);
            utilitySelections[effectId] = selection;
        }
    }
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
    const disciplineNode = field(node, 'discipline');
    if (disciplineNode) {
        if (techniqueId) throw new Error('discipline and outer techniqueId are alternatives. Put exactly one child technique in the discipline group, or reference the known techniqueId alone.');
        const group = parseTechniqueDisciplineGroupXml(disciplineNode, {
            maxTechniques: 1,
            ...(candidateDefaults?.techniqueId ? { resolveParent: raw => reserveAutomaticTechniqueDiscipline(raw, candidateDefaults) } : {})
        });
        if (candidateDefaults?.disciplineId && group.disciplineId !== candidateDefaults.disciplineId) throw new Error(`The intended discipline ${candidateDefaults.disciplineId} cannot be replaced during correction. Retain its original parent name or canonical disciplineId.`);
        const entry = group.techniques[0];
        if (entry.definitionRevision !== undefined) throw new Error('discipline.techniques[0].definitionRevision is only for attachment catalogue pins. Omit it in a first-use operation; ordinary source selection supplies the revision.');
        candidateDiscipline = entry.candidateDiscipline;
        if (entry.candidate) {
            const raw = { ...entry.candidate };
            raw.id = candidateDefaults?.techniqueId ?? require('./IdGenerator.js').next('technique', raw.name);
            raw.disciplineId = group.disciplineId;
            raw.provenance = candidateDefaults?.provenance ?? { kind: 'discovery', reason: intent };
            candidate = parseAutomaticTechniqueCandidate(raw);
            techniqueId = candidate.id;
        } else techniqueId = entry.techniqueId;
        if (onIdentifiedTechnique) onIdentifiedTechnique(techniqueId);
    }
    if (kind === 'discover' && !candidate && !techniqueId) throw new Error('Discovery requires a known catalogue techniqueId or a complete validated candidate.');
    const discoveryIntent = scalar(node, 'discoveryIntent');
    if (candidate && techniqueId && candidate.id !== techniqueId) throw new Error('candidate.id must match techniqueId.');
    if (operationId && (candidate || candidateDiscipline || discoveryIntent || kind === 'discover')) throw new Error('A committed operation reference cannot contain discovery or candidate mechanics.');

    return { actor, intent, ...(operationId ? { operationId } : {}), ...(newAttemptText ? { newAttempt: true } : {}), techniqueId: techniqueId || candidate.id, ...(sourceId ? { sourceId } : {}), ...(weaponItemId ? { weaponItemId } : {}), ...(utilitySelectionsNode ? { utilitySelections } : {}), targetIds, ...(kind === 'discover' || discoveryIntent || candidate ? { acquisition: { provenance: { kind: 'discovery', reason: discoveryIntent || intent }, establishDisciplineAccess: true } } : {}), ...(candidate ? { candidate } : {}), ...(candidateDiscipline ? { candidateDiscipline } : {}) };
}
function parseTechniqueIntent(response, options = {}) {
    const xml = extractTinyBrainXmlResponse(response, 'techniqueIntent');
    const document = Utils.parseXmlDocumentStrict(xml, 'text/xml');
    if (document.documentElement?.tagName !== 'techniqueIntent') throw new Error('Expected <techniqueIntent>.');
    return parseTechniqueOperation(document.documentElement, { ...options, includeKind: true });
}
function receiptInvocation(receipt, intent = '') {
    TechniqueService.retryReceiptNotification(receipt.operationId);
    const reported = projectTechniqueReceiptReport(receipt);
    return { id: receipt.operationId, name: 'useTechnique', intent, argumentsObject: { actorId: receipt.actorId, techniqueId: receipt.techniqueId, sourceId: receipt.source?.sourceId, targetIds: receipt.request?.targetIds, ...(receipt.request?.weaponItemId ? { weaponItemId: receipt.request.weaponItemId } : {}), ...(receipt.request?.utilitySelections ? { utilitySelections: receipt.request.utilitySelections } : {}) }, content: `Authoritative committed technique receipt (damage/healing reports rounded to the nearest integer; formula inputs, costs and health values remain exact):\n${JSON.stringify(reported)}`, metadata: { kind: 'technique', techniqueReceipt: receipt, locationRefreshRequested: true } };
}

function ignoredTechniqueInvocation({ actor, techniqueId = null, operationId, intent = '', reason = TechniqueService.getStartBlocker(actor) }) {
    if (!reason) throw new Error('An ignored technique result requires an authoritative actor-state blocker.');
    return { id: operationId, name: 'useTechnique', intent, argumentsObject: { actorId: actor.id, techniqueId },
        content: `Technique attempt ignored: ${reason} No roll, cost, effect or learning occurred. Report the attempted technique as blocked by the actor's current condition and continue the prompt with other possible events.`,
        metadata: { kind: 'technique', ignored: true, actorId: actor.id, techniqueId, reason } };
}

/** Resolve a model-selected reference; execution IDs for new attempts remain server-owned. */
function resolveTechniqueAttemptIdentity({ actor, techniqueId, sourceId, targetIds, weaponItemId, utilitySelections, operationId, newAttempt, turnId }) {
    if (operationId !== undefined && newAttempt !== undefined) throw new Error('operationId and newAttempt are mutually exclusive.');
    if (newAttempt !== undefined && typeof newAttempt !== 'boolean') throw new Error('newAttempt must be boolean.');
    const targetKey = ids => JSON.stringify([...ids].sort());
    const selectionKey = value => JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, selection]) => [key, Object.entries(selection).sort(([a], [b]) => a.localeCompare(b))]));
    const matches = receipt => receipt?.kind === 'use' && receipt.committed === true && receipt.turnId === turnId && receipt.actorId === actor.id && receipt.techniqueId === techniqueId && (sourceId === undefined || receipt.source?.sourceId === sourceId) && (weaponItemId === undefined || receipt.request?.weaponItemId === weaponItemId) && (utilitySelections === undefined || selectionKey(receipt.request?.utilitySelections) === selectionKey(utilitySelections)) && targetKey(receipt.request?.targetIds || receipt.effects.map(effect => effect.targetId).filter((id, index, all) => all.indexOf(id) === index)) === targetKey(targetIds);
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

function getTechniqueCreationInstructions({ includeIntentEnvelope = false } = {}) {
    return `For a qualified novel attempt use one enclosing XML discipline group with its parent ID or new parent metadata outside the child technique mechanics. Omit IDs/provenance for new definitions.\n${getTechniqueXmlInstructions()}\n${includeIntentEnvelope ? 'Novel operation: <techniqueIntent><kind>discover</kind><actor>exact acting name</actor><intent>practical attempt</intent><targets><targetId>exact intended actor ID</targetId></targets><discipline>parent fields followed by techniques/technique/candidate as described above</discipline></techniqueIntent>. Self targets use the acting actor ID.' : ''}`;
}

/** One preparation boundary shared by standard actions and TinyBrain actions. */
async function prepareTechniqueIntent({ actor, actionText, turnId, operationId, explicitUse = null, baseContext, prepareCheck, assessDamageEffectiveness, prepareDestination = null, resolveActor, assertTarget, validatePreview = null, config, clientId = null }) {
    if (!actor || typeof resolveActor !== 'function' || typeof assertTarget !== 'function') throw new Error('Technique intent requires actor and actor/target validators.');
    let identifiedTechnique = null;
    const validateOperation = operation => {
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
        const blocker = TechniqueService.getStartBlocker(actor);
        if (blocker) return { ignored: ignoredTechniqueInvocation({ actor, techniqueId: operation.techniqueId, operationId, intent: operation.intent, reason: blocker }) };
        operation.targetIds.forEach(id => assertTarget(id, actor));
        const options = { ...operation, intent: actionText, actor, turnId, operationId, prepareCheck, assessDamageEffectiveness, ...(operation.acquisition ? { acquisition: operation.acquisition } : operation.candidate ? { acquisition: { provenance: { kind: 'discovery', reason: operation.intent } } } : {}) };
        const preview = TechniqueService.preview(options);
        if (validatePreview) validatePreview(preview, actor);
        return { options, intent: operation.intent };
    };
    if (explicitUse) {
        Technique.assertKeys(explicitUse, ['actorId', 'techniqueId', 'sourceId', 'definitionRevision', 'personalRevision', 'targetIds', 'weaponItemId', 'utilitySelections'], 'techniqueUse');
        if (explicitUse.actorId !== actor.id) throw new Error('The selected technique actor is not controlled by this turn.');
        Technique.text(explicitUse.sourceId, 'techniqueUse.sourceId');
        const replay = TechniqueService.getReceipt(operationId);
        if (replay) {
            if (replay.actorId !== actor.id || replay.techniqueId !== explicitUse.techniqueId || replay.source?.sourceId !== explicitUse.sourceId || JSON.stringify(replay.request?.targetIds) !== JSON.stringify(explicitUse.targetIds) || replay.request?.weaponItemId !== explicitUse.weaponItemId || JSON.stringify(replay.request?.utilitySelections ?? {}) !== JSON.stringify(explicitUse.utilitySelections ?? {})) throw new Error('The retried technique operation differs from its committed receipt.');
            return receiptInvocation(replay, actionText);
        }
        const blocker = TechniqueService.getStartBlocker(actor);
        if (blocker) return ignoredTechniqueInvocation({ actor, techniqueId: explicitUse.techniqueId, operationId, intent: actionText, reason: blocker });
        const source = TechniqueService.resolveSource(actor, explicitUse.techniqueId, explicitUse.sourceId);
        for (const key of ['definitionRevision', 'personalRevision']) if (explicitUse[key] !== undefined && explicitUse[key] !== source[key]) throw new Error(`The selected technique ${key} changed; refresh and select it again.`);
        const pending = validateOperation({ ...explicitUse, expectedDefinitionRevision: explicitUse.definitionRevision, expectedPersonalRevision: explicitUse.personalRevision, actor: actor.name, intent: actionText });
        if (pending.ignored) return pending.ignored;
        if (pending.options && prepareDestination) await prepareDestination(pending.options);
        return receiptInvocation(pending.receipt || TechniqueService.commit(await TechniqueService.prepare(pending.options)), pending.intent);
    }
    const previous = TechniqueService.getReceipt(operationId);
    if (previous) {
        if (previous.actorId !== actor.id || (previous.request?.intent !== undefined && previous.request.intent !== actionText)) throw new Error('Retried technique intent differs from its committed operation.');
        return receiptInvocation(previous, actionText);
    }
    const facts = TechniqueService.getPromptContext([actor]);
    const systemPrompt = `Identify whether the acting character is attempting an executable technique: a concrete practiced spell, maneuver, or other discipline action. Ordinary speech, basic movement, passive equipment, and ordinary weapon attacks are not techniques. A reasonable first technique can be discovered from existing meaningful skills, abilities, training, equipment or story facts; baseline initialized skills alone do not qualify. Never invent qualification. Reuse a semantically equivalent known catalogue definition, regardless of wording. The catalogue lookup gives IDs, names and stored short descriptions only; an exact ID resolves full canonical mechanics on the server. Do not invent omitted catalogue mechanics. Generate new mechanics only when qualified and no equivalent exists. Do not narrate outcomes, roll, charge costs or mutate state. An attempted technique remains a technique when the actor is dead or disabled; authoritative execution will report that blocker. Do not substitute none or ordinary prose to bypass it. For a relevant public catalogue definition the actor has not learned, use kind discover with that exact techniqueId and no candidate or repeated mechanics; it will be learned only with the accepted first attempt. Return strictly valid XML using child elements only and no attributes.\nReturn <techniqueIntent><kind>none</kind></techniqueIntent> when there is no technique. For a known available technique use <techniqueIntent><kind>use</kind><actor>exact acting name</actor><intent>practical attempt</intent><techniqueId>canonical ID</techniqueId><sourceId>exact selected source when needed</sourceId><targets><targetId>exact actor ID</targetId></targets></techniqueIntent>. To discover an existing catalogue self technique use <techniqueIntent><kind>discover</kind><actor>exact acting name</actor><intent>practical self attempt</intent><techniqueId>existing catalogue ID</techniqueId><targets><targetId>exact acting actor ID</targetId></targets></techniqueIntent>. Every use and discover requires actor, intent and targets, including self actions; use exactly the acting actor ID as the sole self target. Target IDs come from authoritative facts. Do not repeat known mechanics in use intents. For weapon-based damage include <weaponItemId>exact equipped ID</weaponItemId> when more than one eligible weapon is equipped. For a utility effect needing an unstored selector use <utilitySelections><selection><effectId>the effect ID</effectId><destinationId>existing location ID</destinationId></selection></utilitySelections>, or actorId/templateId for a summon. Select only IDs present in the supplied facts.\n${getTechniqueCreationInstructions({ includeIntentEnvelope: true })}`;
    const publicContext = {
        actor: { id: actor.id, name: actor.name, class: actor.class, race: actor.race, level: actor.level, description: actor.description, health: actor.health, isDead: actor.isDead, isDisabled: actor.isDisabled, skills: Object.fromEntries(actor.getSkills()), attributes: Object.fromEntries(actor.getAttributeNames().map(name => [name, actor.getAttributeModifier(name)])), abilities: actor.getAbilities(), needBars: actor.getNeedBars({ scope: 'active' }) },
        location: baseContext.currentLocation ? { id: baseContext.currentLocation.id, name: baseContext.currentLocation.name, description: baseContext.currentLocation.description } : null,
        characters: require('./Player.js').getAll().filter(character => (character.isInPlayerParty ? require('./Globals.js').currentPlayer?.currentLocation : character.currentLocation) === (actor.isInPlayerParty ? require('./Globals.js').currentPlayer?.currentLocation : actor.currentLocation)).map(character => ({ id: character.id, name: character.name, description: character.shortDescription || character.description })),
        setting: { genre: baseContext.setting?.genre, description: baseContext.setting?.description },
        techniqueContext: facts,
        catalog: { disciplines: buildTechniqueCatalogueOutlineGroups({
            definitions: TechniqueService.getDefinitions().filter(definition => !definition.provenance?.private && facts.some(context => context.disciplineAccess.some(discipline => discipline.id === definition.disciplineId))),
            disciplines: TechniqueService.getDisciplines().filter(discipline => facts.some(context => context.disciplineAccess.some(access => access.id === discipline.id)))
        }).filter(group => group.techniques.length) }
    };
    const reserved = {};
    const generationPrompt = xmlValue('techniqueIntentContext', { actorId: actor.id, actorName: actor.name, actionText, facts: publicContext });
    const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: generationPrompt }];
    let loggedMessages = messages;
    const result = await runPromptWithParseRetries({
        metadataLabel: 'technique_intent',
        messages,
        maxAttempts: resolveConfiguredPromptMaxAttempts(config?.ai),
        complete: async ({ messages: attemptMessages }) => {
            loggedMessages = attemptMessages;
            try {
                return await LLMClient.chatCompletion({ messages: attemptMessages, metadataLabel: 'technique_intent', xmlSchema: 'technique-intent.schema.xml', metadata: { clientId }, validateXML: false, throwOnError: true, allowToolCalls: false, additionalPayload: { tools: [], tool_choice: 'none' } });
            } catch (cause) {
                await LLMClient.logPrompt({ prefix: 'technique', metadataLabel: 'technique_intent', systemPrompt, generationPrompt, response: '', sections: [{ title: 'Transport failure', content: cause.stack || cause.message }, { title: 'Complete attempt conversation', content: JSON.stringify(attemptMessages) }] });
                throw cause;
            }
        },
        parse: response => {
                reserved.provenance = { kind: 'discovery', reason: actionText };
            return validateOperation(parseTechniqueIntent(response, { candidateDefaults: reserved, onIdentifiedTechnique: techniqueId => {
                if (identifiedTechnique && identifiedTechnique !== techniqueId) throw new Error(`The intended technique ${identifiedTechnique} cannot be replaced after rejected preparation.`);
                identifiedTechnique = techniqueId;
            } }));
        },
        buildRetryInstruction: error => `Technique preparation failed: ${error.message}\nCorrect the field or reference. Return one complete <techniqueIntent>. Invalid preparation has applied no changes. Do not replace an unaffordable intended technique with different invented mechanics; use none only when the action is not a technique.`,
        onAttempt: async ({ response, error, accepted, attempt }) => {
            await LLMClient.logPrompt({ prefix: 'technique', metadataLabel: 'technique_intent', systemPrompt, generationPrompt, response, sections: [{ title: 'Validation', content: `${attempt}: ${accepted ? 'accepted' : error.message}` }, { title: 'Complete attempt conversation', content: JSON.stringify(loggedMessages) }] });
        }
    });
    if (!result.value) return null;
    if (result.value.ignored) return result.value.ignored;
    if (result.value.options && prepareDestination) await prepareDestination(result.value.options);
    return receiptInvocation(result.value.receipt || TechniqueService.commit(await TechniqueService.prepare(result.value.options)), result.value.intent);
}

module.exports = { parseAutomaticTechniqueCandidate, parseAutomaticTechniqueDiscipline, reserveAutomaticTechniqueDiscipline, parseTechniqueOperation, parseTechniqueIntent, prepareTechniqueIntent, receiptInvocation, ignoredTechniqueInvocation, getTechniqueCreationInstructions, resolveTechniqueAttemptIdentity, collectCommittedTechniqueReceipts };
