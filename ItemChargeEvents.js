'use strict';

const { createHash } = require('crypto');
const Technique = require('./Technique.js');
const ChargeService = require('./ItemChargeService.js');
const { parseTechniqueXmlValue } = require('./TechniqueXml.js');
const reference = { operationId: 'text', mutationId: 'text' };
const schemas = {
    reloadItem: { actorId: 'text', itemId: 'text', ammoItemId: 'text', amount: 'number', chargeReceipt: reference },
    chargeAdjust: { actorId: 'text', itemId: 'text', amount: 'number', reason: 'text', chargeReceipt: reference, techniqueReceipt: reference }
};
function parse(node, tagName = node.tagName) {
    const declaration = schemas[tagName];
    if (!declaration) throw new Error(`Unsupported charge event ${tagName}.`);
    const value = parseTechniqueXmlValue(node, declaration, tagName);
    for (const key of tagName === 'reloadItem' ? ['actorId', 'itemId', 'ammoItemId'] : ['actorId', 'itemId', 'reason']) Technique.text(value[key], `${tagName}.${key}`);
    Technique.number(value.amount, `${tagName}.amount`, { minimum: tagName === 'reloadItem' ? 1 : 0, integer: tagName === 'reloadItem' });
    if (value.chargeReceipt && value.techniqueReceipt) throw new Error(`${tagName}: use one chargeReceipt or techniqueReceipt, never both.`);
    for (const key of ['chargeReceipt', 'techniqueReceipt']) if (value[key]) {
        Technique.text(value[key].operationId, `${tagName}.${key}.operationId`);
        Technique.text(value[key].mutationId, `${tagName}.${key}.mutationId`);
    }
    return { kind: tagName, ...value };
}
function referencedResult(command) {
    const linked = command.chargeReceipt || command.techniqueReceipt;
    if (!linked) return null;
    if (command.techniqueReceipt) {
        const receipt = require('./TechniqueService.js').getReceipt(linked.operationId);
        const cost = receipt?.costs?.find(cost => cost.resource === 'charge' && `${linked.operationId}:cost:${cost.key}` === linked.mutationId);
        if (!receipt?.committed || !cost) throw new Error('chargeAdjust.techniqueReceipt must reference an exact committed charge cost mutation.');
        return { kind: 'chargeAdjust', actorId: receipt.actorId, itemId: cost.itemId, amount: cost.newValue };
    }
    const record = ChargeService.getOperationRecord(linked.operationId);
    if (!record) throw new Error(`${command.kind}.chargeReceipt.operationId is not committed. Use an existing exact charge/reload receipt, or omit the reference for an independent event.`);
    const payment = record.result.chargePayment || record.result;
    const suffix = payment.kind === 'reload' ? 'reload' : 'charge';
    if (linked.mutationId !== `${linked.operationId}:${suffix}:${payment.itemId}`) throw new Error(`${command.kind}.chargeReceipt.mutationId does not identify that operation's exact item mutation.`);
    return { kind: payment.kind === 'reload' ? 'reloadItem' : 'chargeAdjust', actorId: payment.actorId, itemId: payment.itemId, amount: payment.kind === 'reload' ? payment.amount : payment.after, ...(payment.kind === 'reload' ? { ammoItemId: payment.ammoItemId } : {}) };
}
function suppressReferencedMutation(node, tagName) {
    if (!schemas[tagName]) return false;
    const command = parse(node, tagName);
    const committed = referencedResult(command);
    if (!committed) return false;
    for (const key of ['kind', 'actorId', 'itemId', 'amount', ...(tagName === 'reloadItem' ? ['ammoItemId'] : [])]) {
        if (committed[key] !== command[key]) throw new Error(`${tagName}.${key} differs from the referenced committed mutation. Reference the exact original actor, item, source and amount, or omit the reference for an independent event.`);
    }
    return true;
}
function validateScope(scope, path = 'chargeEventScope') {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error(`${path} must be a recorded source/section object or a nested parent/followup object. Restore its original scope before replay.`);
    if (Object.hasOwn(scope, 'parent')) {
        if (Object.keys(scope).some(key => !['parent', 'followup'].includes(key)) || typeof scope.followup !== 'string' || !scope.followup.trim()) throw new Error(`${path} requires only parent and a nonempty recorded followup identity. Restore the original recorded scope before replay.`);
        validateScope(scope.parent, `${path}.parent`);
    } else if (Object.keys(scope).some(key => !['sourceEntryId', 'eventSectionKind'].includes(key)) || typeof scope.sourceEntryId !== 'string' || !scope.sourceEntryId.trim() || typeof scope.eventSectionKind !== 'string' || !scope.eventSectionKind.trim()) {
        throw new Error(`${path} requires its original nonempty sourceEntryId and eventSectionKind. Restore the recorded scope; do not substitute a new event identity.`);
    }
    return scope;
}
function resolveScope(context = {}, passIdentity = require('./EventReprocessor.js').getCurrentPassIdentity()) {
    if (context.chargeEventScope) return validateScope(context.chargeEventScope);
    const sourceEntryId = context.sourceEntryId || passIdentity?.sourceEntryId;
    if (!sourceEntryId) return null;
    return { sourceEntryId, eventSectionKind: (context.eventSectionKind || passIdentity?.eventSectionKind || 'current').trim().toLowerCase() };
}
function apply(command, context) {
    const scope = resolveScope(context);
    if (!scope) throw new Error(`${command.kind} requires a stable sourceEntryId or chargeEventScope. Run it within a recorded event pass so replay cannot reload or adjust twice.`);
    // Domain IDs may be explicitly migrated while opaque operation IDs remain
    // stable. Event position is the identity; the durable request separately
    // validates every migrated actor/item/source/amount field.
    const key = command.kind;
    context.chargeEventOccurrences ||= new Map();
    const occurrence = context.chargeEventOccurrences.get(key) || 0;
    context.chargeEventOccurrences.set(key, occurrence + 1);
    const operationId = `event-charge:${createHash('sha256').update(JSON.stringify({ scope, kind: command.kind, occurrence })).digest('hex')}`;
    const record = ChargeService.getOperationRecord(operationId);
    const actor = record ? { id: command.actorId } : require('./Player.js').getById(command.actorId);
    if (!actor) throw new Error(`${command.kind}.actorId ${command.actorId} does not exist. Select a registered player or NPC.`);
    const receipt = command.kind === 'reloadItem' ? ChargeService.reload({ actor, itemId: command.itemId, ammoItemId: command.ammoItemId, amount: command.amount, operationId }) : ChargeService.adjust({ actor, itemId: command.itemId, amount: command.amount, operationId });
    context.itemChargeChanges ||= [];
    context.itemChargeChanges.push({ ...receipt, mutationId: `${operationId}:${command.kind === 'reloadItem' ? 'reload' : 'charge'}:${command.itemId}` });
    context.locationRefreshRequested = true;
    return receipt;
}
module.exports = { parse, apply, suppressReferencedMutation, resolveScope, validateScope };
