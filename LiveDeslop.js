const Utils = require('./Utils.js');

const PROSE_TAG_PATTERN = /<(prose|originProse|betweenProse|destinationProse)(?:\s[^>]*)?>/gi;
const PROSE_BOUNDARY_SEPARATOR = '\n\n';

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findXmlTagEnd(text, tagStart) {
    let quote = null;
    for (let index = tagStart + 1; index < text.length; index += 1) {
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
        if (character === '>') {
            return index;
        }
    }
    return -1;
}

function splitXmlTextFragments(text, { rawOffset = 0, excludeHiddenContent = true } = {}) {
    if (typeof text !== 'string') {
        throw new TypeError('splitXmlTextFragments requires string text.');
    }
    if (!Number.isInteger(rawOffset) || rawOffset < 0) {
        throw new RangeError('splitXmlTextFragments rawOffset must be a non-negative integer.');
    }

    const fragments = [];
    let cursor = 0;
    let hiddenDepth = 0;
    while (cursor < text.length) {
        const tagStart = text.indexOf('<', cursor);
        if (tagStart < 0) {
            if (hiddenDepth === 0 && cursor < text.length) {
                fragments.push({
                    text: text.slice(cursor),
                    rawStart: rawOffset + cursor,
                    rawEnd: rawOffset + text.length
                });
            }
            break;
        }

        if (hiddenDepth === 0 && tagStart > cursor) {
            fragments.push({
                text: text.slice(cursor, tagStart),
                rawStart: rawOffset + cursor,
                rawEnd: rawOffset + tagStart
            });
        }

        const tagEnd = findXmlTagEnd(text, tagStart);
        if (tagEnd < 0) {
            break;
        }
        const tagText = text.slice(tagStart, tagEnd + 1);
        const tagMatch = tagText.match(/^<\s*(\/?)\s*([a-z_][\w:.-]*)\b[\s\S]*>$/i);
        if (excludeHiddenContent && tagMatch && tagMatch[2].toLowerCase() === 'hidden') {
            const isClosing = Boolean(tagMatch[1]);
            const isSelfClosing = /\/\s*>$/.test(tagText);
            if (isClosing) {
                hiddenDepth = Math.max(0, hiddenDepth - 1);
            } else if (!isSelfClosing) {
                hiddenDepth += 1;
            }
        }
        cursor = tagEnd + 1;
    }
    return fragments;
}

function sanitizeLiveSlopText(text) {
    if (typeof text !== 'string') {
        throw new TypeError('sanitizeLiveSlopText requires string text.');
    }
    return splitXmlTextFragments(text, { excludeHiddenContent: true })
        .map(fragment => fragment.text)
        .join(PROSE_BOUNDARY_SEPARATOR);
}

function extractLiveProse(rawResponse) {
    if (typeof rawResponse !== 'string') {
        throw new TypeError('extractLiveProse requires a string response.');
    }

    const segments = [];
    PROSE_TAG_PATTERN.lastIndex = 0;
    let openingMatch = null;
    while ((openingMatch = PROSE_TAG_PATTERN.exec(rawResponse)) !== null) {
        const tagName = openingMatch[1];
        const rawStart = openingMatch.index + openingMatch[0].length;
        const closingPattern = new RegExp(`<\\/\\s*${escapeRegExp(tagName)}\\s*>`, 'ig');
        closingPattern.lastIndex = rawStart;
        const closingMatch = closingPattern.exec(rawResponse);
        const rawEnd = closingMatch ? closingMatch.index : rawResponse.length;
        segments.push({
            tagName,
            rawStart,
            rawEnd,
            closed: Boolean(closingMatch),
            text: rawResponse.slice(rawStart, rawEnd)
        });
        if (!closingMatch) {
            break;
        }
        PROSE_TAG_PATTERN.lastIndex = closingMatch.index + closingMatch[0].length;
    }

    let prose = '';
    const fragments = [];
    segments.forEach((segment, segmentIndex) => {
        const segmentFragments = splitXmlTextFragments(segment.text, {
            rawOffset: segment.rawStart,
            excludeHiddenContent: true
        });
        segment.fragmentStartIndex = fragments.length;
        segment.proseStart = prose.length;
        for (const rawFragment of segmentFragments) {
            if (prose) {
                prose += PROSE_BOUNDARY_SEPARATOR;
            }
            const fragment = {
                ...rawFragment,
                segmentIndex,
                proseStart: prose.length
            };
            prose += fragment.text;
            fragment.proseEnd = prose.length;
            fragments.push(fragment);
        }
        segment.proseEnd = prose.length;
        segment.fragmentEndIndex = fragments.length;
    });

    const ngramSegments = fragments
        .filter(fragment => fragment.text.trim())
        .map(fragment => ({
            text: fragment.text,
            start: fragment.proseStart,
            end: fragment.proseEnd
        }));

    return {
        prose,
        segments,
        fragments,
        ngramSegments,
        toRawOffset(proseOffset) {
            if (!Number.isInteger(proseOffset) || proseOffset < 0) {
                throw new RangeError('Prose offset must be a non-negative integer.');
            }
            for (const fragment of fragments) {
                if (proseOffset >= fragment.proseStart && proseOffset < fragment.proseEnd) {
                    return fragment.rawStart + (proseOffset - fragment.proseStart);
                }
            }
            if (fragments.length && proseOffset === prose.length) {
                return fragments.at(-1).rawEnd;
            }
            throw new Error(`Unable to map prose offset ${proseOffset} into the streamed response.`);
        }
    };
}

function extractStableLiveProse(rawResponse) {
    const extraction = extractLiveProse(rawResponse);
    const lastSegment = extraction.segments.at(-1) || null;
    if (!lastSegment || lastSegment.closed) {
        return extraction;
    }

    const lastFragment = extraction.fragments
        .filter(fragment => fragment.segmentIndex === extraction.segments.length - 1)
        .at(-1) || null;
    if (!lastFragment || lastFragment.rawEnd !== rawResponse.length) {
        return extraction;
    }

    const trailingPartialWord = lastFragment.text.match(/[a-z0-9']+$/i);
    if (!trailingPartialWord) {
        return extraction;
    }
    const stableRawResponse = rawResponse.slice(0, lastFragment.rawStart + trailingPartialWord.index);
    return extractLiveProse(stableRawResponse);
}

function extractLivePlainProse(rawResponse) {
    if (typeof rawResponse !== 'string') {
        throw new TypeError('extractLivePlainProse requires a string response.');
    }

    let prose = '';
    const fragments = splitXmlTextFragments(rawResponse, { excludeHiddenContent: true })
        .map(rawFragment => {
            if (prose) {
                prose += PROSE_BOUNDARY_SEPARATOR;
            }
            const fragment = {
                ...rawFragment,
                segmentIndex: 0,
                proseStart: prose.length
            };
            prose += fragment.text;
            fragment.proseEnd = prose.length;
            return fragment;
        });
    const ngramSegments = fragments
        .filter(fragment => fragment.text.trim())
        .map(fragment => ({
            text: fragment.text,
            start: fragment.proseStart,
            end: fragment.proseEnd
        }));

    return {
        prose,
        segments: rawResponse.length
            ? [{
                tagName: null,
                rawStart: 0,
                rawEnd: rawResponse.length,
                closed: true,
                text: rawResponse,
                proseStart: 0,
                proseEnd: prose.length,
                fragmentStartIndex: 0,
                fragmentEndIndex: fragments.length
            }]
            : [],
        fragments,
        ngramSegments,
        toRawOffset(proseOffset) {
            if (!Number.isInteger(proseOffset) || proseOffset < 0) {
                throw new RangeError('Prose offset must be a non-negative integer.');
            }
            for (const fragment of fragments) {
                if (proseOffset >= fragment.proseStart && proseOffset < fragment.proseEnd) {
                    return fragment.rawStart + (proseOffset - fragment.proseStart);
                }
            }
            if (fragments.length && proseOffset === prose.length) {
                return fragments.at(-1).rawEnd;
            }
            throw new Error(`Unable to map prose offset ${proseOffset} into the draft response.`);
        }
    };
}

function extractStableLivePlainProse(rawResponse) {
    const extraction = extractLivePlainProse(rawResponse);
    const lastFragment = extraction.fragments.at(-1) || null;
    if (!lastFragment || lastFragment.rawEnd !== rawResponse.length) {
        return extraction;
    }

    const trailingPartialWord = lastFragment.text.match(/[a-z0-9']+$/i);
    if (!trailingPartialWord) {
        return extraction;
    }
    const stableRawResponse = rawResponse.slice(0, lastFragment.rawStart + trailingPartialWord.index);
    return extractLivePlainProse(stableRawResponse);
}

function resolveTinyBrainLiveDeslopProseMode({ messages, isFinal = false } = {}) {
    if (isFinal) {
        return 'structured';
    }
    if (!Array.isArray(messages)) {
        throw new TypeError('Tiny-brain live deslop stage resolution requires messages.');
    }
    let stagePrompt = '';
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'user' && typeof messages[index].content === 'string') {
            stagePrompt = messages[index].content.trimStart();
            break;
        }
    }
    if (/^Draft Response:/i.test(stagePrompt) || /^Write a second draft\b/i.test(stagePrompt)) {
        return 'plain';
    }
    return null;
}

function findLastWordMatch(prose, word) {
    const target = typeof word === 'string' ? word.trim().toLowerCase() : '';
    if (!target) {
        return null;
    }
    const wordPattern = /[a-z]+(?:'[a-z]+)?/gi;
    let latest = null;
    let match = null;
    while ((match = wordPattern.exec(prose)) !== null) {
        if (match[0].toLowerCase() === target) {
            latest = {
                start: match.index,
                end: match.index + match[0].length,
                type: 'word',
                label: target
            };
        }
    }
    return latest;
}

function findLastNgramMatch(prose, ngram, ngramSegments = null) {
    const targetTokens = Utils.normalizeKgramTokens(ngram);
    if (!targetTokens.length) {
        return null;
    }
    const sourceSegments = ngramSegments === null
        ? [{ text: prose, start: 0, end: prose.length }]
        : ngramSegments;
    if (!Array.isArray(sourceSegments)) {
        throw new TypeError('Live n-gram segments must be an array.');
    }
    let latest = null;
    for (const segment of sourceSegments) {
        if (!segment || typeof segment.text !== 'string' || !Number.isInteger(segment.start)) {
            throw new TypeError('Live n-gram segment entries require text and an integer start offset.');
        }
        const proseTokens = Utils.normalizeKgramTokenSpans(segment.text);
        for (let index = 0; index <= proseTokens.length - targetTokens.length; index += 1) {
            let matches = true;
            for (let tokenIndex = 0; tokenIndex < targetTokens.length; tokenIndex += 1) {
                if (proseTokens[index + tokenIndex].token !== targetTokens[tokenIndex]) {
                    matches = false;
                    break;
                }
            }
            if (!matches) {
                continue;
            }
            const candidate = {
                start: segment.start + proseTokens[index].start,
                end: segment.start + proseTokens[index + targetTokens.length - 1].end,
                type: 'ngram',
                label: targetTokens.join(' ')
            };
            if (!latest || candidate.end >= latest.end) {
                latest = candidate;
            }
        }
    }
    return latest;
}

function locateDetectedSlop({
    prose,
    slopWords = [],
    slopRegexes = [],
    slopRegexMatches = [],
    slopNgrams = [],
    ngramSegments = null
} = {}) {
    if (typeof prose !== 'string' || !prose.trim()) {
        return null;
    }
    if (!Array.isArray(slopWords) || !Array.isArray(slopRegexes) || !Array.isArray(slopRegexMatches) || !Array.isArray(slopNgrams)) {
        throw new TypeError('locateDetectedSlop requires array diagnostics.');
    }

    const candidates = [];
    for (const word of slopWords) {
        const match = findLastWordMatch(prose, word);
        if (match) {
            candidates.push(match);
        }
    }
    const regexNameSet = new Set(slopRegexes);
    for (const match of slopRegexMatches) {
        if (!match || !regexNameSet.has(match.name) || !Number.isInteger(match.index) || !Number.isInteger(match.length)) {
            continue;
        }
        candidates.push({
            start: match.index,
            end: match.index + match.length,
            type: 'regex',
            label: match.name
        });
    }
    for (const ngram of slopNgrams) {
        const match = findLastNgramMatch(prose, ngram, ngramSegments);
        if (match) {
            candidates.push(match);
        }
    }

    if (!candidates.length) {
        throw new Error('Live slop analysis reported a match that could not be located in the prose.');
    }
    candidates.sort((left, right) => (
        (right.end - left.end)
        || (left.start - right.start)
    ));
    return {
        ...candidates[0],
        slopWords: [...slopWords],
        slopRegexes: [...slopRegexes],
        slopNgrams: [...slopNgrams]
    };
}

function buildRepeatedNgramIndex(segments, minK) {
    if (!Array.isArray(segments)) {
        throw new TypeError('Live repeated n-gram history must be an array.');
    }
    const index = new Map();
    segments.forEach((rawText, segmentIndex) => {
        if (typeof rawText !== 'string' || !rawText.trim()) {
            return;
        }
        const xmlFragments = splitXmlTextFragments(rawText, { excludeHiddenContent: true });
        xmlFragments.forEach((fragment, fragmentIndex) => {
            const tokens = Utils.normalizeKgramTokens(fragment.text);
            for (let tokenIndex = 0; tokenIndex <= tokens.length - minK; tokenIndex += 1) {
                const key = tokens.slice(tokenIndex, tokenIndex + minK).join(' ');
                const occurrences = index.get(key) || [];
                occurrences.push({
                    rawText: fragment.text,
                    segmentIndex,
                    fragmentIndex,
                    tokenIndex,
                    tokens
                });
                index.set(key, occurrences);
            }
        });
    });
    return index;
}

function findIndexedRepeatedNgrams(prose, index, minK) {
    const proseTokens = Utils.normalizeKgramTokens(prose);
    if (proseTokens.length < minK) {
        return [];
    }
    const matches = new Set();
    for (let proseIndex = 0; proseIndex <= proseTokens.length - minK; proseIndex += 1) {
        const key = proseTokens.slice(proseIndex, proseIndex + minK).join(' ');
        const occurrences = index.get(key) || [];
        for (const occurrence of occurrences) {
            if (occurrence.rawText === prose) {
                continue;
            }
            let proseStart = proseIndex;
            let historyStart = occurrence.tokenIndex;
            while (
                proseStart > 0
                && historyStart > 0
                && proseTokens[proseStart - 1] === occurrence.tokens[historyStart - 1]
            ) {
                proseStart -= 1;
                historyStart -= 1;
            }

            let proseEnd = proseIndex + minK;
            let historyEnd = occurrence.tokenIndex + minK;
            while (
                proseEnd < proseTokens.length
                && historyEnd < occurrence.tokens.length
                && proseTokens[proseEnd] === occurrence.tokens[historyEnd]
            ) {
                proseEnd += 1;
                historyEnd += 1;
            }
            matches.add(proseTokens.slice(proseStart, proseEnd).join(' '));
        }
    }
    return Utils.pruneContainedKgrams(Array.from(matches));
}

class LiveRepeatedNgramDetector {
    constructor({ baseSegments = [], supplementalSegments = [] } = {}) {
        this.baseIndex = buildRepeatedNgramIndex(baseSegments, 3);
        this.supplementalIndex = buildRepeatedNgramIndex(supplementalSegments, 6);
    }

    find(prose, { segments = null } = {}) {
        if (typeof prose !== 'string' || !prose.trim()) {
            return [];
        }
        const sourceSegments = segments === null
            ? splitXmlTextFragments(prose, { excludeHiddenContent: true }).map(fragment => fragment.text)
            : segments.map(segment => (typeof segment === 'string' ? segment : segment?.text));
        if (sourceSegments.some(segment => typeof segment !== 'string')) {
            throw new TypeError('Live repeated n-gram segments must contain strings or text entries.');
        }
        const matches = [];
        for (const segment of sourceSegments) {
            matches.push(
                ...findIndexedRepeatedNgrams(segment, this.baseIndex, 3),
                ...findIndexedRepeatedNgrams(segment, this.supplementalIndex, 6)
            );
        }
        return Utils.pruneContainedKgrams(matches);
    }
}

function collectRewindTokenRecords({ responseText, extraction, proseStart, tokenRecords }) {
    const rawMatchStart = extraction.toRawOffset(proseStart);
    const containingFragment = extraction.fragments.find(fragment => (
        rawMatchStart >= fragment.rawStart && rawMatchStart < fragment.rawEnd
    ));
    if (!containingFragment) {
        throw new Error('Live deslop could not identify the XML-free prose fragment containing the detected match.');
    }

    const wordSpans = [];
    const wordPattern = /[a-z0-9']+/gi;
    let wordMatch = null;
    while ((wordMatch = wordPattern.exec(containingFragment.text)) !== null) {
        wordSpans.push({
            start: containingFragment.rawStart + wordMatch.index,
            end: containingFragment.rawStart + wordMatch.index + wordMatch[0].length
        });
    }
    let initialWordIndex = wordSpans.findIndex(span => rawMatchStart >= span.start && rawMatchStart < span.end);
    if (initialWordIndex < 0) {
        initialWordIndex = wordSpans.findIndex(span => span.start >= rawMatchStart);
    }
    if (initialWordIndex < 0 && wordSpans.length) {
        initialWordIndex = wordSpans.length - 1;
    }

    const records = [];
    const seenStarts = new Set();
    for (let wordIndex = initialWordIndex; wordIndex >= 0; wordIndex -= 1) {
        const wordStart = wordSpans[wordIndex].start;
        const record = tokenRecords.find(tokenRecord => (
            tokenRecord.start <= wordStart && tokenRecord.end > wordStart
        )) || tokenRecords.find(tokenRecord => (
            tokenRecord.start >= wordStart && tokenRecord.start < wordSpans[wordIndex].end
        ));
        if (!record || record.start < containingFragment.rawStart || seenStarts.has(record.start)) {
            continue;
        }
        seenStarts.add(record.start);
        records.push(record);
    }

    if (!records.length) {
        const record = tokenRecords.find(tokenRecord => (
            tokenRecord.start <= rawMatchStart && tokenRecord.end > rawMatchStart
        ));
        if (record && record.start >= containingFragment.rawStart) {
            records.push(record);
        }
    }
    if (!records.length) {
        throw new Error('Live deslop cannot rewind because no sampled token covers the detected prose.');
    }
    return records;
}

class LiveDeslopController {
    constructor({ detectSlop } = {}) {
        if (typeof detectSlop !== 'function') {
            throw new TypeError('LiveDeslopController requires a detectSlop function.');
        }
        this.detectSlop = detectSlop;
        this.lastAnalyzedProse = null;
        this.corrections = [];
        this.triedTokensByPrefix = new Map();
        this.seenPrefills = new Set();
    }

    beginGeneration() {
        this.lastAnalyzedProse = null;
        this.triedTokensByPrefix.clear();
        this.seenPrefills.clear();
    }

    async inspect({
        responseText,
        tokenRecords,
        proseMode = 'structured',
        responseComplete = false,
        preserveTools = false
    } = {}) {
        if (typeof responseText !== 'string') {
            throw new TypeError('Live deslop inspection requires responseText.');
        }
        if (!Array.isArray(tokenRecords)) {
            throw new TypeError('Live deslop inspection requires tokenRecords.');
        }
        if (proseMode !== 'structured' && proseMode !== 'plain') {
            throw new Error(`Unsupported live deslop prose mode: ${proseMode}`);
        }

        const extractStable = proseMode === 'plain'
            ? extractStableLivePlainProse
            : extractStableLiveProse;
        const extraction = responseComplete
            ? (proseMode === 'plain' ? extractLivePlainProse(responseText) : extractLiveProse(responseText))
            : extractStable(responseText);
        if (!extraction.prose.trim() || extraction.prose === this.lastAnalyzedProse) {
            return null;
        }
        this.lastAnalyzedProse = extraction.prose;
        const detected = await this.detectSlop(extraction.prose, {
            ngramSegments: extraction.ngramSegments
        });
        if (!detected) {
            return null;
        }
        if (!Number.isInteger(detected.start) || detected.start < 0 || detected.start >= extraction.prose.length) {
            throw new Error('Live slop detector returned an invalid match start offset.');
        }

        const rewindRecords = collectRewindTokenRecords({
            responseText,
            extraction,
            proseStart: detected.start,
            tokenRecords
        });
        for (const rewindRecord of rewindRecords) {
            const branchPrefix = responseText.slice(0, rewindRecord.start);
            const branchKey = branchPrefix;
            const triedTokens = this.triedTokensByPrefix.get(branchKey) || new Set();
            if (rewindRecord.id !== undefined && rewindRecord.id !== null) {
                triedTokens.add(`id:${rewindRecord.id}`);
            }
            triedTokens.add(`text:${rewindRecord.token}`);
            this.triedTokensByPrefix.set(branchKey, triedTokens);

            const alternatives = Array.isArray(rewindRecord.top_logprobs)
                ? [...rewindRecord.top_logprobs].sort((left, right) => Number(right?.logprob) - Number(left?.logprob))
                : [];
            for (const alternative of alternatives) {
                if (!alternative || typeof alternative.token !== 'string' || !alternative.token) {
                    continue;
                }
                const idKey = alternative.id !== undefined && alternative.id !== null
                    ? `id:${alternative.id}`
                    : null;
                const textKey = `text:${alternative.token}`;
                if ((idKey && triedTokens.has(idKey)) || triedTokens.has(textKey)) {
                    continue;
                }
                triedTokens.add(textKey);
                if (idKey) {
                    triedTokens.add(idKey);
                }
                if (/[<>\u0000]/.test(alternative.token)) {
                    continue;
                }

                const nextPrefill = `${branchPrefix}${alternative.token}`;
                if (this.seenPrefills.has(nextPrefill)) {
                    continue;
                }
                const candidateExtraction = extractStable(nextPrefill);
                const candidateDetected = await this.detectSlop(candidateExtraction.prose, {
                    ngramSegments: candidateExtraction.ngramSegments
                });
                if (candidateDetected) {
                    continue;
                }

                this.seenPrefills.add(nextPrefill);
                const correction = {
                    rewindOffset: rewindRecord.start,
                    rewoundPastMatch: rewindRecord.start < extraction.toRawOffset(detected.start),
                    rejectedToken: rewindRecord.token,
                    rejectedTokenId: rewindRecord.id ?? null,
                    alternativeToken: alternative.token,
                    alternativeTokenId: alternative.id ?? null,
                    rejectedLogprob: rewindRecord.logprob ?? null,
                    alternativeLogprob: alternative.logprob ?? null,
                    matchType: detected.type,
                    matchLabel: detected.label,
                    slopWords: [...(detected.slopWords || [])],
                    slopRegexes: [...(detected.slopRegexes || [])],
                    slopNgrams: [...(detected.slopNgrams || [])]
                };
                this.corrections.push(correction);
                return {
                    rewindOffset: rewindRecord.start,
                    alternative: {
                        ...alternative,
                        top_logprobs: alternatives
                    },
                    disableTools: preserveTools !== true,
                    diagnostic: correction
                };
            }
        }

        throw new Error(
            `Live deslop found ${detected.type} "${detected.label}" but no sampled token alternative was viable, `
            + (proseMode === 'plain'
                ? 'even after rewinding one word at a time to the start of the draft.'
                : 'even after rewinding one word at a time to the preceding XML boundary.')
        );
    }

    getDiagnostics() {
        const unique = key => Array.from(new Set(this.corrections.flatMap(correction => correction[key] || [])));
        return {
            ran: this.corrections.length > 0,
            corrections: this.corrections.map(correction => ({ ...correction })),
            slopWords: unique('slopWords'),
            slopRegexes: unique('slopRegexes'),
            slopNgrams: unique('slopNgrams')
        };
    }
}

module.exports = {
    LiveDeslopController,
    LiveRepeatedNgramDetector,
    extractLiveProse,
    extractLivePlainProse,
    extractStableLiveProse,
    extractStableLivePlainProse,
    locateDetectedSlop,
    resolveTinyBrainLiveDeslopProseMode,
    sanitizeLiveSlopText
};
