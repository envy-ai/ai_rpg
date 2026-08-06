const Utils = require('./Utils.js');

function requireResponseText(response, label) {
    if (typeof response !== 'string' || !response.trim()) {
        throw new Error(`${label} requires a non-empty response.`);
    }
    return response.trim();
}

function parseStrictXml(response, label) {
    const xml = requireResponseText(response, label);
    if (!xml.startsWith('<') || !xml.endsWith('>')) {
        throw new Error(`${label} must contain XML only.`);
    }
    let doc;
    try {
        doc = Utils.parseXmlDocumentStrict(xml, 'text/xml');
    } catch (error) {
        throw new Error(`${label} contains malformed XML: ${error.message}`);
    }
    return { xml, doc, root: doc.documentElement };
}

function normalizedTagName(node) {
    return String(node?.tagName || '').trim().toLowerCase();
}

function directChildElements(node) {
    return Array.from(node?.childNodes || []).filter(child => child?.nodeType === 1);
}

function directChildrenByTagName(node, tagName) {
    const expected = String(tagName || '').toLowerCase();
    return directChildElements(node).filter(child => normalizedTagName(child) === expected);
}

function requireSingleDirectChild(node, tagName, label, { allowEmpty = false } = {}) {
    const matches = directChildrenByTagName(node, tagName);
    if (matches.length !== 1) {
        throw new Error(`${label} requires exactly one direct <${tagName}> child.`);
    }
    const text = String(matches[0].textContent || '').trim();
    if (!allowEmpty && !text) {
        throw new Error(`${label} requires non-empty <${tagName}> content.`);
    }
    return { node: matches[0], text };
}

function rejectUnexpectedDirectChildren(node, allowedTags, label) {
    const allowed = new Set(allowedTags.map(tag => String(tag).toLowerCase()));
    const unexpected = directChildElements(node)
        .map(normalizedTagName)
        .filter(tag => !allowed.has(tag));
    if (unexpected.length) {
        throw new Error(`${label} contains unexpected direct child <${unexpected[0]}>.`);
    }
}

function parseBooleanText(text, fieldLabel) {
    const normalized = String(text || '').trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes') {
        return true;
    }
    if (normalized === 'false' || normalized === 'no') {
        return false;
    }
    throw new Error(`${fieldLabel} must be true/false or yes/no.`);
}

function parseExactXmlRoot(response, expectedRoot, { allowEmptyRoot = false } = {}) {
    const rootLabel = `<${expectedRoot}> response`;
    const parsed = parseStrictXml(response, rootLabel);
    if (normalizedTagName(parsed.root) !== String(expectedRoot).toLowerCase()) {
        throw new Error(`${rootLabel} must use <${expectedRoot}> as its document root.`);
    }
    if (!allowEmptyRoot && !String(parsed.root.textContent || '').trim() && !directChildElements(parsed.root).length) {
        throw new Error(`${rootLabel} cannot be empty.`);
    }
    return { value: parsed.xml };
}

function parseRevisionDecision(response) {
    const { xml, root } = parseStrictXml(response, 'revision decision');
    if (normalizedTagName(root) !== 'revisiondecision') {
        throw new Error('Revision decision must use <revisionDecision> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['revise', 'issues'], 'Revision decision');
    const revise = parseBooleanText(
        requireSingleDirectChild(root, 'revise', 'Revision decision').text,
        'Revision decision <revise>'
    );
    const issues = directChildrenByTagName(root, 'issues');
    if (issues.length > 1) {
        throw new Error('Revision decision may contain at most one direct <issues> child.');
    }
    const issueText = issues.length ? String(issues[0].textContent || '').trim() : '';
    if (revise && !issueText) {
        throw new Error('Revision decision requires non-empty <issues> when revision is requested.');
    }
    return { value: { revise, issues: issueText, xml } };
}

function parseAllowedCharacterSelection(response, allowedNames, minimum = 0, maximum = 3) {
    if (!Array.isArray(allowedNames) || allowedNames.some(name => typeof name !== 'string' || !name.trim())) {
        throw new TypeError('Allowed character selection requires an array of non-empty names.');
    }
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || maximum < minimum) {
        throw new RangeError('Allowed character selection requires valid integer bounds.');
    }
    const { root } = parseStrictXml(response, 'character selection');
    if (normalizedTagName(root) !== 'selectedcharacters') {
        throw new Error('Character selection must use <selectedCharacters> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['name'], 'Character selection');
    const canonicalNames = new Map(allowedNames.map(name => [name.trim().toLowerCase(), name.trim()]));
    const selected = directChildrenByTagName(root, 'name').map(node => String(node.textContent || '').trim());
    if (selected.length < minimum || selected.length > maximum) {
        throw new Error(`Character selection must contain between ${minimum} and ${maximum} names.`);
    }
    const seen = new Set();
    const resolved = selected.map(name => {
        const canonical = canonicalNames.get(name.toLowerCase());
        if (!canonical) {
            throw new Error(`Character selection contains unavailable character "${name}".`);
        }
        const key = canonical.toLowerCase();
        if (seen.has(key)) {
            throw new Error(`Character selection contains duplicate character "${canonical}".`);
        }
        seen.add(key);
        return canonical;
    });
    return { value: resolved };
}

function parseNarrativeScope(response) {
    const { root } = parseStrictXml(response, 'narrative scope');
    if (normalizedTagName(root) !== 'narrativescope') {
        throw new Error('Narrative scope must use <narrativeScope> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['travel', 'before', 'during', 'after'], 'Narrative scope');
    const traveling = parseBooleanText(
        requireSingleDirectChild(root, 'travel', 'Narrative scope').text,
        'Narrative scope <travel>'
    );
    const readOptional = tagName => {
        const matches = directChildrenByTagName(root, tagName);
        if (matches.length > 1) {
            throw new Error(`Narrative scope may contain at most one direct <${tagName}> child.`);
        }
        return matches.length ? String(matches[0].textContent || '').trim() : '';
    };
    return {
        value: {
            travel: traveling,
            before: readOptional('before'),
            during: readOptional('during'),
            after: readOptional('after')
        }
    };
}

function parseOutcomeAcknowledgement(response, expectedFacts = []) {
    if (!Array.isArray(expectedFacts) || expectedFacts.some(fact => typeof fact !== 'string' || !fact.trim())) {
        throw new TypeError('Outcome acknowledgement requires an array of non-empty expected facts.');
    }
    const { root } = parseStrictXml(response, 'outcome acknowledgement');
    if (normalizedTagName(root) !== 'outcomeacknowledgement') {
        throw new Error('Outcome acknowledgement must use <outcomeAcknowledgement> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['fact'], 'Outcome acknowledgement');
    const facts = directChildrenByTagName(root, 'fact').map(node => String(node.textContent || '').trim());
    if (facts.length !== expectedFacts.length) {
        throw new Error(`Outcome acknowledgement requires exactly ${expectedFacts.length} facts.`);
    }
    expectedFacts.forEach((expected, index) => {
        if (facts[index] !== expected) {
            throw new Error(`Outcome acknowledgement fact ${index + 1} must exactly match "${expected}".`);
        }
    });
    return { value: facts };
}

function parseQuestRewardResult(response, expectedRewards) {
    const expectedRewardList = Array.isArray(expectedRewards)
        ? expectedRewards.map(reward => String(reward).trim())
        : null;
    const expectedRewardCount = expectedRewardList
        ? expectedRewardList.length
        : expectedRewards;
    if (
        !Number.isInteger(expectedRewardCount)
        || expectedRewardCount < 1
        || (expectedRewardList && expectedRewardList.some(reward => !reward))
    ) {
        throw new RangeError('Quest reward parser requires a positive count or non-empty reward list.');
    }
    const { xml, root } = parseStrictXml(response, 'quest reward result');
    if (normalizedTagName(root) !== 'questrewardresult') {
        throw new Error('Quest reward result must use <questRewardResult> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['prose', 'rewardcoverage'], 'Quest reward result');
    requireSingleDirectChild(root, 'prose', 'Quest reward result');
    const coverageNodes = directChildrenByTagName(root, 'rewardcoverage');
    if (coverageNodes.length !== expectedRewardCount) {
        throw new Error(`Quest reward result requires exactly ${expectedRewardCount} <rewardCoverage> entries.`);
    }
    const seenIndexes = new Set();
    coverageNodes.forEach(node => {
        const indexText = requireSingleDirectChild(node, 'index', 'Quest reward coverage').text;
        const index = Number(indexText);
        if (!Number.isInteger(index) || index < 1 || index > expectedRewardCount || seenIndexes.has(index)) {
            throw new Error(`Quest reward coverage contains invalid or duplicate index "${indexText}".`);
        }
        seenIndexes.add(index);
        const included = requireSingleDirectChild(node, 'included', 'Quest reward coverage').text;
        if (expectedRewardList && included !== expectedRewardList[index - 1]) {
            throw new Error(
                `Quest reward coverage ${index} must exactly match "${expectedRewardList[index - 1]}".`
            );
        }
    });
    return {
        value: {
            xml,
            prose: requireSingleDirectChild(root, 'prose', 'Quest reward result').text,
            coveredRewardIndexes: Array.from(seenIndexes).sort((left, right) => left - right)
        }
    };
}

function parseGameIntroResult(response) {
    const { xml, root } = parseStrictXml(response, 'game intro result');
    if (normalizedTagName(root) !== 'gameintro') {
        throw new Error('Game intro result must use <gameIntro> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['introprose'], 'Game intro result');
    requireSingleDirectChild(root, 'introProse', 'Game intro result');
    return { value: xml };
}

function parseTurnNarrativeResult(response, { allowTravel = true } = {}) {
    const { xml, root } = parseStrictXml(response, 'turn narrative result');
    const rootName = normalizedTagName(root);
    const allowedRoots = allowTravel ? ['turnresult', 'moveturnresult'] : ['turnresult'];
    if (!allowedRoots.includes(rootName)) {
        throw new Error(`Turn narrative result must use ${allowTravel ? '<turnResult> or <moveTurnResult>' : '<turnResult>'} as its document root.`);
    }
    if (rootName === 'turnresult') {
        requireSingleDirectChild(root, 'prose', 'Turn narrative result');
    } else {
        const proseTags = ['originprose', 'betweenprose', 'destinationprose'];
        if (!proseTags.some(tag => directChildrenByTagName(root, tag).some(node => String(node.textContent || '').trim()))) {
            throw new Error('Move turn narrative result requires player-facing travel prose.');
        }
    }
    return { value: xml };
}

function parseCraftNarrativeResult(response, {
    requireOtherEffect = false,
    expectedDurationMinutes = null
} = {}) {
    const { xml, root } = parseStrictXml(response, 'craft narrative result');
    if (normalizedTagName(root) !== 'result') {
        throw new Error('Craft narrative result must use <result> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['description', 'othereffectdescription', 'timepassed'], 'Craft narrative result');
    requireSingleDirectChild(root, 'description', 'Craft narrative result');
    const otherEffects = directChildrenByTagName(root, 'otherEffectDescription');
    if (requireOtherEffect && (otherEffects.length !== 1 || !String(otherEffects[0].textContent || '').trim())) {
        throw new Error('Craft narrative result requires one non-empty <otherEffectDescription>.');
    }
    if (!requireOtherEffect && otherEffects.length > 1) {
        throw new Error('Craft narrative result may contain at most one <otherEffectDescription>.');
    }
    const timePassedNode = requireSingleDirectChild(root, 'timePassed', 'Craft narrative result').node;
    if (expectedDurationMinutes !== null) {
        if (!Number.isInteger(expectedDurationMinutes) || expectedDurationMinutes < 1) {
            throw new RangeError('Craft narrative expected duration must be a positive integer.');
        }
        const durationText = requireSingleDirectChild(
            timePassedNode,
            'duration',
            'Craft narrative <timePassed>'
        ).text;
        const expectedText = `${expectedDurationMinutes} minutes`;
        if (durationText !== expectedText) {
            throw new Error(`Craft narrative duration must exactly match "${expectedText}".`);
        }
    }
    return { value: xml };
}

function parseLocationModificationNarrativeResult(response, { expectedDurationMinutes = null } = {}) {
    const parsed = parseCraftNarrativeResult(response, {
        requireOtherEffect: false,
        expectedDurationMinutes
    });
    const { root } = parseStrictXml(response, 'location modification narrative result');
    requireSingleDirectChild(root, 'otherEffectDescription', 'Location modification narrative result', { allowEmpty: true });
    return parsed;
}

function parseContainerOpenNarrativeResult(response, { expectedToolName = null } = {}) {
    const { xml, root } = parseStrictXml(response, 'container open result');
    if (normalizedTagName(root) !== 'containeropenresult') {
        throw new Error('Container open result must use <containerOpenResult> as its document root.');
    }
    rejectUnexpectedDirectChildren(
        root,
        ['toolused', 'checkresult', 'success', 'permanentlyopened', 'prose', 'timepassed'],
        'Container open result'
    );
    const toolUsed = requireSingleDirectChild(root, 'toolUsed', 'Container open result').text;
    if (!['resolveSkillCheck', 'resolveOpposedSkillCheck'].includes(toolUsed)) {
        throw new Error('Container open result <toolUsed> must name the check tool that was used.');
    }
    if (expectedToolName !== null && toolUsed !== expectedToolName) {
        throw new Error(`Container open result <toolUsed> must exactly match "${expectedToolName}".`);
    }
    requireSingleDirectChild(root, 'checkResult', 'Container open result');
    parseBooleanText(requireSingleDirectChild(root, 'success', 'Container open result').text, 'Container open result <success>');
    parseBooleanText(
        requireSingleDirectChild(root, 'permanentlyOpened', 'Container open result').text,
        'Container open result <permanentlyOpened>'
    );
    requireSingleDirectChild(root, 'prose', 'Container open result');
    requireSingleDirectChild(root, 'timePassed', 'Container open result');
    return { value: xml };
}

function parseWhileYouWereAwayResult(response) {
    const { xml, root } = parseStrictXml(response, 'while-you-were-away result');
    if (normalizedTagName(root) !== 'response') {
        throw new Error('While-you-were-away result must use <response> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['proseforplayer', 'characterupdates', 'itemscenerymoves'], 'While-you-were-away result');
    requireSingleDirectChild(root, 'proseForPlayer', 'While-you-were-away result');
    requireSingleDirectChild(root, 'characterUpdates', 'While-you-were-away result', { allowEmpty: true });
    requireSingleDirectChild(root, 'itemSceneryMoves', 'While-you-were-away result', { allowEmpty: true });
    return { value: xml };
}

function parseWhileAwayCharacterUpdate(response, expectedName) {
    if (typeof expectedName !== 'string' || !expectedName.trim()) {
        throw new TypeError('While-you-were-away character update requires an expected name.');
    }
    const { xml, root } = parseStrictXml(response, 'while-you-were-away character update');
    if (normalizedTagName(root) !== 'characterupdate') {
        throw new Error('While-you-were-away character update must use <characterUpdate> as its document root.');
    }
    const name = requireSingleDirectChild(root, 'name', 'While-you-were-away character update').text;
    if (name !== expectedName.trim()) {
        throw new Error(`While-you-were-away character update name must exactly match "${expectedName.trim()}".`);
    }
    return { value: { xml, name } };
}

function canonicalizeXmlElement(node) {
    const attributes = Array.from(node?.attributes || [])
        .map(attribute => [String(attribute.name), String(attribute.value)])
        .sort((left, right) => left[0].localeCompare(right[0]));
    const children = Array.from(node?.childNodes || []).flatMap(child => {
        if (child?.nodeType === 1) {
            return [canonicalizeXmlElement(child)];
        }
        if (child?.nodeType === 3 || child?.nodeType === 4) {
            const text = String(child.nodeValue || '').replace(/\s+/g, ' ').trim();
            return text ? [{ text }] : [];
        }
        return [];
    });
    return { tag: normalizedTagName(node), attributes, children };
}

function parseXmlRootForComparison(xml, expectedRoot, label) {
    const parsed = parseStrictXml(xml, label);
    if (normalizedTagName(parsed.root) !== expectedRoot.toLowerCase()) {
        throw new Error(`${label} must use <${expectedRoot}> as its document root.`);
    }
    return parsed.root;
}

function parseWhileYouWereAwayStagedResult(response, {
    characterUpdateXml = [],
    arrivalUpdatesXml,
    itemSceneryMovesXml
} = {}) {
    if (!Array.isArray(characterUpdateXml)) {
        throw new TypeError('Staged while-you-were-away character updates must be an array.');
    }
    const parsedFinal = parseWhileYouWereAwayResult(response);
    const finalRoot = parseXmlRootForComparison(response, 'response', 'staged while-you-were-away final response');
    const finalUpdatesRoot = requireSingleDirectChild(
        finalRoot,
        'characterUpdates',
        'Staged while-you-were-away final response',
        { allowEmpty: true }
    ).node;
    const finalMoveRoot = requireSingleDirectChild(
        finalRoot,
        'itemSceneryMoves',
        'Staged while-you-were-away final response',
        { allowEmpty: true }
    ).node;
    const expectedUpdateNodes = characterUpdateXml.map((xml, index) => (
        parseXmlRootForComparison(xml, 'characterUpdate', `staged character update ${index + 1}`)
    ));
    const arrivalsRoot = parseXmlRootForComparison(
        arrivalUpdatesXml,
        'characterUpdates',
        'staged arrival updates'
    );
    expectedUpdateNodes.push(...directChildrenByTagName(arrivalsRoot, 'characterUpdate'));
    const finalUpdateNodes = directChildrenByTagName(finalUpdatesRoot, 'characterUpdate');
    if (finalUpdateNodes.length !== expectedUpdateNodes.length) {
        throw new Error('Final while-you-were-away response changed the staged character-update count.');
    }
    expectedUpdateNodes.forEach((expectedNode, index) => {
        if (JSON.stringify(canonicalizeXmlElement(expectedNode)) !== JSON.stringify(canonicalizeXmlElement(finalUpdateNodes[index]))) {
            throw new Error(`Final while-you-were-away response changed staged character update ${index + 1}.`);
        }
    });
    const expectedMoveRoot = parseXmlRootForComparison(
        itemSceneryMovesXml,
        'itemSceneryMoves',
        'staged item/scenery moves'
    );
    if (JSON.stringify(canonicalizeXmlElement(expectedMoveRoot)) !== JSON.stringify(canonicalizeXmlElement(finalMoveRoot))) {
        throw new Error('Final while-you-were-away response changed the staged item/scenery moves.');
    }
    return parsedFinal;
}

function parseScheduledEventNarrativeResult(response) {
    const { xml, root } = parseStrictXml(response, 'scheduled event result');
    if (normalizedTagName(root) !== 'scheduledeventresult') {
        throw new Error('Scheduled event result must use <scheduledEventResult> as its document root.');
    }
    rejectUnexpectedDirectChildren(root, ['summary', 'proseforplayer'], 'Scheduled event result');
    const children = directChildElements(root);
    if (!children.length) {
        return { value: xml };
    }
    requireSingleDirectChild(root, 'summary', 'Scheduled event result');
    if (directChildrenByTagName(root, 'proseForPlayer').length > 1) {
        throw new Error('Scheduled event result may contain at most one <proseForPlayer>.');
    }
    return { value: xml };
}

function parseScheduledEventStagedResult(response, {
    happened,
    expectedSummary = '',
    playerPresent = false
} = {}) {
    const parsed = parseScheduledEventNarrativeResult(response);
    const { root } = parseStrictXml(response, 'staged scheduled event result');
    if (!happened) {
        if (directChildElements(root).length || String(root.textContent || '').trim()) {
            throw new Error('Skipped staged scheduled event must return an empty <scheduledEventResult/>.');
        }
        return parsed;
    }
    const summary = requireSingleDirectChild(root, 'summary', 'Staged scheduled event result').text;
    if (summary !== String(expectedSummary || '').trim()) {
        throw new Error('Final scheduled event summary must exactly match the approved summary checkpoint.');
    }
    const playerProseNodes = directChildrenByTagName(root, 'proseForPlayer');
    if (playerPresent && (playerProseNodes.length !== 1 || !String(playerProseNodes[0].textContent || '').trim())) {
        throw new Error('Staged scheduled event in the player location requires non-empty <proseForPlayer>.');
    }
    if (!playerPresent && playerProseNodes.length) {
        throw new Error('Offscreen staged scheduled event must not include <proseForPlayer>.');
    }
    return parsed;
}

function canonicalizeInterruptionResult(root) {
    const proseTags = new Set(['prose', 'originprose', 'betweenprose', 'destinationprose']);
    const visit = node => {
        const tag = normalizedTagName(node);
        if (proseTags.has(tag)) {
            return { tag, playerFacingProse: true };
        }
        const attributes = Array.from(node?.attributes || [])
            .map(attribute => [String(attribute.name), String(attribute.value)])
            .sort((left, right) => left[0].localeCompare(right[0]));
        const children = Array.from(node?.childNodes || []).flatMap(child => {
            if (child?.nodeType === 1) {
                return [visit(child)];
            }
            if (child?.nodeType === 3 || child?.nodeType === 4) {
                const text = String(child.nodeValue || '').replace(/\s+/g, ' ').trim();
                return text ? [{ text }] : [];
            }
            return [];
        });
        return { tag, attributes, children };
    };
    return visit(root);
}

function parseScheduledEventInterruptionRewrite(response, originalXml) {
    const finalParsed = parseStrictXml(response, 'scheduled-event interruption rewrite');
    const originalParsed = parseStrictXml(originalXml, 'original scheduled-event interruption XML');
    const finalRootName = normalizedTagName(finalParsed.root);
    const originalRootName = normalizedTagName(originalParsed.root);
    if (!['turnresult', 'moveturnresult'].includes(originalRootName)) {
        throw new Error('Original scheduled-event interruption XML must use <turnResult> or <moveTurnResult>.');
    }
    if (finalRootName !== originalRootName) {
        throw new Error('Scheduled-event interruption rewrite changed the original XML root.');
    }
    if (
        JSON.stringify(canonicalizeInterruptionResult(finalParsed.root))
        !== JSON.stringify(canonicalizeInterruptionResult(originalParsed.root))
    ) {
        throw new Error('Scheduled-event interruption rewrite changed a non-prose XML field.');
    }
    parseTurnNarrativeResult(response, { allowTravel: true });
    return { value: finalParsed.xml };
}

module.exports = {
    parseAllowedCharacterSelection,
    parseContainerOpenNarrativeResult,
    parseCraftNarrativeResult,
    parseExactXmlRoot,
    parseGameIntroResult,
    parseLocationModificationNarrativeResult,
    parseNarrativeScope,
    parseOutcomeAcknowledgement,
    parseQuestRewardResult,
    parseRevisionDecision,
    parseScheduledEventNarrativeResult,
    parseScheduledEventInterruptionRewrite,
    parseScheduledEventStagedResult,
    parseTurnNarrativeResult,
    parseWhileAwayCharacterUpdate,
    parseWhileYouWereAwayResult,
    parseWhileYouWereAwayStagedResult
};
