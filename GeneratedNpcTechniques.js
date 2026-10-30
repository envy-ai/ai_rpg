'use strict';

const TechniqueService = require('./TechniqueService.js');

const children = node => Array.from(node.childNodes || []).filter(child => child.nodeType === 1);

function initializationError(message, cause) {
    // Cancellation identity is used by the runtime drain/abort owners.
    if (['PROMPT_CANCELLED', 'ERR_CANCELED'].includes(cause?.code) || ['PromptCancellationError', 'AbortError'].includes(cause?.name)) {
        cause.npcTechniqueInitializationFailed = true;
        return cause;
    }
    const error = new Error(message, { cause });
    error.code = 'NPC_TECHNIQUE_INITIALIZATION_FAILED';
    const seen = new Set();
    for (let current = cause; current && !seen.has(current); current = current.cause) {
        seen.add(current);
        error.stack += `\nCaused by: ${current.stack || current.message || current}`;
    }
    return error;
}

function parseStartingTechniqueIds(node, { quantity = 1 } = {}) {
    const roots = children(node).filter(child => child.tagName === 'startingTechniques');
    if (roots.length > 1) throw new Error('NPC requires at most one <startingTechniques>.');
    if (!roots.length) return [];
    const root = roots[0];
    if (root.attributes.length || Array.from(root.childNodes).some(child => [3, 4].includes(child.nodeType) && child.nodeValue.trim())) {
        throw new Error('<startingTechniques> requires only <techniqueId> children.');
    }
    const ids = children(root).map(child => {
        if (child.tagName !== 'techniqueId' || child.attributes.length || children(child).length || !child.textContent.trim()) {
            throw new Error('<startingTechniques> requires nonempty text-only <techniqueId> children.');
        }
        const id = child.textContent.trim();
        const definition = TechniqueService.getDefinition(id);
        if (!definition) throw new Error(`Generated NPC starting technique ${id} is not in the current world catalogue.`);
        if (quantity > 1 && definition.unique) throw new Error(`A quantity group cannot share unique technique ${id}.`);
        return id;
    });
    if (new Set(ids).size !== ids.length) throw new Error('Generated NPC starting techniques must be distinct.');
    return ids;
}

function isGeneratedNpcTechniqueError(error) {
    const seen = new Set();
    for (let current = error; current && !seen.has(current); current = current.cause) {
        if (current.code === 'NPC_TECHNIQUE_INITIALIZATION_FAILED' || current.npcTechniqueInitializationFailed === true) return true;
        seen.add(current);
    }
    return false;
}

function parseGeneratedNpcTechniques(node, options) {
    try { return parseStartingTechniqueIds(node, options); }
    catch (cause) {
        throw initializationError(`Invalid generated NPC starting techniques: ${cause.message}`, cause);
    }
}

function applyGeneratedNpcTechniques(actor, techniqueIds = []) {
    if (!Array.isArray(techniqueIds)) throw new TypeError('Generated NPC starting techniques must be an array.');
    try {
        return techniqueIds.map(techniqueId => TechniqueService.learn({
            operationId: `${actor.id}:initial-technique:${techniqueId}`,
            actor,
            techniqueId,
            provenance: { kind: 'generation', reason: `Established training of newly generated character ${actor.name}.` }
        }));
    } catch (cause) {
        throw initializationError(`Could not initialize techniques for ${actor.name}: ${cause.message}`, cause);
    }
}

async function initializeGeneratedNpcTechniques(actors, options) {
    try {
        return await require('./StartingTechniques.js').generateStartingTechniques({ actors, ...options });
    } catch (cause) {
        throw initializationError(`Could not initialize generated character techniques: ${cause.message}`, cause);
    }
}

module.exports = { parseGeneratedNpcTechniques, applyGeneratedNpcTechniques, initializeGeneratedNpcTechniques, isGeneratedNpcTechniqueError };
