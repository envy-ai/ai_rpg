const Utils = require('./Utils.js');

function parseRegionLevelOffsetResponse(response) {
    const guidance = 'regionLevelOffset must be one integer from 1 to 4. Return exactly <regionLevelOffset>1</regionLevelOffset>, using the appropriate offset, with no attributes, nested elements or other text.';
    if (typeof response !== 'string' || !response.trim()) {
        throw new Error(guidance);
    }
    let document;
    try {
        document = Utils.parseXmlDocumentStrict(`<regionLevelOffsetResponse>${response.trim()}</regionLevelOffsetResponse>`, 'text/xml');
    } catch (cause) {
        throw new Error(`regionLevelOffset contains invalid XML: ${cause.message}. ${guidance}`, { cause });
    }
    const children = Array.from(document?.documentElement?.childNodes || [])
        .filter(node => !(node.nodeType === 3 && !node.textContent.trim()));
    const root = children[0];
    if (!root || root.tagName !== 'regionLevelOffset' || root.attributes.length
        || children.length !== 1 || Array.from(root.childNodes || []).some(node => node.nodeType !== 3)) {
        throw new Error(guidance);
    }
    const value = root.textContent.trim();
    if (!/^[1-4]$/.test(value)) throw new Error(guidance);
    return Number(value);
}

module.exports = { parseRegionLevelOffsetResponse };
