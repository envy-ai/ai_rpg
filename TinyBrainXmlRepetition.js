const MINIMUM_XML_BLOCK_LENGTH = 51;

function findMarkupEnd(text, startIndex, { declaration = false } = {}) {
    let quote = null;
    let subsetDepth = 0;
    for (let index = startIndex; index < text.length; index += 1) {
        const character = text[index];
        if (quote) {
            if (character === quote) {
                quote = null;
            }
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }
        if (declaration) {
            if (character === '[') {
                subsetDepth += 1;
                continue;
            }
            if (character === ']' && subsetDepth > 0) {
                subsetDepth -= 1;
                continue;
            }
        }
        if (character === '>' && subsetDepth === 0) {
            return index;
        }
    }
    return -1;
}

function readXmlName(text, startIndex) {
    const match = text.slice(startIndex).match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/);
    return match ? match[1] : null;
}

function trimEndIndex(text, endIndex) {
    let index = endIndex;
    while (index > 0 && /\s/.test(text[index - 1])) {
        index -= 1;
    }
    return index;
}

function blocksAreWhitespaceSeparated(text, blocks) {
    for (let index = 1; index < blocks.length; index += 1) {
        if (!/^\s*$/.test(text.slice(blocks[index - 1].end, blocks[index].start))) {
            return false;
        }
    }
    return true;
}

function buildDetection({ pattern, removeStart, removeEnd, blocks }) {
    return {
        pattern,
        truncateOffset: removeStart,
        duplicateEndOffset: removeEnd,
        duplicateLength: removeEnd - removeStart,
        blocks: blocks.map(block => ({
            name: block.name,
            start: block.start,
            end: block.end,
            length: block.raw.length,
            raw: block.raw
        }))
    };
}

function findTinyBrainXmlRepetition(responseText, {
    minimumBlockLength = MINIMUM_XML_BLOCK_LENGTH
} = {}) {
    if (typeof responseText !== 'string') {
        throw new TypeError('TinyBrain XML repetition detection requires response text.');
    }
    if (!Number.isInteger(minimumBlockLength) || minimumBlockLength < 1) {
        throw new RangeError('TinyBrain XML repetition minimum block length must be a positive integer.');
    }

    const stack = [];
    const completedByParent = new Map();
    let cursor = 0;
    while (cursor < responseText.length) {
        const opening = responseText.indexOf('<', cursor);
        if (opening < 0) {
            break;
        }
        if (responseText.startsWith('<!--', opening)) {
            const end = responseText.indexOf('-->', opening + 4);
            if (end < 0) {
                break;
            }
            cursor = end + 3;
            continue;
        }
        if (responseText.startsWith('<![CDATA[', opening)) {
            const end = responseText.indexOf(']]>', opening + 9);
            if (end < 0) {
                break;
            }
            cursor = end + 3;
            continue;
        }
        if (responseText.startsWith('<?', opening)) {
            const end = responseText.indexOf('?>', opening + 2);
            if (end < 0) {
                break;
            }
            cursor = end + 2;
            continue;
        }
        if (responseText.startsWith('<!', opening)) {
            const end = findMarkupEnd(responseText, opening + 2, { declaration: true });
            if (end < 0) {
                break;
            }
            cursor = end + 1;
            continue;
        }

        const closing = responseText.startsWith('</', opening);
        const nameStart = opening + (closing ? 2 : 1);
        const name = readXmlName(responseText, nameStart);
        if (!name) {
            cursor = opening + 1;
            continue;
        }
        const tagEnd = findMarkupEnd(responseText, nameStart + name.length);
        if (tagEnd < 0) {
            break;
        }

        if (!closing) {
            const beforeClose = responseText.slice(opening, tagEnd).trimEnd();
            if (!beforeClose.endsWith('/')) {
                stack.push({ name, start: opening });
            }
            cursor = tagEnd + 1;
            continue;
        }

        const openBlock = stack[stack.length - 1] || null;
        if (!openBlock || openBlock.name !== name) {
            stack.length = 0;
            completedByParent.clear();
            cursor = tagEnd + 1;
            continue;
        }
        stack.pop();
        const block = {
            name,
            start: openBlock.start,
            end: tagEnd + 1,
            raw: responseText.slice(openBlock.start, tagEnd + 1)
        };

        if (block.raw.length >= minimumBlockLength) {
            const precedingEnd = trimEndIndex(responseText, block.start);
            const precedingStart = precedingEnd - block.raw.length;
            if (
                precedingStart >= 0
                && responseText.slice(precedingStart, precedingEnd) === block.raw
            ) {
                return buildDetection({
                    pattern: 'AA',
                    removeStart: block.start,
                    removeEnd: block.end,
                    blocks: [
                        {
                            ...block,
                            start: precedingStart,
                            end: precedingEnd
                        },
                        block
                    ]
                });
            }
        }

        const parent = stack[stack.length - 1] || null;
        const parentKey = parent ? `${parent.start}:${parent.name}` : 'document';
        const siblings = completedByParent.get(parentKey) || [];
        siblings.push(block);
        completedByParent.set(parentKey, siblings);
        if (siblings.length >= 4) {
            const sequence = siblings.slice(-4);
            const [firstA, firstB, secondA, secondB] = sequence;
            if (
                sequence.every(entry => entry.raw.length >= minimumBlockLength)
                && firstA.raw === secondA.raw
                && firstB.raw === secondB.raw
                && blocksAreWhitespaceSeparated(responseText, sequence)
            ) {
                return buildDetection({
                    pattern: 'ABAB',
                    removeStart: secondA.start,
                    removeEnd: secondB.end,
                    blocks: sequence
                });
            }
        }

        cursor = tagEnd + 1;
    }
    return null;
}

class TinyBrainXmlRepetitionDetector {
    constructor({ minimumBlockLength = MINIMUM_XML_BLOCK_LENGTH } = {}) {
        if (!Number.isInteger(minimumBlockLength) || minimumBlockLength < 1) {
            throw new RangeError('TinyBrain XML repetition minimum block length must be a positive integer.');
        }
        this.minimumBlockLength = minimumBlockLength;
        this.lastInspectedResponse = '';
    }

    reset() {
        this.lastInspectedResponse = '';
    }

    inspect(responseText) {
        if (typeof responseText !== 'string') {
            throw new TypeError('TinyBrain XML repetition inspection requires response text.');
        }
        const extendsPrevious = responseText.startsWith(this.lastInspectedResponse);
        const newText = extendsPrevious
            ? responseText.slice(this.lastInspectedResponse.length)
            : responseText;
        this.lastInspectedResponse = responseText;
        if (!newText.includes('>')) {
            return null;
        }
        return findTinyBrainXmlRepetition(responseText, {
            minimumBlockLength: this.minimumBlockLength
        });
    }
}

module.exports = {
    MINIMUM_XML_BLOCK_LENGTH,
    TinyBrainXmlRepetitionDetector,
    findTinyBrainXmlRepetition
};
