'use strict';

const TechniqueService = require('./TechniqueService.js');
const Technique = require('./Technique.js');
const Utils = require('./Utils.js');
const { parseTechniqueXmlValue } = require('./TechniqueXml.js');
const { compactTechniquePromptContext, compactTechniqueActorFacts, compactTechniqueCatalogue } = require('./TechniquePromptContext.js');
const { extractTinyBrainXmlResponse } = require('./TinyBrainXmlResponse.js');

const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const normalized = value => value.trim().toLowerCase();

function actorsFromTechniqueContext(context) {
    const Player = require('./Player.js');
    const ids = new Set([
        ...Object.keys(context.techniqueSummaries || {}), context.currentPlayer?.id,
        ...(context.npcs || []).map(actor => actor.id), ...(context.party || []).map(actor => actor.id)
    ].filter(Boolean));
    return [...ids].map(id => {
        const actor = Player.getById(id);
        if (!actor) throw new Error(`Technique selection actor ${id} is no longer present in this world. Rebuild the prompt context before continuing.`);
        return actor;
    });
}

function localTechniqueActors() {
    const Player = require('./Player.js');
    const player = require('./Globals.js').currentPlayer;
    if (!player) throw new Error('Technique detail lookup requires a current player.');
    const party = new Set(player.getPartyMembers());
    return Player.getAll().filter(actor => actor.id === player.id || party.has(actor.id) || actor.currentLocation === player.currentLocation);
}

function resolveTechniqueSelection(selection, { actors } = {}) {
    Technique.assertKeys(selection, ['actor', 'technique', 'kind'], 'technique selection');
    if (!Array.isArray(actors)) throw new TypeError('Technique selection requires the prompt actor roster.');
    const actorText = Technique.text(selection.actor, 'technique selection.actor');
    const techniqueText = Technique.text(selection.technique, 'technique selection.technique');
    if (selection.kind !== undefined && selection.kind !== null && typeof selection.kind !== 'string') throw new TypeError('technique selection.kind must be text: use or discover; omit it for use.');
    const kind = selection.kind?.trim() || 'use';
    if (!['use', 'discover'].includes(kind)) throw new Error('technique selection.kind must be use for an existing reference or discover for an explicitly proposed acquisition.');
    const playerId = require('./Globals.js').currentPlayer?.id;
    const isPlayerAlias = ['player', 'the player', 'you'].includes(normalized(actorText));
    const exactActors = actors.filter(actor => actor.id === (isPlayerAlias ? playerId : actorText));
    const matches = isPlayerAlias || exactActors.length ? exactActors : actors.filter(actor => [actor.name, ...(actor.getAliases?.() || [])].some(name => normalized(name) === normalized(actorText)));
    if (matches.length !== 1) throw new Error(`technique selection.actor "${actorText}" ${matches.length ? 'is ambiguous' : 'is not in the supplied scene'}. Select one exact character name or ID: ${actors.map(actor => `${actor.name} (${actor.id})`).join(', ')}.`);
    const actor = matches[0];
    const available = TechniqueService.getAvailable(actor, { includeBlocked: true });
    const known = new Set(available.map(technique => technique.techniqueId));
    const disciplines = new Set(TechniqueService.getEffectiveDisciplineAccess(actor).map(value => value.id));
    const catalogue = TechniqueService.getDefinitions().filter(definition => known.has(definition.id)
        || (kind === 'discover' && definition.provenance?.private !== true && disciplines.has(definition.disciplineId)));
    const exact = catalogue.filter(definition => definition.id === techniqueText);
    const techniques = exact.length ? exact : catalogue.filter(definition => [definition.name, ...definition.aliases].some(name => normalized(name) === normalized(techniqueText)));
    if (techniques.length > 1) throw new Error(`technique selection.technique "${techniqueText}" is ambiguous for ${actor.name}. Select one canonical ID: ${techniques.map(value => `${value.name} (${value.id}, ${TechniqueService.getDiscipline(value.disciplineId).name})`).join(', ')}.`);
    if (!techniques.length && techniqueText.toLowerCase().startsWith('technique_')) throw new Error(`technique selection.technique ${techniqueText} is an unknown or inaccessible canonical ID. Correct the existing ID; for an explicitly novel discovery, provide its intended human-readable name instead of inventing an ID.`);
    if (!techniques.length && kind !== 'discover') throw new Error(`technique selection.technique "${techniqueText}" is not a known technique for ${actor.name}. Correct the name/ID using ${available.map(value => `${value.name} (${value.techniqueId})`).join(', ') || 'the actor\'s actual repertoire'}, or explicitly choose kind discover only for an intended qualified new acquisition.`);
    return { actorId: actor.id, actorName: actor.name, kind, requestedTechnique: techniqueText, techniqueId: techniques[0]?.id ?? null };
}

function parseTechniqueSelections(response, { actors } = {}) {
    const xml = extractTinyBrainXmlResponse(response, ['techniqueSelections']);
    const document = Utils.parseXmlDocumentStrict(xml, 'text/xml');
    const root = document.documentElement;
    if (root.tagName !== 'techniqueSelections') throw new Error('Technique selection requires one techniqueSelections root.');
    const entries = parseTechniqueXmlValue(root, { tag: 'selection', item: { actor: 'text', technique: 'text', kind: { optionalEmptyLeaf: 'text' } } }, 'techniqueSelections');
    const seen = new Set();
    const selections = entries.map(entry => {
        const selection = resolveTechniqueSelection(entry, { actors });
        const key = `${selection.actorId}:${selection.kind}:${selection.techniqueId || normalized(selection.requestedTechnique)}`;
        if (seen.has(key)) throw new Error(`techniqueSelections contains a duplicate selection for ${selection.actorName}: ${selection.requestedTechnique}. List each selected reference once.`);
        seen.add(key);
        return selection;
    });
    return { value: selections, normalizedResponse: xml };
}

// These are named domain lists, not a JSON object embedded in an XML leaf.
const itemNames = { sources: 'source', techniques: 'technique', catalogue: 'technique', disciplineAccess: 'discipline',
    costs: 'cost', failureCosts: 'cost', calculations: 'calculation', effects: 'effect', acquisitionRequirements: 'requirement', useRequirements: 'requirement',
    attributes: 'attribute', skills: 'skill', needBars: 'needBar', techniqueGrants: 'grant', blockers: 'blocker',
    chargeItems: 'item', weaponItems: 'weapon', resourceProfiles: 'profile', recipes: 'recipe', improvementSteps: 'step',
    destinations: 'destination', summonTemplates: 'template', summonActors: 'actor', deadTargets: 'target',
    abilities: 'ability', statusEffects: 'status', evidence: 'entry', aliases: 'alias',
    actors: 'actor', disciplines: 'discipline', catalog: 'technique', inventory: 'item', gear: 'slot' };
function xmlValue(name, value) {
    if (value === undefined || value === null) return `<${name}/>`;
    if (Array.isArray(value)) return `<${name}>${value.map(entry => xmlValue(itemNames[name] || 'entry', entry)).join('')}</${name}>`;
    if (typeof value === 'object') return `<${name}>${Object.entries(value).map(([key, entry]) =>
        /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? xmlValue(key, entry) : `<entry><key>${escape(key)}</key>${xmlValue('value', entry)}</entry>`).join('')}</${name}>`;
    return `<${name}>${escape(value)}</${name}>`;
}

function buildTechniqueCatalogueOutlineGroups({ definitions = TechniqueService.getDefinitions(), disciplines = TechniqueService.getDisciplines() } = {}) {
    const byDiscipline = new Map(disciplines.map(discipline => [discipline.id, []]));
    for (const definition of definitions) {
        const group = byDiscipline.get(definition.disciplineId);
        if (!group) throw new Error(`Technique catalogue ${definition.id} references missing discipline ${definition.disciplineId}. Repair the catalogue before authoring techniques.`);
        const shortDescription = definition.shortDescription?.trim();
        group.push({ id: definition.id, name: String(definition.name).replace(/\s+/g, ' ').trim(),
            ...(shortDescription ? { shortDescription: shortDescription.replace(/\s+/g, ' ') } : {}) });
    }
    const line = value => String(value).replace(/\s+/g, ' ').trim();
    return disciplines.map(discipline => ({ id: discipline.id, name: line(discipline.name),
        techniques: byDiscipline.get(discipline.id) }));
}

function renderTechniqueCatalogueOutline(options = {}) {
    return buildTechniqueCatalogueOutlineGroups(options).map(discipline => [
        `${discipline.id} (${JSON.stringify(discipline.name)}):`,
        ...discipline.techniques.map(definition => (
            `  ${definition.id} (${JSON.stringify(definition.name)})`
            + (definition.shortDescription ? ` - ${definition.shortDescription}` : '')
        ))
    ].join('\n')).join('\n');
}

function parseCatalogueTechniqueSelections(response, { definitions = TechniqueService.getDefinitions() } = {}) {
    const xml = extractTinyBrainXmlResponse(response, 'techniqueSelections');
    const document = Utils.parseXmlDocumentStrict(xml, 'text/xml');
    if (document.documentElement.tagName !== 'techniqueSelections') throw new Error('Catalogue selection requires one techniqueSelections root.');
    const ids = parseTechniqueXmlValue(document.documentElement, { tag: 'techniqueId', item: 'text' }, 'techniqueSelections');
    const known = new Set(definitions.map(definition => definition.id));
    const seen = new Set();
    ids.forEach((id, index) => {
        if (!known.has(id)) throw new Error(`techniqueSelections.techniqueId[${index}] ${id} is not a listed catalogue ID. Select an exact technique ID from the outline, or return <techniqueSelections/> when no existing detail is relevant.`);
        if (seen.has(id)) throw new Error(`techniqueSelections.techniqueId[${index}] repeats ${id}. List each lookup ID once.`);
        seen.add(id);
    });
    return { value: ids, normalizedResponse: xml };
}

function renderSelectedCatalogueTechniqueDetails(techniqueIds, { definitions = TechniqueService.getDefinitions() } = {}) {
    if (!Array.isArray(techniqueIds)) throw new TypeError('Selected catalogue details require a list of technique IDs.');
    const byId = new Map(definitions.map(definition => [definition.id, definition]));
    const selected = techniqueIds.map(id => {
        const definition = byId.get(id);
        if (!definition) throw new Error(`Selected catalogue technique ${id} no longer exists. Rebuild the lookup selection before authoring.`);
        return definition;
    });
    return `<selectedCatalogueTechniqueDetails>${xmlValue('techniques', compactTechniqueCatalogue(selected))}</selectedCatalogueTechniqueDetails>`;
}

function renderSelectedTechniqueDetails(selections, { actors, purpose = 'use' } = {}) {
    if (!Array.isArray(selections) || !Array.isArray(actors)) throw new TypeError('Technique detail rendering requires selections and the authoritative actor roster.');
    if (!selections.length) return '';
    const byActor = new Map();
    for (const selection of selections) {
        const actor = actors.find(value => value.id === selection.actorId);
        if (!actor) throw new Error(`Technique detail actor ${selection.actorId} left the supplied scene.`);
        const checked = resolveTechniqueSelection({ actor: actor.id, technique: selection.techniqueId || selection.requestedTechnique, kind: selection.kind }, { actors });
        if (!byActor.has(actor.id)) byActor.set(actor.id, { actor, selections: [] });
        byActor.get(actor.id).selections.push(checked);
    }
    const groups = [...byActor.values()].map(group => {
        const full = TechniqueService.getPromptContext([group.actor])[0];
        const ids = new Set(group.selections.map(value => value.techniqueId).filter(Boolean));
        const authoring = purpose === 'authoring' || group.selections.some(value => value.kind === 'discover');
        const selected = full.techniques.filter(value => ids.has(value.techniqueId));
        const effects = selected.flatMap(value => value.sources.flatMap(source => source.mechanics.effects));
        return { ...group, authoring, full, selected,
            needsUtility: authoring || effects.some(effect => ['teleport', 'summon', 'resurrection'].includes(effect.kind)),
            needsWeapon: authoring || effects.some(effect => effect.damageMode === 'weapon'),
            needsCharges: authoring || selected.some(value => value.sources.some(source => source.costs.some(cost => cost.resource === 'charge') || source.failureCosts.some(cost => cost.resource === 'charge'))) };
    });
    const compact = compactTechniquePromptContext(groups.map(group => ({ ...group.full, techniques: group.selected,
        utilityContext: group.needsUtility ? group.full.utilityContext : {} })));
    const shared = xmlValue('formulaVariableSchema', compact.formulaVariableSchema)
        + (groups.some(group => group.authoring) ? xmlValue('balancePolicies', compact.balancePolicies) : '')
        + (groups.some(group => group.needsUtility) ? xmlValue('utilityCatalog', compact.utilityCatalog) : '');
    const blocks = groups.map(({ actor, selections: selected, authoring, full, needsUtility, needsWeapon, needsCharges }) => {
        const facts = compact.actors.find(value => value.actorId === actor.id);
        const accessible = new Set(full.disciplineAccess.map(value => value.id));
        const catalogue = authoring ? { disciplines: buildTechniqueCatalogueOutlineGroups({
            definitions: TechniqueService.getDefinitions().filter(value => value.provenance?.private !== true && accessible.has(value.disciplineId)),
            disciplines: TechniqueService.getDisciplines().filter(value => accessible.has(value.id))
        }).filter(group => group.techniques.length) } : null;
        const acquisitionIds = selected.filter(value => value.techniqueId && !full.techniques.some(technique => technique.techniqueId === value.techniqueId)).map(value => value.techniqueId);
        const acquisitionDefinitions = compactTechniqueCatalogue(acquisitionIds.map(id => TechniqueService.getDefinition(id)));
        const qualification = authoring ? compactTechniqueActorFacts({ id: actor.id, name: actor.name, class: actor.class, race: actor.race,
            description: actor.description, health: actor.health, maxHealth: actor.maxHealth, isDead: actor.isDead, isDisabled: actor.isDisabled,
            abilities: actor.getAbilities(), needBars: actor.getNeedBars({ scope: 'active' }) }, { includeFormulaFacts: false })
            : { id: actor.id, name: actor.name, health: actor.health, maxHealth: actor.maxHealth, isDead: actor.isDead, isDisabled: actor.isDisabled };
        return '<character>' + xmlValue('qualification', qualification) + xmlValue('formulaVariables', facts.formulaVariables)
            + (authoring ? xmlValue('balanceAuthoring', facts.balanceAuthoring) + xmlValue('disciplineAccess', facts.disciplineAccess) : '')
            + (needsCharges ? xmlValue('chargeItems', facts.chargeItems) : '')
            + (needsWeapon ? xmlValue('weaponItems', facts.weaponItems) : '')
            + (needsUtility ? xmlValue('utilityContext', facts.utilityContext) : '')
            + xmlValue('techniques', facts.techniques.map(value => ({ ...value, ...(authoring ? { evidence: actor.techniques.find(entry => entry.techniqueId === value.techniqueId)?.evidence || [] } : {}) })))
            + (acquisitionDefinitions.length ? xmlValue('catalogueAcquisitions', acquisitionDefinitions) : '')
            + (authoring ? xmlValue('catalogue', catalogue) : '')
            + xmlValue('proposedTechniques', selected.filter(value => !value.techniqueId).map(value => ({ name: value.requestedTechnique, acquisition: 'Proposed only; qualification, authoring and acquisition remain subject to normal validation.' }))) + '</character>';
    });
    return `<selectedTechniqueDetails>${shared}${blocks.join('\n')}</selectedTechniqueDetails>\nThese are current read-only authoritative facts, not committed attempts; this snapshot supersedes earlier facts for the same actor/technique. Use exact canonical IDs and source pins; blockers remain binding. The catalogue list is an identity lookup, and exact IDs resolve canonical mechanics on the server. Do not copy known mechanics into a new candidate. Resolve an attempted use through the existing technique executor before narrating its outcome; authoring selections do not themselves cast or learn anything.`;
}

function getTechniqueSelectionInstructions({ purpose = 'use' } = {}) {
    return `${purpose === 'authoring' ? 'Identify only techniques whose completed learning, personal improvement or meaningful evidence needs authoring in the checked events. This is not a request to cast or re-resolve a committed technique.' : 'Before planning mechanics, identify any technique the player or responding characters actually intend to attempt, including techniques newly introduced by the latest draft.'} Select only references whose full facts are needed now. The server supplies the full authoritative information next; do not repeat statistics or mechanics. Use exact character names/aliases/IDs and technique names/aliases/IDs. kind use (or omission) looks up an existing owned/granted technique; choose from that actor's <techniques> list, using a shown ID to disambiguate names; ability names alone are not technique references. kind discover explicitly requests qualification/authoring facts for a new acquisition or accessible catalogue technique. An unknown use is an error, not permission to invent a technique. Ordinary actions require no selection. Output only child-element XML: <techniqueSelections><selection><actor>exact character</actor><technique>exact technique</technique><kind>use or discover</kind></selection></techniqueSelections>. Return <techniqueSelections/> when no new detail is needed. Never return JSON or known mechanics.`;
}

async function requestTechniqueAuthoringDetails({ baseContext, textToCheck, actionText = '', LLMClient, maxAttempts, timeoutMs }) {
    const actors = actorsFromTechniqueContext(baseContext);
    const summaries = TechniqueService.getTechniqueSummaries(actors);
    const roster = actors.map(actor => `<character><id>${escape(actor.id)}</id><name>${escape(actor.name)}</name><techniques>${summaries[actor.id].map(value => `* ${escape(value.name)}${value.techniqueId ? ` [${escape(value.techniqueId)}]` : ''}${value.shortDescription ? ` - ${escape(value.shortDescription)}` : ''}`).join('\n')}</techniques></character>`).join('\n');
    const systemPrompt = 'Select technique authoring references from completed story events. Return strict child-only XML. Never invent mechanics, repeat a committed cast, or apply changes.';
    const generationPrompt = `<characters>${roster}</characters>\n<playerAction>${escape(actionText)}</playerAction>\n<textToCheck>${escape(textToCheck)}</textToCheck>\n${getTechniqueSelectionInstructions({ purpose: 'authoring' })}`;
    const { runPromptWithParseRetries } = require('./PromptRetryPolicy.js');
    let requestMessages = [];
    const attempt = await runPromptWithParseRetries({
        metadataLabel: 'event_checks', maxAttempts,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: generationPrompt }],
        complete: ({ messages }) => {
            requestMessages = messages;
            return LLMClient.chatCompletion({ messages, metadataLabel: 'event_checks', timeoutMs,
                expectedXmlRootTag: 'techniqueSelections', validateXML: false, throwOnError: true });
        },
        parse: response => parseTechniqueSelections(response, { actors }).value,
        buildRetryInstruction: error => `${error.message}\nReturn one corrected techniqueSelections XML document. Use an empty techniqueSelections element when no completed technique authoring is supported.`,
        onAttempt: ({ response, error, accepted }) => LLMClient.logPrompt({ prefix: 'event_technique_selection', metadataLabel: 'event_checks',
            systemPrompt, generationPrompt: requestMessages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n'),
            response: response || '', sections: [{ title: 'Selection validation', content: accepted ? 'accepted' : error?.stack || String(error) }] })
    });
    return renderSelectedTechniqueDetails(attempt.value, { actors, purpose: 'authoring' });
}

module.exports = { actorsFromTechniqueContext, localTechniqueActors, resolveTechniqueSelection, parseTechniqueSelections,
    renderSelectedTechniqueDetails, getTechniqueSelectionInstructions, requestTechniqueAuthoringDetails,
    buildTechniqueCatalogueOutlineGroups, renderTechniqueCatalogueOutline,
    parseCatalogueTechniqueSelections, renderSelectedCatalogueTechniqueDetails, xmlValue };
