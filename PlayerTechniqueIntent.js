'use strict';
const Technique = require('./Technique.js');
const TechniqueService = require('./TechniqueService.js');
const Utils = require('./Utils.js');
const { parseTechniqueOperation, getTechniqueCreationInstructions } = require('./TechniquePrompt.js');
const { compactTechniqueActorFacts, compactTechniqueCatalogue } = require('./TechniquePromptContext.js');
const elements = node => Array.from(node?.childNodes || []).filter(child => child.nodeType === 1);
const value = (node, key) => elements(node).find(child => child.tagName === key)?.textContent?.trim();

function getPlayerTechniqueAuthoringInstructions() {
    return `Identify concrete practiced spells, maneuvers and other discipline techniques in the player's committed action before outcome brainstorming. Ordinary dialogue, movement and ordinary weapon attacks need no technique decision or none response. Resolve a technique through useTechnique (standard) or a technique resolution-plan entry (TinyBrain) before prose; never resolve its effects again as ordinary attacks/checks. Reuse available techniques or a relevant public catalogue identity. Catalogue discovery uses discoveryIntent, with no repeated mechanics. Qualified novel attempts use one enclosing discipline group with its existing disciplineId or new metadata, containing exactly one technique/candidate. Never repeat disciplineId in the child or use sibling candidateDiscipline. The engine assigns new IDs and preserves them through correction retries. Native useTechnique supplies the identical XML group as a disciplineXml string; XML plans contain discipline directly. The engine supplies known provenance and fresh revision 1. A new canonical ID is available only after the engine returns its receipt. In one batch, do not repeat a new candidate to represent another use of that same technique; execute it first, then reference the returned canonical ID for follow-up attempts in a later tool round or plan. A recognized rejected technique cannot be omitted, changed into a different technique or replaced by prose-only effects. An attempted technique remains a technique when the actor is dead/disabled; the engine reports that blocker.\n` + getTechniqueCreationInstructions({ serverAssignedIds: true });
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
        if (slot.actorId !== actor.id) {
            if (slot.techniqueId) throw new Error('A recognized technique attempt cannot change acting characters during correction.');
            slot.actorId = actor.id;
        }
        return slot;
    };
    const identify = (slot, id) => {
        if (slot.techniqueId && slot.techniqueId !== id) throw new Error(`The intended technique ${slot.techniqueId} cannot be replaced after rejected preparation.`);
        if (slot.techniqueId) return;
        if (slot.reserved?.techniqueId !== id && !TechniqueService.getDefinition(id)) {
            throw new Error(`technique.techniqueId: Unknown technique ${id}. Use an existing canonical technique ID from the supplied technique catalogue; if no technique is intended, use an ordinary check or attack as appropriate. Ability IDs are not technique IDs.`);
        }
        slot.techniqueId = id;
    };
    const parseNode = (node, key) => {
        const actor = resolveActor(value(node, 'actor'));
        const slot = slotFor(key, actor);
        planSeen?.add(key);
        try {
            const known = value(node, 'techniqueId');
            const rawParent = elements(node).find(child => child.tagName === 'discipline');
            const child = elements(elements(rawParent || {}).find(entry => entry.tagName === 'techniques') || {}).find(entry => entry.tagName === 'technique');
            const childId = child && !elements(child).some(entry => entry.tagName === 'candidate') ? value(child, 'techniqueId') : undefined;
            if (childId) identify(slot, childId);
            else if (rawParent) {
                slot.reserved ||= {};
            } else if (known) identify(slot, known);
            const operation = parseTechniqueOperation(node, {
                candidateDefaults: slot.reserved ? Object.assign(slot.reserved, { provenance: { kind: 'discovery', reason: value(node, 'discoveryIntent') || value(node, 'intent') } }) : null,
                onIdentifiedTechnique: id => identify(slot, id)
            });
            // Keep the mutable reservation across failures and subsequent corrections.
            if (operation.candidate) {
                if (slot.semanticKey && operation.candidate.semanticKey !== slot.semanticKey) throw new Error('A recognized novel technique cannot change semantic identity during correction.');
                slot.semanticKey = operation.candidate.semanticKey;
            }
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
            if (raw.techniqueId) identify(slot, raw.techniqueId);
            try {
                Technique.assertKeys(raw, ['actor', 'techniqueId', 'sourceId', 'targetIds', 'weaponItemId', 'utilitySelections', 'operationId', 'newAttempt', 'intent', 'disciplineXml', 'discoveryIntent'], 'useTechnique');
                const document = Utils.parseXmlDocumentStrict('<technique/>', 'text/xml');
                for (const [name, content] of Object.entries(raw)) {
                    const field = document.createElement(name === 'targetIds' ? 'targets' : name);
                    if (name === 'targetIds' && Array.isArray(content)) {
                        for (const id of content) { const target = document.createElement('targetId'); target.textContent = String(id); field.appendChild(target); }
                    } else if (name === 'utilitySelections') {
                        if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('useTechnique.utilitySelections must be an object keyed by effect ID.');
                        for (const [effectId, selection] of Object.entries(content)) {
                            Technique.assertKeys(selection, ['destinationId', 'actorId', 'templateId'], `useTechnique.utilitySelections.${effectId}`);
                            const entry = document.createElement('selection');
                            const identity = document.createElement('effectId');
                            identity.textContent = effectId;
                            entry.appendChild(identity);
                            for (const [selector, value] of Object.entries(selection)) {
                                if (value === undefined || value === null) continue;
                                if (typeof value !== 'string') throw new Error(`useTechnique.utilitySelections.${effectId}.${selector} must be a text ID.`);
                                const child = document.createElement(selector);
                                child.textContent = value;
                                entry.appendChild(child);
                            }
                            field.appendChild(entry);
                        }
                    } else if (name === 'disciplineXml') {
                        if (typeof content !== 'string' || !content.trim()) throw new Error('useTechnique.disciplineXml requires a nonempty XML discipline group string.');
                        const authored = Utils.parseXmlDocumentStrict(content, 'text/xml').documentElement;
                        if (authored.tagName !== 'discipline') throw new Error('useTechnique.disciplineXml requires exactly one discipline root.');
                        document.documentElement.appendChild(document.importNode(authored, true));
                        continue;
                    } else field.textContent = String(content);
                    document.documentElement.appendChild(field);
                }
                return parseNode(document.documentElement, key);
            } catch (error) {
                slot.error = error; throw error;
            }
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
