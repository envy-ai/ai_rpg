const Utils = require('./Utils.js');

function getDirectElementChildren(node, tagName = null) {
    const normalizedTagName = typeof tagName === 'string' ? tagName.trim().toLowerCase() : null;
    return Array.from(node?.childNodes || []).filter(child => (
        child
        && child.nodeType === 1
        && child.tagName
        && (!normalizedTagName || child.tagName.toLowerCase() === normalizedTagName)
    ));
}

function getRequiredDirectChildText(node, tagName, contextLabel) {
    const matches = getDirectElementChildren(node, tagName);
    if (matches.length !== 1) {
        throw new Error(`${contextLabel} must contain exactly one <${tagName}> field.`);
    }
    const value = typeof matches[0].textContent === 'string' ? matches[0].textContent.trim() : '';
    if (!value) {
        throw new Error(`${contextLabel} has an empty <${tagName}> field.`);
    }
    return value;
}

function extractLocationXml(xmlSnippet) {
    if (typeof xmlSnippet !== 'string' || !xmlSnippet.trim()) {
        throw new Error('Location exit suggestions require a non-empty XML response.');
    }
    const match = xmlSnippet.match(/<location(?:\s[^>]*)?>[\s\S]*?<\/location>/i);
    if (!match) {
        throw new Error('Location generation response is missing a <location> root.');
    }
    return match[0];
}

function parseLocationExitSuggestions(xmlSnippet, { required = false } = {}) {
    const locationXml = extractLocationXml(xmlSnippet);
    const doc = Utils.parseXmlDocumentStrict(locationXml, 'text/xml');
    if (!doc || doc.getElementsByTagName('parsererror')?.length) {
        throw new Error('Location generation response contained invalid XML while parsing new exits.');
    }

    const root = doc.documentElement;
    if (!root || root.tagName?.toLowerCase() !== 'location') {
        throw new Error('Location generation response must use <location> as its root.');
    }

    const containers = getDirectElementChildren(root, 'newExits');
    if (containers.length > 1) {
        throw new Error('Location generation response contains more than one <newExits> block.');
    }
    if (!containers.length) {
        if (required) {
            throw new Error('Location generation response is missing the required <newExits> decision.');
        }
        return [];
    }

    const container = containers[0];
    const unexpectedChildren = getDirectElementChildren(container)
        .filter(child => child.tagName.toLowerCase() !== 'exit');
    if (unexpectedChildren.length) {
        throw new Error(`<newExits> contains unsupported <${unexpectedChildren[0].tagName}> content.`);
    }

    const suggestions = [];
    const seenDestinations = new Set();
    for (const [index, exitNode] of getDirectElementChildren(container, 'exit').entries()) {
        const contextLabel = `Location new exit ${index + 1}`;
        const destinationType = getRequiredDirectChildText(exitNode, 'destinationType', contextLabel).toLowerCase();
        if (destinationType !== 'location' && destinationType !== 'region') {
            throw new Error(`${contextLabel} has unsupported destination type "${destinationType}"; expected "location" or "region".`);
        }

        const name = getRequiredDirectChildText(exitNode, 'name', contextLabel);
        const description = getRequiredDirectChildText(exitNode, 'description', contextLabel);
        const travelTimeText = getRequiredDirectChildText(exitNode, 'travelTime', contextLabel);
        const duplicateKey = name.toLowerCase().replace(/\s+/g, ' ');
        if (seenDestinations.has(duplicateKey)) {
            continue;
        }

        suggestions.push({
            destinationType,
            name,
            description,
            travelTimeMinutes: Utils.normalizeGeneratedExitTravelTimeMinutes(
                Utils.parseDurationToMinutes(travelTimeText, {
                    fieldName: `${contextLabel} travelTime`
                }),
                {
                    fieldName: `${contextLabel} travelTime`
                }
            )
        });
        seenDestinations.add(duplicateKey);
    }

    return suggestions;
}

module.exports = {
    parseLocationExitSuggestions
};
