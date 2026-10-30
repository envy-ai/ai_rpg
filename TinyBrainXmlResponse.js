'use strict';

const { extractXmlRootBlock } = require('./XmlResponse.js');

// Select a model-authored envelope, not a valid descendant or an earlier valid
// answer. Validation belongs to the caller's strict XML/domain parser.
function extractTinyBrainXmlResponse(response, expectedRootTags) {
    if (typeof response !== 'string' || !response.trim()) {
        throw new TypeError('TinyBrain XML extraction requires a non-empty response.');
    }
    const roots = Array.isArray(expectedRootTags) ? expectedRootTags : [expectedRootTags];
    if (!roots.length || roots.some(tag => typeof tag !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(tag))) {
        throw new TypeError('TinyBrain XML extraction requires valid expected root names.');
    }
    const raw = response.trim().replace(/^```(?:xml)?\s*/i, '').replace(/\s*```$/, '').trim();
    return extractXmlRootBlock(raw, {
        expectedRootTags: roots,
        selectFinal: true,
        ignoreInlineCode: true
    }) || raw;
}

module.exports = { extractTinyBrainXmlResponse };
