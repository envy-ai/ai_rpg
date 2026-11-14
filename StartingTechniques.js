'use strict';

const Technique = require('./Technique.js');
const TechniqueService = require('./TechniqueService.js');
const LLMClient = require('./LLMClient.js');
const Utils = require('./Utils.js');
const { parseTechniqueXmlValue, disciplineGroupsSchema, disciplineHeaderSchema, resolveTechniqueDisciplineHeader, flattenTechniqueDisciplineGroups, getTechniqueXmlInstructions } = require('./TechniqueXml.js');
const IdGenerator = require('./IdGenerator.js');
const path = require('path');
const nunjucks = require('nunjucks');
const { TinyBrainPromptExtension } = require('./TinyBrainPromptRunner.js');
const { configureTinyBrainPromptContext, isTinyBrainPromptEnabled, resolveTinyBrainAiConfig, runTinyBrainPromptProgram } = require('./TinyBrainPromptFamilies.js');
const { wrapTaskInBaseContext } = require('./BaseContextTaskPrompt.js');
const { extractTinyBrainXmlResponse } = require('./TinyBrainXmlResponse.js');
const { parseAutomaticTechniqueCandidate } = require('./TechniquePrompt.js');
const { runPromptWithParseRetries, resolveConfiguredPromptMaxAttempts } = require('./PromptRetryPolicy.js');
const { ValidationIssueCollector, withValidationContext } = require('./ResponseValidation.js');

const children = node => Array.from(node?.childNodes || []).filter(child => child.nodeType === 1);
const operationIdFor = actor => `${actor.id}:starting-technique-initialization`;
const provenanceFor = actor => ({ kind: 'generation', reason: `Established initial training of newly created character ${actor.name}.` });

function selectPendingHostileArrivalActors(actors, { destinationId, arrivalId }) {
    Technique.text(destinationId, 'hostile technique destinationId');
    Technique.text(arrivalId, 'hostile technique arrivalId');
    return Array.from(actors.values()).filter(actor => actor.isNPC
        && actor.currentLocation === destinationId
        && actor.hostileArrivalProvenance?.arrivalId === arrivalId
        && !TechniqueService.getReceipt(operationIdFor(actor)));
}

function container(node, allowed) {
    if (node.attributes.length) throw new Error(`<${node.tagName}> cannot have attributes.`);
    if (Array.from(node.childNodes || []).some(child => [3, 4].includes(child.nodeType) && child.nodeValue.trim())) throw new Error(`<${node.tagName}> requires child elements only.`);
    for (const child of children(node)) if (!allowed.includes(child.tagName)) throw new Error(`Unsupported <${child.tagName}> in <${node.tagName}>.`);
}
function field(node, name, required = false) {
    const found = children(node).filter(child => child.tagName === name);
    if (found.length > 1 || (required && found.length !== 1)) throw new Error(`<${node.tagName}> requires ${required ? 'exactly' : 'at most'} one <${name}>.`);
    return found[0];
}
function scalar(node, { optional = false } = {}) {
    const value = node.textContent.trim();
    if (node.attributes.length || children(node).length || (!optional && !value)) throw new Error(`<${node.tagName}> requires nonempty text only.`);
    return value || undefined;
}

/** Strict proposal parsing; IDs and provenance belong to the engine, never the model. */
function parseStartingTechniques(response, { actors, disciplines: stagedDisciplines = TechniqueService.getDisciplines() }) {
    const doc = Utils.parseXmlDocumentStrict(extractTinyBrainXmlResponse(response, 'startingTechniques'), 'text/xml');
    const root = doc.documentElement;
    if (root?.tagName !== 'startingTechniques') throw new Error('Expected <startingTechniques>.');
    container(root, ['actor']);
    const actorMap = new Map(actors.map(actor => [actor.id, actor]));
    const result = new Map();
    const issues = new ValidationIssueCollector();
    const seen = new Set();
    const disciplines = [...stagedDisciplines];
    for (const [actorIndex, node] of children(root).entries()) {
        if (issues.full) break;
        issues.capture(() => {
        try {
        container(node, ['actorId', 'disciplines']);
        const actorId = scalar(field(node, 'actorId', true));
        const actor = actorMap.get(actorId);
        if (!actor || seen.has(actorId)) throw new Error(`Unexpected or duplicate starting-technique actor ${actorId}.`);
        seen.add(actorId);
        const list = field(node, 'disciplines');
        const groups = list ? parseTechniqueXmlValue(list, disciplineGroupsSchema, 'actor.disciplines') : [];
        const entries = flattenTechniqueDisciplineGroups(groups, { disciplines });
        const candidates = new ValidationIssueCollector();
        const techniques = entries.map((entry, index) => candidates.capture(() => {
            try {
            const provenance = provenanceFor(actor);
            if (entry.techniqueId) {
                if (entry.definitionRevision !== undefined) throw new Error('Starting technique references omit definitionRevision; the engine selects the current definition.');
                return { techniqueId: entry.techniqueId, provenance };
            }
            const candidate = parseAutomaticTechniqueCandidate({ ...entry.candidate, id: IdGenerator.next('technique', entry.candidate.name), disciplineId: entry.candidateDiscipline?.id ?? entry.candidate.disciplineId, provenance });
            if (candidate.revisions.length !== 1) throw new Error('A new initial technique must have exactly its first revision.');
            return { candidate, ...(entry.candidateDiscipline ? { candidateDiscipline: entry.candidateDiscipline } : {}), provenance };
            } catch (cause) { throw withValidationContext(cause, `techniques[${index}]`); }
        }));
        candidates.throwIfAny();
        result.set(actorId, techniques);
        } catch (cause) { throw withValidationContext(cause, `startingTechniques.actor[${actorIndex}]`); }
        });
    }
    for (const actor of actors) if (!seen.has(actor.id)) issues.add(new Error(`Starting techniques must include every requested actor exactly once, including empty repertoires. Missing actor ${actor.id}.`));
    issues.throwIfAny();
    return result;
}

/** Compact authoring decisions only; actor facts and mechanical definitions stay in fixed context. */
function parseStartingTechniquePlan(response, { actors }) {
    const doc = Utils.parseXmlDocumentStrict(extractTinyBrainXmlResponse(response, 'startingTechniquePlan'), 'text/xml');
    const root = doc.documentElement;
    if (root?.tagName !== 'startingTechniquePlan') throw new Error('Expected <startingTechniquePlan>.');
    container(root, ['actor']);
    const found = new Map();
    const stagedDisciplines = TechniqueService.getDisciplines();
    for (const node of children(root)) {
        container(node, ['actorId', 'disciplines']);
        const idNode = field(node, 'actorId', actors.length !== 1);
        const actorId = (idNode ? scalar(idNode, { optional: actors.length === 1 }) : undefined) ?? actors[0].id;
        const actor = actors.find(entry => entry.id === actorId);
        if (!actor || found.has(actorId)) throw new Error(`Unexpected or duplicate starting-technique roster actor ${actorId}.`);
        const list = field(node, 'disciplines');
        if (list) container(list, ['discipline']);
        const names = new Set();
        const techniques = [];
        for (const parentNode of children(list)) {
            const headerNode = parentNode.cloneNode(true);
            const rosterNodes = children(headerNode).filter(child => child.tagName === 'techniques');
            if (rosterNodes.length > 1) throw new Error('Roster discipline.techniques must occur at most once; combine its child techniques.');
            for (const child of rosterNodes) headerNode.removeChild(child);
            const header = parseTechniqueXmlValue(headerNode, disciplineHeaderSchema, 'roster.discipline');
            const parent = resolveTechniqueDisciplineHeader(header, { disciplines: stagedDisciplines });
            if (parent.candidateDiscipline && !stagedDisciplines.some(value => value.id === parent.disciplineId)) stagedDisciplines.push(parent.candidateDiscipline);
            const discipline = stagedDisciplines.find(value => value.id === parent.disciplineId);
            if (!rosterNodes.length || !children(rosterNodes[0]).length) throw new Error('Roster discipline.techniques requires at least one technique; omit unused discipline blocks.');
            container(rosterNodes[0], ['technique']);
            for (const entry of children(rosterNodes[0])) {
                container(entry, ['name', 'description']);
                const name = scalar(field(entry, 'name', true));
                const description = scalar(field(entry, 'description', true));
                const key = JSON.stringify([parent.disciplineId, name.toLowerCase()]);
                if (names.has(key)) throw new Error(`Duplicate roster technique ${name} in ${discipline.name} for ${actor.name}.`);
                names.add(key);
                techniques.push({ discipline: discipline.name, disciplineId: discipline.id, ...(parent.candidateDiscipline ? { candidateDiscipline: parent.candidateDiscipline } : {}), name, description });
            }
        }
        found.set(actorId, { actorId, actorName: actor.name, techniques });
    }
    if (found.size !== actors.length) throw new Error('Starting-technique roster must include every requested actor exactly once, including empty repertoires.');
    return actors.map(actor => found.get(actor.id));
}

async function generateStagedStartingTechniques({ actors, config, systemPrompt, generationPrompt, clientId, makeGroups }) {
    const promptEnv = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, 'prompts')), { autoescape: false });
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    const templateContext = { startingTechniqueActors: actors.map(({ id, name }) => ({ id, name })) };
    const tinyBrain = configureTinyBrainPromptContext(templateContext, 'starting_techniques');
    const initialRenderedTemplate = generationPrompt + '\n' + tinyBrain.renderState.programStartMarker
        + promptEnv.render(tinyBrain.programTemplateName, templateContext);
    let roster;
    let prepared;
    let proposals = new Map();
    const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    await runTinyBrainPromptProgram({
        initialRenderedTemplate, templateContext, tinyBrain,
        runnerOptions: {
            promptEnv,
            // The existing fixed facts are already serialized; only the program rerenders.
            parseXMLTemplate: rendered => ({ systemPrompt, generationPrompt: rendered }),
            metadataLabel: 'starting_techniques', logPrefix: 'starting_techniques_tinybrain', toolDefinitions: [],
            retryAttempts: resolveConfiguredPromptMaxAttempts(resolveTinyBrainAiConfig(config, 'starting_techniques')) - 1,
            parserOutputContracts: {
                starting_technique_plan: { xmlOutput: true, expectedXmlRootTag: 'startingTechniquePlan' },
                starting_technique: { xmlOutput: true, expectedXmlRootTag: 'technique' }
            },
            complete: async ({ messages, queueReservation, checkpoint }) => {
                const aiResponse = await LLMClient.chatCompletion({ messages, queueReservation, xmlSchema: checkpoint.parserName === 'starting_technique_plan' ? 'starting-technique-plan.schema.xml' : 'starting-technique.schema.xml', metadataLabel: 'starting_techniques', metadata: { clientId }, validateXML: false, throwOnError: true, allowToolCalls: false, additionalPayload: { tools: [], tool_choice: 'none' } });
                return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
            },
            parsers: {
                starting_technique_plan: response => {
                    const plan = parseStartingTechniquePlan(response, { actors });
                    const empty = TechniqueService.prepareLearningBatch(makeGroups(new Map()));
                    roster = plan;
                    prepared = empty;
                    return { value: plan };
                },
                starting_technique: (response, actorId, index) => {
                    const actor = actors.find(entry => entry.id === actorId);
                    const planned = roster.find(entry => entry.actorId === actorId)?.techniques[index];
                    if (!actor || !planned) throw new Error('Starting-technique checkpoint has no approved roster entry.');
                    try {
                        const disciplines = [...TechniqueService.getDisciplines()];
                        for (const plannedActor of roster) for (const plannedTechnique of plannedActor.techniques) {
                            if (plannedTechnique.candidateDiscipline && !disciplines.some(value => value.id === plannedTechnique.disciplineId)) disciplines.push(plannedTechnique.candidateDiscipline);
                        }
                        for (const entries of proposals.values()) for (const entry of entries) {
                            if (entry.candidateDiscipline && !disciplines.some(value => value.id === entry.candidateDiscipline.id)) disciplines.push(entry.candidateDiscipline);
                        }
                        const xml = extractTinyBrainXmlResponse(response, 'technique');
                        const wrapped = `<startingTechniques><actor><actorId>${escapeXml(actorId)}</actorId><disciplines><discipline><disciplineId>${escapeXml(planned.disciplineId)}</disciplineId><techniques>${xml}</techniques></discipline></disciplines></actor></startingTechniques>`;
                        const parsed = parseStartingTechniques(wrapped, { actors: [actor], disciplines }).get(actorId);
                        if (parsed.length !== 1) throw new Error('Return exactly one <technique>.');
                        const entry = parsed[0];
                        const definition = entry.candidate || TechniqueService.getDefinition(entry.techniqueId);
                        const discipline = entry.candidateDiscipline || disciplines.find(value => value.id === definition?.disciplineId);
                        if (!definition || definition.name.toLowerCase() !== planned.name.toLowerCase()
                            || !discipline || IdGenerator.normalizeName(discipline.name) !== IdGenerator.normalizeName(planned.discipline)) {
                            throw new Error(`Use the approved name ${planned.name} and discipline ${planned.discipline}; do not substitute another roster entry.`);
                        }
                        const next = new Map(proposals);
                        next.set(actorId, [...(proposals.get(actorId) || []), entry]);
                        const nextPrepared = TechniqueService.prepareLearningBatch(makeGroups(next));
                        proposals = next;
                        prepared = nextPrepared;
                        return { value: { actorId, name: planned.name } };
                    } catch (cause) {
                        throw withValidationContext(cause, `Starting technique ${planned.name} (${planned.discipline}) for ${actor.name}`);
                    }
                }
            },
            resultBuilders: {
                starting_techniques_result: () => {
                    for (const actor of roster) if ((proposals.get(actor.actorId)?.length || 0) !== actor.techniques.length) throw new Error(`Incomplete starting-technique roster for ${actor.actorName}.`);
                    return '<startingTechniquesPrepared/>';
                }
            }
        }
    });
    return prepared;
}

function promptFacts(actor) {
    return {
        id: actor.id, name: actor.name, class: actor.class, race: actor.race, description: actor.description,
        level: actor.level, skills: Object.fromEntries(actor.getSkills()),
        attributes: Object.fromEntries(actor.getAttributeNames().map(name => [name, actor.getAttributeModifier(name)])),
        abilities: actor.getAbilities().map(ability => ({
            name: ability.name, description: ability.description,
            statusEffects: (ability.statusEffects || []).map(effect => ({
                name: effect.name, description: effect.description,
                techniqueGrants: (effect.techniqueGrants || []).map(grant => ({
                    techniqueId: grant.techniqueId,
                    definitionRevision: grant.definitionRevision
                }))
            }))
        })),
        needBars: actor.getNeedBars({ scope: 'active' }).map(bar => ({ id: bar.id, name: bar.name, description: bar.description, value: bar.value, min: bar.min, max: bar.max, paymentDirection: bar.paymentDirection })),
        inventory: actor.getInventoryItems().map(item => ({ id: item.id, name: item.name, description: item.description, itemTypeDetail: item.itemTypeDetail, techniqueGrants: item.techniqueGrants.map(grant => ({ id: grant.id, techniqueId: grant.techniqueId, definitionRevision: grant.definitionRevision, teaches: grant.teaches })) })),
        gear: Object.entries(actor.getGear()).map(([slot, value]) => ({ slot, slotType: value.slotType, itemId: value.itemId }))
    };
}

/** Called only by actual new-character construction owners, never save hydration. */
async function generateStartingTechniques({ actors, config = {}, setting = {}, location = null, clientId = null, explicitTechniques = new Map() }) {
    if (!Array.isArray(actors) || new Set(actors.map(actor => actor.id)).size !== actors.length) throw new TypeError('Starting techniques require distinct newly created actors.');
    for (const actor of actors) {
        const receipt = TechniqueService.getReceipt(operationIdFor(actor));
        if (receipt && (receipt.kind !== 'initialization' || receipt.actorId !== actor.id || receipt.techniqueId !== 'starting-techniques')) throw new Error(`Invalid starting-technique completion receipt for ${actor.id}.`);
    }
    const completed = actors.map(actor => TechniqueService.getReceipt(operationIdFor(actor))).filter(Boolean);
    for (const receipt of completed) TechniqueService.retryReceiptNotification(receipt.operationId);
    const pending = actors.filter(actor => !TechniqueService.getReceipt(operationIdFor(actor)));
    if (!pending.length) return completed;
    // Generated corpse/dead-character descriptions do not establish usable learned powers.
    const active = pending.filter(actor => !actor.isDead && !actor.isDisabled && actor.health > 0);
    const makeGroups = proposals => pending.map(actor => {
        const techniques = [...(proposals.get(actor.id) ?? [])];
        for (const techniqueId of active.includes(actor) ? explicitTechniques.get(actor.id) ?? [] : []) {
            if (!techniques.some(entry => entry.techniqueId === techniqueId)) techniques.push({ techniqueId, provenance: provenanceFor(actor) });
        }
        return { actor, operationId: operationIdFor(actor), techniques };
    });
    if (!active.length) return [...completed, ...TechniqueService.commitLearningBatch(TechniqueService.prepareLearningBatch(makeGroups(new Map())))];
    const useTinyBrain = isTinyBrainPromptEnabled(config, 'starting_techniques');
    const taskInstructions = `Author a small, appropriate initial repertoire of executable techniques for newly created characters using only their established class/race/concept, meaningful training, actual abilities, equipment and the world's rules. Ordinary non-specialists may have an empty repertoire. No mandatory count; do not invent backstory, training, access, powers, resource pools, numeric bonuses or an additional currency. Baseline initialized skills (rank 1) alone grant no magical or specialist access. A class/race can qualify only where its actual identity and setting establish that training or inherent capacity; use exact class/race name requirements when needed. Magic is not globally public by default. Equipment and status effect grants provide source-bound access, distinct from learned knowledge. Do not learn or recreate a technique solely to realize an ability whose status effect already grants it. Independent durable learning needs established training or other qualifying facts. These are initial learned techniques, not casts, damage, time advancement or NPC turns. Use current established abilities even when the player still has pending ability choices.\nReuse an equivalent common catalogue technique by discipline and semantic meaning before creating anything, regardless of renamed prose. Reuse existing disciplines. All quantity copies need independent learned state and can share common definitions; unique definitions cannot be shared. For a new common technique in multiple actors, repeat the same semanticKey and discipline identity and the engine shares its definition. Do not make techniques or discipline access depend on other newly proposed techniques. Healing uses semantic recipe choices available for every intended learner; standard damage is an optional resource-backed recipe. Deliberate custom damage and other mechanics retain full costs, checks, prerequisites, effects and valid automatic formulas. The engine supplies known recipe identities, fresh revision 1 and compiled amounts; omit singleton selections it can determine.\n${useTinyBrain ? 'Follow each checkpoint: approve grouped parent metadata and a compact child roster, then expand exactly one technique without repeating known parent facts.' : 'Return strict child-only XML: <startingTechniques><actor><actorId>exact supplied actor ID</actorId><disciplines><discipline>existing parent ID OR new parent metadata<techniques><technique>catalogue techniqueId OR candidate mechanics</technique></techniques></discipline></disciplines></actor></startingTechniques>. Include every requested actor exactly once; an omitted or empty disciplines list is valid.'}\n${getTechniqueXmlInstructions()}\nFor THIS initial response, omit all new IDs/provenance and child disciplineId. Do not output first-use kind, actor name, intent, targets or discoveryIntent. Each new candidate contains only revision 1. Repeated discipline blocks append children in encounter order and reuse the first canonical metadata. Discipline requirements support exact actual class/race names.`;
    const taskFacts = JSON.stringify({
        actors: active.map(promptFacts), techniqueContext: TechniqueService.getPromptContext(active),
        setting: Object.fromEntries(['name', 'description', 'theme', 'genre', 'magicLevel', 'techLevel', 'baseContextPreamble', 'characterGenInstructions'].map(key => [key, setting?.[key]])),
        location: location ? { name: location.name, description: location.description } : null,
        disciplines: TechniqueService.getDisciplines().filter(entry => !entry.provenance?.private),
        catalog: TechniqueService.getDefinitions().filter(entry => !entry.provenance?.private),
        explicitTechniques: Object.fromEntries(active.map(actor => [actor.id, explicitTechniques.get(actor.id) ?? []]))
    });
    // Runs after the shared base context so the cached story prefix is reused.
    const { systemPrompt, generationPrompt } = await wrapTaskInBaseContext({ systemPrompt: taskInstructions, taskPrompt: taskFacts });
    if (useTinyBrain) {
        const prepared = await generateStagedStartingTechniques({ actors: active, config, systemPrompt, generationPrompt, clientId, makeGroups });
        return [...completed, ...TechniqueService.commitLearningBatch(prepared)];
    }
    const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: generationPrompt }];
    let attemptMessages = messages;
    const result = await runPromptWithParseRetries({
        metadataLabel: 'starting_techniques',
        messages, maxAttempts: resolveConfiguredPromptMaxAttempts(config.ai),
        complete: async ({ messages: current }) => {
            attemptMessages = current;
            try {
                return await LLMClient.chatCompletion({ messages: current, xmlSchema: 'starting-techniques.schema.xml', metadataLabel: 'starting_techniques', metadata: { clientId }, validateXML: false, throwOnError: true, allowToolCalls: false, additionalPayload: { tools: [], tool_choice: 'none' } });
            } catch (cause) {
                await LLMClient.logPrompt({ prefix: 'starting_techniques', metadataLabel: 'starting_techniques', systemPrompt, generationPrompt, response: '', sections: [{ title: 'Transport failure', content: cause.stack || cause.message }, { title: 'Complete attempt conversation', content: JSON.stringify(current) }] });
                throw cause;
            }
        },
        parse: response => TechniqueService.prepareLearningBatch(makeGroups(parseStartingTechniques(response, { actors: active }))),
        buildRetryInstruction: error => `Initial technique validation failed: ${error.message}\nCorrect these fields and return the entire <startingTechniques> for every requested actor. No character knowledge or catalogue state was changed.`,
        onAttempt: ({ response, error, accepted, attempt }) => LLMClient.logPrompt({ prefix: 'starting_techniques', metadataLabel: 'starting_techniques', systemPrompt, generationPrompt, response, sections: [{ title: 'Validation', content: `${attempt}: ${accepted ? 'accepted' : error.message}` }, { title: 'Complete attempt conversation', content: JSON.stringify(attemptMessages) }] })
    }).catch(error => {
        const seen = new Set([error]);
        for (let cause = error.cause; cause && !seen.has(cause); cause = cause.cause) {
            seen.add(cause);
            error.stack += `\nCaused by: ${cause.stack || cause.message || cause}`;
        }
        throw error;
    });
    return [...completed, ...TechniqueService.commitLearningBatch(result.value)];
}

module.exports = { generateStartingTechniques, parseStartingTechniques, parseStartingTechniquePlan, operationIdFor, selectPendingHostileArrivalActors };
