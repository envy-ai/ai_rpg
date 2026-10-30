'use strict';

const Technique = require('./Technique.js');
const TechniqueService = require('./TechniqueService.js');
const LLMClient = require('./LLMClient.js');
const Utils = require('./Utils.js');
const IdGenerator = require('./IdGenerator.js');
const path = require('path');
const nunjucks = require('nunjucks');
const { TinyBrainPromptExtension } = require('./TinyBrainPromptRunner.js');
const { configureTinyBrainPromptContext, isTinyBrainPromptEnabled, resolveTinyBrainAiConfig, runTinyBrainPromptProgram } = require('./TinyBrainPromptFamilies.js');
const { extractTinyBrainXmlResponse } = require('./TinyBrainXmlResponse.js');
const { getTechniqueCreationInstructions, parseAutomaticTechniqueCandidate, parseAutomaticTechniqueDiscipline } = require('./TechniquePrompt.js');
const { runPromptWithParseRetries, resolveConfiguredPromptMaxAttempts } = require('./PromptRetryPolicy.js');

const children = node => Array.from(node.childNodes || []).filter(child => child.nodeType === 1);
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
function scalar(node) {
    if (node.attributes.length || children(node).length || !node.textContent.trim()) throw new Error(`<${node.tagName}> requires nonempty text only.`);
    return node.textContent.trim();
}

/** Strict proposal parsing; IDs and provenance belong to the engine, never the model. */
function parseStartingTechniques(response, { actors, disciplines: stagedDisciplines = TechniqueService.getDisciplines() }) {
    const doc = Utils.parseXmlDocumentStrict(extractTinyBrainXmlResponse(response, 'startingTechniques'), 'text/xml');
    const root = doc.documentElement;
    if (root?.tagName !== 'startingTechniques') throw new Error('Expected <startingTechniques>.');
    container(root, ['actor']);
    const actorMap = new Map(actors.map(actor => [actor.id, actor]));
    const result = new Map();
    const disciplines = [...stagedDisciplines];
    for (const node of children(root)) {
        container(node, ['actorId', 'techniques']);
        const actorId = scalar(field(node, 'actorId', true));
        const actor = actorMap.get(actorId);
        if (!actor || result.has(actorId)) throw new Error(`Unexpected or duplicate starting-technique actor ${actorId}.`);
        const list = field(node, 'techniques', true);
        container(list, ['technique']);
        const techniques = [];
        for (const entry of children(list)) {
            container(entry, ['techniqueId', 'candidate', 'candidateDiscipline']);
            const id = field(entry, 'techniqueId');
            const candidateNode = field(entry, 'candidate');
            const disciplineNode = field(entry, 'candidateDiscipline');
            if (Boolean(id) === Boolean(candidateNode) || (id && disciplineNode)) throw new Error('<technique> requires either techniqueId or candidate, with candidateDiscipline only for a candidate.');
            const provenance = provenanceFor(actor);
            if (id) {
                techniques.push({ techniqueId: scalar(id), provenance });
                continue;
            }
            const raw = JSON.parse(scalar(candidateNode));
            if (Object.hasOwn(raw, 'id') || Object.hasOwn(raw, 'provenance')) throw new Error('Candidate IDs and provenance are assigned by the engine; omit them.');
            let candidateDiscipline;
            if (disciplineNode) {
                const rawDiscipline = JSON.parse(scalar(disciplineNode));
                if (Object.hasOwn(rawDiscipline, 'id') || Object.hasOwn(rawDiscipline, 'provenance') || Object.hasOwn(raw, 'disciplineId')) throw new Error('A new candidateDiscipline omits id/provenance; its candidate omits disciplineId.');
                const matching = disciplines.find(discipline => discipline.name.toLowerCase() === String(rawDiscipline.name).trim().toLowerCase());
                const normalized = parseAutomaticTechniqueDiscipline({ ...rawDiscipline, id: matching?.id ?? IdGenerator.next('discipline') });
                if (matching) {
                    if (JSON.stringify(normalized.accessRequirements) !== JSON.stringify(matching.accessRequirements) || normalized.publicAccess !== matching.publicAccess) throw new Error(`Reuse discipline ${matching.id} with its existing access requirements.`);
                    candidateDiscipline = matching;
                } else {
                    candidateDiscipline = normalized;
                    disciplines.push(normalized);
                }
            }
            const candidate = parseAutomaticTechniqueCandidate({ ...raw, id: IdGenerator.next('technique'), disciplineId: candidateDiscipline?.id ?? raw.disciplineId, provenance });
            if (candidate.revisions.length !== 1) throw new Error('A new initial technique must have exactly its first revision.');
            techniques.push({ candidate, ...(candidateDiscipline ? { candidateDiscipline } : {}), provenance });
        }
        result.set(actorId, techniques);
    }
    if (result.size !== actors.length) throw new Error('Starting techniques must include every requested actor exactly once, including empty repertoires.');
    return result;
}

/** Compact authoring decisions only; actor facts and mechanical definitions stay in fixed context. */
function parseStartingTechniquePlan(response, { actors }) {
    const doc = Utils.parseXmlDocumentStrict(extractTinyBrainXmlResponse(response, 'startingTechniquePlan'), 'text/xml');
    const root = doc.documentElement;
    if (root?.tagName !== 'startingTechniquePlan') throw new Error('Expected <startingTechniquePlan>.');
    container(root, ['actor']);
    const found = new Map();
    for (const node of children(root)) {
        container(node, ['actorId', 'techniques']);
        const idNode = field(node, 'actorId', actors.length !== 1);
        const actorId = idNode ? scalar(idNode) : actors[0].id;
        const actor = actors.find(entry => entry.id === actorId);
        if (!actor || found.has(actorId)) throw new Error(`Unexpected or duplicate starting-technique roster actor ${actorId}.`);
        const list = field(node, 'techniques', true);
        container(list, ['technique']);
        const names = new Set();
        const techniques = children(list).map(entry => {
            container(entry, ['discipline', 'name', 'description']);
            const values = Object.fromEntries(['discipline', 'name', 'description'].map(key => [key, scalar(field(entry, key, true))]));
            const key = JSON.stringify([values.discipline.toLowerCase(), values.name.toLowerCase()]);
            if (names.has(key)) throw new Error(`Duplicate roster technique ${values.name} in ${values.discipline} for ${actor.name}.`);
            names.add(key);
            return values;
        });
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
            complete: async ({ messages, queueReservation }) => {
                const aiResponse = await LLMClient.chatCompletion({ messages, queueReservation, metadataLabel: 'starting_techniques', metadata: { clientId }, validateXML: false, throwOnError: true, allowToolCalls: false, additionalPayload: { tools: [], tool_choice: 'none' } });
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
                        for (const entries of proposals.values()) for (const entry of entries) {
                            if (entry.candidateDiscipline && !disciplines.some(value => value.id === entry.candidateDiscipline.id)) disciplines.push(entry.candidateDiscipline);
                        }
                        const xml = extractTinyBrainXmlResponse(response, 'technique');
                        const wrapped = `<startingTechniques><actor><actorId>${escapeXml(actorId)}</actorId><techniques>${xml}</techniques></actor></startingTechniques>`;
                        const parsed = parseStartingTechniques(wrapped, { actors: [actor], disciplines }).get(actorId);
                        if (parsed.length !== 1) throw new Error('Return exactly one <technique>.');
                        const entry = parsed[0];
                        const definition = entry.candidate || TechniqueService.getDefinition(entry.techniqueId);
                        const discipline = entry.candidateDiscipline || disciplines.find(value => value.id === definition?.disciplineId);
                        if (!definition || definition.name.toLowerCase() !== planned.name.toLowerCase()
                            || discipline?.name.toLowerCase() !== planned.discipline.toLowerCase()) {
                            throw new Error(`Use the approved name ${planned.name} and discipline ${planned.discipline}; do not substitute another roster entry.`);
                        }
                        const next = new Map(proposals);
                        next.set(actorId, [...(proposals.get(actorId) || []), entry]);
                        const nextPrepared = TechniqueService.prepareLearningBatch(makeGroups(next));
                        proposals = next;
                        prepared = nextPrepared;
                        return { value: { actorId, name: planned.name } };
                    } catch (cause) {
                        throw new Error(`Starting technique ${planned.name} (${planned.discipline}) for ${actor.name}: ${cause.message}`, { cause });
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
    const systemPrompt = `Author a small, appropriate initial repertoire of executable techniques for newly created characters using only their established class/race/concept, meaningful training, actual abilities, equipment and the world's rules. Ordinary non-specialists may have an empty repertoire. No mandatory count; do not invent backstory, training, access, powers, resource pools, numeric bonuses or an additional currency. Baseline initialized skills (rank 1) alone grant no magical or specialist access. A class/race can qualify only where its actual identity and setting establish that training or inherent capacity; use exact class/race name requirements when needed. Magic is not globally public by default. Equipment and status effect grants provide source-bound access, distinct from learned knowledge. Do not learn or recreate a technique solely to realize an ability whose status effect already grants it. Independent durable learning needs established training or other qualifying facts. These are initial learned techniques, not casts, damage, time advancement or NPC turns. Use current established abilities even when the player still has pending ability choices.\nReuse an equivalent common catalogue technique by discipline and semantic meaning before creating anything, regardless of renamed prose. Reuse existing disciplines. All quantity copies need independent learned state and can share common definitions; unique definitions cannot be shared. For a new common technique in multiple actors, repeat the same semanticKey and discipline identity and the engine shares its definition. Do not make techniques or discipline access depend on other newly proposed techniques. New healing must select a standard-healing recipe and actual skill/attribute/resource profile available for every intended learner; the engine supplies its numbers. Other mechanics contain full costs, checks, prerequisites, effects, and valid automatic formula variables from each actor's supplied catalogue.\n${useTinyBrain ? 'Follow each current checkpoint output format: first the compact roster, then exactly one technique. Do not return an all-actor batch.' : 'Return strict child-only XML: <startingTechniques><actor><actorId>exact supplied actor ID</actorId><techniques><technique><techniqueId>existing catalogue ID</techniqueId></technique><technique><candidate>XML-escaped strict JSON</candidate><candidateDiscipline>optional XML-escaped strict JSON</candidateDiscipline></technique></techniques></actor></startingTechniques>. Include every requested actor exactly once; an empty <techniques/> is valid. Never repeat already known facts as separate answers.'}\n${getTechniqueCreationInstructions()}\nFor THIS initial-authoring response, omit candidate id/provenance; the engine supplies them. For a novel discipline also omit candidateDiscipline id/provenance AND candidate.disciplineId; the engine assigns its identity. Otherwise use the exact existing disciplineId. Do not output kind, actor name, intent, targets, discoveryIntent or reservedNewIds from the first-use format above. A new candidate contains only revision 1. Discipline access requirements additionally support {"kind":"class","name":"exact actual class"} and {"kind":"race","name":"exact actual race"}.`;
    const generationPrompt = JSON.stringify({
        actors: active.map(promptFacts), techniqueContext: TechniqueService.getPromptContext(active),
        setting: Object.fromEntries(['name', 'description', 'theme', 'genre', 'magicLevel', 'techLevel', 'baseContextPreamble', 'characterGenInstructions'].map(key => [key, setting?.[key]])),
        location: location ? { name: location.name, description: location.description } : null,
        disciplines: TechniqueService.getDisciplines().filter(entry => !entry.provenance?.private),
        catalog: TechniqueService.getDefinitions().filter(entry => !entry.provenance?.private),
        explicitTechniques: Object.fromEntries(active.map(actor => [actor.id, explicitTechniques.get(actor.id) ?? []]))
    });
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
                return await LLMClient.chatCompletion({ messages: current, metadataLabel: 'starting_techniques', metadata: { clientId }, validateXML: false, throwOnError: true, allowToolCalls: false, additionalPayload: { tools: [], tool_choice: 'none' } });
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
