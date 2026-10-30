'use strict';

const Technique = require('./Technique.js');
const TechniqueService = require('./TechniqueService.js');
const Player = require('./Player.js');
const { parseAutomaticTechniqueCandidate, parseAutomaticTechniqueDiscipline } = require('./TechniquePrompt.js');
const { createHash } = require('crypto');
const children = node => Array.from(node.childNodes || []).filter(child => child.nodeType === 1);
const field = (node, name) => {
    const values = children(node).filter(child => child.tagName === name);
    if (values.length !== 1 || children(values[0]).length || !values[0].textContent.trim()) throw new Error(`<${node.tagName}> requires one text-only <${name}>.`);
    return values[0].textContent.trim();
};
function assertReference(node) {
    for (const current of [node, ...children(node)]) if (current.attributes?.length) throw new Error('Technique receipt references cannot have attributes.');
    if (children(node).some(child => !['operationId', 'mutationId'].includes(child.tagName))) throw new Error('Technique receipt reference has unknown fields.');
    const operationId = field(node, 'operationId');
    const mutationId = field(node, 'mutationId');
    const receipt = TechniqueService.getReceipt(operationId);
    if (!receipt?.committed) throw new Error(`Technique receipt ${operationId} is not committed.`);
    const effect = receipt.effects?.find(entry => entry.mutationId === mutationId);
    const cost = receipt.costs?.find(entry => `${operationId}:cost:${entry.key}` === mutationId);
    const change = receipt.techniqueChanges?.find((entry, index) => `${operationId}:change:${index}` === mutationId);
    if (!effect && !cost && !change) throw new Error(`Technique mutation ${mutationId} does not belong to receipt ${operationId}.`);
    return { receipt, effect, cost, change };
}
function suppressReferencedMutation(node, tagName) {
    if (tagName === 'techniqueNotification') { assertReference(node); return true; }
    const references = children(node).filter(child => child.tagName === 'techniqueReceipt');
    if (!references.length) return false;
    if (references.length !== 1) throw new Error('An event may reference only one technique mutation.');
    const linked = assertReference(references[0]);
    if (tagName === 'needBarChange' && linked.cost) {
        const needId = field(node, 'needBarId');
        if (linked.cost.resource !== 'need' || linked.cost.needId !== needId) throw new Error('Receipt-linked needBarChange names a different resource from the committed technique cost.');
        const direction = field(node, 'direction');
        if (direction !== linked.cost.direction) throw new Error('Receipt-linked needBarChange direction differs from the committed technique cost.');
        const targetName = field(node, 'characterName');
        const payer = Player.getById(linked.receipt.actorId);
        if (targetName && ![payer?.id, payer?.name, ...(payer?.id === require('./Globals.js').currentPlayer?.id ? ['player', 'the player', 'you'] : [])].filter(Boolean).some(name => name.toLowerCase() === targetName.toLowerCase())) throw new Error('Receipt-linked cost event targets a different payer.');
        return true;
    }
    const expected = { healRecover: ['healing'], environmentalStatusDamage: ['damage'], attackDamage: ['damage'], statusEffectChange: ['buff', 'debuff'] }[tagName];
    if (!expected || !linked.effect || !expected.includes(linked.effect.kind) || !linked.effect.success) throw new Error(`<${tagName}> does not match the referenced committed technique effect.`);
    if (tagName === 'statusEffectChange') {
        const action = field(node, 'action').toLowerCase();
        if (action !== 'gained') throw new Error('A status removal is not the referenced committed technique gain.');
        const statusName = field(node, 'statusEffectName');
        const actual = linked.effect.status;
        if (!actual || ![actual.name, actual.description].filter(value => typeof value === 'string').some(value => value.trim() === statusName)) throw new Error('Receipt-linked statusEffectChange names a different status from the committed technique effect.');
    }
    const target = Player.getById(linked.effect.targetId);
    if (!target) throw new Error(`Missing technique receipt target ${linked.effect.targetId}.`);
    const targetField = { statusEffectChange: 'entityName', healRecover: 'characterName', environmentalStatusDamage: 'actorName', attackDamage: 'targetName' }[tagName];
    if (targetField) field(node, targetField);
    const named = children(node).filter(child => ['characterName', 'actorName', 'targetName', 'defenderName', 'entityName', 'name'].includes(child.tagName));
    if (named.length && !named.some(child => [target.id, target.name, ...(target.id === require('./Globals.js').currentPlayer?.id ? ['player', 'the player', 'you'] : [])].some(name => name.toLowerCase() === child.textContent.trim().toLowerCase()))) throw new Error('Receipt-linked event target differs from the committed technique target.');
    return true;
}
function parseChange(value) {
    const command = typeof value === 'string' ? JSON.parse(value) : value;
    Technique.assertKeys(command, ['kind', 'actorId', 'techniqueId', 'definitionRevision', 'mechanics', 'improvement', 'evidenceIds', 'evidence', 'provenance', 'candidate', 'candidateDiscipline'], 'techniqueChange');
    Technique.text(command.actorId, 'techniqueChange.actorId');
    Technique.text(command.techniqueId, 'techniqueChange.techniqueId');
    if (!['learn', 'improve', 'evidence'].includes(command.kind)) throw new Error('techniqueChange.kind must be learn, improve, or evidence.');
    if (command.kind === 'learn' || command.kind === 'improve') {
        const provenance = Technique.normalizeProvenance(command.provenance);
        if (provenance.kind === 'editor' || provenance.kind === 'generation') throw new Error('Narrative technique changes require an actual trainer, teaching item, discovery, training or story provenance.');
    }
    if (command.improvement !== undefined) {
        if (command.kind !== 'improve' || command.mechanics !== undefined) throw new Error('A semantic improvement requires kind improve and omits mechanics.');
        Technique.assertKeys(command.improvement, ['stepId', 'reason'], 'techniqueChange.improvement');
        Technique.text(command.improvement.stepId, 'techniqueChange.improvement.stepId');
        if (command.improvement.reason !== undefined) Technique.text(command.improvement.reason, 'techniqueChange.improvement.reason');
    }
    if (command.kind === 'improve' && command.improvement === undefined && command.mechanics === undefined) throw new Error('Improvement requires a configured improvement step or complete nonhealing custom mechanics.');
    if (command.mechanics !== undefined) Technique.normalizeRevision(command.mechanics);
    if (command.evidence) {
        const evidence = command.evidence;
        if (evidence.id === undefined) evidence.id = `milestone:${createHash('sha256').update(JSON.stringify({ actorId: command.actorId, techniqueId: command.techniqueId, kind: evidence.kind, description: evidence.description })).digest('hex')}`;
        if (evidence.worldMinute === undefined) evidence.worldMinute = require('./Globals.js').getTotalWorldMinutes();
        Technique.normalizeEvidence([evidence]);
    }
    if (command.candidate) parseAutomaticTechniqueCandidate(command.candidate);
    if (command.candidateDiscipline) parseAutomaticTechniqueDiscipline(command.candidateDiscipline);
    return command;
}
function applyChange(command, context) {
    command = parseChange(command);
    const actor = Player.getById(command.actorId);
    if (!actor) throw new Error(`Technique change actor ${command.actorId} is absent.`);
    const stable = { ...command, ...(command.evidence ? { evidence: { ...command.evidence, worldMinute: undefined } } : {}) };
    const operationId = `event-technique:${createHash('sha256').update(JSON.stringify(stable)).digest('hex')}`;
    const options = { ...command, actor, operationId };
    const replay = TechniqueService.getReceipt(operationId);
    if (replay) TechniqueService.retryReceiptNotification(operationId);
    const receipt = replay || (command.kind === 'learn' ? TechniqueService.learn(options) : command.kind === 'improve' ? TechniqueService.improve(options) : TechniqueService.recordEvidence(options));
    context.techniqueChanges ||= [];
    context.techniqueChanges.push(...(receipt.techniqueChanges || [{ kind: receipt.kind, actorId: actor.id, techniqueId: receipt.techniqueId, evidenceIds: receipt.evidenceIds }]));
    context.locationRefreshRequested = true;
    return receipt;
}
module.exports = { assertReference, suppressReferencedMutation, parseChange, applyChange };
