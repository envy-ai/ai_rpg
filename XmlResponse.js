'use strict';

// Isolate an envelope without repairing it or selecting a valid descendant of
// an incomplete outer envelope. The XML parser still owns syntax validation.
function extractXmlRootBlock(input, {
    expectedRootTags = null,
    selectFinal = false,
    ignoreInlineCode = false,
    requireComplete = false
} = {}) {
    if (typeof input !== 'string') {
        throw new TypeError('XML root extraction requires a string input.');
    }
    let expected = null;
    if (expectedRootTags !== null) {
        const roots = Array.isArray(expectedRootTags) ? expectedRootTags : [expectedRootTags];
        if (!roots.length || roots.some(tag => typeof tag !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(tag))) {
            throw new TypeError('XML root extraction requires valid expected root names.');
        }
        expected = new Set(roots.map(tag => tag.toLowerCase()));
    }

    const tokens = /`+|<!--|<!\[CDATA\[|<\?|<!|<\/?([A-Za-z_][A-Za-z0-9_.:-]*)/g;
    let selected = null;
    let active = null;
    let match;
    while ((match = tokens.exec(input)) !== null) {
        if (match[0].startsWith('`')) {
            if (ignoreInlineCode && !active && match[0].length <= 2) {
                const delimiters = /`+/g;
                delimiters.lastIndex = tokens.lastIndex;
                let closing;
                while ((closing = delimiters.exec(input)) !== null) {
                    if (closing[0].length === match[0].length) {
                        tokens.lastIndex = delimiters.lastIndex;
                        break;
                    }
                }
            }
            continue;
        }
        const terminator = match[0] === '<!--' ? '-->'
            : match[0] === '<![CDATA[' ? ']]>'
                : match[0] === '<?' ? '?>' : null;
        if (terminator) {
            const end = input.indexOf(terminator, tokens.lastIndex);
            tokens.lastIndex = end < 0 ? input.length : end + terminator.length;
            continue;
        }

        // Quoted values and DOCTYPE internal subsets can contain tag-shaped
        // text. Skip the whole lexical token before considering another root.
        let quote = null;
        let subsetDepth = 0;
        let end = tokens.lastIndex;
        for (; end < input.length; end += 1) {
            const character = input[end];
            if (quote) {
                if (character === quote) quote = null;
            } else if (match[0] === '<!' && input.startsWith('<!--', end)) {
                const commentEnd = input.indexOf('-->', end + 4);
                if (commentEnd < 0) {
                    end = input.length;
                    break;
                }
                end = commentEnd + 2;
            } else if (character === '"' || character === "'") {
                quote = character;
            } else if (match[0] === '<!' && character === '[') {
                subsetDepth += 1;
            } else if (match[0] === '<!' && character === ']') {
                subsetDepth -= 1;
            } else if (character === '>' && subsetDepth === 0) {
                break;
            }
        }
        const completeTag = end < input.length;
        const selfClosing = completeTag && /\/\s*$/.test(input.slice(tokens.lastIndex, end));
        tokens.lastIndex = completeTag ? end + 1 : input.length;
        if (match[0] === '<!') continue;

        const name = match[1].toLowerCase();
        const closing = match[0].startsWith('</');
        if (!active && !closing && (!expected || expected.has(name))) {
            selected = { start: match.index, end: input.length, complete: false };
            if (selfClosing) {
                selected.end = end + 1;
                selected.complete = true;
                if (!selectFinal) break;
            } else {
                active = { name, depth: 1 };
            }
        } else if (active && name === active.name) {
            if (closing) {
                active.depth -= 1;
                if (active.depth === 0) {
                    selected.end = completeTag ? end + 1 : input.length;
                    selected.complete = completeTag;
                    active = null;
                    if (!selectFinal) break;
                }
            } else if (!selfClosing) {
                active.depth += 1;
            }
        }
    }
    return selected && (!requireComplete || selected.complete)
        ? input.slice(selected.start, selected.end) : '';
}

module.exports = { extractXmlRootBlock };
