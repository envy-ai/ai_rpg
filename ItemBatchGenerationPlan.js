'use strict';

const Utils = require('./Utils.js');

function parseItemBatchPlan(response, { rarityDefinitions = [] } = {}) {
    const xml = Utils.extractFinalXmlRootBlock(response, 'itemsPlan');
    const root = Utils.parseXmlDocumentStrict(xml, 'text/xml').documentElement;
    const children = node => Array.from(node.childNodes || []).filter(child => child.nodeType === 1);
    const assertContainer = (node, label) => {
        if (node.attributes?.length || Array.from(node.childNodes || []).some(child =>
            [3, 4].includes(child.nodeType) && child.nodeValue.trim())) {
            throw new Error(`${label} must contain only documented XML child elements, without attributes or bare text.`);
        }
    };
    if (root?.tagName !== 'itemsPlan') throw new Error('Item planning requires one complete <itemsPlan> root.');
    assertContainer(root, '<itemsPlan>');
    const rarities = new Map();
    for (const definition of rarityDefinitions) {
        const key = String(definition.key || definition.label).trim().toLowerCase();
        rarities.set(key, key);
        rarities.set(String(definition.label || key).trim().toLowerCase(), key);
    }
    return children(root).map((node, index) => {
        const label = `Item plan entry ${index + 1}`;
        if (node.tagName !== 'item') throw new Error(`${label} must be an <item>.`);
        assertContainer(node, label);
        const values = {};
        const allowed = new Set(['name', 'description', 'rarity', 'count', 'relativeLevel', 'itemOrScenery']);
        for (const child of children(node)) {
            if (!allowed.delete(child.tagName)) throw new Error(`${label} has an unknown or duplicate <${child.tagName}> field.`);
            if (child.attributes?.length || children(child).length) throw new Error(`${label} <${child.tagName}> must contain plain text only.`);
            values[child.tagName] = child.textContent.trim();
        }
        for (const field of ['name', 'description', 'rarity']) {
            if (!values[field]) throw new Error(`${label} requires <${field}>.`);
        }
        const rarity = rarities.get(values.rarity.toLowerCase());
        if (!rarity) throw new Error(`${label} <rarity> "${values.rarity}" is unknown; use a configured rarity key or label.`);
        const count = values.count ? Number(values.count) : 1;
        if (!Number.isInteger(count) || count < 0) throw new Error(`${label} <count> must be an integer zero or greater; omit it for one item.`);
        const relativeLevel = values.relativeLevel ? Number(values.relativeLevel) : 0;
        if (!Number.isInteger(relativeLevel) || relativeLevel < -10 || relativeLevel > 10) {
            throw new Error(`${label} <relativeLevel> must be an integer from -10 through 10; omit it for zero.`);
        }
        if (values.itemOrScenery && values.itemOrScenery.toLowerCase() !== 'item') {
            throw new Error(`${label} <itemOrScenery> must be item; inventories and containers cannot hold scenery.`);
        }
        return { name: values.name, description: values.description, rarity, count, relativeLevel, itemOrScenery: 'item' };
    });
}

function validateItemBatchPlanAgainstSeeds(plan, seeds, { rarityDefinitions = [] } = {}) {
    if (plan.length !== seeds.length) throw new Error(`Item plan has ${plan.length} entries; return exactly ${seeds.length}, in requested order.`);
    for (const [index, seed] of seeds.entries()) {
        const planned = plan[index];
        if (planned.name !== seed.name) throw new Error(`Item plan entry ${index + 1} <name> must be exactly "${seed.name}"; preserve requested order.`);
        if (seed.count !== undefined && seed.count !== null && seed.count !== '' && planned.count !== Number(seed.count)) {
            throw new Error(`Item plan "${seed.name}" <count> must remain ${seed.count}.`);
        }
        const seedRarity = String(seed.rarity || '').trim().toLowerCase();
        const seedRarityDefinition = rarityDefinitions.find(definition =>
            [definition.key, definition.label].some(value => String(value || '').trim().toLowerCase() === seedRarity));
        const expectedRarity = seedRarityDefinition
            ? String(seedRarityDefinition.key || seedRarityDefinition.label).trim().toLowerCase() : seedRarity;
        if (seedRarity && expectedRarity !== planned.rarity) {
            throw new Error(`Item plan "${seed.name}" <rarity> must remain "${seed.rarity}".`);
        }
        if (seed.relativeLevel !== undefined && seed.relativeLevel !== null && seed.relativeLevel !== '' && planned.relativeLevel !== Number(seed.relativeLevel)) {
            throw new Error(`Item plan "${seed.name}" <relativeLevel> must remain ${seed.relativeLevel}.`);
        }
    }
    return plan;
}

function validateItemBatchExpansion(items, plan) {
    if (items.length !== plan.length) throw new Error(`Item expansion returned ${items.length} entries; return exactly the ${plan.length} unresolved roster entries in their approved order.`);
    for (const [index, expected] of plan.entries()) {
        const actual = items[index];
        for (const field of ['name', 'rarity', 'count', 'relativeLevel']) {
            const value = field === 'relativeLevel' ? (actual[field] ?? 0) : actual[field];
            if (value !== expected[field]) throw new Error(`Item expansion entry ${index + 1} <${field}> must remain ${JSON.stringify(expected[field])}; preserve the approved roster and order.`);
        }
    }
    return items;
}

function combineItemBatchEntries(plan, resolvedEntries, expandedItems) {
    if (resolvedEntries.length !== plan.length) throw new Error('Resolved item batch does not match the approved plan length.');
    let cursor = 0;
    const combined = resolvedEntries.map(entry => entry || expandedItems[cursor++]);
    if (cursor !== expandedItems.length || combined.some(entry => !entry)) throw new Error('Item batch expansion does not fill exactly the unresolved approved roster entries.');
    return combined;
}

function formatItemBatchPlanXml(plan, rootName = 'approvedItemsPlan') {
    const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
    return `<${rootName}>\n${plan.map(entry => '<item>' + ['name', 'itemOrScenery', 'rarity', 'description', 'count', 'relativeLevel']
        .filter(field => entry[field] !== undefined && entry[field] !== null)
        .map(field => `<${field}>${escape(entry[field])}</${field}>`).join('') + '</item>').join('\n')}\n</${rootName}>`;
}

module.exports = { parseItemBatchPlan, validateItemBatchPlanAgainstSeeds, validateItemBatchExpansion, combineItemBatchEntries, formatItemBatchPlanXml };
