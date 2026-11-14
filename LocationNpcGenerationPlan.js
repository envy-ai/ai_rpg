'use strict';

const { XMLSerializer } = require('@xmldom/xmldom');
const Utils = require('./Utils.js');
const { XmlClosingTagGuard } = require('./XmlClosingTagGuard.js');

function parseLocationNpcXmlPlan(response, { maxQuantity = 20, schema } = {}) {
    if (typeof response !== 'string' || !response.trim()) {
        throw new Error('Location NPC plan requires one complete <npcsPlan> XML root.');
    }
    if (!Number.isInteger(maxQuantity) || maxQuantity < 1) {
        throw new TypeError('Location NPC plan maxQuantity must be a positive integer.');
    }
    if (!schema) throw new TypeError('Location NPC plan requires its compiled XML schema.');
    const xml = Utils.extractFinalXmlRootBlock(response, 'npcsPlan');
    const doc = Utils.parseXmlDocumentStrict(xml, 'text/xml');
    validateSchema(xml, schema, 'Location NPC plan');
    const rows = directElements(doc.documentElement);
    if (!rows.length) {
        throw new Error('Location NPC <npcsPlan> needs at least one <npc> entry when NPC generation was requested.');
    }
    const names = new Set();
    return rows.map((row, index) => {
        const label = `Location NPC plan <npc> ${index + 1}`;
        const rawKind = directChild(row, 'kind')?.textContent.trim() || '';
        const name = directChild(row, 'name')?.textContent.trim() || '';
        const rawQuantity = directChild(row, 'quantity')?.textContent.trim() || '';
        const description = directChild(row, 'description')?.textContent.trim() || '';
        const kind = rawKind.toLowerCase();
        if (kind !== 'npc' && kind !== 'hostile') {
            throw new Error(`${label} <kind> must be npc or hostile; received ${JSON.stringify(rawKind)}.`);
        }
        if (!name) throw new Error(`${label} <name> must identify one new NPC profile.`);
        if (!description) throw new Error(`${label} <description> must briefly describe that profile.`);
        if (!/^[1-9]\d*$/.test(rawQuantity) || !Number.isSafeInteger(Number(rawQuantity))
            || Number(rawQuantity) > maxQuantity) {
            throw new Error(`${label} <quantity> must be a plain integer from 1 through ${maxQuantity}; received ${JSON.stringify(rawQuantity)}.`);
        }
        const key = name.toLowerCase();
        if (names.has(key)) throw new Error(`${label} <name> ${JSON.stringify(name)} duplicates another planned NPC; use distinct names.`);
        names.add(key);
        return { kind, name, quantity: Number(rawQuantity), description };
    });
}

const directElements = node => Array.from(node?.childNodes || []).filter(child => child.nodeType === 1);
const directChild = (node, tagName) => directElements(node).find(child => child.tagName === tagName) || null;

function validateSchema(xml, schema, label) {
    const guard = new XmlClosingTagGuard({ mode: true, schema, allowToolCalls: false });
    const violation = guard.inspect(xml);
    if (violation) {
        throw new Error(`${label} XML schema rejects ${violation.actualName || 'markup'}: ${violation.message} Correct the named element and return one complete <${schema.name}>.`);
    }
    if (guard.terminalState(xml).incomplete) {
        throw new Error(`${label} XML schema requires a complete <${schema.name}> with every required child; close the root and supply missing required fields.`);
    }
}

function parseLocationNpcCheckpoint(response, entry, { schema, parseNpcXml, validateCandidates } = {}) {
    if (!entry || !['npc', 'hostile'].includes(entry.kind) || !entry.name || !Number.isInteger(entry.quantity)) {
        throw new TypeError('Location NPC checkpoint requires one approved plan entry.');
    }
    if (!schema || typeof parseNpcXml !== 'function' || typeof validateCandidates !== 'function') {
        throw new TypeError('Location NPC checkpoint requires its compiled schema, native parser, and detached candidate validator.');
    }
    const label = `Location NPC ${JSON.stringify(entry.name)}`;
    try {
        const xml = Utils.extractFinalXmlRootBlock(response, 'response');
        const doc = Utils.parseXmlDocumentStrict(xml, 'text/xml');
        validateSchema(xml, schema, label);
        const root = doc.documentElement;
        const npcNodes = directElements(directChild(root, 'npcs')).filter(node => node.tagName === 'npc');
        const hostileNodes = directElements(directChild(root, 'hostiles')).filter(node => node.tagName === 'hostile');
        if (npcNodes.length + hostileNodes.length !== 1) {
            throw new Error(`${label} requires exactly one <npc> or <hostile> entry in the matching wrapper; remove extra entries.`);
        }
        const actualKind = npcNodes.length ? 'npc' : 'hostile';
        if (actualKind !== entry.kind) {
            throw new Error(`${label} was planned as ${entry.kind}; use one <${entry.kind}> in its matching wrapper.`);
        }
        const node = npcNodes[0] || hostileNodes[0];
        for (const [tagName, expected] of [
            ['name', entry.name], ['quantity', String(entry.quantity)],
            ['description', entry.description], ['isHostile', String(entry.kind === 'hostile')]
        ]) {
            const echoed = directChild(node, tagName);
            if (echoed && echoed.textContent.trim() && echoed.textContent.trim() !== expected) {
                throw new Error(`${label} <${tagName}> must be omitted or exactly ${JSON.stringify(expected)} from the approved plan; do not change known fields.`);
            }
            if (!echoed) {
                const child = doc.createElement(tagName);
                child.appendChild(doc.createTextNode(expected));
                node.appendChild(child);
            } else if (!echoed.textContent.trim()) {
                echoed.appendChild(doc.createTextNode(expected));
            }
        }
        const memories = directChild(root, 'memories');
        const memoryRecords = directElements(memories);
        if (memoryRecords.length > 1) throw new Error(`${label} <memories> may contain only this planned NPC's one <npcMemories> record.`);
        if (memoryRecords.length) {
            const record = memoryRecords[0];
            const owner = directChild(record, 'npcName');
            if (owner && owner.textContent.trim() && owner.textContent.trim() !== entry.name) {
                throw new Error(`${label} <memories>/<npcMemories>/<npcName> must be omitted or exactly ${JSON.stringify(entry.name)}; do not assign another NPC's memories.`);
            }
            if (!owner) {
                const child = doc.createElement('npcName');
                child.appendChild(doc.createTextNode(entry.name));
                record.appendChild(child);
            } else if (!owner.textContent.trim()) {
                owner.appendChild(doc.createTextNode(entry.name));
            }
        }
        const assembledXml = new XMLSerializer().serializeToString(doc);
        const parsed = parseNpcXml(assembledXml);
        if (!Array.isArray(parsed?.npcs) || parsed.npcs.length !== 1) {
            throw new Error(`${label} must parse to exactly one NPC; supply its complete profile.`);
        }
        const npc = parsed.npcs[0];
        if (npc.name !== entry.name || npc.quantity !== entry.quantity || npc.isHostile !== (entry.kind === 'hostile')) {
            throw new Error(`${label} changed an approved name, quantity, or hostility; keep the planned values.`);
        }
        validateCandidates(parsed.npcs);
        return { xml: assembledXml, npc, memories: parsed.memories };
    } catch (cause) {
        const seen = new Set();
        for (let current = cause; current && !seen.has(current); current = current.cause) {
            seen.add(current);
            if (current.code === 'PROMPT_CANCELLED' || current.name === 'PromptCancellationError') throw cause;
        }
        throw new Error(`${label} checkpoint failed: ${cause.message}`, { cause });
    }
}

module.exports = { parseLocationNpcXmlPlan, parseLocationNpcCheckpoint };
