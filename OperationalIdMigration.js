'use strict';

const IdGenerator = require('./IdGenerator.js');
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID = new RegExp(`^${UUID_SOURCE}$`, 'i');
const UUID_PART = new RegExp(UUID_SOURCE, 'i');
const references = new Set(['id', 'imageId', 'sourceImageId', 'operationId', 'turnId', 'requestId', 'parentId',
    'confirmationId', 'chatEntryId', 'sourceEntryId', 'arrivalId', 'worldLineageId', 'evidenceIds', 'usedBy', 'techniqueRecordId',
    'techniqueOperationIds', 'receiptIds', 'mutationId', 'techniqueOperationId', 'techniqueToolCallId',
    'sourceId', 'sourceEntryIds', 'parentEntryId', 'anchorEntryId', 'entryId',
    'startEntryId', 'endEntryId', 'lastHousekeepingTurnId', 'lastReviewedTurnId']);
const opaque = new Set(['chargeEventScope', 'providerResponseId', 'providerRequestId', 'wirePromptId',
    'comfyPromptId', 'filename', 'filePath', 'filepath', 'url', 'prompt', 'generationPrompt', 'systemPrompt']);

function migrateOperationalIds(snapshot, { domainReplacements = {} } = {}) {
    const serialized = structuredClone(snapshot);
    const replacements = new Map();
    const counts = {};
    const add = (id, category, { operation = false } = {}) => {
        if (typeof id !== 'string' || !(operation ? UUID_PART : UUID).test(id)) return;
        if (!replacements.has(id)) {
            replacements.set(id, IdGenerator.nextSequential(category));
            counts[category] = (counts[category] || 0) + 1;
        }
    };
    // Canonical rows come first: optimistic request IDs can be the SAME identity
    // as a user chat row and must not receive a second request_N allocation.
    for (const entry of serialized.chatHistory || []) add(entry?.id, 'chat');
    for (const [id, metadata] of Object.entries(serialized.generatedImages || {})) {
        add(id, 'image');
        if (UUID.test(id) && !(metadata?.images || []).some(image => typeof image.filename === 'string' && image.filename && typeof image.url === 'string' && image.url.startsWith('/generated-images/'))) throw new Error(`generatedImages.${id}: UUID image migration requires its existing filename and local URL. Resolve its existing asset metadata before migration; no files were renamed.`);
        add(metadata?.id, 'image');
    }
    for (const offer of serialized.pendingQuestConfirmations || []) add(offer?.confirmationId, 'quest_offer');
    const collect = (value, field = '') => {
        if (typeof value === 'string') {
            if (field === 'operationId' && (UUID.test(value) || new RegExp(`^(?:editor|learn):${UUID_SOURCE}$`, 'i').test(value))) add(value, /^editor:/i.test(value) ? 'editor_operation' : /^learn:/i.test(value) ? 'learn_operation' : 'operation', { operation: true });
            else if (field === 'turnId') add(value, 'turn');
            else if (field === 'requestId') add(value, 'request');
            else if (field === 'arrivalId') add(value, 'arrival');
            else if (field === 'worldLineageId') add(value, 'world_lineage');
            return;
        }
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(entry => collect(entry, field)); return; }
        for (const [key, entry] of Object.entries(value)) if (!opaque.has(key)) collect(entry, key);
    };
    collect(serialized);
    const mapped = id => replacements.get(id) || id;
    const mappedSource = id => replacements.get(id) || domainReplacements[id] || id;
    const mapSemanticOperation = id => {
        if (typeof id !== 'string' || replacements.has(id)) return;
        let match = /^(.*):technique:player$/.exec(id);
        let next;
        if (match) next = `${mappedSource(match[1])}:technique:player`;
        else if ((match = /^(.*):(technique|ordinaryAttack):npc:([^:]+)$/.exec(id))) next = `${mappedSource(match[1])}:${match[2]}:npc:${mappedSource(match[3])}`;
        else if ((match = /^(.*):resolution:(\d+):(\d+)$/.exec(id))) next = `${mappedSource(match[1])}:resolution:${match[2]}:${match[3]}`;
        if (next && next !== id) { replacements.set(id, next); counts.operation = (counts.operation || 0) + 1; }
    };
    for (const receipt of serialized.techniques?.receipts || []) mapSemanticOperation(receipt.operationId);
    for (const record of serialized.itemCharges?.operations || []) {
        mapSemanticOperation(record.operationId);
        const next = require('./DomainIdMigration.js').mapNativeAttackOperation(record, mappedSource);
        if (next !== record.operationId && !replacements.has(record.operationId)) { replacements.set(record.operationId, next); counts.operation = (counts.operation || 0) + 1; }
    }
    const derived = new Map();
    const derive = (oldId, newId) => { if (oldId !== newId) derived.set(oldId, newId); };
    for (const receipt of serialized.techniques?.receipts || []) {
        const next = mapped(receipt.operationId);
        derive(`${receipt.operationId}:use`, `${next}:use`);
        for (const effect of receipt.effects || []) if (effect.mutationId) derive(effect.mutationId, `${next}:effect:${effect.targetId}:${effect.effectId}`);
        for (const cost of receipt.costs || []) derive(`${receipt.operationId}:cost:${cost.key}`, `${next}:cost:${cost.key}`);
        for (let index = 0; index < (receipt.techniqueChanges || []).length; index++) derive(`${receipt.operationId}:change:${index}`, `${next}:change:${index}`);
    }
    for (const record of serialized.itemCharges?.operations || []) {
        const next = mapped(record.operationId);
        const payment = record.result?.chargePayment;
        if (payment?.mutationId && payment.itemId) derive(payment.mutationId, `${next}:charge:${payment.itemId}`);
        if (['reload', 'adjust', 'spend'].includes(record.request?.kind)) {
            const kind = record.request.kind === 'reload' ? 'reload' : 'charge';
            derive(`${record.operationId}:${kind}:${record.request.itemId}`, `${next}:${kind}:${record.request.itemId}`);
        }
    }
    // Charge hashes depend on the original pass scope, not mutable canonical
    // chat references. Preserve that opaque provenance before remapping sources.
    for (const entry of serialized.chatHistory || []) for (const pass of entry.metadata?.eventReplay?.passes || []) {
        if (!replacements.has(pass.sourceEntryId)) continue;
        if (typeof pass.sourceEntryId !== 'string' || !pass.sourceEntryId.trim()) throw new Error('eventReplay.pass.sourceEntryId is required to preserve charge replay identity before migration.');
        pass.options ||= {};
        pass.options.chargeEventScope ||= { sourceEntryId: pass.sourceEntryId, eventSectionKind: (pass.eventSectionKind || 'current').trim().toLowerCase() };
        require('./ItemChargeEvents.js').validateScope(pass.options.chargeEventScope, 'eventReplay.pass.options.chargeEventScope');
    }
    const rewriteXml = (xml, path) => {
        if (!/<(?:technique_?receipt|charge_?receipt)(?:\s|>)/i.test(xml)) return xml;
        let document;
        try { document = require('./Utils.js').parseXmlDocumentStrict(xml, 'text/xml'); }
        catch (cause) { throw new Error(`${path}: Stored event receipt XML is malformed; repair it before migration. ${cause.message}`, { cause }); }
        let changed = false;
        for (const tag of ['operationId', 'mutationId', 'operation_id', 'mutation_id']) for (const node of Array.from(document.getElementsByTagName(tag))) {
            if (Array.from(node.childNodes || []).some(child => child.nodeType === 1)) throw new Error(`${path}.${tag}: Receipt references must be text-only before migration.`);
            const value = node.textContent.trim();
            const next = derived.get(value) || mapped(value);
            if (next !== value) { node.textContent = next; changed = true; }
        }
        return changed ? document.toString() : xml;
    };
    const rewrite = (value, field = '', path = []) => {
        if (typeof value === 'string') {
            if (field === 'acceptedXml' && path.includes('eventReplay')) return rewriteXml(value, path.join('.'));
            return references.has(field) ? derived.get(value) || mapped(value) : value;
        }
        if (!value || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(entry => rewrite(entry, field, path));
        const result = {};
        for (const [key, entry] of Object.entries(value)) {
            const next = derived.get(key) || mapped(key);
            if (Object.hasOwn(result, next)) throw new Error(`${path.join('.')}: ID migration would overwrite map key ${next}; repair colliding identities first.`);
            result[next] = opaque.has(key) ? entry : rewrite(entry, key, [...path, key]);
        }
        return result;
    };
    return { serialized: rewrite(serialized), counts, replacements: Object.fromEntries(replacements) };
}

module.exports = { migrateOperationalIds, isUuid: value => typeof value === 'string' && UUID.test(value) };
