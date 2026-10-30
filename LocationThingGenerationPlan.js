const Utils = require('./Utils.js');
const { extractTinyBrainXmlResponse } = require('./TinyBrainXmlResponse.js');
const { validateGeneratedLocationThingBatch } = require('./LocationThingGenerationValidation.js');

function directElements(node) {
    return Array.from(node.childNodes || []).filter(child => child.nodeType === 1);
}

function parseDocument(response, rootName) {
    const xml = extractTinyBrainXmlResponse(response, [rootName]);
    const doc = Utils.parseXmlDocumentStrict(xml, 'text/xml');
    const root = doc.documentElement;
    if (root?.tagName !== rootName) {
        throw new Error(`Location things generation requires one complete <${rootName}>...</${rootName}> root; received <${root?.tagName || 'missing'}>.`);
    }
    return { xml, doc, root };
}

function assertNoAttributes(node, label) {
    if (node.attributes?.length) throw new Error(`${label} must use child elements, not attributes.`);
}

function assertNoBareText(node, label) {
    const text = Array.from(node.childNodes || []).filter(child => child.nodeType === 3 || child.nodeType === 4)
        .map(child => child.nodeValue || '').join('').trim();
    if (text) throw new Error(`${label} must contain only its documented child elements.`);
}

function buildRarityKeys(rarityDefinitions) {
    if (!Array.isArray(rarityDefinitions) || !rarityDefinitions.length) {
        throw new TypeError('Location things planning requires configured rarityDefinitions.');
    }
    const rarityKeys = new Map();
    for (const definition of rarityDefinitions) {
        const label = typeof definition.label === 'string' ? definition.label.trim() : '';
        if (!label) throw new Error('Location things planning rarity definitions require a non-empty label.');
        const key = typeof definition.key === 'string' && definition.key.trim()
            ? definition.key.trim().toLowerCase() : label.toLowerCase();
        rarityKeys.set(label.toLowerCase(), key);
        rarityKeys.set(key, key);
    }
    return rarityKeys;
}

function normalizeLocationThingRarities(entries, rarityDefinitions) {
    const rarityKeys = buildRarityKeys(rarityDefinitions);
    return entries.map((entry, index) => {
        const rarity = rarityKeys.get(String(entry?.rarity || '').trim().toLowerCase());
        if (!rarity) throw new Error(`Location things entry ${index + 1} has unknown rarity "${entry?.rarity || '(blank)'}"; use a configured rarity.`);
        return { ...entry, rarity };
    });
}

function parseLocationThingsPlan(response, requirements = {}) {
    const { root } = parseDocument(response, 'thingsPlan');
    assertNoAttributes(root, '<thingsPlan>');
    assertNoBareText(root, '<thingsPlan>');
    const names = new Set();
    const entries = directElements(root).map((node, index) => {
        const label = `Location things plan entry ${index + 1}`;
        if (node.tagName !== 'item') throw new Error(`${label} must be an <item> child of <thingsPlan>.`);
        assertNoAttributes(node, label);
        assertNoBareText(node, label);
        const fields = new Set(['name', 'itemOrScenery', 'rarity', 'description']);
        const values = {};
        for (const child of directElements(node)) {
            if (!fields.has(child.tagName)) throw new Error(`${label} has an unexpected or duplicate <${child.tagName}> field.`);
            fields.delete(child.tagName);
            assertNoAttributes(child, `${label} <${child.tagName}>`);
            if (directElements(child).length) throw new Error(`${label} <${child.tagName}> must contain plain text.`);
            const value = child.textContent.trim();
            if (!value) throw new Error(`${label} requires non-empty <${child.tagName}> content.`);
            values[child.tagName] = value;
        }
        if (fields.size) throw new Error(`${label} is missing ${[...fields].map(field => `<${field}>`).join(', ')}.`);
        const nameKey = values.name.toLowerCase();
        if (names.has(nameKey)) throw new Error(`Location things plan contains duplicate name "${values.name}"; use unique names across items and scenery.`);
        names.add(nameKey);
        values.itemOrScenery = values.itemOrScenery.toLowerCase();
        return values;
    });
    return validateGeneratedLocationThingBatch(normalizeLocationThingRarities(entries, requirements.rarityDefinitions), requirements);
}

function parseLocationThingsDocument(response) {
    const parsed = parseDocument(response, 'things');
    assertNoAttributes(parsed.root, '<things>');
    assertNoBareText(parsed.root, '<things>');
    for (const child of directElements(parsed.root)) {
        if (child.tagName !== 'item') throw new Error(`Location things <things> requires direct <item> entries, not <${child.tagName}>.`);
    }
    return parsed;
}

function validateLocationThingsAgainstPlan(parsedItems, plan) {
    if (!Array.isArray(parsedItems) || !Array.isArray(plan)) {
        throw new TypeError('Location things roster matching requires parsed items and an approved plan.');
    }
    const expected = new Map(plan.map(entry => [entry.name, entry]));
    const seen = new Set();
    for (const entry of parsedItems) {
        const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
        const planned = expected.get(name);
        if (!planned) throw new Error(`Location things expansion includes unplanned name "${name}"; preserve every approved name exactly and add no entries.`);
        if (seen.has(name)) throw new Error(`Location things expansion duplicates "${name}"; return each approved entry exactly once.`);
        seen.add(name);
        for (const field of ['itemOrScenery', 'rarity']) {
            if (String(entry[field] || '').trim().toLowerCase() !== planned[field].trim().toLowerCase()) {
                throw new Error(`Location things expansion "${name}" must keep approved ${field} "${planned[field]}"; received "${entry[field] || '(blank)'}".`);
            }
        }
    }
    const missing = [...expected.keys()].filter(name => !seen.has(name));
    if (missing.length) throw new Error(`Location things expansion is missing approved entries: ${missing.join(', ')}.`);
    return parsedItems;
}

module.exports = { parseLocationThingsPlan, parseLocationThingsDocument, normalizeLocationThingRarities, validateLocationThingsAgainstPlan };
