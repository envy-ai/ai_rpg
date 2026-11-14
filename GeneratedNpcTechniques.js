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
    const npcName = children(node).find(child => child.tagName === 'name')?.textContent.trim() || 'Unnamed NPC';
    const roots = children(node).filter(child => child.tagName === 'startingTechniques');
    if (roots.length > 1) throw new Error(`NPC ${JSON.stringify(npcName)} <startingTechniques> appears more than once; keep one collection or omit it.`);
    if (!roots.length) return [];
    const root = roots[0];
    if (root.attributes.length || Array.from(root.childNodes).some(child => [3, 4].includes(child.nodeType) && child.nodeValue.trim())) {
        throw new Error(`NPC ${JSON.stringify(npcName)} <startingTechniques> requires only <techniqueId> children; remove bare text and attributes.`);
    }
    const ids = children(root).map((child, index) => {
        const field = `NPC ${JSON.stringify(npcName)} <startingTechniques>/<techniqueId>[${index + 1}]`;
        if (child.tagName !== 'techniqueId' || child.attributes.length || children(child).length || !child.textContent.trim()) {
            throw new Error(`${field} must contain one nonempty canonical technique ID as plain text; omit empty entries.`);
        }
        const id = child.textContent.trim();
        const definition = TechniqueService.getDefinition(id);
        if (!definition) {
            const publicIds = TechniqueService.getDefinitions()
                .filter(candidate => candidate.provenance?.private !== true)
                .map(candidate => candidate.id);
            const fix = publicIds.length
                ? `Use an exact <id> from the known technique catalogue, such as ${publicIds.slice(0, 8).join(', ')}, or remove this entry.`
                : 'No public technique IDs are available; omit <startingTechniques> or leave it empty. Separate initial authoring may create new techniques later.';
            throw new Error(`${field} ${JSON.stringify(id)} is not an exact canonical technique ID in the current world catalogue. ${fix} A discipline ID/name, skill name or technique display name is not valid in this field.`);
        }
        if (quantity > 1 && definition.unique) throw new Error(`${field} ${JSON.stringify(id)} is unique and cannot be shared by a quantity group; choose a nonunique known technique or omit this entry.`);
        return id;
    });
    if (new Set(ids).size !== ids.length) throw new Error(`NPC ${JSON.stringify(npcName)} <startingTechniques>/<techniqueId> values must be distinct; remove duplicate entries.`);
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
