'use strict';

const { normalizeFavorList } = require('./FactionFavor.js');
const FactionFavorEffectRegistry = require('./FactionFavorEffectRegistry.js');

const directChildren = (node, tagName) => Array.from(node?.childNodes || [])
    .filter(child => child && child.nodeType === 1 && (child.tagName || child.nodeName) === tagName);

const childText = (node, tagName) => {
    const matches = directChildren(node, tagName);
    if (matches.length > 1) {
        throw new Error(`<${node.tagName || node.nodeName}> has more than one <${tagName}>.`);
    }
    return matches.length ? matches[0].textContent.trim() : '';
};

function parseEffectNode(effectNode, label) {
    if (!effectNode) return null;
    const type = childText(effectNode, 'type').toLowerCase();
    if (!type || type === 'none') return null;
    if (!FactionFavorEffectRegistry.has(type)) {
        throw new Error(`${label} <effect><type> "${type}" is not a known effect. Use one of: none, ${FactionFavorEffectRegistry.types.join(', ')}.`);
    }
    if (type === 'grant-item') {
        return { type, params: { name: childText(effectNode, 'itemName'), description: childText(effectNode, 'itemDescription') } };
    }
    if (type === 'grant-currency') {
        return { type, params: { amount: childText(effectNode, 'amount') } };
    }
    if (type === 'restore-needs') {
        const container = directChildren(effectNode, 'needBars')[0] || null;
        const bars = container
            ? directChildren(container, 'needBar').map(barNode => ({
                needBar: childText(barNode, 'name'),
                percentage: childText(barNode, 'percentage')
            }))
            : [];
        return { type, params: { bars } };
    }
    return { type, params: {} };
}

/** Reads the optional <favors> child of a faction node without validating it. */
function parseFavorDraftsFromFactionNode(factionNode, { factionName = 'faction' } = {}) {
    const containers = directChildren(factionNode, 'favors');
    if (containers.length > 1) {
        throw new Error(`Faction "${factionName}" has more than one <favors> element.`);
    }
    if (!containers.length) return [];
    return directChildren(containers[0], 'favor').map((favorNode, index) => {
        const label = `Faction "${factionName}" favor ${index + 1}`;
        return {
            name: childText(favorNode, 'name'),
            shortDescription: childText(favorNode, 'shortDescription'),
            description: childText(favorNode, 'description'),
            minThreshold: childText(favorNode, 'minThreshold'),
            cooldown: childText(favorNode, 'cooldown'),
            requiresTarget: childText(favorNode, 'requiresTarget') || 'false',
            targetPrompt: childText(favorNode, 'targetPrompt'),
            presence: childText(favorNode, 'presence') || 'anywhere',
            effect: parseEffectNode(directChildren(favorNode, 'effect')[0] || null, label)
        };
    });
}

/**
 * Parses the optional <favors> child of a generated faction node and validates
 * the favors against that faction's tiers. Returns draft favors without ids.
 */
function parseFavorsFromFactionNode(factionNode, { factionName, tiers }) {
    const drafts = parseFavorDraftsFromFactionNode(factionNode, { factionName });
    return normalizeFavorList(drafts, { tiers, factionName, register: false })
        .map(({ id, imageId, imagePrompt, ...favor }) => favor);
}

module.exports = {
    parseFavorDraftsFromFactionNode,
    parseFavorsFromFactionNode
};
