'use strict';
const Technique = require('./Technique.js');
const TechniqueService = require('./TechniqueService.js');
const IdGenerator = require('./IdGenerator.js');
const Utils = require('./Utils.js');
const { parseTechniqueOperation, getTechniqueCreationInstructions } = require('./TechniquePrompt.js');
const { compactTechniqueActorFacts, compactTechniqueCatalogue } = require('./TechniquePromptContext.js');
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const elements = node => Array.from(node.childNodes || []).filter(child => child.nodeType === 1);
const value = (node, key) => elements(node).find(child => child.tagName === key)?.textContent?.trim();

function getPlayerTechniqueAuthoringInstructions() {
    return `Identify concrete practiced spells, maneuvers and other discipline techniques in the player's committed action before outcome brainstorming. Ordinary dialogue, movement and ordinary weapon attacks need no technique decision or none response. Resolve a technique through useTechnique (standard) or a technique resolution-plan entry (TinyBrain) before prose; never resolve its effects again as ordinary attacks/checks. Reuse available techniques or a relevant public catalogue identity. Catalogue discovery uses discoveryIntent, with no repeated mechanics. Qualified novel attempts use candidate JSON and optional candidateDiscipline JSON. The engine assigns new IDs: omit candidate.id, candidateDiscipline.id and, for a NEW discipline, candidate.disciplineId. For an existing discipline, retain its canonical disciplineId. Do not supply techniqueId for a novel candidate. IDs stay stable through correction retries. Native tools take JSON strings; XML takes XML-escaped JSON. A new canonical ID is available only after the engine returns its receipt. In one batch, do not repeat a new candidate to represent another use of that same technique; execute it first, then reference the returned canonical ID for follow-up attempts in a later tool round or plan. A recognized rejected technique cannot be omitted, changed into a different technique or replaced by prose-only effects. An attempted technique remains a technique when the actor is dead/disabled; the engine reports that blocker.\n` + getTechniqueCreationInstructions({ serverAssignedIds: true });
}

function getPlayerTechniqueAuthoringContext(actors, { sharedTechniqueContext = null } = {}) {
    if (sharedTechniqueContext !== null && (!Array.isArray(sharedTechniqueContext.actors)
        || !Array.isArray(sharedTechniqueContext.formulaVariableSchema) || !sharedTechniqueContext.balancePolicies)) {
        throw new TypeError('Shared technique context requires compact actors, formula variable schema and balance policies.');
    }
    const sharedActors = new Map((sharedTechniqueContext?.actors || []).map(actor => [actor.actorId, actor]));
    const missingActors = actors.filter(actor => !sharedActors.has(actor.id));
    const techniqueContext = TechniqueService.getCompactPromptContext(missingActors);
    const actorContexts = [...actors.filter(actor => sharedActors.has(actor.id)).map(actor => sharedActors.get(actor.id)), ...techniqueContext.actors];
    const accessible = new Set(actorContexts.flatMap(context => context.disciplineAccess.map(entry => entry.id)));
    return {
        actors: actors.map(actor => compactTechniqueActorFacts({ id: actor.id, name: actor.name, class: actor.class, race: actor.race, description: actor.description, health: actor.health, maxHealth: actor.maxHealth, isDead: actor.isDead, isDisabled: actor.isDisabled, abilities: actor.getAbilities(), needBars: actor.getNeedBars({ scope: 'active' }) }, { includeFormulaFacts: false })),
        ...(missingActors.length || sharedTechniqueContext === null ? { techniqueContext } : {}),
        catalog: compactTechniqueCatalogue(TechniqueService.getDefinitions().filter(definition => !definition.provenance?.private && accessible.has(definition.disciplineId)))
    };
}

function createPlayerTechniqueSession({ resolveActor, resolveAttackOperation = null }) {
    if (typeof resolveActor !== 'function') throw new TypeError('Player technique session requires an actor resolver.');
    const slots = new Map();
    let planSeen = null;
    const slotFor = (key, actor) => {
        let slot = slots.get(key);
        if (!slot) { slot = { key, actorId: actor.id, committed: false }; slots.set(key, slot); }
        if (slot.actorId !== actor.id) throw new Error('A recognized technique attempt cannot change acting characters during correction.');
        return slot;
    };
    const identify = (slot, id) => {
        if (slot.techniqueId && slot.techniqueId !== id) throw new Error(`The intended technique ${slot.techniqueId} cannot be replaced after rejected preparation.`);
        slot.techniqueId = id;
    };
    const parseNode = (node, key) => {
        const actor = resolveActor(value(node, 'actor'));
        const slot = slotFor(key, actor);
        planSeen?.add(key);
        const set = (name, text) => {
            let field = elements(node).find(child => child.tagName === name);
            if (!field) { field = node.ownerDocument.createElement(name); node.appendChild(field); }
            field.textContent = text;
        };
        try {
            const known = value(node, 'techniqueId');
            const rawCandidate = value(node, 'candidate');
            if (known && !rawCandidate) identify(slot, known);
            if (rawCandidate) {
                slot.reserved ||= { techniqueId: IdGenerator.next('technique'), disciplineId: IdGenerator.next('discipline') };
                identify(slot, slot.reserved.techniqueId);
                const candidate = JSON.parse(rawCandidate);
                if (known && known !== slot.reserved.techniqueId) throw new Error('Omit techniqueId for a novel candidate; the engine assigns its identity.');
                if (candidate.id !== undefined && candidate.id !== slot.reserved.techniqueId) throw new Error('Omit a novel candidate.id; the engine assigns its identity.');
                if (slot.semanticKey && candidate.semanticKey !== slot.semanticKey) throw new Error('A recognized novel technique cannot change semantic identity during correction.');
                candidate.id = slot.reserved.techniqueId;
                const rawDiscipline = value(node, 'candidateDiscipline');
                if (rawDiscipline) {
                    const discipline = JSON.parse(rawDiscipline);
                    if (discipline.id !== undefined && discipline.id !== slot.reserved.disciplineId) throw new Error('Omit a new candidateDiscipline.id; the engine assigns its identity.');
                    if (candidate.disciplineId !== undefined && candidate.disciplineId !== slot.reserved.disciplineId) throw new Error('Omit candidate.disciplineId when creating a new discipline.');
                    discipline.id = candidate.disciplineId = slot.reserved.disciplineId;
                    set('candidateDiscipline', JSON.stringify(discipline));
                }
                set('candidate', JSON.stringify(candidate));
                set('techniqueId', candidate.id);
            }
            const operation = parseTechniqueOperation(node, { onIdentifiedTechnique: id => identify(slot, id) });
            if (operation.candidate) slot.semanticKey = operation.candidate.semanticKey;
            slot.error = null;
            return operation;
        } catch (error) { slot.error = error; throw error; }
    };
    return {
        parseNode,
        attackOperation(name, args) {
            if (!['resolveAttack', 'resolveAreaAttack'].includes(name) || !resolveAttackOperation) return null;
            return resolveAttackOperation(name, args);
        },
        nativeKey(raw, operationId) {
            resolveActor(raw.actor || raw.actorId);
            const pending = [...slots.values()].find(slot => slot.key.startsWith('native:') && !slot.committed && slot.techniqueId);
            if (pending) return pending.key;
            return `native:${operationId}`;
        },
        normalizeNative(raw, key) {
            const actor = resolveActor(raw.actor || raw.actorId);
            const slot = slotFor(key, actor);
            if (raw.candidate !== undefined) {
                slot.reserved ||= { techniqueId: IdGenerator.next('technique'), disciplineId: IdGenerator.next('discipline') };
                identify(slot, slot.reserved.techniqueId);
            } else if (raw.techniqueId) identify(slot, raw.techniqueId);
            try {
                Technique.assertKeys(raw, ['actor', 'techniqueId', 'sourceId', 'targetIds', 'operationId', 'newAttempt', 'intent', 'candidate', 'candidateDiscipline', 'discoveryIntent'], 'useTechnique');
                const fields = Object.entries(raw).map(([name, content]) => {
                    if (name === 'targetIds') return `<targets>${Array.isArray(content) ? content.map(id => `<targetId>${escape(id)}</targetId>`).join('') : escape(content)}</targets>`;
                    const text = ['candidate', 'candidateDiscipline'].includes(name) && typeof content !== 'string' ? JSON.stringify(content) : content;
                    return `<${name}>${escape(text)}</${name}>`;
                }).join('');
                const document = Utils.parseXmlDocumentStrict(`<technique>${fields}</technique>`, 'text/xml');
                return parseNode(document.documentElement, key);
            } catch (error) { slot.error = error; throw error; }
        },
        parsePlan(response, { checkpointId, completedCount = 0 }) {
            if (!Number.isInteger(checkpointId) || !Number.isInteger(completedCount) || completedCount < 0) throw new Error('Technique resolution planning requires a checkpoint identity and completed count.');
            const { parsePlayerActionResolutionPlan } = require('./PlayerActionResolutionPlan.js');
            const prefix = `plan:${checkpointId}:`;
            this.beginPlan();
            const parsed = parsePlayerActionResolutionPlan(response, { parseTechnique: (node, index) => {
                const attemptKey = `${prefix}${completedCount + index}`;
                return { operation: parseNode(node, attemptKey), attemptKey };
            } });
            for (const [index, action] of parsed.value.entries()) {
                const operation = this.attackOperation(action.functionName, action.argumentsObject);
                if (!operation) continue;
                const attemptKey = `${prefix}${completedCount + index}`;
                action.argumentsObject = this.normalizeNative(operation, attemptKey);
                action.functionName = 'useTechnique';
                action.techniqueAttemptKey = attemptKey;
            }
            this.finishPlan(prefix);
            return parsed;
        },
        beginPlan() { planSeen = new Set(); },
        finishPlan(prefix) {
            const seen = planSeen;
            planSeen = null;
            for (const slot of slots.values()) if (slot.key.startsWith(prefix) && slot.techniqueId && !slot.committed && !seen?.has(slot.key)) throw slot.error || new Error(`The intended technique ${slot.techniqueId} cannot be omitted from the corrected resolution plan.`);
        },
        reject(key, error) { const slot = slots.get(key); if (slot) slot.error = error; },
        commit(key) { const slot = slots.get(key); if (slot) { slot.committed = true; slot.error = null; } },
        assertComplete() {
            for (const slot of slots.values()) if (slot.techniqueId && !slot.committed) throw slot.error || new Error(`The intended technique ${slot.techniqueId} was not resolved; prose cannot replace its mechanics.`);
        }
    };
}
module.exports = { createPlayerTechniqueSession, getPlayerTechniqueAuthoringContext, getPlayerTechniqueAuthoringInstructions };
