const { XmlClosingTagGuard } = require('./XmlClosingTagGuard.js');
const Utils = require('./Utils.js');

const DEFAULT_PROSE_TAGS = Object.freeze(['prose', 'originProse', 'betweenProse', 'destinationProse']);
const LIVE_DESLOP_PROSE_PROFILES = Object.freeze({
    player_action: DEFAULT_PROSE_TAGS,
    event_checks: DEFAULT_PROSE_TAGS,
    quest_reward_prose: Object.freeze(['prose']),
    game_intro: Object.freeze(['introProse']),
    random_event: DEFAULT_PROSE_TAGS,
    creative_mode_action: DEFAULT_PROSE_TAGS,
    npc_action: Object.freeze(['prose']),
    craft_player_action: Object.freeze(['description', 'otherEffectDescription']),
    location_modify_player_action: Object.freeze(['description', 'otherEffectDescription']),
    player_action_open_container: Object.freeze(['prose']),
    while_you_were_away: Object.freeze(['proseForPlayer']),
    scheduled_event_resolution: Object.freeze(['proseForPlayer']),
    scheduled_event_interruption_rewrite: DEFAULT_PROSE_TAGS
});
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

function normalizeProseTags(proseTags = DEFAULT_PROSE_TAGS) {
    if (!Array.isArray(proseTags) || !proseTags.length) {
        throw new TypeError('Live deslop prose tags must be a non-empty array.');
    }
    const normalized = proseTags.map(tagName => {
        if (typeof tagName !== 'string' || !/^[a-z_][\w:.-]*$/i.test(tagName.trim())) {
            throw new Error(`Invalid live deslop prose tag: ${tagName}`);
        }
        return tagName.trim();
    });
    if (new Set(normalized.map(tagName => tagName.toLowerCase())).size !== normalized.length) {
        throw new Error('Live deslop prose tags cannot contain duplicates.');
    }
    return normalized;
}

function resolveLiveDeslopProseTags(profileName) {
    if (typeof profileName !== 'string' || !Object.hasOwn(LIVE_DESLOP_PROSE_PROFILES, profileName)) {
        throw new Error(`Unknown live deslop prose profile: ${profileName}`);
    }
    return [...LIVE_DESLOP_PROSE_PROFILES[profileName]];
}

function extractLiveProse(rawResponse, { proseTags = DEFAULT_PROSE_TAGS } = {}) {
    if (typeof rawResponse !== 'string') {
        throw new TypeError('extractLiveProse requires a string response.');
    }

    const segments = [];
    const tagPattern = new RegExp(
        `<(${normalizeProseTags(proseTags).map(escapeRegExp).join('|')})(?:\\s[^>]*)?>`,
        'gi'
    );
    let openingMatch = null;
    while ((openingMatch = tagPattern.exec(rawResponse)) !== null) {
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
        tagPattern.lastIndex = closingMatch.index + closingMatch[0].length;
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

function extractStableLiveProse(rawResponse, { proseTags = DEFAULT_PROSE_TAGS } = {}) {
    const extraction = extractLiveProse(rawResponse, { proseTags });
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
    return extractLiveProse(stableRawResponse, { proseTags });
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

function resolveTinyBrainLiveDeslopProseMode({ messages, isFinal = false, checkpoint = null } = {}) {
    if (
        checkpoint?.parserName === 'player_action_required_prose'
        || checkpoint?.parserName === 'player_action_optional_prose'
    ) {
        return 'plain';
    }
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
        this.xmlGuard = null;
        this.eosContinuations = 0;
        this.forcedContinuations = 0;
    }

    beginGeneration() {
        this.lastAnalyzedProse = null;
        this.triedTokensByPrefix.clear();
        this.seenPrefills.clear();
        this.xmlGuard?.beginGeneration();
        this.eosContinuations = 0;
        this.forcedContinuations = 0;
    }

    async inspect({
        responseText,
        tokenRecords,
        proseMode = 'structured',
        proseTags = DEFAULT_PROSE_TAGS,
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

        const normalizedProseTags = proseMode === 'structured'
            ? normalizeProseTags(proseTags)
            : DEFAULT_PROSE_TAGS;
        const extractStable = proseMode === 'plain'
            ? extractStableLivePlainProse
            : response => extractStableLiveProse(response, { proseTags: normalizedProseTags });
        const extraction = responseComplete
            ? (proseMode === 'plain'
                ? extractLivePlainProse(responseText)
                : extractLiveProse(responseText, { proseTags: normalizedProseTags }))
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
        return this.selectBranch({ responseText, rewindRecords, detected, preserveTools,
            matchRawStart: extraction.toRawOffset(detected.start),
            isCandidateAllowed: async candidate => {
                const candidateExtraction = extractStable(candidate);
                return !await this.detectSlop(candidateExtraction.prose, { ngramSegments: candidateExtraction.ngramSegments });
            },
            exhaustion: proseMode === 'plain' ? 'to the start of the draft' : 'to the preceding XML boundary'
        });
    }

    ensureXmlGuard({ mode, schema, expectedRootTags, allowToolCalls }) {
        const roots = schema ? [schema.name] : expectedRootTags || [];
        if (!this.xmlGuard || this.xmlGuard.mode !== (roots.length ? true : mode) || this.xmlGuard.schema !== schema
            || this.xmlGuard.allowToolCalls !== allowToolCalls
            || this.xmlGuard.expectedRootTags.length !== roots.length
            || this.xmlGuard.expectedRootTags.some((name, index) => name !== roots[index])) {
            this.xmlGuard = new XmlClosingTagGuard({ mode, schema, expectedRootTags, allowToolCalls, stopAtDocumentEnd: Boolean(schema) });
        }
        return this.xmlGuard;
    }

    async inspectXml({ responseText, tokenRecords, preserveTools = true, mode = true, schema = null, expectedRootTags = null,
        remainingTokens = null, continuationLimit = 1, canStopEarly = true, hasToolCalls = false, allowToolCalls = true } = {}) {
        if (hasToolCalls) return null;
        if (typeof responseText !== 'string' || !Array.isArray(tokenRecords)) throw new TypeError('XML closing guard requires responseText and tokenRecords.');
        this.ensureXmlGuard({ mode, schema, expectedRootTags, allowToolCalls });
        const match = this.xmlGuard.inspect(responseText);
        if (!match) return canStopEarly ? this.completedSchemaDecision(responseText) : null;
        const inside = tokenRecords.filter(record => record.end > match.start && record.start < match.end);
        const previous = tokenRecords.filter(record => record.end <= match.start).reverse();
        const rewindRecords = schema ? inside : [...inside, ...previous];
        const label = match.message || `</${match.actualName}>; expected ${match.expectedName ? `</${match.expectedName}>` : 'no closing tag'}`;
        try { return await this.selectBranch({ responseText, rewindRecords, preserveTools, allowMarkup: true,
            detected: { type: match.kind || 'xml-closing-tag', label }, matchRawStart: match.start,
            isCandidateAllowed: candidate => new XmlClosingTagGuard({ mode, schema, expectedRootTags, allowToolCalls }).isViablePrefix(candidate),
            exhaustion: `through available sampled XML tokens (offset ${match.start}; regex ${match.pattern})`
        }); } catch (error) {
            if (match.kind === 'xml-tool-call-policy' || error.code !== 'LIVE_TOKEN_ALTERNATIVES_EXHAUSTED' || (!schema && !this.xmlGuard.cdataFrame)) throw error;
            return this.forceXmlStructure({ responseText, rewindOffset: match.rewindStart ?? match.start,
                remainingTokens, continuationLimit, preserveTools, reason: label });
        }
    }

    completedSchemaDecision(responseText) {
        const scanner = this.xmlGuard;
        if (!scanner?.schema || scanner.completedAt === null || scanner.detection || scanner.invalidMarkup) return null;
        return { documentComplete: true, responseText: responseText.slice(0, scanner.completedAt),
            completionOffset: scanner.completedAt, rewindOffset: scanner.completedAt, diagnostic: { matchType: 'xml-schema-complete',
                rewindOffset: scanner.completedAt, requirement: scanner.schema.name } };
    }

    completeSchemaAtEos({ responseText, remainingTokens, continuationLimit, preserveTools }) {
        const state = this.xmlGuard.terminalState(responseText);
        let rewindOffset = state.pendingMarkup ? state.pendingMarkupStart : responseText.length;
        let prefix = responseText.slice(0, rewindOffset);
        const steps = [];
        if (this.forcedContinuations >= continuationLimit) throw new Error(`Forced XML prefix limit exhausted or invalid (${this.forcedContinuations}/${continuationLimit}).`);
        while (true) {
            const retained = new XmlClosingTagGuard({ mode: true, schema: this.xmlGuard.schema, expectedRootTags: this.xmlGuard.expectedRootTags, allowToolCalls: this.xmlGuard.allowToolCalls, stopAtDocumentEnd: true });
            if (retained.inspect(prefix) || retained.invalidMarkup) throw new Error('Cannot complete schema over invalid retained XML.');
            if (retained.completedAt !== null) break;
            const next = retained.nextForcedPrefix(prefix);
            if (next.rewindOffset < rewindOffset) rewindOffset = next.rewindOffset;
            prefix = prefix.slice(0, next.rewindOffset) + next.text;
            const opening = next.text.startsWith('<') && !next.text.startsWith('</');
            steps.push({ requirement: next.requirement, kind: opening ? 'opening' : next.text === ']]>' ? 'cdata' : 'closing' });
            if (opening) break; // The model must supply this field's value.
        }
        if (this.seenPrefills.has(prefix)) throw new Error('Forced XML prefix would repeat a previously rejected prefix.');
        this.seenPrefills.add(prefix);
        this.forcedContinuations += 1;
        const documentComplete = steps.length > 0 && steps.at(-1).kind !== 'opening';
        const diagnostic = { matchType: 'xml-schema-eos-completion', synthetic: true, rewindOffset,
            requirement: steps.at(-1)?.requirement, requiredOpening: steps.at(-1)?.kind === 'opening', closedElements: steps.filter(step => step.kind !== 'opening').map(step => step.requirement),
            forceCount: this.forcedContinuations, forceLimit: continuationLimit, syntheticTagCount: steps.length };
        this.corrections.push(diagnostic);
        const common = { rewindOffset, syntheticPrefix: true, forcedStructure: true, syntheticTagCount: steps.length,
            terminalSample: true, syntheticActionCost: 1, disableTools: preserveTools !== true, diagnostic };
        if (documentComplete) return { ...common, documentComplete: true, responseText: prefix, completionOffset: prefix.length };
        return { ...common, alternative: { token: prefix.slice(rewindOffset) }, allowAppend: rewindOffset === responseText.length };
    }

    forceXmlStructure({ responseText, rewindOffset, remainingTokens, continuationLimit, preserveTools, reason }) {
        if (!Number.isSafeInteger(remainingTokens) || remainingTokens <= 0) throw new Error('Forced XML prefix requires remaining positive logical max_tokens budget.');
        if (!Number.isSafeInteger(continuationLimit) || continuationLimit <= 0 || this.forcedContinuations >= continuationLimit) {
            throw new Error(`Forced XML prefix limit exhausted or invalid (${this.forcedContinuations}/${continuationLimit}).`);
        }
        const next = this.xmlGuard.nextForcedPrefix(responseText, rewindOffset);
        const prefix = responseText.slice(0, next.rewindOffset) + next.text;
        if (this.seenPrefills.has(prefix)) throw new Error('Forced XML prefix would repeat a previously rejected prefix.');
        this.seenPrefills.add(prefix);
        this.forcedContinuations += 1;
        const diagnostic = { matchType: this.xmlGuard.schema ? 'xml-schema-forced' : 'xml-cdata-forced',
            matchLabel: reason, synthetic: true, rewindOffset: next.rewindOffset, forcedText: next.text,
            forceCount: this.forcedContinuations, forceLimit: continuationLimit, requirement: next.requirement };
        this.corrections.push(diagnostic);
        return { rewindOffset: next.rewindOffset, alternative: { token: next.text }, syntheticPrefix: true,
            forcedStructure: true, allowAppend: next.rewindOffset === responseText.length,
            disableTools: preserveTools !== true, diagnostic };
    }

    async inspectXmlTerminal({ responseText, terminal, finishReason, hasToolCalls = false, mode = true,
        preserveTools = true, remainingTokens, continuationLimit = 1, schema = null, expectedRootTags = null, allowToolCalls = true } = {}) {
        if (hasToolCalls || finishReason === 'tool_calls') return null;
        this.ensureXmlGuard({ mode, schema, expectedRootTags, allowToolCalls });
        const violation = this.xmlGuard.inspect(responseText);
        if (violation?.kind === 'xml-tool-call-policy') throw new Error(violation.message);
        const state = this.xmlGuard.terminalState(responseText);
        if (!state.incomplete) return this.completedSchemaDecision(responseText);
        if (finishReason === 'length' && terminal?.reason !== 'eos_token') return null;
        const detail = `open=${state.openElements.join('/') || '(none)'}, pendingMarkup=${state.pendingMarkup}`;
        if (!terminal || terminal.reason === 'unknown' || typeof terminal.reason !== 'string') {
            throw new Error(`XML EOS guard cannot classify terminal ${finishReason || 'completion'}: missing observed EOS metadata (${detail}).`);
        }
        if (terminal.reason !== 'eos_token') {
            if (['stop_sequence', 'token_limit', 'repeated_token_guard', 'cancel', 'disconnect', 'error'].includes(terminal.reason)) return null;
            throw new Error(`XML EOS guard received an unknown terminal reason ${terminal.reason} (${detail}).`);
        }
        const sample = terminal.sample;
        const stops = terminal.stop_token_ids;
        if (finishReason !== 'stop' || !sample || !Number.isSafeInteger(sample.id) || sample.id < 0
            || !Number.isFinite(sample.logprob) || !Array.isArray(stops) || !stops.length
            || stops.some(id => !Number.isSafeInteger(id) || id < 0) || !stops.includes(sample.id)
            || !Array.isArray(sample.top_logprobs)
            || sample.top_logprobs.some(record => !Number.isSafeInteger(record?.id) || record.id < 0 || !Number.isFinite(record.logprob))) {
            throw new Error(`XML EOS guard received invalid actual-EOS sample metadata (${detail}).`);
        }
        if (state.missingRoot) {
            const wrappers = this.xmlGuard.expectedRootTags.map(name => `<${name}>...</${name}>`).join(' or ');
            const error = new Error(`EOS before the expected XML opening tag. Wrap your response in ${wrappers}.`);
            error.isResponseValidationError = true;
            error.isXmlMissingRootError = true;
            throw error;
        }
        if (!Number.isSafeInteger(remainingTokens) || remainingTokens <= 0) {
            throw new Error(`XML EOS continuation requires remaining positive logical max_tokens budget (${detail}).`);
        }
        if (!Number.isSafeInteger(continuationLimit) || continuationLimit <= 0 || this.eosContinuations >= continuationLimit) {
            throw new Error(`XML EOS continuation limit exhausted or invalid (${this.eosContinuations}/${continuationLimit}; ${detail}).`);
        }
        if (schema) {
            const completion = this.completeSchemaAtEos({ responseText, remainingTokens, continuationLimit, preserveTools });
            this.eosContinuations += 1;
            return completion;
        }
        const record = { ...sample, start: responseText.length, end: responseText.length,
            top_logprobs: sample.top_logprobs.filter(alternative => !stops.includes(alternative.id)) };
        let correction;
        try { correction = await this.selectBranch({ responseText, rewindRecords: [record], preserveTools,
            allowMarkup: true, matchRawStart: responseText.length,
            detected: { type: 'xml-eos', label: `EOS before XML completion (${detail})` },
            isCandidateAllowed: candidate => new XmlClosingTagGuard({ mode, schema, expectedRootTags, allowToolCalls }).isViablePrefix(candidate),
            exhaustion: 'at the terminal sample; earlier response text is retained'
        }); } catch (error) {
            if (error.code !== 'LIVE_TOKEN_ALTERNATIVES_EXHAUSTED' || (!schema && !this.xmlGuard.cdataFrame)) throw error;
            correction = this.forceXmlStructure({ responseText,
                rewindOffset: state.pendingMarkup ? state.pendingMarkupStart : responseText.length,
                remainingTokens, continuationLimit, preserveTools, reason: `EOS before XML completion (${detail})` });
        }
        this.eosContinuations += 1;
        return { ...correction, allowAppend: correction.rewindOffset === responseText.length, terminalSample: true };
    }

    async selectBranch({ responseText, rewindRecords, detected, preserveTools, isCandidateAllowed,
        matchRawStart, allowMarkup = false, exhaustion }) {
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
                if ((!allowMarkup && /[<>]/.test(alternative.token)) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(alternative.token)
                    || /<\|[^]*?\|>/.test(alternative.token)
                    || /^(?:<\/?(?:s|eos|bos|pad|unk)>|\[\/?INST\])$/i.test(alternative.token)
                    || alternative.special === true || alternative.is_special === true) {
                    continue;
                }

                const nextPrefill = `${branchPrefix}${alternative.token}`;
                if (this.seenPrefills.has(nextPrefill)) {
                    continue;
                }
                if (!await isCandidateAllowed(nextPrefill)) continue;

                this.seenPrefills.add(nextPrefill);
                const correction = {
                    rewindOffset: rewindRecord.start,
                    rewoundPastMatch: rewindRecord.start < matchRawStart,
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

        const error = new Error(`Live token guard found ${detected.type} "${detected.label}" but no sampled token alternative was viable, ${exhaustion}.`);
        error.code = 'LIVE_TOKEN_ALTERNATIVES_EXHAUSTED';
        throw error;
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
    DEFAULT_PROSE_TAGS,
    LIVE_DESLOP_PROSE_PROFILES,
    LiveDeslopController,
    LiveRepeatedNgramDetector,
    extractLiveProse,
    extractLivePlainProse,
    extractStableLiveProse,
    extractStableLivePlainProse,
    locateDetectedSlop,
    resolveLiveDeslopProseTags,
    resolveTinyBrainLiveDeslopProseMode,
    sanitizeLiveSlopText
};
