'use strict';

const Utils = require('./Utils.js');
const { parseTechniqueOperation } = require('./TechniquePrompt.js');
const { extractTinyBrainXmlResponse } = require('./TinyBrainXmlResponse.js');
const { CHAT_TOOL_DEFINITIONS } = require('./chat_tool_calls.js');
const { ValidationIssueCollector } = require('./ResponseValidation.js');

const FUNCTIONS = Object.freeze({
    check: Object.freeze({ unopposed: 'resolveSkillCheck', opposed: 'resolveOpposedSkillCheck' }),
    attack: Object.freeze({ single: 'resolveAttack', area: 'resolveAreaAttack' })
});
const SCHEMAS = new Map(CHAT_TOOL_DEFINITIONS.map(definition => [definition.function.name, definition.function.parameters]));
const clone = value => JSON.parse(JSON.stringify(value));
const children = node => Array.from(node?.childNodes || []).filter(child => child.nodeType === 1);
const text = node => Array.from(node?.childNodes || [])
    .filter(child => child.nodeType === 3 || child.nodeType === 4)
    .map(child => child.nodeValue || '').join('').trim();

function parseValue(node, schema, label, { aliases = {}, extraTags = [], attack = false, issues = new ValidationIssueCollector() } = {}) {
    const nodes = children(node);
    if (schema.type === 'object') {
        if (text(node)) issues.add(new Error(`${label} cannot contain text outside its fields.`));
        const properties = schema.properties || {};
        const result = {};
        const allowed = new Set([...Object.keys(properties).map(key => aliases[key] || key), ...extraTags]);
        for (const child of nodes) {
            if (!allowed.has(child.tagName)) issues.add(new Error(`${label} contains unexpected <${child.tagName}>. Remove it; allowed fields are ${[...allowed].map(tag => `<${tag}>`).join(', ')}.`));
        }
        for (const [key, fieldSchema] of Object.entries(properties)) {
            const tag = aliases[key] || key;
            const fields = nodes.filter(child => child.tagName === tag);
            if (fields.length > 1) {
                issues.add(new Error(`${label} contains duplicate <${tag}> fields. Keep at most one <${tag}>.`));
                continue;
            }
            const emptyScalar = fields.length === 1
                && !['array', 'object'].includes(fieldSchema.type)
                && !children(fields[0]).length && !text(fields[0]);
            if (!fields.length || emptyScalar) {
                const nullableSelections = ['skill', 'attribute', 'opponentSkill', 'opponentAttribute', 'ability', 'weapon', 'evadeSkill', 'deflectSkill', 'toughnessAttribute'];
                if (fieldSchema.type === 'string' && (nullableSelections.includes(key)
                    || (node?.tagName === 'secondaryEffect' && ['name', 'description'].includes(key)))) {
                    result[key] = 'N/A';
                    continue;
                }
                if (fieldSchema.type === 'array' && ['circumstanceModifiers', 'attackerCircumstanceModifier', 'defenderCircumstanceModifier'].includes(key)) {
                    result[key] = [];
                    continue;
                }
                if (fieldSchema.type === 'object' && ['defenseInfo', 'defenderInfo'].includes(key)) {
                    result[key] = parseValue(null, fieldSchema, `${label} <${tag}>`, { attack, issues });
                    continue;
                }
                if (schema.required?.includes(key)) issues.add(new Error(`${label} requires <${tag}>. Supply one non-empty <${tag}> value.`));
                continue;
            }
            result[key] = issues.capture(() => parseValue(fields[0], fieldSchema, `${label} <${tag}>`, { attack, issues }));
        }
        return result;
    }
    if (schema.type === 'array') {
        if (text(node)) issues.add(new Error(`${label} cannot contain text outside its entries.`));
        const itemTag = node.tagName === 'targets' ? 'target' : 'modifier';
        if (nodes.some(child => child.tagName !== itemTag)) issues.add(new Error(`${label} requires <${itemTag}> entries.`));
        if (node.tagName === 'targets' && !nodes.length) issues.add(new Error(`${label} requires at least one target.`));
        return nodes.filter(child => child.tagName === itemTag).map((child, index) => issues.capture(() => parseValue(child, schema.items, `${label} entry ${index + 1}`, { attack, issues })));
    }
    if (nodes.length) throw new Error(`${label} must contain text only.`);
    const value = text(node);
    if (!value) throw new Error(`${label} is empty. Supply the required value.`);
    if (schema.type === 'boolean') {
        if (value !== 'true' && value !== 'false') throw new Error(`${label} must be true or false.`);
        return value === 'true';
    }
    if (schema.type === 'integer') {
        if (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${label} must be a safe integer.`);
        const number = Number(value);
        if (node.tagName === 'damageEffectiveness' && (number < 1 || number > 5)) throw new Error(`${label} must be from 1 to 5.`);
        if (attack && node.tagName === 'amount' && (number < -10 || number > 10)) throw new Error(`${label} must be from -10 to 10.`);
        return number;
    }
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${label} must be one of: ${schema.enum.join(', ')}.`);
    return value;
}

function parsePlayerActionResolutionPlan(response, { parseTechnique = parseTechniqueOperation, normalizeAttack = null } = {}) {
    if (typeof response !== 'string' || !response.trim()) throw new Error('Resolution plan requires XML.');
    const xml = extractTinyBrainXmlResponse(response, 'resolutionPlan');
    const document = Utils.parseXmlDocumentStrict(xml, 'text/xml');
    const root = document.documentElement;
    if (root?.tagName !== 'resolutionPlan') throw new Error('Resolution plan requires one <resolutionPlan> root.');
    const issues = new ValidationIssueCollector();
    const inspectAttributes = node => {
        if (node.attributes?.length) issues.add(new Error(`Resolution plan <${node.tagName}> cannot have XML attributes; use child elements.`));
        children(node).forEach(inspectAttributes);
    };
    inspectAttributes(root);
    if (text(root)) issues.add(new Error('Resolution plan cannot contain text outside its actions.'));
    const actions = children(root).map((node, index) => issues.capture(() => {
        const label = `Resolution plan action ${index + 1}`;
        if (node.tagName === 'technique') {
            // The session adapter can reserve intent locks. Once an earlier
            // issue rejects this plan, do not create additional adapter state.
            if (parseTechnique !== parseTechniqueOperation && issues.size) return;
            const parsed = parseTechnique(node, index);
            const operation = parsed.operation || parsed;
            return { ...(parsed.attemptKey ? { techniqueAttemptKey: parsed.attemptKey } : {}), functionName: 'useTechnique', argumentsObject: operation, intent: operation.intent };
        }
        const types = children(node).filter(child => child.tagName === 'type');
        if (types.length !== 1 || children(types[0]).length) throw new Error(`${label} requires one text-only <type>.`);
        const type = text(types[0]);
        const functionName = FUNCTIONS[node.tagName]?.[type];
        if (!functionName) throw new Error(`${label} must be a check of type unopposed/opposed or attack of type single/area.`);
        const originalSchema = SCHEMAS.get(functionName);
        const schema = {
            ...originalSchema,
            properties: { ...originalSchema.properties },
            required: [...originalSchema.required]
        };
        if (node.tagName === 'check') schema.required.push('actor');
        else {
            schema.properties.intent = { type: 'string' };
            schema.required.push('intent');
        }
        if (type === 'opposed') {
            schema.properties.opponent = {
                type: 'object',
                properties: { name: originalSchema.properties.opponent, skill: originalSchema.properties.opponentSkill, attribute: originalSchema.properties.opponentAttribute },
                required: ['name', 'skill', 'attribute']
            };
            delete schema.properties.opponentSkill;
            delete schema.properties.opponentAttribute;
            schema.required = schema.required.filter(key => !['opponentSkill', 'opponentAttribute'].includes(key));
        }
        if (type === 'single') {
            schema.properties.targets = {
                type: 'array', items: {
                    type: 'object',
                    properties: {
                        name: originalSchema.properties.defender,
                        defenseInfo: originalSchema.properties.defenderInfo,
                        circumstanceModifiers: originalSchema.properties.circumstanceModifiers.properties.defenderCircumstanceModifier,
                        damageEffectiveness: originalSchema.properties.damageEffectiveness
                    },
                    required: ['name', 'defenseInfo', 'circumstanceModifiers', 'damageEffectiveness']
                }
            };
            schema.properties.circumstanceModifiers = originalSchema.properties.circumstanceModifiers.properties.attackerCircumstanceModifier;
            for (const key of ['defender', 'defenderInfo', 'damageEffectiveness']) delete schema.properties[key];
            schema.required = schema.required.filter(key => !['defender', 'defenderInfo', 'damageEffectiveness'].includes(key));
            schema.required.push('targets');
        }
        if (type === 'area') {
            delete schema.properties.rollMode;
            schema.required = schema.required.filter(key => key !== 'rollMode');
        }
        const args = parseValue(node, schema, label, {
            aliases: node.tagName === 'check' ? { reason: 'intent', difficultyLevel: 'difficulty' } : {},
            extraTags: ['type'],
            attack: node.tagName === 'attack',
            issues
        });
        if (type === 'opposed') {
            const opponent = args.opponent;
            args.opponent = opponent?.name;
            args.opponentSkill = opponent?.skill;
            args.opponentAttribute = opponent?.attribute;
        }
        if (type === 'single' && args.targets) {
            if (args.targets.length !== 1) throw new Error(`${label} single attack requires exactly one target.`);
            const [target] = args.targets;
            if (!target) return;
            delete args.targets;
            args.defender = target.name;
            args.defenderInfo = target.defenseInfo;
            args.damageEffectiveness = target.damageEffectiveness;
            args.circumstanceModifiers = {
                attackerCircumstanceModifier: args.circumstanceModifiers,
                defenderCircumstanceModifier: target.circumstanceModifiers
            };
        }
        const noSelection = value => typeof value === 'string' && /^n\/a$/i.test(value);
        if (node.tagName === 'check' && noSelection(args.skill) && noSelection(args.attribute)) issues.add(new Error(`${label} must select a skill, an attribute, or both.`));
        if (type === 'opposed' && noSelection(args.opponentSkill) && noSelection(args.opponentAttribute)) issues.add(new Error(`${label} must select an opponent skill, attribute, or both.`));
        if (type === 'opposed' && typeof args.actor === 'string' && typeof args.opponent === 'string' && args.actor.toLowerCase() === args.opponent.toLowerCase()) issues.add(new Error(`${label} cannot oppose its own actor.`));
        if (type === 'area' && args.targets) {
            args.rollMode = 'sharedAttackRoll';
            const names = args.targets.filter(target => typeof target?.name === 'string').map(target => target.name.toLowerCase());
            if (new Set(names).size !== names.length) issues.add(new Error(`${label} cannot repeat an area target.`));
        }
        const intent = args.intent || args.reason;
        if (args.newTechniqueAttempt !== true) delete args.intent;
        const action = { functionName, argumentsObject: args, intent };
        // Like the technique parser, this adapter can reserve intent locks. Run
        // it in action order, and never after an earlier validation issue.
        if (node.tagName === 'attack' && normalizeAttack && !issues.size) return normalizeAttack(action, index);
        return action;
    }));
    issues.throwIfAny();
    return { value: actions, normalizedResponse: xml };
}

function createResolutionPlanExecutionState(runId) {
    if (typeof runId !== 'string' || !runId.trim()) throw new Error('Resolution execution requires a run id.');
    return { runId: runId.trim(), checkpoints: new Map() };
}

function validatePlayerActionResolutionReferences(action, {
    resolveActor, resolveSkillDefinition, resolveAttributeKey, assertActorCanAttack
} = {}) {
    if ([resolveActor, resolveSkillDefinition, resolveAttributeKey, assertActorCanAttack].some(callback => typeof callback !== 'function')) {
        throw new Error('Resolution reference validation requires actor, skill, attribute, and attack validators.');
    }
    const args = action.argumentsObject;
    const living = (name, label) => {
        const actor = resolveActor(name, label);
        if (!actor || actor.isDead === true || (Number.isFinite(actor.health) && actor.health <= 0)) {
            throw new Error(`Resolution ${label} "${name}" is missing, dead, or defeated; revise the remaining plan explicitly.`);
        }
        return actor;
    };
    const selection = (actor, value, kind, label) => {
        if (/^n\/a$/i.test(value)) return false;
        const known = kind === 'skill' ? resolveSkillDefinition(value) : resolveAttributeKey(actor, value);
        if (!known) throw new Error(`Resolution ${label} references unknown ${kind} "${value}".`);
        return true;
    };
    const pairing = (actor, skill, attribute, label) => {
        const hasSkill = selection(actor, skill, 'skill', label);
        const hasAttribute = selection(actor, attribute, 'attribute', label);
        if (!hasSkill && !hasAttribute) throw new Error(`Resolution ${label} requires a skill, an attribute, or both.`);
    };
    if (action.functionName === 'resolveSkillCheck' || action.functionName === 'resolveOpposedSkillCheck') {
        const actor = living(args.actor, 'actor');
        pairing(actor, args.skill, args.attribute, 'acting check');
        if (action.functionName === 'resolveOpposedSkillCheck') {
            const opponent = living(args.opponent, 'opponent');
            if (actor === opponent || (actor.id && actor.id === opponent.id)) throw new Error('A planned opposed check cannot oppose its own actor.');
            pairing(opponent, args.opponentSkill, args.opponentAttribute, 'opposed check');
        }
        return;
    }
    if (action.functionName === 'useTechnique') {
        living(args.actor, 'technique actor');
        if (!args.techniqueId || !Array.isArray(args.targetIds) || !args.targetIds.length) throw new Error('Technique operation needs canonical technique and target IDs.');
        return;
    }
    const attacker = living(args.attacker, 'attacker');
    assertActorCanAttack(attacker, { toolName: action.functionName });
    const hasAttackSkill = selection(attacker, args.attackerInfo.attackSkill, 'skill', 'attack');
    const hasDamageAttribute = selection(attacker, args.attackerInfo.damageAttribute, 'attribute', 'attack');
    if (!hasAttackSkill || !hasDamageAttribute) throw new Error('A planned attack requires both a known attackSkill and damageAttribute; neither may be N/A.');
    const targets = action.functionName === 'resolveAttack'
        ? [{ name: args.defender, defenseInfo: args.defenderInfo }]
        : args.targets;
    const identities = new Set();
    for (const target of targets) {
        const actor = living(target.name, 'target');
        const identity = actor.id || actor;
        if (identities.has(identity)) throw new Error('An area attack cannot target one character twice under different names.');
        identities.add(identity);
        selection(actor, target.defenseInfo.evadeSkill, 'skill', 'evade defense');
        selection(actor, target.defenseInfo.deflectSkill, 'skill', 'deflect defense');
        if (action.functionName === 'resolveAreaAttack') selection(actor, target.defenseInfo.toughnessAttribute, 'attribute', 'toughness defense');
    }
}

function formatPlayerActionResolutionResults(invocations) {
    if (!invocations.length) return 'No additional mechanical resolutions were required.';
    const labels = {
        resolveSkillCheck: 'unopposed check',
        resolveOpposedSkillCheck: 'opposed check',
        resolveAttack: 'single-target attack',
        resolveAreaAttack: 'area attack',
        useTechnique: 'technique attempt'
    };
    return invocations.map(invocation => {
        if (!Object.hasOwn(labels, invocation.name)) {
            throw new Error(`Unsupported player-action resolution receipt: ${invocation.name}`);
        }
        return `Action ${invocation.id}: ${labels[invocation.name]}\nIntent: ${invocation.intent}\n`
            + `Resolution details: ${JSON.stringify(invocation.argumentsObject)}\n${invocation.content}`;
    }).join('\n\n');
}

async function executePlayerActionResolutionPlan(actions, {
    state, checkpointId, validateAction, executeAction, onAction = null
} = {}) {
    if (!Array.isArray(actions) || !(state?.checkpoints instanceof Map)) throw new Error('Resolution execution requires parsed actions and run state.');
    if (typeof validateAction !== 'function' || typeof executeAction !== 'function') throw new Error('Resolution execution requires validation and execution callbacks.');
    if (!(typeof checkpointId === 'string' && checkpointId.trim()) && !(Number.isSafeInteger(checkpointId) && checkpointId >= 0)) throw new Error('Resolution execution requires an explicit checkpoint id.');
    const key = String(checkpointId);
    let ledger = state.checkpoints.get(key);
    if (!ledger) {
        ledger = { completed: [], caches: new Map(), finished: false, fatalError: null };
        state.checkpoints.set(key, ledger);
    }
    if (ledger.fatalError) throw ledger.fatalError;
    if (ledger.finished) {
        if (ledger.input !== JSON.stringify(actions)) throw new Error('A completed resolution plan cannot be replaced.');
        return { invocations: clone(ledger.completed) };
    }
    const knownFailure = error => {
        error.resolutionPlanPendingOnly = true;
        error.completedResolutionInvocations = clone(ledger.completed);
        error.message += ledger.completed.length
            ? '\nCompleted actions are authoritative and retained. Return only the remaining unexecuted resolution-plan suffix; do not repeat completed actions.'
            : '\nNo actions have executed. Return the full corrected resolution plan, retaining every recognized technique attempt and correcting its preparation.';
        return error;
    };
    try {
        for (const action of actions) await validateAction(action);
    } catch (error) { if (error.fatalTinyBrainExecution) throw error; throw knownFailure(error); }

    for (const action of actions) {
        try { await validateAction(action); }
        catch (error) { if (error.fatalTinyBrainExecution) throw error; throw knownFailure(error); }
        const id = `${state.runId}:resolution:${key}:${ledger.completed.length}`;
        const toolCall = { id, ...clone(action) };
        let resultCache = ledger.caches.get(id);
        if (!resultCache) {
            resultCache = { roundKey: id, entries: new Map() };
            ledger.caches.set(id, resultCache);
        }
        let result = null;
        let invocation = null;
        try {
            if (onAction) await onAction({ phase: 'started', toolCall });
            result = await executeAction(toolCall, { resultCache });
            if (!result || typeof result.content !== 'string' || !result.content.trim() || result.metadata?.error === true) {
                throw new Error(result?.metadata?.message || `Resolution ${id} did not return a trustworthy successful receipt.`);
            }
            invocation = { id, name: action.functionName, intent: action.intent, argumentsObject: clone(action.argumentsObject), content: result.content, metadata: clone(result.metadata || {}) };
            ledger.completed.push(invocation);
            if (onAction) await onAction({ phase: 'completed', toolCall, invocation: clone(invocation) });
        } catch (cause) {
            const error = new Error(`Resolution ${id} failed after execution began; its effects cannot safely be replayed: ${cause.message}`, { cause });
            if (cause?.code === 'PROMPT_CANCELLED' || cause?.name === 'PromptCancellationError'
                || cause?.code === 'ABORT_ERR' || cause?.name === 'AbortError') {
                error.name = cause.name;
                if (cause.code !== undefined) error.code = cause.code;
            }
            error.fatalTinyBrainExecution = true;
            error.completedResolutionInvocations = clone(ledger.completed);
            ledger.fatalError = error;
            if (onAction) {
                try {
                    await onAction({ phase: 'error', toolCall, error: cause, result, invocation: invocation ? clone(invocation) : null });
                } catch (notificationError) {
                    error.notificationError = notificationError;
                    error.message += `\nReporting the resolution failure also failed: ${notificationError.message}`;
                    error.stack += `\nResolution failure notification:\n${notificationError.stack || notificationError}`;
                }
            }
            throw error;
        }
    }
    ledger.finished = true;
    ledger.input = JSON.stringify(actions);
    return { invocations: clone(ledger.completed) };
}

module.exports = {
    parsePlayerActionResolutionPlan,
    createResolutionPlanExecutionState,
    validatePlayerActionResolutionReferences,
    executePlayerActionResolutionPlan,
    formatPlayerActionResolutionResults
};
